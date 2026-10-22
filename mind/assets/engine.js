// Mind games engine: runs one level of one game on play.html.
// Shell (pause · level · live score) → how-to card on a game's first play → 3-2-1 → the game → results.
// v15: calm, neutral dark play surface; the game accent only on interactive parts and the timer line.
// Games get `api`: sfx, haptic, now/after/frame (a clock that stops while paused), timer (top bar), setScore,
// float, combo, end(result) and test(hooks) for the Playwright hook window.__mindTest.
import * as store from './store.js';
import { esc, ico, sfx, buzz, countUp, star, reduced, clamp, HI, tr, rawText } from './util.js';
import { icon } from './art.js';

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
  if (HI) return cfg.lower ? `${t} सेकंड में पूरा करें` : `${t} ${cfg.goalUnit || cfg.scoreLabel}`;
  return cfg.lower ? `Finish in ${t}s` : `${t} ${cfg.goalUnit || cfg.scoreLabel}`;
}

const CHEER = tr('Try again.', 'फिर कोशिश करें।');
// "Title. Detail." → [title, detail] (Hindi: "शीर्षक। ब्योरा।")
const split = t => { const m = /\. |। /.exec(String(t)), i = m ? m.index : -1; return i < 0 ? [String(t).replace(/[.।]$/, ''), ''] : [t.slice(0, i), t.slice(i + 2)]; };
// a solid two-bar pause glyph (reads better at 20px on the dark header than an outlined one)
const PAUSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.3"/><rect x="14" y="5" width="4" height="14" rx="1.3"/></svg>';
// where a workout ends (and where quitting one goes): the app's Learn → Games list
const HUB = '/?tab=learn&hub=games';
// v21: inside Brodoit's layer an exit to the app closes the layer (app/inframe.js); on its own the page replaces itself
const go = url => (window.bdGo ? window.bdGo(url, { replace: true }) : location.replace(url));
const href = (g, l, w) => `/mind/play.html?g=${g}&l=${l}${w ? '&w=1' : ''}`;

export function play({ mod, level, workout: inWorkout, games }) {
  const meta = mod.meta;
  if (mod.preload) mod.preload(); // e.g. Word Builder's big word list, fetched while the how-to and 3-2-1 run
  const cfg = Object.assign({ targets: [1, 2, 3], scoreLabel: '' }, mod.levelConfig(level));
  const app = document.getElementById('app');
  const byId = id => games.find(g => g.meta.id === id);
  const w0 = store.workout(store.read());
  const wIndex = inWorkout ? Math.max(1, w0.games.indexOf(meta.id) + 1) : 0;

  document.title = HI ? `${meta.name} · लेवल ${level} · गेम्स` : `${meta.name} · Level ${level} · Mind`;
  document.body.style.setProperty('--g', meta.color);
  document.body.style.setProperty('--g-deep', meta.deep);
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.setAttribute('content', '#121214');

  app.innerHTML = `
    <header class="pl-top">
      <button class="pl-btn" id="pauseBtn" aria-label="${tr('Pause', 'रोकें')}">${PAUSE}</button>
      <div class="pl-title"><b>${tr('Level', 'लेवल')} ${level}</b><small id="plSub" aria-live="polite">${esc(meta.name)}${inWorkout ? (HI ? ` · 3 में से ${wIndex}` : ` · ${wIndex} of 3`) : ''}</small></div>
      <div class="pl-score" id="score" role="status" aria-label="${tr('Score', 'अंक')}"><b>0</b><small>${esc(cfg.scoreLabel)}</small></div>
    </header>
    <div class="pl-bar" id="bar" hidden><div class="pl-track"><i></i></div></div>
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
    bar.innerHTML = `<div class="pl-track"><i></i></div>${marks.map(m => `<span class="pl-mk" style="left:${(m.at * 100).toFixed(1)}%" title="${m.stars} ${tr('stars', 'स्टार')}"></span>`).join('')}`;
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
    setTimeout(() => el.remove(), 800);
  }
  // a short status note ("5 in a row") takes the subtitle's place under "Level N" for a moment
  const subEl = app.querySelector('#plSub'), subText = subEl.textContent;
  function combo(label) {
    subEl.textContent = label; subEl.classList.remove('note'); void subEl.offsetWidth; subEl.classList.add('note');
    clearTimeout(subEl._t); subEl._t = setTimeout(() => { subEl.textContent = subText; subEl.classList.remove('note'); }, 1600);
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
    ov.innerHTML = `<div class="pl-ov pl-done"><div class="pl-done-in">${esc(r.failed ? tr("Time's up", 'समय ख़त्म') : cfg.time ? tr('Time', 'समय पूरा') : tr('Done', 'हो गया'))}</div></div>`;
    sfx(passed ? 'go' : 'flip');
    setTimeout(() => results(r, rec, nStars, pct, display), reduced() ? 250 : 800);
  }

  function results(r, rec, nStars, pct, display) {
    setPhase('results');
    const passed = nStars > 0, t = cfg.targets, lower = !!cfg.lower, w = rec.workout;
    const best = rec.unit, bestStars = store.starsFor(best.best || 0);
    const title = passed ? (HI ? `लेवल ${level} पास` : `Level ${level} passed`) : tr('Not passed', 'पास नहीं हुआ'); // say what happened (DESIGN.md: no praise words)
    // the number
    const big = r.big != null ? r.big : r.score, bigLabel = r.bigLabel || cfg.resultLabel || cfg.scoreLabel;
    const fmtBig = r.failed ? v => String(Math.round(v)) : lower ? v => fmtTime(v) : v => String(Math.round(v));
    // at most one chip
    let chip = '';
    if (rec.newBest) chip = tr('New best', 'नया रिकॉर्ड');
    else if (best.rawText && (lower || best.raw > 0) && !rec.firstTime) chip = HI ? `सबसे अच्छा ${rawText(best.rawText)}` : `Best ${best.rawText}`;
    else if (bestStars > nStars) chip = HI ? `सबसे अच्छा ${bestStars} स्टार` : `Best ${bestStars} star${bestStars === 1 ? '' : 's'}`;
    // next star, or how far from a pass
    let mid = '';
    if (passed && nStars < 3) mid = HI ? `<p class="res-next">${nStars + 1} स्टार के लिए ${esc(goalText(cfg, nStars + 1))}</p>` : `<p class="res-next">${esc(goalText(cfg, nStars + 1))} for ${nStars + 1} stars</p>`;
    else if (!passed) {
      const need = t[0];
      const frac = r.failed ? clamp(r.progress || 0, 0, 1) : lower ? clamp(need / Math.max(need, r.score), 0, 1) : clamp(r.score / need, 0, 1);
      const line = HI
        ? (r.needText ? `पास होने के लिए ${r.needText}।` : lower ? `पास होने के लिए ${goalText(cfg, 1)}।` : `पास होने के लिए ${goalText(cfg, 1)} चाहिए।`)
        : r.needText ? `${r.needText} to pass.` : lower ? `${goalText(cfg, 1)} to pass.` : `Get ${goalText(cfg, 1)} to pass.`;
      mid = `<div class="res-meter"><div class="res-meter-t" aria-hidden="true"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><p>${esc(line)} ${CHEER}</p></div>`;
    }
    let nextDesc = '';
    if (rec.unlocked) { try { nextDesc = mod.levelConfig(level + 1).desc || ''; } catch (e) { /* ignore */ } }
    const unlock = rec.unlocked ? `<div class="res-unlock" id="resUnlock"><span class="ru-ic">${ico('lock-open', 18)}</span><div><b>${HI ? `लेवल ${level + 1} खुल गया` : `Level ${level + 1} unlocked`}</b>${nextDesc ? `<small>${esc(nextDesc)}</small>` : ''}</div></div>` : '';
    const note = r.note && !passed ? `<p class="res-note">${esc(r.note)}</p>` : ''; // the detail helps after a miss; a pass needs no footnote
    const wRow = inWorkout ? `<div class="res-wo">${w.games.map(g => `<span class="${w.done.includes(g) ? 'on' : ''}" style="--wc:${byId(g).meta.color}"></span>`).join('')}<small>${w.complete ? tr('Workout done', 'वर्कआउट पूरा') : HI ? `वर्कआउट: 3 में से ${w.done.length}` : `Workout ${w.done.length} of 3`}</small></div>` : '';

    // actions: one primary, then a quiet secondary and a ghost
    let primary, secondary = [];
    if (inWorkout) {
      if (w.next) { const nm = byId(w.next).meta; primary = { label: `${tr('Next:', 'अगला:')} ${nm.name}`, href: href(w.next, store.current(store.read(), w.next), true) }; }
      else primary = { label: tr('Finish workout', 'वर्कआउट पूरा करें'), href: HUB };
      secondary = [{ label: passed ? tr('Replay', 'फिर खेलें') : tr('Retry', 'फिर कोशिश करें'), href: href(meta.id, level, true), cls: 'sec' }, { label: tr('Quit', 'छोड़ें'), href: HUB, cls: 'ghost' }];
    } else if (passed) {
      primary = level < store.LEVELS ? { label: tr('Next level', 'अगला लेवल'), href: href(meta.id, level + 1) } : { label: tr('All levels done', 'सभी लेवल पूरे'), href: `/mind/game.html?g=${meta.id}` };
      secondary = [{ label: tr('Replay', 'फिर खेलें'), href: href(meta.id, level), cls: 'sec' }, { label: tr('Levels', 'लेवल देखें'), href: `/mind/game.html?g=${meta.id}`, cls: 'ghost' }];
    } else {
      primary = { label: tr('Retry', 'फिर कोशिश करें'), href: href(meta.id, level) };
      secondary = [{ label: tr('Levels', 'लेवल देखें'), href: `/mind/game.html?g=${meta.id}`, cls: 'ghost' }];
    }
    const btn = (b, cls) => `<a class="ui-btn ${cls}" href="${b.href}" data-nav>${esc(b.label)}</a>`;

    ov.innerHTML = `<div class="pl-ov res-ov"><section class="res${passed ? ' won' : ''}" role="dialog" aria-modal="true" aria-labelledby="resT">
      <p class="res-eyebrow">${tr('Level', 'लेवल')} ${level} · ${esc(meta.name)}</p>
      <h2 id="resT" class="res-t">${esc(title)}</h2>
      <div class="res-score"><b id="resN">${esc(fmtBig(0))}</b><span>${esc(bigLabel)}</span></div>
      <div class="res-stars" role="img" aria-label="${HI ? `3 में से ${nStars} स्टार` : `${nStars} of 3 stars`}">${[0, 1, 2].map(i => `<span class="rs" data-i="${i}">${star(26)}</span>`).join('')}</div>
      ${chip ? `<p class="res-chips"><span class="chip">${esc(chip)}</span></p>` : ''}
      ${mid}${unlock}${note}${wRow}
      <div class="res-actions pl-act">${btn(primary, 'wide m-pri')}<div class="res-sec">${secondary.map(b => btn(b, b.cls)).join('')}</div></div>
    </section></div>`;
    const card = ov.querySelector('.res');
    footer(card);
    // timeline: count-up → stars fill one by one → unlock row fades in
    setTimeout(() => countUp(ov.querySelector('#resN'), big, 600, fmtBig), 150);
    const step = reduced() ? 60 : 180;
    for (let i = 0; i < nStars; i++) setTimeout(() => { const s = card.querySelector(`.rs[data-i="${i}"]`); if (s) s.classList.add('on'); sfx('star'); buzz('light'); }, 450 + i * step);
    setTimeout(() => {
      if (!passed) return;
      const u = card.querySelector('#resUnlock');
      if (u) { u.classList.add('on'); sfx('unlock'); }
      else if (nStars === 3) sfx('levelup');
      if (inWorkout && w.complete) setTimeout(() => sfx('levelup'), 400);
    }, 450 + nStars * step + 100);
    card.addEventListener('click', e => {
      const a = e.target.closest('[data-nav]'); if (!a) return;
      sfx('tap'); buzz('light');
      // replace, not push: system back from the next screen must never restart a finished round
      if (a.href && !e.metaKey && !e.ctrlKey && !e.defaultPrevented) { e.preventDefault(); go(a.href); }
    });
  }

  // ── overlays: how-to, countdown, pause ──
  // A card's actions live in a sticky .pl-act footer (mind.css), so they stay on screen when a short screen makes
  // the card scroll; .under marks "content is scrolled under the footer" for its hairline.
  function footer(card) {
    if (!card) return;
    const f = () => card.classList.toggle('under', card.scrollHeight - card.clientHeight - card.scrollTop > 1);
    card.addEventListener('scroll', f, { passive: true });
    try { new ResizeObserver(f).observe(card); } catch (e) { /* older browsers: the footer still sticks */ }
    f();
  }
  function how() {
    return new Promise(res => {
      setPhase('how');
      const lines = (meta.how || []).slice(0, 2).map(x => (Array.isArray(x) ? x[1] : x));
      ov.innerHTML = `<div class="pl-ov dim"><section class="how" role="dialog" aria-modal="true" aria-labelledby="howT">
        <span class="ui-ic how-ic" style="--ui-accent:var(--g-ui)">${icon(meta.id, 26)}</span>
        <p class="how-eyebrow">${tr('How to play', 'कैसे खेलें')}</p>
        <h2 id="howT">${esc(meta.name)}</h2>
        <ol class="how-list">${lines.map((t, i) => `<li><span class="how-n" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>
        <p class="how-goal"><span>${HI ? `लेवल ${level} का लक्ष्य` : `Level ${level} goal`}</span><b>${esc(goalText(cfg, 1))}</b></p>
        <div class="pl-act"><button class="ui-btn wide m-pri" id="howGo">${tr('Start', 'शुरू करें')}</button></div></section></div>`;
      footer(ov.querySelector('.how'));
      const go = ov.querySelector('#howGo');
      go.addEventListener('click', () => { sfx('tap'); buzz('light'); store.markSeen(meta.id); res(); });
    });
  }
  function twist() {
    return new Promise(res => {
      setPhase('twist');
      const [tt, detail] = split(cfg.twist);
      ov.innerHTML = `<div class="pl-ov dim"><section class="sheet twist" role="dialog" aria-modal="true" aria-labelledby="twT">
        <p class="how-eyebrow">${HI ? `लेवल ${level} में नया` : `New at level ${level}`}</p>
        <h2 id="twT">${esc(tt)}</h2>${detail ? `<p class="twist-d">${esc(detail)}</p>` : ''}
        <div class="pl-act"><button class="ui-btn wide m-pri" id="twistGo">${tr('Continue', 'जारी रखें')}</button></div></section></div>`;
      footer(ov.querySelector('.twist'));
      sfx('unlock');
      ov.querySelector('#twistGo').addEventListener('click', () => { sfx('tap'); buzz('light'); res(); });
    });
  }
  function countdown() {
    return new Promise(res => {
      setPhase('countdown');
      ov.innerHTML = `<div class="pl-ov cd"><div class="cd-in"><p class="cd-goal">${tr('Goal', 'लक्ष्य')} · ${esc(goalText(cfg, 1))}</p><b class="cd-n" id="cdN" aria-live="assertive"></b><small>${esc(cfg.desc || '')}</small></div></div>`;
      const n = ov.querySelector('#cdN');
      const seq = ['3', '2', '1'];
      let i = 0;
      const tick = () => {
        if (i >= seq.length) { ov.innerHTML = ''; sfx('go'); buzz('medium'); res(); return; }
        n.textContent = seq[i];
        n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
        sfx('tick'); buzz('select');
        i++; setTimeout(tick, 640);
      };
      tick();
    });
  }
  function openPause() {
    if (phase !== 'play' || paused) return;
    paused = true; pausedAt = performance.now(); setPhase('paused'); T.phase = 'paused';
    const muted = (() => { try { return window.Sfx && window.Sfx.muted(); } catch (e) { return false; } })();
    ov.innerHTML = `<div class="pl-ov dim"><section class="sheet pause" role="dialog" aria-modal="true" aria-labelledby="pT">
      <h2 id="pT">${tr('Paused', 'खेल रुका है')}</h2><p>${tr('Level', 'लेवल')} ${level} · ${esc(meta.name)}</p>
      <div class="pl-act"><button class="ui-btn wide m-pri" data-a="resume">${tr('Resume', 'जारी रखें')}</button>
      <div class="sheet-row"><button class="ui-btn sec" data-a="restart">${tr('Restart', 'फिर से शुरू')}</button><button class="ui-btn sec" data-a="quit">${tr('Quit', 'छोड़ें')}</button></div>
      <button class="sheet-snd" data-a="sound" aria-pressed="${!muted}">${ico(muted ? 'volume-x' : 'volume-high', 18)}<span>${muted ? tr('Sound off', 'आवाज़ बंद') : tr('Sound on', 'आवाज़ चालू')}</span></button></div>
    </section></div>`;
    footer(ov.querySelector('.sheet'));
    ov.querySelector('.sheet').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'resume') closePause();
      else if (a === 'restart') go(href(meta.id, level, inWorkout));
      else if (a === 'quit') go(inWorkout ? HUB : `/mind/game.html?g=${meta.id}`);
      else if (a === 'sound') {
        let m = false;
        try { window.Sfx.setMuted(!window.Sfx.muted()); m = window.Sfx.muted(); } catch (e2) { /* ignore */ }
        b.setAttribute('aria-pressed', String(!m));
        b.innerHTML = ico(m ? 'volume-x' : 'volume-high', 18) + `<span>${m ? tr('Sound off', 'आवाज़ बंद') : tr('Sound on', 'आवाज़ चालू')}</span>`;
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
  // v21: inside Brodoit's layer the phone's back during a round pauses it (Quit is one tap away); on the results the
  // layer's own back applies
  window.bdBackHandler = () => { if (phase === 'play' || phase === 'countdown') { openPause(); return true; } if (phase === 'paused') { closePause(); return true; } return false; };
  let pauseOnPlay = false;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) return; if (phase === 'play') openPause(); else if (phase === 'countdown') pauseOnPlay = true; });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (phase === 'play') openPause(); else if (phase === 'paused') closePause(); }
    if (e.key === 'Enter' && (phase === 'how' || phase === 'twist')) { const g = ov.querySelector('#howGo, #twistGo'); if (g) g.click(); }
    if (e.key === 'Enter' && phase === 'results') { const p = ov.querySelector('.m-pri'); if (p && document.activeElement !== p) p.click(); }
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
