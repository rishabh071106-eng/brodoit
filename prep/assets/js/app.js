// Shared helpers for the learning pages: data loading, progress store, nav.
// Progress lives in this browser's localStorage only (no accounts yet).

const STORE_KEY = 'academy.progress.v1';
const ACTIVITY_CAP = 300;

function emptyStore() {
  return { completed: {}, listen: {}, study: {}, days: {}, activity: [], ncert: {}, companies: [], last: null };
}

export const store = {
  read() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...emptyStore(), ...JSON.parse(raw) } : emptyStore();
    } catch { return emptyStore(); }
  },
  write(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode: progress just won't persist */ }
  },
  update(fn) { const s = this.read(); fn(s); this.write(s); return s; },
  reset() { try { localStorage.removeItem(STORE_KEY); } catch {} },
};

export const today = () => new Date().toISOString().slice(0, 10);

// Adds study seconds to a chapter and to today's total (used for streak + daily chart).
export function addTime(kind, key, seconds) {
  if (!seconds) return;
  store.update(s => {
    s[kind][key] = (s[kind][key] || 0) + seconds;
    s.days[today()] = (s.days[today()] || 0) + seconds;
  });
}

export function logActivity(entry) {
  store.update(s => {
    s.activity.unshift({ at: Date.now(), ...entry });
    s.activity.length = Math.min(s.activity.length, ACTIVITY_CAP);
  });
}

export function streak(days) {
  let n = 0;
  const d = new Date();
  // A streak survives until the end of today even if nothing was studied yet today.
  if (!days[d.toISOString().slice(0, 10)]) d.setDate(d.getDate() - 1);
  while (days[d.toISOString().slice(0, 10)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const cache = new Map();
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then(r => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const loadCatalog = () => loadJSON('data/catalog.json');
export const loadExam = id => loadJSON(`data/exams/${id}.json`);

// Returns the exam plus, when it declares a shared "core" syllabus, the core exam.
export async function loadExamWithCore(id) {
  const exam = await loadExam(id);
  const core = exam.core ? await loadExam(exam.core).catch(() => null) : null;
  return { exam, core };
}

export function examChapters(exam) {
  const out = [];
  for (const s of exam.subjects || []) for (const c of s.chapters || []) out.push({ subject: s, chapter: c, key: `${exam.id}/${s.id}/${c.id}` });
  return out;
}

export function esc(str = '') {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Card text supports **bold**, `code` and line breaks; everything else is escaped.
export function richText(str = '') {
  return esc(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

export function fmtMinutes(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const param = name => new URLSearchParams(location.search).get(name);

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg>',
  exams: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  ssb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
};
export { ICON };

const TABS = [
  ['index.html', 'Home', 'home'],
  ['exams.html', 'Exams', 'exams'],
  ['ssb.html', 'SSB', 'ssb'],
  ['groups.html', 'Groups', 'groups'],
  ['progress.html', 'Board', 'me'],
];

// Top bar (back + title + optional right slot) and the floating bottom tab bar.
export function renderChrome({ active, title = '', back = null, right = '' } = {}) {
  const top = document.createElement('header');
  top.className = 'topbar';
  const backHref = back || '/?learn=1';
  top.innerHTML = `<div class="wrap">
    <a class="icon-btn press" href="${backHref}" aria-label="${back ? 'Back' : 'Back to Brodoit'}">${ICON.back}</a>
    <div class="title">${title || '<span class="brand">Brodoit <b>Prep</b></span>'}</div>${right}</div>`;
  document.body.prepend(top);
  const bar = document.createElement('div');
  bar.className = 'tabbar';
  bar.innerHTML = `<nav>${TABS.map(([href, label, ic]) =>
    `<a href="${href}" class="${href === active ? 'on' : ''}">${ICON[ic]}${label}</a>`).join('')}</nav>`;
  document.body.append(bar);
}

export function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---- Brodoit account API (same token as the main app) ----
export function token() { try { return localStorage.getItem('tf_token') || ''; } catch { return ''; } }
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/prep' + path, {
    method,
    headers: { 'x-token': token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return data;
}
export function signInCard() {
  return `<div class="card" style="padding:22px;text-align:center;margin-top:10px">
    <div style="font-size:44px">🔐</div><div class="h-md" style="margin-top:6px">Sign in to join groups</div>
    <p class="muted" style="font-size:14px;margin:6px 0 14px">Groups use your Brodoit account so approvers know who is joining.</p>
    <a class="btn btn-dark press" href="/">Sign in on Brodoit</a>
    <p class="muted" style="font-size:12px;margin-top:10px">After signing in, come back to Learn → Groups.</p></div>`;
}

// ---- Exam countdowns (also read by the main app's Learn tab from the same storage key) ----
export function examCountdowns() {
  const t0 = new Date(new Date().toDateString()).getTime();
  return Object.entries(store.read().examDates || {})
    .map(([key, x]) => ({ key, ...x, days: Math.round((new Date(x.date + 'T00:00:00').getTime() - t0) / 86400000) }))
    .sort((a, b) => (a.days < 0) - (b.days < 0) || a.days - b.days);
}
export function setExamDate(key, { name, date, examId }) {
  store.update(s => { s.examDates = { ...(s.examDates || {}), [key]: { name, date, examId, setAt: Date.now() } }; });
}
export function removeExamDate(key) { store.update(s => { if (s.examDates) delete s.examDates[key]; }); }
export function countdownStrip(max = 3) {
  const list = examCountdowns().filter(x => x.days >= 0).slice(0, max);
  if (!list.length) return `<a class="row press" href="countdown.html" style="margin-top:14px;border:1px dashed var(--line)"><div class="thumb" style="background:var(--g-ssb);font-size:24px">⏳</div>
    <div class="body"><div class="t">Set your exam date</div><div class="s">See the days left on every screen</div></div><span class="chev">›</span></a>`;
  return `<div class="rail" style="margin-top:12px">${list.map(x => `<a class="press" href="countdown.html" style="min-width:150px;border-radius:20px;padding:14px 16px;color:#fff;background:linear-gradient(140deg,#14213D,#2B4C8C 60%,#F2A541);box-shadow:var(--shadow)">
    <div style="font-size:32px;font-weight:800;letter-spacing:-.04em;line-height:1">${x.days}</div><div style="font-size:11px;font-weight:700;opacity:.85">${x.days === 1 ? 'day' : 'days'} to go</div>
    <div style="font-size:13.5px;font-weight:800;margin-top:6px">${esc(x.name)}</div></a>`).join('')}
    <a class="press" href="countdown.html" style="min-width:110px;border-radius:20px;padding:14px;display:grid;place-items:center;background:var(--card);box-shadow:var(--shadow);font-weight:800;font-size:13px;text-align:center">＋<br>Add exam</a></div>`;
}
