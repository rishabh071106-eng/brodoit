// Quick Math: as many sums as you can in 45 seconds on a big keypad. The answer checks itself as soon as it has
// enough digits. 10 points per answer, +5 while on a streak of 3 or more. Every result is a whole number ≥ 0.
import { onTap, clamp, ri, HI, tr, trLive } from '../util.js';

export const meta = {
  id: 'math', name: 'Quick Math', get skill() { return trLive('Math', 'गणित'); }, color: '#2563EB', deep: '#1E40AF',
  rule: tr('Solve as many sums as you can in 45 seconds.', '45 सेकंड में जितने हो सकें, उतने सवाल हल करें।'),
  how: HI ? [
    'कीपैड पर जवाब लिखें। जाँच अपने-आप होगी।',
    'लगातार 3 सही होने पर हर जवाब पर 5 अंक ज़्यादा।',
  ] : [
    'Type the answer on the keypad. It checks itself.',
    'Three in a row adds 5 points to each answer.',
  ],
};

const g = (a, b) => (b ? g(b, a % b) : a);
const pct = (p, n) => (HI ? `${n} का ${p}%` : `${p}% of ${n}`);
const K = {
  add1: R => { const a = ri(R, 1, 9), b = ri(R, 1, 9); return [`${a} + ${b}`, a + b]; },
  add2: R => { const a = ri(R, 10, 29), b = ri(R, 2, 9); return R() < 0.5 ? [`${a} + ${b}`, a + b] : [`${b} + ${a}`, a + b]; },
  add22: R => { const a = ri(R, 12, 58), b = ri(R, 11, 39); return [`${a} + ${b}`, a + b]; },
  sub1: R => { const a = ri(R, 6, 18), b = ri(R, 1, Math.min(9, a)); return [`${a} − ${b}`, a - b]; },
  sub2: R => { const a = ri(R, 21, 79), b = ri(R, 6, Math.min(49, a - 2)); return [`${a} − ${b}`, a - b]; },
  mul1: R => { const a = ri(R, 2, 5), b = ri(R, 2, 9); return R() < 0.5 ? [`${a} × ${b}`, a * b] : [`${b} × ${a}`, a * b]; },
  mul2: R => { const a = ri(R, 3, 9), b = ri(R, 3, 9); return [`${a} × ${b}`, a * b]; },
  mul3: R => { const a = ri(R, 6, 12), b = ri(R, 4, 12); return [`${a} × ${b}`, a * b]; },
  mul21: R => { const a = ri(R, 11, 25), b = ri(R, 2, 6); return [`${a} × ${b}`, a * b]; },
  mul22: R => { const a = ri(R, 11, 19), b = ri(R, 11, 15); return [`${a} × ${b}`, a * b]; },
  div1: R => { const b = ri(R, 2, 5), q = ri(R, 2, 9); return [`${b * q} ÷ ${b}`, q]; },
  div2: R => { const b = ri(R, 3, 9), q = ri(R, 3, 12); return [`${b * q} ÷ ${b}`, q]; },
  div3: R => { const b = ri(R, 6, 12), q = ri(R, 6, 15); return [`${b * q} ÷ ${b}`, q]; },
  two1: R => {
    const k = ri(R, 0, 3), a = ri(R, 2, 9), b = ri(R, 2, 6), c = ri(R, 2, 9);
    if (k === 0) return [`${c} + ${a} × ${b}`, c + a * b];
    if (k === 1) return [`${a} × ${b} + ${c}`, a * b + c];
    if (k === 2) { const m = a * b, s = ri(R, 1, Math.min(m - 1, 15)); return [`${a} × ${b} − ${s}`, m - s]; }
    const x = ri(R, 2, 8), y = ri(R, 2, 7), z = ri(R, 2, 5); return [`(${x} + ${y}) × ${z}`, (x + y) * z];
  },
  two2: R => {
    const k = ri(R, 0, 3);
    if (k === 0) { const c = ri(R, 2, 9), q = ri(R, 2, 9), tot = c * q, a = ri(R, 1, tot - 1); return [`(${a} + ${tot - a}) ÷ ${c}`, q]; }
    if (k === 1) { const a = ri(R, 3, 9), b = ri(R, 3, 9), c = ri(R, 2, 5), d = ri(R, 2, 5); const big = Math.max(a * b, c * d), sm = Math.min(a * b, c * d); return big === a * b ? [`${a} × ${b} − ${c} × ${d}`, big - sm] : [`${c} × ${d} − ${a} × ${b}`, big - sm]; }
    if (k === 2) { const a = ri(R, 2, 9), b = ri(R, 2, 9); return [`100 − ${a} × ${b}`, 100 - a * b]; }
    const a = ri(R, 12, 40), b = ri(R, 12, 40), c = ri(R, 5, Math.min(30, a + b - 1)); return [`${a} + ${b} − ${c}`, a + b - c];
  },
  miss: R => {
    const k = ri(R, 0, 3);
    if (k === 0) { const b = ri(R, 3, 19), x = ri(R, 4, 29); return [`? + ${b} = ${x + b}`, x]; }
    if (k === 1) { const a = ri(R, 15, 60), x = ri(R, 3, a - 3); return [`${a} − ? = ${a - x}`, x]; }
    if (k === 2) { const b = ri(R, 2, 9), x = ri(R, 2, 12); return [`? × ${b} = ${x * b}`, x]; }
    const b = ri(R, 2, 9), x = ri(R, 2, 9); return [`${x * b} ÷ ? = ${b}`, x];
  },
  pct1: R => {
    const p = [10, 50, 25][ri(R, 0, 2)];
    const n = p === 10 ? ri(R, 2, 20) * 10 : p === 50 ? ri(R, 3, 60) * 2 : ri(R, 2, 30) * 4;
    return [pct(p, n), n * p / 100];
  },
  pct2: R => {
    const p = [5, 15, 20, 30, 40, 75][ri(R, 0, 5)];
    const step = 100 / g(p, 100); // smallest n with a whole answer
    const n = step * ri(R, Math.max(1, Math.ceil(20 / step)), Math.floor(200 / step));
    return [pct(p, n), n * p / 100];
  },
  sq: R => { const a = ri(R, 3, 15); return [`${a}²`, a * a]; },
};
// [kind, weight] mixes for levels 1..20
const MIX = [
  [['add1', 1]],
  [['add1', 1], ['add2', 1]],
  [['add1', 3], ['add2', 3], ['sub1', 4]],
  [['add2', 4], ['sub1', 3], ['sub2', 3]],
  [['mul1', 5], ['add2', 2], ['sub1', 3]],
  [['mul2', 4], ['add22', 2], ['sub2', 2], ['add2', 2]],
  [['div1', 4], ['mul2', 3], ['sub2', 3]],
  [['div2', 3], ['mul2', 3], ['add22', 2], ['sub2', 2]],
  [['mul3', 3], ['div2', 3], ['add22', 2], ['sub2', 2]],
  [['mul21', 3], ['div2', 2], ['add22', 3], ['sub2', 2]],
  [['two1', 4], ['mul3', 2], ['div2', 2], ['add22', 2]],
  [['miss', 3], ['two1', 3], ['mul21', 2], ['div3', 2]],
  [['two1', 3], ['two2', 3], ['miss', 2], ['mul3', 2]],
  [['pct1', 4], ['two1', 2], ['mul21', 2], ['div3', 2]],
  [['pct2', 3], ['pct1', 2], ['two2', 3], ['miss', 2]],
  [['sq', 3], ['pct2', 3], ['two2', 2], ['mul21', 2]],
  [['two2', 3], ['pct2', 3], ['sq', 2], ['miss', 2]],
  [['pct2', 3], ['mul22', 2], ['two2', 3], ['sq', 2]],
  [['pct2', 2], ['mul22', 2], ['two2', 2], ['sq', 1], ['div3', 1], ['miss', 2]],
  [['pct2', 3], ['mul22', 3], ['two2', 2], ['sq', 1], ['div3', 1]],
];
// expected correct answers for three stars
const C3 = [20, 18, 17, 15, 15, 14, 14, 13, 12, 12, 10, 10, 9, 10, 9, 9, 8, 8, 8, 8];
const LABEL = HI ? ['एक अंक का जोड़', '30 तक जोड़', 'जोड़ और घटाना', 'बड़े घटाव', '5 तक के पहाड़े',
  '9 तक के पहाड़े', 'भाग', 'चारों तरह के सवाल', 'बड़े पहाड़े', 'दो अंकों के सवाल', 'दो क़दम वाले सवाल', 'ग़ायब नंबर', 'मुश्किल दो क़दम',
  'आसान प्रतिशत', 'प्रतिशत', 'वर्ग', 'मिले-जुले मुश्किल', 'बड़े गुणा', 'लंबी दिमाग़ी दौड़', 'सबसे मुश्किल'] : ['Single-digit adding', 'Adding up to 30', 'Adding and taking away', 'Bigger take-aways', 'Times tables to 5',
  'Times tables to 9', 'Dividing', 'All four', 'Bigger tables', 'Two-digit sums', 'Two steps', 'Missing numbers', 'Tricky two-steps',
  'Easy percentages', 'Percentages', 'Squares', 'Mixed hard', 'Big multiplying', 'Mental marathon', 'Grandmaster'];

const TWIST = HI ? {
  3: 'घटाना। अब घटाने के सवाल भी आएँगे।',
  5: 'पहाड़े। अभी 5 × 9 तक।',
  7: 'भाग। हर जवाब पूरी संख्या होगा।',
  11: 'दो क़दम। पहले × और ÷, फिर + और −।',
  12: 'ग़ायब नंबर। पता करें कि ? की जगह क्या आएगा।',
  14: 'प्रतिशत। 10% यानी दसवाँ हिस्सा, 50% यानी आधा, 25% यानी चौथाई।',
  15: 'मुश्किल प्रतिशत। 15% यानी 10% और उसका आधा।',
  16: 'वर्ग। 7² का मतलब 7 × 7।',
} : {
  3: 'Subtraction. Taking away joins the mix.',
  5: 'Times tables. Up to 5 × 9 for now.',
  7: 'Division. Every answer is a whole number.',
  11: 'Two steps. Do × and ÷ before + and −.',
  12: 'Missing numbers. Work out what the ? must be.',
  14: 'Percentages. 10% is a tenth, 50% is half, 25% is a quarter.',
  15: 'Harder percentages. 15% is 10% plus half of that.',
  16: 'Squares. 7² means 7 × 7.',
};

export function levelConfig(n) {
  n = clamp(n | 0, 1, 20);
  const c3 = C3[n - 1];
  return {
    mix: MIX[n - 1], time: 45,
    targets: [Math.round(c3 * 0.45) * 10, Math.round(c3 * 0.72) * 10, c3 * 10],
    lower: false, scoreLabel: tr('pts', 'अंक'), goalUnit: tr('points', 'अंक'), resultLabel: tr('points', 'अंक'),
    desc: `${LABEL[n - 1]} · ${tr('45 seconds', '45 सेकंड')}`,
    twist: TWIST[n] || '',
  };
}
export function makeProblem(cfg, R = Math.random) {
  const tot = cfg.mix.reduce((a, m) => a + m[1], 0);
  let x = R() * tot, kind = cfg.mix[0][0];
  for (const [k, w] of cfg.mix) { if ((x -= w) < 0) { kind = k; break; } }
  const [q, a] = K[kind](R);
  return { q, a: Math.round(a), kind };
}

const BACK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m17 9-6 6"/><path d="m11 9 6 6"/></svg>';

export function start(host, cfg, api) {
  host.innerHTML = `<div class="qm">
    <div class="qm-streak" id="qmStreak" aria-live="polite"></div>
    <div class="qm-qwrap"><div class="qm-q" id="qmQ"></div></div>
    <div class="qm-a" id="qmA" aria-live="polite"><span class="qm-ph">?</span></div>
    <div class="qm-pad" id="qmPad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button class="qm-k" data-k="${d}">${d}</button>`).join('')}
      <button class="qm-k fn" data-k="C" aria-label="${tr('Clear', 'सब मिटाएँ')}">C</button><button class="qm-k" data-k="0">0</button><button class="qm-k fn" data-k="<" aria-label="${tr('Delete', 'एक अंक मिटाएँ')}">${BACK}</button></div>
  </div>`;
  const qEl = host.querySelector('#qmQ'), aEl = host.querySelector('#qmA'), stEl = host.querySelector('#qmStreak');
  let p = null, input = '', score = 0, right = 0, wrong = 0, streak = 0, best = 0, locked = true, over = false, last = '';

  function show() {
    let guard = 0;
    do { p = makeProblem(cfg); } while (p.q === last && guard++ < 8);
    last = p.q;
    qEl.textContent = p.q.includes('=') ? p.q : `${p.q} =`;
    // long two-step sums shrink to fit the width instead of overflowing
    qEl.style.fontSize = '';
    const room = qEl.parentElement.clientWidth - 8;
    if (qEl.scrollWidth > room) qEl.style.fontSize = Math.floor(parseFloat(getComputedStyle(qEl).fontSize) * room / qEl.scrollWidth) + 'px';
    qEl.classList.remove('in', 'out'); void qEl.offsetWidth; qEl.classList.add('in');
    input = ''; render(); locked = false;
  }
  function render(state) {
    aEl.className = 'qm-a' + (state ? ' ' + state : '');
    aEl.innerHTML = input ? `<span>${input}</span>` : '<span class="qm-ph">?</span>';
  }
  function key(k) {
    if (locked || over) return;
    if (k === 'C') input = '';
    else if (k === '<') input = input.slice(0, -1);
    else if (input.length < 5) input = input === '0' ? k : input + k;
    api.sfx('tap'); api.haptic('select');
    render();
    if (/^\d$/.test(k) && input.length >= String(p.a).length) check();
  }
  function check() {
    locked = true;
    if (+input === p.a) {
      right++; streak++; best = Math.max(best, streak);
      const bonus = streak >= 3 ? 5 : 0, pts = 10 + bonus;
      score += pts; api.setScore(score);
      render('ok');
      api.float(bonus ? `+${pts}` : '+10', { el: aEl, dy: -8 });
      const milestone = streak === 3 || (streak > 3 && streak % 5 === 0);
      api.sfx(milestone ? 'combo' : 'correct'); api.haptic(milestone ? 'medium' : 'light');
      stEl.innerHTML = streak >= 3 ? (HI ? `<span>लगातार ${streak} सही · हर जवाब +5</span>` : `<span>Streak ${streak} · +5 each</span>`) : '';
      qEl.classList.add('out');
      api.after(170, show);
    } else {
      wrong++; streak = 0; stEl.innerHTML = '';
      input = String(p.a); render('no');
      api.sfx('wrong'); api.haptic('error');
      api.after(720, show);
    }
  }

  onTap(host.querySelector('#qmPad'), '.qm-k', b => { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); key(b.dataset.k); });
  addEventListener('keydown', e => {
    if (/^\d$/.test(e.key)) key(e.key);
    else if (e.key === 'Backspace') key('<');
    else if (e.key === 'Delete') key('C');
  });
  api.timer({ seconds: cfg.time, onEnd() { over = true; api.end({ score, note: HI ? `${right} सही · ${wrong} ग़लत · लगातार सबसे ज़्यादा ${best} सही` : `${right} right · ${wrong} wrong · best streak ${best}` }); } });
  api.setScore(0, tr('pts', 'अंक'), true);
  api.test({
    state: () => ({ q: p && p.q, input, score, locked }),
    answer: () => p && String(p.a),
    step() {
      if (locked || over || !p) return false;
      for (const d of String(p.a)) host.querySelector(`.qm-k[data-k="${d}"]`).click();
      return true;
    },
  });
  show();
}
