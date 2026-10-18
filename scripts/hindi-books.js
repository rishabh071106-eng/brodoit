#!/usr/bin/env node
// One-off, resumable pipeline: translate every book brief into Hindi (Gemini) and record it
// with ElevenLabs. Output: books-hi/<id>.json (text) + audio-static/hi-<id>.mp3 (served by the
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
const VOICE_HI = process.env.ELEVEN_VOICE_HI || 'pNInz6obpgDQGcFmaJgB';
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
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], systemInstruction: { parts: [{ text: 'Return only valid JSON. No code fences.' }] }, generationConfig: { maxOutputTokens: 8000, temperature: 0.4 } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gemini ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return JSON.parse(j.candidates[0].content.parts[0].text.replace(/^```json\s*|```$/g, '').trim());
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
async function record(text, out) {
  const chunks = []; let cur = '';
  for (const s of text.replace(/\n+/g, ' \n ').split(/(?<=[।.!?])\s+/)) { if ((cur + ' ' + s).length > 4000) { chunks.push(cur.trim()); cur = s; } else cur += ' ' + s; }
  if (cur.trim()) chunks.push(cur.trim());
  const bufs = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_HI}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunks[i], model_id: 'eleven_multilingual_v2', language_code: 'hi', voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
    });
    if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 200));
    bufs.push(Buffer.from(await r.arrayBuffer()));
    process.stdout.write(`  chunk ${i + 1}/${chunks.length}\r`);
  }
  fs.writeFileSync(out, Buffer.concat(bufs));
}
(async () => {
  const books = loadBooks().filter(b => !only.length || only.includes(b.id));
  console.log(`[hindi-books] output → ${MEDIA_DIR}`);
  console.log(`[hindi-books] ${books.length} books · gemini ${GEMINI_KEY ? '✅' : '❌'} · elevenlabs ${ELEVEN_KEY ? '✅' : '❌'}${textOnly ? ' · text only' : ''}`);
  let chars = 0;
  for (const b of books) {
    const tf = path.join(TEXT_DIR, b.id + '.json'), af = path.join(AUDIO_DIR, 'hi-' + b.id + '.mp3');
    try {
      let t;
      if (fs.existsSync(tf)) t = JSON.parse(fs.readFileSync(tf, 'utf8'));
      else { if (!GEMINI_KEY) { console.log('skip (no GEMINI_API_KEY)', b.id); continue; } t = await translate(b); fs.writeFileSync(tf, JSON.stringify(t, null, 1)); console.log('translated', b.id, t.summary.length, 'chars'); }
      chars += t.summary.length;
      if (textOnly || fs.existsSync(af)) continue;
      if (!ELEVEN_KEY) { console.log('skip audio (no ELEVENLABS_API_KEY)', b.id); continue; }
      const narration = `${t.title}, ${b.author}.\n\n${t.why}\n\n${t.summary}`;
      await record(narration, af + '.part'); fs.renameSync(af + '.part', af);
      console.log('recorded', b.id, Math.round(fs.statSync(af).size / 1024), 'KB');
    } catch (e) { console.log('FAILED', b.id, e.message); }
  }
  console.log(`[hindi-books] done. Hindi text total ≈ ${chars.toLocaleString('en-IN')} characters (ElevenLabs bills per character).`);
})();
