// Learn tab (v13.1): two schools only, few words — Python: Zero to Hero (/code/) and Languages (/lang/).
// window.LearnUI.landing() returns the tab's HTML; server.js calls it when S.tab==='courses'.
// Progress is read from the schools' own stores (bd.py.v1, lang.progress.v1) — same origin, no fetch.
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

  L.landing = function () {
    const H = hi(), P = py(), G = langs();
    const pct = Math.round((P.done / 60) * 100), r = 22, circ = 2 * Math.PI * r;
    const photo = k => (window.Cards && Cards.photo ? Cards.photo(k) : '');
    let h = '<div class="lx"><h1 class="b-h1 lx-h">' + (H ? 'सीखो' : 'Learn') + '</h1>';

    // ── Python: photo cover (opens the 60-day map) with progress and one Continue button ──
    const go = P.started ? (H ? 'जारी रखें' : 'Continue') : (H ? 'शुरू करें' : 'Start');
    h += '<div class="lx-py">' + (photo('cs-python') ? '<img src="' + esc(photo('cs-python')) + '" alt="" loading="lazy">' : '') + '<span class="lx-shade"></span>'
      + '<a class="lx-cover" href="/code/" aria-label="Python, 60 ' + (H ? 'दिन' : 'days') + '"></a>'
      + '<div class="lx-pb"><span class="lx-t">Python</span><span class="lx-d">' + (P.started ? (H ? 'दिन ' : 'Day ') + P.cur + ' / 60' : (H ? '60 दिन' : '60 days')) + '</span></div>'
      + '<div class="lx-pr"><span class="lx-ring" role="img" aria-label="' + pct + '%"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="' + r + '" class="t"/><circle cx="26" cy="26" r="' + r + '" class="v" style="stroke-dasharray:' + circ + ';stroke-dashoffset:' + (circ * (1 - P.done / 60)) + '"/></svg><b>' + pct + '%</b></span>'
      + '<a class="lx-go" href="/code/' + (P.started ? 'day.html?d=' + P.cur : 'day.html?d=1') + '">' + go + icon('arrow-right', 16) + '</a></div></div>';

    // ── Languages: one row each — photo, name, progress ──
    h += '<h2 class="lx-sec">' + (H ? 'भाषाएँ' : 'Languages') + '</h2><div class="lx-langs">';
    LANGS.forEach(function (l, i) {
      const n = G.by[l.c] || 0, p = Math.min(100, Math.round((n / LANG_TOTAL) * 100));
      const ph = photo('lang-' + l.c);
      h += '<a class="lx-li" style="--i:' + i + '" href="/lang/course.html?c=' + l.c + '">'
        + '<span class="lx-lph">' + (ph ? '<img src="' + esc(ph) + '" alt="" loading="lazy">' : '') + '</span>'
        + '<span class="lx-lt"><b>' + esc(H ? l.nh : l.n) + (l.native !== l.n ? ' <em>' + esc(l.native) + '</em>' : '') + '</b>' + (p ? '<span class="lx-bar"><i style="width:' + p + '%"></i></span>' : '') + '</span>'
        + icon('chevron-right', 18) + '</a>';
    });
    h += '</div>';

    // ── Bro, your coach: one line ──
    h += '<a class="lx-bro" href="/?tab=bro&persona=teacher"><img src="/app/mascot.svg" alt="" width="40" height="40"><b>' + (H ? 'Bro से पूछो' : 'Ask Bro') + '</b>' + icon('chevron-right', 18) + '</a>';
    h += '</div>';
    return h;
  };
})();
