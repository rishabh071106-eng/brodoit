// Mission map: the 60-day journey as six phases, your rocket on the current day.
import { esc, progress, syncProgress, param, token } from './lib.js';
import { mountCoach } from './coach.js';
import * as PY from './runner.js';

const root = document.getElementById('map');
const ART = ['', 'launch', 'ascent', 'orbit', 'deep', 'dev', 'pro'];
const ic = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>', play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 13h5M2 18h5M17 8h5M17 13h5M17 18h5"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
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
  if (locked) toast(`Finish Day ${locked - 1} first, or unlock every day below.`);
}

function ring(pct) {
  const r = 52, c = 2 * Math.PI * r;
  return `<svg class="mp-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="trk"/><circle cx="60" cy="60" r="${r}" class="val" style="stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct)}"/></svg>`;
}

function render(idx, P) {
  const list = idx.list || [], byDay = new Map(list.map(d => [d.day, d]));
  const done = progress.doneCount(P), cur = progress.current(P), curD = byDay.get(cur);
  const left = 60 - done, grad = new Date(Date.now() + left * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('xp').textContent = (P.xp || 0) + ' XP';
  const resume = P.days['d' + cur] && P.days['d' + cur].slide;
  let h = `<section class="mp-hero">
    <div class="mp-orbit" aria-hidden="true"><span class="pl"></span><span class="rg r1"></span><span class="rg r2"></span><span class="rk">${ic(I.rocket, 30)}</span></div>
    <div class="mp-k">Brodoit School of Code</div>
    <h1>Python<span>Zero to Hero</span></h1>
    <p class="mp-sub">60 days from your first line of code to building real software. Real Python runs on your phone. Every lesson is narrated and animated, and Bro coaches you all the way.</p>
    <div class="mp-prog">${ring(done / 60)}<div class="mp-pn"><b>${done}</b><small>of 60 days</small></div>
      <div class="mp-stats"><div><b>${progress.streak(P)}</b><small>day streak</small></div><div><b>${P.xp || 0}</b><small>XP</small></div><div><b>${done ? grad : '60 days'}</b><small>${done ? 'you graduate' : 'to graduate'}</small></div></div></div>
    ${curD ? `<a class="mp-go" href="/code/day.html?d=${cur}"><span class="mp-gk">${done ? (resume ? 'Resume' : 'Next mission') : 'Start here'} · Day ${cur}</span><b>${esc(curD.title)}</b><small>${esc(curD.subtitle || '')} · ${curD.minutes} min</small><span class="mp-gp">${ic(I.play, 18)}</span></a>` : ''}
  </section>
  <section class="mp-why">${[[I.cpu, 'Real Python 3.13', 'runs right on your phone'], [I.mic, 'Studio narration', 'every slide, recorded'], [I.film, 'Watch code run', 'step-by-step animations'], [I.build, '6 projects', 'plus a capstone']].map(x => `<div>${ic(x[0], 20)}<b>${x[1]}</b><small>${x[2]}</small></div>`).join('')}</section>`;
  for (const ph of idx.phases) {
    const days = [];
    for (let d = ph.from; d <= ph.to; d++) days.push(d);
    const pd = days.filter(d => P.days['d' + d] && P.days['d' + d].done).length;
    h += `<section class="mp-ph ph-${ART[ph.n]}"><div class="mp-phh"><div class="mp-planet"><i></i></div><div><div class="mp-phk">Phase ${ph.n} · Days ${ph.from}–${ph.to}</div><h2>${esc(ph.name)}</h2><small>${esc(ph.title)}</small></div><span class="mp-phc">${pd}/10</span></div>
      <ol class="mp-days">${days.map(d => {
        const m = byDay.get(d), st = P.days['d' + d] || {};
        const open = progress.open(P, d), isCur = d === cur, isDone = !!st.done;
        const cls = isDone ? 'done' : isCur ? 'cur' : open ? 'open' : 'locked';
        const dot = isDone ? ic(I.check, 16) : isCur ? ic(I.rocket, 18) : !open ? ic(I.lock, 14) : d;
        if (!m) return `<li class="mp-day soon"><span class="mp-dot">${d}</span><div><b>Day ${d}</b><small>Landing soon</small></div></li>`;
        return `<li class="mp-day ${cls}${m.project ? ' proj' : ''}"><a href="/code/day.html?d=${d}" data-day="${d}" data-open="${open ? 1 : 0}"><span class="mp-dot">${dot}</span>
          <div><span class="mp-dn">Day ${d}${m.project ? ` · ${ic(I.star, 12)} Project` : ''}</span><b>${esc(m.title)}</b><small>${esc(m.subtitle || '')}</small></div><span class="mp-min">${m.minutes}m${st.best != null && isDone ? `<em>${st.best}%</em>` : ''}</span></a></li>`;
      }).join('')}</ol></section>`;
  }
  h += `<section class="mp-foot"><button class="btn ghost" id="unlock">${P.unlockAll ? 'All days unlocked' : 'I know some Python: unlock every day'}</button><p class="muted">Missions open one after another, so each day builds on the last. Unlock all if you want to jump ahead.</p></section>`;
  root.innerHTML = h;
  root.querySelectorAll('[data-day]').forEach(a => a.addEventListener('click', e => { if (a.dataset.open !== '1') { e.preventDefault(); toast(`Day ${a.dataset.day} opens after Day ${a.dataset.day - 1}. You can also unlock every day at the bottom.`); } }));
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
