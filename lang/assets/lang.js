// Brodoit Languages — shared helpers: store, i18n, data loading, chrome, TTS, speech recognition, similarity, confetti.

export const STORE_KEY = 'lang.progress.v1';
export const DAILY_GOAL = 50;
export const LESSON_XP = 50;

export const today = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const dayBefore = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return today(d); };

function emptyStore() {
  return { course: null, xp: 0, streak: 0, lastDay: null, daily: {}, done: {}, hearts: 3 };
}
export const store = {
  read() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? { ...emptyStore(), ...JSON.parse(raw) } : emptyStore(); }
    catch { return emptyStore(); }
  },
  write(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode */ } },
  update(fn) { const s = this.read(); fn(s); this.write(s); return s; },
};

// Consecutive days (ending today or yesterday) with at least one lesson completed.
export function computeStreak(daily) {
  let d = today(), n = 0;
  if (!daily[d]) d = dayBefore(d);
  while (daily[d]) { n++; d = dayBefore(d); }
  return n;
}

export function isDone(key) { return !!store.read().done[key]; }

// Marks a lesson done, adds XP, refreshes the streak and tells the host app.
export function completeLesson(key, xp = LESSON_XP, extra = {}) {
  const s = store.update(s => {
    const t = today();
    s.done[key] = Date.now();
    s.xp = (s.xp || 0) + xp;
    s.daily[t] = (s.daily[t] || 0) + xp;
    s.lastDay = t;
    s.streak = computeStreak(s.daily);
  });
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'brodoit-xp', xp }, '*'); } catch { /* no host */ }
  syncLesson(key, s, extra);
  return s;
}

// Tell the server (modules/learn.js) so Bro knows how each language is growing. Fire-and-forget.
function syncLesson(key, s, extra = {}) {
  try {
    const tok = localStorage.getItem('tf_token'); if (!tok) return;
    const [course, unit] = String(key).split('/');
    if (!['es', 'fr', 'de', 'hi', 'en'].includes(course) || !unit) return;
    const xp = Object.keys(s.done).filter(k => k.startsWith(course + '/')).length * LESSON_XP;
    fetch('/api/learn/progress', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-token': tok },
      body: JSON.stringify({ course, unit, units: { [unit.slice(0, 24)]: { done: true, best: extra.accuracy == null ? 100 : extra.accuracy } }, xp, events: [{ kind: 'complete', unit, score: extra.accuracy, mistakes: extra.wrong || 0 }] }) }).catch(() => {});
  } catch { /* offline */ }
}

export function setCourse(code) { store.update(s => { s.course = code; }); }

// ---- i18n: UI labels in the learner's language ----
const UI = {
  en: {
    continue: 'Continue', start: 'Start', review: 'Review', locked: 'Locked', done: 'Done', audio: '🎧 Audio lessons', practice: '✍️ Practice',
    min: 'min', lessons: 'lessons', xp: 'XP', streak: 'day streak', goal: 'daily goal', today: 'Today', next: 'Next lesson',
    check: 'Check', correct: 'Nicely done!', wrong: 'Not quite', answer: 'Correct answer', tapWords: 'Tap the words in order',
    tapToSpeak: 'Tap to speak', listening: 'Listening…', cantSpeak: "Can't speak now", noMic: 'Speech recognition is not available here — tap skip.',
    heard: 'We heard', lessonDone: 'Lesson complete!', accuracy: 'accuracy', time: 'time', back: 'Back to course', again: 'Practice again',
    outOfHearts: 'Out of hearts', outOfHeartsSub: 'Mistakes are how we learn. Refill and keep going?', refill: 'Refill & keep going', quit: 'Quit lesson',
    comingSoon: 'Course coming soon', comingSoonSub: "We're still recording this one. Check back shortly.", browse: 'Browse courses',
    newWord: 'New word', chooseKind: 'Select the meaning', translateKind: 'Translate this sentence', listenKind: 'Tap what you hear', speakKind: 'Say this sentence', matchKind: 'Match the pairs', fillKind: 'Fill in the blank',
    firstLesson: 'Finish the previous lesson first', unit: 'Unit', repeat: 'Repeat', skip: 'Skip 10', speed: 'Speed', sayIt: 'Say it out loud', listenAgain: 'Listen again', great: 'Great!',
    lessonComplete: 'Lesson complete', keepGoing: 'Keep the streak alive tomorrow.', playing: 'Playing', paused: 'Paused', tapPlay: 'Tap play to begin',
    hintTap: 'Tap caption to hide for pure listening', wordsHint: 'Build the sentence here',
    yourTurn: 'Your turn: say it!', checking: 'Checking…', yes: 'Yes! 🔥', tryAgain: 'Not quite. Listen, then try again', youSaid: 'You said',
    didntHear: "I didn't hear you. Say it again!", hearAgain: 'Hear it again', stopForNow: 'Stop for now', tryMic: 'Tap the mic and say it',
    micBlocked: 'Allow the microphone to keep going', saved: 'Saved: you will continue right here', pausedSpeak: 'Paused: come back when you can speak', canSpeak: 'I can speak now',
  },
  hi: {
    continue: 'जारी रखें', start: 'शुरू करें', review: 'दोहराएँ', locked: 'लॉक', done: 'पूरा', audio: '🎧 ऑडियो पाठ', practice: '✍️ अभ्यास',
    min: 'मिनट', lessons: 'पाठ', xp: 'XP', streak: 'दिन की स्ट्रीक', goal: 'दैनिक लक्ष्य', today: 'आज', next: 'अगला पाठ',
    check: 'जाँचें', correct: 'बहुत बढ़िया!', wrong: 'थोड़ा और', answer: 'सही उत्तर', tapWords: 'शब्दों को क्रम में छुएँ',
    tapToSpeak: 'बोलने के लिए छुएँ', listening: 'सुन रहे हैं…', cantSpeak: 'अभी नहीं बोल सकते', noMic: 'यहाँ स्पीच रिकग्निशन उपलब्ध नहीं — स्किप करें।',
    heard: 'हमने सुना', lessonDone: 'पाठ पूरा!', accuracy: 'सटीकता', time: 'समय', back: 'कोर्स पर वापस', again: 'फिर अभ्यास करें',
    outOfHearts: 'दिल खत्म', outOfHeartsSub: 'गलतियों से ही सीखते हैं। फिर से भरें और आगे बढ़ें?', refill: 'भरें और आगे बढ़ें', quit: 'पाठ छोड़ें',
    comingSoon: 'कोर्स जल्द आ रहा है', comingSoonSub: 'हम इसे अभी रिकॉर्ड कर रहे हैं। थोड़ी देर में देखें।', browse: 'कोर्स देखें',
    newWord: 'नया शब्द', chooseKind: 'अर्थ चुनें', translateKind: 'इस वाक्य का अनुवाद करें', listenKind: 'जो सुना वह छुएँ', speakKind: 'यह वाक्य बोलें', matchKind: 'जोड़ियाँ मिलाएँ', fillKind: 'खाली जगह भरें',
    firstLesson: 'पहले पिछला पाठ पूरा करें', unit: 'यूनिट', repeat: 'दोबारा', skip: '10 आगे', speed: 'गति', sayIt: 'ज़ोर से बोलिए', listenAgain: 'फिर सुनिए', great: 'शानदार!',
    lessonComplete: 'पाठ पूरा', keepGoing: 'कल भी स्ट्रीक जारी रखें।', playing: 'चल रहा है', paused: 'रुका है', tapPlay: 'शुरू करने के लिए प्ले दबाएँ',
    hintTap: 'सिर्फ़ सुनने के लिए कैप्शन छुएँ', wordsHint: 'यहाँ वाक्य बनाएँ',
    yourTurn: 'आपकी बारी — बोलिए!', checking: 'जाँच रहे हैं…', yes: 'हाँ! 🔥', tryAgain: 'थोड़ा और — सुनिए, फिर बोलिए', youSaid: 'आपने कहा',
    didntHear: 'सुनाई नहीं दिया — फिर से बोलिए!', hearAgain: 'फिर से सुनें', stopForNow: 'अभी रुकें', tryMic: 'माइक दबाएँ और बोलिए',
    micBlocked: 'आगे बढ़ने के लिए माइक की अनुमति दें', saved: 'सेव हो गया — आप यहीं से आगे बढ़ेंगे', pausedSpeak: 'रुका है — जब बोल सकें तब लौटिए', canSpeak: 'अब बोल सकता हूँ',
  },
};
export const t = (lang, key) => (UI[lang] || UI.en)[key] ?? UI.en[key] ?? key;

// ---- data ----
const cache = new Map();
// Resolves to the JSON, or null when the file is missing / unparsable (course still being written).
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(path);
}
export const loadCourses = () => loadJSON('/lang/data/courses.json').then(x => (Array.isArray(x) ? x : []));
export const loadCourse = code => loadJSON(`/lang/data/${encodeURIComponent(code)}.json`);
export const loadAudioCourse = code => loadJSON(`/lang/audio/${encodeURIComponent(code)}.json`);
export const param = name => new URLSearchParams(location.search).get(name);
export const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// All lesson keys in a course (audio + practice) and how many are done — for progress rings.
export function courseProgress(code, course, audio) {
  const keys = [];
  for (const l of audio?.lessons || []) keys.push(`${code}/${l.id}`);
  for (const u of course?.units || []) for (const l of u.lessons || []) keys.push(`${code}/${l.id}`);
  const done = store.read().done;
  const n = keys.filter(k => done[k]).length;
  return { total: keys.length, done: n, pct: keys.length ? Math.round((n / keys.length) * 100) : 0 };
}

// ---- chrome ----
export const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4a1 1 0 0 0 1 1h3l4 4V5L8 9H5a1 1 0 0 0-1 1z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/></svg>',
  turtle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c0-4 3.5-7 8-7s8 3 8 7H4z"/><path d="M4 14h16v2H4z"/><path d="M2 13l2 1M22 13l-2 1"/><path d="M7 16v3M17 16v3"/><circle cx="12" cy="10" r="1" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2" fill="currentColor"/><rect x="16" y="14" width="5" height="7" rx="2" fill="currentColor"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M13.5 6.5l3 3"/></svg>',
};

// Top bar: [‹ back] [title] [right]. One exit only: `back` (the parent page), else the Languages list in Learn.
// Markup + back guard live in /lang/assets/topbar.js (window.bdTopbar, loaded with defer before this module);
// styles in topbar.css.
export function renderChrome({ title = '', subtitle = '', back = '', backLabel = '', backIcon = '', right = '', mount = null } = {}) {
  const here = location.pathname.replace(/index\.html$/, '');
  const parent = back && back.replace(/index\.html$/, '') !== here ? back : null;
  if (typeof window.bdTopbar === 'function') return window.bdTopbar({ back: parent, backLabel, backIcon, title: esc(title), subtitle: esc(subtitle), right, mount });
  const top = document.createElement('header');
  top.className = 'bd-top';
  const label = parent ? (/^(back|quit)\b/i.test(backLabel) || /[^\x00-\x7f]/.test(backLabel) ? backLabel : 'Back to ' + (backLabel || 'course')) : 'Back to Languages';
  top.innerHTML = `<div class="bd-top-in"><a class="bd-back press" href="${esc(parent || '/?tab=learn&hub=languages')}" aria-label="${esc(label)}">${backIcon === 'x' ? ICON.close : ICON.back}</a><div class="bd-title">${esc(title)}${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div><div class="bd-right">${right}</div></div>`;
  (mount || document.body).prepend(top);
  return top;
}

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---- voices & TTS ----
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
export const hasTTS = !!synth;
const VOICE_KEY = 'lang.voice.v1';
const PREF = ['google', 'natural', 'neural', 'enhanced', 'premium', 'siri', 'online'];
const BEST = /Google|Natural|Neural/i; // the voices that sound closest to a studio recording
let voicesReady = null;

export function voicesLoaded() {
  if (!synth) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(res => {
    const got = synth.getVoices();
    if (got.length) return res(got);
    let settled = false;
    const finish = () => { if (settled) return; settled = true; res(synth.getVoices()); };
    synth.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1200);
  });
  return voicesReady;
}

const voicePick = new Map();
export function pickVoice(lang, voices) {
  if (!lang || !voices?.length) return null;
  if (voicePick.has(lang)) return voicePick.get(lang);
  let cached = {};
  try { cached = JSON.parse(localStorage.getItem(VOICE_KEY) || '{}'); } catch { cached = {}; }
  const norm = s => String(s || '').toLowerCase().replace('_', '-');
  const L = norm(lang), base = L.split('-')[0];
  const exact = voices.filter(v => norm(v.lang) === L);
  const pool = exact.length ? exact : voices.filter(v => norm(v.lang).split('-')[0] === base);
  // A remembered pick is kept only while nothing better is installed (a Google/Natural/Neural voice for this language).
  let best = pool.find(v => v.name === cached[lang]) || null;
  if (best && !BEST.test(best.name) && pool.some(v => BEST.test(v.name))) best = null;
  if (!best && pool.length) {
    const score = v => {
      const n = v.name.toLowerCase();
      let s = BEST.test(v.name) ? 1000 : 0;
      if (norm(v.lang) === L) s += 500;
      PREF.forEach((p, i) => { if (n.includes(p)) s += 100 - i * 10; });
      if (v.default) s += 1;
      if (!v.localService) s += 5;
      return s;
    };
    best = [...pool].sort((a, b) => score(b) - score(a))[0];
    try { cached[lang] = best.name; localStorage.setItem(VOICE_KEY, JSON.stringify(cached)); } catch { /* ignore */ }
  }
  voicePick.set(lang, best);
  return best;
}

// Splits long text into utterance-sized chunks (Chrome stops speaking after ~15s otherwise).
export function chunkText(text, max = 160) {
  const parts = String(text).match(/[^.!?।。\n]+[.!?।。]*\s*|\S+\s*/g) || [String(text)];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = p; }
    else cur += p;
    while (cur.length > max) { out.push(cur.slice(0, max).trim()); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [String(text)];
}

const isChromeDesktop = /Chrome\//.test(navigator.userAgent) && !/Android|Mobile/i.test(navigator.userAgent);
let keepAlive = null;
function startKeepAlive() {
  if (!isChromeDesktop || keepAlive) return;
  keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
}
function stopKeepAlive() { clearInterval(keepAlive); keepAlive = null; }

let speakGen = 0;
export function stopSpeaking() { speakGen++; waiting(false); if (clipAudio) { try { clipAudio.pause(); } catch { /* ignore */ } clipAudio = null; } if (synth) { try { synth.cancel(); } catch { /* ignore */ } } stopKeepAlive(); }

// Speaks text in `lang`, resolving when done (or after a watchdog so the caller is never stuck).
// Options: rate (1; clips play at it too), slow (→ 0.72 for clips, 0.6 for the phone's voice), pitch, signal (AbortSignal),
// onStart (called once when the voice actually starts).
// Recorded clips (modules/learn.js records each course line once in Bro's voice and keeps it): same id on both sides.
const VOICE_KEYS = new Set(['es', 'fr', 'de', 'hi', 'en']);
let clipAudio = null;
async function clipId(voice, text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(voice + '\n' + String(text).trim()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
// v21: one Bro voice. ?v=v21 starts phones on a clean cache. A clip the server has not recorded yet is recorded when it
// is asked for; while Bro's voice is busy or loading the server answers 503 + Retry-After and the clip is asked for again
// (up to 45 s, "Bro is getting ready…" after 1.2 s), so online the phone's own voice never stands in for Bro.
// The line playing now is asked for first (p=now: the server records it ahead of lines fetched in advance); at most two
// lines are fetched ahead, and only once the current one is playing.
const CLIP_V = 'v21';
const clipUrl = (id, now) => '/api/learn/say/' + id + '.mp3?v=' + CLIP_V + (now ? '&p=now' : '');
const testOpt = k => (typeof window !== 'undefined' && window.LANG_TEST ? window.LANG_TEST[k] : undefined);
const CLIP_WAIT_MS = 45000, AHEAD_MAX = 2;
// → { url } · { why: 'missing' } (not a course line: read live) · { why: 'offline' } · { why: 'failed' }
async function fetchClip(id, { now = false, signal } = {}) {
  const scale = testOpt('retryScale') || 1, t0 = Date.now();
  for (;;) {
    if (signal?.aborted) return { why: 'aborted' };
    let r;
    try { r = await fetch(clipUrl(id, now), { signal }); }
    catch { return { why: signal?.aborted ? 'aborted' : navigator.onLine === false ? 'offline' : 'failed' }; }
    if (r.ok) { try { const b = await r.blob(); return b.size ? { url: URL.createObjectURL(b) } : { why: 'failed' }; } catch { return { why: 'failed' }; } }
    if (r.status === 404) return { why: 'missing' };
    if (r.status !== 503 && r.status !== 429) return { why: 'failed' };
    const wait = Math.min(10, Math.max(1, Number(r.headers.get('Retry-After')) || 2)) * 1000 * scale;
    if (Date.now() - t0 + wait > CLIP_WAIT_MS * scale) return { why: 'failed' };
    await sleep(wait, signal);
  }
}
const clips = new Map(); // id → { p?: Promise<result>, url?, done }
const aheadQ = []; let aheadActive = 0;
function pumpAhead() {
  while (aheadActive < AHEAD_MAX && aheadQ.length) {
    const [id, e] = aheadQ.shift(); aheadActive++;
    e.p = fetchClip(id).then(r => { e.done = true; e.url = r.url || null; if (!r.url && clips.get(id) === e) clips.delete(id); return r; })
      .finally(() => { aheadActive--; pumpAhead(); });
  }
}
function trimClips() {
  while (clips.size > 16) {
    const [k, e] = clips.entries().next().value; clips.delete(k);
    const qi = aheadQ.findIndex(x => x[1] === e); if (qi >= 0) aheadQ.splice(qi, 1);
    if (e.url) URL.revokeObjectURL(e.url); else if (e.p) e.p.then(r => r.url && URL.revokeObjectURL(r.url));
  }
}
// fetch a course line ahead of time (call it once the current line is playing)
export function prefetch(text, lang) {
  text = String(text || '').trim(); const vk = String(lang || '').slice(0, 2).toLowerCase();
  if (!text || !VOICE_KEYS.has(vk) || testOpt('noClips')) return;
  clipId(vk, text).then(id => {
    if (clips.has(id)) return;
    const e = { done: false }; clips.set(id, e); aheadQ.push([id, e]); pumpAhead(); trimClips();
  }).catch(() => {});
}
// the line to play now: a clip fetched ahead when it is there, else asked for at once (racing one still on its way)
function clipNow(id, signal) {
  const e = clips.get(id);
  if (e && e.done && e.url) return Promise.resolve({ url: e.url, kept: true });
  if (e && !e.p) { const qi = aheadQ.findIndex(x => x[0] === id); if (qi >= 0) aheadQ.splice(qi, 1); clips.delete(id); }
  const ctrl = new AbortController(); const stop = () => ctrl.abort(); signal?.addEventListener('abort', stop, { once: true });
  const mine = fetchClip(id, { now: true, signal: ctrl.signal });
  if (!(e && e.p)) return mine.finally(() => signal?.removeEventListener('abort', stop));
  return new Promise(res => {
    let left = 2, last = null;
    const take = (r, ahead) => {
      if (r && r.url) { if (ahead) ctrl.abort(); res(ahead ? { url: r.url, kept: true } : r); return; }
      last = last && last.why !== 'aborted' ? last : r; if (--left === 0) res(last || { why: 'failed' });
    };
    e.p.then(r => take(r, true), () => take(null, true));
    mine.then(r => take(r, false), () => take(null, false));
  }).finally(() => signal?.removeEventListener('abort', stop));
}
// "Bro is getting ready…": a small pill while a line waits for Bro's voice for more than 1.2 s
let waitEl = null, waitT = 0;
const READY_TXT = { en: 'Bro is getting ready…', hi: 'Bro तैयार हो रहा है…' };
function waiting(on) {
  clearTimeout(waitT);
  if (!on) { if (waitEl) waitEl.hidden = true; return; }
  waitT = setTimeout(() => {
    if (typeof document === 'undefined') return;
    if (!waitEl) {
      waitEl = document.createElement('div'); waitEl.id = 'broWait'; waitEl.setAttribute('role', 'status');
      waitEl.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);z-index:60;padding:9px 16px;border-radius:999px;background:rgba(20,20,28,.88);color:#fff;font:700 13px/1.2 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none';
      document.body.append(waitEl);
    }
    waitEl.textContent = READY_TXT[(typeof window !== 'undefined' && window.__langUi) === 'hi' ? 'hi' : 'en'];
    waitEl.hidden = false;
  }, 1200);
}
let offlineSaid = false;
function phoneVoiceNote(why) {
  if (offlineSaid) return; offlineSaid = true;
  const hi = typeof window !== 'undefined' && window.__langUi === 'hi';
  toast(why === 'offline' ? (hi ? 'ऑफ़लाइन: अभी आपके फ़ोन की आवाज़ पढ़ेगी' : "Offline: your phone's voice reads for now") : (hi ? 'Bro की आवाज़ अभी व्यस्त है: यह लाइन फ़ोन की आवाज़ में' : "Bro's voice is busy: your phone reads this line"), 3200);
}
function playUrl(url, { rate, slow, signal, onStart, revoke }) {
  return new Promise(res => {
    const a = new Audio(url); clipAudio = a;
    a.playbackRate = Math.max(0.5, Math.min(2, (slow ? 0.72 : 1) * (rate || 1))); a.preservesPitch = true;
    let started = false;
    const done = v => { signal?.removeEventListener('abort', stop); if (revoke) URL.revokeObjectURL(url); res(v); };
    const stop = () => { try { a.pause(); } catch { /* ignore */ } done(true); };
    signal?.addEventListener('abort', stop, { once: true });
    a.onplaying = () => { if (!started) { started = true; try { onStart?.(); } catch { /* ignore */ } } };
    a.onended = () => done(true);
    a.onerror = () => done(started ? true : null);
    a.play().catch(() => { if (!started) done(null); });
  });
}
// → true (played, or stopped) · { why } (no clip: 'missing' | 'offline' | 'failed')
async function playClip(text, voice, { rate, slow, signal, gen, onStart }) {
  let id = '';
  try { id = await clipId(voice, text); } catch { return { why: 'failed' }; }
  if (gen !== speakGen || signal?.aborted) return true;
  waiting(true);
  const r = await clipNow(id, signal);
  waiting(false);
  if (gen !== speakGen || signal?.aborted) { if (r.url && !r.kept) URL.revokeObjectURL(r.url); return true; }
  if (!r.url) return r;
  const ok = await playUrl(r.url, { rate, slow, signal, onStart, revoke: !r.kept });
  return ok ? true : { why: 'failed' };
}

// a line that is not a course line (no recorded clip) is read live in Bro's voice (POST /api/voice/tts, which waits its
// turn on the server; one more try after a 503)
const LIVE_KEYS = new Set(['es', 'fr', 'de', 'hi', 'en', 'it', 'pt', 'ja', 'zh']);
async function liveBro(text, vk, { rate, slow, signal, gen, onStart }) {
  let tok = ''; try { tok = localStorage.getItem('tf_token') || ''; } catch { tok = ''; }
  if (!tok) return null;
  let url = '';
  waiting(true);
  try {
    for (let i = 0; i < 2 && !url; i++) {
      const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok }, body: JSON.stringify({ text, lang: vk }), signal });
      if (r.ok) url = URL.createObjectURL(await r.blob());
      else if (r.status === 503 && i === 0) await sleep(Math.min(5, Number(r.headers.get('Retry-After')) || 2) * 1000 * (testOpt('retryScale') || 1), signal);
      else break;
    }
  } catch { url = ''; }
  waiting(false);
  if (!url) return null;
  if (gen !== speakGen || signal?.aborted) { URL.revokeObjectURL(url); return true; }
  return playUrl(url, { rate, slow, signal, onStart, revoke: true });
}

export async function speak(text, { lang = 'en-US', rate = 1, slow = false, pitch = 1, signal, onStart } = {}) {
  text = String(text || '').trim();
  if (!text) return false;
  const vk = String(lang).slice(0, 2).toLowerCase();
  let why = '';
  if (VOICE_KEYS.has(vk) && !testOpt('noClips')) {
    const gen0 = ++speakGen;
    try { synth && synth.cancel(); } catch { /* ignore */ }
    const r = await playClip(text, vk, { rate, slow, signal, gen: gen0, onStart });
    if (r === true) return gen0 === speakGen;
    if (gen0 !== speakGen) return false;
    why = r.why;
  }
  if (LIVE_KEYS.has(vk) && !testOpt('noClips') && (!why || why === 'missing')) {
    const gen1 = ++speakGen;
    const r = await liveBro(text, vk, { rate, slow, signal, gen: gen1, onStart });
    if (r) return gen1 === speakGen;
    if (gen1 !== speakGen) return false;
    why = why || 'failed';
  }
  // the phone's own voice: only when Bro's voice cannot be reached (offline, or the server failed), with a note
  if (why && why !== 'missing') phoneVoiceNote(why);
  const scale = testOpt('ttsScale') || 1;
  const r = Math.max(0.5, Math.min(2, (slow ? 0.6 : 1) * rate));
  try { onStart?.(); } catch { /* ignore */ }
  if (!synth) { await sleep(Math.min(4000, text.length * 60 / r) * scale, signal); return false; }
  const voices = await voicesLoaded();
  const voice = pickVoice(lang, voices);
  const gen = ++speakGen;
  try { synth.cancel(); } catch { /* ignore */ }
  const chunks = chunkText(text);
  startKeepAlive();
  for (const chunk of chunks) {
    if (gen !== speakGen || signal?.aborted) break;
    await new Promise(res => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = voice?.lang || lang;
      if (voice) u.voice = voice;
      u.rate = r; u.pitch = pitch;
      const est = (chunk.length * 75) / r + 600;
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(wd); res(); };
      const wd = setTimeout(finish, Math.min(20000, est * 2.2 * scale + 1500));
      u.onend = finish; u.onerror = finish;
      const onAbort = () => { try { synth.cancel(); } catch { /* ignore */ } finish(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      try { synth.speak(u); } catch { finish(); }
    });
  }
  if (gen === speakGen) stopKeepAlive();
  return gen === speakGen;
}

export function sleep(ms, signal) {
  return new Promise(res => {
    if (signal?.aborted) return res();
    const id = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); res(); }, { once: true });
  });
}

// ---- speech recognition ----
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const hasSR = !!SR;

// Listens for up to `ms`; resolves with the best transcript ('' when nothing heard / unsupported). Never rejects.
export function recognize(lang, { ms = 4000, signal, onInterim } = {}) {
  return new Promise(res => {
    if (!SR) return res('');
    let best = '', done = false, rec;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); try { rec.stop(); } catch { /* ignore */ } res(best.trim()); };
    try {
      rec = new SR();
      rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
      rec.onresult = e => {
        let txt = '';
        for (const r of e.results) txt += r[0].transcript + ' ';
        best = txt; onInterim?.(txt.trim());
      };
      rec.onerror = finish; rec.onend = finish;
      rec.start();
    } catch { return res(''); }
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

// ---- speak-back: hear what the learner said and check it (v20) ----
// hearPhrase(expect, lang, { signal, onInterim, onState }) → { heard, alts, ok, via: 'sr'|'server', error?: 'mic'|'nohear' }
// The phone's own recogniser (Chrome, Android) is used when it works: instant and free. Otherwise the mic is recorded
// (MediaRecorder, the first type the browser supports) until the learner stops talking, and Bro's hearing on the server
// (POST /api/voice/transcribe?lang=<course>&expect=<phrase>) writes it down. Never rejects.
let srBroken = false, micStream = null;
const SR_FATAL = new Set(['network', 'language-not-supported', 'service-not-allowed', 'audio-capture', 'bad-grammar']);
function srHear(lang, { signal, onInterim, ms = 8000 } = {}) {
  return new Promise(res => {
    let alts = [], done = false, rec, err = '';
    const finish = () => { if (done) return; done = true; clearTimeout(timer); try { rec.stop(); } catch { /* ignore */ } res({ alts: alts.filter(Boolean), err }); };
    try {
      rec = new SR();
      rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
      rec.onresult = e => {
        const list = [];
        for (const r of e.results) for (let i = 0; i < r.length; i++) list.push(String(r[i].transcript || '').trim());
        const best = [...e.results].map(r => r[0].transcript).join(' ').trim();
        alts = [best, ...list]; onInterim?.(best);
      };
      rec.onerror = e => { err = (e && e.error) || 'error'; finish(); };
      rec.onend = finish;
      rec.start();
    } catch { err = 'start'; return finish(); }
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
async function mic() {
  if (micStream && micStream.getAudioTracks().some(t => t.readyState === 'live')) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return micStream;
}
// the mic is kept open through a lesson (no prompt or start-up delay per try) and let go when it pauses or closes
export function releaseMic() { try { micStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ } micStream = null; }
const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
// records one utterance: waits up to waitMs for speech, then stops after quietMs of silence (or maxMs) → Blob | null
// v21 (soft voices): the recorder takes the mic through MicGain (app/micgain.js) when the page loaded it, so a soft voice is
// recorded louder. The room's noise floor is the 20th percentile of what was heard (frozen once speech starts), not the
// loudest moment of the first 300 ms (that was the learner's own voice when they answered at once). A sound counts as
// speech above max(0.0025, floor × 2); a quieter voice heard for 300 ms is sent anyway and Bro's hearing decides.
async function recordUtterance({ signal, onState, waitMs = 7000, quietMs = 900, maxMs = 9000 } = {}) {
  const raw = await mic();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC(); try { await ac.resume(); } catch { /* ignore */ }
  let mg = null; try { mg = window.MicGain ? window.MicGain.wrap(raw, { ac }) : null; } catch { mg = null; }
  const stream = mg ? mg.stream : raw;
  const type = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) ? REC_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '' : '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const parts = []; rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
  let level;
  if (mg) level = mg.level;
  else {
    const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(raw).connect(an);
    const buf = new Float32Array(an.fftSize);
    level = () => { an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; return Math.sqrt(e / buf.length); };
  }
  const scale = (window.LANG_TEST && window.LANG_TEST.vadScale) || 1;
  return new Promise(res => {
    let spoke = false, lastLoud = 0, soft = 0, lastSoft = 0, iv = 0, frozen = 0;
    const seen = [], t0 = performance.now();
    const floorNow = () => { if (frozen) return frozen; const s = seen.slice().sort((a, b) => a - b); return s.length ? Math.max(0.0004, s[Math.floor((s.length - 1) * 0.2)]) : 0.002; };
    const stop = keep => {
      clearInterval(iv); signal?.removeEventListener('abort', onAbort);
      rec.onstop = () => { try { mg?.close(); } catch { /* ignore */ } try { ac.close(); } catch { /* ignore */ } res(keep && (spoke || soft >= 300) && parts.length ? new Blob(parts, { type: rec.mimeType || type || 'audio/webm' }) : null); };
      try { rec.state !== 'inactive' ? rec.stop() : rec.onstop(); } catch { rec.onstop(); }
    };
    const onAbort = () => stop(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    rec.start(250);
    iv = setInterval(() => {
      const now = performance.now(), l = level();
      seen.push(l); if (seen.length > 160) seen.shift();
      if (now - t0 < 240) return; // the mic settles
      const floor = floorNow();
      const loud = l > Math.max(0.0025, floor * 2);
      if (loud) { if (!spoke) { onState?.('speaking'); frozen = floor; } spoke = true; lastLoud = now; }
      else if (!spoke && l > Math.max(0.0012, floor * 1.6)) { soft += 60; lastSoft = now; }
      if (spoke && now - lastLoud > quietMs * scale) return stop(true);
      if (!spoke && soft >= 300 && now - lastSoft > quietMs * scale) return stop(true); // a quiet voice: Bro's hearing decides
      if (!spoke && now - t0 > waitMs * scale) return stop(soft >= 300);
      if (now - t0 > maxMs * scale) return stop(true);
    }, 60);
  });
}
async function serverHear(blob, lang, expect, signal) {
  let tok = ''; try { tok = localStorage.getItem('tf_token') || ''; } catch { tok = ''; }
  if (!tok) return { error: 'nohear' };
  try {
    const q = `?lang=${encodeURIComponent(String(lang).slice(0, 2))}&expect=${encodeURIComponent(String(expect).slice(0, 300))}`;
    const r = await fetch('/api/voice/transcribe' + q, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', 'x-token': tok }, body: blob, signal });
    if (!r.ok) return { error: 'nohear' };
    const j = await r.json(); return { text: String(j.text || '').trim() };
  } catch { return { error: 'nohear' }; }
}
// v21: the phone's recogniser heard nothing ("no-speech": often a soft voice) → this try is recorded and Bro's hearing
// writes it down; after two such rescues the phone records from then on (localStorage lang.hear = 'rec').
const HEAR_PREF = 'lang.hear';
let srRescues = 0;
const recPreferred = () => { try { return localStorage.getItem(HEAR_PREF) === 'rec'; } catch { return false; } };
export async function hearPhrase(expect, lang, { signal, onInterim, onState } = {}) {
  const T = (typeof window !== 'undefined' && window.LANG_TEST) || {};
  let rescue = false;
  if (SR && !srBroken && !T.noSR && !recPreferred()) {
    onState?.('listening');
    const r = await srHear(lang, { signal, onInterim });
    if (signal?.aborted) return { heard: '', alts: [], ok: false, via: 'sr' };
    if (r.err === 'not-allowed') return { heard: '', alts: [], ok: false, via: 'sr', error: 'mic' };
    if (!SR_FATAL.has(r.err)) {
      const heard = r.alts[0] || '';
      if (heard || (r.err && r.err !== 'no-speech')) return { heard, alts: r.alts, ok: r.alts.some(a => matchPhrase(a, expect, lang)), via: 'sr' };
      rescue = true; // heard nothing: let the recorder and Bro's hearing try this once
    } else srBroken = true; // this phone's recogniser can't work here: record and let the server hear it, from now on
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return { heard: '', alts: [], ok: false, via: 'server', error: 'nohear' };
  let blob = null;
  onState?.('listening');
  try { blob = await recordUtterance({ signal, onState, waitMs: rescue ? 4000 : 7000 }); }
  catch (e) { return { heard: '', alts: [], ok: false, via: 'server', error: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'mic' : 'nohear' }; }
  if (signal?.aborted || !blob) return { heard: '', alts: [], ok: false, via: 'server' };
  onState?.('checking');
  const h = await serverHear(blob, lang, expect, signal);
  if (h.error) return { heard: '', alts: [], ok: false, via: 'server', error: h.error };
  onInterim?.(h.text);
  if (rescue && h.text && ++srRescues >= 2) { try { localStorage.setItem(HEAR_PREF, 'rec'); } catch { /* private mode */ } }
  return { heard: h.text, alts: [h.text], ok: matchPhrase(h.text, expect, lang), via: rescue ? 'rescue' : 'server' };
}

// Right when, accents, punctuation and number digits aside, it is close (similarity ≥ 0.6) or holds the expected phrase.
// A short fragment the course teaches piece by piece ("ñol", "jour") passes when one heard word is close to it.
const NUM = {
  en: 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
  es: 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte',
  fr: 'zero un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt',
  de: 'null eins zwei drei vier funf sechs sieben acht neun zehn elf zwolf dreizehn vierzehn funfzehn sechzehn siebzehn achtzehn neunzehn zwanzig',
  hi: 'शून्य एक दो तीन चार पांच छह सात आठ नौ दस',
};
const NUMS = Object.fromEntries(Object.entries(NUM).map(([k, v]) => [k, new Map(v.split(' ').map((w, i) => [w, String(i)]))]));
export function fold(s, lang = '') {
  let t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/़/g, '').replace(/ँ/g, 'ं') // Hindi: nukta dropped, chandrabindu = anusvara
    .replace(/[०-९]/g, d => String('०१२३४५६७८९'.indexOf(d)))
    .replace(/[¿¡?!.,;:"“”„«»‘’'()\-—–…。、！？।]/g, ' ').replace(/\s+/g, ' ').trim();
  const L = NUMS[String(lang).slice(0, 2).toLowerCase()];
  if (L) t = t.split(' ').map(w => L.get(w) || w).join(' ');
  return t;
}
// (a close sentence must also have its words: "मुझे पानी चाहिए" is not "मुझे चाय चाहिए", one slip in four words is fine)
const wordsCovered = (a, b) => { const hw = a.split(' '); const bw = b.split(' '); let n = 0; for (const w of bw) { const i = hw.findIndex(x => x === w || similarity(x, w) >= 0.6); if (i >= 0) { n++; hw.splice(i, 1); } } return n / bw.length; };
export function matchPhrase(heard, expect, lang = '') {
  const a = fold(heard, lang), b = fold(expect, lang);
  if (!a || !b) return false;
  if (a === b) return true;
  if ((' ' + a + ' ').includes(' ' + b + ' ') || (b.length >= 4 && a.includes(b))) return true;
  const nw = b.split(' ').length;
  if (similarity(a, b) >= 0.6 && wordsCovered(a, b) >= (nw >= 4 ? 0.74 : 1)) return true;
  if (b.length <= 5 && !b.includes(' ')) return a.split(' ').some(w => similarity(w, b) >= 0.5 || (w.length > b.length && w.endsWith(b)));
  return false;
}

// ---- text similarity (normalised Levenshtein) ----
export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFC')
    .replace(/[¿¡?!.,;:"“”„«»‘’'()\-—–…。、！？]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
export function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}
export const sameAnswer = (a, b) => normalize(a) === normalize(b);

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- confetti ----
export function confetti({ count = 140, duration = 2600 } = {}) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
  const colors = ['#B5402A', '#8E2F1E', '#1F1E1C', '#D9654E', '#E8DCC8', '#F3E9D8'];
  const ps = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .5, y: H * .35, vx: (Math.random() - .5) * 18 * dpr, vy: (-14 - Math.random() * 10) * dpr,
    r: (4 + Math.random() * 5) * dpr, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * Math.PI, va: (Math.random() - .5) * .3, s: Math.random() < .5,
  }));
  const t0 = performance.now();
  (function frame(now) {
    const dt = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += .45 * dpr; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - dt / duration);
      if (p.s) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.4, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (dt < duration) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

export function haptic(ms = 12) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

export function comingSoonHTML(lang = 'en', back = '/?tab=learn&hub=languages') {
  return `<div class="ui-card lc-soon"><h2>${t(lang, 'comingSoon')}</h2><p>${t(lang, 'comingSoonSub')}</p><a class="ui-btn sec sm" href="${esc(back)}">${t(lang, 'browse')}</a></div>`;
}
