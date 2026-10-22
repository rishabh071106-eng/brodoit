// Talking Bro — Bro chat, the voice-first home screen. Loaded by the SPA as a plain script; uses the SPA globals (S, api,
// token, toast, esc, render, switchTab). One voice behind one UI. Engines, in the order /api/voice/session hands them out:
//  • core: Bro Core (v16). A WebSocket to /api/voice/live: our mic → 16 kHz frames → voice activity detection →
//    the server hears, thinks and streams Bro's own voice back (Int16 24 kHz) sentence by sentence.
//    v17 "Bro listens": half-duplex like a phone call with a person. While Bro's voice plays (and 350 ms after) the mic
//    is not listened to, so Bro never hears himself; you stop him by tapping the orb ("tap to interrupt"). Bro waits for
//    the end of your thought: 1.1 s of silence (1.3 s after a short phrase), and a phrase only counts once ~200 ms of
//    real voice is heard (coughs and clicks never reach the server). Silero VAD gates speech once it has loaded (it
//    starts loading with the call, up to 4 s before Bro's first word). The conversation is in English or हिंदी, the
//    user's choice. Bro chat is just the conversation: no app control, and leaving the Bro tab ends the call.
//  • fallback: browser SpeechRecognition → /api/voice/turn → /api/voice/tts
//  • eleven / realtime: ElevenLabs agent / OpenAI Realtime, only when the server's emergency switch is on
(function () {
  'use strict';
  const storedLang = () => { try { return localStorage.getItem('bro.lang') === 'hi' ? 'hi' : 'en'; } catch (e) { return 'en'; } };
  const V = window.BroVoice = {
    state: 'idle', // idle | connecting | live | listening | thinking | speaking | ended | off
    engine: null,   // 'core' | 'fallback' | 'eleven' | 'realtime'
    persona: 'bro', // Bro chat; ?persona=teacher|language (Learn, language lessons) sets the mode for that visit only
    lang: storedLang(), // en | hi: the conversation language (English | हिंदी)
    course: (() => { try { return localStorage.getItem('bro.course') || 'es'; } catch (e) { return 'es'; } })(),
    thread: [],     // {role:'user'|'bro', text, ts, turn?}
    pc: null, dc: null, mic: null, audioEl: null, rec: null, handsFree: false, partial: '',
    // core engine
    ws: null, ac: null, said: '', turn: 0, dropTurn: -1, turnDone: true, srcs: new Set(), playT: 0, playEnd: 0,
    stats: { frames: 0, scheduled: 0, played: 0, barge: 0, deaf: 0, vad: [], lat: [] }, // read by tests and the console
  };
  try { localStorage.removeItem('bro.persona'); } catch (e) {} // v17: Bro chat has no persona switch
  const PERSONA_LABEL = { bro: ['Bro', 'Bro'], teacher: ['Teacher', 'टीचर'], language: ['Language practice', 'भाषा अभ्यास'] };
  const COURSES = { es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', en: 'English' };
  const hasDevanagari = s => /[ऀ-ॿ]/.test(s || '');
  const ICON = {
    mic: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    stop: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    keys: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10"/></svg>',
  };
  const isLive = () => V.state !== 'idle' && V.state !== 'off' && V.state !== 'ended';
  const coreLive = () => V.engine === 'core' && isLive();
  // one line per state, in the conversation language
  const WORDS = {
    listening: ['Listening…', 'सुन रहा हूँ…'], thinking: ['Thinking…', 'सोच रहा हूँ…'], connecting: ['One sec…', 'एक सेकंड…'],
    speaking: ['Bro is speaking · tap to interrupt', 'Bro बोल रहा है · रोकने के लिए टैप करो'],
  };
  const word = k => (WORDS[k] || ['', ''])[V.lang === 'hi' ? 1 : 0];

  // ───────────────────────── UI ─────────────────────────
  // Bro chat: the orb, one Talk button, the conversation, the compose bar, and one small English | हिंदी switch.
  // Styles in app/home.css.
  const hEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const langSwitch = cls => '<div class="' + cls + '" role="group" aria-label="Language / भाषा">' + [['en', 'English', 'Talk in English'], ['hi', 'हिंदी', 'हिंदी में बात करो']].map(x => '<button type="button" class="' + (V.lang === x[0] ? 'on' : '') + '" aria-pressed="' + (V.lang === x[0]) + '" aria-label="' + x[2] + '" onclick="BroVoice.setLang(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';

  // v23: what Bro wrote down (a plan, a list, a draft): a card with its lines, Copy and Share; it is also in Notes
  const docBody = text => String(text || '').split('\n').map(l => {
    const t = l.trim(); if (!t) return '<div class="bv-doc-gap"></div>';
    const bullet = /^[-•*]\s+/.test(t), body = t.replace(/^[-•*]\s+/, '');
    const tm = /^(\d{1,2}[:.]\d{2}(?:\s*(?:am|pm))?\s*(?:[-–—]|to)\s*\d{1,2}[:.]\d{2}(?:\s*(?:am|pm))?|\d{1,2}[:.]\d{2}(?:\s*(?:am|pm))?)\s*[:\-–—]?\s*(.*)$/i.exec(body);
    if (tm) return '<div class="bv-doc-l tm"><b>' + hEsc(tm[1]) + '</b><span>' + hEsc(tm[2]) + '</span></div>';
    return '<div class="bv-doc-l' + (bullet ? ' bl' : '') + '">' + hEsc(body) + '</div>';
  }).join('');
  const docCard = (d, hi) => { const k = V.docs.indexOf(d); return '<div class="bv-msg bro"><div class="bv-doc"><div class="bv-doc-h"><span aria-hidden="true">📝</span><b>' + hEsc(d.title) + '</b></div><div class="bv-doc-b">' + docBody(d.text) + '</div>' +
    '<div class="bv-doc-f"><span>' + (hi ? 'नोट्स में सेव' : 'Saved in Notes') + '</span><button type="button" onclick="BroVoice.copyDoc(' + k + ')">' + (hi ? 'कॉपी' : 'Copy') + '</button>' + (navigator.share ? '<button type="button" onclick="BroVoice.shareDoc(' + k + ')">' + (hi ? 'शेयर' : 'Share') + '</button>' : '') + '</div></div></div>'; };
  V.docs = [];
  V.showDoc = function (doc) {
    if (!doc || !doc.text) return;
    const d = { title: String(doc.title || 'From Bro').slice(0, 80), text: String(doc.text).slice(0, 4000), at: Date.now() };
    V.docs.push(d); if (V.docs.length > 30) V.docs.shift();
    V.thread.push({ role: 'bro', text: d.title, doc: d, ts: Date.now() }); if (V.thread.length > 60) V.thread.shift();
    V.lastDoc = d;
    try { // kept in Notes on this phone ("From Bro")
      if (window.S && Array.isArray(S.notes)) { const at = new Date().toISOString(); S.notes.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), category: 'bro', title: d.title, content: d.text, drawing: null, voiceUrl: null, transcript: '', created: at, updated: at }); localStorage.setItem('tf_notes', JSON.stringify(S.notes)); }
    } catch (e) { /* storage full or private mode: the card still shows */ }
    V.rerender();
  };
  V.copyDoc = function (k) { const d = V.docs[k]; if (!d) return; const t = d.title + '\n\n' + d.text; (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(V.lang === 'hi' ? 'कॉपी हो गया' : 'Copied'), () => {}); };
  V.shareDoc = function (k) { const d = V.docs[k]; if (!d || !navigator.share) return; navigator.share({ title: d.title, text: d.title + '\n\n' + d.text }).catch(() => {}); };
  V.closeDoc = function () { V.lastDoc = null; V.renderFull(); };

  V.html = function () {
    const hi = V.lang === 'hi';
    const live = isLive();
    let line = '';
    if (V.state === 'connecting') line = word('connecting');
    else if (V.state === 'thinking') line = word('thinking');
    else if (V.partial) line = V.partial;
    else if (V.state === 'speaking') line = V.said || word('speaking');
    else if (live) line = word('listening');
    else if (V.persona === 'teacher') line = hi ? 'टीचर मोड · बोलकर पूछो' : 'Teacher mode · tap to talk';
    else if (V.persona === 'language') line = (hi ? 'भाषा अभ्यास · ' : 'Practise ') + (COURSES[V.course] || 'Spanish');
    const chat = V.thread.length > 0;
    const art = '<span class="hb-orbw" aria-hidden="true"><span class="hb-shade"></span><span class="hb-orb st-' + V.state + '"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span></span>';
    let h = '<div class="bh' + (hi ? ' hi' : '') + (chat ? ' chat' : '') + (live ? ' live' : '') + '">';
    h += '<div class="hb-top">' + langSwitch('hb-langs') + '</div>';
    h += '<section class="hb-stage" aria-label="Bro"><button type="button" class="hb-bro" onclick="BroVoice.tapOrb()" aria-label="' + (live ? (hi ? 'Bro को रोको' : 'Interrupt Bro') : (hi ? 'Bro से बात करो' : 'Talk to Bro')) + '">' + art + '</button>';
    h += '<p class="hb-say' + (V.partial ? ' partial' : '') + '" id="bvSay" aria-live="polite">' + hEsc(line) + '</p>';
    h += '<button type="button" class="hb-mic' + (live ? ' on' : '') + '" id="bvTalk" onclick="' + (live ? 'BroVoice.hangUp()' : 'BroVoice.tapOrb()') + '" aria-label="' + (live ? (hi ? 'कॉल खत्म करो' : 'End the call') : (hi ? 'बात करो' : 'Talk')) + '">' + (live ? ICON.stop : ICON.mic) + '</button></section>';
    if (chat) {
      h += '<div class="hb-thread" id="bvThread">';
      V.thread.slice(-8).forEach(m => { h += m.doc ? docCard(m.doc, hi) : '<div class="bv-msg ' + m.role + '"><div class="bv-bub">' + hEsc(m.text) + '</div></div>'; });
      h += '</div>';
    }
    h += '<form class="hb-compose" onsubmit="event.preventDefault();BroVoice.send()"><input id="bvInput" placeholder="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '" autocomplete="off" enterkeyhint="send" aria-label="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '"><button type="submit" class="hb-send"' + (V.state === 'thinking' && V.engine !== 'core' ? ' disabled' : '') + ' aria-label="' + (hi ? 'भेजो' : 'Send') + '">' + (window.ico ? ico('arrow-up', 20) : ICON.send) + '</button></form>';
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
  V.set = function (st) { if (V.engine === 'core' && V.state === st) return; V.state = st; V.rerender(); };
  V.push = function (role, text) { if (!text) return; V.thread.push({ role, text, ts: Date.now() }); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; V.rerender(); };
  // deep links only (Learn → teacher, language lessons → language practice): never a switch on Bro's screen
  V.setPersona = function (k) { k = k === 'news' ? 'bro' : k; if (!PERSONA_LABEL[k]) return; V.persona = k; V.rerender(); };
  // English | हिंदी. During a live call the server switches at once (no reconnect); other engines restart.
  V.setLang = function (l, fromApp) {
    l = l === 'hi' ? 'hi' : 'en'; if (V.lang === l) return;
    V.lang = l; try { localStorage.setItem('bro.lang', l); } catch (e) {}
    if (!fromApp && window.setAppLang) setAppLang(l, 'bro'); // v24: one language for the whole app
    if (coreLive() && V.ws && V.ws.readyState === 1) { V.wsSend({ t: 'lang', lang: l }); V.rerender(); return; }
    V.rerender(); if (isLive()) { V.stop(true); V.start(); }
  };
  V.setCourse = function (c) { if (!COURSES[c]) return; V.course = c; try { localStorage.setItem('bro.course', c); } catch (e) {} V.rerender(); };
  // tap the orb: start a call; while Bro speaks (or thinks) it stops him and listens; otherwise it shows the call screen
  V.tapOrb = function () {
    V.unlockAudio();
    if (!isLive()) { V.start(); return; }
    if (V.engine === 'core') { if (V.broAudible() || V.state === 'speaking' || V.state === 'thinking') V.interrupt(); else if (!document.getElementById('bvFull')) V.openFull(); return; }
    if (V.engine === 'fallback' && V.state === 'live') V.listen(); else V.stop();
  };
  V.engineLabel = () => V.engine === 'core' ? 'Bro Core' : V.engine === 'eleven' ? 'ElevenLabs' : V.engine === 'realtime' ? 'OpenAI Realtime' : V.engine === 'fallback' ? (V.noTTS ? 'Device voice' : 'Studio voice') : '';
  // Audio playback must be unlocked by a user gesture on mobile: play a silent clip on the first tap.
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  V.ttsEl = function () { if (!V.tts) { V.tts = document.createElement('audio'); V.tts.setAttribute('playsinline', ''); V.tts.preload = 'auto'; document.body.appendChild(V.tts); } return V.tts; };
  V.unlockAudio = function () { try { const a = V.ttsEl(); if (!V.unlocked) { a.src = SILENT; a.play().then(() => { V.unlocked = true; }).catch(() => {}); } } catch (e) {} };

  // ───────────────────────── full-screen call ─────────────────────────
  // when Bro isn't in his own voice, say why in a few words
  const WHY = {
    credits: ['ElevenLabs credits are used up · phone voice', 'ElevenLabs क्रेडिट खत्म · फ़ोन की आवाज़'],
    connect: ['Voice service unreachable · phone voice', 'वॉइस सर्विस नहीं मिली · फ़ोन की आवाज़'],
    agent: ['Voice agent unavailable · phone voice', 'वॉइस एजेंट उपलब्ध नहीं · फ़ोन की आवाज़'],
    nokey: ['No voice key set · phone voice', 'वॉइस की नहीं · फ़ोन की आवाज़'],
    mic: ['Microphone is blocked · allow it, or type to Bro', 'माइक बंद है · इजाज़त दो या लिखकर बात करो'],
    live: ['Bro’s live line didn’t connect · simple mode', 'Bro की लाइव लाइन नहीं जुड़ी · सादा मोड'],
    voice: ['Bro’s voice is warming up · phone voice for now', 'Bro की आवाज़ तैयार हो रही है · अभी फ़ोन की आवाज़'],
    limit: ['Lots of calls this hour · simple mode', 'इस घंटे बहुत कॉल · सादा मोड'],
  };
  V.fullHtml = function () {
    const hi = V.lang === 'hi'; const live = isLive();
    if (V.state === 'ended') return V.endHtml();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const core = V.engine === 'core';
    const lastUser = V.thread.slice().reverse().find(m => m.role === 'user'); const lastBro = V.thread.slice().reverse().find(m => m.role === 'bro');
    // one clear state at a time; while Bro speaks the state line is the interrupt control
    const st = V.state === 'live' ? 'listening' : V.state;
    const cap = st === 'speaking' && core
      ? '<button type="button" class="bvf-cap bvf-int' + (hi ? ' dev' : '') + '" id="bvfCap" onclick="BroVoice.interrupt()">' + esc(word('speaking')) + '</button>'
      : '<div class="bvf-cap' + (hi ? ' dev' : '') + '" id="bvfCap" aria-live="polite">' + esc(st === 'connecting' ? word('connecting') : st === 'thinking' ? word('thinking') : st === 'listening' ? word('listening') : '') + '</div>';
    let line = '', cls = '';
    if (core) { line = st === 'speaking' || (V.state === 'listening' && V.said) ? V.said : ''; cls = 'bro'; }
    else if (V.partial) { line = V.partial; cls = 'bro'; }
    else if (V.state === 'listening') { line = V.heard || ''; cls = 'user'; }
    else if (V.state === 'thinking') { line = lastUser ? lastUser.text : ''; cls = 'user'; }
    else if (lastBro && (V.state === 'speaking' || V.state === 'live')) { line = lastBro.text; cls = 'bro'; }
    const why = V.why && WHY[V.why] ? WHY[V.why][hi ? 1 : 0] : '';
    const hint = !live ? '' : core && V.closerUntil > Date.now() ? (hi ? 'थोड़ा पास आकर बोलो' : 'Speak a little closer') : V.engine === 'fallback' && (V.noTTS || V.fromCore) ? (why || WHY.credits[hi ? 1 : 0]) : core && V.noVoice ? WHY.voice[hi ? 1 : 0]
      : V.engine === 'fallback' && V.state === 'live' ? (SR ? (hi ? 'बोलने के लिए टैप करो' : 'Tap the circle to speak') : (hi ? 'बोलते समय दबाए रखो' : 'Hold the circle while you speak')) : '';
    // captions (core): the last thing you said, small, above what Bro is saying now
    const heardLine = core && lastUser ? '<div class="bvf-heard" id="bvfHeard">' + esc(lastUser.text) + '</div>' : '';
    const typeRow = core && V.typing ? '<form class="bvf-type" onsubmit="event.preventDefault();BroVoice.send(document.getElementById(\'bvfInput\').value)"><input id="bvfInput" placeholder="' + (hi ? 'Bro को लिखो' : 'Type to Bro') + '" autocomplete="off" enterkeyhint="send" aria-label="' + (hi ? 'Bro को लिखो' : 'Type to Bro') + '"><button type="submit" aria-label="' + (hi ? 'भेजो' : 'Send') + '">' + ICON.send + '</button></form>' : '';
    const keys = core ? '<button class="bvf-kb' + (V.typing ? ' on' : '') + '" onclick="BroVoice.toggleType()" aria-label="' + (hi ? 'लिखकर बोलो' : 'Type instead') + '">' + ICON.keys + '</button>' : '';
    const mode = V.persona !== 'bro' ? '<span class="bvf-mode">' + esc((PERSONA_LABEL[V.persona] || PERSONA_LABEL.bro)[hi ? 1 : 0]) + '</span>' : '';
    return '<div class="bvf-top' + (mode ? '' : ' solo') + '">' + langSwitch('bvf-langs') + mode + '</div>' +
      '<div class="bvf-stage"><button class="bv-orb st-' + st + '" id="bvfOrb" ' + ((!SR && V.engine === 'fallback' && V.caps && V.caps.stt) ? 'onpointerdown="BroVoice.holdStart()" onpointerup="BroVoice.holdEnd()" onpointercancel="BroVoice.holdEnd()" onpointerleave="BroVoice.holdEnd()"' : 'onclick="BroVoice.tapOrb()"') + ' aria-label="' + (st === 'speaking' ? (hi ? 'Bro को रोको' : 'Interrupt Bro') : 'Bro') + '"><span class="bv-ring r1"></span><span class="bv-ring r2"></span><span class="hb-orb st-' + st + (core ? ' drv' : '') + '"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span></button>' + cap + heardLine + '<div class="bvf-text ' + cls + '" id="bvfText" aria-live="polite">' + esc(line) + '</div></div>' +
      docPanel(hi) +
      '<div class="bvf-bar">' + typeRow + '<div class="bvf-hint">' + esc(hint) + '</div><div class="bvf-row">' + keys + '<button class="bvf-end" onclick="BroVoice.hangUp()">' + ICON.stop + (hi ? ' बंद करो' : ' End') + '</button></div></div>';
  };
  // v23: during a call, what Bro just wrote down stays on screen (and in the chat and Notes afterwards)
  const docPanel = hi => { const d = V.lastDoc; if (!d || Date.now() - d.at > 20 * 60e3) return '';
    return '<div class="bvf-doc" role="region" aria-label="' + hEsc(d.title) + '"><div class="bv-doc-h"><span aria-hidden="true">📝</span><b>' + hEsc(d.title) + '</b><button type="button" class="bvf-doc-x" onclick="BroVoice.closeDoc()" aria-label="' + (hi ? 'बंद करो' : 'Close') + '">✕</button></div><div class="bv-doc-b">' + docBody(d.text) + '</div><div class="bv-doc-f"><span>' + (hi ? 'नोट्स में सेव' : 'Saved in Notes') + '</span></div></div>'; };
  // the end screen: one question, two answers; the answer travels with the goodbye
  V.endHtml = function () {
    const hi = V.lang === 'hi', E = V.endInfo || {}, secs = Math.max(0, Math.round(((E.at || Date.now()) - (E.started || Date.now())) / 1000));
    const dur = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    const rated = E.rated;
    return '<div class="bvf-top"><span class="bvf-mode">' + (hi ? 'कॉल खत्म · ' : 'Call ended · ') + dur + '</span><button class="bvf-x" onclick="BroVoice.closeEnd()" aria-label="' + (hi ? 'बंद करो' : 'Close') + '">' + (window.ico ? ico('x', 22) : '✕') + '</button></div>' +
      '<div class="bvf-stage"><span class="hb-orb st-idle bvf-endorb" aria-hidden="true"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span>' +
      (rated ? '<div class="bvf-ask">' + (hi ? 'शुक्रिया!' : 'Thanks!') + '</div>' :
        '<div class="bvf-ask" id="bvfAsk">' + (hi ? 'Bro कैसा रहा?' : 'How was Bro?') + '</div><div class="bvf-rate" role="group" aria-labelledby="bvfAsk"><button type="button" onclick="BroVoice.rate(\'up\')" aria-label="' + (hi ? 'अच्छा' : 'Good') + '">👍</button><button type="button" onclick="BroVoice.rate(\'down\')" aria-label="' + (hi ? 'अच्छा नहीं' : 'Not good') + '">👎</button></div>') +
      '</div><div class="bvf-bar"><button class="bvf-end bvf-done" onclick="BroVoice.closeEnd()">' + (hi ? 'ठीक है' : 'Done') + '</button></div>';
  };
  V.openFull = function () { let el = document.getElementById('bvFull'); if (!el) { el = document.createElement('div'); el.id = 'bvFull'; el.className = 'bvf'; document.body.appendChild(el); document.documentElement.classList.add('bvf-open'); } el.innerHTML = V.fullHtml(); };
  V.closeFull = function () { const el = document.getElementById('bvFull'); if (el) el.remove(); document.documentElement.classList.remove('bvf-open'); };
  V.renderFull = function () {
    const el = document.getElementById('bvFull'); if (!el) return;
    const inp = document.getElementById('bvfInput'), had = inp && document.activeElement === inp, val = inp && inp.value;
    el.innerHTML = V.fullHtml();
    if (inp) { const n = document.getElementById('bvfInput'); if (n) { n.value = val || ''; if (had) n.focus(); } }
  };
  V.say = function (text) { V.send(text); };
  V.toggleType = function () { V.typing = !V.typing; V.renderFull(); const n = document.getElementById('bvfInput'); if (n) n.focus(); };
  // switchTab() tells us first. Bro chat lives on the Bro tab: leaving it ends the call politely (bye, no end screen).
  V.onTab = function (t) {
    if (t === 'bro' || t === 'home') return;
    if (V.state === 'ended') V.closeEnd();
    else if (isLive() || V.state === 'connecting') V.stop(true);
    V.persona = 'bro';
  };

  // ───────────────────────── session ─────────────────────────
  V.start = async function (opts) {
    if (V.state === 'connecting') return;
    opts = opts || {};
    V.heard = ''; V.said = ''; V.why = ''; V.fromCore = false; V.noVoice = false; V.endInfo = null; V.closeFull();
    V.set('connecting'); V.openFull();
    try { V.prepAudio(); } catch (e) {} // inside the tap: mobile browsers only let audio start from a gesture
    const body = { persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang };
    let sess;
    try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify(body) }); } catch (e) { sess = { mode: 'fallback' }; }
    if (V.state !== 'connecting') return; // ended while we waited
    if (sess && sess.mode === 'core') {
      try { await V.connectCore(sess, opts); return; }
      catch (e) {
        if (e && e.why === 'gone') { if (V.state !== 'connecting') V.coreCleanup(true); return; } // the user left while it connected: release the mic
        console.warn('[bro] live call failed, simple mode', e);
        V.coreCleanup(); V.fromCore = true; V.why = (e && e.why) || 'live';
        try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify(Object.assign({ engine: 'classic' }, body)) }); } catch (e2) { sess = { mode: 'fallback' }; }
        const why = V.why; if (sess) sess.why = why;
      }
    }
    if (V.state !== 'connecting') return;
    if (sess && sess.mode === 'eleven') {
      try { await V.connectEleven(sess); return; } catch (e) { console.warn('[bro] elevenlabs failed, next engine', e); V.why = 'connect'; try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify(Object.assign({ engine: 'classic' }, body)) }); } catch (e2) { sess = { mode: 'fallback' }; } }
    }
    if (sess && sess.mode === 'realtime') {
      try { await V.connectRealtime(sess); return; } catch (e) { console.warn('[bro] realtime failed, falling back', e); }
    }
    V.caps = (sess && sess.caps) || {}; if (V.caps.tts === false) V.noTTS = true;
    if (sess && sess.why) V.why = sess.why;
    V.engine = 'fallback'; V.set('live');
    if (opts.context) { V.send(opts.ask || opts.context); return; }
    if (V.why !== 'mic') V.listen();
  };
  // End = the end screen with the rating for a core call; everything else stops at once
  V.hangUp = function () { if (V.engine === 'core' && (isLive() || V.ws)) V.endCore(); else V.stop(); };
  V.stop = function (silent) {
    if (V.engine === 'core' || V.ws) V.coreCleanup(true);
    if (V.pendingOpen) { const u = V.pendingOpen; V.pendingOpen = null; setTimeout(() => { if (window.BroFrame) BroFrame.go(u); else location.href = u; }, 400); } // a lesson or screen Bro opened on the call
    try { if (V.conv) { const c = V.conv; V.conv = null; c.endSession().catch(() => {}); } } catch (e) {} V.conv = null;
    try { if (V.dc) V.dc.close(); } catch (e) {}
    try { if (V.pc) V.pc.close(); } catch (e) {}
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { if (V.rec) { V.rec.onend = null; V.rec.stop(); } } catch (e) {}
    try { speechSynthesis.cancel(); } catch (e) {}
    try { if (V.tts) { V.tts.pause(); V.tts.onended = null; } } catch (e) {}
    try { if (V.recd) { V.recd.onstop = null; V.recd.stop(); V.recd.stream.getTracks().forEach(t => t.stop()); } } catch (e) {} V.recd = null;
    V.pc = V.dc = V.mic = V.rec = null; V.handsFree = false; V.partial = ''; V.heard = ''; V.said = ''; V.typing = false;
    V.closeFull(); V.state = 'idle'; V.engine = null; V.rerender();
  };

  // ───────────────────────── core: Bro Core over a WebSocket ─────────────────────────
  // Mic → AudioWorklet (16 kHz Int16 frames of 32 ms, with level and pitch) → VAD → the socket.
  // Socket → Int16 24 kHz frames → a gapless Web Audio queue → speaker (and an analyser that moves the orb).
  const FRAME_MS = 32;
  const WORKLET = `
class BroMic extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / 16000; this.t = 0; this.prev = 0; this.buf = new Float32Array(512); this.n = 0; }
  emit() {
    const b = this.buf, n = b.length; let s = 0; for (let i = 0; i < n; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / n), db = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    let f0 = 0;
    if (db > -55) { // pitch: normalised autocorrelation, 70–400 Hz
      let best = 0, lag = 0; const r0 = s;
      for (let L = 40; L <= 228; L++) { let r = 0; for (let i = 0; i + L < n; i++) r += b[i] * b[i + L]; r /= r0; if (r > best) { best = r; lag = L; } }
      if (best > 0.5 && lag > 40 && lag < 228) f0 = 16000 / lag;
    }
    const pcm = new Int16Array(n); for (let i = 0; i < n; i++) { const v = b[i] < -1 ? -1 : b[i] > 1 ? 1 : b[i]; pcm[i] = v * 32767; }
    this.port.postMessage({ pcm: pcm.buffer, db, f0 }, [pcm.buffer]); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    const L = ch.length; let t = this.t;
    while (t < L - 1) { const i = Math.floor(t), f = t - i, a = i < 0 ? this.prev : ch[i], b = ch[i + 1]; this.buf[this.n++] = a + (b - a) * f; if (this.n === 512) this.emit(); t += this.step; }
    this.prev = ch[L - 1]; this.t = t - L;
    return true;
  }
}
registerProcessor('bro-mic', BroMic);`;
  V.prepAudio = function () {
    if (!V.ac || V.ac.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC({ latencyHint: 'interactive' });
      V.outGain = V.ac.createGain(); V.analyser = V.ac.createAnalyser(); V.analyser.fftSize = 512;
      V.outGain.connect(V.analyser); V.analyser.connect(V.ac.destination); V.workletReady = null;
    }
    try { V.ac.resume(); } catch (e) {}
    return V.ac;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  V.connectCore = async function (sess, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const gone = () => { if (V.state !== 'connecting') throw Object.assign(new Error('left'), { why: 'gone' }); };
    // 0. Silero starts loading now, alongside the mic and the socket (Bro's first word waits for it, at most ~4 s)
    if (V.sil && V.sil.error) V.sil = null;
    const silP = V.loadSilero();
    // 1. the mic (a refusal → simple mode with the reason on screen)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no mic api'), { why: 'mic' });
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {} // Safari: a call, not music (echo cancelling, loudspeaker)
    try { V.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { throw Object.assign(new Error('mic: ' + (e && e.name)), { why: 'mic' }); }
    gone();
    const ac = V.prepAudio(); try { await ac.resume(); } catch (e) {}
    if (!ac.audioWorklet) throw Object.assign(new Error('no audio worklet'), { why: 'live' });
    if (!V.workletReady) { const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })); V.workletReady = ac.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)); }
    await V.workletReady; gone();
    const src = ac.createMediaStreamSource(V.mic), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const node = new AudioWorkletNode(ac, 'bro-mic'), mute = ac.createGain(); mute.gain.value = 0;
    src.connect(lp); lp.connect(node); node.connect(mute); mute.connect(ac.destination);
    V.micNodes = [src, lp, node, mute];
    V.vadReset();
    node.port.onmessage = e => V.onFrame(e.data);
    // 2. the socket
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (sess.ws || '/api/voice/live'));
    ws.binaryType = 'arraybuffer'; V.ws = ws; V.wsClosing = false;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(Object.assign(new Error('socket timeout'), { why: 'live' })), 8000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(Object.assign(new Error('socket error'), { why: 'live' })); };
    });
    ws.onmessage = V.onWs; ws.onclose = V.onWsClose; ws.onerror = () => {};
    // 3. Silero ready (or 4 s gone: the energy detector covers until it is)
    await Promise.race([silP, sleep(Math.max(0, 4000 - (Date.now() - t0)))]); gone();
    const ready = new Promise((res, rej) => { V._ready = res; V._readyFail = rej; setTimeout(() => rej(Object.assign(new Error('no ready'), { why: 'live' })), 8000); });
    V.wsSend({ t: 'hello', token: sess.token, lang: V.lang, persona: V.persona, course: V.persona === 'language' ? COURSES[V.course] : '', greet: opts.greet !== false && !opts.context, context: opts.context || '' });
    const r = await ready; V._ready = V._readyFail = null; gone();
    V.engine = 'core'; V.callStarted = Date.now(); V.noVoice = r && r.voice === false;
    V.turnDone = true; V.dropTurn = -1; V.thinkingSince = 0;
    V.set('listening'); V.orbLoop(); V.keepAwake(true);
    console.log('[bro] live call · Bro Core · ' + (V.lang === 'hi' ? 'हिंदी' : 'English') + ' · ' + (V.sil && V.sil.ok ? 'Silero VAD' : 'energy VAD'));
  };
  V.wsSend = function (o) { try { if (V.ws && V.ws.readyState === 1) V.ws.send(typeof o === 'string' || o instanceof ArrayBuffer ? o : JSON.stringify(o)); } catch (e) {} };
  // tear down the mic, the socket and playback; bye (with the rating) goes first when asked
  V.coreCleanup = function (bye, rating) {
    if (bye && V.ws && V.ws.readyState === 1) { V.wsSend(rating ? { t: 'bye', rating } : { t: 'bye' }); }
    if (V.ws) { V.wsClosing = true; const w = V.ws; V.ws = null; setTimeout(() => { try { w.close(1000); } catch (e) {} }, bye ? 150 : 0); }
    try { (V.micNodes || []).forEach(n => { try { n.disconnect(); } catch (e) {} }); if (V.micNodes && V.micNodes[2]) V.micNodes[2].port.onmessage = null; } catch (e) {} V.micNodes = null;
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {} V.mic = null;
    V.stopPlayback(); V.stopLocal(); V.keepAwake(false); V.vadReset();
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) {}
    if (V._readyFail) { const f = V._readyFail; V._ready = V._readyFail = null; f(Object.assign(new Error('closed'), { why: 'live' })); }
  };
  V.endCore = function () {
    V.endInfo = { started: V.callStarted || Date.now(), at: Date.now(), rated: null };
    // the mic and Bro stop now; the socket waits for the rating (or Done / 20 s) to say goodbye
    try { (V.micNodes || []).forEach(n => { try { n.disconnect(); } catch (e) {} }); } catch (e) {} V.micNodes = null;
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {} V.mic = null;
    V.stopPlayback(); V.stopLocal(); V.wsSend({ t: 'cancel' }); V.keepAwake(false);
    V.state = 'ended'; V.openFull(); V.rerender();
    clearTimeout(V._endT); V._endT = setTimeout(() => { if (V.state === 'ended') V.closeEnd(); }, 20000);
  };
  V.rate = function (r) {
    if (!V.endInfo || V.endInfo.rated) return;
    V.endInfo.rated = r; V.stats.rating = r;
    V.coreCleanup(true, r); V.renderFull();
    try { if (window.haptic) haptic('light'); } catch (e) {}
    setTimeout(() => { if (V.state === 'ended') V.closeEnd(); }, 900);
  };
  V.closeEnd = function () { clearTimeout(V._endT); if (V.ws) V.coreCleanup(true); V.endInfo = null; V.closeFull(); V.state = 'idle'; V.engine = null; V.persona = 'bro'; V.rerender(); };
  V.onWsClose = function () {
    if (V.wsClosing || !V.ws) return;
    V.ws = null;
    if (V.state === 'ended') return;
    if (V._readyFail) { const f = V._readyFail; V._ready = V._readyFail = null; f(Object.assign(new Error('closed'), { why: V._why || 'live' })); return; }
    if (coreLive()) { const hi = V.lang === 'hi'; V.coreCleanup(false); V.stop(true); toast(V._why === 'max_call' ? (hi ? '15 मिनट हो गए — फिर से कॉल करो' : '15 minutes up — call Bro again any time') : (hi ? 'Bro की लाइन कट गई' : 'Bro hung up')); }
  };
  V.onWs = function (e) {
    if (typeof e.data !== 'string') { // one binary audio frame, right after its {t:'audio'} header
      const h = V._hdr; V._hdr = null;
      if (!h || h.turn === V.dropTurn || !coreLive()) return;
      V.playFrame(e.data, h); return;
    }
    let m = null; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (!m) return;
    switch (m.t) {
      case 'ready': if (V._ready) V._ready(m); break;
      case 'state':
        if (m.s === 'thinking') { V.turn = m.turn; V.turnDone = false; if (!V.vad.inUtt) V.set('thinking'); }
        else if (m.s === 'speaking') { if (m.turn !== V.dropTurn && !V.vad.inUtt) V.set('speaking'); }
        else if (m.s === 'listening') { V.turnDone = true; V.checkDrain(); }
        break;
      case 'heard': if (m.text) { V.push('user', m.text); V.said = ''; } break;
      case 'say':
        if (m.turn === V.dropTurn) break;
        if (V.vad.inUtt) { V.dropTurn = m.turn; break; } // the user is talking: this reply is being replaced
        // the caption shows the sentence Bro is saying now: at once when nothing plays, else when its audio starts
        if (m.noaudio || !V.srcs.size) { V._capWait = null; V.said = m.text; } else V._capWait = m.text;
        V.pushBro(m.text, m.turn);
        if (m.noaudio) { V.noVoice = true; V.speakLine(m.text, m.lang); }
        break;
      case 'audio': V._hdr = m; break;
      case 'lang': // the user asked Bro, in their own words, to switch: the English | हिंदी switch follows
        if (m.lang === 'en' || m.lang === 'hi') { V.lang = m.lang; try { localStorage.setItem('bro.lang', m.lang); } catch (err) {} if (window.setAppLang) setAppLang(m.lang, 'bro'); V.rerender(); }
        break;
      case 'tool': V.wsSend({ t: 'tool_result', id: m.id, result: { error: 'unknown tool' } }); break; // no client tools
      case 'action': V.afterTool(m.tool, m.input || {}, m.result); break; // v20: Bro did something in the app on the call (a toast, the list, a screen)
      case 'error':
        if (m.why === 'slow_down' || m.why === 'daily_limit' || m.why === 'bad') { V.onSkipped(m.why); break; } // the call goes on
        V._why = m.why;
        if (m.why === 'utterance_max' && V.vad.inUtt) V.uttEnd(true);
        else if (m.why === 'max_call') toast(V.lang === 'hi' ? '15 मिनट की कॉल पूरी' : 'That’s the 15-minute limit for one call');
        else if (V._readyFail && /auth|expired|used|busy|hello/.test(m.why || '')) { const f = V._readyFail; V._ready = V._readyFail = null; f(Object.assign(new Error('refused: ' + m.why), { why: m.why === 'busy' ? 'limit' : 'live' })); }
        break;
    }
  };
  // The server skipped a turn (slow_down: too many this minute, or typed too fast; daily_limit: today's turns are used
  // up). It answers an utterance's end or typed text, so: stop waiting for a reply, say so briefly.
  V.onSkipped = function (why) {
    if (why === 'bad') return;
    V.turnDone = true; V.checkDrain();
    const hi = V.lang === 'hi', now = Date.now();
    if (why === 'daily_limit') toast(hi ? 'आज के लिए बहुत बात हो गई — Bro कल फिर मिलेगा' : 'That’s a lot of talking for today — Bro is back tomorrow');
    else if (now - (V._slowT || 0) > 15000) { V._slowT = now; toast(hi ? 'एक-एक करके — फिर से बोलो?' : 'One at a time — say that again?'); }
  };
  // Bro's sentences of one turn grow one bubble
  V.pushBro = function (text, turn) {
    const last = V.thread[V.thread.length - 1];
    if (last && last.role === 'bro' && last.turn === turn && turn != null) { last.text += ' ' + text; V.partial = ''; V.rerender(); return; }
    V.thread.push({ role: 'bro', text, ts: Date.now(), turn }); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; V.rerender();
  };

  // ── playback: frames are scheduled back to back on the AudioContext clock (gapless); a tap stops them all
  V.playFrame = function (buf, h) {
    const ac = V.ac; if (!ac) return;
    if (V.vad.inUtt) { V.dropTurn = h ? h.turn : V.turn; return; } // never talk over the user: this turn is being replaced
    const i16 = new Int16Array(buf), n = i16.length; if (!n) return;
    const ab = ac.createBuffer(1, n, 24000), ch = ab.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = i16[i] / 32768;
    const src = ac.createBufferSource(); src.buffer = ab; src.connect(V.outGain);
    const now = ac.currentTime;
    if (!V.srcs.size || V.playT < now + 0.02) V.playT = now + 0.05; // first frame (or after a gap): a small lead
    if (V._capWait) { const t = V._capWait, turn = h && h.turn; V._capWait = null; V._capTs = (V._capTs || []).concat([setTimeout(() => { if (coreLive() && turn !== V.dropTurn && V.said !== t) { V.said = t; V.renderFull(); } }, Math.max(0, (V.playT - now) * 1000))]).slice(-60); }
    src.start(V.playT); V.playT += ab.duration; V.playEnd = V.playT;
    V.srcs.add(src); V.stats.scheduled++; V.stats.frames++;
    src.onended = () => { V.srcs.delete(src); V.stats.played++; V.checkDrain(); };
    if (V.lastEnd && h && h.turn !== V._latTurn) { V._latTurn = h.turn; const ms = Math.round(performance.now() - V.lastEnd); if (ms < 20000) { V.stats.lat.push(ms); if (V.stats.lat.length > 50) V.stats.lat.shift(); } V.lastEnd = 0; }
    if (V.state !== 'speaking') V.set('speaking');
  };
  V.stopPlayback = function () { V.srcs.forEach(s => { s.onended = null; try { s.stop(); } catch (e) {} }); V.srcs.clear(); V.playT = 0; V._hdr = null; V._capWait = null; (V._capTs || []).forEach(clearTimeout); V._capTs = []; if (V.playEnd && V.ac) V.playEnd = Math.min(V.playEnd, V.ac.currentTime); };
  // half-duplex: Bro is audible while his audio plays and for 350 ms after the last scheduled sample has left the
  // speaker (the room's tail), counted from the device's output latency on (Bluetooth adds 0.1–0.3 s)
  const TAIL_S = 0.35;
  V.broAudible = function () { if (V.srcs.size || V.localN) return true; const ac = V.ac; return !!(ac && V.playEnd && ac.currentTime < V.playEnd + TAIL_S + Math.min(0.5, ac.outputLatency || 0)); };
  // device voice for a line Bro's own voice couldn't speak
  V.speakLine = function (text, lang) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'hi' || hasDevanagari(text) ? 'hi-IN' : 'en-IN';
    V.localN = (V.localN || 0) + 1; u.onend = u.onerror = () => { V.localN = Math.max(0, (V.localN || 1) - 1); if (!V.localN && V.ac) V.playEnd = V.ac.currentTime; V.checkDrain(); };
    if (!V.vad.inUtt) V.set('speaking'); speechSynthesis.speak(u);
  };
  V.stopLocal = function () { if (V.localN) { V.localN = 0; try { speechSynthesis.cancel(); } catch (e) {} if (V.ac) V.playEnd = V.ac.currentTime; } };
  // the turn is over and the last frame has played: back to listening
  V.checkDrain = function () {
    if (V.engine !== 'core' || V.srcs.size || V.localN) return;
    // v23: Bro said "let me think" and is still working (writing a plan, adding events): after 1.2 s of quiet the screen
    // says "Thinking…" instead of a stale "speaking"; his next words switch it back (playFrame)
    if (!V.turnDone) { clearTimeout(V._thinkT); V._thinkT = setTimeout(() => { if (coreLive() && !V.turnDone && !V.srcs.size && !V.localN && V.state === 'speaking' && !V.vad.inUtt) V.set('thinking'); }, 1200); return; }
    if (coreLive() && V.state !== 'listening' && !V.vad.inUtt) V.set('listening');
  };
  // tap to interrupt: Bro stops at once, the server drops the rest of his reply, and the mic listens again
  V.interrupt = function () {
    if (V.engine !== 'core' || !coreLive()) return;
    V.stopPlayback(); V.stopLocal(); V.dropTurn = V.turn;
    V.wsSend({ t: 'cancel' }); V.stats.barge++; V.stats.vad.push({ t: 'interrupt', at: Date.now() });
    V.turnDone = true; V.said = ''; V.set('listening');
    try { if (window.haptic) haptic('light'); } catch (e) {}
  };
  V.bargeIn = V.interrupt; // older name
  // the orb follows a voice: Bro's (analyser level → --lvl) while he speaks, yours (mic level → --in on the rings) while
  // Bro listens
  V.orbLoop = function () {
    cancelAnimationFrame(V._raf);
    const data = new Uint8Array(256);
    const tick = () => {
      if (V.engine !== 'core' || !isLive()) { V._raf = 0; return; }
      let lvl = 0, inp = 0;
      if (V.analyser && V.srcs.size) { V.analyser.getByteTimeDomainData(data); let s = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; } lvl = Math.min(1, Math.sqrt(s / data.length) * 4); }
      else if (V.state === 'listening' && V.vad && !V.vad.deaf) inp = V.vad.level || 0;
      V._lvl = (V._lvl || 0) * 0.6 + lvl * 0.4; V._in = (V._in || 0) * 0.65 + inp * 0.35;
      document.querySelectorAll('.hb-orb.drv').forEach(o => o.style.setProperty('--lvl', V._lvl.toFixed(3)));
      const orb = document.getElementById('bvfOrb'); if (orb) orb.style.setProperty('--in', V._in.toFixed(3));
      V._raf = requestAnimationFrame(tick);
    };
    V._raf = requestAnimationFrame(tick);
  };
  V.keepAwake = async function (on) { try { if (on && navigator.wakeLock && !V._wake) V._wake = await navigator.wakeLock.request('screen'); else if (!on && V._wake) { V._wake.release(); V._wake = null; } } catch (e) {} };

  // ── listening. Frames are ignored while Bro is audible (half-duplex). Otherwise:
  //    · a phrase starts as a candidate on the first voiced frame (Silero ≥ 0.5 when loaded, else energy ≥ floor + 12 dB;
  //      a little stricter while a turn is in flight)
  //      and becomes an utterance after ~200 ms of voiced frames; a gap of 160 ms before that drops it (a cough, a click);
  //    · start goes to the server only then, with ~320 ms of pre-roll so the first syllable is never cut;
  //    · the end of a turn: 1.1 s of silence, 1.3 s while the voiced speech is still under 1.2 s; 30 s at most;
  //    · the noise floor adapts while nobody speaks.
  //  v21 (soft voices): the start needs floor + 9 dB (+4 dB with Silero), the phrase continues at floor + 4 dB (+5 dB
  //  without Silero), and the floor is the 20th percentile of the last 3 s of frames Silero calls non-speech, so a soft
  //  voice can no longer drag the floor up to itself. Silero hearing speech that stays under the start level for a while
  //  shows "Speak a little closer".
  const VADC = { START_DB: 9, START_DB_SIL: 4, CONT_DB: 5, CONT_DB_SIL: 4, CONFIRM_MS: 192, GAP_MS: 160, END_MS: 1100, END_SHORT_MS: 1300, SHORT_MS: 1200, MIN_MS: 180, MAX_MS: 30000, PREROLL: 10, FLOOR_FRAMES: 94, CLOSER_MS: 640 };
  V.VAD = VADC;
  V.vadReset = function () { V.vad = { floor: -60, hist: [], soft: [], ring: [], cand: null, inUtt: false, ms: 0, voiced: 0, quiet: 0, dbs: [], f0s: [], edges: 0, wasV: false, n: 0, q: Promise.resolve(), pend: 0, level: 0, deaf: false }; };
  // the noise floor: the 20th percentile of the recent non-speech frames (minimum statistics), between -80 and -28 dBFS
  V.vadFloor = function (D, db, prob) {
    if (prob != null && prob >= 0.3 && D.hist.length >= 8) return; // Silero hears a voice: never learn the floor from it (once it has a start)
    D.hist.push(db); if (D.hist.length > VADC.FLOOR_FRAMES) D.hist.shift();
    const s = D.hist.slice().sort((a, b) => a - b), p = s[Math.floor((s.length - 1) * 0.2)];
    D.floor = Math.max(-80, Math.min(-28, D.hist.length < 8 ? Math.min(D.floor, p) : p));
  };
  // Silero hears speech that never gets loud enough to start a phrase: ask to speak a little closer (at most every 30 s)
  V.closerCheck = function (D, prob, speechy) {
    const now = performance.now();
    if (prob != null && prob >= 0.6 && !speechy) D.soft.push(now);
    while (D.soft.length && now - D.soft[0] > 2000) D.soft.shift();
    if (D.soft.length * FRAME_MS >= VADC.CLOSER_MS && !(V.closerAt > Date.now() - 30000)) {
      D.soft = []; V.closerAt = Date.now(); V.closerUntil = Date.now() + 4000; V.stats.closer = (V.stats.closer || 0) + 1;
      const el = document.querySelector('.bvf-hint'); if (el) el.textContent = V.lang === 'hi' ? 'थोड़ा पास आकर बोलो' : 'Speak a little closer';
      setTimeout(() => { const e2 = document.querySelector('.bvf-hint'); if (e2 && /closer|पास आकर/.test(e2.textContent)) e2.textContent = ''; }, 4100);
    }
  };
  V.vadReset();
  V.onFrame = function (d) {
    if (V.engine !== 'core' || !coreLive()) return;
    const D = V.vad;
    if (V.broAudible()) { // Bro's own voice never reaches the detector
      if (!D.deaf) { D.deaf = true; D.cand = null; D.ring = []; }
      D.level = 0; V.stats.deaf++; if (!(d.db <= V.stats.deafPeak)) V.stats.deafPeak = Math.round(d.db); return;
    }
    if (D.deaf) { D.deaf = false; if (V.sil && V.sil.reset) V.sil.reset(); }
    const fr = { pcm: new Int16Array(d.pcm), db: d.db, f0: d.f0 };
    const sil = V.sil;
    if (sil && sil.ok && D.pend < 6) { D.pend++; D.q = D.q.then(() => sil.run(fr.pcm)).then(p => { D.pend--; V.vadStep(fr, p); }, () => { D.pend--; V.vadStep(fr, null); }); }
    else D.q = D.q.then(() => V.vadStep(fr, null));
  };
  V.vadStep = function (fr, prob) {
    const D = V.vad, C = VADC; if (V.engine !== 'core' || !coreLive()) return;
    if (V.broAudible()) return;
    D.n++;
    const useSil = prob != null;
    D.level = Math.max(0, Math.min(1, (fr.db - D.floor - 4) / 26));
    if (!D.inUtt) {
      if (!D.cand) V.vadFloor(D, fr.db, prob); // the noise floor, from the frames nobody is speaking in
      // busy (from your end of speech until the server's turn is done, sentence gaps and thinking included): you can
      // still add to your thought, with a slightly stricter start so a last echo in a gap between Bro's lines can't
      const busy = !V.turnDone;
      const speechy = useSil ? prob >= (busy ? 0.6 : 0.5) && fr.db > D.floor + C.START_DB_SIL + (busy ? 2 : 0) : fr.db > D.floor + C.START_DB + (busy ? 3 : 0);
      if (useSil) V.closerCheck(D, prob, speechy);
      if (!D.cand) {
        if (speechy) D.cand = { frames: [fr], voiced: FRAME_MS, gap: 0, dbs: [fr.db], f0s: fr.f0 ? [fr.f0] : [] };
        else { D.ring.push(fr); if (D.ring.length > C.PREROLL) D.ring.shift(); }
        return;
      }
      const c = D.cand; c.frames.push(fr);
      if (speechy) { c.voiced += FRAME_MS; c.gap = 0; c.dbs.push(fr.db); if (fr.f0) c.f0s.push(fr.f0); } else c.gap += FRAME_MS;
      if (c.gap > C.GAP_MS) { // a click or a cough, not a phrase: it never reaches the server
        V.stats.vad.push({ t: 'blip', at: Date.now(), ms: c.voiced });
        D.ring.push(...c.frames); while (D.ring.length > C.PREROLL) D.ring.shift(); D.cand = null; return;
      }
      if (c.voiced >= C.CONFIRM_MS) V.uttStart();
      return;
    }
    V.wsSend(fr.pcm.buffer);
    D.ms += FRAME_MS;
    const voiced = fr.db > D.floor + (useSil ? C.CONT_DB_SIL : C.CONT_DB) && (!useSil || prob >= 0.35);
    if (voiced) { D.voiced += FRAME_MS; D.quiet = 0; D.dbs.push(fr.db); if (fr.f0) D.f0s.push(fr.f0); if (!D.wasV) D.edges++; } else D.quiet += FRAME_MS;
    D.wasV = voiced;
    if (D.quiet >= (D.voiced < C.SHORT_MS ? C.END_SHORT_MS : C.END_MS) || D.ms >= C.MAX_MS) V.uttEnd(D.ms >= C.MAX_MS);
  };
  V.uttStart = function () {
    const D = V.vad, c = D.cand; if (!c) return; if (V.stats.vad.length > 200) V.stats.vad.splice(0, 100);
    D.cand = null; D.inUtt = true;
    D.ms = (D.ring.length + c.frames.length) * FRAME_MS; D.voiced = c.voiced; D.quiet = c.gap; D.edges = 1; D.wasV = c.gap === 0;
    D.dbs = c.dbs.slice(); D.f0s = c.f0s.slice();
    V.wsSend({ t: 'start' }); D.ring.forEach(f => V.wsSend(f.pcm.buffer)); c.frames.forEach(f => V.wsSend(f.pcm.buffer)); D.ring = [];
    V.stats.vad.push({ t: 'start', at: Date.now(), floor: Math.round(D.floor), sil: !!(V.sil && V.sil.ok) });
    V.heard = ''; if (V.state !== 'listening') V.set('listening');
  };
  V.uttEnd = function () {
    const D = V.vad; if (!D.inUtt) return;
    D.inUtt = false;
    if (D.voiced < VADC.MIN_MS) { V.wsSend({ t: 'end', discard: true }); V.stats.vad.push({ t: 'discard', at: Date.now(), ms: D.voiced }); if (V.turnDone) V.checkDrain(); return; }
    const mean = D.dbs.length ? D.dbs.reduce((a, b) => a + b, 0) / D.dbs.length : null;
    const f0 = D.f0s.slice().sort((a, b) => a - b)[D.f0s.length >> 1] || null;
    const feats = { energy: mean == null ? null : Math.round(mean * 10) / 10, pitch: f0 ? Math.round(f0) : null, rate: Math.round(D.edges / Math.max(0.3, D.ms / 1000) * 100) / 100 };
    V.wsSend({ t: 'end', feats });
    V.lastEnd = performance.now() - D.quiet; // when the voice actually stopped
    V.stats.vad.push({ t: 'end', at: Date.now(), ms: D.ms, voiced: D.voiced, feats });
    V.turnDone = false; V.set('thinking');
  };
  // Silero VAD (self-hosted onnxruntime-web + silero_vad_v5): starts loading with each call (never on data saver or 2G;
  // localStorage bro.vad = 'energy' turns it off). Until it loads, or if it fails, the energy detector decides alone.
  // → a promise that settles when it is ready or has failed.
  V.loadSilero = function () {
    if (V.sil && V.sil.p) return V.sil.p;
    if (V.sil && (V.sil.ok || V.sil.off)) return Promise.resolve(V.sil);
    let pref = ''; try { pref = localStorage.getItem('bro.vad') || ''; } catch (e) {}
    const cn = navigator.connection || {};
    if (pref === 'energy' || cn.saveData || /(^|-)2g$/.test(cn.effectiveType || '')) { V.sil = { ok: false, off: true }; return Promise.resolve(V.sil); }
    const S2 = V.sil = { ok: false, loading: true, t0: Date.now() };
    const base = '/app/vendor/vad/';
    const script = () => window.ort ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = base + 'ort.wasm.min.js'; s.onload = res; s.onerror = () => rej(new Error('ort script')); document.head.appendChild(s); });
    S2.p = script().then(async () => {
      const ort = window.ort; ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1; ort.env.logLevel = 'error';
      const model = await (await fetch(base + 'silero_vad_v5.onnx')).arrayBuffer();
      const sess = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      const sr = new ort.Tensor('int64', [16000n]);
      let state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]), ctx = new Float32Array(64);
      S2.reset = () => { state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]); ctx = new Float32Array(64); };
      S2.run = async pcm => { // 512 samples + 64 of context from the frame before (as silero-vad does)
        const x = new Float32Array(576); x.set(ctx, 0); for (let i = 0; i < 512; i++) x[64 + i] = pcm[i] / 32768; ctx = x.slice(-64);
        const out = await sess.run({ input: new ort.Tensor('float32', x, [1, 576]), state, sr });
        state = out.stateN; const p = out.output.data[0]; S2.last = p; S2.n = (S2.n || 0) + 1; return p;
      };
      S2.ok = true; S2.loading = false; S2.ms = Date.now() - S2.t0; console.log('[bro] Silero VAD on (' + S2.ms + ' ms)');
      return S2;
    }).catch(e => { S2.ok = false; S2.loading = false; S2.error = String(e && e.message || e); console.warn('[bro] Silero VAD unavailable, energy VAD only:', S2.error); return S2; });
    return S2.p;
  };

  // ───────────────────────── ElevenLabs Conversational AI (emergency only) ─────────────────────────
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

  // ───────────────────────── realtime (WebRTC, emergency only) ─────────────────────────
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
    rec.lang = V.lang === 'hi' ? 'hi-IN' : 'en-IN';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '';
    rec.onresult = e => { let s = ''; for (let i = e.resultIndex; i < e.results.length; i++) { s += e.results[i][0].transcript; if (e.results[i].isFinal) final += e.results[i][0].transcript; } V.heard = s; const t = document.getElementById('bvfText'); if (t) { t.textContent = s; t.className = 'bvf-text user'; } };
    rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone blocked — allow it in site settings'); };
    rec.onend = () => { V.rec = null; const text = final.trim(); V.heard = ''; if (text) V.send(text); else if (V.state === 'listening') V.set('live'); };
    V.set('listening'); try { rec.start(); } catch (e) { V.set('live'); }
  };
  // Press-and-hold recording → /api/voice/transcribe when SpeechRecognition is missing (e.g. some iOS / desktop browsers).
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
          const r = await fetch('/api/voice/transcribe?lang=' + (V.lang === 'hi' ? 'hi' : 'en'), { method: 'POST', headers: { 'Content-Type': blob.type, 'x-token': (typeof token !== 'undefined' && token) || '' }, body: blob });
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
        // 503: Bro's voice is busy (live calls go first) · 429: over the speech limit → the device voice says this reply
        else if (r.status === 503 || r.status === 429) { V.speakLocal(clean, hi, onEnd); return; }
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
    const inp = document.getElementById('bvInput'), fin = document.getElementById('bvfInput');
    text = (text || (inp && inp.value) || '').trim(); if (!text) return;
    if (V.engine === 'core' && coreLive() && V.ws && V.ws.readyState === 1) { // typed words in a live call go over the socket
      if (inp) inp.value = ''; if (fin) fin.value = '';
      V.stopPlayback(); V.stopLocal(); V.dropTurn = V.turn; V.push('user', text); V.said = '';
      V.wsSend({ t: 'text', text }); V.turnDone = false; V.set('thinking'); return;
    }
    if (V.state === 'thinking') return;
    if (inp) inp.value = '';
    V.push('user', text);
    if (V.engine === 'eleven' && V.conv) { try { V.conv.sendUserMessage(text); } catch (e) {} return; }
    if (V.engine === 'realtime' && V.dc && V.dc.readyState === 'open') {
      V.rtSend({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      V.rtSend({ type: 'response.create' }); return;
    }
    V.set('thinking');
    const msgs = V.thread.slice(-10).map(m => ({ role: m.role === 'bro' ? 'assistant' : 'user', content: m.doc ? ('(I wrote this down for you) ' + m.doc.title + '\n' + m.doc.text).slice(0, 1900) : m.text }));
    const wasVoice = V.engine === 'fallback';
    // v20: the reply streams in (Server-Sent Events): words appear as Bro thinks them, the app's actions as they run, and
    // with the voice on Bro starts speaking at the first full sentence
    let msg = null, done = null, failed = false, spoke = 0, raf = 0;
    const say = wasVoice ? V.sentenceSpeaker() : null;
    const paint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; V.rerender(); }); };
    const handle = o => {
      if (!o || typeof o !== 'object') return;
      if (o.t === 'delta' && typeof o.text === 'string') {
        if (!msg) { msg = { role: 'bro', text: '', ts: Date.now() }; V.thread.push(msg); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; if (V.state === 'thinking') V.set(V.engine ? 'live' : 'idle'); }
        msg.text += o.text; paint();
        if (say) { const full = msg.text, cut = full.slice(spoke).match(/^[\s\S]*[.!?।](\s|$)/); if (cut) { say.push(cut[0]); spoke += cut[0].length; } }
      } else if (o.t === 'action') V.afterTool(o.tool, o.input || {}, o.result);
      else if (o.t === 'done') done = o;
      else if (o.t === 'error') failed = true;
    };
    try {
      const r = await fetch('/api/voice/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': (typeof token !== 'undefined' && token) || '' }, body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang, messages: msgs, stream: true }) });
      if (r.ok && /event-stream/.test(r.headers.get('content-type') || '') && r.body && r.body.getReader) {
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done: end } = await rd.read(); if (end) break;
          buf += dec.decode(value, { stream: true });
          for (let i; (i = buf.indexOf('\n\n')) >= 0;) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const line = ev.split('\n').find(l => l.startsWith('data:')); if (line) { try { handle(JSON.parse(line.slice(5).trim())); } catch (e) { /* a broken event */ } } }
        }
      } else if (r.ok) { const j = await r.json(); if (j && j.reply) { (j.actions || []).forEach(a => handle({ t: 'action', tool: a.tool, input: a.input, result: a.result })); handle({ t: 'delta', text: j.reply }); done = j; } else failed = true; }
      else failed = true;
    } catch (e) { failed = true; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    // a failed turn: a plain line for everyone (setup details stay in the server log / Admin), and the words come back to the box
    if (!msg || !msg.text.trim()) {
      if (msg) V.thread.splice(V.thread.indexOf(msg), 1);
      V.push('bro', V.lang === 'hi' ? 'अभी जवाब नहीं दे पाया — फिर से भेजो?' : 'I couldn’t answer just now — try again?'); V.set(V.engine ? 'live' : 'idle');
      const box = document.getElementById('bvInput'); if (box && !box.value) box.value = text; return;
    }
    msg.text = msg.text.trim(); V.rerender();
    if (say) { const rest = msg.text.slice(spoke).trim(); if (rest) say.push(rest); say.end(() => V.listen()); }
    else V.set(V.engine ? 'live' : 'idle');
    void done; void failed;
  };
  // sentences spoken one after another in Bro's voice as they arrive (typed chat with the voice on)
  V.sentenceSpeaker = function () {
    const q = []; let busy = false, fin = null;
    const next = () => {
      if (busy) return;
      const t = q.shift();
      if (t == null) { if (fin) { const f = fin; fin = null; V.set('live'); f(); } return; }
      busy = true; V.set('speaking');
      const go = () => { busy = false; next(); };
      if (window.BroSay) window.BroSay.one(t, { lang: V.lang === 'hi' || hasDevanagari(t) ? 'hi' : 'en', onend: go }); else V.speakLocal(t, hasDevanagari(t), go);
    };
    return { push(t) { t = String(t || '').replace(/[*_#`>]/g, '').trim(); if (t) { q.push(t); next(); } }, end(cb) { fin = cb; next(); } };
  };
  // what a tool did, shown in the app (the emergency engines only: Bro chat on Bro Core runs no app tools)
  async function refreshTasks() { const t = await api('/tasks'); if (Array.isArray(t)) { S.tasks = t; S._lastTasksHash = JSON.stringify(t); if (S.tab === 'tasks' && typeof render === 'function') render(); } return t; }
  V.afterTool = function (name, input, result) {
    if (!result || result.error) return;
    if (result.open) {
      const m = /[?&]tab=(\w+)/.exec(result.open);
      if (m && typeof switchTab === 'function') { setTimeout(() => switchTab(m[1] === 'you' ? 'profile' : m[1]), 300); return; }
      // leaving the app would end a call: it opens when the call ends
      if (coreLive()) { V.pendingOpen = result.open; toast(V.lang === 'hi' ? 'कॉल खत्म होते ही खुलेगा' : 'Opens when the call ends'); return; }
      setTimeout(() => { if (window.BroFrame) BroFrame.go(result.open); else location.href = result.open; }, 900); return;
    }
    if (name === 'create_task' || name === 'complete_task') { toast(name === 'create_task' ? '✅ Task added: ' + (input.title || '') : '🎉 Done: ' + (input.title || '')); refreshTasks(); }
    if (name === 'set_reminder') toast('⏰ Reminder set' + (input.time ? ' for ' + input.time : ''));
    if (name === 'set_step_goal') toast('👟 Step goal: ' + (result.goal || input.goal || ''));
    if (name === 'write_down' && result.doc) { V.showDoc(result.doc); toast(V.lang === 'hi' ? '📝 नोट्स में सेव' : '📝 Saved in Notes'); }
    // v23: everything Bro schedules is in Brodoit's calendar (and Google's when connected); the calendar screens refresh
    const when = (d, t) => (d ? ' · ' + d : '') + (t ? ' ' + t : '');
    if (name === 'create_schedule_block') { const b = result.block || {}; toast('🗓️ ' + (result.already ? 'Already on your plan: ' : 'On your plan: ') + (b.label || input.label || '') + when(b.date || input.date, b.start || input.start_time) + (b.synced_to_gcal ? ' · Google ✓' : '')); if (window.calBlocksRefresh) calBlocksRefresh(); }
    if (name === 'create_calendar_event') { const e = result.event || {}; toast('🗓️ ' + (result.already ? 'Already in your calendar: ' : 'In your calendar: ') + (e.title || input.title || '') + when(e.date || input.date, e.time || input.time) + (e.synced_to_google ? ' · Google ✓' : '')); if (e.all_day) refreshTasks(); if (window.calBlocksRefresh) calBlocksRefresh(); }
  };
  // Deep links: /?say=...  and  /?persona=teacher|language (&course=es): the mode for this visit, never a setting
  V.boot = function () {
    const q = new URLSearchParams(location.search);
    if (q.get('course')) V.setCourse(q.get('course'));
    if (q.get('persona')) V.setPersona(q.get('persona'));
    if (q.get('say')) setTimeout(() => V.send(q.get('say')), 600);
    try { speechSynthesis.getVoices(); } catch (e) {}
  };
})();
