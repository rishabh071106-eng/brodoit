// Bro Core · knowledge. What Bro knows about the world today, refreshed every few hours (no API key needed):
//   • Brodoit News stories (news_stories: headline + story, English and Hindi)
//   • the legacy headline feed (server.js RSS cache, through deps.newsItems)
//   • Wikipedia "Current events" for the last 3 days, stripped to one line per bullet
// Kept 30 days in bro_knowledge (+ bro_knowledge_fts). search() ranks by bm25 with a recency boost.
// lookup() asks Wikipedia (search + page summary, Hindi Wikipedia first for Hindi questions) within 6 seconds.
'use strict';
const crypto = require('crypto');

const UA = 'Brodoit-Bro/1.0 (https://brodoit.com)';
const KEEP_DAYS = 30;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const STOP = new Set('a an the of to in on at for and or but with is am are was were be been it its this that these those what which who whom when where why how do does did tell me about please news latest today current any some there here i you we they he she my your our their can could would should will kya hai hain ka ki ke ko se me mein aur kaun kab kahan kyun batao bata'.split(' '));
const words = q => String(q || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w && (w.length > 2 || /\d/.test(w) || /[ऀ-ॿ]/.test(w)) && !STOP.has(w));
const ftsQuery = q => words(q).slice(0, 12).map(w => '"' + w + '"' + (w.length > 4 && /^[a-z]+$/.test(w) ? '*' : '')).join(' OR ');
const isoDay = d => d.toISOString().slice(0, 10);

function decode(s) {
  return String(s || '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } }).replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return ''; } });
}
// Wikipedia Current-events HTML → [{ category, topic, text }]: one entry per leaf bullet, its parent bullets as context.
// Categories come from <p><b>Armed conflicts and attacks</b></p> or <div role="heading">…</div>; quoted attributes may hold '>'.
function ceBullets(html) {
  html = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|sup|noscript)\b[\s\S]*?<\/\1>/gi, '');
  const out = [], stack = [], divs = []; let category = '', pText = null, pBold = 0, pAll = 0, inB = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g; let m;
  const clean = s => decode(s).replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').trim();
  const endHeading = () => { if (pText == null) return; const t = clean(pText); if (t && t.length < 70 && pBold >= pAll * 0.8) category = t; pText = null; };
  while ((m = re.exec(html))) {
    if (m[2] == null) {
      const t = m[5] != null ? m[5] : '<';
      if (stack.length) stack[stack.length - 1].own += t;
      if (pText != null) { pText += t; pAll += t.trim().length; if (inB) pBold += t.trim().length; }
      continue;
    }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (tag === 'li') {
      if (!close) stack.push({ own: '', kids: false });
      else if (stack.length) {
        const li = stack.pop();
        if (!li.kids) {
          const chain = stack.map(x => clean(x.own)).filter(Boolean);
          let text = clean(li.own);
          for (let i = 0; i < 3; i++) text = text.replace(/\s*\((?:[^()]{1,48})\)\s*$/, '').trim(); // trailing "(Reuters)" sources
          if (text.length >= 30) out.push({ category, topic: chain[0] || '', text: (chain.length ? chain.join(' — ') + ' — ' : '') + text });
        }
      }
    } else if (tag === 'ul' || tag === 'ol') { if (!close && stack.length) stack[stack.length - 1].kids = true; }
    else if (tag === 'p') { if (!close) { pText = ''; pBold = 0; pAll = 0; } else endHeading(); }
    else if (tag === 'div') {
      if (!close) { const h = /role\s*=\s*["']?heading/i.test(attrs); divs.push(h); if (h) { pText = ''; pBold = 0; pAll = 0; inB++; } }
      else if (divs.pop()) { endHeading(); inB = Math.max(0, inB - 1); }
    } else if (tag === 'b' || tag === 'strong') { if (!m[4]) inB = Math.max(0, inB + (close ? -1 : 1)); }
    else if (tag === 'br' && stack.length) stack[stack.length - 1].own += ' ';
  }
  return out;
}

function createKnowledge(o) {
  const db = o.db;
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const now = o.now || (() => Date.now());
  const log = o.log || ((...a) => console.log('[brocore]', ...a));
  db.exec(`CREATE TABLE IF NOT EXISTS bro_knowledge(id TEXT PRIMARY KEY, source TEXT, title TEXT, text TEXT, url TEXT, lang TEXT DEFAULT 'en', published_at TEXT, added TEXT DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS idx_bro_knowledge_pub ON bro_knowledge(published_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS bro_knowledge_fts USING fts5(title, text, tokenize='unicode61 remove_diacritics 2');`);
  const q = s => db.prepare(s);
  const st = { lastRefresh: null, lastAdded: 0, lastError: '', wiki: {}, running: null };
  const cache = new Map();

  const upsert = db.transaction(items => {
    let added = 0, updated = 0;
    const get = q('SELECT rowid, title, text FROM bro_knowledge WHERE id=?');
    for (const it of items) {
      if (!it || !it.id || !it.text) continue;
      const title = clip(it.title, 200), text = clip(it.text, 1200);
      const old = get.get(it.id);
      if (old) {
        if (old.title === title && old.text === text) continue;
        q('UPDATE bro_knowledge SET source=?, title=?, text=?, url=?, lang=?, published_at=? WHERE id=?').run(it.source, title, text, it.url || '', it.lang || 'en', it.published_at || null, it.id);
        q('DELETE FROM bro_knowledge_fts WHERE rowid=?').run(old.rowid); q('INSERT INTO bro_knowledge_fts(rowid, title, text) VALUES(?,?,?)').run(old.rowid, title, text); updated++;
      } else {
        const info = q('INSERT INTO bro_knowledge(id, source, title, text, url, lang, published_at) VALUES(?,?,?,?,?,?,?)').run(it.id, it.source, title, text, it.url || '', it.lang || 'en', it.published_at || null);
        q('INSERT INTO bro_knowledge_fts(rowid, title, text) VALUES(?,?,?)').run(info.lastInsertRowid, title, text); added++;
      }
    }
    return { added, updated };
  });
  const prune = db.transaction(() => {
    const cut = new Date(now() - KEEP_DAYS * 864e5).toISOString();
    const rows = q("SELECT rowid FROM bro_knowledge WHERE COALESCE(published_at, added) < ?").all(cut);
    for (const r of rows) { q('DELETE FROM bro_knowledge_fts WHERE rowid=?').run(r.rowid); q('DELETE FROM bro_knowledge WHERE rowid=?').run(r.rowid); }
    return rows.length;
  });

  // ── sources ──
  function fromNewsStories() {
    try {
      if (!q("SELECT name FROM sqlite_master WHERE type='table' AND name='news_stories'").get()) return [];
      const cut = new Date(now() - KEEP_DAYS * 864e5).toISOString();
      const out = [];
      for (const r of q('SELECT id, headline, summary, why, headline_hi, summary_hi, sources, published_at, created_at FROM news_stories WHERE COALESCE(published_at, created_at) >= ? ORDER BY published_at DESC LIMIT 400').all(cut)) {
        let url = ''; try { url = ((JSON.parse(r.sources || '[]') || [])[0] || {}).link || ''; } catch (e) { /* none */ }
        const when = r.published_at || r.created_at;
        if (r.headline && r.summary) out.push({ id: 'news:' + r.id, source: 'news', title: r.headline, text: r.summary + (r.why ? ' ' + r.why : ''), url, lang: 'en', published_at: when });
        if (r.headline_hi && r.summary_hi) out.push({ id: 'news-hi:' + r.id, source: 'news', title: r.headline_hi, text: r.summary_hi, url, lang: 'hi', published_at: when });
      }
      return out;
    } catch (e) { st.lastError = 'news_stories: ' + e.message; return []; }
  }
  function fromFeed() {
    if (typeof o.newsItems !== 'function') return [];
    let items = []; try { items = o.newsItems() || []; } catch (e) { return []; }
    return items.filter(it => it && it.title).slice(0, 300).map(it => {
      const ts = Date.parse(it.date || it.pubDate || '') || now();
      return { id: 'rss:' + sha(it.link || it.title), source: 'feed', title: decode(it.title), text: decode(it.desc || it.description || it.title).replace(/<[^>]+>/g, ' '), url: it.link || '', lang: /[ऀ-ॿ]/.test(it.title) ? 'hi' : 'en', published_at: new Date(ts).toISOString() };
    });
  }
  const pageTitle = d => 'Portal:Current_events/' + d.getUTCFullYear() + '_' + MONTHS[d.getUTCMonth()] + '_' + d.getUTCDate();
  async function getJson(url, signal) {
    const r = await fetchFn(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' }, signal });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function currentEventsHtml(d) {
    const title = pageTitle(d), signal = AbortSignal.timeout(15000);
    try {
      const r = await fetchFn('https://en.wikipedia.org/api/rest_v1/page/html/' + encodeURIComponent(title), { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'text/html' }, signal });
      if (r.ok) return { html: await r.text(), title };
      if (r.status === 404) return { html: '', title, missing: true };
    } catch (e) { /* try the action API */ }
    const j = await getJson('https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&redirects=1&page=' + encodeURIComponent(title), AbortSignal.timeout(15000));
    if (j && j.error) return { html: '', title, missing: true };
    return { html: (j && j.parse && j.parse.text) || '', title };
  }
  async function fromWikipedia(days) {
    const out = [];
    for (let i = 0; i < (days || 3); i++) {
      const d = new Date(now() - i * 864e5); const day = isoDay(d);
      try {
        const { html, title, missing } = await currentEventsHtml(d);
        if (missing || !html) { st.wiki[day] = 0; continue; }
        const bullets = ceBullets(html).slice(0, 200);
        st.wiki[day] = bullets.length;
        for (const b of bullets) out.push({ id: 'wce:' + day + ':' + sha(b.text), source: 'wikipedia', title: b.topic || b.category || 'Current events', text: (b.category ? b.category + ': ' : '') + b.text, url: 'https://en.wikipedia.org/wiki/' + encodeURI(title), lang: 'en', published_at: day + 'T12:00:00.000Z' });
      } catch (e) { st.wiki[day] = -1; st.lastError = 'wikipedia ' + day + ': ' + e.message; }
    }
    return out;
  }

  async function refresh(opts) {
    if (st.running) return st.running;
    st.running = (async () => {
      const t0 = now();
      const items = [...fromNewsStories(), ...fromFeed()];
      if (!(opts && opts.wikipedia === false)) items.push(...await fromWikipedia(3));
      const r = upsert(items); const pruned = prune();
      st.lastRefresh = new Date(now()).toISOString(); st.lastAdded = r.added;
      const total = count();
      log('knowledge refreshed:', r.added, 'new,', r.updated, 'updated,', pruned, 'expired ·', total, 'items ·', (now() - t0) + 'ms');
      return { added: r.added, updated: r.updated, pruned, total, wiki: Object.assign({}, st.wiki) };
    })().finally(() => { st.running = null; });
    return st.running;
  }

  const ageDays = r => Math.max(0, (now() - (Date.parse(r.published_at || r.added) || now())) / 864e5);
  const pub = r => ({ id: r.id, source: r.source, title: r.title, text: r.text, url: r.url, lang: r.lang, published_at: r.published_at, date: String(r.published_at || r.added || '').slice(0, 10) });
  // bm25 (title counts double) × recency: today ×2.5, 3 days ×1.55, 10 days ×1.05
  function search(query, n, opts) {
    n = n || 3; const fq = ftsQuery(query); if (!fq) return [];
    let rows = [];
    try { rows = q('SELECT k.*, bm25(bro_knowledge_fts, 2.0, 1.0) AS rank FROM bro_knowledge_fts JOIN bro_knowledge k ON k.rowid = bro_knowledge_fts.rowid WHERE bro_knowledge_fts MATCH ? ORDER BY rank LIMIT 60').all(fq); } catch (e) { return []; }
    if (opts && opts.lang) rows = rows.filter(r => r.lang === opts.lang || !r.lang);
    return rows.map(r => Object.assign(pub(r), { score: +(-r.rank * (1 + 1.5 * Math.exp(-ageDays(r) / 3))).toFixed(4) })).sort((a, b) => b.score - a.score).slice(0, n);
  }
  function latest(n, opts) {
    const lang = opts && opts.lang;
    return q("SELECT * FROM bro_knowledge WHERE source IN ('news','wikipedia')" + (lang ? ' AND lang=?' : '') + ' ORDER BY published_at DESC LIMIT ?').all(...(lang ? [lang, n || 3] : [n || 3])).map(pub);
  }
  // the today tool: a topic search over the last days, or the newest stories
  function today(topic, n) {
    n = n || 6;
    const list = topic ? search(topic, n) : latest(n);
    return { items: list.map(x => ({ date: x.date, title: x.title, text: clip(x.text, 320), source: x.source })), updated: st.lastRefresh };
  }

  // ── lookup: Wikipedia search + page summary ──
  async function lookup(query) {
    query = String(query || '').trim().slice(0, 200); if (!query) return { found: false };
    const ck = query.toLowerCase(); const hit = cache.get(ck); if (hit && now() - hit.at < 6 * 3600e3) return hit.value;
    const hosts = /[ऀ-ॿ]/.test(query) ? ['hi.wikipedia.org', 'en.wikipedia.org'] : ['en.wikipedia.org'];
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), o.lookupMs || 6000);
    let value = { found: false, query };
    try {
      for (const host of hosts) {
        let j; try { j = await getJson('https://' + host + '/w/rest.php/v1/search/page?q=' + encodeURIComponent(query) + '&limit=3', ctrl.signal); } catch (e) { if (ctrl.signal.aborted) break; continue; }
        const pages = (j && j.pages) || []; if (!pages.length) continue;
        const p = pages[0];
        let s = null; try { s = await getJson('https://' + host + '/api/rest_v1/page/summary/' + encodeURIComponent(String(p.key || p.title).replace(/ /g, '_')), ctrl.signal); } catch (e) { s = null; }
        const extract = (s && s.extract) || decode(String(p.excerpt || '').replace(/<[^>]+>/g, ''));
        if (!extract) continue;
        value = { found: true, query, title: (s && s.title) || p.title, summary: clip(extract, 900), description: (s && s.description) || p.description || '', url: (s && s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || ('https://' + host + '/wiki/' + encodeURIComponent(String(p.key || p.title).replace(/ /g, '_'))), lang: host.slice(0, 2), updated: (s && s.timestamp) || '', also: pages.slice(1).map(x => x.title) };
        break;
      }
    } finally { clearTimeout(t); }
    if (!value.found) { // nothing on Wikipedia (or it timed out): what today's index says
      const local = search(query, 2);
      if (local.length) value = { found: true, query, title: local[0].title, summary: clip(local[0].text, 600), url: local[0].url, lang: local[0].lang, source: local[0].source, date: local[0].date };
    }
    if (value.found) { cache.set(ck, { at: now(), value }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
    return value;
  }

  // ── news search: Google News RSS (free, no key): today's headlines on a query, with dates and outlets. The web
  //    search's last resort, so a question about something current still gets dated facts.
  async function newsSearch(query, opts) {
    opts = opts || {};
    query = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200); if (!query) return { found: false, items: [] };
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + (/[ऀ-ॿ]/.test(query) ? '&hl=hi&gl=IN&ceid=IN:hi' : '&hl=en-IN&gl=IN&ceid=IN:en');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
    try {
      const r = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: ctrl.signal });
      if (!r.ok) { const e = new Error('news search HTTP ' + r.status); e.status = r.status; throw e; }
      const xml = String(await r.text()), items = [];
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const tag = n => { const x = m[1].match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>')); return x ? decode(x[1].replace(/<!\[CDATA\[|\]\]>/g, '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; };
        const title = tag('title'); if (!title) continue;
        const d = new Date(tag('pubDate'));
        items.push({ title: clip(title, 200), date: isNaN(d) ? '' : d.toISOString().slice(0, 10), source: clip(tag('source'), 60) });
        if (items.length >= (opts.n || 6)) break;
      }
      return { found: items.length > 0, items };
    } finally { clearTimeout(t); }
  }

  function count() { try { return q('SELECT COUNT(*) n FROM bro_knowledge').get().n; } catch (e) { return 0; } }
  const health = () => ({ items: count(), lastRefresh: st.lastRefresh, lastAdded: st.lastAdded, wiki: st.wiki, lastError: st.lastError, running: !!st.running });
  return { refresh, search, latest, today, lookup, newsSearch, count, health, _ceBullets: ceBullets };
}

module.exports = { createKnowledge, ceBullets, ftsQuery, UA };
