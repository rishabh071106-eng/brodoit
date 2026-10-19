// game.html?g=<id>: hero in the game's colour, the 20-level path (★ on cleared levels, the current one glowing,
// locked ones with a lock), and one big Play button for the current level.
import * as store from './store.js';
import { byId, SKILL_ICON } from './games/index.js';
import { art } from './art.js';
import { esc, ico, toast, stars as starRow, sfx, buzz, unlockAudio } from './util.js';


unlockAudio();
const id = new URLSearchParams(location.search).get('g');
const mod = byId(id);
const root = document.getElementById('gp');
let scrolled = false;
const TIER = [['Warm-up', 1], ['Steady', 6], ['Sharp', 11], ['Master', 16]];

if (!mod) location.replace('/mind/');
else {
  const m = mod.meta;
  document.title = `${m.name} · Mind · Brodoit`;
  document.body.style.setProperty('--g', m.color);
  document.body.style.setProperty('--g-deep', m.deep);
  if (window.bdTopbar) window.bdTopbar({ back: '/mind/', backLabel: 'Mind games', title: esc(m.name), subtitle: esc(m.skill) + ' training' });

  const render = () => {
    const p = store.read(), s = store.gameStats(p, m.id), cur = s.level, all = store.allDone(p, m.id);
    const cfg = mod.levelConfig(cur);
    let path = '';
    for (const [name, from] of TIER) {
      let row = '';
      for (let l = from; l < from + 5; l++) {
        const done = store.isDone(p, m.id, l), open = store.isOpen(p, m.id, l), st = store.starsAt(p, m.id, l), isCur = l === cur && !all;
        const cls = isCur ? 'cur' : done ? 'done' : open ? 'open' : 'locked';
        const label = `Level ${l}: ${done ? `${st} star${st === 1 ? '' : 's'}` : isCur ? 'play now' : open ? 'open' : 'locked'}`;
        row += `<button class="lv ${cls}" data-l="${l}" aria-label="${label}">
          ${cls === 'locked' ? `<span class="lv-lock">${ico('lock', 16)}</span><small>${l}</small>` : `<span class="lv-n">${l}</span>${done ? `<span class="lv-st">${starRow(st, 11)}</span>` : isCur ? `<span class="lv-go">${ico('play', 12)}</span>` : ''}`}
        </button>`;
      }
      path += `<div class="lv-tier"><b>${name}</b><small>Levels ${from}–${from + 4}</small></div><div class="lv-row">${row}</div>`;
    }
    const bestText = s.best ? s.best.text : '—', bestSub = s.best ? `best · Lv ${s.best.level}` : 'best result';
    root.innerHTML = `
      <section class="gh">
        <div class="gh-art">${art(m.id, m.deep)}</div>
        <div class="gh-b">
          <span class="gh-skill">${ico(SKILL_ICON[m.skill], 15)}${esc(m.skill)}</span>
          <h1>${esc(m.name)}</h1>
          <p>${esc(m.rule)}</p>
          <div class="gh-stats">
            <span><b>${s.done}</b><small>of 20 levels</small></span>
            <span><b>${s.stars}</b><small>of 60 stars</small></span>
            <span><b>${esc(bestText)}</b><small>${esc(bestSub)}</small></span>
          </div>
        </div>
      </section>
      <div class="m-sec"><h2>Levels</h2><span>${all ? 'All clear' : `Level ${cur} is next`}</span></div>
      <div class="lv-path" id="lvPath">${path}</div>
      <div class="gp-cta">
        <div class="gp-next"><b>${all ? 'Every level cleared' : `Level ${cur}`}</b><small>${esc(cfg.desc || '')}</small></div>
        <a class="btn-play" id="playBtn" href="/mind/play.html?g=${m.id}&l=${cur}">${ico(all ? 'rotate-ccw' : 'play', 22)}<span>${all ? `Replay level ${cur}` : `Play level ${cur}`}</span></a>
      </div>`;
    const c = root.querySelector('.lv.cur');
    if (c && cur > 10 && !scrolled) { scrolled = true; c.scrollIntoView({ block: 'center' }); }
  };

  root.addEventListener('click', e => {
    const b = e.target.closest('.lv');
    if (b) {
      const l = +b.dataset.l, p = store.read();
      if (store.isOpen(p, m.id, l)) { sfx('tap'); buzz('light'); location.href = `/mind/play.html?g=${m.id}&l=${l}`; }
      else {
        sfx('wrong'); buzz('warning');
        b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
        toast(`Finish level ${store.current(p, m.id)} first`, 'lock');
      }
      return;
    }
    if (e.target.closest('#playBtn')) { sfx('tap'); buzz('light'); }
  });
  render();
  if (new URLSearchParams(location.search).has('locked')) { toast(`Finish level ${store.current(store.read(), m.id)} first`, 'lock'); history.replaceState(null, '', `?g=${m.id}`); }
  store.pull().then(ch => { if (ch) render(); });
  addEventListener('pageshow', e => { if (e.persisted) render(); });
}
