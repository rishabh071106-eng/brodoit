// The Python level player. A day is a level in four stages, Learn → Practice → Challenge → Recap:
// concepts revealed a step at a time, live code (Run / Watch it run), predict and quiz tiles with instant
// feedback, puzzles generated from the day's own code (arrange the lines, fill the blank), bug fixes and
// challenges checked by real tests. XP pops, three right in a row lights a combo (×2 XP), and the level
// ends with 1–3 stars. Sound is short game effects from window.Sfx (/app/sound.js): there is no voice.
import { esc, md, mdInline, progress, syncProgress, confetti, haptic, param, sfx, calm, rankOf, starsOf } from './lib.js';
import { render as renderVisual, mount as mountVisual } from './visuals.js';
import { createEditor, codeView } from './editor.js';
import { highlight } from './hl.js';
import { openTrace } from './trace.js';
import * as PY from './runner.js';
import { mountCoach } from './coach.js';
import { planDay, withBlock, testLabels, bugLine, STAGES, ANSWERABLE } from './puzzles.js';

const DAY = Math.max(1, Math.min(60, parseInt(param('d')) || 1));
const pad = n => String(n).padStart(2, '0');
const $ = s => document.querySelector(s);
const stage = $('#stage'), foot = $('#foot');
const XP = { run: 5, predict: 10, quiz: 10, arrange: 15, fill: 10, bug: 20, exercise: 20, project: 50, level: 20, star: 10 };
const HINT_COST = 5, SOLUTION_COST = 10;
const TASK = new Set(['bug', 'exercise', 'project']), CHOICE = new Set(['predict', 'quiz', 'fill']), REVEAL = new Set(['concept', 'visual']);
// a small tag on slides where you act; dropped when the title already says it
const KICK = {
  code: ['play', 'Run it', /\brun\b/i], predict: ['crystal', 'Predict', /predict/i], quiz: ['check', 'Quiz', /quiz|check|question/i],
  arrange: ['puzzle', 'Puzzle', /^$/], fill: ['puzzle', 'Puzzle', /^$/], exercise: ['target', 'Challenge', /challenge/i], bug: ['bug', 'Fix the bug', /bug|fix/i], project: ['crown', 'Boss challenge', /^$/],
};
const norm = s => String(s == null ? '' : s).split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
const sleep = ms => new Promise(r => setTimeout(r, calm() ? 0 : ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

const ICON = {
  play: '<polygon points="7 4.5 19 12 7 19.5 7 4.5"/>',
  crystal: '<circle cx="12" cy="11" r="7"/><path d="M8 21h8M9 18l-1 3M15 18l1 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  puzzle: '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9"/><path d="M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6 13H2M22 13h-4M3 21c0-2.1 1.6-3.8 3.5-4M21 21c0-2.1-1.6-3.8-3.5-4M3 5c0 2.1 1.6 3.8 3.5 4M21 5c0 2.1-1.6 3.8-3.5 4"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
  watch: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  flame: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.9-2.7-6.2-4.2-9.4-.4 2-1.5 3.3-2.8 3.8.4-3-1-6.2-3.8-7.8.2 3.2-1.4 5.4-3 7.4C3.9 11.1 5 13.6 5 15.4 5 19.1 7.6 22 12 22z"/>',
  star: '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.7-1.5"/>',
  map: '<path d="m9 4-6 2.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20"/>',
  dumbbell: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 5-3 7-8 7z"/><path d="M12 15c0-3-2.4-5.5-7-5.5 0 4 2.4 5.5 7 5.5z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>',
};
const FILLED = new Set(['play', 'bolt', 'flame', 'star']);
const ic = (n, s = 18) => FILLED.has(n)
  ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[n] || ''}</svg>`
  : `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

let D = null, PLAN = null, items = [], idx = 0, P = progress.read(), shownStage = null;
const U = {};          // per item: what is on screen (revealed parts, picked tile, placed lines…)
const editors = {}, lastError = {};
let traceCtl = null, R = null, tick = Date.now();
const RUNKEY = `bd.py.run.d${pad(DAY)}`;

// ── this run of the level: first-try answers, hints, XP (kept on the device so a reload resumes it) ──
const freshRun = () => ({ v: 1, day: DAY, idx: 0, ans: {}, solved: {}, hints: 0, xp: 0, cost: 0, committed: 0, combo: 0, bestCombo: 0, ms: 0 });
function readRun() { try { const r = JSON.parse(localStorage.getItem(RUNKEY) || 'null'); return r && r.v === 1 && r.day === DAY ? r : null; } catch (e) { return null; } }
function saveRun() { if (!R) return; const now = Date.now(); R.ms += Math.min(now - tick, 120000); tick = now; R.idx = idx; try { localStorage.setItem(RUNKEY, JSON.stringify(R)); } catch (e) { /* private mode */ } }
const netXP = () => Math.max(0, R.xp - R.cost);

// ── load ──
async function load() {
  PY.warm();
  try {
    const r = await fetch(`/code/days/d${pad(DAY)}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch (e) {
    stage.innerHTML = `<div class="sl in"><div class="sl-card"><h2 class="sl-title">Day ${DAY} is coming soon</h2><p class="muted">Keep going with the days before it.</p><a class="btn pri" href="/code/">Back to the map</a></div></div>`;
    foot.hidden = true;
    return;
  }
  document.title = `Day ${DAY}: ${D.title} · Python`;
  document.body.classList.add('w' + (D.phase || Math.ceil(DAY / 10)));
  if (!progress.open(P, DAY)) { location.replace('/code/?locked=' + DAY); return; }
  PLAN = planDay(D); items = PLAN.items;
  const saved = progress.day(P, DAY) || {};
  const stored = readRun();
  let at = !saved.done && saved.slide ? saved.slide : 0;
  if (stored && !saved.done) at = Math.max(at, stored.idx || 0);
  at = Math.min(at, items.length - 1);
  R = at > 0 && stored ? stored : freshRun();
  if (at > 0 && !stored) for (let k = 0; k < at; k++) R.solved[k] = true;
  buildHud();
  show(at, 0);
  mountCoach({ context, button: $('#bro') });
  syncProgress({ day: DAY, patch: { slide: at, title: D.title, started: saved.started || new Date().toISOString() } });
}

function context() {
  const it = items[idx], s = it && D.slides[it.src];
  const ed = editors[idx];
  const kind = it && it.puzzle ? (it.kind === 'arrange' ? 'arrange-the-lines puzzle' : 'fill-the-blank puzzle') : s && s.type;
  return { course: 'py', unit: 'd' + pad(DAY), day: DAY, dayTitle: D && D.title, slide: s ? { n: idx + 1, of: items.length, type: kind, stage: it.stage, title: s.title, task: s.task || s.brief || s.q || s.body || '' } : null, code: ed ? ed.value : (s && s.code) || '', lastError: lastError[idx] || null };
}

// ── HUD: stage segments, XP counter, combo meter, sound ──
function buildHud() {
  $('#segs').innerHTML = STAGES.map((st, k) => PLAN.count[k] ? `<i class="seg s-${st.id}" style="flex:${PLAN.count[k]}" data-st="${st.id}"><b></b></i>` : '').join('');
  paintXP(true); paintCombo(); paintSnd();
}
function paintHud() {
  const it = items[idx];
  STAGES.forEach((st, k) => {
    const seg = document.querySelector(`.seg[data-st="${st.id}"]`); if (!seg) return;
    const mine = items.filter(x => x.stage === st.id);
    const doneN = mine.filter(x => R.solved[x.k] || x.k < idx).length + (it.stage === st.id && !R.solved[idx] ? 0.5 : 0);
    seg.querySelector('b').style.width = Math.min(100, (doneN / mine.length) * 100) + '%';
    seg.classList.toggle('on', it.stage === st.id);
    seg.classList.toggle('full', mine.every(x => R.solved[x.k] || x.k < idx));
  });
  const mine = items.filter(x => x.stage === it.stage), pos = mine.indexOf(it) + 1;
  $('#stageLabel').innerHTML = `<b>${STAGES.find(s => s.id === it.stage).name}</b> ${pos}/${mine.length}`;
}
let shownXP = 0;
function paintXP(now) {
  const el = $('#xp'), target = netXP();
  const set = v => { el.querySelector('b').textContent = v; };
  if (!el.querySelector('b')) el.innerHTML = `${ic('bolt', 15)}<b>0</b>`;
  if (now || calm()) { shownXP = target; set(target); return; }
  const from = shownXP, t0 = performance.now();
  shownXP = target;
  const step = t => { const p = Math.min(1, (t - t0) / 450); set(Math.round(from + (target - from) * p)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function paintCombo() {
  const el = $('#combo'), c = R ? R.combo : 0, on = c >= 3;
  el.classList.toggle('on', on);
  el.setAttribute('aria-label', on ? `Combo: ${c} in a row, double XP` : `${c} of 3 in a row for a combo`);
  el.innerHTML = on ? `${ic('flame', 14)}<b>×2</b><small>${c}</small>` : `${ic('flame', 13)}${[0, 1, 2].map(k => `<i class="${k < c ? 'on' : ''}"></i>`).join('')}`;
}
function paintSnd() {
  const b = $('#snd'), m = !window.Sfx || window.Sfx.muted();
  b.innerHTML = ic(m ? 'mute' : 'sound', 20);
  b.setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
  b.setAttribute('aria-pressed', String(!m));
}

// "+10 XP" floats up from where you earned it and lands in the counter
function flyXP(n, fromEl) {
  const chip = $('#xp'), b = chip.getBoundingClientRect();
  const a = fromEl && fromEl.isConnected ? fromEl.getBoundingClientRect() : b;
  const f = document.createElement('div');
  f.className = 'xp-fly' + (n < 0 ? ' neg' : '');
  f.textContent = (n < 0 ? '−' : '+') + Math.abs(n) + ' XP';
  const x0 = a.left + a.width / 2, y0 = a.top + Math.min(a.height / 2, 40);
  f.style.left = x0 + 'px'; f.style.top = y0 + 'px';
  document.body.appendChild(f);
  if (calm() || !f.animate) { setTimeout(() => { f.remove(); paintXP(); }, 500); return; }
  const dx = b.left + b.width / 2 - x0, dy = b.top + b.height / 2 - y0;
  const anim = n < 0
    ? f.animate([{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 0 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 26}px)) scale(1)`, opacity: 1, offset: 0.3 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 46}px)) scale(.9)`, opacity: 0 }], { duration: 1100, easing: 'ease-out' })
    : f.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-140%) scale(1.15)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-140%) scale(1)', opacity: 1, offset: 0.55 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.6 }], { duration: 1050, easing: 'cubic-bezier(.45,0,.4,1)' });
  anim.onfinish = () => { f.remove(); paintXP(); };
  if (n < 0) paintXP();
}

// ── progress + XP: gains go to the total as soon as you earn them; a hint's cost is taken from what you earn next ──
const pendingEvents = [];
function logEvent(ev) { pendingEvents.push(Object.assign({ at: Date.now() }, ev)); }
function award(base, fromEl, answer) {
  const n = answer && R.combo >= 3 ? base * 2 : base;
  R.xp += n; flyXP(n, fromEl); commit();
  return n;
}
function commit(patch) {
  const delta = Math.max(0, netXP() - R.committed);
  R.committed += delta; saveRun();
  if (!delta && !pendingEvents.length && !patch) return Promise.resolve(P);
  return syncProgress({ day: DAY, xp: delta, patch: Object.assign({ slide: idx }, patch || {}), events: pendingEvents.splice(0) }).then(p => (P = p));
}
function spend(n, fromEl) { R.cost += n; R.hints++; saveRun(); flyXP(-n, fromEl || $('#xp')); }

// First try decides accuracy and the combo; later tries can still finish the item.
function judge(k, ok) {
  const first = !(k in R.ans);
  if (first) R.ans[k] = ok ? 1 : 0;
  if (ok && first) {
    R.combo++; R.bestCombo = Math.max(R.bestCombo, R.combo);
    if (R.combo === 3) comboPop(); else sfx(R.combo > 3 ? 'combo' : 'correct');
  } else if (ok) sfx('correct');
  else {
    if (R.combo >= 3) toastMini('Combo lost');
    R.combo = 0; sfx('wrong');
  }
  haptic(ok ? 14 : [20, 40, 20]);
  paintCombo(); saveRun();
  return first;
}
function comboPop() {
  sfx('combo');
  const d = document.createElement('div'); d.className = 'combo-pop'; d.setAttribute('role', 'status');
  d.innerHTML = `${ic('flame', 30)}<div><b>Combo!</b><small>3 in a row · double XP</small></div>`;
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 400); }, 1700);
}
function toastMini(t) {
  document.querySelectorAll('.pl-toast').forEach(o => o.remove()); // one at a time, never stacked
  const d = document.createElement('div'); d.className = 'pl-toast'; d.setAttribute('role', 'status'); d.innerHTML = t;
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 350); }, 2000);
}

// ── item views ──
function head(it, s) {
  const kick = KICK[it.kind];
  const title = it.kind === 'arrange' ? 'Arrange the lines' : it.kind === 'fill' ? 'Fill the blank' : s.title;
  const chip = kick && !kick[2].test(title || '') ? `<span class="sl-chip t-${it.kind}">${ic(kick[0], 14)}${kick[1]}</span>` : '';
  if (it.puzzle) return `<div class="sl-head" style="--i:0"><div class="pz-top">${chip}<span class="pz-from">from <b>${esc(s.title)}</b></span></div><h2 class="sl-title">${esc(title)}</h2></div>`;
  return `<div class="sl-head" style="--i:0">${chip ? `<div>${chip}</div>` : ''}<h2 class="sl-title">${esc(title)}</h2></div>`;
}

// A concept as steps: every paragraph and bullet (then the visual) appears on a tap.
function parts(body, vis) {
  let html = '', list = false, n = 0;
  for (const raw of String(body || '').split('\n')) {
    const l = raw.trimEnd();
    if (/^- /.test(l)) { if (!list) { html += '<ul class="rv-ul">'; list = true; } html += `<li class="rv" data-p="${n++}">${mdInline(l.slice(2))}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (l.trim()) html += `<p class="rv" data-p="${n++}">${mdInline(l)}</p>`;
  }
  if (list) html += '</ul>';
  if (vis) html += `<div class="rv rv-vis" data-p="${n++}">${vis}</div>`;
  return { html, n };
}

function body(it, s) {
  const k = it.k, u = U[k];
  const vis = s.visual ? renderVisual(s.visual) : '';
  switch (it.kind) {
    case 'intro': {
      const w = Math.ceil(DAY / 10), c = PLAN.count;
      return `<div class="lv-start" style="--i:1"><span class="lv-day">Day ${DAY}</span><span class="lv-min">${ic('clock', 14)}${D.minutes || 45} min</span></div>
        <div class="sl-body" style="--i:2">${md(s.body)}</div>${vis ? `<div class="sl-vis" style="--i:3">${vis}</div>` : ''}
        <div class="lv-stages" style="--i:4" aria-label="Today's level">${[['book', 'Learn', c[0]], ['dumbbell', 'Practice', c[1]], ['target', 'Challenge', c[2]]].map(([i, t, n], j) => `<div class="lv-st s${j}">${ic(i, 18)}<b>${t}</b><small>${n} ${n === 1 ? 'step' : 'steps'}</small></div>`).join('<span class="lv-arr">' + ic('next', 14) + '</span>')}</div>
        <div class="sl-outs" style="--i:5"><div class="sl-ot">Today you will</div>${(D.outcomes || []).map((o, j) => `<div class="sl-o" style="--j:${j}">${ic('check', 14)}<span>${esc(o)}</span></div>`).join('')}</div>
        <p class="lv-tip" style="--i:6">World ${w} · ${ic('flame', 13)} 3 right in a row starts a combo: double XP.</p>`;
    }
    case 'concept': case 'visual': {
      const p = parts(s.body, vis && `<div class="sl-vis">${vis}</div>`);
      u.n = p.n; if (u.rv == null) u.rv = R.solved[k] || p.n <= 1 ? p.n - 1 : 0;
      return `<div class="rv-wrap sl-body" style="--i:2">${p.html}</div>
        <button class="rv-more" data-act="more" style="--i:3" ${u.rv >= u.n - 1 ? 'hidden' : ''}><span class="rv-dots">${Array.from({ length: p.n }, (_, j) => `<i class="${j <= u.rv ? 'on' : ''}"></i>`).join('')}</span>Tap to reveal the next step</button>`;
    }
    case 'code':
      return `${s.body ? `<div class="sl-body" style="--i:2">${md(s.body)}</div>` : ''}${vis ? `<div class="sl-vis" style="--i:3">${vis}</div>` : ''}
        <div class="sl-ed" style="--i:3" data-ed></div>
        ${stdinBox(s)}
        <div class="sl-acts" style="--i:4"><button class="btn run" data-act="run">${ic('play', 16)}Run</button>${traceable(s) ? `<button class="btn ghost" data-act="trace">${ic('watch', 16)}Watch it run</button>` : ''}<button class="btn icon" data-act="reset" aria-label="Reset code">${ic('reset', 16)}</button></div>
        <div class="sl-con" hidden></div><div class="sl-trace" hidden></div>
        ${s.explain && s.explain.length ? `<div class="sl-exp" style="--i:5"><div class="sl-ot">Line by line</div>${s.explain.map((e, j) => `<button class="sl-ex" data-line="${e[0]}" style="--j:${j}"><b>${e[0]}</b><span>${esc(e[1])}</span></button>`).join('')}</div>` : ''}`;
    case 'predict':
      return `<div class="sl-body" style="--i:1"><p class="q">What will this program print?</p></div><div class="sl-ro" style="--i:2">${codeView(s.code)}</div>
        <div class="tiles out" style="--i:3" role="group" aria-label="Answers">${s.options.map((o, j) => `<button class="tile" data-opt="${j}" style="--j:${j}"><span class="tk">${j + 1}</span><pre>${esc(o)}</pre></button>`).join('')}</div>
        <div class="sl-con" hidden></div><div class="sl-why" hidden></div>`;
    case 'quiz':
      return `<div class="sl-body" style="--i:1"><p class="q">${mdInline(s.q)}</p></div>${s.code ? `<div class="sl-ro" style="--i:2">${codeView(s.code)}</div>` : ''}
        <div class="tiles" style="--i:3" role="group" aria-label="Answers">${s.options.map((o, j) => `<button class="tile" data-opt="${j}" style="--j:${j}"><span class="tk">${'ABCD'[j]}</span><span class="tt">${mdInline(o)}</span></button>`).join('')}</div><div class="sl-why" hidden></div>`;
    case 'arrange':
      return `${goal(s)}<div class="pz-board" style="--i:3"></div>`;
    case 'fill':
      return `${goal(s)}<div class="pz-code" style="--i:3">${fillCode(it)}</div>
        <div class="pz-chips" style="--i:4" role="group" aria-label="Pick the missing piece">${it.puzzle.chips.map((c, j) => `<button class="pz-chip" data-chip="${j}" style="--j:${j}"><code>${esc(c)}</code></button>`).join('')}</div><div class="sl-why" hidden></div>`;
    case 'exercise': case 'bug': case 'project': {
      const labels = testLabels(s.tests);
      u.labels = labels.length ? labels : ['Your program runs', 'All the checks pass'];
      return `<div class="ch-card t-${it.kind}" style="--i:1"><div class="ch-k">${ic(it.kind === 'bug' ? 'bug' : it.kind === 'project' ? 'crown' : 'target', 16)}${it.kind === 'bug' ? 'Fix the bug' : it.kind === 'project' ? 'Boss challenge' : 'Challenge'}<span class="ch-xp">${ic('bolt', 12)}${XP[it.kind]} XP</span></div>
          <div class="sl-body task">${md(s.task || s.brief)}</div>
          ${s.steps ? `<ol class="sl-steps">${s.steps.map(x => `<li>${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ol>` : ''}</div>${vis ? `<div class="sl-vis" style="--i:2">${vis}</div>` : ''}
        <div class="sl-ed" style="--i:3" data-ed></div>${stdinBox(s)}
        <div class="sl-acts" style="--i:4"><button class="btn run" data-act="run">${ic('play', 16)}Run</button><button class="btn pri" data-act="check">${ic('check', 16)}Check</button>
          <button class="btn icon" data-act="reset" aria-label="Start over">${ic('reset', 16)}</button></div>
        <div class="ch-tests" style="--i:5" aria-label="Checks"><div class="ch-th">Checks<small>${R.solved[k] === true ? u.labels.length : 0}/${u.labels.length}</small></div><ol>${u.labels.map((t, j) => `<li data-t="${j}" class="${R.solved[k] === true ? 'ok' : ''}"><i>${ic('check', 12)}</i><span>${esc(t)}</span></li>`).join('')}</ol></div>
        <div class="sl-res" hidden></div>
        <div class="sl-hints"></div>
        <button class="btn ghost hint-btn" data-act="hint" style="--i:6">${ic('bulb', 16)}<span>Hint</span><small>−${HINT_COST} XP</small></button>
        <div class="sl-con" hidden></div>`;
    }
    case 'recap':
      return `<div class="sl-points" style="--i:2">${(s.points || []).map((p, j) => `<div class="sl-pt" style="--j:${j}">${ic('check', 16)}<span>${md(p).replace(/^<p>|<\/p>$/g, '')}</span></div>`).join('')}</div>
        <div class="sl-badge" style="--i:3"><div class="medal">${ic('flag', 22)}</div><div><b>Last step: finish the level</b><small>See your stars, XP and what unlocks next.</small></div></div>`;
  }
  return '';
}
const traceable = s => s.trace !== false && s.code.split('\n').length <= 25 && !(s.needs && s.needs.length);
function stdinBox(s) {
  const src = s.code || s.starter || '';
  if (!s.stdin && !/input\s*\(/.test(src) && !/input\s*\(/.test(s.solution || '')) return '';
  return `<label class="sl-in" style="--i:3"><span>Input <small>one per line</small></span><textarea rows="2" data-stdin spellcheck="false" autocapitalize="off">${esc(s.stdin || '')}</textarea></label>`;
}
function goal(s) {
  if (typeof s.expect !== 'string' || !s.expect.trim()) return '';
  const L = norm(s.expect).split('\n'), cut = L.length > 8;
  return `<div class="pz-goal" style="--i:2"><div class="pz-gh">${ic('target', 14)}It should print</div><pre>${esc(L.slice(0, 8).join('\n'))}${cut ? '\n…' : ''}</pre></div>`;
}

const codeKey = src => `bd.py.code.d${pad(DAY)}.s${src}`;
function startCode(s, src) {
  try { const v = localStorage.getItem(codeKey(src)); if (v != null && TASK.has(s.type)) return v; } catch (e) { /* ignore */ }
  return s.code != null ? s.code : (s.starter || '');
}

function show(k, dir) {
  if (traceCtl) { traceCtl.close(); traceCtl = null; }
  const it = items[k]; idx = k;
  const s = D.slides[it.src];
  U[k] = U[k] || {};
  const el = document.createElement('section');
  el.className = 'sl ' + (dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : 'from-0') + ' t-' + it.kind;
  el.dataset.kind = it.kind; el.dataset.src = it.src; el.dataset.k = k;
  if (it.puzzle) el.dataset.puzzle = it.puzzle.id;
  el.innerHTML = `<div class="sl-card">${it.kind === 'intro' ? '' : head(it, s)}${it.kind === 'intro' ? `<div class="sl-head" style="--i:0"><h2 class="sl-title">${esc(String(s.title || '').replace(/^Mission\s*\d+\s*:\s*/i, ''))}</h2><p class="lv-sub">${esc(D.subtitle || '')}</p></div>` : ''}${body(it, s)}</div>`;
  const old = stage.querySelector('.sl.in');
  if (old) { old.classList.remove('in'); old.classList.add(dir >= 0 ? 'out-l' : 'out-r'); setTimeout(() => old.remove(), 420); }
  stage.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  window.scrollTo({ top: 0 });
  const edHost = el.querySelector('[data-ed]');
  if (edHost) {
    const label = s.type === 'code' ? 'example.py' : 'main.py';
    editors[k] = createEditor(edHost, { value: startCode(s, it.src), label, onRun: () => run(el, s, k), onChange: v => { if (TASK.has(s.type)) try { localStorage.setItem(codeKey(it.src), v); } catch (e) { /* ignore */ } } });
    const bl = bugLine(s);
    if (bl && !R.solved[k]) { editors[k].mark(bl, 'bug'); el.querySelector('.ed-head').insertAdjacentHTML('beforeend', `<span class="ed-bug">${ic('bug', 13)}Bug on line ${bl}</span>`); }
  } else delete editors[k];
  if (it.kind === 'arrange') { U[k].placed = U[k].placed || new Array(it.puzzle.lines.length).fill(null); U[k].lock = U[k].lock || []; if (R.solved[k] && U[k].placed.some(x => x == null)) U[k].placed = it.puzzle.lines.map((_, j) => j); paintBoard(el, it); }
  if (REVEAL.has(it.kind)) paintReveal(el, it, false);
  if (R.solved[k]) restore(el, it, s);
  mountVisual(el);
  wire(el, it, s);
  fb(null);
  paintHud(); paintFoot();
  if (dir > 0 && it.stage !== shownStage && it.stage !== 'learn') stageToast(it.stage);
  shownStage = it.stage;
  saveRun();
  if (k > 0) commit();
}

// Coming back to an item you already finished shows it finished.
function restore(el, it, s) {
  const u = U[it.k];
  if ((it.kind === 'predict' || it.kind === 'quiz') && s.answer != null) {
    el.querySelectorAll('.tile').forEach((b, j) => { b.disabled = true; b.classList.toggle('right', j === s.answer); b.classList.toggle('wrong', u.pick === j && j !== s.answer); });
    showWhy(el, u.pick == null || u.pick === s.answer, s.why, true);
  }
  if (it.kind === 'fill') {
    el.querySelectorAll('.pz-chip').forEach(b => { b.disabled = true; b.classList.toggle('right', b.textContent === it.puzzle.token); });
    const bl = el.querySelector('.pz-blank'); bl.textContent = it.puzzle.token; bl.className = 'pz-blank right';
    showWhy(el, true, fillWhy(it, s), true);
  }
}

function paintFoot() {
  const it = items[idx], u = U[idx] || {}, last = idx === items.length - 1, done = !!R.solved[idx];
  const next = $('#next');
  let label = '', act = 'next', dis = false;
  if (REVEAL.has(it.kind) && u.rv < u.n - 1) { label = 'Next'; act = 'more'; }
  else if (CHOICE.has(it.kind) && !done) { label = 'Pick an answer'; dis = true; }
  else if (it.kind === 'arrange' && !done) { act = 'check'; label = u.busy ? 'Checking…' : 'Check'; dis = !!u.busy || u.placed.some(x => x == null); }
  else if (TASK.has(it.kind) && !done) { label = 'Pass the checks'; dis = true; }
  if (!label) label = last ? `Finish level ${ic('flag', 16)}` : `Continue ${ic('next', 16)}`;
  next.dataset.act = act; next.disabled = dis; next.innerHTML = label;
  $('#back').disabled = idx === 0;
}

// The footer turns green or red with a short verdict (the explanation slides in on the card).
function fb(kind, title, sub) {
  const box = $('#fb');
  foot.dataset.fb = kind || '';
  if (!kind) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span class="fb-ic">${ic(kind === 'ok' ? 'check' : 'x', 22)}</span><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  paintFoot();
}

function stageToast(st) {
  const T = { practice: ['dumbbell', 'Practice', 'Predict, quiz and puzzles. 3 right in a row = combo.'], challenge: ['target', 'Challenge', 'Write real code. Pass the checks.'], recap: ['flag', 'Recap', 'What you can do now.'] }[st];
  if (!T) return;
  const n = STAGES.findIndex(s => s.id === st) + 1;
  toastMini(`${ic(T[0], 16)}<span><b>Stage ${n} · ${T[1]}</b><small>${T[2]}</small></span>`);
}

// ── concept reveal ──
function paintReveal(el, it, animate) {
  const u = U[it.k];
  el.querySelectorAll('.rv').forEach(p => {
    const j = +p.dataset.p, on = j <= u.rv;
    if (on && !p.classList.contains('on')) { p.classList.add('on'); if (animate) { p.classList.add('new'); setTimeout(() => p.classList.remove('new'), 1200); } }
  });
  el.querySelectorAll('.rv-dots i').forEach((d, j) => d.classList.toggle('on', j <= u.rv));
  const more = el.querySelector('.rv-more'); if (more) more.hidden = u.rv >= u.n - 1;
  if (u.rv >= u.n - 1) R.solved[it.k] = true;
}
function reveal(el, it) {
  const u = U[it.k]; if (u.rv >= u.n - 1) return;
  u.rv++; sfx('tap'); haptic(6);
  paintReveal(el, it, true);
  const p = el.querySelector(`.rv[data-p="${u.rv}"]`);
  if (p) { if (p.classList.contains('rv-vis')) mountVisual(p); setTimeout(() => { const r = p.getBoundingClientRect(), fh = foot.getBoundingClientRect().top; if (r.bottom > fh - 12) window.scrollBy({ top: r.bottom - fh + 28, behavior: calm() ? 'auto' : 'smooth' }); }, 60); }
  paintHud(); paintFoot(); saveRun();
}

// ── interactions ──
function wire(el, it, s) {
  const k = it.k;
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-act],[data-opt],[data-line],[data-chip],[data-t],[data-slot]');
    if (!t) { if (REVEAL.has(it.kind) && !e.target.closest('a,button,input,textarea,.vx')) reveal(el, it); return; }
    const a = t.dataset.act;
    if (a === 'more') return reveal(el, it);
    if (a === 'all') { el.querySelector('.pz-code .cv-code').classList.remove('part'); t.remove(); return; }
    if (a === 'run') return run(el, s, k);
    if (a === 'trace') return trace(el, s, k);
    if (a === 'reset') { const ed = editors[k]; if (ed) { ed.value = s.code != null ? s.code : (s.starter || ''); try { localStorage.removeItem(codeKey(it.src)); } catch (er) { /* ignore */ } } return; }
    if (a === 'check') return check(el, it, s);
    if (a === 'hint') return hint(el, it, s, t);
    if (a === 'solution') return solution(el, it, s, t);
    if (a === 'skip') return skip(it);
    if (a === 'askbro') { window.bdCoach && window.bdCoach.open(t.dataset.q || ''); return; }
    if (t.dataset.line) { const ed = editors[k]; if (ed) { ed.clearMarks(); ed.mark(+t.dataset.line, 'focus'); } el.querySelectorAll('.sl-ex').forEach(b => b.classList.toggle('on', b === t)); haptic(8); return; }
    if (t.dataset.opt != null) return answer(el, it, s, +t.dataset.opt, t);
    if (t.dataset.chip != null) return fillPick(el, it, s, +t.dataset.chip, t);
    if (t.dataset.t != null && it.kind === 'arrange') return movePool(el, it, +t.dataset.t, t);
    if (t.dataset.slot != null && it.kind === 'arrange') return moveBack(el, it, +t.dataset.slot, t);
  });
}

function stdinOf(el) { const t = el.querySelector('[data-stdin]'); return t ? t.value : ''; }

function consoleEl(el) {
  const c = el.querySelector('.sl-con'); c.hidden = false;
  c.innerHTML = `<div class="con-h"><span>Output</span><span class="con-st"><span class="spin"></span>running…</span></div><pre class="con-o"></pre><div class="con-err" hidden></div>`;
  return c;
}

// Output arrives line by line, like a real terminal.
function paintResult(c, res, k, ms) {
  const o = c.querySelector('.con-o'), st = c.querySelector('.con-st'), er = c.querySelector('.con-err');
  let lines = 0;
  if (res.log && res.log.length) {
    const total = res.log.reduce((a, x) => a + x[1].length, 0);
    if (total > 20000) {
      const tail = res.log.map(x => x[1]).join('').slice(-6000);
      o.innerHTML = `<span class="dim">… ${total.toLocaleString('en-IN')} characters printed; showing the end …</span>\n` + esc(tail);
    } else {
      // split into lines so each one can slide in
      const parts = [];
      res.log.forEach(([n, t]) => String(t).split(/(?<=\n)/).forEach(seg => parts.push([n, seg])));
      o.innerHTML = parts.map(([n, t]) => { const cls = n === 'out' ? '' : n === 'echo' ? 'echo' : 'stderr'; const d = t.endsWith('\n') ? lines++ : lines; return `<span class="ln ${cls}" style="--d:${Math.min(d, 40)}">${esc(t)}</span>`; }).join('');
    }
  }
  if (!o.textContent.trim() && res.ok) o.innerHTML = '<span class="dim">(nothing was printed)</span>';
  st.innerHTML = res.ok ? `${ic('check', 13)}ran${ms != null ? ` in ${ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'}` : ''}` : esc((res.error && res.error.type) || 'error');
  st.className = 'con-st ' + (res.ok ? 'ok' : 'bad');
  c.classList.toggle('good', !!res.ok); c.classList.toggle('bad', !res.ok);
  if (!res.ok && res.error) {
    lastError[k] = { type: res.error.type, text: res.error.text, line: res.error.line, tb: res.error.tb };
    const hint = PY.hintFor(res.error);
    er.hidden = false;
    er.innerHTML = `<div class="err-t">${esc(res.error.text)}${res.error.line ? ` <small>line ${res.error.line}</small>` : ''}</div>${hint ? `<div class="err-h">${ic('bulb', 14)}${esc(hint)}</div>` : ''}
      ${res.error.tb && res.error.tb.split('\n').length > 1 ? `<details><summary>Full traceback</summary><pre>${esc(res.error.tb)}</pre></details>` : ''}
      <button class="btn small ghost" data-act="askbro" data-q="Why do I get this error? ${esc(res.error.text)}">Ask Bro</button>`;
    const ed = editors[k]; if (ed && res.error.line) { ed.clearMarks(); ed.mark(res.error.line, 'err'); }
  }
}

async function run(el, s, k) {
  const ed = editors[k]; if (!ed) return;
  const c = consoleEl(el); const o = c.querySelector('.con-o');
  el.querySelector('.sl-trace') && (el.querySelector('.sl-trace').hidden = true);
  const btn = el.querySelector('[data-act="run"]'); btn.disabled = true; btn.classList.add('busy');
  haptic(8);
  if (PY.state.status === 'starting' || PY.state.status === 'cold') c.querySelector('.con-st').innerHTML = '<span class="spin"></span>starting Python…';
  const t0 = performance.now();
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el), files: s.files, needs: s.needs, mode: 'run' }, {
    onOut: (n, t) => { if (o.childNodes.length > 400) return; o.insertAdjacentHTML('beforeend', n === 'out' ? esc(t) : `<span class="${n === 'echo' ? 'echo' : 'stderr'}">${esc(t)}</span>`); },
    onStatus: t => { c.querySelector('.con-st').textContent = t; },
  });
  btn.disabled = false; btn.classList.remove('busy');
  o.innerHTML = '';
  paintResult(c, res, k, Math.round(performance.now() - t0));
  if (res.ok) { sfx('go'); haptic(10); } else { sfx('wrong'); haptic([20, 40, 20]); }
  if (s.type === 'code' && res.ok && !U[k].ran) { U[k].ran = true; R.solved[k] = true; award(XP.run, btn, false); logEvent({ kind: 'run', ok: true, slide: k + 1 }); }
  if (!res.ok) logEvent({ kind: 'error', type: res.error && res.error.type, text: res.error && res.error.text, slide: k + 1 });
  c.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'nearest' });
  paintHud();
}

async function trace(el, s, k) {
  const ed = editors[k]; if (!ed) return;
  const host = el.querySelector('.sl-trace'); host.hidden = false;
  host.innerHTML = '<div class="tr-loading"><span class="spin"></span>Recording every step…</div>';
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el), files: s.files, mode: 'trace' });
  if (traceCtl) traceCtl.close();
  traceCtl = openTrace(host, { code: ed.value, res, onClose: () => { host.hidden = true; } });
  host.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  sfx('flip');
  if (!U[k].ran && s.type === 'code') { U[k].ran = true; R.solved[k] = true; award(XP.run, el.querySelector('[data-act="trace"]'), false); paintHud(); }
}

// ── predict + quiz: tap a tile, know at once ──
async function answer(el, it, s, j, btn) {
  const k = it.k, u = U[k];
  if (R.solved[k] || u.busy) return;
  u.busy = true; u.pick = j;
  const ok = j === s.answer;
  const tiles = el.querySelectorAll('.tile');
  tiles.forEach(b => { b.disabled = true; });
  btn.classList.add('picked');
  tiles[s.answer].classList.add('right');
  if (!ok) btn.classList.add('wrong');
  const first = judge(k, ok);
  R.solved[k] = true;
  let got = 0;
  if (ok) { got = award(XP[it.kind], btn, first); confetti(btn, 22); }
  fb(ok ? 'ok' : 'no', ok ? pick(['Nailed it!', 'Spot on!', 'Correct!', 'Exactly right.']) : 'Not quite', ok ? `+${got} XP${R.combo >= 3 ? ' · combo ×2' : ''}` : 'The right answer is glowing. Read why below.');
  logEvent({ kind: it.kind, ok, slide: it.src + 1, title: s.title });
  if (it.kind === 'predict') {
    const c = consoleEl(el); c.querySelector('.con-st').innerHTML = '<span class="spin"></span>running for real…';
    const res = await PY.run({ code: s.code, stdin: s.stdin || '', files: s.files, needs: s.needs, mode: 'run' });
    const out = c.querySelector('.con-o'); out.textContent = '';
    await typeOut(out, res.ok ? res.out : (res.error && res.error.text) || '');
    const st = c.querySelector('.con-st'); st.innerHTML = `${ic('check', 13)}real output`; st.className = 'con-st ok';
  }
  showWhy(el, ok, s.why);
  u.busy = false;
  paintHud(); paintFoot(); commit();
}
function showWhy(el, ok, why, still) {
  const box = el.querySelector('.sl-why'); if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="why ${ok ? 'ok' : 'no'}${still ? ' still' : ''}"><span class="why-k">${ic(ok ? 'check' : 'bulb', 14)}${ok ? 'Why it works' : 'Here is why'}</span>${md(why).replace(/^<p>|<\/p>$/g, '')}</div>`;
  if (!still) setTimeout(() => box.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'nearest' }), 120);
}
function typeOut(pre, text) {
  if (calm()) { pre.textContent = text; return Promise.resolve(); }
  return new Promise(res => { let i = 0; const step = Math.max(1, Math.ceil(text.length / 50)); const t = setInterval(() => { i += step; pre.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(t); res(); } }, 16); });
}

// ── fill the blank ──
// Long programs show the lines around the blank first; one tap shows the whole thing.
function fillCode(it) {
  const p = it.puzzle, L = p.code.split('\n'), long = L.length > 9;
  const from = long ? Math.max(0, Math.min(p.line - 4, L.length - 8)) : 0, to = long ? from + 7 : L.length - 1;
  return `<div class="cv-code${long ? ' part' : ''}">${L.map((l, i) => `<div class="cv-line${i === p.line ? ' bl' : ''}${i < from || i > to ? ' far' : ''}"><span class="cv-n">${i + 1}</span><span class="cv-t">${i === p.line ? `${highlight(p.before)}<span class="pz-blank" aria-label="blank"></span>${highlight(p.after)}` : highlight(l) || ' '}</span></div>`).join('')}</div>
    ${long ? `<button class="pz-all" data-act="all">Show the whole program · ${L.length} lines</button>` : ''}`;
}
function fillWhy(it, s) {
  const p = it.puzzle, line = p.before + p.token + p.after;
  const ex = (s.explain || []).find(e => e[0] === p.line + 1);
  const what = { kw: 'the keyword', bi: 'the built-in', op: 'the operator', name: 'the name' }[p.tokenKind] || '';
  return `Line ${p.line + 1} reads \`${line.trim()}\`. ${ex ? ex[1] : `The missing piece is ${what} \`${p.token}\`.`}`;
}
async function fillPick(el, it, s, j, btn) {
  const k = it.k, u = U[k], p = it.puzzle;
  if (R.solved[k]) return;
  const chip = p.chips[j], ok = chip === p.token;
  u.pick = j;
  el.querySelectorAll('.pz-chip').forEach(b => { b.disabled = true; });
  const blank = el.querySelector('.pz-blank');
  blank.textContent = chip; blank.className = 'pz-blank ' + (ok ? 'right' : 'wrong');
  btn.classList.add(ok ? 'right' : 'wrong');
  const first = judge(k, ok);
  R.solved[k] = true;
  let got = 0;
  if (ok) { got = award(XP.fill, btn, first); confetti(blank, 18); }
  else {
    await sleep(750);
    blank.textContent = p.token; blank.className = 'pz-blank right fix';
    el.querySelectorAll('.pz-chip').forEach(b => { if (b.textContent === p.token) b.classList.add('right'); });
  }
  fb(ok ? 'ok' : 'no', ok ? pick(['Perfect fit!', 'Nailed it!', 'Exactly.']) : 'Not this one', ok ? `+${got} XP${R.combo >= 3 ? ' · combo ×2' : ''}` : `The missing piece is ${p.token}`);
  showWhy(el, ok, fillWhy(it, s));
  logEvent({ kind: 'fill', ok, slide: it.src + 1, title: s.title });
  paintHud(); paintFoot(); commit();
}

// ── arrange the lines: tap a line to place it, tap a placed line to send it back ──
const indentOf = l => Math.round(((/^\s*/.exec(l) || [''])[0].replace(/\t/g, '    ').length) / 4);
const codeLine = l => `<code style="--ind:${indentOf(l)}">${highlight(l.trim())}</code>`;
function paintBoard(el, it) {
  const p = it.puzzle, u = U[it.k], solved = !!R.solved[it.k];
  const board = el.querySelector('.pz-board');
  const ctx = (L, more, where) => L.length ? `<div class="pz-ctx ${where}">${where === 'pre' && more ? '<div class="pz-more">⋯</div>' : ''}${L.map(l => `<div class="pz-fixed">${codeLine(l)}</div>`).join('')}${where === 'post' && more ? '<div class="pz-more">⋯</div>' : ''}</div>` : '';
  board.innerHTML = `<div class="pz-ans${solved ? ' solved' : ''}" aria-label="Your program">${ctx(p.before, p.more, 'pre')}
      ${u.placed.map((t, i) => t == null ? `<div class="pz-slot empty"><span class="pz-n">${i + 1}</span><span class="pz-hole"></span></div>`
        : `<button class="pz-slot${u.lock.includes(i) ? ' lock' : ''}${solved ? ' ok' : ''}" data-slot="${i}" data-tile="${t}" ${u.lock.includes(i) || solved ? 'disabled' : ''} aria-label="Line ${i + 1}: ${esc(p.lines[t].trim())}. Tap to take it back."><span class="pz-n">${i + 1}</span>${codeLine(p.lines[t])}</button>`).join('')}
      ${ctx(p.after, p.moreAfter, 'post')}</div>
    <div class="pz-ph">${solved ? 'Solved' : u.placed.every(x => x != null) ? 'All placed. Tap <b>Check</b>.' : 'Tap the lines in the order they run'}</div>
    <div class="pz-pool" role="group" aria-label="Lines to place">${p.order.map(t => u.placed.includes(t) ? `<span class="pz-tile ghost">${codeLine(p.lines[t])}</span>` : `<button class="pz-tile" data-t="${t}" aria-label="${esc(p.lines[t].trim())}">${codeLine(p.lines[t])}</button>`).join('')}</div>`;
}
// FLIP: the line glides from where it was to where it lands
function glide(el, sel, from) {
  const to = el.querySelector(sel); if (!to || !from || calm() || !to.animate) return;
  const r = to.getBoundingClientRect();
  to.animate([{ transform: `translate(${from.left - r.left}px, ${from.top - r.top}px)`, opacity: 0.85 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function movePool(el, it, t, btn) {
  const u = U[it.k]; if (R.solved[it.k] || u.busy) return;
  const slot = u.placed.indexOf(null); if (slot < 0) return;
  const from = btn.getBoundingClientRect();
  u.placed[slot] = t; sfx('tap'); haptic(6);
  paintBoard(el, it); glide(el, `.pz-slot[data-tile="${t}"]`, from); paintFoot();
}
function moveBack(el, it, i, btn) {
  const u = U[it.k]; if (R.solved[it.k] || u.busy || u.lock.includes(i)) return;
  const t = u.placed[i], from = btn.getBoundingClientRect();
  u.placed[i] = null;
  // close the gap so the answer stays a top-to-bottom list
  const rest = u.placed.map((x, j) => (u.lock.includes(j) ? null : x)).filter(x => x != null);
  u.placed = u.placed.map((x, j) => (u.lock.includes(j) ? x : null));
  rest.forEach(x => { const j = u.placed.indexOf(null); u.placed[j] = x; });
  sfx('tap'); haptic(6);
  paintBoard(el, it); glide(el, `.pz-tile[data-t="${t}"]`, from); paintFoot();
}
async function checkArrange(el, it, s) {
  const k = it.k, u = U[k], p = it.puzzle;
  if (R.solved[k] || u.busy || u.placed.some(x => x == null)) return;
  let ok = u.placed.every((t, i) => p.lines[t] === p.lines[i]), also = false;
  if (!ok && typeof s.expect === 'string' && !(s.needs && s.needs.length)) {
    // another order can be just as right: if the program still prints the same thing, it counts
    u.busy = true; paintFoot();
    const res = await PY.run({ code: withBlock(s.code, p, u.placed), stdin: s.stdin || '', files: s.files, mode: 'run' });
    u.busy = false;
    also = res.ok && norm(res.out) === norm(s.expect);
  }
  const slots = [...el.querySelectorAll('.pz-slot')];
  if (ok || also) {
    const first = judge(k, true);
    R.solved[k] = true;
    slots.forEach((b, i) => setTimeout(() => b.classList.add('ok'), calm() ? 0 : i * 90));
    await sleep(slots.length * 90);
    const got = award(first ? XP.arrange : 5, el.querySelector('.pz-ans'), first);
    el.querySelector('.pz-ans').classList.add('solved');
    el.querySelector('.pz-ph').textContent = also ? 'Solved: a different order that prints the same' : 'Solved';
    fb('ok', also ? 'That works too!' : pick(['Perfect order!', 'Clean build!', 'Nailed it!']), `+${got} XP${R.combo >= 3 && first ? ' · combo ×2' : ''}`);
    logEvent({ kind: 'arrange', ok: true, slide: it.src + 1, first });
  } else {
    judge(k, false);
    const wrong = [];
    u.placed.forEach((t, i) => { if (p.lines[t] === p.lines[i]) { if (!u.lock.includes(i)) u.lock.push(i); } else wrong.push(i); });
    slots.forEach((b, i) => b.classList.add(wrong.includes(i) ? 'no' : 'ok'));
    fb('no', 'Not quite', `${u.placed.length - wrong.length} of ${u.placed.length} in the right place. Try again.`);
    u.busy = true; paintFoot();
    await sleep(950);
    u.busy = false;
    wrong.forEach(i => { u.placed[i] = null; });
    // the wrong lines go back to the pool; the right ones stay, locked
    const keep = u.placed.map((x, j) => (u.lock.includes(j) ? x : null));
    u.placed = keep;
    paintBoard(el, it);
    logEvent({ kind: 'arrange', ok: false, slide: it.src + 1 });
  }
  paintHud(); paintFoot(); commit();
}

// ── challenges: bug fixes, exercises, the project ──
async function check(el, it, s) {
  const k = it.k, u = U[k], ed = editors[k]; if (!ed || u.busy) return;
  const r = el.querySelector('.sl-res'); r.hidden = false; r.innerHTML = '<div class="res info"><span class="spin"></span>Running the checks…</div>';
  const btn = el.querySelector('[data-act="check"]'); btn.disabled = true; u.busy = true;
  const res = await PY.run({ code: ed.value, stdin: stdinOf(el) || s.stdin || '', files: s.files, needs: s.needs, tests: s.tests, mode: 'test' });
  btn.disabled = false; u.busy = false;
  const c = consoleEl(el); paintResult(c, res, k);
  const t = res.test || { passed: false, msg: res.error ? res.error.text : 'Could not check.' };
  const lis = [...el.querySelectorAll('.ch-tests li')], count = el.querySelector('.ch-th small');
  lis.forEach(li => li.classList.remove('ok', 'no', 'lit'));
  if (t.passed) {
    const wasSolved = !!R.solved[k];
    const first = wasSolved ? false : judge(k, true);
    R.solved[k] = true;
    r.innerHTML = '';
    // every check lights up, one by one, then the star
    for (let j = 0; j < lis.length; j++) { lis[j].classList.add('ok', 'lit'); count.textContent = `${j + 1}/${lis.length}`; sfx('tick'); await sleep(200); }
    sfx('star');
    if (!wasSolved) {
      const got = award(first ? XP[it.kind] : Math.round(XP[it.kind] / 2), el.querySelector('.ch-tests'), first);
      fb('ok', pick(['All checks passed!', 'It works!', 'Shipped!']), `+${got} XP · ${first ? 'first try' : 'you debugged it, that is the job'}`);
      confetti(el.querySelector('.ch-tests'), 60);
      logEvent({ kind: 'check', ok: true, slide: it.src + 1, tries: (u.fails || 0) + 1 });
      el.querySelector('.ed-bug') && el.querySelector('.ed-bug').remove();
    }
  } else {
    u.fails = (u.fails || 0) + 1;
    if (!R.solved[k]) judge(k, false);
    lastError[k] = { type: 'CheckFailed', text: t.msg };
    // the failing check turns red; the ones before it passed
    const msg = String(t.msg || '');
    const at = t.stage === 'run' ? -1 : u.labels.findIndex(l => { const a = l.replace(/…$/, '').slice(0, 26).toLowerCase(); return a.length > 6 && msg.toLowerCase().startsWith(a.split('…')[0]); });
    if (at >= 0) { lis.forEach((li, j) => { if (j < at) li.classList.add('ok'); else if (j === at) li.classList.add('no'); }); count.textContent = `${at}/${lis.length}`; }
    r.innerHTML = `<div class="res no"><b>${t.stage === 'run' ? 'Your program crashed.' : 'Not yet.'}</b> ${esc(t.msg)}</div>
      <div class="res-acts">${u.fails >= 2 ? `<button class="btn small ghost" data-act="solution">${ic('key', 14)}Solution<small>−${SOLUTION_COST} XP</small></button><button class="btn small ghost" data-act="skip">Skip for now</button>` : ''}<button class="btn small ghost" data-act="askbro" data-q="My check fails: ${esc(t.msg)}. Can you give me a hint (not the answer)?">Ask Bro</button></div>`;
    fb('no', t.stage === 'run' ? 'It crashed' : 'Not yet', 'Read the message, fix, check again.');
    logEvent({ kind: 'check', ok: false, slide: it.src + 1, title: s.title, msg: t.msg });
  }
  paintHud(); paintFoot(); commit();
  r.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'nearest' });
}

function hint(el, it, s, btn) {
  const box = el.querySelector('.sl-hints'), n = box.querySelectorAll('.hint').length, hs = s.hints || [];
  if (n >= hs.length) return;
  spend(HINT_COST, btn);
  box.insertAdjacentHTML('beforeend', `<div class="hint">${ic('bulb', 14)}<span><b>Hint ${n + 1}.</b> ${md(hs[n]).replace(/^<p>|<\/p>$/g, '')}</span></div>`);
  sfx('flip');
  if (n + 1 >= hs.length) { btn.disabled = true; btn.innerHTML = `${ic('bulb', 16)}<span>No more hints</span>`; }
  else btn.querySelector('span').textContent = `Hint ${n + 2}`;
  logEvent({ kind: 'hint', slide: it.src + 1 });
}
function solution(el, it, s, btn) {
  const ed = editors[it.k]; if (!ed) return;
  spend(SOLUTION_COST, btn);
  ed.value = s.solution;
  el.querySelector('.sl-res').innerHTML = '<div class="res info">Here is a working solution. Read it line by line, then tap <b>Check</b>.</div>';
}
function skip(it) {
  if (!(it.k in R.ans)) judge(it.k, false);
  R.combo = 0; paintCombo();
  logEvent({ kind: 'skip', slide: it.src + 1 });
  R.solved[it.k] = 'skipped';
  go(1);
}

// ── level complete ──
async function complete() {
  saveRun();
  const answered = Object.keys(R.ans).filter(k => items[k] && ANSWERABLE.has(items[k].kind));
  const right = answered.filter(k => R.ans[k]).length;
  const acc = answered.length ? right / answered.length : 1;
  const stars = acc >= 0.9 && !R.hints ? 3 : acc >= 0.7 ? 2 : 1;
  const before = progress.read(), prev = before.days['d' + DAY] || {};
  const xpBefore = before.xp || 0;
  R.xp += XP.level + XP.star * stars;
  const levelXP = netXP();
  const best = Math.max(starsOf(prev), stars);
  logEvent({ kind: 'complete', stars, acc: Math.round(acc * 100), hints: R.hints });
  P = await commit({ done: true, slide: 0, stars: best, xp: Math.max(prev.xp || 0, levelXP), best: Math.max(prev.best || 0, stars * 33), doneAt: new Date().toISOString() });
  try { localStorage.removeItem(RUNKEY); } catch (e) { /* ignore */ }
  const xpAfter = P.xp || xpBefore + levelXP, r0 = rankOf(xpBefore), r1 = rankOf(xpAfter);
  const nxt = DAY < 60 ? DAY + 1 : null;
  const nextTitle = nxt ? await fetch('/code/days/index.json').then(r => r.json()).then(j => ((j.list || []).find(d => d.day === nxt) || {}).title).catch(() => '') : '';
  const mins = Math.max(1, Math.round(R.ms / 60000));
  const title = stars === 3 ? 'Perfect level!' : stars === 2 ? 'Great job!' : 'Level complete';
  const ov = document.createElement('div'); ov.className = 'lc'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', `Day ${DAY} complete, ${stars} of 3 stars`);
  ov.innerHTML = `<div class="lc-in">
    <div class="lc-bro">${window.mascot ? window.mascot('celebrating', 112) : ''}</div>
    <div class="lc-k">Day ${DAY} complete</div><h2>${nxt ? title : 'You graduated!'}</h2>
    <div class="lc-stars" data-stars="${stars}">${[0, 1, 2].map(j => `<i class="${j < stars ? 'won' : ''}" style="--j:${j}">${ic('star', j === 1 ? 64 : 52)}</i>`).join('')}</div>
    <div class="lc-stats">
      <div class="xp"><small>${ic('bolt', 13)}Total XP</small><b data-n="${levelXP}">0</b></div>
      <div class="acc"><small>${ic('target', 13)}Accuracy</small><b data-n="${Math.round(acc * 100)}" data-u="%">0%</b></div>
      <div class="time"><small>${ic('clock', 13)}Time</small><b>${mins} min</b></div>
    </div>
    <div class="lc-rank r${r1.i}"><span class="lc-badge">${ic(['seed', 'code', 'build', 'term', 'bolt', 'crown'][r1.i], 20)}</span>
      <div class="lc-rt"><b>${r1.i > r0.i ? `Rank up: ${r1.name}!` : r1.name}</b><span class="lc-bar"><i style="width:${(r0.i === r1.i ? r0.pct : 0) * 100}%" data-w="${r1.pct * 100}"></i></span><small>${r1.next ? `${r1.toNext.toLocaleString('en-IN')} XP to ${r1.next.name}` : 'Top rank'}</small></div></div>
    ${nxt ? `<div class="lc-unlock"><span class="lc-ui">${ic('unlock', 22)}</span><div><b>Day ${nxt} unlocked</b><small>${esc(nextTitle || '')}</small></div></div>` : ''}
    <div class="lc-acts">
      ${nxt ? `<a class="btn pri big" href="/code/day.html?d=${nxt}" id="lcNext">Continue ${ic('next', 16)}</a>` : `<a class="btn pri big" href="/code/?from=${DAY}">See your map</a>`}
      ${stars < 3 ? `<a class="btn ghost" href="/code/day.html?d=${DAY}" id="lcReplay">${ic('replay', 16)}Replay for 3 stars</a>` : ''}
      <a class="btn ghost" href="/code/?from=${DAY}" id="lcMap">${ic('map', 16)}Map</a>
    </div></div>`;
  document.body.appendChild(ov);
  document.body.classList.add('lc-open');
  requestAnimationFrame(() => ov.classList.add('in'));
  sfx('levelup'); haptic([30, 60, 30]);
  await sleep(650);
  const st = [...ov.querySelectorAll('.lc-stars i')];
  for (let j = 0; j < stars; j++) { st[j].classList.add('pop'); sfx('star'); await sleep(420); }
  ov.querySelectorAll('[data-n]').forEach(b => countUp(b, +b.dataset.n, b.dataset.u || ''));
  await sleep(700);
  const bar = ov.querySelector('.lc-bar i'); bar.style.width = bar.dataset.w + '%';
  if (r1.i > r0.i) { ov.querySelector('.lc-rank').classList.add('up'); sfx('levelup'); }
  await sleep(600);
  const un = ov.querySelector('.lc-unlock');
  if (un) { un.classList.add('in'); sfx('unlock'); confetti(ov, 120); }
  else confetti(ov, 160);
  ov.classList.add('done');
}
function countUp(el, n, unit) {
  if (calm()) { el.textContent = n + unit; return; }
  const t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(n * e) + unit; if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ── navigation ──
function go(dir) {
  if (dir > 0) { if (idx >= items.length - 1) return complete(); show(idx + 1, 1); }
  else if (idx > 0) show(idx - 1, -1);
}
$('#next').addEventListener('click', () => {
  const it = items[idx], el = stage.querySelector('.sl.in'), act = $('#next').dataset.act;
  if (act === 'more') return reveal(el, it);
  if (act === 'check') return checkArrange(el, it, D.slides[it.src]);
  sfx('tap');
  go(1);
});
$('#back').addEventListener('click', () => go(-1));
$('#snd').addEventListener('click', () => {
  if (!window.Sfx) return;
  window.Sfx.setMuted(!window.Sfx.muted()); window.Sfx.unlock(); paintSnd();
  if (!window.Sfx.muted()) sfx('tap');
});
// browsers start audio only after a tap
addEventListener('pointerdown', () => { try { window.Sfx && window.Sfx.unlock(); } catch (e) { /* ignore */ } }, { once: true });
document.addEventListener('keydown', e => {
  if (e.target.closest('textarea,input') || document.querySelector('.lc') || !items.length) return;
  const el = stage.querySelector('.sl.in');
  if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('button,a,summary'))) { if (!$('#next').disabled) { e.preventDefault(); $('#next').click(); } }
  else if (e.key === 'ArrowLeft') $('#back').click();
  else if (/^[1-4]$/.test(e.key) && el) { const t = el.querySelectorAll('.tile:not(:disabled), .pz-chip:not(:disabled)')[+e.key - 1]; if (t) t.click(); }
});
PY.onStatus(st => { const el = $('#pyst'); if (!el) return; el.dataset.s = st.status; const t = st.status === 'ready' || st.status === 'running' ? 'Python ready' : st.status === 'error' ? 'Python offline' : 'Starting Python'; el.setAttribute('aria-label', t); el.title = st.note || t; });
addEventListener('pagehide', () => { saveRun(); if (pendingEvents.length) syncProgress({ day: DAY, events: pendingEvents.splice(0) }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick = Date.now(); else saveRun(); });
// the stage leaves room for the footer, which grows when a verdict slides in
if (window.ResizeObserver) new ResizeObserver(() => document.body.style.setProperty('--foot-h', foot.offsetHeight + 'px')).observe(foot);
load();
