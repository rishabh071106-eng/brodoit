// Learn tab (v16): three big buttons (Games, Coding, Languages) that share the screen, each opening its own list inside the tab.
// The landing uses the framework hub buttons (.ui-hub); every list inside is the framework row (.ui-row). Both live in
// app/ui.css; the rules are in /DESIGN.md.
// window.LearnUI.landing() returns the tab's HTML; server.js calls it when S.tab==='courses'.
// S.learnHub picks the inner list; ?tab=learn&hub=games opens one directly and the phone's back button closes it.
// Progress is read from each school's own store (bd.py.v1, lang.progress.v1, bd.mind.v1): same origin, no fetch.
(function () {
  const L = window.LearnUI = window.LearnUI || {};
  const hi = () => (window.S && S.lang === 'hi');
  const icon = (n, s, w) => (window.ico ? window.ico(n, s || 22, w) : '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
  const HUBS = ['games', 'coding', 'languages'];
  const codeIc = (s, w) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m13.5 4-3 16"/></svg>';
  const CODE_IC = codeIc(22);

  const LANGS = [
    { c: 'es', n: 'Spanish', nh: 'स्पैनिश', native: 'Español', g: 'Ñ', a: '#DC2626' },
    { c: 'fr', n: 'French', nh: 'फ़्रेंच', native: 'Français', g: 'Ç', a: '#2563EB' },
    { c: 'de', n: 'German', nh: 'जर्मन', native: 'Deutsch', g: 'ß', a: '#64748B' },
    { c: 'en', n: 'English', nh: 'अंग्रेज़ी', native: 'Taught in Hindi', g: 'Aa', a: '#7C3AED' },
    { c: 'hi', n: 'Hindi', nh: 'हिंदी', native: 'हिन्दी', g: 'अ', a: '#EA580C' },
  ];
  const LANG_TOTAL = 52; // 12 audio lessons + 40 practice lessons per language

  function py() {
    const p = read('bd.py.v1'), days = p.days || {};
    let done = 0, cur = 60;
    for (let d = 60; d >= 1; d--) if (!(days['d' + d] && days['d' + d].done)) cur = d;
    for (const k in days) if (days[k] && days[k].done) done++;
    return { done, cur, started: !!Object.keys(days).length };
  }
  function langPct(c) {
    const done = read('lang.progress.v1').done || {};
    let n = 0; for (const k in done) if (done[k] && k.split('/')[0] === c) n++;
    return Math.min(100, Math.round((n / LANG_TOTAL) * 100));
  }

  // Games come from the /mind/ app itself (same store, game list and icons), loaded once as ES modules.
  let MIND = null, mindAsked = false;
  const rerender = () => { if (window.S && S.tab === 'courses' && typeof render === 'function') render(); };
  function loadMind() {
    if (mindAsked) return; mindAsked = true;
    Promise.all([import('/mind/assets/store.js'), import('/mind/assets/games/index.js'), import('/mind/assets/art.js').catch(() => ({}))])
      .then(([store, games, art]) => { MIND = { store, games, art }; rerender(); })
      .catch(() => { MIND = { failed: true }; rerender(); });
  }
  const gameIcon = id => (MIND && MIND.art && typeof MIND.art.icon === 'function' ? MIND.art.icon(id, 22) : icon('brain'));

  // ── the one row ──
  function row(o) {
    const tag = o.href ? 'a' : 'button';
    const act = o.href ? ' href="' + o.href + '"' : ' type="button" onclick="' + o.onclick + '"';
    return '<' + tag + ' class="ui-row"' + act + (o.id ? ' data-id="' + o.id + '"' : '') + '>'
      + '<span class="ui-ic" style="--ui-accent:' + o.accent + '" aria-hidden="true">' + o.ic + '</span>'
      + '<span class="ui-tx"><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '')
      + (o.pct ? '<span class="ui-prog" aria-hidden="true"><i style="width:' + o.pct + '%;--ui-accent:' + o.accent + '"></i></span>' : '') + '</span>'
      + '<span class="ui-chev">' + icon('chevron-right', 18) + '</span></' + tag + '>';
  }
  const list = rows => '<div class="ui-list">' + rows.join('') + '</div>';
  const header = (title, back) => '<header class="ui-page-h">'
    + (back ? '<button class="ui-back" type="button" onclick="LearnUI.back()" aria-label="' + (hi() ? 'वापस' : 'Back') + '">' + icon('chevron-left', 24) + '</button>' : '')
    + '<h1>' + esc(title) + '</h1></header>';

  // ── status lines for the three main rows ──
  function gamesStatus(H) {
    if (!MIND || MIND.failed) return H ? '5 ब्रेन गेम' : '5 brain games';
    const w = MIND.store.workout(MIND.store.read());
    if (w.complete) return H ? 'आज का वर्कआउट पूरा' : "Today's workout done";
    return (H ? 'आज का वर्कआउट · ' : "Today's workout · ") + w.done.length + (H ? ' / 3' : ' of 3');
  }
  function langStatus(H) {
    let best = null;
    LANGS.forEach(l => { const p = langPct(l.c); if (p && (!best || p > best.p)) best = { l, p }; });
    return best ? (H ? best.l.nh : best.l.n) + ' · ' + best.p + '%' : (H ? '5 भाषाएँ' : '5 languages');
  }

  // ── the landing: three big buttons that split the space between the header and the tab bar ──
  // o.ic(size, stroke) draws the item's icon: once in the tile, once large and faint in the corner.
  function hub(o) {
    return '<button class="ui-hub lx-hub" type="button" data-id="' + o.id + '" onclick="LearnUI.open(\'' + o.id + '\')" style="--hub-accent:' + o.accent + '"'
      + ' aria-label="' + esc(o.title + ', ' + o.sub.replace(/ · /g, ', ')) + '">'
      + '<span class="ui-hub-in"><span class="ui-hub-ic" aria-hidden="true">' + o.ic(30, 2) + '</span>'
      + '<span class="ui-hub-tx"><b>' + esc(o.title) + '</b><small>' + esc(o.sub) + '</small></span>'
      + '<span class="ui-hub-go" aria-hidden="true">' + icon('arrow-right', 20, 2.25) + '</span></span>'
      + '<span class="ui-hub-art" aria-hidden="true">' + o.ic(144, 1.25) + '</span></button>';
  }
  function landing(H) {
    const P = py();
    loadMind();
    requestAnimationFrame(fit); // runs once the tab's HTML is in the page, before it paints
    return '<div class="lx lx-home">' + header(H ? 'सीखो' : 'Learn', false) + '<div class="ui-hubs lx-hubs">'
      + hub({ id: 'games', accent: 'var(--g-memory)', ic: (s, w) => icon('brain', s, w), title: H ? 'गेम्स' : 'Games', sub: gamesStatus(H) })
      + hub({ id: 'coding', accent: 'var(--g-python)', ic: codeIc, title: H ? 'कोडिंग' : 'Coding', sub: 'Python · ' + (P.started ? (H ? 'दिन ' : 'Day ') + P.cur + (H ? ' / 60' : ' of 60') : (H ? '60 दिन' : '60 days')) })
      + hub({ id: 'languages', accent: 'var(--g-lang)', ic: (s, w) => icon('languages', s, w), title: H ? 'भाषाएँ' : 'Languages', sub: langStatus(H) })
      + '</div></div>';
  }
  // The buttons share the height from under the header to just above the tab bar (or the audio player, when it sits
  // above the tabs), measured the way the News deck is. Each keeps its 124px minimum (three fit a 360×640 screen), so short screens scroll.
  function fit() {
    const box = document.querySelector('#app .lx-hubs'), lx = box && box.closest('.lx'); if (!lx) return;
    box.style.minHeight = lx.style.marginBottom = '';
    const bar = document.querySelector('.tabs.page-t'), r = bar && bar.getBoundingClientRect();
    let bottom = r && r.height && r.top > innerHeight * 0.6 ? r.top : innerHeight;
    const pl = document.querySelector('.player.on'), q = pl && pl.getBoundingClientRect();
    if (q && q.height && q.top > innerHeight * 0.5 && q.top < bottom) bottom = q.top;
    // offsetTop, not the box's rect: the rect includes the tab's entrance slide. Measured twice because a wide layout
    // can move the box once it grows.
    const top = () => { let t = 0; for (let e = box; e; e = e.offsetParent) t += e.offsetTop; return t; };
    let fill = 0;
    for (let i = 0; i < 2; i++) { fill = Math.max(0, Math.floor(bottom - top() - 16)); box.style.minHeight = fill + 'px'; }
    // When the three fit, end the page at the screen's bottom instead of letting it scroll into the shell's padding
    // (kept only where the layout really ends with the content).
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0 && box.offsetHeight <= fill + 1) {
      lx.style.marginBottom = -over + 'px';
      if (document.documentElement.scrollHeight > innerHeight) lx.style.marginBottom = '';
    }
  }
  addEventListener('resize', () => { if (window.S && S.tab === 'courses' && !S.learnHub) fit(); });

  function gamesHub(H) {
    let h = '<div class="lx">' + header(H ? 'गेम्स' : 'Games', true);
    if (!MIND) { loadMind(); return h + '<i class="ui-skel" style="height:176px"></i><i class="ui-skel" style="height:360px;margin-top:12px"></i></div>'; }
    if (MIND.failed) return h + list([row({ href: '/mind/', accent: 'var(--g-memory)', ic: icon('brain'), title: H ? 'गेम्स खोलें' : 'Open games' })]) + '</div>';
    const { store, games } = MIND, p = store.read(), w = store.workout(p);
    const meta = id => games.byId(id).meta, left = 3 - w.done.length, next = w.next || w.games[0];
    // today's workout: one card, one action
    h += '<section class="ui-card lx-wo" aria-labelledby="lxWoT"><div class="lx-wo-h"><div><h2 id="lxWoT">' + (H ? 'आज का वर्कआउट' : "Today's workout") + '</h2>'
      + '<p>' + (w.complete ? (H ? 'आज के लिए पूरा। कल नया सेट।' : 'Done for today. A new set tomorrow.') : (H ? left + ' गेम · ~' + left * 2 + ' मिनट' : left + ' game' + (left === 1 ? '' : 's') + ' · ~' + left * 2 + ' min')) + '</p></div>'
      + '<span class="lx-wo-n" aria-label="' + w.done.length + ' of 3 done">' + w.done.length + '<small>/3</small></span></div>'
      + '<div class="lx-wo-g">' + w.games.map(g => '<span class="lx-wo-i' + (w.done.includes(g) ? ' done' : '') + '"><span class="ui-ic" style="--ui-accent:' + meta(g).color + '">' + (w.done.includes(g) ? icon('check', 22) : gameIcon(g)) + '</span><small>' + esc(meta(g).name) + '</small></span>').join('') + '</div>'
      + (w.complete ? '' : '<a class="ui-btn wide" href="/mind/play.html?g=' + next + '&l=' + store.current(p, next) + '&w=1">' + (w.done.length ? (H ? 'जारी रखें' : 'Continue') : (H ? 'शुरू करें' : 'Start')) + '</a>')
      + '</section>';
    // every game, same row
    h += '<div class="ui-sec">' + (H ? 'सभी गेम्स' : 'All games') + '</div>' + list(games.GAMES.map(g => {
      const m = g.meta, st = store.gameStats(p, m.id);
      return row({ id: m.id, href: '/mind/game.html?g=' + m.id, accent: m.color, ic: gameIcon(m.id), title: m.name,
        sub: m.skill + ' · ' + (st.started ? (H ? 'लेवल ' : 'Level ') + st.level : (H ? 'नया' : 'New')), pct: st.started ? Math.round(st.done / 20 * 100) : 0 });
    }));
    return h + '</div>';
  }

  function codingHub(H) {
    const P = py();
    return '<div class="lx">' + header(H ? 'कोडिंग' : 'Coding', true) + list([
      row({ id: 'python', href: '/code/', accent: 'var(--g-python)', ic: CODE_IC, title: 'Python',
        sub: P.started ? (H ? 'दिन ' : 'Day ') + P.cur + (H ? ' / 60' : ' of 60') : (H ? '60 दिन · शुरुआत से' : '60 days · From zero'), pct: P.started ? Math.round(P.done / 60 * 100) : 0 }),
    ]) + '<div class="ui-sec">' + (H ? 'मदद' : 'Help') + '</div>' + list([
      row({ href: '/?tab=bro&persona=teacher', accent: 'var(--b-primary)', ic: icon('message-circle'), title: H ? 'Bro से पूछो' : 'Ask Bro', sub: H ? 'कोड पर कोई भी सवाल' : 'Any question about code' }),
    ]) + '</div>';
  }

  function languagesHub(H) {
    return '<div class="lx">' + header(H ? 'भाषाएँ' : 'Languages', true) + list(LANGS.map(l => {
      const p = langPct(l.c);
      return row({ id: l.c, href: '/lang/course.html?c=' + l.c, accent: l.a, ic: '<b class="lx-glyph">' + l.g + '</b>', title: H ? l.nh : l.n,
        sub: l.native + ' · ' + (p ? p + '%' : (H ? 'शुरू नहीं किया' : 'Not started')), pct: p });
    })) + '</div>';
  }

  L.landing = function () {
    const H = hi(), hub = window.S && S.learnHub;
    if (hub === 'games') return gamesHub(H);
    if (hub === 'coding') return codingHub(H);
    if (hub === 'languages') return languagesHub(H);
    return landing(H);
  };

  // ── inner lists: opening pushes a history entry so the phone's back button returns to the three rows ──
  L.open = function (hub, fromUrl) {
    if (HUBS.indexOf(hub) < 0 || !window.S) return;
    try {
      if (fromUrl) history.replaceState({ learn: 1 }, '', '/?tab=learn');
      history.pushState({ learn: 1, hub }, '', '/?tab=learn&hub=' + hub);
    } catch (e) { /* ignore */ }
    S.learnHub = hub;
    if (typeof render === 'function') render();
    window.scrollTo(0, 0);
  };
  L.back = function () {
    if (history.state && history.state.hub) { history.back(); return; }
    close();
  };
  function close() {
    if (!window.S || !S.learnHub) return;
    S.learnHub = null;
    if (typeof render === 'function') render();
    window.scrollTo(0, 0);
  }
  addEventListener('popstate', e => {
    if (!window.S || S.tab !== 'courses') return;
    const hub = e.state && e.state.hub;
    if (hub && HUBS.indexOf(hub) >= 0) { S.learnHub = hub; render(); window.scrollTo(0, 0); }
    else close();
  });
})();
