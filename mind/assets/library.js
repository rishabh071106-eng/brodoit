// /mind/ library: greeting, today's workout (3 games picked by date, played back to back), the five game tiles,
// and Elevate-style performance bars per skill.
import * as store from './store.js';
import { GAMES, byId, SKILL_ICON } from './games/index.js';
import { art } from './art.js';
import { esc, ico, ring, toast, countUp, confetti, sfx, buzz, greeting, unlockAudio } from './util.js';

unlockAudio();
const TIERS = [[20, 'Master'], [15, 'Expert'], [10, 'Advanced'], [5, 'Skilled'], [1, 'Beginner'], [0, 'Not started']];
const tierOf = (done, started) => (!started ? 'Not started' : (TIERS.find(([n]) => done >= n) || TIERS[4])[1]);
const root = document.getElementById('lib');

function pill(p) {
  return `${ico('flame', 16)}<b>${store.streak(p)}</b><i aria-hidden="true"></i>${ico('zap', 16)}<b>${p.xp | 0}</b><span class="sr">XP</span>`;
}
if (window.bdTopbar) window.bdTopbar({ title: 'Mind', right: `<span class="m-pill" id="mPill" aria-label="Streak and XP"></span>` });

function workoutCard(p) {
  const w = store.workout(p), n = w.done.length;
  let date = '';
  try { date = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date()); } catch (e) { /* ignore */ }
  const link = (g, wk) => `/mind/play.html?g=${g}&l=${store.current(p, g)}${wk ? '&w=1' : ''}`;
  const href = w.next ? link(w.next, true) : link(w.games[0], false);
  const label = n === 0 ? 'Start workout' : w.next ? `Continue: ${byId(w.next).meta.name}` : 'Play again';
  return `<section class="wo${w.complete ? ' complete' : ''}" aria-labelledby="woT">
    <div class="wo-head">
      <div class="wo-hl"><div class="m-eyebrow">${date ? esc(date) : 'Today'}</div>
        <h2 id="woT" class="wo-t">${w.complete ? 'Workout complete' : n ? 'Keep it going' : 'Today\'s workout'}</h2>
        <p class="wo-sub">${w.complete ? 'New mix tomorrow' : `${3 - n} game${3 - n === 1 ? '' : 's'} · ~${(3 - n) * 2} min`}</p></div>
      <div class="wo-ring" role="img" aria-label="${n} of 3 games done">${ring(n / 3, 72, 8, w.complete ? 'var(--b-mint)' : 'var(--b-primary)')}<b>${n}<small>/3</small></b></div>
    </div>
    <div class="wo-games">${w.games.map((g, i) => {
      const m = byId(g).meta, d = w.done.includes(g);
      return `<a class="wo-g${d ? ' on' : ''}${g === w.next ? ' next' : ''}" href="${link(g, true)}" style="--g:${m.color};--g-deep:${m.deep}">
        <span class="wo-art">${art(g, m.deep)}<i class="wo-n">${d ? ico('check', 15, 3) : i + 1}</i></span>
        <b>${esc(m.name)}</b><small>${esc(m.skill)} · Lv ${store.current(p, g)}</small></a>`;
    }).join('')}</div>
    <a class="wo-btn" id="woBtn" href="${href}">${ico(w.complete ? 'rotate-ccw' : 'play', 20)}<span>${esc(label)}</span></a>
  </section>`;
}

function tile(mod, p, i) {
  const m = mod.meta, s = store.gameStats(p, m.id), wide = i === GAMES.length - 1;
  const badge = s.started
    ? `<span class="m-badge">${store.allDone(p, m.id) ? ico('crown', 13) + ' ' : ''}Lv ${s.level}</span>`
    : `<span class="m-badge new">${ico('sparkles', 13)}New</span>`;
  return `<a class="m-tile${wide ? ' wide' : ''}" href="/mind/game.html?g=${m.id}" style="--g:${m.color};--g-deep:${m.deep}" data-g="${m.id}"
      aria-label="${esc(m.name)}, trains ${esc(m.skill)}${s.started ? `, level ${s.level}` : ', new'}">
    <span class="m-tile-art">${art(m.id, m.deep)}</span>${badge}
    <span class="m-tile-txt"><b>${esc(m.name)}</b><small>${ico(SKILL_ICON[m.skill], 14)}${esc(m.skill)}${s.stars ? ` · ${s.stars}★` : ''}</small></span>
    <span class="m-tile-prog" aria-hidden="true"><i style="transform:scaleX(${(s.done / store.LEVELS).toFixed(3)})"></i></span>
  </a>`;
}

function skills(p) {
  let total = 0, top = null;
  const rows = GAMES.map(mod => {
    const m = mod.meta, s = store.gameStats(p, m.id);
    total += s.sum;
    if (s.sum > 0 && (!top || s.sum > top.sum)) top = { skill: m.skill, sum: s.sum };
    return `<div class="sk-row" style="--g:${m.color}">
      <span class="sk-ic">${ico(SKILL_ICON[m.skill], 18)}</span>
      <div class="sk-l"><b>${esc(m.skill)}</b><small>${tierOf(s.done, s.started)}${s.started ? ` · ${s.done}/20 levels` : ''}</small></div>
      <b class="sk-n" data-to="${s.sum}">${s.sum}</b>
      <div class="sk-bar"><i style="--f:${(s.sum / 2000).toFixed(4)}"></i></div>
    </div>`;
  }).join('');
  return `<section class="sk" aria-labelledby="skT">
    <div class="sk-top"><div><div class="m-eyebrow" id="skT">Mind score</div><b class="sk-total" id="skTotal">${total}</b></div>
      ${top ? `<p>Strongest: <b>${esc(top.skill)}</b></p>` : ''}</div>
    <div class="sk-rows pre" id="skRows">${rows}</div>
  </section>`;
}

let first = true;
function render() {
  const p = store.read();
  const played = (p.plays | 0) > 0, st = store.streak(p);
  const totalDone = GAMES.reduce((a, g) => a + store.gameStats(p, g.meta.id).done, 0);
  // v14: few words — the greeting, and a one-line streak only once there is one
  root.innerHTML = `
    <section class="m-hello"><h1 class="m-h1">${greeting()}</h1>${st > 1 ? `<p class="m-lede">${ico('flame', 15)} ${st}-day streak</p>` : ''}</section>
    ${workoutCard(p)}
    <div class="m-sec"><h2>Games</h2><span>${totalDone} of 100 levels</span></div>
    <div class="m-grid">${GAMES.map((g, i) => tile(g, p, i)).join('')}</div>
    <div class="m-sec"><h2>Performance</h2><span>5 skills</span></div>
    ${played ? skills(p) : ''}`;
  const pl = document.getElementById('mPill'); if (pl) pl.innerHTML = pill(p);
  // bars grow in; numbers count up on first paint
  requestAnimationFrame(() => requestAnimationFrame(() => { const r = document.getElementById('skRows'); if (r) r.classList.remove('pre'); }));
  if (first) {
    first = false;
    root.classList.add('enter');
    const t = document.getElementById('skTotal'); if (t) countUp(t, +t.textContent, 1100, v => Math.round(v).toLocaleString('en-IN'));
  } else { const t = document.getElementById('skTotal'); if (t) t.textContent = (+t.textContent).toLocaleString('en-IN'); }
}

root.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  sfx('tap'); buzz('light');
});

render();
// Workout just finished: celebrate once, then clean the URL.
const q = new URLSearchParams(location.search);
if (q.get('wdone') === '1') {
  history.replaceState(history.state, '', location.pathname);
  setTimeout(() => {
    const r = document.querySelector('.wo-ring'); const b = r ? r.getBoundingClientRect() : { left: innerWidth / 2, top: 160, width: 0, height: 0 };
    confetti(b.left + b.width / 2, b.top + b.height / 2, 150); sfx('levelup'); buzz('success');
    toast('Workout complete! See you tomorrow.', 'ok');
  }, 350);
}
store.pull().then(changed => { if (changed) render(); });
addEventListener('pageshow', e => { if (e.persisted) render(); });
