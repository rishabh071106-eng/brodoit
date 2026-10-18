#!/usr/bin/env node
// Card photos for the card-based UI. Runs in CI (GitHub Actions has network; the server never does this at request time).
// For each key in config/image-manifest.json: try each Wikipedia article title in order, take its lead image only when it is
// a Wikimedia Commons JPEG with a free license (public domain, CC0, CC BY, CC BY-SA), download a 1280px rendition, crop it
// to 960x640 (attention-based crop) and save app/img/cards/<key>.jpg. Attribution for every photo goes to
// app/img/cards/credits.json, which the app shows on its "Photo credits" page. Existing photos are kept (delete to refetch).
'use strict';
const fs = require('fs'), path = require('path');
const sharp = require(process.env.SHARP_PATH || 'sharp');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'img', 'cards');
const UA = { 'User-Agent': 'BrodoitCardPhotos/1.0 (https://brodoit.com)', 'Api-User-Agent': 'BrodoitCardPhotos/1.0 (https://brodoit.com)' };
const FREE = /^(public domain|pd\b|pd-|cc0|cc[- ]by(-sa)?[- ]?[0-9.]*|attribution|no restrictions)/i;
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function json(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }
async function tryTitle(title) {
  // pilicense=free: the article's lead image only when it is free-licensed (never fair-use logos or posters)
  const q = await json('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=name|original&pilicense=free&titles=' + encodeURIComponent(title));
  const page = Object.values((q.query || {}).pages || {})[0] || {};
  if ('missing' in page) return { skip: 'no such article' };
  const name = page.pageimage; if (!name) return { skip: 'no free lead image' };
  if (!/\.jpe?g$/i.test(name)) return { skip: 'not a photo (' + name.split('.').pop() + ')' };
  if (page.original && page.original.width && page.original.width < 800) return { skip: 'too small' };
  const r1 = await json('https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280&titles=' + encodeURIComponent('File:' + name));
  const fp = Object.values((r1.query || {}).pages || {})[0] || {}; const ii = (fp.imageinfo || [])[0];
  if (!ii) return { skip: 'no imageinfo for ' + name };
  const m = ii.extmetadata || {}; const lic = strip(m.LicenseShortName && m.LicenseShortName.value);
  if (!FREE.test(lic)) return { skip: 'license ' + lic };
  const r = await fetch(ii.thumburl || ii.url, { headers: UA }); if (!r.ok) return { skip: 'download ' + r.status };
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, credit: { article: title, file: name, page: ii.descriptionurl || 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(name), artist: strip(m.Artist && m.Artist.value).slice(0, 160) || 'Unknown', license: lic, licenseUrl: strip(m.LicenseUrl && m.LicenseUrl.value) } };
}

(async () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'image-manifest.json'), 'utf8')).images;
  fs.mkdirSync(OUT, { recursive: true });
  const credFile = path.join(OUT, 'credits.json');
  let credits = {}; try { credits = JSON.parse(fs.readFileSync(credFile, 'utf8')); } catch (e) {}
  let got = 0, kept = 0, miss = [];
  for (const [key, titles] of Object.entries(man)) {
    const out = path.join(OUT, key + '.jpg');
    if (fs.existsSync(out) && credits[key]) { kept++; continue; }
    let done = false;
    for (const t of titles) {
      try {
        const res = await tryTitle(t);
        if (res.skip) { console.log(`  ${key}: ${t} — ${res.skip}`); continue; }
        await sharp(res.buf).rotate().resize(960, 640, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 78, mozjpeg: true }).toFile(out);
        credits[key] = res.credit; got++; done = true;
        console.log(`✓ ${key}: ${t} · ${res.credit.license} · ${res.credit.artist}`);
        break;
      } catch (e) { console.log(`  ${key}: ${t} — ${e.message}`); }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!done) miss.push(key);
  }
  for (const k of Object.keys(credits)) if (!man[k] || !fs.existsSync(path.join(OUT, k + '.jpg'))) delete credits[k];
  fs.writeFileSync(credFile, JSON.stringify(credits, null, 1) + '\n');
  console.log(`[photos] new ${got} · kept ${kept} · missing ${miss.length}${miss.length ? ' (' + miss.join(', ') + ')' : ''}`);
})();
