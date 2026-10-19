// The world map: six worlds of ten days on a winding path of round nodes (done / current / locked),
// stars under each finished day, boss nodes for the project days, and a HUD with your rank, streak and stars.
import { esc, progress, syncProgress, param, token, rankOf, RANKS, starsOf, totalStars, sfx, calm, confetti } from './lib.js';
import { mountCoach } from './coach.js';
import * as PY from './runner.js';

const root = document.getElementById('map'), hud = document.getElementById('hud');
const ic = (d, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${w ? 'none' : 'currentColor'}" stroke="${w ? 'currentColor' : 'none'}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  star: '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  flame: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.9-2.7-6.2-4.2-9.4-.4 2-1.5 3.3-2.8 3.8.4-3-1-6.2-3.8-7.8.2 3.2-1.4 5.4-3 7.4C3.9 11.1 5 13.6 5 15.4 5 19.1 7.6 22 12 22z"/>',
  seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 5-3 7-8 7z"/><path d="M12 15c0-3-2.4-5.5-7-5.5 0 4 2.4 5.5 7 5.5z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  build: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  // world emblems
  rocket: '<path d="M12 15c-1.5 0-3-1.5-3-3 0-5 3-9 3-9s3 4 3 9c0 1.5-1.5 3-3 3z"/><path d="M9 12.5 6 15l1 4 3-2M15 12.5l3 2.5-1 4-3-2M12 15v6"/>',
  mountain: '<path d="m3 20 6.5-11 4 6 2.5-3.5L21 20z"/><path d="m8 11.5 1.5 1.5 1.5-1.5"/>',
  orbit: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-20 12 12)"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20M10 9l-2 2 2 2M14 9l2 2-2 2"/>',
};
const RANK_IC = { seed: I.seed, code: I.code, build: I.build, term: I.term, bolt: I.bolt, crown: I.crown };
const WORLD_IC = [I.rocket, I.mountain, I.orbit, I.sparkle, I.laptop, I.crown];
const starRow = (n, size = 14) => `<span class="mp-stars" aria-hidden="true">${[0, 1, 2].map(k => `<i class="${k < n ? 'on' : ''}">${ic(I.star, size, 0)}</i>`).join('')}</span>`;

let IDX = null, P = progress.read(), W = 0;

async function main() {
  try { IDX = await (await fetch('/code/days/index.json', { cache: 'no-cache' })).json(); }
  catch (e) { root.innerHTML = '<p class="muted pad">Could not load the course. Check your connection.</p>'; return; }
  try { window.mascot && window.mascot.preload && window.mascot.preload(); } catch (e) { /* optional */ }
  render();
  if (token()) { P = await syncProgress(); render(); }
  mountCoach({ context: () => ({ course: 'py', unit: 'map', day: progress.current(P), slide: null }) });
  setTimeout(() => PY.warm(), 1500); // Python is ready by the time a lesson opens
  const locked = param('locked');
  if (locked) toast(`Finish Day ${locked - 1} first.`);
  const from = +param('from');
  if (from) celebrate(from + 1);
  let t = null;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (Math.abs(width() - W) > 4) render(); }, 150); });
}

const width = () => Math.min(root.clientWidth || 360, 600) - 32;

function renderHud() {
  const xp = P.xp || 0, rk = rankOf(xp), stars = totalStars(P), total = (IDX.days || 60) * 3;
  const streak = P.log && P.log.length ? progress.streak(P) : null;
  hud.innerHTML = `<a class="mp-home" href="/?tab=learn" aria-label="Back to Brodoit">${ic('<path d="m15 18-6-6 6-6"/>', 20, 2.4)}</a>
    <button class="mp-rank r${rk.i}" id="rankBtn" aria-label="Rank ${rk.name}, ${xp} XP${rk.next ? `, ${rk.toNext} XP to ${rk.next.name}` : ''}">
      <span class="mp-badge">${ic(RANK_IC[rk.icon], 18, 2.2)}</span>
      <span class="mp-rk"><b>${rk.name}</b><span class="mp-bar"><i style="width:${Math.round(rk.pct * 100)}%"></i></span><small>${xp.toLocaleString('en-IN')}${rk.next ? ' / ' + rk.next.xp.toLocaleString('en-IN') : ''} XP</small></span>
    </button>
    ${streak != null ? `<span class="mp-chip fl${streak ? '' : ' off'}" role="img" aria-label="${streak} day streak">${ic(I.flame, 18, 0)}<b>${streak}</b></span>` : ''}
    <span class="mp-chip st" role="img" aria-label="${stars} of ${total} stars">${ic(I.star, 17, 0)}<b>${stars}<small>/${total}</small></b></span>`;
  document.getElementById('rankBtn').addEventListener('click', rankSheet);
}

function render() {
  W = width();
  renderHud();
  const list = IDX.list || [], byDay = new Map(list.map(d => [d.day, d]));
  const done = progress.doneCount(P), cur = progress.current(P), curD = byDay.get(cur);
  const started = done > 0 || !!(P.days['d' + cur] && P.days['d' + cur].slide);
  let h = hero(done, cur, curD, started);
  for (const ph of IDX.phases) h += world(ph, byDay, cur);
  h += `<section class="mp-foot"><button class="mp-unlock" id="unlock">${P.unlockAll ? 'Lock days again' : 'Unlock all days'}</button></section>`;
  root.innerHTML = h;
  wireStory();
  root.querySelectorAll('.mp-node').forEach(a => a.addEventListener('click', e => {
    if (a.dataset.open !== '1') { e.preventDefault(); a.classList.remove('nope'); void a.offsetWidth; a.classList.add('nope'); toast(`Day ${a.dataset.day} opens after Day ${a.dataset.day - 1}.`); }
  }));
  document.getElementById('unlock').addEventListener('click', () => { const p = progress.read(); p.unlockAll = !p.unlockAll; progress.write(p); P = p; render(); });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
  root.querySelectorAll('.mp-world').forEach(s => (io ? io.observe(s) : s.classList.add('in')));
  const curEl = root.querySelector('.mp-node.cur');
  if (curEl && cur > 2 && !render.scrolled && !param('from')) {
    render.scrolled = true;
    // look the node up again when the timer fires: the synced redraw may have replaced it
    setTimeout(() => { const el = root.querySelector('.mp-node.cur'); if (el) el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' }); }, 500);
  }
}

// ── the hero: the story of Python as a drawn timeline, ending with you ──
// Our own motif (no logos, no photos): one sinuous line, warm to cool, that runs through the history and
// ends at a glowing head: the learner, with their rank and day.
const STORY = [
  ['1989', 'Guido van Rossum starts Python as a holiday project.'],
  ['1991', 'First public release, with functions, lists and classes.'],
  ['2000', 'Python 2 arrives with list comprehensions.'],
  ['2008', 'Python 3 cleans up the language.'],
  ['Today', 'The most popular language. AI, data and the web run on it.'],
];
function hero(done, cur, curD, started) {
  const rk = rankOf(P.xp || 0);
  const you = done >= 60 ? 'Graduated. You\'re a Python developer.'
    : `Day ${cur} · ${rk.name}${P.xp ? ` · ${(P.xp || 0).toLocaleString('en-IN')} XP` : ''}`;
  const stops = STORY.concat([['You', you]]);
  // the snake: through six stop centres on a 600×80 band, bending up and down between them
  const xs = stops.map((_, i) => 50 + i * 100);
  let d = `M${xs[0] - 50} 40 Q${xs[0] - 25} 40 ${xs[0]} 40`;
  for (let i = 1; i < xs.length; i++) { const a = xs[i - 1], b = xs[i], up = i % 2 ? -26 : 26; d += ` C${a + 34} ${40 + up} ${b - 34} ${40 + up} ${b} 40`; }
  const last = stops.length - 1;
  return `<section class="mp-hero">
    <div class="mp-story">
      <span class="mp-eye">Python · Zero to Hero</span>
      <h1>The story of Python</h1>
      <div class="mp-tl r${rk.i}">
        <svg class="mp-snake" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="snk" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#F2A08A"/><stop offset=".45" stop-color="#E8C27A"/><stop offset=".8" stop-color="#8FC3E6"/><stop offset="1" stop-color="#B9A6F2"/></linearGradient></defs>
          <path class="glow" d="${d}" vector-effect="non-scaling-stroke"/><path class="line" d="${d}" pathLength="1" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="mp-stops" role="tablist" aria-label="Milestones">${stops.map((st, i) => `<button class="mp-stop${i === last ? ' you' : ''}" role="tab" data-i="${i}" aria-selected="${i === 0}" aria-label="${st[0]}">
          <i>${i === last ? ic(RANK_IC[rk.icon], 15, 2.4) : ''}</i><span>${st[0]}</span></button>`).join('')}</div>
      </div>
      <div class="mp-cap" aria-live="polite">${stops.map((st, i) => `<p data-i="${i}"${i ? ' hidden' : ''}><b>${i === last ? 'You are here' : st[0]}</b>${esc(st[1])}</p>`).join('')}</div>
    </div>
    <div class="mp-now">
      <div class="mp-ht"><span class="mp-eye">${done >= 60 ? 'Course complete' : started ? 'Up next' : 'Start here'}</span><h2>${done >= 60 ? 'Graduate' : `Day ${cur}`}</h2><p>${curD ? esc(curD.title) : ''}</p></div>
      ${curD ? `<a class="mp-go" href="/code/day.html?d=${cur}" aria-label="${started ? 'Continue' : 'Start'}: Day ${cur}, ${esc(curD.title)}">${started ? 'Continue' : 'Start'}${ic(I.arrow, 18, 2.4)}</a>` : ''}
      <div class="mp-hp" role="img" aria-label="${done} of 60 days done"><i style="width:${(done / 60) * 100}%"></i></div><small class="mp-hs">${done} of 60 days · ${Math.round((done / 60) * 100)}%</small>
    </div>
  </section>`;
}
// Tap a milestone to read it; on its own the story plays once, 1989 to you, then rests on you.
let storyTimer = null;
function wireStory() {
  const box = root.querySelector('.mp-story'); if (!box) return;
  const stops = [...box.querySelectorAll('.mp-stop')], caps = [...box.querySelectorAll('.mp-cap p')];
  const pick = i => {
    stops.forEach((b, j) => { b.setAttribute('aria-selected', String(j === i)); b.classList.toggle('past', j < i); });
    caps.forEach((p, j) => { p.hidden = j !== i; });
    box.style.setProperty('--at', i / (stops.length - 1));
  };
  clearInterval(storyTimer);
  stops.forEach((b, i) => b.addEventListener('click', () => { clearInterval(storyTimer); pick(i); sfx('tap'); }));
  if (calm()) return pick(stops.length - 1);
  let i = 0; pick(0);
  storyTimer = setInterval(() => { i++; pick(i); if (i >= stops.length - 1) clearInterval(storyTimer); }, 2600);
}

// One world: a banner and its ten days on a zig-zag path (a sine wave); labels sit on the roomier side.
function world(ph, byDay, cur) {
  const n = ph.n, days = [];
  for (let d = ph.from; d <= ph.to; d++) days.push(d);
  const doneN = days.filter(d => P.days['d' + d] && P.days['d' + d].done).length;
  const stars = days.reduce((a, d) => a + starsOf(P.days['d' + d]), 0);
  const A = Math.min(92, W * 0.24), dir = n % 2 ? 1 : -1;
  let y = cur >= ph.from && cur <= ph.to && cur === ph.from && !(P.days['d' + cur] || {}).done ? 100 : 64;
  const pts = [], nodes = [], extras = [];
  days.forEach((d, i) => {
    const m = byDay.get(d), st = P.days['d' + d] || {};
    const boss = !!(m && m.project), r = boss ? 46 : 36;
    const open = progress.open(P, d), isDone = !!st.done, isCur = d === cur && !isDone;
    const cls = isDone ? 'done' : isCur ? 'cur' : open ? 'open' : 'locked';
    if (i) y += (boss || (byDay.get(d - 1) || {}).project ? 124 : 108) + (isCur ? 64 : 0); // room for the Start bubble, clear of the day above
    const cx = Math.round(W / 2 + dir * Math.sin((i * Math.PI) / 4) * A);
    pts.push([cx, y, isDone]);
    const icon = boss ? (d >= 58 ? I.crown : I.trophy) : isDone ? I.check : isCur ? I.play : !open ? I.lock : '';
    const label = m ? esc(m.title.replace(/^Project:\s*/, '')) : 'Coming soon';
    const s = isDone ? starsOf(st) : 0;
    nodes.push(`<a class="mp-node ${cls}${boss ? ' boss' : ''}" href="/code/day.html?d=${d}" data-day="${d}" data-open="${open ? 1 : 0}" style="left:${cx}px;top:${y}px;--r:${r}px"
      aria-label="Day ${d}: ${label}${boss ? ' (boss level)' : ''}${isDone ? `, done, ${s} of 3 stars` : isCur ? ', up next' : !open ? ', locked' : ''}">
      ${isCur ? `<span class="mp-start">${st.slide ? 'Continue' : 'Start'}</span>` : ''}
      <span class="mp-orb">${icon ? ic(icon, boss ? 36 : 28, isCur && !boss ? 0 : isDone && !boss ? 3.4 : 2.4) : `<b>${d}</b>`}</span>
      ${open ? starRow(s) : ''}</a>`);
    // the label sits where there is more room; Bro stands on the other side of the current day
    const roomL = cx - r - 12, roomR = W - cx - r - 12;
    const side = roomR >= roomL ? 'r' : 'l', room = Math.max(roomL, roomR);
    let lw = Math.min(170, room), lx = side === 'r' ? cx + r + 14 : cx - r - 14 - lw;
    if (isCur) {
      const other = side === 'r' ? roomL : roomR, bro = 56;
      let bx;
      if (other >= bro + 4) bx = side === 'r' ? cx - r - 10 - bro : cx + r + 10;
      else { bx = side === 'r' ? cx + r + 8 : cx - r - 8 - bro; lw = Math.max(80, lw - bro - 8); lx = side === 'r' ? cx + r + 16 + bro : cx - r - 16 - bro - lw; }
      extras.push(`<span class="mp-bro" style="left:${bx}px;top:${y - 40}px" aria-hidden="true">${window.mascot ? window.mascot('walking', bro) : ''}</span>`);
    }
    extras.push(`<span class="mp-lab ${side} ${cls}" style="left:${lx}px;top:${y}px;width:${lw}px" aria-hidden="true"><small>${boss ? 'Boss · ' : ''}Day ${d}</small><span>${label}</span></span>`);
  });
  const H = y + 74;
  // the trail: one smooth curve through every node; the part you have walked is drawn in the world colour
  const curve = ps => ps.map((p, k) => { if (!k) return `M${p[0]} ${p[1]}`; const q = ps[k - 1], my = (q[1] + p[1]) / 2; return `C${q[0]} ${my} ${p[0]} ${my} ${p[0]} ${p[1]}`; }).join(' ');
  let walked = 0; while (walked < pts.length && pts[walked][2]) walked++;
  const trail = curve(pts), done = walked > 0 ? curve(pts.slice(0, Math.min(pts.length, walked + 1))) : '';
  return `<section class="mp-world w${n}" data-world="${n}" aria-label="World ${n}: ${esc(ph.name)}">
    <header class="mp-banner">
      <div class="mp-bt"><small><span class="mp-emb" aria-hidden="true">${ic(WORLD_IC[n - 1], 15, 2.2)}</span>World ${n} · Days ${ph.from}–${ph.to}</small><h2>${esc(ph.name)}</h2><p>${esc(ph.title)}</p></div>
      <div class="mp-bs"><span class="mp-bst">${ic(I.star, 15, 0)}<b>${stars}</b>/${days.length * 3}</span><span class="mp-bpr"><i style="width:${(doneN / days.length) * 100}%"></i></span><small>${doneN}/${days.length} days</small></div>
    </header>
    <div class="mp-path" style="height:${H}px">
      <svg class="mp-trail" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="base" d="${trail}"/>${done ? `<path class="walk" d="${done}"/>` : ''}</svg>
      ${extras.join('')}${nodes.join('')}
    </div>
  </section>`;
}

// Back from a finished day: the next node pops open.
function celebrate(d) {
  history.replaceState(null, '', '/code/');
  const el = root.querySelector(`.mp-node[data-day="${d}"]`);
  if (!el || el.dataset.open !== '1') return;
  setTimeout(() => {
    el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
    setTimeout(() => {
      el.classList.add('unlocked'); sfx('unlock');
      const r = el.getBoundingClientRect(), box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left + r.width / 2 - 100}px;top:${r.top - 40}px;width:200px;height:200px;pointer-events:none;z-index:40`;
      document.body.appendChild(box); confetti(box, 36); setTimeout(() => box.remove(), 2400);
      toast(`Day ${d} unlocked`);
    }, calm() ? 50 : 700);
  }, 300);
}

function rankSheet() {
  const xp = P.xp || 0, rk = rankOf(xp);
  const sh = document.createElement('div'); sh.className = 'mp-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', 'Ranks');
  sh.innerHTML = `<div class="mp-scrim" data-x></div><div class="mp-panel"><div class="mp-grab"></div>
    <h3>Your rank</h3><p class="mp-sub">Every level earns XP: runs, answers, puzzles and challenges. Three right in a row starts a combo that doubles it.</p>
    <ol class="mp-ladder">${RANKS.map((r, k) => `<li class="r${k} ${k < rk.i ? 'past' : k === rk.i ? 'now' : ''}"><span class="mp-badge">${ic(RANK_IC[r.icon], 18, 2.2)}</span><b>${r.name}</b><small>${r.xp.toLocaleString('en-IN')} XP</small>${k === rk.i ? '<em>You</em>' : k < rk.i ? ic(I.check, 16, 3) : ''}</li>`).join('')}</ol>
    <button class="mp-close" data-x>Got it</button></div>`;
  document.body.appendChild(sh);
  requestAnimationFrame(() => sh.classList.add('in'));
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { removeEventListener('keydown', onKey); sh.classList.remove('in'); setTimeout(() => sh.remove(), 300); };
  sh.addEventListener('click', e => { if (e.target.closest('[data-x]')) close(); });
  addEventListener('keydown', onKey);
  sh.querySelector('.mp-close').focus();
}

function toast(t) {
  document.querySelectorAll('.mp-toast').forEach(x => x.remove());
  const d = document.createElement('div'); d.className = 'mp-toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 300); }, 3200);
}

main();
