// Voice notes (v20): a full-screen recorder. Speak, and Bro writes it down; translate it; save it as a note.
//   BroNote.open({ lang, onSave({ title, text, auto }), onAppend(text) }) → opens the recorder
//     lang: '' (Bro detects it), 'en' or 'hi' — the hearing hint; the learner's last pick is remembered
//     onAppend: given when opened from a note → "Add to this note"
//   BroNote.close()
// The recording is cut into ~2-minute pieces (each a complete file, so it fits Bro's hearing), and each piece is written
// down while the next is being recorded: POST /api/voice/transcribe?lang=… with the recorder's real type. Up to 10
// minutes. The words so far are kept on the phone (localStorage bro_note_draft) until saved: closing mid-way finishes
// writing and saves the note by itself; a draft left behind comes back the next time the recorder opens.
// POST /api/notes/translate { text, to } → { text } translates it. Plain script, no modules.
(function () {
  'use strict';
  const B = window.BroNote = {};
  const T = () => window.BRO_NOTE_TEST || {};
  const MAX_MS = 10 * 60e3, SEG = () => T().segMs || 120e3, DRAFT = 'bro_note_draft', LANG = 'bro_note_lang';
  const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const TR = [['en', 'English'], ['hi', 'हिंदी'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']];
  const ic = (n, s) => (window.ico ? window.ico(n, s || 22) : '');
  const tok = () => { try { return localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const buzz = k => { try { window.haptic && window.haptic(k); } catch (e) { /* ignore */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

  const CSS = `
.bvn{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:var(--b-bg,#FBF8F3);color:var(--b-ink,#1F1E1C);font-family:var(--ui-font,system-ui);padding:calc(8px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));animation:bvnIn .22s ease both;overflow-y:auto}
@keyframes bvnIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.bvn-top{display:flex;align-items:center;gap:8px;min-height:48px}
.bvn-x{width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;margin-left:-8px}
.bvn-x:active{background:var(--b-bg-2,#F2EDE4)}
.bvn-title{flex:1;font:var(--ui-t-head,600 16px/1.3 system-ui)}
.bvn-langs{display:flex;gap:4px;background:var(--b-bg-2,#F2EDE4);border-radius:999px;padding:3px}
.bvn-langs button{min-height:36px;min-width:44px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:var(--b-mute,#6F6B66);font:600 13px/1 var(--ui-font,system-ui);cursor:pointer}
.bvn-langs button[aria-pressed=true]{background:var(--b-card,#fff);color:var(--b-ink,#1F1E1C);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.bvn-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:220px;text-align:center}
.bvn-wave{width:100%;max-width:420px;height:96px;display:block}
.bvn-time{font:700 44px/1 var(--ui-font,system-ui);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.bvn-time small{font:500 14px/1 var(--ui-font,system-ui);color:var(--b-mute,#6F6B66);letter-spacing:0;margin-left:4px}
.bvn-hint{font:var(--ui-t-sub,500 13px/1.4 system-ui);color:var(--b-mute,#6F6B66);max-width:30ch;min-height:2.8em}
.bvn-hint.err{color:var(--b-primary,#B5402A);font-weight:700}
.bvn-ctrls{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:8px 0 4px}
.bvn-side{justify-self:center;width:56px;height:56px;border:0;border-radius:50%;background:var(--b-bg-2,#F2EDE4);color:var(--b-ink,#1F1E1C);display:grid;place-items:center;cursor:pointer;transition:opacity .2s}
.bvn-side:disabled{opacity:0;pointer-events:none}
.bvn-side.warn{background:var(--b-primary-soft,rgba(181,64,42,.12));color:var(--b-primary,#B5402A)}
.bvn-rec{position:relative;width:96px;height:96px;border:0;border-radius:50%;background:var(--b-grad,linear-gradient(135deg,#B5402A,#8E2F1E));color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 30px -10px rgba(181,64,42,.6);transition:transform .12s}
.bvn-rec:active{transform:scale(.94)}
.bvn-rec::before{content:'';position:absolute;inset:-10px;border-radius:50%;border:3px solid var(--b-primary,#B5402A);opacity:0;transform:scale(calc(1 + var(--lv,0) * .35));transition:transform .08s linear,opacity .2s}
.bvn.on .bvn-rec::before{opacity:.35}
.bvn.paused .bvn-rec::before{opacity:0}
.bvn-out{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.bvn.done .bvn-stage{display:none}
.bvn.done .bvn-out{flex:1;padding-top:12px}
.bvn.done .bvn-text{flex:1;min-height:38vh;max-height:none}
.bvn-out[hidden]{display:none}
.bvn-status{font:600 14px/1.3 var(--ui-font,system-ui);color:var(--b-mute,#6F6B66);display:flex;align-items:center;gap:8px;min-height:20px}
.bvn-status.err{color:var(--b-primary,#B5402A)}
.bvn-spin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:bvnSpin .8s linear infinite}
@keyframes bvnSpin{to{transform:rotate(360deg)}}
.bvn-text{width:100%;min-height:160px;max-height:40vh;resize:vertical;border:1px solid var(--b-line-2,rgba(0,0,0,.16));border-radius:var(--ui-r2,16px);background:var(--b-card,#fff);color:var(--b-ink,#1F1E1C);padding:14px;font:var(--ui-t-body,400 15px/1.5 system-ui);box-sizing:border-box;outline:none}
.bvn-text:focus{border-color:var(--b-primary,#B5402A)}
.bvn-tr{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.bvn-tr span{font:600 12px/1 var(--ui-font,system-ui);color:var(--b-mute,#6F6B66);margin-right:2px}
.bvn-tr button{min-height:36px;padding:0 12px;border:1px solid var(--b-line-2,rgba(0,0,0,.16));border-radius:999px;background:transparent;color:var(--b-ink,#1F1E1C);font:600 13px/1 var(--ui-font,system-ui);cursor:pointer}
.bvn-tr button[aria-pressed=true]{background:var(--b-ink,#1F1E1C);color:var(--b-bg,#fff);border-color:transparent}
.bvn-tr a{font:600 12px/1 var(--ui-font,system-ui);color:var(--b-primary,#B5402A);cursor:pointer;padding:8px 4px}
.bvn-acts{display:grid;gap:8px}
.bvn-acts .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.nv-cta{display:flex;align-items:center;gap:14px;width:100%;min-height:76px;padding:14px 16px;margin:0 0 16px;border:0;border-radius:var(--ui-r3,20px);background:var(--b-grad,linear-gradient(135deg,#B5402A,#8E2F1E));color:#fff;text-align:left;cursor:pointer;box-shadow:0 12px 28px -16px rgba(181,64,42,.7);font-family:var(--ui-font,system-ui)}
.nv-cta:active{transform:scale(.985)}
.nv-cta .nv-ic{flex:none;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center}
.nv-cta b{display:block;font:700 17px/1.2 var(--ui-font,system-ui)}
.nv-cta small{display:block;margin-top:3px;font:500 13px/1.35 var(--ui-font,system-ui);opacity:.88}
`;
  function css() { if (document.getElementById('bvnCss')) return; const s = document.createElement('style'); s.id = 'bvnCss'; s.textContent = CSS; document.head.appendChild(s); }
  // the Notes screen's big "Record a voice note" card is styled here too
  if (document.head) css(); else document.addEventListener('DOMContentLoaded', css);

  let st = null; // the open recorder

  B.open = function (opts) {
    if (st) { // still writing a note down after it was closed: show it again (it won't save by itself now)
      if (st.el.style.display === 'none') { st.el.style.display = ''; st.autosave = false; document.addEventListener('keydown', onKey); }
      return;
    }
    css();
    const o = opts || {};
    const saved = store.get(LANG);
    st = { o, lang: saved != null ? saved : (o.lang === 'hi' ? 'hi' : ''), phase: 'idle', segs: [], texts: [], fails: [], recMs: 0, segMs: 0, t0: 0, raf: 0, timer: 0, autosave: false, orig: '', translated: '', levels: [], gen: 0 };
    const el = st.el = document.createElement('div');
    el.className = 'bvn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Voice note');
    el.innerHTML = `<div class="bvn-top"><button class="bvn-x" id="bvnX" aria-label="Close">${ic('x', 24)}</button><div class="bvn-title">Voice note</div>
      <div class="bvn-langs" role="group" aria-label="Language you speak">${[['', 'Auto'], ['en', 'EN'], ['hi', 'हिं']].map(([k, l]) => `<button data-l="${k}" aria-pressed="${st.lang === k}">${l}</button>`).join('')}</div></div>
      <div class="bvn-stage"><canvas class="bvn-wave" id="bvnWave"></canvas><div class="bvn-time" id="bvnTime">00:00<small>/ 10:00</small></div><div class="bvn-hint" id="bvnHint">Tap the mic and talk. Bro writes it down.</div></div>
      <div class="bvn-ctrls"><button class="bvn-side" id="bvnPause" aria-label="Pause" disabled>${ic('pause')}</button><button class="bvn-rec" id="bvnRec" aria-label="Start recording">${ic('mic', 40)}</button><button class="bvn-side" id="bvnDiscard" aria-label="Discard" disabled>${ic('trash-2')}</button></div>
      <div class="bvn-out" id="bvnOut" hidden><div class="bvn-status" id="bvnStatus"></div><textarea class="bvn-text" id="bvnText" aria-label="Your note" placeholder="Your words appear here"></textarea>
        <div class="bvn-tr" id="bvnTr"><span>${ic('languages', 14)} Translate</span>${TR.map(([k, l]) => `<button data-to="${k}" aria-pressed="false">${l}</button>`).join('')}<a id="bvnOrig" hidden>Show original</a></div>
        <div class="bvn-acts"><button class="ui-btn accent wide" id="bvnSave">${ic('check', 20)} Save as note</button>${o.onAppend ? `<button class="ui-btn sec wide" id="bvnAppend">${ic('plus', 20)} Add to this note</button>` : ''}<div class="row"><button class="ui-btn sec" id="bvnMore">${ic('mic', 18)} Record more</button><button class="ui-btn ghost" id="bvnToss">${ic('trash-2', 18)} Discard</button></div></div></div>`;
    document.body.appendChild(el);
    const $ = id => el.querySelector('#' + id);
    st.$ = $;
    $('bvnX').onclick = () => B.close();
    el.querySelector('.bvn-langs').onclick = e => { const b = e.target.closest('button[data-l]'); if (!b) return; st.lang = b.dataset.l; store.set(LANG, st.lang); el.querySelectorAll('.bvn-langs button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
    $('bvnRec').onclick = () => (st.phase === 'recording' || st.phase === 'paused' ? finish() : start());
    $('bvnPause').onclick = () => (st.phase === 'paused' ? resume() : pause());
    $('bvnDiscard').onclick = () => discardTap();
    $('bvnSave').onclick = () => save();
    if ($('bvnAppend')) $('bvnAppend').onclick = () => append();
    $('bvnMore').onclick = () => start(true);
    $('bvnToss').onclick = () => toss();
    $('bvnTr').onclick = e => { const b = e.target.closest('button[data-to]'); if (b) translate(b.dataset.to, b); };
    $('bvnOrig').onclick = () => { $('bvnText').value = st.orig; st.translated = ''; $('bvnOrig').hidden = true; el.querySelectorAll('#bvnTr button').forEach(x => x.setAttribute('aria-pressed', 'false')); };
    $('bvnText').oninput = () => { if (!st.translated) keepDraft($('bvnText').value); };
    document.addEventListener('keydown', onKey);
    drawWave();
    // a draft left behind (the app closed while Bro was writing): back where it was
    let d = null; try { d = JSON.parse(store.get(DRAFT) || 'null'); } catch (e) { d = null; }
    if (d && d.text && Date.now() - (d.at || 0) < 7 * 864e5) { review(d.text); status('Your last recording is back. Save it, or record more.'); }
  };

  const onKey = e => { if (e.key === 'Escape' && st) B.close(); };
  function hint(t, err) { const h = st.$('bvnHint'); h.textContent = t; h.className = 'bvn-hint' + (err ? ' err' : ''); }
  function status(html, kind) { const s = st.$('bvnStatus'); s.innerHTML = (kind === 'busy' ? '<i class="bvn-spin"></i>' : '') + html; s.className = 'bvn-status' + (kind === 'err' ? ' err' : ''); }
  function setPhase(p) {
    st.phase = p; const el = st.el, $ = st.$;
    el.classList.toggle('on', p === 'recording' || p === 'paused'); el.classList.toggle('paused', p === 'paused'); el.classList.toggle('done', p === 'working' || p === 'review');
    const rec = p === 'recording' || p === 'paused';
    $('bvnRec').innerHTML = rec ? ic('square', 34) : ic('mic', 40);
    $('bvnRec').setAttribute('aria-label', rec ? 'Stop and write it down' : 'Start recording');
    $('bvnPause').disabled = !rec; $('bvnDiscard').disabled = !rec;
    $('bvnPause').innerHTML = p === 'paused' ? ic('play') : ic('pause'); $('bvnPause').setAttribute('aria-label', p === 'paused' ? 'Resume' : 'Pause');
    $('bvnRec').style.display = p === 'working' || p === 'review' ? 'none' : '';
    st.el.querySelector('.bvn-ctrls').style.display = p === 'review' || p === 'working' ? 'none' : '';
  }
  function keepDraft(text) { const t = (text != null ? text : joined()).trim(); if (t) store.set(DRAFT, JSON.stringify({ text: t, at: Date.now() })); }
  const joined = () => st.texts.filter(Boolean).join(' ').replace(/\s+\n/g, '\n').trim();

  // ── recording ──
  async function start(more) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { hint('Recording is not supported in this browser.', true); return; }
    if (more) { st.base = st.$('bvnText').value.trim(); st.segs = []; st.texts = []; st.fails = []; st.recMs = 0; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { if (st) { hint(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Allow the microphone for Brodoit, then tap the mic again.' : 'No microphone found.', true); setPhase(more ? 'review' : 'idle'); if (more) st.$('bvnOut').hidden = false; } return; }
    if (!st) { stream.getTracks().forEach(t => t.stop()); return; } // closed while the phone asked for the mic
    st.stream = stream;
    st.type = MediaRecorder.isTypeSupported ? TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '' : '';
    try {
      const AC = window.AudioContext || window.webkitAudioContext; st.ac = new AC(); try { await st.ac.resume(); } catch (e) { /* ignore */ }
      st.an = st.ac.createAnalyser(); st.an.fftSize = 1024; st.ac.createMediaStreamSource(st.stream).connect(st.an); st.buf = new Float32Array(st.an.fftSize);
    } catch (e) { st.an = null; }
    st.$('bvnOut').hidden = true;
    newSegment();
    st.t0 = performance.now(); st.segMs = 0;
    setPhase('recording'); hint('Listening… tap ■ when you are done.');
    buzz('medium');
    tick();
  }
  function newSegment() {
    const rec = new MediaRecorder(st.stream, st.type ? { mimeType: st.type } : undefined);
    const parts = [], i = st.segs.length, gen = st.gen;
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise(res => { rec.onstop = () => res(new Blob(parts, { type: rec.mimeType || st.type || 'audio/webm' })); });
    st.segs.push({ rec, done, i });
    rec.start(1000);
    // each piece is written down as soon as it is complete, while the next one records
    done.then(blob => { if (st && st.gen === gen) hearPiece(i, blob); }); // (not a discarded recording)
  }
  function rotate() { const old = st.segs[st.segs.length - 1]; newSegment(); try { old.rec.stop(); } catch (e) { /* ignore */ } st.segMs = 0; }
  function tick() {
    if (!st) return;
    const now = performance.now();
    if (st.phase === 'recording') { const dt = now - st.t0; st.recMs += dt; st.segMs += dt; }
    st.t0 = now;
    st.$('bvnTime').innerHTML = mmss(st.recMs) + '<small>/ 10:00</small>';
    if (st.phase === 'recording' && st.recMs >= (T().maxMs || MAX_MS)) { hint('That\'s 10 minutes: Bro is writing it down.'); finish(); return; }
    if (st.phase === 'recording' && st.segMs >= SEG()) rotate();
    if (st.an) {
      st.an.getFloatTimeDomainData(st.buf); let e = 0; for (const v of st.buf) e += v * v;
      const lv = st.phase === 'recording' ? Math.min(1, Math.sqrt(e / st.buf.length) * 8) : 0;
      st.peak = Math.max(st.peak || 0, lv); st.el.style.setProperty('--lv', lv.toFixed(3));
      if (now - (st.barAt || 0) >= 80) { st.barAt = now; st.levels.push(st.peak); st.peak = 0; if (st.levels.length > 64) st.levels.shift(); }
    }
    drawWave();
    st.raf = requestAnimationFrame(tick);
  }
  function drawWave() {
    const c = st.$('bvnWave'); if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth || 300, h = c.clientHeight || 96;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const color = getComputedStyle(st.el).getPropertyValue('--b-primary').trim() || '#B5402A';
    const n = 48, bw = w / n, lv = st.levels;
    for (let k = 0; k < n; k++) {
      const v = lv[lv.length - n + k] || 0, bh = Math.max(4, v * (h - 8));
      g.fillStyle = color; g.globalAlpha = v ? 0.35 + v * 0.65 : 0.18;
      const x = k * bw + bw * 0.2, y = (h - bh) / 2, r = Math.min(3, bw * 0.3);
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw * 0.6, bh, r); else g.rect(x, y, bw * 0.6, bh); g.fill();
    }
    g.globalAlpha = 1;
  }
  function pause() { if (st.phase !== 'recording') return; try { st.segs[st.segs.length - 1].rec.pause(); } catch (e) { /* ignore */ } setPhase('paused'); hint('Paused. Tap ▶ to go on, ■ to finish.'); buzz('light'); }
  function resume() { if (st.phase !== 'paused') return; try { st.segs[st.segs.length - 1].rec.resume(); } catch (e) { /* ignore */ } st.t0 = performance.now(); setPhase('recording'); hint('Listening… tap ■ when you are done.'); buzz('light'); }
  function release() { cancelAnimationFrame(st.raf); try { st.stream && st.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ } const ac = st.ac; st.ac = null; if (ac && ac.state !== 'closed') ac.close().catch(() => {}); st.an = null; st.levels = []; st.el.style.setProperty('--lv', '0'); drawWave(); }
  let tossArmed = 0;
  function discardTap() {
    if (Date.now() - tossArmed > 3000) { tossArmed = Date.now(); st.$('bvnDiscard').classList.add('warn'); hint('Tap 🗑 again to throw this recording away.', true); return; }
    st.gen++; st.segs.forEach(s => { try { s.rec.stop(); } catch (e) { /* ignore */ } }); release();
    st.segs = []; st.texts = []; st.fails = []; st.recMs = 0; st.$('bvnTime').innerHTML = '00:00<small>/ 10:00</small>';
    st.$('bvnDiscard').classList.remove('warn'); setPhase('idle'); hint('Thrown away. Tap the mic to record again.'); buzz('warning');
  }
  async function finish() {
    if (st.phase !== 'recording' && st.phase !== 'paused') return;
    buzz('success');
    try { st.segs[st.segs.length - 1].rec.stop(); } catch (e) { /* ignore */ }
    release();
    setPhase('working'); st.$('bvnOut').hidden = false; st.$('bvnText').value = st.base || '';
    hint(''); progress();
    await settle();
  }

  // ── writing it down ──
  async function hearPiece(i, blob, retry) {
    const gen = st && st.gen;
    if (!st || !blob || blob.size < 1200) { if (st) st.texts[i] = st.texts[i] || ''; progress(); return; }
    const p = (async () => {
      try {
        const r = await fetch('/api/voice/transcribe' + (st.lang ? '?lang=' + st.lang : ''), { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', 'x-token': tok() }, body: blob });
        if (!st || st.gen !== gen) return;
        if (r.status === 401) throw Object.assign(new Error('signin'), { kind: 'signin' });
        if (!r.ok) throw Object.assign(new Error('http ' + r.status), { kind: r.status === 429 ? 'limit' : 'server' });
        const j = await r.json(); st.texts[i] = String(j.text || '').trim(); st.fails = st.fails.filter(f => f.i !== i);
        keepDraft((st.base ? st.base + '\n' : '') + joined());
      } catch (e) { if (st && st.gen === gen) { st.fails = st.fails.filter(f => f.i !== i).concat([{ i, blob, kind: e.kind || 'offline' }]); } }
      progress();
    })();
    st.segs[i] && (st.segs[i].heard = p);
    if (retry) return p;
  }
  function progress() {
    if (!st || (st.phase !== 'working' && st.phase !== 'review')) return;
    const n = st.segs.length, have = st.texts.filter(x => x != null).length;
    if (st.phase === 'working') status(n > 1 ? `Bro is writing it down… ${Math.min(have, n)} of ${n}` : 'Bro is writing it down…', 'busy');
  }
  async function settle() {
    // wait for every piece: the last one is still being cut when finish() runs
    for (const s of st.segs.slice()) { const blob = await s.done; void blob; }
    await new Promise(r => setTimeout(r, 0));
    for (const s of st.segs.slice()) if (s.heard) await s.heard;
    if (!st) return;
    const text = joined(), all = ((st.base ? st.base + '\n' : '') + text).trim();
    if (st.fails.length) {
      if (st.autosave) { st.autosave = false; try { window.toast && window.toast('⚠️ Your voice note is kept: open the recorder to finish it', 'err'); } catch (e) { /* ignore */ } }
      review(all);
      const why = st.fails.some(f => f.kind === 'signin') ? 'Sign in again to write it down.' : st.fails.some(f => f.kind === 'limit') ? 'Bro needs a minute (too many recordings).' : 'No connection. Your recording is kept.';
      status(`${why} <a id="bvnRetry" style="cursor:pointer;text-decoration:underline">Try again</a>`, 'err');
      st.$('bvnRetry').onclick = async () => { const f = st.fails.slice(); setPhase('working'); progress(); for (const x of f) await hearPiece(x.i, x.blob, true); await settle(); };
      return;
    }
    if (!text) {
      if (st.autosave && !st.base) { shut(); try { window.toast && window.toast('🎙️ Bro didn\'t hear anything in that recording'); } catch (e) { /* ignore */ } return; }
      review(st.base || ''); status('I didn\'t hear anything. Tap "Record more" and speak a little closer.', 'err'); st.$('bvnText').focus(); return;
    }
    review(all);
    status('Done. Change anything you like.');
    if (st.autosave) save(true);
  }
  function review(text) { setPhase('review'); st.$('bvnOut').hidden = false; st.$('bvnText').value = text; st.orig = text; st.translated = ''; st.$('bvnOrig').hidden = true; st.base = ''; }

  async function translate(to, btn) {
    const src = st.translated ? st.orig : st.$('bvnText').value.trim(); if (!src) return;
    if (!st.translated) st.orig = src;
    st.el.querySelectorAll('#bvnTr button').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
    status('Translating…', 'busy');
    try {
      const r = await fetch('/api/notes/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok() }, body: JSON.stringify({ text: src, to }) });
      const j = await r.json().catch(() => ({}));
      if (!st) return;
      if (!r.ok || !j.text) throw new Error(j.error || 'failed');
      st.$('bvnText').value = j.text; st.translated = to; st.$('bvnOrig').hidden = false;
      status('Translated. "Show original" brings your words back.');
    } catch (e) { if (st) { status('Couldn\'t translate right now. Try again in a moment.', 'err'); btn.setAttribute('aria-pressed', 'false'); } }
  }

  // ── keeping it ──
  const titleOf = text => { const first = String(text).split(/[.!?\n।]/)[0].trim().split(/\s+/).slice(0, 6).join(' ').replace(/[,;:]+$/, ''); return first ? first.slice(0, 48) : 'Voice note · ' + new Date().toLocaleDateString(); };
  function save(auto) {
    const text = st.$('bvnText').value.trim(); if (!text) { status('Nothing to save yet.', 'err'); return; }
    const out = { title: titleOf(text), text, transcript: st.translated ? st.orig : text, auto: !!auto };
    store.del(DRAFT);
    const o = st.o; shut();
    try { o.onSave && o.onSave(out); } catch (e) { console.warn('[voicenote] save', e); }
  }
  function append() {
    const text = st.$('bvnText').value.trim(); if (!text) { status('Nothing to add yet.', 'err'); return; }
    store.del(DRAFT); const o = st.o; shut();
    try { o.onAppend && o.onAppend(text); } catch (e) { console.warn('[voicenote] append', e); }
  }
  function toss() { store.del(DRAFT); st.texts = []; st.segs = []; st.fails = []; st.recMs = 0; st.$('bvnText').value = ''; st.$('bvnOut').hidden = true; st.$('bvnTime').innerHTML = '00:00<small>/ 10:00</small>'; setPhase('idle'); hint('Tap the mic and talk. Bro writes it down.'); }
  function shut() { if (!st) return; document.removeEventListener('keydown', onKey); try { release(); } catch (e) { /* ignore */ } st.el.remove(); st = null; }

  // Closing while recording or writing: nothing is lost. Bro finishes writing it down and saves the note by itself.
  B.close = function () {
    if (!st) return;
    if (st.phase === 'recording' || st.phase === 'paused' || st.phase === 'working') {
      st.autosave = true;
      st.el.style.display = 'none'; document.removeEventListener('keydown', onKey);
      const wasRec = st.phase !== 'working';
      if (wasRec) finish(); // finish() → settle() → save(true)
      try { window.toast && window.toast('🎙️ Bro is writing your voice note down, it will be saved'); } catch (e) { /* ignore */ }
      return;
    }
    shut();
  };
  B.isOpen = () => !!st;
  B.state = () => (st ? { phase: st.phase, segs: st.segs.length, texts: st.texts.slice(), fails: st.fails.length, recMs: Math.round(st.recMs), lang: st.lang, translated: st.translated } : null);
})();
