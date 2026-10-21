// v21 Bro's library: the app's other spoken pieces (the breathing cues, the affirmations and guided meditations), recorded
// once in Bro's one voice, the voice heard on calls and in lessons, so the app has a single speaker.
//   create({ mediaDir, items: () => [{ key, text, lang?, speed?, gapMs?, breathMs? }], log? })
//     → { file(key) → path | '', run(o?) → Promise<number recorded>, stats(), dir() }
// Files: MEDIA_DIR/bro-voice/<voice key>/<key>.mp3, so a new voice records them again. Each piece is spoken paragraph
// by paragraph at low priority (live calls go first; the recorder also steps aside while a call is open), with real
// silences between paragraphs (gapMs) and at "…" (breathMs), joined and encoded to mp3 with ffmpeg. Until a piece is
// recorded the caller keeps serving its old file.
//   sendAudio(req, res, file, cacheControl) streams an mp3 with Range support (iOS needs it).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');

const RATE = 24000;
const nap = ms => new Promise(r => setTimeout(r, ms));

// one piece → the parts to speak and the silence after each: paragraphs split at blank lines, then at "…"
function parts(text, gapMs, breathMs) {
  const out = [];
  const paras = String(text || '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  paras.forEach((p, i) => {
    const bits = p.split(/…|\.\.\./).map(b => b.trim()).filter(Boolean);
    bits.forEach((b, j) => out.push({ text: b + (j < bits.length - 1 && !/[.!?,]$/.test(b) ? ',' : ''), after: j < bits.length - 1 ? breathMs : i < paras.length - 1 ? gapMs : 0 }));
  });
  return out;
}
// the 16-bit PCM inside a wav file (Bro Core's voice answers 24 kHz mono wav)
function pcmOf(wav) {
  let o = 12;
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4), n = wav.readUInt32LE(o + 4);
    if (id === 'data') return wav.subarray(o + 8, Math.min(wav.length, o + 8 + n));
    o += 8 + n + (n & 1);
  }
  return wav.subarray(44);
}
function encodeMp3(pcm, ffmpeg) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const t = setTimeout(() => p.kill('SIGKILL'), 120e3);
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); if (code === 0 && out.length) resolve(Buffer.concat(out)); else reject(new Error('ffmpeg exit ' + code + ' ' + Buffer.concat(err).toString().slice(0, 200))); });
    p.stdin.on('error', () => {});
    p.stdin.end(pcm);
  });
}

function sendAudio(req, res, file, cacheControl) {
  let st; try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.size) return false;
  const total = st.size, cc = cacheControl || 'no-cache';
  const etag = 'W/"' + total.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg', 'Cache-Control': cc, ETag: etag });
  if (!req.headers.range && req.headers['if-none-match'] === etag) { res.status(304).end(); return true; }
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, total - parseInt(m[2], 10));
    let end = m[1] && m[2] ? parseInt(m[2], 10) : total - 1;
    if (!(start >= 0 && start < total)) { res.set('Content-Range', 'bytes */' + total); res.status(416).end(); return true; }
    end = Math.min(end, total - 1);
    res.status(206).set({ 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': String(end - start + 1) });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.set('Content-Length', String(total));
  fs.createReadStream(file).pipe(res);
  return true;
}

function create(o) {
  o = o || {};
  const log = o.log || ((...a) => console.log('[bro-library]', ...a));
  const ROOT = path.join(o.mediaDir || process.env.MEDIA_DIR || '.', 'bro-voice');
  const core = () => global._broCore || null;
  const ready = () => { const B = core(); try { return !!(B && B.voiceReady && B.voiceReady() && typeof B.voiceKey === 'function' && B.voiceKey()); } catch (e) { return false; } };
  const key = () => { const B = core(); try { return String((B && B.voiceKey && B.voiceKey()) || '').replace(/[^a-z0-9-]/gi, ''); } catch (e) { return ''; } };
  const liveCalls = () => { try { return global._liveCalls ? +global._liveCalls() || 0 : 0; } catch (e) { return 0; } };
  const dir = () => (key() ? path.join(ROOT, key()) : '');
  const items = () => { try { return (o.items ? o.items() : []).filter(x => x && /^[a-z0-9_-]{1,60}$/i.test(x.key) && String(x.text || '').trim()); } catch (e) { return []; } };
  const file = k => { const d = dir(); if (!d || !/^[a-z0-9_-]{1,60}$/i.test(String(k))) return ''; const f = path.join(d, k + '.mp3'); return fs.existsSync(f) ? f : ''; };
  const state = { state: 'idle', made: 0, at: null, error: '' };

  async function render(it) {
    const B = core();
    const gap = it.gapMs != null ? it.gapMs : 2200, breath = it.breathMs != null ? it.breathMs : 1000;
    const bufs = [];
    for (const p of parts(it.text, gap, breath)) {
      const r = await B.speak(p.text, { lang: it.lang || 'en', format: 'wav', priority: 'low', wait: 120e3, noCache: true, speed: it.speed || undefined, purpose: 'library' });
      bufs.push(Buffer.from(pcmOf(r.audio)));
      if (p.after > 0) bufs.push(Buffer.alloc(Math.round(RATE * p.after / 1000) * 2));
    }
    const mp3 = await encodeMp3(Buffer.concat(bufs), o.ffmpeg);
    const d = dir(); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, it.key + '.mp3'), tmp = f + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, mp3); fs.renameSync(tmp, f);
    return f;
  }
  let running = null;
  function run(ro) {
    ro = ro || {};
    if (running) return running;
    running = (async () => {
      let n = 0;
      for (const it of items()) {
        if (!ready()) { state.state = 'waiting for the voice'; break; }
        if (file(it.key)) continue;
        const t0 = Date.now();
        while (liveCalls() > 0 && Date.now() - t0 < (ro.maxPauseMs != null ? ro.maxPauseMs : 180e3)) { state.state = 'paused for a call'; await nap(ro.callMs != null ? ro.callMs : 2000); }
        state.state = 'recording';
        try { await render(it); n++; state.made++; state.at = new Date().toISOString(); state.error = ''; }
        catch (e) { state.error = String(e.message || e).slice(0, 120); log('could not record', it.key + ':', state.error); await nap(ro.failMs != null ? ro.failMs : 10e3); }
      }
      if (state.state === 'recording' || state.state === 'idle') state.state = items().every(it => file(it.key)) ? 'done' : 'idle';
      if (n) log(n + ' pieces recorded in Bro\'s voice');
      return n;
    })().finally(() => { running = null; });
    return running;
  }
  function stats() { const all = items(); return { total: all.length, recorded: all.filter(it => file(it.key)).length, voice: key(), state: state.state, made: state.made, at: state.at, error: state.error }; }
  if (o.schedule !== false && process.env.BRO_LIBRARY !== '0') {
    const t1 = setTimeout(() => run().catch(() => {}), o.firstMs != null ? o.firstMs : 120e3), t2 = setInterval(() => run().catch(() => {}), 15 * 60e3);
    for (const t of [t1, t2]) if (t.unref) t.unref();
  }
  return { file, run, stats, dir, render, items };
}

module.exports = { create, sendAudio, parts, pcmOf };
