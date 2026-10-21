// v21 "learning should be exciting" (DESIGN.md · Celebration): the shared lesson rewards for the Languages pages.
//   statsHTML(code, ui) / mountStats(el, code, ui)  the streak flame, today's goal ring (50 XP) and the course's XP;
//                                                   a mounted strip updates itself (and pops) on every 'lang-xp' event
//   xpPop(el, n)        a "+n XP" that floats up from el          combo(el, n)   the "n in a row" chip
//   sfx(kind) / buzz(kind)   window.Sfx and window.haptic when the page loaded them (sounds can be muted: muteButton)
//   cheer(kind, ui)     Bro says one of his recorded cheers (lang/data/cheers.json: yes, five, ten, done, goal, streak)
//   mascotStage(el)     Bro on the stage: .set('speaking'|'listening'|'celebrating'|'idle')
//   celebrate()         confetti + the level-up sound (lesson done, goal reached)
// Reduced motion: no pops, no confetti, no bobbing; the numbers still change.
import { stats, speak, confetti, loadJSON } from '/lang/assets/lang.js?v=15';

export const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
const CHEERS = (await loadJSON('/lang/data/cheers.json')) || { en: {}, hi: {} };
const HI = ui => ui === 'hi';
const L = (ui, en, hi) => (HI(ui) ? hi : en);

const FLAME = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.6 3.3-1.5 5-2.9 6.6C7.7 10.7 6.5 12.4 6.5 15A5.5 5.5 0 0 0 12 20.5 5.5 5.5 0 0 0 17.5 15c0-2.1-.9-3.6-1.9-4.9-.3 1.4-1 2.4-2.1 2.9.6-3.5-.2-7.3-1.5-10.5z"/></svg>';
const BOLT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M13.5 2 4.5 13.5H11L10 22l9.5-12H13z"/></svg>';
function ring(today, goal) {
  const r = 9, c = 2 * Math.PI * r, f = Math.min(1, goal ? today / goal : 0);
  return `<svg class="lx-ring" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="3"/><circle cx="12" cy="12" r="${r}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/></svg>`;
}
export function statsHTML(code, ui) {
  const s = stats(code), met = s.today >= s.goal;
  return `<div class="lx-stats" role="group" aria-label="${L(ui, 'Your progress', 'आपकी प्रगति')}">`
    + `<span class="lx-st lx-streak${s.streak ? ' on' : ''}" title="${L(ui, 'Day streak', 'दिन की स्ट्रीक')}">${FLAME}<b data-k="streak">${s.streak}</b><span class="sr">${L(ui, 'day streak', 'दिन की स्ट्रीक')}</span></span>`
    + `<span class="lx-st lx-goal${met ? ' met' : ''}" title="${L(ui, "Today's goal", 'आज का लक्ष्य')}">${ring(s.today, s.goal)}<b data-k="today">${Math.min(s.today, 999)}</b><small>/${s.goal}</small></span>`
    + `<span class="lx-st lx-xp" title="XP">${BOLT}<b data-k="course">${code ? s.course : s.total}</b><small>XP</small></span></div>`;
}
export function mountStats(el, code, ui) {
  if (!el) return;
  el.innerHTML = statsHTML(code, ui);
  addEventListener('lang-xp', e => {
    el.innerHTML = statsHTML(code, ui);
    if (!reduced) { const st = el.querySelector('.lx-stats'); if (st) { st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump'); } }
    if (e.detail && e.detail.goalReached) el.querySelector('.lx-goal')?.classList.add('just');
  });
}
export function xpPop(el, n) {
  if (!el || !n) return;
  const p = document.createElement('span'); p.className = 'lx-pop'; p.textContent = `+${n} XP`;
  if (reduced) p.classList.add('still');
  try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch { /* ignore */ }
  el.appendChild(p);
  setTimeout(() => p.remove(), 1100);
}
export function combo(el, n, ui) {
  if (!el) return;
  if (n < 2) { el.hidden = true; return; }
  el.hidden = false; el.innerHTML = `${FLAME}<b>${n}</b> ${L(ui, 'in a row', 'लगातार')}`;
  if (!reduced) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}
export const sfx = kind => { try { window.Sfx && window.Sfx.play(kind); } catch { /* sound is optional */ } };
export const buzz = kind => { try { window.haptic && window.haptic(kind); } catch { /* optional */ } };
export const muted = () => { try { return !!(window.Sfx && window.Sfx.muted()); } catch { return false; } };
// a small speaker button that mutes the lesson sounds (remembered: localStorage bd.sfx)
const SPK = on => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4a1 1 0 0 0 1 1h3l4 4V5L8 9H5a1 1 0 0 0-1 1z" fill="currentColor"/>${on ? '<path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>' : '<path d="m16 9 5 6M21 9l-5 6"/>'}</svg>`;
export function muteButton(ui) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'lx-mute press';
  const draw = () => { const m = muted(); b.innerHTML = SPK(!m); b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? L(ui, 'Sounds off', 'आवाज़ें बंद') : L(ui, 'Sounds on', 'आवाज़ें चालू')); };
  b.onclick = () => { try { window.Sfx && window.Sfx.setMuted(!muted()); } catch { /* ignore */ } draw(); };
  draw(); return b;
}
// Bro's recorded cheer (in Bro's one voice, the course clip catalog); resolves when it has been said
export function cheer(kind, ui) {
  const line = (CHEERS[HI(ui) ? 'hi' : 'en'] || {})[kind];
  if (!line || muted()) return Promise.resolve(false);
  return speak(line, { lang: HI(ui) ? 'hi-IN' : 'en-IN' });
}
export function mascotStage(el) {
  if (!el || !window.mascot) return { set() {} };
  el.innerHTML = window.mascot('idle', 72, { className: 'lx-bro' });
  let cur = 'idle';
  return { set(p) { if (p === cur) return; cur = p; try { window.mascot.set(el, p); } catch { /* ignore */ } el.classList.toggle('cheer', p === 'celebrating'); } };
}
export function celebrate() { sfx('levelup'); buzz('success'); if (!reduced) confetti(); }
