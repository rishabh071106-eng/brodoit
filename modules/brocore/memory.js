// Bro Core · memory. What Bro remembers about each person, and what Bro learned about talking to people.
//   bro_calls       one row per voice call: summary (≤2 sentences), mood word, rating, the voice spec it used
//   bro_memory      durable facts / preferences / goals per user, weighted; mirrored in bro_memory_fts (FTS5, bm25)
//   bro_lessons     behaviour lessons as numbered snapshots; bro_state.lessons_active points at the live one (rollback)
//   bro_lessons_pending  nightly lessons the filter held back (lessonProblem, or fewer than 3 users behind them): never live
// Nothing that reads like an instruction is remembered (factProblem), since memories go back into later prompts.
// remember() merges near-duplicates (case-insensitive, word overlap) and raises their weight instead of piling copies.
// endCall() asks the brain (JSON mode) for the summary, mood and up to 5 facts, and stores them.
'use strict';

const STOP = new Set('a an the of to in on at for and or but with is am are was were be been being i me my mine you your user users he she they them his her their it its this that these those has have had do does did not no so very really just also about into from by as than then there here what which who when where why how will would can could should may might shall must'.split(' '));
const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const toks = s => new Set(norm(s).split(' ').filter(w => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w)));
function similar(a, b) {
  const na = norm(a), nb = norm(b); if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  const jac = i / (A.size + B.size - i), cont = i / Math.min(A.size, B.size);
  return Math.min(A.size, B.size) >= 2 ? Math.max(jac, cont >= 0.999 ? 0.85 : 0) : jac;
}
const NEAR = 0.6;
const uid = u => String(typeof u === 'string' ? u : (u && (u.phone || u.user_phone || u.id)) || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const sentences = (s, n) => { const parts = String(s || '').replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]*/g) || []; return parts.slice(0, n).join(' ').trim(); };
// FTS5 query: each word quoted (so user text can never be FTS syntax), longer words as prefixes, OR-joined
function ftsQuery(q) {
  const words = [...toks(q)].filter(w => w.length >= 2).slice(0, 12);
  return words.map(w => w.length > 3 && /^[a-z]+$/.test(w) ? '"' + w.replace(/(es|s)$/, '') + '"*' : '"' + w.replace(/"/g, '') + '"').join(' OR ');
}
const KINDS = new Set(['fact', 'preference', 'goal', 'mood', 'note']);

// ── what may be stored: memories and lessons go back into every later prompt, so nothing that reads like an instruction ──
// A memory (the remember tool, call notes): a short fact, never a rule for Bro, a link or a secret. '' = fine, else why not.
const FACT_BAD = /ignore|instruction|system prompt|always (say|do)|from now on|delete|password|http/i;
function factProblem(text) {
  const t = String(text || '').trim();
  if (t.length > 200) return 'too long (200 characters at most)';
  if (FACT_BAD.test(t)) return 'looks like an instruction, a link or a secret';
  return '';
}
// A lesson is shared by every user, so it is held to more: a short style or behaviour rule ("When users …, do …" or an
// imperative like "Ask …") with no tool names, links, numbers or words about the system, prompts, instructions,
// deleting or passwords. toolNames: extra tool names to refuse (the server tools are always refused).
const LESSON_MAX = 160;
const LESSON_WORDS = /\b(ignor|system|prompt|instruct|delet|password|passcode|admin|developer|jailbreak|override)/i;
const LESSON_LINK = /https?:|:\/\/|www\.|@|\b[\w-]+\.(?:com|net|org|in|io|ai|app|co|me|ly|gg|xyz|info|dev|link)\b/i;
const LESSON_TOOLS = /\b[a-z]+_[a-z0-9_]+\b|\b(?:tools?|function|api|remember|recall|lookup|navigate|weather)\b|\btoday\s*(?:\(|tool)|\b(?:use|call|run|invoke|trigger)\s+(?:the\s+)?today\b/i;
const LESSON_SHAPE = /^(?:(?:when|whenever|if|once|after|before|while|as soon as|the moment)\b[^,]{3,},\s*\S|(?:ask|offer|keep|use|avoid|acknowledge|reflect|suggest|start|begin|speak|talk|let|give|celebrate|listen|validate|encourage|check in|name|mirror|slow|pause|match|be|stay|try|share|invite|thank|praise|remind|mention|end|close|repeat|reply|respond|answer|greet|follow up|focus|help|gently|don't|do not|never|always|prefer|lead|explain|summari[sz]e|wait|allow|notice|normali[sz]e|frame|break|sound)\b)/i;
function lessonProblem(text, toolNames) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'empty';
  if (t.length > LESSON_MAX) return 'too long';
  if (LESSON_WORDS.test(t)) return 'mentions the system, prompts, instructions, deleting or passwords';
  if (LESSON_LINK.test(t)) return 'contains a link or address';
  if (/[0-9०-९]/.test(t)) return 'contains a number';
  // "today" is also a tool, but only its tool form counts ("use today"): "a small step for today" is a fine lesson
  const named = (toolNames || []).map(n => String(n || '').replace(/[^\w]/g, '')).filter(n => n && n !== 'today');
  if (LESSON_TOOLS.test(t) || named.some(n => new RegExp('\\b' + n + '\\b', 'i').test(t))) return 'mentions a tool';
  if (!LESSON_SHAPE.test(t)) return 'not phrased as a style or behaviour rule';
  return '';
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bro_calls(id INTEGER PRIMARY KEY AUTOINCREMENT, user_phone TEXT NOT NULL, lang TEXT DEFAULT '', started TEXT, ended TEXT,
  turns INTEGER DEFAULT 0, seconds INTEGER DEFAULT 0, summary TEXT DEFAULT '', mood TEXT DEFAULT '', coach_note TEXT DEFAULT '', rating INTEGER,
  spec TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_bro_calls_user ON bro_calls(user_phone, id DESC);
CREATE INDEX IF NOT EXISTS idx_bro_calls_created ON bro_calls(created_at);
CREATE TABLE IF NOT EXISTS bro_memory(id INTEGER PRIMARY KEY AUTOINCREMENT, user_phone TEXT NOT NULL, kind TEXT DEFAULT 'fact', text TEXT NOT NULL,
  weight REAL DEFAULT 1, hits INTEGER DEFAULT 1, source TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_bro_memory_user ON bro_memory(user_phone, weight DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS bro_memory_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS bro_lessons(id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, idx INTEGER DEFAULT 0, text TEXT NOT NULL, source TEXT DEFAULT 'nightly', created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_bro_lessons_v ON bro_lessons(version, idx);
CREATE TABLE IF NOT EXISTS bro_lessons_pending(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, reason TEXT DEFAULT '', users INTEGER DEFAULT 0, source TEXT DEFAULT 'nightly', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bro_state(k TEXT PRIMARY KEY, v TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bro_daily(day TEXT PRIMARY KEY, version TEXT, data TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bro_usage(month TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, calls INTEGER DEFAULT 0, tin INTEGER DEFAULT 0, tout INTEGER DEFAULT 0, usd REAL DEFAULT 0, PRIMARY KEY(month, model, purpose));
`;
const MAX_PER_USER = 200, MAX_LESSONS = 20, KEEP_VERSIONS = 40;

function createMemory(o) {
  const db = o.db;
  const chat = o.chat; // (req) → { text }
  const log = o.log || ((...a) => console.log('[brocore]', ...a));
  db.exec(SCHEMA);
  const q = s => db.prepare(s);
  const state = {
    get(k) { try { const r = q('SELECT v FROM bro_state WHERE k=?').get(k); return r ? r.v : null; } catch (e) { return null; } },
    set(k, v) { q("INSERT INTO bro_state(k,v,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at").run(k, v == null ? null : String(v)); },
    json(k, d) { try { const v = this.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  };
  const ftsPut = (id, text) => { q('DELETE FROM bro_memory_fts WHERE rowid=?').run(id); q('INSERT INTO bro_memory_fts(rowid, text) VALUES(?,?)').run(id, text); };
  const ftsDel = id => q('DELETE FROM bro_memory_fts WHERE rowid=?').run(id);

  // ── remember: upsert with near-duplicate merge ──
  const remember = db.transaction((user, text, kind, opts) => {
    const phone = uid(user); text = clip(text, 300); opts = opts || {};
    kind = KINDS.has(kind) ? kind : 'fact';
    if (!phone || norm(text).length < 3) return null;
    if (kind === 'mood') { // one slot: the latest mood replaces the last one
      const old = q("SELECT id FROM bro_memory WHERE user_phone=? AND kind='mood'").all(phone);
      for (const r of old) { q('DELETE FROM bro_memory WHERE id=?').run(r.id); ftsDel(r.id); }
    } else {
      const rows = q("SELECT id, text, weight, kind FROM bro_memory WHERE user_phone=? AND kind!='mood'").all(phone);
      let best = null, bs = 0;
      for (const r of rows) { const s = similar(text, r.text); if (s > bs) { bs = s; best = r; } }
      if (best && bs >= NEAR) {
        const keep = norm(text).length >= norm(best.text).length ? text : best.text; // the newer wording wins a tie (an updated date)
        q("UPDATE bro_memory SET text=?, kind=?, weight=MIN(weight+0.5, 5), hits=hits+1, updated_at=datetime('now') WHERE id=?").run(keep, kind === 'fact' ? best.kind : kind, best.id);
        if (keep !== best.text) ftsPut(best.id, keep);
        return { id: best.id, merged: true };
      }
    }
    const info = q('INSERT INTO bro_memory(user_phone, kind, text, weight, source) VALUES(?,?,?,?,?)').run(phone, kind, text, opts.weight || 1, opts.source || '');
    const id = Number(info.lastInsertRowid); ftsPut(id, text);
    const n = q('SELECT COUNT(*) n FROM bro_memory WHERE user_phone=?').get(phone).n;
    if (n > MAX_PER_USER) for (const r of q('SELECT id FROM bro_memory WHERE user_phone=? ORDER BY weight ASC, updated_at ASC LIMIT ?').all(phone, n - MAX_PER_USER)) { q('DELETE FROM bro_memory WHERE id=?').run(r.id); ftsDel(r.id); }
    return { id, merged: false };
  });

  const pub = r => ({ id: r.id, kind: r.kind, text: r.text, weight: Math.round(r.weight * 100) / 100, updated_at: r.updated_at });
  function top(user, n) { return q('SELECT * FROM bro_memory WHERE user_phone=? ORDER BY weight DESC, updated_at DESC LIMIT ?').all(uid(user), n || 8).map(pub); }
  // bm25 relevance, nudged by weight; [] when nothing matches
  function recall(user, query, n) {
    n = n || 8; const fq = ftsQuery(query); if (!fq) return [];
    let rows = [];
    try { rows = q('SELECT m.*, bm25(bro_memory_fts) AS rank FROM bro_memory_fts JOIN bro_memory m ON m.id = bro_memory_fts.rowid WHERE bro_memory_fts MATCH ? AND m.user_phone=? ORDER BY rank LIMIT 40').all(fq, uid(user)); } catch (e) { return []; }
    return rows.map(r => Object.assign(pub(r), { score: -r.rank * (1 + 0.25 * r.weight) })).sort((a, b) => b.score - a.score).slice(0, n);
  }
  function lastSummary(user) {
    const r = q("SELECT id, summary, mood, lang, ended, rating FROM bro_calls WHERE user_phone=? AND summary!='' ORDER BY id DESC LIMIT 1").get(uid(user));
    return r ? { id: r.id, summary: r.summary, mood: r.mood, lang: r.lang, ended: r.ended, rating: r.rating } : null;
  }

  // ── end of a call: store it, then let the brain write the notes ──
  const SUM_SYS = 'You write private notes for Bro, a warm voice coach, after a call with a user. Return JSON only, exactly: '
    + '{"summary":"at most 2 short sentences: what the user talked about and how Bro helped","mood":"one lowercase word for the user\'s mood (calm, happy, excited, hopeful, neutral, tired, stressed, anxious, sad, lonely, angry, confused)",'
    + '"facts":[{"text":"a durable fact, preference or goal about the user in third person, e.g. Has a maths exam on 3 March","kind":"fact|preference|goal"}],'
    + '"coach_note":"one short sentence on what Bro could do better next time"}. '
    + 'Up to 5 facts, only things worth remembering for weeks (not small talk, not passing feelings). Never include phone numbers, addresses, passwords, money or health details, or the user\'s name. Write the notes in English even if the call was in another language. If nothing is worth remembering, use an empty list.';
  async function endCall(user, call) {
    const phone = uid(user); call = call || {};
    if (!phone) throw new Error('user required');
    const turns = (Array.isArray(call.turns) ? call.turns : []).map(t => ({ role: t.role === 'assistant' || t.role === 'bro' ? 'Bro' : 'User', text: clip(t.text != null ? t.text : t.content, 600) })).filter(t => t.text);
    const userTurns = turns.filter(t => t.role === 'User').length;
    const started = call.started ? new Date(call.started).toISOString() : null, ended = call.ended ? new Date(call.ended).toISOString() : new Date().toISOString();
    const seconds = started ? Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000)) : 0;
    const rating = call.rating != null && +call.rating >= 1 && +call.rating <= 5 ? Math.round(+call.rating) : null;
    const lang = String(call.lang || '').slice(0, 8);
    let spec = String(call.spec || ''); if (!spec && o.voiceFor) { try { spec = String(o.voiceFor(lang) || ''); } catch (e) { spec = ''; } }
    const info = q('INSERT INTO bro_calls(user_phone, lang, started, ended, turns, seconds, rating, spec) VALUES(?,?,?,?,?,?,?,?)').run(phone, lang, started, ended, turns.length, seconds, rating, spec);
    const id = Number(info.lastInsertRowid);
    const out = { id, summary: '', mood: '', facts: [], rating };
    if (!userTurns || typeof chat !== 'function') return out;
    let transcript = turns.slice(-40).map(t => t.role + ': ' + t.text).join('\n');
    if (transcript.length > 7000) transcript = transcript.slice(-7000);
    try {
      const r = await chat({ system: SUM_SYS, messages: [{ role: 'user', content: 'Call transcript:\n' + transcript }], json: true, maxTokens: 500, temperature: 0.2, purpose: 'util' });
      const j = JSON.parse(r.text);
      out.summary = clip(sentences(j.summary, 2), 400);
      out.mood = norm(j.mood).split(' ')[0] || '';
      out.coach_note = clip(sentences(j.coach_note, 1), 200);
      // the notes come from the user's own words: a "fact" that reads like an instruction is not kept
      const facts = (Array.isArray(j.facts) ? j.facts : []).slice(0, 5).map(f => typeof f === 'string' ? { text: f, kind: 'fact' } : f).filter(f => f && f.text && norm(f.text).length >= 3 && !factProblem(f.text));
      q('UPDATE bro_calls SET summary=?, mood=?, coach_note=? WHERE id=?').run(out.summary, out.mood, out.coach_note, id);
      for (const f of facts) { const res = remember(phone, f.text, KINDS.has(f.kind) && f.kind !== 'mood' ? f.kind : 'fact', { source: 'call:' + id }); if (res) out.facts.push({ text: clip(f.text, 300), kind: f.kind || 'fact', merged: res.merged }); }
      if (out.mood) remember(phone, 'Mood on the last call (' + ended.slice(0, 10) + '): ' + out.mood, 'mood', { source: 'call:' + id });
    } catch (e) { log('endCall notes failed:', e.message); out.error = e.message; }
    return out;
  }
  // a rating for the user's own call (by id, else the latest call in the last day)
  function rate(user, rating, callId) {
    const phone = uid(user); const v = Math.round(+rating);
    if (!(v >= 1 && v <= 5)) return { ok: false, error: 'rating must be 1-5' };
    const row = callId ? q('SELECT id FROM bro_calls WHERE id=? AND user_phone=?').get(+callId, phone)
      : q("SELECT id FROM bro_calls WHERE user_phone=? AND created_at > datetime('now','-1 day') ORDER BY id DESC LIMIT 1").get(phone);
    if (!row) return { ok: false, error: 'no call to rate' };
    q('UPDATE bro_calls SET rating=? WHERE id=?').run(v, row.id);
    return { ok: true, id: row.id, rating: v };
  }
  // what a user can see, and erase
  function list(user) {
    const phone = uid(user);
    return { memories: q('SELECT * FROM bro_memory WHERE user_phone=? ORDER BY weight DESC, updated_at DESC').all(phone).map(pub),
      calls: q("SELECT id, lang, ended, summary, mood, rating FROM bro_calls WHERE user_phone=? AND summary!='' ORDER BY id DESC LIMIT 20").all(phone) };
  }
  const erase = db.transaction((user, id) => {
    const phone = uid(user);
    if (id) { const r = q('SELECT id FROM bro_memory WHERE id=? AND user_phone=?').get(+id, phone); if (!r) return { deleted: 0 }; q('DELETE FROM bro_memory WHERE id=?').run(r.id); ftsDel(r.id); return { deleted: 1 }; }
    const ids = q('SELECT id FROM bro_memory WHERE user_phone=?').all(phone);
    for (const r of ids) ftsDel(r.id);
    const m = q('DELETE FROM bro_memory WHERE user_phone=?').run(phone).changes;
    const c = q("UPDATE bro_calls SET summary='', mood='', coach_note='' WHERE user_phone=?").run(phone).changes;
    return { deleted: m, calls: c };
  });

  // ── nightly: merge near-duplicates, decay what has not come up in 60 days ──
  const consolidate = db.transaction(() => {
    let merged = 0, decayed = 0, removed = 0;
    for (const { user_phone } of q('SELECT DISTINCT user_phone FROM bro_memory').all()) {
      const rows = q("SELECT * FROM bro_memory WHERE user_phone=? AND kind!='mood' ORDER BY weight DESC, updated_at DESC").all(user_phone);
      const gone = new Set();
      for (let i = 0; i < rows.length; i++) {
        if (gone.has(rows[i].id)) continue;
        for (let j = i + 1; j < rows.length; j++) {
          if (gone.has(rows[j].id) || similar(rows[i].text, rows[j].text) < NEAR) continue;
          const a = rows[i], b = rows[j], text = norm(b.text).length > norm(a.text).length ? b.text : a.text;
          a.weight = Math.min(5, a.weight + b.weight * 0.5); a.text = text;
          q('UPDATE bro_memory SET text=?, weight=?, hits=hits+? WHERE id=?').run(text, a.weight, b.hits || 1, a.id); ftsPut(a.id, text);
          q('DELETE FROM bro_memory WHERE id=?').run(b.id); ftsDel(b.id); gone.add(b.id); merged++;
        }
      }
    }
    decayed = q("UPDATE bro_memory SET weight=weight*0.9 WHERE updated_at < datetime('now','-60 days')").run().changes;
    for (const r of q('SELECT id FROM bro_memory WHERE weight < 0.2').all()) { q('DELETE FROM bro_memory WHERE id=?').run(r.id); ftsDel(r.id); removed++; }
    return { merged, decayed, removed };
  });

  // ── lessons: snapshots by version; the pointer says which one is live ──
  const lessons = {
    activeVersion() { const v = parseInt(state.get('lessons_active'), 10); if (v >= 0) return v; const r = q('SELECT MAX(version) v FROM bro_lessons').get(); return (r && r.v) || 0; },
    active() { const v = lessons.activeVersion(); return v ? q('SELECT text FROM bro_lessons WHERE version=? ORDER BY idx').all(v).map(r => r.text) : []; },
    versions(n) { return q('SELECT version, COUNT(*) count, MIN(created_at) created_at, MAX(source) source FROM bro_lessons GROUP BY version ORDER BY version DESC LIMIT ?').all(n || 10).map(r => Object.assign(r, { lessons: q('SELECT text FROM bro_lessons WHERE version=? ORDER BY idx').all(r.version).map(x => x.text) })); },
    // a new version = these lessons first, then the live ones (near-duplicates dropped), at most 20
    add: db.transaction((fresh, source) => {
      const base = lessons.active();
      const list = [];
      for (const t of [...(fresh || []), ...base]) { const s = clip(t, 220); if (norm(s).length >= 8 && !list.some(x => similar(x, s) >= 0.7)) list.push(s); if (list.length >= MAX_LESSONS) break; }
      if (!list.length) return null;
      const r = q('SELECT MAX(version) v FROM bro_lessons').get(); const v = ((r && r.v) || 0) + 1;
      list.forEach((t, i) => q('INSERT INTO bro_lessons(version, idx, text, source) VALUES(?,?,?,?)').run(v, i, t, source || 'nightly'));
      state.set('lessons_active', v);
      q('DELETE FROM bro_lessons WHERE version <= ?').run(v - KEEP_VERSIONS);
      return { version: v, count: list.length, added: list.filter(t => !base.includes(t)).length };
    }),
    // lessons the nightly filter held back (not live): kept for the admin to read, newest first, at most 100
    addPending: db.transaction((items, source) => {
      let n = 0;
      for (const it of items || []) {
        const t = clip(it && it.text, 400); if (!t) continue;
        if (q('SELECT 1 FROM bro_lessons_pending WHERE text=?').get(t)) continue;
        q('INSERT INTO bro_lessons_pending(text, reason, users, source) VALUES(?,?,?,?)').run(t, String(it.reason || '').slice(0, 120), +it.users || 0, source || 'nightly'); n++;
      }
      q('DELETE FROM bro_lessons_pending WHERE id NOT IN (SELECT id FROM bro_lessons_pending ORDER BY id DESC LIMIT 100)').run();
      return n;
    }),
    pending(n) { return q('SELECT id, text, reason, users, source, created_at FROM bro_lessons_pending ORDER BY id DESC LIMIT ?').all(n || 20); },
    pendingCount() { try { return q('SELECT COUNT(*) n FROM bro_lessons_pending').get().n; } catch (e) { return 0; } },
    problem: t => lessonProblem(t, o.toolNames), // '' when a lesson may go live
    safeActive() { return lessons.active().filter(t => !lessonProblem(t, o.toolNames)); },
    rollback(to) {
      const cur = lessons.activeVersion();
      const target = to != null && to !== '' ? (parseInt(to, 10) || 0) : ((q('SELECT MAX(version) v FROM bro_lessons WHERE version < ?').get(cur) || {}).v || 0);
      if (target && !q('SELECT 1 FROM bro_lessons WHERE version=?').get(target)) return { ok: false, error: 'no such version' };
      if (target === cur) return { ok: false, error: 'already live' };
      state.set('lessons_active', target);
      log('lessons rolled back', cur, '→', target || 'none');
      return { ok: true, from: cur, active_version: target };
    },
  };

  function stats() {
    try {
      return { memories: q('SELECT COUNT(*) n FROM bro_memory').get().n, users: q('SELECT COUNT(DISTINCT user_phone) n FROM bro_memory').get().n,
        calls: q('SELECT COUNT(*) n FROM bro_calls').get().n, rated: q('SELECT COUNT(*) n FROM bro_calls WHERE rating IS NOT NULL').get().n };
    } catch (e) { return { memories: 0, users: 0, calls: 0, rated: 0 }; }
  }
  return { remember, recall, top, lastSummary, endCall, rate, list, erase, consolidate, lessons, state, stats, factProblem, lessonProblem };
}

module.exports = { createMemory, similar, norm, ftsQuery, SCHEMA, factProblem, lessonProblem, LESSON_MAX };
