// Mind games progress. Local first (localStorage bd.mind.v1); synced to /api/learn/progress as course 'mind'
// with one unit per level ('<game>-<level>': {done, best 0-100}). Merges keep the higher values on both sides.
// Network errors are silent: play never waits on the server.
import { hash, rng, shuffle } from './util.js';

export const KEY = 'bd.mind.v1';
export const LEVELS = 20;
export const GAME_IDS = ['memory', 'clash', 'hunt', 'math', 'words'];
const UNIT_RE = /^(memory|clash|hunt|math|words)-([1-9]|1\d|20)$/;

const blank = () => ({ v: 1, units: {}, xp: 0, seen: {}, days: [], workout: null, plays: 0 });

export function dayKey(d = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); } catch (e) { return d.toISOString().slice(0, 10); }
}
export function read() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = Object.assign(blank(), p && typeof p === 'object' ? p : {});
    if (!out.units || typeof out.units !== 'object') out.units = {};
    if (!Array.isArray(out.days)) out.days = [];
    if (!out.seen || typeof out.seen !== 'object') out.seen = {};
    return out;
  } catch (e) { return blank(); }
}
export function write(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: progress lives for this page only */ } }

// best is a 0-100 "performance" number: 40 = one star, 70 = two, 100 = three (see engine.pctOf)
export const starsFor = pct => (pct >= 100 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0);
export const uid = (g, l) => g + '-' + l;
export const unit = (p, g, l) => p.units[uid(g, l)] || null;
export const isDone = (p, g, l) => !!(unit(p, g, l) && unit(p, g, l).done);
export const starsAt = (p, g, l) => { const u = unit(p, g, l); return u ? starsFor(u.best || 0) : 0; };
export function current(p, g) { for (let l = 1; l <= LEVELS; l++) if (!isDone(p, g, l)) return l; return LEVELS; }
export const isOpen = (p, g, l) => l >= 1 && l <= LEVELS && (l === 1 || isDone(p, g, l) || isDone(p, g, l - 1));
export function allDone(p, g) { return isDone(p, g, LEVELS); }

export function gameStats(p, g) {
  let stars = 0, done = 0, sum = 0, started = false, best = null;
  for (let l = 1; l <= LEVELS; l++) {
    const u = unit(p, g, l); if (!u) continue;
    started = true; sum += u.best || 0; stars += starsFor(u.best || 0); if (u.done) done++;
    if (u.rawText) best = { level: l, text: u.rawText };
  }
  return { stars, done, sum, started, best, level: current(p, g) };
}

export function streak(p) {
  const days = new Set(p.days || []);
  let n = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ── daily workout: 3 of the 5 games, the same for everyone on a given day ──
export function workoutGames(day = dayKey()) { return shuffle(GAME_IDS.slice(), rng(hash('mind-workout-' + day))).slice(0, 3); }
export function workout(p) {
  const day = dayKey(), games = workoutGames(day);
  const doneList = p.workout && p.workout.day === day && Array.isArray(p.workout.done) ? p.workout.done : [];
  const done = games.filter(g => doneList.includes(g));
  return { day, games, done, next: games.find(g => !done.includes(g)) || null, complete: done.length === games.length };
}

// Save one finished game. r = {pct, stars, passed, raw, rawOk, lower, display}
export function record(g, l, r, opts = {}) {
  const p = read(), k = uid(g, l), prev = p.units[k] || null;
  const wasDone = !!(prev && prev.done), prevBest = prev ? prev.best || 0 : 0;
  const u = Object.assign({}, prev || {}, { done: wasDone || !!r.passed, best: Math.max(prevBest, r.pct | 0) });
  let rawBetter = false;
  if (r.rawOk && r.raw != null) {
    rawBetter = !prev || prev.raw == null || (r.lower ? r.raw < prev.raw : r.raw > prev.raw);
    if (rawBetter) { u.raw = r.raw; u.rawText = r.display; }
  }
  p.units[k] = u;
  const gain = 5 + (r.stars | 0) * 10 + (r.passed && !wasDone ? 20 : 0);
  p.xp = (p.xp | 0) + gain;
  p.plays = (p.plays | 0) + 1;
  const day = dayKey();
  if (!p.days.includes(day)) { p.days.push(day); if (p.days.length > 90) p.days = p.days.slice(-90); }
  if (opts.workout) {
    const w = workout(p);
    if (w.games.includes(g)) {
      if (!p.workout || p.workout.day !== day) p.workout = { day, done: [] };
      if (!p.workout.done.includes(g)) p.workout.done.push(g);
      if (workout(p).complete && !p.workout.bonus) { p.workout.bonus = 1; p.xp += 30; }
    }
  }
  write(p);
  return {
    unit: u, prev, wasDone, gain,
    newBest: !!prev && (u.best > prevBest || (rawBetter && prev.raw != null)),
    firstTime: !prev,
    unlocked: !!r.passed && !wasDone && l < LEVELS,
    workout: workout(p),
  };
}
export function markSeen(g) { const p = read(); p.seen[g] = 1; write(p); }

// ── server sync ──
const token = () => { try { return localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };
function merge(p, r) {
  if (!r || typeof r !== 'object' || !r.units || typeof r.units !== 'object') return false;
  let changed = false;
  for (const [k, v] of Object.entries(r.units)) {
    if (!UNIT_RE.test(k) || !v || typeof v !== 'object') continue;
    const mine = p.units[k];
    const done = !!((mine && mine.done) || v.done), best = Math.max((mine && mine.best) || 0, Math.min(100, v.best | 0));
    if (!mine || done !== !!mine.done || best !== (mine.best || 0)) { p.units[k] = Object.assign({}, mine || {}, { done, best }); changed = true; }
  }
  if ((r.xp | 0) > (p.xp | 0)) { p.xp = r.xp | 0; changed = true; }
  return changed;
}
export async function pull() {
  if (!token()) return false;
  try {
    const res = await fetch('/api/learn/progress?course=mind', { headers: { 'x-token': token() } });
    if (!res.ok) return false;
    const j = await res.json();
    const p = read(); const ch = merge(p, j); if (ch) write(p);
    return ch;
  } catch (e) { return false; }
}
export async function push() {
  if (!token()) return false;
  try {
    const p = read(), units = {};
    for (const [k, v] of Object.entries(p.units)) if (UNIT_RE.test(k)) units[k] = { done: !!v.done, best: Math.max(0, Math.min(100, v.best | 0)) };
    const res = await fetch('/api/learn/progress', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-token': token() },
      body: JSON.stringify({ course: 'mind', units, xp: p.xp | 0 }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    const q = read(); if (merge(q, j)) write(q);
    return true;
  } catch (e) { return false; }
}
