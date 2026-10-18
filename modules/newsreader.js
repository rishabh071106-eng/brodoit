// Brodoit News reader — fetches an article server-side and returns clean, readable paragraphs so the
// app can show the story in its own Reader sheet (and read it aloud) instead of bouncing to a browser.
//   server.js:  require('./modules/newsreader.js').install(app, { auth, getSetting, MEDIA_DIR });
//   GET /api/news/read?url=<encoded>  (auth)  →  { ok, title, byline, site, image, published, paragraphs, url, cached }
// Failures answer 200 with { ok:false, error } so the client can fall back to "Open original".
// No new dependencies: a small tag scanner scores every block by the length of the <p> text it holds and
// returns the tightest block that still carries most of the article (an <article> element wins when it is
// substantial). Results are cached in memory (LRU 200, 6 h) and on disk at MEDIA_DIR/news-cache/<sha1>.json.
// Only http(s) URLs that resolve to public addresses are fetched (every redirect hop is checked too).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const dns = require('dns').promises;

const TTL = 6 * 60 * 60 * 1000;
const FAIL_TTL = 10 * 60 * 1000;
const MEM_MAX = 200;
const MAX_BYTES = 2.5 * 1024 * 1024;
const TIMEOUT = 10000;
const MAX_HOPS = 5;
const MAX_PARAS = 40;
const MIN_PARA = 40;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// ── network guard ──────────────────────────────────────────────────────────────────────────────────
function isPrivateIp(ip) {
  if (!ip) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const h = ip.toLowerCase();
  return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
}
async function assertPublic(hostname) {
  if (process.env.NEWS_READER_ALLOW_PRIVATE === '1') return;
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(h)) throw new Error('blocked host');
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new Error('blocked address'); return; }
  const addrs = await dns.lookup(h, { all: true, verbatim: true });
  if (!addrs.length) throw new Error('unresolved host');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('blocked address');
}

// ── fetch (manual redirects, size cap, charset) ───────────────────────────────────────────────────
async function readBody(res, max) {
  const chunks = []; let size = 0;
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) { const b = Buffer.from(await res.arrayBuffer()); return b.subarray(0, max); }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value)); size += value.length;
    if (size >= max) { try { await reader.cancel(); } catch (e) {} break; }
  }
  return Buffer.concat(chunks).subarray(0, max);
}
function decodeBuffer(buf, contentType) {
  let cs = (String(contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) { const head = buf.subarray(0, 4096).toString('latin1'); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]; }
  try { return new TextDecoder(cs || 'utf-8', { fatal: false }).decode(buf); } catch (e) { return buf.toString('utf8'); }
}
async function fetchHtml(startUrl) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s)');
      await assertPublic(u.hostname);
      const r = await fetch(u.href, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8' } });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get('location'); if (!loc) throw new Error('redirect without location');
        try { await r.body?.cancel(); } catch (e) {}
        url = new URL(loc, u.href).href; continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = String(r.headers.get('content-type') || '');
      if (ct && !/html|xml/i.test(ct)) throw new Error('not an article page');
      const buf = await readBody(r, MAX_BYTES);
      return { html: decodeBuffer(buf, ct), url: u.href };
    }
    throw new Error('too many redirects');
  } finally { clearTimeout(timer); }
}

// ── text helpers ───────────────────────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', inr: '₹', middot: '·', bull: '•', laquo: '«', raquo: '»', times: '×', deg: '°', frac12: '½', shy: '' };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    try {
      if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
      return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
    } catch (err) { return m; }
  });
}
const clean = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function stripBlocks(html, tags) {
  const re = new RegExp('<(' + tags.join('|') + ')\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>', 'gi');
  for (let pass = 0; pass < 3; pass++) { const next = html.replace(re, ' '); if (next === html) break; html = next; } // nested same-name tags need a second pass
  return html;
}
function attr(tagAttrs, name) {
  const m = String(tagAttrs || '').match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
  return m ? decodeEntities(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : '';
}
function meta(html, key) {
  const re1 = new RegExp('<meta\\s[^>]*(?:property|name|itemprop)\\s*=\\s*["\']' + key + '["\'][^>]*>', 'i');
  const m = html.match(re1);
  if (m) { const c = attr(m[0], 'content'); if (c) return c.trim(); }
  const re2 = new RegExp('<meta\\s[^>]*content\\s*=\\s*["\']([^"\']*)["\'][^>]*(?:property|name|itemprop)\\s*=\\s*["\']' + key + '["\']', 'i');
  const n = html.match(re2);
  return n ? decodeEntities(n[1]).trim() : '';
}
function jsonLd(html) {
  const out = []; const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); out.push(n); if (n['@graph']) walk(n['@graph']); if (n.mainEntity) walk(n.mainEntity); };
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim())); } catch (e) {} }
  const types = /NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|Article|BlogPosting|TechArticle/;
  return out.find(n => types.test([].concat(n['@type'] || []).join(' '))) || null;
}
const names = v => [].concat(v || []).map(x => typeof x === 'string' ? x : x && (x.name || x['@name']) || '').filter(Boolean).join(', ');
const firstUrl = v => { const x = [].concat(v || [])[0]; return typeof x === 'string' ? x : x && (x.url || x.contentUrl) || ''; };
let SOURCE_NAMES = {}; try { SOURCE_NAMES = require('./newsfeeds.js').SOURCE_NAMES || {}; } catch (e) {}
function pretty(host) {
  const h = String(host || '').replace(/^www\./, '').replace(/^\[|\]$/g, '');
  const known = h.split('.').map(l => SOURCE_NAMES[l]).find(Boolean); if (known) return known;
  const k = h.split('.'); return k[0] ? k[0].charAt(0).toUpperCase() + k[0].slice(1) : h;
}
function readMeta(html, url) {
  const ld = jsonLd(html) || {};
  let host = ''; try { host = new URL(url).hostname; } catch (e) {}
  const titleTag = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const site = meta(html, 'og:site_name') || (ld.publisher && ld.publisher.name) || pretty(host);
  let title = ld.headline || meta(html, 'og:title') || meta(html, 'twitter:title') || titleTag;
  title = clean(title);
  if (site) { const re = new RegExp('\\s*[|\\-–—:]\\s*' + site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'); title = title.replace(re, ''); }
  let byline = names(ld.author) || meta(html, 'author') || meta(html, 'article:author') || meta(html, 'parsely-author') || meta(html, 'dc.creator') ||
    clean((html.match(/<a[^>]+rel=["']author["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1]) ||
    clean((html.match(/<[a-z]+[^>]+class=["'][^"']*\b(?:byline|author-name|author__name|article-author)\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/i) || [])[1]);
  byline = byline.replace(/^by\s+/i, '').replace(/^https?:\/\/\S+$/, '').slice(0, 120);
  let image = meta(html, 'og:image:secure_url') || meta(html, 'og:image') || meta(html, 'twitter:image') || firstUrl(ld.image);
  try { if (image) image = new URL(image, url).href; } catch (e) { image = ''; }
  const published = ld.datePublished || meta(html, 'article:published_time') || meta(html, 'pubdate') || meta(html, 'publish-date') || meta(html, 'date') || attr((html.match(/<time\s[^>]*datetime=[^>]*>/i) || [])[0], 'datetime') || '';
  const description = meta(html, 'og:description') || meta(html, 'description') || clean(ld.description);
  return { title, byline, site, image, published: String(published).slice(0, 40), description };
}

// ── readable-block extraction ──────────────────────────────────────────────────────────────────────
const CONTAINER = new Set(['div', 'section', 'main', 'article', 'body', 'td', 'li', 'blockquote']);
const BLOCK = new Set(['div', 'section', 'main', 'article', 'body', 'td', 'li', 'blockquote', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'figure', 'dl', 'dd', 'dt', 'hr', 'pre']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BAD = /(^|[\s_-])(comments?|sidebar|side-bar|related|promo|promotion|recommend(ed|ations?)?|newsletter|subscri(be|ption)|share|sharing|social|footer|footnote|nav|navigation|menu|breadcrumbs?|cookie|advert(isement)?|ads?|ad-slot|sponsor(ed)?|outbrain|taboola|trending|popular|most-read|tags?|tag-list|author-bio|disclaimer|paywall|modal|popup|widget|read-more|also-read|more-stories|caption|credit|ticker|live-blog-nav|toolbar|skip)([\s_-]|$)/i;
const BOILER = /^(advertisement|advertisements|read more|also read|read also|related|share this|follow us|click here|sign up|subscribe|loading|loading\.\.\.|photo:|image:|published|updated|first published|comments|story continues|continue reading|we use cookies|this article was|watch:|listen:)/i;
const LINK_HEAVY = 0.5;

function collect(html) {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g;
  const stack = []; const paras = []; const blocks = new Map();
  let m, last = 0, nextId = 1, skip = 0, order = 0;
  const openP = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].p) return i; if (BLOCK.has(stack[i].tag)) return -1; } return -1; };
  const finishP = (idx) => {
    const p = stack[idx]; if (!p || !p.p) return;
    const text = clean(p.html); const len = text.length;
    const linkLen = clean(p.linkHtml).length;
    if (len >= MIN_PARA && !BOILER.test(text) && (linkLen / len) < LINK_HEAVY && !/^[^a-zA-Z\u0900-\u097F]*$/.test(text)) {
      paras.push({ text, len, anc: p.anc, order: order++ });
      for (const id of p.anc) { const b = blocks.get(id); if (b) { b.score += len; b.n++; } }
    }
  };
  const popTo = (idx) => { for (let i = stack.length - 1; i >= idx; i--) { if (stack[i].p) finishP(i); if (stack[i].skip) skip--; } stack.length = idx; };
  while ((m = re.exec(html))) {
    const raw = m[0], tag = m[1].toLowerCase(), attrs = m[2] || '';
    const text = html.slice(last, m.index); last = re.lastIndex;
    const pi = openP();
    if (pi >= 0 && !skip && text) { stack[pi].html += text; if (stack[pi].a > 0) stack[pi].linkHtml += text; }
    if (raw[1] === '/') {
      if (tag === 'a') { const p = pi >= 0 ? stack[pi] : null; if (p && p.a > 0) p.a--; }
      for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].tag === tag) { popTo(i); break; } }
      continue;
    }
    if (VOID.has(tag) || raw.endsWith('/>')) { if (pi >= 0 && tag === 'br') stack[pi].html += ' '; continue; }
    if (BLOCK.has(tag) || tag === 'p') { if (pi >= 0) popTo(pi); }
    const bad = tag !== 'body' && tag !== 'html' && (BAD.test(attr(attrs, 'class')) || BAD.test(attr(attrs, 'id')) || /^(nav|menu|complementary|banner|contentinfo|search|dialog)$/i.test(attr(attrs, 'role')) || attr(attrs, 'aria-hidden') === 'true' || attr(attrs, 'hidden') !== '' && /hidden/i.test(raw));
    const node = { tag, p: tag === 'p' || tag === 'pre', html: '', linkHtml: '', a: 0, skip: false };
    if (bad) { node.skip = true; skip++; }
    if (CONTAINER.has(tag)) { node.id = nextId++; node.depth = stack.filter(s => CONTAINER.has(s.tag)).length; blocks.set(node.id, { id: node.id, tag, score: 0, n: 0, depth: node.depth }); }
    if (node.p) node.anc = skip ? [] : stack.filter(s => CONTAINER.has(s.tag)).map(s => s.id);
    if (tag === 'a' && pi >= 0) stack[pi].a++;
    stack.push(node);
  }
  popTo(0);
  return { paras: paras.filter(p => p.anc.length), blocks };
}

function extract(html, url) {
  const info = readMeta(html, url);
  let body = String(html).replace(/<!--[\s\S]*?-->/g, ' ');
  body = stripBlocks(body, ['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'form', 'button', 'select', 'textarea', 'nav', 'aside', 'footer', 'figcaption', 'video', 'audio', 'canvas', 'object', 'dialog', 'menu', 'head']);
  const { paras, blocks } = collect(body);
  let paragraphs = [];
  if (paras.length) {
    let best = null, max = 0;
    for (const b of blocks.values()) if (b.score > max) max = b.score;
    let art = null; for (const b of blocks.values()) if (b.tag === 'article' && (!art || b.score > art.score)) art = b;
    if (art && art.score >= 600 && art.score >= max * 0.4) best = art;
    else { for (const b of blocks.values()) if (b.score >= max * 0.8 && (!best || b.depth > best.depth)) best = b; }
    if (best) paragraphs = paras.filter(p => p.anc.includes(best.id)).sort((a, b) => a.order - b.order).map(p => p.text);
  }
  if (paragraphs.length < 2) {
    // Pages that write text straight into <div>s (no <p>): take long text runs in document order.
    const runs = []; const re = />([^<>]{120,})</g; let m;
    while ((m = re.exec(body))) { const t = clean(m[1]); if (t.length >= 80 && !BOILER.test(t)) runs.push(t); }
    if (runs.length > paragraphs.length) paragraphs = runs;
  }
  const seen = new Set(); const out = [];
  for (const p of paragraphs) { const k = p.slice(0, 80).toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(p); if (out.length >= MAX_PARAS) break; }
  if (!out.length && info.description && info.description.length >= MIN_PARA) out.push(info.description);
  return { ok: out.length > 0, title: info.title, byline: info.byline, site: info.site, image: info.image, published: info.published, paragraphs: out, url, error: out.length ? undefined : 'no readable text' };
}

async function readArticle(url) {
  const { html, url: finalUrl } = await fetchHtml(url);
  const d = extract(html, finalUrl);
  if (!d.title) { try { d.title = new URL(finalUrl).hostname; } catch (e) { d.title = ''; } }
  return d;
}

// ── caches + route ─────────────────────────────────────────────────────────────────────────────────
const sha1 = s => crypto.createHash('sha1').update(String(s)).digest('hex');
function install(app, deps) {
  const { auth } = deps || {};
  const mediaDir = (deps && deps.MEDIA_DIR) || path.join(os.tmpdir(), 'brodoit-media');
  const dir = path.join(mediaDir, 'news-cache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const mem = new Map(); const fails = new Map(); const inflight = new Map();
  const memGet = k => { const v = mem.get(k); if (!v) return null; if (Date.now() - v.ts > TTL) { mem.delete(k); return null; } mem.delete(k); mem.set(k, v); return v.data; };
  const memSet = (k, data) => { mem.set(k, { ts: Date.now(), data }); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };
  const diskGet = k => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, k + '.json'), 'utf8')); if (Date.now() - j.ts > TTL) return null; return j.data; } catch (e) { return null; } };
  let writes = 0;
  const diskSet = (k, data) => {
    try { fs.writeFileSync(path.join(dir, k + '.json'), JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    if (++writes % 50 === 0) { try { const old = Date.now() - 2 * TTL; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); try { if (fs.statSync(p).mtimeMs < old) fs.unlinkSync(p); } catch (e) {} } } catch (e) {} }
  };

  const guard = typeof auth === 'function' ? auth : (req, res, next) => next();
  app.get('/api/news/read', guard, async (req, res) => {
    const raw = String(req.query.url || '').trim().slice(0, 2000);
    let u; try { u = new URL(raw); } catch (e) { return res.json({ ok: false, error: 'bad url', url: raw }); }
    if (!/^https?:$/.test(u.protocol)) return res.json({ ok: false, error: 'only http(s) links', url: raw });
    u.hash = '';
    const key = sha1(u.href);
    res.set('Cache-Control', 'private, max-age=300');
    const hit = memGet(key) || diskGet(key);
    if (hit) { if (!mem.has(key)) memSet(key, hit); return res.json({ ...hit, cached: true }); }
    const f = fails.get(key); if (f && Date.now() - f.ts < FAIL_TTL) return res.json({ ...f.data, cached: true });
    let p = inflight.get(key);
    if (!p) {
      p = readArticle(u.href).then(d => { if (d.ok) { memSet(key, d); diskSet(key, d); } else fails.set(key, { ts: Date.now(), data: d }); return d; })
        .catch(e => { const msg = e && e.name === 'AbortError' || /aborted/i.test(e && e.message) ? 'timed out' : String(e && e.message || e).slice(0, 120); const d = { ok: false, error: msg, url: u.href }; fails.set(key, { ts: Date.now(), data: d }); return d; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const d = await p;
    res.json({ ...d, cached: false });
  });
  console.log('[news-reader] ready · cache', dir);
  return { readArticle, extract };
}

module.exports = { install, extract, readArticle, isPrivateIp };
