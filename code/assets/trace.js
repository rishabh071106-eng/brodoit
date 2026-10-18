// "Watch it run": replays a program step by step from the harness trace — the current line,
// every variable (changes flash), the call stack and the output as it appears, with a caption
// that says what just happened in plain English.
import { esc } from './lib.js';
import { codeView } from './editor.js';

function valueHTML(v) {
  if (v.items) return `<span class="tv-items">${v.items.map(x => `<i>${esc(x)}</i>`).join('') || '<em>empty</em>'}</span>`;
  if (v.kv) return `<span class="tv-items kv">${v.kv.map(p => `<i><b>${esc(p[0])}</b>${esc(p[1])}</i>`).join('') || '<em>empty</em>'}</span>`;
  return `<span class="tv-r">${esc(v.r)}</span>`;
}

function caption(prev, step, lines) {
  const name = s => s[s.length - 1];
  if (step.e === 'ret') return `${name(step.s)}() returns ${step.ret ? step.ret.r : 'None'}`;
  if (step.e === 'exc') return `An exception happens: ${step.exc}`;
  if (prev && step.s.length > prev.s.length) return `Calling ${name(step.s)}()`;
  const before = new Map([...(prev ? (prev.loc || prev.g) : [])].map(x => [x[0], x[1].r]));
  const now = step.loc || step.g;
  const changes = [];
  for (const [k, v] of now) {
    if (!before.has(k)) { if (v.t !== 'function' && v.t !== 'class') changes.push(`${k} is created: ${v.r}`); }
    else if (before.get(k) !== v.r) changes.push(`${k} changes: ${before.get(k)} → ${v.r}`);
  }
  if (changes.length) return changes.slice(0, 2).join(' · ');
  const src = (lines[step.l - 1] || '').trim();
  return src ? `Next line: ${src}` : `Line ${step.l}`;
}

export function openTrace(host, { code, res, onClose }) {
  const steps = (res && res.steps) || [], out = (res && res.out) || '';
  const lines = code.split('\n');
  if (!steps.length) { host.innerHTML = '<div class="tr-empty">Nothing to animate here.</div>'; return { close() {} }; }
  host.innerHTML = `<div class="tr" role="region" aria-label="Step-by-step run">
    <div class="tr-cap" aria-live="polite"></div>
    <div class="tr-grid"><div class="tr-code">${codeView(code)}</div>
      <div class="tr-side"><div class="tr-stack"></div><div class="tr-vars"></div></div></div>
    <div class="tr-out"><div class="tr-olabel">Output</div><pre></pre></div>
    <div class="tr-ctl"><button class="tr-b" data-a="first" aria-label="First step">⏮</button><button class="tr-b" data-a="prev" aria-label="Previous step">◀</button>
      <button class="tr-b play" data-a="play" aria-label="Play">▶</button><button class="tr-b" data-a="next" aria-label="Next step">▶ ▶</button>
      <input class="tr-scrub" type="range" min="0" max="${steps.length - 1}" value="0" aria-label="Step"><span class="tr-count"></span>
      <button class="tr-b speed" data-a="speed" aria-label="Speed">1×</button><button class="tr-b" data-a="close" aria-label="Close">✕</button></div>
    ${res.cut ? '<div class="tr-note">Showing the first ' + steps.length + ' steps.</div>' : ''}</div>`;
  const $ = s => host.querySelector(s);
  let i = 0, timer = null, speed = 1;
  const SPEEDS = [0.5, 1, 2, 4];
  let prevVals = new Map();

  function show(k, animate = true) {
    i = Math.max(0, Math.min(steps.length - 1, k));
    const st = steps[i], prev = steps[i - 1];
    host.querySelectorAll('.cv-line').forEach(el => { el.classList.toggle('on', +el.dataset.l === st.l); el.classList.toggle('ran', steps.slice(0, i).some(s => s.l === +el.dataset.l)); });
    const lineEl = host.querySelector(`.cv-line[data-l="${st.l}"]`), arrow = $('.cv-arrow');
    if (lineEl && arrow) { arrow.style.transform = `translateY(${lineEl.offsetTop}px)`; arrow.classList.toggle('ret', st.e === 'ret'); arrow.classList.toggle('exc', st.e === 'exc'); }
    if (lineEl) { const box = $('.tr-code'); const top = lineEl.offsetTop - box.clientHeight / 2; box.scrollTo({ top: Math.max(0, top), behavior: animate ? 'smooth' : 'auto' }); }
    $('.tr-stack').innerHTML = st.s.map((f, k) => `<span class="tr-frame${k === st.s.length - 1 ? ' on' : ''}">${esc(f)}${k === st.s.length - 1 && st.e === 'ret' && st.ret ? ` <b>→ ${esc(st.ret.r)}</b>` : ''}</span>`).join('<span class="tr-sep">›</span>');
    const groups = [];
    if (st.loc) groups.push([st.s[st.s.length - 1] + '()', st.loc]);
    groups.push(['Global', (st.g || []).filter(x => !(st.loc && x[1].t === 'function'))]);
    const cur = new Map();
    $('.tr-vars').innerHTML = groups.map(([title, vars]) => `<div class="tr-group"><div class="tr-gt">${esc(title)}</div>${vars.length ? vars.map(([k, v]) => {
      const key = title + '.' + k; cur.set(key, v.r);
      const st2 = !prevVals.has(key) ? 'new' : prevVals.get(key) !== v.r ? 'chg' : '';
      return `<div class="tr-var ${animate ? st2 : ''}"><span class="tr-vn">${esc(k)}</span>${valueHTML(v)}<span class="tr-vt">${esc(v.t)}</span></div>`;
    }).join('') : '<div class="tr-none">no variables yet</div>'}</div>`).join('');
    prevVals = cur;
    $('.tr-out pre').textContent = out.slice(0, st.o) || '';
    $('.tr-cap').textContent = caption(prev, st, lines);
    $('.tr-scrub').value = i; $('.tr-count').textContent = `${i + 1} / ${steps.length}`;
  }
  function stop() { clearInterval(timer); timer = null; $('.tr-b.play').textContent = '▶'; $('.tr-b.play').setAttribute('aria-label', 'Play'); }
  function play() {
    if (i >= steps.length - 1) { prevVals = new Map(); show(0); }
    $('.tr-b.play').textContent = '⏸'; $('.tr-b.play').setAttribute('aria-label', 'Pause');
    timer = setInterval(() => { if (i >= steps.length - 1) { stop(); $('.tr-out pre').textContent = out; return; } show(i + 1); }, 900 / speed);
  }
  host.querySelector('.tr-ctl').addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'play') return timer ? stop() : play();
    if (act === 'speed') { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; a.textContent = speed + '×'; if (timer) { stop(); play(); } return; }
    if (act === 'close') { stop(); onClose && onClose(); return; }
    stop();
    if (act === 'first') { prevVals = new Map(); show(0); }
    if (act === 'prev') show(i - 1, false);
    if (act === 'next') show(i + 1);
  });
  $('.tr-scrub').addEventListener('input', e => { stop(); show(+e.target.value, false); });
  show(0);
  setTimeout(play, 500);
  return { close() { stop(); } };
}
