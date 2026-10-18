// Phone-friendly code editor: a textarea over a highlighted <pre>, line numbers, auto-indent,
// Tab = 4 spaces, a symbol key bar, and line marks (current step, error line).
import { highlight } from './hl.js';
import { esc } from './lib.js';

const LH = 22, PAD = 12;
const KEYS = [['tab', '⇥'], ['(', '( )'], [':', ':'], ['"', '" "'], ["'", "' '"], ['[', '[ ]'], ['=', '='], ['.', '.'], [',', ','], ['_', '_'], ['+', '+'], ['-', '-'], ['*', '*'], ['/', '/'], ['<', '<'], ['>', '>'], ['{', '{ }'], ['#', '#'], ['%', '%'], ['undo', '↶']];
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };

export function createEditor(host, { value = '', onChange, onRun, label = 'main.py', keybar = true } = {}) {
  host.innerHTML = `<div class="ed"><div class="ed-head"><span class="ed-file">${esc(label)}</span><span class="ed-lang">Python 3</span></div>
    <div class="ed-body"><div class="ed-gutter" aria-hidden="true"></div><div class="ed-main"><div class="ed-marks"></div><pre class="ed-hl" aria-hidden="true"><code></code></pre>
    <textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Python code editor"></textarea></div></div>
    ${keybar ? `<div class="ed-keys" role="toolbar" aria-label="Code symbols">${KEYS.map(k => `<button type="button" data-k="${esc(k[0])}" tabindex="-1">${esc(k[1])}</button>`).join('')}</div>` : ''}</div>`;
  const ta = host.querySelector('.ed-ta'), code = host.querySelector('.ed-hl code'), gut = host.querySelector('.ed-gutter'), marks = host.querySelector('.ed-marks'), pre = host.querySelector('.ed-hl');
  const history = [];
  ta.value = value;

  function paint() {
    const v = ta.value, n = Math.max(v.split('\n').length, 4);
    code.innerHTML = highlight(v) + '\n';
    gut.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');
    const h = n * LH + PAD * 2;
    ta.style.height = h + 'px'; pre.style.height = h + 'px';
  }
  function sync() { pre.scrollLeft = ta.scrollLeft; marks.style.transform = ''; }
  function snapshot() { history.push([ta.value, ta.selectionStart]); if (history.length > 80) history.shift(); }
  function insert(text, caretOffset = text.length) {
    snapshot();
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end');
    ta.selectionStart = ta.selectionEnd = s + caretOffset;
    changed();
  }
  function changed() { paint(); clearMarks(); onChange && onChange(ta.value); }
  function lineStart(pos) { return ta.value.lastIndexOf('\n', pos - 1) + 1; }

  ta.addEventListener('input', changed);
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun && onRun(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) { const ls = lineStart(ta.selectionStart); const m = /^ {1,4}/.exec(ta.value.slice(ls)); if (m) { snapshot(); ta.setRangeText('', ls, ls + m[0].length, 'end'); changed(); } }
      else insert('    ');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = ta.selectionStart, ls = lineStart(s), line = ta.value.slice(ls, s);
      let ind = (/^\s*/.exec(line) || [''])[0];
      if (/:\s*(#.*)?$/.test(line)) ind += '    ';
      insert('\n' + ind);
      return;
    }
    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      const s = ta.selectionStart, ls = lineStart(s), before = ta.value.slice(ls, s);
      if (before.length && /^ +$/.test(before)) { e.preventDefault(); const cut = before.length % 4 || 4; snapshot(); ta.setRangeText('', s - cut, s, 'end'); changed(); }
    }
  });
  host.querySelectorAll('.ed-keys button').forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault()); // keep the keyboard open
    b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'undo') { const h = history.pop(); if (h) { ta.value = h[0]; ta.selectionStart = ta.selectionEnd = h[1]; changed(); } return; }
      if (k === 'tab') return insert('    ');
      if (PAIRS[k]) return insert(k + PAIRS[k], 1);
      insert(k);
    });
  });

  function clearMarks() { marks.innerHTML = ''; }
  function mark(line, cls = 'step') {
    if (!line) return;
    const el = document.createElement('div');
    el.className = 'ed-mark ' + cls; el.style.top = (PAD + (line - 1) * LH) + 'px';
    marks.appendChild(el);
    return el;
  }
  paint();
  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; paint(); clearMarks(); },
    focus() { ta.focus(); },
    mark, clearMarks, el: host, ta,
  };
}

// Read-only highlighted code with numbered lines and a movable step marker (used by the trace player).
export function codeView(src) {
  const lines = src.split('\n');
  return `<div class="cv-code"><div class="cv-arrow" aria-hidden="true"></div>${lines.map((l, i) => `<div class="cv-line" data-l="${i + 1}"><span class="cv-n">${i + 1}</span><span class="cv-t">${highlight(l) || ' '}</span></div>`).join('')}</div>`;
}
