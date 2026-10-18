// Shared helpers for the Python school: markup, progress (local first, synced to the server
// so Bro knows how you are growing), recorded narration with a device-voice fallback.
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tiny markup: **bold**, *italic*, `code`, "- " bullets, line breaks.
let inlineMd = null;
export function mdInline(s) { if (!inlineMd) md(''); return inlineMd(String(s || '')); }
export function md(s) {
  const lines = String(s || '').split('\n');
  let html = '', list = false;
  // code spans are cut out first so * inside code (.*?, **kwargs) never turns into bold/italic
  const inline = t => {
    const codes = [];
    const out = esc(t).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; })
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s.,;:!?)]|$)/g, '$1<i>$2</i>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
  };
  inlineMd = inline;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^- /.test(l)) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + inline(l.slice(2)) + '</li>'; continue; }
    if (list) { html += '</ul>'; list = false; }
    html += l.trim() ? '<p>' + inline(l) + '</p>' : '';
  }
  return html + (list ? '</ul>' : '');
}

export const token = () => { try { return localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };

export async function api(path, body, method) {
  const t = token();
  const r = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { 'x-token': t } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status, body: j });
  return j;
}

// ── progress ──
const KEY = 'bd.py.v1';
const blank = () => ({ days: {}, xp: 0, log: [], unlockAll: false, voice: true, started: null });
export const progress = {
  read() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return blank(); } },
  write(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode */ } },
  day(p, d) { return p.days['d' + d] || null; },
  doneCount(p) { return Object.values(p.days).filter(x => x && x.done).length; },
  current(p, total = 60) { for (let d = 1; d <= total; d++) if (!(p.days['d' + d] && p.days['d' + d].done)) return d; return total; },
  open(p, d) { return p.unlockAll || d === 1 || !!(p.days['d' + d] && p.days['d' + d].slide != null) || !!(p.days['d' + (d - 1)] && p.days['d' + (d - 1)].done); },
  streak(p) {
    const days = new Set(p.log.map(e => e.on));
    let n = 0; const dt = new Date();
    if (!days.has(dayKey(dt))) dt.setDate(dt.getDate() - 1);
    while (days.has(dayKey(dt))) { n++; dt.setDate(dt.getDate() - 1); }
    return n;
  },
};
export function dayKey(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); }

// Merge with the server copy (the server keeps the max of each field) and remember activity days.
export async function syncProgress(update) {
  const p = progress.read();
  if (update) {
    const k = 'd' + update.day, cur = p.days[k] || {};
    p.days[k] = Object.assign(cur, update.patch || {});
    if (update.xp) p.xp += update.xp;
    if (!p.started) p.started = dayKey();
    if (!p.log.some(e => e.on === dayKey())) p.log.push({ on: dayKey() });
    if (p.log.length > 120) p.log = p.log.slice(-120);
    progress.write(p);
  }
  if (!token()) return p;
  try {
    const r = await api('/api/learn/progress', { course: 'py', units: p.days, xp: p.xp, events: update && update.events || [] });
    if (r && r.units) {
      for (const [k, v] of Object.entries(r.units)) {
        const mine = p.days[k] || {};
        p.days[k] = Object.assign({}, v, mine, { done: !!(mine.done || v.done), best: Math.max(mine.best || 0, v.best || 0), slide: Math.max(mine.slide || 0, v.slide || 0) });
      }
      p.xp = Math.max(p.xp, r.xp || 0);
      progress.write(p);
    }
  } catch (e) { /* offline: local copy wins until next sync */ }
  return p;
}

// ── narration: recorded once on the server (studio voice), kept forever; device voice as fallback ──
export async function sid(voice, text) {
  const data = new TextEncoder().encode(voice + '\n' + String(text).trim());
  const buf = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

let audio = null, speakGen = 0;
export function stopVoice() {
  speakGen++;
  if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } audio = null; }
  try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}

function deviceSpeak(text, lang, gen, onEnd) {
  try {
    if (!('speechSynthesis' in window)) return onEnd(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 1;
    const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    const best = vs.find(v => /Google|Natural|Neural/i.test(v.name)) || vs[0]; if (best) u.voice = best;
    u.onend = u.onerror = () => { if (gen === speakGen) onEnd(true); };
    speechSynthesis.speak(u);
  } catch (e) { onEnd(false); }
}

// Plays the recorded clip for `text`; falls back to the device voice. Resolves when finished.
export function speak(text, { voice = 'py', lang = 'en-IN', onStart } = {}) {
  stopVoice();
  const gen = ++speakGen;
  text = String(text || '').trim();
  if (!text) return Promise.resolve(false);
  return new Promise(async resolve => {
    let id = '';
    try { id = await sid(voice, text); } catch (e) { /* no SubtleCrypto (http) */ }
    if (gen !== speakGen) return resolve(false);
    const fallback = () => { if (gen !== speakGen) return resolve(false); onStart && onStart('device'); deviceSpeak(text, lang, gen, resolve); };
    if (!id) return fallback();
    const a = new Audio('/api/learn/say/' + id + '.mp3');
    audio = a;
    let started = false;
    a.onplaying = () => { if (!started) { started = true; onStart && onStart('studio'); } };
    a.onended = () => { if (gen === speakGen) resolve(true); };
    a.onerror = () => { if (!started) fallback(); else resolve(false); };
    a.play().catch(() => { if (!started) fallback(); });
  });
}

export function confetti(host, n = 60) {
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#FFD43B', '#5AA9F0', '#3DDC97', '#FF7A59', '#C084FC', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.25}s;--dx:${(Math.random() - 0.5) * 220}px;--r:${Math.random() * 720 - 360}deg;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px`;
    box.appendChild(s);
  }
  (host || document.body).appendChild(box);
  setTimeout(() => box.remove(), 2200);
}

export function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }
export const param = k => new URLSearchParams(location.search).get(k);
