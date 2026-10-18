// Brodoit News Desk — Brodoit's own news, written in batches.
// Every run: pull every feed (all categories), merge stories that several outlets are covering into one cluster,
// rank clusters by how many independent sources carry them and how fresh they are, then have the brain
// (OpenAI → Gemini → Groq; extractive fallback without a key) write ONE original Brodoit story per cluster:
// a headline, a 60-word summary, "why it matters", in English and Hindi, with the sources listed.
// Rules for the writer: only facts present in the sources; no opinions; neutral, simple words.
//   GET  /api/news/desk?cat=&limit=   → { stories:[…], updated_at, writer }
//   POST /api/news/desk/run (admin)   → runs a batch now
// Batches run on boot (+2 min) and every 30 minutes; stories older than 3 days drop off.
'use strict';
const GEM = require('./gemini.js');
const crypto = require('crypto');

const STOP = new Set('a an the of to in on for and or but with at by from as is are was were be been it its this that these those after before over under into about than then new says said say will would can could may might not no yes up down out more most what why how who when where which while amid amid as india india’s'.split(/\s+/));
const CAT_LABEL = { india: 'India', world: 'World', business: 'Business', tech: 'Tech', science: 'Science' };

function tokens(s) {
  return String(s || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}
function jaccard(a, b) { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); }
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const words = (s, n) => { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' '); return w.length > n ? w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…' : w.join(' '); };
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/\s+/g, ' ').trim();

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
  const SYS = 'You are the editor of Brodoit News, an Indian news app for young readers. Write ONE original news story from the source reports provided. Rules: use only facts that appear in the sources; never invent numbers, names or quotes; neutral tone; simple words a 15-year-old understands; no clickbait. Return strict JSON with keys: headline (max 12 words), summary (55-65 words, one paragraph), why (one sentence, max 22 words, why it matters to an Indian reader), headline_hi, summary_hi, why_hi (natural Hindi, not word-for-word), category (one of india, world, business, tech, science).';
  function promptFor(c) {
    const lines = c.items.slice(0, 6).map((i, n) => `Source ${n + 1} (${i.source}): ${i.title}. ${clip(i.desc, 420)}`);
    return lines.join('\n');
  }
  async function viaOpenAI(key, text) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ model: getSetting('OPENAI_CHAT_MODEL') || 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'openai ' + r.status);
    return JSON.parse(j.choices[0].message.content);
  }
  async function viaGemini(key, text) {
    // the lite tier: a story is short structured writing, and the desk runs every 30 minutes
    const { json: j } = await GEM.generate(key, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }, { tier: 'lite', getSetting, timeout: 40000 });
    return JSON.parse(GEM.textOf(j));
  }
  async function viaGroq(key, text) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] }) });
    const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'groq ' + r.status);
    return JSON.parse(j.choices[0].message.content);
  }
  function writers() {
    const w = [];
    const o = getSetting('OPENAI_API_KEY'); if (o) w.push(['openai', t => viaOpenAI(o, t)]);
    const g = getSetting('GEMINI_API_KEY'); if (g) w.push(['gemini', t => viaGemini(g, t)]);
    const r = getSetting('GROQ_API_KEY'); if (r) w.push(['groq', t => viaGroq(r, t)]);
    return w;
  }
  function extractive(c) {
    const lead = c.items.slice().sort((a, b) => (b.desc || '').length - (a.desc || '').length)[0];
    return { headline: clip(c.items[0].title, 110), summary: words(lead.desc || lead.title, 60), why: '', headline_hi: '', summary_hi: '', why_hi: '', category: c.cat };
  }
  const valid = s => s && typeof s.headline === 'string' && s.headline.length > 8 && typeof s.summary === 'string' && s.summary.split(/\s+/).length >= 25;

  async function run(reason) {
    if (state.running) return { busy: true };
    state.running = true; const t0 = Date.now(); let wrote = 0, skipped = 0;
    try {
      const items = await gather();
      const clusters = cluster(items).filter(c => c.items.length >= 1).slice(0, 40);
      const have = new Set(q('SELECT cluster_key FROM news_stories WHERE created_at > datetime(\'now\',\'-3 days\')').all().map(r => r.cluster_key));
      const ws = writers(); state.writer = ws.length ? ws[0][0] : 'extractive';
      for (const c of clusters) {
        if (wrote >= 24) break;
        if (have.has(c.key)) { skipped++; continue; }
        let s = null, by = 'extractive';
        for (const [name, fn] of ws) { try { const out = await fn(promptFor(c)); if (valid(out)) { s = out; by = name; break; } } catch (e) { state.lastError = name + ': ' + e.message; } }
        if (!s) { if (c.sources < 2 && ws.length) continue; s = extractive(c); }
        const sources = []; const seen = new Set();
        for (const i of c.items) { if (seen.has(i.source)) continue; seen.add(i.source); sources.push({ name: i.source, link: i.link, title: i.title }); }
        const image = (c.items.find(i => i.img) || {}).img || null;
        const cat = CAT_LABEL[s.category] ? s.category : c.cat;
        try {
          q('INSERT OR IGNORE INTO news_stories(id,cluster_key,category,headline,summary,why,headline_hi,summary_hi,why_hi,sources,image,writer,source_count,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run('ns_' + c.key, c.key, cat, clip(s.headline, 140), words(s.summary, 75), clip(s.why || '', 200), clip(s.headline_hi || '', 160), words(s.summary_hi || '', 90), clip(s.why_hi || '', 220), JSON.stringify(sources.slice(0, 6)), image, by, sources.length, new Date(c.newest || Date.now()).toISOString());
          wrote++;
        } catch (e) { state.lastError = 'db: ' + e.message; }
      }
      q("DELETE FROM news_stories WHERE created_at < datetime('now','-4 days')").run();
      state.last = { at: new Date().toISOString(), reason, items: items.length, clusters: clusters.length, wrote, skipped, ms: Date.now() - t0, writer: state.writer };
      log('batch', JSON.stringify(state.last));
      return state.last;
    } catch (e) { state.lastError = e.message; log('batch failed', e.message); return { error: e.message }; }
    finally { state.running = false; }
  }

  const pub = r => ({ id: r.id, category: r.category, label: CAT_LABEL[r.category] || r.category, headline: r.headline, summary: r.summary, why: r.why, headline_hi: r.headline_hi, summary_hi: r.summary_hi, why_hi: r.why_hi, sources: (() => { try { return JSON.parse(r.sources || '[]'); } catch (e) { return []; } })(), image: r.image, writer: r.writer, source_count: r.source_count, published_at: r.published_at, created_at: r.created_at });
  app.get('/api/news/desk', (req, res) => {
    const cat = String(req.query.cat || '').toLowerCase(); const lim = Math.max(1, Math.min(60, parseInt(req.query.limit) || 40));
    const rows = CAT_LABEL[cat] ? q('SELECT * FROM news_stories WHERE category=? ORDER BY source_count DESC, published_at DESC LIMIT ?').all(cat, lim)
      : q("SELECT * FROM news_stories WHERE created_at > datetime('now','-2 days') ORDER BY (source_count * 3 - (julianday('now') - julianday(published_at)) * 24 / 8) DESC LIMIT ?").all(lim);
    res.set('Cache-Control', 'no-cache');
    res.json({ stories: rows.map(pub), updated_at: state.last && state.last.at, writer: state.writer || (writers()[0] || ['extractive'])[0], running: state.running });
  });
  app.post('/api/news/desk/run', auth, async (req, res) => {
    let ok = false; try { ok = !!(isAdminUser && isAdminUser(req.user)); } catch (e) {}
    if (!ok) return res.status(403).json({ error: 'admin only' });
    res.json(await run('admin'));
  });
  global._deskStatus = () => ({ last: state.last, running: state.running, error: state.lastError, writer: state.writer });
  if (String(process.env.NEWS_DESK || '1') !== '0') {
    setTimeout(() => run('boot').catch(() => {}), 120000);
    setInterval(() => run('schedule').catch(() => {}), 30 * 60 * 1000);
  }
  log('ready · batches every 30 min · writer', (writers()[0] || ['extractive'])[0]);
  return { run, cluster, status: () => global._deskStatus() };
}

module.exports = { install, cluster, tokens };
