// Brodoit Languages — phrase courses ("Indian languages & more"): data loading, progress keys,
// the 60-day challenge and the quick-check builder. Progress lives in the SAME store as the
// audio/practice courses (lang.progress.v1) under keys `phr/<language>/<lesson>`.
import { loadJSON, store, today, computeStreak } from '/lang/assets/lang.js?v=9';

export const PHRASE_XP = 30;

export const loadPhraseCatalog = () => loadJSON('/lang/data/phrases/catalog.json');
export const loadPhraseLang = id => (id ? loadJSON(`/lang/data/phrases/${encodeURIComponent(id)}.json`) : Promise.resolve(null));
export const loadAllPhraseLangs = async cat => Object.fromEntries(await Promise.all(phraseIds(cat).map(async id => [id, await loadPhraseLang(id)])));

export const phraseIds = cat => (cat?.categories || []).flatMap(c => c.languages);
export const phraseKey = (lang, lesson) => `phr/${lang}/${lesson}`;
export const phrasesHref = id => `/lang/phrases.html?l=${encodeURIComponent(id)}`;
export const phraseLessonHref = (id, n) => `/lang/phrase-lesson.html?l=${encodeURIComponent(id)}&n=${encodeURIComponent(n)}`;

// Phrase courses that double as a Brodoit audio/practice course: shown under that course, not in the index section.
export const COURSE_OF = { spanish: 'es', french: 'fr', german: 'de', japanese: 'ja' };
export const PHRASE_OF = Object.fromEntries(Object.entries(COURSE_OF).map(([a, b]) => [b, a]));

// Emblem shown in the card's flag box: the classic "ka" letter for Indian scripts, a flag otherwise.
export const EMBLEM = { bengali: 'ক', kannada: 'ಕ', malayalam: 'ക', tamil: 'க', telugu: 'క', mandarin: '中', spanish: '🇪🇸', french: '🇫🇷', german: '🇩🇪', japanese: '🇯🇵' };
export const emblem = id => EMBLEM[id] || '🌍';

// Google-Fonts family for scripts that many desktops lack.
export const NATIVE_FONT = { bengali: 'Noto Sans Bengali', kannada: 'Noto Sans Kannada', malayalam: 'Noto Sans Malayalam', tamil: 'Noto Sans Tamil', telugu: 'Noto Sans Telugu', japanese: 'Noto Sans JP', mandarin: 'Noto Sans SC' };
export function applyNativeFont(id) {
  const f = NATIVE_FONT[id];
  document.documentElement.style.setProperty('--native-font', f ? `'${f}', var(--b-sans)` : 'var(--b-sans)');
}

// How many lessons of a phrase course are done.
export function phraseProgress(id, cat, s = store.read()) {
  const total = cat?.lessons?.length || 0;
  const done = (cat?.lessons || []).filter(l => s.done[phraseKey(id, l.id)]).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ---- 60-day challenge: one lesson a day, every language in catalog order ----
export function challengePlan(cat) {
  return phraseIds(cat).flatMap(lang => cat.lessons.map(l => ({ lang, lesson: l.id, key: phraseKey(lang, l.id) }))).map((x, i) => ({ ...x, day: i + 1 }));
}
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);

export function challengeStatus(cat, s = store.read(), now = today()) {
  const plan = challengePlan(cat), total = plan.length;
  const start = s.phrStart || null;
  const unlocked = start ? Math.min(total, Math.max(1, dayDiff(start, now) + 1)) : 0;
  const days = plan.map(p => ({ ...p, state: s.done[p.key] ? 'done' : !start ? 'locked' : p.day < unlocked ? 'missed' : p.day === unlocked ? 'today' : 'locked' }));
  const doneCount = days.filter(d => d.state === 'done').length;
  const next = days.find(x => x.state === 'missed') || days.find(x => x.state === 'today') || days.find(x => x.state !== 'done');
  return { started: !!start, start, total, unlocked, days, doneCount, streak: computeStreak(s.daily), next, finished: doneCount === total, pct: Math.round((100 * doneCount) / total) };
}
export function startChallenge() { return store.update(s => { if (!s.phrStart) s.phrStart = today(); }); }

// ---- Quick check: built from the lesson's own phrases ----
export function phraseQuiz(cat, language, lessonId, seed = Date.now()) {
  const meta = cat.lessons.find(l => l.id === lessonId), lesson = language.lessons.find(l => l.id === lessonId);
  let r = seed % 2147483647 || 1;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const items = meta.phrases.map(p => ({ en: p.en, ...lesson.phrases.find(x => x.key === p.key) })).filter(p => p.native);
  // Two "listen and pick", then two "say it back".
  return shuffle(items).slice(0, 4).map((p, n) => {
    const wrong = shuffle(items.filter(x => x.key !== p.key)).slice(0, 3);
    const opts = shuffle([p, ...wrong]);
    return n < 2 ? { t: 'listen', phrase: p, options: opts, answer: opts.indexOf(p) } : { t: 'speak', phrase: p };
  });
}

// Merge catalog lesson meta (title, goal, English) with the language's own phrases.
export function lessonPhrases(cat, language, lessonId) {
  const meta = cat.lessons.find(l => l.id === lessonId), lesson = language.lessons.find(l => l.id === lessonId);
  if (!meta || !lesson) return [];
  return meta.phrases.map(p => ({ en: p.en, ...lesson.phrases.find(x => x.key === p.key) })).filter(p => p.native);
}
