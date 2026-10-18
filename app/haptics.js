// Brodoit v10 haptics — tiny vibration vocabulary for taps, confirmations and errors.
//   window.haptic('light'|'medium'|'heavy'|'success'|'error'|'warning'|'select') → true if a pulse was sent
// No-op (returns false) when navigator.vibrate is unsupported, the user prefers reduced motion,
// the page is hidden, or haptics were switched off (localStorage bd_haptics === '0').
// Plain script, zero deps. Guard callers with `window.haptic && haptic('light')`.
(function () {
  'use strict';
  var PATTERNS = {
    light: [8],
    medium: [14],
    heavy: [22],
    select: [5],
    success: [10, 40, 14],
    warning: [14, 30, 14],
    error: [30, 40, 30]
  };
  var reduced = null;
  try { reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { reduced = null; }

  function supported() {
    try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch (e) { return false; }
  }
  function enabled() {
    try { return localStorage.getItem('bd_haptics') !== '0'; } catch (e) { return true; }
  }
  function haptic(kind) {
    try {
      if (!supported()) return false;
      if (reduced && reduced.matches) return false;
      if (!enabled()) return false;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
      var p = PATTERNS[kind] || (Array.isArray(kind) ? kind : PATTERNS.light);
      return !!navigator.vibrate(p);
    } catch (e) { return false; }
  }
  haptic.patterns = PATTERNS;
  haptic.supported = supported;
  haptic.enabled = enabled;
  haptic.setEnabled = function (on) { try { localStorage.setItem('bd_haptics', on ? '1' : '0'); } catch (e) {} return !!on; };
  haptic.stop = function () { try { supported() && navigator.vibrate(0); } catch (e) {} };
  window.haptic = haptic;
})();
