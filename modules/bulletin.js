// Brodoit News Channel — daily spoken bulletins in English + Hindi, "explain it simply", monthly digest.
// Text is written by Gemini from the curated RSS items; audio is rendered once by ElevenLabs and
// saved to the media dir so it is never re-rendered. The ElevenLabs key and voice ids are read per
// use via deps.getSetting (pasted in You → Admin; env is the fallback). Without a key the client
// falls back to the device voice using the same text.
'use strict';
const fs = require('fs');
const path = require('path');
const EV = require('./elevenvoice.js');

const DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam — warm news-anchor voice; multilingual v2 speaks Hindi with any voice
let DIR = path.join(__dirname, '..', 'audio-news');
const IST_OFFSET = 5.5 * 3600 * 1000;
const istDate = (d = new Date()) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);

async function elevenTTS(text, voice, lang, key) {
  key = key || process.env.ELEVENLABS_API_KEY || '';
  if (!key) return null;
  const chunks = [];
  // ElevenLabs takes ~5k chars per request; split on paragraph/sentence boundaries.
  let cur = '';
  for (const s of String(text).split(/(?<=[.!?।])\s+/)) {
    if ((cur + ' ' + s).length > 4000) { chunks.push(cur.trim()); cur = s; } else cur += ' ' + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  const bufs = [];
  for (const c of chunks) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: c, model_id: EV.MODEL, language_code: lang, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
    });
    if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 200));
    bufs.push(Buffer.from(await r.arrayBuffer()));
  }
  return Buffer.concat(bufs);
}

function install(app, deps) {
  const { db, auth, isAdmin, callGemini, getNewsItems } = deps;
  const getSetting = typeof deps.getSetting === 'function' ? deps.getSetting : (k => process.env[k] || '');
  const elevenKey = () => getSetting('ELEVENLABS_API_KEY') || process.env.ELEVENLABS_API_KEY || '';
  const voiceEn = () => getSetting('ELEVEN_VOICE_EN') || process.env.ELEVEN_VOICE_EN || DEFAULT_VOICE;
  const voiceHi = () => getSetting('ELEVEN_VOICE_HI') || process.env.ELEVEN_VOICE_HI || DEFAULT_VOICE;
  if (deps.mediaDir) DIR = path.join(deps.mediaDir, 'news');
  fs.mkdirSync(DIR, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS news_bulletins(id TEXT PRIMARY KEY,kind TEXT NOT NULL,date TEXT NOT NULL,title TEXT DEFAULT '',data TEXT NOT NULL,audio_en TEXT DEFAULT '',audio_hi TEXT DEFAULT '',created_at TEXT DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS news_explain(k TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT DEFAULT(datetime('now')))`);
  const get = db.prepare('SELECT * FROM news_bulletins WHERE id=?');
  const put = db.prepare('INSERT OR REPLACE INTO news_bulletins(id,kind,date,title,data,audio_en,audio_hi) VALUES(?,?,?,?,?,?,?)');
  const row = r => r && { id: r.id, kind: r.kind, date: r.date, title: r.title, ...JSON.parse(r.data), audio: { en: r.audio_en ? '/audio-news/' + r.audio_en : null, hi: r.audio_hi ? '/audio-news/' + r.audio_hi : null } };
  const latest = kind => row(db.prepare('SELECT * FROM news_bulletins WHERE kind=? ORDER BY date DESC LIMIT 1').get(kind));

  async function writeDaily(date) {
    const items = (await getNewsItems()).slice(0, 28);
    if (items.length < 5) throw new Error('not enough news items');
    const src = items.map((it, i) => `${i + 1}. [${it.source || ''}] ${it.title}\n${String(it.desc || it.description || '').replace(/\s+/g, ' ').slice(0, 320)}`).join('\n\n');
    const prompt = `You are the anchor of "Brodoit News", a friendly daily audio bulletin for Indians aged 15–60, many of whom are not fluent in English. Today is ${date}. From the stories below, produce STRICT JSON:
{
 "title": "<catchy 6-10 word title for today's bulletin>",
 "headlines": [ {"h":"<headline in simple English, max 14 words>","easy":"<2-3 sentence explanation a 12-year-old understands: what happened, why it matters to a normal person in India>","hi":"<the same explanation in simple, natural Hindi (Devanagari), not a literal translation>","topic":"india|world|tech|business|science|sports"} x 8-10 ],
 "script_en": "<a spoken 3-4 minute bulletin (~480-560 words) in simple, warm English. Open with 'Namaste, this is Brodoit News for ${date}.' Cover the headlines in order with one or two plain sentences each, add a 'why it matters' line for the big ones, close with a one-line positive sign-off. Spoken style, no bullet points, no markdown, no URLs, numbers written as words where natural.>",
 "script_hi": "<the same bulletin in natural spoken Hindi (Devanagari), ~500 words, opening 'नमस्ते, यह है ब्रोडूइट न्यूज़'. Use common Hindustani words people actually say; keep English names of companies/people in Devanagari transliteration.>"
}
Only report what the sources say; do not add facts. Avoid graphic details. STORIES:\n\n${src}`;
    const g = await callGemini([{ role: 'user', content: prompt }], { maxTokens: 6000, systemPrompt: 'Return only valid JSON. No code fences.' });
    const j = JSON.parse(g.reply.replace(/^```json\s*|```$/g, '').trim());
    if (!j.headlines || !j.script_en || !j.script_hi) throw new Error('bad bulletin JSON');
    const id = 'd-' + date;
    const data = { headlines: j.headlines, script_en: j.script_en, script_hi: j.script_hi, sources: items.slice(0, 10).map(it => ({ title: it.title, link: it.link, source: it.source })) };
    put.run(id, 'daily', date, j.title, JSON.stringify(data), '', '');
    await renderAudio(id, j.script_en, j.script_hi);
    console.log('[NEWS-CH] daily bulletin ready', id);
    return row(get.get(id));
  }

  // Renders whichever of EN/HI is still missing. Errors are logged and swallowed for the hourly
  // tick; pass strict=true (admin job) to surface them to the caller instead.
  async function renderAudio(id, en, hi, strict) {
    const key = elevenKey(); if (!key) return;
    const r = get.get(id); if (!r) return;
    try {
      if (!r.audio_en) { const b = await elevenTTS(en, await EV.pickVoice(key, 'en', getSetting), 'en', key); if (b) { fs.writeFileSync(path.join(DIR, id + '-en.mp3'), b); db.prepare('UPDATE news_bulletins SET audio_en=? WHERE id=?').run(id + '-en.mp3', id); } }
      if (!r.audio_hi) { const b = await elevenTTS(hi, await EV.pickVoice(key, 'hi', getSetting), 'hi', key); if (b) { fs.writeFileSync(path.join(DIR, id + '-hi.mp3'), b); db.prepare('UPDATE news_bulletins SET audio_hi=? WHERE id=?').run(id + '-hi.mp3', id); } }
    } catch (e) { console.log('[NEWS-CH] audio render failed', id, e.message); if (strict) throw e; }
  }

  // Admin "Record today's bulletin": write today's text if missing, render audio if a key exists, return the row.
  async function ensureToday() {
    const today = istDate(); const id = 'd-' + today;
    if (!get.get(id)) await writeDaily(today);
    let r = get.get(id); if (!r) throw new Error('bulletin not written');
    if (elevenKey() && (!r.audio_en || !r.audio_hi)) { const d = JSON.parse(r.data); await renderAudio(id, d.script_en, d.script_hi, true); r = get.get(id); }
    return row(r);
  }

  async function writeMonthly(ym) {
    const dailies = db.prepare("SELECT * FROM news_bulletins WHERE kind='daily' AND date LIKE ? ORDER BY date").all(ym + '%').map(row);
    if (dailies.length < 5) throw new Error('not enough dailies for ' + ym);
    const src = dailies.map(d => `${d.date}: ${d.headlines.map(h => h.h).join(' | ')}`).join('\n');
    const monthName = new Date(ym + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const prompt = `From these daily Brodoit News headlines for ${monthName}, write STRICT JSON for a "month in review" audio feature:
{"title":"<title>","themes":[{"h":"<theme headline>","easy":"<3-4 sentences in simple English on what happened over the month and why it matters>","hi":"<same in natural Hindi>"} x 6-8],"script_en":"<spoken 5-6 minute review (~800 words), simple warm English, opening 'Namaste, this is the Brodoit News month in review for ${monthName}.'>","script_hi":"<same in natural spoken Hindi, ~850 words>"}
HEADLINES:\n${src}`;
    const g = await callGemini([{ role: 'user', content: prompt }], { maxTokens: 8000, systemPrompt: 'Return only valid JSON. No code fences.' });
    const j = JSON.parse(g.reply.replace(/^```json\s*|```$/g, '').trim());
    const id = 'm-' + ym;
    put.run(id, 'monthly', ym + '-01', j.title, JSON.stringify({ headlines: j.themes, script_en: j.script_en, script_hi: j.script_hi, days: dailies.length }), '', '');
    await renderAudio(id, j.script_en, j.script_hi);
    console.log('[NEWS-CH] monthly review ready', id);
  }

  async function tick() {
    const today = istDate();
    try { if (!get.get('d-' + today)) await writeDaily(today); else { const r = get.get('d-' + today); if (elevenKey() && (!r.audio_en || !r.audio_hi)) { const d = JSON.parse(r.data); await renderAudio(r.id, d.script_en, d.script_hi); } } }
    catch (e) { console.log('[NEWS-CH] daily failed', e.message); }
    try {
      const d = new Date(Date.now() + IST_OFFSET);
      if (d.getUTCDate() >= 1) { const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); if (!get.get('m-' + prev)) await writeMonthly(prev); }
    } catch (e) { if (!/not enough/.test(e.message)) console.log('[NEWS-CH] monthly failed', e.message); }
  }
  // First run 40 s after boot (lets the RSS cache warm), then hourly; the daily is written once per IST day.
  if (deps.schedule !== false) { setTimeout(tick, 40 * 1000); setInterval(tick, 60 * 60 * 1000); }

  // ── routes ──
  app.get('/api/bulletins', (req, res) => {
    const kind = req.query.kind === 'monthly' ? 'monthly' : 'daily';
    const list = db.prepare('SELECT * FROM news_bulletins WHERE kind=? ORDER BY date DESC LIMIT 31').all(kind).map(row);
    res.json({ kind, items: list, hasAudio: !!elevenKey() });
  });
  app.get('/api/bulletins/latest', (req, res) => res.json({ daily: latest('daily'), monthly: latest('monthly'), hasAudio: !!elevenKey() }));
  app.get('/api/bulletins/:id', (req, res) => { const r = row(get.get(String(req.params.id))); if (!r) return res.status(404).json({ error: 'not found' }); res.json(r); });
  app.post('/api/bulletins/refresh', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin only' });
    const date = istDate(); db.prepare('DELETE FROM news_bulletins WHERE id=?').run('d-' + date);
    try { res.json({ ok: true, bulletin: await writeDaily(date) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Explain any story simply, in English and Hindi, cached per headline.
  app.post('/api/news/explain', auth, async (req, res) => {
    const title = String(req.body && req.body.title || '').slice(0, 300);
    const desc = String(req.body && req.body.desc || '').slice(0, 2500);
    if (!title) return res.status(400).json({ error: 'title required' });
    const k = title.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim().slice(0, 120);
    const c = db.prepare('SELECT data FROM news_explain WHERE k=?').get(k);
    if (c) return res.json(JSON.parse(c.data));
    try {
      const g = await callGemini([{ role: 'user', content: `Explain this news story to someone in India who finds English news hard. STRICT JSON: {"easy":"<4-6 short sentences in very simple English: what happened, who it affects, why it matters, what may happen next>","hi":"<the same in natural spoken Hindi (Devanagari)>","words":[{"w":"<hard English word from the story>","m":"<simple meaning in English>","hi":"<Hindi meaning>"} x 3-5]}\n\nHEADLINE: ${title}\nSTORY: ${desc}` }], { maxTokens: 1200, systemPrompt: 'Return only valid JSON. No code fences. Do not add facts not in the story.' });
      const j = JSON.parse(g.reply.replace(/^```json\s*|```$/g, '').trim());
      db.prepare('INSERT OR REPLACE INTO news_explain(k,data) VALUES(?,?)').run(k, JSON.stringify(j));
      res.json(j);
    } catch (e) { res.status(503).json({ error: 'Could not explain right now: ' + e.message }); }
  });
  app.get('/audio-news/:file', (req, res) => {
    const f = String(req.params.file).replace(/[^a-zA-Z0-9_.-]/g, '');
    const p = path.join(DIR, f);
    if (!f.endsWith('.mp3') || !fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(p);
  });
  console.log('[NEWS-CH] channel ready; elevenlabs', elevenKey() ? '✅' : '❌ (device voice fallback — paste a key in You → Admin)');
  return { tick, writeDaily, writeMonthly, latest, ensureToday, renderAudio };
}

module.exports = { install, elevenTTS };
