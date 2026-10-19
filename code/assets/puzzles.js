// A day as a level: the stage plan (Learn → Practice → Challenge → Recap) and the practice puzzles
// generated at runtime from the day's own code slides:
//   • "Arrange the lines" (Parsons): a 3–6 line snippet, shuffled; tap lines back into order.
//   • "Fill the blank": one meaningful token hidden on one line, with 3–4 answer chips.
// Everything here is pure and deterministic (seeded by the day number), so the player and
// scripts/code-check.mjs build exactly the same puzzles. No imports: the validator loads this file in Node.

// ── seeded random (mulberry32) ──
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function weighted(list, r) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let t = r() * total;
  for (const x of list) { t -= x.w; if (t < 0) return x; }
  return list[list.length - 1];
}

// ── a one-line Python tokenizer (enough to find tokens outside strings and comments) ──
const KW = new Set('False None True and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield'.split(' '));
const OPS = ['**=', '//=', '>>=', '<<=', '->', ':=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>>', '<<', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '^', '~', '@'];
const ID0 = /[A-Za-z_À-￿]/, IDN = /[\wÀ-￿]/;

export function tokenize(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i], s = i;
    if (c === ' ' || c === '\t') { while (i < n && (line[i] === ' ' || line[i] === '\t')) i++; out.push({ k: 'ws', v: line.slice(s, i), s }); continue; }
    if (c === '#') { out.push({ k: 'com', v: line.slice(i), s }); break; }
    if (ID0.test(c)) {
      while (i < n && IDN.test(line[i])) i++;
      const w = line.slice(s, i);
      if ((line[i] === '"' || line[i] === "'") && /^[rRbBfFuU]{1,2}$/.test(w)) { i = str(line, i); out.push({ k: 'str', v: line.slice(s, i), s }); continue; }
      out.push({ k: KW.has(w) ? 'kw' : 'name', v: w, s });
      continue;
    }
    if (c === '"' || c === "'") { i = str(line, i); out.push({ k: 'str', v: line.slice(s, i), s }); continue; }
    const num = /^(0[xXoObB][0-9a-fA-F_]+|\d[\d_]*(\.\d*)?([eE][+-]?\d+)?j?|\.\d+([eE][+-]?\d+)?j?)/.exec(line.slice(i));
    if (num && /[\d.]/.test(c)) { i += num[0].length; out.push({ k: 'num', v: num[0], s }); continue; }
    const op = OPS.find(o => line.startsWith(o, i));
    if (op) { i += op.length; out.push({ k: 'op', v: op, s }); continue; }
    i++; out.push({ k: 'p', v: c, s });
  }
  return out;
}
function str(line, i) {
  const q = line[i]; i++;
  while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === q) return i + 1; i++; }
  return line.length;
}

// ── "Fill the blank": which tokens can be hidden, and the wrong answers that sit next to them ──
// Distractors are real look-alikes (other keywords, other builtins, the habits other languages teach)
// so the right chip is the only one that makes this program print what it prints.
const KW_D = {
  for: ['while', 'if', 'each'], in: ['of', 'on', 'at'], def: ['function', 'func', 'fn'], return: ['print', 'give', 'output'],
  if: ['when', 'while', 'for'], else: ['otherwise', 'then', 'elseif'], elif: ['elseif', 'else if', 'elsif'], while: ['until', 'loop', 'repeat'],
  import: ['include', 'require', 'using'], from: ['of', 'at', 'inside'], True: ['true', 'TRUE', 'Yes'], False: ['false', 'FALSE', 'No'],
  None: ['null', 'nil', 'Nothing'], and: ['&&', 'also', 'plus'], or: ['||', 'either', 'otherwise'], not: ['!', 'no', 'isnt'],
  break: ['stop', 'exit', 'halt'], continue: ['skip', 'next', 'pass on'], class: ['struct', 'object', 'type'], with: ['using', 'within', 'open'],
  as: ['to', 'into', 'named'], try: ['attempt', 'do', 'test'], except: ['catch', 'rescue', 'error'], lambda: ['fn', 'func', 'arrow'], yield: ['emit', 'give', 'send'],
};
const BI_D = {
  print: ['echo', 'show', 'console.log'], len: ['size', 'length', 'count'], range: ['ranges', 'span', 'steps'], int: ['integer', 'num', 'Int'],
  str: ['string', 'text', 'String'], float: ['decimal', 'double', 'real'], input: ['read', 'scan', 'ask'], sum: ['total', 'add', 'sums'],
  max: ['biggest', 'maximum', 'top'], min: ['smallest', 'minimum', 'least'], sorted: ['sort', 'order', 'arrange'], list: ['array', 'List', 'vector'],
  dict: ['map', 'hash', 'object'], set: ['unique', 'Set', 'bag'], tuple: ['pair', 'record', 'Tuple'], round: ['roundup', 'trunc', 'fix'],
  abs: ['positive', 'absolute', 'mod'], enumerate: ['indexed', 'numbered', 'count'], zip: ['pair', 'join', 'merge'], type: ['typeof', 'kind', 'class_of'],
  open: ['file', 'load', 'fopen'], bool: ['boolean', 'Bool', 'truth'], any: ['some', 'either', 'exists'], all: ['every', 'each', 'both'],
  isinstance: ['instanceof', 'is_type', 'typeof'], reversed: ['reverse', 'backwards', 'flip'], map: ['each', 'apply', 'forEach'], filter: ['select', 'where', 'keep'],
};
const OP_D = {
  '+': ['-', '*', '/'], '-': ['+', '*', '//'], '*': ['+', '**', '-'], '/': ['//', '%', '*'], '//': ['/', '%', '**'], '%': ['//', '/', '*'], '**': ['*', '^', '//'],
  // never < next to <= (or > next to >=): at the boundary they often print the same thing
  '==': ['=', '!=', '=>'], '!=': ['==', '<>', '=!'], '<': ['>', '>=', '=<'], '>': ['<', '<=', '=>'], '<=': ['>=', '>', '=<'], '>=': ['<=', '<', '=>'],
  '+=': ['=+', '-=', '=='], '-=': ['=-', '+=', '=='], '*=': ['=*', '+=', '**='],
};
const KIND_W = { kw: 4, bi: 3, op: 3, name: 2 };

const lines = code => String(code || '').replace(/\s+$/, '').split('\n');
const isComment = l => /^\s*#/.test(l);
const sig = l => l.trim() && !isComment(l);
const words = (line, w) => (line.match(new RegExp('(^|[^\\w\\u00C0-\\uFFFF])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w\\u00C0-\\uFFFF])', 'g')) || []).length;
const tripleQ = code => /"""|'''/.test(code);

// Parsons: a run of whole top-level statements (a def with its body, a loop, a few assignments and prints),
// minus blank lines and full-line comments: 3–6 lines, every line different. The whole snippet when it is
// that short; otherwise a block of it, shown between the lines around it (locked).
function arrangesOf(s, i) {
  if (s.type !== 'code' || !s.code || tripleQ(s.code) || /\\\s*$/m.test(s.code) || (s.needs && s.needs.length)) return [];
  const raw = lines(s.code);
  // group significant lines into top-level statements (brackets left open keep a statement going)
  const stmts = [];
  let depthNow = 0;
  raw.forEach((l, li) => {
    if (!sig(l)) return;
    const prev = stmts.length ? raw[stmts[stmts.length - 1].slice(-1)[0]] : '';
    const top = depthNow === 0 && !/^\s/.test(l) && !/^(else|elif|except|finally)\b/.test(l) && !/^@/.test(prev);
    if (top || !stmts.length) stmts.push([]);
    stmts[stmts.length - 1].push(li);
    for (const t of tokenize(l)) { if ('([{'.includes(t.v) && t.k === 'p') depthNow++; else if (')]}'.includes(t.v) && t.k === 'p') depthNow = Math.max(0, depthNow - 1); }
  });
  const out = [];
  for (let a = 0; a < stmts.length; a++) {
    let idx = [];
    for (let b = a; b < stmts.length; b++) {
      idx = idx.concat(stmts[b]);
      if (idx.length > 6) break;
      if (idx.length < 3) continue;
      const L = idx.map(li => raw[li].replace(/\s+$/, ''));
      if (new Set(L.map(l => l.trim())).size !== L.length || L.some(l => l.length > 76)) continue;
      const whole = a === 0 && b === stmts.length - 1;
      const header = L.some(l => /:\s*(#.*)?$/.test(l));
      // only blocks whose order matters: a block header, a name made on one line and used on a later one,
      // or prints whose order is the output (a stack of imports can go in any order)
      if (!header && !usesEarlier(L) && L.filter(l => /^\s*print\(/.test(l)).length < 2) continue;
      const pre = stmts.slice(0, a).flat(), post = stmts.slice(b + 1).flat();
      out.push({
        src: i, lines: L, from: idx[0], to: idx[idx.length - 1], whole,
        before: pre.slice(-2).map(li => raw[li].replace(/\s+$/, '')), more: pre.length > 2,
        after: post.slice(0, 1).map(li => raw[li].replace(/\s+$/, '')), moreAfter: post.length > 1,
        w: (whole ? 6 : 1) * (L.length - 1 + (header ? 2 : 0)),
      });
    }
  }
  return out;
}

function usesEarlier(L) {
  const made = new Set();
  for (const l of L) {
    const ts = tokenize(l).filter(t => t.k !== 'ws');
    if (ts.some((t, j) => t.k === 'name' && made.has(t.v) && !(ts[j - 1] && ts[j - 1].v === '.'))) return true;
    const eq = ts.findIndex(t => t.k === 'op' && /^(=|\+=|-=|\*=|\/=)$/.test(t.v));
    if (eq > 0) ts.slice(0, eq).forEach(t => { if (t.k === 'name') made.add(t.v); });
    if (ts[0] && ts[0].k === 'kw' && /^(import|from|def|class)$/.test(ts[0].v)) ts.slice(1).forEach(t => { if (t.k === 'name') made.add(t.v); });
  }
  return false;
}

// The full program with a block's lines put back in a given order (blank lines and comments in the block dropped).
export function withBlock(code, p, order) {
  const raw = lines(code);
  const body = (order || p.lines.map((_, k) => k)).map(k => p.lines[k]);
  return raw.slice(0, p.from).concat(body, raw.slice(p.to + 1)).join('\n');
}

// Every token on every line of a short snippet that could be the blank.
function blanksOf(s) {
  if (s.type !== 'code' || !s.code || typeof s.expect !== 'string' || tripleQ(s.code) || (s.needs && s.needs.length)) return [];
  const L = lines(s.code);
  if (L.filter(sig).length > 14) return [];
  const toks = L.map(tokenize);
  const nameLines = new Map(); // name -> set of lines it appears on (as a plain name)
  toks.forEach((ts, li) => ts.forEach((t, j) => { if (t.k === 'name' && !prevIs(ts, j, '.')) { if (!nameLines.has(t.v)) nameLines.set(t.v, new Set()); nameLines.get(t.v).add(li); } }));
  const names = [...nameLines.keys()].filter(n => !BI_D[n]);
  const out = [];
  toks.forEach((ts, li) => {
    if (!sig(L[li]) || L[li].length > 72) return;
    ts.forEach((t, j) => {
      let kind = null, pool = null;
      if (t.k === 'kw' && KW_D[t.v]) { kind = 'kw'; pool = KW_D[t.v]; }
      else if (t.k === 'name' && BI_D[t.v] && !prevIs(ts, j, '.') && !nextIs(ts, j, '=')) { kind = 'bi'; pool = BI_D[t.v]; }
      else if (t.k === 'op' && OP_D[t.v]) { kind = 'op'; pool = OP_D[t.v]; }
      else if (t.k === 'name' && !BI_D[t.v] && t.v.length >= 2 && !prevIs(ts, j, '.') && !(nextIs(ts, j, '=') && depth(ts, j) > 0)) {
        const on = nameLines.get(t.v);
        if (on && [...on].some(x => x !== li)) { kind = 'name'; pool = names.filter(n => n !== t.v && n.length >= 2); }
      }
      if (!kind) return;
      // the hidden token must be the only one of its kind on the line, so the blank has one answer
      const same = kind === 'op' ? ts.filter(x => x.k === 'op' && x.v === t.v).length : words(L[li], t.v);
      if (same !== 1) return;
      out.push({ line: li, start: t.s, token: t.v, kind, pool, w: KIND_W[kind] * (t.v === 'print' ? 0.25 : 1) });
    });
  });
  return out;
}
function prevIs(ts, j, v) { for (let k = j - 1; k >= 0; k--) { if (ts[k].k === 'ws') continue; return ts[k].v === v; } return false; }
function nextIs(ts, j, v) { for (let k = j + 1; k < ts.length; k++) { if (ts[k].k === 'ws') continue; return ts[k].v === v; } return false; }
function depth(ts, j) { let d = 0; for (let k = 0; k < j; k++) { if ('([{'.includes(ts[k].v)) d++; else if (')]}'.includes(ts[k].v)) d--; } return d; }

// Builds the day's puzzles: at most one arrange and one fill-blank, from different code slides when possible.
export function makePuzzles(day) {
  const S = (day && day.slides) || [];
  const r = rng((day.day || 1) * 7919 + 101);
  const out = [];
  // whole short snippets first; blocks of longer ones only when a day has none
  let arr = [];
  S.forEach((s, i) => { arr = arr.concat(arrangesOf(s, i)); });
  if (arr.some(x => x.whole)) arr = arr.filter(x => x.whole);
  let used = -1;
  if (arr.length) {
    const pick = weighted(arr, r), L = pick.lines;
    let order = shuffle(L.map((_, k) => k), r);
    if (order.every((v, k) => v === k)) order = order.slice(1).concat(order[0]);
    // never leave the snippet nearly solved: if most lines stay put, rotate once more
    if (order.filter((v, k) => v === k).length > Math.floor(L.length / 2)) order = order.slice(1).concat(order[0]);
    used = pick.src;
    const { w, ...p } = pick;
    out.push({ kind: 'arrange', id: 'a' + pick.src, ...p, order, code: S[pick.src].code.replace(/\s+$/, '') });
  }
  let cands = [];
  S.forEach((s, i) => { if (i !== used) blanksOf(s).forEach(b => cands.push({ ...b, src: i })); });
  if (!cands.length && used >= 0) blanksOf(S[used]).forEach(b => cands.push({ ...b, src: used }));
  while (cands.length) {
    const b = weighted(cands, r);
    const s = S[b.src], L = lines(s.code);
    const ds = shuffle(b.pool.filter(x => x !== b.token), r).filter((x, k, a) => a.indexOf(x) === k).slice(0, 3);
    if (ds.length >= 2) {
      const chips = shuffle([b.token, ...ds], r);
      const line = L[b.line];
      out.push({
        kind: 'fill', id: 'f' + b.src, src: b.src, code: s.code.replace(/\s+$/, ''), line: b.line, token: b.token, tokenKind: b.kind,
        before: line.slice(0, b.start), after: line.slice(b.start + b.token.length), chips,
      });
      break;
    }
    cands = cands.filter(c => c !== b);
  }
  return out;
}

// Puts a chip into the blank: the full snippet as it would read.
export function fillWith(p, chip) {
  const L = p.code.split('\n');
  L[p.line] = p.before + chip + p.after;
  return L.join('\n');
}

// ── the level plan ──
export const STAGES = [
  { id: 'learn', name: 'Learn' },
  { id: 'practice', name: 'Practice' },
  { id: 'challenge', name: 'Challenge' },
  { id: 'recap', name: 'Recap' },
];
const STAGE_OF = { intro: 'learn', concept: 'learn', visual: 'learn', code: 'learn', predict: 'practice', quiz: 'practice', bug: 'challenge', exercise: 'challenge', project: 'challenge', recap: 'recap' };
export const ANSWERABLE = new Set(['predict', 'quiz', 'arrange', 'fill', 'bug', 'exercise', 'project']);

// Learn (intro, concepts, visuals, runnable code) → Practice (predict, quiz, puzzles spread through) →
// Challenge (bugs and exercises in their order, the project last as the boss) → Recap.
// Every code slide comes before every exercise, so nothing is asked before it is taught.
export function planDay(day) {
  const S = (day && day.slides) || [];
  const groups = { learn: [], practice: [], challenge: [], recap: [] };
  S.forEach((s, i) => { const st = STAGE_OF[s.type] || 'learn'; groups[st].push({ kind: s.type, src: i, stage: st }); });
  groups.challenge = groups.challenge.filter(x => x.kind !== 'project').concat(groups.challenge.filter(x => x.kind === 'project'));
  const puzzles = makePuzzles(day);
  // puzzles spread evenly through Practice: with 3 questions, Q · arrange · Q · fill · Q
  const P = groups.practice, n = P.length, m = puzzles.length;
  puzzles.forEach((p, k) => {
    const at = Math.min(P.length, Math.max(0, Math.round(((k + 1) * (n + m + 1)) / (m + 1)) - 1));
    P.splice(at, 0, { kind: p.kind, puzzle: p, src: p.src, stage: 'practice' });
  });
  const items = [...groups.learn, ...P, ...groups.challenge, ...groups.recap];
  items.forEach((it, k) => { it.k = k; });
  return { items, puzzles, count: STAGES.map(s => items.filter(i => i.stage === s.id).length) };
}

// ── helpers the player and the validator share ──
// Labels for an exercise's checks, from its assert messages ("Print two lines: your name, then your city.").
// index of the first bracket that never closes (the whole length when all close)
function unclosedAt(t) {
  const open = [];
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '(' || c === '[') open.push(i); else if ((c === ')' || c === ']') && open.length) open.pop(); }
  return open.length ? open[0] : t.length;
}
export function testLabels(tests) {
  const out = [];
  // words a label must not end on once an f-string value is cut away ("changed to", "should be")
  const dangling = /\s+(?:should(?:\s+(?:be|return|give|get|hold|become|print|end\s+at))?|is|are|was|to|be|of|for|like|as|got|with|than|and|or|the|a|an|at|from|by|into|still)$/i;
  for (const raw of String(tests || '').split('\n')) {
    if (!/^\s*assert\s/.test(raw)) continue;
    // the message is the last string literal on the line, right after a comma (not a comma inside a list)
    const m = /,\s*f?(["'])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(raw);
    if (!m) continue;
    let t = m[2].replace(/\\(["'])/g, '$1');
    for (let i = 0; i < 3; i++) t = t.replace(/\{[^{}]*\}/g, '…'); // f-string values, nested ones too
    t = t.replace(/…\s*\./g, '…');
    t = t.split(/,\s+(?:but|not|got)\s|\s+—\s|\?\s|\.\s+(?=[A-Z])/)[0];
    t = t.slice(0, unclosedAt(t)).replace(/\s+$/, ''); // cut an unclosed "(…" or "[…" tail
    for (let i = 0; i < 4; i++) t = t.replace(/[\s.…,:;=]+$/, '').replace(dangling, '');
    if (t.length > 84) { t = t.slice(0, 82).replace(/\s+\S*$/, ''); t = t.slice(0, unclosedAt(t)).replace(/[\s.,:;]+$/, '') + '…'; }
    if (t.length >= 8 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 6);
}

// The buggy line, when the content gives one: a `line` on the slide, or a fix that changes exactly one line.
export function bugLine(s) {
  if (!s || s.type !== 'bug') return null;
  if (Number.isInteger(s.line)) return s.line;
  const a = lines(s.starter).map(l => l.replace(/\s+$/, '')), b = lines(s.solution).map(l => l.replace(/\s+$/, ''));
  if (a.length !== b.length) return null;
  const diff = a.map((l, k) => (l !== b[k] ? k + 1 : 0)).filter(Boolean);
  return diff.length === 1 ? diff[0] : null;
}
