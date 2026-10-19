// Mind games engine: runs one level of one game on play.html.
// Shell (pause · title · live score) → how-to card on a game's first play → 3-2-1 → the game → results.
// Games get `api`: sfx, haptic, now/after/frame (a clock that stops while paused), timer (top bar), setScore,
// float, combo, end(result) and test(hooks) for the Playwright hook window.__mindTest.
import * as store from './store.js';
import { esc, ico, sfx, buzz, countUp, confetti, star, reduced, clamp } from './util.js';
import { art } from './art.js';

// ── stars & the 0-100 "best" number the server keeps: 40 = ★, 70 = ★★, 100 = ★★★ ──
export function starsOf(score, t, lower) {
  if (lower) return score <= t[2] ? 3 : score <= t[1] ? 2 : score <= t[0] ? 1 : 0;
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}
export function pctOf(score, t, lower) {
  const s = starsOf(score, t, lower);
  if (s === 3) return 100;
  const seg = (a, b, x) => clamp((x - a) / (b - a || 1), 0, 0.999);
  if (lower) {
    if (s === 2) return 70 + Math.floor(30 * seg(t[1], t[2], score));
    if (s === 1) return 40 + Math.floor(30 * seg(t[0], t[1], score));
    return 0;
  }
  if (s === 2) return 70 + Math.floor(30 * seg(t[1], t[2], score));
  if (s === 1) return 40 + Math.floor(30 * seg(t[0], t[1], score));
  return Math.floor(39 * clamp(score / (t[0] || 1), 0, 1));
}
export const fmtTime = v => (Math.round(v * 10) / 10).toFixed(1);
export function goalText(cfg, nStars = 1) {
  const t = cfg.targets[nStars - 1];
  return cfg.lower ? `Finish in ${t}s` : `${t} ${cfg.goalUnit || cfg.scoreLabel}`;
}

const pick = a => a[Math.floor(Math.random() * a.length)];
const PRAISE = { 3: ['Brilliant!', 'Flawless!', 'Top marks!'], 2: ['Great job!', 'Nicely done!', 'Strong round!'], 1: ['Level passed!', 'You did it!', 'Passed!'] };
const CHEER = ['Every round trains your brain. One more go?', 'You are warming up. The next try is usually better.', 'Close enough to taste it. Try again?', 'Brains grow with practice. Give it another shot!'];
const href = (g, l, w) => `/mind/play.html?g=${g}&l=${l}${w ? '&w=1' : ''}`;

export function play({ mod, level, workout: inWorkout, games }) {
  const meta = mod.meta;
  if (mod.preload) mod.preload(); // e.g. Word Builder's big word list, fetched while the how-to and 3-2-1 run
  const cfg = Object.assign({ targets: [1, 2, 3], scoreLabel: '' }, mod.levelConfig(level));
  const app = document.getElementById('app');
  const byId = id => games.find(g => g.meta.id === id);
  const w0 = store.workout(store.read());
  const wIndex = inWorkout ? Math.max(1, w0.games.indexOf(meta.id) + 1) : 0;

  document.title = `${meta.name} · Level ${level} · Mind`;
  document.body.style.setProperty('--g', meta.color);
  document.body.style.setProperty('--g-deep', meta.deep);
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.setAttribute('content', meta.color);

  app.innerHTML = `
    <header class="pl-top">
      <button class="pl-btn" id="pauseBtn" aria-label="Pause">${ico('pause', 22)}</button>
      <div class="pl-title"><b>${esc(meta.name)}</b><small>Level ${level}${inWorkout ? ` · Workout ${wIndex}/3` : ''}</small></div>
      <div class="pl-score" id="score" role="status" aria-label="Score"><b>0</b><small>${esc(cfg.scoreLabel)}</small></div>
    </header>
    <div class="pl-bar" id="bar" hidden><div class="pl-track"><i></i></div></div>
    <div class="pl-combo" id="combo" aria-hidden="true"></div>
    <main class="pl-stage" id="stage"></main>`;
  const stage = app.querySelector('#stage'), bar = app.querySelector('#bar'), scoreEl = app.querySelector('#score');
  const ov = document.getElementById('ov');

  // ── pausable clock + scheduler ──
  let paused = false, pausedAt = 0, pausedTotal = 0, phase = 'init', ended = false, activeTimer = null;
  const clock = () => (paused ? pausedAt : performance.now()) - pausedTotal;
  const jobs = new Set(), frames = new Set();
  let looping = false;
  function loop() {
    const t = clock();
    for (const j of [...jobs]) if (t >= j.at) { jobs.delete(j); try { j.fn(); } catch (e) { console.error(e); } }
    for (const f of [...frames]) { try { f(t); } catch (e) { console.error(e); } }
    if (jobs.size || frames.size) requestAnimationFrame(loop); else looping = false;
  }
  const kick = () => { if (!looping) { looping = true; requestAnimationFrame(loop); } };
  const after = (ms, fn) => { const j = { at: clock() + ms, fn }; jobs.add(j); kick(); return () => jobs.delete(j); };
  const frame = fn => { frames.add(fn); kick(); return () => frames.delete(fn); };

  // ── the top time bar (down = time left; up = time until the 1-star limit, with star marks) ──
  function timer(o) {
    const secs = o.seconds, marks = o.marks || [];
    let extra = 0, done = false, lastSec = -1;
    const t0 = clock();
    bar.hidden = false;
    bar.innerHTML = `<div class="pl-track"><i></i></div>${marks.map(m => `<span class="pl-mk" style="left:${(m.at * 100).toFixed(1)}%">${star(11).repeat(m.stars)}</span>`).join('')}`;
    const fill = bar.querySelector('i'), mks = [...bar.querySelectorAll('.pl-mk')];
    const elapsed = () => (clock() - t0) / 1000 + extra;
    const f = () => {
      if (done) return;
      const e = elapsed(), left = Math.max(0, secs - e), frac = left / secs;
      fill.style.transform = `scaleX(${frac.toFixed(4)})`;
      bar.classList.toggle('low', left <= 5);
      mks.forEach((m, i) => m.classList.toggle('gone', frac < marks[i].at));
      if (left <= 5 && left > 0) { const s = Math.ceil(left); if (s !== lastSec) { lastSec = s; sfx('tick'); } }
      if (o.onFrame) o.onFrame(e, left);
      if (left <= 0) { done = true; frames.delete(f); if (o.onEnd) o.onEnd(); }
    };
    frame(f);
    const t = {
      elapsed, left: () => Math.max(0, secs - elapsed()),
      add(s) { extra += s; bar.classList.remove('hit'); void bar.offsetWidth; bar.classList.add('hit'); },
      stop() { done = true; frames.delete(f); },
      end() { extra = secs + 1; },
    };
    activeTimer = t;
    return t;
  }

  // ── live score, floating feedback, combo banner ──
  const scoreB = scoreEl.querySelector('b'), scoreS = scoreEl.querySelector('small');
  function setScore(v, sub, quiet) {
    if (scoreB.textContent !== String(v)) scoreB.textContent = v;
    if (sub != null) scoreS.textContent = sub;
    if (!quiet) { scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump'); }
  }
  function float(text, o = {}) {
    const el = document.createElement('div');
    el.className = 'pl-fl ' + (o.tone || 'good');
    el.textContent = text;
    let x = innerWidth / 2, y = innerHeight * 0.42;
    if (o.el) { const r = o.el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + (o.dy != null ? o.dy : r.height * 0.35); }
    if (o.x != null) x = o.x; if (o.y != null) y = o.y;
    el.style.left = Math.round(clamp(x, 60, innerWidth - 60)) + 'px'; el.style.top = Math.round(y) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  const comboEl = app.querySelector('#combo');
  function combo(label) {
    comboEl.innerHTML = ico('flame', 18) + '<span>' + esc(label) + '</span>';
    comboEl.classList.remove('on'); void comboEl.offsetWidth; comboEl.classList.add('on');
    clearTimeout(comboEl._t); comboEl._t = setTimeout(() => comboEl.classList.remove('on'), 1500);
    sfx('combo'); buzz('medium');
  }

  // ── test hook ──
  const T = window.__mindTest = {
    game: meta.id, level, cfg, phase: 'init', ended: false, result: null, posted: false,
    endNow() { if (activeTimer) activeTimer.end(); else if (T.finish) T.finish(); },
  };
  const setPhase = p => { phase = p; T.phase = p; document.body.dataset.phase = p; };

  // ── end of a game → save → results ──
  function end(r) {
    if (ended) return; ended = true;
    if (activeTimer) activeTimer.stop();
    jobs.clear(); frames.clear();
    const lower = !!cfg.lower;
    let nStars = 0, pct = 0;
    if (r.failed) pct = Math.floor(39 * clamp(r.progress || 0, 0, 1));
    else { nStars = starsOf(r.score, cfg.targets, lower); pct = pctOf(r.score, cfg.targets, lower); }
    const passed = nStars > 0;
    const display = r.display != null ? r.display : (lower ? fmtTime(r.score) + 's' : String(r.score));
    const rec = store.record(meta.id, level, { pct, stars: nStars, passed, raw: r.score, rawOk: !r.failed, lower, display }, { workout: inWorkout });
    T.ended = true; T.result = { stars: nStars, pct, passed, score: r.score, unlocked: rec.unlocked };
    store.push().then(ok => { T.posted = ok; });
    setPhase('done');
    buzz(passed ? 'success' : 'warning');
    ov.innerHTML = `<div class="pl-ov pl-done"><div class="pl-done-in">${esc(r.failed ? "Time's up" : cfg.time ? 'Time!' : 'Done!')}</div></div>`;
    sfx(passed ? 'go' : 'flip');
    setTimeout(() => results(r, rec, nStars, pct, display), reduced() ? 250 : 950);
  }

  function results(r, rec, nStars, pct, display) {
    setPhase('results');
    const passed = nStars > 0, t = cfg.targets, lower = !!cfg.lower, w = rec.workout;
    const best = rec.unit, bestStars = store.starsFor(best.best || 0);
    const title = passed ? pick(PRAISE[nStars]) : pct >= 28 ? 'So close!' : 'Keep going';
    // big number
    const big = r.big != null ? r.big : r.score, bigLabel = r.bigLabel || cfg.resultLabel || cfg.scoreLabel;
    const fmtBig = r.failed ? v => String(Math.round(v)) : lower ? v => fmtTime(v) : v => String(Math.round(v));
    // chips
    let chips = '';
    if (best.rawText && (lower || best.raw > 0) && !rec.newBest && !rec.firstTime) chips += `<span class="chip">${ico('trophy', 14)} Best ${esc(best.rawText)}</span>`;
    if (bestStars > nStars) chips += `<span class="chip">Best <i class="chip-st">${star(13).repeat(bestStars)}</i></span>`;
    if (rec.newBest) chips += `<span class="chip gold">${ico('sparkles', 14)} New best</span>`;
    else if (rec.firstTime && passed) chips += `<span class="chip gold">${ico('sparkles', 14)} First clear</span>`;
    // next goal / fail meter
    let mid = '';
    if (passed && nStars < 3) mid = `<p class="res-next">${star(14)} ${esc(goalText(cfg, nStars + 1))} for ${nStars + 1} stars</p>`;
    else if (passed) mid = `<p class="res-next">${ico('crown', 16)} Perfect. All three stars.</p>`;
    else {
      const need = t[0];
      const frac = r.failed ? clamp(r.progress || 0, 0, 1) : lower ? clamp(need / Math.max(need, r.score), 0, 1) : clamp(r.score / need, 0, 1);
      const have = r.failed ? (r.haveText || '') : lower ? `${fmtTime(r.score)}s` : `${r.score}`;
      const needText = r.needText || (lower ? `${need}s or faster` : `${need}`);
      mid = `<div class="res-meter"><div class="res-meter-h"><span>You: <b>${esc(have)}</b></span><span>${star(13)} needs <b>${esc(needText)}</b></span></div>
        <div class="res-meter-t"><i style="transform:scaleX(${frac.toFixed(3)})"></i></div><p>${esc(pick(CHEER))}</p></div>`;
    }
    const unlock = rec.unlocked ? `<div class="res-unlock" id="resUnlock"><span class="ru-ic">${ico('lock-open', 20)}</span><div><b>Level ${level + 1} unlocked</b><small>${esc(meta.name)} gets a little harder</small></div></div>` : '';
    const note = r.note ? `<p class="res-note">${esc(r.note)}</p>` : '';
    const wRow = inWorkout ? `<div class="res-wo">${w.games.map(g => `<span class="${w.done.includes(g) ? 'on' : ''}" style="--g:${byId(g).meta.color}">${w.done.includes(g) ? ico('check', 14) : ''}</span>`).join('')}<small>${w.complete ? 'Workout complete' : `Workout ${w.done.length} of 3`}</small></div>` : '';

    // actions
    let primary, secondary = [];
    if (inWorkout) {
      if (w.next) { const nm = byId(w.next).meta; primary = { label: `Next: ${nm.name}`, icon: 'arrow-right', href: href(w.next, store.current(store.read(), w.next), true) }; }
      else primary = { label: 'Finish workout', icon: 'trophy', href: '/mind/?wdone=1' };
      secondary = [{ label: passed ? 'Replay' : 'Retry', icon: 'rotate-ccw', href: href(meta.id, level, true) }, { label: 'Quit', icon: 'x', href: '/mind/' }];
    } else if (passed) {
      primary = level < store.LEVELS ? { label: `Next level`, icon: 'arrow-right', href: href(meta.id, level + 1) } : { label: 'All levels done', icon: 'crown', href: `/mind/game.html?g=${meta.id}` };
      secondary = [{ label: 'Replay', icon: 'rotate-ccw', href: href(meta.id, level) }, { label: 'Levels', icon: 'chevron-left', href: `/mind/game.html?g=${meta.id}` }];
    } else {
      primary = { label: 'Retry', icon: 'rotate-ccw', href: href(meta.id, level) };
      secondary = [{ label: 'Levels', icon: 'chevron-left', href: `/mind/game.html?g=${meta.id}` }];
    }
    const btn = (b, cls) => `<a class="${cls}" href="${b.href}" data-nav>${cls === 'btn-g' ? '' : ico(b.icon, 18)}<span>${esc(b.label)}</span>${cls === 'btn-g' ? ico(b.icon, 20) : ''}</a>`;

    ov.innerHTML = `<div class="pl-ov res-ov"><section class="res${passed ? ' won' : ''}" role="dialog" aria-modal="true" aria-labelledby="resT">
      <div class="res-eyebrow">Level ${level} · ${esc(meta.name)}</div>
      <h2 id="resT" class="res-t">${esc(title)}</h2>
      <div class="res-stars" aria-label="${nStars} of 3 stars">${[0, 1, 2].map(i => `<span class="rs" data-i="${i}">${star(i === 1 ? 58 : 46)}</span>`).join('')}</div>
      <div class="res-score"><b id="resN">${esc(fmtBig(0))}</b><span>${esc(bigLabel)}</span></div>
      <div class="res-chips">${chips}</div>
      ${mid}${unlock}${note}${wRow}
      <div class="res-actions">${btn(primary, 'btn-g')}<div class="res-sec">${secondary.map(b => btn(b, 'btn-l')).join('')}</div></div>
    </section></div>`;
    const card = ov.querySelector('.res');
    // timeline: count-up → stars one by one → unlock + confetti
    setTimeout(() => countUp(ov.querySelector('#resN'), big, 900, fmtBig), 250);
    const step = reduced() ? 120 : 430;
    for (let i = 0; i < nStars; i++) setTimeout(() => { const s = card.querySelector(`.rs[data-i="${i}"]`); if (s) s.classList.add('on'); sfx('star'); buzz('light'); }, 650 + i * step);
    const after = 650 + nStars * step + 150;
    setTimeout(() => {
      if (passed) {
        const u = card.querySelector('#resUnlock');
        if (u) { u.classList.add('on'); sfx('unlock'); const r2 = u.getBoundingClientRect(); confetti(r2.left + 28, r2.top + r2.height / 2, 130); }
        else if (nStars === 3) { sfx('levelup'); const s = card.querySelector('.res-stars').getBoundingClientRect(); confetti(s.left + s.width / 2, s.top + s.height / 2, 110); }
        if (inWorkout && w.complete) setTimeout(() => sfx('levelup'), 500);
      }
    }, after);
    card.addEventListener('click', e => {
      const a = e.target.closest('[data-nav]'); if (!a) return;
      sfx('tap'); buzz('light');
      // replace, not push: system back from the next screen must never restart a finished round
      if (a.href && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.replace(a.href); }
    });
  }

  // ── overlays: how-to, countdown, pause ──
  function how() {
    return new Promise(res => {
      setPhase('how');
      ov.innerHTML = `<div class="pl-ov dim"><section class="how" role="dialog" aria-modal="true" aria-labelledby="howT">
        <div class="how-art">${art(meta.id, meta.deep)}</div>
        <div class="how-b"><div class="how-eyebrow">How to play</div><h2 id="howT">${esc(meta.name)}</h2>
        <ol>${meta.how.map(([ic, txt]) => `<li><span class="how-ic">${ico(ic, 20)}</span><span>${esc(txt)}</span></li>`).join('')}</ol>
        <div class="how-goal">${star(16)}<span>Level ${level} goal: <b>${esc(goalText(cfg, 1))}</b></span></div>
        <button class="btn-g" id="howGo"><span>Let's go</span>${ico('arrow-right', 20)}</button></div></section></div>`;
      const go = ov.querySelector('#howGo');
      go.addEventListener('click', () => { sfx('tap'); buzz('light'); store.markSeen(meta.id); res(); });
    });
  }
  function twist() {
    return new Promise(res => {
      setPhase('twist');
      ov.innerHTML = `<div class="pl-ov dim"><section class="sheet twist" role="dialog" aria-modal="true" aria-labelledby="twT">
        <div class="twist-ic">${ico('sparkles', 26)}</div><div class="how-eyebrow">New at level ${level}</div>
        <h2 id="twT">${esc(cfg.twist)}</h2>
        <button class="btn-g" id="twistGo"><span>Got it</span>${ico('arrow-right', 20)}</button></section></div>`;
      sfx('unlock');
      ov.querySelector('#twistGo').addEventListener('click', () => { sfx('tap'); buzz('light'); res(); });
    });
  }
  function countdown() {
    return new Promise(res => {
      setPhase('countdown');
      ov.innerHTML = `<div class="pl-ov cd"><div class="cd-in"><div class="cd-goal">${star(16)}<span>${esc(goalText(cfg, 1))}</span></div><b class="cd-n" id="cdN"></b><small>${esc(cfg.desc || '')}</small></div></div>`;
      const n = ov.querySelector('#cdN');
      const seq = ['3', '2', '1', 'Go'];
      let i = 0;
      const tick = () => {
        if (i >= seq.length) { ov.innerHTML = ''; res(); return; }
        n.textContent = seq[i]; n.classList.toggle('go', seq[i] === 'Go');
        n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
        if (seq[i] === 'Go') { sfx('go'); buzz('medium'); } else { sfx('tick'); buzz('select'); }
        i++; setTimeout(tick, i === seq.length ? 420 : 640);
      };
      tick();
    });
  }
  function openPause() {
    if (phase !== 'play' || paused) return;
    paused = true; pausedAt = performance.now(); setPhase('paused'); T.phase = 'paused';
    const muted = (() => { try { return window.Sfx && window.Sfx.muted(); } catch (e) { return false; } })();
    ov.innerHTML = `<div class="pl-ov dim"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="pT">
      <h2 id="pT">Paused</h2><p>Level ${level} · ${esc(meta.name)}</p>
      <button class="btn-g" data-a="resume"><span>Resume</span>${ico('play', 20)}</button>
      <div class="sheet-row"><button class="btn-l" data-a="restart">${ico('rotate-ccw', 18)}<span>Restart</span></button><button class="btn-l" data-a="quit">${ico('x', 18)}<span>Quit</span></button></div>
      <button class="sheet-snd" data-a="sound" aria-pressed="${!muted}">${ico(muted ? 'volume-x' : 'volume-high', 18)}<span>${muted ? 'Sound off' : 'Sound on'}</span></button>
    </section></div>`;
    ov.querySelector('.sheet').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'resume') closePause();
      else if (a === 'restart') location.replace(href(meta.id, level, inWorkout));
      else if (a === 'quit') location.replace(inWorkout ? '/mind/' : `/mind/game.html?g=${meta.id}`);
      else if (a === 'sound') {
        let m = false;
        try { window.Sfx.setMuted(!window.Sfx.muted()); m = window.Sfx.muted(); } catch (e2) { /* ignore */ }
        b.setAttribute('aria-pressed', String(!m));
        b.innerHTML = ico(m ? 'volume-x' : 'volume-high', 18) + `<span>${m ? 'Sound off' : 'Sound on'}</span>`;
        sfx('tap');
      }
    });
    sfx('tap');
  }
  function closePause() {
    if (!paused) return;
    pausedTotal += performance.now() - pausedAt; paused = false;
    ov.innerHTML = ''; setPhase('play'); sfx('tap'); buzz('light'); kick();
  }
  app.querySelector('#pauseBtn').addEventListener('click', () => (paused ? closePause() : openPause()));
  let pauseOnPlay = false;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) return; if (phase === 'play') openPause(); else if (phase === 'countdown') pauseOnPlay = true; });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (phase === 'play') openPause(); else if (phase === 'paused') closePause(); }
    if (e.key === 'Enter' && (phase === 'how' || phase === 'twist')) { const g = ov.querySelector('#howGo, #twistGo'); if (g) g.click(); }
    if (e.key === 'Enter' && phase === 'results') { const p = ov.querySelector('.btn-g'); if (p && document.activeElement !== p) p.click(); }
  });

  const api = {
    meta, cfg, level, stage,
    sfx, haptic: buzz, now: clock, after, frame, timer,
    setScore, float, combo, end,
    get paused() { return paused; },
    test(h) { Object.assign(T, h); },
  };

  (async () => {
    const p = store.read();
    if (!p.seen[meta.id]) await how();
    else if (cfg.twist && !store.unit(p, meta.id, level)) await twist();
    await countdown();
    setPhase('play');
    mod.start(stage, cfg, api);
    if (pauseOnPlay || document.hidden) openPause();
  })();
}
