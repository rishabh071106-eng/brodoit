// Talking Bro — the voice-first home screen. Loaded by the SPA as a plain script; uses the SPA
// globals (S, api, token, toast, esc, render, switchTab). Two engines behind one UI:
//  • realtime: OpenAI Realtime over WebRTC (speech in, speech out, tools) when the server has a key
//  • fallback: browser SpeechRecognition → /api/voice/turn → browser speechSynthesis
(function () {
  'use strict';
  const V = window.BroVoice = {
    state: 'idle', // idle | connecting | live | listening | thinking | speaking | off
    engine: null,   // 'realtime' | 'fallback'
    persona: localStorage.getItem('bro.persona') || 'bro',
    lang: localStorage.getItem('bro.lang') || 'auto', // auto | en | hi
    course: localStorage.getItem('bro.course') || 'es',
    thread: [],     // {role:'user'|'bro', text, ts}
    pc: null, dc: null, mic: null, audioEl: null, rec: null, handsFree: false, partial: '',
  };
  const PERSONAS = [
    { k: 'bro', i: 'message-circle', l: 'Bro', hi: 'Bro' },
    { k: 'teacher', i: 'graduation-cap', l: 'Teach', hi: 'सिखाओ' },
    { k: 'news', i: 'radio', l: 'News', hi: 'ख़बरें' },
    { k: 'language', i: 'languages', l: 'Speak', hi: 'भाषा' },
  ];
  const QUICK = [
    ['check-square', 'Add a task', 'टास्क जोड़ो', 'Add a task: call mom at 6', 'टास्क जोड़ो: शाम 6 बजे मम्मी को कॉल'],
    ['radio', "Today's news", 'आज की ख़बरें', "What's in the news today?", 'आज की ख़बरें सुनाओ'],
    ['graduation-cap', 'Teach me', 'कुछ सिखाओ', "Explain inflation like I'm 12", 'महंगाई आसान शब्दों में समझाओ'],
    ['bell', 'Remind me', 'याद दिलाओ', 'Remind me to drink water at 3', '3 बजे पानी पीने की याद दिलाओ'],
  ];
  const COURSES = { es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', en: 'English', ja: 'Japanese' };
  const hasDevanagari = s => /[ऀ-ॿ]/.test(s || '');
  const ICON = {
    mic: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    stop: '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  };

  // ───────────────────────── UI ─────────────────────────
  V.html = function () {
    const name = ((S.user && S.user.name) || '').split(' ')[0];
    const hour = new Date().getHours();
    const live = V.state !== 'idle' && V.state !== 'off';
    const hi = V.lang === 'hi';
    const ic = (n, sz) => (window.ico ? ico(n, sz || 18) : '');
    // Bro's line — the only words on the hero: live transcript → last reply → a short hello
    const lastBro = V.thread.slice().reverse().find(m => m.role === 'bro');
    let line, partial = false;
    if (V.state === 'connecting') line = hi ? 'एक सेकंड…' : 'One sec…';
    else if (V.state === 'thinking') line = hi ? 'हम्म…' : 'Hmm…';
    else if (V.partial) { line = V.partial; partial = true; }
    else if (V.state === 'listening') line = hi ? 'बोलो, सुन रहा हूँ।' : "I'm listening.";
    else if (lastBro) line = lastBro.text;
    else line = hi ? ((name ? name + ', ' : '') + 'बोलो, क्या चल रहा है?') : ((hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening') + (name ? ', ' + name : '') + '. What\'s up?');
    const pose = V.state === 'listening' ? 'listening' : (V.state === 'speaking' || V.state === 'thinking' || V.state === 'connecting') ? 'speaking' : live ? 'listening' : 'idle';
    const face = window.mascot ? window.mascot(pose, 156, { className: 'bv-mas' }) : '<img src="/app/mascot.svg" width="156" height="156" alt="Bro">';
    let h = '<div class="bv v2">';
    h += '<div class="bv-langs">' + [['auto', 'Auto'], ['en', 'EN'], ['hi', 'हिं']].map(x => '<button class="' + (V.lang === x[0] ? 'on' : '') + '" onclick="BroVoice.setLang(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';
    h += '<div class="bv-hero' + (live ? ' live' : '') + '"><button class="bv-face" onclick="BroVoice.tapOrb()" aria-label="' + (hi ? 'Bro से बात करो' : 'Talk to Bro') + '">' + face + '</button>';
    h += '<div class="bv-say' + (partial ? ' partial' : '') + '" id="bvSay" aria-live="polite">' + esc(line) + '</div></div>';
    h += '<div class="bv-modes">' + PERSONAS.map(p => '<button class="bv-mode' + (V.persona === p.k ? ' on' : '') + '" onclick="BroVoice.setPersona(\'' + p.k + '\')">' + ic(p.i, 17) + '<b>' + (hi ? p.hi : p.l) + '</b></button>').join('') + '</div>';
    if (V.persona === 'language') h += '<div class="bv-courses">' + Object.keys(COURSES).map(c => '<button class="b-chip' + (V.course === c ? ' on' : '') + '" onclick="BroVoice.setCourse(\'' + c + '\')">' + COURSES[c] + '</button>').join('') + '<a class="b-chip" href="/lang/?course=' + V.course + '">' + ic('headphones', 16) + ' ' + (hi ? 'पाठ' : 'Lessons') + '</a></div>';
    // the mic
    h += '<div class="bv-stage"><button class="bv-orb st-' + V.state + '" onclick="BroVoice.tapOrb()" aria-label="' + (live ? 'Stop' : 'Talk') + '"><span class="bv-ring r1"></span><span class="bv-ring r2"></span><span class="bv-core"><span class="bv-bars"><i></i><i></i><i></i><i></i><i></i></span>' + (live ? '' : ICON.mic) + '</span></button>';
    if (live) h += '<button class="bv-end" onclick="BroVoice.stop()">' + ICON.stop + (hi ? ' बंद' : ' End') + '</button>';
    else h += '<div class="bv-hint">' + (hi ? 'दबाओ और बोलो' : 'Tap and talk') + '</div>';
    h += '</div>';
    if (!V.thread.length && !live) h += '<div class="bv-quick">' + QUICK.map(x => '<button onclick="BroVoice.say(\'' + (hi ? x[4] : x[3]).replace(/'/g, '\\\'') + '\')">' + ic(x[0], 16) + esc(hi ? x[2] : x[1]) + '</button>').join('') + '</div>';
    h += V.todayStrip();
    if (V.thread.length) {
      h += '<div class="bv-thread" id="bvThread">';
      V.thread.slice(-8).forEach(m => { h += '<div class="bv-msg ' + m.role + '"><div class="bv-bub">' + esc(m.text) + '</div></div>'; });
      h += '</div>';
    }
    h += '<form class="bv-compose" onsubmit="event.preventDefault();BroVoice.send()"><input id="bvInput" placeholder="' + (hi ? 'या लिखो…' : 'Or type…') + '" autocomplete="off"><button type="submit" aria-label="Send">' + ICON.send + '</button></form>';
    h += '</div>';
    return h;
  };
  V.todayStrip = function () {
    const b = V.bulletin; const hi = V.lang === 'hi'; const ic = (n, sz) => (window.ico ? ico(n, sz || 20) : '');
    const T = window.StepsTab; const sum = T && T.sum; const n = sum && sum.today ? Number(sum.today.counted) || 0 : 0; const g = sum && sum.goal ? Number(sum.goal) : 8000;
    const fmt = x => Number(x || 0).toLocaleString('en-IN');
    let h = '<div class="bv-today">';
    h += '<button class="bv-tile news" onclick="switchTab(\'news\')"><span class="bv-tile-ic">' + (b && b.audio && (b.audio.en || b.audio.hi) ? ic('play', 18) : ic('radio', 20)) + '</span><span class="bv-tile-b"><b>' + (hi ? 'ख़बरें' : 'News') + '</b><small>' + (hi ? 'आज' : 'Today') + '</small></span>' + ic('chevron-right', 18) + '</button>';
    h += '<button class="bv-tile steps" onclick="switchTab(\'steps\')"><span class="bv-tile-ic">' + (T && T.ringSVG ? T.ringSVG(sum ? Math.min(1, n / g) : 0, 36, { stroke: 5 }) : ic('footprints', 20)) + '</span><span class="bv-tile-b"><b>' + (sum ? fmt(n) : '—') + '</b><small>' + (hi ? 'कदम' : 'steps') + '</small></span>' + ic('chevron-right', 18) + '</button>';
    h += '</div>';
    if (V.bulletin === undefined) { V.bulletin = null; fetch('/api/bulletins/latest', { cache: 'no-store' }).then(r => r.json()).then(j => { V.bulletin = (j && j.daily) || null; V.rerender(); }).catch(() => {}); }
    if (T && !sum && T.loadSummary && !V._stepsAsked && token) { V._stepsAsked = true; T.loadSummary().then(() => V.rerender()).catch(() => {}); }
    return h;
  };
  V.rerender = function () { if (S.tab === 'bro' || S.tab === 'home' || !S.tab) { const root = document.getElementById('broVoiceRoot'); if (root) { root.innerHTML = V.html(); V.scroll(); } } };
  V.scroll = function () { const t = document.getElementById('bvThread'); if (t) t.scrollTop = t.scrollHeight; };
  V.set = function (st) { V.state = st; V.rerender(); };
  V.push = function (role, text) { if (!text) return; V.thread.push({ role, text, ts: Date.now() }); if (V.thread.length > 60) V.thread.shift(); V.partial = ''; V.rerender(); };
  V.setPersona = function (k) { V.persona = k; localStorage.setItem('bro.persona', k); const was = V.state; V.rerender(); if (was !== 'idle' && was !== 'off') { V.stop(true); V.start(); } };
  V.setLang = function (l) { V.lang = l; localStorage.setItem('bro.lang', l); V.rerender(); if (V.state !== 'idle' && V.state !== 'off') { V.stop(true); V.start(); } };
  V.setCourse = function (c) { V.course = c; localStorage.setItem('bro.course', c); V.rerender(); };
  V.tapOrb = function () { if (V.state === 'idle' || V.state === 'off') V.start(); else if (V.engine === 'fallback' && V.state === 'live') V.listen(); else V.stop(); };
  V.say = function (text) { V.send(text); };

  // ───────────────────────── session ─────────────────────────
  V.start = async function () {
    if (V.state === 'connecting') return;
    V.set('connecting');
    let sess;
    try { sess = await api('/voice/session', { method: 'POST', body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang }) }); } catch (e) { sess = { mode: 'fallback' }; }
    if (sess && sess.mode === 'realtime') {
      try { await V.connectRealtime(sess); return; } catch (e) { console.warn('[bro] realtime failed, falling back', e); }
    }
    V.engine = 'fallback'; V.set('live'); V.listen();
  };
  V.stop = function (silent) {
    try { if (V.dc) V.dc.close(); } catch (e) {}
    try { if (V.pc) V.pc.close(); } catch (e) {}
    try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { if (V.rec) { V.rec.onend = null; V.rec.stop(); } } catch (e) {}
    try { speechSynthesis.cancel(); } catch (e) {}
    V.pc = V.dc = V.mic = V.rec = null; V.handsFree = false; V.partial = '';
    V.state = 'idle'; if (!silent) V.rerender();
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
    if (!SR) { toast('Voice input is not supported here — type to Bro instead'); V.set('live'); return; }
    try { speechSynthesis.cancel(); } catch (e) {}
    const rec = new SR(); V.rec = rec;
    rec.lang = V.lang === 'hi' ? 'hi-IN' : V.lang === 'en' ? 'en-IN' : (navigator.language || 'en-IN');
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '';
    rec.onresult = e => { let s = ''; for (let i = e.resultIndex; i < e.results.length; i++) { s += e.results[i][0].transcript; if (e.results[i].isFinal) final += e.results[i][0].transcript; } const h = document.querySelector('.bv-hint'); if (h) h.textContent = s || 'Speak now…'; };
    rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone blocked — allow it in site settings'); };
    rec.onend = () => { V.rec = null; const text = final.trim(); if (text) V.send(text); else if (V.state === 'listening') V.set('live'); };
    V.set('listening'); try { rec.start(); } catch (e) { V.set('live'); }
  };
  V.speak = function (text, onEnd) {
    if (!('speechSynthesis' in window)) { onEnd && onEnd(); return; }
    speechSynthesis.cancel();
    const hi = hasDevanagari(text);
    const clean = text.replace(/[*_#`>]/g, '').replace(/https?:\S+/g, '');
    const chunks = clean.match(/[^.!?।\n]+[.!?।\n]*/g) || [clean];
    let i = 0; V.set('speaking');
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
    text = (text || (inp && inp.value) || '').trim(); if (!text) return;
    if (inp) inp.value = '';
    V.push('user', text);
    if (V.engine === 'realtime' && V.dc && V.dc.readyState === 'open') {
      V.rtSend({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      V.rtSend({ type: 'response.create' }); return;
    }
    V.set('thinking');
    const msgs = V.thread.slice(-10).map(m => ({ role: m.role === 'bro' ? 'assistant' : 'user', content: m.text }));
    let r; try { r = await api('/voice/turn', { method: 'POST', body: JSON.stringify({ persona: V.persona, lang: V.persona === 'language' ? COURSES[V.course] : '', speak: V.lang, messages: msgs }) }); } catch (e) { r = { error: 'offline' }; }
    if (!r || r.error) { V.push('bro', r && r.error ? r.error : 'I lost you for a second — say that again?'); V.set(V.engine ? 'live' : 'idle'); return; }
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
