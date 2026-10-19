// Memory Grid: tiles light up together for a moment; tap them all back from memory. One wrong tap ends the round.
import { shuffle, onTap, clamp } from '../util.js';

export const meta = {
  id: 'memory', name: 'Memory Grid', skill: 'Memory', color: '#6C4DF6', deep: '#4A2FCF',
  rule: 'Tiles glow for a moment. Tap every one back from memory.',
  how: [
    ['eye', 'Watch the tiles that light up.'],
    ['brain', 'Hold the pattern in your head when they go dark.'],
    ['target', 'Tap every lit tile. One wrong tap ends the round.'],
  ],
};

// [grid size, tiles to remember] for levels 1..20
// capped at 11 tiles: past ~10 most people's visual memory gives out, so hard stays fair
const T = [[3, 3], [3, 3], [3, 4], [4, 4], [4, 5], [4, 5], [4, 6], [5, 6], [5, 6], [5, 7],
  [5, 7], [5, 8], [6, 8], [6, 8], [6, 9], [6, 9], [6, 10], [6, 10], [6, 11], [6, 11]];

const TWIST = {
  4: 'Bigger board: 4×4. Same idea, more places to look.',
  8: 'Now a 5×5 board. Try seeing the lit tiles as one shape.',
  10: 'Six rounds per level from here on.',
  13: 'The full 6×6 board. Chunk the pattern into little groups.',
  16: 'Expert boards now. Three perfect rounds earn a star.',
};

export function levelConfig(n) {
  n = clamp(n | 0, 1, 20);
  const [size, tiles] = T[n - 1];
  const rounds = n < 10 ? 5 : 6;
  return {
    size, tiles, rounds,
    show: Math.round(900 + tiles * 170 - n * 35), // the glow: longer for more tiles, shorter per tile as levels rise
    targets: rounds === 5 ? [3, 4, 5] : n >= 16 ? [3, 5, 6] : [4, 5, 6],
    twist: TWIST[n] || '',
    lower: false, scoreLabel: `of ${rounds}`, goalUnit: 'perfect rounds', resultLabel: `of ${rounds} rounds perfect`,
    desc: `${size}×${size} grid · ${tiles} tiles · ${rounds} rounds`,
  };
}

export function start(host, cfg, api) {
  const N = cfg.size * cfg.size;
  host.innerHTML = `<div class="mg">
    <div class="mg-dots" aria-label="Rounds">${Array.from({ length: cfg.rounds }, () => '<i></i>').join('')}</div>
    <div class="mg-hint" id="mgHint" aria-live="polite">Watch closely</div>
    <div class="mg-board" id="mgBoard" style="--n:${cfg.size}">${Array.from({ length: N }, (_, i) => `<button class="mg-c" data-i="${i}" aria-label="Tile ${i + 1}"><i></i></button>`).join('')}</div>
  </div>`;
  const board = host.querySelector('#mgBoard'), hint = host.querySelector('#mgHint');
  const cells = [...board.children], dots = [...host.querySelectorAll('.mg-dots i')];
  let round = 0, score = 0, streak = 0, phase = 'ready', lit = new Set(), found = new Set(), prevKey = '';
  api.setScore(0, `of ${cfg.rounds}`, true);

  const say = (t, tone) => { hint.textContent = t; hint.className = 'mg-hint' + (tone ? ' ' + tone : ''); };

  function nextRound() {
    if (round >= cfg.rounds) return finish();
    round++;
    dots.forEach((d, i) => d.classList.toggle('now', i === round - 1));
    cells.forEach(c => { c.className = 'mg-c'; });
    board.classList.remove('live', 'win', 'lose');
    let pick;
    do { pick = shuffle([...Array(N).keys()]).slice(0, cfg.tiles).sort((a, b) => a - b); } while (pick.join() === prevKey && N > cfg.tiles);
    prevKey = pick.join(); lit = new Set(pick); found = new Set();
    phase = 'ready'; say('Watch closely');
    api.after(520, () => {
      phase = 'show'; lit.forEach(i => cells[i].classList.add('on'));
      api.sfx('flip'); api.haptic('select');
      api.after(cfg.show, () => {
        lit.forEach(i => cells[i].classList.remove('on'));
        phase = 'input'; board.classList.add('live');
        say(`Tap the ${cfg.tiles} tiles`);
      });
    });
  }

  function tap(c) {
    if (phase !== 'input') return;
    const i = +c.dataset.i;
    if (found.has(i)) return;
    if (lit.has(i)) {
      found.add(i); c.classList.add('hit');
      api.sfx('tap'); api.haptic('light');
      const left = lit.size - found.size;
      if (left) say(`${left} to go`); else win();
    } else {
      c.classList.add('miss'); api.sfx('wrong'); api.haptic('error');
      lose();
    }
  }
  function win() {
    phase = 'done'; score++; streak++;
    dots[round - 1].classList.add('ok');
    board.classList.add('win'); api.setScore(score);
    say(streak >= 2 ? `Perfect × ${streak}` : 'Perfect!', 'good');
    if (streak >= 3) api.combo(`${streak} perfect in a row`); else api.sfx('correct');
    api.float('+1', { el: board, dy: board.offsetHeight / 2 });
    api.after(850, nextRound);
  }
  function lose() {
    phase = 'done'; streak = 0;
    dots[round - 1].classList.add('bad');
    board.classList.add('lose');
    lit.forEach(i => { if (!found.has(i)) cells[i].classList.add('reveal'); });
    say(found.size ? `Missed ${lit.size - found.size}. Here they were` : 'Here they were', 'bad');
    api.after(1400, nextRound);
  }
  function finish() {
    phase = 'over';
    api.end({ score, display: `${score}/${cfg.rounds}` });
  }

  onTap(board, '.mg-c', tap);
  api.test({
    state: () => ({ phase, round, score }),
    answer: () => [...lit].filter(i => !found.has(i)),
    step() { if (phase !== 'input') return false; const i = [...lit].find(x => !found.has(x)); if (i == null) return false; cells[i].click(); return true; },
    miss() { if (phase !== 'input') return false; const i = [...Array(N).keys()].find(x => !lit.has(x)); cells[i].click(); return true; },
  });
  api.after(150, nextRound);
}
