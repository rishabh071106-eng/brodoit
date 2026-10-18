// Serves real CPython for the browser (Pyodide, pinned in package.json) at /code/py/<version>/.
// The 8.6 MB wasm and the stdlib zip are compressed once in the background (brotli + gzip),
// so phones download ~3 MB instead of ~12 MB. Versioned URLs are cached forever.
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');

const FILES = {
  'pyodide.js': 'text/javascript', 'pyodide.mjs': 'text/javascript', 'pyodide.asm.js': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm', 'python_stdlib.zip': 'application/zip', 'pyodide-lock.json': 'application/json',
};

function install(app, opts = {}) {
  let dir = '', version = '';
  try {
    const pkg = require.resolve('pyodide/package.json');
    dir = path.dirname(pkg); version = require(pkg).version;
  } catch (e) { console.log('[python] pyodide package missing — the Python course cannot run code'); return { version: '' }; }
  const cacheDir = path.join(opts.cacheDir || os.tmpdir(), 'pyodide-' + version);
  const ready = {}; // file -> { br, gz }
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* read-only tmp: serve raw */ }

  // Compress one file at a time after boot so startup stays fast.
  const queue = Object.keys(FILES).filter(f => !/\.mjs$/.test(f));
  const next = () => {
    const f = queue.shift(); if (!f) return;
    const src = path.join(dir, f), br = path.join(cacheDir, f + '.br'), gz = path.join(cacheDir, f + '.gz');
    const done = () => { ready[f] = { br: fs.existsSync(br) ? br : '', gz: fs.existsSync(gz) ? gz : '' }; setTimeout(next, 50); };
    if (fs.existsSync(br) && fs.existsSync(gz)) return done();
    fs.readFile(src, (err, buf) => {
      if (err) return done();
      zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e1, b) => {
        try { if (!e1) fs.writeFileSync(br + '.tmp', b), fs.renameSync(br + '.tmp', br); } catch (e) { /* ignore */ }
        zlib.gzip(buf, { level: 9 }, (e2, g) => {
          try { if (!e2) fs.writeFileSync(gz + '.tmp', g), fs.renameSync(gz + '.tmp', gz); } catch (e) { /* ignore */ }
          done();
        });
      });
    });
  };
  setTimeout(next, opts.delay == null ? 4000 : opts.delay);

  app.get('/code/py/:ver/:file', (req, res) => {
    const f = req.params.file, type = FILES[f];
    if (!type) return res.status(404).end();
    if (req.params.ver !== version) return res.redirect(302, '/code/py/' + version + '/' + f);
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Vary': 'Accept-Encoding', 'Access-Control-Allow-Origin': '*' });
    const ae = String(req.headers['accept-encoding'] || ''), r = ready[f];
    if (r && r.br && /\bbr\b/.test(ae)) { res.set('Content-Encoding', 'br'); return res.sendFile(r.br); }
    if (r && r.gz && /\bgzip\b/.test(ae)) { res.set('Content-Encoding', 'gzip'); return res.sendFile(r.gz); }
    res.sendFile(path.join(dir, f));
  });
  console.log('[python] CPython (Pyodide ' + version + ') served at /code/py/' + version + '/');
  return { version };
}

module.exports = { install };
