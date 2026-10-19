// Number Hunt (Schulte table): tap 1 → N in order as fast as you can. The top bar runs down to the one-star limit;
// the star marks on it show the 2★ and 3★ times. From level 12 the numbers jump to new places after every tap;
// "decoy" levels paint the tiles in mixed colours, sizes and tilts so the eye cannot coast.
import { shuffle, onTap, clamp } from '../util.js';

export const meta = {
  id: 'hunt', name: 'Number Hunt', skill: 'Speed', color: '#D97706', deep: '#92400E',
  rule: 'Tap the numbers in order, as fast as you can.',
  how: [
    'Tap the numbers in order, from 1 up.',
    'Faster times earn more stars.',
  ],
};

// size, reshuffle, decoy, 1★ limit, 2★, 3★ (seconds)
const T = [
  [3, 0, 0, 20, 12, 8], [3, 0, 0, 16, 10, 6.5], [4, 0, 0, 36, 23, 16], [4, 0, 0, 32, 20, 14], [4, 0, 1, 32, 21, 15],
  [5, 0, 0, 64, 42, 30], [5, 0, 0, 58, 38, 27], [5, 0, 1, 60, 40, 28], [5, 0, 1, 55, 37, 26], [6, 0, 0, 105, 72, 52],
  [6, 0, 1, 100, 70, 50], [3, 1, 0, 20, 13, 9], [4, 1, 0, 42, 28, 20], [4, 1, 0, 38, 26, 18], [4, 1, 1, 40, 27, 19],
  [5, 1, 0, 82, 56, 40], [5, 1, 1, 82, 56, 40], [5, 1, 1, 76, 52, 37], [6, 1, 0, 140, 100, 75], [6, 1, 1, 135, 96, 72],
];
// decoy tiles: muted tints on the dark board, each with a light ink of its own hue
const DECOY_BG = ['rgba(255,255,255,.08)', 'rgba(217,119,6,.22)', 'rgba(37,99,235,.24)', 'rgba(5,150,105,.24)', 'rgba(225,29,72,.22)', 'rgba(124,58,237,.24)'];
const DECOY_INK = ['#FFFFFF', '#FCD34D', '#93C5FD', '#6EE7B7', '#FDA4AF', '#C4B5FD'];

const TWIST = {
  3: 'A 4×4 board. Find 1 to 16.',
  5: 'Some numbers are decoys. Colours, sizes and tilts vary. Only the number matters.',
  6: 'A 5×5 board. Find 1 to 25.',
  10: 'A 6×6 board. Find 1 to 36.',
  12: 'Numbers move. After every tap they jump to new places.',
  19: 'The final test. A 6×6 board, and the numbers keep moving.',
};

export function levelConfig(n) {
  n = clamp(n | 0, 1, 20);
  const [size, reshuffle, decoy, t1, t2, t3] = T[n - 1];
  return {
    size, reshuffle: !!reshuffle, decoy: !!decoy, count: size * size,
    targets: [t1, t2, t3], lower: true, scoreLabel: 'sec', goalUnit: 's', resultLabel: 'seconds',
    desc: `${size}×${size} · 1 to ${size * size}${reshuffle ? ' · numbers move' : ''}${decoy ? ' · decoy colours' : ''}`,
    twist: TWIST[n] || '',
  };
}

export function start(host, cfg, api) {
  const n = cfg.size, count = cfg.count;
  const pos = shuffle([...Array(count).keys()]); // pos[k] = cell index of number k+1
  const R = Math.random;
  host.innerHTML = `<div class="nh">
    <div class="nh-find"><small>Find</small><b id="nhNext">1</b><small id="nhLeft">${count} left</small></div>
    <div class="nh-board" id="nhBoard" style="--n:${n}">${Array.from({ length: count }, (_, k) => {
      const st = cfg.decoy
        ? `--bg:${DECOY_BG[Math.floor(R() * DECOY_BG.length)]};--ink:${DECOY_INK[Math.floor(R() * DECOY_INK.length)]};--rot:${Math.round(R() * 30 - 15)}deg;--sc:${(0.8 + R() * 0.4).toFixed(2)}`
        : '';
      return `<button class="nh-t" data-n="${k + 1}" style="${st}" aria-label="${k + 1}"><span>${k + 1}</span></button>`;
    }).join('')}</div>
  </div>`;
  const board = host.querySelector('#nhBoard'), nextEl = host.querySelector('#nhNext'), leftEl = host.querySelector('#nhLeft');
  const tiles = [...board.children];
  const place = () => tiles.forEach((t, k) => { t.style.setProperty('--c', pos[k] % n); t.style.setProperty('--r', Math.floor(pos[k] / n)); });
  place();
  requestAnimationFrame(() => board.classList.add('ready'));

  let next = 1, slips = 0, over = false;
  const t = cfg.targets;
  const timer = api.timer({
    seconds: t[0],
    marks: [{ at: 1 - t[2] / t[0], stars: 3 }, { at: 1 - t[1] / t[0], stars: 2 }],
    onFrame(e) { api.setScore(e.toFixed(1), 'sec', true); },
    onEnd() { if (over) return; over = true; api.end({ failed: true, progress: (next - 1) / count, score: t[0], big: next - 1, bigLabel: `of ${count} found`, haveText: `${next - 1} of ${count}`, needText: `Find all ${count} in ${t[0]}s`, note: 'Time ran out' }); },
  });

  function tap(b) {
    if (over) return;
    const v = +b.dataset.n;
    if (v < next) return; // already found
    if (v === next) {
      b.classList.add('found'); next++;
      api.haptic('light');
      if (next > count) return finish();
      api.sfx(next % 5 === 1 ? 'correct' : 'tap');
      nextEl.textContent = next; leftEl.textContent = `${count - next + 1} left`;
      nextEl.classList.remove('pop'); void nextEl.offsetWidth; nextEl.classList.add('pop');
      if (cfg.reshuffle) {
        // everyone jumps to a new cell (transform transition, 60fps)
        const order = shuffle([...Array(count).keys()]);
        for (let k = 0; k < count; k++) pos[k] = order[k];
        place();
      }
    } else {
      slips++;
      b.classList.remove('bad'); void b.offsetWidth; b.classList.add('bad');
      api.sfx('wrong'); api.haptic('error');
      timer.add(1);
      api.float('+1s', { el: b, dy: 0, tone: 'bad' });
    }
  }
  function finish() {
    over = true;
    const e = Math.round(timer.elapsed() * 10) / 10;
    timer.stop();
    api.setScore(e.toFixed(1), 'sec');
    api.sfx('combo');
    api.end({ score: e, display: `${e.toFixed(1)}s`, note: slips ? `${slips} wrong tap${slips === 1 ? '' : 's'} (+${slips}s)` : 'No wrong taps' });
  }

  onTap(board, '.nh-t', tap);
  api.test({
    state: () => ({ next, count, slips }),
    answer: () => next,
    step() { if (over) return false; const b = board.querySelector(`.nh-t[data-n="${next}"]`); if (!b) return false; b.click(); return true; },
  });
}
