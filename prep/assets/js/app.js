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
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
};
export { ICON };

const TABS = [
  ['index.html', 'Home', 'home'],
  ['exams.html', 'Exams', 'exams'],
  ['ssb.html', 'SSB Journey', 'ssb'],
  ['progress.html', 'My Board', 'me'],
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
