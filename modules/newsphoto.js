// v27: news photos from Wikimedia Commons only. A publisher's photo (the feed's image or the page's og:image) belongs to
// the publisher or an agency (Reuters, AP, PTI, Getty…), so the desk never copies one. Instead it looks up the story's
// subject (a place, a public figure, an organisation, a landmark: the writer's `image_query`) on Wikimedia Commons and
// takes a freely licensed photo: public domain, CC0, CC BY or CC BY-SA (never NC/ND, never non-free), shown with its
// credit (author · licence · Commons). No match → no photo: the app draws its own category-colour card instead.
//   const P = require('./newsphoto.js'); const hit = await P.find('Brahmaputra river', { fetch })
//   → { url, page, by, license, title } | null
'use strict';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks every client to name itself and give a contact
const UA = 'BrodoitNews/1.0 (https://brodoit.com; hello@brodoit.com)';
const FREE = /^(cc0|public domain|pd\b|pd-|cc[- ]by(-sa)?([- ][0-9.]+)?( [a-z-]+)?$)/i;
const STOP = new Set('the a an of in on at for and or to with from by is are was were be its it this that new says said after over into as amid near'.split(' '));

const strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const words = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(w => w.length >= 3 && !STOP.has(w));

// the licence is free enough to reuse with credit
function freeLicense(meta) {
  const v = k => strip(meta && meta[k] && meta[k].value);
  const name = v('LicenseShortName'), url = v('LicenseUrl');
  if (!name || /\bnc\b|\bnd\b|non-?commercial|no ?deriv|fair use|non-?free/i.test(name + ' ' + url)) return '';
  if (v('NonFree') && v('NonFree') !== 'false') return '';
  return FREE.test(name) ? name : '';
}

// a subject query from a headline when the writer gave none: its proper nouns ("Assam floods displace…" → "Assam")
function queryFromHeadline(h) {
  const toks = String(h || '').replace(/[“”"'’:,.;!?()]/g, ' ').split(/\s+/).filter(Boolean);
  const caps = toks.filter((w, i) => /^[A-Z][a-zA-Z]+$/.test(w) && !STOP.has(w.toLowerCase()) && !(i === 0 && w.length < 4));
  return caps.slice(0, 3).join(' ');
}

async function find(query, opts = {}) {
  query = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const want = words(query);
  if (!want.length) return null;
  const doFetch = opts.fetch || fetch;
  const u = API + '?' + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: query + ' filetype:bitmap', prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: '960',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|NonFree|Restrictions|ObjectName|ImageDescription', origin: '*',
  });
  let j;
  try {
    const r = await doFetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeout || 10000) });
    if (!r.ok) return null;
    j = await r.json();
  } catch (e) { return null; }
  const pages = ((j && j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
    if (!/^image\/(jpeg|png)$/.test(ii.mime || '')) continue;
    if ((ii.width || 0) < 640 || (ii.height || 0) < 360 || ii.height > ii.width * 1.25) continue; // landscape-ish, big enough
    const meta = ii.extmetadata || {};
    const license = freeLicense(meta); if (!license) continue;
    if (strip(meta.Restrictions && meta.Restrictions.value)) continue; // trademark, insignia, personality… skip
    // it must really be about the subject: a query word in its file name, title or description
    const about = new Set(words(String(p.title || '').replace(/^File:/, '') + ' ' + strip(meta.ObjectName && meta.ObjectName.value) + ' ' + strip(meta.ImageDescription && meta.ImageDescription.value).slice(0, 400)));
    if (!want.some(w => about.has(w))) continue;
    const url = ii.thumburl || ii.url;
    if (!/^https:\/\/upload\.wikimedia\.org\//.test(url || '')) continue;
    const by = strip(meta.Artist && meta.Artist.value).slice(0, 80) || strip(meta.Credit && meta.Credit.value).slice(0, 80) || 'Unknown author';
    return { url, page: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title || '')), by, license, title: String(p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '') };
  }
  return null;
}

module.exports = { find, queryFromHeadline, freeLicense, UA };
