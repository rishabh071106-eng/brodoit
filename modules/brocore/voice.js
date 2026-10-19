// Bro Core voice: Bro's own deep voice, self-hosted on our CPU.
//   Kokoro-82M (fp32 ONNX, Apache-2.0) through onnxruntime-node, with phonemes from espeak-ng (WASM build, GPL-3).
//   - init({getSetting, setSetting, mediaDir}) fetches the model in the background on first boot (npm registry tarballs,
//     sha256-checked) into MEDIA_DIR/brocore/kokoro/ (BROCORE_MODEL_DIR overrides), then loads it.
//   - Phonemes and inference run in a child "engine" process (this file with --brocore-voice-engine), so the app's event
//     loop never blocks. One chunk is synthesised at a time (BROCORE_THREADS threads from settings or env, default
//     min(4, cpus - 1) so a core stays free for the app) so live calls never fight each other for the CPU.
//   - Two priorities: 'live' (speakStream's default) always goes first; 'low' (speak()'s default: /api/voice/tts, studio)
//     is cut into short chunks (~4 s of speech) so a live sentence never waits long behind one, and at most 3 low
//     requests are admitted at once: the next gets VOICE_BUSY (the caller answers 503 and the phone's own voice speaks).
//     A queued job whose signal aborts is dropped at once.
//   - Watchdog: each job must come back within max(8 s, 4 x its audio length) or the engine is killed, every job in it
//     fails with VOICE_STALLED and the voice reads not ready until the engine is back. Restarts back off 2 s, 4 s, 8 s …
//     5 min (reset after 10 healthy minutes); health() reports restarts and lastCrash.
//   - The model download first checks the disk (1 GB free needed), and the mp3 cache never eats the last 1 GB either.
//   - speakStream() splits a reply into sentences (first one kept short) and yields 24 kHz PCM sentence by sentence.
// Kokoro's context is 510 tokens; we keep each inference under 400 phoneme tokens.
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream').promises;
const { spawn } = require('child_process');
const VOCAB = require('./vocab.json');

const SAMPLE_RATE = 24000;
const MODEL_NAME = 'kokoro-82m-fp32';
const MODEL_SHA256 = '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb';
const MODEL_BYTES = 325532232;
const SHARD_PKGS = ['kokoro-fp32a-shards', 'kokoro-fp32b-shards', 'kokoro-fp32c-shards']; // parts 0-6, 7-13, 14-18
const SHARD_VERSION = '1.0.0';
const SHARD_COUNT = 19;
const VOICES_PKG = 'kokoro-js';
const VOICES_VERSION = '1.2.1';
const VOICES_INTEGRITY = 'sha512-oq0HZJWis3t8lERkMJh84WLU86dpYD0EuBPtqYnLlQzyFP1OkyBRDcweAqCfhNOpltyN9j/azp1H6uuC47gShw==';
const VOICE_NAMES = ['am_onyx', 'hm_omega', 'hm_psi', 'em_alex', 'im_nicola', 'pm_alex', 'jm_kumo', 'zm_yunjian', 'bm_lewis', 'am_echo'];
const VOICE_BYTES = 510 * 256 * 4; // Float32Array [510 x 256]
const MAX_TOKENS = 400;
const SPEC_KEY = 'BRO_VOICE_SPECS';
const LRU_MAX = 200;
const LRU_MAX_BYTES = 64 * 1024 * 1024;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const GB = 1024 * 1024 * 1024, MB = 1024 * 1024;
const LOW_MAX = 3;              // low-priority requests admitted at once (one synthesising, the rest waiting)
const LOW_CHUNK_SEC = 4;        // a low-priority chunk is at most ~4 s of speech (~1.5-2 s of CPU) …
const LOW_CHUNK_CHARS = 90;     // … and at most 90 characters
const MIN_FREE_MODEL = GB;      // free disk needed before fetching the 325 MB model (tarballs + parts + joined file)
const MIN_FREE_VOICES = 200 * MB;
const RESTART_BASE_MS = 2000, RESTART_MAX_MS = 5 * 60e3, HEALTHY_RESET_MS = 10 * 60e3;

// Bro's voice per language (deep male timbre; blends are weighted sums of the voice style tables)
const LANGS = {
  en: { espeak: 'en-us', voice: 'am_onyx' },
  hi: { espeak: 'hi', voice: 'hm_omega:0.5+am_onyx:0.5' },
  es: { espeak: 'es', voice: 'em_alex:0.5+am_onyx:0.5' },
  fr: { espeak: 'fr', voice: 'am_onyx' },
  de: { espeak: 'de', voice: 'am_onyx' },
  it: { espeak: 'it', voice: 'im_nicola' },
  pt: { espeak: 'pt-br', voice: 'pm_alex:0.5+am_onyx:0.5' },
  ja: { espeak: 'ja', voice: 'jm_kumo' },
  zh: { espeak: 'cmn', voice: 'zm_yunjian' },
};
const LANG_ALIASES = { hinglish: 'hi', cmn: 'zh', jp: 'ja', 'pt-br': 'pt', 'pt-pt': 'pt' };

const log = (...a) => console.log('[brocore/voice]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function abortError() { const e = new Error('aborted'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; return e; }
function notReady(msg) { const e = new Error(msg); e.code = 'VOICE_NOT_READY'; return e; }
function busyError() { return Object.assign(new Error('voice busy'), { code: 'VOICE_BUSY' }); }
const fmtBytes = n => n >= GB ? +(n / GB).toFixed(1) + ' GB' : Math.round(n / MB) + ' MB';
// Free bytes on the volume holding `dir` (Infinity when the check is unavailable: Node < 18.15 has no fs.statfs).
async function freeBytes(dir, statfs) {
  const fn = statfs || fsp.statfs;
  if (typeof fn !== 'function') return Infinity;
  try { const s = await fn(dir); const n = Number(s.bavail) * Number(s.bsize); return Number.isFinite(n) ? n : Infinity; } catch (e) { return Infinity; }
}

const S = {
  phase: 'idle', // idle | loading | fetching | ready | error
  error: '', initPromise: null, retryDelay: 60e3, retryTimer: null,
  dir: '', mediaDir: '', getSetting: null, setSetting: null, download: {},
  ort: null, session: null, threads: 0,
  esp: null, espVoice: '',
  voices: new Map(), blends: new Map(), specs: {},
  rtfAvg: 0, lastMs: 0, runs: 0, hits: 0, misses: 0, diskHits: 0,
  missing: new Set(), mp3Off: false, cacheSkips: 0,
  engine: null, pending: new Map(), seq: 0, call: (op, args) => engineCall(op, args),
  // watchdog and restarts (the *Ms knobs are here so tests can shorten them)
  watchdogMinMs: 8000, startTimeoutMs: 180e3, upAt: 0, crashDelay: 0, restarts: 0, lastCrash: null,
};

// ---------- languages and voice specs ----------
function normLang(lang) {
  const l = String(lang || '').trim().toLowerCase().replace(/_/g, '-');
  if (!l) return '';
  if (LANG_ALIASES[l]) return LANG_ALIASES[l];
  const base = l.split('-')[0];
  return LANGS[base] ? base : (LANG_ALIASES[base] || '');
}
const RE_DEVA = /[\u0900-\u097f]/;
const RE_KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;
const RE_HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
function detectLang(text) {
  const t = String(text || '');
  if (RE_DEVA.test(t)) return 'hi';
  if (RE_KANA.test(t)) return 'ja';
  if (RE_HAN.test(t)) return 'zh';
  return 'en';
}
// The language we speak a text in: a known code wins; a missing or unknown one is detected from the script
// (Latin text in an unknown language gets English phonemes and am_onyx).
function resolveLang(lang, text) { return normLang(lang) || detectLang(text); }

function parseSpec(spec) {
  const parts = String(spec || '').split('+').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) throw new Error('bad voice spec: ' + spec);
  return parts.map(p => {
    const m = /^([a-z]{2}_[a-z]+)(?::(\d*\.?\d+))?$/.exec(p);
    if (!m) throw new Error('bad voice spec part: ' + p);
    const w = m[2] == null ? 1 : Number(m[2]);
    if (!(w > 0 && w <= 10)) throw new Error('bad voice weight: ' + p);
    return { name: m[1], w };
  });
}
function knownVoice(name) {
  if (VOICE_NAMES.includes(name)) return true;
  return !!S.dir && fs.existsSync(path.join(S.dir, 'voices', name + '.bin'));
}
function voiceFor(lang) {
  const L = normLang(lang) || 'en';
  return S.specs[L] || LANGS[L].voice;
}
function specFile() { return S.mediaDir ? path.join(S.mediaDir, 'brocore', 'voice-specs.json') : ''; }
function loadSpecs() {
  let raw = '';
  try { raw = S.getSetting ? String(S.getSetting(SPEC_KEY) || '') : ''; } catch (e) { raw = ''; }
  if (!raw && specFile()) { try { raw = fs.readFileSync(specFile(), 'utf8'); } catch (e) { raw = ''; } }
  const out = {};
  try {
    const o = JSON.parse(raw || '{}');
    for (const [k, v] of Object.entries(o || {})) {
      const L = normLang(k);
      try { if (L && parseSpec(v).every(p => knownVoice(p.name))) out[L] = String(v); } catch (e) { /* skip bad entry */ }
    }
  } catch (e) { log('ignoring unreadable', SPEC_KEY); }
  S.specs = out;
}
function persistSpecs() {
  const json = Object.keys(S.specs).length ? JSON.stringify(S.specs) : '';
  if (S.setSetting) {
    try { S.setSetting(SPEC_KEY, json); } catch (e) { log('settings refused', SPEC_KEY + ':', e.message, '(kept in voice-specs.json)'); }
  }
  // mirror on the media volume, so a tuned voice survives even when the settings store does not take the key
  const f = specFile();
  if (f) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, json || '{}'); } catch (e) { /* best effort */ } }
}
// The nightly tuner sets a language's voice. Empty/null/'default' resets it. Returns the spec now in use.
function setVoiceSpec(lang, spec) {
  const L = normLang(lang);
  if (!L) throw new Error('unknown language: ' + lang);
  if (spec == null || spec === '' || spec === 'default') delete S.specs[L];
  else {
    const parts = parseSpec(spec);
    const unknown = parts.filter(p => !knownVoice(p.name)).map(p => p.name);
    if (unknown.length) throw new Error('unknown voice: ' + unknown.join(', '));
    S.specs[L] = String(spec).replace(/\s+/g, ''); // kept verbatim: callers compare spec strings (nightly A/B)
  }
  persistSpecs();
  return voiceFor(L);
}

function voiceTable(name) {
  let v = S.voices.get(name);
  if (v) return v;
  const buf = fs.readFileSync(path.join(S.dir, 'voices', name + '.bin'));
  if (buf.length !== VOICE_BYTES) throw new Error('voice file has wrong size: ' + name);
  v = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  S.voices.set(name, v);
  return v;
}
// Weighted blend of the voices' style tables (weights normalised to sum to 1), cached per spec.
function blendFor(spec) {
  let b = S.blends.get(spec);
  if (b) return b;
  const parts = parseSpec(spec);
  const total = parts.reduce((a, p) => a + p.w, 0);
  if (parts.length === 1) b = voiceTable(parts[0].name);
  else {
    b = new Float32Array(VOICE_BYTES / 4);
    for (const p of parts) { const t = voiceTable(p.name), w = p.w / total; for (let i = 0; i < b.length; i++) b[i] += t[i] * w; }
  }
  S.blends.set(spec, b);
  return b;
}
function styleFor(spec, paddedLen) {
  const b = blendFor(spec);
  const off = 256 * Math.min(Math.max(paddedLen - 2, 0), 509);
  return b.slice(off, off + 256);
}

// ---------- text: cleaning, English normalisation (as kokoro-js does), sentence splitting ----------
function cleanText(t) {
  return String(t == null ? '' : t)
    .replace(/\[([^\]]*)\]\((?:https?:)?[^)]*\)/g, '$1') // markdown links -> their text
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[*#`~^|<>]+/g, ' ')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
    .replace(/^\s*[-•·]\s+/gm, '')
    .replace(/\.{3,}/g, '…')
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ');
}

function splitNum(m) {
  if (m.includes('.')) return m;
  if (m.includes(':')) {
    const [h, mm] = m.split(':').map(Number);
    return mm === 0 ? `${h} o'clock` : mm < 10 ? `${h} oh ${mm}` : `${h} ${mm}`;
  }
  const year = parseInt(m.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return m;
  const left = m.slice(0, 2), right = parseInt(m.slice(2, 4), 10), s = m.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`;
    if (right < 10) return `${left} oh ${right}${s}`;
  }
  return `${left} ${right}${s}`;
}
const CURRENCY = { '$': ['dollar', 'cent', 'cents'], '£': ['pound', 'penny', 'pence'], '€': ['euro', 'cent', 'cents'], '₹': ['rupee', 'paisa', 'paise'] };
function flipMoney(m) {
  const [unit, coin, coins] = CURRENCY[m[0]];
  const amt = m.slice(1);
  if (isNaN(Number(amt))) return `${amt} ${unit}s`;
  if (!amt.includes('.')) return `${amt} ${unit}${amt === '1' ? '' : 's'}`;
  const [b, c] = amt.split('.');
  const d = parseInt(c.padEnd(2, '0'), 10);
  return `${b} ${unit}${b === '1' ? '' : 's'} and ${d} ${d === 1 ? coin : coins}`;
}
function pointNum(m) { const [a, b] = m.split('.'); return `${a} point ${b.split('').join(' ')}`; }
// Port of kokoro-js normalize_text (numbers, years, times, money, abbreviations), plus rupees and euros.
function normEnglish(t) {
  return t
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\bRs\.?\s?(?=\d)/g, '₹')
    .replace(/\d*\.\d+|(?<![$£€₹])\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£€₹] ?\d+(?:\.\d+)?(?: hundred| thousand| lakh| crore| (?:[bm]|tr)illion)*\b|[$£€₹]\d+\.\d\d?\b/gi, m => flipMoney(m.replace(/^(.) /, '$1')))
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)[-–](?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, m => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-');
}
// For every language: typographic quotes, CJK and Devanagari punctuation to what the vocab knows.
function normCommon(t, L) {
  t = t.replace(/[‘’ʼ]/g, "'").replace(/[“”«»„「」『』]/g, '"')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ')
    .replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[।॥]+/g, '. ')
    .replace(/\s[-–]\s/g, ' — ');
  if (L === 'hi') t = t.replace(/(?:₹|\bRs\.?)\s?([\d०-९][\d०-९,]*)/g, '$1 रुपये');
  if (L === 'hi' || L === 'en' || L === 'ja' || L === 'zh') t = t.replace(/(?<=[\d०-९]),(?=[\d०-९])/g, '');
  return t.replace(/ {2,}/g, ' ').trim();
}

const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'sgt', 'col', 'gen', 'rep', 'sen', 'gov', 'lt', 'maj', 'capt', 'st', 'mt', 'etc', 'co', 'inc', 'ltd', 'dept', 'vs', 'p', 'pg', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'no', 'approx', 'e.g', 'i.e', 'rs', 'smt', 'shri']);
const CONJ = new Set(['and', 'but', 'so', 'because', 'or', 'then', 'which', 'when', 'if', 'while', 'although', 'और', 'लेकिन', 'तो', 'क्योंकि', 'कि', 'फिर', 'मगर', 'y', 'pero', 'porque', 'que', 'et', 'mais', 'parce', 'und', 'aber', 'weil', 'dass', 'e', 'ma', 'perché', 'che', 'mas', 'então']);
const isCJK = L => L === 'ja' || L === 'zh';
const hasWords = s => /[\p{L}\p{N}]/u.test(s);

// Sentences of one line, splitting after . ! ? … । ॥ 。 ！ ？ (not after abbreviations, initials or inside numbers).
function sentencesOf(line) {
  const out = [];
  let start = 0;
  const re = /[.!?…]+["'”’)\]」』]*(?=\s|$)|[।॥。！？]+["'”’)\]」』]*/g;
  for (const m of line.matchAll(re)) {
    const end = m.index + m[0].length;
    if (m[0] === '.') {
      const word = line.slice(start, m.index).split(/\s+/).pop() || '';
      const w = word.toLowerCase().replace(/['’]s$/, '');
      if (ABBR.has(w) || /^[A-Z]$/.test(word)) continue;
    }
    out.push(line.slice(start, end).trim());
    start = end;
  }
  if (start < line.length) out.push(line.slice(start).trim());
  // fold pieces without letters or digits ("…", "!!") into the previous sentence
  const merged = [];
  for (const s of out) {
    if (!s) continue;
    if (!hasWords(s) && merged.length) merged[merged.length - 1] += s;
    else merged.push(s);
  }
  return merged.filter(hasWords);
}
// Cut a long sentence near maxChars, preferring clause punctuation, then a space.
function splitLong(s, maxChars, L) {
  const out = [];
  while (s.length > maxChars) {
    const head = s.slice(0, maxChars);
    let cut = -1;
    const clause = /[,;:—]\s?|[、，；：]/g;
    for (const m of head.matchAll(clause)) if (m.index >= maxChars * 0.4) cut = m.index + m[0].length;
    if (cut < 0 && !isCJK(L)) cut = head.lastIndexOf(' ');
    if (cut <= 0) cut = maxChars;
    out.push(s.slice(0, cut).trim());
    s = s.slice(cut).trim();
  }
  if (s) out.push(s);
  return out;
}
// ---- streaming plan: a short first chunk, then chunks that grow only as fast as synthesis can stay ahead ----
// Spoken seconds per character (measured with Bro's voices at speed 1, edges trimmed).
const SEC_PER_CHAR = { en: 0.066, hi: 0.09, es: 0.082, fr: 0.07, de: 0.078, it: 0.08, pt: 0.076, ja: 0.13, zh: 0.2 };
function estSec(t, L, speed = 1) { return [...t].length * (SEC_PER_CHAR[L] || 0.075) / speed; }
function firstSec() { return Math.max(0.6, Number(process.env.BROCORE_FIRST_SEC) || 1.3); }
// Words a chunk should not end on (articles, prepositions, pronoun subjects…) or, for Hindi, start with (postpositions,
// auxiliaries), so a cut never splits "the | plan" or "कर रहे | हैं".
const NO_END = new Set('a an the to of in on at for with and but or so my your our their his her its is are was were be been i you we they he she it this that these those very really just not no if as from by about into than then el la los las un una unos de del y o en con por para mi tu su le les des du et ou à au aux ce cette mon ton son der die das den dem ein eine einen und oder zu mit von im am il lo gli di e da del della um uma do dos das os as em com meu seu'.split(' '));
const NO_START = new Set('का की के को में से पर ने तक है हैं था थी थे हूँ हो रहा रही रहे गया गई गए सकता सकती सकते चाहिए वाला वाली वाले ही भी'.split(' '));
const bare = w => (w || '').toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
// Places a sentence can be cut: after clause punctuation, before a conjunction, or at a natural word gap (CJK: punctuation only).
function cutPoints(s, L) {
  const out = [];
  if (isCJK(L)) { for (const m of s.matchAll(/[,、，;；:：]\s?/g)) out.push({ a: m.index + m[0].length, b: m.index + m[0].length, kind: 'comma' }); return out; }
  for (const m of s.matchAll(/\s+/g)) {
    const before = s.slice(0, m.index);
    const prev = bare((before.match(/\S+$/) || [''])[0]);
    const next = bare((s.slice(m.index + m[0].length).match(/^\S+/) || [''])[0]);
    const kind = /[,;:—]$/.test(before) ? 'comma' : CONJ.has(next) ? 'conj' : (NO_END.has(prev) || NO_START.has(next)) ? '' : 'word';
    if (kind) out.push({ a: m.index, b: m.index + m[0].length, kind });
  }
  return out;
}
// Cut s into [first, rest] with the rest >= 0.4 s: for each group [kinds, minSec, maxSec] in order, the longest first
// part ending at one of those kinds of cut and lasting minSec..maxSec. Returns [first, rest, kind] or null.
function cutSentence(s, L, speed, groups) {
  const pts = cutPoints(s, L).map(p => Object.assign(p, { sec: estSec(s.slice(0, p.a), L, speed) }))
    .filter(p => estSec(s.slice(p.b), L, speed) >= 0.4);
  for (const [kinds, minSec, maxSec] of groups) {
    const c = pts.filter(p => kinds.includes(p.kind) && p.sec >= minSec && p.sec <= maxSec);
    if (c.length) { const p = c[c.length - 1]; return [s.slice(0, p.a).trim(), s.slice(p.b).trim(), p.kind]; }
  }
  return null;
}
// Model of the stream: inference takes about A + r * (audio seconds), one chunk after another; playback starts with the
// first chunk. The first chunk is cut to ~BROCORE_FIRST_SEC (1.3 s) of speech so it is ready in under a second. Later
// chunks are cut at a comma or conjunction when they would not be ready before the audio ahead runs out (a pause there
// sounds natural); a phrase that was already cut mid-way may also be cut at a word gap, so it never stalls mid-phrase.
function rampPlan(chunks, L, speed) {
  const F = firstSec();
  const d0 = estSec(chunks[0].text, L, speed);
  if (d0 > F * 1.25) {
    // a clause boundary when there is one; a bare word gap only for a long sentence (a short one is kept whole)
    const groups = [[['comma', 'conj'], 0.3, F * 1.3]];
    if (d0 > F * 2) groups.push([['word'], 0.6, F]);
    const c = cutSentence(chunks[0].text, L, speed, groups);
    if (c) chunks.splice(0, 1, { text: c[0], end: false, cut: c[2] }, { text: c[1], end: chunks[0].end });
  }
  const r = Math.min(1.5, Math.max(0.35, S.rtfAvg || 0.5));
  const A = 0.12 + r * 0.35; // fixed cost per inference + the edge silence Kokoro renders (trimmed afterwards)
  let d = estSec(chunks[0].text, L, speed);
  let ready = A + r * d, playEnd = ready + d;
  for (let i = 1; i < chunks.length; i++) {
    const slack = playEnd - ready;
    if (slack > 6) break;
    const maxD = (slack - A + 0.15) / r; // tolerate a 150 ms stall
    d = estSec(chunks[i].text, L, speed);
    if (d > maxD && maxD >= 0.4) {
      const groups = chunks[i - 1].cut === 'word' ? [[['comma', 'conj', 'word'], 0.5, maxD]] : [[['comma', 'conj'], 0.4, maxD]];
      const c = cutSentence(chunks[i].text, L, speed, groups);
      if (c) { chunks.splice(i, 1, { text: c[0], end: false, cut: c[2] }, { text: c[1], end: chunks[i].end }); d = estSec(c[0], L, speed); }
    }
    ready += A + r * d;
    playEnd = Math.max(playEnd, ready) + d;
  }
  return chunks;
}
// Low-priority chunks: at most ~LOW_CHUNK_SEC of speech and LOW_CHUNK_CHARS characters (en 60, hi 44, ja 30, zh 20).
function lowChunkChars(L) { return Math.max(12, Math.min(LOW_CHUNK_CHARS, Math.floor(LOW_CHUNK_SEC / (SEC_PER_CHAR[L] || 0.075)))); }
// Cut a sentence into pieces of at most maxChars, as even as possible, preferring a comma, then a conjunction, then a
// natural word gap (never "the | plan" or "कर रहे | हैं"); splitLong's cut when there is no such place.
// Digits are read out as words ("12,345" → "twelve thousand three hundred…"), so each counts as ~4 characters of speech.
const spokenLen = s => s.length + 3 * (s.match(/[0-9०-९]/g) || []).length;
function splitSmall(s, maxChars, L) {
  const out = [];
  while (spokenLen(s) > maxChars) {
    const cap = Math.max(12, Math.min(maxChars, Math.floor(maxChars * s.length / spokenLen(s)))); // in plain characters
    const target = s.length / Math.ceil(spokenLen(s) / maxChars);
    const score = p => Math.abs(p.a - target) / cap + (p.kind === 'comma' ? 0 : p.kind === 'conj' ? 0.1 : 0.3);
    let best = null;
    for (const p of cutPoints(s, L)) if (p.a >= target * 0.5 && p.a <= cap && p.b < s.length && (!best || score(p) < score(best))) best = p;
    if (best) { out.push(s.slice(0, best.a).trim()); s = s.slice(best.b).trim(); continue; }
    const head = splitLong(s, cap, L)[0];
    if (!head || head.length >= s.length) break; // nowhere left to cut
    out.push(head); s = s.slice(head.length).trim();
  }
  if (s) out.push(s);
  return out.filter(Boolean);
}
// Text -> chunks [{text, end}]; `end` marks chunks that close a sentence or line. `small` (low-priority work) keeps each
// chunk short, so a live sentence queued behind it waits at most ~1-2 s.
function chunkText(text, L, { quickStart = false, speed = 1, small = false } = {}) {
  const maxChars = small ? lowChunkChars(L) : isCJK(L) ? 110 : 240;
  const chunks = [];
  for (const line of cleanText(text).split(/\n+/)) {
    for (const s of sentencesOf(line.trim())) {
      const parts = small ? splitSmall(s, maxChars, L) : splitLong(s, maxChars, L);
      parts.forEach((p, i) => chunks.push({ text: p, end: i === parts.length - 1 }));
    }
  }
  // fold a tiny sentence ("Okay.", "हाँ।") into its neighbour, except at the very start where short is what we want
  // (small chunks: only when the two still fit, so the cap holds)
  const tiny = c => c.text.replace(/[^\p{L}\p{N}]/gu, '').length < 6;
  for (let i = 1; i < chunks.length; i++) {
    if (!tiny(chunks[i])) continue;
    const fits = j => !small || chunks[j].text.length + chunks[i].text.length < maxChars;
    if (i < chunks.length - 1 && fits(i + 1)) { chunks[i + 1].text = chunks[i].text + ' ' + chunks[i + 1].text; chunks.splice(i, 1); i--; }
    else if (fits(i - 1)) { chunks[i - 1].text += ' ' + chunks[i].text; chunks[i - 1].end = chunks[i].end; chunks.splice(i, 1); i--; }
  }
  return quickStart && chunks.length ? rampPlan(chunks, L, speed) : chunks;
}

// ---------- phonemes (espeak-ng) ----------
let espPromise = null;
function loadEspeak() {
  if (!espPromise) {
    espPromise = (async () => {
      const mod = await import('@echogarden/espeak-ng-emscripten'); // ESM package; dynamic import works from CommonJS on Node 18
      const m = await mod.default();
      S.esp = new m.eSpeakNGWorker();
      S.espVoice = '';
      return S.esp;
    })().catch(e => { espPromise = null; throw e; });
  }
  return espPromise;
}
// espeak keeps the current voice as global state. This function is synchronous (set_voice + synthesize_ipa run back to
// back on the single JS thread), so calls from concurrent requests can never interleave.
function espeakIPA(text, voice) {
  if (S.espVoice !== voice) { S.esp.set_voice(voice); S.espVoice = voice; }
  const r = S.esp.synthesize_ipa(text);
  return r && r.code === 0 ? String(r.ipa || '') : '';
}
// espeak marks each phoneme with '_'; multi-letter phonemes stay together. Kokoro's vocab has single symbols for the
// tied affricates and diphthongs (misaki's espeak mapping), so we merge those within one phoneme.
const TIES = [['tʃ', 'ʧ'], ['dʒ', 'ʤ'], ['ts', 'ʦ'], ['dz', 'ʣ'], ['tɕ', 'ʨ'], ['dʑ', 'ʥ'], ['eɪ', 'A'], ['aɪ', 'I'], ['aʊ', 'W'], ['oʊ', 'O'], ['əʊ', 'Q'], ['ɔɪ', 'Y']];
const useTies = () => process.env.BROCORE_TIES !== '0';
const FALLBACK = { 'ʏ': 'y', 'ɫ': 'l', 'ɵ': 'o', 'ʉ': 'u', 'ɭ': 'l', 'ʑ': 'ʒ', 'ʐ': 'ʒ', 'ɱ': 'm', 'ɘ': 'ə', 'ʀ': 'ʁ', 'ɧ': 'ʃ', 'ɞ': 'ɜ', 'ɶ': 'œ', 'ʍ': 'w', 'ɦ': 'h', 'g': 'ɡ', 'ɝ': 'ɜ', 'ɺ': 'ɾ', 'ʙ': 'b', 'ɓ': 'b', 'ɗ': 'd', 'ɠ': 'ɡ', 'ʄ': 'ɟ' };
const ZH_TONES = { 1: '→', 2: '↗', 3: '↓', 4: '↘', 5: '' };
function cleanIPA(raw, L) {
  let s = raw.replace(/\((?:[a-z]{2,3}(?:-[a-z]+)?)\)/g, '').replace(/\n/g, ' ');
  if (useTies()) {
    s = s.split(' ').map(w => w.split('_').map(u => { for (const [a, b] of TIES) if (u.includes(a)) u = u.split(a).join(b); return u; }).join('')).join(' ');
  } else s = s.replace(/_/g, '');
  s = s.replace(/[¿¡]/g, '').replace(/-/g, '').replace(/\u031e/g, '').replace(/ä/g, 'a').replace(/ʲ/g, 'j').replace(/ɬ/g, 'l');
  // x→k and r→ɹ are English-only (as in kokoro-js); es/pt/hi keep x, which is in the vocab ("mejor", "ख़ुशी")
  if (L === 'en') s = s.replace(/x/g, 'k').replace(/r/g, 'ɹ').replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di').replace(/(?<=nˈIn)ti(?!ː)/g, 'di');
  if (L === 'zh') s = s.replace(/[1-5]/g, d => ZH_TONES[d]).replace(/\./g, '');
  s = s.replace(/\./g, '');
  let out = '';
  for (const ch of s) {
    if (VOCAB[ch] != null) { out += ch; continue; }
    if (FALLBACK[ch]) { out += FALLBACK[ch]; continue; }
    // combining marks other than the nasal tilde (which is in the vocab) and the half-length mark are dropped quietly
    if (/[\u0300-\u036f\u02d1]/.test(ch)) continue;
    let kept = '';
    for (const c of ch.normalize('NFD')) if (VOCAB[c] != null) kept += c; // e.g. a precomposed nasal vowel
    out += kept;
    if (!kept && !S.missing.has(ch)) { S.missing.add(ch); log('no vocab symbol for', JSON.stringify(ch), 'U+' + ch.codePointAt(0).toString(16), '(' + L + ')'); }
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
const PUNCT_RE = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;
const PROTECT = { '.': '\ue000', ',': '\ue001', ':': '\ue002' };
const UNPROTECT = { '\ue000': '.', '\ue001': ',', '\ue002': ':' };
// text (one chunk) -> phoneme string. espeak drops punctuation, so we phonemize between punctuation and put it back.
function phonemize(text, L, end) {
  let t = L === 'en' ? normEnglish(text) : text;
  t = normCommon(t, L).replace(/(?<=\d)[.,:](?=\d)/g, c => PROTECT[c]); // keep 3.5 / 10:30 / 1.000 inside the number
  const voice = LANGS[L].espeak;
  let out = '', last = 0;
  const say = seg => { const x = seg.replace(/[\ue000-\ue002]/g, c => UNPROTECT[c]).trim(); return x ? cleanIPA(espeakIPA(x, voice), L) : ''; };
  for (const m of t.matchAll(PUNCT_RE)) {
    if (m.index > last) out += say(t.slice(last, m.index));
    out += m[0].replace(/[«»]/g, '"').replace(/[¿¡]/g, '').replace(/\s+/g, ' ');
    last = m.index + m[0].length;
  }
  if (last < t.length) out += say(t.slice(last));
  out = out.replace(/ {2,}/g, ' ').trim();
  if (end && out && !/[.!?…]$/.test(out)) out += '.';
  return out;
}
function tokenize(ph) {
  const ids = [];
  for (const ch of ph) { const v = VOCAB[ch]; if (v != null) ids.push(v); }
  return ids;
}
// Split a phoneme string so each piece is at most MAX_TOKENS tokens, at punctuation or a space.
function splitPhonemes(ph) {
  const out = [];
  let s = ph;
  while ([...s].length > MAX_TOKENS) {
    const chars = [...s];
    const head = chars.slice(0, MAX_TOKENS).join('');
    let cut = -1;
    for (const m of head.matchAll(/[,;:.!?—…] /g)) if (m.index > head.length * 0.3) cut = m.index + 1;
    if (cut < 0) cut = head.lastIndexOf(' ');
    if (cut <= 0) cut = head.length;
    out.push(s.slice(0, cut).trim());
    s = s.slice(cut).trim();
  }
  if (s) out.push(s);
  return out;
}

// ---------- synthesis queue (one sentence at a time, in the voice engine process) ----------
// onnxruntime-node runs inference on the calling JS thread, and espeak can take 10-150 ms on new words, so both run in a
// separate engine process: the app's HTTP and WebSocket handling never freezes while Bro speaks.
// Q.hi: live jobs (always first). Q.lo: low-priority jobs, small chunks, from at most LOW_MAX admitted requests.
const Q = { hi: [], lo: [], running: false, current: 0, lowActive: 0 };
function queueLength() { return Q.hi.length + Q.lo.length + Q.current; }
function enqueue(job, prio) {
  return new Promise((resolve, reject) => {
    if (job.signal && job.signal.aborted) { reject(abortError()); return; }
    // a queued job whose signal aborts leaves the queue at once (a running one finishes; its sentence is cached)
    const onAbort = () => { for (const l of [Q.hi, Q.lo]) { const i = l.indexOf(job); if (i >= 0) { l.splice(i, 1); job.reject(abortError()); return; } } };
    const off = () => { if (job.signal) job.signal.removeEventListener('abort', onAbort); };
    Object.assign(job, { prio, resolve: v => { off(); resolve(v); }, reject: e => { off(); reject(e); } });
    if (job.signal) job.signal.addEventListener('abort', onAbort, { once: true });
    (prio === 'hi' ? Q.hi : Q.lo).push(job);
    pump();
  });
}
// A live request for a sentence a low-priority job already queued: move that job to the live queue.
function promote(job) {
  if (!job || job.prio === 'hi') return;
  const i = Q.lo.indexOf(job);
  if (i >= 0) { Q.lo.splice(i, 1); job.prio = 'hi'; Q.hi.push(job); }
}
// Admission for low-priority work: at most LOW_MAX requests at once, else VOICE_BUSY. Returns the release function.
function admitLow() {
  if (Q.lowActive >= LOW_MAX) throw busyError();
  Q.lowActive++;
  let done = false;
  return () => { if (!done) { done = true; Q.lowActive--; } };
}
async function pump() {
  if (Q.running) return;
  Q.running = true;
  try {
    for (;;) {
      const j = Q.hi.shift() || Q.lo.shift();
      if (!j) break;
      if (j.signal && j.signal.aborted) { j.reject(abortError()); continue; }
      Q.current = 1;
      try {
        const r = await S.call('synth', j.args);
        if (r.rawSec > 0) { const rtf = r.runMs / 1000 / r.rawSec; S.rtfAvg = S.runs ? S.rtfAvg * 0.8 + rtf * 0.2 : rtf; S.runs++; }
        S.lastMs = r.runMs;
        for (const ch of r.missing || []) S.missing.add(ch);
        j.resolve(r.pcm);
      } catch (e) { j.reject(e); }
      Q.current = 0;
    }
  } finally { Q.running = false; Q.current = 0; }
}

// ---------- per-sentence LRU cache (+ sharing of identical in-flight sentences) ----------
const LRU = new Map();
let lruBytes = 0;
function lruGet(k) { const v = LRU.get(k); if (v) { LRU.delete(k); LRU.set(k, v); } return v; }
function lruSet(k, v) {
  if (LRU.has(k)) { lruBytes -= LRU.get(k).byteLength; LRU.delete(k); }
  LRU.set(k, v); lruBytes += v.byteLength;
  while (LRU.size > LRU_MAX || lruBytes > LRU_MAX_BYTES) { const [k0, v0] = LRU.entries().next().value; LRU.delete(k0); lruBytes -= v0.byteLength; }
}
const inflight = new Map();
const chunkKey = c => [c.spec, c.lang, c.speed, c.end ? 1 : 0, c.text].join('\u0001');

// Kokoro renders ~230 ms of silence before speech and a long quiet tail. Trim to a short lead-in (the first audio starts
// at once), a natural pause after a sentence and a short one mid-sentence. The threshold sits below soft onsets ("h", "f").
function trimEdges(w, end) {
  const win = 240, thr = 0.004; // 10 ms windows
  const loud = i => { let m = 0; for (let k = i; k < Math.min(i + win, w.length); k++) { const a = Math.abs(w[k]); if (a > m) m = a; } return m > thr; };
  let a = 0; while (a < w.length && !loud(a)) a += win;
  let b = w.length; while (b > a && !loud(Math.max(0, b - win))) b -= win;
  if (a >= b) return w;
  const lead = Math.round(SAMPLE_RATE * 0.05), tail = Math.round(SAMPLE_RATE * (end ? 0.2 : 0.08));
  return w.subarray(Math.max(0, a - lead), Math.min(w.length, b + tail));
}
function toInt16(f) {
  const o = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const x = f[i]; o[i] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767); }
  return o;
}
function synthChunk(c, prio, signal) {
  const key = chunkKey(c);
  const hit = lruGet(key);
  if (hit) { S.hits++; return Promise.resolve(hit); }
  if (signal && signal.aborted) return Promise.reject(abortError());
  let e = inflight.get(key);
  if (!e) {
    S.misses++;
    e = { ctrl: new AbortController(), refs: 0, job: { args: { text: c.text, lang: c.lang, end: c.end, spec: c.spec, speed: c.speed } } };
    e.job.signal = e.ctrl.signal;
    e.p = enqueue(e.job, prio).then(pcm => { lruSet(key, pcm); return pcm; });
    e.p.catch(() => {}).then(() => { if (inflight.get(key) === e) inflight.delete(key); });
    inflight.set(key, e);
  } else if (prio === 'hi') promote(e.job);
  e.refs++;
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return; done = true;
      if (--e.refs === 0) { e.ctrl.abort(); if (inflight.get(key) === e) inflight.delete(key); }
      reject(abortError());
    };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    e.p.then(v => { if (done) return; done = true; if (signal) signal.removeEventListener('abort', onAbort); resolve(v); },
      err => { if (done) return; done = true; if (signal) signal.removeEventListener('abort', onAbort); reject(err); });
  });
}

function plan(text, opts, quickStart, small) {
  const base = resolveLang(opts.lang, text);
  const speed = Math.min(2, Math.max(0.5, Number(opts.speed) || 1));
  if (opts.voice) parseSpec(opts.voice).forEach(p => { if (!knownVoice(p.name)) throw new Error('unknown voice: ' + p.name); });
  return chunkText(text, base, { quickStart, speed, small }).map(c => {
    let L = base;
    if (RE_DEVA.test(c.text) && L !== 'hi') L = 'hi';
    else if (RE_KANA.test(c.text) && L !== 'ja') L = 'ja';
    else if (RE_HAN.test(c.text) && !isCJK(L)) L = 'zh';
    return { text: c.text, end: c.end, lang: L, spec: opts.voice || specOrDefault(L), speed };
  });
}
// A tuned spec whose voice file vanished must not silence Bro: fall back to the built-in voice.
function specOrDefault(L) {
  const spec = voiceFor(L);
  try { blendFor(spec); return spec; } catch (e) { log('voice spec', spec, 'unusable (' + e.message + '), using default'); return LANGS[L].voice; }
}

// ---------- public API ----------
function ready() { return S.phase === 'ready' && !!S.engine && S.engine.connected; }
async function ensureReady(waitMs = 30000) {
  if (ready()) return;
  if (!S.initPromise) throw notReady('voice not initialised');
  if (S.phase === 'loading') {
    await Promise.race([S.initPromise, sleep(waitMs)]);
    if (ready()) return;
  }
  throw notReady(S.phase === 'fetching' ? 'voice model still downloading' : (S.error || 'voice not ready'));
}

// priority 'live' (default for speakStream) or 'low' (default for speak) -> queue name
const prioOf = (opts, dflt) => ((opts.priority || dflt) === 'low' ? 'lo' : 'hi');
const allCached = chunks => chunks.every(c => LRU.has(chunkKey(c)));

// speakStream(text, {lang, voice?, speed?, signal?, quickStart = true, priority = 'live'})
//   -> AsyncIterable<{ pcm: Int16Array, sampleRate: 24000, text, last }>
// Synthesises one sentence ahead of the consumer. When `signal` aborts it stops yielding and drops queued work.
// Pass quickStart:false for follow-up sentences of a reply that is already playing (no need to cut the first one short).
// priority 'low' uses small chunks and the low-priority admission (VOICE_BUSY when 3 low requests are already in).
async function* speakStream(text, opts = {}) {
  await ensureReady();
  const prio = prioOf(opts, 'live');
  const chunks = plan(text, opts, prio === 'hi' && opts.quickStart !== false, prio === 'lo');
  if (!chunks.length) return;
  const outer = opts.signal;
  if (outer && outer.aborted) return;
  const release = prio === 'lo' && !allCached(chunks) ? admitLow() : () => {};
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  if (outer) outer.addEventListener('abort', onOuter, { once: true });
  const start = i => { const p = synthChunk(chunks[i], prio, ctrl.signal); p.catch(() => {}); return p; };
  let next = start(0);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const cur = next;
      next = i + 1 < chunks.length ? start(i + 1) : null;
      let pcm;
      try { pcm = await cur; } catch (e) { if (ctrl.signal.aborted) return; throw e; }
      if (ctrl.signal.aborted) return;
      yield { pcm, sampleRate: SAMPLE_RATE, text: chunks[i].text, last: i === chunks.length - 1 };
      if (ctrl.signal.aborted) return;
    }
  } finally {
    ctrl.abort();
    release();
    if (outer) outer.removeEventListener('abort', onOuter);
  }
}

// speak(text, {lang, voice?, speed?, format:'mp3'|'wav', signal?, priority = 'low'}) -> { audio: Buffer, mime, seconds }
// mp3 (48 kbps mono, via ffmpeg) results are also kept on disk under mediaDir/brocore/cache/.
// Low priority (the default): small chunks behind every live sentence; throws VOICE_BUSY when 3 low requests are already
// in (callers answer 503 and let the phone's own voice speak). `signal` drops this request's queued work when it aborts.
async function speak(text, opts = {}) {
  await ensureReady();
  const signal = opts.signal;
  if (signal && signal.aborted) throw abortError();
  const prio = prioOf(opts, 'low');
  const chunks = plan(text, opts, false, prio === 'lo');
  const wantMp3 = opts.format === 'mp3' && !S.mp3Off;
  const cdir = wantMp3 && S.mediaDir ? path.join(S.mediaDir, 'brocore', 'cache') : '';
  const file = cdir ? path.join(cdir, crypto.createHash('sha256').update(JSON.stringify([MODEL_NAME, chunks.map(c => [c.text, c.lang, c.spec, c.speed])])).digest('hex').slice(0, 40) + '.mp3') : '';
  if (file) {
    try {
      const audio = await fsp.readFile(file);
      S.diskHits++;
      const now = new Date(); fsp.utimes(file, now, now).catch(() => {});
      return { audio, mime: 'audio/mpeg', seconds: +Math.max(0, (audio.length - 144) / 6000).toFixed(2), cached: true };
    } catch (e) { /* not cached */ }
  }
  const parts = [];
  const release = prio === 'lo' && !allCached(chunks) ? admitLow() : () => {};
  try {
    for (const c of chunks) parts.push(await synthChunk(c, prio, signal));
  } finally { release(); }
  if (signal && signal.aborted) throw abortError();
  const pcm = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
  const seconds = +(pcm.length / SAMPLE_RATE).toFixed(2);
  if (wantMp3) {
    try {
      const audio = await encodeMp3(pcm);
      if (file) writeCache(cdir, file, audio);
      return { audio, mime: 'audio/mpeg', seconds };
    } catch (e) {
      if (e.code === 'ENOENT') { S.mp3Off = true; log('ffmpeg not found; speaking wav instead of mp3'); } else log('mp3 encode failed, sending wav:', e.message);
    }
  }
  return { audio: toWav(pcm), mime: 'audio/wav', seconds };
}

function toWav(pcm, rate = SAMPLE_RATE) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(b, 44);
  return b;
}
function encodeMp3(pcm) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const t = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); if (code === 0 && out.length) resolve(Buffer.concat(out)); else reject(new Error('ffmpeg exit ' + code + ' ' + Buffer.concat(err).toString().slice(0, 200))); });
    p.stdin.on('error', () => {});
    p.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}
let pruneAt = 0, lowDiskPruneAt = 0;
function cacheCapBytes() { return (Number(process.env.BROCORE_CACHE_MB) || 256) * MB; }
// the mp3 cache never takes the volume's last BROCORE_CACHE_RESERVE_MB (default 1 GB): the database and recordings live there
function cacheReserveBytes() { const v = process.env.BROCORE_CACHE_RESERVE_MB; return (v != null && v !== '' && Number(v) >= 0 ? Number(v) : 1024) * MB; }
// Store one mp3 (atomically). Low on disk: skip it and shrink the cache instead. Returns a promise that never rejects.
function writeCache(dir, file, audio) {
  return (async () => {
    await fsp.mkdir(dir, { recursive: true });
    const reserve = cacheReserveBytes();
    const free = await freeBytes(dir);
    if (free - audio.length < reserve) {
      S.cacheSkips++;
      if (Date.now() - lowDiskPruneAt > 10e3) { lowDiskPruneAt = Date.now(); await pruneCache(dir, cacheCapBytes(), { free, reserve }); }
      return false;
    }
    const tmp = file + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, audio);
    await fsp.rename(tmp, file);
    if (Date.now() - pruneAt > 60e3) { pruneAt = Date.now(); await pruneCache(dir, cacheCapBytes(), { free: free - audio.length, reserve }); }
    return true;
  })().catch(e => { log('cache write failed:', e.message); return false; });
}
// Keep the mp3 cache under `cap` bytes: delete least recently used files (hits refresh mtime) down to 80% of cap.
// With o.free (bytes free on the volume) the cap also shrinks so at least o.reserve bytes stay free.
async function pruneCache(dir, cap, o = {}) {
  const names = (await fsp.readdir(dir)).filter(n => n.endsWith('.mp3'));
  const files = [];
  for (const n of names) { try { const st = await fsp.stat(path.join(dir, n)); files.push({ f: path.join(dir, n), size: st.size, t: st.mtimeMs }); } catch (e) { /* gone */ } }
  let total = files.reduce((a, f) => a + f.size, 0);
  if (Number.isFinite(o.free)) cap = Math.min(cap, Math.max(0, total + o.free - (o.reserve || 0)));
  if (total <= cap) return 0;
  files.sort((a, b) => a.t - b.t);
  let removed = 0;
  for (const f of files) { if (total <= cap * 0.8) break; try { await fsp.unlink(f.f); total -= f.size; removed++; } catch (e) { /* ignore */ } }
  return removed;
}

// one word for public status checks: never an error message or a path
function phaseWord() {
  if (ready()) return 'ready';
  if (S.phase === 'fetching') return 'fetching';
  if (S.phase === 'error') return /disk space/.test(S.error || '') ? 'no-space' : 'error';
  if (S.restarts && S.lastCrash) return 'restarting';
  return S.phase === 'loading' ? 'loading' : 'starting';
}
function health() {
  const rtf = +S.rtfAvg.toFixed(3);
  return {
    ready: ready(), loading: S.phase === 'loading' || S.phase === 'fetching', phase: S.phase, word: phaseWord(), error: S.error || null,
    queue: queueLength(), live: Q.hi.length, low: Q.lowActive, lowMax: LOW_MAX,
    rtf, rtfAvg: rtf, lastMs: S.lastMs, model: MODEL_NAME, threads: S.threads,
    restarts: S.restarts, lastCrash: S.lastCrash ? Object.assign({}, S.lastCrash) : null,
    cache: { mem: LRU.size, hits: S.hits, misses: S.misses, disk: S.diskHits, diskSkips: S.cacheSkips },
  };
}

// ---------- model files: fetch from the npm registry, verify, load ----------
async function sizeIs(f, n) { try { const st = await fsp.stat(f); return n ? st.size === n : st.size > 0; } catch (e) { return false; } }
function getToFile(url, dest, timeoutMs, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'user-agent': 'brocore-voice/1' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        getToFile(new URL(res.headers.location, url).toString(), dest, timeoutMs, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); return; }
      const want = Number(res.headers['content-length']) || 0;
      let got = 0;
      res.on('data', d => { got += d.length; });
      pipeline(res, fs.createWriteStream(dest)).then(() => {
        if (want && got !== want) reject(new Error('short download ' + got + '/' + want + ' for ' + url)); else resolve(got);
      }, reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('stalled download ' + url)));
    req.on('error', reject);
  });
}
async function download(url, dest, c) {
  let last;
  for (let i = 0; i < c.attempts; i++) {
    if (i) { const wait = Math.min(c.backoffMs * 2 ** (i - 1), 60e3); c.log('retry', i, url, 'in', wait, 'ms:', last.message); await sleep(wait); }
    try { return await getToFile(url, dest, c.timeoutMs); } catch (e) { last = e; }
  }
  throw last;
}
function fileHash(f, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(f).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('base64')));
  });
}
async function fetchModel(dir, c) {
  const tar = require('tar');
  const work = path.join(dir, '.fetch-model');
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });
  try {
    for (const name of c.shards) {
      const url = `${c.registry}/${name}/-/${name}-${c.shardVersion}.tgz`;
      const tgz = path.join(work, name + '.tgz');
      c.log('fetching', url);
      await download(url, tgz, c);
      await tar.x({ file: tgz, cwd: work, strip: 1, filter: p => /(^|\/)kokoro-fp32\.part\d+\.bin$/.test(p) });
      await fsp.rm(tgz, { force: true });
    }
    const parts = (await fsp.readdir(work)).map(f => /^kokoro-fp32\.part(\d+)\.bin$/.exec(f)).filter(Boolean)
      .map(m => ({ n: Number(m[1]), f: path.join(work, m[0]) })).sort((a, b) => a.n - b.n);
    if (!parts.length || parts.some((p, i) => p.n !== i) || (c.partCount && parts.length !== c.partCount)) {
      throw new Error('model shards incomplete: got parts ' + parts.map(p => p.n).join(','));
    }
    const tmp = path.join(dir, 'model.onnx.partial');
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    for (const p of parts) {
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(p.f);
        rs.on('data', d => { hash.update(d); if (!out.write(d)) { rs.pause(); out.once('drain', () => rs.resume()); } });
        rs.on('error', reject); rs.on('end', resolve);
      });
      await fsp.rm(p.f, { force: true }); // free disk as we go
    }
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve); });
    const got = hash.digest('hex');
    if (got !== c.sha256) { await fsp.rm(tmp, { force: true }); throw new Error('model sha256 mismatch: got ' + got.slice(0, 16) + '…, want ' + c.sha256.slice(0, 16) + '…'); }
    await fsp.rename(tmp, path.join(dir, 'model.onnx'));
    c.log('model verified', got.slice(0, 16) + '…');
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
async function fetchVoices(dir, names, c) {
  const tar = require('tar');
  const work = path.join(dir, '.fetch-voices');
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });
  try {
    const url = `${c.registry}/${c.voicesPkg}/-/${c.voicesPkg}-${c.voicesVersion}.tgz`;
    const tgz = path.join(work, 'voices.tgz');
    c.log('fetching', url);
    await download(url, tgz, c);
    if (c.voicesIntegrity) {
      const [algo, want] = c.voicesIntegrity.split('-');
      const got = await fileHash(tgz, algo);
      if (got !== want) throw new Error('voices tarball integrity mismatch');
    }
    const wanted = new Set(names.map(n => 'package/voices/' + n + '.bin'));
    await tar.x({ file: tgz, cwd: work, strip: 2, filter: p => wanted.has(p.replace(/^\.\//, '')) });
    for (const n of names) {
      const f = path.join(work, n + '.bin');
      if (!(await sizeIs(f, VOICE_BYTES))) throw new Error('voice missing from tarball: ' + n);
      await fsp.rename(f, path.join(dir, 'voices', n + '.bin'));
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
// Makes sure dir/model.onnx and dir/voices/<name>.bin exist, fetching what is missing. Returns what it fetched.
async function ensureModel(dir, cfg = {}) {
  const c = Object.assign({
    registry: process.env.BROCORE_REGISTRY || 'https://registry.npmjs.org',
    sha256: MODEL_SHA256, bytes: MODEL_BYTES, shards: SHARD_PKGS, shardVersion: SHARD_VERSION, partCount: SHARD_COUNT,
    voicesPkg: VOICES_PKG, voicesVersion: VOICES_VERSION, voicesIntegrity: VOICES_INTEGRITY, voices: VOICE_NAMES,
    attempts: 5, backoffMs: 2000, timeoutMs: 60000, log, onFetch: null,
    minFreeBytes: MIN_FREE_MODEL, minFreeVoicesBytes: MIN_FREE_VOICES, statfs: null, // statfs: (dir) -> {bavail, bsize}, for tests
  }, cfg);
  c.registry = c.registry.replace(/\/+$/, '');
  await fsp.mkdir(path.join(dir, 'voices'), { recursive: true });
  // a full disk must not end in a half-written model (or a full volume for the app): check before fetching anything
  const roomFor = async (need, what) => {
    const free = await freeBytes(dir, c.statfs);
    if (free >= need) return;
    c.log('only', fmtBytes(free), 'free in', dir, '- not fetching the', what);
    throw Object.assign(new Error('not enough disk space for the ' + what + ' (need ' + fmtBytes(need) + ')'), { code: 'VOICE_NO_SPACE', free });
  };
  const fetched = { model: false, voices: [] };
  if (!(await sizeIs(path.join(dir, 'model.onnx'), c.bytes))) {
    await roomFor(c.minFreeBytes, 'voice model');
    if (c.onFetch) c.onFetch();
    await fetchModel(dir, c);
    fetched.model = true;
  }
  const missing = [];
  for (const v of c.voices) if (!(await sizeIs(path.join(dir, 'voices', v + '.bin'), VOICE_BYTES))) missing.push(v);
  if (missing.length) {
    await roomFor(c.minFreeVoicesBytes, 'voice files');
    if (c.onFetch) c.onFetch();
    await fetchVoices(dir, missing, c);
    fetched.voices = missing;
  }
  return fetched;
}

// ---------- the voice engine (a child process) ----------
// Engine side: loads the model and espeak, then turns {text, lang, end, spec, speed} into trimmed Int16 PCM.
async function runModel(ids, spec, speed) {
  const ort = S.ort;
  const padded = [0, ...ids, 0];
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(padded, x => BigInt(x)), [1, padded.length]),
    style: new ort.Tensor('float32', styleFor(spec, padded.length), [1, 256]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  };
  const r = await S.session.run(feeds);
  return (r.waveform || r[S.session.outputNames[0]]).data;
}
async function engineSynth({ text, lang, end, spec, speed }) {
  const before = new Set(S.missing);
  const ph = phonemize(text, lang, end);
  const waves = [];
  const t0 = Date.now();
  for (const piece of splitPhonemes(ph)) {
    const ids = tokenize(piece);
    if (ids.length) waves.push(await runModel(ids, spec, speed));
  }
  const runMs = Date.now() - t0;
  const total = waves.reduce((a, w) => a + w.length, 0);
  const all = new Float32Array(total);
  let o = 0; for (const w of waves) { all.set(w, o); o += w.length; }
  return { pcm: toInt16(trimEdges(all, end)), runMs, rawSec: total / SAMPLE_RATE, missing: [...S.missing].filter(c => !before.has(c)) };
}
const ENGINE_FLAG = '--brocore-voice-engine';
async function engineMain() {
  const send = m => { try { process.send(m); } catch (e) { /* parent gone */ } };
  process.on('disconnect', () => process.exit(0)); // the app went away: so do we
  const d = await new Promise(r => process.once('message', r));
  S.dir = d.dir; S.threads = d.threads;
  try {
    S.ort = require('onnxruntime-node');
    S.session = await S.ort.InferenceSession.create(path.join(S.dir, 'model.onnx'), {
      intraOpNumThreads: S.threads, interOpNumThreads: 1, graphOptimizationLevel: 'all', executionMode: 'sequential',
    });
    await loadEspeak();
    // warm-up: the first espeak call per language and the first ORT run are slow
    for (const L of ['en', 'hi']) espeakIPA(L === 'hi' ? 'नमस्ते' : 'Hello there', LANGS[L].espeak);
    await engineSynth({ text: 'Hi.', lang: 'en', end: true, spec: LANGS.en.voice, speed: 1 });
  } catch (e) { send({ type: 'fatal', error: e.message }); setTimeout(() => process.exit(1), 50); return; }
  process.on('message', async m => {
    try {
      if (m.op === 'synth') send({ id: m.id, ok: true, out: await engineSynth(m.args) });
      else if (m.op === 'phonemize') send({ id: m.id, ok: true, out: phonemize(m.args.text, m.args.lang, m.args.end) });
      else send({ id: m.id, ok: false, error: 'unknown op ' + m.op });
    } catch (e) { send({ id: m.id, ok: false, error: e.message }); }
  });
  send({ type: 'ready' });
}
// Main side: the engine is a child process (this same file), not a worker thread: onnxruntime-node's binding can be loaded
// only once per process, so a worker could never be restarted, and a native crash in the engine must not take the app down.
// It only keeps the app's event loop alive while it has work.
const holdOpen = (c, on) => { try { if (on) { c.ref(); if (c.channel) c.channel.ref(); } else { c.unref(); if (c.channel) c.channel.unref(); } } catch (e) { /* closed */ } };
function spawnEngine() {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [__filename, ENGINE_FLAG], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced', env: process.env,
    });
    let up = false;
    // loading must finish too: an engine that hangs while loading is killed (start() then retries with its backoff)
    const startTimer = setTimeout(() => { if (up) return; reject(new Error('voice engine did not start in ' + Math.round(S.startTimeoutMs / 1000) + ' s')); try { c.kill('SIGKILL'); } catch (e) { /* gone */ } }, S.startTimeoutMs);
    c.on('message', m => {
      if (m.type === 'ready') { up = true; clearTimeout(startTimer); if (!S.pending.size) holdOpen(c, false); resolve(c); return; }
      if (m.type === 'fatal') { clearTimeout(startTimer); reject(new Error(m.error)); return; }
      const p = S.pending.get(m.id);
      if (!p) return; // late answer from a job the watchdog already failed
      S.pending.delete(m.id);
      if (!S.pending.size) holdOpen(c, false);
      if (m.ok) p.resolve(m.out); else p.reject(new Error(m.error));
    });
    c.on('error', e => { if (!up) { clearTimeout(startTimer); reject(new Error('voice engine failed to start: ' + e.message)); } });
    c.on('exit', (code, sig) => { clearTimeout(startTimer); const why = 'voice engine exited (' + (sig || code) + ')'; if (!up) reject(new Error(why)); else engineDown(c, why); });
    c.send({ dir: S.dir, threads: S.threads });
  });
}
// How long one job may take in the engine: max(8 s, 4 x the audio it should produce).
function jobTimeoutMs(op, args) {
  const min = S.watchdogMinMs;
  if (op !== 'synth' || !args) return min;
  return Math.max(min, Math.round(4000 * estSec(String(args.text || ''), args.lang, Number(args.speed) || 1)));
}
function engineCall(op, args) {
  const c = S.engine;
  if (!c || !c.connected) return Promise.reject(notReady('voice engine is not running'));
  const id = ++S.seq;
  const ms = jobTimeoutMs(op, args);
  return new Promise((resolve, reject) => {
    // watchdog: a stalled engine (stuck native code, swapped out, SIGSTOP) would block the queue forever while ready()
    // still says true. Kill it, fail this job and every other one in it, and let the restart backoff bring it back.
    const timer = setTimeout(() => {
      if (!S.pending.has(id)) return;
      engineDown(c, 'voice engine stalled (no answer in ' + (ms / 1000).toFixed(1) + ' s); restarting it', 'VOICE_STALLED');
      try { c.kill('SIGKILL'); } catch (e) { /* gone */ }
    }, ms);
    S.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    holdOpen(c, true);
    c.send({ id, op, args });
  });
}
// The engine died or stalled: fail its jobs, read not ready, restart after 2 s, 4 s, 8 s … 5 min (an engine that ran
// healthy for 10 minutes starts again from 2 s), so an OOM kill does not become a loop reloading 325 MB every 2 s.
function engineDown(c, why, code) {
  if (S.engine !== c) return;
  S.engine = null;
  for (const p of S.pending.values()) p.reject(Object.assign(new Error(why), { code: code || 'VOICE_ENGINE_DOWN' }));
  S.pending.clear();
  S.phase = 'error'; S.error = why;
  const now = Date.now(), upMs = S.upAt ? now - S.upAt : 0;
  if (upMs >= HEALTHY_RESET_MS) S.crashDelay = 0;
  const d = S.crashDelay ? Math.min(S.crashDelay * 2, RESTART_MAX_MS) : RESTART_BASE_MS;
  S.crashDelay = d; S.restarts++; S.upAt = 0;
  S.lastCrash = { at: new Date(now).toISOString(), why, upMs, nextRestartMs: d };
  log(why, '- restarting in', d / 1000, 's (restart', S.restarts + ')');
  clearTimeout(S.retryTimer);
  S.retryTimer = setTimeout(() => { S.phase = 'loading'; S.initPromise = start(); }, d);
  if (S.retryTimer.unref) S.retryTimer.unref();
}
// BROCORE_THREADS from the settings store (then env); default min(4, cpus - 1) so one core stays free for the app.
function threadCount() {
  let v = 0;
  try { v = Number(S.getSetting ? S.getSetting('BROCORE_THREADS') : '') || 0; } catch (e) { v = 0; }
  if (!(v > 0)) v = Number(process.env.BROCORE_THREADS) || 0;
  if (v > 0) return Math.max(1, Math.min(64, Math.round(v)));
  const cpus = (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1;
  return Math.max(1, Math.min(4, cpus - 1));
}

async function load() {
  if (!S.dir) throw new Error('no model directory (pass mediaDir to init or set BROCORE_MODEL_DIR)');
  const t0 = Date.now();
  try {
    await ensureModel(S.dir, Object.assign({ onFetch: () => { S.phase = 'fetching'; } }, S.download));
  } catch (e) {
    // the media volume is too full: the container's own disk holds the model instead (fetched again after a redeploy)
    const alt = path.join(os.tmpdir(), 'brocore', 'kokoro');
    if (e.code !== 'VOICE_NO_SPACE' || process.env.BROCORE_MODEL_DIR || S.dir === alt) throw e;
    log('media volume is full; using', alt, 'for the voice model');
    S.dir = alt;
    await ensureModel(S.dir, Object.assign({ onFetch: () => { S.phase = 'fetching'; } }, S.download));
  }
  S.phase = 'loading';
  S.threads = threadCount();
  S.engine = await spawnEngine();
  loadSpecs(); // again, now that voice files can be checked
  S.rtfAvg = 0; S.runs = 0;
  S.phase = 'ready'; S.error = ''; S.retryDelay = 60e3; S.upAt = Date.now();
  log('ready in', Date.now() - t0, 'ms;', S.threads, 'threads; model', path.join(S.dir, 'model.onnx'));
}
async function start() {
  try { await load(); return true; } catch (e) {
    S.phase = 'error'; S.error = e.message;
    const d = S.retryDelay; S.retryDelay = Math.min(d * 2, 30 * 60e3);
    log('not ready:', e.message, '- retrying in', Math.round(d / 1000), 's');
    S.retryTimer = setTimeout(() => { S.phase = 'loading'; S.initPromise = start(); }, d);
    if (S.retryTimer.unref) S.retryTimer.unref();
    return false;
  }
}
// init({getSetting, setSetting, mediaDir, modelDir?, download?}) -> Promise<boolean> (never rejects). Idempotent.
function init(opts = {}) {
  if (S.initPromise) return S.initPromise;
  S.getSetting = typeof opts.getSetting === 'function' ? opts.getSetting : null;
  S.setSetting = typeof opts.setSetting === 'function' ? opts.setSetting : null;
  S.mediaDir = opts.mediaDir || process.env.MEDIA_DIR || '';
  S.dir = process.env.BROCORE_MODEL_DIR || opts.modelDir || (S.mediaDir ? path.join(S.mediaDir, 'brocore', 'kokoro') : '');
  S.download = opts.download || {};
  loadSpecs();
  S.phase = 'loading';
  S.initPromise = start();
  return S.initPromise;
}

if (require.main === module && process.argv.includes(ENGINE_FLAG) && process.send) engineMain();

module.exports = {
  init, ready, speak, speakStream, voiceFor, setVoiceSpec, health,
  SAMPLE_RATE, MODEL_NAME, LANGS,
  _internals: { ensureModel, pruneCache, writeCache, freeBytes, loadSpecs, loadEspeak, chunkText, lowChunkChars, phonemize, tokenize, splitPhonemes, normEnglish, normCommon, cleanText, detectLang, normLang, resolveLang, parseSpec, toWav, encodeMp3, threadCount, jobTimeoutMs, start, state: S, queue: Q, VOICE_NAMES, MODEL_SHA256, LOW_MAX },
};
