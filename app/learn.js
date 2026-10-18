// Learn landing — card UI v12. window.LearnUI.landing() returns the HTML for the Learn tab landing (see app/cards.js).
// server.js calls it when S.tab==='courses' && !S.learnSection; the legacy landing stays as the fallback when this file is absent.
// Data: the global _LT tree ({k, t, s, badge, c:[[title, subtitle, target, emoji]]}); handlers _ltToggle(k), _ltGo(i, j), _openPrep(file).
(function () {
  const L = window.LearnUI = window.LearnUI || {};
  const C = () => window.Cards;
  const hi = () => (window.S && S.lang === 'hi');
  const icon = (n, s) => (window.ico ? window.ico(n, s || 20) : '');
  // _LT strings are pre-escaped HTML (e.g. "IAS &amp; Civil Services"); Cards.* escapes again, so decode first
  const dec = s => String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CAT_ICON = { lang: 'languages', defence: 'shield', ias: 'landmark', banking: 'building-2', it: 'layers', mba: 'graduation-cap', cs: 'brain' };
  const CAT_TONE = { lang: 'ink', defence: 'umber', ias: 'wine', banking: 'ink', it: 'umber', mba: 'wine', cs: 'ink' };
  const HI_NAME = { lang: 'भाषाएँ', defence: 'रक्षा', ias: 'IAS और सिविल सेवा', banking: 'बैंकिंग', it: 'IT सेक्टर', mba: 'MBA', cs: 'कंप्यूटर साइंस' };

  // photo key for one course row (spec: language photos, exam photos; anything else falls back to the category photo)
  function rowKey(k, c) {
    const target = String(c[2] || ''), title = dec(c[0]).toLowerCase();
    if (k === 'lang') { const m = target.match(/[?&]c=([a-z]{2})/); return m ? 'lang-' + m[1] : ''; }
    if (k === 'defence') {
      if (/ssb/.test(target)) return 'def-ssb';
      const m = target.match(/id=(nda|cds|afcat)/); return m ? 'def-' + m[1] : '';
    }
    if (k === 'ias') return 'ias-upsc';
    if (k === 'banking') return 'bank-core';
    if (k === 'it') return 'it-gate';
    if (k === 'mba') return 'mba-gmat';
    if (k === 'cs') return /python/.test(title) ? 'cs-python' : 'cs-ai';
    return '';
  }

  function countdowns() {
    let ed = {};
    try { ed = (JSON.parse(localStorage.getItem('academy.progress.v1') || '{}').examDates) || {}; } catch (e) {}
    const t0 = new Date(new Date().toDateString()).getTime();
    return Object.keys(ed).map(k => { const x = ed[k] || {}; return { n: String(x.name || k), d: Math.round((new Date(x.date + 'T00:00:00').getTime() - t0) / 86400000) }; })
      .filter(x => x.d >= 0 && isFinite(x.d)).sort((a, b) => a.d - b.d).slice(0, 3);
  }

  // open a track (never toggles it shut) and bring its panel into view: used by the hero
  L.openTrack = function (k) {
    if (!window.S) return;
    S.learnOpen = k;
    if (typeof render === 'function') render();
    setTimeout(function () { const el = document.getElementById('lt-' + k); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };

  function panel(n, i) {
    const Cd = C(), H = hi();
    const catPhoto = Cd.photo('cat-' + n.k);
    const count = n.c.length + ' ' + (H ? 'कोर्स' : (n.c.length === 1 ? 'course' : 'courses'));
    let h = '<div class="lu-panel" id="lt-' + esc(n.k) + '" role="region" aria-label="' + esc(dec(n.t)) + '">';
    h += '<div class="lu-ph"><div><b>' + esc(H && HI_NAME[n.k] ? HI_NAME[n.k] : dec(n.t)) + '</b><small>' + count + '</small></div>' +
      '<button type="button" class="btn-ic lu-x" onclick="_ltToggle(\'' + esc(n.k) + '\')" aria-label="' + (H ? 'बंद करो' : 'Close') + '">' + icon('x', 20) + '</button></div>';
    h += '<div class="lu-rows cv-anim">';
    n.c.forEach(function (c, j) {
      const isBro = /tab=bro/.test(String(c[2] || ''));
      const img = isBro ? '/app/mascot.svg' : (Cd.photo(rowKey(n.k, c)) || catPhoto);
      h += Cd.row({ img: img, icon: isBro ? 'message-circle' : (CAT_ICON[n.k] || 'book-open'), tone: CAT_TONE[n.k] || 'ink', title: dec(c[0]), sub: dec(c[1]), onclick: '_ltGo(' + i + ',' + j + ')' })
        .replace('class="rowc"', 'class="rowc lu-course' + (isBro ? ' lu-bro' : '') + '"');
    });
    h += '</div></div>';
    return h;
  }

  L.landing = function () {
    const Cd = C();
    if (!Cd || !Cd.cover || !window._LT) return '';
    const H = hi(), LT = window._LT;
    const cd = countdowns();
    let h = '<div class="lu">';

    // header: serif title + exam countdown
    const cdLabel = cd.length ? '<b>' + cd[0].d + '</b>&nbsp;' + (H ? 'दिन' : (cd[0].d === 1 ? 'day' : 'days')) : (H ? 'परीक्षा की तारीख' : 'Exam date');
    h += '<div class="page-h lu-head"><h1>' + (H ? 'सीखो' : 'Learn') + '</h1>' +
      '<button type="button" class="btn soft sm lu-timer" onclick="_openPrep(\'countdown.html\')" aria-label="' + esc(cd.length ? cd[0].n + ', ' + cd[0].d + ' days left' : 'Set an exam date') + '">' + icon('calendar', 17) + '<span>' + cdLabel + '</span></button></div>';

    // more than one exam: a quiet rail of countdown minis
    if (cd.length > 1) {
      h += '<div class="cv-rail half lu-cds">' + cd.map(x => Cd.mini({ num: x.d, title: x.n, sub: H ? 'दिन बाकी' : (x.d === 1 ? 'day to go' : 'days to go'), onclick: "_openPrep('countdown.html')" })).join('') + '</div>';
    }

    // hero
    h += '<div class="lu-hero">' + Cd.cover({ key: 'hero-learn', icon: 'headphones', tone: 'ink', size: 'wide', cls: 'lg',
      kick: H ? 'ऑडियो' : 'Audio first',
      title: H ? 'सुनकर सीखो' : 'Learn by ear',
      sub: H ? 'कोर्स, परीक्षा और भाषाएँ' : 'Courses, exams and languages',
      go: 'arrow', onclick: "LearnUI.openTrack('lang')" }) + '</div>';

    // tracks: 2-up tall covers; the open track's panel spans the full width right under its row
    h += Cd.sec(H ? 'ट्रैक' : 'Tracks');
    h += '<div class="cv-grid lu-grid">';
    let pending = '';
    LT.forEach(function (n, i) {
      const open = S.learnOpen === n.k;
      const kick = n.c.length + ' ' + (H ? 'कोर्स' : (n.c.length === 1 ? 'course' : 'courses'));
      h += Cd.cover({ key: 'cat-' + n.k, icon: CAT_ICON[n.k] || 'book-open', tone: CAT_TONE[n.k] || 'ink', size: 'tall', cls: 'sm lu-track' + (open ? ' lu-open' : ''),
        kick: kick, title: H && HI_NAME[n.k] ? HI_NAME[n.k] : dec(n.t), tag: n.badge ? esc(n.badge) : '', onclick: "_ltToggle('" + n.k + "')", aria: dec(n.t) + ', ' + kick })
        .replace('<button type="button" class="cv', '<button type="button" aria-expanded="' + open + '" class="cv');
      if (open) pending = panel(n, i);
      // flush the panel after the second card of a row (or after the last card)
      if (pending && (i % 2 === 1 || i === LT.length - 1)) { h += pending; pending = ''; }
    });
    h += '</div>';

    // more: half-width square covers
    h += Cd.sec(H ? 'और' : 'More');
    h += '<div class="cv-rail half lu-more">';
    h += Cd.cover({ key: 'more-jobs', icon: 'briefcase', tone: 'umber', size: 'square', cls: 'sm', title: H ? 'सरकारी नौकरी' : 'Govt jobs', onclick: "_openPrep('jobs.html')" });
    h += Cd.cover({ key: 'hero-news', icon: 'radio', tone: 'ink', size: 'square', cls: 'sm', title: H ? 'ख़बरें' : 'News', onclick: "switchTab('news')" });
    h += Cd.cover({ key: 'more-groups', icon: 'users', tone: 'wine', size: 'square', cls: 'sm', title: H ? 'ग्रुप' : 'Groups', onclick: "_openPrep('groups.html')" });
    h += Cd.cover({ icon: 'bar-chart-3', tone: 'sand', size: 'square', cls: 'sm lu-board', title: H ? 'मेरा बोर्ड' : 'My board', onclick: "_openPrep('progress.html')" });
    h += Cd.cover({ key: 'more-speaker', icon: 'mic', tone: 'clay', size: 'square', cls: 'sm', title: H ? 'स्पीकर' : 'Speaker', onclick: "location.href='/speaker/'" });
    h += '</div>';

    h += '</div>';
    return h;
  };

  // scoped styles: the legacy inline <style> in server.js loads after the app CSS, so every rule is anchored on #app .lu
  const css = `
#app .lu{padding-bottom:8px}
#app .lu .lu-head{align-items:center;margin:4px 0 18px}
#app .lu .lu-timer{min-height:44px;gap:7px;padding:0 15px;border-radius:999px;font-weight:600;white-space:nowrap}
#app .lu .lu-timer b{font:400 21px/1 var(--b-serif);font-variant-numeric:tabular-nums}
#app .lu .lu-timer svg{width:17px;height:17px;color:var(--b-primary)}
#app .lu .lu-cds{margin-bottom:14px}
#app .lu .lu-cds .mini{min-height:96px}
#app .lu .lu-cds .mini b{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
#app .lu .lu-hero .cv-sub{-webkit-line-clamp:1}
#app .lu .sec-h{margin:28px 0 12px}
#app .lu .lu-grid{align-items:start}
#app .lu .lu-track .cv-kick{font-size:10.5px}
#app .lu .lu-track .cv-tag{background:rgba(255,255,255,.92);color:#1F1E1C;-webkit-backdrop-filter:none;backdrop-filter:none}
#app .lu .lu-track.lu-open{box-shadow:0 0 0 2.5px var(--b-bg),0 0 0 5px var(--b-ink),0 14px 30px -18px rgba(31,30,28,.55)}
#app .lu .lu-panel{grid-column:1/-1;scroll-margin-top:84px;margin:2px 0 4px;padding:8px 10px 10px;border-radius:24px;background:var(--b-bg-2);animation:lu-open .38s var(--ease,cubic-bezier(.16,1,.3,1)) both}
#app .lu .lu-ph{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 2px 10px 8px}
#app .lu .lu-ph b{display:block;font:400 24px/1.1 var(--b-serif);color:var(--b-ink);letter-spacing:-.01em}
#app .lu .lu-ph small{display:block;margin-top:3px;font:500 12.5px var(--b-sans);color:var(--b-mute)}
#app .lu .lu-x{background:var(--b-card);width:44px;height:44px}
#app .lu .lu-rows .rowc{box-shadow:0 1px 2px rgba(31,30,28,.05)}
#app .lu .lu-rows .rowc+.rowc{margin-top:8px}
#app .lu .lu-bro .rc-th{background:var(--b-primary-soft)}
#app .lu .lu-bro .rc-th img{object-fit:contain;inset:7px;width:calc(100% - 14px);height:calc(100% - 14px)}
#app .lu .lu-board .cv-art svg{width:72%;right:-14%;top:4%}
#app .lu .lu-more{padding-bottom:10px}
@keyframes lu-open{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
html[data-theme="dark"] #app .lu .lu-track.lu-open,body[data-theme=aurora] #app .lu .lu-track.lu-open{box-shadow:0 0 0 2.5px var(--b-bg),0 0 0 5px var(--b-ink)}
html[data-theme="dark"] #app .lu .lu-x,body[data-theme=aurora] #app .lu .lu-x{background:var(--b-card);color:var(--b-ink)}
html[data-theme="dark"] #app .lu .lu-timer,body[data-theme=aurora] #app .lu .lu-timer{background:var(--b-card);color:var(--b-ink)}
@media (max-width:370px){#app .lu .lu-track .cv-title{font-size:19px}#app .lu .lu-track .cv-body{padding:14px 13px 13px}}
@media (prefers-reduced-motion:reduce){#app .lu .lu-panel{animation:none}}
`;
  try {
    if (!document.getElementById('lu-css')) { const st = document.createElement('style'); st.id = 'lu-css'; st.textContent = css; document.head.appendChild(st); }
  } catch (e) {}
})();
