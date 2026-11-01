// /credits — attribution for the card photos (Wikimedia Commons, free licenses; list in app/img/cards/credits.json written by
// scripts/fetch-images.js) and the book cover source. Linked from the You tab.
'use strict';
const fs = require('fs'), path = require('path');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function install(app, deps) {
  const file = path.join(deps.appRoot, 'app', 'img', 'cards', 'credits.json');
  // v31: the voices (open models we run ourselves; no recording of a real person is copied)
  const voices = () => {
    let bv = null; try { bv = global._bookVoice ? global._bookVoice.stats() : null; } catch (e) { bv = null; }
    const book = bv && bv.voice ? `Book notes are read by ${esc(bv.voice)}${bv.license ? ' (' + esc(bv.license) + ' licence)' : ''}, recorded by Brodoit. ` : '';
    return `<h2 style="font:600 18px/1.3 var(--b-sans);margin:28px 0 6px">Voices</h2><p>${book}Bro's voice is Kokoro-82M (Apache-2.0), running on our own server.</p>`;
  };
  app.get('/credits', (req, res) => {
    let c = {}; try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const rows = Object.entries(c).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) =>
      `<li><img src="/app/img/cards/${esc(k)}.jpg" alt="" loading="lazy"><div><b>${esc(String(v.file || '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '))}</b><span>${esc(v.artist)} · <a href="${esc(v.licenseUrl || v.page)}" rel="noopener" target="_blank">${esc(v.license)}</a> · <a href="${esc(v.page)}" rel="noopener" target="_blank">Wikimedia Commons</a></span></div></li>`).join('');
    res.set('Cache-Control', 'no-cache').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Photo credits · Brodoit</title>
<link rel="stylesheet" href="/app/theme.css"><style>body{margin:0;background:var(--b-bg);color:var(--b-ink);font:15px/1.5 var(--b-sans)}main{max-width:640px;margin:0 auto;padding:20px 16px 48px}
a.back{display:inline-flex;align-items:center;min-height:44px;color:var(--b-primary);font-weight:600;text-decoration:none}h1{font:400 38px/1.1 var(--b-serif);margin:8px 0 6px}p{color:var(--b-mute);margin:0 0 18px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}li{display:flex;gap:12px;align-items:center;background:var(--b-card);border-radius:16px;padding:10px;min-width:0}li>div{min-width:0;overflow-wrap:anywhere}li img{width:72px;height:48px;object-fit:cover;border-radius:10px;flex:0 0 auto}
li b{display:block;font-weight:600;font-size:14px}li span{display:block;font-size:13px;color:var(--b-mute)}li a{color:var(--b-ink-2);display:inline-block;padding:6px 0}</style>
<script>try{var t=localStorage.getItem('theme')||localStorage.getItem('bd_theme');if(t==='aurora'||t==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}</script></head>
<body><main><a class="back" href="/?tab=profile">← Brodoit</a><h1>Photo credits</h1><p>Card photos come from Wikimedia Commons under free licenses. Thank you to every photographer below. Book covers come from Open Library.</p>
<ul>${rows || '<li><div><b>No photos yet</b><span>They are added automatically.</span></div></li>'}</ul>${voices()}</main></body></html>`);
  });
}
module.exports = { install };
