// Brodoit News (v16): one story per screen, swiped left and right, without end. A big real photo, the full story
// (never cut off), its source, and one Share button that turns the story into an image. No audio, no counters.
// Mounted into the SPA's News tab: the shell calls NewsChannel.html(), .load(), reads .loaded/._loading,
// and .stop() when leaving the tab. Stories come from the News Desk (modules/newsdesk.js), a page at a time:
// near the end of the deck the next, older page is added behind the last card; when the desk has nothing older the
// deck goes round again from the newest story, so it never stops.
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
      const w = sig(st.headline);
      if (P.heads.some(h => same(w, h))) continue;
      P.heads.push(w); out.push(st);
    }
    return out;
  }
  // one page: the first is today's ranked desk; after it, `before` = the server's cursor (or the oldest story it sent)
  async function page() {
    const P = pass, first = P.next === undefined, qs = ['limit=' + (first ? 40 : 20)];
    if (!first) {
      qs.push('before=' + encodeURIComponent(P.next));
      const g = P.got, ex = g.length > 200 ? g.slice(0, 40).concat(g.slice(-160)) : g;
      if (ex.length) qs.push('exclude=' + ex.map(encodeURIComponent).join(','));
    }
    const r = await fetch('/api/news/desk?' + qs.join('&'), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), list = j && Array.isArray(j.stories) ? j.stories : [];
    if (P !== pass) return [];                                 // a reload started a new walk meanwhile
    const had = P.ids.size, kept = take(P, list);
    if (j && 'next' in j) P.next = j.next || null;
    else { const t = list.map(s => Date.parse((s && s.published_at) || '')).filter(x => x > 0); P.next = t.length ? new Date(Math.min(...t)).toISOString() : null; }
    if (P.ids.size === had) P.next = null;                     // nothing new came back: this walk is over
    return kept;
  }
  function keep(st) {
    N.stories.push(st);
    if (st.id && !N._seen.has(st.id)) { N._seen.add(st.id); N._pool.push(st); }
  }
  N.load = async function () {
    N.err = false;
    const P = newPass();
    try {
      const got = await page();
      if (P === pass) {
        N.stories = []; N._pool = []; N._seen = new Set(); N._rp = 0; got.forEach(keep);
        // a shared link (?s=<story id>) opens on that story
        const want = new URLSearchParams(location.search).get('s'); const k = want ? N.stories.findIndex(x => x.id === want) : -1; if (k >= 0) N.i = k;
      }
    } catch (e) { if (!N.stories.length) N.err = true; }
    N.loaded = true; N._loading = false;
    N.rerender();
  };
  // Near the end: the next page goes in behind the last card (the card in view never moves). One load at a time.
  N.more = async function () {
    if (N._busy || !N.loaded || !N.stories.length || !pass || Date.now() < (N._wait || 0)) return;
    N._busy = true; let added = 0;
    try {
      for (let k = 0; k < 4 && !added; k++) {                 // a page of repeats only: ask for the one after it
        const fresh = pass.next === null; if (fresh) newPass();  // caught up: round again from the newest story
        let got;
        try { got = await page(); } catch (e) { N._wait = Date.now() + 4000; got = []; k = 4; }
        if (!got.length && (fresh || k === 4)) got = replay();   // offline, or the desk is empty: go round what is here
        if (got.length) { append(got); added = got.length; }
      }
    } finally { N._busy = false; }
    if (added) near(); else setTimeout(near, 4100);           // never stuck on the last card
  };
  function replay() { const P = N._pool || [], out = []; for (let k = 0; k < Math.min(10, P.length); k++) out.push(P[(N._rp++) % P.length]); return out; }
  function append(list) {
    const base = N.stories.length; list.forEach(keep);
    const d = document.getElementById('nzDeck'); if (!d || !window.S || S.tab !== 'news') return;
    if (d.children.length !== base) { N.rerender(); return; }
    d.insertAdjacentHTML('beforeend', list.map((st, k) => card(st, base + k)).join(''));
    fitNear();
  }
  function near() { if (N.loaded && N.stories.length && N.i >= N.stories.length - 4) N.more(); }

  N.stop = function () {};                                    // nothing plays in News any more
  N.setLang = function (l) { N.lang = l; try { localStorage.setItem('news.lang', l); } catch (e) {} N.rerender(); };
  // The shell re-renders the tab itself; size the deck and wire swiping after every render.
  N.after = function () { requestAnimationFrame(() => { N.size(); N.go(N.i, true); N.hint(); }); };
  N.hint = function () {
    const d = document.getElementById('nzDeck');
    if (!d || N.stories.length < 2 || N._hinted) return;
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

  function card(st, i) {
    const c = CAT[st.category] || ['', '', '#37352F'];
    const label = hi() ? c[1] : c[0];
    const src = st.sources || [];
    const names = src.slice(0, 2).map(srcName).filter(Boolean).join(', ');
    const share = '<button class="nz-share" onclick="NewsChannel.share(' + i + ')" aria-label="' + (hi() ? 'शेयर करें' : 'Share') + '">' + I('share-2', 20) + '</button>';
    // talk it through with Bro: starts a voice call with this story as the topic
    const ask = '<button class="nz-ask" onclick="NewsChannel.ask(' + i + ')" aria-label="' + (hi() ? 'इस ख़बर पर ब्रो से बात करें' : 'Talk about this with Bro') + '"><i class="nz-ask-orb" aria-hidden="true"></i>' + (hi() ? 'ब्रो से पूछें' : 'Ask Bro') + '</button>';
    // No real photo: a panel in the category's colour holds the same slot, so every card reads the same way.
    const ph = '<div class="nz-img ph"><span aria-hidden="true">' + I(c[3] || 'newspaper', 72, 1.4) + '</span>' + ask + share + '</div>';
    const img = st.image ? '<div class="nz-img"><img class="nz-fg" src="' + esc(st.image) + '" alt="" loading="' + (i < 3 ? 'eager' : 'lazy') + '" onerror="NewsChannel.noimg(this)">' + ask + share + '</div>' : ph;
    return '<article class="nz-card' + (st.image ? '' : ' noimg') + '" data-i="' + i + '" data-id="' + esc(st.id || '') + '" style="--c:' + c[2] + '" aria-roledescription="slide" aria-label="' + esc(pick(st, 'headline')) + '">' + img +
      '<div class="nz-body"><div class="nz-k">' + (label ? '<b' + (hi() ? ' class="dev"' : '') + '>' + esc(label) + '</b>' : '') + (ago(st.published_at) ? '<span>' + ago(st.published_at) + '</span>' : '') + (names ? '<span class="nz-src">' + esc(names) + '</span>' : '') + '</div>' +
      '<h2 class="' + (hi() && st.headline_hi ? 'dev' : '') + '">' + esc(pick(st, 'headline')) + '</h2>' +
      '<p class="nz-text' + (hi() && st.summary_hi ? ' dev' : '') + '">' + esc(pick(st, 'summary')) + '</p></div></article>';
  }
  N.ask = function (i) {
    const st = N.stories[i]; if (!st) return;
    const topic = { title: pick(st, 'headline'), summary: pick(st, 'summary'), lang: hi() ? 'hi' : 'en' };
    if (window.BroVoice && BroVoice.askAbout) { BroVoice.askAbout(topic); return; }
    if (window.switchTab) switchTab('bro');
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
    if (!n && N.err) return '<div class="nz"><div class="nz-empty">' + (window.mascot ? window.mascot('idle', 96) : '') + '<b>' + (H ? 'ख़बरें लोड नहीं हुईं' : 'Couldn’t load the news') + '</b><button class="b-chip" onclick="NewsChannel.loaded=false;NewsChannel.rerender();NewsChannel.load()">' + I('refresh-cw', 14) + (H ? 'फिर कोशिश करें' : 'Try again') + '</button></div></div>';
    if (!n) return '<div class="nz"><div class="nz-empty">' + (window.mascot ? window.mascot('sleeping', 96) : '') + '<b>' + (H ? 'ख़बरें आ रही हैं' : 'Stories are on the way') + '</b></div></div>';
    return '<div class="nz"><div class="nz-stage"><div class="nz-deck" id="nzDeck" tabindex="0" aria-label="' + (H ? 'ख़बरें' : 'News') + '">' + list.map((st, i) => card(st, i)).join('') + '</div>' + hud +
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
    if (!d._wired) {
      d._wired = true;
      let t = 0;
      d.addEventListener('scroll', () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => { const k = Math.max(0, Math.min(N.stories.length - 1, Math.round(d.scrollLeft / Math.max(1, d.clientWidth)))); if (k !== N.i) { const was = N.i; N.i = k; moved(was); } }); }, { passive: true });
      d.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); N.go(N.i + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); N.go(N.i - 1); } });
    }
  };
  // Fit one card: the photo holds 40% of the card on every story so the headline sits at the same height as you swipe.
  // If the story is long the type steps down first, then the photo gives way to a 34% floor, and only then does the
  // text scroll inside the card (never cut off). Landscape phones lay the card out side by side (photo left).
  // Only the cards around the one in view are fitted, so a deck of hundreds stays quick.
  function fit(cardEl) {
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
  function moved(was) { fitNear(); near(); if (was === 0 && N.i > 0) hold(); }
  N.go = function (k, instant) {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const was = N.i;
    N.i = Math.max(0, Math.min(N.stories.length - 1, k | 0));
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

  // ── Share: the story as one tall image (photo, headline, the full text, source, brodoit.com) ──
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
  N.draw = async function (st) {
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
    const im = await loadImg(st.image);
    // no photo: the same category-colour panel and icon the card shows
    const glyph = im ? null : await loadImg('data:image/svg+xml,' + encodeURIComponent((window.ico ? ico(c[3] || 'newspaper', 24, 1.4) : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>').replace('stroke="currentColor"', 'stroke="#ffffff"').replace(/width="24" height="24"/, 'width="240" height="240"')));
    // fit: shrink the photo, then the type, until headline + every word of the story fit
    let imgH = im ? 760 : 520, hs = 64, bs = 40, lines, hl, need = 0;
    const floor = im ? 480 : 300;
    for (let k = 0; k < 40; k++) {
      x.font = '600 ' + hs + 'px ' + serif; hl = wrap(x, head, W - 2 * P);
      x.font = '400 ' + bs + 'px ' + sans; lines = wrap(x, body, W - 2 * P);
      need = imgH + 64 + 50 + hl.length * hs * 1.18 + 36 + lines.length * bs * 1.5 + 190;
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
    // footer
    x.fillStyle = '#17141F'; x.fillRect(0, H - 130, W, 130);
    x.fillStyle = '#FFFFFF'; x.font = '800 44px ' + "Georgia, serif"; x.fillText('Bro', P, H - 52);
    const bw = x.measureText('Bro').width; x.fillStyle = '#E0603F'; x.fillText('doit', P + bw, H - 52);
    x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '600 28px ' + sans;
    const src = (st.sources || []).slice(0, 2).map(srcName).join(', ');
    const right = (src ? src + '  ·  ' : '') + 'brodoit.com'; x.fillText(right, W - P - x.measureText(right).width, H - 56);
    return cv;
  };
  N.share = async function (i) {
    const st = N.stories[i]; if (!st) return;
    try {
      const cv = await N.draw(st);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('no image');
      const file = new File([blob], 'brodoit-news.jpg', { type: 'image/jpeg' });
      const link = location.origin + '/?tab=news&s=' + encodeURIComponent(st.id);
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: pick(st, 'headline'), text: pick(st, 'headline') + ' ' + link });
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'brodoit-news.jpg'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (e) { if (e && e.name !== 'AbortError' && typeof toast === 'function') toast(hi() ? 'शेयर नहीं हो सका' : 'Could not share'); }
  };
})();
