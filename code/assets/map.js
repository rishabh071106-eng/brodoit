// Course map: the 60 days in six phases, the current day highlighted.
import { esc, progress, syncProgress, param, token } from './lib.js';
import { mountCoach } from './coach.js';
import * as PY from './runner.js';

const root = document.getElementById('map');
const ic = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  check: '<path d="M20 6 9 17l-5-5"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>', play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

async function main() {
  let idx;
  try { idx = await (await fetch('/code/days/index.json', { cache: 'no-cache' })).json(); }
  catch (e) { root.innerHTML = '<p class="muted pad">Could not load the course. Check your connection.</p>'; return; }
  let P = progress.read();
  render(idx, P);
  if (token()) { P = await syncProgress(); render(idx, P); }
  mountCoach({ context: () => ({ course: 'py', unit: 'map', day: progress.current(P), slide: null }) });
  setTimeout(() => PY.warm(), 1500); // Python is ready by the time a lesson opens
  const locked = param('locked');
  if (locked) toast(`Finish Day ${locked - 1} first.`);
}

function ring(pct) {
  const r = 52, c = 2 * Math.PI * r;
  return `<svg class="mp-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="trk"/><circle cx="60" cy="60" r="${r}" class="val" style="stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct)}"/></svg>`;
}

function render(idx, P) {
  const list = idx.list || [], byDay = new Map(list.map(d => [d.day, d]));
  const done = progress.doneCount(P), cur = progress.current(P), curD = byDay.get(cur);
  document.getElementById('xp').textContent = (P.xp || 0) + ' XP';
  const started = done > 0 || !!(P.days['d' + cur] && P.days['d' + cur].slide);
  const label = started ? 'Continue' : 'Start';
  let h = `<section class="mp-hero">
    <div><h1>Python</h1><span class="mp-sub">60 days</span></div>
    <div class="mp-hb"><div class="mp-prog" role="img" aria-label="${done} of 60 days done">${ring(done / 60)}<b class="mp-pn">${Math.round(done / 60 * 100)}%</b></div>
      ${curD ? `<a class="mp-go" href="/code/day.html?d=${cur}" aria-label="${label}: Day ${cur}, ${esc(curD.title)}">${label}${ic(I.arrow, 18)}</a>` : ''}</div>
  </section>`;
  for (const ph of idx.phases) {
    const days = [];
    for (let d = ph.from; d <= ph.to; d++) days.push(d);
    h += `<section class="mp-ph"><div class="mp-phh"><h2>${esc(ph.title || ph.name)}</h2><span>Days ${ph.from}–${ph.to}</span></div>
      <ol class="mp-days">${days.map(d => {
        const m = byDay.get(d), st = P.days['d' + d] || {};
        const open = progress.open(P, d), isCur = d === cur, isDone = !!st.done;
        const cls = isDone ? 'done' : isCur ? 'cur' : open ? 'open' : 'locked';
        if (!m) return `<li class="mp-day soon"><div><span class="mp-dot">${d}</span><b>Soon</b></div></li>`;
        const end = isCur ? `<span class="mp-play">${ic(I.play, 15)}</span>` : !open ? `<span class="mp-lock">${ic(I.lock, 16)}</span>` : '';
        return `<li class="mp-day ${cls}${m.project ? ' proj' : ''}"><a href="/code/day.html?d=${d}" data-day="${d}" data-open="${open ? 1 : 0}" aria-label="Day ${d}: ${esc(m.title)}${isDone ? ', done' : ''}"><span class="mp-dot">${isDone ? ic(I.check, 18) : d}</span><b>${esc(m.title)}${m.project ? ic(I.star, 14) : ''}</b>${end}</a></li>`;
      }).join('')}</ol></section>`;
  }
  h += `<section class="mp-foot"><button class="mp-unlock" id="unlock">${P.unlockAll ? 'Lock days again' : 'Unlock all days'}</button></section>`;
  root.innerHTML = h;
  root.querySelectorAll('[data-day]').forEach(a => a.addEventListener('click', e => { if (a.dataset.open !== '1') { e.preventDefault(); toast(`Day ${a.dataset.day} opens after Day ${a.dataset.day - 1}.`); } }));
  document.getElementById('unlock').addEventListener('click', () => { const p = progress.read(); p.unlockAll = !p.unlockAll; progress.write(p); render(idx, p); });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -10% 0px' }) : null;
  root.querySelectorAll('.mp-ph').forEach(s => io ? io.observe(s) : s.classList.add('in'));
  const curEl = root.querySelector('.mp-day.cur');
  if (curEl && done > 2 && !render.scrolled) { render.scrolled = true; setTimeout(() => curEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 700); }
}

function toast(t) {
  const d = document.createElement('div'); d.className = 'mp-toast'; d.textContent = t; document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 300); }, 3600);
}

main();
