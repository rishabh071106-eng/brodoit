// Brodoit News Desk — Brodoit's own news, written in batches.
// Every run: pull every feed (all categories), merge stories that several outlets are covering into one cluster,
// rank clusters by how many independent sources carry them and how fresh they are, then have the brain
// (Gemini → Bro Core's background lane; v27: with no writer nothing is published, never the sources' own sentences)
// write ONE original Brodoit story per cluster, in its own words (v27: a check rejects any 8-word run copied from a source):
// a headline and a full 90–105 word story (10+ lines on a phone), in English and Hindi, with the sources listed.
// v13.1: near-duplicates of recent stories are skipped. v27: photos come only from Wikimedia Commons under a free licence
// (modules/newsphoto.js: the story's subject, credited author · licence), never a publisher's or agency's photo; cached
// once in MEDIA_DIR/news-img and served same-origin (/api/news/img/:id) so Share can draw it. No free photo → no photo.
// Rules for the writer: only facts present in the sources; no opinions; neutral, simple words.
//   GET  /api/news/desk?cat=&limit=   → { stories:[…], next, updated_at, writer }
//   GET  /api/news/desk?before=<next>&exclude=id,id&limit=  → the page older than that (v16 endless deck)
//   POST /api/news/desk/run (admin)   → runs a batch now
// v21: a signed-in reader never gets a story again once it was on screen (POST /api/news/seen; news_seen keeps 30 days),
// nor a rewrite of it (headline + opening words ≥ 0.45 alike a story seen in the last 14 days); the deck ends with
// `caughtUp` instead of going round again. A shared story is kept 90 days (news_shared, outside the feed):
//   GET  /api/news/story/:id → { story }      POST /api/news/share {id} → { url: <site>/n/<id> }
//   GET  /n/:id  the story's own page with link-preview tags (a signed-in visitor goes straight into the app);
//   GET  /n/:id/card.png  the preview picture when the story has no photo
// v22: three editions a day (07:00, 13:00, 19:00 India time; NEWS_EDITIONS), not a batch every 30 minutes. The best
// writer writes each story (Gemini Flash, then Bro Core's background models); every story is checked before it
// is published: English fields in English and Hindi fields in Hindi, complete sentences (never cut off with "…"), the
// length, a "why it matters" line, and every number in the story found in the sources. A story that fails gets one
// repair round, else it is not published (a story with good English and bad Hindi is published in English only).
// Repeats are caught by shared source links, by wording (≥ 0.45 alike) and by the writer, which sees the last two
// days' headlines. Only written stories reach the deck (no raw feed items); ?lang=hi gives the Hindi ones.
//   GET /api/news/edition → { id, label, at, next_at, count }   (the app's "new edition" dot)
// Stories older than 4 days drop off.
'use strict';
const GEM = require('./gemini.js');
const PHOTO = require('./newsphoto.js');
const crypto = require('crypto');
const fs = require('fs'), path = require('path');

const STOP = new Set('a an the of to in on for and or but with at by from as is are was were be been it its this that these those after before over under into about than then new says said say will would can could may might not no yes up down out more most what why how who when where which while amid amid as india india’s her his him their them she they you your our has have had'.split(/\s+/));
// words too common in news to tell two stories apart on their own ("police arrest three" is many stories)
const GENERIC = new Set('police arrest arrested arrests court government govt minister chief state city district shares share stock stocks percent crore lakh rupee rupees killed dead death deaths case report people year years day days week first two three four five six ten hundred thousand million billion top big world global national major announces launches gets hits seeks calls plan plans set sets amid'.split(/\s+/));
// v28: AI is a section of its own (its own feeds: the labs' own announcements and the tech press's AI desks)
const CAT_LABEL = { india: 'India', world: 'World', ai: 'AI', business: 'Business', tech: 'Tech', science: 'Science' };

function tokens(s) {
  return String(s || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}
function jaccard(a, b) { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); }
// v22: one event told twice. Headline + opening ≥ 0.45 alike, or headlines sharing 4+ words (3+ of them not generic,
// e.g. "elon musk tesla spacex") that make up 60% of the shorter headline.
const sigOf = (headline, text) => ({ t: new Set(tokens(headline + ' ' + String(text || '').slice(0, 140))), h: new Set(tokens(headline)) });
const telling = x => !GENERIC.has(x) && !/^\d+$/.test(x);
function sameStory(a, b) {
  if (jaccard(a.t, b.t) >= 0.45) { let d = 0; for (const x of a.t) if (b.t.has(x) && telling(x)) d++; if (d >= 2) return true; }
  let i = 0, d = 0; for (const x of a.h) if (b.h.has(x)) { i++; if (telling(x)) d++; }
  return i >= 4 && d >= 3 && i >= 0.6 * Math.min(a.h.size, b.h.size);
}
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const words = (s, n) => { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' '); return w.length > n ? w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…' : w.join(' '); };
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/\s+/g, ' ').trim();

// ── v22: language and quality checks ──
const DEVA_RE = /[ऀ-ॿ]/;
const hasDeva = t => DEVA_RE.test(String(t || ''));
const letters = t => (String(t || '').match(/[A-Za-zऀ-ॿ]/g) || []).length;
const isEnglishText = t => { t = String(t || ''); return letters(t) > 0 && !hasDeva(t); };
const isHindiText = t => { t = String(t || ''); const n = letters(t); return n > 0 && (t.match(/[ऀ-ॿ]/g) || []).length / n >= 0.6; };
const wordsIn = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const CUT_RE = /(…|\.\.\.)\s*["'”’)]*\s*$/;
const ENDS_RE = /[.!?।"'”’)]\s*$/;
// v27: own words. The longest run of words the story shares with the sources, if it is COPY_RUN words or more
// ("…displaced 20,000 people across six districts, officials said…"): facts can match, a sentence may not.
const COPY_RUN = 8;
const wordsOf = t => String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
function copiedRun(text, sourceText, n = COPY_RUN) {
  const src = wordsOf(sourceText), grams = new Set();
  for (let i = 0; i + n <= src.length; i++) grams.add(src.slice(i, i + n).join(' '));
  const w = wordsOf(text);
  for (let i = 0; i + n <= w.length; i++) {
    if (!grams.has(w.slice(i, i + n).join(' '))) continue;
    let j = i + n; while (j < w.length && grams.has(w.slice(j - n + 1, j + 1).join(' '))) j++;
    return w.slice(i, j).join(' ');
  }
  return '';
}
// every number the story states must be in the sources ("1,200" and "1200" are the same; 0–12 are allowed as words)
const numsOf = t => (String(t || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, '').replace(/\.0+$/, ''));
function checkStory(st, sourceText) {
  const en = [], hi = [];
  if (!st || typeof st !== 'object') return { en: ['not a JSON object'], hi: [] };
  const h = String(st.headline || '').trim(), sm = String(st.summary || '').trim(), why = String(st.why || '').trim();
  if (!isEnglishText(h)) en.push('the headline must be in English (no Devanagari)');
  if (wordsIn(h) < 4 || wordsIn(h) > 16) en.push('the headline must be 6-12 words');
  if (CUT_RE.test(h)) en.push('the headline must not end with an ellipsis');
  if (!isEnglishText(sm)) en.push('the summary must be in English (no Devanagari)');
  if (wordsIn(sm) < 70 || wordsIn(sm) > 135) en.push('the summary must be 80-110 words (it has ' + wordsIn(sm) + ')');
  if (CUT_RE.test(sm) || !ENDS_RE.test(sm)) en.push('the summary must end with a complete sentence, never an ellipsis');
  if (!isEnglishText(why) || wordsIn(why) < 6 || wordsIn(why) > 40) en.push('"why" must be one English sentence of 12-25 words');
  if (sourceText != null) {
    const src = new Set(numsOf(sourceText)), srcDigits = String(sourceText).replace(/,/g, '');
    const bad = [...new Set(numsOf(sm + ' ' + h + ' ' + why))].filter(n => !(+n <= 12 && !/\./.test(n)) && !src.has(n) && !srcDigits.includes(n));
    if (bad.length) en.push('these numbers are not in the sources: ' + bad.slice(0, 5).join(', ') + ' (use only the sources\' numbers)');
    const cp = copiedRun(h + ' . ' + sm + ' . ' + why, sourceText);
    if (cp) en.push('these words are copied from a source: "' + cp.split(' ').slice(0, 14).join(' ') + '" (say it in your own words)');
  }
  const hh = String(st.headline_hi || '').trim(), hs = String(st.summary_hi || '').trim(), hw = String(st.why_hi || '').trim();
  if (!isHindiText(hh)) hi.push('headline_hi must be Hindi in Devanagari');
  if (!isHindiText(hs) || wordsIn(hs) < 55 || wordsIn(hs) > 170) hi.push('summary_hi must be 80-120 words of Hindi in Devanagari');
  if (hs && (CUT_RE.test(hs) || !ENDS_RE.test(hs))) hi.push('summary_hi must end with a complete sentence');
  if (!isHindiText(hw)) hi.push('why_hi must be Hindi in Devanagari');
  return { en, hi };
}
// the edition a moment belongs to: the latest slot (India time) at or before it
const IST_MIN = 330;
function parseSlots(v) { return String(v || '07:00,13:00,19:00').split(',').map(x => x.trim()).filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).map(x => +x.slice(0, 2) * 60 + +x.slice(3)).sort((a, b) => a - b); }
function editionOf(now, slots) {
  slots = slots && slots.length ? slots : parseSlots();
  const t = (now instanceof Date ? now : new Date(now || Date.now())).getTime(), ist = new Date(t + IST_MIN * 60e3);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()), min = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  let d = day, k = slots.filter(x => x <= min).length - 1;
  if (k < 0) { d = day - 864e5; k = slots.length - 1; }
  const at = d + slots[k] * 60e3 - IST_MIN * 60e3, next = k + 1 < slots.length ? d + slots[k + 1] * 60e3 - IST_MIN * 60e3 : d + 864e5 + slots[0] * 60e3 - IST_MIN * 60e3;
  const hhmm = String(Math.floor(slots[k] / 60)).padStart(2, '0') + String(slots[k] % 60).padStart(2, '0'), hour = Math.floor(slots[k] / 60);
  return { id: new Date(d).toISOString().slice(0, 10) + '-' + hhmm, slot: hhmm, label: hour < 11 ? 'Morning edition' : hour < 17 ? 'Afternoon edition' : 'Evening edition', label_hi: hour < 11 ? 'सुबह का संस्करण' : hour < 17 ? 'दोपहर का संस्करण' : 'शाम का संस्करण', at: new Date(at).toISOString(), next_at: new Date(next).toISOString() };
}

function cluster(items) {
  const out = [];
  for (const it of items) {
    const t = new Set(tokens(it.title + ' ' + (it.desc || '').slice(0, 140)));
    if (t.size < 3) continue;
    let best = null, bs = 0;
    for (const c of out) { const s = jaccard(t, c.tok); if (s > bs) { bs = s; best = c; } }
    if (best && bs >= 0.28) { best.items.push(it); for (const x of t) best.tok.add(x); }
    else out.push({ tok: t, items: [it] });
  }
  for (const c of out) {
    const srcs = new Set(c.items.map(i => i.source)); c.sources = srcs.size;
    const newest = Math.max(...c.items.map(i => Date.parse(i.date || i.pubDate || '') || 0));
    const ageH = newest ? (Date.now() - newest) / 3600e3 : 24;
    c.score = c.sources * 3 + c.items.length - Math.min(ageH, 48) / 8;
    const cats = {}; for (const i of c.items) cats[i.cat] = (cats[i.cat] || 0) + 1;
    c.cat = Object.keys(cats).sort((a, b) => cats[b] - cats[a])[0];
    c.key = sha([...c.tok].sort().slice(0, 8).join(' ') + '|' + c.cat);
    c.newest = newest;
  }
  return out.sort((a, b) => b.score - a.score);
}

function install(app, deps) {
  const { db, auth, getSetting, isAdminUser, fetchFeed, feeds } = deps;
  const log = (...a) => console.log('[desk]', ...a);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS news_stories(id TEXT PRIMARY KEY, cluster_key TEXT UNIQUE, category TEXT, headline TEXT, summary TEXT, why TEXT,
      headline_hi TEXT, summary_hi TEXT, why_hi TEXT, sources TEXT, image TEXT, writer TEXT, source_count INTEGER DEFAULT 1, published_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_news_stories_created ON news_stories(created_at)');
  } catch (e) { log('schema', e.message); }
  const q = s => db.prepare(s);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS news_seen(user_phone TEXT NOT NULL, story_id TEXT NOT NULL, toks TEXT DEFAULT '', seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(user_phone, story_id))");
    db.exec('CREATE INDEX IF NOT EXISTS idx_news_seen_user ON news_seen(user_phone, seen_at)');
    db.exec("CREATE TABLE IF NOT EXISTS news_shared(id TEXT PRIMARY KEY, story TEXT NOT NULL, shared_at TEXT DEFAULT (datetime('now')), opens INTEGER DEFAULT 0)");
  } catch (e) { log('schema v21', e.message); }
  try {
    db.exec("CREATE TABLE IF NOT EXISTS news_editions(id TEXT PRIMARY KEY, slot TEXT, at TEXT, stories INTEGER DEFAULT 0, writer TEXT, created_at TEXT DEFAULT (datetime('now')))");
    try { db.exec('ALTER TABLE news_stories ADD COLUMN edition TEXT'); } catch (e) { /* already there */ }
  } catch (e) { log('schema v22', e.message); }
  for (const col of ['image_credit TEXT', 'image_query TEXT']) { try { db.exec('ALTER TABLE news_stories ADD COLUMN ' + col); } catch (e) { /* already there */ } }
  // v22: stories written before the checks: English fields with Hindi in them, or a story cut off with "…", go (the next
  // edition writes fresh ones); Hindi fields that are not Hindi are cleared (the story stays, in English only)
  try {
    let gone = 0, cleared = 0;
    for (const r of q('SELECT id, headline, summary, why, headline_hi, summary_hi, why_hi FROM news_stories').all()) {
      if (hasDeva(r.headline) || hasDeva(r.summary) || CUT_RE.test(String(r.summary || ''))) { q('DELETE FROM news_stories WHERE id=?').run(r.id); gone++; continue; }
      if (hasDeva(r.why)) q("UPDATE news_stories SET why='' WHERE id=?").run(r.id);
      if ((r.headline_hi || r.summary_hi) && !(isHindiText(r.headline_hi) && isHindiText(r.summary_hi) && !CUT_RE.test(String(r.summary_hi || '')))) { q("UPDATE news_stories SET headline_hi='', summary_hi='', why_hi='' WHERE id=?").run(r.id); cleared++; }
    }
    if (gone || cleared) log('cleanup:', gone, 'stories in the wrong language or cut off removed;', cleared, 'Hindi versions that were not Hindi cleared');
    // the same event written twice (before v22 each 30-minute batch could write it again): the best-sourced one stays
    const kept = []; let twice = 0;
    for (const r of q("SELECT id, headline, summary FROM news_stories WHERE created_at > datetime('now','-4 days') ORDER BY source_count DESC, created_at ASC").all()) {
      const g = sigOf(r.headline, r.summary);
      if (kept.some(k => sameStory(g, k))) { q('DELETE FROM news_stories WHERE id=?').run(r.id); twice++; } else kept.push(g);
    }
    if (twice) log('cleanup:', twice, 'repeats of the same story removed');
  } catch (e) { log('cleanup v22', e.message); }
  const state = { running: false, last: null, lastError: '', writer: '' };

  async function gather() {
    const all = [];
    for (const cat of Object.keys(CAT_LABEL)) {
      const urls = (feeds && feeds[cat]) || [];
      const res = await Promise.all(urls.map(u => fetchFeed(u).then(r => (Array.isArray(r) ? r : (r && r.items) || [])).catch(() => [])));
      for (const list of res) for (const it of list.slice(0, 25)) {
        if (!it || !it.title || !it.link) continue;
        all.push({ title: strip(it.title), desc: strip(it.desc || it.description || ''), link: it.link, source: it.source || (() => { try { return new URL(it.link).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })(), img: it.img || null, date: it.date || it.pubDate || '', cat });
      }
    }
    return all;
  }

  // ── the writer ──
  // v22: the editor's brief. Accuracy first, wire-service style, a "why it matters" line, Hindi written like a Hindi
  // newspaper, and the last two days' headlines so the writer can say "this is the same event".
  const SYS = 'You are the senior editor of Brodoit News, an Indian news app read on phones. From the source reports, write ONE news story. ' +
    'Accuracy first: use only facts the sources state; never add numbers, names, dates, quotes or causes they do not state; if the sources disagree, say so or leave it out. ' +
    'Write like a top wire-service editor: the most important fact first, then who, what, where, when, the key numbers and the context; plain, specific words; active voice; ' +
    'no opinion, hype, clickbait or questions; no filler such as "according to reports"; complete sentences only, never an ellipsis. ' +
    'Write every sentence in your own words: never copy a sentence, or more than six words in a row, from a source, and report what people said in indirect speech, not quotes. ' +
    'Return strict JSON with keys: headline (English, 6-12 words, sentence case, no full stop), summary (English, one paragraph of 80-110 words), ' +
    'why (English, one sentence of 12-25 words: why it matters to a reader in India), headline_hi, summary_hi, why_hi (natural, fluent Hindi in Devanagari, the same facts, ' +
    'written the way a good Hindi newspaper would, not word-for-word; numbers in digits), category (one of india, world, ai, business, tech, science; ai = artificial intelligence: AI models, AI labs and companies, AI chips, AI rules and AI in daily life), ' +
    'image_query (2-5 English words naming the story\'s main subject that an encyclopedia photo could show: a place, a public figure, an organisation, a landmark or an object, e.g. "Brahmaputra river", "Reserve Bank of India"; never the event itself), ' +
    'duplicate_of (the number of a RECENT headline that reports the same event, else null). English fields must contain no Devanagari; Hindi fields must be in Devanagari.';
  const sourceText = c => c.items.slice(0, 6).map(i => i.title + '. ' + i.desc + (i.full ? ' ' + i.full : '')).join('\n');
  function promptFor(c, heads) {
    const lines = c.items.slice(0, 6).map((i, n) => `Source ${n + 1} (${i.source}${i.date ? ', ' + String(i.date).slice(0, 16) : ''}): ${i.title}. ${i.full || clip(i.desc, 600)}`);
    const recent = (heads || []).slice(0, 30).map((h, n) => `${n + 1}. ${h}`).join('\n');
    return (recent ? 'RECENT (already published in the last three days; if the sources report the same event, answer only {"duplicate_of": its number}):\n' + recent + '\n\n' : '') + 'SOURCES:\n' + lines.join('\n');
  }
  const parseJSON = t => { const m = String(t || '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };
  async function viaOpenAI(key, text) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ model: getSetting('OPENAI_CHAT_MODEL') || 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'openai ' + r.status);
    return JSON.parse(j.choices[0].message.content);
  }
  async function viaGemini(key, text) {
    // v22: the Flash tier (not lite): three editions a day, so the better model is affordable
    const { json: j } = await GEM.generate(key, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, { tier: 'flash', getSetting, timeout: 40000 });
    return JSON.parse(GEM.textOf(j));
  }
  async function viaGroq(key, text) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'groq ' + r.status);
    return JSON.parse(j.choices[0].message.content);
  }
  function writers() {
    // v22: news is written 3 times a day, so the best writer that does not touch live talk writes it: Gemini Flash (its
    // own provider and allowance, the best Hindi), then Bro Core's background lane (its own Groq models: the gpt-oss
    // allowance stays live talk's). The writers after them run only while Bro Core's emergency switch is on.
    const w = [], BC = global._broCore;
    const g = getSetting('GEMINI_API_KEY');
    if (g && !((global._geminiDownUntil || 0) > Date.now())) w.push(['gemini', t => viaGemini(g, t)]);
    if (BC && BC.brainReady()) w.push(['brocore', t => BC.chat({ system: SYS, messages: [{ role: 'user', content: t }], json: true, maxTokens: 3000, temperature: 0.2, purpose: 'news', emergency: false }).then(r => parseJSON(r.text))]);
    if (BC && !BC.emergencyOn()) return w;
    const o = getSetting('OPENAI_API_KEY'); if (o) w.push(['openai', t => viaOpenAI(o, t)]);
    const r = getSetting('GROQ_API_KEY'); if (r && !(BC && BC.brainReady())) w.push(['groq', t => viaGroq(r, t)]);
    const B = global._elevenBrain; if (B && B.available()) w.push(['elevenlabs', t => viaEleven(B, t)]);
    return w;
  }
  // write → check → one repair round → next writer. Returns { s, by } | { duplicate } | null.
  // v22: a feed gives a line or two per report, too little for a full story; the writer reads the articles themselves
  // (up to 2 per story, through modules/newsreader.js, which fetches public addresses only). Off when the server does
  // not pass deps.readArticle (tests) or NEWS_READ_ARTICLES=0.
  const readArticle = typeof deps.readArticle === 'function' && process.env.NEWS_READ_ARTICLES !== '0' ? deps.readArticle : null;
  async function enrich(c) {
    if (!readArticle) return;
    const pick = c.items.filter(i => /^https?:\/\//.test(i.link || '') && !/(^|\.)news\.google\./.test((() => { try { return new URL(i.link).hostname; } catch (e) { return ''; } })())).slice(0, 2);
    await Promise.all(pick.map(async i => {
      try {
        const d = await Promise.race([readArticle(i.link), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 15000))]);
        if (!d || !d.ok) return;
        const t = (d.paragraphs || []).filter(x => !hasDeva(x)).join(' ').replace(/\s+/g, ' ').trim();
        if (t.length > String(i.desc || '').length + 200) i.full = clip(t, 2400);
      } catch (e) { /* the feed's own lines are used */ }
    }));
  }
  // the recent headlines that share a telling word with this story, most alike first (what a repeat would look like)
  function relatedHeads(c, heads) {
    const t = new Set(); for (const i of c.items.slice(0, 6)) for (const w of tokens(i.title)) if (!GENERIC.has(w)) t.add(w);
    return heads.map((h, k) => ({ h, k, n: tokens(h).filter(w => t.has(w)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.k - b.k).slice(0, 30).map(x => x.h);
  }
  // v28.2: Bro Core's background lane shares one Groq allowance (8,000 tokens a minute on gpt-oss-20b): a rate limit
  // there waits a minute and tries once more before the story goes to the next writer (the 07:00 edition of 1 Nov
  // sent 18 of 33 stories to ElevenLabs's emergency writer because each 429 cooled the lane for every story after it)
  const RATE_WAIT_MS = process.env.NEWS_RATE_WAIT_MS != null ? +process.env.NEWS_RATE_WAIT_MS : 65000;
  const rateLimited = e => !!e && (e.kind === 'rate' || e.code === 'brain_down' || /\b429\b|rate.?limit|brain_down|too many requests/i.test(String(e.message || '')));
  async function writeStory(c, allHeads, ws) {
    const heads = relatedHeads(c, allHeads || []), prompt = promptFor(c, heads), src = sourceText(c);
    let enOnly = null;
    for (let k = 0, retried = false; k < ws.length; k++) {
      const [name, fn] = ws[k];
      try {
        let out = await fn(prompt);
        if (!out || typeof out !== 'object') continue;
        const d = parseInt(out.duplicate_of, 10); if (d >= 1 && heads[d - 1]) return { duplicate: heads[d - 1], by: name };
        let p = checkStory(out, src);
        if (p.en.length || p.hi.length) {
          const fixed = await fn(prompt + '\n\nYOUR DRAFT:\n' + JSON.stringify(out) + '\n\nIt has these problems: ' + p.en.concat(p.hi).join('; ') + '. Fix every one and return the corrected JSON with the same keys.');
          if (fixed && typeof fixed === 'object') { const p2 = checkStory(fixed, src); if (p2.en.length <= p.en.length) { out = fixed; p = p2; } }
        }
        if (!p.en.length && !p.hi.length) return { s: out, by: name };
        if (!p.en.length && !enOnly) enOnly = { s: Object.assign({}, out, { headline_hi: '', summary_hi: '', why_hi: '' }), by: name };
        state.lastError = name + ': ' + p.en.concat(p.hi).join('; ');
      } catch (e) {
        state.lastError = name + ': ' + e.message; if (name === 'gemini' && /402|credit|prepay|billing/i.test(e.message)) global._geminiDownUntil = Date.now() + 3600e3;
        if (name === 'brocore' && !retried && rateLimited(e)) { retried = true; state.rateWaits = (state.rateWaits || 0) + 1; if (RATE_WAIT_MS > 0) await new Promise(r => setTimeout(r, RATE_WAIT_MS)); k--; continue; }
      }
    }
    return enOnly; // good English, Hindi not right from any writer: published in English only
  }
  async function viaEleven(B, text) {
    const out = await B.ask({ system: SYS + ' Reply with the JSON object only, no other text.', messages: [{ role: 'user', content: text }], timeout: 40000 });
    const m = String(out).match(/\{[\s\S]*\}/); if (!m) throw new Error('no JSON in reply');
    return JSON.parse(m[0]);
  }
  // v27: without any writer the desk publishes nothing: never the sources' own sentences stitched together
  const wc = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = 70;

  // ── v27: free photos only (Wikimedia Commons, credited); cached once and served same-origin ──
  const IMG = deps.mediaDir ? path.join(deps.mediaDir, 'news-img') : '';
  if (IMG) { try { fs.mkdirSync(IMG, { recursive: true }); } catch (e) { /* read-only */ } }
  const imgFile = id => { if (!IMG) return ''; for (const x of ['jpg', 'png', 'webp']) { const f = path.join(IMG, id + '.' + x); if (fs.existsSync(f)) return f; } return ''; };
  // only public http(s) hosts: page and photo URLs come from outside, so never touch localhost or private ranges
  const publicUrl = u => { try { const x = new URL(u), h = x.hostname.toLowerCase(); return /^https?:$/.test(x.protocol) && !h.startsWith('[') && /[a-z]/.test(h) && h !== 'localhost' && !/\.(local|internal|localhost)$/.test(h); } catch (e) { return false; } };
  // a photo saved as <base>.<jpg|png|webp> (the first of the urls that answers with a real image of sensible size)
  async function download(urls, base) {
    for (const url of [].concat(urls).filter(Boolean)) {
      if (!publicUrl(url)) continue;
      try {
        const r = await (deps.fetchImage || fetch)(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': PHOTO.UA } });
        const type = String(r.headers.get('content-type') || '');
        if (!r.ok || !/^image\/(jpeg|jpg|png|webp)/.test(type)) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 4000 || buf.length > 3e6) continue; // tiny = a logo/pixel, huge = not worth it (the next url is smaller)
        const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
        const f = base + '.' + ext, tmp = f + '.tmp';
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
        return f;
      } catch (e) { /* the next url */ }
    }
    return '';
  }
  async function cacheImage(id, url, alt) {
    if (!IMG || !url || imgFile(id)) return !!imgFile(id);
    return !!(await download([url, alt], path.join(IMG, id)));
  }
  // v28: Wikimedia Commons first, then Openverse (CC0, public domain, CC BY, CC BY-SA only; modules/newsphoto.js)
  const findPhoto = deps.findPhoto || ((qy, o) => PHOTO.findAny(qy, o));
  const creditJSON = (hit, extra) => JSON.stringify(Object.assign({ by: hit.by, license: hit.license, page: hit.page, title: hit.title, source: hit.source || 'Wikimedia Commons' }, extra || {}));

  // ── v28: every story has a photo. When nothing free shows the story's own subject, it takes one from its section's
  // pool: free photos (the same licences, credited) of the section's usual subjects, found once and kept in
  // MEDIA_DIR/news-pool (pool.json lists each with its credit). A story's pick is fixed by its id, so it never changes.
  const POOL_Q = {
    india: ['India Gate New Delhi', 'Gateway of India Mumbai', 'Parliament House New Delhi', 'Howrah Bridge Kolkata', 'Charminar Hyderabad', 'Mysore Palace', 'Hawa Mahal Jaipur', 'Marine Drive Mumbai'],
    world: ['United Nations headquarters', 'Earth from space', 'Tower Bridge London', 'Sydney Opera House', 'Eiffel Tower Paris', 'Tokyo skyline', 'Brandenburg Gate', 'world map globe'],
    ai: ['data center servers', 'server room', 'computer chip', 'circuit board', 'supercomputer', 'robot arm', 'humanoid robot', 'fiber optic cables'],
    tech: ['smartphone', 'laptop computer', 'semiconductor wafer', 'circuit board', 'satellite dish', 'keyboard computer', 'mobile phone tower', 'electronics factory'],
    business: ['Bombay Stock Exchange', 'Mumbai skyline', 'container ship port', 'Indian rupee banknotes', 'Bandra Kurla Complex', 'shipping containers', 'office buildings', 'market vegetables India'],
    science: ['laboratory', 'telescope observatory', 'microscope', 'Milky Way night sky', 'rocket launch', 'DNA model', 'Himalaya mountains', 'rainforest'],
    life: ['sunrise', 'banyan tree', 'mountain landscape', 'Varanasi ghats', 'tea garden', 'Kerala backwaters', 'lotus flower', 'monsoon clouds'],
  };
  const POOL_DIR = deps.mediaDir ? path.join(deps.mediaDir, 'news-pool') : '';
  if (POOL_DIR) { try { fs.mkdirSync(POOL_DIR, { recursive: true }); } catch (e) { /* read-only */ } }
  let pool = {}; try { pool = JSON.parse(fs.readFileSync(path.join(POOL_DIR, 'pool.json'), 'utf8')) || {}; } catch (e) { pool = {}; }
  const poolState = { busy: false, at: null, made: 0 };
  async function buildPool(paceMs) {
    if (!POOL_DIR || poolState.busy) return poolState;
    poolState.busy = true;
    try {
      for (const [cat, qs] of Object.entries(POOL_Q)) {
        const have = (pool[cat] = (pool[cat] || []).filter(x => x && x.file && fs.existsSync(path.join(POOL_DIR, x.file))));
        for (const qy of qs) {
          if (have.some(x => x.q === qy)) continue;
          let hit = null; try { hit = await findPhoto(qy); } catch (e) { hit = null; }
          if (hit && hit.url && have.every(x => x.url !== hit.url)) {
            const f = await download([hit.url, hit.thumb], path.join(POOL_DIR, cat + '-' + sha(qy).slice(0, 8)));
            if (f) { have.push({ q: qy, url: hit.url, file: path.basename(f), credit: JSON.parse(creditJSON(hit)) }); poolState.made++; fs.writeFileSync(path.join(POOL_DIR, 'pool.json'), JSON.stringify(pool)); }
          }
          if (paceMs > 0) await new Promise(r => setTimeout(r, paceMs));
        }
      }
    } catch (e) { log('photo pool', e.message); }
    finally { poolState.busy = false; poolState.at = new Date().toISOString(); }
    return poolState;
  }
  function poolPick(cat, id) {
    const ok = l => (l || []).filter(x => x && x.file && fs.existsSync(path.join(POOL_DIR, x.file)));
    let list = ok(pool[cat]); if (!list.length) list = ok(pool.world); if (!list.length) list = ok([].concat(...Object.values(pool)));
    if (!list.length) return null;
    return list[parseInt(sha(String(id)).slice(0, 8), 16) % list.length];
  }
  // the pool photo copied in as <id>.<ext> (served and shared like any other); its credit, marked pool: true
  function usePool(id, cat) {
    if (!IMG || !POOL_DIR) return null;
    const p = poolPick(cat, id); if (!p) return null;
    try { fs.copyFileSync(path.join(POOL_DIR, p.file), path.join(IMG, id + path.extname(p.file))); } catch (e) { return null; }
    return Object.assign({}, p.credit, { pool: true });
  }
  // one photo for anything the News tab shows (a story, today's thought, a reader's piece): its own subject first, else
  // the section's pool. Returns its credit (the file is IMG/<id>.<ext>) or null.
  async function photoInto(id, query, headline, cat) {
    if (imgFile(id)) return 'have';
    // the writer's subject (at least half its words in the photo's description), then the headline's proper nouns (all)
    const qs = [[String(query || '').trim(), {}], [PHOTO.headlineSubject(headline), { all: true }]].filter(x => x[0]);
    if (Date.now() - (tried.get(id) || 0) >= 6 * 3600e3) {
      for (const [qy, o] of qs) {
        let hit = null; try { hit = await findPhoto(qy, o); } catch (e) { hit = null; }
        if (hit && hit.url && await cacheImage(id, hit.url, hit.thumb)) return Object.assign(JSON.parse(creditJSON(hit, { fit: 1, via: o.all ? 'headline' : 'writer' })), { _url: hit.url });
      }
      tried.set(id, Date.now()); if (tried.size > 2000) tried.clear();
    }
    return usePool(id, cat);
  }
  const tried = new Map(); // id → when a lookup last found nothing (looked up again after 6 hours)
  // upgrades look on Commons only (fast, well described; Openverse's daily allowance stays for new stories)
  const findOwn = deps.findPhoto || ((qy, o) => PHOTO.find(qy, o).then(h => h && Object.assign({ source: 'Wikimedia Commons' }, h)));
  const rmImg = id => { for (const x of ['jpg', 'png', 'webp']) { try { fs.unlinkSync(path.join(IMG, id + '.' + x)); } catch (e) { /* none */ } } };
  // v28.1: a story on a pool photo tries its own subject again (more is found now that Wikimedia's new thumbnail host is
  // accepted), and one that took another section's pool photo (its own section's pool was empty) gets its own section's
  async function upgrade(r) {
    let cr = null; try { cr = JSON.parse(r.image_credit || 'null'); } catch (e) { cr = null; }
    if (!IMG || !cr || !cr.pool) return false;
    if (Date.now() - (tried.get(r.id) || 0) >= 6 * 3600e3) {
      for (const [qy, o] of [[String(r.image_query || '').trim(), {}], [PHOTO.headlineSubject(r.headline), { all: true }]].filter(x => x[0])) {
        let hit = null; try { hit = await findOwn(qy, o); } catch (e) { hit = null; }
        if (!hit || !hit.url) continue;
        const nf = await download([hit.url, hit.thumb], path.join(IMG, r.id + '__new'));
        if (!nf) continue;
        rmImg(r.id); fs.renameSync(nf, path.join(IMG, r.id + path.extname(nf)));
        q('UPDATE news_stories SET image=?, image_credit=? WHERE id=?').run(hit.url, creditJSON(hit, { fit: 1, via: o.all ? 'headline' : 'writer' }), r.id);
        return true;
      }
      tried.set(r.id, Date.now()); if (tried.size > 2000) tried.clear();
    }
    const own = (pool[r.category] || []).filter(x => x && x.credit);
    if (own.length && !own.some(x => x.credit.page === cr.page)) {
      rmImg(r.id); const c2 = usePool(r.id, r.category);
      if (c2) { q('UPDATE news_stories SET image=?, image_credit=? WHERE id=?').run('pool:' + r.category, JSON.stringify(c2), r.id); return true; }
    }
    return false;
  }
  async function photoFor(id, query, headline, cat) {
    const cr = await photoInto(id, query, headline, cat);
    if (cr === 'have') return true;
    if (!cr) return false;
    const url = cr._url || ''; delete cr._url;
    try { q('UPDATE news_stories SET image=?, image_credit=? WHERE id=?').run(url || 'pool:' + (cat || ''), JSON.stringify(cr), id); } catch (e) { /* ignore */ }
    return true;
  }
  // v27: a photo saved before v27 came from a publisher (the feed's image or the page's og:image): removed once, with
  // its link; the stories stay and get a free photo, or the app's own colour card
  try {
    const old = q("SELECT id FROM news_stories WHERE image IS NOT NULL AND (image_credit IS NULL OR image_credit='')").all();
    for (const r of old) { const f = imgFile(r.id); if (f) fs.unlinkSync(f); }
    if (old.length) { q("UPDATE news_stories SET image=NULL WHERE image_credit IS NULL OR image_credit=''").run(); log('removed', old.length, 'publisher photos (v27: free photos only)'); }
    if (IMG) {
      const credited = new Set(q("SELECT id FROM news_stories WHERE image_credit IS NOT NULL AND image_credit<>''").all().map(r => r.id));
      try { for (const r of q('SELECT id, story FROM news_shared').all()) if (/"image_credit":\{/.test(r.story || '')) credited.add(r.id); } catch (e) { /* no shares yet */ }
      let n = 0; for (const f of fs.readdirSync(IMG)) { const id = f.replace(/\.(jpg|png|webp|tmp)$/, ''); if (/^(th|rd)_/.test(id) || !fs.statSync(path.join(IMG, f)).isFile()) continue; if (!credited.has(id)) { fs.unlinkSync(path.join(IMG, f)); n++; } }
      if (n) log('removed', n, 'cached photos without a free licence');
    }
  } catch (e) { log('photo cleanup', e.message); }
  // the photo pass: recent stories without a photo look one up (Commons, one at a time). Runs after each edition, and
  // on its own soon after boot and every hour, so stories written before a deploy don't wait for the next edition.
  const photoState = { busy: false, at: null, looked: 0, found: 0 };
  async function photoPass(limit, paceMs) {
    if (photoState.busy) return { busy: true };
    photoState.busy = true; let looked = 0, found = 0;
    try {
      // stories with no photo first, then stories on a pool photo (v28.1: their own subject may be found now)
      const all = q("SELECT id, image_query, headline, category, image_credit FROM news_stories WHERE created_at > datetime('now','-4 days') ORDER BY created_at DESC LIMIT 120").all();
      const isPool = r => /"pool":true/.test(r.image_credit || '');
      // v28.1: a photo found before v28.1 from one loose word takes its section's pool photo: dolphins for "Indian stock
      // market…" (no subject from the writer: the headline's subject must be in the photo's title), or a house in
      // Virginia for the writer's "Indian Parliament House" (two thirds of the writer's subject must be in it). Photos
      // found since carry `fit` (they met the stricter rule) and are never checked again; with no pool photo to give,
      // the old photo stays.
      for (const r of all) {
        if (isPool(r) || !imgFile(r.id)) continue;
        let cr = null; try { cr = JSON.parse(r.image_credit || 'null'); } catch (e) { cr = null; }
        if (!cr || cr.via) continue;                                  // found under the v28.2 rules: never undone
        // a v28.1 photo (fit, no via) found from a one-word headline subject ("Platforms", "Boutique"): the story had no
        // writer's subject, or its photo does not carry the writer's subject, so the one word is what found it
        const oneWord = !PHOTO.headlineSubject(r.headline) && !!PHOTO.queryFromHeadline(r.headline);
        if (cr.fit ? !(oneWord && (!r.image_query || !PHOTO.fitsQuery(cr.title, r.image_query))) : (r.image_query ? PHOTO.fitsQuery(cr.title, r.image_query) : PHOTO.fitsHeadline(cr.title, r.headline))) continue;
        const hit = poolPick(r.category, r.id); if (!hit) continue;
        rmImg(r.id); const c2 = usePool(r.id, r.category);
        if (c2) { q('UPDATE news_stories SET image=?, image_credit=? WHERE id=?').run('pool:' + r.category, JSON.stringify(c2), r.id); r.image_credit = JSON.stringify(c2); tried.set(r.id, Date.now()); }
      }
      const rows = all.filter(r => !imgFile(r.id)).concat(all.filter(r => imgFile(r.id) && isPool(r) && Date.now() - (tried.get(r.id) || 0) >= 6 * 3600e3)).slice(0, limit || 12);
      for (const r of rows) {
        looked++; if (imgFile(r.id) ? await upgrade(r) : await photoFor(r.id, r.image_query, r.headline, r.category)) found++;
        if (paceMs > 0) await new Promise(res => setTimeout(res, paceMs));
      }
    } catch (e) { log('photo pass', e.message); }
    finally { photoState.busy = false; }
    Object.assign(photoState, { at: new Date().toISOString(), looked, found });
    if (looked) log('photo pass', JSON.stringify({ looked, found }));
    return { looked, found };
  }
  app.get('/api/news/img/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    const f = id && imgFile(id); if (!f) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800, immutable'); res.sendFile(f);
  });
  // One-time cleanup: short stories from before v13.1 are rewritten as full stories by the next batch.
  try { const short = q('SELECT id, summary FROM news_stories').all().filter(r => wc(r.summary) < MIN_WORDS).map(r => r.id); if (short.length) { const del = q('DELETE FROM news_stories WHERE id=?'); for (const id of short) del.run(id); log('removed', short.length, 'short stories; the next batch writes them in full'); } } catch (e) { log('cleanup', e.message); }

  const SLOTS = parseSlots(process.env.NEWS_EDITIONS);
  const PER_EDITION = Math.max(5, Math.min(40, parseInt(process.env.NEWS_PER_EDITION, 10) || 20));
  const PACE_MS = process.env.NEWS_PACE_MS != null ? +process.env.NEWS_PACE_MS : 4000; // between stories: spares the live allowance
  // v28.2: when Bro Core's shared Groq lane writes, about one story a minute keeps it inside 8,000 tokens a minute (a
  // story with its repair round is ~4-7k tokens); Gemini, with its own allowance, keeps the short pace
  const SHARED_PACE_MS = process.env.NEWS_PACE_SHARED_MS != null ? +process.env.NEWS_PACE_SHARED_MS : (process.env.NEWS_PACE_MS != null ? +process.env.NEWS_PACE_MS : 45000);
  const nowOf = () => (deps.now ? deps.now() : new Date());
  const parseSources = t => { try { return JSON.parse(t || '[]'); } catch (e) { return []; } };
  async function run(reason, ed) {
    if (state.running) return { busy: true };
    ed = ed || editionOf(nowOf(), SLOTS);
    state.running = true; const t0 = Date.now(); let wrote = 0, skipped = 0, dup = 0, failed = 0;
    try {
      const items = await gather();
      // v28: every section gets its turn (its best story first, then the next round), so AI, Science or Business are
      // never crowded out by one busy section
      const byCat = {}; for (const c of cluster(items).filter(c => c.items.length >= 1)) (byCat[c.cat] = byCat[c.cat] || []).push(c);
      const order = Object.keys(byCat).sort((a, b) => byCat[b][0].score - byCat[a][0].score), clusters = [];
      for (let k = 0; clusters.length < 60 && order.some(o => byCat[o][k]); k++) for (const o of order) if (byCat[o][k] && clusters.length < 60) clusters.push(byCat[o][k]);
      const have = new Set(q('SELECT cluster_key FROM news_stories WHERE created_at > datetime(\'now\',\'-3 days\')').all().map(r => r.cluster_key));
      // no repeats: a cluster that shares a source link with, or reads like, a story of the last 3 days is skipped;
      // the writer also sees the last two days' headlines and can say "duplicate_of"
      const rows = q("SELECT headline, summary, sources FROM news_stories WHERE created_at > datetime('now','-3 days') ORDER BY created_at DESC").all();
      const recent = rows.map(r => sigOf(r.headline, r.summary));
      const links = new Set(); for (const r of rows) for (const x of parseSources(r.sources)) if (x && x.link) links.add(x.link);
      const heads = rows.map(r => r.headline);
      const repeat = c => c.items.some(i => links.has(i.link)) || c.items.slice(0, 6).some(i => { const g = sigOf(i.title, i.desc); return recent.some(r => sameStory(g, r)); });
      const ws = writers(); state.writer = ws.length ? ws[0][0] : 'none';
      if (!ws.length) state.lastError = 'no writer: the desk publishes nothing rather than copy the sources';
      for (const c of clusters) {
        if (wrote >= PER_EDITION) break;
        if (have.has(c.key) || repeat(c)) { skipped++; continue; }
        if (c.items.every(i => hasDeva(i.title))) { skipped++; continue; } // the desk writes from English reports
        if (!ws.length) break;
        await enrich(c);
        const res = await writeStory(c, heads, ws);
        if (res && res.duplicate) { dup++; continue; }
        if (!res) { failed++; continue; }
        const st = res.s;
        const sources = []; const seen = new Set();
        for (const i of c.items) { if (seen.has(i.source)) continue; seen.add(i.source); sources.push({ name: i.source, link: i.link, title: i.title }); }
        const cat = CAT_LABEL[st.category] ? st.category : c.cat;
        const T = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
        try {
          const iq = T(st.image_query, 80);
          q('INSERT OR IGNORE INTO news_stories(id,cluster_key,category,headline,summary,why,headline_hi,summary_hi,why_hi,sources,image,writer,source_count,published_at,edition,image_query) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run('ns_' + c.key, c.key, cat, T(st.headline, 160), T(st.summary, 1400), T(st.why, 300), T(st.headline_hi, 200), T(st.summary_hi, 1800), T(st.why_hi, 400), JSON.stringify(sources.slice(0, 6)), null, res.by, sources.length, new Date(c.newest || Date.now()).toISOString(), ed.id, iq);
          wrote++;
          heads.unshift(T(st.headline, 160)); recent.push(sigOf(st.headline, st.summary)); for (const i of c.items) links.add(i.link);
          await photoFor('ns_' + c.key, iq, st.headline, cat);
        } catch (e) { state.lastError = 'db: ' + e.message; }
        const pace = ws.length && ws[0][0] === 'brocore' ? Math.max(PACE_MS, SHARED_PACE_MS) : PACE_MS;
        if (pace > 0) await new Promise(r => setTimeout(r, pace));
      }
      if (wrote) q('INSERT OR REPLACE INTO news_editions(id, slot, at, stories, writer) VALUES(?,?,?,?,?)').run(ed.id, ed.slot, ed.at, wrote + ((q('SELECT stories FROM news_editions WHERE id=?').get(ed.id) || {}).stories || 0), state.writer);
      q("DELETE FROM news_stories WHERE created_at < datetime('now','-4 days')").run();
      try { q("DELETE FROM news_shared WHERE shared_at < datetime('now','-90 days')").run(); q('DELETE FROM news_editions WHERE at < ?').run(new Date(nowOf().getTime() - 7 * 864e5).toISOString()); } catch (e) { /* ignore */ }
      await photoPass(12, 0);
      try { for (const f of fs.readdirSync(IMG)) { const id = f.replace(/\.(jpg|png|webp|tmp)$/, ''); if (/^(th|rd)_/.test(id)) continue; if (!q('SELECT 1 FROM news_stories WHERE id=?').get(id) && !q('SELECT 1 FROM news_shared WHERE id=?').get(id)) fs.unlinkSync(path.join(IMG, f)); } } catch (e) { /* ignore */ }
      const by = {}; for (const r of q('SELECT writer, COUNT(*) n FROM news_stories WHERE edition=? GROUP BY writer').all(ed.id)) by[r.writer || '?'] = r.n;
      state.last = { at: new Date().toISOString(), reason, edition: ed.id, items: items.length, clusters: clusters.length, wrote, skipped, duplicates: dup, failed, ms: Date.now() - t0, writer: state.writer, by, rate_waits: state.rateWaits || 0 };
      state.rateWaits = 0;
      log('edition', JSON.stringify(state.last));
      // record the new headlines and top stories right away (modules/newsvoice.js)
      if (wrote && global._newsVoice) setTimeout(() => global._newsVoice.run('desk batch').catch(() => {}), 3000);
      return state.last;
    } catch (e) { state.lastError = e.message; log('edition failed', e.message); return { error: e.message }; }
    finally { state.running = false; }
  }
  // the minute tick: the current edition is made once (a failed or empty try is retried after 20 minutes, 3 times)
  state.tries = {};
  function tick(now) {
    now = now instanceof Date ? now : nowOf();
    const ed = editionOf(now, SLOTS);
    if (state.running || q('SELECT 1 FROM news_editions WHERE id=?').get(ed.id)) return null;
    const t = state.tries[ed.id] || { n: 0, at: 0 };
    if (t.n >= 3 || +now - t.at < 20 * 60e3) return null;
    state.tries[ed.id] = { n: t.n + 1, at: +now };
    return run('edition', ed);
  }
  function editionInfo() {
    const cur = editionOf(nowOf(), SLOTS);
    let last = null; try { last = q('SELECT id, slot, at, stories FROM news_editions ORDER BY id DESC LIMIT 1').get(); } catch (e) { last = null; }
    if (!last) return Object.assign({}, cur, { count: 0, ready: false });
    const hour = +String(last.slot || '0700').slice(0, 2);
    return { id: last.id, slot: last.slot, label: hour < 11 ? 'Morning edition' : hour < 17 ? 'Afternoon edition' : 'Evening edition', label_hi: hour < 11 ? 'सुबह का संस्करण' : hour < 17 ? 'दोपहर का संस्करण' : 'शाम का संस्करण', at: last.at, next_at: cur.id === last.id ? cur.next_at : cur.at > last.at ? cur.at : cur.next_at, count: last.stories, ready: true };
  }

  // v27: the photo's credit (Wikimedia Commons: author · licence · file page), and which sources are official ones
  // (government, regulator, UN agency, space agency): the app marks a story backed by one "Official source"
  const creditOf = r => { try { const c = JSON.parse(r.image_credit || 'null'); return c && c.license ? c : null; } catch (e) { return null; } };
  const OFFICIAL = /(^|\.)(gov\.in|nic\.in|gov|gov\.uk|europa\.eu|int|un\.org|who\.int|rbi\.org\.in|sebi\.gov\.in|isro\.gov\.in|nasa\.gov|esa\.int|pib\.gov\.in)$/;
  // v28: an AI lab's own announcement is the primary source for what it released ("Primary source" in the app)
  const PRIMARY = /(^|\.)(openai\.com|deepmind\.google|blog\.google|huggingface\.co|blogs\.nvidia\.com)$/;
  const officialMark = list => (Array.isArray(list) ? list : []).map(x => { let h = ''; try { h = new URL(x.link).hostname.replace(/^www\./, ''); } catch (e) { h = ''; } return OFFICIAL.test(h) ? Object.assign({}, x, { official: true }) : PRIMARY.test(h) ? Object.assign({}, x, { primary: true }) : x; });
  const pub = r => ({ id: r.id, category: r.category, label: CAT_LABEL[r.category] || r.category, headline: r.headline, summary: r.summary, why: r.why, headline_hi: r.headline_hi, summary_hi: r.summary_hi, why_hi: r.why_hi, sources: officialMark((() => { try { return JSON.parse(r.sources || '[]'); } catch (e) { return []; } })()), image: imgFile(r.id) ? '/api/news/img/' + encodeURIComponent(r.id) : null, image_credit: creditOf(r), writer: r.writer, source_count: r.source_count, published_at: r.published_at, created_at: r.created_at, edition: r.edition || null, voice: global._newsVoice ? global._newsVoice.flags(r.id) : {} });

  // ── v16: the deck never ends. ?before=<cursor>&exclude=id,id… walks back through every story the desk still holds
  // (newest first, past the 2-day window), then through the cached headline feed (/api/news) in the same story shape.
  // A cursor is a published_at (ISO or ms; inclusive when exclude is sent) or the `next` this route returned:
  // '<ISO>~<id>' inside the desk, 'rss:<ms>~<id>' inside the feed. next is null when nothing older is left.
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  // v21: what this reader has seen (null for a visitor who is not signed in: the app keeps its own list)
  const SEEN_DAYS = 30, LIKE_DAYS = 14, LIKE = 0.45;
  const toksOf = st => new Set(tokens(String(st.headline || '') + ' ' + String(st.summary || '').slice(0, 140)));
  function seenOf(phone) {
    if (!phone) return null;
    let rows = []; try { rows = q("SELECT story_id, toks, seen_at > datetime('now', ?) AS near FROM news_seen WHERE user_phone=? AND seen_at > datetime('now', ?)").all('-' + LIKE_DAYS + ' days', phone, '-' + SEEN_DAYS + ' days'); } catch (e) { return null; }
    if (!rows.length) return null;
    const ids = new Set(), sigs = [];
    for (const r of rows) { ids.add(r.story_id); if (r.near && r.toks) { const w = new Set(String(r.toks).split(' ').filter(Boolean)); if (w.size >= 3) sigs.push(w); } }
    return { ids, sigs };
  }
  const fresh = (S, st) => { if (!S) return true; if (S.ids.has(st.id)) return false; if (!S.sigs.length) return true; const t = toksOf(st); return !S.sigs.some(w => jaccard(t, w) >= LIKE); };
  function cursor(v) {
    const s = String(v == null ? '' : v).trim(); if (!s) return null;
    let m = s.match(/^rss:(-?\d+)(?:~([A-Za-z0-9_-]{1,64}))?$/);
    if (m) return { feed: true, ts: +m[1], id: m[2] || '' };
    m = s.match(/^(.+?)(?:~([A-Za-z0-9_-]{1,64}))?$/);
    const t = /^\d+$/.test(m[1]) ? +m[1] : Date.parse(m[1]);
    return Number.isFinite(t) ? { feed: false, iso: new Date(t).toISOString(), id: m[2] || '' } : false;
  }
  // the legacy headline feed (server.js newsCache), mapped once per feed refresh or desk batch; a feed item that tells
  // a story the desk already wrote is left out, and stock filler photos are dropped so the card shows its category panel
  const feedMemo = {};
  function feedStories(cat) {
    let items = []; try { items = (deps.rssItems && deps.rssItems()) || []; } catch (e) { items = []; }
    const dk = q('SELECT COUNT(*) n, MAX(created_at) m FROM news_stories').get() || {};
    const k = cat || '*', key = [items.length, items[0] && items[0].link, items.length && items[items.length - 1].link, dk.n, dk.m].join('|');
    if (feedMemo[k] && feedMemo[k].key === key) return feedMemo[k].list;
    if (!items.length) return (feedMemo[k] = { key, list: [] }).list;
    let desk = []; try { desk = q('SELECT headline, summary FROM news_stories').all().map(r => new Set(tokens(r.headline + ' ' + String(r.summary || '').slice(0, 140)))); } catch (e) { /* ignore */ }
    const seen = new Set(), list = [];
    for (const it of items) {
      const title = strip(it && it.title), desc = strip(it && (it.desc || it.description));
      if (!title || !desc) continue;
      const category = CAT_LABEL[it.cat] ? it.cat : 'world';
      if (cat && category !== cat) continue;
      const id = 'rss-' + sha(String(it.link || title));
      if (seen.has(id)) continue; seen.add(id);
      const t = new Set(tokens(title + ' ' + desc.slice(0, 140)));
      if (desk.some(d => jaccard(t, d) >= 0.45)) continue;
      const ts = Date.parse(it.date || it.pubDate || '') || 0, when = ts ? new Date(ts).toISOString() : '';
      const source = String(it.source || (() => { try { return new URL(it.link).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })());
      const image = null; // v27: a feed item shows the app's colour card, never the publisher's photo
      list.push({ ts, id, story: { id, category, label: CAT_LABEL[category], headline: clip(title, 160), summary: desc, why: '', headline_hi: '', summary_hi: '', why_hi: '', sources: [{ name: source, link: it.link || '' }], image, writer: 'feed', source_count: 1, published_at: when, created_at: when, voice: {} } });
    }
    list.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    feedMemo[k] = { key, list };
    return list;
  }
  function feedPage(cat, cur, exSet, n, S) {
    const after = x => !cur ? true : cur.id ? (x.ts < cur.ts || (x.ts === cur.ts && x.id < cur.id)) : (exSet.size ? x.ts <= cur.ts : x.ts < cur.ts);
    const rest = feedStories(cat).filter(x => after(x) && !exSet.has(x.id) && fresh(S, x.story)), page = rest.slice(0, n), last = page[page.length - 1];
    return { stories: page.map(x => x.story), next: rest.length > n && last ? 'rss:' + last.ts + '~' + last.id : null };
  }
  // v22: one event once per page (stories written before v22 may tell it twice)
  const once = () => { const got = []; return r => { const g = sigOf(r.headline, r.summary); if (got.some(x => sameStory(g, x))) return false; got.push(g); return true; }; };
  function older(cat, cur, ex, exSet, lim, S, hi) {
    if (cur && cur.feed) return { stories: [], next: null }; // v22: no raw feed items in the deck
    const out = [], one = once(); let c = cur, last = null, ended = false;
    const chunk = S ? Math.max(lim * 3, 60) : lim;
    for (let guard = 0; guard < 25 && out.length < lim; guard++) {
      const w = [], a = [];
      if (cat) { w.push('category=?'); a.push(cat); }
      if (hi) w.push("headline_hi != '' AND summary_hi != ''");
      if (c && c.id) { w.push('(published_at < ? OR (published_at = ? AND id < ?))'); a.push(c.iso, c.iso, c.id); }
      else if (c) { w.push(ex.length ? 'published_at <= ?' : 'published_at < ?'); a.push(c.iso); }
      if (ex.length) { w.push('id NOT IN (' + ex.map(() => '?').join(',') + ')'); a.push(...ex); }
      const rows = q('SELECT * FROM news_stories' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY published_at DESC, id DESC LIMIT ?').all(...a, chunk);
      for (const r of rows) { last = r; if (fresh(S, r) && one(r)) { out.push(r); if (out.length >= lim) break; } }
      if (out.length >= lim) break;
      if (rows.length < chunk) { ended = true; break; }
      c = { feed: false, iso: last.published_at, id: last.id };
    }
    if (out.length >= lim || !ended) { const l = out.length >= lim ? out[out.length - 1] : last; return { stories: out.map(pub), next: l ? l.published_at + '~' + l.id : null }; }
    return { stories: out.map(pub), next: null }; // v22: the desk's own stories only; the deck ends here
  }
  app.get('/api/news/desk', (req, res) => {
    const cat = CAT_LABEL[String(req.query.cat || '').toLowerCase()] ? String(req.query.cat).toLowerCase() : '';
    const lim = Math.max(1, Math.min(60, parseInt(req.query.limit) || 40));
    const cur = cursor(req.query.before);
    res.set('Cache-Control', 'no-cache');
    if (cur === false) return res.status(400).json({ error: 'bad cursor', stories: [], next: null });
    const ex = String(req.query.exclude || '').split(',').map(s => s.trim()).filter(s => ID.test(s)).slice(0, 200), exSet = new Set(ex);
    let out;
    let S = null; try { const u = deps.userOf && deps.userOf(req); S = u ? seenOf(u.phone) : null; } catch (e) { S = null; }
    const hi = String(req.query.lang || '') === 'hi', HI = hi ? " AND headline_hi != '' AND summary_hi != ''" : '';
    try {
      if (!cur) { // the first page keeps today's ranking; next points at everything else, newest first
        const n0 = S ? 200 : lim;
        // v22: the newest edition first, ranked by how many outlets carry a story and how fresh it is
        const rows = (cat ? q("SELECT * FROM news_stories WHERE category=?" + HI + " ORDER BY COALESCE(edition,'') DESC, source_count DESC, published_at DESC LIMIT ?").all(cat, n0)
          : q("SELECT * FROM news_stories WHERE created_at > datetime('now','-2 days')" + HI + " ORDER BY COALESCE(edition,'') DESC, (source_count * 3 - (julianday('now') - julianday(published_at)) * 24 / 8) DESC LIMIT ?").all(n0)).filter(r => fresh(S, r)).filter(once()).slice(0, lim);
        if (rows.length) {
          const all = q('SELECT COUNT(*) n, MAX(published_at) m FROM news_stories WHERE 1=1' + (cat ? ' AND category=?' : '') + HI).get(...(cat ? [cat] : []));
          out = { stories: rows.map(pub), next: all.m && all.n > rows.length ? all.m : null };
        } else out = older(cat, null, ex, exSet, lim, S, hi); // nothing new today: start with the newest the desk has
      } else out = older(cat, cur, ex, exSet, lim, S, hi);
    } catch (e) { log('desk page', e.message); return res.status(500).json({ error: 'news desk unavailable', stories: [], next: null }); }
    res.json({ stories: out.stories, next: out.next, caughtUp: !out.stories.length && !out.next, edition: editionInfo(), updated_at: state.last && state.last.at, writer: state.writer || (writers()[0] || ['none'])[0], running: state.running });
  });
  // ── v21: seen memory, one story, sharing ──
  app.post('/api/news/seen', auth, (req, res) => {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).filter(x => ID.test(x)).slice(0, 200);
    if (!ids.length) return res.json({ ok: true, n: 0 });
    let feed = null; const feedOf = id => { if (!feed) { feed = new Map(); for (const x of feedStories('')) feed.set(x.id, x.story); } return feed.get(id); };
    const ins = q('INSERT INTO news_seen(user_phone, story_id, toks) VALUES(?,?,?) ON CONFLICT(user_phone, story_id) DO NOTHING');
    const one = q('SELECT headline, summary FROM news_stories WHERE id=?');
    let n = 0;
    try {
      db.transaction(() => { for (const id of ids) { const st = one.get(id) || feedOf(id) || sharedOf(id); n += ins.run(req.user.phone, id, st ? [...toksOf(st)].join(' ') : '').changes; } })();
      if (Math.random() < 0.02) q("DELETE FROM news_seen WHERE seen_at < datetime('now','-" + SEEN_DAYS + " days')").run();
    } catch (e) { log('seen', e.message); return res.status(500).json({ error: 'could not save' }); }
    res.json({ ok: true, n });
  });
  function sharedOf(id) {
    let r = null; try { r = q('SELECT story FROM news_shared WHERE id=?').get(id); } catch (e) { return null; }
    if (!r) return null;
    try { const st = JSON.parse(r.story); st.image = imgFile(id) && st.image_credit ? '/api/news/img/' + encodeURIComponent(id) : null; if (!st.image) st.image_credit = null; return st; } catch (e) { return null; }
  }
  function storyById(id) {
    if (!ID.test(id)) return null;
    const r = q('SELECT * FROM news_stories WHERE id=?').get(id); if (r) return pub(r);
    const sh = sharedOf(id); if (sh) return sh;
    const f = feedStories('').find(x => x.id === id); return f ? f.story : null;
  }
  app.get('/api/news/story/:id', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    const st = storyById(String(req.params.id || ''));
    if (!st) return res.status(404).json({ error: 'This story is no longer available' });
    res.json({ story: st });
  });
  const SITE = String(deps.publicUrl || 'https://brodoit.com').replace(/\/+$/, '');
  const hits = new Map();
  const limited = (req, n) => { const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), now = Date.now(), h = hits.get(ip); if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; } return ++h.n > n; };
  app.post('/api/news/share', (req, res) => {
    const id = String((req.body && req.body.id) || '');
    if (limited(req, 30)) return res.status(429).json({ error: 'slow down' });
    const st = storyById(id); if (!st) return res.status(404).json({ error: 'This story is no longer available' });
    const keep = Object.assign({}, st); delete keep.voice;
    try { q('INSERT INTO news_shared(id, story) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET story=excluded.story').run(id, JSON.stringify(keep)); } catch (e) { return res.status(500).json({ error: 'could not share' }); }
    if (!imgFile(id) && st.image_credit) { const r0 = q('SELECT image, category FROM news_stories WHERE id=?').get(id); if (r0 && /^pool:/.test(r0.image || '')) usePool(id, r0.category); else if (r0 && /^https:/.test(r0.image || '')) cacheImage(id, r0.image).catch(() => {}); }
    res.json({ ok: true, url: SITE + '/n/' + encodeURIComponent(id) });
  });

  // ── v21: the story's own page (what a shared link opens; link previews read its tags) ──
  const H = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT_COLOR = { india: '#B5402A', world: '#2F5FA8', ai: '#A21CAF', business: '#2F7D4F', tech: '#6D28D9', science: '#0E7C7B' };
  const host = l => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  function pageHTML(id, st) {
    const url = SITE + '/n/' + encodeURIComponent(id), app = '/?tab=news&s=' + encodeURIComponent(id);
    const img = st.image ? (/^\//.test(st.image) ? SITE + st.image : st.image) : SITE + '/n/' + encodeURIComponent(id) + '/card.png';
    const desc = clip(st.summary, 200), color = CAT_COLOR[st.category] || '#37352F';
    const when = Date.parse(st.published_at || '') ? new Date(st.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
    const srcs = (st.sources || []).filter(x => x && /^https?:\/\//.test(x.link || '')).slice(0, 6);
    const paras = String(st.summary || '').split(/\n+/).filter(Boolean).map(p => '<p>' + H(p) + '</p>').join('');
    const hiPart = st.headline_hi && st.summary_hi ? `<details class="hi"><summary>हिंदी में पढ़ें</summary><h2 lang="hi">${H(st.headline_hi)}</h2><p lang="hi">${H(st.summary_hi)}</p></details>` : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${H(st.headline)} · Brodoit News</title><meta name="description" content="${H(desc)}"><link rel="canonical" href="${H(url)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Brodoit"><meta property="og:title" content="${H(st.headline)}"><meta property="og:description" content="${H(desc)}"><meta property="og:url" content="${H(url)}"><meta property="og:image" content="${H(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${H(st.headline)}"><meta name="twitter:description" content="${H(desc)}"><meta name="twitter:image" content="${H(img)}">
<meta name="theme-color" content="#FBF8F3"><link rel="icon" href="/icon-192.png"><link rel="stylesheet" href="/app/fonts/fonts.css">
<style>:root{--bg:#FBF8F3;--card:#fff;--ink:#17141F;--mute:#6B6875;--line:#E9E3D9;--c:${color};--f:'Plus Jakarta Sans',system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141217;--card:#1E1B22;--ink:#F3F0EA;--mute:#A7A2AE;--line:#2D2933}.k b{color:color-mix(in srgb,var(--c) 55%,#fff)!important}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.6 var(--f)}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;max-width:720px;margin:0 auto}
.brand{font:800 22px/1 Georgia,serif;color:var(--ink);text-decoration:none}.brand i{font-style:normal;color:#E0603F}
.open{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:var(--ink);color:var(--bg);font:700 14px/1 var(--f);text-decoration:none}
main{max-width:720px;margin:0 auto;padding:0 16px 40px}.ph{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:20px;background:var(--c);display:block}
.k{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0 6px;font:700 13px/1.2 var(--f);color:var(--mute)}.k b{color:var(--c);text-transform:uppercase;letter-spacing:.06em}
h1{font:700 30px/1.2 var(--f);letter-spacing:-.02em;margin:4px 0 14px}h2{font:700 22px/1.3 var(--f)}p{margin:0 0 14px}
.why{border-left:4px solid var(--c);padding:6px 0 6px 14px;color:var(--mute);margin:18px 0}
.src{margin:22px 0;padding:16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}.src b{display:block;margin-bottom:6px}.src a{color:var(--ink);word-break:break-word}
.hi{margin:18px 0}.hi summary{cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center}
.cta{display:flex;flex-direction:column;gap:10px;align-items:stretch;margin-top:26px;padding:20px;border-radius:20px;background:var(--card);border:1px solid var(--line);text-align:center}
.cta .open{justify-content:center;min-height:50px;font-size:16px}.cta small{color:var(--mute)}</style></head>
<body><header class="top"><a class="brand" href="/">Bro<i>doit</i></a><a class="open" href="${H(app)}">Open in Brodoit</a></header>
<main><article>${st.image ? `<img class="ph" src="${H(st.image)}" alt="">${st.image_credit ? `<p style="margin:6px 0 0;font-size:12px;color:#77706a">Photo: <a href="${H(st.image_credit.page)}" rel="noopener nofollow" target="_blank" style="color:inherit">${H(st.image_credit.by)}</a> · ${H(st.image_credit.license)} · ${H(st.image_credit.source || 'Wikimedia Commons')}</p>` : ''}` : ''}
<div class="k">${st.label ? `<b>${H(st.label)}</b>` : ''}${when ? `<span>${H(when)}</span>` : ''}</div>
<h1>${H(st.headline)}</h1>${paras}${st.why ? `<p class="why">${H(st.why)}</p>` : ''}${hiPart}
${srcs.length ? `<div class="src"><b>Sources</b>${srcs.map(x => `<div><a href="${H(x.link)}" rel="noopener nofollow" target="_blank">${H(x.name || host(x.link))}</a>${x.official ? ' <small>· Official source</small>' : ''}</div>`).join('')}</div>` : ''}
</article><div class="cta"><b>More stories like this, every 30 minutes</b><a class="open" href="${H(app)}">Open in Brodoit</a><small>Free · News, tasks, steps and Bro, your coach</small></div></main></body></html>`;
  }
  app.get('/n/:id', (req, res) => {
    const id = String(req.params.id || '');
    res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' });
    let signedIn = false; try { signedIn = !!(deps.userOf && deps.userOf(req)); } catch (e) { signedIn = false; }
    if (signedIn && ID.test(id)) return res.redirect(302, '/?tab=news&s=' + encodeURIComponent(id));
    const st = storyById(id);
    if (!st) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brodoit News</title><body style="font:16px/1.5 system-ui;padding:32px;max-width:560px;margin:auto"><h1>This story is no longer available</h1><p>Fresh stories arrive every 30 minutes.</p><p><a href="/?tab=news">Open Brodoit News</a></p>');
    try { q('UPDATE news_shared SET opens=opens+1 WHERE id=?').run(id); } catch (e) { /* ignore */ }
    res.type('html').send(pageHTML(id, st));
  });
  // the link-preview picture for a story without a photo: its headline on its category's colour
  const cards = new Map();
  function cardSvg(st) {
    const words = String(st.headline || '').split(/\s+/).filter(Boolean);
    let size = 64, per = 30, lines = [];
    for (const [sz, n] of [[64, 30], [56, 34], [48, 40]]) {
      lines = []; let l = '';
      for (const w of words) { if ((l + ' ' + w).trim().length > n && l) { lines.push(l); l = w; } else l = (l + ' ' + w).trim(); }
      if (l) lines.push(l);
      size = sz; per = n; if (lines.length <= 5) break;
    }
    if (lines.length > 5) { lines = lines.slice(0, 5); lines[4] = lines[4].replace(/\s*\S*$/, '') + '…'; }
    const c = CAT_COLOR[st.category] || '#37352F', top = 315 - (lines.length * size * 1.18) / 2 + size * 0.4;
    const X = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#17141F"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><text x="64" y="86" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="700" fill="#ffffff" fill-opacity=".85" letter-spacing="3">BRODOIT NEWS${st.label ? ' · ' + X(String(st.label).toUpperCase()) : ''}</text>
${lines.map((l, i) => `<text x="64" y="${Math.round(top + i * size * 1.18)}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="700" fill="#ffffff">${X(l)}</text>`).join('')}
<text x="64" y="580" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="700" fill="#ffffff">Bro<tspan fill="#F08A6C">doit</tspan><tspan fill="#ffffff" fill-opacity=".7" font-weight="400">  ·  brodoit.com</tspan></text></svg>`;
  }
  app.get('/n/:id/card.png', (req, res) => {
    const id = String(req.params.id || ''); const st = storyById(id);
    if (!st) return res.status(404).end();
    let png = cards.get(id);
    if (!png) {
      try { const { Resvg } = require('@resvg/resvg-js'); png = new Resvg(cardSvg(st), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng(); }
      catch (e) { log('card', e.message); return res.redirect(302, '/icon-512.png'); }
      cards.set(id, png); if (cards.size > 60) cards.delete(cards.keys().next().value);
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(png);
  });
  app.post('/api/news/desk/run', auth, async (req, res) => {
    let ok = false; try { ok = !!(isAdminUser && isAdminUser(req.user)); } catch (e) {}
    if (!ok) return res.status(403).json({ error: 'admin only' });
    res.json(await run('admin', editionOf(nowOf(), SLOTS)));
  });
  // v22: the latest edition (the app shows a dot on News when there is one you have not opened)
  app.get('/api/news/edition', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json(editionInfo()); });
  global._deskStatus = () => ({ last: state.last, running: state.running, error: state.lastError, writer: state.writer, photos: Object.assign({}, photoState), pool: Object.assign({ sizes: Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, (v || []).length])) }, poolState) });
  // v28: the same photo finder for today's thought and readers' pieces (modules/newsthought.js, modules/newsreaders.js)
  global._newsPhotos = { into: photoInto, file: imgFile, url: id => '/api/news/img/' + encodeURIComponent(id) };
  if (String(process.env.NEWS_DESK || '1') !== '0' && deps.timer !== false) {
    // v27.1: the photo pass on its own: 90 s after boot (every recent story), then hourly (a few, while no edition runs)
    const pass = n => { if (!state.running) photoPass(n, 1500).catch(() => {}); };
    // v28: the section pools first (found once, kept on the volume), then every recent story without a photo
    const pt = setTimeout(() => { buildPool(1200).catch(() => {}).then(() => pass(120)); }, 20000); if (pt.unref) pt.unref();
    const pd = setInterval(() => buildPool(3000).catch(() => {}), 24 * 3600e3); if (pd.unref) pd.unref();
    const pv = setInterval(() => pass(20), 3600e3); if (pv.unref) pv.unref();
    // v22: three editions a day; the minute tick makes the current one if it is not there yet (so a deploy at 14:10
    // still gets the 13:00 edition)
    setTimeout(() => { try { const p = tick(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }, 120000);
    const iv = setInterval(() => { try { const p = tick(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }, 60000); if (iv.unref) iv.unref();
  }
  log('ready · editions at', SLOTS.map(m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')).join(', '), 'India time · writer', (writers()[0] || ['none'])[0]);
  return { run, tick, cluster, editionInfo, photoPass, buildPool, poolPick, photoInto, status: () => global._deskStatus() };
}

module.exports = { sameStory, sigOf, install, cluster, tokens, checkStory, editionOf, parseSlots, hasDeva, isHindiText, isEnglishText };
