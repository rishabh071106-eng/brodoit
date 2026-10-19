#!/usr/bin/env node
// Validates the Python course (code/days/dNN.json) and writes code/days/index.json.
// Every code slide runs in real CPython (Pyodide, the same harness learners use): expected
// output must match, predict answers must be the real output, exercise solutions must pass
// and starters must fail. Slides that need internet packages (sqlite3…) run in local python3.
// It also builds each day's level plan and practice puzzles with the player's own generator
// (code/assets/puzzles.js, seeded by the day) and proves every puzzle solvable and unambiguous.
// usage: node scripts/code-check.mjs [--days 1-10] [--no-run] [--quiet]
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = path.join(ROOT, 'code', 'days');
const HARNESS = path.join(ROOT, 'code', 'assets', 'harness.py');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] || true) : null; };
const RUN = !args.includes('--no-run'), QUIET = args.includes('--quiet');
let range = [1, 60];
if (opt('--days')) { const [a, b] = String(opt('--days')).split('-').map(Number); range = [a, b || a]; }

const PHASES = [
  { n: 1, name: 'Launch', title: 'Foundations', from: 1, to: 10 },
  { n: 2, name: 'Ascent', title: 'Data and functions', from: 11, to: 20 },
  { n: 3, name: 'Orbit', title: 'Programs that scale', from: 21, to: 30 },
  { n: 4, name: 'Deep space', title: 'Professional Python', from: 31, to: 40 },
  { n: 5, name: 'Developer', title: 'Algorithms, data and the web', from: 41, to: 50 },
  { n: 6, name: 'Pro', title: 'Build like a pro', from: 51, to: 60 },
];
const KINDS = new Set(['boxes', 'memory', 'list', 'dict', 'flow', 'stack', 'terminal', 'compare', 'steps', 'table', 'tree', 'chart']);
const TYPES = new Set(['intro', 'concept', 'visual', 'code', 'predict', 'quiz', 'exercise', 'bug', 'project', 'recap']);
const norm = s => String(s == null ? '' : s).split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
// the player's puzzle generator, loaded as-is (a data: URL keeps Node from guessing the module type)
const PZ = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(ROOT, 'code', 'assets', 'puzzles.js')).toString('base64'));
const pz = { arrange: 0, fill: 0, runs: 0, days: 0, bad: 0 };

let py = null, run = null;
async function boot() {
  const req = createRequire(path.join(ROOT, 'package.json'));
  const dir = path.dirname(req.resolve('pyodide/package.json'));
  const { loadPyodide } = await import(path.join(dir, 'pyodide.mjs'));
  py = await loadPyodide({ indexURL: dir + '/' });
  py.runPython(fs.readFileSync(HARNESS, 'utf8'));
  run = py.globals.get('bd_run');
}

// Slides with `needs` (sqlite3…) cannot load packages offline: run them in local CPython instead.
function runLocal(o) {
  const work = fs.mkdtempSync('/tmp/bdwork-');
  const script = `import asyncio, json, sys, os\nos.environ['BD_WORK']=${JSON.stringify(work)}\nexec(open(${JSON.stringify(HARNESS)}).read())\nprint('\\x00'+asyncio.run(bd_run(sys.stdin.read())))`;
  const r = spawnSync('python3', ['-c', script], { input: JSON.stringify(o), encoding: 'utf8', timeout: 20000 });
  const m = String(r.stdout || '').split('\x00').pop();
  try { return JSON.parse(m); } catch (e) { return { ok: false, error: { text: 'local python3 failed: ' + (r.stderr || '').slice(-300) } }; }
}

async function exec(o) {
  if (o.needs && o.needs.length) return { ...runLocal(o), local: true };
  // maxEvents: a starter that loops forever without printing is stopped instead of hanging the check
  return JSON.parse(await run(JSON.stringify(o.mode === 'trace' ? o : { ...o, maxEvents: 3000000 })));
}

const errors = [], warns = [];
const E = (d, i, m) => errors.push(`d${d}${i == null ? '' : ' s' + (i + 1)}: ${m}`);
const W = (d, i, m) => warns.push(`d${d}${i == null ? '' : ' s' + (i + 1)}: ${m}`);
const str = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;

function checkSay(d, i, s) {
  if (!str(s.say, 20)) return E(d, i, 'missing narration (say)');
  if (s.say.length > 420) E(d, i, `narration too long (${s.say.length} > 420 chars)`);
  if (/[`*#]|[\u{1F300}-\u{1FAFF}]|\\n/u.test(s.say)) E(d, i, 'narration has symbols that read badly aloud: ' + s.say.match(/[`*#]|[\u{1F300}-\u{1FAFF}]|\\n/u)[0]);
}

function checkVisual(d, i, v) {
  if (!v) return;
  if (!KINDS.has(v.kind)) return E(d, i, 'unknown visual kind ' + v.kind);
  const need = { boxes: 'vars', memory: 'objects', list: 'items', dict: 'pairs', flow: 'nodes', stack: 'frames', terminal: 'lines', compare: 'left', steps: 'items', table: 'rows', tree: 'root', chart: 'bars' }[v.kind];
  if (v[need] == null) E(d, i, `visual ${v.kind} needs "${need}"`);
}

async function checkDay(file) {
  let J;
  try { J = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return E(path.basename(file), null, 'invalid JSON: ' + e.message); }
  const d = J.day;
  if (!Number.isInteger(d)) return E(path.basename(file), null, 'day missing');
  if (path.basename(file) !== `d${String(d).padStart(2, '0')}.json`) E(d, null, 'file name does not match day');
  const ph = PHASES.find(p => d >= p.from && d <= p.to);
  if (J.phase !== ph.n) E(d, null, `phase should be ${ph.n}`);
  for (const k of ['title', 'subtitle', 'goal']) if (!str(J[k], 3)) E(d, null, 'missing ' + k);
  if (!Number.isInteger(J.minutes) || J.minutes < 20 || J.minutes > 120) E(d, null, 'minutes should be 20–120');
  if (!Array.isArray(J.outcomes) || J.outcomes.length < 3) E(d, null, 'needs 3+ outcomes');
  const S = Array.isArray(J.slides) ? J.slides : [];
  if (S.length < 14) E(d, null, `only ${S.length} slides (min 14)`);
  if (S.length > 26) W(d, null, `${S.length} slides is long`);
  const count = t => S.filter(s => t.includes(s.type)).length;
  if (S[0] && S[0].type !== 'intro') E(d, 0, 'first slide must be intro');
  if (S.length && S[S.length - 1].type !== 'recap') E(d, S.length - 1, 'last slide must be recap');
  if (count(['code']) < 4) E(d, null, 'needs 4+ code slides');
  if (count(['quiz', 'predict']) < 2) E(d, null, 'needs 2+ quiz/predict slides');
  if (count(['exercise', 'bug', 'project']) < 2) E(d, null, 'needs 2+ exercise/bug/project slides');
  if (S.filter(s => s.visual).length < 3) E(d, null, 'needs 3+ slides with a visual');
  if ([10, 20, 30, 40, 50].includes(d) && !count(['project'])) E(d, null, 'phase-end day needs a project slide');

  let ran = 0;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (!TYPES.has(s.type)) { E(d, i, 'unknown type ' + s.type); continue; }
    if (!str(s.title, 2)) E(d, i, 'missing title');
    checkSay(d, i, s);
    checkVisual(d, i, s.visual);
    const words = String(s.body || s.task || s.brief || '').split(/\s+/).filter(Boolean).length;
    if (words > 90) W(d, i, `body is ${words} words (keep screens short)`);
    if (s.type === 'recap' && (!Array.isArray(s.points) || s.points.length < 3)) E(d, i, 'recap needs 3+ points');
    if (s.type === 'quiz') {
      if (!str(s.q, 5)) E(d, i, 'quiz needs q');
      if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 4) E(d, i, 'quiz needs 2–4 options');
      else if (!(s.answer >= 0 && s.answer < s.options.length)) E(d, i, 'quiz answer out of range');
      if (!str(s.why, 5)) E(d, i, 'quiz needs why');
    }
    if (['code', 'predict'].includes(s.type) && !str(s.code)) { E(d, i, 'needs code'); continue; }
    if (s.type === 'code' && s.expect === undefined) E(d, i, 'code needs expect (or null)');
    if (s.explain) for (const e of s.explain) if (!Array.isArray(e) || !Number.isInteger(e[0]) || !str(e[1]) || e[0] > s.code.split('\n').length) E(d, i, 'bad explain entry ' + JSON.stringify(e).slice(0, 60));
    if (s.type === 'predict') {
      if (!Array.isArray(s.options) || s.options.length < 2) E(d, i, 'predict needs options');
      if (!str(s.why, 5)) E(d, i, 'predict needs why');
    }
    if (['exercise', 'bug', 'project'].includes(s.type)) {
      for (const k of ['starter', 'solution', 'tests']) if (typeof s[k] !== 'string' || (k !== 'starter' && !s[k].trim())) E(d, i, 'needs ' + k);
      if (!str(s.task || s.brief, 10)) E(d, i, 'needs task/brief');
      if (!Array.isArray(s.hints) || !s.hints.length) E(d, i, 'needs hints');
      if (s.type === 'project' && (!Array.isArray(s.steps) || s.steps.length < 3)) E(d, i, 'project needs 3+ steps');
    }
    if (!RUN) continue;
    const base = { stdin: s.stdin || '', files: s.files || null, needs: s.needs || [] };
    if (s.type === 'code') {
      const r = await exec({ ...base, code: s.code, mode: 'run' }); ran++;
      if (!r.ok && r.local && /ModuleNotFoundError/.test(r.error && r.error.text || '') && base.needs.some(n => (r.error.text || '').includes("'" + n))) W(d, i, 'not verified here (install ' + base.needs.join(', ') + ' for local python3): ' + r.error.text);
      else if (!r.ok) E(d, i, 'code crashed: ' + (r.error && r.error.text));
      else if (s.expect !== null && norm(r.out) !== norm(s.expect)) E(d, i, `output differs\n      expected: ${JSON.stringify(norm(s.expect)).slice(0, 200)}\n      actual:   ${JSON.stringify(norm(r.out)).slice(0, 200)}`);
      if (s.trace !== false && s.code.split('\n').length <= 25 && !base.needs.length) {
        const t = await exec({ ...base, code: s.code, mode: 'trace' }); ran++;
        if (!t.steps || !t.steps.length) W(d, i, 'trace produced no steps');
      }
    }
    if (s.type === 'predict') {
      const r = await exec({ ...base, code: s.code, mode: 'run' }); ran++;
      const actual = norm(r.ok ? r.out : (r.error && r.error.text));
      const hits = (s.options || []).map((o, k) => norm(o) === actual ? k : -1).filter(k => k >= 0);
      if (!hits.length) E(d, i, `no option equals the real output ${JSON.stringify(actual).slice(0, 120)}`);
      else if (!hits.includes(s.answer)) E(d, i, `answer is ${s.answer} but the real output is option ${hits[0]}`);
      else if (hits.length > 1) E(d, i, 'two options equal the real output');
    }
    if (['exercise', 'bug', 'project'].includes(s.type) && s.solution && s.tests) {
      const good = await exec({ ...base, code: s.solution, mode: 'test', tests: s.tests }); ran++;
      if (!good.test || !good.test.passed) E(d, i, 'solution fails its own tests: ' + JSON.stringify(good.test || good.error).slice(0, 220));
      const bad = await exec({ ...base, code: s.starter || '', mode: 'test', tests: s.tests }); ran++;
      if (bad.test && bad.test.passed) E(d, i, 'starter already passes the tests');
    }
  }
  ran += await checkLevel(d, J);
  if (!QUIET) console.log(`d${String(d).padStart(2, '0')} ${J.title} — ${S.length} slides, ${ran} runs`);
  return {
    day: d, phase: J.phase, title: J.title, subtitle: J.subtitle, minutes: J.minutes, goal: J.goal,
    slides: S.length, practice: count(['exercise', 'bug', 'project']), project: count(['project']) > 0,
  };
}

// The level plan (Learn → Practice → Challenge → Recap) and its generated puzzles: the same code the
// player runs. Arrange: the lines put back in order are exactly the original block and the program still
// prints its output. Fill: one right chip, the restored snippet is the original, and no wrong chip makes
// the program print the same thing.
async function checkLevel(d, J) {
  const S = J.slides || [];
  let runs = 0, plan;
  const before = errors.length;
  try { plan = PZ.planDay(J); } catch (e) { E(d, null, 'level plan failed: ' + e.message); return 0; }
  if (JSON.stringify(plan) !== JSON.stringify(PZ.planDay(J))) E(d, null, 'level plan is not deterministic');
  const seen = plan.items.filter(it => !it.puzzle).map(it => it.src).sort((a, b) => a - b);
  if (seen.length !== S.length || seen.some((v, k) => v !== k)) E(d, null, 'level plan must use every slide exactly once');
  const order = ['learn', 'practice', 'challenge', 'recap'];
  plan.items.forEach((it, k) => { if (k && order.indexOf(it.stage) < order.indexOf(plan.items[k - 1].stage)) E(d, null, 'level stages out of order at item ' + (k + 1)); });
  if (plan.items.length && plan.items[plan.items.length - 1].kind !== 'recap') E(d, null, 'level must end with the recap');
  const lastCode = Math.max(-1, ...plan.items.filter(it => it.kind === 'code').map(it => it.k));
  const firstTask = Math.min(1e9, ...plan.items.filter(it => ['exercise', 'bug', 'project'].includes(it.kind)).map(it => it.k));
  if (lastCode > firstTask) E(d, null, 'a code slide comes after an exercise in the level plan');
  if (plan.puzzles.length) pz.days++;
  for (const p of plan.puzzles) {
    const s = S[p.src] || {}, tag = `${p.kind} from s${p.src + 1}`;
    const base = { stdin: s.stdin || '', files: s.files || null, needs: s.needs || [] };
    const canRun = RUN && typeof s.expect === 'string' && !base.needs.length;
    if (s.type !== 'code') { E(d, p.src, tag + ': source is not a code slide'); continue; }
    if (p.kind === 'arrange') {
      const n = p.lines.length;
      if (n < 3 || n > 6) E(d, p.src, `${tag}: ${n} lines (needs 3–6)`);
      if (new Set(p.lines.map(l => l.trim())).size !== n) E(d, p.src, tag + ': two lines are the same, so the order is ambiguous');
      if (p.order.length !== n || [...p.order].sort((a, b) => a - b).some((v, k) => v !== k)) E(d, p.src, tag + ': shuffle is not a permutation');
      if (p.order.every((v, k) => v === k)) E(d, p.src, tag + ': shuffle left the lines in order');
      // solve it the way a learner does (tap the shuffled tiles in the right order) and compare with the original
      const tiles = p.order.map(k => ({ k, text: p.lines[k] }));
      const solved = p.lines.map(line => tiles.find(t => t.text === line)).map(t => t.text);
      const original = s.code.replace(/\s+$/, '').split('\n').slice(p.from, p.to + 1).filter(l => l.trim() && !/^\s*#/.test(l)).map(l => l.replace(/\s+$/, ''));
      if (solved.join('\n') !== original.join('\n')) E(d, p.src, tag + ': the arranged answer is not the original block');
      if (canRun) {
        const r = await exec({ ...base, code: PZ.withBlock(s.code, p), mode: 'run' }); runs++; pz.runs++;
        if (!r.ok || norm(r.out) !== norm(s.expect)) E(d, p.src, tag + ': the arranged program does not print the expected output: ' + JSON.stringify((r.error && r.error.text) || norm(r.out)).slice(0, 120));
      }
      pz.arrange++;
    }
    if (p.kind === 'fill') {
      const L = s.code.replace(/\s+$/, '').split('\n');
      if (p.chips.length < 3 || p.chips.length > 4) E(d, p.src, `${tag}: ${p.chips.length} chips (needs 3–4)`);
      if (new Set(p.chips).size !== p.chips.length) E(d, p.src, tag + ': two chips are the same');
      if (p.chips.filter(c => c === p.token).length !== 1) E(d, p.src, tag + ': the right chip is not exactly once among the chips');
      if (PZ.fillWith(p, p.token) !== L.join('\n')) E(d, p.src, tag + ': restoring the token does not give the original snippet');
      const toks = PZ.tokenize(L[p.line]).filter(t => t.v === p.token && t.k !== 'str' && t.k !== 'com');
      if (toks.length !== 1 || toks[0].s !== p.before.length) E(d, p.src, `${tag}: "${p.token}" is not exactly once on line ${p.line + 1}`);
      if (!/\S/.test(p.token)) E(d, p.src, tag + ': empty token');
      if (canRun) {
        for (const c of p.chips) {
          if (c === p.token) continue;
          const r = await exec({ ...base, code: PZ.fillWith(p, c), mode: 'run' }); runs++; pz.runs++;
          if (r.ok && norm(r.out) === norm(s.expect)) E(d, p.src, `${tag}: the wrong chip "${c}" prints the same output as "${p.token}"`);
        }
      }
      pz.fill++;
    }
  }
  pz.bad += errors.length - before;
  return runs;
}

const t0 = Date.now();
if (RUN) await boot();
const files = fs.readdirSync(DAYS).filter(f => /^d\d\d\.json$/.test(f)).sort();
const meta = [];
for (const f of files) {
  const n = Number(f.slice(1, 3));
  if (n < range[0] || n > range[1]) { try { const J = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf8')); meta.push({ day: J.day, phase: J.phase, title: J.title, subtitle: J.subtitle, minutes: J.minutes, goal: J.goal, slides: (J.slides || []).length, practice: (J.slides || []).filter(s => ['exercise', 'bug', 'project'].includes(s.type)).length, project: (J.slides || []).some(s => s.type === 'project') }); } catch (e) { /* checked when in range */ } continue; }
  const m = await checkDay(path.join(DAYS, f));
  if (m) meta.push(m);
}
meta.sort((a, b) => a.day - b.day);
const index = { course: 'python', title: 'Python: Zero to Hero', days: 60, phases: PHASES, list: meta };
fs.writeFileSync(path.join(DAYS, 'index.json'), JSON.stringify(index));
if (warns.length && !QUIET) console.log('\nWarnings:\n  ' + warns.join('\n  '));
if (errors.length) { console.log('\nErrors (' + errors.length + '):\n  ' + errors.join('\n  ')); }
console.log(`\nPuzzles: ${pz.arrange} arrange-the-lines + ${pz.fill} fill-the-blank generated on ${pz.days} days; ${pz.bad ? pz.bad + ' problems (see errors)' : 'all solvable and unambiguous'}${RUN ? ` (${pz.runs} puzzle runs in Python)` : ' (structure only: --no-run)'}`);
console.log(`\n${meta.length} days indexed, ${errors.length} errors, ${warns.length} warnings, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(errors.length ? 1 : 0);
