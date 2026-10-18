// The Python lesson player: animated slides, recorded narration, live code (Run / Watch it run),
// predict-then-run, quizzes, exercises checked by real tests, hints, solutions, celebrations.
import { esc, md, mdInline, progress, syncProgress, speak, stopVoice, confetti, haptic, param } from './lib.js';
import { render as renderVisual, mount as mountVisual } from './visuals.js';
import { createEditor, codeView } from './editor.js';
import { openTrace } from './trace.js';
import * as PY from './runner.js';
import { mountCoach } from './coach.js';

const DAY = Math.max(1, Math.min(60, parseInt(param('d')) || 1));
const pad = n => String(n).padStart(2, '0');
const stage = document.getElementById('stage'), foot = document.getElementById('foot');
const PHASES = ['', 'Launch', 'Ascent', 'Orbit', 'Deep space', 'Developer', 'Pro'];
const KICK = { intro: ['rocket', 'Mission briefing'], concept: ['spark', 'Concept'], visual: ['eye', 'See it'], code: ['play', 'Run it'], predict: ['crystal', 'Predict'], quiz: ['check', 'Quick check'], exercise: ['keyboard', 'Your turn'], bug: ['bug', 'Fix the bug'], project: ['build', 'Project'], recap: ['flag', 'Recap'] };
const XP = { code: 2, predict: 5, quiz: 5, exercise: 20, bug: 20, project: 60 };

let D = null, idx = 0, P = progress.read();
const solved = {};        // slide index -> true once its task is done
const fails = {};         // slide index -> failed checks
const editors = {};
let traceCtl = null;

const ICON = {
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  crystal: '<circle cx="12" cy="11" r="7"/><path d="M8 21h8M9 18l-1 3M15 18l1 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9"/><path d="M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6 13H2M22 13h-4M3 21c0-2.1 1.6-3.8 3.5-4M21 21c0-2.1-1.6-3.8-3.5-4M3 5c0 2.1 1.6 3.8 3.5 4M21 5c0 2.1-1.6 3.8-3.5 4"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6M17 9l6 6"/>',
  watch: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
};
const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

// ── load ──
async function load() {
  PY.warm();
  try {
    const r = await fetch(`/code/days/d${pad(DAY)}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch (e) {
    stage.innerHTML = `<div class="sl in"><div class="sl-card"><h2>Day ${DAY} is being prepared</h2><p class="muted">This mission lands soon. Keep going with the days before it.</p><a class="btn pri" href="/code/">Back to the mission map</a></div></div>`;
    foot.hidden = true;
    return;
  }
  document.title = `Day ${DAY}: ${D.title} · Python`;
  if (!progress.open(P, DAY)) { location.replace('/code/?locked=' + DAY); return; }
  const saved = progress.day(P, DAY);
  idx = saved && !saved.done && saved.slide ? Math.min(saved.slide, D.slides.length - 1) : 0;
  for (let k = 0; k < idx; k++) solved[k] = true;
  buildProgress();
  show(idx, 0);
  mountCoach({ context, button: document.getElementById('bro') });
  syncProgress({ day: DAY, patch: { slide: idx, title: D.title, started: (saved && saved.started) || new Date().toISOString() } });
}

function context() {
  const s = D && D.slides[idx];
  const ed = editors[idx];
  return { course: 'py', unit: 'd' + pad(DAY), day: DAY, dayTitle: D && D.title, slide: s ? { n: idx + 1, of: D.slides.length, type: s.type, title: s.title, task: s.task || s.brief || s.q || s.body || '' } : null, code: ed ? ed.value : (s && s.code) || '', lastError: lastError[idx] || null };
}
const lastError = {};

function buildProgress() {
  const bar = document.getElementById('segs');
  bar.innerHTML = D.slides.map((s, k) => `<i data-k="${k}" class="${s.type}"></i>`).join('');
  document.getElementById('dayLabel').textContent = `Day ${DAY} · ${PHASES[D.phase] || ''}`;
}
function paintProgress() {
  document.querySelectorAll('#segs i').forEach(el => { const k = +el.dataset.k; el.classList.toggle('done', k < idx || !!solved[k]); el.classList.toggle('on', k === idx); });
}

// ── slides ──
function head(s, k) {
  const [icn, label] = KICK[s.type] || ['spark', ''];
  return `<div class="sl-kick" style="--i:0"><span class="sl-chip t-${s.type}">${ic(icn, 14)}${label}</span><span class="sl-n">${k + 1}/${D.slides.length}</span><button class="sl-say" aria-label="Play narration" data-act="say">${ic('sound', 16)}<span class="wave"><i></i><i></i><i></i><i></i></span></button></div>
  <h2 class="sl-title" style="--i:1">${esc(s.title)}</h2>`;
}

function body(s, k) {
  const vis = s.visual ? `<div class="sl-vis" style="--i:3">${renderVisual(s.visual)}</div>` : '';
  switch (s.type) {
    case 'intro':
      return `<div class="sl-hero" style="--i:1"><div class="orbit"><span class="planet"></span><span class="ring r1"></span><span class="ring r2"></span><span class="ship">${ic('rocket', 26)}</span></div>
        <div class="sl-day">Day ${DAY} <small>of 60 · ${esc(PHASES[D.phase])}</small></div><div class="sl-sub">${esc(D.subtitle || '')}</div></div>
        <div class="sl-body" style="--i:2">${md(s.body)}</div>${vis}
        <div class="sl-outs" style="--i:4"><div class="sl-ot">Today you will</div>${(D.outcomes || []).map((o, j) => `<div class="sl-o" style="--j:${j}">${ic('check', 14)}<span>${esc(o)}</span></div>`).join('')}</div>`;
    case 'concept': case 'visual':
      return `${s.body ? `<div class="sl-body" style="--i:2">${md(s.body)}</div>` : ''}${vis}`;
    case 'code':
      return `${s.body ? `<div class="sl-body" style="--i:2">${md(s.body)}</div>` : ''}${vis}
        <div class="sl-ed" style="--i:3" data-ed></div>
        ${stdinBox(s, k)}
        <div class="sl-acts" style="--i:4"><button class="btn run" data-act="run">${ic('play', 16)}Run</button>${traceable(s) ? `<button class="btn ghost" data-act="trace">${ic('watch', 16)}Watch it run</button>` : ''}<button class="btn icon" data-act="reset" aria-label="Reset code">${ic('reset', 16)}</button></div>
        <div class="sl-con" hidden></div><div class="sl-trace" hidden></div>
        ${s.explain && s.explain.length ? `<div class="sl-exp" style="--i:5"><div class="sl-ot">Line by line</div>${s.explain.map((e, j) => `<button class="sl-ex" data-line="${e[0]}" style="--j:${j}"><b>${e[0]}</b><span>${esc(e[1])}</span></button>`).join('')}</div>` : ''}`;
    case 'predict':
      return `<div class="sl-body" style="--i:2"><p>What will this program print?</p></div><div class="sl-ro" style="--i:3">${codeView(s.code)}</div>
        <div class="sl-opts out" style="--i:4">${s.options.map((o, j) => `<button class="opt" data-opt="${j}" style="--j:${j}"><pre>${esc(o)}</pre></button>`).join('')}</div>
        <div class="sl-con" hidden></div><div class="sl-why" hidden></div>`;
    case 'quiz':
      return `<div class="sl-body" style="--i:2"><p class="q">${mdInline(s.q)}</p></div>${s.code ? `<div class="sl-ro" style="--i:3">${codeView(s.code)}</div>` : ''}
        <div class="sl-opts" style="--i:4">${s.options.map((o, j) => `<button class="opt" data-opt="${j}" style="--j:${j}"><span class="ol">${'ABCD'[j]}</span><span class="ot">${md(o).replace(/^<p>|<\/p>$/g, '')}</span></button>`).join('')}</div><div class="sl-why" hidden></div>`;
    case 'exercise': case 'bug': case 'project':
      return `<div class="sl-body task" style="--i:2">${md(s.task || s.brief)}</div>
        ${s.steps ? `<ol class="sl-steps" style="--i:3">${s.steps.map(x => `<li>${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ol>` : ''}${vis}
        <div class="sl-ed" style="--i:3" data-ed></div>${stdinBox(s, k)}
        <div class="sl-acts" style="--i:4"><button class="btn run" data-act="run">${ic('play', 16)}Run</button><button class="btn pri" data-act="check">${ic('check', 16)}Check</button>
          <button class="btn icon" data-act="hint" aria-label="Hint">${ic('bulb', 16)}</button><button class="btn icon" data-act="reset" aria-label="Start over">${ic('reset', 16)}</button></div>
        <div class="sl-con" hidden></div><div class="sl-res" hidden></div><div class="sl-hints"></div>`;
    case 'recap':
      return `<div class="sl-points" style="--i:2">${(s.points || []).map((p, j) => `<div class="sl-pt" style="--j:${j}">${ic('check', 16)}<span>${md(p).replace(/^<p>|<\/p>$/g, '')}</span></div>`).join('')}</div>
        <div class="sl-badge" style="--i:3"><div class="medal"><span>${DAY}</span></div><div><b>Mission ${DAY} complete</b><small>${esc(D.title)}</small></div></div>`;
  }
  return '';
}
const traceable = s => s.trace !== false && s.code.split('\n').length <= 25 && !(s.needs && s.needs.length);
function stdinBox(s, k) {
  const src = s.code || s.starter || '';
  if (!s.stdin && !/input\s*\(/.test(src) && !/input\s*\(/.test(s.solution || '')) return '';
  return `<label class="sl-in" style="--i:3"><span>Input <small>one value per line</small></span><textarea rows="2" data-stdin spellcheck="false" autocapitalize="off">${esc(s.stdin || '')}</textarea></label>`;
}

function codeKey(k) { return `bd.py.code.d${pad(DAY)}.s${k}`; }
function startCode(s, k) {
  try { const v = localStorage.getItem(codeKey(k)); if (v != null && ['exercise', 'bug', 'project'].includes(s.type)) return v; } catch (e) { /* ignore */ }
  return s.code != null ? s.code : (s.starter || '');
}

function show(k, dir) {
  stopVoice();
  if (traceCtl) { traceCtl.close(); traceCtl = null; }
  const s = D.slides[k]; idx = k;
  const el = document.createElement('section');
  el.className = 'sl ' + (dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : 'from-0') + ' t-' + s.type;
  el.innerHTML = `<div class="sl-card">${head(s, k)}${body(s, k)}</div>`;
  const old = stage.querySelector('.sl.in');
  if (old) { old.classList.remove('in'); old.classList.add(dir >= 0 ? 'out-l' : 'out-r'); setTimeout(() => old.remove(), 420); }
  stage.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  stage.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
  const edHost = el.querySelector('[data-ed]');
  if (edHost) {
    const label = s.type === 'code' ? 'example.py' : 'main.py';
    editors[k] = createEditor(edHost, { value: startCode(s, k), label, onRun: () => run(el, s, k), onChange: v => { if (['exercise', 'bug', 'project'].includes(s.type)) try { localStorage.setItem(codeKey(k), v); } catch (e) { /* ignore */ } } });
  } else delete editors[k];
  mountVisual(el);
  wire(el, s, k);
  paintProgress();
  paintFoot();
  if (P.voice !== false) narrate(el, s);
  if (k > 0) syncProgress({ day: DAY, patch: { slide: k } });
}

function narrate(el, s) {
  const b = el.querySelector('.sl-say'); if (!b || !s.say) return;
  b.classList.add('on');
  speak(s.say, { voice: 'py', lang: 'en-IN' }).then(() => b.classList.remove('on'));
}

function paintFoot() {
  const s = D.slides[idx], last = idx === D.slides.length - 1;
  const gated = ['quiz', 'predict'].includes(s.type) && !solved[idx];
  const task = ['exercise', 'bug', 'project'].includes(s.type) && !solved[idx];
  const next = document.getElementById('next'), skip = document.getElementById('skip');
  next.disabled = gated || task;
  next.innerHTML = last ? `Complete mission ${ic('flag', 16)}` : gated ? 'Answer to continue' : task ? 'Pass the check to continue' : `Continue ${ic('next', 16)}`;
  skip.hidden = !(task && (fails[idx] || 0) >= 2);
  document.getElementById('back').disabled = idx === 0;
}

// ── interactions ──
function wire(el, s, k) {
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-act],[data-opt],[data-line]'); if (!t) return;
    if (t.dataset.act === 'say') { if (t.classList.contains('on')) { stopVoice(); t.classList.remove('on'); } else narrate(el, s); return; }
    if (t.dataset.act === 'run') return run(el, s, k);
    if (t.dataset.act === 'trace') return trace(el, s, k);
    if (t.dataset.act === 'reset') { const ed = editors[k]; if (ed) { ed.value = s.code != null ? s.code : (s.starter || ''); try { localStorage.removeItem(codeKey(k)); } catch (er) { /* ignore */ } } return; }
    if (t.dataset.act === 'check') return check(el, s, k);
    if (t.dataset.act === 'hint') return hint(el, s, k);
    if (t.dataset.act === 'solution') { const ed = editors[k]; if (ed) ed.value = s.solution; el.querySelector('.sl-res').innerHTML = '<div class="res info">Here is a working solution. Read it line by line, then tap <b>Check</b>.</div>'; return; }
    if (t.dataset.act === 'askbro') { window.bdCoach && window.bdCoach.open(t.dataset.q || ''); return; }
    if (t.dataset.line) { const ed = editors[k]; if (ed) { ed.clearMarks(); ed.mark(+t.dataset.line, 'focus'); } el.querySelectorAll('.sl-ex').forEach(b => b.classList.toggle('on', b === t)); haptic(8); return; }
    if (t.dataset.opt != null) return answer(el, s, k, +t.dataset.opt, t);
  });
}

function stdinOf(el) { const t = el.querySelector('[data-stdin]'); return t ? t.value : ''; }

function consoleEl(el) {
  const c = el.querySelector('.sl-con'); c.hidden = false;
  c.innerHTML = `<div class="con-h"><span>Output</span><span class="con-st">running…</span></div><pre class="con-o"></pre><div class="con-err" hidden></div>`;
  return c;
}

function paintResult(c, res, k) {
  const o = c.querySelector('.con-o'), st = c.querySelector('.con-st'), er = c.querySelector('.con-err');
  if (res.log && res.log.length) {
    let html = res.log.map(([n, t]) => n === 'out' ? esc(t) : `<span class="${n === 'echo' ? 'echo' : 'stderr'}">${esc(t)}</span>`).join('');
    const total = res.log.reduce((a, x) => a + x[1].length, 0);
    if (total > 20000) { const tail = res.log.map(x => x[1]).join('').slice(-6000); html = `<span class="dim">\u2026 ${total.toLocaleString('en-IN')} characters printed; showing the end \u2026</span>\n` + esc(tail); }
    o.innerHTML = html;
  }
  if (!o.textContent.trim() && res.ok) o.innerHTML = '<span class="dim">(nothing was printed)</span>';
  st.textContent = res.ok ? 'done' : (res.error && res.error.type) || 'error';
  st.className = 'con-st ' + (res.ok ? 'ok' : 'bad');
  if (!res.ok && res.error) {
    lastError[k] = { type: res.error.type, text: res.error.text, line: res.error.line, tb: res.error.tb };
    const hint = PY.hintFor(res.error);
    er.hidden = false;
    er.innerHTML = `<div class="err-t">${esc(res.error.text)}${res.error.line ? ` <small>line ${res.error.line}</small>` : ''}</div>${hint ? `<div class="err-h">${ic('bulb', 14)}${esc(hint)}</div>` : ''}
      ${res.error.tb && res.error.tb.split('\n').length > 1 ? `<details><summary>Full traceback</summary><pre>${esc(res.error.tb)}</pre></details>` : ''}
      <button class="btn small ghost" data-act="askbro" data-q="Why do I get this error? ${esc(res.error.text)}">Ask Bro why</button>`;
    const ed = editors[k]; if (ed && res.error.line) { ed.clearMarks(); ed.mark(res.error.line, 'err'); }
  }
}

async function run(el, s, k) {
  const ed = editors[k]; if (!ed) return;
  const c = consoleEl(el); const o = c.querySelector('.con-o');
  el.querySelector('.sl-trace').hidden = true;
  const btn = el.querySelector('[data-act="run"]'); btn.disabled = true; btn.classList.add('busy');
  if (PY.state.status === 'starting' || PY.state.status === 'cold') c.querySelector('.con-st').textContent = 'starting Python…';
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el), files: s.files, needs: s.needs, mode: 'run' }, {
    onOut: (n, t) => { if (o.childNodes.length > 400) return; o.insertAdjacentHTML('beforeend', n === 'out' ? esc(t) : `<span class="${n === 'echo' ? 'echo' : 'stderr'}">${esc(t)}</span>`); },
    onStatus: t => { c.querySelector('.con-st').textContent = t; },
  });
  btn.disabled = false; btn.classList.remove('busy');
  o.innerHTML = '';
  paintResult(c, res, k);
  haptic(res.ok ? 10 : [20, 40, 20]);
  if (s.type === 'code' && res.ok && !solved[k]) { solved[k] = true; award(XP.code, { kind: 'run', ok: true }); }
  if (!res.ok) logEvent({ kind: 'error', type: res.error && res.error.type, text: res.error && res.error.text, slide: k + 1 });
  paintProgress();
}

async function trace(el, s, k) {
  const ed = editors[k]; if (!ed) return;
  const host = el.querySelector('.sl-trace'); host.hidden = false;
  host.innerHTML = '<div class="tr-loading">Recording every step…</div>';
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el), files: s.files, mode: 'trace' });
  if (traceCtl) traceCtl.close();
  traceCtl = openTrace(host, { code: ed.value, res, onClose: () => { host.hidden = true; } });
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!solved[k] && s.type === 'code') { solved[k] = true; award(XP.code, { kind: 'trace' }); paintProgress(); }
}

async function answer(el, s, k, j, btn) {
  if (solved[k] && s.type !== 'predict') return;
  if (el.dataset.answered) return;
  el.dataset.answered = '1';
  const opts = el.querySelectorAll('.opt');
  opts.forEach(b => b.disabled = true);
  btn.classList.add('picked');
  if (s.type === 'predict') {
    const c = consoleEl(el); c.querySelector('.con-st').textContent = 'running for real…';
    const res = await PY.run({ code: s.code, stdin: s.stdin || '', files: s.files, mode: 'run' });
    c.querySelector('.con-o').textContent = '';
    await typeOut(c.querySelector('.con-o'), res.ok ? res.out : (res.error && res.error.text) || '');
    c.querySelector('.con-st').textContent = 'real output'; c.querySelector('.con-st').className = 'con-st ok';
  }
  const ok = j === s.answer;
  opts[s.answer].classList.add('right');
  if (!ok) btn.classList.add('wrong');
  const why = el.querySelector('.sl-why'); why.hidden = false;
  why.innerHTML = `<div class="why ${ok ? 'ok' : 'no'}"><b>${ok ? pick(['Exactly right.', 'Nailed it.', 'Spot on.', 'Correct!']) : 'Not quite.'}</b> ${md(s.why).replace(/^<p>|<\/p>$/g, '')}</div>`;
  why.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  solved[k] = true;
  if (ok) { award(XP[s.type], { kind: s.type, ok: true }); confetti(el, 26); haptic(14); }
  else { logEvent({ kind: s.type, ok: false, slide: k + 1, title: s.title }); haptic([20, 40, 20]); }
  paintProgress(); paintFoot();
}
const pick = a => a[Math.floor(Math.random() * a.length)];
function typeOut(pre, text) {
  return new Promise(res => { let i = 0; const step = Math.max(1, Math.ceil(text.length / 60)); const t = setInterval(() => { i += step; pre.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(t); res(); } }, 16); });
}

async function check(el, s, k) {
  const ed = editors[k]; if (!ed) return;
  const r = el.querySelector('.sl-res'); r.hidden = false; r.innerHTML = '<div class="res info"><span class="spin"></span>Checking your code in Python…</div>';
  const btn = el.querySelector('[data-act="check"]'); btn.disabled = true;
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el) || s.stdin || '', files: s.files, needs: s.needs, tests: s.tests, mode: 'test' });
  btn.disabled = false;
  const c = consoleEl(el); paintResult(c, res, k);
  const t = res.test || { passed: false, msg: res.error ? res.error.text : 'Could not check.' };
  if (t.passed) {
    const first = !fails[k];
    r.innerHTML = `<div class="res ok"><b>${pick(['All checks passed!', 'It works!', 'Mission accomplished!'])}</b> ${first ? 'First try. Impressive.' : 'You debugged it. That is the job.'}<span class="xp">+${XP[s.type] + (first ? 10 : 0)} XP</span></div>`;
    if (!solved[k]) { solved[k] = true; award(XP[s.type] + (first ? 10 : 0), { kind: 'check', ok: true, slide: k + 1, tries: (fails[k] || 0) + 1 }); }
    confetti(el, 70); haptic([10, 30, 10]);
  } else {
    fails[k] = (fails[k] || 0) + 1;
    lastError[k] = { type: 'CheckFailed', text: t.msg };
    r.innerHTML = `<div class="res no"><b>${t.stage === 'run' ? 'Your program crashed.' : 'Not yet.'}</b> ${esc(t.msg)}</div>
      <div class="res-acts">${fails[k] >= 2 ? `<button class="btn small ghost" data-act="solution">${ic('key', 14)}Show a solution</button>` : ''}<button class="btn small ghost" data-act="askbro" data-q="My check fails: ${esc(t.msg)}. Can you give me a hint (not the answer)?">Ask Bro for a hint</button></div>`;
    logEvent({ kind: 'check', ok: false, slide: k + 1, title: s.title, msg: t.msg });
    haptic([20, 40, 20]);
  }
  paintProgress(); paintFoot();
  r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hint(el, s, k) {
  const box = el.querySelector('.sl-hints'); const n = box.children.length;
  const hs = s.hints || [];
  if (n >= hs.length) { box.insertAdjacentHTML('beforeend', ''); if (!box.querySelector('.more')) box.insertAdjacentHTML('beforeend', `<div class="hint more">No more hints. Tap <b>Ask Bro</b> and describe what you tried.</div>`); return; }
  box.insertAdjacentHTML('beforeend', `<div class="hint">${ic('bulb', 14)}<span><b>Hint ${n + 1}.</b> ${md(hs[n]).replace(/^<p>|<\/p>$/g, '')}</span></div>`);
  logEvent({ kind: 'hint', slide: k + 1 });
}

// ── progress ──
const pendingEvents = [];
function logEvent(ev) { pendingEvents.push(Object.assign({ at: Date.now() }, ev)); }
function award(xp, ev) {
  logEvent(ev);
  const chip = document.getElementById('xp'); P = progress.read();
  syncProgress({ day: DAY, xp, patch: { slide: idx }, events: pendingEvents.splice(0) }).then(p => { P = p; chip.textContent = p.xp + ' XP'; });
  chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
}

async function complete() {
  stopVoice();
  const practice = D.slides.map((s, k) => ['exercise', 'bug', 'project'].includes(s.type) ? (solved[k] ? 1 : 0) : null).filter(x => x !== null);
  const score = practice.length ? Math.round(100 * practice.reduce((a, b) => a + b, 0) / practice.length) : 100;
  P = await syncProgress({ day: DAY, xp: 30, patch: { done: true, slide: 0, best: score, doneAt: new Date().toISOString() }, events: pendingEvents.splice(0).concat([{ kind: 'complete', score }]) });
  const nxt = DAY < 60 ? DAY + 1 : null;
  const ov = document.createElement('div'); ov.className = 'done-ov';
  ov.innerHTML = `<div class="done-card"><div class="launch"><span class="trail"></span>${ic('rocket', 46)}</div>
    <div class="done-k">Mission ${DAY} complete</div><h2>${esc(D.title)}</h2>
    <div class="done-stats"><div><b>${score}%</b><small>practice solved</small></div><div><b>${P.xp}</b><small>total XP</small></div><div><b>${progress.streak(P)}</b><small>day streak</small></div></div>
    <div class="done-path"><i style="--w:${(progress.doneCount(P) / 60) * 100}%"></i></div><small class="muted">${progress.doneCount(P)} of 60 days done</small>
    ${nxt ? `<a class="btn pri big" href="/code/day.html?d=${nxt}">Start Day ${nxt} ${ic('rocket', 16)}</a>` : `<a class="btn pri big" href="/code/">You graduated. See your journey</a>`}
    <a class="btn ghost" href="/code/">Mission map</a></div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('in'));
  confetti(ov, 140); haptic([30, 60, 30]);
  speak(`Mission ${DAY} complete. ${nxt ? 'Rest your brain, then come back for day ' + nxt + '.' : 'You are now a Python developer. Congratulations.'}`, { voice: 'py' });
}

document.getElementById('next').addEventListener('click', () => {
  if (idx >= D.slides.length - 1) return complete();
  show(idx + 1, 1);
});
document.getElementById('back').addEventListener('click', () => { if (idx > 0) show(idx - 1, -1); });
document.getElementById('skip').addEventListener('click', () => { logEvent({ kind: 'skip', slide: idx + 1 }); solved[idx] = 'skipped'; paintFoot(); show(Math.min(idx + 1, D.slides.length - 1), 1); });
document.getElementById('voice').addEventListener('click', e => {
  P = progress.read(); P.voice = P.voice === false; progress.write(P);
  e.currentTarget.innerHTML = ic(P.voice ? 'sound' : 'mute', 20);
  e.currentTarget.setAttribute('aria-label', P.voice ? 'Narration on' : 'Narration off');
  if (!P.voice) stopVoice(); else narrate(stage.querySelector('.sl.in'), D.slides[idx]);
});
document.getElementById('voice').innerHTML = ic(P.voice === false ? 'mute' : 'sound', 20);
document.getElementById('xp').textContent = (P.xp || 0) + ' XP';
document.addEventListener('keydown', e => {
  if (e.target.closest('textarea,input')) return;
  if (e.key === 'ArrowRight' && !document.getElementById('next').disabled) document.getElementById('next').click();
  if (e.key === 'ArrowLeft') document.getElementById('back').click();
});
PY.onStatus(st => { const el = document.getElementById('pyst'); if (!el) return; el.dataset.s = st.status; el.title = st.note || ''; el.querySelector('span').textContent = st.status === 'ready' || st.status === 'running' ? 'Python ready' : st.status === 'error' ? 'Python offline' : 'Starting Python'; });
window.addEventListener('pagehide', () => { stopVoice(); if (pendingEvents.length) syncProgress({ day: DAY, events: pendingEvents.splice(0) }); });
load();
