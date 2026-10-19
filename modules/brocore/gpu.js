// Bro Core GPU voice (optional). When the owner pastes a RunPod key in Admin, this creates a serverless endpoint
// running brocore/gpu (Chatterbox Multilingual with Bro's cloned voice) and speaks through it.
// Without a key, nothing here runs and Bro speaks with the CPU voice (voice.js).
//   - Setup (template + endpoint) runs in the background. A failure backs off 15 minutes before the next try, and a
//     template created once is reused in this process, so a failing setup never POSTs a new template per speak().
//   - A new endpoint (or one remembered in settings, once per process) must answer a {ping:true} job before it is used.
//     The first cold start pulls a large image, so the ping may wait up to 20 minutes. Until it has answered once, speak()
//     throws at once and the CPU voice speaks. A worker that cannot start (e.g. the GHCR image is private) shows in
//     health().error.
//   - Recordings and other non-live speech then use it (a cold worker takes ~30 s to start); live calls use it only while
//     a worker is already warm, so a call never waits on a cold start.
const REST = 'https://rest.runpod.io/v1';
const RUN = 'https://api.runpod.ai/v2';
const IMAGE = 'ghcr.io/rishabh071106-eng/brocore-gpu:latest';
const GPUS = ['NVIDIA L4', 'NVIDIA RTX A5000', 'NVIDIA RTX A4000', 'NVIDIA GeForce RTX 4090', 'NVIDIA A40'];
const BACKOFF_MS = 15 * 60e3;
const PING_WAIT_MS = 20 * 60e3;
const PULL_HINT = /pull|manifest|unauthori[sz]ed|denied|forbidden|not found|401|403|registry|image/i;

function create({ getSetting, setSetting, fetchImpl, now: nowFn, pingWaitMs, pollMs, sleep: sleepFn } = {}) {
  const f = (...a) => (fetchImpl || globalThis.fetch)(...a);
  const now = nowFn || (() => Date.now());
  const sleep = sleepFn || (ms => new Promise(r => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }));
  const state = {
    error: '', lastMs: 0, ok: 0, fail: 0, warmAt: 0, warm: false, ensuring: null, rawAuth: false,
    templateId: '', retryAt: 0, setupFails: 0, templatePosts: 0,
    usable: '', pinging: null, pingId: '', pingAt: 0, pingMs: 0,
  };
  const key = () => String(getSetting('RUNPOD_API_KEY') || '').trim();
  const configured = () => !!key() && getSetting('BROCORE_GPU') !== 'off';
  const endpointId = () => String(getSetting('RUNPOD_ENDPOINT_ID') || '').trim();
  const image = () => String(getSetting('BROCORE_GPU_IMAGE') || IMAGE);
  const backingOff = () => now() < state.retryAt;
  function failed(msg) {
    state.error = msg; state.setupFails++; state.retryAt = now() + BACKOFF_MS;
    console.log('[brocore] GPU voice:', msg, '- next try in 15 min');
  }
  // an error that looks like the worker could not get its image: say what to do about it
  const pullError = why => 'GPU worker could not start: the image probably failed to pull (' + String(why).slice(0, 120) + '). Make ' + image().replace(/:.*$/, '') + ' public in GitHub Packages, or set BROCORE_GPU_IMAGE';

  // RunPod documents both "Authorization: Bearer <key>" and a bare key, so try one and remember what works
  async function call(url, method, body, timeoutMs = 20000) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await f(url, { method, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: state.rawAuth ? key() : 'Bearer ' + key() }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 401 && attempt === 0) { state.rawAuth = !state.rawAuth; continue; }
        const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text.slice(0, 200) }; }
        return { ok: r.ok, status: r.status, body: j };
      }
    } finally { clearTimeout(t); }
  }

  // template + endpoint, created once and remembered in settings. Returns the endpoint id, or null (not configured, still
  // backing off after a failure, or failed now).
  async function ensure() {
    if (!configured()) return null;
    if (endpointId()) return endpointId();
    if (state.ensuring) return state.ensuring;
    if (backingOff()) return null;
    state.ensuring = (async () => {
      if (!state.templateId) {
        state.templatePosts++;
        const tpl = await call(REST + '/templates', 'POST', { name: 'brocore-voice-' + now().toString(36), imageName: image(), isServerless: true, containerDiskInGb: 30 });
        const templateId = tpl && tpl.ok && tpl.body && tpl.body.id;
        if (!templateId) throw new Error('template ' + (tpl && tpl.status) + ' ' + JSON.stringify(tpl && tpl.body).slice(0, 160));
        state.templateId = templateId; // reused if the endpoint step fails and is retried later
      }
      const ep = await call(REST + '/endpoints', 'POST', { name: 'brocore-voice', templateId: state.templateId, gpuTypeIds: GPUS, workersMin: 0, workersMax: 1, idleTimeout: 180, flashboot: true });
      const id = ep && ep.ok && ep.body && ep.body.id;
      if (!id) throw new Error('endpoint ' + (ep && ep.status) + ' ' + JSON.stringify(ep && ep.body).slice(0, 160));
      setSetting('RUNPOD_ENDPOINT_ID', id);
      state.error = ''; state.retryAt = 0;
      console.log('[brocore] GPU voice endpoint created', id, '- checking it with a ping before use');
      return id;
    })().catch(e => { failed('setup failed: ' + e.message); return null; })
      .finally(() => { state.ensuring = null; });
    return state.ensuring;
  }

  // One {ping:true} job, submitted async and polled, so the first cold start (image pull + model load) may take minutes.
  // The endpoint becomes usable after one success; a failure backs off 15 minutes.
  function ping(id) {
    if (state.pinging) return state.pinging;
    if (state.usable === id) return Promise.resolve(true);
    if (backingOff()) return Promise.resolve(false);
    const wait = pingWaitMs || PING_WAIT_MS, every = pollMs || 10000;
    state.pingId = id; state.pingAt = now();
    state.pinging = (async () => {
      const r = await call(RUN + '/' + id + '/run', 'POST', { input: { ping: true } });
      if (!r || !r.ok || !r.body || !r.body.id) {
        if (r && r.status === 404) { try { setSetting('RUNPOD_ENDPOINT_ID', ''); } catch (e) { /* read-only */ } }
        throw new Error('ping ' + (r && r.status) + ' ' + JSON.stringify(r && r.body).slice(0, 160));
      }
      const job = r.body.id; let st = r.body, sawUnhealthy = 0, sawInit = false;
      const deadline = now() + wait;
      for (;;) {
        const status = String((st && st.status) || '');
        if (status === 'COMPLETED') {
          const out = st.output || {};
          if (out.ok === false || out.error) throw new Error('ping answered with an error: ' + String(out.error || 'not ok').slice(0, 160));
          return true;
        }
        if (/FAILED|CANCELLED|TIMED_OUT/.test(status)) {
          const why = String(st.error || (st.output && st.output.error) || status);
          throw new Error(PULL_HINT.test(why) ? pullError(why) : 'ping job ' + status + ': ' + why.slice(0, 160));
        }
        if (now() >= deadline) {
          call(RUN + '/' + id + '/cancel/' + job, 'POST', null, 5000).catch(() => {});
          throw new Error(sawUnhealthy || sawInit ? pullError('no worker became ready in ' + Math.round(wait / 60e3) + ' min') : 'GPU ping not answered in ' + Math.round(wait / 60e3) + ' min');
        }
        await sleep(every);
        // a worker that cannot pull its image shows up as unhealthy (or never leaves initializing): fail early on that
        const h = await call(RUN + '/' + id + '/health', 'GET', null, 5000).catch(() => null);
        const w = (h && h.body && h.body.workers) || {}, n = k => Number(w[k]) || 0;
        if (n('initializing') > 0) sawInit = true;
        if (n('unhealthy') > 0 && n('idle') + n('running') + n('ready') === 0) {
          if (++sawUnhealthy >= 3) { call(RUN + '/' + id + '/cancel/' + job, 'POST', null, 5000).catch(() => {}); throw new Error(pullError('worker unhealthy')); }
        } else sawUnhealthy = 0;
        const s = await call(RUN + '/' + id + '/status/' + job, 'GET', null, 10000).catch(() => null);
        if (s && s.status === 404) throw new Error('ping job vanished (404)');
        if (s && s.ok && s.body) st = s.body;
      }
    })().then(ok => {
      state.usable = id; state.error = ''; state.retryAt = 0; state.pingMs = now() - state.pingAt;
      state.warm = true; state.warmAt = now();
      console.log('[brocore] GPU voice endpoint', id, 'answered its ping in', Math.round(state.pingMs / 1000), 's: in use');
      return ok;
    }, e => { failed(e.message); return false; })
      .finally(() => { state.pinging = null; });
    return state.pinging;
  }

  // Background: create the endpoint if needed, then ping it. Never waits; callers fall back to the CPU voice meanwhile.
  function prepare() {
    if (!configured() || state.ensuring || state.pinging) return;
    const id = endpointId();
    if (id && state.usable === id) return;
    if (backingOff()) return;
    (id ? Promise.resolve(id) : ensure()).then(x => { if (x) return ping(x); }).catch(() => {});
  }

  // a worker is warm when RunPod reports one idle or running; checked at most every 20 s
  async function isWarm() {
    if (!configured() || !endpointId()) return false;
    if (now() - state.warmAt < 20000) return state.warm;
    state.warmAt = now();
    try {
      const r = await call(RUN + '/' + endpointId() + '/health', 'GET', null, 5000);
      const w = (r && r.body && r.body.workers) || {};
      state.warm = (Number(w.idle) || 0) + (Number(w.running) || 0) > 0;
    } catch (e) { state.warm = false; }
    return state.warm;
  }

  // → { audio: Buffer (wav), mime, seconds }. Throws at once while the endpoint is being set up or checked.
  async function speak(text, { lang = 'en', live = false } = {}) {
    if (!configured()) throw new Error('GPU voice not configured');
    const id = endpointId();
    if (!id || state.usable !== id) {
      prepare();
      throw new Error(state.error ? 'GPU voice unavailable: ' + state.error : id ? 'GPU voice is being checked (ping)' : 'GPU voice is being set up');
    }
    if (live && !(await isWarm())) throw new Error('GPU voice is cold');
    const started = now();
    const r = await call(RUN + '/' + id + '/runsync?wait=60000', 'POST', { input: { text: String(text).slice(0, 1200), lang } }, live ? 15000 : 65000);
    const out = r && r.body && r.body.output;
    if (!r || !r.ok || !r.body || r.body.status !== 'COMPLETED' || !out || !out.audio) {
      state.fail++; state.error = 'speak ' + (r && r.status) + ' ' + JSON.stringify(r && r.body).slice(0, 160);
      if (r && r.status === 404) { state.usable = ''; try { setSetting('RUNPOD_ENDPOINT_ID', ''); } catch (e) {} } // endpoint deleted in RunPod: recreate next time
      throw new Error(state.error);
    }
    state.ok++; state.lastMs = now() - started; state.error = ''; state.warm = true; state.warmAt = now();
    const audio = Buffer.from(out.audio, 'base64');
    return { audio, mime: out.mime || 'audio/wav', seconds: Math.max(0, (audio.length - 44) / 2 / (out.sr || 24000)) };
  }

  // status: 'off' (no key or switched off) | 'setting up' | 'checking' | 'ready' | 'error'
  function health() {
    const id = endpointId();
    const usable = !!id && state.usable === id;
    const status = !configured() ? 'off' : usable ? 'ready' : state.error ? 'error' : state.pinging ? 'checking' : 'setting up';
    return {
      configured: configured(), status, usable,
      endpoint: id ? (usable ? 'ready' : state.pinging ? 'checking' : 'unverified') : (state.ensuring ? 'creating' : 'none'),
      warm: state.warm, lastMs: state.lastMs, ok: state.ok, fail: state.fail, error: state.error,
      retryAt: state.retryAt > now() ? new Date(state.retryAt).toISOString() : null, pingMs: state.pingMs || null,
      keyMissing: !key(), switchedOff: getSetting('BROCORE_GPU') === 'off',
    };
  }

  return { configured, ensure, ping, prepare, isWarm, speak, health, _state: state };
}

module.exports = { create, IMAGE, GPUS, BACKOFF_MS, PING_WAIT_MS };
