// The Python course page (/code/), built from the app's framework (app/ui.css, /DESIGN.md) so it reads like the
// Learn → Coding list that opens it: back chevron + large title, one card with the one action (continue the
// current day), then the 60 days as list rows in six parts. A row is a numbered tile (done = check), the day's
// title and one status line; locked days are muted and say which day to finish first.
import { esc, progress, syncProgress, param, token, starsOf, totalStars, calm } from './lib.js';
import { mountCoach } from './coach.js';
import * as PY from './runner.js';

const TOTAL = 60;
const root = document.getElementById('map'), bar = document.getElementById('bar'), bigTitle = document.querySelector('.cm-top h1');
const svg = (d, s = 20, w = 2, fill = false) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const I = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  star: '<path d="M11.5 2.3a.55.55 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.55.55 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.55.55 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0L6.4 21a.55.55 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.55.55 0 0 1 .3-.9l5.2-.8a2.1 2.1 0 0 0 1.6-1.2z"/>',
  msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
};
const plain = t => String(t || '').replace(/^Project:\s*/, '');
const starRow = n => `<span class="cm-stars" aria-hidden="true">${[0, 1, 2].map(k => `<i${k < n ? ' class="on"' : ''}>${svg(I.star, 12, 0, true)}</i>`).join('')}</span>`;

let IDX = null, P = progress.read();
const days = document.createElement('div'); // the part that redraws when progress changes

async function main() {
  try { IDX = await (await fetch('/code/days/index.json', { cache: 'no-cache' })).json(); }
  catch (e) { root.removeAttribute('aria-busy'); root.innerHTML = '<section class="ui-card"><h2>Could not load the course</h2><p>Check your connection and try again.</p></section>'; return; }
  root.innerHTML = ''; root.removeAttribute('aria-busy');
  root.append(days, help());
  if (param('dev') === '1') root.append(devUnlock());
  render();
  // ?from=N: back from a finished day (scroll to the next one); ?locked=N: a day opened too early
  const from = +param('from') || 0, locked = +param('locked') || 0;
  if (from || locked) history.replaceState(null, '', '/code/' + (param('dev') === '1' ? '?dev=1' : ''));
  if (locked > 1) toast(`Finish Day ${locked - 1} first`);
  if (token()) {
    const before = JSON.stringify(P);
    P = await syncProgress();
    if (JSON.stringify(P) !== before) render();
  }
  // a returning learner lands on their day (only if they have not started scrolling themselves)
  const target = from ? Math.min(TOTAL, from + 1) : progress.current(P, TOTAL);
  if (target > 1 && scrollY < 8) reveal(target);
  setTimeout(() => PY.warm(), 1500); // Python is ready by the time a lesson opens
}

function render() {
  const list = IDX.list || [], byDay = new Map(list.map(d => [d.day, d]));
  let h = card(byDay);
  for (const ph of IDX.phases || []) h += part(ph, byDay);
  days.innerHTML = h;
}

// The one card: where you are and the one thing to do next.
function card(byDay) {
  const done = progress.doneCount(P), cur = progress.current(P, TOTAL), m = byDay.get(cur);
  const all = done >= TOTAL && !!(P.days['d' + TOTAL] || {}).done;
  const started = done > 0 || !!(P.days['d' + cur] && P.days['d' + cur].slide);
  const stars = totalStars(P), mins = m && m.minutes ? ` · ${m.minutes} min` : '';
  const title = all ? 'Course complete' : m ? esc(plain(m.title)) : `Day ${cur}`;
  const kick = all ? `All ${TOTAL} days done` : (started ? `Day ${cur} of ${TOTAL}` : 'Start here') + mins;
  // before the first finished day the card says what the day is about; after it, how far you are
  const meta = done ? `${done} of ${TOTAL} days · ${stars} ${stars === 1 ? 'star' : 'stars'}` : m && m.subtitle ? esc(m.subtitle) : `${TOTAL} days · From zero`;
  const btn = all
    ? `<a class="ui-btn wide ghost cm-go" id="go" href="/code/day.html?d=${TOTAL}">Review Day ${TOTAL}</a>`
    : `<a class="ui-btn wide cm-go" id="go" href="/code/day.html?d=${cur}" aria-label="${started ? 'Continue' : 'Start'}: Day ${cur}, ${title}">${started ? 'Continue' : 'Start'}</a>`;
  return `<section class="ui-card cm-now" aria-labelledby="cmNowT">
    <p class="cm-kick">${kick}</p>
    <h2 id="cmNowT">${title}</h2>
    ${done ? `<span class="ui-prog" style="--ui-accent:var(--g-python)" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${done}"><i style="width:${(done / TOTAL) * 100}%"></i></span>` : ''}
    <p class="cm-meta">${meta}</p>
    ${btn}
  </section>`;
}

// One part of the course: a section label and its ten days as rows.
function part(ph, byDay) {
  const cur = progress.current(P, TOTAL);
  let rows = '';
  for (let d = ph.from; d <= ph.to; d++) rows += row(d, byDay.get(d), cur);
  return `<section class="cm-part" aria-labelledby="cmP${ph.n}"><h2 class="ui-sec" id="cmP${ph.n}">Part ${ph.n} · ${esc(ph.title)}</h2><div class="ui-list">${rows}</div></section>`;
}

function row(d, m, cur) {
  const st = P.days['d' + d] || {}, open = progress.open(P, d), isDone = !!st.done, isCur = d === cur && !isDone;
  const proj = !!(m && m.project), title = m ? esc(plain(m.title)) : 'Coming soon', mins = m && m.minutes ? `${m.minutes} min` : '';
  const s = isDone ? starsOf(st) : 0;
  let status, said;
  if (isDone) { status = 'Done · ' + starRow(s); said = `done, ${s} of 3 stars`; }
  else if (isCur) { status = (st.slide ? 'In progress' : 'Next') + (mins ? ' · ' + mins : ''); said = st.slide ? 'in progress' : 'up next'; }
  else if (open) { status = mins || 'Open'; said = 'open'; }
  else { status = 'Locked'; said = 'locked'; }
  if (proj) status = 'Project · ' + status;
  const cls = isDone ? 'done' : isCur ? 'cur' : open ? 'open' : 'locked';
  const inner = `<span class="ui-ic cm-n" aria-hidden="true">${isDone ? svg(I.check, 22, 2.6) : `<b>${d}</b>`}</span>`
    + `<span class="ui-tx"><b>${title}</b><small>${status}</small></span>`
    + (open ? `<span class="ui-chev">${svg(I.chev, 18)}</span>` : '');
  const label = `Day ${d}: ${title}${proj ? ', project' : ''}, ${said}`;
  return open
    ? `<a class="ui-row cm-day ${cls}${proj ? ' proj' : ''}" href="/code/day.html?d=${d}" data-day="${d}" aria-label="${label}"${isCur ? ' aria-current="step"' : ''}>${inner}</a>`
    : `<button type="button" class="ui-row cm-day locked${proj ? ' proj' : ''}" data-day="${d}" aria-disabled="true" aria-label="${label}">${inner}</button>`;
}

// Help at the very bottom: Bro, the coach, in a sheet over this page (same as in a lesson).
function help() {
  const sec = document.createElement('section');
  sec.className = 'cm-part cm-help'; sec.setAttribute('aria-labelledby', 'cmHelp');
  sec.innerHTML = '<h2 class="ui-sec" id="cmHelp">Help</h2><div class="ui-list"><button type="button" class="ui-row" id="askBro"></button></div>';
  const b = sec.querySelector('#askBro');
  mountCoach({ context: () => ({ course: 'py', unit: 'map', day: progress.current(P, TOTAL), slide: null }), button: b });
  // mountCoach puts Bro's face on the button; the row keeps the framework look instead
  b.innerHTML = `<span class="ui-ic" style="--ui-accent:var(--b-primary)" aria-hidden="true">${svg(I.msg, 22)}</span><span class="ui-tx"><b>Ask Bro</b><small>Any question about Python</small></span><span class="ui-chev">${svg(I.chev, 18)}</span>`;
  return sec;
}

// For testing only (/code/?dev=1): open every day.
function devUnlock() {
  const box = document.createElement('div'); box.className = 'cm-dev';
  const paint = () => { box.innerHTML = `<button type="button" class="ui-btn ghost sm" id="unlock">${P.unlockAll ? 'Lock days again' : 'Unlock all days'}</button>`; };
  box.addEventListener('click', e => {
    if (!e.target.closest('#unlock')) return;
    const p = progress.read(); p.unlockAll = !p.unlockAll; progress.write(p); P = p; render(); paint();
  });
  paint();
  return box;
}

// A locked day is a button, not a link: it says which day opens it.
root.addEventListener('click', e => {
  const r = e.target.closest('.cm-day[aria-disabled="true"]');
  if (!r) return;
  e.preventDefault();
  toast(`Finish Day ${r.dataset.day - 1} first`);
});

// Bring a day's row into view (clear of the slim bar), unless it is already on screen.
function reveal(d) {
  const el = days.querySelector(`.cm-day[data-day="${d}"]`); if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top >= 72 && r.bottom <= innerHeight - 16) return;
  el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
}

function toast(t) {
  document.querySelectorAll('.cm-toast').forEach(x => x.remove());
  const d = document.createElement('div'); d.className = 'cm-toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 250); }, 3000);
}

// the slim bar shows once the large title has scrolled away
const onScroll = () => { if (bar && bigTitle) bar.classList.toggle('on', bigTitle.getBoundingClientRect().bottom < 44); };
addEventListener('scroll', onScroll, { passive: true });
onScroll();

main();
