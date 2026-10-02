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

const NAV_LINKS = [
  ['index.html', 'Prep'],
  ['ncert.html', 'NCERT'],
  ['exams.html', 'Exam Prep'],
  ['progress.html', 'My Progress'],
];

export function renderNav(active) {
  const nav = document.createElement('nav');
  nav.innerHTML = `<div class="nav-inner">
    <a href="/?learn=1" class="logo" title="Back to Brodoit"><span aria-hidden="true">←</span> <span class="logo-dot"></span> Brodoit</a>
    <div class="nav-links">${NAV_LINKS.map(([href, label]) =>
      `<a href="${href}"${href === active ? ' class="active"' : ''}>${label}</a>`).join('')}</div>
  </div>`;
  document.body.prepend(nav);
}

export function renderFooter() {
  const f = document.createElement('footer');
  f.innerHTML = `<div class="logo"><span class="logo-dot"></span> Brodoit</div>
    <p>Free NCERT books and exam prep for every student. Your progress is saved in this browser.</p>
    <p style="margin-top:.5rem"><a href="/?learn=1">← Back to Brodoit</a></p>`;
  document.body.append(f);
}
