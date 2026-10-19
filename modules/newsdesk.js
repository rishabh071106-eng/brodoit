// Brodoit News Desk — Brodoit's own news, written in batches.
// Every run: pull every feed (all categories), merge stories that several outlets are covering into one cluster,
// rank clusters by how many independent sources carry them and how fresh they are, then have the brain
// (OpenAI → Gemini → Groq; extractive fallback without a key) write ONE original Brodoit story per cluster:
// a headline and a full 90–105 word story (10+ lines on a phone), in English and Hindi, with the sources listed.
// v13.1: near-duplicates of recent stories are skipped, and each story's real photo (RSS image or the source page's
// og:image) is cached once in MEDIA_DIR/news-img and served same-origin (/api/news/img/:id) so Share can draw it.
// Rules for the writer: only facts present in the sources; no opinions; neutral, simple words.
//   GET  /api/news/desk?cat=&limit=   → { stories:[…], next, updated_at, writer }
//   GET  /api/news/desk?before=<next>&exclude=id,id&limit=  → the page older than that (v16 endless deck)
//   POST /api/news/desk/run (admin)   → runs a batch now
// Batches run on boot (+2 min) and every 30 minutes; stories older than 3 days drop off.
'use strict';
const GEM = require('./gemini.js');
const crypto = require('crypto');
const fs = require('fs'), path = require('path');

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
  const SYS = 'You are the editor of Brodoit News, an Indian news app. Write ONE original news story from the source reports provided. Rules: use only facts that appear in the sources; never invent numbers, names or quotes; neutral tone; clear, simple words; no clickbait. The story must be complete on its own: what happened, who is involved, the key numbers and why it matters, woven into the text. Return strict JSON with keys: headline (max 12 words), summary (the full story, 90-105 words, one paragraph), headline_hi, summary_hi (natural Hindi, same facts, 90-110 words, not word-for-word), category (one of india, world, business, tech, science).';
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
    // v16: Bro Core (open models on Groq) writes the news; the writers after it run only while its emergency switch is on
    const w = [], BC = global._broCore;
    if (BC && BC.brainReady()) w.push(['brocore', t => BC.chat({ system: SYS, messages: [{ role: 'user', content: t }], json: true, maxTokens: 2000, temperature: 0.3, purpose: 'news', emergency: false }).then(r => JSON.parse(r.text))]);
    if (BC && !BC.emergencyOn()) return w;
    const o = getSetting('OPENAI_API_KEY'); if (o) w.push(['openai', t => viaOpenAI(o, t)]);
    const g = getSetting('GEMINI_API_KEY'); if (g) w.push(['gemini', t => viaGemini(g, t)]);
    const r = getSetting('GROQ_API_KEY'); if (r) w.push(['groq', t => viaGroq(r, t)]);
    const B = global._elevenBrain; if (B && B.available()) w.push(['elevenlabs', t => viaEleven(B, t)]);
    // Gemini out of prepaid credit: skip it for an hour so each story does not wait on a failing call
    return w.filter(x => !(x[0] === 'gemini' && (global._geminiDownUntil || 0) > Date.now()));
  }
  async function viaEleven(B, text) {
    const out = await B.ask({ system: SYS + ' Reply with the JSON object only, no other text.', messages: [{ role: 'user', content: text }], timeout: 40000 });
    const m = String(out).match(/\{[\s\S]*\}/); if (!m) throw new Error('no JSON in reply');
    return JSON.parse(m[0]);
  }
  // Without a writer: stitch the sources' own sentences (no repeats) into one story of 110+ words when possible.
  function extractive(c) {
    const seen = new Set(), out = [];
    for (const it of c.items.slice().sort((a, b) => (b.desc || '').length - (a.desc || '').length)) {
      for (const sent of String(it.desc || '').split(/(?<=[.!?])\s+/)) {
        const k = sent.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
        if (sent.split(' ').length < 6 || seen.has(k)) continue;
        seen.add(k); out.push(sent.trim());
        if (out.join(' ').split(' ').length >= 100) break;
      }
      if (out.join(' ').split(' ').length >= 100) break;
    }
    return { headline: clip(c.items[0].title, 110), summary: words(out.join(' '), 115), why: '', headline_hi: '', summary_hi: '', why_hi: '', category: c.cat };
  }
  const wc = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const valid = s => s && typeof s.headline === 'string' && s.headline.length > 8 && typeof s.summary === 'string' && wc(s.summary) >= 75;
  const MIN_WORDS = 70;

  // ── real photos: the RSS image, else the source page's og:image; cached once and served same-origin ──
  const IMG = deps.mediaDir ? path.join(deps.mediaDir, 'news-img') : '';
  if (IMG) { try { fs.mkdirSync(IMG, { recursive: true }); } catch (e) { /* read-only */ } }
  const imgFile = id => { if (!IMG) return ''; for (const x of ['jpg', 'png', 'webp']) { const f = path.join(IMG, id + '.' + x); if (fs.existsSync(f)) return f; } return ''; };
  // only public http(s) hosts: page and photo URLs come from outside, so never touch localhost or private ranges
  const publicUrl = u => { try { const x = new URL(u), h = x.hostname.toLowerCase(); return /^https?:$/.test(x.protocol) && !h.startsWith('[') && /[a-z]/.test(h) && h !== 'localhost' && !/\.(local|internal|localhost)$/.test(h); } catch (e) { return false; } };
  async function ogImage(link) {
    if (!publicUrl(link)) return '';
    try {
      const r = await fetch(link, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) BrodoitNews/1.0', Accept: 'text/html' } });
      if (!r.ok) return '';
      const html = (await r.text()).slice(0, 300000);
      const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
      return m ? new URL(m[1].replace(/&amp;/g, '&'), link).href : '';
    } catch (e) { return ''; }
  }
  async function cacheImage(id, url) {
    if (!IMG || !url || imgFile(id)) return !!imgFile(id);
    if (!publicUrl(url)) return false;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 BrodoitNews/1.0' } });
      const type = String(r.headers.get('content-type') || '');
      if (!r.ok || !/^image\/(jpeg|jpg|png|webp)/.test(type)) return false;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 4000 || buf.length > 3e6) return false; // tiny = a logo/pixel, huge = not worth it
      const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
      const f = path.join(IMG, id + '.' + ext), tmp = f + '.tmp';
      fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
      return true;
    } catch (e) { return false; }
  }
  async function photoFor(id, image, sources) {
    if (imgFile(id)) return true;
    if (image && await cacheImage(id, image)) return true;
    for (const src of (sources || []).slice(0, 3)) { const og = await ogImage(src.link); if (og && await cacheImage(id, og)) { try { q('UPDATE news_stories SET image=? WHERE id=?').run(og, id); } catch (e) { /* ignore */ } return true; } }
    return false;
  }
  app.get('/api/news/img/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    const f = id && imgFile(id); if (!f) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800, immutable'); res.sendFile(f);
  });
  // One-time cleanup: short stories from before v13.1 are rewritten as full stories by the next batch.
  try { const short = q('SELECT id, summary FROM news_stories').all().filter(r => wc(r.summary) < MIN_WORDS).map(r => r.id); if (short.length) { const del = q('DELETE FROM news_stories WHERE id=?'); for (const id of short) del.run(id); log('removed', short.length, 'short stories; the next batch writes them in full'); } } catch (e) { log('cleanup', e.message); }

  async function run(reason) {
    if (state.running) return { busy: true };
    state.running = true; const t0 = Date.now(); let wrote = 0, skipped = 0;
    try {
      const items = await gather();
      const clusters = cluster(items).filter(c => c.items.length >= 1).slice(0, 40);
      const have = new Set(q('SELECT cluster_key FROM news_stories WHERE created_at > datetime(\'now\',\'-3 days\')').all().map(r => r.cluster_key));
      // no repeats: a cluster that tells the same story as one we already published is skipped
      const recent = q("SELECT headline, summary FROM news_stories WHERE created_at > datetime('now','-3 days')").all().map(r => new Set(tokens(r.headline + ' ' + String(r.summary || '').slice(0, 140))));
      const repeat = c => { const t = new Set(tokens(c.items[0].title + ' ' + (c.items[0].desc || '').slice(0, 140))); return recent.some(r => jaccard(t, r) >= 0.45); };
      const ws = writers(); state.writer = ws.length ? ws[0][0] : 'extractive';
      for (const c of clusters) {
        if (wrote >= 24) break;
        if (have.has(c.key) || repeat(c)) { skipped++; continue; }
        let s = null, by = 'extractive';
        for (const [name, fn] of ws) { try { const out = await fn(promptFor(c)); if (valid(out)) { s = out; by = name; break; } } catch (e) { state.lastError = name + ': ' + e.message; if (name === 'gemini' && /402|credit|prepay|billing/i.test(e.message)) global._geminiDownUntil = Date.now() + 3600e3; } }
        if (!s) { if (c.sources < 2 && ws.length) continue; s = extractive(c); }
        if (wc(s.summary) < MIN_WORDS) { skipped++; continue; } // too thin to be a full story
        const sources = []; const seen = new Set();
        for (const i of c.items) { if (seen.has(i.source)) continue; seen.add(i.source); sources.push({ name: i.source, link: i.link, title: i.title }); }
        const image = (c.items.find(i => i.img) || {}).img || null;
        const cat = CAT_LABEL[s.category] ? s.category : c.cat;
        try {
          q('INSERT OR IGNORE INTO news_stories(id,cluster_key,category,headline,summary,why,headline_hi,summary_hi,why_hi,sources,image,writer,source_count,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run('ns_' + c.key, c.key, cat, clip(s.headline, 140), words(s.summary, 120), clip(s.why || '', 200), clip(s.headline_hi || '', 160), words(s.summary_hi || '', 140), clip(s.why_hi || '', 220), JSON.stringify(sources.slice(0, 6)), image, by, sources.length, new Date(c.newest || Date.now()).toISOString());
          wrote++;
          recent.push(new Set(tokens(s.headline + ' ' + String(s.summary).slice(0, 140))));
          await photoFor('ns_' + c.key, image, sources);
        } catch (e) { state.lastError = 'db: ' + e.message; }
      }
      q("DELETE FROM news_stories WHERE created_at < datetime('now','-4 days')").run();
      for (const r of q("SELECT id, image, sources FROM news_stories WHERE created_at > datetime('now','-2 days') ORDER BY created_at DESC LIMIT 40").all().filter(r => !imgFile(r.id)).slice(0, 12)) { let src = []; try { src = JSON.parse(r.sources || '[]'); } catch (e) { /* ignore */ } await photoFor(r.id, r.image, src); }
      try { for (const f of fs.readdirSync(IMG)) { const id = f.replace(/\.(jpg|png|webp)$/, ''); if (!q('SELECT 1 FROM news_stories WHERE id=?').get(id)) fs.unlinkSync(path.join(IMG, f)); } } catch (e) { /* ignore */ }
      state.last = { at: new Date().toISOString(), reason, items: items.length, clusters: clusters.length, wrote, skipped, ms: Date.now() - t0, writer: state.writer };
      log('batch', JSON.stringify(state.last));
      // record the new headlines and top stories right away (modules/newsvoice.js)
      if (wrote && global._newsVoice) setTimeout(() => global._newsVoice.run('desk batch').catch(() => {}), 3000);
      return state.last;
    } catch (e) { state.lastError = e.message; log('batch failed', e.message); return { error: e.message }; }
    finally { state.running = false; }
  }

  const pub = r => ({ id: r.id, category: r.category, label: CAT_LABEL[r.category] || r.category, headline: r.headline, summary: r.summary, why: r.why, headline_hi: r.headline_hi, summary_hi: r.summary_hi, why_hi: r.why_hi, sources: (() => { try { return JSON.parse(r.sources || '[]'); } catch (e) { return []; } })(), image: imgFile(r.id) ? '/api/news/img/' + encodeURIComponent(r.id) : r.image, writer: r.writer, source_count: r.source_count, published_at: r.published_at, created_at: r.created_at, voice: global._newsVoice ? global._newsVoice.flags(r.id) : {} });

  // ── v16: the deck never ends. ?before=<cursor>&exclude=id,id… walks back through every story the desk still holds
  // (newest first, past the 2-day window), then through the cached headline feed (/api/news) in the same story shape.
  // A cursor is a published_at (ISO or ms; inclusive when exclude is sent) or the `next` this route returned:
  // '<ISO>~<id>' inside the desk, 'rss:<ms>~<id>' inside the feed. next is null when nothing older is left.
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
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
      const image = it.img && !/unsplash\.com/i.test(it.img) && publicUrl(it.img) ? it.img : null;
      list.push({ ts, id, story: { id, category, label: CAT_LABEL[category], headline: clip(title, 160), summary: desc, why: '', headline_hi: '', summary_hi: '', why_hi: '', sources: [{ name: source, link: it.link || '' }], image, writer: 'feed', source_count: 1, published_at: when, created_at: when, voice: {} } });
    }
    list.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    feedMemo[k] = { key, list };
    return list;
  }
  function feedPage(cat, cur, exSet, n) {
    const after = x => !cur ? true : cur.id ? (x.ts < cur.ts || (x.ts === cur.ts && x.id < cur.id)) : (exSet.size ? x.ts <= cur.ts : x.ts < cur.ts);
    const rest = feedStories(cat).filter(x => after(x) && !exSet.has(x.id)), page = rest.slice(0, n), last = page[page.length - 1];
    return { stories: page.map(x => x.story), next: rest.length > n && last ? 'rss:' + last.ts + '~' + last.id : null };
  }
  function older(cat, cur, ex, exSet, lim) {
    if (cur && cur.feed) return feedPage(cat, cur, exSet, lim);
    const w = [], a = [];
    if (cat) { w.push('category=?'); a.push(cat); }
    if (cur && cur.id) { w.push('(published_at < ? OR (published_at = ? AND id < ?))'); a.push(cur.iso, cur.iso, cur.id); }
    else if (cur) { w.push(ex.length ? 'published_at <= ?' : 'published_at < ?'); a.push(cur.iso); }
    if (ex.length) { w.push('id NOT IN (' + ex.map(() => '?').join(',') + ')'); a.push(...ex); }
    const rows = q('SELECT * FROM news_stories' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY published_at DESC, id DESC LIMIT ?').all(...a, lim);
    const last = rows[rows.length - 1];
    if (rows.length === lim) return { stories: rows.map(pub), next: last.published_at + '~' + last.id };
    const fill = feedPage(cat, null, exSet, lim - rows.length); // the desk has nothing older: the feed carries on
    return { stories: rows.map(pub).concat(fill.stories), next: fill.next };
  }
  app.get('/api/news/desk', (req, res) => {
    const cat = CAT_LABEL[String(req.query.cat || '').toLowerCase()] ? String(req.query.cat).toLowerCase() : '';
    const lim = Math.max(1, Math.min(60, parseInt(req.query.limit) || 40));
    const cur = cursor(req.query.before);
    res.set('Cache-Control', 'no-cache');
    if (cur === false) return res.status(400).json({ error: 'bad cursor', stories: [], next: null });
    const ex = String(req.query.exclude || '').split(',').map(s => s.trim()).filter(s => ID.test(s)).slice(0, 200), exSet = new Set(ex);
    let out;
    try {
      if (!cur) { // the first page keeps today's ranking; next points at everything else, newest first
        const rows = cat ? q('SELECT * FROM news_stories WHERE category=? ORDER BY source_count DESC, published_at DESC LIMIT ?').all(cat, lim)
          : q("SELECT * FROM news_stories WHERE created_at > datetime('now','-2 days') ORDER BY (source_count * 3 - (julianday('now') - julianday(published_at)) * 24 / 8) DESC LIMIT ?").all(lim);
        if (rows.length) {
          const all = q('SELECT COUNT(*) n, MAX(published_at) m FROM news_stories' + (cat ? ' WHERE category=?' : '')).get(...(cat ? [cat] : []));
          out = { stories: rows.map(pub), next: all.m && (all.n > rows.length || feedStories(cat).length) ? all.m : null };
        } else out = older(cat, null, ex, exSet, lim); // nothing new today: start with the newest the desk (or the feed) has
      } else out = older(cat, cur, ex, exSet, lim);
    } catch (e) { log('desk page', e.message); return res.status(500).json({ error: 'news desk unavailable', stories: [], next: null }); }
    res.json({ stories: out.stories, next: out.next, updated_at: state.last && state.last.at, writer: state.writer || (writers()[0] || ['extractive'])[0], running: state.running });
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
