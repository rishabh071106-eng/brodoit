// Learn tab (v13): two schools only — Python: Zero to Hero (/code/) and Languages (/lang/).
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
    const pct = Math.round((P.done / 60) * 100), r = 30, circ = 2 * Math.PI * r;
    let h = '<div class="lx">';
    h += '<div class="lx-head"><h1 class="b-h1">' + (H ? 'सीखो' : 'Learn') + '</h1><p>' + (H ? 'दो स्कूल। शुरू से प्रो तक, आवाज़ और एनिमेशन के साथ।' : 'Two schools. From zero to job-ready, narrated and animated.') + '</p></div>';

    // ── School of Code: Python ──
    h += '<a class="lx-py" href="/code/' + (P.started ? 'day.html?d=' + P.cur : '') + '" aria-label="Python: Zero to Hero">'
      + '<span class="lx-stars" aria-hidden="true"></span><span class="lx-orbit" aria-hidden="true"><i class="pl"></i><i class="rg"></i><i class="rk">' + icon('rocket', 18) + '</i></span>'
      + '<span class="lx-k">' + (H ? 'कोडिंग स्कूल' : 'School of Code') + '</span>'
      + '<span class="lx-t">Python<small>Zero to Hero · 60 days</small></span>'
      + '<span class="lx-s">' + (H ? 'असली Python आपके फ़ोन पर चलता है। हर दिन एक मिशन, Bro आपका कोच।' : 'Real Python runs on your phone. One mission a day, with Bro as your coach.') + '</span>'
      + '<span class="lx-row"><span class="lx-ring"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="' + r + '" class="t"/><circle cx="36" cy="36" r="' + r + '" class="v" style="stroke-dasharray:' + circ + ';stroke-dashoffset:' + (circ * (1 - P.done / 60)) + '"/></svg><b>' + pct + '%</b></span>'
      + '<span class="lx-meta"><b>' + (P.started ? (H ? 'दिन ' + P.cur + ' / 60' : 'Day ' + P.cur + ' of 60') : (H ? '60 दिन का मिशन' : 'A 60-day mission')) + '</b><small>' + (P.done ? P.done + (H ? ' दिन पूरे · ' : ' days done · ') + P.xp + ' XP' : (H ? 'शून्य से डेवलपर तक' : 'From zero to Python developer')) + '</small></span>'
      + '<span class="lx-go">' + (P.started ? (P.resume ? (H ? 'जारी रखें' : 'Resume') : (H ? 'आगे बढ़ें' : 'Continue')) : (H ? 'शुरू करें' : 'Start')) + icon('arrow-right', 16) + '</span></span></a>';
    h += '<a class="lx-link" href="/code/">' + icon('compass', 16) + '<span>' + (H ? 'पूरा 60-दिन का मिशन मैप देखें' : 'See the full 60-day mission map') + '</span>' + icon('chevron-right', 16) + '</a>';

    // ── School of Languages ──
    const img = window.Cards && Cards.photo ? Cards.photo('cat-lang') : '';
    h += '<div class="lx-lang">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') + '<div class="lx-lshade"></div>'
      + '<div class="lx-lb"><span class="lx-k">' + (H ? 'भाषा स्कूल' : 'School of Languages') + '</span><b>' + (H ? '5 भाषाएँ, सुनकर सीखें' : '5 languages, learned by ear') + '</b><small>' + (H ? 'स्पैनिश, फ़्रेंच, जर्मन और हिंदी अंग्रेज़ी में; अंग्रेज़ी हिंदी में' : 'Spanish, French, German and Hindi in English, plus English taught in Hindi') + '</small></div></div>';
    h += '<div class="lx-langs">';
    LANGS.forEach(function (l, i) {
      const n = G.by[l.c] || 0, p = Math.min(100, Math.round((n / LANG_TOTAL) * 100));
      const ph = window.Cards && Cards.photo ? Cards.photo('lang-' + l.c) : '';
      h += '<a class="lx-li" style="--i:' + i + '" href="/lang/course.html?c=' + l.c + '">'
        + '<span class="lx-lph">' + (ph ? '<img src="' + esc(ph) + '" alt="" loading="lazy">' : '') + '</span>'
        + '<span class="lx-lt"><b>' + esc(H ? l.nh : l.n) + ' <em>' + esc(l.native) + '</em></b><small>' + esc(H ? l.viah : l.via) + (n ? ' · ' + n + '/' + LANG_TOTAL : '') + '</small><span class="lx-bar"><i style="width:' + p + '%"></i></span></span>'
        + icon('chevron-right', 18) + '</a>';
    });
    h += '</div>';

    // ── Bro knows your progress ──
    h += '<button class="lx-bro" onclick="location.href=\'/?tab=bro&persona=teacher\'"><img src="/app/mascot.svg" alt="" width="44" height="44"><span><b>' + (H ? 'Bro से पूछो' : 'Ask Bro, your coach') + '</b><small>' + (H ? 'वह आपकी प्रगति जानता है और हर सवाल का जवाब देता है' : 'Knows your progress in both schools and answers any question') + '</small></span>' + icon('chevron-right', 18) + '</button>';
    h += '</div>';
    return h;
  };
})();
