// Talking Bro — the voice-first home screen. Loaded by the SPA as a plain script; uses the SPA
// globals (S, api, token, toast, esc, render, switchTab). One voice (Bro's ElevenLabs voice) behind one UI:
//  • eleven: ElevenLabs Conversational AI (speech in/out, tools), greeting + context passed as dynamic variables
//  • fallback: browser SpeechRecognition → /api/voice/turn → /api/voice/tts in the same ElevenLabs voice
//  • realtime: OpenAI Realtime over WebRTC, only on servers without an ElevenLabs key
//    (the device voice only when no voice provider exists at all)
(function () {
  'use strict';
  const V = window.BroVoice = {
    state: 'idle', // idle | connecting | live | listening | thinking | speaking | off
    engine: null,   // 'realtime' | 'fallback'
    persona: (p => p === 'news' ? 'bro' : p)(localStorage.getItem('bro.persona') || 'bro'),
    lang: localStorage.getItem('bro.lang') || 'auto', // auto | en | hi
    course: localStorage.getItem('bro.course') || 'es',
    thread: [],     // {role:'user'|'bro', text, ts}
    pc: null, dc: null, mic: null, audioEl: null, rec: null, handsFree: false, partial: '',
  };
  const PERSONAS = [
    { k: 'bro', i: 'message-circle', l: 'Bro', hi: 'Bro' },
    { k: 'teacher', i: 'lightbulb', l: 'Teach', hi: 'सिखाओ' },
    { k: 'language', i: 'languages', l: 'Speak', hi: 'भाषा' },
  ];
  const COURSES = { es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', en: 'English' };
  const hasDevanagari = s => /[ऀ-ॿ]/.test(s || '');
  const ICON = {
    mic: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    stop: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  };

  // ───────────────────────── UI ─────────────────────────
  // Home v13.1 — Bro and almost no words: the big mascot on the app background, one round mic button, the mode and
  // language switches as small toggles, chat bubbles, and the compose bar. A status line appears only while Bro is live.
  // Styles in app/home.css.
  const hEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  V.html = function () {
    const hi = V.lang === 'hi';
    const ic = (n, sz) => (window.ico ? ico(n, sz || 18) : '');
    const live = V.state !== 'idle' && V.state !== 'off';
    let line = '';
    if (V.state === 'connecting') line = hi ? 'एक सेकंड…' : 'One sec…';
    else if (V.state === 'thinking') line = hi ? 'सोच रहा हूँ…' : 'Thinking…';
    else if (V.partial) line = V.partial;
    else if (live) line = hi ? 'सुन रहा हूँ…' : 'Listening…';
    const chat = V.thread.length > 0;
    // v15: Bro is a living voice orb (light that moves with his state), not a cartoon
    const art = '<span class="hb-orbw" aria-hidden="true"><span class="hb-shade"></span><span class="hb-orb st-' + V.state + '"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span></span>';
    let h = '<div class="bh' + (hi ? ' hi' : '') + (chat ? ' chat' : '') + (live ? ' live' : '') + '">';
    // mode (only the chosen one shows its name) + language
    h += '<div class="hb-top"><div class="hb-modes" role="group" aria-label="' + (hi ? 'मोड' : 'Mode') + '">' + PERSONAS.map(p => '<button type="button" class="hb-mode' + (V.persona === p.k ? ' on' : '') + '" aria-pressed="' + (V.persona === p.k) + '" aria-label="' + (hi ? p.hi : p.l) + '" title="' + (hi ? p.hi : p.l) + '" onclick="BroVoice.setPersona(\'' + p.k + '\')">' + ic(p.i, 18) + (V.persona === p.k ? '<span>' + (hi ? p.hi : p.l) + '</span>' : '') + '</button>').join('') + '</div>';
    h += '<div class="hb-langs" role="group" aria-label="Language">' + [['auto', 'Auto', 'Reply in my language'], ['en', 'EN', 'Reply in English'], ['hi', 'हि', 'Reply in Hindi']].map(x => '<button type="button" class="' + (V.lang === x[0] ? 'on' : '') + '" aria-pressed="' + (V.lang === x[0]) + '" aria-label="' + x[2] + '" onclick="BroVoice.setLang(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div></div>';
    // Bro
    h += '<section class="hb-stage" aria-label="Bro"><button type="button" class="hb-bro" onclick="BroVoice.tapOrb()" aria-label="' + (live ? (hi ? 'बंद करो' : 'Stop') : (hi ? 'बोलकर पूछो' : 'Talk to Bro')) + '">' + art + '</button>';
    h += '<p class="hb-say' + (V.partial ? ' partial' : '') + '" id="bvSay" aria-live="polite">' + hEsc(line) + '</p>';
    h += '<button type="button" class="hb-mic' + (live ? ' on' : '') + '" id="bvTalk" onclick="' + (live ? 'BroVoice.stop()' : 'BroVoice.tapOrb()') + '" aria-label="' + (live ? (hi ? 'बंद करो' : 'Stop') : (hi ? 'बोलकर पूछो' : 'Talk to Bro')) + '">' + (live ? ICON.stop : ICON.mic) + '</button></section>';
    if (V.persona === 'language') h += '<div class="pill-row hb-courses">' + Object.keys(COURSES).map(c => '<button type="button" class="pill' + (V.course === c ? ' on' : '') + '" onclick="BroVoice.setCourse(\'' + c + '\')">' + COURSES[c] + '</button>').join('') + '</div>';
    if (chat) {
      h += '<div class="hb-thread" id="bvThread">';
      V.thread.slice(-8).forEach(m => { h += '<div class="bv-msg ' + m.role + '"><div class="bv-bub">' + hEsc(m.text) + '</div></div>'; });
      h += '</div>';
    }
    h += '<form class="hb-compose" onsubmit="event.preventDefault();BroVoice.send()"><input id="bvInput" placeholder="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '" autocomplete="off" enterkeyhint="send" aria-label="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '"><button type="submit" class="hb-send"' + (V.state === 'thinking' ? ' disabled' : '') + ' aria-label="' + (hi ? 'भेजो' : 'Send') + '">' + (window.ico ? ico('arrow-up', 20) : ICON.send) + '</button></form>';
    h += '</div>';
    return h;
  };
  V.rerender = function () { if (S.tab === 'bro' || S.tab === 'home' || !S.tab) { const root = document.getElementById('broVoiceRoot'); if (root) { root.innerHTML = V.html(); V.scroll(); } } V.renderFull(); };
  // While chatting Home is a fixed-height chat: it fills the space above the tab bar, the bubbles scroll inside,
  // and the compose bar stays at the bottom. The newest message is always in view.
  V.scroll = function () {
    const root = document.getElementById('broVoiceRoot'), t = document.getElementById('bvThread');
    if (!root) return;
    if (t) {
      const bar = document.querySelector('.tabs.page-t') || document.querySelector('.rd-tabbar'), r = bar && bar.getBoundingClientRect();
      const bottom = r && r.top > innerHeight * 0.6 ? r.top : innerHeight - 16;
      root.style.setProperty('--hb-avail', Math.max(360, Math.floor(bottom - (root.getBoundingClientRect().top + scrollY) - 8)) + 'px');
      if (scrollY) scrollTo(0, 0);
      t.scrollTop = t.scrollHeight;
    } else root.style.removeProperty('--hb-avail');
  };
  V.set = function (st) { V.state = st; V.rerender(); };
  V.push = function (role, text) { if (!text) return; V.thread.push({ role, text, ts: Date.now() }); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; V.rerender(); };
  V.setPersona = function (k) { V.persona = k; localStorage.setItem('bro.persona', k); const was = V.state; V.rerender(); if (was !== 'idle' && was !== 'off') { V.stop(true); V.start(); } };
  V.setLang = function (l) { V.lang = l; localStorage.setItem('bro.lang', l); V.rerender(); if (V.state !== 'idle' && V.state !== 'off') { V.stop(true); V.start(); } };
  V.setCourse = function (c) { V.course = c; localStorage.setItem('bro.course', c); V.rerender(); };
  V.tapOrb = function () { V.unlockAudio(); if (V.state === 'idle' || V.state === 'off') V.start(); else if (V.engine === 'fallback' && V.state === 'live') V.listen(); else V.stop(); };
  V.engineLabel = () => V.engine === 'eleven' ? 'ElevenLabs' : V.engine === 'realtime' ? 'OpenAI Realtime' : V.engine === 'fallback' ? (V.noTTS ? 'Device voice' : 'Studio voice') : '';
  // Audio playback must be unlocked by a user gesture on mobile: play a silent clip on the first tap.
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  V.ttsEl = function () { if (!V.tts) { V.tts = document.createElement('audio'); V.tts.setAttribute('playsinline', ''); V.tts.preload = 'auto'; document.body.appendChild(V.tts); } return V.tts; };
  V.unlockAudio = function () { try { const a = V.ttsEl(); if (!V.unlocked) { a.src = SILENT; a.play().then(() => { V.unlocked = true; }).catch(() => {}); } } catch (e) {} };
  // ───────────────────────── full-screen voice mode ─────────────────────────
  V.fullHtml = function () {
    const hi = V.lang === 'hi'; const live = V.state !== 'idle' && V.state !== 'off';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const cap = { connecting: hi ? 'जुड़ रहा है' : 'Connecting', live: hi ? 'बोलो' : 'Your turn', listening: hi ? 'सुन रहा हूँ' : 'Listening', thinking: hi ? 'सोच रहा हूँ' : 'Thinking', speaking: 'Bro' }[V.state] || '';
    const lastUser = V.thread.slice().reverse().find(m => m.role === 'user'); const lastBro = V.thread.slice().reverse().find(m => m.role === 'bro');
    let line = '', cls = '';
    if (V.partial) { line = V.partial; cls = 'bro'; }
    else if (V.state === 'listening') { line = V.heard || ''; cls = 'user'; }
    else if (V.state === 'thinking') { line = lastUser ? lastUser.text : ''; cls = 'user'; }
    else if (lastBro && (V.state === 'speaking' || V.state === 'live')) { line = lastBro.text; cls = 'bro'; }
    // when Bro isn't in his own voice, say why in a few words (credits low, no voice key, couldn't connect)
    const WHY = { credits: ['ElevenLabs credits are used up · phone voice', 'ElevenLabs क्रेडिट खत्म · फ़ोन की आवाज़'], connect: ['Voice service unreachable · phone voice', 'वॉइस सर्विस नहीं मिली · फ़ोन की आवाज़'], agent: ['Voice agent unavailable · phone voice', 'वॉइस एजेंट उपलब्ध नहीं · फ़ोन की आवाज़'], nokey: ['No voice key set · phone voice', 'वॉइस की नहीं · फ़ोन की आवाज़'] };
    const whyLine = live && V.engine === 'fallback' && V.noTTS ? (WHY[V.why] || WHY.credits)[hi ? 1 : 0] : '';
    const hint = whyLine ? whyLine : !live ? '' : (V.engine === 'realtime' || V.engine === 'eleven') ? (hi ? 'बस बोलो — बीच में टोक सकते हो' : 'Just talk — interrupt any time') : V.state === 'live' ? (SR ? (hi ? 'बोलने के लिए टैप करो' : 'Tap the circle to speak') : (hi ? 'बोलते समय दबाए रखो' : 'Hold the circle while you speak')) : '';
    return '<div class="bvf-top"><span class="bvf-mode">' + esc((PERSONAS.find(p => p.k === V.persona) || PERSONAS[0])[hi ? 'hi' : 'l']) + '</span><button class="bvf-x" onclick="BroVoice.stop()" aria-label="Close">' + (window.ico ? ico('x', 22) : '✕') + '</button></div>' +
      '<div class="bvf-stage"><button class="bv-orb st-' + V.state + '" id="bvfOrb" ' + ((!SR && V.engine === 'fallback' && V.caps && V.caps.stt) ? 'onpointerdown="BroVoice.holdStart()" onpointerup="BroVoice.holdEnd()" onpointercancel="BroVoice.holdEnd()" onpointerleave="BroVoice.holdEnd()"' : 'onclick="BroVoice.tapOrb()"') + ' aria-label="Talk"><span class="bv-ring r1"></span><span class="bv-ring r2"></span><span class="hb-orb st-' + V.state + '"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span></button><div class="bvf-cap">' + esc(cap) + '</div><div class="bvf-text ' + cls + '" id="bvfText">' + esc(line) + '</div></div>' +
      '<div class="bvf-bar"><div class="bvf-hint">' + esc(hint) + '</div><button class="bvf-end" onclick="BroVoice.stop()">' + ICON.stop + (hi ? ' बंद करो' : ' End') + '</button></div>';
  };
  V.openFull = function () { let el = document.getElementById('bvFull'); if (!el) { el = document.createElement('div'); el.id = 'bvFull'; el.className = 'bvf'; document.body.appendChild(el); document.documentElement.classList.add('bvf-open'); } el.innerHTML = V.fullHtml(); };
  V.closeFull = function () { const el = document.getElementById('bvFull'); if (el) el.remove(); document.documentElement.classList.remove('bvf-open'); };
  V.renderFull = function () { const el = document.getElementById('bvFull'); if (el) el.innerHTML = V.fullHtml(); };
  V.say = function (text) { V.send(text); };

  // ───────────────────────── session ─────────────────────────
  V.start = async function () {
    if (V.state === 'connecting') return;
    V.heard = ''; V.set('connecting'); V.openFull();
    let sess;
    try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang }) }); } catch (e) { sess = { mode: 'fallback' }; }
    if (sess && sess.mode === 'eleven') {
      try { await V.connectEleven(sess); return; } catch (e) { console.warn('[bro] elevenlabs failed, next engine', e); V.why = 'connect'; try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify({ engine: 'classic', persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang }) }); } catch (e2) { sess = { mode: 'fallback' }; } }
    }
    if (sess && sess.mode === 'realtime') {
      try { await V.connectRealtime(sess); return; } catch (e) { console.warn('[bro] realtime failed, falling back', e); }
    }
    V.caps = (sess && sess.caps) || {}; if (V.caps.tts === false && !elevenHint()) V.noTTS = true;
    if (sess && sess.why) V.why = sess.why;
    V.engine = 'fallback'; V.set('live'); V.listen();
  };
  const elevenHint = () => false;
  V.stop = function (silent) {
    try { if (V.conv) { const c = V.conv; V.conv = null; c.endSession().catch(() => {}); } } catch (e) {} V.conv = null;
    try { if (V.dc) V.dc.close(); } catch (e) {}
    try { if (V.pc) V.pc.close(); } catch (e) {}
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { if (V.rec) { V.rec.onend = null; V.rec.stop(); } } catch (e) {}
    try { speechSynthesis.cancel(); } catch (e) {}
    try { if (V.tts) { V.tts.pause(); V.tts.onended = null; } } catch (e) {}
    try { if (V.recd) { V.recd.onstop = null; V.recd.stop(); V.recd.stream.getTracks().forEach(t => t.stop()); } } catch (e) {} V.recd = null;
    V.pc = V.dc = V.mic = V.rec = null; V.handsFree = false; V.partial = ''; V.heard = '';
    V.closeFull(); V.state = 'idle'; if (!silent) V.rerender();
  };

  // ───────────────────────── ElevenLabs Conversational AI ─────────────────────────
  V.loadElevenSDK = async function () {
    if (V._elSDK) return V._elSDK;
    // pinned: an unpinned import would pick up every new ElevenLabs release the moment it ships
    const urls = ['https://esm.sh/@elevenlabs/client@1.28.0', 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.28.0/+esm'];
    let last = null;
    for (const u of urls) { try { const m = await import(/* webpackIgnore: true */ u); if (m && m.Conversation) { V._elSDK = m; return m; } } catch (e) { last = e; } }
    throw last || new Error('sdk unavailable');
  };
  V.connectEleven = async function (sess) {
    const { Conversation } = await V.loadElevenSDK();
    const toolsMap = {};
    (sess.tools || []).forEach(name => { toolsMap[name] = async params => { try { const r = await api('/voice/tool', { method: 'POST', body: JSON.stringify({ name, args: params || {} }) }); const result = (r && r.result) || { ok: false }; V.afterTool(name, params || {}, result); return JSON.stringify(result).slice(0, 4000); } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); } }; });
    const opts = {
      connectionType: sess.signed_url ? 'websocket' : 'webrtc',
      clientTools: toolsMap,
      onConnect: () => { V.engine = 'eleven'; V.set('listening'); }, // the context travels as dynamic variables, never as spoken text
      onDisconnect: () => { if (V.engine === 'eleven' && V.state !== 'idle') { V.conv = null; V.stop(); } },
      onMessage: m => { if (!m || !m.message) return; const src = m.source || m.role || ''; if (/user/i.test(src)) { V.heard = ''; V.push('user', String(m.message)); } else { V.partial = ''; V.push('bro', String(m.message)); } },
      onModeChange: m => { const mode = m && m.mode; if (mode === 'speaking') V.set('speaking'); else if (mode === 'listening') V.set('listening'); },
      onStatusChange: st => { const v = st && st.status; if (v === 'connecting') V.set('connecting'); },
      onError: (msg, ctx) => { console.warn('[bro eleven]', msg, ctx || ''); },
    };
    if (sess.signed_url) opts.signedUrl = sess.signed_url; else opts.conversationToken = sess.conversation_token;
    if (sess.dynamic) opts.dynamicVariables = sess.dynamic; // { greeting: "Hey Riya, what's up?", context: 'Mode: bro…' }
    V.conv = await Conversation.startSession(opts);
    V.engine = 'eleven'; if (V.state !== 'speaking') V.set('listening');
  };

  // ───────────────────────── realtime (WebRTC) ─────────────────────────
  V.connectRealtime = async function (sess) {
    V.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const pc = new RTCPeerConnection(); V.pc = pc;
    if (!V.audioEl) { V.audioEl = document.createElement('audio'); V.audioEl.autoplay = true; V.audioEl.setAttribute('playsinline', ''); document.body.appendChild(V.audioEl); }
    pc.ontrack = e => { V.audioEl.srcObject = e.streams[0]; };
    V.mic.getTracks().forEach(t => pc.addTrack(t, V.mic));
    const dc = pc.createDataChannel('oai-events'); V.dc = dc;
    dc.onmessage = e => { try { V.onEvent(JSON.parse(e.data)); } catch (err) {} };
    dc.onclose = () => { if (V.state !== 'idle') { V.stop(); toast('Bro hung up'); } };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const r = await fetch('https://api.openai.com/v1/realtime/calls?model=' + encodeURIComponent(sess.model), { method: 'POST', headers: { Authorization: 'Bearer ' + sess.client_secret, 'Content-Type': 'application/sdp' }, body: offer.sdp });
    if (!r.ok) throw new Error('realtime call ' + r.status);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    V.engine = 'realtime'; V.set('live');
    // Say hello first so the user hears the voice immediately.
    const hello = V.lang === 'hi' ? 'Greet the user warmly in Hindi in one short sentence and ask what they need.' : V.persona === 'news' ? 'Greet in one sentence, then call get_news and read the top headlines.' : V.persona === 'language' ? 'Greet in one sentence and start a short spoken lesson.' : 'Greet the user warmly in one short sentence and ask what they need.';
    V.rtSend({ type: 'response.create', response: { instructions: hello } });
  };
  V.rtSend = function (ev) { try { if (V.dc && V.dc.readyState === 'open') V.dc.send(JSON.stringify(ev)); } catch (e) {} };
  V.onEvent = async function (ev) {
    const t = ev.type || '';
    if (t === 'input_audio_buffer.speech_started') { V.set('listening'); }
    else if (t === 'input_audio_buffer.speech_stopped') { V.set('thinking'); }
    else if (t === 'conversation.item.input_audio_transcription.completed') { if (ev.transcript && ev.transcript.trim()) V.push('user', ev.transcript.trim()); }
    else if (t === 'response.output_audio_transcript.delta') { if (V.state !== 'speaking') V.state = 'speaking'; V.partial += ev.delta || ''; const say = document.getElementById('bvSay'); if (say) { say.textContent = V.partial; say.classList.add('partial'); } else V.rerender(); }
    else if (t === 'response.output_audio_transcript.done') { V.push('bro', (ev.transcript || V.partial).trim()); }
    else if (t === 'response.done') { V.set('live'); }
    else if (t === 'response.function_call_arguments.done') {
      let args = {}; try { args = JSON.parse(ev.arguments || '{}'); } catch (e) {}
      const r = await api('/voice/tool', { method: 'POST', body: JSON.stringify({ name: ev.name, args }) });
      V.afterTool(ev.name, args, r && r.result);
      V.rtSend({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify((r && r.result) || { ok: false }) } });
      V.rtSend({ type: 'response.create' });
    }
    else if (t === 'error') { console.warn('[bro rt]', ev.error); }
  };

  // ───────────────────────── fallback (browser STT/TTS) ─────────────────────────
  V.listen = function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (!(V.caps && V.caps.stt)) toast(V.lang === 'hi' ? 'यहाँ आवाज़ से इनपुट नहीं — टाइप करो' : 'Voice input is not supported here — type to Bro instead'); V.set('live'); return; }
    try { speechSynthesis.cancel(); } catch (e) {}
    const rec = new SR(); V.rec = rec;
    rec.lang = V.lang === 'hi' ? 'hi-IN' : V.lang === 'en' ? 'en-IN' : (navigator.language || 'en-IN');
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '';
    rec.onresult = e => { let s = ''; for (let i = e.resultIndex; i < e.results.length; i++) { s += e.results[i][0].transcript; if (e.results[i].isFinal) final += e.results[i][0].transcript; } V.heard = s; const t = document.getElementById('bvfText'); if (t) { t.textContent = s; t.className = 'bvf-text user'; } };
    rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone blocked — allow it in site settings'); };
    rec.onend = () => { V.rec = null; const text = final.trim(); V.heard = ''; if (text) V.send(text); else if (V.state === 'listening') V.set('live'); };
    V.set('listening'); try { rec.start(); } catch (e) { V.set('live'); }
  };
  // Press-and-hold recording → /api/voice/transcribe (OpenAI) when SpeechRecognition is missing (e.g. some iOS / desktop browsers).
  V.holdStart = async function () {
    if (V.engine !== 'fallback' || V.state !== 'live' || V.recd) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const parts = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); V.recd = null;
        const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
        if (blob.size < 2000) { V.set('live'); return; }
        V.set('thinking');
        try {
          const r = await fetch('/api/voice/transcribe?lang=' + (V.lang === 'auto' ? '' : V.lang), { method: 'POST', headers: { 'Content-Type': blob.type, 'x-token': (typeof token !== 'undefined' && token) || '' }, body: blob });
          const j = await r.json(); if (j && j.text) V.send(j.text); else { toast(j && j.error ? j.error : 'Could not hear that'); V.set('live'); }
        } catch (e) { toast('Could not hear that'); V.set('live'); }
      };
      V.recd = rec; rec.start(); V.set('listening');
    } catch (e) { toast('Microphone blocked — allow it in site settings'); }
  };
  V.holdEnd = function () { try { if (V.recd && V.recd.state === 'recording') V.recd.stop(); } catch (e) {} };
  V.speak = async function (text, onEnd) {
    const clean = text.replace(/[*_#`>]/g, '').replace(/https?:\S+/g, '').trim();
    const hi = hasDevanagari(clean);
    V.set('speaking');
    if (!V.noTTS && clean) {
      try {
        const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': (typeof token !== 'undefined' && token) || '' }, body: JSON.stringify({ text: clean, lang: hi ? 'hi' : (V.lang === 'hi' ? 'hi' : 'en') }) });
        if (r.status === 404 || r.status === 501) V.noTTS = true;
        else if (r.ok) {
          const blob = await r.blob(); if (V.state !== 'speaking') return;
          const url = URL.createObjectURL(blob); const a = V.ttsEl();
          await new Promise(resolve => { a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve(); }; a.src = url; a.play().catch(() => resolve()); });
          if (V.state === 'speaking') { V.set('live'); onEnd && onEnd(); }
          return;
        }
      } catch (e) { /* a failed reply stays as text below */ }
      // one voice: when Bro's voice can't reach this reply, the words stay on screen instead of a robotic device voice
      if (!V.noTTS) { if (V.state === 'speaking') { V.set('live'); onEnd && onEnd(); } return; }
    }
    V.speakLocal(clean, hi, onEnd);
  };
  V.speakLocal = function (clean, hi, onEnd) {
    if (!('speechSynthesis' in window)) { V.set('live'); onEnd && onEnd(); return; }
    speechSynthesis.cancel();
    const chunks = clean.match(/[^.!?।\n]+[.!?।\n]*/g) || [clean];
    let i = 0; if (V.state !== 'speaking') V.set('speaking');
    const vs = speechSynthesis.getVoices();
    const pick = vs.find(v => hi ? /hi-IN|hi_IN/i.test(v.lang) : /en-IN/i.test(v.lang) && /natural|neural|google/i.test(v.name)) || vs.find(v => hi ? /^hi/i.test(v.lang) : /^en/i.test(v.lang));
    const next = () => {
      if (V.state !== 'speaking') return;
      if (i >= chunks.length) { V.set('live'); onEnd && onEnd(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]); if (pick) { u.voice = pick; u.lang = pick.lang; } else u.lang = hi ? 'hi-IN' : 'en-IN';
      u.rate = 1; u.pitch = 1; u.onend = next; u.onerror = next; speechSynthesis.speak(u);
    };
    next();
  };

  // ───────────────────────── shared send + tool effects ─────────────────────────
  V.send = async function (text) {
    const inp = document.getElementById('bvInput');
    text = (text || (inp && inp.value) || '').trim(); if (!text || V.state === 'thinking') return;
    if (inp) inp.value = '';
    V.push('user', text);
    if (V.engine === 'eleven' && V.conv) { try { V.conv.sendUserMessage(text); } catch (e) {} return; }
    if (V.engine === 'realtime' && V.dc && V.dc.readyState === 'open') {
      V.rtSend({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      V.rtSend({ type: 'response.create' }); return;
    }
    V.set('thinking');
    const msgs = V.thread.slice(-10).map(m => ({ role: m.role === 'bro' ? 'assistant' : 'user', content: m.text }));
    let r; try { r = await api('/voice/turn', { method: 'POST', body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang, messages: msgs }) }); } catch (e) { r = { error: 'offline' }; }
    // a failed turn: a plain line for everyone (setup details stay in the server log / Admin), and the words come back to the box
    if (!r || r.error) { V.push('bro', V.lang === 'hi' ? 'अभी जवाब नहीं दे पाया — फिर से भेजो?' : 'I couldn’t answer just now — try again?'); V.set(V.engine ? 'live' : 'idle'); const box = document.getElementById('bvInput'); if (box && !box.value) box.value = text; return; }
    (r.actions || []).forEach(a => V.afterTool(a.tool, a.input, a.result));
    V.push('bro', r.reply);
    const wasVoice = V.engine === 'fallback' && V.state !== 'idle';
    if (wasVoice) V.speak(r.reply, () => V.listen()); else V.set(V.engine ? 'live' : 'idle');
  };
  V.afterTool = function (name, input, result) {
    if (!result) return;
    if (result.open) { setTimeout(() => { location.href = result.open; }, 900); return; }
    if (name === 'create_task' || name === 'complete_task') { toast(name === 'create_task' ? '✅ Task added: ' + (input.title || '') : '🎉 Done: ' + (input.title || '')); if (typeof load === 'function') load(); }
    if (name === 'set_reminder') toast('⏰ Reminder set' + (input.time ? ' for ' + input.time : ''));
    if (name === 'create_calendar_event') toast('🗓️ Event added' + (input.date ? ' on ' + input.date : ''));
  };
  // Deep links: /?say=...  and  /?persona=news
  V.boot = function () {
    const q = new URLSearchParams(location.search);
    if (q.get('persona')) V.setPersona(q.get('persona'));
    if (q.get('say')) setTimeout(() => V.send(q.get('say')), 600);
    try { speechSynthesis.getVoices(); } catch (e) {}
  };
})();
