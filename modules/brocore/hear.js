// Bro Core · hearing. Groq Whisper (whisper-large-v3-turbo, then whisper-large-v3) turns one utterance into text.
// Input: a WAV file, raw 16-bit PCM (the live socket sends Int16 mono at 16 kHz) or any container Whisper reads (webm,
// ogg, mp3, m4a). PCM is wrapped in a WAV header and sent as multipart/form-data (FormData + Blob, Node 18+).
// Clips of 0.3 s or less are "empty" without a request, and Whisper's classic silence hallucinations ("Thank you.",
// "Thanks for watching", a lone "धन्यवाद") are dropped when the clip is near-silent. → { text, lang, model, duration }.
'use strict';

const GROQ = 'https://api.groq.com/openai/v1';
const MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
const NAMES = { english: 'en', hindi: 'hi', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja', chinese: 'zh', mandarin: 'zh', urdu: 'ur', bengali: 'bn', marathi: 'mr', tamil: 'ta', telugu: 'te', gujarati: 'gu', punjabi: 'pa', kannada: 'kn', malayalam: 'ml', nepali: 'ne', russian: 'ru', arabic: 'ar', korean: 'ko', dutch: 'nl', turkish: 'tr', polish: 'pl', indonesian: 'id', thai: 'th', vietnamese: 'vi', persian: 'fa', swedish: 'sv' };
const HALLUCINATIONS = new Set(['thank you', 'thank you very much', 'thanks', 'thanks for watching', 'thank you for watching', 'thanks for watching and see you next time', 'please subscribe', 'subscribe', 'like and subscribe', 'bye', 'bye bye', 'you', 'so', 'okay', 'subtitles by the amara org community', 'धन्यवाद', 'शुक्रिया', 'धन्यवाद धन्यवाद', 'thank you thank you', 'gracias', 'merci', 'danke', 'ご視聴ありがとうございました', 'продолжение следует', 'उप शीर्षक']);
const norm = s => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const isHallucination = text => { const t = norm(text); return !t || HALLUCINATIONS.has(t); };

function toIso(l) {
  const s = String(l || '').trim().toLowerCase(); if (!s) return '';
  if (/^[a-z]{2}(-|$)/.test(s) && s.length <= 5) return s.slice(0, 2);
  return NAMES[s] || '';
}
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
const EXT = m => /wav/.test(m) ? 'wav' : /webm/.test(m) ? 'webm' : /ogg|opus/.test(m) ? 'ogg' : /mp4|m4a|aac/.test(m) ? 'm4a' : /mpeg|mp3/.test(m) ? 'mp3' : /flac/.test(m) ? 'flac' : 'wav';

function createHear(o) {
  o = o || {};
  const getSetting = typeof o.getSetting === 'function' ? o.getSetting : (k => process.env[k] || '');
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const brain = o.brain || null;
  const log = o.log || ((...a) => console.log('[brocore]', ...a));
  const key = () => getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY || '';
  const st = { calls: 0, empty: 0, dropped: 0, fails: 0, lastError: '', model: MODELS[0], dead: new Map() };
  const MIN_S = o.minSeconds || 0.3, SILENT = 0.0015, QUIET = 0.01;

  async function hear(buffer, opts) {
    opts = opts || {};
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : (buffer && buffer.buffer ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : []));
    const mime = String(opts.mime || '').toLowerCase();
    const hint = toIso(opts.lang);
    let body = buf, type = mime || 'audio/wav', duration = null, energy = null;
    const wav = parseWav(buf);
    if (wav && wav.bits === 16 && wav.format === 1) {
      duration = wav.data.length / (wav.sampleRate * wav.channels * 2); energy = rms16(wav.data); type = 'audio/wav';
    } else if (!wav && (!mime || /pcm|l16|raw|octet|x-int16/.test(mime))) {
      const rate = opts.sampleRate || parseInt((mime.match(/rate=(\d+)/) || [])[1], 10) || 16000;
      const pcm = buf.subarray(0, buf.length - (buf.length % 2));
      duration = pcm.length / (rate * 2); energy = rms16(pcm); body = wavFromPcm16(pcm, rate, 1); type = 'audio/wav';
    }
    if ((duration != null && duration <= MIN_S) || buf.length < 64) { st.empty++; return { text: '', lang: hint, empty: 'short', duration }; }
    if (energy != null && energy < SILENT) { st.empty++; return { text: '', lang: hint, empty: 'silence', duration }; }
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
      if (opts.prompt) fd.append('prompt', String(opts.prompt).slice(0, 400));
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
      const text = String((j && j.text) || '').replace(/\s+/g, ' ').trim();
      const segs = (j && Array.isArray(j.segments)) ? j.segments : [];
      const noSpeech = segs.length ? Math.max(...segs.map(s => +s.no_speech_prob || 0)) : null;
      const dur = duration != null ? duration : (j && +j.duration) || null;
      st.model = model; st.lastError = '';
      if (brain && brain.trackAudio) brain.trackAudio(model, dur || 0);
      const lang = toIso(j && j.language) || scriptLang(text) || hint;
      if (!text) { st.empty++; return { text: '', lang, model, duration: dur, empty: 'nothing' }; }
      if (isHallucination(text) && ((energy != null && energy < QUIET) || (energy == null && noSpeech != null && noSpeech > 0.5))) { st.dropped++; return { text: '', lang, model, duration: dur, empty: 'hallucination' }; }
      return { text, lang, model, duration: dur };
    }
    st.fails++; st.lastError = last ? last.message : 'whisper failed';
    log('hearing failed:', st.lastError);
    throw last || new Error('whisper failed');
  }
  const health = () => ({ ready: !!key(), model: st.model, calls: st.calls, empty: st.empty, dropped: st.dropped, fails: st.fails, lastError: st.lastError });
  return { hear, health };
}

module.exports = { createHear, parseWav, wavFromPcm16, rms16, isHallucination, toIso, MODELS };
