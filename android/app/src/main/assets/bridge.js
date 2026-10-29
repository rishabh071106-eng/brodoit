// Runs in brodoit.com before the page's own scripts, inside the Play app's WebView (WebAppActivity). It tells the
// web app it is inside Brodoit for Android, and fills in what a WebView lacks, using the phone itself:
//   navigator.share (text, links, images) → Android's share sheet
//   navigator.clipboard.writeText        → Android's clipboard
//   SpeechRecognition                    → Android's speech recognizer (English, हिंदी)
//   window.open                          → a Chrome tab (Google sign-in, other sites); the app stays on Brodoit
// %PKG% and %VER% are filled in by WebAppActivity.
(function () {
  'use strict';
  if (window.__brodoitApp) return;
  window.__brodoitApp = true;
  var PKG = '%PKG%', VER = '%VER%';
  // the steps tab reads these to know it runs inside the app (and which one) without a Chrome referrer
  try { localStorage.setItem('bd_twa', '1'); localStorage.setItem('bd_twa_pkg', PKG); localStorage.setItem('bd_shell', 'webview'); } catch (e) {}
  var App = window.BrodoitApp = { platform: 'android', shell: 'webview', package: PKG, version: VER };
  var N = window.BrodoitNative;
  if (!N) return;

  var seq = 0, waiting = {}, handlers = {};
  function send(type, data) { var m = data || {}; m.type = type; N.postMessage(JSON.stringify(m)); }
  function call(type, data) {
    return new Promise(function (resolve, reject) {
      var id = ++seq; waiting[id] = { resolve: resolve, reject: reject };
      var m = data || {}; m.id = id; send(type, m);
    });
  }
  function on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); }
  N.addEventListener('message', function (e) {
    var m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.id && waiting[m.id]) {
      var w = waiting[m.id]; delete waiting[m.id];
      if (m.error) w.reject(new DOMException(m.error, m.name || 'AbortError')); else w.resolve(m.result);
      return;
    }
    (handlers[m.event] || []).forEach(function (f) { try { f(m); } catch (x) {} });
  });
  App.openExternal = function (url) { return call('open', { url: String(url) }); };

  // ---- sharing --------------------------------------------------------------------------------------------------
  function dataURL(blob) {
    return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(blob); });
  }
  function share(d) {
    d = d || {};
    var files = Array.prototype.slice.call(d.files || [], 0, 4);
    return Promise.all(files.map(function (f) {
      return dataURL(f).then(function (u) { return { name: f.name || 'brodoit.png', type: f.type || 'image/png', data: u }; });
    })).then(function (list) {
      return call('share', { title: String(d.title || ''), text: String(d.text || ''), url: String(d.url || ''), files: list });
    }).then(function () {});
  }
  try {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    Object.defineProperty(navigator, 'canShare', { value: function (d) { return !!d && !!(d.title || d.text || d.url || (d.files && d.files.length)); }, configurable: true, writable: true });
  } catch (e) {}

  // ---- clipboard ------------------------------------------------------------------------------------------------
  function copy(t) { return call('copy', { text: String(t) }).then(function () {}); }
  try {
    if (navigator.clipboard) navigator.clipboard.writeText = copy;
    else Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy, readText: function () { return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); } }, configurable: true });
  } catch (e) {}

  // ---- window.open: other pages open in a Chrome tab; the app keeps Brodoit on screen -----------------------------
  var opened = [];
  window.open = function (url, target) {
    var u; try { u = new URL(url || '', location.href); } catch (e) { return null; }
    if (u.origin === location.origin && (target === '_self' || target === '_top')) { location.href = u.href; return window; }
    call('open', { url: u.href }).catch(function () {});
    var w = { closed: false, close: function () { w.closed = true; }, focus: function () {}, blur: function () {}, postMessage: function () {}, location: { href: u.href } };
    opened.push(w);
    return w;
  };
  // back from the Chrome tab: those windows count as closed (Google sign-in then re-checks the connection)
  on('resume', function () {
    opened.forEach(function (w) { w.closed = true; }); opened = [];
    try { window.dispatchEvent(new Event('brodoit:resume')); } catch (e) {}
  });

  // ---- speech recognition (Web Speech API shape) ----------------------------------------------------------------
  var active = null;
  function Rec() {
    this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
    this.onstart = this.onend = this.onerror = this.onresult = this.onnomatch = null;
    this.onaudiostart = this.onaudioend = this.onsoundstart = this.onsoundend = this.onspeechstart = this.onspeechend = null;
    this._l = {}; this._results = [];
  }
  Rec.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
  Rec.prototype.removeEventListener = function (t, f) { var a = this._l[t] || [], i = a.indexOf(f); if (i >= 0) a.splice(i, 1); };
  Rec.prototype._emit = function (t, ev) {
    ev = ev || {}; ev.type = t; ev.target = this; ev.currentTarget = this;
    var self = this, h = this['on' + t];
    if (typeof h === 'function') { try { h.call(this, ev); } catch (x) { setTimeout(function () { throw x; }); } }
    (this._l[t] || []).slice().forEach(function (f) { try { f.call(self, ev); } catch (x) { setTimeout(function () { throw x; }); } });
  };
  Rec.prototype.start = function () {
    if (active === this) throw new DOMException('recognition has already started', 'InvalidStateError');
    if (active) active.abort();
    active = this; this._results = [];
    send('sr-start', { lang: this.lang || document.documentElement.lang || navigator.language || 'en-IN', interim: !!this.interimResults, continuous: !!this.continuous });
  };
  Rec.prototype.stop = function () { if (active === this) send('sr-stop'); };
  Rec.prototype.abort = function () { if (active === this) send('sr-abort'); };
  function alternatives(texts, final) {
    var r = texts.map(function (t, i) { return { transcript: String(t), confidence: i === 0 ? 0.9 : 0.5 }; });
    r.isFinal = final; r.item = function (i) { return this[i]; };
    return r;
  }
  on('sr', function (m) {
    var r = active; if (!r) return;
    if (m.kind === 'start') { r._emit('start'); r._emit('audiostart'); }
    else if (m.kind === 'speechstart') { r._emit('soundstart'); r._emit('speechstart'); }
    else if (m.kind === 'speechend') { r._emit('speechend'); r._emit('soundend'); }
    else if (m.kind === 'result') {
      var list = r._results, last = list.length - 1;
      var idx = last >= 0 && !list[last].isFinal ? last : list.length;
      list[idx] = alternatives(m.texts || [], !!m.final); list.length = idx + 1;
      var results = list.slice(); results.item = function (i) { return this[i]; };
      r._emit('result', { results: results, resultIndex: idx });
    }
    else if (m.kind === 'nomatch') r._emit('nomatch', { results: [] });
    else if (m.kind === 'error') r._emit('error', { error: m.error || 'aborted', message: m.message || '' });
    else if (m.kind === 'end') { if (active === r) active = null; r._emit('audioend'); r._emit('end'); }
  });
  try {
    Object.defineProperty(window, 'SpeechRecognition', { value: Rec, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Rec, configurable: true, writable: true });
  } catch (e) {}
})();
