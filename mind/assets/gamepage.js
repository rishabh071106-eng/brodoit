// game.html?g=<id>: a calm header (icon tile, name, one line on the skill, three small stats), the 20 levels as a
// grid of numbered circles (done = filled, current = ring, locked = muted), and one Play button at the bottom.
import * as store from './store.js';
import { byId } from './games/index.js';
import { icon } from './art.js';
import { esc, ico, toast, sfx, buzz, titleOnScroll, unlockAudio, HI, tr, rawText } from './util.js';

unlockAudio();
const id = new URLSearchParams(location.search).get('g');
const mod = byId(id);
const root = document.getElementById('gp');
let scrolled = false;

if (!mod) location.replace('/mind/');
else {
  const m = mod.meta;
  document.title = `${m.name} · ${tr('Games', 'गेम्स')} · Brodoit`;
  document.body.style.setProperty('--g', m.color);
  document.body.style.setProperty('--g-deep', m.deep);
  // back goes to Learn → Games (the one Games list), not the /mind/ library
  if (window.bdTopbar) window.bdTopbar({ back: window.bdLearnHref || '/?tab=learn&hub=games', backLabel: tr('Games', 'गेम्स पर वापस'), title: esc(m.name) });

  const dots = n => `<span class="lv-st" aria-hidden="true">${[0, 1, 2].map(i => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;

  const render = () => {
    const p = store.read(), s = store.gameStats(p, m.id), cur = s.level, all = store.allDone(p, m.id);
    const cfg = mod.levelConfig(cur);
    let grid = '';
    for (let l = 1; l <= store.LEVELS; l++) {
      const done = store.isDone(p, m.id, l), open = store.isOpen(p, m.id, l), st = store.starsAt(p, m.id, l), isCur = l === cur && !all;
      const cls = isCur ? 'cur' : done ? 'done' : open ? 'open' : 'locked';
      const label = HI
        ? `लेवल ${l}: ${done ? `${st} स्टार` : isCur ? 'अभी खेलें' : open ? 'खुला' : 'बंद'}`
        : `Level ${l}: ${done ? `${st} star${st === 1 ? '' : 's'}` : isCur ? 'play now' : open ? 'open' : 'locked'}`;
      grid += `<button class="lv ${cls}" data-l="${l}" aria-label="${label}"><span class="lv-n">${l}</span>${done ? dots(st) : cls === 'locked' ? `<span class="lv-lock" aria-hidden="true">${ico('lock', 11)}</span>` : ''}</button>`;
    }
    const bestText = s.best ? rawText(s.best.text) : '–';
    root.innerHTML = `
      <header class="gp-h">
        <span class="ui-ic gp-ic" style="--ui-accent:${m.color}">${icon(m.id, 30)}</span>
        <h1 id="gpT">${esc(m.name)}</h1>
        <p>${esc(m.rule)}</p>
        <div class="gp-stats">
          <span><b>${s.done}<small>/20</small></b><small>${tr('Levels', 'लेवल')}</small></span>
          <span><b>${s.stars}<small>/60</small></b><small>${tr('Stars', 'स्टार')}</small></span>
          <span><b>${esc(bestText)}</b><small>${s.best ? (HI ? `सबसे अच्छा<br>लेवल ${s.best.level}` : `Best · level ${s.best.level}`) : tr('Best', 'सबसे अच्छा')}</small></span>
        </div>
      </header>
      <div class="ui-sec"><span>${tr('Levels', 'लेवल')}</span><span class="gp-next">${all ? tr('All clear', 'सब पूरे') : HI ? `अगला: लेवल ${cur}` : `Level ${cur} next`}</span></div>
      <div class="lv-grid" id="lvPath">${grid}</div>
      <div class="gp-cta"><div class="gp-cta-in">
        <p class="gp-desc">${esc(cfg.desc || '')}</p>
        <a class="ui-btn wide" id="playBtn" href="/mind/play.html?g=${m.id}&l=${cur}">${HI ? (all ? `लेवल ${cur} फिर खेलें` : `लेवल ${cur} खेलें`) : all ? `Replay level ${cur}` : `Play level ${cur}`}</a>
      </div></div>`;
    titleOnScroll(document.getElementById('gpT'));
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
        toast(HI ? `पहले लेवल ${store.current(p, m.id)} पूरा करें` : `Finish level ${store.current(p, m.id)} first`, 'lock');
      }
      return;
    }
    if (e.target.closest('#playBtn')) { sfx('tap'); buzz('light'); }
  });
  render();
  if (new URLSearchParams(location.search).has('locked')) { toast(HI ? `पहले लेवल ${store.current(store.read(), m.id)} पूरा करें` : `Finish level ${store.current(store.read(), m.id)} first`, 'lock'); history.replaceState(null, '', `?g=${m.id}`); }
  store.pull().then(ch => { if (ch) render(); });
  addEventListener('pageshow', e => { if (e.persisted) render(); });
}
