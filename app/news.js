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
(function () {
  'use strict';
  const N = window.NewsChannel = { lang: localStorage.getItem('news.lang') || 'en', stories: [], loaded: false, _loading: false, i: 0 };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = (n, s) => (window.ico ? window.ico(n, s) : '');
  const hi = () => N.lang === 'hi';
  const pick = (st, k) => (hi() && st[k + '_hi']) ? st[k + '_hi'] : st[k];
  const CAT = { india: ['India', 'भारत', '#B5402A', 'landmark'], world: ['World', 'दुनिया', '#2F5FA8', 'globe'], business: ['Business', 'कारोबार', '#2F7D4F', 'trending-up'], tech: ['Tech', 'टेक', '#6D28D9', 'smartphone'], science: ['Science', 'विज्ञान', '#0E7C7B', 'rocket'] };
  const SRC = { thehindu: 'The Hindu', indianexpress: 'Indian Express', ndtv: 'NDTV', hindustantimes: 'Hindustan Times', livemint: 'Mint', economictimes: 'Economic Times', timesofindia: 'Times of India', bbc: 'BBC', bbci: 'BBC', theguardian: 'The Guardian', reuters: 'Reuters', aljazeera: 'Al Jazeera', npr: 'NPR', cnbc: 'CNBC', techcrunch: 'TechCrunch', theverge: 'The Verge', wired: 'Wired', arstechnica: 'Ars Technica', sciencedaily: 'ScienceDaily', nasa: 'NASA', scroll: 'Scroll', thewire: 'The Wire', news18: 'News18', indiatoday: 'India Today', moneycontrol: 'Moneycontrol', businessstandard: 'Business Standard' };
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
      if (window.S && S.tab === 'news') { sawEdition(); return; }
      document.body.classList.toggle('nz-fresh', seenId !== e.id);
    } catch (e) { /* offline */ }
  };
  setTimeout(() => N.checkEdition(), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') N.checkEdition(); });
  // the story on screen counts as seen after 1.5 s (only while News is what you are looking at)
  let viewT = 0;
  function watch() {
    clearTimeout(viewT);
    const st = N.stories[N.i]; if (!st || seen.ids[st.id]) return;
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
  N.load = async function () {
    N.err = false; N.caughtUp = false; N._at = Date.now();
    const P = newPass();
    try {
      let got = await page();
      for (let k = 0; k < 6 && !got.length && P === pass && P.next !== null; k++) got = await page(); // a first page of seen stories: look further
      if (P === pass) {
        N.stories = []; N.i = 0; got.forEach(keep);
        if (got.length) N.stories.unshift({ kind: 'cover' }); // v22: the edition's front page
        N.caughtUp = !got.length && P.next === null;
        sawEdition();
        // a shared link or a notification (?s=<story id>) opens on that story, even one seen before
        const want = N._want || new URLSearchParams(location.search).get('s'); N._want = null;
        if (want) await openStory(want);
      }
    } catch (e) { if (!N.stories.length) N.err = true; }
    N.loaded = true; N._loading = false;
    N.rerender();
  };
  async function openStory(id) {
    let k = N.stories.findIndex(x => x.id === id);
    if (k < 0) {
      try {
        const r = await fetch('/api/news/story/' + encodeURIComponent(id), { cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if (j && j.story && j.story.headline) { k = Math.max(isCover(N.stories[0]) ? 1 : 0, Math.min(N.i, N.stories.length)); N.stories.splice(k, 0, j.story); if (pass) pass.ids.add(j.story.id); }
      } catch (e) { /* offline */ }
    }
    if (k >= 0) { N.i = k; N.caughtUp = N.caughtUp && N.stories.length > 0; }
    else if (typeof toast === 'function') toast(hi() ? 'यह ख़बर अब उपलब्ध नहीं' : 'This story is no longer available');
    return k;
  }
  // a story link inside the app (a tapped notification, a shared link opened in the app)
  N.open = async function (id) {
    if (!id) return;
    if (!N.loaded) { N._want = id; if (!N._loading) { N._loading = true; N.load(); } return; }
    const k = await openStory(id);
    if (k >= 0) { N.rerender(); }
  };
  // Near the end: the next page goes in behind the last card (the card in view never moves). One load at a time.
  // v21: when the desk has nothing unseen left, the deck ends on "You're all caught up" (it no longer goes round again)
  N.more = async function () {
    if (N._busy || !N.loaded || !N.stories.length || !pass || N.caughtUp || Date.now() < (N._wait || 0)) return;
    N._busy = true; let added = 0;
    try {
      for (let k = 0; k < 6 && !added && pass.next !== null; k++) {
        let got;
        try { got = await page(); } catch (e) { N._wait = Date.now() + 4000; break; }
        if (got.length) { append(got); added = got.length; }
      }
      if (!added && pass.next === null) { N.caughtUp = true; appendEnd(); }
    } finally { N._busy = false; }
    if (added) near(); else if (!N.caughtUp) setTimeout(near, 4100);
  };
  N.again = function () { N.loaded = false; N.caughtUp = false; N.i = 0; N.rerender(); N._loading = true; N.load(); };
  const isCover = st => !!(st && st.kind === 'cover');
  const storyCount = () => N.stories.filter(x => !isCover(x)).length;
  // a section on the front page: the deck reloads with that section only (All clears it)
  N.setCat = function (c) { N.cat = CAT[c] ? c : ''; N.again(); };
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
    return '<article class="nz-card nz-end" data-i="' + N.stories.length + '" aria-label="' + (H ? 'सारी ख़बरें देख लीं' : 'All caught up') + '"><div class="nz-endin">' +
      '<span class="nz-endic" aria-hidden="true">' + I('check-circle', 44, 1.8) + '</span>' +
      '<h2>' + (H ? 'आपने सारी ख़बरें देख लीं' : 'You’re all caught up') + '</h2>' +
      '<p>' + esc(nextText()) + '</p>' +
      '<button class="b-btn" onclick="NewsChannel.again()">' + I('refresh-cw', 16) + (H ? 'फिर देखें' : 'Check again') + '</button></div></article>';
  }
  function near() { if (N.loaded && storyCount() && N.i >= N.stories.length - 4) N.more(); }

  N.stop = function () { clearTimeout(viewT); flushSeen(); N._leftAt = Date.now(); };   // nothing plays in News any more
  N.setLang = function (l, fromApp) { if (l === N.lang) return; N.lang = l; try { localStorage.setItem('news.lang', l); } catch (e) {} if (!fromApp && window.setAppLang) setAppLang(l, 'news'); if (N.loaded) N.again(); else N.rerender(); }; // v24: one app language
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
    setTimeout(() => { d.scrollTo({ left: 72, behavior: 'smooth' }); setTimeout(() => d.scrollTo({ left: 0, behavior: 'smooth' }), 520); }, 700);
  };
  N.rerender = function () {
    const r = document.getElementById('newsRoot');
    if (!r || !window.S || S.tab !== 'news') return;
    r.innerHTML = N.html();
    requestAnimationFrame(() => { N.size(); N.go(N.i, true); });
  };

  function cover(i) {
    const H = hi(), ed = N.edition || {}, list = N.stories.map((st, k) => [st, k]).filter(([st]) => !isCover(st)).slice(0, 5);
    const day = (() => { try { return new Date(Date.parse(ed.at || '') || Date.now()).toLocaleDateString(H ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return ''; } })();
    const label = (H ? ed.label_hi : ed.label) || (H ? 'आज की ख़बरें' : 'Today’s news');
    const chips = [['', H ? 'सब' : 'All']].concat(Object.keys(CAT).map(k => [k, H ? CAT[k][1] : CAT[k][0]]));
    // the lead story, when it has a photo, opens the page big; the rest follow as a numbered list
    const lead = list.length && list[0][0].image ? list[0] : null, rest = lead ? list.slice(1) : list;
    const lc = lead ? (CAT[lead[0].category] || ['', '', '#37352F']) : null;
    const leadHtml = lead ? '<button type="button" class="nz-cv-lead" style="--c:' + lc[2] + '" onclick="NewsChannel.go(' + lead[1] + ')"><img src="' + esc(lead[0].image) + '" alt="" onerror="this.remove()"><span class="nz-cv-lead-t' + (H ? ' dev' : '') + '"><small>' + esc((H ? lc[1] : lc[0]) || '') + (ago(lead[0].published_at) ? ' · ' + ago(lead[0].published_at) : '') + '</small><b>' + esc(pick(lead[0], 'headline')) + '</b></span></button>' : '';
    return '<article class="nz-card nz-cover" data-i="' + i + '" aria-roledescription="slide" aria-label="' + esc(label) + '"><div class="nz-cv">' +
      '<div class="nz-cv-k"><span class="nz-cv-dot" aria-hidden="true"></span><b' + (H ? ' class="dev"' : '') + '>' + esc(label) + '</b><span>' + esc(day) + '</span></div>' +
      '<h2 class="nz-cv-t' + (H ? ' dev' : '') + '">' + (H ? 'अभी की बड़ी ख़बरें' : 'The stories that matter now') + '</h2>' +
      '<div class="nz-cv-chips" role="group" aria-label="' + (H ? 'विषय' : 'Sections') + '">' + chips.map(([k, l]) => '<button type="button" class="' + ((N.cat || '') === k ? 'on' : '') + (H ? ' dev' : '') + '" aria-pressed="' + ((N.cat || '') === k) + '" onclick="NewsChannel.setCat(\'' + k + '\')">' + esc(l) + '</button>').join('') + '</div>' +
      leadHtml +
      '<ol class="nz-cv-list">' + rest.map(([st, k], n) => { const c = CAT[st.category] || ['', '', '#37352F']; return '<li><button type="button" onclick="NewsChannel.go(' + k + ')" style="--c:' + c[2] + '"><span class="nz-cv-n">' + (n + (lead ? 2 : 1)) + '</span><span class="nz-cv-h' + (H ? ' dev' : '') + '"><b>' + esc(pick(st, 'headline')) + '</b><small>' + esc((H ? c[1] : c[0]) || '') + (ago(st.published_at) ? ' · ' + ago(st.published_at) : '') + '</small></span></button></li>'; }).join('') + '</ol>' +
      '<div class="nz-cv-foot"><span>' + esc(nextText()) + '</span><button type="button" class="nz-cv-go" onclick="NewsChannel.go(1)">' + (H ? 'पढ़ना शुरू करें' : 'Start reading') + I('chevron-right', 18) + '</button></div>' +
      '</div></article>';
  }
  function card(st, i) {
    if (isCover(st)) return cover(i);
    const H = hi(), c = CAT[st.category] || ['', '', '#37352F'];
    const label = H ? c[1] : c[0];
    const src = (st.sources || []).filter(x => x && (x.name || x.link));
    const names = src.slice(0, 2).map(srcName).filter(Boolean).join(', ') + (src.length > 2 ? ' +' + (src.length - 2) : '');
    const share = '<button class="nz-share" onclick="NewsChannel.share(' + i + ')" aria-label="' + (H ? 'शेयर करें' : 'Share') + '">' + I('share-2', 20) + '</button>';
    // the section and how fresh it is sit on the photo, so the story starts with its headline
    const tag = '<div class="nz-tag">' + (label ? '<b' + (H ? ' class="dev"' : '') + '>' + esc(label) + '</b>' : '') + (ago(st.published_at) ? '<span>' + ago(st.published_at) + '</span>' : '') + '</div>';
    // No real photo: a panel in the category's colour holds the same slot, so every card reads the same way.
    const ph = '<div class="nz-img ph"><span aria-hidden="true">' + I(c[3] || 'newspaper', 72, 1.4) + '</span>' + tag + share + '</div>';
    const img = st.image ? '<div class="nz-img"><img class="nz-fg" src="' + esc(st.image) + '" alt="" loading="' + (i < 4 ? 'eager' : 'lazy') + '" onerror="NewsChannel.noimg(this)">' + tag + share + '</div>' : ph;
    const why = pick(st, 'why');
    return '<article class="nz-card' + (st.image ? '' : ' noimg') + '" data-i="' + i + '" data-id="' + esc(st.id || '') + '" style="--c:' + c[2] + '" aria-roledescription="slide" aria-label="' + esc(pick(st, 'headline')) + '">' + img +
      '<div class="nz-body">' +
      '<h2 class="' + (H && st.headline_hi ? 'dev' : '') + '">' + esc(pick(st, 'headline')) + '</h2>' +
      '<p class="nz-text' + (H && st.summary_hi ? ' dev' : '') + '">' + esc(pick(st, 'summary')) + '</p>' +
      (why ? '<div class="nz-why' + (H ? ' dev' : '') + '"><b>' + (H ? 'यह क्यों मायने रखता है' : 'Why it matters') + '</b>' + esc(why) + '</div>' : '') +
      (names ? '<button type="button" class="nz-srcs" onclick="NewsChannel.sources(' + i + ')">' + I('newspaper', 16) + '<span>' + (H ? 'स्रोत: ' : 'Sources: ') + esc(names) + '</span>' + I('chevron-right', 16) + '</button>' : '') +
      '</div></article>';
  }
  // the original reports behind a story
  N.sources = function (i) {
    const st = N.stories[i]; if (!st || isCover(st)) return;
    const H = hi(), list = (st.sources || []).filter(x => x && /^https?:\/\//.test(x.link || ''));
    document.getElementById('nzSrc')?.remove();
    const bg = document.createElement('div'); bg.className = 'nz-sheet-bg'; bg.id = 'nzSrc';
    bg.innerHTML = '<div class="nz-sheet" role="dialog" aria-modal="true" aria-label="' + (H ? 'स्रोत' : 'Sources') + '"><div class="nz-grab" aria-hidden="true"></div>' +
      '<b class="nz-sh-t">' + (H ? 'मूल रिपोर्टें' : 'The original reports') + '</b><p class="nz-sh-p">' + (H ? 'यह ख़बर इन रिपोर्टों से लिखी गई है।' : 'Brodoit wrote this story from these reports.') + '</p>' +
      list.map(x => '<a class="nz-sh" href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">' + I('external-link', 22) + '<span><b>' + esc(srcName(x)) + '</b><small>' + esc(x.title || x.link) + '</small></span></a>').join('') +
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

  N.html = function () {
    const H = hi(), list = N.stories, n = list.length;
    const hud = '<div class="nz-hud"><div class="nz-lang" role="group" aria-label="Language"><button class="' + (H ? '' : 'on') + '" aria-pressed="' + !H + '" aria-label="English" onclick="NewsChannel.setLang(\'en\')">EN</button><button class="' + (H ? 'on' : '') + '" aria-pressed="' + H + '" aria-label="हिंदी" onclick="NewsChannel.setLang(\'hi\')">हिं</button></div></div>';
    if (!N.loaded) return '<div class="nz"><div class="nz-stage"><div class="nz-deck" id="nzDeck"><article class="nz-card skel"><div class="nz-img"></div><div class="nz-body"><i></i><i></i><i></i><i></i></div></article></div></div></div>';
    if (!n && N.err) return '<div class="nz"><div class="nz-empty"><span class="nz-emic" aria-hidden="true">' + I('wifi-off', 40, 1.8) + '</span><b>' + (H ? 'ख़बरें लोड नहीं हुईं' : 'Couldn’t load the news') + '</b><button class="b-chip" onclick="NewsChannel.loaded=false;NewsChannel.rerender();NewsChannel.load()">' + I('refresh-cw', 14) + (H ? 'फिर कोशिश करें' : 'Try again') + '</button></div></div>';
    if (!n && N.caughtUp) return '<div class="nz"><div class="nz-empty"><span class="nz-emic" aria-hidden="true">' + I('check-circle', 40, 1.8) + '</span><b>' + (H ? 'आपने सारी ख़बरें देख लीं' : 'You’re all caught up') + '</b><span>' + esc(nextText()) + '</span><button class="b-chip" onclick="NewsChannel.again()">' + I('refresh-cw', 14) + (H ? 'फिर देखें' : 'Check again') + '</button></div></div>';
    if (!n) return '<div class="nz"><div class="nz-empty"><span class="nz-emic" aria-hidden="true">' + I('newspaper', 40, 1.8) + '</span><b>' + (H ? 'ख़बरें आ रही हैं' : 'Stories are on the way') + '</b></div></div>';
    return '<div class="nz"><div class="nz-stage"><div class="nz-prog" aria-hidden="true"><i id="nzProg"></i></div><div class="nz-deck" id="nzDeck" tabindex="0" aria-label="' + (H ? 'ख़बरें' : 'News') + '">' + list.map((st, i) => card(st, i)).join('') + (N.caughtUp ? endCard() : '') + '</div>' + hud +
      '<button class="nz-nav prev" aria-label="Previous" onclick="NewsChannel.go(NewsChannel.i-1)">' + I('chevron-left', 22) + '</button><button class="nz-nav next" aria-label="Next" onclick="NewsChannel.go(NewsChannel.i+1)">' + I('chevron-right', 22) + '</button></div></div>';
  };

  // The deck fills the space between the header and the tab bar on any phone.
  N.size = function () {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const bar = document.querySelector('.tabs.page-t') || document.querySelector('.rd-tabbar'); const r = bar && bar.getBoundingClientRect();
    const bottom = r && r.top > innerHeight * 0.6 ? r.top : innerHeight - 24;
    const h = Math.max(240, Math.floor(bottom - d.getBoundingClientRect().top - 10));
    d.style.height = h + 'px';
    fitNear();
    if (document.fonts && !N._fontsHook) { N._fontsHook = true; document.fonts.ready.then(() => fitNear()); }
    if (!d._wired) {
      d._wired = true;
      let t = 0;
      d.addEventListener('scroll', () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => { const k = Math.max(0, Math.min(count() - 1, Math.round(d.scrollLeft / Math.max(1, d.clientWidth)))); if (k !== N.i) { const was = N.i; N.i = k; moved(was); } }); }, { passive: true });
      d.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); N.go(N.i + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); N.go(N.i - 1); } });
    }
  };
  // Fit one card: the photo holds 40% of the card on every story so the headline sits at the same height as you swipe.
  // If the story is long the type steps down first, then the photo gives way to a 34% floor, and only then does the
  // text scroll inside the card (never cut off). Landscape phones lay the card out side by side (photo left).
  // Only the cards around the one in view are fitted, so a deck of hundreds stays quick.
  // The front page never scrolls inside itself: the list keeps only the stories that fit whole above "Start reading"
  // (which goes through all of them). On a very short screen the lead photo gets shorter first; only if one story
  // still can't fit does the page scroll. Not cached by size, so it refits once the fonts (Hindi) have loaded.
  function fitCover(cardEl) {
    const cv = cardEl.querySelector('.nz-cv'); if (!cv || !cv.clientHeight) return;
    const rows = Array.from(cv.querySelectorAll('.nz-cv-list li')), lead = cv.querySelector('.nz-cv-lead');
    rows.forEach(li => { li.style.display = ''; }); if (lead) lead.style.height = '';
    cv.classList.remove('scroll');
    const over = () => cv.scrollHeight > cv.clientHeight + 1;
    for (let k = rows.length - 1; k >= 1 && over(); k--) rows[k].style.display = 'none';
    if (over() && lead) lead.style.height = Math.max(120, lead.offsetHeight - (cv.scrollHeight - cv.clientHeight)) + 'px';
    if (over() && rows.length) rows[0].style.display = 'none';
    if (over()) cv.classList.add('scroll');
  }
  function fit(cardEl) {
    if (cardEl.classList.contains('nz-cover')) return fitCover(cardEl);
    const H = cardEl.clientHeight, body = cardEl.querySelector('.nz-body'), img = cardEl.querySelector('.nz-img');
    if (!H || !body) return;
    cardEl.classList.remove('sm', 'xs', 'scroll');
    const row = getComputedStyle(cardEl).flexDirection === 'row';
    const over = () => body.scrollHeight > body.clientHeight + 1;
    let ih = img && !row ? Math.round(H * 0.40) : 0;
    if (img) img.style.height = row ? '' : ih + 'px';
    if (over()) cardEl.classList.add('sm');
    if (over()) cardEl.classList.add('xs');
    while (img && !row && over() && ih > H * 0.34) { ih -= 8; img.style.height = ih + 'px'; }
    if (over()) cardEl.classList.add('scroll');
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
    for (let k = was; k < N.i; k++) markSeen(N.stories[k]); // swiped past: seen
    watch();
  }
  N.go = function (k, instant) {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const was = N.i;
    N.i = Math.max(0, Math.min(count() - 1, k | 0));
    d.scrollTo({ left: N.i * d.clientWidth, behavior: instant ? 'auto' : 'smooth' });
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
    const W = 1080, H = 1920, P = 72, c = (CAT[st.category] || ['', '', '#37352F']);
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
    let y = imgH + 64;
    x.fillStyle = c[2]; x.font = '800 30px ' + sans;
    const label = (hi() ? c[1] : c[0]) || ''; if (label) { x.fillText(label.toUpperCase(), P, y + 22); }
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
