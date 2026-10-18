// Brodoit v9.4 motion layer — screen transitions, staggered rise-ins, spring pops, count-ups,
// press feedback and a confetti burst. Plain script, no deps; honours prefers-reduced-motion.
//   Motion.after(tab)  — called by the SPA after every render
//   Motion.countUp(el) — tweens a number already in the DOM
//   Motion.confetti(x, y, n) — celebration burst (steps goal, task done)
(function () {
  'use strict';
  var reduced = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var M = window.Motion = { t: Date.now(), lastTab: null };
  var STAGGER = '.lt-tile,.lt-kid2,.bk-sum-card,.yu-tile,.bv-mode,.bv-quick button,.bv-tile,.st-mini,.nw-card,.nw-item,.st-card,.adm-card,.task-card,.task-row,.tk-card,.b-card';
  var SKIP_PRESS = '.tab,.bv-orb,.bv-face,input,textarea,select,.onb-slide,.nw-prog';

  M.after = function (tab) {
    if (reduced()) return;
    var root = document.getElementById('app'); if (!root) return;
    var fresh = tab !== M.lastTab || Date.now() - M.t < 1200; M.lastTab = tab;
    if (!fresh) return;
    var i = 0;
    root.querySelectorAll(STAGGER).forEach(function (el) {
      if (el.classList.contains('m-rise') || (el.parentElement && el.parentElement.closest('.m-rise'))) return;
      el.style.animationDelay = (Math.min(i++, 16) * 38) + 'ms'; el.classList.add('m-rise');
    });
    root.querySelectorAll('.yu-tile b,.lt-timer b,.st-count').forEach(function (el) { M.countUp(el); });
  };

  M.countUp = function (el, ms) {
    var raw = (el.textContent || '').trim(); var m = raw.match(/^([\d,]+)(.*)$/s); if (!m) return;
    var to = parseInt(m[1].replace(/,/g, ''), 10); if (!(to > 0) || el.dataset.counted === String(to)) return;
    el.dataset.counted = String(to);
    var keep = el.innerHTML.slice(m[1].length); var loc = raw.indexOf(',') >= 0 || to >= 1000;
    var t0 = performance.now(), dur = ms || Math.min(1100, 420 + String(to).length * 150);
    var ease = function (x) { return 1 - Math.pow(1 - x, 4); };
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur); var v = Math.round(to * ease(p));
      el.innerHTML = (loc ? v.toLocaleString('en-IN') : String(v)) + keep;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  };

  // Tab switches cross-fade + slide through the View Transitions API (Chrome / Android WebView);
  // other browsers keep the instant switch.
  var orig = window.switchTab;
  if (typeof orig === 'function') window.switchTab = function (t) {
    M.t = Date.now();
    var S_ = window.S || {};
    if (document.startViewTransition && !reduced() && t !== S_.tab && !document.documentElement.dataset.vt) {
      document.documentElement.dataset.vt = 'tab';
      var vt = document.startViewTransition(function () { orig(t); });
      vt.finished.then(function () { delete document.documentElement.dataset.vt; }, function () { delete document.documentElement.dataset.vt; });
    } else orig(t);
  };

  // Press feedback: anything tappable squeezes a little under the finger.
  document.addEventListener('pointerdown', function (e) {
    var el = e.target && e.target.closest && e.target.closest('button,[onclick],.b-chip,.b-btn');
    if (!el || el.matches(SKIP_PRESS) || reduced()) return;
    el.classList.add('m-press');
    var up = function () { el.classList.remove('m-press'); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }, { passive: true });

  M.confetti = function (x, y, n) {
    if (reduced()) return;
    var c = document.createElement('canvas'); c.className = 'm-confetti';
    var W = c.width = innerWidth, H = c.height = innerHeight; document.body.appendChild(c);
    var ctx = c.getContext('2d'); var cols = ['#FF5A36', '#FF2D7A', '#6C4CF1', '#00C2A8', '#FFB800', '#19C37D'];
    var ps = []; for (var k = 0; k < (n || 110); k++) ps.push({ x: x == null ? W / 2 : x, y: y == null ? H * .38 : y, vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 5, r: Math.random() * 5 + 3, c: cols[Math.random() * cols.length | 0], a: Math.random() * Math.PI, s: Math.random() * .3 - .15 });
    var t0 = performance.now();
    (function tick(now) {
      var t = (now - t0) / 1000; ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) { p.vy += .38; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.a += p.s; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - t / 1.7); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
      if (t < 1.8) requestAnimationFrame(tick); else c.remove();
    })(t0);
  };
})();
