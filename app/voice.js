// Talking Bro — the voice-first home screen. Loaded by the SPA as a plain script; uses the SPA
// globals (S, api, token, toast, esc, render, switchTab). One voice behind one UI. Engines, in the order
// /api/voice/session hands them out:
//  • core: Bro Core (v16). A WebSocket to /api/voice/live: our mic → 16 kHz frames → voice activity detection →
//    the server hears, thinks and streams Bro's own voice back (Int16 24 kHz) sentence by sentence. Interruptible,
//    and Bro runs the app from inside the call (client tools: tabs, news, steps, tasks, theme, weather, mini-apps).
//    The call survives tab changes: a slim pill above the tab bar brings it back.
//  • fallback: browser SpeechRecognition → /api/voice/turn → /api/voice/tts
//  • eleven / realtime: ElevenLabs agent / OpenAI Realtime, only when the server's emergency switch is on
//    (the device voice only when no voice exists at all)
(function () {
  'use strict';
  const V = window.BroVoice = {
    state: 'idle', // idle | connecting | live | listening | thinking | speaking | ended | off
    engine: null,   // 'core' | 'fallback' | 'eleven' | 'realtime'
    persona: (p => p === 'news' ? 'bro' : p)(localStorage.getItem('bro.persona') || 'bro'),
    lang: localStorage.getItem('bro.lang') || 'auto', // auto | en | hi
    course: localStorage.getItem('bro.course') || 'es',
    thread: [],     // {role:'user'|'bro', text, ts, turn?}
    pc: null, dc: null, mic: null, audioEl: null, rec: null, handsFree: false, partial: '',
    // core engine
    ws: null, ac: null, said: '', turn: 0, dropTurn: -1, turnDone: true, srcs: new Set(), playT: 0,
    stats: { frames: 0, scheduled: 0, played: 0, barge: 0, vad: [], lat: [] }, // read by tests and the console
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
    down: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    keys: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10"/></svg>',
  };
  const isLive = () => V.state !== 'idle' && V.state !== 'off' && V.state !== 'ended';
  const coreLive = () => V.engine === 'core' && isLive();

  // ───────────────────────── UI ─────────────────────────
  // Home v13.1 — Bro and almost no words: the big mascot on the app background, one round mic button, the mode and
  // language switches as small toggles, chat bubbles, and the compose bar. A status line appears only while Bro is live.
  // Styles in app/home.css.
  const hEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  V.html = function () {
    const hi = V.lang === 'hi';
    const ic = (n, sz) => (window.ico ? ico(n, sz || 18) : '');
    const live = isLive();
    let line = '';
    if (V.state === 'connecting') line = hi ? 'एक सेकंड…' : 'One sec…';
    else if (V.state === 'thinking') line = hi ? 'सोच रहा हूँ…' : 'Thinking…';
    else if (V.partial) line = V.partial;
    else if (V.state === 'speaking' && V.said) line = V.said;
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
    h += '<button type="button" class="hb-mic' + (live ? ' on' : '') + '" id="bvTalk" onclick="' + (live ? 'BroVoice.hangUp()' : 'BroVoice.tapOrb()') + '" aria-label="' + (live ? (hi ? 'बंद करो' : 'Stop') : (hi ? 'बोलकर पूछो' : 'Talk to Bro')) + '">' + (live ? ICON.stop : ICON.mic) + '</button></section>';
    if (V.persona === 'language') h += '<div class="pill-row hb-courses">' + Object.keys(COURSES).map(c => '<button type="button" class="pill' + (V.course === c ? ' on' : '') + '" onclick="BroVoice.setCourse(\'' + c + '\')">' + COURSES[c] + '</button>').join('') + '</div>';
    if (chat) {
      h += '<div class="hb-thread" id="bvThread">';
      V.thread.slice(-8).forEach(m => { h += '<div class="bv-msg ' + m.role + '"><div class="bv-bub">' + hEsc(m.text) + '</div></div>'; });
      h += '</div>';
    }
    h += '<form class="hb-compose" onsubmit="event.preventDefault();BroVoice.send()"><input id="bvInput" placeholder="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '" autocomplete="off" enterkeyhint="send" aria-label="' + (hi ? 'Bro को लिखो' : 'Message Bro') + '"><button type="submit" class="hb-send"' + (V.state === 'thinking' && V.engine !== 'core' ? ' disabled' : '') + ' aria-label="' + (hi ? 'भेजो' : 'Send') + '">' + (window.ico ? ico('arrow-up', 20) : ICON.send) + '</button></form>';
    h += '</div>';
    return h;
  };
  V.rerender = function () { if (S.tab === 'bro' || S.tab === 'home' || !S.tab) { const root = document.getElementById('broVoiceRoot'); if (root) { root.innerHTML = V.html(); V.scroll(); } } V.renderFull(); V.renderPill(); };
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
  V.set = function (st) { if (V.engine === 'core' && V.state === st) { V.renderPill(); return; } V.state = st; V.rerender(); };
  V.push = function (role, text) { if (!text) return; V.thread.push({ role, text, ts: Date.now() }); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; V.rerender(); };
  V.setPersona = function (k) { k = k === 'news' ? 'bro' : k; if (!PERSONAS.some(p => p.k === k)) return; V.persona = k; localStorage.setItem('bro.persona', k); const was = isLive(); V.rerender(); if (was) { V.stop(true); V.start(); } };
  V.setLang = function (l) { V.lang = l; localStorage.setItem('bro.lang', l); V.rerender(); if (isLive()) { V.stop(true); V.start(); } };
  V.setCourse = function (c) { V.course = c; localStorage.setItem('bro.course', c); V.rerender(); };
  // tap the orb: start a call; in a live core call it brings the call screen back, or stops Bro mid-sentence
  V.tapOrb = function () { V.unlockAudio(); if (!isLive()) V.start(); else if (V.engine === 'core') { if (V.state === 'speaking' && document.getElementById('bvFull')) { V.bargeIn(); V.set('listening'); } else V.openFull(); } else if (V.engine === 'fallback' && V.state === 'live') V.listen(); else V.stop(); };
  V.engineLabel = () => V.engine === 'core' ? 'Bro Core' : V.engine === 'eleven' ? 'ElevenLabs' : V.engine === 'realtime' ? 'OpenAI Realtime' : V.engine === 'fallback' ? (V.noTTS ? 'Device voice' : 'Studio voice') : '';
  // Audio playback must be unlocked by a user gesture on mobile: play a silent clip on the first tap.
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  V.ttsEl = function () { if (!V.tts) { V.tts = document.createElement('audio'); V.tts.setAttribute('playsinline', ''); V.tts.preload = 'auto'; document.body.appendChild(V.tts); } return V.tts; };
  V.unlockAudio = function () { try { const a = V.ttsEl(); if (!V.unlocked) { a.src = SILENT; a.play().then(() => { V.unlocked = true; }).catch(() => {}); } } catch (e) {} };

  // ───────────────────────── full-screen voice mode ─────────────────────────
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
    const cap = { connecting: hi ? 'जुड़ रहा है' : 'Connecting', live: hi ? 'बोलो' : 'Your turn', listening: hi ? 'सुन रहा हूँ' : 'Listening', thinking: hi ? 'सोच रहा हूँ' : 'Thinking', speaking: 'Bro' }[V.state] || '';
    const lastUser = V.thread.slice().reverse().find(m => m.role === 'user'); const lastBro = V.thread.slice().reverse().find(m => m.role === 'bro');
    let line = '', cls = '';
    if (V.engine === 'core') { line = V.state === 'speaking' || (V.state === 'listening' && V.said) ? V.said : ''; cls = 'bro'; }
    else if (V.partial) { line = V.partial; cls = 'bro'; }
    else if (V.state === 'listening') { line = V.heard || ''; cls = 'user'; }
    else if (V.state === 'thinking') { line = lastUser ? lastUser.text : ''; cls = 'user'; }
    else if (lastBro && (V.state === 'speaking' || V.state === 'live')) { line = lastBro.text; cls = 'bro'; }
    const why = V.why && WHY[V.why] ? WHY[V.why][hi ? 1 : 0] : '';
    const whyLine = !live ? '' : V.engine === 'fallback' && (V.noTTS || V.fromCore) ? (why || WHY.credits[hi ? 1 : 0]) : V.engine === 'core' && V.noVoice ? WHY.voice[hi ? 1 : 0] : '';
    const hint = whyLine ? whyLine : !live ? '' : (V.engine === 'realtime' || V.engine === 'eleven' || V.engine === 'core') ? (hi ? 'बस बोलो — बीच में टोक सकते हो' : 'Just talk — interrupt any time') : V.state === 'live' ? (SR ? (hi ? 'बोलने के लिए टैप करो' : 'Tap the circle to speak') : (hi ? 'बोलते समय दबाए रखो' : 'Hold the circle while you speak')) : '';
    // captions (core): the last thing you said, small, above what Bro is saying now
    const heardLine = V.engine === 'core' && lastUser ? '<div class="bvf-heard" id="bvfHeard">' + esc(lastUser.text) + '</div>' : '';
    const min = V.engine === 'core' ? '<button class="bvf-x bvf-min" onclick="BroVoice.minimize()" aria-label="' + (hi ? 'छोटा करो, कॉल चलती रहेगी' : 'Minimise, the call keeps going') + '">' + ICON.down + '</button>' : '';
    const typeRow = V.engine === 'core' ? (V.typing ? '<form class="bvf-type" onsubmit="event.preventDefault();BroVoice.send(document.getElementById(\'bvfInput\').value)"><input id="bvfInput" placeholder="' + (hi ? 'Bro को लिखो' : 'Type to Bro') + '" autocomplete="off" enterkeyhint="send" aria-label="' + (hi ? 'Bro को लिखो' : 'Type to Bro') + '"><button type="submit" aria-label="' + (hi ? 'भेजो' : 'Send') + '">' + ICON.send + '</button></form>' : '') : '';
    const keys = V.engine === 'core' ? '<button class="bvf-kb' + (V.typing ? ' on' : '') + '" onclick="BroVoice.toggleType()" aria-label="' + (hi ? 'लिखकर बोलो' : 'Type instead') + '">' + ICON.keys + '</button>' : '';
    return '<div class="bvf-top">' + min + '<span class="bvf-mode">' + esc((PERSONAS.find(p => p.k === V.persona) || PERSONAS[0])[hi ? 'hi' : 'l']) + '</span><button class="bvf-x" onclick="BroVoice.hangUp()" aria-label="' + (hi ? 'कॉल खत्म करो' : 'End call') + '">' + (window.ico ? ico('x', 22) : '✕') + '</button></div>' +
      '<div class="bvf-stage"><button class="bv-orb st-' + V.state + '" id="bvfOrb" ' + ((!SR && V.engine === 'fallback' && V.caps && V.caps.stt) ? 'onpointerdown="BroVoice.holdStart()" onpointerup="BroVoice.holdEnd()" onpointercancel="BroVoice.holdEnd()" onpointerleave="BroVoice.holdEnd()"' : 'onclick="BroVoice.tapOrb()"') + ' aria-label="Talk"><span class="bv-ring r1"></span><span class="bv-ring r2"></span><span class="hb-orb st-' + V.state + (V.engine === 'core' ? ' drv' : '') + '"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span></button><div class="bvf-cap">' + esc(cap) + '</div>' + heardLine + '<div class="bvf-text ' + cls + '" id="bvfText" aria-live="polite">' + esc(line) + '</div></div>' +
      '<div class="bvf-bar">' + typeRow + '<div class="bvf-hint">' + esc(hint) + '</div><div class="bvf-row">' + keys + '<button class="bvf-end" onclick="BroVoice.hangUp()">' + ICON.stop + (hi ? ' बंद करो' : ' End') + '</button></div></div>';
  };
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
  V.openFull = function () { let el = document.getElementById('bvFull'); if (!el) { el = document.createElement('div'); el.id = 'bvFull'; el.className = 'bvf'; document.body.appendChild(el); document.documentElement.classList.add('bvf-open'); } el.innerHTML = V.fullHtml(); V.renderPill(); };
  V.closeFull = function () { const el = document.getElementById('bvFull'); if (el) el.remove(); document.documentElement.classList.remove('bvf-open'); };
  V.renderFull = function () {
    const el = document.getElementById('bvFull'); if (!el) return;
    const inp = document.getElementById('bvfInput'), had = inp && document.activeElement === inp, val = inp && inp.value;
    el.innerHTML = V.fullHtml();
    if (inp) { const n = document.getElementById('bvfInput'); if (n) { n.value = val || ''; if (had) n.focus(); } }
  };
  V.say = function (text) { V.send(text); };
  V.minimize = function () { V.closeFull(); V.renderPill(); };
  V.toggleType = function () { V.typing = !V.typing; V.renderFull(); const n = document.getElementById('bvfInput'); if (n) n.focus(); };

  // ── the floating pill: while a live call goes on in another tab, a slim bar above the tab bar (mini orb, status, end)
  V.renderPill = function () {
    let el = document.getElementById('bvPill');
    const show = coreLive() && !document.getElementById('bvFull') && !(S.tab === 'bro' || S.tab === 'home' || !S.tab);
    if (!show) { if (el) { el.remove(); document.documentElement.classList.remove('bro-pill'); keepNewsClear(); } return; }
    const hi = V.lang === 'hi';
    const label = { connecting: hi ? 'Bro जुड़ रहा है' : 'Bro is connecting', listening: hi ? 'Bro सुन रहा है' : 'Bro is listening', thinking: hi ? 'Bro सोच रहा है' : 'Bro is thinking', speaking: hi ? 'Bro बोल रहा है' : 'Bro is speaking' }[V.state] || 'Bro';
    if (!el) { el = document.createElement('div'); el.id = 'bvPill'; el.className = 'bvp'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', hi ? 'Bro से कॉल' : 'Call with Bro'); document.body.appendChild(el); }
    const html = '<button type="button" class="bvp-main" onclick="BroVoice.openCall()" aria-label="' + (hi ? 'कॉल पर वापस जाओ' : 'Back to the call') + '"><span class="hb-orb bvp-orb st-' + V.state + ' drv"><i class="o1"></i><i class="o2"></i><i class="o3"></i></span><span class="bvp-txt">' + esc(label) + '</span></button><button type="button" class="bvp-end" onclick="BroVoice.hangUp()" aria-label="' + (hi ? 'कॉल खत्म करो' : 'End call') + '">' + ICON.stop + '</button>';
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    // sit 8px above the tab bar (or bottom-right on desktop, where the tabs live in the side column)
    const bar = document.querySelector('nav.tabs.page-t') || document.querySelector('.rd-tabbar'), r = bar && bar.getBoundingClientRect();
    const onBottom = r && r.height && r.top > innerHeight * 0.55;
    el.style.bottom = (onBottom ? Math.max(8, Math.round(innerHeight - r.top + 8)) : 16) + 'px';
    el.classList.toggle('side', !onBottom);
    // keep the page clear of it: scrolling tabs get a spacer at the end (home.css), the News deck gets shorter
    document.documentElement.classList.add('bro-pill');
    document.documentElement.style.setProperty('--bro-pill-space', Math.round(el.getBoundingClientRect().height + 16) + 'px');
    keepNewsClear();
  };
  // The News deck sizes itself to end at the tab bar (NewsChannel.size); while the pill shows there it ends above the pill
  // instead, so no story text hides behind it. Re-applied whenever the deck is resized.
  function keepNewsClear() {
    const d = document.getElementById('nzDeck'); if (!d) return;
    const pill = document.getElementById('bvPill');
    if (!pill || S.tab !== 'news') { if (d._broShrunk) { d._broShrunk = 0; try { NewsChannel.size(); } catch (e) {} } return; }
    const pr = pill.getBoundingClientRect(), dr = d.getBoundingClientRect(), over = Math.ceil(dr.bottom - (pr.top - 8));
    if (over > 1) { d._broShrunk = 1; d.style.height = Math.max(240, Math.floor(dr.height - over)) + 'px'; try { NewsChannel.go(NewsChannel.i, true); } catch (e) {} }
    if (!d._broObs && window.MutationObserver) { d._broObs = new MutationObserver(() => { if (document.getElementById('bvPill')) requestAnimationFrame(keepNewsClear); }); d._broObs.observe(d, { attributes: true, attributeFilter: ['style'] }); }
  }
  V.openCall = function () { if (S.tab !== 'bro' && typeof switchTab === 'function') switchTab('bro'); else { V.openFull(); } };
  // switchTab() asks us first: a live core call keeps going on every tab; the other engines stop as before
  V.onTab = function (t) {
    if (t === 'bro' || t === 'home') { if (coreLive() || V.state === 'ended') setTimeout(() => { V.openFull(); }, 0); return; }
    if (V.state === 'ended') { V.closeEnd(); return; }
    if (!isLive()) return;
    if (V.engine === 'core') { V.closeFull(); setTimeout(V.renderPill, 0); return; }
    V.stop(true);
  };
  addEventListener('resize', () => { if (document.getElementById('bvPill')) V.renderPill(); });

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
        console.warn('[bro] live call failed, simple mode', e);
        V.coreCleanup(); V.fromCore = true; V.why = (e && e.why) || 'live';
        try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify(Object.assign({ engine: 'classic' }, body)) }); } catch (e2) { sess = { mode: 'fallback' }; }
        const why = V.why; if (sess) sess.why = why;
      }
    }
    if (sess && sess.mode === 'eleven') {
      try { await V.connectEleven(sess); return; } catch (e) { console.warn('[bro] elevenlabs failed, next engine', e); V.why = 'connect'; try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify(Object.assign({ engine: 'classic' }, body)) }); } catch (e2) { sess = { mode: 'fallback' }; } }
    }
    if (sess && sess.mode === 'realtime') {
      try { await V.connectRealtime(sess); return; } catch (e) { console.warn('[bro] realtime failed, falling back', e); }
    }
    V.caps = (sess && sess.caps) || {}; if (V.caps.tts === false && !elevenHint()) V.noTTS = true;
    if (sess && sess.why) V.why = sess.why;
    V.engine = 'fallback'; V.set('live');
    if (opts.context) { V.send(opts.ask || opts.context); return; }
    if (V.why !== 'mic') V.listen();
  };
  const elevenHint = () => false;
  // End = the end screen with the rating for a core call; everything else stops at once
  V.hangUp = function () { if (V.engine === 'core' && (isLive() || V.ws)) V.endCore(); else V.stop(); };
  V.stop = function (silent) {
    if (V.engine === 'core' || V.ws) V.coreCleanup(true);
    try { if (V.conv) { const c = V.conv; V.conv = null; c.endSession().catch(() => {}); } } catch (e) {} V.conv = null;
    try { if (V.dc) V.dc.close(); } catch (e) {}
    try { if (V.pc) V.pc.close(); } catch (e) {}
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { if (V.rec) { V.rec.onend = null; V.rec.stop(); } } catch (e) {}
    try { speechSynthesis.cancel(); } catch (e) {}
    try { if (V.tts) { V.tts.pause(); V.tts.onended = null; } } catch (e) {}
    try { if (V.recd) { V.recd.onstop = null; V.recd.stop(); V.recd.stream.getTracks().forEach(t => t.stop()); } } catch (e) {} V.recd = null;
    V.pc = V.dc = V.mic = V.rec = null; V.handsFree = false; V.partial = ''; V.heard = ''; V.said = ''; V.typing = false;
    V.closeFull(); V.state = 'idle'; V.engine = null; if (!silent) V.rerender(); else V.renderPill();
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
  V.connectCore = async function (sess, opts) {
    opts = opts || {};
    const hi = V.lang === 'hi';
    // 1. the mic (a refusal → simple mode with the reason on screen)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no mic api'), { why: 'mic' });
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {} // Safari: a call, not music (echo cancelling, loudspeaker)
    try { V.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { throw Object.assign(new Error('mic: ' + (e && e.name)), { why: 'mic' }); }
    const ac = V.prepAudio(); try { await ac.resume(); } catch (e) {}
    if (!ac.audioWorklet) throw Object.assign(new Error('no audio worklet'), { why: 'live' });
    if (!V.workletReady) { const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })); V.workletReady = ac.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)); }
    await V.workletReady;
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
    const ready = new Promise((res, rej) => { V._ready = res; V._readyFail = rej; setTimeout(() => rej(Object.assign(new Error('no ready'), { why: 'live' })), 8000); });
    V.wsSend({ t: 'hello', token: sess.token, lang: V.lang, persona: V.persona, course: V.persona === 'language' ? COURSES[V.course] : '', greet: opts.greet !== false && !opts.context, context: opts.context || '' });
    const r = await ready; V._ready = V._readyFail = null;
    V.engine = 'core'; V.callStarted = Date.now(); V.noVoice = r && r.voice === false;
    V.turnDone = true; V.dropTurn = -1; V.thinkingSince = 0;
    V.set('listening'); V.orbLoop(); V.keepAwake(true);
    V.loadSilero();
    console.log('[bro] live call · Bro Core' + (hi ? ' · हिन्दी' : ''));
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
    V.pendingOpen = null;
  };
  V.endCore = function () {
    V.endInfo = { started: V.callStarted || Date.now(), at: Date.now(), rated: null };
    // the mic and Bro stop now; the socket waits for the rating (or Done / 20 s) to say goodbye
    try { (V.micNodes || []).forEach(n => { try { n.disconnect(); } catch (e) {} }); } catch (e) {} V.micNodes = null;
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {} V.mic = null;
    V.stopPlayback(); V.stopLocal(); V.wsSend({ t: 'cancel' }); V.keepAwake(false);
    V.state = 'ended'; V.renderPill(); V.openFull(); V.rerender();
    clearTimeout(V._endT); V._endT = setTimeout(() => { if (V.state === 'ended') V.closeEnd(); }, 20000);
  };
  V.rate = function (r) {
    if (!V.endInfo || V.endInfo.rated) return;
    V.endInfo.rated = r; V.stats.rating = r;
    V.coreCleanup(true, r); V.renderFull();
    try { if (window.haptic) haptic('light'); } catch (e) {}
    setTimeout(() => { if (V.state === 'ended') V.closeEnd(); }, 900);
  };
  V.closeEnd = function () { clearTimeout(V._endT); if (V.ws) V.coreCleanup(true); V.endInfo = null; V.closeFull(); V.state = 'idle'; V.engine = null; V.rerender(); };
  V.onWsClose = function () {
    if (V.wsClosing || !V.ws) return;
    V.ws = null;
    if (V.state === 'ended') return;
    if (V._readyFail) { const f = V._readyFail; V._ready = V._readyFail = null; f(Object.assign(new Error('closed'), { why: V._why || 'live' })); return; }
    if (coreLive()) { const hi = V.lang === 'hi'; V.coreCleanup(false); V.stop(true); V.rerender(); toast(V._why === 'max_call' ? (hi ? '15 मिनट हो गए — फिर से कॉल करो' : '15 minutes up — call Bro again any time') : (hi ? 'Bro की लाइन कट गई' : 'Bro hung up')); }
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
        V.said = m.text; V.pushBro(m.text, m.turn);
        if (m.noaudio) { V.noVoice = true; V.speakLine(m.text, m.lang); }
        break;
      case 'audio': V._hdr = m; break;
      case 'tool': V.runTool(m); break;
      case 'did': V.afterTool(m.name, m.args || {}, m.result || {}); break;
      case 'error':
        if (m.why === 'slow_down' || m.why === 'daily_limit' || m.why === 'bad') { V.onSkipped(m.why); break; } // the call goes on
        V._why = m.why;
        if (m.why === 'utterance_max' && V.vad.inUtt) V.uttEnd(true);
        else if (m.why === 'max_call') toast(V.lang === 'hi' ? '15 मिनट की कॉल पूरी' : 'That’s the 15-minute limit for one call');
        else if (V._readyFail && /auth|expired|used|busy|hello/.test(m.why || '')) { const f = V._readyFail; V._ready = V._readyFail = null; f(Object.assign(new Error('refused: ' + m.why), { why: m.why === 'busy' ? 'limit' : 'live' })); }
        break;
    }
  };
  // The server skipped a turn (slow_down: too soon after the last one, or too many this minute; daily_limit: today's
  // turns are used up). It answers an utterance's end or typed text, so: stop waiting for a reply, say so briefly.
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

  // ── playback: frames are scheduled back to back on the AudioContext clock (gapless); a barge-in stops them all
  V.playFrame = function (buf, h) {
    const ac = V.ac; if (!ac) return;
    const i16 = new Int16Array(buf), n = i16.length; if (!n) return;
    const ab = ac.createBuffer(1, n, 24000), ch = ab.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = i16[i] / 32768;
    const src = ac.createBufferSource(); src.buffer = ab; src.connect(V.outGain);
    const now = ac.currentTime;
    if (!V.srcs.size || V.playT < now + 0.02) V.playT = now + 0.05; // first frame (or after a gap): a small lead
    src.start(V.playT); V.playT += ab.duration;
    V.srcs.add(src); V.stats.scheduled++; V.stats.frames++;
    src.onended = () => { V.srcs.delete(src); V.stats.played++; V.checkDrain(); };
    if (V.lastEnd && h && h.turn !== V._latTurn) { V._latTurn = h.turn; const ms = Math.round(performance.now() - V.lastEnd); if (ms < 20000) { V.stats.lat.push(ms); if (V.stats.lat.length > 50) V.stats.lat.shift(); } V.lastEnd = 0; }
    if (V.state !== 'speaking' && !V.vad.inUtt) V.set('speaking');
  };
  V.stopPlayback = function () { V.srcs.forEach(s => { s.onended = null; try { s.stop(); } catch (e) {} }); V.srcs.clear(); V.playT = 0; V._hdr = null; };
  // device voice for a line Bro's own voice couldn't speak
  V.speakLine = function (text, lang) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'hi' || hasDevanagari(text) ? 'hi-IN' : 'en-IN';
    V.localN = (V.localN || 0) + 1; u.onend = u.onerror = () => { V.localN = Math.max(0, (V.localN || 1) - 1); V.checkDrain(); };
    if (!V.vad.inUtt) V.set('speaking'); speechSynthesis.speak(u);
  };
  V.stopLocal = function () { if (V.localN) { V.localN = 0; try { speechSynthesis.cancel(); } catch (e) {} } };
  // the turn is over and the last frame has played: back to listening (and open a mini-app if Bro was asked to)
  V.checkDrain = function () {
    if (V.engine !== 'core' || V.srcs.size || V.localN || !V.turnDone) return;
    if (V.pendingOpen) { const url = V.pendingOpen; V.pendingOpen = null; setTimeout(() => { V.stop(true); location.href = url; }, 250); return; }
    if (coreLive() && V.state !== 'listening' && !V.vad.inUtt) V.set('listening');
  };
  // the orb breathes with Bro's voice: analyser level → --lvl on every live orb
  V.orbLoop = function () {
    cancelAnimationFrame(V._raf);
    const data = new Uint8Array(256);
    const tick = () => {
      if (V.engine !== 'core' || !isLive()) { V._raf = 0; return; }
      let lvl = 0;
      if (V.analyser && V.srcs.size) { V.analyser.getByteTimeDomainData(data); let s = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; } lvl = Math.min(1, Math.sqrt(s / data.length) * 4); }
      V._lvl = (V._lvl || 0) * 0.6 + lvl * 0.4;
      document.querySelectorAll('.hb-orb.drv').forEach(o => o.style.setProperty('--lvl', V._lvl.toFixed(3)));
      V._raf = requestAnimationFrame(tick);
    };
    V._raf = requestAnimationFrame(tick);
  };
  V.keepAwake = async function (on) { try { if (on && navigator.wakeLock && !V._wake) V._wake = await navigator.wakeLock.request('screen'); else if (!on && V._wake) { V._wake.release(); V._wake = null; } } catch (e) {} };

  // ── voice activity: energy (adaptive noise floor) always; Silero VAD on top once it has loaded.
  //    Start: 120 ms above floor+9 dB. End: 650 ms of silence. Min 300 ms of speech. Max 30 s.
  //    Barge-in (Bro speaking or thinking): 250 ms above a higher bar, so Bro's own echo doesn't cut him off.
  V.vadReset = function () { V.vad = { floor: -60, run: 0, ring: [], inUtt: false, ms: 0, voiced: 0, quiet: 0, dbs: [], f0s: [], edges: 0, wasV: false, n: 0, q: Promise.resolve(), pend: 0 }; };
  V.vadReset();
  V.onFrame = function (d) {
    const fr = { pcm: new Int16Array(d.pcm), db: d.db, f0: d.f0 };
    const sil = V.sil;
    if (sil && sil.ok && V.vad.pend < 6) { V.vad.pend++; V.vad.q = V.vad.q.then(() => sil.run(fr.pcm)).then(p => { V.vad.pend--; V.vadStep(fr, p); }, () => { V.vad.pend--; V.vadStep(fr, null); }); }
    else V.vad.q = V.vad.q.then(() => V.vadStep(fr, null));
  };
  V.vadStep = function (fr, prob) {
    const D = V.vad; if (V.engine !== 'core' || !coreLive()) return;
    D.n++;
    const broTalking = V.srcs.size > 0 || !!V.localN, busy = broTalking || V.state === 'thinking';
    const useSil = prob != null;
    if (!D.inUtt) {
      // the noise floor: follows quiet frames quickly, loud ones very slowly; frozen while Bro talks (his echo isn't noise)
      if (fr.db < D.floor) D.floor += (fr.db - D.floor) * 0.3;
      else if (!broTalking) D.floor += (fr.db - D.floor) * (fr.db < D.floor + 6 ? 0.03 : 0.003);
      D.floor = Math.max(-80, Math.min(-28, D.floor));
      D.ring.push(fr); if (D.ring.length > 12) D.ring.shift();
      const thr = D.floor + (busy ? (useSil ? 10 : 15) : (useSil ? 4 : 9));
      const on = fr.db > thr && (!useSil || prob >= (busy ? 0.6 : 0.5));
      D.run = on ? D.run + 1 : 0;
      if (D.run * FRAME_MS >= (busy ? 250 : 120)) { if (busy) V.bargeIn(); V.uttStart(); }
      return;
    }
    V.wsSend(fr.pcm.buffer);
    D.ms += FRAME_MS;
    const voiced = fr.db > D.floor + 6 && (!useSil || prob >= 0.35);
    if (voiced) { D.voiced += FRAME_MS; D.quiet = 0; D.dbs.push(fr.db); if (fr.f0) D.f0s.push(fr.f0); if (!D.wasV) D.edges++; } else D.quiet += FRAME_MS;
    D.wasV = voiced;
    if (D.quiet >= 650 || D.ms >= 30000) V.uttEnd(D.ms >= 30000);
  };
  V.uttStart = function () {
    const D = V.vad; if (V.stats.vad.length > 200) V.stats.vad.splice(0, 100);
    D.inUtt = true; D.ms = D.ring.length * FRAME_MS; D.voiced = D.run * FRAME_MS; D.quiet = 0; D.edges = 1; D.wasV = true;
    D.dbs = D.ring.slice(-D.run).map(f => f.db); D.f0s = D.ring.slice(-D.run).map(f => f.f0).filter(Boolean);
    V.wsSend({ t: 'start' }); D.ring.forEach(f => V.wsSend(f.pcm.buffer)); D.ring = []; D.run = 0;
    V.stats.vad.push({ t: 'start', at: Date.now(), floor: Math.round(D.floor) });
    V.heard = ''; if (V.state !== 'listening') V.set('listening');
  };
  V.uttEnd = function () {
    const D = V.vad; if (!D.inUtt) return;
    D.inUtt = false; D.run = 0;
    if (D.voiced < 300) { V.wsSend({ t: 'end', discard: true }); V.stats.vad.push({ t: 'discard', at: Date.now(), ms: D.voiced }); if (V.turnDone) V.checkDrain(); return; }
    const mean = D.dbs.length ? D.dbs.reduce((a, b) => a + b, 0) / D.dbs.length : null;
    const f0 = D.f0s.slice().sort((a, b) => a - b)[D.f0s.length >> 1] || null;
    const feats = { energy: mean == null ? null : Math.round(mean * 10) / 10, pitch: f0 ? Math.round(f0) : null, rate: Math.round(D.edges / Math.max(0.3, D.ms / 1000) * 100) / 100 };
    V.wsSend({ t: 'end', feats });
    V.lastEnd = performance.now() - D.quiet; // when the voice actually stopped
    V.stats.vad.push({ t: 'end', at: Date.now(), ms: D.ms, voiced: D.voiced, feats });
    V.turnDone = false; V.set('thinking');
  };
  V.bargeIn = function () {
    V.stopPlayback(); V.stopLocal(); V.dropTurn = V.turn; V.pendingOpen = null;
    V.wsSend({ t: 'cancel' }); V.stats.barge++;
    V.stats.vad.push({ t: 'barge', at: Date.now() });
  };
  // Silero VAD (self-hosted onnxruntime-web + silero_vad_v5) — loaded after the call connects, never on data saver or
  // 2G; localStorage bro.vad = 'energy' turns it off. Until it loads, or if it fails, the energy VAD decides alone.
  V.loadSilero = function () {
    if (V.sil) return;
    let pref = ''; try { pref = localStorage.getItem('bro.vad') || ''; } catch (e) {}
    const cn = navigator.connection || {};
    if (pref === 'energy' || cn.saveData || /(^|-)2g$/.test(cn.effectiveType || '')) { V.sil = { ok: false, off: true }; return; }
    const S2 = V.sil = { ok: false, loading: true };
    const base = '/app/vendor/vad/';
    const script = () => window.ort ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = base + 'ort.wasm.min.js'; s.onload = res; s.onerror = () => rej(new Error('ort script')); document.head.appendChild(s); });
    script().then(async () => {
      const ort = window.ort; ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1; ort.env.logLevel = 'error';
      const model = await (await fetch(base + 'silero_vad_v5.onnx')).arrayBuffer();
      const sess = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      const sr = new ort.Tensor('int64', [16000n]);
      let state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]), ctx = new Float32Array(64);
      S2.run = async pcm => { // 512 samples + 64 of context from the frame before (as silero-vad does)
        const x = new Float32Array(576); x.set(ctx, 0); for (let i = 0; i < 512; i++) x[64 + i] = pcm[i] / 32768; ctx = x.slice(-64);
        const out = await sess.run({ input: new ort.Tensor('float32', x, [1, 576]), state, sr });
        state = out.stateN; const p = out.output.data[0]; S2.last = p; S2.n = (S2.n || 0) + 1; return p;
      };
      S2.ok = true; S2.loading = false; console.log('[bro] Silero VAD on');
    }).catch(e => { S2.ok = false; S2.loading = false; S2.error = String(e && e.message || e); console.warn('[bro] Silero VAD unavailable, energy VAD only:', S2.error); });
  };

  // ── Bro runs the app: client tools, run in this page without a reload; each returns a short result for Bro
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(80); } return false; };
  const story = () => { const N = window.NewsChannel, st = N && N.stories && N.stories[N.i]; if (!st) return { error: 'no story on screen' }; const hi = (N.lang === 'hi'); return { index: N.i + 1, of: N.stories.length, headline: (hi && st.headline_hi) || st.headline, summary: String((hi && st.summary_hi) || st.summary || '').slice(0, 700), source: st.source || undefined }; };
  async function newsReady() {
    if (S.tab !== 'news') switchTab('news');
    await until(() => window.NewsChannel && NewsChannel.loaded && NewsChannel.stories.length && document.getElementById('nzDeck'), 6000);
    return !!(window.NewsChannel && NewsChannel.stories && NewsChannel.stories.length);
  }
  async function refreshTasks() { const t = await api('/tasks'); if (Array.isArray(t)) { S.tasks = t; S._lastTasksHash = JSON.stringify(t); if (S.tab === 'tasks' && typeof render === 'function') render(); } return t; }
  const APPS = { games: id => '/mind/' + (id ? 'game.html?g=' + encodeURIComponent(id) : ''), python: id => (parseInt(id, 10) > 0 ? '/code/day.html?d=' + Math.min(60, parseInt(id, 10)) : '/code/'), languages: id => (/^(es|fr|de|hi|en)$/.test(id || '') ? '/lang/course.html?c=' + id : '/lang/') };
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); // tool args come from a model: never look up 'constructor'
  const TOOLS = {
    async navigate(a) {
      const tab = typeof a.tab === 'string' ? a.tab : 'bro', map = { bro: 'bro', news: 'news', steps: 'steps', tasks: 'tasks', learn: 'courses', books: 'books' };
      if (!own(map, tab)) return { error: 'unknown tab ' + tab.slice(0, 30) };
      if (S.tab !== map[tab]) switchTab(map[tab]);
      if (tab === 'learn' && a.hub && window.LearnUI && LearnUI.open) LearnUI.open(a.hub);
      return { ok: true, tab, hub: a.hub || undefined };
    },
    async news_next() { if (!(await newsReady())) return { error: 'news not loaded' }; NewsChannel.go(NewsChannel.i + 1); return story(); },
    async news_prev() { if (!(await newsReady())) return { error: 'news not loaded' }; NewsChannel.go(NewsChannel.i - 1); return story(); },
    async news_read() { if (!(await newsReady())) return { error: 'news not loaded' }; return story(); },
    async steps_walk(a) {
      if (S.tab !== 'steps') switchTab('steps');
      const T = window.StepsTab; if (!T || !T.walkStart) return { error: 'steps unavailable' };
      if (a.action === 'stop') { await T.walkStop(); return { ok: true, walking: false }; }
      await T.walkStart(); return { ok: true, walking: !!(T.walk && T.walk.on) };
    },
    async steps_log(a) {
      const n = Math.round(Number(a.steps) || 0); if (!(n > 0) || n > 20000) return { error: 'steps must be 1 to 20000' };
      const r = await api('/steps', { method: 'POST', body: JSON.stringify({ count: n, source: 'manual', app: 'other' }) });
      if (!r || r.error) return { error: (r && r.error) || 'could not save' };
      const T = window.StepsTab; if (T && r.today) { T.sum = Object.assign({}, T.sum || {}, r); try { T.rerender(); } catch (e) {} }
      return { ok: true, logged: n, today: r.today ? { counted: r.today.counted, goal: r.today.goal } : undefined };
    },
    async tasks_list() {
      const t = await refreshTasks(); if (!Array.isArray(t)) return { error: 'could not load tasks' };
      const list = t.slice().sort((x, y) => (x.status === 'done') - (y.status === 'done'));
      return { count: t.length, tasks: list.slice(0, 25).map(x => ({ id: x.id, title: x.title, done: x.status === 'done', due: x.due_date || undefined })) };
    },
    async task_edit(a) {
      if (!a.id) return { error: 'id required (call tasks_list first)' };
      const body = {}; if (a.title) body.title = String(a.title).slice(0, 200); if (typeof a.done === 'boolean') body.status = a.done ? 'done' : 'pending';
      const r = await api('/tasks/' + encodeURIComponent(a.id), { method: 'PUT', body: JSON.stringify(body) });
      if (!r || r.error) return { error: (r && r.error) || 'could not update' };
      refreshTasks(); return { ok: true, task: { id: r.id, title: r.title, done: r.status === 'done' } };
    },
    async task_delete(a) {
      if (!a.id) return { error: 'id required (call tasks_list first)' };
      const r = await api('/tasks/' + encodeURIComponent(a.id), { method: 'DELETE' });
      if (!r || r.error) return { error: (r && r.error) || 'could not delete' };
      refreshTasks(); return { ok: true, deleted: a.id };
    },
    async set_theme(a) {
      const wantDark = a.mode === 'dark', dark = S.theme === 'aurora';
      if (wantDark !== dark && typeof toggleTheme === 'function') toggleTheme();
      return { ok: true, mode: S.theme === 'aurora' ? 'dark' : 'light' };
    },
    async weather() {
      const w = S.weather || {};
      const url = w._geoLat && w._geoLon ? '/api/weather?lat=' + w._geoLat + '&lon=' + w._geoLon + (w.city ? '&name=' + encodeURIComponent(w.city) : '') : '/api/weather?city=' + encodeURIComponent(w.city || 'Bangalore');
      try {
        const j = await (await fetch(url)).json(); if (!j || j.error) return { error: (j && j.error) || 'weather unavailable' };
        const sky = c => c == null ? undefined : c === 0 ? 'clear' : c <= 3 ? 'partly cloudy' : c <= 48 ? 'foggy' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : 'thunderstorms'; // WMO codes
        const d = j.daily || {};
        return { city: j.city, temp_c: j.temp, sky: sky(j.weatherCode), aqi: j.aqi, today: d.max ? { high_c: d.max[0], low_c: d.min[0], rain_chance: (d.rain || [])[0], sky: sky((d.code || [])[0]) } : undefined, tomorrow: d.max && d.max[1] != null ? { high_c: d.max[1], low_c: d.min[1], rain_chance: (d.rain || [])[1], sky: sky((d.code || [])[1]) } : undefined };
      }
      catch (e) { return { error: 'weather unavailable' }; }
    },
    async open_app(a) {
      const f = own(APPS, a.app) ? APPS[a.app] : null; if (!f) return { error: 'unknown app' };
      V.pendingOpen = f(typeof a.id === 'string' || typeof a.id === 'number' ? String(a.id) : ''); // opens once Bro finishes this line (then the call ends)
      return { ok: true, opening: a.app, note: 'the app opens when you finish speaking; this ends the call' };
    },
  };
  V.tools = TOOLS;
  // task_delete / task_edit change the user's things: they run only when the server marked the request allowed (the
  // user asked in their own words, or confirmed). The server doesn't send them otherwise; this is the second lock.
  const GUARDED = { task_delete: 1, task_edit: 1 };
  V.runTool = async function (m) {
    const fn = own(TOOLS, m.name) ? TOOLS[m.name] : null; let result;
    const args = m.args && typeof m.args === 'object' && !Array.isArray(m.args) ? m.args : {};
    try { result = !fn ? { error: 'unknown tool ' + String(m.name).slice(0, 40) } : own(GUARDED, m.name) && m.allowed !== true ? { error: 'needs_confirmation' } : await fn(args); } catch (e) { result = { error: String(e && e.message || e) }; }
    V.stats.tools = (V.stats.tools || []).concat([{ name: m.name, args: m.args, result }]).slice(-40);
    V.wsSend({ t: 'tool_result', id: m.id, result });
  };
  // Ask Bro about something on screen (News "Ask Bro"): uses the live call when there is one, else starts one with it
  V.askAbout = function (o) {
    o = o || {};
    const ctx = 'The user wants to talk about this news story: ' + String(o.title || '').slice(0, 300) + (o.summary ? ' — ' + String(o.summary).slice(0, 900) : '');
    if (coreLive() && V.ws && V.ws.readyState === 1) { V.stopPlayback(); V.dropTurn = V.turn; V.wsSend({ t: 'context', text: ctx, ask: true }); V.renderPill(); return; }
    const ask = (V.lang === 'hi' ? 'इस खबर के बारे में बताओ: ' : 'Tell me about this story: ') + (o.title || '');
    if (isLive()) { V.send(ask); return; }
    V.unlockAudio(); V.start({ context: ctx, ask });
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
    rec.lang = V.lang === 'hi' ? 'hi-IN' : V.lang === 'en' ? 'en-IN' : (navigator.language || 'en-IN');
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
    const msgs = V.thread.slice(-10).map(m => ({ role: m.role === 'bro' ? 'assistant' : 'user', content: m.text }));
    let r; try { r = await api('/voice/turn', { method: 'POST', body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang, messages: msgs }) }); } catch (e) { r = { error: 'offline' }; }
    // a failed turn: a plain line for everyone (setup details stay in the server log / Admin), and the words come back to the box
    if (!r || r.error) { V.push('bro', V.lang === 'hi' ? 'अभी जवाब नहीं दे पाया — फिर से भेजो?' : 'I couldn’t answer just now — try again?'); V.set(V.engine ? 'live' : 'idle'); const box = document.getElementById('bvInput'); if (box && !box.value) box.value = text; return; }
    (r.actions || []).forEach(a => V.afterTool(a.tool, a.input, a.result));
    V.push('bro', r.reply);
    const wasVoice = V.engine === 'fallback' && V.state !== 'idle';
    if (wasVoice) V.speak(r.reply, () => V.listen()); else V.set(V.engine ? 'live' : 'idle');
  };
  // what a tool did, shown in the app. Screens open in place during a core call (no reload); the older engines still
  // navigate, which ends their call.
  V.afterTool = function (name, input, result) {
    if (!result) return;
    if (result.open) {
      const m = /[?&]tab=(\w+)/.exec(result.open);
      if (m && typeof switchTab === 'function') { setTimeout(() => switchTab(m[1] === 'you' ? 'profile' : m[1]), 300); return; }
      if (V.engine === 'core') { V.pendingOpen = result.open; V.checkDrain(); return; }
      setTimeout(() => { location.href = result.open; }, 900); return;
    }
    if (name === 'create_task' || name === 'complete_task') { toast(name === 'create_task' ? '✅ Task added: ' + (input.title || '') : '🎉 Done: ' + (input.title || '')); refreshTasks(); }
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
