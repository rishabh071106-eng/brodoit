// Brodoit Python worker: real CPython (Pyodide) off the main thread, so a stuck loop never
// freezes the page (the page terminates this worker and starts a new one).
/* global loadPyodide */
const Q = new URLSearchParams(self.location.search);
const VER = Q.get('v') || '0.29.5';
const BASE = self.location.origin + '/code/py/' + VER + '/';
importScripts(BASE + 'pyodide.js');

let py = null, run = null;
const boot = (async () => {
  const t0 = Date.now();
  py = await loadPyodide({
    indexURL: BASE,
    packageBaseUrl: 'https://cdn.jsdelivr.net/pyodide/v' + VER + '/full/',
    stdout: () => {}, stderr: () => {},
  });
  const src = await (await fetch('/code/assets/harness.py?v=' + (Q.get('h') || '1'))).text();
  py.runPython(src);
  run = py.globals.get('bd_run');
  self.postMessage({ type: 'ready', ms: Date.now() - t0, version: py.version });
})().catch(e => self.postMessage({ type: 'fatal', error: String((e && e.message) || e) }));

self.onmessage = async ev => {
  const m = ev.data || {};
  try { await boot; } catch (e) { return; }
  if (!run) return self.postMessage({ type: 'done', id: m.id, res: { ok: false, error: { type: 'Startup', text: 'Python did not start.', tb: '' } } });
  if (m.needs && m.needs.length) {
    self.postMessage({ type: 'status', id: m.id, text: 'Loading ' + m.needs.join(', ') + '…' });
    try { await py.loadPackage(m.needs, { messageCallback: () => {}, errorCallback: () => {} }); }
    catch (e) { self.postMessage({ type: 'status', id: m.id, text: 'Could not load ' + m.needs.join(', ') + ' (needs internet).' }); }
  }
  let sent = 0;
  const sink = (stream, text) => { if (sent++ < 3000) self.postMessage({ type: 'out', id: m.id, stream, text }); };
  let res;
  try {
    const json = await run(JSON.stringify({ code: m.code || '', stdin: m.stdin || '', mode: m.mode || 'run', tests: m.tests || '', files: m.files || null, maxSteps: m.maxSteps || 400 }), sink);
    res = JSON.parse(json);
  } catch (e) {
    res = { ok: false, out: '', err: '', log: [], error: { type: 'Internal', text: String((e && e.message) || e).split('\n').slice(-2).join(' '), tb: '' } };
  }
  self.postMessage({ type: 'done', id: m.id, res, streamed: Math.min(sent, 3000), total: sent });
};
