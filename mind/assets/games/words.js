// Word Builder: make words from the letters on a wheel (tap letters, or swipe across them). 90 seconds.
// Longer words score more; a word that uses every letter earns a bonus. Letter sets come from a seed word chosen
// per level with a fixed seed, so a level always has the same letters, and every set is checked to hold enough words.
import { WORDS, EXTRA } from '../words.js';
import { rng, hash, shuffle, clamp } from '../util.js';

export const meta = {
  id: 'words', name: 'Word Builder', skill: 'Language', color: '#13A07D', deep: '#0B7558',
  rule: 'Make as many words as you can from the letters on the wheel.',
  how: [
    ['pencil', 'Tap letters, or swipe across them, to spell a word.'],
    ['check', 'Press the tick to submit. Longer words score more.'],
    ['shuffle', 'Stuck? Shuffle the wheel for a fresh look.'],
  ],
};

export const POINTS = { 3: 10, 4: 20, 5: 30, 6: 50, 7: 80, 8: 110 };
const FULL_BONUS = 30;
const TGT = [[40, 90, 150], [40, 90, 150], [50, 100, 160], [50, 100, 170], [50, 110, 180], [60, 110, 180], [60, 120, 190],
  [60, 120, 200], [70, 130, 210], [70, 130, 220], [60, 130, 220], [70, 140, 230], [70, 140, 240], [80, 160, 260],
  [80, 160, 270], [90, 170, 280], [90, 180, 290], [100, 190, 300], [100, 200, 320], [110, 210, 340]];

export function levelConfig(n) {
  n = clamp(n | 0, 1, 20);
  const letters = n >= 14 ? 8 : 7, min = n >= 11 ? 4 : 3;
  return {
    n, letters, min, time: 90, targets: TGT[n - 1],
    lower: false, scoreLabel: 'pts', goalUnit: 'points', resultLabel: 'points',
    desc: `${letters} letters · words of ${min}+ letters · 90 seconds`,
    twist: n === 11 ? 'From now on, words need 4 or more letters.' : n === 14 ? 'Eight letters on the wheel. More words hide in there.' : '',
  };
}

// ── dictionary + letter sets ──
let DICT = null, CNT = null;
const counts = w => { const c = new Uint8Array(26); for (let i = 0; i < w.length; i++) c[w.charCodeAt(i) - 97]++; return c; };
const fits = (a, b) => { for (let i = 0; i < 26; i++) if (a[i] > b[i]) return false; return true; };
function init() {
  if (DICT) return;
  DICT = new Set(WORDS); for (const w of EXTRA) DICT.add(w);
  CNT = WORDS.map(w => [w, counts(w)]);
}
export const isWord = w => { init(); return DICT.has(w); };
// The big list of everyday words (plurals, -ed, -ing …) loads only when Word Builder starts, so real words are never rejected.
let more = null;
const loadMore = () => more || (more = import('../words-ok.js').then(m => { init(); for (const w of m.OK.split(' ')) DICT.add(w); }).catch(() => { more = null; }));
export const preload = loadMore;
const sets = {};
export function letterSet(n) {
  init();
  if (sets[n]) return sets[n];
  const used = new Set();
  for (let k = 1; k <= n; k++) { if (!sets[k]) sets[k] = choose(k, used); used.add(sets[k].key); }
  return sets[n];
}
function choose(n, used) {
  const cfg = levelConfig(n), L = cfg.letters, min = cfg.min, t3 = cfg.targets[2];
  const pool = WORDS.filter(w => w.length === L && (w.match(/[aeiou]/g) || []).length >= 2);
  const R = rng(hash('mind-words-' + n));
  const need = t3 * (n <= 10 ? 2.6 : 2.2), minWords = n <= 10 ? 18 : 12;
  let best = null;
  for (let i = 0; i < 400; i++) {
    const seed = pool[Math.floor(R() * pool.length)], key = [...seed].sort().join('');
    if (used.has(key)) continue;
    const c = counts(seed), words = [];
    let pts = 0;
    for (const [w, wc] of CNT) if (w.length >= min && w.length <= L && fits(wc, c)) { words.push(w); pts += POINTS[w.length]; }
    const cand = { seed, key, words, pts };
    if (pts >= need && words.length >= minWords) { best = cand; break; }
    if (!best || pts > best.pts) best = cand;
  }
  let letters, guard = 0;
  do { letters = shuffle([...best.seed], R); } while (letters.join('') === best.seed && guard++ < 10);
  return Object.assign({}, best, { letters, min });
}

const BACK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m17 9-6 6"/><path d="m11 9 6 6"/></svg>';

export function start(host, cfg, api) {
  loadMore();
  const set = letterSet(cfg.n);
  const letters = set.letters, L = letters.length;
  const ico = (n, s) => (window.ico ? window.ico(n, s) : '');
  host.innerHTML = `<div class="wb">
    <div class="wb-found" id="wbFound"><span class="wb-count" id="wbCount">0 words</span></div>
    <div class="wb-word" id="wbWord" aria-live="polite"></div>
    <div class="wb-msg" id="wbMsg" aria-live="polite"></div>
    <div class="wb-wheel" id="wbWheel">
      <div class="wb-disc"></div>
      <svg class="wb-lines" id="wbLines" aria-hidden="true"><polyline points="" /></svg>
      ${letters.map((ch, i) => `<button class="wb-l" data-i="${i}" aria-label="${ch.toUpperCase()}">${ch.toUpperCase()}</button>`).join('')}
    </div>
    <div class="wb-ctl">
      <button class="wb-ic" id="wbShuf" aria-label="Shuffle letters">${ico('shuffle', 22)}</button>
      <button class="wb-go" id="wbGo" aria-label="Submit word" disabled>${ico('check', 26)}<span>Enter</span></button>
      <button class="wb-ic" id="wbDel" aria-label="Delete last letter">${BACK}</button>
    </div>
  </div>`;
  const $ = s => host.querySelector(s);
  const wheel = $('#wbWheel'), lines = $('#wbLines'), poly = lines.querySelector('polyline');
  const wordEl = $('#wbWord'), msgEl = $('#wbMsg'), foundEl = $('#wbFound'), countEl = $('#wbCount'), goBtn = $('#wbGo');
  const btns = [...wheel.querySelectorAll('.wb-l')];
  let slots = letters.map((_, i) => i), centers = [], B = 60, sel = [], found = new Set(), score = 0, over = false, tail = null, drag = null, lastPD = 0, longest = '';

  function layout() {
    const S = wheel.clientWidth || 280;
    B = Math.round(Math.min(64, Math.max(46, S * 0.21)));
    const r = S / 2 - B / 2 - 6;
    centers = letters.map((_, i) => { const a = (-90 + slots[i] * 360 / L) * Math.PI / 180; return [S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r]; });
    btns.forEach((b, i) => { b.style.width = b.style.height = B + 'px'; b.style.transform = `translate(${(centers[i][0] - B / 2).toFixed(1)}px,${(centers[i][1] - B / 2).toFixed(1)}px)`; });
    lines.setAttribute('viewBox', `0 0 ${S} ${S}`);
    drawLines();
  }
  function drawLines() {
    const pts = sel.map(i => centers[i]);
    if (tail && pts.length) pts.push(tail);
    poly.setAttribute('points', pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
  }
  function renderWord(state) {
    wordEl.className = 'wb-word' + (state ? ' ' + state : '');
    wordEl.innerHTML = sel.length ? sel.map(i => `<span>${letters[i].toUpperCase()}</span>`).join('') : '<em>Tap or swipe the letters</em>';
    goBtn.disabled = sel.length < 2;
    btns.forEach((b, i) => b.classList.toggle('sel', sel.includes(i)));
  }
  const say = (t, tone) => { msgEl.textContent = t; msgEl.className = 'wb-msg' + (tone ? ' ' + tone : ''); };
  function push(i) { if (over || sel.includes(i)) return; sel.push(i); api.sfx('tap'); api.haptic('select'); say(''); renderWord(); drawLines(); }
  function pop() { if (!sel.length) return; sel.pop(); api.sfx('tap'); renderWord(); drawLines(); }

  function submit() {
    if (over || !sel.length) return;
    const w = sel.map(i => letters[i]).join('');
    sel = []; tail = null;
    if (w.length < cfg.min) { renderWord('no'); say(`Words need ${cfg.min}+ letters`, 'bad'); api.sfx('wrong'); api.haptic('error'); }
    else if (found.has(w)) {
      renderWord('dup'); say(`${w.toUpperCase()} is already in`, 'warn'); api.sfx('flip'); api.haptic('warning');
      const chip = foundEl.querySelector(`[data-w="${w}"]`); if (chip) { chip.classList.remove('ping'); void chip.offsetWidth; chip.classList.add('ping'); }
    } else if (isWord(w)) {
      found.add(w);
      const full = w.length === L, pts = POINTS[w.length] + (full ? FULL_BONUS : 0);
      score += pts; api.setScore(score);
      if (w.length > longest.length) longest = w;
      const chip = document.createElement('span');
      chip.className = 'wb-chip new'; chip.dataset.w = w;
      chip.innerHTML = `${w.toUpperCase()}<b>+${pts}</b>`;
      countEl.after(chip);
      countEl.textContent = `${found.size} word${found.size === 1 ? '' : 's'}`;
      renderWord('ok'); say(full ? 'Full wheel!' : w.length >= 6 ? 'Superb word!' : w.length >= 5 ? 'Great word!' : 'Nice!', 'good');
      api.float(`+${pts}`, { el: wordEl, dy: -6 });
      if (full) api.combo(`Full wheel +${FULL_BONUS}`); else api.sfx(w.length >= 5 ? 'combo' : 'correct');
      api.haptic('light');
    } else { renderWord('no'); say(`${w.toUpperCase()} is not in our word list`, 'bad'); api.sfx('wrong'); api.haptic('error'); }
    // let the coloured flash show, then clear the tray
    api.after(420, () => { if (!sel.length) renderWord(); });
    drawLines();
  }

  // ── tap or swipe on the wheel ──
  const hit = (x, y) => {
    const r = wheel.getBoundingClientRect();
    const px = x - r.left, py = y - r.top;
    for (let i = 0; i < L; i++) if (Math.hypot(px - centers[i][0], py - centers[i][1]) < B * 0.48) return i;
    return null;
  };
  wheel.addEventListener('pointerdown', e => {
    if (over || e.button > 0) return;
    const i = hit(e.clientX, e.clientY); if (i == null) return;
    e.preventDefault(); lastPD = performance.now();
    try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drag = { id: e.pointerId, moved: false };
    if (sel.includes(i)) { if (sel[sel.length - 1] === i) pop(); } else push(i);
  });
  wheel.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = wheel.getBoundingClientRect();
    tail = sel.length ? [e.clientX - r.left, e.clientY - r.top] : null;
    const i = hit(e.clientX, e.clientY);
    if (i != null) {
      if (!sel.includes(i)) { push(i); drag.moved = true; }
      else if (sel.length >= 2 && sel[sel.length - 2] === i) { pop(); drag.moved = true; }
    }
    drawLines();
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved; drag = null; tail = null; drawLines();
    if (moved && sel.length >= 2) submit();
  };
  wheel.addEventListener('pointerup', up);
  wheel.addEventListener('pointercancel', up);
  wheel.addEventListener('click', e => {
    if (performance.now() - lastPD < 700) return;
    const b = e.target.closest('.wb-l'); if (!b) return;
    const i = +b.dataset.i;
    if (sel.includes(i)) { if (sel[sel.length - 1] === i) pop(); } else push(i);
  });
  goBtn.addEventListener('click', submit);
  $('#wbDel').addEventListener('click', () => { pop(); });
  $('#wbShuf').addEventListener('click', () => {
    if (over) return;
    slots = shuffle(slots.slice());
    api.sfx('flip'); api.haptic('light');
    layout();
  });
  addEventListener('keydown', e => {
    if (over) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Backspace') pop();
    else if (/^[a-z]$/i.test(e.key)) { const k = e.key.toLowerCase(); const i = letters.findIndex((ch, j) => ch === k && !sel.includes(j)); if (i >= 0) push(i); }
  });
  addEventListener('resize', layout);

  api.timer({
    seconds: cfg.time,
    onEnd() {
      over = true; sel = []; renderWord();
      const missed = set.words.filter(w => !found.has(w)).sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 3).map(w => w.toUpperCase());
      const head = `${found.size} word${found.size === 1 ? '' : 's'}${longest ? ` · longest ${longest.toUpperCase()}` : ''}`;
      api.end({ score, note: missed.length ? `${head}. You could ${found.size ? 'also ' : ''}have made ${missed.slice(0, -1).join(', ')}${missed.length > 1 ? ' and ' : ''}${missed[missed.length - 1]}.` : head });
    },
  });
  api.setScore(0, 'pts', true);
  api.test({
    state: () => ({ score, found: [...found], letters: letters.join('') }),
    answer: () => set.words.filter(w => !found.has(w)).sort((a, b) => b.length - a.length),
    step() {
      if (over) return false;
      const w = set.words.filter(x => !found.has(x)).sort((a, b) => b.length - a.length)[0];
      if (!w) return false;
      sel = []; renderWord();
      const usedIdx = new Set();
      for (const ch of w) { const i = letters.findIndex((c, j) => c === ch && !usedIdx.has(j)); usedIdx.add(i); btns[i].click(); }
      goBtn.click();
      return true;
    },
  });
  renderWord();
  layout();
  requestAnimationFrame(() => { layout(); requestAnimationFrame(() => wheel.classList.add('ready')); });
}
