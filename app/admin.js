// Brodoit Admin card (You → Admin). Plain script mounted by the SPA shell inside the profile tab:
// paste the OpenAI / ElevenLabs keys (verified before saving), see which studio services are on,
// recording counts, and run the one-time recordings on the server with a live log.
// Uses the SPA globals: S, api(path,{method,body}), esc, toast, render; optional window.ico / window.haptic.
// Public API: window.AdminPanel = { html(), load(force), save(key, force), remove(key), run(kind), stop(kind),
//   poll(), rerender(), draft(key,val), toggleEye(key), toggleHelp(), toggleLog(kind), toggleTextOnly() }
(function () {
  'use strict';
  const A = window.AdminPanel = {};

  // ── shell shims (the SPA defines these; harnesses may not) ──
  const _S = () => (typeof S !== 'undefined' && S) || window.S || (window.S = { tab: 'profile' });
  const _esc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const _toast = (m, t) => { try { if (typeof toast === 'function') toast(m, t); } catch (e) {} };
  const _api = (p, o) => { try { return typeof api === 'function' ? Promise.resolve(api(p, o)) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } };
  const hap = k => { try { if (window.haptic) haptic(k || 'light'); } catch (e) {} };
  const attr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const isAdmin = () => { const s = _S(); return !!(s.profile && s.profile.admin); };
  // All transient UI state lives in S.adm so the shell's full re-renders never wipe typed keys.
  const adm = () => { const s = _S(); if (!s.adm) s.adm = { status: null, loading: false, error: null, at: 0, draft: {}, eye: {}, reject: {}, saving: {}, starting: {}, open: {}, textOnly: false, help: false, _poll: null }; return s.adm; };

  const KEYS = [
    { k: 'OPENAI_API_KEY', label: 'OpenAI', sub: 'Talking Bro — real-time voice', ph: 'sk-…', icon: 'mic', url: 'https://platform.openai.com/api-keys', host: 'platform.openai.com' },
    { k: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', sub: 'Studio voices — bulletins, Hindi books, lessons', ph: 'xi-…', icon: 'radio', url: 'https://elevenlabs.io/app/settings/api-keys', host: 'elevenlabs.io' },
  ];
  const SERVICES = [
    { k: 'realtime', label: 'Realtime voice', icon: 'mic', off: 'device voice' },
    { k: 'elevenlabs', label: 'ElevenLabs', icon: 'radio', off: 'device voice' },
    { k: 'gemini', label: 'Gemini', icon: 'sparkles', off: 'set on server' },
    { k: 'ffmpeg', label: 'ffmpeg', icon: 'film', off: 'lessons need it' },
    { k: 'android', label: 'Android app', icon: 'smartphone', off: 'building…' },
  ];
  const JOBS = [
    { k: 'bulletin', label: "Record today's bulletin", sub: 'English + Hindi · once per day', icon: 'radio' },
    { k: 'hindi-books', label: 'Record Hindi books', sub: '106 briefs · runs for hours · resumable', icon: 'book-open' },
    { k: 'lang-audio', label: 'Record language lessons', sub: '60 lessons · needs ffmpeg · resumable', icon: 'languages' },
  ];
  const ST = { idle: 'Idle', running: 'Running', done: 'Done', failed: 'Failed' };

  // ── icons: window.ico(name,size) with inline fallbacks ──
  const P = {
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  };
  const ic = (name, size) => {
    size = size || 18; let s = '';
    try {
      const f = window.ico;
      // icons.js warns and returns a placeholder for names it lacks (film, database): use our inline glyph for those.
      const known = f && (typeof f.has !== 'function' || f.has(name));
      if (f && known) s = f(name, size) || '';
      if (s && P[name] && f.fallback && s.indexOf(f.fallback) >= 0) s = '';
    } catch (e) { s = ''; }
    if (s) return s;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.key) + '</svg>';
  };
  const fmtTime = iso => { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } };
  const fmtDay = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch (e) { return d; } };
  const pct = (n, t) => t ? Math.max(0, Math.min(100, Math.round(n / t * 100))) : 0;
  const anyRunning = jobs => !!jobs && Object.keys(jobs).some(k => jobs[k] && jobs[k].status === 'running');

  // ───────────────────────── markup ─────────────────────────
  A.html = function () {
    if (!isAdmin()) return '';
    const a = adm();
    // Keep the log fresh when the admin comes back to this tab with a job still running, and refresh stale counts.
    if (a.status && anyRunning(a.status.jobs) && !a._poll) setTimeout(() => A.poll(), 0);
    else if (a.status && !a.loading && Date.now() - (a.at || 0) > 60000) setTimeout(() => A.load(true), 0);
    let h = '<section class="adm b-card" id="admRoot" aria-label="Admin">';
    h += '<header class="adm-top"><div><div class="b-eyebrow adm-eyebrow">' + ic('shield-check', 14) + ' Admin</div><h3 class="b-h2 adm-title">Studio keys</h3></div>';
    h += '<button type="button" class="icon-btn adm-refresh' + (a.loading ? ' spin' : '') + '" onclick="AdminPanel.load(true)" aria-label="Refresh">' + ic('refresh-cw', 18) + '</button></header>';
    if (!a.status && a.loading) h += skeleton();
    else if (!a.status) h += '<div class="adm-err" role="alert">' + ic('alert-triangle', 18) + '<div><b>' + _esc(a.forbidden ? 'Admin only' : 'Could not load admin status') + '</b><small>' + _esc(a.error || 'Check the connection and try again.') + '</small></div></div>';
    else h += body(a);
    return h + '</section>';
  };
  function skeleton() {
    return '<div class="adm-skel"><div class="b-skel" style="height:54px"></div><div class="b-skel" style="height:118px"></div><div class="b-skel" style="height:118px"></div><div class="b-skel" style="height:140px"></div></div>';
  }
  function body(a) {
    const st = a.status;
    let h = '<p class="adm-lead b-body">Paste once. Saved on the server, live right away.</p>';
    // service tiles
    h += '<div class="adm-tiles" id="admTiles">' + SERVICES.map(tileHtml).join('') + '</div>';
    // keys
    h += '<div class="adm-keys">' + KEYS.map(k => keyHtml(k)).join('') + '</div>';
    // help
    h += '<div class="adm-helpwrap' + (a.help ? ' open' : '') + '"><button type="button" class="adm-help-t" onclick="AdminPanel.toggleHelp()" aria-expanded="' + (a.help ? 'true' : 'false') + '">' + ic('key', 16) + '<span>How to get the keys</span>' + ic('chevron-down', 16) + '</button>';
    h += '<div class="adm-help" id="admHelp"' + (a.help ? '' : ' hidden') + '>';
    h += '<p><b>OpenAI</b> — sign in at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys ' + ic('external-link', 12) + '</a>, tap <i>Create new secret key</i>, copy the <code>sk-…</code> key. Add a little credit to the account; Realtime voice is billed per minute.</p>';
    h += '<p><b>ElevenLabs</b> — sign in at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io/app/settings/api-keys ' + ic('external-link', 12) + '</a>, tap <i>Create API key</i> with text-to-speech access, copy it. Bulletins, Hindi books and lessons are recorded once and kept on the volume.</p>';
    h += '<p>Keys are verified with the provider before saving, stored masked, and never shown again. Remove a key here to fall back to the server variable.</p></div></div>';
    // recordings
    h += '<div class="adm-sec"><div class="b-eyebrow">Recordings</div>' + mediaHtml(st.media) + '</div>';
    // jobs
    h += (function () { const a = S.adm && S.adm.status && S.adm.status.auto; if (!a || a.on === false) return ''; const q = (a.running ? [a.running + ' (recording)'] : []).concat(a.queue || []); return '<p class="adm-auto b-sm">' + ic('zap', 14) + ' ' + (q.length ? 'Auto: ' + _esc(q.join(' → ')) : 'Recordings start by themselves once a key is saved.') + '</p>'; })();
    h += '<div class="adm-jobs" id="admJobs">' + JOBS.map(j => jobHtml(j)).join('') + '</div>';
    return h;
  }
  function tileHtml(sv) {
    const st = adm().status; const on = !!(st && st.services && st.services[sv.k]);
    return '<div class="adm-tile' + (on ? ' on' : '') + '" data-service="' + sv.k + '" role="status"><span class="adm-tile-ic">' + ic(sv.icon, 18) + '</span><div class="adm-tile-b"><b>' + _esc(sv.label) + '</b><small>' + (on ? 'On' : _esc(sv.off)) + '</small></div><i class="adm-dot" aria-hidden="true"></i></div>';
  }
  function keyChip(info) {
    if (!info || !info.set) return '<span class="adm-chip adm-chip-none">' + ic('x', 12) + 'Not set</span>';
    if (info.source === 'app') return '<span class="adm-chip adm-chip-app">' + ic('check', 12) + 'Saved in app · <code>' + _esc(info.hint || '') + '</code></span>';
    return '<span class="adm-chip adm-chip-env">' + ic('database', 12) + 'From server env · <code>' + _esc(info.hint || '') + '</code></span>';
  }
  function keyHtml(k) {
    const a = adm(); const info = a.status && a.status.keys && a.status.keys[k.k];
    const draft = a.draft[k.k] || '', saving = !!a.saving[k.k], rej = a.reject[k.k];
    let h = '<div class="adm-key" data-key="' + k.k + '" id="admKey-' + k.k + '">';
    h += '<div class="adm-key-h"><span class="adm-key-ic">' + ic(k.icon, 18) + '</span><div class="adm-key-t"><b>' + _esc(k.label) + '</b><small>' + _esc(k.sub) + '</small></div></div>';
    h += '<div class="adm-key-chip">' + keyChip(info) + '</div>';
    h += '<div class="adm-in-row"><input class="adm-in" id="admIn-' + k.k + '" type="' + (a.eye[k.k] ? 'text' : 'password') + '" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + attr(info && info.set ? 'Paste a new key to replace' : 'Paste your ' + k.label + ' key (' + k.ph + ')') + '" value="' + attr(draft) + '" aria-label="' + attr(k.label + ' API key') + '" oninput="AdminPanel.draft(\'' + k.k + '\',this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();AdminPanel.save(\'' + k.k + '\')}">';
    h += '<button type="button" class="icon-btn adm-eye" onclick="AdminPanel.toggleEye(\'' + k.k + '\')" aria-label="' + (a.eye[k.k] ? 'Hide key' : 'Show key') + '">' + ic(a.eye[k.k] ? 'eye-off' : 'eye', 18) + '</button></div>';
    if (rej) h += '<div class="adm-reject" role="alert">' + ic('alert-triangle', 16) + '<div><b>' + _esc(rej.valid === false ? 'Key rejected' : 'Could not verify') + '</b><small>' + _esc(rej.error || '') + '</small></div><button type="button" class="adm-force" onclick="AdminPanel.save(\'' + k.k + '\',true)">Save anyway</button></div>';
    h += '<div class="adm-key-act"><button type="button" class="b-btn sm adm-save" id="admSave-' + k.k + '" onclick="AdminPanel.save(\'' + k.k + '\')"' + (saving || !draft.trim() ? ' disabled' : '') + '>' + (saving ? '<span class="adm-spin" aria-hidden="true"></span>Checking…' : ic('check', 16) + 'Save') + '</button>';
    if (info && info.source === 'app') h += '<button type="button" class="b-btn sm ghost adm-remove" onclick="AdminPanel.remove(\'' + k.k + '\')"' + (saving ? ' disabled' : '') + '>' + ic('x', 16) + 'Remove</button>';
    h += '</div></div>';
    return h;
  }
  function mediaHtml(m) {
    m = m || {}; const b = m.books || {}, l = m.lessons || {}, n = (m.news || {}).today;
    let h = '<div class="adm-media" id="admMedia">';
    h += '<div class="adm-m" id="admBooks"><div class="adm-m-h"><span>' + ic('book-open', 16) + 'Hindi books</span><b><span class="adm-n">' + (b.audio || 0) + '</span>/' + (b.total || 106) + '</b></div><div class="b-progress adm-bar"><i style="width:' + pct(b.audio || 0, b.total || 106) + '%"></i></div><small class="adm-m-s">' + (b.text || 0) + ' translated · ' + (b.audio || 0) + ' recorded</small></div>';
    h += '<div class="adm-m" id="admLessons"><div class="adm-m-h"><span>' + ic('languages', 16) + 'Lessons</span><b><span class="adm-n">' + (l.audio || 0) + '</span>/' + (l.total || 60) + '</b></div><div class="b-progress adm-bar"><i style="width:' + pct(l.audio || 0, l.total || 60) + '%"></i></div><small class="adm-m-s">' + (l.audio || 0) + ' lessons with studio audio</small></div>';
    h += '<div class="adm-m adm-m-news" id="admNews"><div class="adm-m-h"><span>' + ic('radio', 16) + "Today's bulletin</span>" + (n ? '<b>' + _esc(fmtDay(n.date)) + '</b>' : '<b class="adm-mute">not yet</b>') + '</div><small class="adm-m-s">' + (n ? 'Text ' + (n.text ? '✓' : '—') + ' · English ' + (n.en ? '✓' : '—') + ' · Hindi ' + (n.hi ? '✓' : '—') : 'Written automatically after boot; or record it below.') + '</small></div>';
    h += '<div class="adm-dur' + (m.durable ? '' : ' warn') + '">' + ic(m.durable ? 'database' : 'alert-triangle', 14) + '<span>' + (m.durable ? 'Stored on the persistent volume' : 'Not persistent — set DB_PATH on a volume') + ' · <code>' + _esc(m.dir || '') + '</code></span></div>';
    return h + '</div>';
  }
  function jobHtml(j) {
    const a = adm(); const jb = (a.status && a.status.jobs && a.status.jobs[j.k]) || { status: 'idle', tail: [] };
    const run = jb.status === 'running', starting = !!a.starting[j.k], open = !!a.open[j.k];
    const tail = (jb.tail || []); const show = open ? tail.slice(-40) : tail.slice(-5);
    let h = '<div class="adm-job" data-job="' + j.k + '" data-status="' + jb.status + '" id="admJob-' + j.k + '">';
    h += '<div class="adm-job-h"><span class="adm-job-ic">' + ic(j.icon, 18) + '</span><div class="adm-job-t"><b>' + _esc(j.label) + '</b><small>' + _esc(j.sub) + '</small></div><span class="adm-st adm-st-' + jb.status + '" id="admSt-' + j.k + '" role="status" aria-live="polite">' + stText(jb) + '</span></div>';
    h += '<div class="adm-job-act">';
    h += '<button type="button" class="b-btn sm adm-run" id="admRun-' + j.k + '" onclick="AdminPanel.run(\'' + j.k + '\')"' + (run || starting ? ' disabled' : '') + '>' + runLabel(jb, starting) + '</button>';
    if (j.k === 'hindi-books') h += '<button type="button" class="b-chip adm-tog' + (a.textOnly ? ' on' : '') + '" onclick="AdminPanel.toggleTextOnly()" aria-pressed="' + (a.textOnly ? 'true' : 'false') + '">Text only</button>';
    h += '<button type="button" class="b-chip adm-stop" id="admStop-' + j.k + '" onclick="AdminPanel.stop(\'' + j.k + '\')"' + (run && j.k !== 'bulletin' ? '' : ' hidden') + '>' + ic('square', 14) + 'Stop</button>';
    h += '<button type="button" class="adm-logt" id="admLogT-' + j.k + '" onclick="AdminPanel.toggleLog(\'' + j.k + '\')"' + (tail.length > 5 ? '' : ' hidden') + '>' + (open ? 'Less' : 'Full log') + '</button>';
    h += '</div>';
    h += '<pre class="adm-log" id="admLog-' + j.k + '" aria-label="' + attr(j.label + ' log') + '" tabindex="0"' + (show.length ? '' : ' hidden') + '>' + _esc(show.join('\n')) + '</pre>';
    return h + '</div>';
  }
  const stText = jb => jb.status === 'running' ? '<span class="adm-spin" aria-hidden="true"></span>Running' : jb.status === 'done' ? ic('check', 12) + 'Done' + (jb.finishedAt ? ' · ' + fmtTime(jb.finishedAt) : '') : jb.status === 'failed' ? ic('x', 12) + 'Failed' + (jb.exitCode != null ? ' · exit ' + jb.exitCode : '') : ST.idle;
  const runLabel = (jb, starting) => starting ? '<span class="adm-spin" aria-hidden="true"></span>Starting…' : jb.status === 'running' ? '<span class="adm-spin" aria-hidden="true"></span>Recording…' : jb.status === 'done' ? ic('play', 16) + 'Record again' : jb.status === 'failed' ? ic('play', 16) + 'Retry' : ic('play', 16) + 'Record';

  // ───────────────────────── rendering helpers ─────────────────────────
  A.rerender = function () {
    const root = document.getElementById('admRoot');
    if (!root) return;
    const ae = document.activeElement;
    if (ae && root.contains(ae) && ae.tagName === 'INPUT') { A.patch(); return; } // don't yank the keyboard away mid-paste
    const h = A.html();
    if (!h) { root.remove(); return; }
    root.outerHTML = h;
  };
  // Replace innerHTML only when it differs (keeps live regions quiet and avoids needless reflow while polling).
  const setHtml = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };
  // DOM-patch only the live parts (jobs, counts, tiles) — used while polling and when an input has focus.
  A.patch = function () { A.patchJobs(); A.patchMedia(); A.patchTiles(); };
  A.patchTiles = function () { const el = document.getElementById('admTiles'); if (el) setHtml(el, SERVICES.map(tileHtml).join('')); };
  A.patchMedia = function () { const el = document.getElementById('admMedia'); const a = adm(); if (el && a.status) el.outerHTML = mediaHtml(a.status.media); };
  A.patchJobs = function () {
    const a = adm(); if (!a.status || !document.getElementById('admJobs')) return;
    for (const j of JOBS) {
      const jb = (a.status.jobs && a.status.jobs[j.k]) || { status: 'idle', tail: [] };
      const row = document.getElementById('admJob-' + j.k); if (!row) continue;
      const run = jb.status === 'running', starting = !!a.starting[j.k], open = !!a.open[j.k];
      row.setAttribute('data-status', jb.status);
      const st = document.getElementById('admSt-' + j.k); if (st) { setHtml(st, stText(jb)); const cls = 'adm-st adm-st-' + jb.status; if (st.className !== cls) st.className = cls; }
      const btn = document.getElementById('admRun-' + j.k); if (btn) { btn.disabled = run || starting; setHtml(btn, runLabel(jb, starting)); }
      const stop = document.getElementById('admStop-' + j.k); if (stop) stop.hidden = !(run && j.k !== 'bulletin');
      const tail = jb.tail || []; const show = open ? tail.slice(-40) : tail.slice(-5);
      const lt = document.getElementById('admLogT-' + j.k); if (lt) { lt.hidden = tail.length <= 5; const t = open ? 'Less' : 'Full log'; if (lt.textContent !== t) lt.textContent = t; }
      const log = document.getElementById('admLog-' + j.k);
      if (log) { const txt = show.join('\n'); if (log.textContent !== txt) { log.textContent = txt; log.scrollTop = log.scrollHeight; } log.hidden = !show.length; }
    }
  };
  A.patchKey = function (key) { const el = document.getElementById('admKey-' + key); const def = KEYS.find(k => k.k === key); if (el && def) el.outerHTML = keyHtml(def); };

  // ───────────────────────── data ─────────────────────────
  A.load = async function (force) {
    const a = adm();
    if (a.loading) return a._p;
    if (a.status && !force) { A.rerender(); return; }
    a.loading = true; a.error = null;
    if (!a.status) A.rerender(); else { const b = document.querySelector('#admRoot .adm-refresh'); if (b) b.classList.add('spin'); }
    a._p = (async () => {
      const r = await _api('/admin/status');
      a.loading = false; a.at = Date.now();
      if (!r || r.error || !r.admin) { a.status = null; a.error = r && r.error ? r.error : 'Could not reach the server'; a.forbidden = !!(r && /admin only/i.test(r.error || '')); }
      else { const prev = a.status && a.status.jobs; a.status = r; a.forbidden = false; A.noteTransitions(prev, r.jobs); }
      A.rerender(); A.poll();
    })();
    return a._p;
  };
  // Toast + haptic when a job that was running has finished.
  A.noteTransitions = function (prev, next) {
    const done = [];
    if (!prev || !next) return done;
    for (const j of JOBS) {
      const p = prev[j.k], n = next[j.k];
      if (p && n && p.status === 'running' && n.status !== 'running') {
        done.push(j.k);
        if (n.status === 'done') { hap('success'); _toast(j.label.replace('Record ', '') + ' — done'); }
        else { hap('error'); _toast(j.label.replace('Record ', '') + ' failed — see the log', 'err'); }
      }
    }
    return done;
  };
  // Every 3 s while a job runs and the You tab is open: fetch /admin/jobs and patch the DOM (no full re-render).
  A.poll = function () {
    const a = adm();
    if (a._poll) { clearTimeout(a._poll); a._poll = null; }
    if (!a.status || !anyRunning(a.status.jobs)) return;
    if (_S().tab !== 'profile' || !document.getElementById('admRoot')) return;
    a._poll = setTimeout(async () => {
      a._poll = null;
      const r = await _api('/admin/jobs');
      if (r && r.jobs && a.status) {
        const prev = a.status.jobs; a.status.jobs = r.jobs;
        const finished = A.noteTransitions(prev, r.jobs);
        A.patchJobs();
        if (finished.length) { await A.load(true); return; } // counts changed
      }
      A.poll();
    }, 3000);
  };

  // ───────────────────────── keys ─────────────────────────
  A.draft = function (key, val) {
    adm().draft[key] = val;
    const b = document.getElementById('admSave-' + key); if (b && !adm().saving[key]) b.disabled = !String(val || '').trim();
  };
  A.toggleEye = function (key) {
    const a = adm(); a.eye[key] = !a.eye[key];
    const inp = document.getElementById('admIn-' + key); if (inp) inp.type = a.eye[key] ? 'text' : 'password';
    const btn = inp && inp.parentNode && inp.parentNode.querySelector('.adm-eye'); if (btn) { btn.innerHTML = ic(a.eye[key] ? 'eye-off' : 'eye', 18); btn.setAttribute('aria-label', a.eye[key] ? 'Hide key' : 'Show key'); }
  };
  A.toggleHelp = function () { const a = adm(); a.help = !a.help; const w = document.querySelector('#admRoot .adm-helpwrap'); const p = document.getElementById('admHelp'); if (w) { w.classList.toggle('open', a.help); const t = w.querySelector('.adm-help-t'); if (t) t.setAttribute('aria-expanded', a.help ? 'true' : 'false'); } if (p) p.hidden = !a.help; };
  A.save = async function (key, force) {
    const a = adm(); const def = KEYS.find(k => k.k === key); if (!def) return;
    const value = String(a.draft[key] || '').trim();
    if (!value) { _toast('Paste a key first', 'err'); return; }
    if (a.saving[key]) return;
    a.saving[key] = true; a.reject[key] = null; A.patchKey(key);
    const r = await _api('/admin/settings', { method: 'POST', body: JSON.stringify({ key, value, verify: true, force: !!force }) });
    a.saving[key] = false;
    if (!r) { _toast('Offline — try again', 'err'); A.patchKey(key); return; }
    // ok:false + valid → the provider rejected (or could not confirm) the key: offer "Save anyway" inline.
    if (r.ok === false && 'valid' in r) { a.reject[key] = { error: r.error || (def.label + ' did not accept this key'), valid: r.valid }; hap('error'); A.patchKey(key); return; }
    if (r.error || !r.ok) { hap('error'); _toast(r.error || 'Could not save', 'err'); A.patchKey(key); return; }
    delete a.draft[key]; a.reject[key] = null; a.eye[key] = false;
    hap('success'); _toast(def.label + ' key saved' + (r.valid === true ? ' · verified' : force ? ' · not verified' : ''));
    await A.load(true);
  };
  A.remove = async function (key) {
    const a = adm(); const def = KEYS.find(k => k.k === key); if (!def || a.saving[key]) return;
    a.saving[key] = true; A.patchKey(key);
    const r = await _api('/admin/settings', { method: 'POST', body: JSON.stringify({ key, value: '' }) });
    a.saving[key] = false;
    if (!r || r.error) { hap('error'); _toast(r && r.error ? r.error : 'Offline — try again', 'err'); A.patchKey(key); return; }
    a.reject[key] = null; hap('light');
    _toast(def.label + ' key removed' + (r.source === 'env' ? ' · using the server variable' : ''));
    await A.load(true);
  };

  // ───────────────────────── jobs ─────────────────────────
  A.run = async function (kind) {
    const a = adm(); const def = JOBS.find(j => j.k === kind); if (!def || a.starting[kind]) return;
    a.starting[kind] = true; A.patchJobs();
    const body = {}; if (kind === 'hindi-books' && a.textOnly) body.textOnly = true;
    const r = await _api('/admin/jobs/' + kind, { method: 'POST', body: JSON.stringify(body) });
    a.starting[kind] = false;
    if (r && r.job && a.status) { a.status.jobs = a.status.jobs || {}; a.status.jobs[kind] = r.job; }
    if (!r) { hap('error'); _toast('Offline — try again', 'err'); A.patchJobs(); return; }
    if (r.error) { hap('error'); _toast(r.error === 'already running' ? def.label.replace('Record ', '') + ' is already running' : r.error, 'err'); A.patchJobs(); A.poll(); return; }
    hap('medium'); _toast('Recording on the server — you can close the app');
    A.patchJobs(); A.poll();
  };
  A.stop = async function (kind) {
    const a = adm(); const r = await _api('/admin/jobs/' + kind, { method: 'DELETE' });
    if (!r || r.error) { _toast(r && r.error ? r.error : 'Offline — try again', 'err'); return; }
    if (r.job && a.status) { a.status.jobs[kind] = r.job; }
    _toast(r.stopping ? 'Stopping… it resumes where it left off next time' : 'Cleared');
    A.patchJobs(); A.poll();
  };
  A.toggleLog = function (kind) { const a = adm(); a.open[kind] = !a.open[kind]; A.patchJobs(); };
  A.toggleTextOnly = function () { const a = adm(); a.textOnly = !a.textOnly; const b = document.querySelector('#admJob-hindi-books .adm-tog'); if (b) { b.classList.toggle('on', a.textOnly); b.setAttribute('aria-pressed', a.textOnly ? 'true' : 'false'); } };
})();
