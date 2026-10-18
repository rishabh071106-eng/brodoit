// Shared Gemini text calls. Google retires model ids (gemini-2.0-flash now returns 404 "no longer available"), so every
// caller goes through a model chain: the Admin setting GEMINI_MODEL (or GEMINI_LITE_MODEL for cheap batch work) first, then
// the stable ids, then Google's rolling "-latest" aliases. The first id that answers is remembered for the process.
// A 402 RESOURCE_EXHAUSTED means the Google project's prepaid credit is used up — surfaced as err.code 'credits' so the
// Admin card can say exactly that instead of a generic failure.
'use strict';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const CHAINS = {
  flash: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash'],
  lite: ['gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash'],
};
const working = { flash: null, lite: null };

function chain(tier, getSetting) {
  const own = typeof getSetting === 'function' ? (getSetting(tier === 'lite' ? 'GEMINI_LITE_MODEL' : 'GEMINI_MODEL') || '') : '';
  const env = process.env[tier === 'lite' ? 'GEMINI_LITE_MODEL' : 'GEMINI_MODEL'] || '';
  return [...new Set([own, env, working[tier], ...CHAINS[tier] || CHAINS.flash].filter(Boolean))];
}
const retired = (status, msg) => status === 404 || (status === 400 && /not (found|supported)|no longer available|is not available/i.test(msg));

function errorFrom(status, j) {
  const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + status);
  const e = new Error(msg); e.status = status;
  if (status === 402 || /prepayment credits|prepaid credit/i.test(msg)) { e.code = 'credits'; e.message = 'Gemini credit is used up — top up the Google AI Studio project (ai.studio/projects)'; }
  else if (status === 429) e.code = 'rate';
  else if ((status === 400 && /api key not valid|API_KEY_INVALID/i.test(msg)) || status === 401 || status === 403) e.code = 'key';
  return e;
}

// 2.5+ models think before answering and the thinking counts against maxOutputTokens (gemini-2.0-flash did not), so a short
// reply could come back empty. Text calls on 2.5 Flash turn thinking off; other models get headroom on the token limit.
function forModel(model, body) {
  const gc = body && body.generationConfig; if (!gc || gc.responseModalities || gc.thinkingConfig) return body;
  if (/^gemini-2\.5-flash/.test(model)) return Object.assign({}, body, { generationConfig: Object.assign({}, gc, { thinkingConfig: { thinkingBudget: 0 } }) });
  if (gc.maxOutputTokens) return Object.assign({}, body, { generationConfig: Object.assign({}, gc, { maxOutputTokens: gc.maxOutputTokens + 2048 }) });
  return body;
}

// body: a generateContent request body. Returns { json, model }.
async function generate(key, body, opts) {
  opts = opts || {};
  if (!key) { const e = new Error('no-key'); e.code = 'key'; throw e; }
  const tier = opts.tier === 'lite' ? 'lite' : 'flash';
  const fetchFn = opts.fetch || fetch;
  let last = null;
  for (const model of (opts.models || chain(tier, opts.getSetting))) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeout || 50000);
    try {
      const r = await fetchFn(BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forModel(model, body)) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { if (!opts.models) working[tier] = model; return { json: j, model }; }
      const msg = (j.error && j.error.message) || '';
      if (retired(r.status, msg)) { last = errorFrom(r.status, j); continue; }
      throw errorFrom(r.status, j);
    } finally { clearTimeout(t); }
  }
  throw last || new Error('no Gemini model available');
}
const textOf = j => (((j && j.candidates) || [])[0]?.content?.parts || []).map(p => p.text || '').join('');

// A real one-token call: listing models succeeds even when the project has no credit, so it can't tell "works".
async function check(key, fetchFn, getSetting) {
  try { await generate(key, { contents: [{ role: 'user', parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 4 } }, { fetch: fetchFn, timeout: 12000, getSetting }); return { ok: true }; }
  catch (e) { return { ok: false, code: e.code || (e.name === 'AbortError' ? 'timeout' : 'error'), status: e.status || 0, error: e.message }; }
}

module.exports = { generate, textOf, check, chain, CHAINS };
