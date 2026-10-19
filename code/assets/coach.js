// Bro, the coach, docked on every lesson. Knows your progress (from the server), the slide
// you are on, your code and your last error. Text only: type a question or tap one of the chips.
import { esc, md, api, token } from './lib.js';

const BRO = '<svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><defs><linearGradient id="brg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E0603F"/><stop offset="1" stop-color="#9B2F1C"/></linearGradient></defs><rect x="8" y="8" width="48" height="40" rx="14" fill="url(#brg)"/><path d="M22 48l-6 10 14-10z" fill="#9B2F1C"/><circle cx="25" cy="26" r="5" fill="#fff"/><circle cx="41" cy="26" r="5" fill="#fff"/><circle cx="26" cy="27" r="2.4" fill="#111"/><circle cx="42" cy="27" r="2.4" fill="#111"/><path d="M22 36q10 8 20 0" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg>';
const CHIPS = [
  ['Hint', 'Give me a hint for this, not the answer.'],
  ['Explain', 'Explain this slide simply, with a tiny example.'],
  ['Why error?', 'Explain my last error and how to fix it.'],
];

export function mountCoach({ context, course = 'py', button = null }) {
  const fab = button || document.createElement('button');
  if (button) fab.innerHTML = BRO;
  else { fab.className = 'bro-fab'; fab.setAttribute('aria-label', 'Ask Bro'); fab.innerHTML = BRO; }
  const sheet = document.createElement('div');
  sheet.className = 'bro-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Bro'); sheet.hidden = true;
  sheet.innerHTML = `<div class="bro-scrim" data-x></div><div class="bro-panel">
    <div class="bro-h"><div class="bro-av">${BRO}<i class="pulse"></i></div><div><b>Bro</b><small>Your Python coach</small></div>
      <button class="bro-x" data-x aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="bro-msgs" aria-live="polite"></div>
    <div class="bro-chips">${CHIPS.map(c => `<button data-q="${esc(c[1])}">${esc(c[0])}</button>`).join('')}</div>
    <form class="bro-f"><input name="q" autocomplete="off" placeholder="Ask Bro…" aria-label="Your question"><button class="bro-send" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form></div>`;
  if (!button) document.body.append(fab);
  document.body.append(sheet);
  const msgs = sheet.querySelector('.bro-msgs'), input = sheet.querySelector('input');
  const history = [];
  let busy = false, greeted = false;

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
    if (q) ask(q);
    setTimeout(() => input.focus(), 250);
  }
  function close() { if (sheet.hidden) return; sheet.classList.remove('in'); setTimeout(() => { sheet.hidden = true; }, 260); try { fab.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  // a real dialog: Escape closes it and Tab stays inside the panel
  sheet.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('button, input, a[href]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  async function ask(q) {
    q = String(q || '').trim(); if (!q || busy) return;
    if (!token()) { add('bot', 'Please sign in to Brodoit first, then I can help.'); return; }
    busy = true; add('me', esc(q)); input.value = '';
    const w = add('bot', '<span class="typing"><i></i><i></i><i></i></span>');
    try {
      const r = await api('/api/learn/coach', { course, question: q, context: context(), history: history.slice(-8) });
      w.innerHTML = md(r.reply);
      history.push({ role: 'user', content: q }, { role: 'assistant', content: r.reply });
    } catch (e) {
      w.innerHTML = e.status === 429 ? 'Give me a few seconds, too many questions at once.' : e.status === 503 ? 'I am offline right now. Try again in a little while.' : 'I could not answer that just now. Try again in a moment.';
    }
    busy = false;
  }
  fab.addEventListener('click', () => open());
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) return close();
    const c = e.target.closest('.bro-chips button'); if (c) return ask(c.dataset.q);
  });
  sheet.querySelector('form').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  window.bdCoach = { open, ask };
  return window.bdCoach;
}
