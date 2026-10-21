// v21 speed: text files (js, css, html, json, svg) under the app's folders are sent compressed (brotli when the browser
// takes it, else gzip), each compressed once and kept in memory (an LRU of at most 48 MB, keyed by the file's size and
// time, so an edited file is compressed again). Cache-Control stays no-cache with an ETag per encoding: a phone keeps the
// file and a revalidation costs a 304. Anything else (images, audio, a browser asking for no compression, a missing
// file) falls through to express.static as before.
//   staticText({ root, prefixes: ['/app', …] }) → middleware
//   pickEncoding(req) → 'br' | 'gzip' | ''        compressText(buf, enc) → Buffer
'use strict';
const zlib = require('zlib'), fs = require('fs'), path = require('path');

const TYPES = {
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
function pickEncoding(req) {
  const ae = String((req.headers && req.headers['accept-encoding']) || '');
  if (/(^|[\s,])br($|[\s,;])/.test(ae) && !/br;q=0(\.0*)?($|[\s,])/.test(ae)) return 'br';
  if (/(^|[\s,])gzip($|[\s,;])/.test(ae) && !/gzip;q=0(\.0*)?($|[\s,])/.test(ae)) return 'gzip';
  return '';
}
function compressText(buf, enc, quality) {
  if (enc === 'br') return zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality || 9, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  return zlib.gzipSync(buf, { level: 9 });
}

function staticText(o) {
  o = o || {};
  const root = path.resolve(o.root || '.'), prefixes = o.prefixes || [], maxBytes = o.maxBytes || 48 * 1024 * 1024;
  const minBytes = o.minBytes != null ? o.minBytes : 1024, maxFile = o.maxFile || 8 * 1024 * 1024;
  const cache = new Map(); let bytes = 0;
  const stats = { hits: 0, made: 0, sent: 0, notModified: 0 };
  const put = (k, v) => {
    if (cache.has(k)) { bytes -= cache.get(k).z.length; cache.delete(k); }
    cache.set(k, v); bytes += v.z.length;
    while (bytes > maxBytes && cache.size) { const [k0, v0] = cache.entries().next().value; cache.delete(k0); bytes -= v0.z.length; }
  };
  const mw = function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p; try { p = decodeURIComponent(req.path || ''); } catch (e) { return next(); }
    if (!prefixes.some(x => p === x || p.startsWith(x + '/'))) return next();
    if (p.includes('\0') || p.split('/').includes('..')) return next();
    const rel = p.endsWith('/') ? p + 'index.html' : p;
    const type = TYPES[path.extname(rel).toLowerCase()];
    if (!type) return next();
    const enc = pickEncoding(req); if (!enc) return next();
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    let st; try { st = fs.statSync(file); } catch (e) { return next(); }
    if (!st.isFile() || st.size < minBytes || st.size > maxFile) return next();
    const tag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '-' + enc + '"';
    const key = file + '|' + enc;
    let ent = cache.get(key);
    if (ent && ent.tag === tag) { stats.hits++; cache.delete(key); cache.set(key, ent); }
    else {
      let buf; try { buf = fs.readFileSync(file); } catch (e) { return next(); }
      ent = { tag, z: compressText(buf, enc) }; put(key, ent); stats.made++;
    }
    res.set({ 'Content-Type': type, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Cache-Control': 'no-cache', ETag: tag });
    if (req.headers['if-none-match'] === tag) { stats.notModified++; return res.status(304).end(); }
    res.set('Content-Length', String(ent.z.length));
    stats.sent++;
    if (req.method === 'HEAD') return res.end();
    res.end(ent.z);
  };
  mw.stats = () => Object.assign({ files: cache.size, bytes }, stats);
  return mw;
}

module.exports = { staticText, pickEncoding, compressText, TYPES };
