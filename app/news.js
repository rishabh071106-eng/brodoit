// Brodoit News (v16): one story per screen, swiped left and right. A big real photo, the full story (never cut off),
// its source, and one Share button. No audio, no counters.
// Mounted into the SPA's News tab: the shell calls NewsChannel.html(), .load(), reads .loaded/._loading,
// and .stop() when leaving the tab. Stories come from the News Desk (modules/newsdesk.js), a page at a time:
// near the end of the deck the next, older page is added behind the last card.
// v21: a story that was on screen for 1.5 s (or swiped past) is seen and never comes back, nor a rewrite of it: this
// phone keeps the list (localStorage news.seen.v1, 30 days) and a signed-in reader's server does too (POST
// /api/news/seen), so it holds on every phone. When nothing unseen is left the deck ends on "You're all caught up"
// (no going round again). Share opens a sheet: the story as a picture (with its brodoit.com/n/<id> link and a QR code),
// the link, or copy the link. No Bro in News.
// v22: News comes in three editions a day (7 am, 1 pm, 7 pm India time). The deck opens on the edition's front page (its
// top headlines, tap one to jump to it; the sections; when the next edition comes), then the stories: each with
// "Why it matters" and its sources (tap: the original reports). A slim bar shows how far you are. Hindi shows only the
// stories written in Hindi (the server sends ?lang=hi), never English ones. A dot on the News tab says a new edition
// is in.
// v28: News opens straight on the first story (no front page). A bar under the story holds the sections (Top, AI, India,
// World, Business, Tech, Science), Readers (pieces readers sent, checked by Brodoit's AI editor), Thought of the day (an
// original thought and the story behind it) and Send (write for Brodoit). Every card has a free photo with its credit.
// v29: the short-news reader. One story fills the screen and you swipe UP for the next (down for the one before); the
// card you leave stays put and the next one slides over it. The photo runs edge to edge with its credit; the story
// always fits its card (the type steps down, the photo gives way, then the text ends on a whole line with "Read the
// full story"), never scrolling inside it. Swipe LEFT (or tap the strip at the bottom) for the original reports. A
// bookmark keeps a story in Saved (on this phone). News opens at once on the stories from your last visit while the
// new ones load, and a "New stories" pill appears when an edition comes in while you read.
(function () {
  'use strict';
  const N = window.NewsChannel = { lang: localStorage.getItem('news.lang') || 'en', stories: [], loaded: false, _loading: false, i: 0 };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = (n, s) => (window.ico ? window.ico(n, s) : '');
  const hi = () => N.lang === 'hi';
  const pick = (st, k) => (hi() && st[k + '_hi']) ? st[k + '_hi'] : st[k];
  const CAT = { india: ['India', 'भारत', '#B5402A', 'landmark'], world: ['World', 'दुनिया', '#2F5FA8', 'globe'], ai: ['AI', 'AI', '#A21CAF', 'sparkles'], business: ['Business', 'कारोबार', '#2F7D4F', 'trending-up'], tech: ['Tech', 'टेक', '#6D28D9', 'smartphone'], science: ['Science', 'विज्ञान', '#0E7C7B', 'rocket'], life: ['Life', 'जीवन', '#A0570F', 'sun'] };
  // v28: the bar under the story: the sections in this order, then Readers
  const BAR = ['', 'ai', 'india', 'world', 'business', 'tech', 'science'];
  const SRC = { thehindu: 'The Hindu', indianexpress: 'Indian Express', ndtv: 'NDTV', hindustantimes: 'Hindustan Times', livemint: 'Mint', economictimes: 'Economic Times', timesofindia: 'Times of India', bbc: 'BBC', bbci: 'BBC', theguardian: 'The Guardian', reuters: 'Reuters', aljazeera: 'Al Jazeera', npr: 'NPR', cnbc: 'CNBC', techcrunch: 'TechCrunch', theverge: 'The Verge', wired: 'Wired', arstechnica: 'Ars Technica', sciencedaily: 'ScienceDaily', nasa: 'NASA', scroll: 'Scroll', thewire: 'The Wire', news18: 'News18', indiatoday: 'India Today', moneycontrol: 'Moneycontrol', businessstandard: 'Business Standard', pibgovin: 'PIB · Govt of India', rbiorgin: 'Reserve Bank of India', newsun: 'UN News', whoint: 'WHO', nasagov: 'NASA', openai: 'OpenAI', deepmindgoogle: 'Google DeepMind', bloggoogle: 'Google', huggingfaceco: 'Hugging Face', huggingface: 'Hugging Face', blogsnvidia: 'NVIDIA', newsmitedu: 'MIT News', technologyreview: 'MIT Technology Review', analyticsindiamag: 'Analytics India Magazine' };
  const srcName = x => { const k = String(x && x.name || '').toLowerCase().replace(/^www\./, '').replace(/\.(com|in|co\.in|co\.uk|org|net)$/, '').replace(/[^a-z]/g, ''); return SRC[k] || String(x && x.name || '').replace(/^www\./, ''); };
  const ago = d => { const t = Date.parse(d || ''); if (!t) return ''; const m = Math.max(1, Math.round((Date.now() - t) / 60000)), H = hi(); return m < 60 ? m + (H ? ' मि' : 'm') : m < 1440 ? Math.round(m / 60) + (H ? ' घं' : 'h') : Math.round(m / 1440) + (H ? ' दि' : 'd'); };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॣ०-ॿ]+/g, ' ').trim();

  // ── No repeats, without losing real stories: the same id is dropped, and so is a headline that says the same
  // thing in nearly the same meaningful words (Jaccard ≥ 0.7, only when both have 4+). Words every headline uses
  // ("the", "says", "India", "के", "भारत" …) never count, so unrelated stories are not taken for each other.
  const STOP = new Set((
    'a an the of to in on at by for from with without into onto over under after before about above below across against along amid among around ' +
    'as is are was were be been being am it its this that these those there here their them they he she his her him we our you your me my ' +
    'and or but nor so yet if then than also not no yes up down out off more most less very much many some any all each every both few other such ' +
    'just only even still will would can could may might must shall should do does did done has have had get gets got make makes made take takes took ' +
    'what why how who whom whose when where which while new says said say tells told report reports reported via per vs now today tonight ' +
    'yesterday tomorrow week weeks month months year years day days time first last next top big india indian indians indias ' +
    'के का की को में से पर ने है हैं था थी थे और या भी तो ही एक यह वह ये वो इस उस इन उन लिए साथ बाद पहले बीच तक कि जो जब अब ' +
    'कर करें करने किया किए गया गई गए हुआ हुई हुए हो होगा होगी होंगे रहा रही रहे दिया दी नए नई नया कहा कहते बताया भारत भारतीय देश आज'
  ).split(/\s+/).filter(Boolean));
  const sig = s => { const w = new Set(); for (const x of norm(s).split(' ')) if (x.length > 1 && !STOP.has(x)) w.add(x); return w; };
  const same = (a, b) => { if (a.size < 4 || b.size < 4) return false; let n = 0; a.forEach(w => { if (b.has(w)) n++; }); return n / (a.size + b.size - n) >= 0.7; };
  const jac = (a, b) => { let n = 0; a.forEach(w => { if (b.has(w)) n++; }); return n / (a.size + b.size - n || 1); };

  // ── v21: seen memory. ids for 30 days; each story's words (headline + its opening) for 14 days ──
  const SEEN_KEY = 'news.seen.v1', DAY = 864e5;
  const seenSig = st => sig(String(st.headline || '') + ' ' + String(st.summary || '').slice(0, 140));
  const seen = (() => {
    let j = {}; try { j = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { j = {}; }
    const now = Date.now(), ids = {}, sigs = [];
    for (const [id, t] of Object.entries(j.ids || {})) if (now - t < 30 * DAY) ids[id] = t;
    for (const x of Array.isArray(j.sigs) ? j.sigs : []) if (Array.isArray(x) && now - x[0] < 14 * DAY && x[1]) sigs.push([x[0], x[1], new Set(String(x[1]).split(' '))]);
    return { ids, sigs: sigs.slice(-800), queue: [] };
  })();
  function saveSeen() {
    try {
      const ids = Object.entries(seen.ids).sort((a, b) => b[1] - a[1]).slice(0, 4000);
      localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: Object.fromEntries(ids), sigs: seen.sigs.map(x => [x[0], x[1]]) }));
    } catch (e) { /* storage full or blocked */ }
  }
  const isSeen = st => { if (st.id && seen.ids[st.id]) return true; const w = seenSig(st); if (w.size < 3) return false; return seen.sigs.some(x => jac(w, x[2]) >= 0.45); };
  N.isSeen = isSeen;
  function markSeen(st) {
    if (!st || !st.id || seen.ids[st.id]) return;
    const now = Date.now(), w = seenSig(st);
    seen.ids[st.id] = now;
    if (w.size >= 3) { seen.sigs.push([now, [...w].join(' '), w]); if (seen.sigs.length > 800) seen.sigs.shift(); }
    saveSeen();
    seen.queue.push(st.id); clearTimeout(seen.t); seen.t = setTimeout(flushSeen, 3000);
  }
  function flushSeen() {
    clearTimeout(seen.t);
    const ids = seen.queue.splice(0, 200); if (!ids.length) return;
    let tok = ''; try { tok = localStorage.getItem('tf_token') || ''; } catch (e) { tok = ''; }
    if (!tok) return;
    try { fetch('/api/news/seen', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-token': tok }, body: JSON.stringify({ ids }) }).catch(() => {}); } catch (e) { /* offline */ }
    if (seen.queue.length) seen.t = setTimeout(flushSeen, 1000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeen(); });
  addEventListener('pagehide', flushSeen);

  // ── v29: Saved (the bookmark on a card; kept on this phone, newest first, up to 100) and the last deck (News opens on
  // it at once while the new stories load; per language, 36 hours) ──
  const SAVED_KEY = 'news.saved.v1';
  const KEEP = ['id', 'kind', 'reader', 'name', 'day', 'category', 'headline', 'summary', 'why', 'headline_hi', 'summary_hi', 'why_hi', 'image', 'image_credit', 'sources', 'published_at'];
  const slim = st => { const o = {}; for (const k of KEEP) if (st[k] != null && st[k] !== '') o[k] = st[k]; return o; };
  const saved = (() => { let a = []; try { a = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch (e) { a = []; } return Array.isArray(a) ? a.filter(x => x && x.id && x.headline && x.summary) : []; })();
  const isSaved = id => !!id && saved.some(x => x.id === id);
  N.savedCount = () => saved.length;
  function storeSaved() { try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, 100))); } catch (e) { /* storage full or blocked */ } }
  const deckKey = () => 'news.deck.v1.' + (hi() ? 'hi' : 'en');
  function keepDeck(list) {
    if (N.cat || N.view !== 'news' || !list.length) return;
    try { localStorage.setItem(deckKey(), JSON.stringify({ at: Date.now(), edition: N.edition || null, stories: list.slice(0, 12).map(slim) })); } catch (e) { /* storage full or blocked */ }
  }
  function lastDeck() {
    try {
      const j = JSON.parse(localStorage.getItem(deckKey()) || 'null');
      if (!j || !Array.isArray(j.stories) || Date.now() - (j.at || 0) > 36 * 3600e3) return null;
      const list = j.stories.filter(st => st && st.id && st.headline && st.summary && !isSeen(st));
      return list.length ? { list, edition: j.edition } : null;
    } catch (e) { return null; }
  }
  // v22: a dot on the News tab when an edition is in that this phone has not opened yet
  function sawEdition() {
    const id = N.edition && N.edition.id; if (!id) return;
    try { localStorage.setItem('news.edition.seen', id); } catch (e) { /* ignore */ }
    document.body.classList.remove('nz-fresh');
  }
  N.checkEdition = async function () {
    try {
      const r = await fetch('/api/news/edition', { cache: 'no-store' }); if (!r.ok) return;
      const e = await r.json(); if (!e || !e.ready || !e.id) return;
      N.edition = N.edition && N.edition.id === e.id ? N.edition : e;
      let seenId = ''; try { seenId = localStorage.getItem('news.edition.seen') || ''; } catch (x) { seenId = ''; }
      // v29: a new edition came in while the deck shows an older one: a pill offers the new stories (nothing jumps)
      if (window.S && S.tab === 'news' && N.view === 'news' && N.loaded && N._ed && e.id !== N._ed) { N._newEd = e.id; pill(); }
      if (window.S && S.tab === 'news') { sawEdition(); return; }
      document.body.classList.toggle('nz-fresh', seenId !== e.id);
    } catch (e) { /* offline */ }
  };
  setTimeout(() => N.checkEdition(), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') N.checkEdition(); });
  // while News is open, look for a new edition every 10 minutes
  setInterval(() => { if (window.S && S.tab === 'news' && document.visibilityState === 'visible') N.checkEdition(); }, 10 * 60e3);
  function pill() {
    const st = document.querySelector('#newsRoot .nz-stage'); if (!st || !N._newEd || N.view !== 'news') return;
    if (st.querySelector('.nz-new')) return;
    st.insertAdjacentHTML('beforeend', '<button type="button" class="nz-new" onclick="NewsChannel.fresh()">' + I('arrow-up', 16) + '<span' + (hi() ? ' class="dev"' : '') + '>' + (hi() ? 'नई ख़बरें' : 'New stories') + '</span></button>');
  }
  N.fresh = function () { N._newEd = null; document.querySelectorAll('.nz-new').forEach(x => x.remove()); N.cat = N.cat || ''; delete V.news; if (N.view !== 'news') { saveView(); N.view = 'news'; } N.again(); };
  // the story on screen counts as seen after 1.5 s (only while News is what you are looking at)
  let viewT = 0;
  function watch() {
    clearTimeout(viewT);
    const st = N.stories[N.i]; if (N.view !== 'news' || !st || seen.ids[st.id]) return;
    viewT = setTimeout(() => { if (window.S && S.tab === 'news' && document.visibilityState === 'visible' && N.stories[N.i] === st) markSeen(st); }, 1500);
  }

  // A pass is one walk from the newest story back to the oldest the server has. Repeats are dropped within a pass;
  // when a pass runs dry the next one starts from the newest again.
  let pass = null;
  const newPass = () => (pass = { ids: new Set(), got: [], heads: [], next: undefined });
  function take(P, list) {
    const out = [];
    for (const st of list) {
      if (!st || !st.headline || !st.summary) continue;
      const key = st.id || 'h:' + st.headline;
      if (P.ids.has(key)) continue;
      P.ids.add(key); if (st.id) P.got.push(String(st.id));
      if (isSeen(st)) continue;                                // v21: on screen once already (or a rewrite of it)
      const w = sig(st.headline);
      if (P.heads.some(h => same(w, h))) continue;
      P.heads.push(w); out.push(st);
    }
    return out;
  }
  // one page: the first is today's ranked desk; after it, `before` = the server's cursor (or the oldest story it sent)
  async function page() {
    const P = pass, first = P.next === undefined, qs = ['limit=' + (first ? 40 : 20)];
    if (hi()) qs.push('lang=hi');
    if (N.cat) qs.push('cat=' + encodeURIComponent(N.cat));
    if (!first) {
      qs.push('before=' + encodeURIComponent(P.next));
      const g = P.got, ex = g.length > 200 ? g.slice(0, 40).concat(g.slice(-160)) : g;
      if (ex.length) qs.push('exclude=' + ex.map(encodeURIComponent).join(','));
    }
    // signed in: the server leaves out what this reader saw on any phone (v21)
    let tok = ''; try { tok = localStorage.getItem('tf_token') || ''; } catch (e) { tok = ''; }
    const r = await fetch('/api/news/desk?' + qs.join('&'), { cache: 'no-store', headers: tok ? { 'x-token': tok } : {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), list = j && Array.isArray(j.stories) ? j.stories : [];
    if (P !== pass) return [];                                 // a reload started a new walk meanwhile
    if (j && j.edition) N.edition = j.edition;
    const had = P.ids.size, kept = take(P, list);
    if (j && 'next' in j) P.next = j.next || null;
    else { const t = list.map(s => Date.parse((s && s.published_at) || '')).filter(x => x > 0); P.next = t.length ? new Date(Math.min(...t)).toISOString() : null; }
    if (P.ids.size === had) P.next = null;                     // nothing new came back: this walk is over
    return kept;
  }
  function keep(st) {
    N.stories.push(st);
  }
  // v28: four views share the deck: news (the desk, by section), readers, thought, and send (the form). Each keeps its
  // own cards and place while another is open; the shell's load() call loads whichever view is open.
  N.view = 'news';
  const V = {};
  const saveView = () => { if (N.view !== 'send') V[N.view] = { stories: N.stories, i: N.i, caughtUp: N.caughtUp, loaded: N.loaded, err: N.err, at: N._at || Date.now() }; };
  N.load = function () {
    if (N.view === 'thought') return loadThought();
    if (N.view === 'readers') return loadReaders();
    if (N.view === 'saved') return loadSaved();
    if (N.view === 'send') { N.loaded = true; N._loading = false; N.rerender(); loadMine(); return Promise.resolve(); }
    return loadNews();
  };
  async function loadNews() {
    N.err = false; N.caughtUp = false; N._at = Date.now();
    const P = newPass();
    // v29: the first time News opens on this visit, the stories from last time show at once (unseen ones only) while
    // the new ones load; a shared link (?s=) waits for the real deck
    let early = null;
    if (!N._booted && !N.cat && !N._want && !new URLSearchParams(location.search).get('s')) {
      early = lastDeck();
      if (early) { N.stories = early.list; N.i = 0; N.edition = N.edition || early.edition; N.loaded = true; N.rerender(); }
    }
    N._booted = true;
    let got = [], err = false;
    try {
      got = await page();
      for (let k = 0; k < 6 && !got.length && P === pass && P.next !== null; k++) got = await page(); // a first page of seen stories: look further
    } catch (e) { err = true; }
    if (P !== pass) return;
    // opened something else meanwhile: keep the stories for when News comes back
    if (N.view !== 'news') { V.news = { stories: got, i: 0, caughtUp: !got.length && P.next === null, loaded: !err, err: err && !got.length, at: Date.now() }; N._loading = false; return; }
    N._ed = N.edition && N.edition.id;
    if (early && N.loaded && N.stories === early.list) {
      // the reader may be on one of last time's stories: keep those up to the one on screen, then the new ones after
      const kept = N.stories.slice(0, N.i + 1), ks = kept.map(x => sig(x.headline));
      kept.forEach(x => pass.ids.add(x.id));
      const rest = got.filter(x => !kept.some(k => k.id === x.id) && !ks.some(w => same(w, sig(x.headline))));
      if (err && !got.length) { N.loaded = true; N._loading = false; return; }   // offline: last time's stories stay
      N.stories = kept.concat(rest);
      N.caughtUp = !err && !rest.length && P.next === null;
      N.err = false; N.loaded = true; N._loading = false;
      keepDeck(got); sawEdition(); N.rerender();
      return;
    }
    N.stories = []; N.i = 0; got.forEach(keep);
    N.caughtUp = !err && !got.length && P.next === null;
    N.err = err && !got.length;
    keepDeck(got);
    sawEdition();
    // a shared link or a notification (?s=<story id>) opens on that story, even one seen before
    const want = N._want || new URLSearchParams(location.search).get('s'); N._want = null;
    if (want && !/^(th|rd)_/.test(want)) await openStory(want);
    N.loaded = true; N._loading = false;
    N.rerender();
    if (want && /^(th|rd)_/.test(want)) N.open(want); // a shared thought or reader's piece
  }
  // Thought of the day: today first, then the six days before (swipe for yesterday's)
  async function loadThought() {
    N.err = false; N.caughtUp = false; N._at = Date.now();
    let items = [], err = false;
    try { const r = await fetch('/api/news/thought', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); items = ((await r.json()) || {}).items || []; } catch (e) { err = true; }
    const list = items.filter(x => x && x.thought).map(x => Object.assign({ kind: 'thought', headline: x.thought, summary: x.story, headline_hi: x.thought_hi, summary_hi: x.story_hi, category: 'life' }, x));
    if (N.view !== 'thought') { V.thought = { stories: list, i: 0, caughtUp: false, loaded: !err, err: err && !list.length, at: Date.now() }; N._loading = false; return; }
    N.stories = list; N.i = 0; N.err = err && !list.length; N.loaded = true; N._loading = false;
    jumpTo(); N.rerender();
  }
  // Readers: what readers sent, newest first, after Brodoit's AI editor read it (Hindi: the pieces with a Hindi version)
  async function loadReaders() {
    N.err = false; N.caughtUp = false; N._at = Date.now();
    let items = [], err = false;
    try { const r = await fetch('/api/news/readers?limit=40' + (hi() ? '&lang=hi' : ''), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); items = ((await r.json()) || {}).items || []; } catch (e) { err = true; }
    const list = items.filter(x => x && x.headline && x.summary);
    if (N.view !== 'readers') { V.readers = { stories: list, i: 0, caughtUp: true, loaded: !err, err: err && !list.length, at: Date.now() }; N._loading = false; return; }
    N.stories = list; N.i = 0; N.caughtUp = !err; N.err = err && !list.length; N.loaded = true; N._loading = false;
    jumpTo(); N.rerender();
  }
  // v29: Saved: the stories this phone bookmarked, newest first
  function loadSaved() {
    N.err = false; N.caughtUp = false; N._at = Date.now();
    N.stories = saved.slice(); N.i = 0; N.loaded = true; N._loading = false;
    N.rerender(); return Promise.resolve();
  }
  // the bookmark on a card: keep the story in Saved, or take it out
  N.save = function (i) {
    const st = N.stories[i], H = hi(); if (!st || !st.id) return;
    const k = saved.findIndex(x => x.id === st.id), on = k < 0;
    if (on) saved.unshift(Object.assign(slim(st), { saved_at: Date.now() })); else saved.splice(k, 1);
    storeSaved();
    document.querySelectorAll('#nzDeck .nz-card[data-id="' + CSS.escape(st.id) + '"] .nz-save').forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? (H ? 'सहेजी गई, हटाएँ' : 'Saved, remove') : (H ? 'सहेजें' : 'Save')); });
    if (typeof toast === 'function') toast(on ? (H ? 'सहेज ली गई · नीचे "सहेजी" में' : 'Saved · find it under Saved') : (H ? '"सहेजी" से हटा दी' : 'Removed from Saved'));
    if (N.view === 'saved' && !on) { N.stories.splice(i, 1); N.i = Math.min(N.i, Math.max(0, N.stories.length - 1)); N.rerender(); }
  };
  // a link to a thought or a reader's piece (?s=th_… / rd_…) opens on it
  function jumpTo() { const want = N._want; if (!want) return; const k = N.stories.findIndex(x => x.id === want); if (k >= 0) { N.i = k; N._want = null; } }
  // open a view; the one already open goes back to its first card
  N.show = function (view, keepWant) {
    if (!keepWant) N._want = null;
    if (view === N.view) { if (view !== 'send' && N.stories.length) N.go(0); return; }
    clearTimeout(viewT); flushSeen(); saveView();
    N.view = view;
    const s = V[view];
    if (view !== 'send' && view !== 'saved' && s && s.loaded && s.stories.length && Date.now() - s.at < 10 * 60e3) { N.stories = s.stories; N.i = s.i; N.caughtUp = s.caughtUp; N.err = s.err; N.loaded = true; N._at = s.at; jumpTo(); N.rerender(); return; }
    N.stories = []; N.i = 0; N.caughtUp = false; N.err = false; N.loaded = false; N._loading = true;
    N.rerender(); N.load();
  };
  async function openStory(id) {
    let k = N.stories.findIndex(x => x.id === id);
    if (k < 0) {
      try {
        const r = await fetch('/api/news/story/' + encodeURIComponent(id), { cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if (j && j.story && j.story.headline) { k = Math.max(0, Math.min(N.i, N.stories.length)); N.stories.splice(k, 0, j.story); if (pass) pass.ids.add(j.story.id); }
      } catch (e) { /* offline */ }
    }
    if (k >= 0) { N.i = k; N.caughtUp = N.caughtUp && N.stories.length > 0; }
    else if (typeof toast === 'function') toast(hi() ? 'यह ख़बर अब उपलब्ध नहीं' : 'This story is no longer available');
    return k;
  }
  // a story link inside the app (a tapped notification, a shared link opened in the app)
  N.open = async function (id) {
    if (!id) return;
    // v28: a thought or a reader's piece opens its own view
    if (/^(th|rd)_/.test(id)) {
      N._want = id; const v = id[0] === 't' ? 'thought' : 'readers';
      if (v === 'readers') delete V.readers; // a piece just published is not in the list kept from before
      if (N.view === v && N.loaded && N.stories.some(x => x.id === id)) { jumpTo(); N.rerender(); } else if (N.view === v) N.again(); else N.show(v, true);
      return;
    }
    if (N.view !== 'news') { N._want = id; N.show('news', true); return; }
    if (!N.loaded) { N._want = id; if (!N._loading) { N._loading = true; N.load(); } return; }
    const k = await openStory(id);
    if (k >= 0) { N.rerender(); }
  };
  // Near the end: the next page goes in behind the last card (the card in view never moves). One load at a time.
  // v21: when the desk has nothing unseen left, the deck ends on "You're all caught up" (it no longer goes round again)
  N.more = async function () {
    if (N.view !== 'news' || N._busy || N._loading || !N.loaded || !N.stories.length || !pass || N.caughtUp || Date.now() < (N._wait || 0)) return;
    N._busy = true; let added = 0;
    try {
      for (let k = 0; k < 6 && !added && pass.next !== null; k++) {
        let got;
        try { got = await page(); } catch (e) { N._wait = Date.now() + 4000; break; }
        if (got.length) { append(got); added = got.length; }
      }
      if (N.view !== 'news') return;
      if (!added && pass.next === null) { N.caughtUp = true; appendEnd(); }
    } finally { N._busy = false; }
    if (added) near(); else if (!N.caughtUp) setTimeout(near, 4100);
  };
  N.again = function () { delete V[N.view]; N.loaded = false; N.caughtUp = false; N.i = 0; N.rerender(); N._loading = true; N.load(); };
  const isCover = st => !!(st && st.kind === 'cover');
  const storyCount = () => N.stories.filter(x => !isCover(x)).length;
  // a section in the bar: the deck reloads with that section only (Top clears it)
  N.setCat = function (c) {
    c = CAT[c] ? c : '';
    if (N.view === 'news' && (N.cat || '') === c) { if (N.stories.length) N.go(0); return; }
    N.cat = c; delete V.news;
    if (N.view !== 'news') { saveView(); N.view = 'news'; }
    N.again();
  };
  const count = () => N.stories.length + (N.caughtUp && N.stories.length ? 1 : 0);
  function append(list) {
    const base = N.stories.length; list.forEach(keep);
    const d = document.getElementById('nzDeck'); if (!d || !window.S || S.tab !== 'news') return;
    if (d.children.length !== base) { N.rerender(); return; }
    d.insertAdjacentHTML('beforeend', list.map((st, k) => card(st, base + k)).join(''));
    fitNear();
  }
  function appendEnd() {
    const d = document.getElementById('nzDeck'); if (!d || !window.S || S.tab !== 'news') return;
    if (d.children.length !== N.stories.length) { N.rerender(); return; }
    d.insertAdjacentHTML('beforeend', endCard());
  }
  // "1 pm" / "7:30 am"; in Hindi "दोपहर 1 बजे" / "सुबह 7:30 बजे" (no am/pm inside Hindi)
  const fmtTime = iso => {
    const t = Date.parse(iso || ''); if (!t) return '';
    const d = new Date(t), h = d.getHours(), m = d.getMinutes(), hm = (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '');
    return hi() ? (h < 4 ? 'रात' : h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : h < 20 ? 'शाम' : 'रात') + ' ' + hm + ' बजे' : hm + (h < 12 ? ' am' : ' pm');
  };
  const nextText = () => { const t = fmtTime(N.edition && N.edition.next_at); return t ? (hi() ? 'अगला संस्करण ' + t : 'Next edition at ' + t) : (hi() ? 'दिन में तीन बार नई ख़बरें' : 'New stories three times a day'); };
  function endCard() {
    const H = hi();
    // v28: the end of Readers asks for the next piece
    if (N.view === 'readers') return '<article class="nz-card nz-end" data-i="' + N.stories.length + '" aria-label="' + (H ? 'और लेख' : 'More pieces') + '"><div class="nz-in"><div class="nz-endin">' +
      '<span class="nz-endic nz-endic-w" aria-hidden="true">' + I('send', 40, 1.8) + '</span>' +
      '<h2' + (H ? ' class="dev"' : '') + '>' + (H ? 'आपके पास भी कुछ है?' : 'Got something to share?') + '</h2>' +
      '<p' + (H ? ' class="dev"' : '') + '>' + (H ? 'कोई ख़बर, विचार या कहानी भेजें। Brodoit का AI संपादक हर लेख पढ़ता है।' : 'Send a news tip, a thought or a story. Brodoit\'s AI editor reads every piece.') + '</p>' +
      '<button class="b-btn" onclick="NewsChannel.show(\'send\')">' + I('send', 16) + (H ? 'लिखें' : 'Write for Brodoit') + '</button></div></div></article>';
    return '<article class="nz-card nz-end" data-i="' + N.stories.length + '" aria-label="' + (H ? 'सारी ख़बरें देख लीं' : 'All caught up') + '"><div class="nz-in"><div class="nz-endin">' +
      '<span class="nz-endic" aria-hidden="true">' + I('check-circle', 44, 1.8) + '</span>' +
      '<h2>' + (H ? 'आपने सारी ख़बरें देख लीं' : 'You’re all caught up') + '</h2>' +
      '<p>' + esc(nextText()) + '</p>' +
      '<button class="b-btn" onclick="NewsChannel.again()">' + I('refresh-cw', 16) + (H ? 'फिर देखें' : 'Check again') + '</button></div></div></article>';
  }
  function near() { if (N.view === 'news' && N.loaded && storyCount() && N.i >= N.stories.length - 4) N.more(); }

  N.stop = function () { clearTimeout(viewT); clearTimeout(mineT); flushSeen(); N._leftAt = Date.now(); };   // nothing plays in News any more
  N.setLang = function (l, fromApp) { if (l === N.lang) return; N.lang = l; try { localStorage.setItem('news.lang', l); } catch (e) {} if (!fromApp && window.setAppLang) setAppLang(l, 'news'); for (const k of Object.keys(V)) delete V[k]; if (N.view === 'send') N.rerender(); else if (N.loaded) N.again(); else N.rerender(); }; // v24: one app language (v28: every view reloads in it)
  // The shell re-renders the tab itself; size the deck and wire swiping after every render.
  N.after = function () {
    // back on News after 20 minutes away: start from what is new (everything you saw stays seen)
    if (N._leftAt && Date.now() - N._leftAt > 20 * 60e3 && N.loaded && !N._loading) { N._leftAt = 0; N.loaded = false; N._loading = true; N.load(); return; }
    N._leftAt = 0;
    requestAnimationFrame(() => { N.size(); N.go(N.i, true); N.hint(); });
  };
  N.hint = function () {
    const d = document.getElementById('nzDeck');
    if (!d || storyCount() < 2 || N._hinted) return;
    try { if (localStorage.getItem('news.swiped')) return; localStorage.setItem('news.swiped', '1'); } catch (e) { return; }
    N._hinted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // v29: the first story lifts a little and settles back: there is more below
    setTimeout(() => { d.scrollTo({ top: 96, behavior: 'smooth' }); setTimeout(() => d.scrollTo({ top: 0, behavior: 'smooth' }), 560); }, 800);
  };
  N.rerender = function () {
    const r = document.getElementById('newsRoot');
    if (!r || !window.S || S.tab !== 'news') return;
    r.innerHTML = N.html();
    requestAnimationFrame(() => { N.size(); N.go(N.i, true); N.hint(); });
  };

  // v28: every photo carries its credit: who took it, the licence, where it is from (Commons, Openverse)
  const srcOf = cr => (cr && cr.source) || 'Wikimedia Commons';
  const dayName = d => {
    const t = Date.parse((d || '') + 'T12:00:00+05:30'); if (!t) return '';
    const today = new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
    if (d === today) return hi() ? 'आज' : 'Today';
    try { return new Date(t).toLocaleDateString(hi() ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return d; }
  };
  function card(st, i) {
    const H = hi(), kind = st.kind === 'thought' ? 'thought' : st.reader ? 'reader' : 'story';
    const c = CAT[st.category] || CAT.life;
    const label = kind === 'thought' ? (H ? 'आज का विचार' : 'Thought of the day') : kind === 'reader' ? (H ? 'पाठक' : 'Reader') : (H ? c[1] : c[0]);
    const when = kind === 'thought' ? dayName(st.day) : ago(st.published_at);
    const src = (st.sources || []).filter(x => x && (x.name || x.link));
    const names = src.slice(0, 2).map(srcName).filter(Boolean).join(', ') + (src.length > 2 ? ' +' + (src.length - 2) : '');
    const share = '<button class="nz-share" onclick="NewsChannel.share(' + i + ')" aria-label="' + (H ? 'शेयर करें' : 'Share') + '">' + I('share-2', 20) + '</button>';
    // v29: the bookmark beside Share keeps the story in Saved
    const sv = isSaved(st.id), save = st.id ? '<button class="nz-save' + (sv ? ' on' : '') + '" aria-pressed="' + sv + '" onclick="NewsChannel.save(' + i + ')" aria-label="' + (sv ? (H ? 'सहेजी गई, हटाएँ' : 'Saved, remove') : (H ? 'सहेजें' : 'Save')) + '">' + I('bookmark', 20) + '</button>' : '';
    const acts = '<div class="nz-pacts">' + save + share + '</div>';
    // the section and how fresh it is sit on the photo, so the story starts with its headline
    const tag = '<div class="nz-tag">' + (label ? '<b' + (H ? ' class="dev"' : '') + '>' + esc(label) + '</b>' : '') + (when ? '<span>' + esc(when) + '</span>' : '') + '</div>';
    // no photo (rare since v28: every story gets one): a panel in the section's colour holds the same slot
    const ph = '<div class="nz-img ph"><span aria-hidden="true">' + I(kind === 'thought' ? 'sunrise' : c[3] || 'newspaper', 72, 1.4) + '</span>' + tag + acts + '</div>';
    const cr = st.image_credit ? '<small class="nz-cr">' + esc((H ? 'फ़ोटो: ' : 'Photo: ') + st.image_credit.by + ' · ' + st.image_credit.license) + '</small>' : '';
    const img = st.image ? '<div class="nz-img"><img class="nz-fg" src="' + esc(st.image) + '" alt="" loading="' + (Math.abs(i - N.i) < 3 ? 'eager' : 'lazy') + '" decoding="async" onerror="NewsChannel.noimg(this)">' + cr + tag + acts + '</div>' : ph;
    const dev = k => (H && st[k + '_hi']) ? ' dev' : '';
    // shown only when the story had to end on a whole line to fit its card: the whole story opens in a sheet
    const more = '<button type="button" class="nz-more' + (H ? ' dev' : '') + '" onclick="NewsChannel.sources(' + i + ',1)">' + (H ? 'पूरी ख़बर पढ़ें' : 'Read the full story') + I('chevron-right', 16) + '</button>';
    let body, foot = '';
    if (kind === 'thought') {
      body = '<h2 class="nz-th-t' + dev('headline') + '">' + esc(pick(st, 'headline')) + '</h2>' +
        '<b class="nz-th-k' + (H ? ' dev' : '') + '">' + (H ? 'इसके पीछे की कहानी' : 'The story behind it') + '</b>' +
        '<p class="nz-text' + dev('summary') + '">' + esc(pick(st, 'summary')) + '</p>' + more;
    } else if (kind === 'reader') {
      const by = st.name ? (H ? st.name + ' ने भेजा, एक पाठक' : 'By ' + st.name + ', a reader') : (H ? 'एक पाठक ने भेजा' : 'By a reader');
      body = '<h2 class="' + dev('headline').trim() + '">' + esc(pick(st, 'headline')) + '</h2>' +
        '<p class="nz-text' + dev('summary') + '">' + esc(pick(st, 'summary')) + '</p>' + more;
      foot = '<div class="nz-foot nz-rd"><span>' + I('user', 16) + '<b' + (H ? ' class="dev"' : '') + '>' + esc(by) + '</b>' + (st.kind === 'news' ? '<small>' + (H ? 'Brodoit ने इसकी जाँच नहीं की' : 'Not checked by Brodoit') + '</small>' : '') + '</span>' +
        '<button type="button" class="nz-rep" onclick="NewsChannel.report(' + i + ')" aria-label="' + (H ? 'शिकायत करें' : 'Report this piece') + '">' + I('flag', 18) + '</button></div>';
    } else {
      const why = pick(st, 'why');
      const official = src.some(x => x.official), primary = !official && src.some(x => x.primary);
      const chip = official ? '<em class="nz-off">' + (H ? 'आधिकारिक स्रोत' : 'Official source') + '</em>' : primary ? '<em class="nz-off nz-pri">' + (H ? 'मूल स्रोत' : 'Primary source') + '</em>' : '';
      body = '<h2 class="' + dev('headline').trim() + '">' + esc(pick(st, 'headline')) + '</h2>' +
        '<p class="nz-text' + dev('summary') + '">' + esc(pick(st, 'summary')) + '</p>' + more +
        (why ? '<div class="nz-why' + (H ? ' dev' : '') + '"><b>' + (H ? 'यह क्यों मायने रखता है' : 'Why it matters') + '</b><span>' + esc(why) + '</span></div>' : '');
      // v28: the byline: Brodoit's desk wrote it, from these reports. v29: it is the strip at the foot of the card
      // (tap it, or swipe the card left, for the original reports)
      if (names) foot = '<button type="button" class="nz-foot nz-srcs" onclick="NewsChannel.sources(' + i + ')">' + I('newspaper', 18) + '<span class="nz-fby"><small' + (H ? ' class="dev"' : '') + '>' + (H ? 'Brodoit ने लिखा · इन रिपोर्टों से' : 'Written by Brodoit · from') + '</small><b>' + esc(names) + '</b></span>' + chip + I('chevron-right', 18) + '</button>';
    }
    return '<article class="nz-card nz-k-' + kind + (st.image ? '' : ' noimg') + '" data-i="' + i + '" data-id="' + esc(st.id || '') + '" style="--c:' + c[2] + '" aria-roledescription="slide" aria-label="' + esc(pick(st, 'headline')) + '"><div class="nz-in">' + img +
      '<div class="nz-body">' + body + '</div>' + foot + '</div></article>';
  }
  // the original reports behind a story
  // v29: full = the whole story first (a card that had to end its text on a whole line, or a thought or reader's piece)
  N.sources = function (i, full) {
    const st = N.stories[i]; if (!st || isCover(st)) return;
    const H = hi(), list = (st.sources || []).filter(x => x && /^https?:\/\//.test(x.link || ''));
    const isStory = st.kind !== 'thought' && !st.reader;
    if (!full && (!isStory || !list.length)) return;
    document.getElementById('nzSrc')?.remove();
    const bg = document.createElement('div'); bg.className = 'nz-sheet-bg'; bg.id = 'nzSrc';
    const dv = k => (H && st[k + '_hi']) ? ' class="dev"' : '';
    const why = isStory && pick(st, 'why');
    const story = full ? '<div class="nz-sh-full"><h3' + dv('headline') + '>' + esc(pick(st, 'headline')) + '</h3><p' + dv('summary') + '>' + esc(pick(st, 'summary')) + '</p>' +
      (why ? '<div class="nz-why' + (H ? ' dev' : '') + '" style="--c:' + ((CAT[st.category] || CAT.life)[2]) + '"><b>' + (H ? 'यह क्यों मायने रखता है' : 'Why it matters') + '</b><span>' + esc(why) + '</span></div>' : '') + '</div>' : '';
    bg.innerHTML = '<div class="nz-sheet' + (full ? ' nz-sheet-full' : '') + '" role="dialog" aria-modal="true" aria-label="' + (full ? esc(pick(st, 'headline')) : (H ? 'स्रोत' : 'Sources')) + '"><div class="nz-grab" aria-hidden="true"></div>' + story +
      (isStory && list.length ? '<b class="nz-sh-t">' + (H ? 'मूल रिपोर्टें' : 'The original reports') + '</b><p class="nz-sh-p">' + (H ? 'Brodoit ने यह ख़बर इन रिपोर्टों के तथ्यों से अपने शब्दों में लिखी है।' : 'Brodoit wrote this story in its own words from the facts in these reports.') + '</p>' : '') +
      (isStory ? list : []).map(x => '<a class="nz-sh" href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">' + I('external-link', 22) + '<span><b>' + esc(srcName(x)) + (x.official ? ' <em class="nz-off">' + (H ? 'आधिकारिक' : 'Official') + '</em>' : x.primary ? ' <em class="nz-off nz-pri">' + (H ? 'मूल स्रोत' : 'Primary source') + '</em>' : '') + '</b><small>' + esc(x.title || x.link) + '</small></span></a>').join('') +
      (st.image_credit && /^https:\/\//.test(st.image_credit.page || '') ? '<a class="nz-sh" href="' + esc(st.image_credit.page) + '" target="_blank" rel="noopener nofollow">' + I('image', 22) + '<span><b>' + (H ? 'फ़ोटो' : 'Photo') + '</b><small>' + esc(st.image_credit.by + ' · ' + st.image_credit.license + ' · ' + srcOf(st.image_credit)) + '</small></span></a>' : '') +
      (isStory ? '<p class="nz-sh-how">' : '<p class="nz-sh-how" hidden>') + (H ? 'हर ख़बर AI लिखता है और ऐप उसे जाँचता है: हर संख्या स्रोतों में होनी चाहिए, और स्रोतों के वाक्य या फ़ोटो कभी कॉपी नहीं होते।' : 'An AI writes each story and the app checks it: every number must be in the sources, and their sentences and photos are never copied.') + ' <a href="mailto:hello@brodoit.com?subject=' + encodeURIComponent('News correction: ' + (st.headline || '')) + '">' + (H ? 'ग़लती बताएँ' : 'Report a mistake') + '</a></p>' +
      '<button type="button" class="b-btn ghost wide nz-sh-x">' + (H ? 'बंद करें' : 'Close') + '</button></div>';
    document.body.appendChild(bg);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.nz-sh-x')) close(); });
  };
  N.noimg = function (el) {
    const box = el.closest('.nz-img'), cardEl = el.closest('.nz-card'); if (!box || !cardEl) return;
    const st = N.stories[+cardEl.dataset.i] || {}, c = CAT[st.category] || [];
    cardEl.classList.add('noimg'); box.classList.add('ph');
    box.querySelectorAll('img').forEach(x => x.remove());
    const s = document.createElement('span'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = I(c[3] || 'newspaper', 72, 1.4); box.prepend(s);
  };

  // v28: the bar under the story: the sections, Readers, and Thought of the day and Send at the end
  function barHtml() {
    const H = hi(), v = N.view;
    const chip = (l, on, fn) => '<button type="button" class="nz-chip' + (on ? ' on' : '') + (H ? ' dev' : '') + '" aria-pressed="' + on + '" onclick="' + fn + '">' + esc(l) + '</button>';
    const cats = BAR.map(k => chip(k ? (H ? CAT[k][1] : CAT[k][0]) : (H ? 'मुख्य' : 'Top'), v === 'news' && (N.cat || '') === k, "NewsChannel.setCat('" + k + "')")).join('') +
      chip(H ? 'पाठक' : 'Readers', v === 'readers', "NewsChannel.show('readers')") +
      chip(H ? 'सहेजी' : 'Saved', v === 'saved', "NewsChannel.show('saved')");
    const act = (k, icon, l) => '<button type="button" class="nz-act' + (v === k ? ' on' : '') + '" aria-pressed="' + (v === k) + '" onclick="NewsChannel.show(\'' + k + '\')">' + I(icon, 20) + '<span' + (H ? ' class="dev"' : '') + '>' + l + '</span></button>';
    return '<nav class="nz-bar" id="nzBar" aria-label="' + (H ? 'ख़बरों के हिस्से' : 'News sections') + '"><div class="nz-cats" id="nzCats">' + cats + '</div>' +
      '<div class="nz-acts">' + act('thought', 'sunrise', H ? 'विचार' : 'Thought') + act('send', 'send', H ? 'भेजें' : 'Send') + '</div></nav>';
  }
  const langHtml = () => { const H = hi(); return '<div class="nz-lang" role="group" aria-label="Language"><button class="' + (H ? '' : 'on') + '" aria-pressed="' + !H + '" aria-label="English" onclick="NewsChannel.setLang(\'en\')">EN</button><button class="' + (H ? 'on' : '') + '" aria-pressed="' + H + '" aria-label="हिंदी" onclick="NewsChannel.setLang(\'hi\')">हिं</button></div>'; };

  // ── v28: Send. A reader writes a news tip, a thought or a story; Brodoit's AI editor reads it before it is published ──
  const DRAFT_KEY = 'news.draft.v1';
  N.draft = (() => { let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { d = null; } return Object.assign({ kind: 'news', title: '', text: '', link: '', show: true, own: false }, d || {}); })();
  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(N.draft)); } catch (e) { /* storage blocked */ } };
  const words = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const wcLabel = () => { const n = words(N.draft.text), H = hi(); return (H ? n + ' शब्द · 25 से 300' : n + (n === 1 ? ' word' : ' words') + ' · 25 to 300'); };
  N.draftSet = function (k, v) { N.draft[k] = v; saveDraft(); if (k === 'text') { const w = document.getElementById('nzWc'); if (w) { w.textContent = wcLabel(); w.classList.toggle('ok', words(v) >= 25 && words(v) <= 300); } } };
  N.draftKind = function (k) { N.draft.kind = k; saveDraft(); N.rerender(); };
  function sendHtml() {
    const H = hi(), d = N.draft;
    const kinds = [['news', H ? 'ख़बर' : 'News tip', 'newspaper'], ['thought', H ? 'विचार' : 'Thought', 'lightbulb'], ['story', H ? 'कहानी' : 'Story', 'book-open']];
    const ph = { news: H ? 'आपने क्या देखा या आप क्या जानते हैं? कहाँ और कब?' : 'What did you see or find out? Where and when?', thought: H ? 'आपका विचार, और उसके पीछे की बात' : 'Your thought, and what led you to it', story: H ? 'आपकी कहानी, आपके अपने शब्दों में' : 'Your story, in your own words' }[d.kind];
    const dv = H ? ' class="dev"' : '';
    return '<div class="nz-send" id="nzSend"><div class="nz-send-in">' +
      '<div class="nz-send-hd"><h2' + dv + '>' + (H ? 'Brodoit के लिए लिखें' : 'Write for Brodoit') + '</h2>' + langHtml() + '</div>' +
      '<p class="nz-send-p' + (H ? ' dev' : '') + '">' + (H ? 'कुछ ऐसा देखा जो लोगों को पता होना चाहिए? कोई विचार या कहानी है? भेजिए। Brodoit का AI संपादक हर लेख पहले पढ़ता है, सिर्फ़ वर्तनी ठीक करता है, और उसे आपके पहले नाम के साथ पाठक में छापता है।' : 'Saw something people should know, or have a thought or a story? Send it. Brodoit\'s AI editor reads every piece first, fixes only spelling and grammar, and publishes it in Readers with your first name.') + '</p>' +
      '<div class="nz-seg" role="radiogroup" aria-label="' + (H ? 'आप क्या भेज रहे हैं' : 'What you are sending') + '">' + kinds.map(k => '<button type="button" role="radio" aria-checked="' + (d.kind === k[0]) + '" class="' + (d.kind === k[0] ? 'on' : '') + '" onclick="NewsChannel.draftKind(\'' + k[0] + '\')">' + I(k[2], 18) + '<span' + dv + '>' + k[1] + '</span></button>').join('') + '</div>' +
      '<label class="nz-f"><span' + dv + '>' + (H ? 'शीर्षक' : 'Title') + '</span><input id="nzT" maxlength="120" autocomplete="off" value="' + esc(d.title) + '" oninput="NewsChannel.draftSet(\'title\',this.value)"></label>' +
      '<label class="nz-f"><span' + dv + '>' + (H ? 'आपके शब्द' : 'Your words') + '</span><textarea id="nzX" rows="7" maxlength="2400" placeholder="' + esc(ph) + '" oninput="NewsChannel.draftSet(\'text\',this.value)">' + esc(d.text) + '</textarea><small id="nzWc" class="' + (words(d.text) >= 25 && words(d.text) <= 300 ? 'ok' : '') + '">' + esc(wcLabel()) + '</small></label>' +
      (d.kind === 'news' ? '<label class="nz-f"><span' + dv + '>' + (H ? 'लिंक (ज़रूरी नहीं)' : 'Link (optional)') + '</span><input id="nzL" type="url" inputmode="url" maxlength="400" autocomplete="off" placeholder="https://" value="' + esc(d.link) + '" oninput="NewsChannel.draftSet(\'link\',this.value)"></label>' : '') +
      '<label class="nz-chk"><input type="checkbox" id="nzShow"' + (d.show ? ' checked' : '') + ' onchange="NewsChannel.draftSet(\'show\',this.checked)"><span' + dv + '>' + (H ? 'मेरा पहला नाम दिखाएँ' : 'Show my first name') + '</span></label>' +
      '<label class="nz-chk"><input type="checkbox" id="nzOwn"' + (d.own ? ' checked' : '') + ' onchange="NewsChannel.draftSet(\'own\',this.checked)"><span' + dv + '>' + (H ? 'यह मेरा अपना लिखा है, कहीं से कॉपी नहीं किया' : 'This is my own writing, not copied from anywhere') + '</span></label>' +
      '<button type="button" class="b-btn wide nz-send-go" id="nzGo" onclick="NewsChannel.submit()"' + (N._sending ? ' disabled' : '') + '>' + I('send', 18) + '<span' + dv + '>' + (N._sending ? (H ? 'भेज रहे हैं…' : 'Sending…') : (H ? 'भेजें' : 'Send')) + '</span></button>' +
      '<p class="nz-send-rules' + (H ? ' dev' : '') + '">' + (H ? 'हम कभी नहीं छापते: नफ़रत, अपमान, धमकी, अश्लील बातें, विज्ञापन, किसी का फ़ोन नंबर या पता, या किसी आम व्यक्ति पर आरोप। ख़बरों पर लिखा रहता है कि वे एक पाठक ने भेजीं।' : 'We never publish hate, insults, threats, adult content, ads, anyone\'s phone number or address, or accusations against a private person. News tips are labelled as sent by a reader.') + '</p>' +
      '<div id="nzMine">' + mineHtml() + '</div>' +
      '</div></div>';
  }
  function mineHtml() {
    const H = hi(), list = N.mine || [];
    if (!list.length) return '';
    const st = { pending: [H ? 'समीक्षा में' : 'In review', 'wait'], published: [H ? 'छप गया' : 'Published', 'ok'], rejected: [H ? 'नहीं छपा' : 'Not published', 'no'], hidden: [H ? 'हटाया गया' : 'Removed', 'no'] };
    return '<h3 class="nz-mine-t' + (H ? ' dev' : '') + '">' + (H ? 'आपके लेख' : 'Your pieces') + '</h3><ul class="nz-mine">' + list.map(x => {
      const s0 = st[x.status] || st.pending;
      return '<li><div><b>' + esc(x.title) + '</b><em class="nz-st ' + s0[1] + (H ? ' dev' : '') + '">' + esc(s0[0]) + '</em>' + (x.status === 'rejected' && x.reason ? '<small>' + esc(x.reason) + '</small>' : '') + '</div>' +
        (x.status === 'published' ? '<button type="button" class="nz-mine-b" onclick="NewsChannel.open(\'rd_' + esc(x.id) + '\')" aria-label="' + (H ? 'पढ़ें' : 'Read it') + '">' + I('chevron-right', 18) + '</button>' : '') +
        '<button type="button" class="nz-mine-b" onclick="NewsChannel.unsend(\'' + esc(x.id) + '\')" aria-label="' + (H ? 'हटाएँ' : 'Delete') + '">' + I('trash-2', 18) + '</button></li>';
    }).join('') + '</ul>';
  }
  const tok = () => { try { return localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };
  let mineT = 0;
  async function loadMine() {
    clearTimeout(mineT);
    if (!tok()) return;
    try {
      const r = await fetch('/api/news/submit/mine', { cache: 'no-store', headers: { 'x-token': tok() } });
      if (!r.ok) return;
      N.mine = ((await r.json()) || {}).items || [];
      const box = document.getElementById('nzMine'); if (box) box.innerHTML = mineHtml();
      // something still in review: look again in 20 s while Send is open
      if (N.view === 'send' && N.mine.some(x => x.status === 'pending')) mineT = setTimeout(loadMine, 20000);
    } catch (e) { /* offline */ }
  }
  N.submit = async function () {
    const H = hi(), d = N.draft;
    const fail = m => { if (typeof toast === 'function') toast(m); };
    if (String(d.title).trim().length < 6) return fail(H ? 'छोटा-सा शीर्षक लिखें' : 'Add a short title');
    if (words(d.text) < 25) return fail(H ? 'थोड़ा और लिखें: कम से कम 25 शब्द' : 'Write a little more: at least 25 words');
    if (!d.own) return fail(H ? 'पुष्टि करें कि यह आपका अपना लिखा है' : 'Please confirm this is your own writing');
    if (!tok()) return fail(H ? 'भेजने के लिए साइन इन करें' : 'Sign in to send a piece');
    N._sending = true; N.rerender();
    try {
      const r = await fetch('/api/news/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok() }, body: JSON.stringify({ kind: d.kind, title: d.title, text: d.text, link: d.kind === 'news' ? d.link : '', lang: hi() ? 'hi' : 'en', show_name: !!d.show, own: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { N._sending = false; N.rerender(); return fail(j.error || (H ? 'भेजा नहीं जा सका' : 'Could not send')); }
      N.draft = { kind: d.kind, title: '', text: '', link: '', show: d.show, own: false }; saveDraft();
      N._sending = false; N.rerender();
      fail(H ? 'भेज दिया! Brodoit का संपादक इसे पढ़ रहा है।' : 'Sent! Brodoit\'s editor is reading it.');
      loadMine();
    } catch (e) { N._sending = false; N.rerender(); fail(H ? 'भेजा नहीं जा सका' : 'Could not send'); }
  };
  N.unsend = async function (id) {
    const H = hi();
    if (!confirm(H ? 'यह लेख हटाएँ?' : 'Delete this piece?')) return;
    try { await fetch('/api/news/submit/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-token': tok() } }); } catch (e) { /* offline */ }
    delete V.readers; loadMine();
  };
  // a reader reports a piece: two reports from different people hide it at once
  N.report = async function (i) {
    const st = N.stories[i], H = hi(); if (!st || !st.reader) return;
    if (!confirm(H ? 'इस लेख की शिकायत करें? दो शिकायतों पर यह तुरंत हट जाता है।' : 'Report this piece? Two reports hide it at once.')) return;
    try {
      const r = await fetch('/api/news/readers/' + encodeURIComponent(st.id) + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok() }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (typeof toast === 'function') toast(H ? 'धन्यवाद, हम इसे देखेंगे।' : 'Thanks, we will look at it.');
      if (j && j.hidden) { N.stories.splice(i, 1); N.i = Math.min(N.i, Math.max(0, N.stories.length - 1)); N.rerender(); }
    } catch (e) { /* offline */ }
  };

  N.html = function () {
    const H = hi(), list = N.stories, n = list.length, bar = barHtml();
    if (N.view === 'send') return '<div class="nz nz-v-send">' + sendHtml() + bar + '</div>';
    const hud = '<div class="nz-hud">' + langHtml() + '</div>';
    const empty = (icon, title, sub, btn) => '<div class="nz"><div class="nz-empty" id="nzEmpty"><span class="nz-emic" aria-hidden="true">' + I(icon, 40, 1.8) + '</span><b' + (H ? ' class="dev"' : '') + '>' + title + '</b>' + (sub ? '<span' + (H ? ' class="dev"' : '') + '>' + sub + '</span>' : '') + (btn || '') + '</div>' + bar + '</div>';
    if (!N.loaded) return '<div class="nz"><div class="nz-stage"><div class="nz-deck" id="nzDeck"><article class="nz-card skel"><div class="nz-in"><div class="nz-img"></div><div class="nz-body"><i></i><i></i><i></i><i></i></div></div></article></div></div>' + bar + '</div>';
    if (!n && N.err) return empty('wifi-off', H ? 'लोड नहीं हुआ' : 'Couldn’t load this', '', '<button class="b-chip" onclick="NewsChannel.again()">' + I('refresh-cw', 14) + (H ? 'फिर कोशिश करें' : 'Try again') + '</button>');
    if (!n && N.view === 'readers') return empty('users', H ? 'अभी पाठकों का कोई लेख नहीं' : 'No pieces from readers yet', H ? 'पहला लेख आपका हो सकता है।' : 'Yours could be the first.', '<button class="b-btn" onclick="NewsChannel.show(\'send\')">' + I('send', 16) + (H ? 'लिखें' : 'Write for Brodoit') + '</button>');
    if (!n && N.view === 'saved') return empty('bookmark', H ? 'अभी कुछ सहेजा नहीं' : 'Nothing saved yet', H ? 'किसी ख़बर पर बुकमार्क दबाएँ, वह यहाँ रहेगी।' : 'Tap the bookmark on a story to keep it here.', '<button class="b-chip" onclick="NewsChannel.setCat(\'\')">' + I('newspaper', 14) + (H ? 'ख़बरें पढ़ें' : 'Read the news') + '</button>');
    if (!n && N.view === 'thought') return empty('sunrise', H ? 'आज का विचार आ रहा है' : 'Today’s thought is on its way', '', '<button class="b-chip" onclick="NewsChannel.again()">' + I('refresh-cw', 14) + (H ? 'फिर देखें' : 'Check again') + '</button>');
    if (!n && N.caughtUp) return empty('check-circle', H ? 'आपने सारी ख़बरें देख लीं' : 'You’re all caught up', esc(nextText()), '<button class="b-chip" onclick="NewsChannel.again()">' + I('refresh-cw', 14) + (H ? 'फिर देखें' : 'Check again') + '</button>');
    if (!n) return empty('newspaper', H ? 'ख़बरें आ रही हैं' : 'Stories are on the way', '');
    return '<div class="nz"><div class="nz-stage"><div class="nz-prog" aria-hidden="true"><i id="nzProg"></i></div><div class="nz-deck" id="nzDeck" tabindex="0" aria-label="' + (H ? 'ख़बरें' : 'News') + '">' + list.map((st, i) => card(st, i)).join('') + (N.caughtUp ? endCard() : '') + '</div>' + hud +
      '<button class="nz-nav prev" aria-label="' + (H ? 'पिछली' : 'Previous') + '" onclick="NewsChannel.go(NewsChannel.i-1)">' + I('chevron-up', 22) + '</button><button class="nz-nav next" aria-label="' + (H ? 'अगली' : 'Next') + '" onclick="NewsChannel.go(NewsChannel.i+1)">' + I('chevron-down', 22) + '</button>' +
      (N.view === 'news' && N._newEd ? '<button type="button" class="nz-new" onclick="NewsChannel.fresh()">' + I('arrow-up', 16) + '<span' + (H ? ' class="dev"' : '') + '>' + (H ? 'नई ख़बरें' : 'New stories') + '</span></button>' : '') + '</div>' + bar + '</div>';
  };

  // The deck fills the space between the header and the tab bar on any phone.
  N.size = function () {
    const bar = document.querySelector('.tabs.page-t') || document.querySelector('.rd-tabbar'); const r = bar && bar.getBoundingClientRect();
    const bottom = r && r.top > innerHeight * 0.6 ? r.top : innerHeight - 24;
    // v28: the News bar sits under the deck; the section in use is scrolled into view
    const nb = document.getElementById('nzBar'), room = nb ? nb.offsetHeight + 8 : 0;
    const cats = document.getElementById('nzCats'), on = cats && cats.querySelector('.nz-chip.on');
    if (on && !cats._placed) { cats._placed = true; cats.scrollLeft = Math.max(0, on.offsetLeft - (cats.clientWidth - on.offsetWidth) / 2); }
    const sp = document.getElementById('nzSend'); if (sp) sp.style.height = Math.max(240, Math.floor(bottom - sp.getBoundingClientRect().top - room - 4)) + 'px';
    const em = document.getElementById('nzEmpty'); if (em) em.style.minHeight = Math.max(200, Math.floor(bottom - em.getBoundingClientRect().top - room - 4)) + 'px';
    const d = document.getElementById('nzDeck'); if (!d) return;
    const h = Math.max(240, Math.floor(bottom - d.getBoundingClientRect().top - room - 4));
    d.style.height = h + 'px';
    fitNear();
    if (document.fonts && !N._fontsHook) { N._fontsHook = true; document.fonts.ready.then(() => fitNear()); }
    if (!d._wired) {
      d._wired = true;
      let t = 0;
      // v29: the deck runs top to bottom: the card in view is the one the deck has scrolled to
      d.addEventListener('scroll', () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => { const k = Math.max(0, Math.min(count() - 1, Math.round(d.scrollTop / Math.max(1, d.clientHeight)))); if (k !== N.i) { const was = N.i; N.i = k; moved(was); } }); }, { passive: true });
      d.addEventListener('keydown', e => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (['ArrowDown', 'PageDown', 'ArrowRight', 'j'].includes(e.key)) { e.preventDefault(); N.go(N.i + 1); }
        else if (['ArrowUp', 'PageUp', 'ArrowLeft', 'k'].includes(e.key)) { e.preventDefault(); N.go(N.i - 1); }
      });
      // v29: swipe a story LEFT for its original reports (the card follows the finger a little, then springs back)
      let g = null;
      d.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || !e.isPrimary) return; const c = e.target.closest('.nz-card'); g = c ? { id: e.pointerId, x: e.clientX, y: e.clientY, c, m: c.querySelector('.nz-in') || c, side: false } : null; });
      d.addEventListener('pointermove', e => {
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.side && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) { g.side = true; g.c.classList.add('drag'); }
        if (g.side) g.m.style.translate = Math.max(-96, Math.min(24, dx * 0.4)) + 'px 0';
      });
      const end = e => {
        if (!g || e.pointerId !== g.id) return;
        const o = g, dx = e.clientX - o.x, dy = e.clientY - o.y; g = null;
        o.c.classList.remove('drag'); o.m.style.translate = '';
        if (o.side && e.type === 'pointerup' && dx < -64 && Math.abs(dx) > Math.abs(dy) * 1.4 && o.c.classList.contains('nz-k-story')) N.sources(+o.c.dataset.i);
      };
      d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    }
  };
  // Fit one card: the photo holds 42% of the card on every story so the headline sits at the same height as you swipe.
  // If the story is long the type steps down first, then the photo gives way to a 30% floor, then "Why it matters"
  // folds to one line, and last the story's text ends on its last whole line with "Read the full story" (at least five
  // lines: on the smallest screens "Why it matters" steps aside first; it is in the sheet). The whole
  // story opens in a sheet). v29: nothing scrolls inside a card, since the deck itself scrolls up and down. Landscape
  // phones lay the card out side by side (photo left). Only the cards around the one in view are fitted, so a deck of
  // hundreds stays quick.
  function fit(cardEl) {
    const H = cardEl.clientHeight, body = cardEl.querySelector('.nz-body'), img = cardEl.querySelector('.nz-img');
    if (!H || !body) return;
    cardEl.classList.remove('sm', 'xs', 'scroll', 'tight', 'clamp', 'nowhy');
    const txt = body.querySelector('.nz-text'); if (txt) txt.style.webkitLineClamp = '';
    const row = getComputedStyle(cardEl.querySelector('.nz-in') || cardEl).flexDirection === 'row';
    const over = () => body.scrollHeight > body.clientHeight + 1;
    let ih = img && !row ? Math.round(H * 0.42) : 0;
    if (img) img.style.height = row ? '' : ih + 'px';
    if (over()) cardEl.classList.add('sm');
    if (over()) cardEl.classList.add('xs');
    while (img && !row && over() && ih > H * 0.30) { ih -= 8; img.style.height = ih + 'px'; }
    const why = body.querySelector('.nz-why');
    if (over() && why) cardEl.classList.add('tight');                 // "Why it matters" on one line
    if (over() && txt) {
      cardEl.classList.add('clamp');
      const lh = parseFloat(getComputedStyle(txt).lineHeight) || 22, all = Math.max(2, Math.round(txt.scrollHeight / lh));
      let lines = all; txt.style.webkitLineClamp = String(lines);
      while (lines > 5 && over()) { lines--; txt.style.webkitLineClamp = String(lines); }
      // the story keeps at least five lines: on the smallest screens "Why it matters" steps aside (it is in the sheet)
      if (over() && why) { cardEl.classList.add('nowhy'); lines = all; txt.style.webkitLineClamp = String(lines); while (lines > 5 && over()) { lines--; txt.style.webkitLineClamp = String(lines); } }
      while (lines > 2 && over()) { lines--; txt.style.webkitLineClamp = String(lines); }
    }
    cardEl._fit = H + 'x' + cardEl.clientWidth;
  }
  function fitNear() {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const cards = d.children;
    for (let k = Math.max(0, N.i - 2); k <= Math.min(cards.length - 1, N.i + 3); k++) { const c = cards[k]; if (c && c.classList.contains('nz-card') && c._fit !== c.clientHeight + 'x' + c.clientWidth) fit(c); }
  }
  function progress() { const b = document.getElementById('nzProg'); if (b) b.style.width = Math.round(Math.min(1, (N.i + 1) / Math.max(1, count())) * 100) + '%'; }
  function moved(was) {
    fitNear(); near(); progress(); if (was === 0 && N.i > 0) hold();
    if (N.view === 'news') for (let k = was; k < N.i; k++) markSeen(N.stories[k]); // swiped past: seen
    watch();
  }
  N.go = function (k, instant) {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const was = N.i;
    N.i = Math.max(0, Math.min(count() - 1, k | 0));
    d.scrollTo({ top: N.i * d.clientHeight, behavior: instant ? 'auto' : 'smooth' });
    moved(was);
  };
  window.addEventListener('resize', () => { if (window.S && S.tab === 'news') { N.size(); N.go(N.i, true); } });

  // The phone's back button: once you have swiped past the first story, back brings you to the newest story first.
  // One history entry at most (added when you leave the first story), never one per card; at the first story, or on
  // another tab, back does what it always did.
  function hold() {
    if (N._held || !window.S || S.tab !== 'news') return;
    try { if (!(history.state && history.state.nz)) history.pushState({ nz: 1 }, ''); N._held = true; } catch (e) { /* ignore */ }
  }
  window.addEventListener('popstate', () => {
    if (history.state && history.state.nz) { N._held = true; return; }
    if (!N._held) return;
    N._held = false;
    if (window.S && S.tab === 'news' && N.i > 0) N.go(0, N.i > 3);
    else { try { history.back(); } catch (e) { /* ignore */ } }   // the entry was ours alone: step past it
  });

  // ── Share: the story as one tall image (photo, headline, the full text, source, its brodoit.com/n/<id> link + QR) ──
  function wrap(ctx, text, maxW) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  const loadImg = src => new Promise(res => { if (!src) return res(null); const im = new Image(); if (!/^\//.test(src)) im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  // the QR code library (app/vendor/qrcode.js) loads the first time a picture is shared
  let qrLib = null;
  const loadQR = () => qrLib || (qrLib = new Promise(res => { if (window.qrcode) return res(window.qrcode); const sc = document.createElement('script'); sc.src = '/app/vendor/qrcode.js?v=1'; sc.onload = () => res(window.qrcode || null); sc.onerror = () => { qrLib = null; res(null); }; document.head.appendChild(sc); }));
  N.draw = async function (st, link) {
    const W = 1080, H = 1920, P = 72, c = (CAT[st.category] || CAT.life);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const dev = hi() && st.summary_hi;
    const serif = dev ? "'Noto Sans Devanagari', sans-serif" : "'Plus Jakarta Sans', system-ui, sans-serif"; // one family: the share image matches the app
    const sans = dev ? "'Noto Sans Devanagari', sans-serif" : "'Plus Jakarta Sans', system-ui, sans-serif";
    const head = pick(st, 'headline'), body = pick(st, 'summary');
    try { // the canvas only uses a web font that is already loaded, so load the exact faces first
      if (document.fonts && document.fonts.load) await Promise.race([Promise.all(['400 40px', '800 30px', '600 28px'].map(f => document.fonts.load(f + ' ' + sans, dev ? 'हिं' : 'Ab')).concat(document.fonts.load('600 64px ' + serif, dev ? 'हिं' : 'Ab'))), new Promise(r => setTimeout(r, 2500))]);
    } catch (e) {}
    const FOOT = 250, qr = link ? await loadQR() : null;
    const im = await loadImg(st.image);
    // no photo: the same category-colour panel and icon the card shows
    const glyph = im ? null : await loadImg('data:image/svg+xml,' + encodeURIComponent((window.ico ? ico(c[3] || 'newspaper', 24, 1.4) : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>').replace('stroke="currentColor"', 'stroke="#ffffff"').replace(/width="24" height="24"/, 'width="240" height="240"')));
    // fit: shrink the photo, then the type, until headline + every word of the story fit
    let imgH = im ? 760 : 520, hs = 64, bs = 40, lines, hl, need = 0;
    const floor = im ? 480 : 300;
    for (let k = 0; k < 40; k++) {
      x.font = '600 ' + hs + 'px ' + serif; hl = wrap(x, head, W - 2 * P);
      x.font = '400 ' + bs + 'px ' + sans; lines = wrap(x, body, W - 2 * P);
      need = imgH + 64 + 50 + hl.length * hs * 1.18 + 36 + lines.length * bs * 1.5 + FOOT + 60;
      if (need <= H) break;
      if (imgH > floor) imgH -= 60; else { hs = Math.max(44, hs - 3); bs = Math.max(28, bs - 1.5); }
    }
    if (need < H - 40) imgH += Math.min(H - 40 - need, im ? 960 - imgH : 900 - imgH); // a short story gets a taller picture, not a gap
    x.fillStyle = '#FBF8F3'; x.fillRect(0, 0, W, H);
    x.save(); x.beginPath(); x.rect(0, 0, W, imgH); x.clip();
    if (im) { // cover-crop into the top band, never past it
      const r = Math.max(W / im.width, imgH / im.height), w = im.width * r, h = im.height * r;
      try { x.drawImage(im, (W - w) / 2, (imgH - h) / 2, w, h); } catch (e) { x.fillStyle = c[2]; x.fillRect(0, 0, W, imgH); }
    } else {
      const g = x.createLinearGradient(0, 0, W, imgH); g.addColorStop(0, c[2]); g.addColorStop(1, '#17141F');
      x.fillStyle = c[2]; x.fillRect(0, 0, W, imgH); x.globalAlpha = .45; x.fillStyle = g; x.fillRect(0, 0, W, imgH); x.globalAlpha = 1;
      if (glyph) { const gs = Math.min(240, imgH * .5); x.globalAlpha = .9; x.drawImage(glyph, (W - gs) / 2, (imgH - gs) / 2, gs, gs); x.globalAlpha = 1; }
    }
    x.restore();
    if (im && st.image_credit) { // v27: a free photo travels with its credit (author · licence · Wikimedia Commons)
      const t = 'Photo: ' + st.image_credit.by + ' · ' + st.image_credit.license + ' · ' + srcOf(st.image_credit);
      x.font = '500 22px ' + sans; const tw = Math.min(W - 2 * P, x.measureText(t).width + 28);
      x.fillStyle = 'rgba(15,13,20,.6)'; x.fillRect(W - P - tw, imgH - 52, tw, 38);
      x.fillStyle = '#FFFFFF'; x.save(); x.beginPath(); x.rect(W - P - tw, imgH - 52, tw, 38); x.clip(); x.fillText(t, W - P - tw + 14, imgH - 25); x.restore();
    }
    let y = imgH + 64;
    x.fillStyle = c[2]; x.font = '800 30px ' + sans;
    const label = st.kind === 'thought' ? (hi() ? 'आज का विचार' : 'Thought of the day') : st.reader ? (hi() ? 'पाठक' : 'From a reader') : (hi() ? c[1] : c[0]) || ''; if (label) { x.fillText(hi() ? label : label.toUpperCase(), P, y + 22); }
    y += 50;
    x.fillStyle = '#17141F'; x.font = '600 ' + hs + 'px ' + serif;
    for (const l of hl) { y += hs * 1.18; x.fillText(l, P, y); }
    y += 36;
    x.fillStyle = '#3A3644'; x.font = '400 ' + bs + 'px ' + sans;
    for (const l of lines) { y += bs * 1.5; x.fillText(l, P, y); }
    // footer: the brand, where the story lives (brodoit.com/n/<id>) and a QR code of that link
    x.fillStyle = '#17141F'; x.fillRect(0, H - FOOT, W, FOOT);
    const qs = 186, qx = W - P - qs, qy = H - FOOT + (FOOT - qs) / 2;
    let drewQR = false;
    if (qr && link) {
      try {
        const q = qr(0, 'M'); q.addData(link); q.make();
        const n = q.getModuleCount(), m = 10, cell = Math.floor((qs - 2 * m) / n), off = (qs - cell * n) / 2;
        x.fillStyle = '#FFFFFF'; x.fillRect(qx, qy, qs, qs); x.fillStyle = '#17141F';
        for (let r = 0; r < n; r++) for (let c2 = 0; c2 < n; c2++) if (q.isDark(r, c2)) x.fillRect(qx + off + c2 * cell, qy + off + r * cell, cell, cell);
        drewQR = true;
      } catch (e) { drewQR = false; }
    }
    const textR = drewQR ? qx - 36 : W - P;
    x.fillStyle = '#FFFFFF'; x.font = '800 54px ' + "Georgia, serif"; x.fillText('Bro', P, H - FOOT + 92);
    const bw = x.measureText('Bro').width; x.fillStyle = '#E0603F'; x.fillText('doit', P + bw, H - FOOT + 92);
    const short = link ? link.replace(/^https?:\/\//, '') : 'brodoit.com';
    x.fillStyle = '#FFFFFF'; x.font = '700 34px ' + sans;
    let sz = 34; while (sz > 22 && x.measureText(short).width > textR - P) { sz -= 2; x.font = '700 ' + sz + 'px ' + sans; }
    x.fillText(short, P, H - FOOT + 152);
    x.fillStyle = 'rgba(255,255,255,.7)'; x.font = '600 26px ' + sans;
    const src = (st.sources || []).slice(0, 2).map(srcName).join(', ');
    const sub = (hi() ? 'पूरी ख़बर पढ़ें' : 'Read the full story') + (src ? '  ·  ' + src : '');
    x.fillText(wrap(x, sub, textR - P)[0] || '', P, H - FOOT + 200);
    return cv;
  };
  // the story's link: /n/<id> (kept 90 days on the server once shared), else the in-app link
  async function linkFor(st) {
    if (st._link) return st._link;
    try {
      const r = await fetch('/api/news/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: st.id }) });
      const j = r.ok ? await r.json() : null;
      if (j && j.url) return (st._link = j.url);
    } catch (e) { /* offline */ }
    return location.origin + '/?tab=news&s=' + encodeURIComponent(st.id);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* older phones */ }
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  const say = m => { if (typeof toast === 'function') toast(m); };
  // Share opens a sheet: the picture, the link, or copy the link. The link and the picture are made as the sheet
  // opens, so a tap shares at once (phones only share right after a tap).
  N.share = function (i) {
    const st = N.stories[i]; if (!st) return;
    const H = hi();
    document.getElementById('nzShare')?.remove();
    const bg = document.createElement('div'); bg.className = 'nz-sheet-bg'; bg.id = 'nzShare';
    bg.innerHTML = '<div class="nz-sheet" role="dialog" aria-modal="true" aria-label="' + (H ? 'शेयर करें' : 'Share') + '"><div class="nz-grab" aria-hidden="true"></div>' +
      '<b class="nz-sh-t">' + esc(pick(st, 'headline')) + '</b>' +
      '<button type="button" class="nz-sh" data-k="pic">' + I('image', 22) + '<span><b>' + (H ? 'तस्वीर शेयर करें' : 'Share picture') + '</b><small>' + (H ? 'पूरी ख़बर, लिंक और QR कोड के साथ' : 'The whole story, with its link and a QR code') + '</small></span></button>' +
      '<button type="button" class="nz-sh" data-k="link">' + I('share-2', 22) + '<span><b>' + (H ? 'लिंक शेयर करें' : 'Share link') + '</b><small>' + (H ? 'WhatsApp या किसी भी ऐप पर' : 'To WhatsApp or any app') + '</small></span></button>' +
      '<button type="button" class="nz-sh" data-k="copy">' + I('copy', 22) + '<span><b>' + (H ? 'लिंक कॉपी करें' : 'Copy link') + '</b><small class="nz-sh-url">brodoit.com/n/' + esc(st.id) + '</small></span></button>' +
      '<button type="button" class="b-btn ghost wide nz-sh-x">' + (H ? 'रहने दें' : 'Cancel') + '</button></div>';
    document.body.appendChild(bg);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.nz-sh-x')) close(); });
    const linkP = linkFor(st);
    const picP = linkP.then(link => N.draw(st, link)).then(cv => new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9))).catch(() => null);
    linkP.then(link => { const u = bg.querySelector('.nz-sh-url'); if (u) u.textContent = link.replace(/^https?:\/\//, ''); });
    bg.querySelectorAll('.nz-sh').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.k, head = pick(st, 'headline');
      try {
        const link = await linkP;
        if (k === 'copy') { close(); say(await copyText(link) ? (H ? 'लिंक कॉपी हो गया' : 'Link copied') : link); return; }
        if (k === 'link') {
          if (navigator.share) { await navigator.share({ title: head, text: head, url: link }); close(); return; }
          close(); say(await copyText(link) ? (H ? 'लिंक कॉपी हो गया' : 'Link copied') : link); return;
        }
        const blob = await picP; if (!blob) throw new Error('no image');
        const file = new File([blob], 'brodoit-news.jpg', { type: 'image/jpeg' });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: head, text: head + '\n' + link });
        } else {
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'brodoit-news.jpg'; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          await copyText(link); say(H ? 'तस्वीर सेव हुई, लिंक कॉपी हुआ' : 'Picture saved, link copied');
        }
        close();
      } catch (e) { if (e && e.name !== 'AbortError') say(H ? 'शेयर नहीं हो सका' : 'Could not share'); }
    }));
  };
})();
