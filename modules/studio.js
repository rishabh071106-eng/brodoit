// Studio voice — every feature that turns text into speech (News "Listen", the daily bulletin, Bro's classic replies,
// language lessons, Hindi books) goes through here, so the money rules live in one place:
//   1. ElevenLabs — the best voices, but only within the plan's monthly credits (credit guard in elevenvoice.js: bulk
//      recordings use at most the first 40%, the news stops at 70%, the rest is Bro's; nothing runs into overage).
//   2. Gemini TTS — natural voices on the Google key, ≈ US$0.015 per minute of audio.
//   3. OpenAI gpt-4o-mini-tts — same price class.
// A provider that answers "no credit" / "bad key" is skipped for a while; the caller gets null and falls back to the device
// voice. Usage per month is counted in MEDIA_DIR/voice-usage.json (shared by the server and the recording scripts) so the
// Admin card can show what this month cost.
'use strict';
const fs = require('fs'), path = require('path');
const EV = require('./elevenvoice.js');
const GV = require('./geminivoice.js');
const USD_PER_MIN = { gemini: 0.015, openai: 0.015 };
const CHARS_PER_MIN = 850; // spoken English ≈ 150 words a minute; Hindi is close
let MEDIA = process.env.MEDIA_DIR || '';
const down = new Map(); // provider → until (ms)

function configure(o) { if (o && o.mediaDir) MEDIA = o.mediaDir; }
const keys = gs => ({ eleven: gs('ELEVENLABS_API_KEY') || process.env.ELEVENLABS_API_KEY || '', gemini: gs('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '', openai: gs('OPENAI_API_KEY') || process.env.OPENAI_API_KEY || '' });
// "out of credit / bad key / rate-limited" marks are shared with the recording scripts (separate processes) through the
// usage file, so a nightly run doesn't rediscover a 402 on every book.
function markDown(p, ms) { const until = Date.now() + ms; down.set(p, until); try { const u = readUsage(); u.down = u.down || {}; u.down[p] = until; writeUsage(u); } catch (e) {} }
const isDown = p => { if ((down.get(p) || 0) > Date.now()) return true; try { const t = ((readUsage().down || {})[p]) || 0; if (t > Date.now()) { down.set(p, t); return true; } } catch (e) {} return false; };
// v14: one voice. Recorded lines (lessons, books) are ElevenLabs only, so every clip is Bro's voice; a live chat reply may
// fall back to OpenAI (deep 'onyx') when ElevenLabs is out of credits. Gemini TTS is out of every chain: it spoke its own
// style instruction ("Read this aloud in a warm…") at the start of clips.
function order(gs, purpose) {
  const k = keys(gs);
  return (purpose === 'live' ? ['eleven', 'openai'] : ['eleven']).filter(p => k[p]);
}
function available(gs, purpose) { return order(gs, purpose || 'daily').filter(p => !isDown(p)); }

// ElevenLabs budget, plus a fixed monthly cap for bulk recordings when the key can't read its plan (a key without
// "user read" access): bulk then stops at ELEVEN_BULK_MONTHLY_CHARS (default 40,000 ≈ 20,000 credits) of this month's use.
async function elevenOk(key, chars, purpose) {
  const b = await EV.budget(key, chars, purpose);
  if (b.ok && b.left === null && purpose !== 'live') {
    const cap = purpose === 'bulk' ? (parseInt(process.env.ELEVEN_BULK_MONTHLY_CHARS || '', 10) || 20000) : (parseInt(process.env.ELEVEN_DAILY_MONTHLY_CHARS || '', 10) || 60000);
    const used = monthChars('eleven', purpose);
    if (used + chars > cap) return { ok: false, reason: 'plan unknown — ' + purpose + ' voice capped at ' + cap + ' characters this month' };
  }
  return b;
}
// Gemini / OpenAI are pay-as-you-go: bulk recordings (lessons, books) stop at STUDIO_BULK_MONTHLY_USD (default $3 ≈ 200
// minutes) a month, so they can never eat the prepaid credit Bro's brain and the news need. The nightly sweep resumes next month.
function payOk(p, chars, purpose) {
  if (purpose !== 'bulk') return { ok: true };
  const cap = parseFloat(process.env.STUDIO_BULK_MONTHLY_USD || '') || 3;
  const usd = (monthChars(p, 'bulk') + chars) / CHARS_PER_MIN * (USD_PER_MIN[p] || 0.015);
  return usd > cap ? { ok: false, reason: p + ' bulk voice capped at $' + cap + ' this month' } : { ok: true };
}
const monthChars = (p, purpose) => { const r = (((readUsage().months || {})[month()] || {})[p]) || {}; return purpose ? ((r.by || {})[purpose] || 0) : (r.chars || 0); };

// Which provider would take `chars` characters for this purpose right now (used to keep one voice for a whole lesson/book).
async function plan(opts) {
  const gs = opts.getSetting || (() => ''); const k = keys(gs);
  for (const p of order(gs, opts.purpose)) {
    if (isDown(p)) continue;
    if (p === 'gemini' && opts.mp3 && !GV.hasFfmpeg()) continue;
    if (p === 'eleven') { const b = await elevenOk(k.eleven, opts.chars || 0, opts.purpose || 'daily'); if (b.hold) EV.release(k.eleven, b.hold); if (!b.ok) continue; }
    if (p !== 'eleven' && !payOk(p, opts.chars || 0, opts.purpose || 'daily').ok) continue;
    return p;
  }
  return null;
}

async function openaiSpeak(key, text, lang, o) {
  const voice = o.voice || (o.getSetting && o.getSetting(o.role === 'native' ? 'OPENAI_TTS_VOICE_NATIVE' : 'OPENAI_TTS_VOICE')) || 'onyx';
  const how = o.role === 'native' ? 'Speak clearly like a native speaker teaching a learner.' : lang === 'hi' ? 'Speak natural, warm Hindi at an easy pace, like a close friend.' : 'Warm, confident Indian English. Natural pace, friendly, never robotic.';
  const bufs = [];
  for (const c of EV.chunk(text, 3500)) {
    const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', signal: AbortSignal.timeout(o.timeout || 60000), headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: c, response_format: 'mp3', instructions: how + (o.slow ? ' Speak slowly, with a short pause between words.' : '') }) });
    if (!r.ok) { const b = (await r.text()).slice(0, 200); const e = new Error('OpenAI TTS ' + r.status + ' ' + b); e.status = r.status; if (r.status === 401 || r.status === 429 && /quota|billing/i.test(b)) e.code = r.status === 401 ? 'key' : 'credits'; throw e; }
    bufs.push(Buffer.from(await r.arrayBuffer()));
  }
  return { buf: Buffer.concat(bufs), mime: 'audio/mpeg' };
}

// → { buf, mime, provider } or null. opts: text, lang, purpose ('live'|'daily'|'bulk'), role ('narrator'|'native'|'bro'),
//   slow, getSetting, provider (force one), mp3 (must be mp3), eleven (extra ElevenLabs opts), voiceId (ElevenLabs voice)
async function speak(opts) {
  const gs = opts.getSetting || (() => ''); const k = keys(gs);
  const text = String(opts.text || '').trim(); if (!text) return null;
  const lang = String(opts.lang || 'en').toLowerCase().slice(0, 2), purpose = opts.purpose || 'daily';
  const list = (opts.provider ? [opts.provider] : order(gs, purpose)).filter(p => p !== 'gemini' && p !== 'brocore'); // never Gemini TTS (v14)
  let lastErr = null;
  // v16: Bro's own voice (Bro Core: Kokoro on our CPU, free) speaks live replies and daily lines once its model is loaded;
  // the paid chain below is the fallback. A forced provider skips it, unless the provider forced is 'brocore'.
  if ((!opts.provider && (purpose === 'live' || purpose === 'daily')) || opts.provider === 'brocore') {
    const B = global._broCore;
    if (B && typeof B.voiceReady === 'function' && B.voiceReady()) {
      try {
        const r = await B.speak(text, { lang, format: 'mp3', speed: opts.slow ? 0.85 : undefined, purpose: opts.purpose });
        if (r && r.audio && r.audio.length && (!opts.mp3 || r.mime === 'audio/mpeg')) return { buf: r.audio, mime: r.mime || 'audio/mpeg', provider: 'brocore' };
      } catch (e) { lastErr = e; console.log('[studio] brocore voice failed:', String(e.message).slice(0, 160)); }
    }
    if (opts.provider === 'brocore') { if (opts.strict) throw lastErr || new Error('Bro Core voice is not ready'); return null; }
  }
  for (const p of list) {
    if (!k[p] || isDown(p)) continue;
    try {
      let out;
      if (p === 'eleven') {
        const b = await elevenOk(k.eleven, text.length, purpose); if (!b.ok) { lastErr = new Error(b.reason); continue; }
        const voice = opts.voiceId || EV.broVoice(gs);
        try { out = { buf: await EV.speak(k.eleven, text, lang, voice, opts.eleven || {}), mime: 'audio/mpeg' }; }
        catch (e) { if (b.hold) EV.release(k.eleven, b.hold); throw e; } // a failed call is not charged
      } else if (p === 'gemini') {
        if (opts.mp3 && !GV.hasFfmpeg()) continue;
        const pb = payOk(p, text.length, purpose); if (!pb.ok) { lastErr = new Error(pb.reason); continue; }
        out = await GV.speak(k.gemini, text, lang, { role: opts.role, slow: opts.slow, getSetting: gs, mp3: opts.mp3, timeout: opts.timeout });
      } else {
        const pb = payOk(p, text.length, purpose); if (!pb.ok) { lastErr = new Error(pb.reason); continue; }
        out = await openaiSpeak(k.openai, text, lang, { role: opts.role, slow: opts.slow, getSetting: gs, timeout: opts.timeout });
      }
      track(p, text.length, purpose);
      return { buf: out.buf, mime: out.mime, provider: p };
    } catch (e) {
      lastErr = e;
      if (e.code === 'credits' || e.code === 'key' || e.code === 'rate') markDown(p, e.code === 'key' ? 6 * 3600e3 : e.code === 'credits' ? 3600e3 : 5 * 60e3);
      console.log('[studio]', p, 'failed:', e.message.slice(0, 160));
      if (opts.provider) break;
    }
  }
  if (opts.strict && lastErr) throw lastErr;
  return null;
}

// ── monthly usage meter ──
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const usageFile = () => MEDIA ? path.join(MEDIA, 'voice-usage.json') : '';
function readUsage() { try { return JSON.parse(fs.readFileSync(usageFile(), 'utf8')); } catch (e) { return { months: {} }; } }
function writeUsage(u) { const f = usageFile(); if (!f) return; const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(u)); fs.renameSync(tmp, f); }
function track(p, chars, purpose) {
  if (!usageFile()) return;
  try {
    const u = readUsage(); const m = month(); u.months = u.months || {};
    const row = u.months[m] = u.months[m] || {}; const r = row[p] = row[p] || { chars: 0, calls: 0 };
    r.chars += chars; r.calls += 1; r.by = r.by || {}; r.by[purpose || 'daily'] = (r.by[purpose || 'daily'] || 0) + chars;
    for (const old of Object.keys(u.months).sort().slice(0, -6)) delete u.months[old];
    writeUsage(u);
  } catch (e) { /* the meter must never break speech */ }
}
function usage(gs) {
  const m = month(); const row = (readUsage().months || {})[m] || {};
  const out = { month: m, providers: {}, usd: 0 };
  for (const p of ['eleven', 'gemini', 'openai']) {
    const r = row[p] || { chars: 0, calls: 0 }; const mins = r.chars / CHARS_PER_MIN;
    const usd = USD_PER_MIN[p] ? +(mins * USD_PER_MIN[p]).toFixed(2) : 0;
    out.providers[p] = { chars: r.chars, calls: r.calls, minutes: +mins.toFixed(1), usd, credits: p === 'eleven' ? Math.round(r.chars * EV.PER_CHAR()) : undefined, down: isDown(p) };
    out.usd += usd;
  }
  out.usd = +out.usd.toFixed(2);
  try { const k = gs && keys(gs).eleven; if (k) out.eleven = EV.snapshot(k); } catch (e) {}
  return out;
}

function clearDown() { down.clear(); try { const u = readUsage(); if (u.down) { delete u.down; writeUsage(u); } } catch (e) {} }

module.exports = { configure, speak, plan, available, usage, track, keys, isDown, markDown, clearDown, _down: down };
