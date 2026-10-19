// Talking Bro — voice agent backend.
// Primary engine: OpenAI Realtime (speech-to-speech over WebRTC) when an OpenAI key is set.
// The key is read per request via deps.getSetting (pasted in You → Admin; env is the fallback),
// so pasting a key switches the engine on without a restart.
// The browser gets a short-lived client secret from /api/voice/session, opens the WebRTC
// call itself, and asks us to run tools via /api/voice/tool (tasks, reminders, news…).
// Fallback engine (no key): browser speech recognition → /api/voice/turn (Gemini/Groq) → browser TTS.
'use strict';
const EV = require('./elevenvoice.js');
const STUDIO = require('./studio.js');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini'; // ~3x cheaper than gpt-realtime, same voices

const PERSONAS = {
  bro: `You are Bro — the user's best friend who lives inside the Brodoit app, talking to them out loud like a real bro: warm, witty, direct, zero corporate tone. You can also read their steps, streak and friends rank (get_steps) and set their step goal (set_step_goal). Keep spoken replies SHORT (1–3 sentences) unless the user asks you to explain or teach. Match the user's language: if they speak Hindi or Hinglish, answer in natural Hinglish. You can: add tasks, complete tasks, set reminders, create calendar events, read today's schedule, read today's news and explain it simply. When the user wants something done, call the tool and then confirm in one line. Never invent a task — only create what they asked. Be a hype man when they're low, a coach when they're stuck, a teacher when they ask to learn.`,
  teacher: `You are Bro in teacher mode, the coach of Brodoit's two schools (Python: Zero to Hero, 60 days; and Languages: Spanish, French, German, Hindi, English). Call get_learning first to see their progress, struggles and current day, guide them from there, and offer to open their lesson (open_python_day or start_language_lesson). You are a patient, fun tutor who explains anything (science, money, coding, exams, life skills) in plain words with everyday Indian examples, one idea at a time. Check understanding with a quick question after each idea. Speak slowly and clearly; keep each turn under 4 sentences. Switch to Hindi or Hinglish instantly if the user does.`,
  language: `You are Bro the language coach. The user is learning {{LANG}}. Run a spoken lesson: say a short phrase in {{LANG}}, give its meaning in the user's language, ask them to repeat it, listen, gently correct pronunciation or grammar, then praise and move on. Keep it playful and encouraging, like a Duolingo lesson spoken aloud. Use short turns.`,
  news: `You are Bro the news anchor. Use the get_news tool first, then read the top headlines like a friendly radio bulletin in simple English (or Hindi/Hinglish if the user prefers), and offer to explain any story "like I'm 12". Never make up news — only use what the tool returns.`,
};

const EXTRA_TOOLS = [
  { name: 'get_news', description: "Get today's top headlines and the latest Brodoit news bulletin. Use whenever the user asks about news, what's happening, or headlines.", input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Optional topic filter: india, world, tech, business, science' } } } },
  { name: 'start_language_lesson', description: 'Open a Brodoit language lesson for the user (Spanish, French, German, Hindi, or English for Hindi speakers). Use when they want to practise a language with exercises.', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['es', 'fr', 'de', 'hi', 'en'] } }, required: ['language'] } },
  { name: 'get_learning', description: "Read the user's progress in the Python course (60 days) and the language courses: days done, current day, scores, recent errors and struggles. Use when they ask how they are doing, what to study next, or about Python or language learning.", input_schema: { type: 'object', properties: {} } },
  { name: 'open_python_day', description: 'Open the Python: Zero to Hero course for the user, at a given day (1-60) or their current day.', input_schema: { type: 'object', properties: { day: { type: 'integer' } } } },
  { name: 'get_steps', description: "Read the user's steps today, goal, streak and friends rank. Use when they ask about steps, walking, their streak or the leaderboard.", input_schema: { type: 'object', properties: {} } },
  { name: 'set_step_goal', description: 'Set the user\'s daily step goal (500–100000). Use when they say e.g. "set my step goal to 10k".', input_schema: { type: 'object', properties: { goal: { type: 'integer' } }, required: ['goal'] } },
  { name: 'get_speaker_pipeline', description: "Read the user's speaker & teaching pipeline (college talks, guest lectures, faculty roles): counts and the next confirmed event. Use when they ask about their talks, lectures or speaking applications.", input_schema: { type: 'object', properties: {} } },
  { name: 'open_screen', description: 'Open a section of the Brodoit app for the user: tasks, learn, news, books, health, you.', input_schema: { type: 'object', properties: { screen: { type: 'string', enum: ['tasks', 'learn', 'news', 'books', 'health', 'you'] } }, required: ['screen'] } },
];

function install(app, deps) {
  const { auth, BRO_TOOLS, _broExecTool, _getUserTz, _callGemini, _callGroq, getHeadlines, getBulletin, speakerSummary, getSteps, setStepGoal } = deps;
  const getSetting = typeof deps.getSetting === 'function' ? deps.getSetting : (k => process.env[k] || '');
  const openaiKey = () => getSetting('OPENAI_API_KEY') || process.env.OPENAI_API_KEY || '';
  const realtimeVoice = () => getSetting('OPENAI_REALTIME_VOICE') || process.env.OPENAI_REALTIME_VOICE || 'cedar';
  const tools = [...BRO_TOOLS, ...EXTRA_TOOLS];
  const toOpenAI = t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema });

  function instructionsFor(persona, lang, user, speak) {
    const today = new Date().toISOString().slice(0, 10);
    const speakRule = speak === 'hi' ? ' ALWAYS speak in natural Hindi (Hindustani), whatever language the user uses.' : speak === 'en' ? ' ALWAYS speak in simple Indian English.' : '';
    const name = (user && user.name || '').split(' ')[0];
    let p = PERSONAS[persona] || PERSONAS.bro;
    p = p.replace(/\{\{LANG\}\}/g, lang || 'Spanish');
    return p + speakRule + `\nToday is ${today}.${name ? ` The user's name is ${name}.` : ''} Audio only: never read out URLs, markdown or emojis.`;
  }

  async function runTool(name, args, user) {
    if (name === 'get_news') {
      const items = await getHeadlines(args && args.topic);
      const b = getBulletin && getBulletin();
      return { headlines: items.slice(0, 8).map(i => ({ title: i.title, summary: (i.desc || i.description || '').slice(0, 220), source: i.source })), bulletin: b ? { title: b.title, easy: (b.easy_text || '').slice(0, 1500) } : null };
    }
    if (name === 'get_learning') { try { const pr = global._learnVoice && global._learnVoice.profile(user.phone); return pr ? { summary: pr.text, python_current_day: pr.current, python_days_done: pr.done, open: '/code/' } : { error: 'learning unavailable' }; } catch (e) { return { error: e.message }; } }
    if (name === 'open_python_day') { const d = Math.max(1, Math.min(60, parseInt(args && args.day) || 0)); return { ok: true, open: d ? '/code/day.html?d=' + d : '/code/' }; }
    if (name === 'get_steps') { try { return (getSteps && getSteps(user.phone)) || { error: 'steps unavailable' }; } catch (e) { return { error: e.message }; } }
    if (name === 'set_step_goal') { try { const g = Math.max(500, Math.min(100000, parseInt(args && args.goal) || 0)); if (!g) return { error: 'goal required' }; return (setStepGoal && setStepGoal(user.phone, g)) || { ok: true, goal: g }; } catch (e) { return { error: e.message }; } }
    if (name === 'get_speaker_pipeline') { try { return (speakerSummary && speakerSummary(user.phone)) || { confirmed: 0, applied: 0, next: null, open: '/speaker/' }; } catch (e) { return { error: e.message }; } }
    if (name === 'start_language_lesson') { const c = ['es', 'fr', 'de', 'hi', 'en'].includes(args && args.language) ? args.language : 'es'; return { ok: true, open: '/lang/course.html?c=' + c }; }
    if (name === 'open_screen') return { ok: true, open: '/?tab=' + args.screen };
    return _broExecTool(name, args || {}, user.phone, user.tz || _getUserTz(user.phone));
  }

  // 0. Studio voice for the classic pipeline and News "Listen": modules/studio.js picks ElevenLabs (within the month's
  //    credits), then Gemini / OpenAI TTS; 404 when none can speak, so the browser uses its device voice. Results are cached
  //    on the volume by text, so a story many people play is paid for once.
  const elevenKey = () => getSetting('ELEVENLABS_API_KEY') || process.env.ELEVENLABS_API_KEY || '';
  const CACHE = deps.mediaDir ? path.join(deps.mediaDir, 'tts-cache') : '';
  if (CACHE) { try { fs.mkdirSync(CACHE, { recursive: true }); } catch (e) {} }
  // Kept to the newest 3000 files and 400 MB, checked at boot and every 6 hours (the volume also holds the database).
  function pruneCache() {
    try {
      const files = fs.readdirSync(CACHE).map(f => { const st = fs.statSync(path.join(CACHE, f)); return { f, t: st.mtimeMs, n: st.size }; }).sort((x, y) => y.t - x.t);
      let bytes = 0; files.forEach((x, i) => { bytes += x.n; if (i >= 3000 || bytes > 400 * 1024 * 1024) fs.unlinkSync(path.join(CACHE, x.f)); });
    } catch (e) {}
  }
  if (CACHE) { setTimeout(pruneCache, 30000); setInterval(pruneCache, 6 * 3600e3); }
  const inflight = new Map(); // one synthesis per uncached News chunk, however many people tap Listen at once
  const ttsHits = new Map(); // per-user: at most 30 speech requests a minute (each one may cost credits)
  setInterval(() => { const cut = Date.now() - 60e3; for (const [u, l] of ttsHits) { const k = l.filter(t => t > cut); if (k.length) ttsHits.set(u, k); else ttsHits.delete(u); } }, 5 * 60e3).unref();
  app.post('/api/voice/tts', auth, async (req, res) => {
    const who = String((req.user && (req.user.phone || req.user.id)) || req.ip); const cut = Date.now() - 60e3;
    const hits = (ttsHits.get(who) || []).filter(t => t > cut); if (hits.length >= 30) return res.status(429).json({ error: 'slow down' });
    hits.push(Date.now()); ttsHits.set(who, hits);
    const text = String(req.body && req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!text) return res.status(400).json({ error: 'text required' });
    const lang = String(req.body && req.body.lang || '') === 'hi' ? 'hi' : 'en';
    const news = String(req.body && req.body.kind || '') === 'news';
    const role = news ? 'narrator' : 'bro';
    const id = crypto.createHash('sha1').update(lang + '|' + role + '|' + text).digest('hex');
    if (CACHE && news) {
      for (const [ext, mime] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav']]) {
        const f = path.join(CACHE, id + '.' + ext);
        if (fs.existsSync(f)) { res.set('Content-Type', mime); res.set('Cache-Control', 'private, max-age=86400'); return res.send(fs.readFileSync(f)); }
      }
    }
    try {
      const make = () => STUDIO.speak({ text, lang, purpose: news ? 'daily' : 'live', role, getSetting, timeout: 25000, eleven: { format: 'mp3_44100_64', timeout: 20000, chunk: 1500, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } } });
      let out;
      if (news) { if (!inflight.has(id)) inflight.set(id, make().finally(() => inflight.delete(id))); out = await inflight.get(id); }
      else out = await make();
      if (out) {
        if (CACHE && news) { try { const f = path.join(CACHE, id + (out.mime === 'audio/wav' ? '.wav' : '.mp3')); if (!fs.existsSync(f)) fs.writeFileSync(f, out.buf); } catch (e) {} }
        res.set('Content-Type', out.mime); res.set('Cache-Control', 'no-store'); res.set('X-Voice', out.provider); return res.send(out.buf);
      }
    } catch (e) { console.log('[voice] tts error', e.message); }
    res.status(404).json({ error: 'no studio voice configured' });
  });
  // Speech → text for browsers without SpeechRecognition (raw audio body; OpenAI transcription).
  const express = require('express');
  app.post('/api/voice/transcribe', auth, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const key = openaiKey(); if (!key) return res.status(404).json({ error: 'no transcription configured' });
    const body = req.body; if (!body || !body.length || body.length < 1000) return res.status(400).json({ error: 'audio required' });
    const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    const ext = /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm';
    try {
      const fd = new FormData();
      fd.append('file', new Blob([body], { type: mime }), 'speech.' + ext);
      fd.append('model', 'gpt-4o-mini-transcribe');
      const hint = String(req.query.lang || ''); if (hint === 'hi' || hint === 'en') fd.append('language', hint);
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key }, body: fd });
      clearTimeout(t);
      const j = await r.json();
      if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'transcription failed' });
      res.json({ text: String(j.text || '').trim() });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // 0b. ElevenLabs Conversational AI — Bro's primary voice engine when an ElevenLabs key exists: their speech recognition,
  //     their LLM orchestration and their voices, interruptible, Hindi/English. One private agent per server, created on first
  //     use and refreshed when the prompt or tools change. Tools run in the browser (client tools) through /api/voice/tool.
  const AGENT = { id: null, hash: null, error: '', at: 0, creating: null };
  const AGENT_LLMS = ['gemini-2.5-flash', 'gpt-4o-mini', 'gemini-2.0-flash']; // billed by ElevenLabs, no extra key
  const agentPrompt = () => PERSONAS.bro + ' Modes: when the user asks to learn or explain, teach patiently like a tutor; when they ask to practise a language, run a short spoken lesson. Match the user\'s language exactly (Hindi, English or Hinglish). Use tools whenever they ask to add or complete tasks, set reminders, create events, read their schedule, read the news, or check or set steps; confirm in one short line after a tool. Audio only: never read URLs, markdown or emojis. Keep answers to one to three sentences unless asked to explain.';
  const clientTools = () => tools.map(t => ({ type: 'client', name: t.name, description: (t.description || '').slice(0, 400), parameters: t.input_schema || { type: 'object', properties: {} }, expects_response: true }));
  async function elevenApi(key, method, path, body) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch('https://api.elevenlabs.io' + path, { method, signal: ctrl.signal, headers: Object.assign({ 'xi-api-key': key }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text.slice(0, 300) }; }
      return { ok: r.ok, status: r.status, body: j };
    } finally { clearTimeout(t); }
  }
  async function agentConfig(key) {
    return {
      name: 'Brodoit Bro',
      conversation_config: {
        agent: {
          first_message: "Hey, I'm Bro. What's up?",
          language: 'en',
          prompt: { prompt: agentPrompt(), llm: getSetting('ELEVEN_AGENT_LLM') || AGENT_LLMS[0], temperature: 0.6, max_tokens: 350 },
        },
        tts: { voice_id: await EV.pickVoice(key, 'en', getSetting), model_id: 'eleven_turbo_v2_5', stability: 0.45, similarity_boost: 0.8 },
        asr: { quality: 'high', provider: 'elevenlabs' },
        turn: { turn_timeout: 7 },
        conversation: { max_duration_seconds: 600 }, // 10-minute calls: a long session can't run far past the plan
      },
      platform_settings: { auth: { enable_auth: true } },
    };
  }
  function hashOf(o) { return crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12); }
  async function ensureAgent(key) {
    if (AGENT.creating) return AGENT.creating;
    AGENT.creating = (async () => {
      // the hash includes a key fingerprint, so a different ElevenLabs account never reuses another account's agent id
      const cfg = await agentConfig(key); const want = hashOf({ cfg, tools: clientTools().map(t => t.name), key: crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) });
      const savedId = getSetting('ELEVEN_AGENT_ID') || AGENT.id, savedHash = getSetting('ELEVEN_AGENT_HASH') || AGENT.hash;
      if (savedId && savedHash === want) { AGENT.id = savedId; AGENT.hash = want; return savedId; }
      if (AGENT.error && Date.now() - AGENT.at < 10 * 60 * 1000 && !savedId) return null; // don't hammer a failing API
      // tools: try the tools API (tool_ids), then inline tools, then none — whichever the account's API version accepts
      const attempts = [];
      try {
        const ids = [];
        for (const t of clientTools()) { const r = await elevenApi(key, 'POST', '/v1/convai/tools', { tool_config: t }); if (r.ok && r.body && r.body.id) ids.push(r.body.id); else { ids.length = 0; attempts.push('tools api ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120)); break; } }
        if (ids.length) attempts.push({ cfg: JSON.parse(JSON.stringify(cfg)), set: c => { c.conversation_config.agent.prompt.tool_ids = ids; } });
      } catch (e) { attempts.push('tools api: ' + e.message); }
      attempts.push({ cfg: JSON.parse(JSON.stringify(cfg)), set: c => { c.conversation_config.agent.prompt.tools = clientTools(); } });
      attempts.push({ cfg: JSON.parse(JSON.stringify(cfg)), set: c => {} });
      const errors = attempts.filter(a => typeof a === 'string');
      for (const a of attempts) {
        if (typeof a === 'string') continue;
        a.set(a.cfg);
        const r = savedId ? await elevenApi(key, 'PATCH', '/v1/convai/agents/' + encodeURIComponent(savedId), a.cfg) : await elevenApi(key, 'POST', '/v1/convai/agents/create', a.cfg);
        const id = (r.body && (r.body.agent_id || r.body.id)) || (r.ok ? savedId : null);
        if (r.ok && id) {
          AGENT.id = id; AGENT.hash = want; AGENT.error = ''; AGENT.at = Date.now();
          try { if (deps.setSetting) { deps.setSetting('ELEVEN_AGENT_ID', id); deps.setSetting('ELEVEN_AGENT_HASH', want); } } catch (e) {}
          console.log('[voice] elevenlabs agent ready', id, errors.length ? '(' + errors.join('; ') + ')' : '');
          return id;
        }
        errors.push((savedId ? 'update ' : 'create ') + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
        if (r.status === 404 && savedId) { try { deps.setSetting && deps.setSetting('ELEVEN_AGENT_ID', ''); } catch (e) {} }
      }
      // ElevenLabs retires LLM ids too: when the refusal names the model, remember the next one and try again (once per model)
      const llmNow = cfg.conversation_config.agent.prompt.llm, nextLlm = AGENT_LLMS[AGENT_LLMS.indexOf(llmNow) + 1];
      const llmRefused = errors.some(e => /^(create|update) /.test(e) && (/\bllm\b/i.test(e) || e.includes(llmNow)));
      if (nextLlm && llmRefused && deps.setSetting) {
        try { deps.setSetting('ELEVEN_AGENT_LLM', nextLlm); console.log('[voice] agent LLM', llmNow, 'refused → trying', nextLlm); AGENT.creating = null; return await ensureAgent(key); } catch (e) {}
      }
      AGENT.error = errors.join(' | ').slice(0, 600); AGENT.at = Date.now();
      console.log('[voice] elevenlabs agent failed:', AGENT.error);
      return null;
    })().catch(e => { AGENT.error = e.message; AGENT.at = Date.now(); return null; }).finally(() => { AGENT.creating = null; });
    return AGENT.creating;
  }
  async function signedUrl(key, agentId) {
    const r = await elevenApi(key, 'GET', '/v1/convai/conversation/get-signed-url?agent_id=' + encodeURIComponent(agentId));
    if (r.ok && r.body && r.body.signed_url) return { signed_url: r.body.signed_url };
    const t = await elevenApi(key, 'GET', '/v1/convai/conversation/token?agent_id=' + encodeURIComponent(agentId));
    if (t.ok && t.body && t.body.token) return { conversation_token: t.body.token };
    if ([401, 403, 404].includes(r.status) && [401, 403, 404].includes(t.status)) { // agent deleted or belongs to another account
      AGENT.id = null; AGENT.hash = null; try { deps.setSetting && deps.setSetting('ELEVEN_AGENT_ID', ''); deps.setSetting && deps.setSetting('ELEVEN_AGENT_HASH', ''); } catch (e) {}
    }
    throw new Error('signed url ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  global._voiceStatus = () => ({ engine: elevenKey() ? (AGENT.id ? 'elevenlabs' : (AGENT.error ? 'fallback' : 'elevenlabs-pending')) : (openaiKey() ? 'realtime' : 'fallback'), agent_id: AGENT.id || getSetting('ELEVEN_AGENT_ID') || null, agent_error: AGENT.error || '', llm: hasLLM(), tts: STUDIO.available(getSetting).length > 0 });
  if (elevenKey()) setTimeout(() => ensureAgent(elevenKey()).catch(() => {}), 15000);

  // 1. Session: hand the browser a short-lived Realtime client secret.
  app.post('/api/voice/session', auth, async (req, res) => {
    const persona = String(req.body && req.body.persona || 'bro');
    const lang = String(req.body && req.body.lang || '');
    const instructions = instructionsFor(persona, lang, req.user, String(req.body && req.body.speak || ''));
    const ek = elevenKey();
    if (ek && String(req.body && req.body.engine || '') !== 'classic') {
      try {
        const snap = EV.snapshot(ek); if (!snap || Date.now() - (snap.at || 0) > 120000) await EV.subscription(ek, true); // real numbers before a call
        const b = await EV.budget(ek, 0, 'live'); if (!b.ok) throw new Error(b.reason); // out of credits → the next engine, no overage
        const agentId = await ensureAgent(ek);
        if (agentId) {
          const su = await signedUrl(ek, agentId);
          const name = (req.user && req.user.name || '').split(' ')[0];
          const context = 'Mode: ' + persona + (lang ? ' (language practice: ' + lang + ')' : '') + '. ' + (String(req.body && req.body.speak || '') === 'hi' ? 'Speak Hindi.' : String(req.body && req.body.speak || '') === 'en' ? 'Speak English.' : 'Match the user\'s language.') + (name ? ' The user\'s name is ' + name + '.' : '') + ' Today is ' + new Date().toISOString().slice(0, 10) + '.';
          return res.json(Object.assign({ mode: 'eleven', persona, agent_id: agentId, tools: tools.map(t => t.name), context }, su));
        }
      } catch (e) { console.log('[voice] elevenlabs session failed, next engine:', e.message); }
    }
    const key = openaiKey();
    const caps = { tts: STUDIO.available(getSetting).length > 0, stt: !!key, llm: hasLLM() };
    if (!key) return res.json({ mode: 'fallback', persona, caps, instructions: instructions.slice(0, 400) });
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: {
            type: 'realtime', model: REALTIME_MODEL, instructions,
            tools: tools.map(toOpenAI), tool_choice: 'auto',
            audio: {
              input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true }, noise_reduction: { type: 'near_field' } },
              output: { voice: realtimeVoice(), speed: 1.0 },
            },
          },
        }),
      });
      clearTimeout(t);
      const j = await r.json();
      if (!r.ok || !j.value) { console.log('[voice] client secret failed', r.status, JSON.stringify(j).slice(0, 300)); return res.json({ mode: 'fallback', persona, caps, reason: 'realtime-unavailable' }); }
      res.json({ mode: 'realtime', persona, client_secret: j.value, expires_at: j.expires_at, model: REALTIME_MODEL });
    } catch (e) { console.log('[voice] session error', e.message); res.json({ mode: 'fallback', persona, caps, reason: e.message }); }
  });

  // 2. Tool execution requested by the browser during a Realtime call.
  app.post('/api/voice/tool', auth, async (req, res) => {
    const name = String(req.body && req.body.name || '');
    if (!tools.some(t => t.name === name)) return res.status(400).json({ error: 'unknown tool' });
    try { res.json({ result: await runTool(name, req.body.args || {}, req.user) }); }
    catch (e) { res.json({ result: { error: e.message } }); }
  });

  // 3. Classic turn: text in → text out with tools. Providers in order: OpenAI (gpt-4o-mini) → Groq → Gemini; whichever has a key.
  async function callOpenAIChat(key, messages, { maxTokens = 800, tools } = {}) {
    const body = { model: getSetting('OPENAI_CHAT_MODEL') || 'gpt-4o-mini', messages, max_tokens: maxTokens, temperature: 0.7 };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || ('OpenAI ' + r.status));
      const m = j.choices && j.choices[0] && j.choices[0].message;
      return { message: m, reply: (m && m.content) || '' };
    } finally { clearTimeout(t); }
  }
  const hasGroq = () => { try { return !!(deps.hasGroq ? deps.hasGroq() : process.env.GROQ_API_KEY); } catch (e) { return false; } };
  const hasGemini = () => { try { return !!(deps.hasGemini ? deps.hasGemini() : process.env.GEMINI_API_KEY); } catch (e) { return false; } };
  function providers() {
    const out = [];
    const ok = openaiKey(); if (ok) out.push({ name: 'openai', tools: true, call: (m, o) => callOpenAIChat(ok, m, o) });
    if (_callGroq && hasGroq()) out.push({ name: 'groq', tools: true, call: (m, o) => _callGroq(m, o) });
    if (_callGemini && (hasGemini() || (global._elevenBrain && global._elevenBrain.available()))) out.push({ name: 'gemini', tools: false, call: async (m, o) => { const sys = (m.find(x => x.role === 'system') || {}).content || ''; const g = await _callGemini(m.filter(x => x.role !== 'system'), { maxTokens: o.maxTokens || 600, systemPrompt: sys }); return { message: { content: g.reply }, reply: g.reply }; } });
    return out;
  }
  const hasLLM = () => providers().length > 0;
  app.post('/api/voice/turn', auth, async (req, res) => {
    const persona = String(req.body && req.body.persona || 'bro');
    const lang = String(req.body && req.body.lang || '');
    const speak = String(req.body && req.body.speak || '');
    const msgs = Array.isArray(req.body && req.body.messages) ? req.body.messages.slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) })) : [];
    if (!msgs.length) return res.status(400).json({ error: 'messages required' });
    const sys = instructionsFor(persona, lang, req.user, speak) + ' Reply in plain spoken sentences, no lists, no markdown.';
    const list = providers();
    if (!list.length) { console.warn('[voice] no brain: paste an OpenAI, Gemini or Groq key in You → Admin'); return res.status(503).json({ error: 'brain_unavailable' }); }
    const last = msgs[msgs.length - 1].content.toLowerCase();
    const wantsTool = /\b(add|create|schedule|remind|task|event|block|complete|done|finish|mark|news|headline|steps|goal|khabar|samachar|yaad|kaam)\b/i.test(last);
    const fnTools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    let lastErr = null;
    for (const p of list) {
      const actions = [];
      try {
        let apiMsgs = [{ role: 'system', content: sys }, ...msgs];
        for (let loop = 0; loop < 3; loop++) {
          const g = await p.call(apiMsgs, { maxTokens: 800, tools: p.tools && wantsTool ? fnTools : undefined });
          const m = g.message;
          if (p.tools && m && m.tool_calls && m.tool_calls.length) {
            apiMsgs.push(m);
            for (const tc of m.tool_calls) {
              let args = {}; try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch (e) {}
              const result = await runTool(tc.function.name, args, req.user);
              actions.push({ tool: tc.function.name, input: args, result });
              apiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
            }
            continue;
          }
          const reply = ((m && m.content) || g.reply || '').trim();
          if (!reply) throw new Error('empty reply');
          return res.json({ reply, actions, provider: p.name });
        }
        throw new Error('tool loop did not finish');
      } catch (e) { lastErr = e; console.log('[voice] turn via', p.name, 'failed:', e.message); }
    }
    res.status(503).json({ error: speak === 'hi' ? 'Bro एक सेकंड के लिए कट गया — फिर बोलो।' : 'Bro lost the connection for a second — try again.' + (lastErr ? '' : '') });
  });

  console.log('[voice] engines · elevenlabs', elevenKey() ? '✅ agent' : '❌', '· realtime', openaiKey() ? '✅ ' + REALTIME_MODEL : '❌', '· brain', hasLLM() ? '✅' : '❌ (paste a key in You → Admin)');
}

module.exports = { install, PERSONAS };
