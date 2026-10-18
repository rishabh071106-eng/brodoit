// Brodoit Steps — the "Move" tab backend. Collects step counts from several sources (manual entry,
// in-browser Walk mode deltas, Google Fit, an iOS Shortcut, and the Android/Health Connect companion
// that syncs in the background), resolves them into one trusted number per day, keeps goals/streaks/
// freezes, runs friends / city / India leaderboards, invite links with OG images, and IST push jobs.
//
//   install(app,{db,auth,dayKey,webpush?,pushAll?,MEDIA_DIR,PUBLIC_URL,genId,sha256,getUserByPhone,
//                fetchFeed?,gAccessToken?,fitSync?,pushTo?})
//     →  {summaryFor(phone), tick(now?), getStepsTool(phone), ingest(phone,date,count,source?), recompute, stop}
//
// Streak model: step_profile holds only *settled* state (days closed by the 00:35 job, one day at a time,
// idempotent via closed_date). What the user sees is derived live from that state plus today's / an unclosed
// yesterday's rows, so a count that later drops below the goal never leaves a phantom credit behind, and late
// data for the most recently closed day re-settles it from the snapshot kept in closed_prev.
//
// Phone numbers never leave the server: every public payload uses id=sha1(phone).slice(0,10).
'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');

const IST = 'Asia/Kolkata';
const TRUST = { manual: 0, device: 1, googlefit: 2, shortcut: 2, android: 3, healthconnect: 3 };
const HARD_CAP = 50000;      // per day, keep `raw`
const HOUR_CAP = 12000;      // per hour bucket when hours exist → `rate`
const MANUAL_CAP = 20000;    // manual entries, today/yesterday only
const WALK_CAP = 25000;      // Walk-mode deltas per day
const FLUSH_MS = 60 * 1000;  // ≤1 delta flush per user per minute
const BOARD_MIN = 20;        // city / india boards hide below this cohort
const BOARD_TTL = 60 * 1000; // leaderboard cache
const OG_TTL = 10 * 60 * 1000;
const SWAP_DAYS = 7;         // device swap cooldown
const REPORTS_TO_HIDE = 3;
const PEPPER = process.env.STEPS_PEPPER || 'brodoit-steps-pepper-v1';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.brodoit.twa';
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

// ───────────────────────── time helpers (IST + per-user tz, all inside this module) ─────────────────────────
const _fmtCache = new Map();
function tzFormatter(tz) {
  let f = _fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    } catch (e) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: IST, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    }
    _fmtCache.set(tz, f);
  }
  return f;
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// {key:'YYYY-MM-DD', hh, mm, dow} of `date` in time zone `tz` (defaults to IST).
function tzParts(date, tz) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const parts = {};
  for (const p of tzFormatter(tz || IST).formatToParts(d)) parts[p.type] = p.value;
  const hh = parseInt(parts.hour, 10) % 24;
  return { key: `${parts.year}-${parts.month}-${parts.day}`, hh, mm: parseInt(parts.minute, 10), dow: DOW[parts.weekday] ?? 0 };
}
const dk = (tz, date) => tzParts(date, tz).key;
const isKey = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
function addDays(key, n) {
  const t = Date.parse(key + 'T00:00:00Z') + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}
function mondayOf(key) {
  const dow = new Date(key + 'T00:00:00Z').getUTCDay(); // 0=Sun
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}
const nowIso = () => new Date().toISOString();
const safeTz = tz => (typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz) && tz.length < 64 && (() => { try { tzFormatter(tz).format(new Date()); return true; } catch (e) { return false; } })()) ? tz : '';

// ───────────────────────── small utils ─────────────────────────
const sha1 = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const pubId = phone => sha1(phone).slice(0, 10);
const str = (v, max) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi, def) => { const n = typeof v === 'number' ? v : parseInt(v, 10); if (!Number.isFinite(n)) return def; return Math.max(lo, Math.min(hi, Math.round(n))); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Number(n || 0).toLocaleString('en-IN');
const flagsOf = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const safeEqual = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
// First letter-or-digit code point of a string (never a lone surrogate); '' when there is none.
function initialOf(s) {
  for (const ch of String(s || '')) if (/[\p{L}\p{N}]/u.test(ch)) return ch.toUpperCase();
  return '';
}
function displayName(name) {
  const n = str(name, 60);
  if (!n) return 'Bro';
  const parts = n.split(' ');
  const ini = parts[1] ? initialOf(parts[1]) : '';
  return (parts[0] + (ini ? ' ' + ini + '.' : '')).slice(0, 18);
}
const hasDevanagari = s => /\p{Script=Devanagari}/u.test(String(s || ''));

function install(app, deps) {
  deps = deps || {};
  const { db, auth } = deps;
  if (!db || !auth) throw new Error('steps.install: db and auth are required');
  const PUBLIC_URL = String(deps.PUBLIC_URL || process.env.PUBLIC_URL || 'https://brodoit.com').replace(/\/$/, '');
  const APP_DIR = path.join(deps.appRoot || path.join(__dirname, '..'), 'app');
  const log = (...a) => console.log('[steps]', ...a);

  // ───── schema (additive; every statement guarded) ─────
  const exec = sql => { try { db.exec(sql); } catch (e) { /* column/table already there */ } };
  exec("CREATE TABLE IF NOT EXISTS steps(id INTEGER PRIMARY KEY AUTOINCREMENT,user_phone TEXT NOT NULL,date TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,source TEXT DEFAULT'manual',updated_at TEXT DEFAULT(datetime('now')))");
  exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_user_date ON steps(user_phone,date)');
  for (const col of ['raw INTEGER', 'counted INTEGER', "trust INTEGER DEFAULT 0", "flags TEXT DEFAULT ''", 'synced_at TEXT']) exec(`ALTER TABLE steps ADD COLUMN ${col}`);
  exec('CREATE INDEX IF NOT EXISTS idx_steps_date ON steps(date,trust)');
  exec('CREATE TABLE IF NOT EXISTS step_samples(user_phone TEXT NOT NULL,date TEXT NOT NULL,source TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,device_id TEXT,tz TEXT,recorded_at TEXT,PRIMARY KEY(user_phone,date,source))');
  exec('CREATE TABLE IF NOT EXISTS step_hours(user_phone TEXT NOT NULL,date TEXT NOT NULL,hour INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_phone,date,hour))');
  exec('CREATE TABLE IF NOT EXISTS step_devices(device_id TEXT PRIMARY KEY,user_phone TEXT,secret_hash TEXT NOT NULL,claim_hash TEXT,platform TEXT,provider TEXT,model TEXT,os TEXT,app_ver TEXT,last_sync_at TEXT,created_at TEXT,revoked_at TEXT)');
  exec('ALTER TABLE step_devices ADD COLUMN claimed_at TEXT');
  exec('CREATE TABLE IF NOT EXISTS step_profile(user_phone TEXT PRIMARY KEY,goal INTEGER DEFAULT 8000,streak INTEGER DEFAULT 0,longest INTEGER DEFAULT 0,freezes_left INTEGER DEFAULT 1,week_key TEXT,last_goal_date TEXT,shortcut_token_hash TEXT,city TEXT,avatar_hue INTEGER,invite_code TEXT UNIQUE,created_at TEXT)');
  exec('ALTER TABLE step_profile ADD COLUMN frozen_date TEXT');
  exec('ALTER TABLE step_profile ADD COLUMN closed_date TEXT');
  exec('ALTER TABLE step_profile ADD COLUMN closed_prev TEXT'); // JSON snapshot of the state before closed_date was settled
  exec('CREATE TABLE IF NOT EXISTS friends(user_phone TEXT NOT NULL,friend_phone TEXT NOT NULL,status TEXT DEFAULT \'accepted\',created_at TEXT,PRIMARY KEY(user_phone,friend_phone))');
  exec('CREATE TABLE IF NOT EXISTS referrals(code TEXT,inviter TEXT,invitee TEXT PRIMARY KEY,joined_at TEXT,rewarded_at TEXT)');
  exec('CREATE TABLE IF NOT EXISTS share_events(user_phone TEXT,kind TEXT,ts TEXT)');
  exec('CREATE TABLE IF NOT EXISTS step_boards(period TEXT,scope TEXT,key TEXT,date_key TEXT,user_phone TEXT,steps INTEGER,rank INTEGER,computed_at TEXT,PRIMARY KEY(period,scope,key,date_key,user_phone))');
  exec('CREATE TABLE IF NOT EXISTS step_reports(reporter TEXT,target TEXT,date_key TEXT,reason TEXT,created_at TEXT)');
  exec('CREATE TABLE IF NOT EXISTS push_prefs(user_phone TEXT PRIMARY KEY,evening INTEGER DEFAULT 1,weekly INTEGER DEFAULT 1,social INTEGER DEFAULT 1,hour INTEGER DEFAULT 19,minute INTEGER DEFAULT 30)');
  exec('CREATE TABLE IF NOT EXISTS badges(user_phone TEXT,badge TEXT,earned_at TEXT,PRIMARY KEY(user_phone,badge))');
  exec('CREATE TABLE IF NOT EXISTS push_log(user_phone TEXT NOT NULL,date_key TEXT NOT NULL,kind TEXT,ts TEXT,PRIMARY KEY(user_phone,date_key))');
  exec('CREATE TABLE IF NOT EXISTS push_subs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_phone TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,keys_p256dh TEXT NOT NULL,keys_auth TEXT NOT NULL,hydration INTEGER DEFAULT 0,created_at TEXT DEFAULT(datetime(\'now\')))');

  // Prepared-statement cache: compile each SQL string once.
  const _stmts = new Map();
  const q = sql => { let s = _stmts.get(sql); if (!s) { s = db.prepare(sql); _stmts.set(sql, s); } return s; };

  // ───── users & profiles ─────
  const getUser = phone => {
    try { if (typeof deps.getUserByPhone === 'function') { const u = deps.getUserByPhone(phone); if (u) return u; } } catch (e) { /* fall through */ }
    try { return q('SELECT phone,name,tz FROM users WHERE phone=?').get(phone) || null; } catch (e) { return null; }
  };
  const userTz = (phone, user) => { const u = user || getUser(phone); return safeTz(u && u.tz) || IST; };
  const todayOf = (phone, user) => dk(userTz(phone, user));

  function newInviteCode() {
    for (let i = 0; i < 50; i++) {
      let c = ''; for (let j = 0; j < 6; j++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!q('SELECT 1 FROM step_profile WHERE invite_code=?').get(c)) return c;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  }
  function ensureProfile(phone) {
    let p = q('SELECT * FROM step_profile WHERE user_phone=?').get(phone);
    if (!p) {
      const hue = parseInt(sha1(phone).slice(0, 4), 16) % 360;
      try { q('INSERT OR IGNORE INTO step_profile(user_phone,goal,streak,longest,freezes_left,avatar_hue,invite_code,created_at,week_key) VALUES(?,8000,0,0,1,?,?,?,?)').run(phone, hue, newInviteCode(), nowIso(), mondayOf(dk(IST))); } catch (e) { log('profile insert', e.message); }
      p = q('SELECT * FROM step_profile WHERE user_phone=?').get(phone);
    }
    if (p && !p.invite_code) { try { q('UPDATE step_profile SET invite_code=? WHERE user_phone=?').run(newInviteCode(), phone); p = q('SELECT * FROM step_profile WHERE user_phone=?').get(phone); } catch (e) { /* ignore */ } }
    if (p && p.avatar_hue == null) p.avatar_hue = parseInt(sha1(phone).slice(0, 4), 16) % 360;
    return p || { user_phone: phone, goal: 8000, streak: 0, longest: 0, freezes_left: 1, avatar_hue: 200, invite_code: '' };
  }
  const inviteUrl = code => `${PUBLIC_URL}/join/${code}`;
  const prefsOf = phone => {
    const r = q('SELECT evening,weekly,social,hour,minute FROM push_prefs WHERE user_phone=?').get(phone);
    return r ? { evening: !!r.evening, weekly: !!r.weekly, social: !!r.social, hour: r.hour, minute: r.minute } : { evening: true, weekly: true, social: true, hour: 19, minute: 30 };
  };

  // public identity map (id → phone) so reports/deletes can address people without phones leaking
  const _idToPhone = new Map();
  const idOf = phone => { const id = pubId(phone); _idToPhone.set(id, phone); return id; };
  function phoneOfId(id) {
    if (_idToPhone.has(id)) return _idToPhone.get(id);
    try { for (const r of q('SELECT phone FROM users').all()) if (pubId(r.phone) === id) { _idToPhone.set(id, r.phone); return r.phone; } } catch (e) { /* ignore */ }
    return null;
  }

  // ───── samples → counted ─────
  const friendsOf = phone => q("SELECT friend_phone FROM friends WHERE user_phone=? AND status='accepted'").all(phone).map(r => r.friend_phone);
  const boardCache = new Map();
  function invalidateBoards(phone) {
    boardCache.delete('friends|' + phone);
    try { for (const f of friendsOf(phone)) boardCache.delete('friends|' + f); } catch (e) { /* ignore */ }
    try { const p = q('SELECT city FROM step_profile WHERE user_phone=?').get(phone); if (p && p.city) boardCache.delete('city|' + p.city); } catch (e) { /* ignore */ }
    boardCache.delete('india|in');
  }

  function putSample(phone, date, source, count, deviceId, tz) {
    q('INSERT INTO step_samples(user_phone,date,source,count,device_id,tz,recorded_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_phone,date,source) DO UPDATE SET count=excluded.count,device_id=excluded.device_id,tz=excluded.tz,recorded_at=excluded.recorded_at')
      .run(phone, date, source, Math.max(0, Math.round(count || 0)), deviceId || null, tz || null, nowIso());
  }
  function putHours(phone, date, hours) {
    const ins = q('INSERT INTO step_hours(user_phone,date,hour,count) VALUES(?,?,?,?) ON CONFLICT(user_phone,date,hour) DO UPDATE SET count=excluded.count');
    for (let h = 0; h < 24; h++) ins.run(phone, date, h, int(hours[h], 0, HARD_CAP, 0));
  }
  // The latest sync is authoritative for a day's hourly buckets: a sync without hours, or with buckets that cannot
  // describe the day's count (sum far above it, garbage values), clears them instead of leaving stale ones behind.
  function setHours(phone, date, hours, count) {
    let ok = Array.isArray(hours) && hours.length === 24;
    if (ok) { const vals = hours.map(h => int(h, 0, HARD_CAP, 0)); if (vals.reduce((a, b) => a + b, 0) > count * 1.2 + 500) ok = false; else hours = vals; }
    if (ok) putHours(phone, date, hours); else q('DELETE FROM step_hours WHERE user_phone=? AND date=?').run(phone, date);
  }
  const zeroRow = date => ({ date, counted: 0, raw: 0, source: null, trust: 0, flags: [], synced_at: null });
  function dayRow(phone, date) {
    const r = q('SELECT date,count,counted,raw,source,trust,flags,synced_at,updated_at FROM steps WHERE user_phone=? AND date=?').get(phone, date);
    if (!r) return zeroRow(date);
    const counted = r.counted != null ? r.counted : r.count;
    return { date, counted: counted || 0, raw: r.raw != null ? r.raw : counted || 0, source: r.source || null, trust: r.trust || 0, flags: flagsOf(r.flags), synced_at: r.synced_at || r.updated_at || null };
  }

  // Resolve one day: highest trust tier wins, max() inside the tier (never a sum across sources),
  // then the hard cap, then the hourly rate cap. Writes the `steps` row (count mirrors counted).
  function recompute(phone, date) {
    const samples = q('SELECT source,count,recorded_at FROM step_samples WHERE user_phone=? AND date=?').all(phone, date);
    let best = null;
    for (const s of samples) {
      const t = TRUST[s.source] ?? 0;
      const tier = t >= 2 ? 2 : t;
      const bt = best ? (best.trust >= 2 ? 2 : best.trust) : -1;
      if (tier > bt || (tier === bt && (s.count > best.count || (s.count === best.count && t > best.trust)))) best = { source: s.source, count: s.count, trust: t, recorded_at: s.recorded_at };
    }
    const flags = new Set();
    if (reportCount(phone, date) >= REPORTS_TO_HIDE) flags.add('hidden'); // reports may predate the row
    if (!best) {
      // legacy row written by old clients straight into steps (no samples) → keep it, just normalise
      const legacy = q('SELECT count,source,trust,counted FROM steps WHERE user_phone=? AND date=?').get(phone, date);
      if (!legacy) return zeroRow(date);
      if (legacy.counted != null && legacy.source && TRUST[legacy.source] != null) {
        return dayRow(phone, date);
      }
      best = { source: legacy.source || 'manual', count: legacy.count || 0, trust: TRUST[legacy.source] ?? 0, recorded_at: null };
    }
    const raw = Math.max(0, Math.round(best.count || 0));
    let counted = raw;
    if (raw > HARD_CAP) { counted = HARD_CAP; flags.add('capped'); }
    const hours = q('SELECT hour,count FROM step_hours WHERE user_phone=? AND date=?').all(phone, date);
    if (hours.length) {
      let excess = 0; for (const h of hours) if (h.count > HOUR_CAP) excess += h.count - HOUR_CAP;
      if (excess > 0) { flags.add('rate'); counted = Math.max(0, Math.min(counted, raw - excess)); }
    }
    const synced = best.recorded_at || nowIso();
    q("INSERT INTO steps(user_phone,date,count,source,updated_at,raw,counted,trust,flags,synced_at) VALUES(?,?,?,?,datetime('now'),?,?,?,?,?) ON CONFLICT(user_phone,date) DO UPDATE SET count=excluded.count,source=excluded.source,updated_at=excluded.updated_at,raw=excluded.raw,counted=excluded.counted,trust=excluded.trust,flags=excluded.flags,synced_at=excluded.synced_at")
      .run(phone, date, counted, best.source, raw, counted, best.trust, [...flags].join(','), synced);
    invalidateBoards(phone);
    afterWrite(phone, date, counted);
    return { date, counted, raw, source: best.source, trust: best.trust, flags: [...flags], synced_at: synced };
  }
  const reportCount = (phone, date) => { try { return q('SELECT COUNT(DISTINCT reporter) n FROM step_reports WHERE target=? AND date_key=?').get(phone, date).n; } catch (e) { return 0; } };

  // ───── streak core ─────
  // settle(): pure. Given the state settled through the day before Y and Y's counted steps, returns the state
  // settled through Y. Shared by the close-out job (writes), re-settling late data, and the live view (no writes).
  function settle(st, Y, countedY, goal) {
    let streak = st.streak || 0, longest = st.longest || 0, freezes_left = st.freezes_left == null ? 1 : st.freezes_left;
    let last_goal_date = st.last_goal_date || null, frozen_date = st.frozen_date || null, week_key = st.week_key || null;
    const wk = mondayOf(Y);
    if (!week_key) week_key = wk; // legacy profile without a week marker: no free refill
    else if (week_key !== wk) { freezes_left = Math.max(freezes_left, 1); week_key = wk; }
    const chain = last_goal_date === addDays(Y, -1); // the run reaches the day before Y
    let auto = false;
    if (countedY >= goal) {
      streak = chain ? streak + 1 : 1; last_goal_date = Y;
      if (frozen_date === Y) { freezes_left = Math.min(1, freezes_left + 1); frozen_date = null; } // refund a freeze spent on a day that got done after all
    } else if (frozen_date === Y) {
      last_goal_date = Y; // manual freeze: run kept, streak unchanged
    } else if (chain && streak > 0 && freezes_left > 0) {
      freezes_left -= 1; last_goal_date = Y; auto = true; // auto-freeze
    } else {
      streak = 0;
    }
    longest = Math.max(longest, streak);
    if (frozen_date && frozen_date <= Y) frozen_date = null; // settled
    return { streak, longest, freezes_left, last_goal_date, frozen_date, week_key, auto };
  }
  const profState = p => ({ streak: p.streak || 0, longest: p.longest || 0, freezes_left: p.freezes_left == null ? 1 : p.freezes_left, last_goal_date: p.last_goal_date || null, frozen_date: p.frozen_date || null, week_key: p.week_key || null });
  const goalOf = p => p.goal || 8000;
  const countedOn = (phone, date) => dayRow(phone, date).counted;
  const isClosed = (p, Y) => !!(p.closed_date && p.closed_date >= Y);

  // What the user sees: settled state, an unclosed yesterday simulated, plus today when its goal is met.
  function liveView(phone, p, today) {
    const Y = addDays(today, -1);
    let st = profState(p);
    if (!isClosed(p, Y)) st = settle(st, Y, countedOn(phone, Y), goalOf(p));
    const todayCount = countedOn(phone, today);
    const metToday = todayCount >= goalOf(p);
    const streak = metToday ? (st.last_goal_date === Y ? st.streak + 1 : 1) : st.streak;
    return { streak, longest: Math.max(st.longest, streak), freezes_left: st.freezes_left, metToday, chainAlive: st.last_goal_date === Y, today: todayCount };
  }
  const liveStreakOf = (phone, p, today) => { try { return liveView(phone, p || ensureProfile(phone), today || todayOf(phone)).streak; } catch (e) { return (p && p.streak) || 0; } };

  function writeSettled(phone, st, Y, prevJson) {
    q('UPDATE step_profile SET streak=?,longest=?,freezes_left=?,last_goal_date=?,frozen_date=?,week_key=?,closed_date=?,closed_prev=? WHERE user_phone=?')
      .run(st.streak, st.longest, st.freezes_left, st.last_goal_date || null, st.frozen_date || null, st.week_key, Y, prevJson, phone);
  }
  // Close-out for one user: settle yesterday. Idempotent via closed_date; keeps the pre-close snapshot for re-settling.
  function closeUser(p, now) {
    const phone = p.user_phone, tz = userTz(phone), today = dk(tz, now), Y = addDays(today, -1);
    if (isClosed(p, Y)) return false;
    const prev = profState(p);
    const st = settle(prev, Y, countedOn(phone, Y), goalOf(p));
    writeSettled(phone, st, Y, JSON.stringify(prev));
    return true;
  }
  // Late data for the most recently closed day (Fit backfill after the job, a manual entry for yesterday):
  // roll back to the snapshot taken before that day was settled and settle it again with the new count.
  function resettle(phone, date) {
    const p = ensureProfile(phone);
    if (!p.closed_prev || p.closed_date !== date) return false;
    let prev; try { prev = JSON.parse(p.closed_prev); } catch (e) { return false; }
    const st = settle(prev, date, countedOn(phone, date), goalOf(p));
    if (p.frozen_date && p.frozen_date > date) { st.frozen_date = p.frozen_date; st.freezes_left = Math.max(0, st.freezes_left - 1); } // a freeze spent after the close stays spent
    st.longest = Math.max(st.longest, p.longest || 0);
    writeSettled(phone, st, date, p.closed_prev);
    return true;
  }
  // After any write to a day's row: re-settle a closed yesterday if needed, badges from the live streak.
  function afterWrite(phone, date, counted) {
    try {
      const p = ensureProfile(phone), today = todayOf(phone);
      if (date !== today && p.closed_date === date) resettle(phone, date);
      if (date === today || date === addDays(today, -1)) awardBadges(phone, liveStreakOf(phone, ensureProfile(phone), today), counted);
    } catch (e) { log('afterWrite', e.message); }
  }
  function awardBadges(phone, streak, counted) {
    const earned = [];
    if (counted >= 10000) earned.push('10k-day');
    if (counted >= 20000) earned.push('20k-day');
    if (streak >= 3) earned.push('streak-3');
    if (streak >= 7) earned.push('streak-7');
    if (streak >= 30) earned.push('streak-30');
    for (const b of earned) try { q('INSERT OR IGNORE INTO badges(user_phone,badge,earned_at) VALUES(?,?,?)').run(phone, b, nowIso()); } catch (e) { /* ignore */ }
  }

  // ───── boards ─────
  // rows for a cohort over a period: [{phone,id,name,hue,steps,streak,source,trust}] sorted desc.
  function computeRows(scope, key, period, dateKey, minTrust) {
    let phones;
    if (scope === 'friends') phones = [key, ...friendsOf(key)];
    else if (scope === 'city') phones = q('SELECT user_phone FROM step_profile WHERE city=?').all(key).map(r => r.user_phone);
    else phones = q('SELECT DISTINCT user_phone FROM steps WHERE date>=? AND trust>=?').all(period === 'week' ? mondayOf(dateKey) : dateKey, minTrust).map(r => r.user_phone);
    const from = period === 'week' ? mondayOf(dateKey) : dateKey;
    const rows = [];
    for (const phone of phones) {
      const days = q('SELECT counted,count,source,trust,flags FROM steps WHERE user_phone=? AND date>=? AND date<=?').all(phone, from, dateKey);
      let steps = 0, source = null, trust = 0, hidden = false;
      for (const d of days) {
        const fl = flagsOf(d.flags);
        if (fl.includes('hidden')) { hidden = true; continue; }
        if ((d.trust || 0) < minTrust) continue;
        steps += d.counted != null ? d.counted : d.count || 0;
        if ((d.trust || 0) >= trust) { trust = d.trust || 0; source = d.source; }
      }
      if (hidden && phone !== key) continue;
      if (scope !== 'friends' && steps <= 0) continue;
      const u = getUser(phone) || {};
      const p = ensureProfile(phone);
      rows.push({ phone, id: idOf(phone), name: displayName(u.name), hue: p.avatar_hue, steps, streak: liveStreakOf(phone, p, todayOf(phone, u)), source, trust });
    }
    rows.sort((a, b) => b.steps - a.steps || (a.name < b.name ? -1 : 1));
    return rows;
  }
  function boardRows(scope, key, period, dateKey) {
    const ck = `${scope}|${key}`;
    const minTrust = scope === 'friends' ? 1 : 2;
    let c = boardCache.get(ck);
    if (c && c.period === period && c.dateKey === dateKey && Date.now() - c.at < BOARD_TTL) return c.rows;
    const rows = computeRows(scope, key, period, dateKey, minTrust);
    boardCache.set(ck, { at: Date.now(), period, dateKey, rows });
    return rows;
  }
  function friendsRank(phone, dateKey) {
    const n = friendsOf(phone).length;
    if (!n) return null;
    const rows = boardRows('friends', phone, 'today', dateKey);
    const i = rows.findIndex(r => r.phone === phone);
    return { rank: i < 0 ? rows.length : i + 1, of: rows.length };
  }
  const publicRow = (r, me) => ({ id: r.id, name: r.name, hue: r.hue, steps: r.steps, streak: r.streak, source: r.source, trust: r.trust, isMe: r.phone === me });

  // ───── summary / state ─────
  function deviceOf(phone) { return q('SELECT * FROM step_devices WHERE user_phone=? AND revoked_at IS NULL ORDER BY claimed_at DESC LIMIT 1').get(phone) || null; }
  function stateFor(phone, ctx) {
    ctx = ctx || {};
    const dev = deviceOf(phone);
    const H36 = 36 * 3600 * 1000;
    if (dev && dev.last_sync_at && Date.now() - Date.parse(dev.last_sync_at) < H36) return 'bg';
    if (ctx.twa) return 'enable';
    const ua = String(ctx.ua || '');
    if (/iPhone|iPad|iPod/i.test(ua)) {
      const s = q("SELECT recorded_at FROM step_samples WHERE user_phone=? AND source='shortcut' ORDER BY recorded_at DESC LIMIT 1").get(phone);
      if (s && Date.now() - Date.parse(s.recorded_at) < H36) return 'bg';
      return 'ios';
    }
    if (/Android/i.test(ua)) return 'play';
    return 'web';
  }
  function summary(phone, ctx) {
    const user = getUser(phone) || { phone };
    const p = ensureProfile(phone);
    const tz = userTz(phone, user);
    const today = dk(tz);
    const week = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); const r = dayRow(phone, d); week.push({ date: d, counted: r.counted, goalMet: r.counted >= p.goal }); }
    const t = dayRow(phone, today), v = liveView(phone, p, today);
    return {
      today: { date: today, counted: t.counted, raw: t.raw, source: t.source, trust: t.trust, synced_at: t.synced_at, flags: t.flags },
      goal: p.goal, streak: v.streak, longest: v.longest, freezes_left: v.freezes_left,
      week, state: stateFor(phone, ctx), friendsRank: friendsRank(phone, today),
      invite: { code: p.invite_code, url: inviteUrl(p.invite_code) }, city: p.city || null,
      tz, prefs: prefsOf(phone),
    };
  }
  const ctxOf = req => ({ ua: req.headers['user-agent'] || '', twa: String((req.query || {}).twa || '') === '1' });

  // ───── push ─────
  function sendPush(phone, kind, title, body, dateKey) {
    try {
      const ins = q('INSERT OR IGNORE INTO push_log(user_phone,date_key,kind,ts) VALUES(?,?,?,?)').run(phone, dateKey, kind, nowIso());
      if (!ins.changes) return false; // already pushed today — max 1/day/user
      const payload = JSON.stringify({ type: 'steps', kind, title, body, tag: 'steps-' + kind, url: '/?tab=move' });
      const pushFn = typeof deps.pushAll === 'function' ? deps.pushAll : typeof deps.pushTo === 'function' ? deps.pushTo : null;
      if (pushFn) { pushFn(phone, payload); return true; }
      const wp = deps.webpush;
      if (!wp || typeof wp.sendNotification !== 'function') return false;
      const subs = q('SELECT endpoint,keys_p256dh,keys_auth FROM push_subs WHERE user_phone=?').all(phone);
      for (const sub of subs) {
        Promise.resolve().then(() => wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } }, payload)).catch(err => {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) { try { q('DELETE FROM push_subs WHERE endpoint=?').run(sub.endpoint); } catch (e) { /* ignore */ } }
        });
      }
      return subs.length > 0;
    } catch (e) { log('push', e.message); return false; }
  }

  // ───── rate limits (in-memory) ─────
  const regHits = new Map();   // ip → [ts]
  const flushAt = new Map();   // phone → ts
  const REG_PER_IP = 10, REG_GLOBAL_PER_HOUR = 600, REG_MAX_IPS = 5000;
  let regGlobal = [], regPrunedAt = 0;
  // req.ip honours `app.set('trust proxy', …)` when the integrator sets it; X-Forwarded-For is never read directly
  // (any client can forge it). Behind a reverse proxy the integrator must set trust proxy or every client shares one IP.
  const clientIp = req => String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || '').trim() || 'unknown';
  function ipLimited(ip) {
    const now = Date.now(), H = 3600e3;
    if (now - regPrunedAt > 60e3) { regPrunedAt = now; for (const [k, arr] of regHits) { const kept = arr.filter(t => now - t < H); if (kept.length) regHits.set(k, kept); else regHits.delete(k); } }
    regGlobal = regGlobal.filter(t => now - t < H);
    if (regGlobal.length >= REG_GLOBAL_PER_HOUR) return true;
    const arr = (regHits.get(ip) || []).filter(t => now - t < H);
    if (arr.length >= REG_PER_IP) { regHits.set(ip, arr); return true; }
    if (!regHits.has(ip) && regHits.size >= REG_MAX_IPS) regHits.delete(regHits.keys().next().value);
    arr.push(now); regHits.set(ip, arr); regGlobal.push(now); return false;
  }
  // A client-reported Google Fit number is checked against Google in the background (debounced per user).
  const fitVerifyAt = new Map();
  function verifyFit(phone) {
    if (typeof deps.fitSync !== 'function') return;
    if (Date.now() - (fitVerifyAt.get(phone) || 0) < 10 * 60e3) return;
    fitVerifyAt.set(phone, Date.now());
    Promise.resolve().then(() => deps.fitSync(phone, 2)).catch(() => {});
  }

  // ───── express helpers ─────
  const jsonBody = express.json({ limit: '256kb' });
  const json = (req, res, next) => { if (req.body && typeof req.body === 'object') return next(); jsonBody(req, res, err => err ? res.status(400).json({ error: 'Bad JSON' }) : next()); };
  const bad = (res, code, msg) => res.status(code).json({ error: msg });
  const body = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r && typeof r.catch === 'function') r.catch(e => { log('route', e.message); if (!res.headersSent) bad(res, 500, 'Something went wrong'); }); } catch (e) { log('route', e.message); if (!res.headersSent) bad(res, 500, 'Something went wrong'); } };

  // ═════════════════════════ ROUTES ═════════════════════════
  app.get('/api/steps/summary', auth, wrap((req, res) => res.json(summary(req.user.phone, ctxOf(req)))));

  // Manual / Google Fit absolute counts, or Walk-mode deltas.
  app.post('/api/steps', auth, json, wrap((req, res) => {
    const b = body(req), phone = req.user.phone, tz = userTz(phone, req.user), today = dk(tz);
    const source = str(b.source, 20) || 'manual';
    let date = isKey(b.date) ? b.date : today;
    if (source === 'device') {
      const add = int(b.add, 0, WALK_CAP, -1);
      if (add < 0) return bad(res, 400, 'add must be a number');
      if (date !== today && date !== addDays(today, -1)) return bad(res, 400, 'Walk mode only counts today or yesterday');
      const last = flushAt.get(phone) || 0;
      if (Date.now() - last < FLUSH_MS) return res.status(429).json({ error: 'Too many flushes', retry_in: Math.ceil((FLUSH_MS - (Date.now() - last)) / 1000) });
      flushAt.set(phone, Date.now());
      const cur = q("SELECT count FROM step_samples WHERE user_phone=? AND date=? AND source='device'").get(phone, date);
      const next = Math.min(WALK_CAP, (cur ? cur.count : 0) + add);
      putSample(phone, date, 'device', next, null, tz);
      recompute(phone, date);
      const s = summary(phone, ctxOf(req)); s.walkTotal = next; s.walkCapped = next >= WALK_CAP;
      return res.json(s);
    }
    if (source !== 'manual' && source !== 'googlefit') return bad(res, 400, 'source must be manual, googlefit or device');
    const count = int(b.count, 0, 1e7, -1);
    if (count < 0) return bad(res, 400, 'count must be a number');
    if (source === 'manual') {
      if (date !== today && date !== addDays(today, -1)) return bad(res, 400, 'Manual entries are only for today or yesterday');
      if (count > MANUAL_CAP) return bad(res, 400, `Manual entries are capped at ${fmtN(MANUAL_CAP)} steps — connect a device for more`);
    } else {
      if (!hasGoogle(phone)) return bad(res, 403, 'Connect Google Fit first'); // trust 2 needs a linked Google account
      if (date > addDays(today, 1) || date < addDays(today, -60)) return bad(res, 400, 'date out of range');
    }
    putSample(phone, date, source, count, null, tz);
    recompute(phone, date);
    if (source === 'googlefit') verifyFit(phone);
    res.json(summary(phone, ctxOf(req)));
  }));

  // ───── devices (Android / Health Connect companion) ─────
  app.post('/api/steps/device/register', json, wrap((req, res) => {
    if (ipLimited(clientIp(req))) return bad(res, 429, 'Too many registrations');
    const b = body(req);
    const device_id = str(b.device_id, 64), secret = String(b.secret || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(device_id)) return bad(res, 400, 'device_id must be 8–64 chars [A-Za-z0-9_-]');
    if (secret.length < 16 || secret.length > 256) return bad(res, 400, 'secret must be 16–256 chars');
    const secret_hash = sha256(secret + PEPPER);
    const ex = q('SELECT secret_hash FROM step_devices WHERE device_id=?').get(device_id);
    if (ex && !safeEqual(ex.secret_hash, secret_hash)) return bad(res, 409, 'device_id already registered');
    const claim = crypto.randomBytes(16).toString('base64url');
    q('INSERT INTO step_devices(device_id,secret_hash,claim_hash,platform,provider,model,os,app_ver,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET claim_hash=excluded.claim_hash,platform=excluded.platform,provider=excluded.provider,model=excluded.model,os=excluded.os,app_ver=excluded.app_ver')
      .run(device_id, secret_hash, sha256(claim + PEPPER), str(b.platform, 20) || 'android', str(b.provider, 30) || 'healthconnect', str(b.model, 60), str(b.os, 30), str(b.app_ver, 20), nowIso());
    res.json({ ok: true, claim_token: claim, device_id });
  }));

  app.post('/api/steps/device/claim', auth, json, wrap((req, res) => {
    const b = body(req), phone = req.user.phone;
    const device_id = str(b.device_id, 64), ct = String(b.ct || b.claim_token || '');
    const dev = q('SELECT * FROM step_devices WHERE device_id=?').get(device_id);
    if (!dev || !ct || !dev.claim_hash || !safeEqual(dev.claim_hash, sha256(ct + PEPPER))) return bad(res, 403, 'Invalid claim token');
    if (dev.user_phone === phone && !dev.revoked_at) { q('UPDATE step_devices SET claim_hash=NULL WHERE device_id=?').run(device_id); return res.json({ ok: true, already: true }); }
    const mine = deviceOf(phone);
    if (mine && mine.device_id !== device_id) {
      const since = Date.parse(mine.claimed_at || mine.created_at || 0) || 0;
      const left = SWAP_DAYS - Math.floor((Date.now() - since) / 864e5);
      if (left > 0) return res.status(403).json({ error: `You can switch devices in ${left} day${left === 1 ? '' : 's'}`, cooldown_days: left });
      q('UPDATE step_devices SET revoked_at=? WHERE device_id=?').run(nowIso(), mine.device_id);
    }
    // binding to me revokes whoever held it before (it is physically the same phone)
    q('UPDATE step_devices SET user_phone=?,claim_hash=NULL,claimed_at=?,revoked_at=NULL WHERE device_id=?').run(phone, nowIso(), device_id);
    ensureProfile(phone);
    res.json({ ok: true });
  }));

  function deviceAuth(req, res, next) {
    const h = String(req.headers.authorization || '');
    const m = h.match(/^Device\s+([A-Za-z0-9_-]{8,64}):(.+)$/);
    if (!m) return bad(res, 401, 'Device auth required');
    const dev = q('SELECT * FROM step_devices WHERE device_id=?').get(m[1]);
    if (!dev || !safeEqual(dev.secret_hash, sha256(m[2] + PEPPER))) return bad(res, 401, 'Bad device credentials');
    if (dev.revoked_at) return bad(res, 403, 'Device revoked');
    req.device = dev; next();
  }
  app.post('/api/steps/bulk', deviceAuth, json, wrap((req, res) => {
    const dev = req.device;
    if (!dev.user_phone) return res.status(409).json({ error: 'unbound' });
    const phone = dev.user_phone, b = body(req);
    const source = b.source === 'android' ? 'android' : b.source === 'healthconnect' ? 'healthconnect' : null;
    if (!source) return bad(res, 400, 'source must be android or healthconnect');
    const tz = safeTz(b.tz) || userTz(phone);
    if (safeTz(b.tz)) { try { const u = getUser(phone); if (u && !safeTz(u.tz)) q('UPDATE users SET tz=? WHERE phone=?').run(tz, phone); } catch (e) { /* ignore */ } }
    const today = dk(tz);
    if (!Array.isArray(b.days) || !b.days.length) return bad(res, 400, 'days[] required');
    if (b.days.length > 14) return bad(res, 400, 'max 14 days per sync');
    const done = [];
    const tx = db.transaction(days => {
      days = days.filter(d => d && isKey(d.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // oldest first: yesterday settles before today is credited
      for (const d of days) {
        if (!d || !isKey(d.date)) continue;
        if (d.date > addDays(today, 1) || d.date < addDays(today, -30)) continue;
        const count = int(d.count, 0, 1e7, -1); if (count < 0) continue;
        putSample(phone, d.date, source, count, dev.device_id, tz);
        setHours(phone, d.date, d.hours, count);
        done.push(recompute(phone, d.date));
      }
    });
    tx(b.days);
    q('UPDATE step_devices SET last_sync_at=? WHERE device_id=?').run(nowIso(), dev.device_id);
    const p = ensureProfile(phone);
    res.json({ ok: true, goal: p.goal, today: dayRow(phone, today), streak: liveStreakOf(phone, p, today), friendsRank: friendsRank(phone, today), prefs: prefsOf(phone), days: done });
  }));

  // ───── iOS Shortcut ─────
  app.post('/api/steps/shortcut/token', auth, wrap((req, res) => {
    const token = 'bs_' + crypto.randomBytes(24).toString('base64url');
    ensureProfile(req.user.phone);
    q('UPDATE step_profile SET shortcut_token_hash=? WHERE user_phone=?').run(sha256(token + PEPPER), req.user.phone);
    res.json({ token, url: `${PUBLIC_URL}/api/steps/shortcut` });
  }));
  app.post('/api/steps/shortcut', json, wrap((req, res) => {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    const tok = m ? m[1] : String(body(req).token || '');
    if (!tok) return bad(res, 401, 'Shortcut token required');
    const p = q('SELECT user_phone FROM step_profile WHERE shortcut_token_hash=?').get(sha256(tok + PEPPER));
    if (!p) return bad(res, 401, 'Invalid shortcut token');
    const phone = p.user_phone, b = body(req), tz = userTz(phone), today = dk(tz);
    const count = int(b.count, 0, 1e7, -1);
    if (count < 0) return bad(res, 400, 'count must be a number');
    const date = isKey(b.date) ? b.date : today;
    if (date > addDays(today, 1) || date < addDays(today, -14)) return bad(res, 400, 'date out of range');
    putSample(phone, date, 'shortcut', count, null, tz);
    const row = recompute(phone, date);
    res.json({ ok: true, today: dayRow(phone, today), day: row });
  }));

  // ───── leaderboard ─────
  app.get('/api/steps/leaderboard', auth, wrap((req, res) => {
    const phone = req.user.phone;
    const scope = ['friends', 'city', 'india'].includes(req.query.scope) ? req.query.scope : 'friends';
    const period = req.query.period === 'week' ? 'week' : 'today';
    const p = ensureProfile(phone);
    const dateKey = todayOf(phone, req.user);
    const key = scope === 'friends' ? phone : scope === 'city' ? (p.city || '') : 'in';
    const out = { scope, period, me: { rank: null, steps: 0, pct: null, delta: null, streak: liveStreakOf(phone, p, dateKey) }, top: [], around: [], cohort: 0, provisional: period === 'today' };
    if (scope === 'city' && !key) { out.hidden = true; out.noCity = true; return res.json(out); }
    const rows = boardRows(scope, key, period, dateKey);
    const i = rows.findIndex(r => r.phone === phone);
    out.cohort = rows.length;
    if (i >= 0) {
      const rank = i + 1, n = rows.length;
      out.me = { rank, steps: rows[i].steps, pct: n > 1 ? Math.round(100 * (n - rank) / (n - 1)) : 100, delta: rank > 1 ? rows[i - 1].steps - rows[i].steps : 0, streak: rows[i].streak };
    } else {
      const from = period === 'week' ? mondayOf(dateKey) : dateKey;
      out.me.steps = (q('SELECT SUM(COALESCE(counted,count)) s FROM steps WHERE user_phone=? AND date>=? AND date<=?').get(phone, from, dateKey) || {}).s || 0;
    }
    if (scope !== 'friends' && rows.length < BOARD_MIN) { out.hidden = true; return res.json(out); }
    out.top = rows.slice(0, 3).map(r => publicRow(r, phone));
    if (i >= 0) { const lo = Math.max(3, i - 2), hi = Math.min(rows.length, Math.max(i + 3, lo + 5)); out.around = rows.slice(lo, hi).map(r => publicRow(r, phone)); }
    else out.around = rows.slice(3, 8).map(r => publicRow(r, phone));
    res.json(out);
  }));

  // ───── goal / prefs / city / freeze / report / share ─────
  app.put('/api/steps/goal', auth, json, wrap((req, res) => {
    const goal = int(body(req).goal, 0, 1e9, -1);
    if (goal < 500 || goal > 100000) return bad(res, 400, 'goal must be between 500 and 100,000');
    ensureProfile(req.user.phone);
    q('UPDATE step_profile SET goal=? WHERE user_phone=?').run(goal, req.user.phone);
    invalidateBoards(req.user.phone);
    res.json({ ok: true, goal });
  }));
  app.put('/api/steps/prefs', auth, json, wrap((req, res) => {
    const b = body(req), cur = prefsOf(req.user.phone);
    const pick = (k, d) => (k in b ? !!b[k] : d);
    const p = { evening: pick('evening', cur.evening), weekly: pick('weekly', cur.weekly), social: pick('social', cur.social), hour: int(b.hour, 0, 23, cur.hour), minute: int(b.minute, 0, 59, cur.minute) };
    q('INSERT INTO push_prefs(user_phone,evening,weekly,social,hour,minute) VALUES(?,?,?,?,?,?) ON CONFLICT(user_phone) DO UPDATE SET evening=excluded.evening,weekly=excluded.weekly,social=excluded.social,hour=excluded.hour,minute=excluded.minute')
      .run(req.user.phone, p.evening ? 1 : 0, p.weekly ? 1 : 0, p.social ? 1 : 0, p.hour, p.minute);
    res.json({ ok: true, prefs: p });
  }));
  app.put('/api/steps/city', auth, json, wrap((req, res) => {
    let city = str(body(req).city, 40).replace(/[^\p{L}\p{N} .'-]/gu, '');
    city = city ? city.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ') : null;
    const old = ensureProfile(req.user.phone).city;
    q('UPDATE step_profile SET city=? WHERE user_phone=?').run(city, req.user.phone);
    if (old) boardCache.delete('city|' + old); if (city) boardCache.delete('city|' + city);
    res.json({ ok: true, city });
  }));
  app.post('/api/steps/freeze', auth, wrap((req, res) => {
    const phone = req.user.phone, today = todayOf(phone, req.user);
    let p = ensureProfile(phone);
    if (closeUser(p, new Date())) p = ensureProfile(phone); // settle an unclosed yesterday first so the freeze is spent on the right day
    const streak = liveStreakOf(phone, p, today);
    if (p.frozen_date === today) return res.json({ ok: true, already: true, freezes_left: p.freezes_left, streak, frozen_date: today });
    if ((p.freezes_left || 0) <= 0) return res.status(403).json({ error: 'No freezes left this week', freezes_left: 0 });
    if (dayRow(phone, today).counted >= p.goal) return bad(res, 400, 'Goal already met today — no freeze needed');
    if (!(p.streak > 0)) return bad(res, 400, 'No streak to protect yet — hit your goal first');
    q('UPDATE step_profile SET freezes_left=freezes_left-1,frozen_date=? WHERE user_phone=?').run(today, phone);
    res.json({ ok: true, freezes_left: p.freezes_left - 1, streak, frozen_date: today });
  }));
  app.post('/api/steps/report', auth, json, wrap((req, res) => {
    const b = body(req), id = str(b.id, 20), reason = str(b.reason, 200) || 'suspicious';
    const target = id && phoneOfId(id);
    if (!target) return bad(res, 404, 'Unknown user');
    if (target === req.user.phone) return bad(res, 400, "You can't report yourself");
    const dateKey = isKey(b.date) ? b.date : todayOf(req.user.phone, req.user);
    if (!q('SELECT 1 FROM step_reports WHERE reporter=? AND target=? AND date_key=?').get(req.user.phone, target, dateKey))
      q('INSERT INTO step_reports(reporter,target,date_key,reason,created_at) VALUES(?,?,?,?,?)').run(req.user.phone, target, dateKey, reason, nowIso());
    const n = q('SELECT COUNT(DISTINCT reporter) n FROM step_reports WHERE target=? AND date_key=?').get(target, dateKey).n;
    const hidden = n >= REPORTS_TO_HIDE; // applied to the row now, or by recompute() when the row is written later
    if (hidden) {
      const row = q('SELECT flags FROM steps WHERE user_phone=? AND date=?').get(target, dateKey);
      if (row) { const fl = new Set(flagsOf(row.flags)); fl.add('hidden'); q('UPDATE steps SET flags=? WHERE user_phone=? AND date=?').run([...fl].join(','), target, dateKey); }
      invalidateBoards(target);
    }
    res.json({ ok: true, reports: n, hidden });
  }));
  app.post('/api/share', auth, json, wrap((req, res) => {
    const kind = str(body(req).kind, 30) || 'steps';
    q('INSERT INTO share_events(user_phone,kind,ts) VALUES(?,?,?)').run(req.user.phone, kind, nowIso());
    try { q('INSERT OR IGNORE INTO badges(user_phone,badge,earned_at) VALUES(?,?,?)').run(req.user.phone, 'first-share', nowIso()); } catch (e) { /* ignore */ }
    res.json({ ok: true });
  }));

  // ───── friends & invites ─────
  app.get('/api/me/invite', auth, wrap((req, res) => { const p = ensureProfile(req.user.phone); res.json({ code: p.invite_code, url: inviteUrl(p.invite_code) }); }));
  app.get('/api/friends', auth, wrap((req, res) => {
    const phone = req.user.phone, today = todayOf(phone, req.user);
    const friends = friendsOf(phone).map(f => {
      const u = getUser(f) || {}, p = ensureProfile(f), r = dayRow(f, today);
      return { id: idOf(f), name: displayName(u.name), hue: p.avatar_hue, today: r.trust >= 1 && !r.flags.includes('hidden') ? r.counted : 0, streak: liveStreakOf(f, p, todayOf(f, u)) };
    }).sort((a, b) => b.today - a.today);
    const pending = q("SELECT friend_phone FROM friends WHERE user_phone=? AND status='pending'").all(phone).map(r => ({ id: idOf(r.friend_phone), name: displayName((getUser(r.friend_phone) || {}).name) }));
    res.json({ friends, pending });
  }));
  app.post('/api/friends/code', auth, json, wrap((req, res) => {
    const code = str(body(req).code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return bad(res, 400, 'Enter an invite code');
    const inv = q('SELECT user_phone FROM step_profile WHERE invite_code=?').get(code);
    if (!inv) return bad(res, 404, 'That invite code does not exist');
    const me = req.user.phone, them = inv.user_phone;
    if (them === me) return bad(res, 400, "That's your own code");
    const u = getUser(them) || {}, p = ensureProfile(them);
    const already = !!q('SELECT 1 FROM friends WHERE user_phone=? AND friend_phone=?').get(me, them);
    const ts = nowIso();
    const ins = q("INSERT INTO friends(user_phone,friend_phone,status,created_at) VALUES(?,?,'accepted',?) ON CONFLICT(user_phone,friend_phone) DO UPDATE SET status='accepted'");
    db.transaction(() => {
      ins.run(me, them, ts); ins.run(them, me, ts);
      if (!already) q('INSERT OR IGNORE INTO referrals(code,inviter,invitee,joined_at) VALUES(?,?,?,?)').run(code, them, me, ts);
    })();
    ensureProfile(me);
    boardCache.delete('friends|' + me); boardCache.delete('friends|' + them);
    if (!already && prefsOf(them).social) {
      const myName = displayName((getUser(me) || {}).name);
      sendPush(them, 'friend', `${myName} joined your walk crew`, 'Open Move to see who is ahead today.', todayOf(them));
    }
    res.json({ ok: true, already, friend: { id: idOf(them), name: displayName(u.name), hue: p.avatar_hue, streak: liveStreakOf(them, p, todayOf(them, u)) } });
  }));
  app.delete('/api/friends/:id', auth, wrap((req, res) => {
    const me = req.user.phone, id = str(req.params.id, 20);
    const them = friendsOf(me).find(f => pubId(f) === id) || (q("SELECT friend_phone FROM friends WHERE user_phone=?").all(me).map(r => r.friend_phone).find(f => pubId(f) === id));
    if (!them) return bad(res, 404, 'Not in your friends');
    db.transaction(() => { q('DELETE FROM friends WHERE user_phone=? AND friend_phone=?').run(me, them); q('DELETE FROM friends WHERE user_phone=? AND friend_phone=?').run(them, me); })();
    boardCache.delete('friends|' + me); boardCache.delete('friends|' + them);
    res.json({ ok: true });
  }));

  // ───── /join/:code landing + OG image ─────
  const codeParam = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  function inviterByCode(code) {
    const p = code && q('SELECT * FROM step_profile WHERE invite_code=?').get(code);
    if (!p) return null;
    const u = getUser(p.user_phone) || {};
    const tk = todayOf(p.user_phone, u), today = dayRow(p.user_phone, tk);
    return { name: displayName(u.name), hue: p.avatar_hue, streak: liveStreakOf(p.user_phone, p, tk), goal: p.goal, today: today.counted, code };
  }
  const intentUrl = code => { const host = PUBLIC_URL.replace(/^https?:\/\//, ''); return `intent://${host}/?join=${code}#Intent;scheme=https;package=com.brodoit.twa;S.browser_fallback_url=${encodeURIComponent(PUBLIC_URL + '/?join=' + code)};end`; };
  function joinHtml(code, inv) {
    const title = inv ? `${inv.name} invited you to walk on Brodoit` : 'Walk with me on Brodoit';
    const desc = inv ? `${inv.name} ${inv.streak > 0 ? `is on a ${inv.streak}-day streak` : 'counts steps on Brodoit'}. Join the crew, count your steps, and climb the board together.` : 'Count your steps with friends and climb the board together.';
    const og = `${PUBLIC_URL}/og/steps/${code}.png`, open = `/?join=${code}`;
    const ring = inv ? Math.max(0, Math.min(1, inv.today / Math.max(1, inv.goal))) : 0.62;
    const C = 2 * Math.PI * 54, dash = (C * ring).toFixed(1);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Brodoit"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(PUBLIC_URL + '/join/' + code)}"><meta property="og:image" content="${esc(og)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(og)}">
<meta name="theme-color" content="#17141F"><link rel="icon" href="/icon-192.png"><link rel="stylesheet" href="/app/fonts/fonts.css">
<style>
:root{--ink:#17141F;--ink2:#C9C5D2;--mute:#8B8798;--move:#00C2A8;--card:#1C2029;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box}html,body{margin:0;background:var(--ink);color:#F3F1EE;font:500 15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px calc(32px + env(safe-area-inset-bottom));text-align:center;max-width:460px;margin:0 auto}
.eyebrow{font:800 11px var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--move)}
h1{font:800 28px/1.1 var(--sans);letter-spacing:-.03em;margin:12px 0 8px}
p{color:var(--ink2);margin:0 0 20px}
.ring{position:relative;width:148px;height:148px;margin:8px auto 20px}.ring svg{transform:rotate(-90deg)}.ring .n{position:absolute;inset:0;display:grid;place-items:center;font:800 26px/1 var(--sans);letter-spacing:-.02em}.ring .n small{display:block;font:600 11px var(--sans);color:var(--mute);margin-top:6px;letter-spacing:.08em;text-transform:uppercase}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:14px 24px;border-radius:16px;background:var(--move);color:#0F1115;font:800 16px var(--sans);text-decoration:none;box-shadow:0 4px 0 0 #009E89;width:100%;max-width:320px}
.btn:active{transform:translateY(2px);box-shadow:none}
.play{display:inline-flex;align-items:center;gap:10px;margin-top:14px;padding:10px 16px;border-radius:12px;background:var(--card);color:#F3F1EE;font:700 13px var(--sans);text-decoration:none;min-height:44px}
.play svg{width:20px;height:20px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;background:rgba(0,194,168,.14);color:var(--move);font:700 13px var(--sans);margin-top:6px}
.code{font:700 13px var(--sans);color:var(--mute);margin-top:22px;letter-spacing:.2em}
.av{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font:800 22px var(--sans);color:#fff;background:hsl(${inv ? inv.hue : 170} 70% 50%);margin:0 auto 6px}
@media (prefers-reduced-motion:no-preference){.ring circle.p{transition:stroke-dasharray .48s cubic-bezier(.2,.8,.2,1)}}
</style></head><body><div class="wrap">
${inv ? `<div class="av">${esc(initialOf(inv.name) || '•')}</div>` : ''}
<div class="eyebrow">Brodoit · Move</div>
<h1>${esc(title)}</h1>
<p>${esc(desc)}</p>
<div class="ring"><svg width="148" height="148" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10"/><circle class="p" cx="60" cy="60" r="54" fill="none" stroke="#00C2A8" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash} ${C.toFixed(1)}"/></svg><div class="n">${inv ? fmtN(inv.today) : '8,000'}<small>steps today</small></div></div>
${inv && inv.streak ? `<div class="chip">🔥 ${inv.streak}-day streak</div><br>` : ''}
<a class="btn" id="open" href="${esc(open)}">Open Brodoit</a>
<a class="play" href="${esc(PLAY_URL)}" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9-14 9z"/></svg>Get it on Google Play</a>
<div class="code">CODE ${esc(code || '')}</div>
</div>
<script>
(function(){try{localStorage.setItem('join_code',${JSON.stringify(code || '')})}catch(e){}
var ua=navigator.userAgent||'';var a=document.getElementById('open');
if(/Android/i.test(ua)&&!/wv\\)/.test(ua)){a.addEventListener('click',function(ev){ev.preventDefault();var t=Date.now();location.href=${JSON.stringify(intentUrl(code || ''))};setTimeout(function(){if(Date.now()-t<1600)location.href=${JSON.stringify(open)}},1200)})}})();
</script></body></html>`;
  }
  app.get('/join/:code', (req, res) => {
    try {
      const code = codeParam(req.params.code);
      const inv = inviterByCode(code);
      res.status(inv ? 200 : 404).set('Cache-Control', 'public, max-age=120').type('html').send(joinHtml(code, inv));
    } catch (e) { log('join', e.message); res.status(500).type('html').send('<!doctype html><title>Brodoit</title><p>Something went wrong.'); }
  });

  // OG image: SVG → PNG via @resvg/resvg-js; static app/og-steps.png when the renderer is missing.
  let resvg = null; try { resvg = require('@resvg/resvg-js'); } catch (e) { log('resvg unavailable, using static OG image'); }
  // resvg loads sfnt fonts (ttf/otf) only — the app's woff2 files are for browsers. System fonts cover Latin
  // (DejaVu Sans) and Devanagari (FreeSans); drop a .ttf next to the woff2 files to brand the text.
  const FONT_FILES = ['PlusJakartaSans-latin.ttf', 'PlusJakartaSans.ttf', 'NotoSansDevanagari.ttf'].map(f => path.join(APP_DIR, 'fonts', f)).filter(f => fs.existsSync(f));
  const OG_MAX = 64, OG_INFLIGHT_MAX = 3, OG_IP_PER_MIN = 20;
  const ogCache = new Map();    // key → {ck,at,png}; insertion-ordered, bounded to OG_MAX, TTL OG_TTL
  const ogInflight = new Map(); // key → Promise<Buffer|null> (concurrent requests for one code share a render)
  const ogHits = new Map();     // ip → [ts] of uncached renders
  function ogRemember(key, ck, png) {
    ogCache.delete(key); ogCache.set(key, { ck, at: Date.now(), png });
    const now = Date.now();
    for (const [k, v] of ogCache) { if (ogCache.size <= OG_MAX && now - v.at < OG_TTL) break; ogCache.delete(k); }
  }
  function ogIpLimited(ip) {
    const now = Date.now(); if (ogHits.size > 2000) ogHits.clear();
    const arr = (ogHits.get(ip) || []).filter(t => now - t < 60e3);
    if (arr.length >= OG_IP_PER_MIN) { ogHits.set(ip, arr); return true; }
    arr.push(now); ogHits.set(ip, arr); return false;
  }
  const ogFamily = t => hasDevanagari(t) ? 'FreeSans, DejaVu Sans, sans-serif' : 'Plus Jakarta Sans, DejaVu Sans, FreeSans, sans-serif';
  function ogSvg(inv) {
    const name = inv ? inv.name : 'Walk with me', streak = inv ? inv.streak : 0, today = inv ? inv.today : 0, goal = inv ? inv.goal : 8000;
    const pct = Math.max(0, Math.min(1, today / Math.max(1, goal)));
    const R = 190, C = 2 * Math.PI * R;
    const hue = inv ? inv.hue : 170;
    const sub = inv ? `${fmtN(today)} of ${fmtN(goal)} steps today` : 'Count steps with friends';
    const glyph = inv ? initialOf(name) : ''; // a letter DejaVu/FreeSans can draw; names without one get footprints
    // Text that must not run into the ring: squash it (textLength) once the estimated width exceeds maxW.
    const fit = (t, x, y, size, fill, maxW, weight) => {
      const est = t.length * size * 0.62;
      const tl = est > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
      return `<text x="${x}" y="${y}" font-family="${ogFamily(t)}" font-size="${size}" font-weight="${weight || 800}" fill="${fill}" letter-spacing="-1"${tl}>${esc(t)}</text>`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17141F"/><stop offset="1" stop-color="#0F1115"/></linearGradient><radialGradient id="glow" cx="0.78" cy="0.5" r="0.45"><stop offset="0" stop-color="#00C2A8" stop-opacity="0.28"/><stop offset="1" stop-color="#00C2A8" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#glow)"/>
<g font-family="Plus Jakarta Sans, DejaVu Sans, FreeSans, sans-serif">
<text x="84" y="128" font-size="22" font-weight="800" fill="#00C2A8" letter-spacing="4">BRODOIT · MOVE</text>
${fit(inv ? `${name} invited you` : 'Walk with me', 84, 226, 72, '#F3F1EE', 620)}
<text x="84" y="296" font-size="48" font-weight="800" fill="#C9C5D2" letter-spacing="-1">${esc(inv ? 'to walk with them.' : 'on Brodoit')}</text>
${fit(sub, 84, 372, 28, '#8B8798', 600, 600)}
${streak ? `<rect x="84" y="420" rx="26" ry="26" width="${Math.round(48 + (String(streak).length + 11) * 15.5)}" height="52" fill="rgba(0,194,168,0.16)"/><text x="108" y="455" font-size="26" font-weight="800" fill="#00C2A8">${streak}-day streak</text>` : ''}
<text x="84" y="560" font-size="24" font-weight="700" fill="#8B8798">${esc(PUBLIC_URL.replace(/^https?:\/\//, ''))}${inv ? '/join/' + esc(inv.code) : ''}</text>
<g transform="translate(930 315)">
<circle r="${R}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="30"/>
<circle r="${R}" fill="none" stroke="#00C2A8" stroke-width="30" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0.02, pct)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)"/>
<circle r="120" fill="hsl(${hue},70%,50%)" opacity="0.95"/>
${glyph ? `<text x="0" y="22" text-anchor="middle" font-family="${ogFamily(glyph)}" font-size="96" font-weight="800" fill="#fff">${esc(glyph)}</text>` : '<g fill="#fff" opacity="0.95"><ellipse cx="-30" cy="-6" rx="22" ry="36"/><ellipse cx="-30" cy="50" rx="17" ry="15"/><ellipse cx="30" cy="-40" rx="22" ry="36"/><ellipse cx="30" cy="16" rx="17" ry="15"/></g>'}
</g></g></svg>`;
  }
  const ogOpts = () => ({ fitTo: { mode: 'width', value: 1200 }, font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
  function renderOg(inv) { // synchronous; used by tests/tools
    if (!resvg) return null;
    return new resvg.Resvg(ogSvg(inv), ogOpts()).render().asPng();
  }
  function renderOgAsync(inv) { // off the event loop (libuv thread pool)
    if (!resvg) return Promise.resolve(null);
    if (typeof resvg.renderAsync !== 'function') return new Promise(r => r(renderOg(inv)));
    return resvg.renderAsync(ogSvg(inv), ogOpts()).then(img => img.asPng());
  }
  function staticOg() { try { return fs.readFileSync(path.join(APP_DIR, 'og-steps.png')); } catch (e) { return null; } }
  app.get('/og/steps/:code.png', (req, res) => {
    const send = png => { if (res.headersSent) return; if (!png) return res.status(404).json({ error: 'no image' }); res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=600').send(png); };
    try {
      const code = codeParam(req.params.code);
      const inv = inviterByCode(code);
      const stat = staticOg();
      if (!inv && stat) return send(stat); // unknown codes never cost a render
      const key = inv ? code : '_';
      const ck = inv ? `${code}|${inv.today}|${inv.streak}|${inv.goal}` : '_';
      const c = ogCache.get(key);
      if (c && c.ck === ck && Date.now() - c.at < OG_TTL) return send(c.png);
      let p = ogInflight.get(key);
      if (!p) {
        if (ogInflight.size >= OG_INFLIGHT_MAX || ogIpLimited(clientIp(req))) return send((c && c.png) || stat); // saturated: stale or static
        p = renderOgAsync(inv).then(png => { if (png) ogRemember(key, ck, png); return png; }, e => { log('og render', e && e.message); return null; });
        p.finally(() => ogInflight.delete(key));
        ogInflight.set(key, p);
      }
      p.then(png => send(png || (c && c.png) || stat), () => send(stat));
    } catch (e) { log('og', e.message); if (!res.headersSent) res.status(500).json({ error: 'og failed' }); }
  });

  // An app-level express.json() (server.js) rejects malformed bodies before our routes run; keep those errors JSON
  // on our paths only (contract: every error is {error}). Other paths fall through untouched.
  const MY_PATHS = /^\/(api\/(steps|friends|me\/invite|share)(\/|\?|$)|join\/|og\/steps\/)/;
  app.use((err, req, res, next) => {
    if (!err || res.headersSent || !MY_PATHS.test(String(req.originalUrl || req.url || ''))) return next(err);
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'Bad JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body too large' });
    const code = err.status || err.statusCode || 500;
    if (code >= 500) log('error', err.message);
    res.status(code).json({ error: code < 500 ? (err.message || 'Bad request') : 'Something went wrong' });
  });

  // ═════════════════════════ JOBS (IST minute tick; tz-aware per user) ═════════════════════════
  const inWindow = (hh, mm, th, tm, span) => { const a = hh * 60 + mm, b = th * 60 + tm; return a >= b && a < b + (span || 10); };

  function snapshotBoards(dateKey) {
    const ins = q('INSERT INTO step_boards(period,scope,key,date_key,user_phone,steps,rank,computed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(period,scope,key,date_key,user_phone) DO UPDATE SET steps=excluded.steps,rank=excluded.rank,computed_at=excluded.computed_at');
    const ts = nowIso();
    const write = (period, scope, key, rows) => rows.forEach((r, i) => ins.run(period, scope, key, dateKey, r.phone, r.steps, i + 1, ts));
    const periods = ['today']; if (new Date(dateKey + 'T00:00:00Z').getUTCDay() === 0) periods.push('week');
    for (const period of periods) {
      write(period, 'india', 'in', computeRows('india', 'in', period, dateKey, 2));
      for (const c of q('SELECT DISTINCT city FROM step_profile WHERE city IS NOT NULL AND city<>\'\'').all()) write(period, 'city', c.city, computeRows('city', c.city, period, dateKey, 2));
      for (const f of q('SELECT DISTINCT user_phone FROM friends').all()) write(period, 'friends', f.user_phone, computeRows('friends', f.user_phone, period, dateKey, 1));
    }
  }
  const jobRan = new Map(); // kind → key
  const FIT_TIMEOUT_MS = 20000, FIT_PARALLEL = 6;
  const hasGoogle = phone => { try { return !!q('SELECT 1 FROM google_tokens WHERE user_phone=? LIMIT 1').get(phone); } catch (e) { return false; } };
  // Pull yesterday from Google Fit for every user about to be closed, bounded in time and concurrency, so the
  // settle below sees the backfill (late data still re-settles via closed_prev if Google is slow or down).
  async function fitBackfill(phones) {
    const run = phone => Promise.race([
      Promise.resolve().then(() => deps.fitSync(phone, 3)),
      new Promise(r => setTimeout(r, FIT_TIMEOUT_MS, { error: 'timeout' })),
    ]).catch(e => ({ error: e && e.message }));
    for (let i = 0; i < phones.length; i += FIT_PARALLEL) await Promise.all(phones.slice(i, i + FIT_PARALLEL).map(run));
  }
  function closeOut(now) {
    const ist = tzParts(now, IST);
    // 00:35 IST close-out, then an hourly catch-up at :35 for users whose day ends in other zones
    if (ist.mm !== 35) return;
    const k = ist.key + ':' + ist.hh; if (jobRan.get('close') === k) return; jobRan.set('close', k);
    const istY = addDays(ist.key, -1);
    const due = q('SELECT * FROM step_profile').all().filter(p => { try { return !isClosed(p, addDays(dk(userTz(p.user_phone), now), -1)); } catch (e) { return false; } });
    const settleAll = () => {
      let n = 0;
      for (const p0 of due) { try { const p = ensureProfile(p0.user_phone); if (closeUser(p, now)) n++; } catch (e) { log('close', e.message); } }
      if (jobRan.get('snap') !== istY) { jobRan.set('snap', istY); try { snapshotBoards(istY); } catch (e) { log('snapshot', e.message); } }
      if (n) log(`close-out ${istY}: ${n} users`);
    };
    const fitUsers = typeof deps.fitSync === 'function' ? due.map(p => p.user_phone).filter(hasGoogle) : [];
    if (!fitUsers.length) { settleAll(); return; } // synchronous when there is nothing to fetch
    return fitBackfill(fitUsers).then(settleAll, settleAll);
  }
  function pushJobs(now) {
    let users;
    try { users = q('SELECT DISTINCT user_phone FROM push_subs').all().map(r => r.user_phone); } catch (e) { return; }
    for (const phone of users) {
      try {
        const u = getUser(phone) || {}; const tz = userTz(phone, u); const t = tzParts(now, tz);
        if (q('SELECT 1 FROM push_log WHERE user_phone=? AND date_key=?').get(phone, t.key)) continue; // 1/day
        const pr = prefsOf(phone), p = ensureProfile(phone), row = dayRow(phone, t.key), goal = p.goal || 8000;
        const unmet = row.counted < goal, streak = liveStreakOf(phone, p, t.key);
        if (pr.weekly && t.dow === 0 && inWindow(t.hh, t.mm, 20, 0, 15)) {
          const from = mondayOf(t.key);
          const wk = q('SELECT SUM(COALESCE(counted,count)) s, MAX(COALESCE(counted,count)) m, COUNT(*) d FROM steps WHERE user_phone=? AND date>=? AND date<=?').get(phone, from, t.key);
          const total = (wk && wk.s) || 0;
          if (total > 0) { sendPush(phone, 'weekly', `This week: ${fmtN(total)} steps`, `Best day ${fmtN((wk && wk.m) || 0)}. Streak ${streak}. New week starts tomorrow — keep it moving.`, t.key); continue; }
        }
        if (pr.evening && unmet && inWindow(t.hh, t.mm, pr.hour, pr.minute, 15)) {
          const left = goal - row.counted;
          sendPush(phone, 'evening', `${fmtN(left)} steps to go`, left <= 2500 ? 'A 20-minute walk closes it out tonight.' : 'A quick evening walk keeps the streak alive.', t.key); continue;
        }
        if (unmet && streak >= 2 && inWindow(t.hh, t.mm, 21, 0, 15)) {
          sendPush(phone, 'risk', `Your ${streak}-day streak is at risk`, `${fmtN(goal - row.counted)} steps left before midnight.`, t.key);
        }
      } catch (e) { log('pushJobs', e.message); }
    }
  }
  // Synchronous unless Google Fit had to be fetched first; always await the result to observe a finished close-out.
  function tick(now) {
    now = now instanceof Date ? now : new Date(now || Date.now());
    let pending = null;
    try { pending = closeOut(now); } catch (e) { log('tick close', e.message); }
    try { pushJobs(now); } catch (e) { log('tick push', e.message); }
    return pending && typeof pending.then === 'function' ? pending.catch(e => log('tick close', e && e.message)) : Promise.resolve();
  }
  let timer = null;
  if (!deps.noTimer && process.env.NODE_ENV !== 'test') {
    timer = setInterval(() => tick(new Date()), 60 * 1000);
    if (timer.unref) timer.unref();
  }

  // ───── exports for the rest of the server ─────
  const summaryFor = phone => { try { return summary(phone, {}); } catch (e) { log('summaryFor', e.message); return null; } };
  function getStepsTool(phone) {
    try {
      const p = ensureProfile(phone), today = todayOf(phone), row = dayRow(phone, today);
      const fr = friendsRank(phone, today);
      let leader = null;
      if (fr) { const rows = boardRows('friends', phone, 'today', today); if (rows[0]) leader = { name: rows[0].phone === phone ? 'you' : rows[0].name, steps: rows[0].steps }; }
      return { today: row.counted, goal: p.goal, streak: liveStreakOf(phone, p, today), friendsRank: fr, leader, date: today };
    } catch (e) { log('getStepsTool', e.message); return { today: 0, goal: 8000, streak: 0, friendsRank: null, leader: null }; }
  }

  // Server-side ingestion (server.js's fitSync calls this per day as global._stepsIngest): the trusted path for
  // Google Fit numbers. Returns the resolved day row, or null when the input is unusable.
  function ingest(phone, date, count, source) {
    try {
      if (!phone || !isKey(date)) return null;
      source = TRUST[source] != null ? source : 'googlefit';
      if (!(Number(count) >= 0)) return null;
      const n = int(count, 0, 1e7, -1); if (n < 0) return null;
      const tz = userTz(phone), today = dk(tz);
      if (date > addDays(today, 1) || date < addDays(today, -60)) return null;
      ensureProfile(phone);
      putSample(phone, date, source, n, null, tz);
      return recompute(phone, date);
    } catch (e) { log('ingest', e.message); return null; }
  }

  return {
    summaryFor, tick, getStepsTool, recompute, ingest,
    stop() { if (timer) clearInterval(timer); },
    _internal: { boardCache, flushAt, regHits, jobRan, ogCache, ogInflight, ensureProfile, closeUser, settle, liveView, resettle, dk, addDays, mondayOf, tzParts, ogSvg, renderOg, clientIp },
  };
}

module.exports = { install, TRUST, HARD_CAP, HOUR_CAP, MANUAL_CAP, WALK_CAP, tzParts, addDays, mondayOf };
