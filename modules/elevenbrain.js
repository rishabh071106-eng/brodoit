// ElevenLabs as a text brain. An ElevenLabs agent includes an LLM billed to the ElevenLabs plan, so when no
// OpenAI/Groq/Gemini key works (Gemini out of prepaid credit), Bro's chat, the course coach and the news desk
// still answer: a private text-only agent ("Brodoit Brain") gets the caller's system prompt as an override and
// one user message per conversation over the Conversational AI WebSocket; the first agent reply is the answer.
const crypto = require('crypto');
let WS = null; try { WS = require('ws'); } catch (e) { /* ws missing: brain unavailable */ }

const LLMS = ['gemini-2.5-flash', 'gpt-4o-mini', 'gemini-2.0-flash'];

function install(deps) {
  const { getSetting, setSetting } = deps;
  const key = () => getSetting('ELEVENLABS_API_KEY');
  const state = { id: null, hash: null, error: '', at: 0, creating: null, ok: 0, fail: 0, lastMs: 0 };
  const log = (...a) => console.log('[eleven-brain]', ...a);

  async function api(method, path, body) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch((process.env.ELEVEN_API_BASE || 'https://api.elevenlabs.io') + path, { method, signal: ctrl.signal, headers: Object.assign({ 'xi-api-key': key() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text.slice(0, 200) }; }
      return { ok: r.ok, status: r.status, body: j };
    } finally { clearTimeout(t); }
  }
  const config = llm => ({
    name: 'Brodoit Brain (text)',
    conversation_config: {
      agent: { first_message: '', language: 'en', prompt: { prompt: 'You are a precise, helpful assistant. Follow the instructions you are given exactly.', llm, temperature: 0.5, max_tokens: 1200 } },
      conversation: { text_only: true, max_duration_seconds: 180 },
      turn: { turn_timeout: 30 },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true, language: true }, conversation: { text_only: true } } },
    },
  });
  async function ensure() {
    if (!key()) return null;
    if (state.creating) return state.creating;
    state.creating = (async () => {
      const llm = getSetting('ELEVEN_BRAIN_LLM') || LLMS[0];
      const want = crypto.createHash('sha1').update(JSON.stringify(config(llm)) + crypto.createHash('sha256').update(key()).digest('hex').slice(0, 8)).digest('hex').slice(0, 12);
      const saved = getSetting('ELEVEN_BRAIN_ID'), savedHash = getSetting('ELEVEN_BRAIN_HASH');
      if (saved && savedHash === want) { state.id = saved; return saved; }
      if (state.error && Date.now() - state.at < 10 * 60e3) return null;
      const r = saved ? await api('PATCH', '/v1/convai/agents/' + encodeURIComponent(saved), config(llm)) : await api('POST', '/v1/convai/agents/create', config(llm));
      const id = (r.body && (r.body.agent_id || r.body.id)) || (r.ok ? saved : null);
      if (r.ok && id) {
        state.id = id; state.error = '';
        try { setSetting('ELEVEN_BRAIN_ID', id); setSetting('ELEVEN_BRAIN_HASH', want); } catch (e) { /* ignore */ }
        log('text agent ready', id, 'llm', llm);
        return id;
      }
      const msg = r.status + ' ' + JSON.stringify(r.body).slice(0, 200);
      if (r.status === 404 && saved) { try { setSetting('ELEVEN_BRAIN_ID', ''); } catch (e) { /* ignore */ } }
      const next = LLMS[LLMS.indexOf(llm) + 1];
      if (next && /llm/i.test(msg)) { try { setSetting('ELEVEN_BRAIN_LLM', next); } catch (e) { /* ignore */ } state.creating = null; return ensure(); }
      state.error = msg; state.at = Date.now(); log('agent failed:', msg);
      return null;
    })().catch(e => { state.error = e.message; state.at = Date.now(); return null; }).finally(() => { state.creating = null; });
    return state.creating;
  }
  async function url(id) {
    const r = await api('GET', '/v1/convai/conversation/get-signed-url?agent_id=' + encodeURIComponent(id));
    if (r.ok && r.body && r.body.signed_url) return r.body.signed_url;
    if ([401, 403, 404].includes(r.status)) { state.id = null; try { setSetting('ELEVEN_BRAIN_HASH', ''); } catch (e) { /* ignore */ } }
    throw new Error('signed url ' + r.status);
  }

  // ask({ system, messages:[{role,content}], language }) → reply text. Throws on failure.
  async function ask({ system, messages, language = 'en', timeout = 30000 }) {
    if (!WS) throw new Error('ws module missing');
    const id = await ensure(); if (!id) throw new Error('no ElevenLabs agent: ' + (state.error || 'key missing'));
    const t0 = Date.now();
    const signed = await url(id);
    const hist = (messages || []).filter(m => m && m.content);
    const last = hist.pop();
    const text = (hist.length ? 'Conversation so far:\n' + hist.map(m => (m.role === 'assistant' ? 'You' : 'User') + ': ' + String(m.content).slice(0, 1500)).join('\n') + '\n\nNow reply to the user\'s new message.\n' : '') + String(last ? last.content : '').slice(0, 6000);
    return new Promise((resolve, reject) => {
      const ws = new WS(signed);
      let done = false, sent = false;
      const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (e) { /* ignore */ } if (err) { state.fail++; reject(err); } else { state.ok++; state.lastMs = Date.now() - t0; resolve(val); } };
      const timer = setTimeout(() => finish(new Error('timeout')), timeout);
      const send = o => { try { ws.send(JSON.stringify(o)); } catch (e) { finish(e); } };
      const ask1 = () => { if (sent) return; sent = true; send({ type: 'user_message', text }); };
      ws.on('open', () => {
        send({ type: 'conversation_initiation_client_data', conversation_config_override: { agent: { prompt: { prompt: String(system || '').slice(0, 12000) }, first_message: '', language: language === 'hi' ? 'hi' : 'en' }, conversation: { text_only: true } } });
        setTimeout(ask1, 1500); // in case the metadata event is late
      });
      ws.on('message', raw => {
        let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
        if (m.type === 'conversation_initiation_metadata') ask1();
        else if (m.type === 'ping') send({ type: 'pong', event_id: m.ping_event && m.ping_event.event_id });
        else if (m.type === 'agent_response') {
          const reply = m.agent_response_event && m.agent_response_event.agent_response;
          if (sent && reply && String(reply).trim()) finish(null, String(reply).trim());
        } else if (m.type === 'error') finish(new Error('agent error: ' + JSON.stringify(m).slice(0, 200)));
      });
      ws.on('error', e => finish(e));
      ws.on('close', (code, reason) => finish(new Error('closed ' + code + ' ' + String(reason || '').slice(0, 120))));
    });
  }
  const available = () => !!(WS && key());
  const status = () => ({ available: available(), agent: state.id, error: state.error, ok: state.ok, fail: state.fail, lastMs: state.lastMs });
  global._elevenBrain = { ask, available, status, ensure };
  return global._elevenBrain;
}

module.exports = { install };
