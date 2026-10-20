// Bro Core · brain. Open-weight models on Groq (OpenAI-compatible): chat() for one answer, chatStream() for live turns.
// Model chain: the BROCORE_MODEL setting (admin / nightly upgrade) → the last model that worked → openai/gpt-oss-120b →
// openai/gpt-oss-20b → whichever of qwen3-32b / llama-4-maverick / llama-3.3-70b the /models list still carries.
// A retired model (404, model_decommissioned, 400 "model not found") is skipped for six hours; a rate-limited one cools
// down for a few seconds; the first model that answers is remembered for the process (like modules/gemini.js).
// Reasoning models get reasoning_effort 'low' on live turns and their reasoning is never returned or spoken.
// Every call is metered (tokens and US$ per month, by model and purpose) and streams record time-to-first-token.
// When every open model fails and BROCORE_EMERGENCY is not 'off', the old helper (server.js _callGemini, which itself
// falls back to the ElevenLabs brain) answers instead, so Bro is never silent.
// v20 "smartest first": more than one cloud. With GEMINI_API_KEY, Google's newest Flash model (read from its /models)
// streams through Google's OpenAI-compatible endpoint right after gpt-oss-120b on live turns ('gemini/<id>'); with
// OPENAI_API_KEY, an OpenAI model joins after it ('oai/<id>'). Same parser, tools, cooling and metering; a cloud whose
// key is refused is skipped for 10 minutes. req.hard (modules/brocore/route.js) asks for deeper thinking: reasoning
// 'medium' on a call, 'high' in typed chat.
'use strict';

const GROQ = 'https://api.groq.com/openai/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const OPENAI = 'https://api.openai.com/v1';
const GEMINI_FALLBACK = 'gemini-2.5-flash'; // when Google's model list can't be read
const OPENAI_PREF = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini']; // the first one this account lists
// which cloud a model id belongs to, and the id that cloud knows it by
const providerOf = m => (/^gemini\//.test(m) ? 'gemini' : /^oai\//.test(m) ? 'openai' : 'groq');
const wireModel = m => String(m).replace(/^(gemini|oai)\//, '');
const DEFAULT_CHAIN = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const EXTRA = ['qwen/qwen3-32b', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'];
// Two lanes, so background work (News writing, call summaries, nightly lessons) can never spend the per-model
// minute/day allowance that live talk needs. On Groq every model has its own limits, so each lane uses its own models.
// Live talk keeps the gpt-oss chain; background jobs (named purposes below) get models of their own. Scout ends the live
// list only as a last resort, when every other live model is out of allowance.
const BG_PURPOSES = new Set(['news', 'summary', 'lessons']);
const BG_CHAIN = ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'];
const BG_EXTRA = ['meta-llama/llama-4-maverick-17b-128e-instruct'];
// v17.6 rescue: a live turn whose whole chain failed gets one lean try on models with their own (larger) daily
// allowances, before Bro ever says sorry. Only models /models lists for the account.
const RESCUE_CHAIN = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'openai/gpt-oss-20b'];
const laneOf = req => req && req.purpose === 'rescue' ? 'rescue' : (req && !req.live && BG_PURPOSES.has(req.purpose)) ? 'bg' : 'live';
// US$ per 1M tokens [input, output]; Groq list prices, the last three approximate
const PRICES = {
  'openai/gpt-oss-120b': [0.15, 0.60], 'openai/gpt-oss-20b': [0.10, 0.50], 'qwen/qwen3-32b': [0.29, 0.59],
  'meta-llama/llama-4-maverick-17b-128e-instruct': [0.20, 0.60], 'meta-llama/llama-4-scout-17b-16e-instruct': [0.11, 0.34],
  'llama-3.3-70b-versatile': [0.59, 0.79], 'llama-3.1-8b-instant': [0.05, 0.08],
};
const DEFAULT_PRICE = [0.50, 0.80];
const CLOUD_PRICE = { gemini: [0.30, 2.50], openai: [0.25, 2.00] }; // Flash / mini list prices, when the model has no row
const priceOf = m => PRICES[m] || CLOUD_PRICE[providerOf(m)] || DEFAULT_PRICE;
const AUDIO_PER_HOUR = { 'whisper-large-v3-turbo': 0.04, 'whisper-large-v3': 0.111 };
const DEAD_MS = 6 * 3600e3, LIST_MS = 6 * 3600e3, PIN_MS = 30 * 60e3;
const isReasoning = m => /gpt-oss|qwen3|deepseek-r1|qwq|^gemini\/gemini-(2\.5|[3-9])|^oai\/(gpt-5|o\d)/i.test(m);

const month = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d || new Date()).slice(0, 7);
const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
const ring = (arr, v, n) => { arr.push(v); if (arr.length > (n || 200)) arr.splice(0, arr.length - (n || 200)); };

// ── server-sent events: data lines between blank lines; '[DONE]' passes through as a string ──
async function* sseEvents(body, signal) {
  if (!body) return;
  const dec = new TextDecoder();
  let buf = '', data = [];
  const flushEvent = function* () { if (data.length) { const d = data.join('\n'); data = []; yield d; } };
  const lines = function* (final) {
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
      if (line === '') { yield* flushEvent(); continue; }
      if (line.startsWith(':')) continue; // comment / keep-alive
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (final) { if (buf.startsWith('data:')) data.push(buf.slice(5).replace(/^ /, '')); buf = ''; yield* flushEvent(); }
  };
  const iter = typeof body.getReader === 'function' ? (async function* () { const r = body.getReader(); try { for (;;) { const { done, value } = await r.read(); if (done) return; yield value; } } finally { try { r.releaseLock(); } catch (e) { /* already released */ } } })() : body;
  for await (const chunk of iter) {
    if (signal && signal.aborted) throw abortError();
    buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    yield* lines(false);
  }
  buf += dec.decode();
  yield* lines(true);
}
function abortError() { const e = new Error('aborted'); e.name = 'AbortError'; return e; }

// <think>…</think> blocks (qwen raw reasoning) removed from a stream, even when a tag is split across chunks
function thinkFilter() {
  let buf = '', inThink = false;
  const OPEN = '<think>', CLOSE = '</think>';
  const partial = (s, tag) => { for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n; return 0; };
  return {
    push(s) {
      buf += s; let out = '';
      for (;;) {
        if (!inThink) {
          const i = buf.indexOf(OPEN);
          if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + OPEN.length); inThink = true; continue; }
          const keep = partial(buf, OPEN); out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); break;
        }
        const j = buf.indexOf(CLOSE);
        if (j >= 0) { buf = buf.slice(j + CLOSE.length).replace(/^\s+/, ''); inThink = false; continue; }
        buf = buf.slice(buf.length - partial(buf, CLOSE)); break;
      }
      return out;
    },
    flush() { const o = inThink ? '' : buf; buf = ''; return o; },
  };
}
const stripThink = s => String(s == null ? '' : s).replace(/<think>[\s\S]*?(<\/think>\s*|$)/g, '').trim();

// tool_calls arrive in pieces keyed by index: id and name once, arguments as string fragments
function toolAccumulator() {
  const by = new Map();
  return {
    add(list) {
      for (const tc of list || []) {
        const k = tc.index != null ? tc.index : by.size;
        const t = by.get(k) || { id: '', name: '', args: '' }; by.set(k, t);
        if (tc.id) t.id = tc.id;
        const f = tc.function || {};
        if (f.name) t.name = !t.name ? f.name : (t.name === f.name ? t.name : t.name + f.name);
        if (f.arguments != null) t.args += typeof f.arguments === 'string' ? f.arguments : JSON.stringify(f.arguments);
      }
    },
    list() {
      return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([i, t]) => {
        let args = {}; try { args = t.args.trim() ? JSON.parse(t.args) : {}; } catch (e) { args = { _raw: t.args }; }
        return { id: t.id || 'call_' + i, name: t.name, args };
      }).filter(t => t.name);
    },
  };
}

// JSON mode answers: the object itself, or the first {...} block in the text
function jsonText(s) {
  s = stripThink(s).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { JSON.parse(s); return s; } catch (e) { /* look inside */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { const t = s.slice(a, b + 1); try { JSON.parse(t); return t; } catch (e) { /* no */ } }
  return null;
}

// What we send: OpenAI chat messages with only the fields Groq accepts (no image, no reasoning).
function cleanMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: String(system) });
  for (const m of messages || []) {
    if (!m || !m.role) continue;
    const role = ['system', 'user', 'assistant', 'tool'].includes(m.role) ? m.role : 'user';
    const x = { role };
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      x.content = m.content == null ? null : String(m.content);
      x.tool_calls = m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function ? tc.function.name : tc.name, arguments: tc.function ? (typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {})) : JSON.stringify(tc.args || {}) } }));
    } else x.content = String(m.content == null ? (m.text == null ? '' : m.text) : m.content);
    if (role === 'tool') { x.tool_call_id = m.tool_call_id || m.id || ''; if (typeof x.content !== 'string') x.content = JSON.stringify(x.content); }
    if (m.name && role !== 'tool') x.name = String(m.name).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || undefined;
    if (x.name === undefined) delete x.name;
    out.push(x);
  }
  return out;
}

function createBrain(o) {
  o = o || {};
  const getSetting = typeof o.getSetting === 'function' ? o.getSetting : (k => process.env[k] || '');
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const now = o.now || (() => Date.now());
  const log = o.log || ((...a) => console.log('[brocore]', ...a));
  const db = o.db || null;
  const st = { working: null, lane: { live: null, bg: null }, dead: new Map(), cool: new Map(), listed: null, listing: null, noParams: new Map(), lastError: '', lastModel: '', calls: 0, fails: 0, emergency: 0, lastEmergency: null, cloud: {}, provDown: new Map() };
  const ttft = [], chatMs = [];
  const mem = {}; // usage when there is no db

  const key = () => getSetting('GROQ_API_KEY') || process.env.GROQ_API_KEY || '';
  const geminiKey = () => getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '';
  const openaiKey = () => getSetting('OPENAI_API_KEY') || process.env.OPENAI_API_KEY || '';
  const PROV = { groq: { base: GROQ, key }, gemini: { base: GEMINI, key: geminiKey }, openai: { base: OPENAI, key: openaiKey } };
  // a cloud can answer: it has a key, the owner didn't switch it off (BROCORE_CLOUDS: e.g. "groq,gemini"), and its key
  // wasn't just refused
  const cloudsOn = () => String(getSetting('BROCORE_CLOUDS') || process.env.BROCORE_CLOUDS || 'groq,gemini,openai').toLowerCase();
  const usable = p => !!PROV[p].key() && (p === 'groq' || cloudsOn().includes(p)) && !((st.provDown.get(p) || 0) > now());
  const ready = () => !!key() || usable('gemini') || usable('openai');
  const emergencyOn = () => String(getSetting('BROCORE_EMERGENCY') || process.env.BROCORE_EMERGENCY || 'on').trim().toLowerCase() !== 'off';
  const current = () => getSetting('BROCORE_MODEL') || process.env.BROCORE_MODEL || st.working || DEFAULT_CHAIN[0];
  const isDead = m => (st.dead.get(m) || 0) > now();
  const isCool = m => (st.cool.get(m) || 0) > now();
  // optional step trail for diagnostics (req.trace / opts.trace): model, HTTP status and our own error kind, never provider text
  const note = (r, x) => { if (r && Array.isArray(r.trace) && r.trace.length < 32) r.trace.push(x); };

  // ── /models: cached for six hours; null when the list cannot be read ──
  async function listModels(force) {
    if (!key()) return null;
    if (!force && st.listed && now() - st.listed.at < LIST_MS) return st.listed.ids;
    if (st.listing) return st.listing;
    st.listing = (async () => {
      try {
        const r = await fetchFn(GROQ + '/models', { headers: { Authorization: 'Bearer ' + key() }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('models ' + r.status);
        const j = await r.json();
        const ids = new Set(((j && j.data) || []).filter(m => m && m.id && m.active !== false).map(m => m.id));
        st.listed = { at: now(), ids, all: ((j && j.data) || []).map(m => m.id) };
        return ids;
      } catch (e) { if (st.listed) return st.listed.ids; return null; }
      finally { st.listing = null; }
    })();
    return st.listing;
  }

  // ── the other clouds' model: Google's newest stable Flash, the first of OPENAI_PREF OpenAI lists; read every 6 hours ──
  async function cloudModel(p) {
    if (!usable(p)) return null;
    const c = st.cloud[p];
    if (c && now() - c.at < LIST_MS) return c.model;
    if (c && c.pending) return c.pending;
    const pending = (async () => {
      let ids = null;
      try {
        const r = await fetchFn(PROV[p].base + '/models', { headers: { Authorization: 'Bearer ' + PROV[p].key() }, signal: AbortSignal.timeout(8000) });
        if (r.ok) { const j = await r.json(); ids = ((j && j.data) || []).map(m => String(m && m.id || '').replace(/^models\//, '')).filter(Boolean); }
      } catch (e) { ids = null; }
      let id = null;
      if (p === 'gemini') {
        const flash = (ids || []).map(x => { const m = /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(x); return m ? { x, v: parseFloat(m[1]) } : null; }).filter(Boolean).sort((a, b) => b.v - a.v);
        id = flash.length ? flash[0].x : GEMINI_FALLBACK;
      } else id = (ids || []).length ? OPENAI_PREF.find(x => ids.includes(x)) || null : null;
      const model = id ? (p === 'gemini' ? 'gemini/' : 'oai/') + id : null;
      st.cloud[p] = { at: now(), model };
      if (model && (!c || c.model !== model)) log('cloud brain', p, '→', model);
      return model;
    })();
    st.cloud[p] = Object.assign({}, c || {}, { pending });
    try { return await pending; } finally { if (st.cloud[p] && st.cloud[p].pending === pending) delete st.cloud[p].pending; }
  }
  // read the other clouds' models soon after boot, so the first live turn that needs one doesn't wait for the list
  setTimeout(() => { for (const p of ['gemini', 'openai']) if (usable(p)) cloudModel(p).catch(() => {}); }, 1500).unref?.();

  // the chain, lazily: the preferred models first; the extra models only once those failed (and only if /models lists them)
  async function* chainFor(req) {
    if (req && Array.isArray(req.models) && req.models.length) { for (const m of req.models) yield m; return; }
    const seen = new Set();
    const lane = laneOf(req);
    // the remembered model leads for 30 minutes; then the preferred order gets another try (one hiccup is not a demotion)
    const w = st.lane[lane] || {};
    const pin = w.model && now() - w.at < PIN_MS ? w.model : null;
    // v20: the other clouds ('@gemini', '@openai') sit right after gpt-oss-120b on live turns, and end the rescue
    const head = (lane === 'live' ? [getSetting('BROCORE_MODEL'), process.env.BROCORE_MODEL, pin, DEFAULT_CHAIN[0], '@gemini', '@openai', ...DEFAULT_CHAIN.slice(1)] : lane === 'rescue' ? [...RESCUE_CHAIN, '@gemini'] : [pin, ...BG_CHAIN]).filter(Boolean);
    let tried = 0, ids;
    const resolved = [];
    // the two gpt-oss models are always tried; any other Groq model only once /models says this account has it
    for (let m of head) {
      if (m[0] === '@') { m = await cloudModel(m.slice(1)); if (!m) continue; }
      if (seen.has(m)) continue; seen.add(m); resolved.push(m);
      if (!usable(providerOf(m))) continue;
      if (lane !== 'live' && providerOf(m) === 'groq') { if (ids === undefined) ids = await listModels(); if (ids && !ids.has(m)) continue; } // background and rescue models only if this account has them
      if (isDead(m) || isCool(m)) continue; tried++; yield m;
    }
    if (lane === 'rescue') return; // the rescue is one lean pass: models that are down stay down
    if (ids === undefined) ids = await listModels();
    for (const m of (lane === 'live' ? EXTRA : BG_EXTRA)) { if (seen.has(m)) continue; seen.add(m); if (!usable('groq')) continue; if (ids && !ids.has(m)) continue; if (isDead(m) || isCool(m)) continue; tried++; yield m; }
    // everything was marked down: give the head one more go rather than going silent
    if (!tried) for (const m of resolved) if (!isDead(m) && usable(providerOf(m))) yield m;
  }

  // how hard to think: req.effort, else a hard question (route.js) thinks harder (a call: medium; typed chat: high), else
  // live talk and quick helpers think briefly
  const effortOf = req => req.effort || (req.hard ? (req.live ? 'medium' : 'high') : (req.live || ['bro', 'learn', 'util', 'notes'].includes(req.purpose) ? 'low' : 'medium'));
  function bodyFor(model, req, stream) {
    const drop = st.noParams.get(model) || new Set();
    const msgs = cleanMessages(req.system, req.messages);
    const p = providerOf(model);
    const b = { model: wireModel(model), messages: msgs, stream: !!stream };
    let max = req.maxTokens || 1024;
    if (isReasoning(model) && !drop.has('reasoning')) {
      const effort = effortOf(req);
      if (/qwen3/i.test(model)) b.reasoning_effort = 'none';
      else if (p === 'gemini') { b.reasoning_effort = effort === 'low' ? 'none' : effort; if (effort !== 'low') max += effort === 'high' ? 4096 : 1024; } // Flash answers easy turns without thinking
      else if (p === 'openai') { b.reasoning_effort = effort === 'low' ? 'minimal' : effort; max += effort === 'high' ? 4096 : effort === 'medium' ? 1024 : 384; }
      else { b.reasoning_effort = effort; b.include_reasoning = false; max += effort === 'low' ? 384 : effort === 'high' ? 4096 : 1024; } // reasoning tokens count against the limit
    }
    if (p === 'groq' && !drop.has('maxc')) b.max_completion_tokens = max; else b.max_tokens = max;
    if (!drop.has('temperature')) b.temperature = req.temperature != null ? req.temperature : (req.json ? 0.3 : 0.7);
    if (req.tools && req.tools.length && !drop.has('tools')) { b.tools = req.tools; b.tool_choice = req.toolChoice || 'auto'; }
    if (req.json && !drop.has('json')) {
      b.response_format = { type: 'json_object' };
      if (!msgs.some(m => /json/i.test(m.content || ''))) msgs.unshift({ role: 'system', content: 'Reply with a JSON object only.' });
    }
    return b;
  }

  // classify a failed HTTP answer: 'key' stops the chain, 'dead' retires the model, 'param' retries without a parameter
  function classify(status, j, model) {
    const err = (j && j.error) || {};
    const msg = String(err.message || (typeof j === 'string' ? j : '') || ('HTTP ' + status));
    const code = String(err.code || '');
    const p = providerOf(model);
    const e = new Error(p + ' ' + status + ' ' + model + ': ' + msg.slice(0, 200)); e.status = status; e.code = code; e.provider = p;
    if (status === 401 || status === 403 || /API[_ ]key[_ ]not[_ ]valid|API_KEY_INVALID|invalid api key|incorrect api key/i.test(msg + ' ' + code)) e.kind = 'key';
    else if (status === 404 || /model_not_found|model_decommissioned|decommissioned/i.test(code) || (status === 400 && /model.{0,60}(not found|does not exist|decommissioned|not supported|no longer|unknown|invalid model)|decommissioned/i.test(msg))) e.kind = 'dead';
    // a 429 says which allowance ran out: a day's (tokens or requests per day) cools the model far longer than a minute's
    else if (status === 429) { e.kind = 'rate'; e.window = /per day|PerDay|\bTPD\b|\bRPD\b/i.test(msg) ? 'day' : 'min'; }
    // only optional extras are ever dropped (reasoning settings, JSON mode); a tool error moves to the next model instead,
    // so a live turn never silently loses its tools
    else if (status === 400 && /(reasoning_effort|include_reasoning|reasoning_format|response_format|json_object).{0,80}(not supported|unsupported|invalid|unknown|unrecognized|not allowed|must be)|(not supported|unsupported|unknown parameter|unrecognized).{0,60}(reasoning|response_format|json)/i.test(msg)) {
      e.kind = 'param'; e.param = /reasoning/i.test(msg) ? 'reasoning' : 'json';
    } else if (status === 400 && /json_validate_failed|failed to generate json/i.test(code + ' ' + msg)) { e.kind = 'param'; e.param = 'json'; }
    // v20: the other clouds name the parameter they don't take in their own words ("Unknown name \"include_reasoning\"",
    // "Unsupported value: 'temperature'", "Unsupported parameter: 'max_tokens'")
    else if (status === 400 && p !== 'groq' && /reasoning/i.test(msg) && !/tool|function/i.test(msg)) { e.kind = 'param'; e.param = 'reasoning'; }
    else if (status === 400 && /temperature/i.test(msg) && /unsupported|not support|does not support|only the default/i.test(msg)) { e.kind = 'param'; e.param = 'temperature'; }
    else if (status === 400 && /max_tokens|max_completion_tokens/i.test(msg) && /unsupported|not support|use .max_completion_tokens|unknown/i.test(msg)) { e.kind = 'param'; e.param = 'maxc'; }
    // v17: the model wrote a bad tool call (gpt-oss reaching for a built-in "browser" tool, broken arguments) or Groq
    // refused a tool schema: worth one more try, then the same turn without tools (see chatStream), never silence
    else if (status === 400 && /tool_use_failed|failed to call a function|tool call validation/i.test(code + ' ' + msg)) e.kind = 'toolcall';
    else if (status >= 400 && status < 500 && status !== 408 && status !== 413 && /\btools?\b|function|schema|parameters/i.test(msg)) e.kind = 'tools';
    else e.kind = 'next';
    return e;
  }
  function onFail(model, e, retryAfter) {
    st.lastError = e.message; st.fails++;
    if (e.kind === 'key' && providerOf(model) !== 'groq') { st.provDown.set(providerOf(model), now() + 10 * 60e3); log('cloud', providerOf(model), 'refused its key: skipped for 10 minutes'); return; }
    if (e.kind === 'dead') { st.dead.set(model, now() + DEAD_MS); if (st.working === model) st.working = null; for (const k of Object.keys(st.lane)) if (st.lane[k] && st.lane[k].model === model) st.lane[k] = null; log('model retired, skipping', model, '·', (e.message || '').slice(0, 120)); }
    // a minute's allowance: up to 60 s; a day's: until Groq's retry-after, at most 30 min (15 min when it gives none),
    // so a live turn skips an exhausted model at once instead of failing on it again
    else if (e.kind === 'rate') st.cool.set(model, now() + (e.window === 'day' ? Math.min(30 * 60e3, Math.max(60e3, (parseFloat(retryAfter) || 900) * 1000)) : Math.min(60e3, Math.max(3e3, (parseFloat(retryAfter) || 8) * 1000))));
  }
  // the trail word for a failed answer: 429s say which allowance ran out
  const kindWord = e => e.kind === 'rate' && e.window ? 'rate-' + e.window : e.kind;
  function works(model, req) {
    st.lastModel = model; st.lastError = '';
    // v20: only a Groq model is remembered to lead the next turns; a paid cloud that stepped in (Flash) answers while
    // Groq's models cool down, and the next turn tries Groq first again
    if (!(req && req.models) && providerOf(model) === 'groq') {
      const lane = laneOf(req), w = st.lane[lane];
      if (!w || w.model !== model) { st.lane[lane] = { model, at: now() }; log('brain (' + lane + ') answering on', model); } else w.at = now();
      if (lane === 'live' && st.working !== model) { st.working = model; st.workingAt = now(); }
    }
  }

  async function post(path, body, signal, ms, model) {
    const P = PROV[providerOf(model || '')];
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(); if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetchFn(P.base + path, { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + P.key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { r, ctrl, done: () => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }, timer: t };
    } catch (e) { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); throw e; }
  }

  // ── usage meter (bro_usage table when there is a db) ──
  function track(model, usage, purpose, est) {
    try {
      const p = priceOf(model);
      const tin = (usage && (usage.prompt_tokens || usage.input_tokens)) || (est ? est.tin : 0) || 0;
      const tout = (usage && (usage.completion_tokens || usage.output_tokens)) || (est ? est.tout : 0) || 0;
      const usd = (tin * p[0] + tout * p[1]) / 1e6;
      record(model, purpose || 'util', tin, tout, usd);
    } catch (e) { /* the meter never breaks a call */ }
  }
  function trackAudio(model, seconds) {
    const billed = Math.max(10, seconds || 0); // Groq bills at least 10 s per request
    record(model, 'hear', Math.round(billed), 0, billed / 3600 * (AUDIO_PER_HOUR[model] || 0.111));
  }
  let qUp = null;
  function record(model, purpose, tin, tout, usd) {
    const m = month(new Date(now()));
    if (db) {
      try {
        qUp = qUp || db.prepare('INSERT INTO bro_usage(month,model,purpose,calls,tin,tout,usd) VALUES(?,?,?,1,?,?,?) ON CONFLICT(month,model,purpose) DO UPDATE SET calls=calls+1,tin=tin+excluded.tin,tout=tout+excluded.tout,usd=usd+excluded.usd');
        qUp.run(m, model, purpose, tin, tout, usd); return;
      } catch (e) { /* fall through to memory */ }
    }
    const k = m + '|' + model + '|' + purpose; const r = mem[k] = mem[k] || { month: m, model, purpose, calls: 0, tin: 0, tout: 0, usd: 0 };
    r.calls++; r.tin += tin; r.tout += tout; r.usd += usd;
  }
  function costMonth() {
    const m = month(new Date(now()));
    let rows = [];
    if (db) { try { rows = db.prepare('SELECT model,purpose,calls,tin,tout,usd FROM bro_usage WHERE month=?').all(m); } catch (e) { rows = []; } }
    if (!rows.length) rows = Object.values(mem).filter(r => r.month === m);
    const out = { month: m, usd: 0, calls: 0, tokensIn: 0, tokensOut: 0, byModel: {}, byPurpose: {} };
    for (const r of rows) {
      out.usd += r.usd; out.calls += r.calls; if (r.purpose !== 'hear') { out.tokensIn += r.tin; out.tokensOut += r.tout; }
      const bm = out.byModel[r.model] = out.byModel[r.model] || { calls: 0, usd: 0 }; bm.calls += r.calls; bm.usd += r.usd;
      out.byPurpose[r.purpose] = +((out.byPurpose[r.purpose] || 0) + r.usd).toFixed(6);
    }
    out.usd = +out.usd.toFixed(6); for (const k of Object.keys(out.byModel)) out.byModel[k].usd = +out.byModel[k].usd.toFixed(6);
    return out;
  }
  const estTokens = msgs => Math.ceil(msgs.reduce((n, m) => n + String(m.content || '').length, 0) / 4);

  // ── emergency fallback (the old helper) ──
  async function emergency(req, why) {
    const e = why || new Error('brain unavailable');
    if (req.emergency === false || !emergencyOn() || typeof o.callGemini !== 'function') { e.code = e.code || 'brain_down'; throw e; }
    st.emergency++; st.lastEmergency = { at: new Date(now()).toISOString(), why: String(e.message || e).slice(0, 160) };
    const sys = [req.system, ...(req.messages || []).filter(m => m && m.role === 'system').map(m => m.content)].filter(Boolean).join('\n\n') + (req.json ? '\n\nReturn only one valid JSON object. No code fences, no other text.' : '');
    const msgs = (req.messages || []).filter(m => m && m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content == null ? (m.tool_calls ? '(used a tool)' : '') : m.content) }));
    const g = await o.callGemini(msgs, { maxTokens: req.maxTokens || 1024, systemPrompt: sys });
    let text = String((g && (g.reply || g.text)) || '').trim();
    if (req.json) { const j = jsonText(text); if (!j) throw new Error('emergency reply was not JSON'); text = j; }
    if (!text) throw new Error('emergency reply empty');
    log('emergency fallback answered (' + ((g && g.provider) || 'gemini') + ') ·', st.lastEmergency.why);
    return { text, model: 'emergency/' + ((g && g.provider) || 'gemini'), emergency: true, message: { role: 'assistant', content: text }, toolCalls: [], usage: null };
  }

  // ── chat: one answer ──
  async function chat(req) {
    req = Object.assign({ purpose: 'util' }, req || {});
    const t0 = now(); st.calls++;
    if (!ready()) return emergency(req, Object.assign(new Error('no-key'), { code: 'no-key' }));
    let last = null, toolErr = null;
    for (let pass = 0; pass < 2; pass++) {
    if (pass) { const r2 = withoutTools(req, toolErr); if (!r2) break; req = r2; }
    for await (const model of chainFor(req)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let h;
        try { h = await post('/chat/completions', bodyFor(model, req, false), req.signal, req.timeout || (req.live ? 20000 : 50000), model); }
        catch (e) { if (req.signal && req.signal.aborted) throw abortError(); last = e; st.lastError = e.message; break; }
        let j = null; try { j = await h.r.json(); } catch (e) { j = null; } finally { h.done(); }
        if (!h.r.ok) {
          const e = classify(h.r.status, j, model);
          if (e.kind === 'param') { const s = st.noParams.get(model) || new Set(); if (!s.has(e.param)) { s.add(e.param); st.noParams.set(model, s); continue; } }
          if (isToolErr(e)) { logToolErr(model, e); last = toolErr = e; st.lastError = e.message; st.fails++; break; }
          onFail(model, e, h.r.headers && h.r.headers.get && h.r.headers.get('retry-after')); last = e;
          if (e.kind === 'key' && providerOf(model) === 'groq') { if (!usable('gemini') && !usable('openai')) return emergency(req, e); st.provDown.set('groq', now() + 10 * 60e3); }
          break;
        }
        const ch = j && j.choices && j.choices[0]; const msg = (ch && ch.message) || {};
        let text = stripThink(msg.content || '');
        const toolCalls = (msg.tool_calls || []).map(tc => { let args = {}; try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch (e) { args = { _raw: tc.function.arguments }; } return { id: tc.id, name: tc.function && tc.function.name, args }; });
        if (req.json && !toolCalls.length) { const jt = jsonText(text); if (!jt) { last = new Error('not JSON from ' + model); st.lastError = last.message; break; } text = jt; }
        if (!text && !toolCalls.length) { last = new Error('empty reply from ' + model + (ch && ch.finish_reason ? ' (' + ch.finish_reason + ')' : '')); st.lastError = last.message; break; }
        works(model, req);
        track(model, j.usage, req.purpose, { tin: estTokens(bodyFor(model, req, false).messages), tout: Math.ceil(text.length / 4) });
        ring(chatMs, now() - t0);
        const message = { role: 'assistant', content: msg.content == null ? null : stripThink(msg.content) };
        if (msg.tool_calls && msg.tool_calls.length) message.tool_calls = msg.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {}) } }));
        return { text, model, message, toolCalls, usage: j.usage || null, finish: ch && ch.finish_reason, toolsDropped: req.toolsDropped || undefined };
      }
    }
    }
    return emergency(req, last);
  }

  // ── chatStream: live turns ──
  // A tool error (see classify) moves to the next model with the tools kept. Only when every model failed that way
  // does the same request run once more WITHOUT tools, before the emergency path, so a tool problem never silences
  // Bro. The self-test passes toolFallback:false to see the error itself.
  const isToolErr = e => !!e && (e.kind === 'toolcall' || e.kind === 'tools');
  const logToolErr = (model, e) => log('groq refused the tools (' + model + ', ' + e.kind + '): ' + String(e.message || '').slice(0, 300));
  const withoutTools = (req, last) => (isToolErr(last) && req.toolFallback !== false && req.tools && req.tools.length && !req.toolsDropped) ? (log('every model refused the tools: retrying the same turn without tools'), Object.assign({}, req, { tools: undefined, toolsDropped: true })) : null;
  async function* chatStream(req) {
    req = Object.assign({ purpose: 'bro', live: true }, req || {});
    const t0 = now(); st.calls++;
    const signal = req.signal;
    if (!ready()) { yield* emergencyStream(req, Object.assign(new Error('no-key'), { code: 'no-key' })); return; }
    let last = null, toolErr = null;
    for (let pass = 0; pass < 2; pass++) {
    if (pass) { const r2 = withoutTools(req, toolErr); if (!r2) break; req = r2; }
    for await (const model of chainFor(req)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal && signal.aborted) return;
        let h;
        try { h = await post('/chat/completions', bodyFor(model, req, true), signal, req.firstByteMs || 15000, model); }
        catch (e) { if (signal && signal.aborted) return; last = e; st.lastError = e.message; note(req, { m: model, k: e.name === 'AbortError' ? 'slow' : 'net' }); break; }
        clearTimeout(h.timer);
        if (!h.r.ok) {
          let j = null; try { j = await h.r.json(); } catch (e) { j = null; } h.done();
          const e = classify(h.r.status, j, model); note(req, { m: model, s: h.r.status, k: kindWord(e) });
          if (e.kind === 'param') { const s = st.noParams.get(model) || new Set(); if (!s.has(e.param)) { s.add(e.param); st.noParams.set(model, s); continue; } }
          if (isToolErr(e)) { logToolErr(model, e); last = toolErr = e; st.lastError = e.message; st.fails++; break; }
          onFail(model, e, h.r.headers && h.r.headers.get && h.r.headers.get('retry-after')); last = e;
          if (e.kind === 'key' && providerOf(model) === 'groq') { if (!usable('gemini') && !usable('openai')) { yield* emergencyStream(req, e); return; } st.provDown.set('groq', now() + 10 * 60e3); }
          break;
        }
        // idle watchdog: a stream that stops sending for 20 s is cut
        let idle = setTimeout(() => h.ctrl.abort(), req.idleMs || 20000);
        const bump = () => { clearTimeout(idle); idle = setTimeout(() => h.ctrl.abort(), req.idleMs || 20000); };
        const think = thinkFilter(), tools = toolAccumulator();
        let any = false, text = '', usage = null, finish = null, failed = null;
        try {
          for await (const data of sseEvents(h.r.body, h.ctrl.signal)) {
            bump();
            if (data === '[DONE]') break;
            let j; try { j = JSON.parse(data); } catch (e) { continue; }
            if (j.error) { const em = String(j.error.message || 'unknown'), ec = String(j.error.code || ''); throw Object.assign(new Error('stream error: ' + em), { kind: /tool_use_failed|failed to call a function|tool call validation/i.test(ec + ' ' + em) ? 'toolcall' : /\btools?\b|schema/i.test(em) ? 'tools' : 'next', status: 400, code: ec }); }
            if (j.usage) usage = j.usage; else if (j.x_groq && j.x_groq.usage) usage = j.x_groq.usage;
            const ch = j.choices && j.choices[0]; if (!ch) continue;
            const d = ch.delta || {};
            if (typeof d.content === 'string' && d.content) {
              const clean = think.push(d.content);
              if (clean) { if (!any) ring(ttft, now() - t0); any = true; text += clean; yield { type: 'text', delta: clean }; }
            }
            if (Array.isArray(d.tool_calls) && d.tool_calls.length) { if (!any) ring(ttft, now() - t0); any = true; tools.add(d.tool_calls); }
            if (ch.finish_reason) finish = ch.finish_reason;
          }
        } catch (e) { failed = e; }
        finally { clearTimeout(idle); h.done(); }
        if (signal && signal.aborted) return; // barge-in: stop quietly
        if (failed) {
          last = failed; st.lastError = failed.message; note(req, { m: model, k: 'stream-' + (failed.kind || (failed.name === 'AbortError' ? 'idle' : 'x')) });
          if (any && text) { yield { type: 'done', model, usage, finish: 'error', error: failed.message }; return; } // words already out: never switch voices mid-sentence
          if (isToolErr(failed)) { logToolErr(model, failed); toolErr = failed; }
          break;
        }
        const tail = think.flush(); if (tail) { if (!any) ring(ttft, now() - t0); any = true; text += tail; yield { type: 'text', delta: tail }; }
        const calls = tools.list();
        for (const tc of calls) yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.args };
        if (!any) { last = new Error('empty stream from ' + model); st.lastError = last.message; note(req, { m: model, k: 'empty' }); break; }
        works(model, req); note(req, { m: model, ok: 1, calls: calls.map(c => c.name) });
        track(model, usage, req.purpose, { tin: estTokens(cleanMessages(req.system, req.messages)), tout: Math.ceil(text.length / 4) });
        yield { type: 'done', model, usage: usage || null, finish, toolsDropped: req.toolsDropped || undefined };
        return;
      }
    }
    }
    yield* emergencyStream(req, last);
  }
  async function* emergencyStream(req, why) {
    const r = await emergency(Object.assign({}, req, { json: false }), why); // throws when the switch is off
    if (req.signal && req.signal.aborted) return;
    yield { type: 'text', delta: r.text };
    yield { type: 'done', model: r.model, usage: null, emergency: true };
  }

  // ── web search: an open model with built-in web search answers a question with current facts and sources.
  //    First Groq's compound system (only the ids /models lists for this account), then gpt-oss with Groq's built-in
  //    browser_search tool (20b first, so a search doesn't spend the 120b allowance live talk runs on).
  //    Non-stream. → { text (≤ 1,200 chars), model, via: 'compound' | 'browser' }; throws when it cannot answer.
  const SEARCH_MODELS = ['groq/compound-mini', 'groq/compound', 'compound-beta-mini', 'compound-beta'];
  const BROWSE_MODELS = ['openai/gpt-oss-20b']; // never 120b: search results are big, and 120b's allowance is live talk's
  async function webSearch(query, opts) {
    opts = opts || {};
    const q = String(query == null ? '' : query).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!q) return { text: '', model: null };
    if (!key()) throw Object.assign(new Error('no-key'), { code: 'no-key' }); // web search runs on Groq's own tools
    const ask = q + ' — answer briefly with the key facts and dates, and mention the source names';
    const tries = SEARCH_MODELS.map(model => ({ model, via: 'compound', ms: opts.timeout || 12000, body: { model, stream: false, messages: [{ role: 'user', content: ask }] } }))
      .concat(BROWSE_MODELS.map(model => ({ model, via: 'browser', ms: opts.browseTimeout || 15000, body: { model, stream: false, messages: [{ role: 'user', content: 'Search the web, then answer: ' + ask }], tools: [{ type: 'browser_search' }], tool_choice: 'required', reasoning_effort: 'low', max_completion_tokens: 1024 } })));
    const ids = await listModels();
    let last = null, unlisted = 0;
    for (const { model, via, ms, body } of tries) {
      if (ids && !ids.has(model)) { if (via === 'compound' && !unlisted++) note(opts, { m: 'compound', k: 'unlisted' }); continue; }
      if (isDead(model) || isCool(model)) { note(opts, { m: model, k: isDead(model) ? 'retired' : 'cooling' }); continue; }
      const left = opts.deadline ? opts.deadline - now() : Infinity; // the caller's time budget (a live call waits ~14 s)
      if (left < 1500) { note(opts, { m: model, k: 'no-time' }); break; }
      let h;
      try { h = await post('/chat/completions', body, opts.signal, Math.min(ms, left), model); }
      catch (e) { if (opts.signal && opts.signal.aborted) throw abortError(); last = e.name === 'AbortError' ? Object.assign(new Error('web search timed out'), { code: 'timeout' }) : e; note(opts, { m: model, k: e.name === 'AbortError' ? 'slow' : 'net' }); continue; }
      let j = null; try { j = await h.r.json(); } catch (e) { j = null; } finally { h.done(); }
      if (!h.r.ok) {
        const e = classify(h.r.status, j, model); note(opts, { m: model, s: h.r.status, k: via === 'browser' ? 'browse-' + kindWord(e) : kindWord(e) }); last = e;
        // a browse refusal says nothing about gpt-oss for talk: only a rate limit (shared with talk) marks it
        if (via === 'compound' || e.kind === 'rate') onFail(model, e, h.r.headers && h.r.headers.get && h.r.headers.get('retry-after'));
        if (e.kind === 'key') break; continue;
      }
      const msg = (j && j.choices && j.choices[0] && j.choices[0].message) || {};
      const text = stripThink(msg.content || '').replace(/\s+/g, ' ').trim();
      if (!text) { last = new Error('empty search answer from ' + model); note(opts, { m: model, k: 'empty' }); continue; }
      note(opts, { m: model, ok: 1 });
      track(model, j.usage, 'search', { tin: Math.ceil(q.length / 4) + 50, tout: Math.ceil(text.length / 4) });
      return { text: text.length > 1200 ? text.slice(0, 1200).replace(/\s+\S*$/, '') + ' …' : text, model, via };
    }
    throw last || new Error('web search failed');
  }

  // one-turn check used by the nightly model upgrade
  async function healthCheck(model) {
    try { const r = await chat({ models: [model], messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 20, purpose: 'util', emergency: false, timeout: 20000 }); return { ok: !!(r && r.text), text: r.text }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  function health() {
    return {
      ready: ready(), model: current(), working: st.working, lastModel: st.lastModel, lastError: st.lastError,
      emergency: emergencyOn() ? 'on' : 'off', emergencyUsed: st.emergency, lastEmergency: st.lastEmergency,
      calls: st.calls, fails: st.fails, retired: [...st.dead.entries()].filter(e => e[1] > now()).map(e => e[0]),
      listed: st.listed ? st.listed.all : null,
      clouds: { groq: usable('groq'), gemini: usable('gemini') ? (st.cloud.gemini && st.cloud.gemini.model) || 'pending' : false, openai: usable('openai') ? (st.cloud.openai && st.cloud.openai.model) || 'pending' : false },
    };
  }
  const latency = () => ({ p50: pct(ttft, 50), p90: pct(ttft, 90), n: ttft.length, chatP50: pct(chatMs, 50), chatP90: pct(chatMs, 90), chatN: chatMs.length });

  return { chat, chatStream, webSearch, ready, emergencyOn, current, listModels, cloudModel, healthCheck, health, latency, costMonth, track, trackAudio, _st: st };
}

module.exports = { createBrain, sseEvents, thinkFilter, toolAccumulator, jsonText, cleanMessages, DEFAULT_CHAIN, EXTRA, BG_CHAIN, BG_PURPOSES, RESCUE_CHAIN, laneOf, PRICES, GROQ, GEMINI, OPENAI, providerOf, wireModel };
