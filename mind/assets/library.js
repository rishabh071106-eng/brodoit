// /mind/ library: the "Games" page. Large title, today's workout (3 games picked by date, played back to back),
// the five games as one list, and once you have played, a compact skills card.
import * as store from './store.js';
import { GAMES, byId } from './games/index.js';
import { icon } from './art.js';
import { esc, ico, ring, toast, sfx, buzz, titleOnScroll, unlockAudio } from './util.js';

unlockAudio();
const TIERS = [[20, 'Master'], [15, 'Expert'], [10, 'Advanced'], [5, 'Skilled'], [1, 'Beginner'], [0, 'Not started']];
const tierOf = (done, started) => (!started ? 'Not started' : (TIERS.find(([n]) => done >= n) || TIERS[4])[1]);
const root = document.getElementById('lib');

if (window.bdTopbar) window.bdTopbar({ title: 'Games' });

function workoutCard(p) {
  const w = store.workout(p), n = w.done.length, left = 3 - n;
  const link = (g, wk) => `/mind/play.html?g=${g}&l=${store.current(p, g)}${wk ? '&w=1' : ''}`;
  const href = w.next ? link(w.next, true) : link(w.games[0], false);
  const label = n === 0 ? 'Start' : w.next ? 'Continue' : 'Play again';
  const sub = w.complete ? 'Done for today' : n ? `${left} left · ~${left * 2} min` : '3 games · ~6 min';
  return `<section class="ui-card wo${w.complete ? ' complete' : ''}" aria-labelledby="woT">
    <div class="wo-head">
      <div class="wo-hl"><h2 id="woT">Today's workout</h2><p>${sub}</p></div>
      <div class="wo-ring" role="img" aria-label="${n} of 3 games done">${ring(n / 3, 48, 4, 'var(--b-ink)', 'var(--b-line)')}<b>${n}/3</b></div>
    </div>
    <div class="wo-games">${w.games.map(g => {
      const m = byId(g).meta, d = w.done.includes(g);
      return `<a class="wo-g${d ? ' on' : ''}${g === w.next ? ' next' : ''}" href="${link(g, true)}" aria-label="${esc(m.name)}${d ? ', done' : `, level ${store.current(p, g)}`}">
        <span class="ui-ic" style="--ui-accent:${m.color}">${d ? ico('check', 22) : icon(g, 24)}</span>
        <b>${esc(m.name)}</b><small>${d ? 'Done' : `Level ${store.current(p, g)}`}</small></a>`;
    }).join('')}</div>
    <a class="ui-btn wide${w.complete ? ' sec' : ''}" id="woBtn" href="${href}">${esc(label)}</a>
  </section>`;
}

function row(mod, p) {
  const m = mod.meta, s = store.gameStats(p, m.id), all = store.allDone(p, m.id);
  const status = !s.started ? 'New' : all ? 'All 20 levels' : `Level ${s.level}`;
  return `<a class="ui-row m-game" href="/mind/game.html?g=${m.id}" data-g="${m.id}" aria-label="${esc(m.name)}, trains ${esc(m.skill)}, ${status.toLowerCase()}">
    <span class="ui-ic" style="--ui-accent:${m.color}">${icon(m.id, 24)}</span>
    <span class="ui-tx"><b>${esc(m.name)}</b><small>${esc(m.skill)} · ${status}</small>${s.started ? `<span class="ui-prog" style="--ui-accent:${m.color}" aria-hidden="true"><i style="width:${Math.max(3, Math.round(s.done / store.LEVELS * 100))}%"></i></span>` : ''}</span>
    <span class="ui-chev" aria-hidden="true">${ico('chevron-right', 18)}</span>
  </a>`;
}

function skills(p) {
  let total = 0;
  const rows = GAMES.map(mod => {
    const m = mod.meta, s = store.gameStats(p, m.id);
    total += s.sum;
    return `<div class="sk-row" style="--ui-accent:${m.color}">
      <span class="sk-l"><b>${esc(m.skill)}</b><small>${tierOf(s.done, s.started)}</small></span>
      <span class="sk-bar" aria-hidden="true"><i style="width:${Math.max(s.sum ? 2 : 0, Math.min(100, s.sum / 20)).toFixed(1)}%"></i></span>
      <span class="sk-n">${s.sum.toLocaleString('en-IN')}</span>
    </div>`;
  }).join('');
  return `<div class="ui-sec"><span id="skT">Skills</span><span>Score ${total.toLocaleString('en-IN')}</span></div>
    <section class="ui-card sk" aria-labelledby="skT">${rows}</section>`;
}

function render() {
  const p = store.read();
  const played = (p.plays | 0) > 0, st = store.streak(p);
  const totalDone = GAMES.reduce((a, g) => a + store.gameStats(p, g.meta.id).done, 0);
  const sub = played ? `${totalDone} of 100 levels${st > 0 ? ` · ${st}-day streak` : ''}` : 'Five games · 100 levels';
  root.innerHTML = `
    <header class="ui-page-h m-head"><div><h1 id="libT">Games</h1><p>${sub}</p></div></header>
    ${workoutCard(p)}
    <div class="ui-sec"><span>All games</span></div>
    <nav class="ui-list m-games" aria-label="All games">${GAMES.map(g => row(g, p)).join('')}</nav>
    ${played ? skills(p) : ''}`;
  titleOnScroll(document.getElementById('libT'));
}

root.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  sfx('tap'); buzz('light');
});

render();
// Workout just finished: say so once, then clean the URL.
const q = new URLSearchParams(location.search);
if (q.get('wdone') === '1') {
  history.replaceState(history.state, '', location.pathname);
  setTimeout(() => { sfx('levelup'); buzz('success'); toast('Workout done', 'ok'); }, 300);
}
store.pull().then(changed => { if (changed) render(); });
addEventListener('pageshow', e => { if (e.persisted) render(); });
