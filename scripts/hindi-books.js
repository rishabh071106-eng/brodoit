#!/usr/bin/env node
// One-off, resumable pipeline: translate every book brief into Hindi (Gemini) and record it with a studio voice
// (modules/studio.js: ElevenLabs within this month's credits, keeping a reserve for Bro and the news; else Gemini or
// OpenAI TTS; one voice per book). Output: books-hi/<id>.json (text) + audio-static/hi-<id>.mp3 (served by the
// existing /api/book-audio/:id route as id "hi-<id>"). Run on the server:
//   GEMINI_API_KEY=... ELEVENLABS_API_KEY=... node scripts/hindi-books.js            # all books
//   node scripts/hindi-books.js --text-only          # translate now, record later
//   node scripts/hindi-books.js atomic deep          # specific books
// Re-running skips anything already done. Nothing is rendered at request time.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
let VOICE_HI = process.env.ELEVEN_VOICE_HI || 'pNInz6obpgDQGcFmaJgB';
const EV = require('../modules/elevenvoice.js');
const GEM = require('../modules/gemini.js');
const STUDIO = require('../modules/studio.js');
const args = process.argv.slice(2);
const textOnly = args.includes('--text-only');
const only = args.filter(a => !a.startsWith('--'));
// Output goes to the persistent media dir (next to the DB on the Railway volume) so it is recorded ONCE.
const MEDIA_DIR = process.env.MEDIA_DIR || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'media') : (fs.existsSync('/data') ? '/data/media' : path.join(ROOT, 'media')));
const TEXT_DIR = path.join(MEDIA_DIR, 'books-hi');
const AUDIO_DIR = TEXT_DIR;
fs.mkdirSync(TEXT_DIR, { recursive: true }); fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Pull BOOK_SUMMARIES out of server.js without starting the server.
function loadBooks() {
  const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = s.indexOf('const BOOK_SUMMARIES=['); const j = s.indexOf('\n];', i) + 3;
  const browserSrc = eval('`' + s.slice(i, j) + '`'); // the SPA source is a template literal: unescape it the same way
  return eval(browserSrc.replace('const BOOK_SUMMARIES=', '(').replace(/;\s*$/, ')'));
}
async function gemini(prompt) {
  const { json: j } = await GEM.generate(GEMINI_KEY, { contents: [{ role: 'user', parts: [{ text: prompt }] }], systemInstruction: { parts: [{ text: 'Return only valid JSON. No code fences.' }] }, generationConfig: { maxOutputTokens: 8000, temperature: 0.4, responseMimeType: 'application/json' } }, { timeout: 120000 });
  return JSON.parse(GEM.textOf(j).replace(/^```json\s*|```$/g, '').trim());
}
async function translate(b) {
  const clean = String(b.summary).replace(/\\/g, '').replace(/\n/g, '\n');
  const prompt = `Translate this book brief into natural, spoken Hindi (Devanagari) for an audio narration — the way a good Hindi podcaster would say it, not a word-for-word translation. Keep book/author names and well-known English terms in Devanagari transliteration (e.g. "एटॉमिक हैबिट्स"). Keep every "Chapter N." marker as "अध्याय N." at the start of its paragraph, and keep the paragraph breaks. STRICT JSON:
{"title":"<Hindi title>","why":"<Hindi>","insights":[["<idea title in Hindi>","<idea in Hindi>"], ... same count as input],"summary":"<full Hindi narration, paragraphs separated by \\n\\n>"}

TITLE: ${b.title} by ${b.author}
WHY: ${b.why}
INSIGHTS: ${JSON.stringify(b.insights)}
SUMMARY:
${clean}`;
  const j = await gemini(prompt);
  if (!j.summary || !Array.isArray(j.insights)) throw new Error('bad translation JSON');
  return { id: b.id, title: j.title, author: b.author, why: j.why, insights: j.insights, summary: j.summary, mins: Math.round(j.summary.length / 900) || b.mins };
}
const env = k => process.env[k] || '';
async function record(text, out, provider) {
  const r = await STUDIO.speak({ text, lang: 'hi', purpose: 'bulk', role: 'narrator', provider, mp3: true, getSetting: env, strict: true, voiceId: provider === 'eleven' ? VOICE_HI : undefined, eleven: { format: 'mp3_44100_128', chunk: 4000, voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } } });
  if (!r) throw new Error(provider + ' gave no audio');
  fs.writeFileSync(out, r.buf);
}
(async () => {
  STUDIO.configure({ mediaDir: MEDIA_DIR });
  if (ELEVEN_KEY) { try { VOICE_HI = await EV.pickVoice(ELEVEN_KEY, 'hi'); console.log('voice', VOICE_HI); } catch (e) {} }
  const books = loadBooks().filter(b => !only.length || only.includes(b.id));
  console.log(`[hindi-books] output → ${MEDIA_DIR}`);
  console.log(`[hindi-books] ${books.length} books · gemini ${GEMINI_KEY ? '✅' : '❌'} · voices ${STUDIO.available(env).join(' → ') || '❌'}${textOnly ? ' · text only' : ''}`);
  let chars = 0;
  for (const b of books) {
    const tf = path.join(TEXT_DIR, b.id + '.json'), af = path.join(AUDIO_DIR, 'hi-' + b.id + '.mp3');
    try {
      let t;
      if (fs.existsSync(tf)) t = JSON.parse(fs.readFileSync(tf, 'utf8'));
      else { if (!GEMINI_KEY) { console.log('skip (no GEMINI_API_KEY)', b.id); continue; } t = await translate(b); fs.writeFileSync(tf, JSON.stringify(t, null, 1)); console.log('translated', b.id, t.summary.length, 'chars'); }
      chars += t.summary.length;
      if (textOnly || fs.existsSync(af)) continue;
      const narration = `${t.title}, ${b.author}.\n\n${t.why}\n\n${t.summary}`;
      const provider = await STUDIO.plan({ chars: narration.length, purpose: 'bulk', mp3: true, getSetting: env });
      if (!provider) { console.log('[hindi-books] stopping: no voice budget left this month (ElevenLabs reserve kept for Bro and the news). The nightly sweep continues later.'); break; }
      await record(narration, af + '.part', provider); fs.renameSync(af + '.part', af);
      console.log('recorded', b.id, 'via', provider, Math.round(fs.statSync(af).size / 1024), 'KB');
    } catch (e) {
      console.log('FAILED', b.id, e.message);
      if (e.code === 'credits' && /Gemini/.test(e.message)) { console.log('[hindi-books] stopping: Gemini credit is used up — top up the Google AI Studio project, the nightly sweep continues after that.'); break; }
    }
  }
  console.log(`[hindi-books] done. Hindi text total ≈ ${chars.toLocaleString('en-IN')} characters (ElevenLabs bills per character).`);
})();
