// Bro Core · hearing. Groq Whisper (whisper-large-v3-turbo, then whisper-large-v3) turns one utterance into text.
// Input: a WAV file, raw 16-bit PCM (the live socket sends Int16 mono at 16 kHz) or any container Whisper reads (webm,
// ogg, mp3, m4a). PCM is wrapped in a WAV header and sent as multipart/form-data (FormData + Blob, Node 18+).
// Clips of 0.3 s or less are "empty" without a request, and Whisper's classic silence hallucinations ("Thank you.",
// "Thanks for watching", a lone "धन्यवाद") are dropped when the clip is near-silent or Whisper itself says it was
// probably not speech. v17: segments Whisper marks as non-speech (no_speech_prob > 0.6 with avg_logprob < -1) or as a
// repetition loop (compression_ratio > 2.4) are dropped; opts.prompt (the conversation language and Bro's last line)
// is passed to Whisper; Urdu is heard as Hindi (Bro speaks Hindi, not Urdu script). v20: opts.expect (the phrase a language
// lesson waits for) keeps that phrase even when it looks like a phantom ("gracias", "merci", "Thank you very much").
// v21 (soft voices): loudness is measured per 20 ms frame (the speech level, the noise floor, the SNR) instead of over the
// whole clip; recorder clips (webm, ogg, mp4…) are decoded with ffmpeg first so they are measured too. Quiet speech is
// raised to about -20 dBFS before Whisper hears it (at most +30 dB, never clipping). A clip is silence when its loud
// frames are under -58 dBFS or almost nothing rises 6 dB above its noise, and a short phantom-looking word ("okay", "thanks") is dropped only when Whisper doubts it or
// it is both very quiet and barely above the noise.
// → { text, lang, confidence (mean avg_logprob of the kept segments, or null), model, duration, level }.
'use strict';
const os = require('os'), fsp = require('fs').promises, pathM = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');

const GROQ = 'https://api.groq.com/openai/v1';
const MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
const NAMES = { english: 'en', hindi: 'hi', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', chinese: 'zh', mandarin: 'zh', urdu: 'ur', bengali: 'bn', marathi: 'mr', tamil: 'ta', telugu: 'te', gujarati: 'gu', punjabi: 'pa', kannada: 'kn', malayalam: 'ml', nepali: 'ne', russian: 'ru', arabic: 'ar', korean: 'ko', dutch: 'nl', turkish: 'tr', polish: 'pl', indonesian: 'id', thai: 'th', vietnamese: 'vi', persian: 'fa', swedish: 'sv' };
const HALLUCINATIONS = new Set(['thank you', 'thank you very much', 'thanks', 'thanks for watching', 'thank you for watching', 'thanks for watching and see you next time', 'please subscribe', 'subscribe', 'like and subscribe', 'bye', 'bye bye', 'you', 'so', 'okay', 'subtitles by the amara org community', 'धन्यवाद', 'शुक्रिया', 'धन्यवाद धन्यवाद', 'thank you thank you', 'gracias', 'merci', 'danke', 'ご視聴ありがとうございました', 'продолжение следует', 'उप शीर्षक']);
const norm = s => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const isHallucination = text => { const t = norm(text); return !t || HALLUCINATIONS.has(t); };
// the heard text is (or holds) the phrase a lesson expects, accents aside
const fold = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const expected = (text, expect) => { const a = fold(text), b = fold(expect); return !!(a && b && (a === b || a.includes(b) || (b.includes(a) && a.length >= b.length * 0.6))); };

function toIso(l) {
  const s = String(l || '').trim().toLowerCase(); if (!s) return '';
  if (/^[a-z]{2}(-|$)/.test(s) && s.length <= 5) return s.slice(0, 2);
  return NAMES[s] || '';
}
// Bro talks Hindi, not Urdu: Whisper's 'ur' (the same spoken language) is Hindi to us
const appLang = l => (l === 'ur' ? 'hi' : l);
const fin = v => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null));
// Whisper's own quality signals per segment: non-speech, or a repetition loop
const badSegment = s => { const ns = fin(s && s.no_speech_prob), lp = fin(s && s.avg_logprob), cr = fin(s && s.compression_ratio); return (ns != null && ns > 0.6 && lp != null && lp < -1) || (cr != null && cr > 2.4); };
const scriptLang = t => /[ऀ-ॿ]/.test(t) ? 'hi' : /[぀-ヿ]/.test(t) ? 'ja' : /[一-鿿]/.test(t) ? 'zh' : '';

// RIFF/WAVE → { sampleRate, channels, bits, data:Buffer } (null when it is not a PCM wav)
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4); let size = buf.readUInt32LE(p + 4); const start = p + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(start), channels: buf.readUInt16LE(start + 2), sampleRate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    else if (id === 'data') { if (size > buf.length - start || size === 0xFFFFFFFF) size = buf.length - start; data = buf.subarray(start, start + size); break; }
    p = start + size + (size & 1);
  }
  if (!fmt || !data) return null;
  return { sampleRate: fmt.sampleRate, channels: fmt.channels || 1, bits: fmt.bits, format: fmt.format, data };
}
function wavFromPcm16(pcm, sampleRate, channels) {
  channels = channels || 1;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// RMS of 16-bit PCM, 0…1
function rms16(buf) {
  const n = Math.floor(buf.length / 2); if (!n) return 0;
  let s = 0; for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / n);
}
// v21: loudness per 20 ms frame of 16-bit PCM → { frames, p95, floorDb, speechDb, snr, peakDb, speechFrames } in dBFS.
// The floor is the 10th percentile; speech is the power mean of the frames 6 dB or more above it.
function frameStats(pcm, rate) {
  const n = Math.floor(pcm.length / 2), F = Math.max(1, Math.round((rate || 16000) * 0.02));
  const dbs = []; let peak = 0;
  for (let s0 = 0; s0 + F <= n; s0 += F) {
    let e = 0;
    for (let i = s0; i < s0 + F; i++) { const v = pcm.readInt16LE(i * 2) / 32768; e += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    const r = Math.sqrt(e / F); dbs.push(r > 1e-7 ? 20 * Math.log10(r) : -140);
  }
  const dB = x => (x > 1e-7 ? 20 * Math.log10(x) : -140);
  if (!dbs.length) return { frames: 0, p95: -140, floorDb: -140, speechDb: -140, snr: 0, peakDb: dB(peak), speechFrames: 0 };
  const sorted = dbs.slice().sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const floorDb = q(0.1), loud = dbs.filter(d => d >= floorDb + 6);
  const pm = list => 10 * Math.log10(list.reduce((a, d) => a + Math.pow(10, d / 10), 0) / list.length);
  const speechDb = loud.length ? pm(loud) : q(0.95);
  const r1 = v => Math.round(v * 10) / 10;
  return { frames: dbs.length, p95: r1(q(0.95)), floorDb: r1(floorDb), speechDb: r1(speechDb), snr: r1(speechDb - floorDb), peakDb: r1(dB(peak)), speechFrames: loud.length };
}
// raise quiet speech to about `target` dBFS: at most maxGain dB, and never past -1 dBFS at the loudest sample
function normalize(pcm, st, target, maxGain) {
  const gainDb = Math.max(0, Math.min(maxGain, target - st.speechDb, -1 - st.peakDb));
  if (!(gainDb >= 1)) return { pcm, gainDb: 0 };
  const g = Math.pow(10, gainDb / 20), out = Buffer.alloc(pcm.length - (pcm.length % 2));
  for (let i = 0; i < out.length; i += 2) { const v = Math.round(pcm.readInt16LE(i) * g); out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i); }
  return { pcm: out, gainDb: Math.round(gainDb * 10) / 10 };
}
// ffmpeg: a recorder clip (webm, ogg, mp4…) → 16 kHz mono 16-bit PCM; resolves null when it can't (Whisper then reads the
// original file, as before v21). A temp file, not a pipe: Safari's mp4 needs a seekable input.
async function decodeToPcm(buf, ext, o) {
  const tmp = pathM.join(os.tmpdir(), 'hear-' + process.pid + '-' + crypto.randomBytes(6).toString('hex') + '.' + (ext || 'bin'));
  try {
    await fsp.writeFile(tmp, buf);
    return await new Promise(resolve => {
      const p = spawn((o && o.ffmpeg) || process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const out = []; const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }, 20000);
      p.stdout.on('data', d => out.push(d));
      p.on('error', () => { clearTimeout(t); resolve(null); });
      p.on('close', code => { clearTimeout(t); const pcm = Buffer.concat(out); resolve(code === 0 && pcm.length >= 2 ? pcm : null); });
    });
  } catch (e) { return null; } finally { fsp.unlink(tmp).catch(() => {}); }
}
const EXT = m => /wav/.test(m) ? 'wav' : /webm/.test(m) ? 'webm' : /ogg|opus/.test(m) ? 'ogg' : /mp4|m4a|aac/.test(m) ? 'm4a' : /mpeg|mp3/.test(m) ? 'mp3' : /flac/.test(m) ? 'flac' : 'wav';

function createHear(o) {
  o = o || {};
  const getSetting = typeof o.getSetting === 'function' ? o.getSetting : (k => process.env[k] || '');
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const brain = o.brain || null;
  const log = o.log || ((...a) => console.log('[brocore]', ...a));
  const key = () => getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY || '';
  const st = { calls: 0, empty: 0, dropped: 0, fails: 0, lastError: '', model: MODELS[0], dead: new Map() };
  const MIN_S = o.minSeconds || 0.3;
  // v21: silence = the loud frames (p95) under -58 dBFS; a phantom word counts as "very quiet" under -50 dBFS of speech
  // with under 10 dB above the noise; speech is raised to -20 dBFS (at most +30 dB) before Whisper hears it
  const SILENT_DB = o.silentDb != null ? o.silentDb : -58, QUIET_DB = -50, QUIET_SNR = 10, TARGET_DB = -20, MAX_GAIN = 30;

  async function hear(buffer, opts) {
    opts = opts || {};
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : (buffer && buffer.buffer ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : []));
    const mime = String(opts.mime || '').toLowerCase();
    const hint = appLang(toIso(opts.lang));
    let body = buf, type = mime || 'audio/wav', duration = null, pcm = null, rate = 16000, channels = 1;
    const wav = parseWav(buf);
    if (wav && wav.bits === 16 && wav.format === 1) {
      duration = wav.data.length / (wav.sampleRate * wav.channels * 2); type = 'audio/wav';
      if (wav.channels === 1) { pcm = wav.data; rate = wav.sampleRate; } else channels = wav.channels;
    } else if (!wav && (!mime || /pcm|l16|raw|octet|x-int16/.test(mime))) {
      rate = opts.sampleRate || parseInt((mime.match(/rate=(\d+)/) || [])[1], 10) || 16000;
      pcm = buf.subarray(0, buf.length - (buf.length % 2));
      duration = pcm.length / (rate * 2); body = wavFromPcm16(pcm, rate, 1); type = 'audio/wav';
    } else if (!wav && buf.length >= 64 && o.decode !== false) {
      // v21: a recorder clip is decoded so it can be measured and raised like the live call's audio
      const d = await decodeToPcm(buf, EXT(type), o);
      if (d) { pcm = d; rate = 16000; duration = d.length / 32000; }
    }
    if ((duration != null && duration <= MIN_S) || buf.length < 64) { st.empty++; return { text: '', lang: hint, empty: 'short', duration }; }
    const level = pcm ? frameStats(pcm, rate) : null;
    // silence: nothing loud (the loud frames under -58 dBFS), or a quiet clip (under -45 dBFS) with under 60 ms of sound
    // clearly above its own noise (a loud steady sound still goes to Whisper, as before v21)
    if (level && (level.p95 < SILENT_DB || (level.speechFrames < 3 && level.p95 < -45))) { st.empty++; return { text: '', lang: hint, empty: 'silence', duration, level }; }
    if (level) { // quiet speech, raised before Whisper hears it
      const nz = normalize(pcm, level, TARGET_DB, MAX_GAIN);
      level.gainDb = nz.gainDb;
      if (nz.gainDb > 0 || type !== 'audio/wav') { body = wavFromPcm16(nz.pcm, rate, 1); type = 'audio/wav'; }
    }
    if (channels !== 1) { /* a stereo wav: sent as it came */ }
    if (!key()) { const e = new Error('no-key'); e.code = 'no-key'; throw e; }
    st.calls++;
    let last = null;
    for (const model of MODELS) {
      if ((st.dead.get(model) || 0) > Date.now()) continue;
      const fd = new FormData();
      fd.append('file', new Blob([body], { type }), 'speech.' + EXT(type));
      fd.append('model', model);
      fd.append('response_format', 'verbose_json');
      fd.append('temperature', '0');
      if (hint) fd.append('language', hint);
      if (opts.prompt) fd.append('prompt', String(opts.prompt).replace(/\s+/g, ' ').trim().slice(0, 400));
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeout || 20000);
      const onAbort = () => ctrl.abort(); if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
      let r, j = null;
      try { r = await fetchFn(GROQ + '/audio/transcriptions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key() }, body: fd }); try { j = await r.json(); } catch (e) { j = null; } }
      catch (e) { last = e; if (opts.signal && opts.signal.aborted) throw e; continue; }
      finally { clearTimeout(t); if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
      if (!r.ok) {
        const msg = String((j && j.error && (j.error.message || j.error.code)) || r.status);
        last = new Error('whisper ' + r.status + ' ' + model + ': ' + msg.slice(0, 160)); last.status = r.status;
        if (r.status === 401 || r.status === 403) break;
        if (r.status === 404 || /decommissioned|not found|does not exist/i.test(msg)) st.dead.set(model, Date.now() + 6 * 3600e3);
        continue;
      }
      let text = String((j && j.text) || '').replace(/\s+/g, ' ').trim();
      // v20: a language lesson says what it expects ("gracias", "Thank you very much"): those words are never a phantom
      const wanted = expected(text, opts.expect);
      const segs = (j && Array.isArray(j.segments)) ? j.segments.filter(x => x && typeof x === 'object') : [];
      const kept = wanted ? segs : segs.filter(x => !badSegment(x)), cut = segs.length - kept.length;
      if (cut) { // rebuild the words from the segments we keep (when Whisper gave them), or nothing when none is left
        if (!kept.length) text = '';
        else if (segs.every(x => typeof x.text === 'string')) text = kept.map(x => x.text).join(' ').replace(/\s+/g, ' ').trim();
      }
      const noSpeech = segs.length ? Math.max(...segs.map(x => fin(x.no_speech_prob) || 0)) : null;
      const lps = kept.map(x => fin(x.avg_logprob)).filter(v => v != null);
      const confidence = lps.length ? Math.round(lps.reduce((a, b) => a + b, 0) / lps.length * 1000) / 1000 : null;
      const dur = duration != null ? duration : (j && +j.duration) || null;
      st.model = model; st.lastError = '';
      if (brain && brain.trackAudio) brain.trackAudio(model, dur || 0);
      const lang = appLang(toIso(j && j.language) || scriptLang(text) || hint);
      if (!text) { st.empty++; if (cut) st.dropped++; return { text: '', lang, confidence, model, duration: dur, empty: cut ? 'filtered' : 'nothing', level }; }
      // the classic phantoms ("Thank you.", "okay", "धन्यवाद"): dropped when Whisper doubts it was speech, or when the clip
      // is both very quiet and barely above its noise (v21: a soft but clear "okay" is kept)
      const faint = !!level && level.speechDb < QUIET_DB && level.snr < QUIET_SNR;
      if (!wanted && isHallucination(text) && ((noSpeech != null && noSpeech > 0.4) || faint)) { st.dropped++; return { text: '', lang, confidence, model, duration: dur, empty: 'hallucination', level }; }
      return { text, lang, confidence, model, duration: dur, level };
    }
    st.fails++; st.lastError = last ? last.message : 'whisper failed';
    log('hearing failed:', st.lastError);
    throw last || new Error('whisper failed');
  }
  const health = () => ({ ready: !!key(), model: st.model, calls: st.calls, empty: st.empty, dropped: st.dropped, fails: st.fails, lastError: st.lastError });
  return { hear, health };
}

module.exports = { createHear, parseWav, wavFromPcm16, rms16, frameStats, normalize, decodeToPcm, isHallucination, expected, toIso, badSegment, MODELS };
