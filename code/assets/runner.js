// Runs learner code in the Python worker. One warm interpreter per page; a program that runs
// past its time limit is stopped by terminating the worker, and a fresh one starts in the background.
export const PY_VERSION = '0.29.5';
const HARNESS = '5';

let worker = null, ready = null, seq = 0, bootMs = 0;
const pending = new Map();
const watchers = new Set();
export const state = { status: 'cold', note: '' };

function setStatus(status, note = '') {
  state.status = status; state.note = note;
  watchers.forEach(fn => { try { fn(state); } catch (e) { /* ignore */ } });
}
export function onStatus(fn) { watchers.add(fn); fn(state); return () => watchers.delete(fn); }

function spawn() {
  worker = new Worker('/code/assets/pyworker.js?v=' + PY_VERSION + '&h=' + HARNESS);
  setStatus('starting', 'Starting Python…');
  ready = new Promise((resolve, reject) => {
    const w = worker;
    w.onmessage = ev => {
      const m = ev.data || {};
      if (m.type === 'ready') { bootMs = m.ms; setStatus('ready', 'Python ' + (m.version || '') + ' ready'); resolve(m); return; }
      if (m.type === 'fatal') { setStatus('error', 'Python could not start: ' + m.error); reject(new Error(m.error)); return; }
      const p = pending.get(m.id); if (!p) return;
      if (m.type === 'out') p.onOut && p.onOut(m.stream, m.text);
      else if (m.type === 'status') p.onStatus && p.onStatus(m.text);
      else if (m.type === 'done') { pending.delete(m.id); clearTimeout(p.timer); setStatus('ready', ''); p.resolve(m.res); }
    };
    w.onerror = e => { setStatus('error', 'Python stopped unexpectedly'); reject(e); };
  });
  ready.catch(() => {});
  return ready;
}

export function warm() { if (!worker) spawn(); return ready; }

function restart() {
  try { worker && worker.terminate(); } catch (e) { /* ignore */ }
  worker = null;
  spawn();
}

// opts: { code, stdin, mode: 'run'|'test'|'trace', tests, files, needs, timeout }
export async function run(opts, { onOut, onStatus: onSt } = {}) {
  warm();
  try { await ready; } catch (e) {
    return { ok: false, out: '', err: '', log: [], error: { type: 'Startup', text: 'Python could not start on this device. Check your connection and try again.', tb: '' } };
  }
  const id = ++seq;
  const limit = opts.timeout || (opts.mode === 'run' ? 8000 : 12000) + (opts.needs && opts.needs.length ? 30000 : 0);
  setStatus('running', '');
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      restart();
      resolve({ ok: false, timeout: true, out: '', err: '', log: [], error: { type: 'Timeout', line: null, text: 'Your program ran for more than ' + Math.round(limit / 1000) + ' seconds, so it was stopped.', tb: '' } });
    }, limit);
    pending.set(id, { resolve, timer, onOut, onStatus: onSt });
    worker.postMessage({ id, code: opts.code || '', stdin: opts.stdin || '', mode: opts.mode || 'run', tests: opts.tests || '', files: opts.files || null, needs: opts.needs || [], maxSteps: opts.maxSteps || 400 });
  });
}

export function stop() {
  if (!pending.size) return;
  pending.forEach(p => { clearTimeout(p.timer); p.resolve({ ok: false, stopped: true, out: '', err: '', log: [], error: { type: 'Stopped', text: 'Stopped.', tb: '' } }); });
  pending.clear();
  restart();
}

export const bootTime = () => bootMs;

// Plain-English help for the errors beginners meet most. Bro gets the full traceback too.
const HINTS = {
  SyntaxError: 'Python could not read this line. Look for a missing colon, bracket or quote.',
  IndentationError: 'The spaces at the start of a line are off. Blocks under if/for/def need the same indent (4 spaces).',
  NameError: 'Python does not know this name yet. Check the spelling, or create the variable before using it.',
  TypeError: 'Two values of the wrong kinds met (like text + number). Convert one with int(), str() or float().',
  ValueError: 'The type is right but the value is not, like int("hello").',
  ZeroDivisionError: 'Something was divided by zero. Check the number on the right of / or %.',
  IndexError: 'You asked for a position the list does not have. Positions start at 0 and stop at len - 1.',
  KeyError: 'That key is not in the dictionary. Use .get(key) or check with "in" first.',
  AttributeError: 'This kind of value has no such method or attribute. Check the spelling and the type.',
  EOFError: 'The program asked for input. Type a value in the Input box (one per line) and run again.',
  RecursionError: 'A function called itself forever. Make sure the recursion has a base case that stops it.',
  ModuleNotFoundError: 'That module is not available here. Check the name; some packages need internet to load.',
  Timeout: 'It might be an endless loop. Check that your while loop changes something so it can stop.',
  AssertionError: 'A check in your code failed.',
};
export function hintFor(error) { return (error && HINTS[error.type]) || ''; }
