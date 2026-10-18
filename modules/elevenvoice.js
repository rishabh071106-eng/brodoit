// ElevenLabs voice helpers shared by Bro (live replies), the News bulletin, Hindi books and language lessons.
//  • pickVoice(key, lang, getSetting): a proper narrator voice per language. Order: Admin setting ELEVEN_VOICE_<LANG>
//    → env → the account's voices matched by preferred names (warm, mature, male narrators) → the Adam default.
//  • speak(key, text, lang, voiceId, opts): text → mp3 Buffer with eleven_turbo_v2_5, which accepts language_code
//    (eleven_multilingual_v2 rejects language_code with HTTP 400 — the bug that left every recording silent).
'use strict';
const DEFAULT = 'pNInz6obpgDQGcFmaJgB'; // Adam
const MODEL = 'eleven_turbo_v2_5';
const PREF = {
  en: ['Brian', 'George', 'Daniel', 'Adam', 'Antoni', 'Josh', 'Liam', 'Will'],
  hi: ['Adam', 'Brian', 'George', 'Daniel', 'Antoni'],
  es: ['Antoni', 'Josh', 'Adam', 'Brian', 'George'],
  fr: ['Antoni', 'George', 'Adam', 'Brian'],
  de: ['Daniel', 'George', 'Adam', 'Brian'],
  ja: ['Adam', 'Brian', 'George'],
};
let cache = { at: 0, key: '', voices: null };

async function listVoices(key) {
  if (!key) return [];
  if (cache.voices && cache.key === key && Date.now() - cache.at < 3600e3) return cache.voices;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, signal: ctrl.signal });
    if (!r.ok) { cache = { at: Date.now() - 3000e3, key, voices: cache.voices || [] }; return cache.voices; } // retry in 10 min, not on every call
    const j = await r.json();
    cache = { at: Date.now(), key, voices: (j.voices || []).map(v => ({ id: v.voice_id, name: String(v.name || ''), labels: v.labels || {}, category: v.category || '' })) };
    return cache.voices;
  } catch (e) { cache = { at: Date.now() - 3000e3, key, voices: cache.voices || [] }; return cache.voices; } finally { clearTimeout(t); }
}

async function pickVoice(key, lang, getSetting) {
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  const k = 'ELEVEN_VOICE_' + l.toUpperCase();
  try { const s = typeof getSetting === 'function' ? getSetting(k) : ''; if (s) return s; } catch (e) {}
  if (process.env[k]) return process.env[k];
  try {
    const vs = await listVoices(key);
    for (const n of (PREF[l] || PREF.en)) { const v = vs.find(x => x.name.toLowerCase() === n.toLowerCase()); if (v) return v.id; }
    const male = vs.find(x => /^male$/i.test(String(x.labels.gender || '')) && /premade|professional/i.test(x.category));
    if (male) return male.id;
  } catch (e) { /* fall through */ }
  return DEFAULT;
}

function chunk(text, max) {
  const out = []; let cur = '';
  for (const s of String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?।])\s+/)) {
    if ((cur + ' ' + s).length > max && cur) { out.push(cur.trim()); cur = s; } else cur += ' ' + s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function speak(key, text, lang, voiceId, opts) {
  opts = opts || {};
  const l = String(lang || 'en').toLowerCase().slice(0, 2);
  const voice = voiceId || DEFAULT;
  const bufs = [];
  for (const c of chunk(text, opts.chunk || 3800)) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeout || 60000);
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${opts.format || 'mp3_44100_128'}`, {
        method: 'POST', signal: ctrl.signal, headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: c, model_id: opts.model || MODEL, language_code: l, voice_settings: Object.assign({ stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true }, opts.speed ? { speed: opts.speed } : {}, opts.voice_settings || {}) }),
      });
      if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 200));
      bufs.push(Buffer.from(await r.arrayBuffer()));
    } finally { clearTimeout(t); }
  }
  return Buffer.concat(bufs);
}

module.exports = { pickVoice, speak, listVoices, chunk, MODEL, DEFAULT, PREF };
