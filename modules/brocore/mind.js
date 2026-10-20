'use strict';
// Bro's own brain: an open-weights model (GGUF) that runs on this server's CPU through node-llama-cpp, in a child
// process. No AI company is in the loop: the weights are fetched once (sha256-checked, resumable) into
// MEDIA_DIR/brocore/mind/ and every answer is computed here.
//   - init({ mediaDir, getSetting, log }) picks the model this server can hold (RAM from the cgroup, CPUs from its quota),
//     fetches it in the background and starts the engine. Too little RAM or disk: it stays off and Bro uses the cloud.
//   - stream({ session, system, messages, maxTokens, signal }) → async iterable of { type: 'text', delta } and one
//     { type: 'done', stats }. One answer at a time (the CPU is shared with Bro's voice): a second caller gets OWN_BUSY.
//     Each call keeps its own chat session in the engine, so a turn only evaluates the new lines (KV cache reuse).
//   - ready(), busy(), state(), health(), dropSession(id).
// A stalled engine is killed by a watchdog; one that keeps crashing (3 times in 10 minutes) rests for an hour.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');

// The models Bro's own brain can run, best first. Picked by the brain bench (.github/workflows/brain-bench.yml, all on one
// 4-vCPU machine, Bro's prompt, English and Hindi): Gemma 3 4B speaks the most natural Hindi and good English (first
// sentence ~5 s on a fresh call, ~2 s once the call is cached, 4.2 GB); Gemma 3 1B is the small one (~2 s / ~0.6 s, 1.2 GB).
// bytes and sha256 as the bench measured them.
const MODELS = {
  big: { name: 'gemma-3-4b-it', file: 'gemma-3-4b-it-Q4_K_M.gguf', url: 'https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf', bytes: 2489894016, sha256: '04a43a22e8d2003deda5acc262f68ec1005fa76c735a9962a8c77042a74a7d19', minRamMB: 7000 }, // ~4.2 GB + Bro's voice + the app
  small: { name: 'gemma-3-1b-it', file: 'gemma-3-1b-it-Q4_K_M.gguf', url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf', bytes: 806058272, sha256: '8270790f3ab69fdfe860b7b64008d9a19986d8df7e407bb018184caa08798ebd', minRamMB: 3000 }, // ~1.2 GB
};
const ENGINE_FLAG = '--brocore-mind-engine';
const MB = 1048576;
const own = (code, msg) => Object.assign(new Error(msg || code), { code });

// ── what this server can hold ──
function readNum(f) { try { const v = fs.readFileSync(f, 'utf8').trim(); return v && v !== 'max' ? Number(v) : NaN; } catch (e) { return NaN; } }
// RAM this process may use: the container's cgroup limit when it is lower than the machine's memory
function memLimitMB(o) {
  let lim = (o && o.totalmem) || os.totalmem();
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) { const n = readNum(f); if (n > 0 && n < lim) lim = n; }
  return Math.round(lim / MB);
}
// CPUs this container may use: the cgroup quota when there is one (os.cpus() shows the whole host)
function cpuQuota(o) {
  const all = (o && o.cpus) || os.cpus().length || 1;
  try { const [q, p] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/); if (q !== 'max' && Number(p) > 0) return Math.max(1, Math.min(all, Math.floor(Number(q) / Number(p)))); } catch (e) { /* no cgroup v2 */ }
  const q1 = readNum('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'), p1 = readNum('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
  if (q1 > 0 && p1 > 0) return Math.max(1, Math.min(all, Math.floor(q1 / p1)));
  return all;
}
// 'big' | 'small' | null for this much RAM; the owner's choice (BRO_OWN_MODEL) wins when it fits
function pickModel(ramMB, want, models) {
  const M = models || MODELS;
  if (want && M[want]) return ramMB >= M[want].minRamMB ? want : null;
  for (const k of Object.keys(M)) if (ramMB >= M[k].minRamMB) return k;
  return null;
}
// reading the prompt is compute-bound: all but one CPU on a small server (Bro's voice keeps one), half on a big one
const threadsFor = cpus => cpus <= 4 ? Math.max(1, cpus - 1) : Math.min(8, Math.floor(cpus / 2));

async function freeBytes(dir) {
  if (typeof fsp.statfs !== 'function') return Infinity;
  try { const s = await fsp.statfs(dir); const n = Number(s.bavail) * Number(s.bsize); return Number.isFinite(n) ? n : Infinity; } catch (e) { return Infinity; }
}
async function sizeOf(f) { try { return (await fsp.stat(f)).size; } catch (e) { return -1; } }
function sha256File(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f, { highWaterMark: 4 * MB }).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
// GET url → appends to dest from its current size (Range), following redirects. Resolves with the final size.
function fetchResumable(url, dest, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    let hops = 0;
    const go = async u => {
      const have = Math.max(0, await sizeOf(dest));
      const req = (o.get || https.get)(u, { headers: Object.assign({ 'User-Agent': 'Brodoit-Bro/1.0 (https://brodoit.com)' }, have ? { Range: 'bytes=' + have + '-' } : {}) }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); if (++hops > 8) return reject(new Error('too many redirects'));
          return go(new URL(res.headers.location, u).toString());
        }
        if (res.statusCode === 416) { res.resume(); return resolve(have); } // already complete
        if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + u.split('?')[0])); }
        const append = res.statusCode === 206 && have > 0;
        const out = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
        let got = append ? have : 0; const total = append ? have + Number(res.headers['content-length'] || 0) : Number(res.headers['content-length'] || 0);
        res.on('data', d => { got += d.length; if (o.onProgress) o.onProgress(got, total); });
        res.pipe(out);
        out.on('finish', () => resolve(got));
        out.on('error', reject); res.on('error', reject);
      });
      req.setTimeout(o.timeoutMs || 60000, () => req.destroy(new Error('stalled download')));
      req.on('error', reject);
    };
    go(url).catch(reject);
  });
}

// ── the parent side ──
function createMind(cfg) {
  cfg = cfg || {};
  const log = cfg.log || ((...a) => console.log('[brocore/mind]', ...a));
  const getSetting = cfg.getSetting || (() => '');
  const models = cfg.models || MODELS;
  const now = cfg.now || (() => Date.now());
  const S = {
    phase: 'idle', error: '', key: null, model: null, ramMB: 0, cpus: 0, threads: 0, dir: '',
    progress: null, engine: null, job: null, seq: 0, crashes: [], restTimer: null, upAt: 0,
    stats: { answered: 0, failed: 0, aborted: 0, busy: 0, first: [], gen: [], prompt: [] },
  };
  const ring = (a, v) => { if (Number.isFinite(v)) { a.push(v); if (a.length > 50) a.shift(); } };
  const p50 = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const enabled = () => String(getSetting('BRO_OWN_BRAIN') || process.env.BRO_OWN_BRAIN || 'on').toLowerCase() !== 'off';

  async function ensureFile(m) {
    const f = path.join(S.dir, m.file);
    if (m.bytes && (await sizeOf(f)) === m.bytes) return f;
    if (!m.bytes && (await sizeOf(f)) > 0 && !m.url) return f; // a local file (tests)
    const part = f + '.partial';
    const need = (m.bytes || 3000 * MB) - Math.max(0, await sizeOf(part)) + 300 * MB;
    const free = await (cfg.freeBytes || freeBytes)(S.dir);
    if (free < need) throw own('OWN_NO_SPACE', 'not enough disk for the model (' + Math.round(free / MB) + ' MB free, need ' + Math.round(need / MB) + ' MB)');
    // another model's file is no longer needed: give its space back
    for (const k of Object.keys(models)) if (models[k] !== m) { await fsp.rm(path.join(S.dir, models[k].file), { force: true }); await fsp.rm(path.join(S.dir, models[k].file + '.partial'), { force: true }); }
    S.phase = 'downloading'; log('fetching', m.name, m.bytes ? '(' + Math.round(m.bytes / MB) + ' MB)' : '');
    let last = null;
    for (let i = 0; i < 6; i++) {
      try { await (cfg.fetch || fetchResumable)(m.url, part, { onProgress: (got, total) => { S.progress = { got, total: total || m.bytes }; } }); last = null; break; }
      catch (e) { last = e; log('download stopped (' + e.message + '), resuming in', 5 * 2 ** i, 's'); await new Promise(r => { const t = setTimeout(r, (cfg.retryMs || 5000) * 2 ** i); if (t.unref) t.unref(); }); }
    }
    if (last) throw last;
    if (m.bytes && (await sizeOf(part)) !== m.bytes) { await fsp.rm(part, { force: true }); throw own('OWN_BAD_FILE', 'model size mismatch'); }
    if (m.sha256) {
      const got = await sha256File(part);
      if (got !== m.sha256) { await fsp.rm(part, { force: true }); throw own('OWN_BAD_FILE', 'model sha256 mismatch: got ' + got.slice(0, 12)); }
    }
    await fsp.rename(part, f);
    S.progress = null;
    log('model verified', m.name);
    return f;
  }

  function spawnEngine(file) {
    return new Promise((resolve, reject) => {
      const args = cfg.enginePath ? [cfg.enginePath] : [__filename, ENGINE_FLAG];
      const c = (cfg.spawn || spawn)(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: process.env });
      let up = false;
      const t = setTimeout(() => { if (!up) { reject(new Error('own brain did not load in ' + Math.round((cfg.startTimeoutMs || 300e3) / 1000) + ' s')); try { c.kill('SIGKILL'); } catch (e) { /* gone */ } } }, cfg.startTimeoutMs || 300e3);
      c.on('message', m => {
        if (m.type === 'ready') { up = true; clearTimeout(t); resolve(c); return; }
        if (m.type === 'fatal') { clearTimeout(t); reject(new Error(m.error)); return; }
        const j = S.job; if (!j || j.id !== m.id) return; // a job that already ended
        j.feed(m);
      });
      c.on('error', e => { if (!up) { clearTimeout(t); reject(e); } });
      c.on('exit', (code, sig) => { clearTimeout(t); if (!up) reject(new Error('own brain exited (' + (sig || code) + ')')); else engineDown(c, 'own brain exited (' + (sig || code) + ')'); });
      c.send({ file, threads: S.threads, contextSize: cfg.contextSize || 2048, sequences: cfg.sequences || 3 });
    });
  }
  function engineDown(c, why) {
    if (S.engine !== c) return;
    S.engine = null; S.error = why; log(why);
    if (S.job) S.job.feed({ t: 'error', error: why, code: 'OWN_ENGINE_DOWN' });
    // healthy for 10 minutes: this crash starts a fresh count
    S.crashes = S.crashes.filter(x => now() - x < 10 * 60e3); S.crashes.push(now());
    const rest = S.crashes.length >= 3 ? 60 * 60e3 : 5000 * 2 ** (S.crashes.length - 1);
    S.phase = S.crashes.length >= 3 ? 'crashed' : 'loading';
    if (S.crashes.length >= 3) log('own brain keeps crashing: resting for an hour (the cloud answers meanwhile)');
    clearTimeout(S.restTimer);
    S.restTimer = setTimeout(() => start().catch(() => {}), cfg.restartMs != null ? cfg.restartMs : rest);
    if (S.restTimer.unref) S.restTimer.unref();
  }
  async function start() {
    if (!enabled()) { S.phase = 'off'; return; }
    if (!S.model) return;
    S.phase = S.phase === 'crashed' ? 'loading' : S.phase === 'downloading' ? 'downloading' : 'loading';
    try {
      const file = await ensureFile(S.model);
      S.phase = 'loading';
      const t0 = now();
      const c = await spawnEngine(file);
      S.engine = c; S.upAt = now(); S.phase = 'ready'; S.error = '';
      try { c.unref(); if (c.channel) c.channel.unref(); } catch (e) { /* closed */ }
      log('own brain ready ·', S.model.name, '·', S.threads, 'threads ·', Math.round((now() - t0) / 1000), 's to load');
    } catch (e) {
      // no room for the big model: the small one is better than none
      if (e.code === 'OWN_NO_SPACE' && S.key === 'big' && models.small && S.ramMB >= models.small.minRamMB) {
        log('no disk for', S.model.name + ': trying', models.small.name); S.key = 'small'; S.model = models.small; return start();
      }
      S.error = e.message;
      S.phase = e.code === 'OWN_NO_SPACE' ? 'no-space' : 'error';
      log('own brain not started:', e.message);
      if (S.phase === 'error') { clearTimeout(S.restTimer); S.restTimer = setTimeout(() => start().catch(() => {}), cfg.retryStartMs || 15 * 60e3); if (S.restTimer.unref) S.restTimer.unref(); }
    }
  }
  function init(opts) {
    opts = opts || {};
    S.dir = opts.dir || cfg.dir || path.join(opts.mediaDir || cfg.mediaDir || os.tmpdir(), 'brocore', 'mind');
    try { fs.mkdirSync(S.dir, { recursive: true }); } catch (e) { /* checked when fetching */ }
    S.ramMB = cfg.ramMB || memLimitMB(); S.cpus = cfg.cpus || cpuQuota(); S.threads = cfg.threads || threadsFor(S.cpus);
    if (!enabled()) { S.phase = 'off'; log('own brain is switched off (BRO_OWN_BRAIN=off): the cloud answers'); return api; }
    const want = String(getSetting('BRO_OWN_MODEL') || process.env.BRO_OWN_MODEL || '').toLowerCase();
    S.key = pickModel(S.ramMB, models[want] ? want : '', models);
    if (!S.key) { S.phase = 'too-small'; log('own brain needs more RAM than this server has (' + S.ramMB + ' MB): the cloud answers'); return api; }
    S.model = models[S.key];
    log('own brain:', S.model.name, 'for', S.ramMB, 'MB RAM ·', S.cpus, 'CPUs →', S.threads, 'threads');
    start().catch(() => {});
    return api;
  }

  // one answer, streamed. Throws OWN_NOT_READY / OWN_BUSY before anything is sent.
  async function* stream(req) {
    req = req || {};
    if (S.phase !== 'ready' || !S.engine) throw own('OWN_NOT_READY', 'own brain is ' + S.phase);
    if (S.job) { S.stats.busy++; throw own('OWN_BUSY', 'own brain is answering someone else'); }
    const c = S.engine, id = ++S.seq, t0 = now();
    const q = []; let wake = null, ended = false;
    const job = S.job = { id, feed: m => { q.push(m); if (wake) { const w = wake; wake = null; w(); } } };
    const idleMs = req.idleMs || cfg.idleMs || 45000;
    let idle = null;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { if (S.job === job && S.engine === c) { engineDown(c, 'own brain stalled (' + Math.round(idleMs / 1000) + ' s without a word); restarting it'); try { c.kill('SIGKILL'); } catch (e) { /* gone */ } } }, idleMs); };
    const onAbort = () => { try { c.send({ op: 'abort', id }); } catch (e) { /* gone */ } };
    if (req.signal) { if (req.signal.aborted) { S.job = null; throw abortErr(); } req.signal.addEventListener('abort', onAbort, { once: true }); }
    let first = 0, text = '';
    try {
      bump();
      c.send({ op: 'chat', id, session: String(req.session || 'once-' + id), system: String(req.system || ''), messages: (req.messages || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })), maxTokens: req.maxTokens || 220, temperature: req.temperature != null ? req.temperature : 0.6 });
      for (;;) {
        if (!q.length) { await new Promise(r => { wake = r; }); continue; }
        const m = q.shift(); bump();
        if (m.t === 'text') { if (!first) { first = now() - t0; ring(S.stats.first, first); } text += m.d; yield { type: 'text', delta: m.d }; continue; }
        if (m.t === 'error') { S.stats.failed++; throw own(m.code || 'OWN_ERROR', m.error); }
        if (m.t === 'done') {
          ended = true;
          if (m.aborted) { S.stats.aborted++; if (req.signal && req.signal.aborted) return; }
          const st = m.stats || {};
          if (st.genTps) ring(S.stats.gen, st.genTps); if (st.promptTps) ring(S.stats.prompt, st.promptTps);
          if (!m.aborted) S.stats.answered++;
          yield { type: 'done', model: 'own/' + S.model.name, stats: Object.assign({ firstMs: first }, st), aborted: !!m.aborted };
          return;
        }
      }
    } finally {
      clearTimeout(idle);
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
      if (!ended && S.engine === c) { try { c.send({ op: 'abort', id }); } catch (e) { /* gone */ } } // the caller stopped reading
      if (S.job === job) S.job = null;
    }
  }
  const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  // a call just opened: the engine reads this call's system prompt now (in its queue), so the first question only has to
  // read the question itself
  function warm(session, system) { if (S.phase === 'ready' && S.engine && session) { try { S.engine.send({ op: 'warm', session: String(session), system: String(system || '') }); } catch (e) { /* gone */ } } }
  function dropSession(id) { if (S.engine && id) { try { S.engine.send({ op: 'drop', session: String(id) }); } catch (e) { /* gone */ } } }
  const ready = () => S.phase === 'ready' && !!S.engine;
  const busy = () => !!S.job;
  function health() {
    return {
      state: S.phase, model: S.model ? S.model.name : null, ramMB: S.ramMB, cpus: S.cpus, threads: S.threads,
      progress: S.progress ? Math.round(100 * S.progress.got / Math.max(1, S.progress.total || 1)) : null,
      answered: S.stats.answered, failed: S.stats.failed, busy: S.stats.busy, aborted: S.stats.aborted,
      firstMs: p50(S.stats.first), genTps: p50(S.stats.gen), promptTps: p50(S.stats.prompt), error: S.error ? String(S.error).slice(0, 160) : '',
    };
  }
  function shutdown() { clearTimeout(S.restTimer); const c = S.engine; S.engine = null; S.phase = 'off'; if (c) { try { c.kill(); } catch (e) { /* gone */ } } }
  const api = { init, stream, ready, busy, state: () => S.phase, health, warm, dropSession, shutdown, _S: S };
  return api;
}

// ── the engine side (this same file, in a child process) ──
async function engineMain() {
  const send = m => { try { process.send(m); } catch (e) { /* parent gone */ } };
  process.on('disconnect', () => process.exit(0));
  const d = await new Promise(r => process.once('message', r));
  let llama, model, ctx, LlamaChatSession;
  try {
    ({ getLlama: llama, LlamaChatSession } = await import('node-llama-cpp'));
    llama = await llama({ gpu: false, build: 'never', logLevel: 'error' });
    model = await llama.loadModel({ modelPath: d.file });
    ctx = await model.createContext({ contextSize: d.contextSize, sequences: d.sequences, threads: d.threads });
  } catch (e) { send({ type: 'fatal', error: e.message }); setTimeout(() => process.exit(1), 50); return; }
  const sessions = new Map(); // session id → { seq, chat, used }
  const jobs = new Map(); // job id → AbortController
  // a sequence's slot is free only once its dispose() has finished
  const drop = async id => { const s = sessions.get(id); if (!s) return; sessions.delete(id); try { s.chat.dispose(); } catch (e) { /* gone */ } try { await s.seq.dispose(); } catch (e) { /* gone */ } };
  async function sessionFor(id) {
    let s = sessions.get(id);
    if (s) { s.used = Date.now(); return s; }
    if (!ctx.sequencesLeft) { const lru = [...sessions.entries()].sort((a, b) => a[1].used - b[1].used)[0]; if (lru) await drop(lru[0]); }
    let seq;
    try { seq = ctx.getSequence(); }
    catch (e) { for (const k of [...sessions.keys()]) await drop(k); seq = ctx.getSequence(); } // every slot back, then once more
    s = { seq, chat: new LlamaChatSession({ contextSequence: seq }), used: Date.now() };
    sessions.set(id, s);
    return s;
  }
  // our history → node-llama-cpp's: the system prompt, then user/model turns; the last user line is the prompt
  function split(system, messages) {
    const items = [{ type: 'system', text: system }];
    const msgs = messages.slice();
    let last = '';
    while (msgs.length && msgs[msgs.length - 1].role === 'user') last = msgs.pop().content + (last ? '\n' + last : '');
    for (const m of msgs) {
      const prev = items[items.length - 1];
      if (m.role === 'user') { if (prev.type === 'user') prev.text += '\n' + m.content; else items.push({ type: 'user', text: m.content }); }
      else if (prev.type === 'model') prev.response[0] += ' ' + m.content; else items.push({ type: 'model', response: [m.content] });
    }
    return { history: items, prompt: last };
  }
  async function chat(m) {
    const ac = new AbortController(); jobs.set(m.id, ac);
    try {
      const s = await sessionFor(m.session);
      const { history, prompt } = split(m.system, m.messages);
      if (!prompt) throw new Error('nothing to answer');
      s.chat.setChatHistory(history);
      const m0 = { i: s.seq.tokenMeter.usedInputTokens, o: s.seq.tokenMeter.usedOutputTokens };
      const t0 = Date.now(); let firstAt = 0;
      await s.chat.prompt(prompt, {
        maxTokens: m.maxTokens, temperature: m.temperature, signal: ac.signal, stopOnAbortSignal: true, budgets: { thoughtTokens: 0 },
        onTextChunk: c => { if (!firstAt) firstAt = Date.now(); send({ id: m.id, t: 'text', d: c }); },
      });
      const end = Date.now(), inTok = s.seq.tokenMeter.usedInputTokens - m0.i, outTok = s.seq.tokenMeter.usedOutputTokens - m0.o;
      const evalMs = (firstAt || end) - t0, genMs = Math.max(1, end - (firstAt || end));
      send({ id: m.id, t: 'done', aborted: ac.signal.aborted, stats: { inTok, outTok, evalMs, genMs, promptTps: Math.round(inTok / Math.max(0.001, evalMs / 1000)), genTps: +(outTok / (genMs / 1000)).toFixed(1) } });
    } catch (e) {
      if (ac.signal.aborted) send({ id: m.id, t: 'done', aborted: true, stats: {} });
      else send({ id: m.id, t: 'error', error: String(e && e.message || e).slice(0, 300) });
    } finally { jobs.delete(m.id); }
  }
  let chain = Promise.resolve(); // one answer at a time
  process.on('message', m => {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'chat') chain = chain.then(() => chat(m));
    else if (m.op === 'abort') { const ac = jobs.get(m.id); if (ac) ac.abort(); }
    else if (m.op === 'drop') chain = chain.then(() => drop(m.session)); // after any answer still running in it
    else if (m.op === 'warm') chain = chain.then(async () => { try { const s = await sessionFor(m.session); s.chat.setChatHistory([{ type: 'system', text: m.system }]); await s.chat.preloadPrompt(''); } catch (e) { /* the first answer reads it instead */ } });
  });
  // warm-up: the first evaluation is slow (allocations, page-ins)
  try { const s = await sessionFor('warmup'); s.chat.setChatHistory([{ type: 'system', text: 'You are Bro.' }]); await s.chat.prompt('Hi', { maxTokens: 4, budgets: { thoughtTokens: 0 } }); await drop('warmup'); } catch (e) { /* the first real answer pays for it */ }
  send({ type: 'ready' });
}

if (require.main === module && process.argv.includes(ENGINE_FLAG)) engineMain().catch(e => { try { process.send({ type: 'fatal', error: e.message }); } catch (x) { /* gone */ } process.exit(1); });

module.exports = { createMind, MODELS, ENGINE_FLAG, _internals: { memLimitMB, cpuQuota, pickModel, threadsFor, fetchResumable, sha256File } };
