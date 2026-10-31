// v27: Hindi versions of Bro's book notes. Each English note (hook, five ideas with a "try it today", Bro's take) is
// written once in natural Hindi by the background writer (Gemini Flash when a key is set, else Bro Core's background
// lane, never the live-talk allowance) and saved to MEDIA_DIR/books-hi/<id>.json with notes: 2. The app shows it when
// the reader picks हिंदी, and Bro records it the first time someone plays it. Hindi files from before v27 (translations
// of the old chapter-by-chapter briefs, no notes marker) are deleted at start.
//   require('./booknotes-hi.js').create({ mediaDir, getSetting, books: () => [book…] })
'use strict';
const fs = require('fs'), path = require('path');
const GEM = require('./gemini.js');

const NUM_HI = ['एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात'];
const deva = t => (String(t || '').match(/[ऀ-ॿ]/g) || []).length;
const letters = t => (String(t || '').match(/[A-Za-zऀ-ॿ]/g) || []).length;
// share of letters in Devanagari: an idea's title is short and may keep a concept's English name ("Two-minute नियम"),
// so it needs only a quarter; a body needs 60% (an English reply has none)
const isHindi = (t, min) => { const n = letters(t); return n > 0 && deva(t) / n >= (min || 0.6); };
const clean = t => String(t || '').replace(/\s+/g, ' ').replace(/[*#_[\]]/g, '').trim();

const SYS = 'You translate a short audio note about a book into natural, warm, spoken Hindi for Indian listeners, the way a friendly coach talks: ' +
  'simple everyday Hindi in Devanagari (common English words like "app", "phone" or "office" may stay in Devanagari letters), short sentences, second person (तुम). ' +
  'Keep the meaning, keep it original, do not add facts, do not quote the book. Keep the book title and author in English letters. ' +
  'Return strict JSON with the same keys: hook, ideas (an array of exactly 5 objects with t, b, try), take.';

// the note's English parts back out of a BOOK_SUMMARIES entry: why = hook, insights = [title, body, try], take
function partsOf(b) {
  const ideas = (b.insights || []).filter(x => Array.isArray(x) && x[2]).map(x => ({ t: x[0], b: x[1], try: x[2] }));
  return ideas.length === 5 && b.take ? { hook: b.why, ideas, take: b.take } : null;
}
function parseReply(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(t); } catch (e) { /* not bare JSON */ }
  const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
function check(o) {
  const bad = [];
  if (!o || typeof o !== 'object') return ['not a JSON object'];
  if (!isHindi(o.hook)) bad.push('hook must be Hindi in Devanagari');
  if (!Array.isArray(o.ideas) || o.ideas.length !== 5) bad.push('ideas must be exactly 5');
  else o.ideas.forEach((x, i) => { if (!x || !isHindi(x.t, 0.25) || !isHindi(x.b) || !isHindi(x.try)) bad.push('idea ' + (i + 1) + ' must be Hindi in Devanagari (t, b, try)'); });
  if (!isHindi(o.take)) bad.push('take must be Hindi in Devanagari');
  return bad;
}
// the Hindi note as the app and the recorder use it (same shape as a BOOK_SUMMARIES entry)
function toNote(b, o) {
  const ideas = o.ideas.map(x => [clean(x.t).replace(/[।.]+$/, ''), clean(x.b), clean(x.try)]);
  const summary = [b.title + ' पर Bro के नोट्स। ' + clean(o.hook)]
    .concat(ideas.map((x, i) => 'विचार ' + NUM_HI[i] + '। ' + x[0] + '। ' + x[1] + ' आज आज़माएँ: ' + x[2]))
    .concat(['Bro की राय। ' + clean(o.take)]).join('\n\n');
  const words = summary.split(/\s+/).length;
  return { notes: 2, id: b.id, title: b.title, why: clean(o.hook), insights: ideas, take: clean(o.take), summary, mins: Math.max(2, Math.round(words / 130)) };
}

function create(o) {
  const log = (...a) => console.log('[book-notes-hi]', ...a);
  const dir = path.join(o.mediaDir || '.', 'books-hi');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* read-only */ }
  // pre-v27 Hindi briefs (and their old recordings) go
  try {
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f.endsWith('.mp3')) { fs.unlinkSync(p); n++; continue; }
      if (!f.endsWith('.json')) continue;
      let j = null; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { j = null; }
      if (!j || j.notes !== 2) { fs.unlinkSync(p); n++; }
    }
    if (n) log('removed', n, 'Hindi files of the old briefs');
  } catch (e) { /* nothing there */ }

  const getSetting = o.getSetting || (k => process.env[k] || '');
  async function write(text) {
    const g = getSetting('GEMINI_API_KEY');
    if (g && !((global._geminiDownUntil || 0) > Date.now())) {
      try {
        const { json: j } = await GEM.generate(g, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }, { tier: 'flash', getSetting, timeout: 60000 });
        return JSON.parse(GEM.textOf(j));
      } catch (e) { log('gemini:', String(e.message || e).slice(0, 100)); }
    }
    const BC = global._broCore;
    if (BC && BC.brainReady && BC.brainReady()) {
      // Devanagari takes several tokens a word: room for the whole note, so the JSON is never cut off
      const r = await BC.chat({ system: SYS, messages: [{ role: 'user', content: text }], json: true, maxTokens: 7000, temperature: 0.3, purpose: 'news', emergency: false });
      const out = parseReply(r && r.text);
      if (!out) state.why = 'reply was not JSON (' + String(r && r.text || '').length + ' chars' + (r && r.model ? ', ' + r.model : '') + ')';
      return out;
    }
    state.why = 'no writer (no Gemini key and Bro Core not ready)';
    return null;
  }
  const state = { running: false, made: 0, failed: {}, error: '', why: '', at: null, tried: 0, recent: [] };
  async function one(b) {
    const parts = partsOf(b); if (!parts) return false;
    const text = 'BOOK: ' + b.title + ' by ' + b.author + '\nNOTE (English):\n' + JSON.stringify(parts);
    let out = await write(text);
    let bad = check(out);
    if (bad.length && out) { const fixed = await write(text + '\n\nYOUR DRAFT:\n' + JSON.stringify(out) + '\n\nProblems: ' + bad.join('; ') + '. Fix every one and return the corrected JSON.'); if (fixed && check(fixed).length < bad.length) { out = fixed; bad = check(out); } }
    if (bad.length) { state.error = b.id + ': ' + (out ? bad.join('; ') : state.why || 'no reply').slice(0, 160); return false; }
    const note = toNote(b, out), f = path.join(dir, b.id + '.json'), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(note)); fs.renameSync(tmp, f);
    return true;
  }
  async function run() {
    if (state.running) return; state.running = true;
    try {
      let logged = 0;
      for (const b of (o.books ? o.books() : [])) {
        if (!b || !b.id || fs.existsSync(path.join(dir, b.id + '.json'))) continue;
        if (Date.now() - (state.failed[b.id] || 0) < 6 * 3600e3) continue;
        let ok = false; state.tried++; state.error = ''; state.why = '';
        try { ok = await one(b); } catch (e) { state.error = b.id + ': ' + String(e.message || e).slice(0, 120); }
        if (ok) state.made++; else {
          state.failed[b.id] = Date.now();
          state.recent = state.recent.concat([state.error || b.id + ': failed']).slice(-5);
          if (logged++ < 5) log('could not write', state.error || b.id); // the reason, for the deploy logs (5 a run)
        }
        state.at = new Date().toISOString();
        await new Promise(r => setTimeout(r, +(process.env.BOOK_NOTES_HI_PACE_MS || 20000)));
      }
      log(state.made, 'Hindi notes written so far ·', Object.keys(state.failed).length, 'waiting for a retry');
    } finally { state.running = false; }
  }
  if (process.env.BOOK_NOTES_HI !== '0' && o.schedule !== false) {
    const t1 = setTimeout(() => run().catch(() => {}), o.firstMs != null ? o.firstMs : 180e3), t2 = setInterval(() => run().catch(() => {}), 3 * 3600e3);
    for (const t of [t1, t2]) if (t.unref) t.unref();
  }
  // what the job is doing, for /api/book-hi (counts and the last few reasons; no keys, no text of the notes)
  const status = () => ({ running: state.running, made: state.made, tried: state.tried, waiting: Object.keys(state.failed).length, at: state.at, recent: state.recent });
  global._bookNotesHi = { status };
  return { run, state, status, one, toNote, check, partsOf };
}

module.exports = { create, toNote, check, partsOf, isHindi, parseReply };
