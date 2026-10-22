// Mind games: small shared helpers (markup, seeded randomness, feedback, toasts, rings).
// v24: the app-wide language (localStorage bd_lang, written by the main app: 'hi' or 'en'; missing = 'en').
// HI is read once per page load; tr('English', 'हिंदी') picks the string. Game names and the English words that are
// the gameplay (Word Builder's words, Color Clash's colour words) stay English in both.
export const HI = (() => { try { return localStorage.getItem('bd_lang') === 'hi'; } catch (e) { return false; } })();
export const tr = (en, hi) => (HI ? hi : en);
// only on the Mind pages: the main app imports store.js (→ this file) and sets its own <html lang>
if (HI) { try { if (/^\/mind\//.test(location.pathname)) document.documentElement.lang = 'hi'; } catch (e) { /* no DOM */ } }
// The main app (app/learn.js) reads a game's `skill` and can switch language without a reload: that one field reads
// the setting live.
export const trLive = (en, hi) => { try { return localStorage.getItem('bd_lang') === 'hi' ? hi : en; } catch (e) { return en; } };
// A stored best ("12.3s", saved in one language-neutral form) as shown on screen: Hindi spells the unit out.
export const rawText = t => (HI && /^\d+(\.\d+)?s$/.test(String(t)) ? String(t).slice(0, -1) + ' सेकंड' : t);
export const esc =s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
export const wait = ms => new Promise(r => setTimeout(r, ms));

// ── seeded randomness (same level → same letters / same daily workout) ──
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, R = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export const ri = (R, a, b) => a + Math.floor(R() * (b - a + 1));

// ── shared app helpers (all optional: the page still works if a script failed to load) ──
export function ico(name, size = 20, stroke) {
  try { if (window.ico) return window.ico(name, size, stroke); } catch (e) { /* fall through */ }
  return '';
}
export function sfx(kind) { try { if (window.Sfx) window.Sfx.play(kind); } catch (e) { /* audio is optional */ } }
// Chrome refuses vibrate() (and logs an intervention) until the person has tapped this page, e.g. during the
// countdown right after a navigation, so wait for user activation.
export function buzz(kind) {
  try {
    const ua = navigator.userActivation;
    if (ua && !ua.hasBeenActive) return;
    if (window.haptic) window.haptic(kind);
  } catch (e) { /* haptics are optional */ }
}
let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  const go = () => { unlocked = true; try { window.Sfx && window.Sfx.unlock(); } catch (e) { /* ignore */ } };
  addEventListener('pointerdown', go, { once: true, passive: true });
  addEventListener('keydown', go, { once: true });
}

// Fast taps: act on pointerdown (games feel instant), still honour keyboard / programmatic clicks.
export function onTap(root, sel, fn) {
  let last = 0;
  root.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const t = e.target.closest(sel);
    if (!t || !root.contains(t) || t.disabled) return;
    last = performance.now();
    fn(t, e);
  });
  root.addEventListener('click', e => {
    if (performance.now() - last < 700) return;
    const t = e.target.closest(sel);
    if (t && root.contains(t) && !t.disabled) fn(t, e);
  });
}

// ── toast ──
let toastT = 0;
export function toast(msg, tone) {
  let el = document.getElementById('m-toast');
  if (!el) { el = document.createElement('div'); el.id = 'm-toast'; el.className = 'm-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.innerHTML = (tone === 'lock' ? ico('lock', 16) : tone === 'ok' ? ico('check', 16) : '') + '<span>' + esc(msg) + '</span>';
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2300);
}

// ── progress ring (svg) ──
export function ring(frac, size = 64, stroke = 7, color = 'currentColor', track = 'var(--b-line-2)') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = clamp(frac, 0, 1);
  return `<svg class="m-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle class="m-ring-v" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

// ── star ──
export function star(size = 16, cls = '') {
  return `<svg class="m-star ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.01l-5.64 2.97 1.08-6.29L2.87 9.24l6.31-.92z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
export function stars(n, size = 12) { let h = ''; for (let i = 0; i < 3; i++) h += star(size, i < n ? 'on' : 'off'); return h; }

// ── count-up (transform-free, text only) ──
export function countUp(el, to, ms = 900, fmt = v => String(Math.round(v))) {
  if (!el) return;
  const from = 0, t0 = performance.now();
  if (reduced() || !(to > 0)) { el.textContent = fmt(to); return; }
  const ease = x => 1 - Math.pow(1 - x, 3);
  (function step(now) {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(from + (to - from) * ease(p));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

// ── confetti: retired (v15 calm style). Kept as a no-op so older call sites still work. ──
export function confetti() { /* no-op */ }

// ── large page title → small top-bar title once it scrolls under the bar (iOS-style) ──
let titleIO = null;
export function titleOnScroll(h1) {
  const bar = document.querySelector('.bd-top');
  if (!h1 || !bar) return;
  bar.classList.add('m-collapse');
  if (titleIO) titleIO.disconnect();
  try {
    titleIO = new IntersectionObserver(([e]) => bar.classList.toggle('m-titled', !e.isIntersecting && e.boundingClientRect.top < 120), { rootMargin: '-64px 0px 0px 0px' });
    titleIO.observe(h1);
  } catch (e) { bar.classList.add('m-titled'); }
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? tr('Good morning', 'सुप्रभात') : h >= 12 && h < 17 ? tr('Good afternoon', 'नमस्ते') : tr('Good evening', 'शुभ संध्या');
}
