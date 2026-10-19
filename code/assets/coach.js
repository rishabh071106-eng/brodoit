// Bro, the coach, docked on every lesson. Knows your progress (from the server), the slide
// you are on, your code and your last error. Ask by typing or by voice; replies can be spoken.
import { esc, md, api, token, stopVoice } from './lib.js';

const BRO = '<svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><defs><linearGradient id="brg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E0603F"/><stop offset="1" stop-color="#9B2F1C"/></linearGradient></defs><rect x="8" y="8" width="48" height="40" rx="14" fill="url(#brg)"/><path d="M22 48l-6 10 14-10z" fill="#9B2F1C"/><circle cx="25" cy="26" r="5" fill="#fff"/><circle cx="41" cy="26" r="5" fill="#fff"/><circle cx="26" cy="27" r="2.4" fill="#111"/><circle cx="42" cy="27" r="2.4" fill="#111"/><path d="M22 36q10 8 20 0" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg>';
const CHIPS = [
  ['Hint', 'Give me a hint for this, not the answer.'],
  ['Explain', 'Explain this slide simply, with a tiny example.'],
  ['Why error?', 'Explain my last error and how to fix it.'],
];

export function mountCoach({ context, course = 'py', lang = 'en', button = null }) {
  const fab = button || document.createElement('button');
  if (button) fab.innerHTML = BRO;
  else { fab.className = 'bro-fab'; fab.setAttribute('aria-label', 'Ask Bro'); fab.innerHTML = BRO; }
  const sheet = document.createElement('div');
  sheet.className = 'bro-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Bro'); sheet.hidden = true;
  sheet.innerHTML = `<div class="bro-scrim" data-x></div><div class="bro-panel">
    <div class="bro-h"><div class="bro-av">${BRO}<i class="pulse"></i></div><div><b>Bro</b></div>
      <button class="bro-spk" aria-label="Speak replies" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>
      <button class="bro-x" data-x aria-label="Close">✕</button></div>
    <div class="bro-msgs" aria-live="polite"></div>
    <div class="bro-chips">${CHIPS.map(c => `<button data-q="${esc(c[1])}">${esc(c[0])}</button>`).join('')}</div>
    <form class="bro-f"><button type="button" class="bro-mic" aria-label="Speak your question"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg></button>
      <input name="q" autocomplete="off" placeholder="Ask Bro…" aria-label="Your question"><button class="bro-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form></div>`;
  if (!button) document.body.append(fab);
  document.body.append(sheet);
  const msgs = sheet.querySelector('.bro-msgs'), input = sheet.querySelector('input'), spk = sheet.querySelector('.bro-spk');
  const history = [];
  let speakReplies = false, busy = false, greeted = false;

  function add(role, html) {
    const d = document.createElement('div'); d.className = 'bro-m ' + role; d.innerHTML = html; msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight; return d;
  }
  async function greet() {
    if (greeted) return; greeted = true;
    if (!token()) { add('bot', 'Sign in to Brodoit and I will remember your progress and answer your questions.'); return; }
    const w = add('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    try { const r = await api('/api/learn/coach', { course, context: context(), greet: true }); w.innerHTML = md(r.reply); }
    catch (e) { w.innerHTML = 'Hey! Ask me anything about this lesson.'; }
  }
  function open(q) {
    sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('in'));
    greet();
    if (q) ask(q); else setTimeout(() => input.focus(), 250);
  }
  function close() { sheet.classList.remove('in'); setTimeout(() => { sheet.hidden = true; }, 260); }
  async function ask(q, viaVoice) {
    q = String(q || '').trim(); if (!q || busy) return;
    if (!token()) { add('bot', 'Please sign in to Brodoit first, then I can help.'); return; }
    busy = true; add('me', esc(q)); input.value = '';
    const w = add('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    try {
      const r = await api('/api/learn/coach', { course, question: q, context: context(), history: history.slice(-8) });
      w.innerHTML = md(r.reply);
      history.push({ role: 'user', content: q }, { role: 'assistant', content: r.reply });
      if (speakReplies || viaVoice) say(r.reply);
    } catch (e) {
      w.innerHTML = e.status === 429 ? 'Give me a few seconds, too many questions at once.' : e.status === 503 ? 'My brain is offline right now (no AI key). Try again later.' : 'I could not answer that just now. Try again in a moment.';
    }
    busy = false;
  }
  async function say(text) {
    stopVoice();
    try {
      const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': token() }, body: JSON.stringify({ text: text.replace(/[`*#_]/g, '').slice(0, 900), lang }) });
      if (!r.ok) throw new Error(r.status);
      const a = new Audio(URL.createObjectURL(await r.blob())); a.play();
    } catch (e) {
      try { const u = new SpeechSynthesisUtterance(text.replace(/[`*#_]/g, '')); u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; speechSynthesis.speak(u); } catch (er) { /* ignore */ }
    }
  }
  fab.addEventListener('click', () => open());
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) return close();
    const c = e.target.closest('.bro-chips button'); if (c) return ask(c.dataset.q);
  });
  spk.addEventListener('click', () => { speakReplies = !speakReplies; spk.setAttribute('aria-pressed', String(speakReplies)); spk.classList.toggle('on', speakReplies); });
  sheet.querySelector('form').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = sheet.querySelector('.bro-mic');
  if (!SR) mic.hidden = true;
  else mic.addEventListener('click', () => {
    const rec = new SR(); rec.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; rec.interimResults = true;
    mic.classList.add('on'); let text = '';
    rec.onresult = ev => { text = [...ev.results].map(r => r[0].transcript).join(' '); input.value = text; };
    rec.onend = () => { mic.classList.remove('on'); if (text.trim()) ask(text, true); };
    rec.onerror = () => mic.classList.remove('on');
    try { rec.start(); } catch (e) { mic.classList.remove('on'); }
  });
  window.bdCoach = { open, ask };
  return window.bdCoach;
}
