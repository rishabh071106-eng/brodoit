// Admin API — the You → Admin card. Lets the admin paste the OpenAI / ElevenLabs keys from inside
// the app (verified against the provider before they are saved), see what is switched on, and run
// the one-time recordings (Hindi books, language lessons, today's bulletin) on the server with a live
// log. Who is admin is decided by deps.isAdminUser(user) — this module never decides identity.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RING = 300;          // lines kept in memory per job
const TAIL = 40;           // lines sent with /status
const VERIFY_MS = 8000;    // provider check timeout
const BOOKS_TOTAL = 106;
const LESSONS_TOTAL = 60;
const SETTING_KEYS = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_REALTIME_VOICE', 'ELEVEN_VOICE_EN', 'ELEVEN_VOICE_HI'];
const VERIFIABLE = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY'];
const STATUS_KEYS = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'];
const JOBS = {
  bulletin: { label: "Record today's bulletin" },
  'hindi-books': { label: 'Record Hindi books', script: 'hindi-books.js' },
  'lang-audio': { label: 'Record language lessons', script: 'lang-audio.js' },
};

let _maskKey;
try { _maskKey = require('./settings.js').maskKey; } catch (e) {}
const maskKey = _maskKey || (v => { v = String(v || ''); return !v ? '' : v.length <= 8 ? '•'.repeat(v.length) : v.slice(0, 3) + '…' + v.slice(-4); });

let HAS_FFMPEG = null;
function hasFfmpeg() {
  if (HAS_FFMPEG === null) { try { HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0; } catch (e) { HAS_FFMPEG = false; } }
  return HAS_FFMPEG;
}
const dayKey = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata' }).format(new Date());
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
function countFiles(dir, re) { try { return fs.readdirSync(dir).filter(f => re.test(f)).length; } catch (e) { return 0; } }

// Ask the provider whether a key works. valid: true | false (rejected) | null (could not tell).
async function verifyKey(key, value, fetchFn) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), VERIFY_MS);
  const who = key === 'OPENAI_API_KEY' ? 'OpenAI' : 'ElevenLabs';
  try {
    const r = key === 'OPENAI_API_KEY'
      ? await fetchFn('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + value }, signal: ctrl.signal })
      : await fetchFn('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': value }, signal: ctrl.signal });
    if (r.ok) return { valid: true };
    if (r.status === 401 || r.status === 403) return { valid: false, error: who + ' rejected this key (' + r.status + ')' };
    return { valid: null, error: 'Could not verify with ' + who + ' (' + r.status + ')' };
  } catch (e) {
    return { valid: null, error: e && e.name === 'AbortError' ? 'Could not reach ' + who + ' (timeout)' : 'Could not reach ' + who };
  } finally { clearTimeout(t); }
}

// Splits a stream into lines on \n and \r so "chunk 3/9\r" progress updates become lines too.
function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) { buf += chunk.toString('utf8'); const parts = buf.split(/\r\n|\n|\r/); buf = parts.pop(); for (const p of parts) onLine(p); },
    flush() { if (buf) onLine(buf); buf = ''; },
  };
}

function install(app, deps) {
  const { db, auth, isAdminUser, MEDIA_DIR, DB_PATH, getSetting, setSetting, settingSource, bulletin, scriptsDir } = deps;
  const appRoot = deps.appRoot || path.join(__dirname, '..');
  const fetchFn = deps.fetch || ((...a) => fetch(...a));
  const booksTotal = deps.booksTotal || BOOKS_TOTAL;
  const JOBS_DIR = path.join(MEDIA_DIR, 'jobs');
  try { fs.mkdirSync(JOBS_DIR, { recursive: true }); } catch (e) {}

  const requireAdmin = (req, res, next) => { let ok = false; try { ok = !!isAdminUser(req.user); } catch (e) {} if (!ok) return res.status(403).json({ error: 'admin only' }); next(); };

  // ── job state ──
  // Null-prototype map + own-key check so '__proto__' / 'constructor' / 'toString' from a URL are "unknown job",
  // never a walk up Object.prototype (which would let DELETE /jobs/__proto__ write onto every object in the process).
  const jobs = Object.create(null);
  const getJob = kind => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(JOBS, kind) && jobs[kind]) || null;
  for (const k of Object.keys(JOBS)) {
    jobs[k] = { kind: k, label: JOBS[k].label, status: 'idle', startedAt: null, finishedAt: null, exitCode: null, lines: [], proc: null, out: null, textOnly: false };
    // After a restart show the end of the previous run so the admin knows where it stopped.
    try { const prev = fs.readFileSync(path.join(JOBS_DIR, k + '.log'), 'utf8').split('\n').filter(Boolean); if (prev.length) jobs[k].lines = prev.slice(-TAIL); } catch (e) {}
  }
  const pub = (j, full) => ({ kind: j.kind, label: j.label, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt, exitCode: j.exitCode, textOnly: j.textOnly, pid: j.proc ? j.proc.pid : null, tail: j.lines.slice(-TAIL), ...(full ? { lines: j.lines.slice() } : {}) });
  const allJobs = () => Object.fromEntries(Object.keys(jobs).map(k => [k, pub(jobs[k])]));
  function pushLine(j, line) {
    line = stripAnsi(line).replace(/\s+$/, '');
    if (!line.trim()) return;
    j.lines.push(line); if (j.lines.length > RING) j.lines.splice(0, j.lines.length - RING);
    try { if (j.out) j.out.write(line + '\n'); } catch (e) {}
  }
  function begin(j, opts) {
    j.status = 'running'; j.startedAt = new Date().toISOString(); j.finishedAt = null; j.exitCode = null; j.lines = []; j.textOnly = !!(opts && opts.textOnly);
    try { j.out = fs.createWriteStream(path.join(JOBS_DIR, j.kind + '.log'), { flags: 'a' }); j.out.on('error', () => {}); } catch (e) { j.out = null; }
    pushLine(j, `── ${j.label} · started ${j.startedAt}${j.textOnly ? ' · text only' : ''} ──`);
  }
  function finish(j, code, note) {
    j.status = code === 0 ? 'done' : 'failed'; j.exitCode = code; j.finishedAt = new Date().toISOString(); j.proc = null;
    pushLine(j, note || `── ${j.status} (exit ${code}) · ${j.finishedAt} ──`);
    try { if (j.out) j.out.end(); } catch (e) {} j.out = null;
  }

  // Which inputs a job needs before it can start; returns an error string or null.
  function preflight(kind, opts) {
    const eleven = getSetting('ELEVENLABS_API_KEY'), gemini = getSetting('GEMINI_API_KEY');
    if (kind === 'bulletin') return bulletin && typeof bulletin.ensureToday === 'function' ? null : 'news channel not loaded';
    if (kind === 'hindi-books') { if (!gemini) return 'GEMINI_API_KEY is not set'; if (!eleven && !(opts && opts.textOnly)) return 'Paste an ElevenLabs key first (or run text only)'; return null; }
    if (kind === 'lang-audio') { if (!eleven) return 'Paste an ElevenLabs key first'; if (!hasFfmpeg()) return 'ffmpeg is not installed on the server'; return null; }
    return 'unknown job';
  }

  function startScript(j, opts) {
    const def = JOBS[j.kind];
    const script = path.join(scriptsDir, def.script);
    if (!fs.existsSync(script)) return { error: 'script missing: ' + def.script, status: 404 };
    const env = { ...process.env, DB_PATH: DB_PATH || '', MEDIA_DIR, GEMINI_API_KEY: getSetting('GEMINI_API_KEY') || '', ELEVENLABS_API_KEY: getSetting('ELEVENLABS_API_KEY') || '', FORCE_COLOR: '0' };
    for (const k of ['ELEVEN_VOICE_EN', 'ELEVEN_VOICE_HI']) { const v = getSetting(k); if (v) env[k] = v; }
    const args = [script]; if (j.kind === 'hindi-books' && opts && opts.textOnly) args.push('--text-only');
    let p;
    try { p = spawn(process.execPath, args, { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return { error: 'could not start: ' + e.message, status: 500 }; }
    begin(j, opts); j.proc = p;
    const out = lineSplitter(l => pushLine(j, l)), err = lineSplitter(l => pushLine(j, l));
    p.stdout.on('data', c => out.push(c)); p.stderr.on('data', c => err.push(c));
    p.on('error', e => { out.flush(); err.flush(); pushLine(j, 'error: ' + e.message); if (j.status === 'running') finish(j, 1); });
    p.on('close', (code, sig) => { out.flush(); err.flush(); if (j.status !== 'running') return; if (sig) pushLine(j, 'stopped (' + sig + ')'); finish(j, code == null ? 1 : code); });
    return { ok: true };
  }
  async function runBulletin(j) {
    begin(j);
    pushLine(j, "Writing today's bulletin text if missing, then recording EN + HI…");
    try {
      const row = await bulletin.ensureToday();
      if (row) pushLine(j, `ready: ${row.title || row.id} · text ✓ · EN ${row.audio && row.audio.en ? '✓' : '—'} · HI ${row.audio && row.audio.hi ? '✓' : '—'}`);
      if (row && !(row.audio && row.audio.en && row.audio.hi)) pushLine(j, getSetting('ELEVENLABS_API_KEY') ? 'audio incomplete — check the server log' : 'no ElevenLabs key: device voice will read this text');
      finish(j, 0);
    } catch (e) { pushLine(j, 'error: ' + (e && e.message || e)); finish(j, 1); }
  }
  function start(kind, opts) {
    const j = getJob(kind); if (!j) return { status: 404, body: { error: 'unknown job' } };
    if (j.status === 'running') return { status: 409, body: { error: 'already running', job: pub(j) } };
    const pre = preflight(kind, opts); if (pre) return { status: 400, body: { error: pre, job: pub(j) } };
    if (kind === 'bulletin') { runBulletin(j); return { status: 200, body: { ok: true, job: pub(j) } }; }
    const r = startScript(j, opts); if (r.error) return { status: r.status || 500, body: { error: r.error, job: pub(j) } };
    return { status: 200, body: { ok: true, job: pub(j) } };
  }

  // ── auto-record: recordings start themselves once the keys exist (no Record taps needed) ──
  // Order: today's bulletin → Hindi books → language lessons. Each step runs through start(kind) exactly like a
  // manual tap, is skipped when its inputs are missing (preflight) or its media is already complete, and the next
  // step waits for the previous job to finish. Triggers: a key saved in Admin, server boot, a daily sweep at 03:30 IST.
  const AUTO_ON = String(process.env.ADMIN_AUTO_RECORD || '1') !== '0';
  const auto = { queue: [], running: null, reason: '', lastRun: null, lastSweep: null, timer: null };
  function needs(kind) {
    let m; try { m = mediaInfo(); } catch (e) { return false; }
    if (kind === 'bulletin') { const t = m.news.today; return !(t && t.en && t.hi); }
    if (kind === 'hindi-books') return m.books.audio < m.books.total;
    if (kind === 'lang-audio') return m.lessons.audio < m.lessons.total;
    return false;
  }
  function autoRecord(reason) {
    if (!AUTO_ON) return { queued: [], off: true };
    const todo = ['bulletin', 'hindi-books', 'lang-audio'].filter(k => needs(k) && !preflight(k) && getJob(k).status !== 'running' && !auto.queue.includes(k) && auto.running !== k);
    for (const k of todo) auto.queue.push(k);
    if (todo.length) { auto.reason = reason || 'auto'; console.log('[admin] auto-record queued', todo.join(', '), '·', auto.reason); }
    pump();
    return { queued: auto.queue.slice(), running: auto.running };
  }
  function pump() {
    if (auto.running) return;
    if (Object.keys(jobs).some(k => jobs[k].status === 'running')) { clearTimeout(auto.timer); auto.timer = setTimeout(pump, 15000); return; }
    const kind = auto.queue.shift(); if (!kind) return;
    if (!needs(kind) || preflight(kind)) return pump();
    const r = start(kind, {});
    if (r.status !== 200) { console.log('[admin] auto-record', kind, 'did not start:', r.body && r.body.error); return pump(); }
    auto.running = kind; console.log('[admin] auto-record started', kind);
    const wait = () => {
      const j = getJob(kind);
      if (j.status === 'running') { auto.timer = setTimeout(wait, 15000); return; }
      auto.lastRun = { kind, status: j.status, at: new Date().toISOString() }; auto.running = null;
      auto.timer = setTimeout(pump, 2000);
    };
    auto.timer = setTimeout(wait, 5000);
  }
  const autoInfo = () => ({ on: AUTO_ON, queue: auto.queue.slice(), running: auto.running, lastRun: auto.lastRun, reason: auto.reason, needs: { bulletin: needs('bulletin'), 'hindi-books': needs('hindi-books'), 'lang-audio': needs('lang-audio') } });
  if (AUTO_ON) {
    setTimeout(() => { try { autoRecord('boot'); } catch (e) {} }, 90000);
    setInterval(() => {
      try {
        const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date());
        const today = dayKey();
        if (ist === '03' && auto.lastSweep !== today) { auto.lastSweep = today; autoRecord('daily sweep'); }
      } catch (e) {}
    }, 20 * 60 * 1000);
  }

  // ── status pieces ──
  function keysInfo() {
    const out = {};
    for (const k of STATUS_KEYS) { const v = getSetting(k) || ''; out[k] = { set: !!v, source: v ? (settingSource(k) || 'env') : null, hint: maskKey(v) }; }
    return out;
  }
  function voicesInfo() {
    const out = {};
    for (const k of ['OPENAI_REALTIME_VOICE', 'ELEVEN_VOICE_EN', 'ELEVEN_VOICE_HI']) { const v = getSetting(k) || ''; out[k] = { value: v, source: v ? (settingSource(k) || 'env') : null }; }
    return out;
  }
  const services = () => ({ realtime: !!getSetting('OPENAI_API_KEY'), elevenlabs: !!getSetting('ELEVENLABS_API_KEY'), gemini: !!getSetting('GEMINI_API_KEY'), ffmpeg: hasFfmpeg(), android: !!(deps.android && deps.android.status && deps.android.status().ready) });
  function lessonsTotal() {
    try { let n = 0; for (const f of fs.readdirSync(path.join(appRoot, 'lang', 'audio')).filter(f => f.endsWith('.json'))) { const c = JSON.parse(fs.readFileSync(path.join(appRoot, 'lang', 'audio', f), 'utf8')); n += (c.lessons || []).length; } return n || LESSONS_TOTAL; } catch (e) { return LESSONS_TOTAL; }
  }
  function lessonsAudio() {
    const root = path.join(MEDIA_DIR, 'lang-audio'); let n = 0;
    try { for (const d of fs.readdirSync(root)) n += countFiles(path.join(root, d), /\.mp3$/); } catch (e) {}
    return n;
  }
  function newsToday() {
    try {
      const b = bulletin && bulletin.latest && bulletin.latest('daily'); const today = dayKey();
      if (!b || b.date !== today) return null;
      return { date: b.date, text: true, en: !!(b.audio && b.audio.en), hi: !!(b.audio && b.audio.hi) };
    } catch (e) { return null; }
  }
  function mediaInfo() {
    const dbp = String(DB_PATH || '');
    const durable = MEDIA_DIR.startsWith('/data') || dbp.startsWith('/data') || (!!process.env.MEDIA_DIR && !MEDIA_DIR.startsWith(appRoot)) || (!!process.env.DB_PATH && !dbp.startsWith(appRoot));
    const booksDir = path.join(MEDIA_DIR, 'books-hi');
    return {
      dir: MEDIA_DIR, durable,
      books: { audio: countFiles(booksDir, /^hi-.*\.mp3$/), text: countFiles(booksDir, /\.json$/), total: booksTotal },
      lessons: { audio: lessonsAudio(), total: lessonsTotal() },
      news: { today: newsToday() },
    };
  }
  const statusBody = () => ({ admin: true, keys: keysInfo(), voices: voicesInfo(), services: services(), media: mediaInfo(), jobs: allJobs(), auto: autoInfo() });

  // ── routes ──
  app.get('/api/admin/status', auth, requireAdmin, (req, res) => { try { res.json(statusBody()); } catch (e) { res.status(500).json({ error: e.message }); } });

  app.post('/api/admin/settings', auth, requireAdmin, async (req, res) => {
    const b = req.body || {};
    const key = String(b.key || '');
    if (!SETTING_KEYS.includes(key)) return res.status(400).json({ error: 'unknown key' });
    const value = String(b.value == null ? '' : b.value).trim();
    const verify = b.verify !== false && b.verify !== 'false', force = b.force === true || b.force === 'true';
    const current = () => ({ key, source: settingSource(key), hint: maskKey(getSetting(key)) });
    if (value.length > 512) return res.status(400).json({ error: 'value too long' });
    if (/\s/.test(value)) return res.status(400).json({ error: 'a key has no spaces — check what you pasted' });
    if (!VERIFIABLE.includes(key) && value && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return res.status(400).json({ error: 'voice names are letters, digits, - and _' });
    try {
      if (!value) { setSetting(key, ''); return res.json({ ok: true, valid: null, saved: true, removed: true, ...current() }); }
      let valid = null, error = null;
      if (verify && !force && VERIFIABLE.includes(key)) {
        const v = await verifyKey(key, value, fetchFn); valid = v.valid; error = v.error || null;
        if (valid !== true) return res.json({ ok: false, valid, saved: false, error, ...current() });
      }
      setSetting(key, value);
      if (key === 'ELEVENLABS_API_KEY' || key === 'OPENAI_API_KEY') setTimeout(() => { try { autoRecord('key saved'); } catch (e) {} }, 1500);
      res.json({ ok: true, valid, saved: true, forced: !!force, ...current() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/auto', auth, requireAdmin, (req, res) => { res.json({ ok: true, ...autoRecord('admin') }); });
  app.get('/api/admin/jobs', auth, requireAdmin, (req, res) => {
    const kind = String(req.query.kind || '');
    if (kind) { const j = getJob(kind); if (!j) return res.status(404).json({ error: 'unknown job' }); return res.json({ job: pub(j, req.query.full === '1' || req.query.full === 'true') }); }
    res.json({ jobs: allJobs() });
  });
  app.post('/api/admin/jobs/:job', auth, requireAdmin, (req, res) => {
    const kind = String(req.params.job || '');
    const r = start(kind, { textOnly: !!(req.body && (req.body.textOnly === true || req.body.textOnly === 'true')) });
    res.status(r.status).json(r.body);
  });
  app.delete('/api/admin/jobs/:job', auth, requireAdmin, (req, res) => {
    const kind = String(req.params.job || ''); const j = getJob(kind);
    if (!j) return res.status(404).json({ error: 'unknown job' });
    if (j.status === 'running') {
      if (!j.proc) return res.status(409).json({ error: 'this job runs inside the server and cannot be stopped', job: pub(j) });
      const p = j.proc;
      try { p.kill('SIGTERM'); } catch (e) {}
      setTimeout(() => { try { if (j.proc === p) p.kill('SIGKILL'); } catch (e) {} }, 5000);
      pushLine(j, 'stop requested by admin');
      return res.json({ ok: true, stopping: true, job: pub(j) });
    }
    j.status = 'idle'; j.startedAt = null; j.finishedAt = null; j.exitCode = null; j.lines = [];
    res.json({ ok: true, cleared: true, job: pub(j) });
  });

  console.log('[admin] ready · ffmpeg', hasFfmpeg() ? '✅' : '❌', '· media', MEDIA_DIR);
  return { jobs, getJob, start, status: statusBody, hasFfmpeg };
}

module.exports = { install, verifyKey, lineSplitter, JOBS };
