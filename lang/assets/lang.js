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

// Top bar: [← Brodoit] [parent back, when `back` is set] [title] [right]. Markup + back guard live in
// /lang/assets/topbar.js (window.bdTopbar, loaded with defer before this module); styles in topbar.css.
export function renderChrome({ title = '', subtitle = '', back = '/lang/', backLabel = 'Back', backIcon = '', right = '', brand = true, mount = null } = {}) {
  const label = title ? esc(title) : brand ? 'Languages' : '';
  const here = location.pathname.replace(/index\.html$/, '');
  const parent = back && back.replace(/index\.html$/, '') !== here ? back : null;
  if (typeof window.bdTopbar === 'function') return window.bdTopbar({ back: parent, backLabel, backIcon, title: label, subtitle: esc(subtitle), right, mount });
  const top = document.createElement('header');
  top.className = 'bd-top';
  top.innerHTML = `<div class="bd-top-in"><a class="bd-home press" href="/?tab=learn" aria-label="Back to Brodoit">${ICON.back}<span>Brodoit</span></a>${parent ? `<a class="bd-back press" href="${esc(parent)}" aria-label="${esc(backLabel)}">${ICON.back}</a>` : ''}<div class="bd-title">${label}</div><div class="bd-right">${right}</div></div>`;
  document.body.prepend(top);
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
export function stopSpeaking() { speakGen++; if (clipAudio) { try { clipAudio.pause(); } catch { /* ignore */ } clipAudio = null; } if (synth) { try { synth.cancel(); } catch { /* ignore */ } } stopKeepAlive(); }

// Speaks text in `lang`, resolving when done (or after a watchdog so the caller is never stuck).
// Options: rate (1), slow (→ 0.6), pitch, signal (AbortSignal).
// Recorded studio clips (modules/learn.js renders each course line once and keeps it): same id on both sides.
const VOICE_KEYS = new Set(['es', 'fr', 'de', 'hi', 'en']);
let clipAudio = null;
async function clipId(voice, text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(voice + '\n' + String(text).trim()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
function playClip(text, voice, { slow, signal, gen }) {
  return new Promise(async res => {
    let id = '';
    try { id = await clipId(voice, text); } catch { return res(null); }
    if (gen !== speakGen || signal?.aborted) return res(true);
    const a = new Audio('/api/learn/say/' + id + '.mp3');
    clipAudio = a;
    if (slow) { a.playbackRate = 0.72; a.preservesPitch = true; }
    let started = false;
    const done = v => { signal?.removeEventListener('abort', stop); res(v); };
    const stop = () => { try { a.pause(); } catch { /* ignore */ } done(true); };
    signal?.addEventListener('abort', stop, { once: true });
    a.onplaying = () => { started = true; };
    a.onended = () => done(true);
    a.onerror = () => done(started ? true : null);
    a.play().catch(() => { if (!started) done(null); });
  });
}

export async function speak(text, { lang = 'en-US', rate = 1, slow = false, pitch = 1, signal } = {}) {
  text = String(text || '').trim();
  if (!text) return false;
  const vk = String(lang).slice(0, 2).toLowerCase();
  if (VOICE_KEYS.has(vk) && !(typeof window !== 'undefined' && window.LANG_TEST?.noClips)) {
    const gen0 = ++speakGen;
    try { synth && synth.cancel(); } catch { /* ignore */ }
    const r = await playClip(text, vk, { slow, signal, gen: gen0 });
    if (r) return gen0 === speakGen;
    if (gen0 !== speakGen) return false;
  }
  const scale = (typeof window !== 'undefined' && window.LANG_TEST?.ttsScale) || 1;
  const r = Math.max(0.5, Math.min(2, (slow ? 0.6 : 1) * rate));
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

export function comingSoonHTML(lang = 'en', back = '/lang/') {
  return `<div class="b-card empty rise"><div class="e">🎙️</div><div class="t">${t(lang, 'comingSoon')}</div><div class="s">${t(lang, 'comingSoonSub')}</div><a class="b-btn violet" href="${esc(back)}">${t(lang, 'browse')}</a></div>`;
}
