// Color Clash (Stroop): a colour word in a different ink. Tap the INK colour. From level 8 a yellow WORD card
// sometimes flips the rule: then tap the colour the word names. 45 seconds; slips cost 2 seconds.
import { onTap, clamp } from '../util.js';

export const meta = {
  id: 'clash', name: 'Color Clash', skill: 'Focus', color: '#E5407A', deep: '#B32959',
  rule: 'Tap the colour of the ink, not the word you read.',
  how: [
    ['eye', 'A colour word appears, painted in a different ink.'],
    ['target', 'Tap the button that matches the INK colour.'],
  ],
};

const COLORS = [
  { id: 'red', name: 'Red', ink: '#FF5A5F' },
  { id: 'blue', name: 'Blue', ink: '#4D8DFF' },
  { id: 'green', name: 'Green', ink: '#2ECC71' },
  { id: 'yellow', name: 'Yellow', ink: '#FFD23F' },
  { id: 'purple', name: 'Purple', ink: '#B57BFF' },
  { id: 'orange', name: 'Orange', ink: '#FF9533' },
];

const TWIST = {
  5: 'Yellow joins in. Four colours now.',
  8: 'Rule flips! When the card wears a yellow WORD tag, tap the colour the word names, not the ink.',
  10: 'Purple joins. Five colours, faster cards.',
  15: 'Orange joins. Six colours, and the rule flips more often.',
};

export function levelConfig(n) {
  n = clamp(n | 0, 1, 20);
  const colors = n <= 4 ? 3 : n <= 9 ? 4 : n <= 14 ? 5 : 6;
  const t1 = 12 + Math.floor((n - 1) / 4);
  const flip = n < 8 ? 0 : Math.min(0.48, 0.2 + (n - 8) * 0.024);
  const itemTime = +(4.2 - (n - 1) * 0.13).toFixed(2);
  return {
    colors, itemTime, flip, time: 45,
    congruent: Math.max(0.08, 0.28 - n * 0.01),
    targets: [t1, t1 + 6, t1 + 12],
    lower: false, scoreLabel: 'correct', goalUnit: 'correct', resultLabel: 'correct answers',
    desc: `${colors} colours · ${itemTime}s per card${flip ? ' · rule flips' : ''}`,
    twist: TWIST[n] || '',
  };
}

export function start(host, cfg, api) {
  const pal = COLORS.slice(0, cfg.colors);
  const cols = cfg.colors === 4 ? 2 : 3;
  host.innerHTML = `<div class="cc">
    <div class="cc-rule" id="ccRule"><span class="cc-rule-in">Match the <b>INK</b></span></div>
    <div class="cc-card" id="ccCard"><span class="cc-tag" id="ccTag">INK</span><span class="cc-word" id="ccWord"></span><i class="cc-t" id="ccT"></i></div>
    <div class="cc-btns" style="--cols:${cols}">${pal.map(c => `<button class="cc-b" data-c="${c.id}" style="--c:${c.ink}"><span>${c.name}</span></button>`).join('')}</div>
  </div>`;
  const card = host.querySelector('#ccCard'), word = host.querySelector('#ccWord'), tag = host.querySelector('#ccTag');
  const rule = host.querySelector('#ccRule'), ruleIn = rule.querySelector('.cc-rule-in'), tbar = host.querySelector('#ccT');
  const btns = [...host.querySelectorAll('.cc-b')];
  let correct = 0, wrong = 0, streak = 0, bestStreak = 0, item = null, prev = null, locked = true, itemStart = 0, itemLen = 0, over = false;

  const R = Math.random;
  function nextItem() {
    if (over) return;
    let w, ink, guard = 0;
    do {
      w = pal[Math.floor(R() * pal.length)];
      // mostly a clash (ink ≠ word); now and then they agree so you cannot just "do the opposite"
      ink = R() < cfg.congruent ? w : pal[(pal.indexOf(w) + 1 + Math.floor(R() * (pal.length - 1))) % pal.length];
    } while (prev && prev.w === w && prev.ink === ink && guard++ < 10);
    const mode = cfg.flip && R() < cfg.flip ? 'word' : 'ink';
    const switched = !!prev && prev.mode !== mode;
    item = { w, ink, mode, answer: mode === 'ink' ? ink.id : w.id };
    prev = item;
    word.textContent = w.name.toUpperCase();
    word.style.color = ink.ink;
    card.classList.toggle('word', mode === 'word');
    tag.textContent = mode === 'word' ? 'WORD' : 'INK';
    ruleIn.innerHTML = mode === 'word' ? 'Match the <b>WORD</b>' : 'Match the <b>INK</b>';
    rule.classList.toggle('word', mode === 'word');
    card.classList.remove('in', 'ok', 'no'); void card.offsetWidth; card.classList.add('in');
    if (switched) { rule.classList.remove('flip'); void rule.offsetWidth; rule.classList.add('flip'); api.sfx('flip'); api.haptic('warning'); }
    itemLen = (cfg.itemTime + (switched ? 0.5 : 0)) * 1000;
    locked = true;
    api.after(switched ? 260 : 60, () => { locked = false; itemStart = api.now(); });
  }

  function answer(b) {
    if (locked || over || !item) return;
    locked = true;
    if (b.dataset.c === item.answer) {
      correct++; streak++; bestStreak = Math.max(bestStreak, streak);
      api.setScore(correct);
      card.classList.add('ok'); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
      if (streak > 0 && streak % 5 === 0) api.combo(`${streak} in a row`); else api.sfx('correct');
      api.haptic('light');
      api.after(130, nextItem);
    } else slip(b);
  }
  function slip(b) {
    wrong++; streak = 0;
    card.classList.add('no');
    if (b) { b.classList.remove('bad'); void b.offsetWidth; b.classList.add('bad'); }
    api.sfx('wrong'); api.haptic('error');
    timer.add(2);
    api.float('−2s', { el: card, dy: -10, tone: 'bad' });
    api.after(480, nextItem);
  }

  // per-card countdown inside the card (transform only)
  api.frame(t => {
    if (over || locked || !item) return;
    const f = clamp(1 - (t - itemStart) / itemLen, 0, 1);
    tbar.style.transform = `scaleX(${f.toFixed(3)})`;
    if (f <= 0) { locked = true; streak = 0; wrong++; card.classList.add('no'); api.sfx('wrong'); api.haptic('warning'); api.float('Too slow', { el: card, dy: -10, tone: 'bad' }); api.after(380, nextItem); }
  });

  const timer = api.timer({
    seconds: cfg.time,
    onEnd() { over = true; api.end({ score: correct, note: `${wrong} slip${wrong === 1 ? '' : 's'} · best streak ${bestStreak}` }); },
  });
  onTap(host.querySelector('.cc-btns'), '.cc-b', answer);
  addEventListener('keydown', e => { const k = parseInt(e.key, 10); if (k >= 1 && k <= btns.length) answer(btns[k - 1]); });
  api.setScore(0, 'correct', true);
  api.test({
    state: () => ({ correct, wrong, mode: item && item.mode, locked }),
    answer: () => item && item.answer,
    step() { if (locked || over || !item) return false; host.querySelector(`.cc-b[data-c="${item.answer}"]`).click(); return true; },
  });
  nextItem();
}
