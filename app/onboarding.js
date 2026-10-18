// Brodoit v10 onboarding — "Meet Bro" in four swipeable slides (<30 s). Plain script, zero deps.
//   window.Onboarding = { shouldShow(), html(), mount(), next(), prev(), go(i), finish(reason), reset(), goals(), onDone }
// Writes localStorage bd_goals ({steps, lang, exam, ts}) as chips are picked and bd_onboarded=1 on finish/skip.
// Uses window.mascot / window.ico / window.haptic when present (all guarded). Fires 'bd:onboarded' on window when done.
(function () {
  'use strict';
  var KEY_DONE = 'bd_onboarded', KEY_GOALS = 'bd_goals';
  var STEPS = [6000, 8000, 10000];
  var LANGS = [['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese']];
  var EXAMS = [['upsc-cse', 'UPSC CSE'], ['sbi-po', 'SBI PO'], ['nda', 'NDA'], ['gate-cse', 'GATE CSE'], ['tcs-nqt', 'TCS NQT'], ['gmat', 'GMAT']];
  var O = window.Onboarding = { i: 0, n: 4, root: null, onDone: null, _goals: null, _timers: [], _prevOverflow: null };

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); return v; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ic(name, size, stroke) { return window.ico ? window.ico(name, size || 20, stroke || 2) : ''; }
  function mas(pose, size, opts) {
    if (window.mascot) return window.mascot(pose, size, opts);
    return '<svg class="mascot mascot-' + pose + '" data-pose="' + pose + '" width="' + size + '" height="' + size + '" viewBox="0 0 200 200"><use href="/app/mascot.svg#' + pose + '"/></svg>';
  }
  function hap(k) { try { if (window.haptic) window.haptic(k); } catch (e) {} }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function later(fn, ms) { var t = setTimeout(fn, ms); O._timers.push(t); return t; }
  function q(sel) { return O.root ? O.root.querySelector(sel) : null; }

  O.goals = function () {
    if (O._goals) return O._goals;
    var g = null; try { g = JSON.parse(ls(KEY_GOALS) || 'null'); } catch (e) { g = null; }
    O._goals = (g && typeof g === 'object') ? g : { steps: 8000, lang: null, exam: null };
    return O._goals;
  };
  function saveGoals() { var g = O.goals(); g.ts = Date.now(); ls(KEY_GOALS, JSON.stringify(g)); return g; }

  O.shouldShow = function () {
    try {
      var m = /[?&]onb=(\d)/.exec(location.search);
      if (m) return m[1] === '1';
    } catch (e) {}
    if (document.getElementById('onbRoot')) return false;
    return ls(KEY_DONE) !== '1';
  };
  O.reset = function () { try { localStorage.removeItem(KEY_DONE); localStorage.removeItem(KEY_GOALS); } catch (e) {} O._goals = null; O.i = 0; };

  // ─────────────────────────── markup ───────────────────────────
  function slide1() {
    return '<section class="onb-slide s1" data-i="0" aria-label="Meet Bro">' +
      '<div class="onb-hero float tap" id="onbHero1" role="button" tabindex="0" aria-label="Say hi to Bro">' + mas('idle', 140) + '<div class="onb-say" id="onbSay">Hi! I\'m Bro.</div></div>' +
      '<div class="onb-eyebrow">Brodoit</div>' +
      '<h1 class="onb-h1">Meet <span class="grad">Bro</span></h1>' +
      '<p class="onb-p">Tap him. Talk. He talks back — English or हिंदी.</p>' +
      '</section>';
  }
  function slide2() {
    var rows = [
      { r: 1, name: 'Aarav', hue: 205, steps: 9842, streak: 12 },
      { r: 2, name: 'You', hue: 170, steps: 7240, streak: 3, me: true },
      { r: 3, name: 'Priya', hue: 330, steps: 6910, streak: 8 }
    ];
    return '<section class="onb-slide s2" data-i="1" aria-label="Walk. Learn. Rise.">' +
      '<div class="onb-ring" id="onbRing"><svg class="ringsvg" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true"><circle class="bg" cx="110" cy="110" r="95" fill="none" stroke-width="16"/><circle class="fg" cx="110" cy="110" r="95" fill="none" stroke-width="16" stroke-linecap="round"/></svg>' + mas('walking', 104) + '</div>' +
      '<div class="onb-steps"><b id="onbCount">0</b><small>of 10,000 steps</small></div>' +
      '<h1 class="onb-h1">Walk. Learn. <span class="grad">Rise.</span></h1>' +
      '<p class="onb-p">Every step counts. Friends keep score.</p>' +
      '<div class="onb-board" aria-label="Leaderboard preview">' + rows.map(function (x) {
        return '<div class="row' + (x.me ? ' me' : '') + '"><span class="rank">' + x.r + '</span><span class="b-avatar" style="--hue:' + x.hue + '">' + esc(x.name[0]) + '</span>' +
          '<span class="who">' + esc(x.name) + (x.streak ? '<small>' + ic('flame', 14, 2.2) + x.streak + '</small>' : '') + '</span><span class="n">' + fmt(x.steps) + '</span></div>';
      }).join('') + '</div>' +
      '</section>';
  }
  function chip(group, val, label, on, icon) {
    return '<button type="button" class="b-chip' + (on ? ' on' : '') + '" data-g="' + group + '" data-v="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + (icon ? ic(icon, 16, 2.2) : '') + esc(label) + '</button>';
  }
  function slide3() {
    var g = O.goals();
    return '<section class="onb-slide s3" data-i="2" aria-label="Pick your goals">' +
      '<div class="onb-hero" id="onbHero3" style="min-height:96px">' + mas('idle', 88) + '</div>' +
      '<h1 class="onb-h1">Pick your <span class="grad">goals</span></h1>' +
      '<p class="onb-p">Change any time.</p>' +
      '<div class="onb-group"><div class="lbl">' + ic('footprints', 14) + 'Daily steps</div><div class="onb-chips" role="group" aria-label="Daily steps">' +
      STEPS.map(function (s) { return chip('steps', s, fmt(s), +g.steps === s); }).join('') + '</div></div>' +
      '<div class="onb-group"><div class="lbl">' + ic('languages', 14) + 'Learn a language</div><div class="onb-chips" role="group" aria-label="Language">' +
      LANGS.map(function (l) { return chip('lang', l[0], l[1], g.lang === l[0]); }).join('') + '</div></div>' +
      '<div class="onb-group"><div class="lbl">' + ic('graduation-cap', 14) + 'Prepare for an exam</div><div class="onb-chips" role="group" aria-label="Exam">' +
      EXAMS.map(function (e) { return chip('exam', e[0], e[1], g.exam === e[0]); }).join('') + '</div></div>' +
      '</section>';
  }
  function perm(kind, icon, title, body, btn) {
    return '<div class="onb-perm ' + kind + '" id="onbPerm-' + kind + '"><div class="ic">' + ic(icon, 22) + '</div><div class="txt"><b>' + title + '</b><p>' + body + '</p>' +
      '<button type="button" class="b-btn ' + (kind === 'bell' ? 'violet' : '') + '" data-perm="' + kind + '">' + ic(icon, 18) + btn + '</button>' +
      '<div class="state" role="status"></div></div></div>';
  }
  function slide4() {
    return '<section class="onb-slide s4" data-i="3" aria-label="Permissions">' +
      '<div class="onb-hero" id="onbHero4" style="min-height:110px">' + mas('listening', 104) + '</div>' +
      '<h1 class="onb-h1">Two quick <span class="grad">permissions</span></h1>' +
      '<p class="onb-p">Only when you use them.</p>' +
      perm('mic', 'mic', 'Talk to Bro', 'Only while you hold the mic.', 'Allow microphone') +
      perm('bell', 'bell', 'Gentle nudges', 'One evening nudge. Never more than one a day.', 'Allow notifications') +
      '</section>';
  }
  O.html = function () {
    var dots = ''; for (var k = 0; k < O.n; k++) dots += '<i' + (k === O.i ? ' class="on"' : '') + '></i>';
    return '<div class="onb" id="onbRoot" role="dialog" aria-modal="true" aria-label="Welcome to Brodoit">' +
      '<div class="onb-top"><div class="onb-dots" id="onbDots" aria-hidden="true">' + dots + '</div><button type="button" class="onb-skip" id="onbSkip">Skip</button></div>' +
      '<div class="onb-view"><div class="onb-track" id="onbTrack">' + slide1() + slide2() + slide3() + slide4() + '</div></div>' +
      '<div class="onb-foot"><button type="button" class="b-btn wide" id="onbNext">Next ' + ic('arrow-right', 18, 2.4) + '</button><div class="onb-hint" id="onbHint">Swipe to continue</div></div>' +
      '</div>';
  };

  // ─────────────────────────── behaviour ───────────────────────────
  var drag = null, lastX = 0;
  function setPose(hero, pose) { try { var el = hero && hero.querySelector('svg.mascot'); if (el && window.mascot) window.mascot.set(el, pose); else if (el) { var u = el.querySelector('use'); u && u.setAttribute('href', '/app/mascot.svg#' + pose); } } catch (e) {} }
  function sayHi() {
    var hero = q('#onbHero1'), say = q('#onbSay'); if (!hero) return;
    hap('light'); setPose(hero, 'speaking'); say && say.classList.add('on');
    later(function () { setPose(hero, 'idle'); say && say.classList.remove('on'); }, 1600);
  }
  function countUp() {
    var el = q('#onbCount'); if (!el || el.dataset.done) return; el.dataset.done = '1';
    var target = 7240;
    if (reduced()) { el.textContent = fmt(target); return; }
    var t0 = performance.now(), dur = 1600;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(tick); else hap('light');
    })(t0);
  }
  function render(i) {
    var track = q('#onbTrack'); if (!track) return;
    track.style.transform = 'translate3d(' + (-i * 25) + '%,0,0)';
    var slides = track.children;
    for (var k = 0; k < slides.length; k++) { var on = k === i; slides[k].classList.toggle('active', on); slides[k].setAttribute('aria-hidden', on ? 'false' : 'true'); try { if (on) slides[k].removeAttribute('inert'); else slides[k].setAttribute('inert', ''); } catch (e) {} }
    var dots = q('#onbDots') ? q('#onbDots').children : [];
    for (var d = 0; d < dots.length; d++) { dots[d].className = d === i ? 'on' : d < i ? 'done' : ''; }
    var next = q('#onbNext'), hint = q('#onbHint');
    if (next) next.innerHTML = i === O.n - 1 ? ic('sparkles', 18, 2.2) + ' Let’s go' : i === 2 ? 'Save goals ' + ic('arrow-right', 18, 2.4) : 'Next ' + ic('arrow-right', 18, 2.4);
    if (hint) hint.textContent = i === 0 ? 'Swipe to continue' : i === O.n - 1 ? 'You can change all of this later in Profile' : '';
    if (i === 1) later(countUp, 150);
    if (i === 3) { var h = q('#onbHero4'); h && setPose(h, 'listening'); }
  }
  O.go = function (i) {
    i = Math.max(0, Math.min(O.n - 1, i | 0));
    if (i !== O.i) hap('light');
    O.i = i; render(i);
  };
  O.next = function () { if (O.i >= O.n - 1) return O.finish('done'); O.go(O.i + 1); };
  O.prev = function () { O.go(O.i - 1); };

  function onChip(btn) {
    var g = O.goals(), group = btn.dataset.g, v = btn.dataset.v, wrap = btn.parentNode;
    var was = btn.classList.contains('on');
    if (group === 'steps') { if (was) return; g.steps = +v; }
    else { g[group] = was ? null : v; }
    var all = wrap.querySelectorAll('.b-chip');
    for (var k = 0; k < all.length; k++) { var on = all[k] === btn && !was || (group === 'steps' && all[k] === btn); all[k].classList.toggle('on', on); all[k].setAttribute('aria-pressed', on ? 'true' : 'false'); }
    saveGoals(); hap(was ? 'light' : 'medium');
    var hero = q('#onbHero3'); if (hero && !was) { setPose(hero, 'celebrating'); later(function () { setPose(hero, 'idle'); }, 1200); }
  }
  function setPermState(kind, ok, msg) {
    var card = q('#onbPerm-' + kind); if (!card) return;
    card.classList.remove('busy'); card.classList.toggle('ok', !!ok); card.classList.toggle('no', !ok);
    var st = card.querySelector('.state'); if (st) st.innerHTML = ic(ok ? 'check-circle' : 'info', 18) + '<span>' + esc(msg) + '</span>';
    hap(ok ? 'success' : 'light');
    var hero = q('#onbHero4'); if (hero) { setPose(hero, ok ? 'celebrating' : 'idle'); later(function () { setPose(hero, 'listening'); }, 1400); }
  }
  O.askMic = function () {
    var card = q('#onbPerm-mic'); card && card.classList.add('busy'); hap('light');
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return Promise.resolve(setPermState('mic', false, 'Voice needs a newer browser — typing works too.'));
    return md.getUserMedia({ audio: true }).then(function (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      setPermState('mic', true, 'Microphone ready. Hold the mic to talk.');
    }).catch(function (err) {
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setPermState('mic', false, denied ? 'Blocked for now — enable it in browser settings when you want to talk.' : 'No microphone found — typing works too.');
    });
  };
  O.askNotif = function () {
    var card = q('#onbPerm-bell'); card && card.classList.add('busy'); hap('light');
    if (!('Notification' in window) || !Notification.requestPermission) return Promise.resolve(setPermState('bell', false, 'Not available here — install the app for reminders.'));
    var p; try { p = Notification.requestPermission(); } catch (e) { p = null; }
    if (!p || !p.then) p = new Promise(function (res) { try { Notification.requestPermission(res); } catch (e) { res('default'); } });
    return p.then(function (r) {
      setPermState('bell', r === 'granted', r === 'granted' ? 'Reminders on. One nudge a day, max.' : r === 'denied' ? 'Blocked for now — you can turn reminders on in settings later.' : 'Skipped — you can turn reminders on in Profile.');
    });
  };

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x0: e.clientX, y0: e.clientY, dx: 0, t0: performance.now(), on: false, id: e.pointerId };
    lastX = e.clientX;
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.on) { if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 12) drag = null; return; } drag.on = true; q('#onbTrack').classList.add('drag'); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} }
    drag.dx = dx; lastX = e.clientX;
    var w = q('#onbTrack').clientWidth / O.n, lim = (O.i === 0 && dx > 0) || (O.i === O.n - 1 && dx < 0) ? 0.35 : 1;
    q('#onbTrack').style.transform = 'translate3d(' + (-O.i * w + dx * lim) + 'px,0,0)';
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag, track = q('#onbTrack'); drag = null;
    if (!d.on) return;
    track.classList.remove('drag'); try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    var w = track.clientWidth / O.n, v = Math.abs(d.dx) / Math.max(1, performance.now() - d.t0);
    if (d.dx < -w * 0.22 || (d.dx < -30 && v > 0.45)) O.go(O.i + 1);
    else if (d.dx > w * 0.22 || (d.dx > 30 && v > 0.45)) O.go(O.i - 1);
    else render(O.i);
    // swallow the click that follows a drag
    var kill = function (ev) { ev.stopPropagation(); ev.preventDefault(); track.removeEventListener('click', kill, true); };
    track.addEventListener('click', kill, true); later(function () { track.removeEventListener('click', kill, true); }, 50);
  }
  function trapTab(e) {
    if (!O.root || e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(O.root.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (el) { return !el.closest('[inert]') && el.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !O.root.contains(document.activeElement))) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
  function onKey(e) {
    if (!O.root) return;
    trapTab(e);
    if (e.key === 'ArrowRight') { O.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { O.prev(); e.preventDefault(); }
    else if (e.key === 'Escape') { O.finish('skip'); }
  }

  O.mount = function (host) {
    if (O.root && document.body.contains(O.root)) return O.root;
    O.i = 0;
    var parent = host || document.body;
    parent.insertAdjacentHTML('beforeend', O.html());
    O.root = document.getElementById('onbRoot');
    O._prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    var track = q('#onbTrack');
    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove, { passive: false });
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', function () { if (drag && drag.on) { track.classList.remove('drag'); render(O.i); } drag = null; });
    O.root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button,[role=button]') : null; if (!t) return;
      if (t.id === 'onbNext') O.next();
      else if (t.id === 'onbSkip') O.finish('skip');
      else if (t.id === 'onbHero1') sayHi();
      else if (t.dataset.g) onChip(t);
      else if (t.dataset.perm === 'mic') O.askMic();
      else if (t.dataset.perm === 'bell') O.askNotif();
    });
    q('#onbHero1').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { sayHi(); e.preventDefault(); } });
    document.addEventListener('keydown', onKey);
    render(0);
    try { O.root.setAttribute('tabindex', '-1'); O._prevFocus = document.activeElement; O.root.focus({ preventScroll: true }); } catch (e) {}
    later(sayHi, 700);
    try { if (window.mascot && window.mascot.preload) window.mascot.preload(); } catch (e) {}
    return O.root;
  };

  O.finish = function (reason) {
    var root = O.root; if (!root) { ls(KEY_DONE, '1'); return; }
    var skipped = reason === 'skip';
    var goals = skipped ? null : saveGoals(); ls(KEY_DONE, '1');
    if (goals && goals.steps && window.api) { try { api('/steps/goal', { method: 'PUT', body: JSON.stringify({ goal: goals.steps }) }); } catch (e) {} }
    if (goals && goals.lang) { try { localStorage.setItem('bro.course', String(goals.lang)); } catch (e) {} }
    try { if (O._prevFocus && O._prevFocus.focus) O._prevFocus.focus(); } catch (e) {}
    hap(skipped ? 'light' : 'success');
    document.removeEventListener('keydown', onKey);
    O._timers.forEach(clearTimeout); O._timers = [];
    document.body.style.overflow = O._prevOverflow || '';
    var done = function () {
      try { root.parentNode && root.parentNode.removeChild(root); } catch (e) {}
      O.root = null;
      try { window.dispatchEvent(new CustomEvent('bd:onboarded', { detail: { goals: goals, skipped: skipped } })); } catch (e) {}
      try { typeof O.onDone === 'function' && O.onDone({ goals: goals, skipped: skipped }); } catch (e) {}
    };
    if (!skipped) { var h = q('#onbHero4'); h && setPose(h, 'celebrating'); }
    root.classList.add('out');
    if (reduced()) done(); else setTimeout(done, skipped ? 180 : 420);
  };
})();
