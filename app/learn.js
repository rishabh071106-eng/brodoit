// Learn tab (v14): one page, three sections — Coding (Python /code/), Languages (/lang/), Mind games (/mind/) — styled art, no stock photos.
// window.LearnUI.landing() returns the tab's HTML; server.js calls it when S.tab==='courses'.
// Progress is read from each school's own store (bd.py.v1, lang.progress.v1, bd.mind.v1) — same origin, no fetch.
(function () {
  const L = window.LearnUI = window.LearnUI || {};
  const hi = () => (window.S && S.lang === 'hi');
  const icon = (n, s) => (window.ico ? window.ico(n, s || 20) : '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };

  const LANGS = [
    { c: 'es', n: 'Spanish', nh: 'स्पैनिश', native: 'Español', via: 'in English', viah: 'अंग्रेज़ी में' },
    { c: 'fr', n: 'French', nh: 'फ़्रेंच', native: 'Français', via: 'in English', viah: 'अंग्रेज़ी में' },
    { c: 'de', n: 'German', nh: 'जर्मन', native: 'Deutsch', via: 'in English', viah: 'अंग्रेज़ी में' },
    { c: 'en', n: 'English', nh: 'अंग्रेज़ी', native: 'English', via: 'taught in Hindi', viah: 'हिंदी में' },
    { c: 'hi', n: 'Hindi', nh: 'हिंदी', native: 'हिन्दी', via: 'in English', viah: 'अंग्रेज़ी में' },
  ];
  const LANG_TOTAL = 52; // 12 audio lessons + 40 practice lessons per language

  function py() {
    const p = read('bd.py.v1'), days = p.days || {};
    let done = 0, cur = 60;
    for (let d = 60; d >= 1; d--) if (!(days['d' + d] && days['d' + d].done)) cur = d;
    for (const k in days) if (days[k] && days[k].done) done++;
    return { done, cur, xp: p.xp || 0, started: !!Object.keys(days).length, resume: days['d' + cur] && days['d' + cur].slide };
  }
  function langs() {
    const s = read('lang.progress.v1'), done = s.done || {};
    const by = {};
    for (const k in done) { const c = k.split('/')[0]; if (done[k]) by[c] = (by[c] || 0) + 1; }
    return { by };
  }

  // Native-letter tiles for the languages (styled, no photos)
  const GLYPH = { es: ['Ñ', '#C8102E', '#F1BF00'], fr: ['Ç', '#0055A4', '#EF4135'], de: ['ß', '#26221F', '#DD0000'], en: ['Aa', '#012169', '#C8102E'], hi: ['अ', '#FF9933', '#138808'] };

  // Mind games come from the /mind/ app itself (same store, art and game list), loaded once as ES modules.
  let MIND = null, mindAsked = false;
  function loadMind() {
    if (mindAsked) return; mindAsked = true;
    Promise.all([import('/mind/assets/store.js'), import('/mind/assets/games/index.js')])
      .then(([store, games]) => { MIND = { store, games }; if (window.S && S.tab === 'courses' && typeof render === 'function') render(); })
      .catch(() => { MIND = { failed: true }; });
  }
  // game symbols, typeset not illustrated
  const GSYM = {
    memory: '<i></i><i class="on"></i><i></i><i class="on"></i><i></i><i></i><i></i><i class="on"></i><i class="on"></i>',
    clash: '<em>BLUE</em>',
    hunt: '<em>1</em><em>2</em><em>3</em>',
    math: '<em>+</em><em>×</em>',
    words: '<em>W</em><em>O</em><em>R</em><em>D</em>',
  };
  function mindSection(H) {
    let h = '<h2 class="lx-sec">' + (H ? 'माइंड गेम्स' : 'Mind games') + '<a class="lx-all" href="/mind/">' + (H ? 'सभी' : 'All') + icon('chevron-right', 16) + '</a></h2>';
    if (!MIND) { loadMind(); return h + '<div class="lx-mind-sk"><i class="b-skel"></i><i class="b-skel"></i></div>'; }
    if (MIND.failed) return h + '<a class="lx-li" href="/mind/"><span class="lx-glyph" style="--a:#6C4DF6;--b:#13A07D">' + icon('brain', 22) + '</span><span class="lx-lt"><b>' + (H ? 'माइंड गेम्स खोलें' : 'Open Mind games') + '</b></span>' + icon('chevron-right', 18) + '</a>';
    const { store, games } = MIND, p = store.read(), w = store.workout(p);
    const meta = id => games.byId(id).meta, left = 3 - w.done.length;
    const next = w.next || w.games[0];
    const go = w.complete ? '/mind/' : '/mind/play.html?g=' + next + '&l=' + store.current(p, next) + '&w=1';
    const pct = Math.round(w.done.length / 3 * 100), r = 20, circ = 2 * Math.PI * r;
    // Today's workout: one row — ring, title, the three games as colour dots
    h += '<a class="lx-wo" href="' + go + '">'
      + '<span class="lx-ring sm" role="img" aria-label="' + w.done.length + '/3"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="' + r + '" class="t"/><circle cx="24" cy="24" r="' + r + '" class="v" style="stroke-dasharray:' + circ + ';stroke-dashoffset:' + (circ * (1 - pct / 100)) + '"/></svg><b>' + w.done.length + '/3</b></span>'
      + '<span class="lx-wo-t"><b>' + (H ? 'आज का वर्कआउट' : "Today's workout") + '</b><small>' + (w.complete ? (H ? 'पूरा हुआ!' : 'Done for today') : (H ? left + ' गेम · ~' + left * 2 + ' मिनट' : left + ' game' + (left === 1 ? '' : 's') + ' · ~' + left * 2 + ' min')) + '</small></span>'
      + '<span class="lx-wo-dots" aria-hidden="true">' + w.games.map(g => '<i class="' + (w.done.includes(g) ? 'done' : '') + '" style="--c:' + meta(g).color + '">' + (w.done.includes(g) ? icon('check', 12) : '') + '</i>').join('') + '</span>'
      + icon('chevron-right', 18) + '</a>';
    // the five games: colour cards with a drawn-in-CSS symbol, no pictures
    h += '<div class="lx-games">' + games.GAMES.map((g, i) => { const m = g.meta, st = store.gameStats(p, m.id);
      return '<a class="lx-game" style="--c:' + m.color + ';--d:' + m.deep + ';--i:' + i + '" href="/mind/game.html?g=' + m.id + '">'
        + '<span class="lx-gm lx-gm-' + m.id + '" aria-hidden="true">' + (GSYM[m.id] || '') + '</span>'
        + '<span class="lx-lv">' + (H ? 'लेवल ' : 'Lv ') + st.level + '</span>'
        + '<b>' + esc(m.name) + '</b><small>' + esc(m.skill) + '</small></a>'; }).join('') + '</div>';
    return h;
  }

  L.landing = function () {
    const H = hi(), P = py(), G = langs();
    const pct = Math.round((P.done / 60) * 100), r = 22, circ = 2 * Math.PI * r;
    let h = '<div class="lx"><h1 class="b-h1 lx-h">' + (H ? 'सीखो' : 'Learn') + '</h1>';

    // ── Coding: Python's story as the cover (no photo) — a timeline from 1991 to today, then your progress ──
    const go = P.started ? (H ? 'जारी रखें' : 'Continue') : (H ? 'शुरू करें' : 'Start');
    h += '<h2 class="lx-sec">' + (H ? 'कोडिंग' : 'Coding') + '</h2>';
    h += '<div class="lx-py"><span class="lx-py-bg" aria-hidden="true"><i class="o1"></i><i class="o2"></i><code>&gt;&gt;&gt;</code></span>'
      + '<a class="lx-cover" href="/code/" aria-label="Python, 60 ' + (H ? 'दिन' : 'days') + '"></a>'
      + '<span class="lx-k">' + (H ? '1991 से' : 'Since 1991') + '</span><span class="lx-t">Python</span>'
      + '<ol class="lx-tl" aria-hidden="true"><li><b>1991</b><span>' + (H ? 'रिलीज़' : 'Released') + '</span></li><li><b>2000</b><span>Python 2</span></li><li><b>2008</b><span>Python 3</span></li><li class="now"><b>' + (H ? 'आज' : 'Today') + '</b><span>AI &amp; data</span></li></ol>'
      + '<div class="lx-pr"><span class="lx-ring" role="img" aria-label="' + pct + '%"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="' + r + '" class="t"/><circle cx="26" cy="26" r="' + r + '" class="v" style="stroke-dasharray:' + circ + ';stroke-dashoffset:' + (circ * (1 - P.done / 60)) + '"/></svg><b>' + pct + '%</b></span>'
      + '<span class="lx-d">' + (P.started ? (H ? 'दिन ' : 'Day ') + P.cur + ' / 60' : (H ? '60 दिन' : '60 days')) + '</span>'
      + '<a class="lx-go" href="/code/' + (P.started ? 'day.html?d=' + P.cur : 'day.html?d=1') + '">' + go + icon('arrow-right', 16) + '</a></div></div>';

    // ── Languages: native-letter tiles, name, progress ──
    h += '<h2 class="lx-sec">' + (H ? 'भाषाएँ' : 'Languages') + '</h2><div class="lx-langs">';
    LANGS.forEach(function (l, i) {
      const n = G.by[l.c] || 0, p = Math.min(100, Math.round((n / LANG_TOTAL) * 100)), g = GLYPH[l.c];
      h += '<a class="lx-li" style="--i:' + i + '" href="/lang/course.html?c=' + l.c + '">'
        + '<span class="lx-glyph" style="--a:' + g[1] + ';--b:' + g[2] + '" aria-hidden="true">' + g[0] + '</span>'
        + '<span class="lx-lt"><b>' + esc(H ? l.nh : l.n) + (l.native !== l.n ? ' <em>' + esc(l.native) + '</em>' : '') + '</b>' + (p ? '<span class="lx-bar"><i style="width:' + p + '%"></i></span>' : '') + '</span>'
        + icon('chevron-right', 18) + '</a>';
    });
    h += '</div>';

    // ── Mind games ──
    h += mindSection(H);

    // ── Bro, your coach: one line ──
    h += '<a class="lx-bro" href="/?tab=bro&persona=teacher"><img src="/app/mascot.svg" alt="" width="40" height="40"><b>' + (H ? 'Bro से पूछो' : 'Ask Bro') + '</b>' + icon('chevron-right', 18) + '</a>';
    h += '</div>';
    return h;
  };
})();
