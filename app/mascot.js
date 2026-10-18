// Brodoit v10 mascot helper — "Bro", the speech-bubble smiley from the app icon, in 7 poses.
//   window.mascot(pose = 'idle', size = 96) → '<svg …><use href="/app/mascot.svg#pose"/></svg>'
//   mascot.poses → ['idle','listening','speaking','walking','celebrating','sleeping','locked']
//   mascot.set(el, pose) swaps the pose on an already-rendered mascot element (no re-render needed)
//   mascot.preload() inlines the sprite into <body> once so later <use> lookups are local (optional, offline-safe)
// Ink details (shoes, footprints, Z's, padlock) use currentColor; the host svg sets color:var(--b-ink) so they follow the theme.
// Plain script, zero deps.
(function () {
  'use strict';
  var SRC = '/app/mascot.svg';
  var POSES = ['idle', 'listening', 'speaking', 'walking', 'celebrating', 'sleeping', 'locked'];
  var LABEL = { idle: 'Bro', listening: 'Bro is listening', speaking: 'Bro is talking', walking: 'Bro is walking', celebrating: 'Bro is celebrating', sleeping: 'Bro is asleep', locked: 'Locked' };
  var inlined = false;

  function pose(p) { return POSES.indexOf(p) >= 0 ? p : 'idle'; }
  function href(p) { return (inlined ? '' : SRC) + '#' + p; }

  function mascot(p, size, opts) {
    p = pose(p); opts = opts || {};
    var s = +size > 0 ? +size : 96;
    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var cls = 'mascot mascot-' + p + (opts.className ? ' ' + esc(opts.className) : '');
    var label = esc(opts.label || LABEL[p]);
    var style = 'color:' + esc(opts.color || 'var(--b-ink,#17141F)') + (opts.style ? ';' + esc(opts.style) : '');
    return '<svg class="' + cls + '" width="' + s + '" height="' + s + '" viewBox="0 0 200 200" role="img" aria-label="' + label +
      '" data-pose="' + p + '" style="' + style + '"><use href="' + href(p) + '" xlink:href="' + href(p) + '"/></svg>';
  }
  mascot.poses = POSES.slice();
  mascot.src = SRC;
  mascot.set = function (el, p) {
    if (!el) return;
    if (!(el instanceof SVGElement) && el.querySelector) el = el.querySelector('svg.mascot') || el;
    var u = el.querySelector && el.querySelector('use');
    if (!u) return;
    p = pose(p);
    u.setAttribute('href', href(p)); u.setAttribute('xlink:href', href(p));
    el.setAttribute('data-pose', p);
    el.setAttribute('aria-label', LABEL[p]);
    el.className.baseVal = 'mascot mascot-' + p + (el.className.baseVal.replace(/\bmascot(-\w+)?\b/g, '').trim() ? ' ' + el.className.baseVal.replace(/\bmascot(-\w+)?\b/g, '').trim() : '');
  };
  mascot.preload = function () {
    if (inlined || typeof fetch !== 'function' || !document.body) return Promise.resolve(false);
    return fetch(SRC, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
      if (!txt || inlined || !/<symbol/.test(txt)) return false;
      var box = document.createElement('div');
      box.id = 'mascotSprite'; box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      box.innerHTML = txt.replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
      document.body.insertBefore(box, document.body.firstChild);
      inlined = true;
      // repoint already-rendered mascots to the local sprite
      var uses = document.querySelectorAll('svg.mascot use');
      for (var i = 0; i < uses.length; i++) { var h = (uses[i].getAttribute('href') || '').split('#')[1]; if (h) { uses[i].setAttribute('href', '#' + h); uses[i].setAttribute('xlink:href', '#' + h); } }
      return true;
    }).catch(function () { return false; });
  };
  window.mascot = mascot;
})();
