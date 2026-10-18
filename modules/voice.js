// Talking Bro — voice agent backend.
// Primary engine: OpenAI Realtime (speech-to-speech over WebRTC) when an OpenAI key is set.
// The key is read per request via deps.getSetting (pasted in You → Admin; env is the fallback),
// so pasting a key switches the engine on without a restart.
// The browser gets a short-lived client secret from /api/voice/session, opens the WebRTC
// call itself, and asks us to run tools via /api/voice/tool (tasks, reminders, news…).
// Fallback engine (no key): browser speech recognition → /api/voice/turn (Gemini/Groq) → browser TTS.
'use strict';
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';

const PERSONAS = {
  bro: `You are Bro — the user's best friend who lives inside the Brodoit app, talking to them out loud like a real bro: warm, witty, direct, zero corporate tone. You can also read their steps, streak and friends rank (get_steps) and set their step goal (set_step_goal). Keep spoken replies SHORT (1–3 sentences) unless the user asks you to explain or teach. Match the user's language: if they speak Hindi or Hinglish, answer in natural Hinglish. You can: add tasks, complete tasks, set reminders, create calendar events, read today's schedule, read today's news and explain it simply. When the user wants something done, call the tool and then confirm in one line. Never invent a task — only create what they asked. Be a hype man when they're low, a coach when they're stuck, a teacher when they ask to learn.`,
  teacher: `You are Bro in teacher mode — a patient, fun tutor who explains anything (science, money, coding, exams, life skills) in plain words with everyday Indian examples, one idea at a time. Check understanding with a quick question after each idea. Speak slowly and clearly; keep each turn under 4 sentences. Switch to Hindi or Hinglish instantly if the user does.`,
  language: `You are Bro the language coach. The user is learning {{LANG}}. Run a spoken lesson: say a short phrase in {{LANG}}, give its meaning in the user's language, ask them to repeat it, listen, gently correct pronunciation or grammar, then praise and move on. Keep it playful and encouraging, like a Duolingo lesson spoken aloud. Use short turns.`,
  news: `You are Bro the news anchor. Use the get_news tool first, then read the top headlines like a friendly radio bulletin in simple English (or Hindi/Hinglish if the user prefers), and offer to explain any story "like I'm 12". Never make up news — only use what the tool returns.`,
};

const EXTRA_TOOLS = [
  { name: 'get_news', description: "Get today's top headlines and the latest Brodoit news bulletin. Use whenever the user asks about news, what's happening, or headlines.", input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Optional topic filter: india, world, tech, business, science' } } } },
  { name: 'start_language_lesson', description: 'Open a Brodoit language lesson for the user (Spanish, French, German, Japanese, Hindi, or English for Hindi speakers). Use when they want to practise a language with exercises.', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['es', 'fr', 'de', 'ja', 'hi', 'en'] } }, required: ['language'] } },
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
    if (name === 'get_steps') { try { return (getSteps && getSteps(user.phone)) || { error: 'steps unavailable' }; } catch (e) { return { error: e.message }; } }
    if (name === 'set_step_goal') { try { const g = Math.max(500, Math.min(100000, parseInt(args && args.goal) || 0)); if (!g) return { error: 'goal required' }; return (setStepGoal && setStepGoal(user.phone, g)) || { ok: true, goal: g }; } catch (e) { return { error: e.message }; } }
    if (name === 'get_speaker_pipeline') { try { return (speakerSummary && speakerSummary(user.phone)) || { confirmed: 0, applied: 0, next: null, open: '/speaker/' }; } catch (e) { return { error: e.message }; } }
    if (name === 'start_language_lesson') return { ok: true, open: '/lang/?course=' + (args.language || 'es') };
    if (name === 'open_screen') return { ok: true, open: '/?tab=' + args.screen };
    return _broExecTool(name, args || {}, user.phone, user.tz || _getUserTz(user.phone));
  }

  // 0. Studio voice for the classic pipeline (listen → think → speak): ElevenLabs first, OpenAI TTS second, else 404 so the
  //    browser falls back to its device voice.
  const elevenKey = () => getSetting('ELEVENLABS_API_KEY') || process.env.ELEVENLABS_API_KEY || '';
  const DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB';
  const elevenVoice = lang => getSetting(lang === 'hi' ? 'ELEVEN_VOICE_HI' : 'ELEVEN_VOICE_EN') || process.env[lang === 'hi' ? 'ELEVEN_VOICE_HI' : 'ELEVEN_VOICE_EN'] || DEFAULT_VOICE;
  async function elevenSpeak(text, lang, key) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoice(lang)}?output_format=mp3_44100_64`, {
        method: 'POST', signal: ctrl.signal, headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', language_code: lang === 'hi' ? 'hi' : 'en', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
      });
      if (!r.ok) { console.log('[voice] elevenlabs', r.status, (await r.text()).slice(0, 160)); return null; }
      return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  async function openaiSpeak(text, lang, key) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: getSetting('OPENAI_TTS_VOICE') || 'ash', input: text, response_format: 'mp3', instructions: lang === 'hi' ? 'Speak natural, warm Hindi at an easy pace, like a close friend.' : 'Warm, confident Indian English. Natural pace, friendly, never robotic.' }),
      });
      if (!r.ok) { console.log('[voice] openai tts', r.status, (await r.text()).slice(0, 160)); return null; }
      return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  app.post('/api/voice/tts', auth, async (req, res) => {
    const text = String(req.body && req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!text) return res.status(400).json({ error: 'text required' });
    const lang = String(req.body && req.body.lang || '') === 'hi' ? 'hi' : 'en';
    try {
      let buf = null;
      const ek = elevenKey(); if (ek) buf = await elevenSpeak(text, lang, ek);
      const ok = openaiKey(); if (!buf && ok) buf = await openaiSpeak(text, lang, ok);
      if (buf) { res.set('Content-Type', 'audio/mpeg'); res.set('Cache-Control', 'no-store'); return res.send(buf); }
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

  // 1. Session: hand the browser a short-lived Realtime client secret.
  app.post('/api/voice/session', auth, async (req, res) => {
    const persona = String(req.body && req.body.persona || 'bro');
    const lang = String(req.body && req.body.lang || '');
    const instructions = instructionsFor(persona, lang, req.user, String(req.body && req.body.speak || ''));
    const key = openaiKey();
    const caps = { tts: !!(elevenKey() || key), stt: !!key };
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

  // 3. Fallback turn: text in → text out, with simple tool handling, for devices without Realtime.
  app.post('/api/voice/turn', auth, async (req, res) => {
    const persona = String(req.body && req.body.persona || 'bro');
    const lang = String(req.body && req.body.lang || '');
    const msgs = Array.isArray(req.body && req.body.messages) ? req.body.messages.slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) })) : [];
    if (!msgs.length) return res.status(400).json({ error: 'messages required' });
    const sys = instructionsFor(persona, lang, req.user, String(req.body && req.body.speak || '')) + ' Reply in plain spoken sentences, no lists, no markdown.';
    const last = msgs[msgs.length - 1].content.toLowerCase();
    const actions = [];
    try {
      const wantsTool = /\b(add|create|schedule|remind|task|event|block|complete|done|finish|mark|news|headline|khabar|samachar)\b/i.test(last);
      if (wantsTool && _callGroq) {
        const groqTools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
        let apiMsgs = [{ role: 'system', content: sys }, ...msgs];
        for (let loop = 0; loop < 3; loop++) {
          const g = await _callGroq(apiMsgs, { maxTokens: 800, tools: groqTools });
          const m = g.message;
          if (m && m.tool_calls && m.tool_calls.length) {
            apiMsgs.push(m);
            for (const tc of m.tool_calls) {
              const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {});
              const result = await runTool(tc.function.name, args, req.user);
              actions.push({ tool: tc.function.name, input: args, result });
              apiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
            }
            continue;
          }
          return res.json({ reply: (m && m.content) || g.reply || '', actions });
        }
      }
      const g = await _callGemini(msgs, { maxTokens: 600, systemPrompt: sys });
      res.json({ reply: g.reply, actions });
    } catch (e) {
      try { const g = await _callGroq([{ role: 'system', content: sys }, ...msgs], { maxTokens: 600 }); return res.json({ reply: g.reply, actions }); } catch (e2) {}
      res.status(503).json({ error: /no-key/.test(e.message) ? 'Bro\'s brain is not connected yet — add GEMINI_API_KEY or GROQ_API_KEY on the server.' : 'Bro lost the connection for a second — try again.' });
    }
  });

  console.log('[voice] realtime', openaiKey() ? '✅ ' + REALTIME_MODEL : '❌ (fallback mode: browser speech — paste an OpenAI key in You → Admin)');
}

module.exports = { install, PERSONAS };
