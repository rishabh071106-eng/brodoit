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
const isDown = p => (down.get(p) || 0) > Date.now();
function order(gs, purpose) {
  const k = keys(gs); const pin = String(gs(purpose === 'bulk' ? 'BULK_VOICE' : 'STUDIO_VOICE') || '').toLowerCase();
  const all = ['eleven', 'gemini', 'openai'].filter(p => k[p]);
  return pin && all.includes(pin) ? [pin, ...all.filter(p => p !== pin)] : all;
}
function available(gs) { return order(gs, 'daily').filter(p => !isDown(p)); }

// ElevenLabs budget, plus a fixed monthly cap for bulk recordings when the key can't read its plan (a key without
// "user read" access): bulk then stops at ELEVEN_BULK_MONTHLY_CHARS (default 40,000 ≈ 20,000 credits) of this month's use.
async function elevenOk(key, chars, purpose) {
  const b = await EV.budget(key, chars, purpose);
  if (b.ok && b.left === null && purpose === 'bulk') {
    const cap = parseInt(process.env.ELEVEN_BULK_MONTHLY_CHARS || '', 10) || 40000;
    const used = (((readUsage().months || {})[month()] || {}).eleven || {}).chars || 0;
    if (used + chars > cap) return { ok: false, reason: 'plan unknown — bulk recording capped at ' + cap + ' characters this month' };
  }
  return b;
}

// Which provider would take `chars` characters for this purpose right now (used to keep one voice for a whole lesson/book).
async function plan(opts) {
  const gs = opts.getSetting || (() => ''); const k = keys(gs);
  for (const p of order(gs, opts.purpose)) {
    if (isDown(p)) continue;
    if (p === 'gemini' && opts.mp3 && !GV.hasFfmpeg()) continue;
    if (p === 'eleven' && !(await elevenOk(k.eleven, opts.chars || 0, opts.purpose || 'daily')).ok) continue;
    return p;
  }
  return null;
}

async function openaiSpeak(key, text, lang, o) {
  const voice = o.voice || (o.getSetting && o.getSetting(o.role === 'native' ? 'OPENAI_TTS_VOICE_NATIVE' : 'OPENAI_TTS_VOICE')) || (o.role === 'native' ? 'onyx' : 'ash');
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
  const list = opts.provider ? [opts.provider] : order(gs, purpose);
  let lastErr = null;
  for (const p of list) {
    if (!k[p] || isDown(p)) continue;
    try {
      let out;
      if (p === 'eleven') {
        const b = await elevenOk(k.eleven, text.length, purpose); if (!b.ok) { lastErr = new Error(b.reason); continue; }
        const voice = opts.voiceId || await EV.pickVoice(k.eleven, lang, gs);
        out = { buf: await EV.speak(k.eleven, text, lang, voice, opts.eleven || {}), mime: 'audio/mpeg' };
      } else if (p === 'gemini') {
        if (opts.mp3 && !GV.hasFfmpeg()) continue;
        out = await GV.speak(k.gemini, text, lang, { role: opts.role, slow: opts.slow, getSetting: gs, mp3: opts.mp3, timeout: opts.timeout });
      } else out = await openaiSpeak(k.openai, text, lang, { role: opts.role, slow: opts.slow, getSetting: gs, timeout: opts.timeout });
      track(p, text.length);
      return { buf: out.buf, mime: out.mime, provider: p };
    } catch (e) {
      lastErr = e;
      if (e.code === 'credits' || e.code === 'key') down.set(p, Date.now() + (e.code === 'key' ? 6 : 1) * 3600e3);
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
function track(p, chars) {
  const f = usageFile(); if (!f) return;
  try {
    const u = readUsage(); const m = month(); u.months = u.months || {};
    const row = u.months[m] = u.months[m] || {}; const r = row[p] = row[p] || { chars: 0, calls: 0 };
    r.chars += chars; r.calls += 1;
    for (const old of Object.keys(u.months).sort().slice(0, -6)) delete u.months[old];
    const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(u)); fs.renameSync(tmp, f);
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

module.exports = { configure, speak, plan, available, usage, track, keys, isDown, _down: down };
