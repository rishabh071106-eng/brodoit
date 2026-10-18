// Brodoit News Channel — spoken daily bulletin (English / हिंदी), top stories with an in-app Reader,
// explain-it-simply, monthly review, and the live headline feed. Mounted into the SPA's News tab;
// uses S, api, esc, toast, switchTab from the shell and ico()/mascot() from /app. All state lives
// on N (the shell re-renders the page from scratch), never in the DOM.
(function () {
  'use strict';
  const N = window.NewsChannel = { lang: localStorage.getItem('news.lang') || 'en', latest: null, list: [], monthly: [], view: 'top', desk: { stories: [], loaded: false }, playing: null, audio: null, open: null, explain: {}, loaded: false, reader: null, readCache: {}, voice: null, liveLimit: 12, scriptOpen: false, fs: parseInt(localStorage.getItem('news.fs') || '17', 10) || 17 };
  const hasDev = s => /[ऀ-ॿ]/.test(s || '');
  const I = (n, s) => (window.ico ? window.ico(n, s) : '');
  const tok = () => { try { return (typeof token !== 'undefined' && token) || localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };
  const fmtDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString(N.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; } };
  const TT = {
    en: { today: 'Today', live: 'Live', past: 'Past', monthly: 'Monthly', top: 'Top stories', seeAll: 'See all', inThis: 'In this bulletin', listen: 'Listen', pause: 'Pause', resume: 'Resume', loading: 'Loading', explain: 'Explain simply', open: 'Open original', source: 'Source', minRead: 'min read', askBro: 'Ask Bro to explain', noFull: 'The full story could not be loaded here.', more: 'Load more', empty: "Today's bulletin is on its way", emptyLive: 'Headlines are on their way', studio: 'Studio voice', device: 'Device voice', min: 'min', daily: 'Daily bulletin', month: 'Month in review', readFull: 'Read the full bulletin', stop: 'Stop', past0: 'Past bulletins will appear here, one per day.', monthly0: "On the 1st of every month Bro records a 5-minute review of the month's biggest stories.", now: 'now', yday: 'Yesterday', noVoice: 'No voice available on this device', noAudio: 'No audio yet for this bulletin', english: 'English', hindi: 'हिंदी' },
    hi: { today: 'आज', live: 'लाइव', past: 'पिछले दिन', monthly: 'मासिक', top: 'मुख्य ख़बरें', seeAll: 'सभी देखें', inThis: 'इस बुलेटिन में', listen: 'सुनें', pause: 'रोकें', resume: 'जारी रखें', loading: 'लोड हो रहा है', explain: 'आसान शब्दों में', open: 'मूल ख़बर', source: 'स्रोत', minRead: 'मिनट', askBro: 'Bro से समझें', noFull: 'पूरी ख़बर यहाँ लोड नहीं हो सकी।', more: 'और देखें', empty: 'आज का बुलेटिन आ रहा है', emptyLive: 'ख़बरें आ रही हैं', studio: 'स्टूडियो आवाज़', device: 'डिवाइस आवाज़', min: 'मिनट', daily: 'दैनिक बुलेटिन', month: 'महीने की समीक्षा', readFull: 'पूरा बुलेटिन पढ़ें', stop: 'बंद करें', past0: 'पिछले बुलेटिन यहाँ दिखेंगे, हर दिन एक।', monthly0: 'हर महीने की 1 तारीख़ को Bro महीने की बड़ी ख़बरों की 5 मिनट की समीक्षा रिकॉर्ड करता है।', now: 'अभी', yday: 'कल', noVoice: 'इस डिवाइस पर आवाज़ उपलब्ध नहीं', noAudio: 'इस बुलेटिन का ऑडियो अभी नहीं है', english: 'English', hindi: 'हिंदी' },
  };
  const T = k => (TT[N.lang] || TT.en)[k] || TT.en[k] || k;
  const SRC = { thehindu: 'The Hindu', indianexpress: 'Indian Express', ndtv: 'NDTV', hindustantimes: 'Hindustan Times', livemint: 'Mint', economictimes: 'The Economic Times', timesofindia: 'Times of India', bbc: 'BBC', bbci: 'BBC', theguardian: 'The Guardian', aljazeera: 'Al Jazeera', npr: 'NPR', nytimes: 'The New York Times', theverge: 'The Verge', techcrunch: 'TechCrunch', arstechnica: 'Ars Technica', wired: 'Wired', technologyreview: 'MIT Technology Review', nature: 'Nature', sciencedaily: 'ScienceDaily', phys: 'Phys.org', reuters: 'Reuters', apnews: 'AP', venturebeat: 'VentureBeat', newscientist: 'New Scientist' };
  const srcName = it => {
    let host = ''; try { host = new URL(it.link).hostname.replace(/^www\./, ''); } catch (e) {}
    const fromHost = host.split('.').map(l => SRC[l]).find(Boolean);
    if (fromHost) return fromHost;
    const s = String((it.originalSource && it.originalSource !== 'Brodoit' ? it.originalSource : '') || (it.source && it.source !== 'Brodoit' ? it.source : '') || '');
    if (SRC[s.toLowerCase()]) return SRC[s.toLowerCase()];
    if (s && !/^[a-z0-9.-]+$/.test(s)) return s;
    const label = (s || host).split('.')[0];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Source';
  };
  const ago = d => {
    const t = new Date(d || 0).getTime(); if (!t || isNaN(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return T('now'); if (m < 60) return m + 'm'; const h = Math.round(m / 60); if (h < 24) return h + 'h';
    const dd = Math.round(h / 24); if (dd <= 1) return T('yday'); if (dd < 7) return dd + 'd';
    return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const items = () => (window.S && S.news && S.news.all) || [];
  const desc = it => String(it.desc || it.description || it.content || '').replace(/\s+/g, ' ').trim();

  N.load = async function () {
    try { const r = await fetch('/api/bulletins/latest', { cache: 'no-store' }).then(r => r.json()); N.latest = r.daily; N.hasAudio = r.hasAudio; N.monthlyLatest = r.monthly; } catch (e) {}
    try { const r = await fetch('/api/bulletins?kind=daily', { cache: 'no-store' }).then(r => r.json()); N.list = r.items || []; } catch (e) {}
    try { const r = await fetch('/api/bulletins?kind=monthly', { cache: 'no-store' }).then(r => r.json()); N.monthly = r.items || []; } catch (e) {}
    N.loaded = true; N.rerender();
    try { if (window.S && S.news && !S.news.all && !S.newsLoading && typeof loadNews === 'function') loadNews('all'); } catch (e) {}
  };
  N.setLang = function (l) { N.lang = l; localStorage.setItem('news.lang', l); if (N.playing) N.stop(); N.voiceStop(); N.rerender(); };
  N.setView = function (v) { N.view = v; N.liveLimit = 12; N.rerender(); try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) {} };
  N.rerender = function () { const r = document.getElementById('newsRoot'); if (r && S.tab === 'news') r.innerHTML = N.html(); };

  // ── bulletin player: pre-recorded mp3 when present, else device voice reading the same script ──
  N.play = function (id) {
    const b = [N.latest, ...N.list, ...N.monthly].find(x => x && x.id === id); if (!b) return;
    if (N.playing && N.playing.id === id) { N.toggle(); return; }
    N.stop(); N.voiceStop();
    N.playing = { id, paused: false, pct: 0, mode: 'tts' };
    const url = b.audio && b.audio[N.lang];
    if (url) {
      const a = N.audio || (N.audio = document.createElement('audio')); a.src = url; a.playbackRate = N.rate || 1;
      a.ontimeupdate = () => { if (a.duration) N.paint(a.currentTime / a.duration * 100, a.currentTime, a.duration); };
      a.onended = () => { N.playing = null; N.rerender(); };
      a.onerror = () => { N.playing.mode = 'tts'; N.tts(b); };
      N.playing.mode = 'mp3'; a.play().catch(() => { N.playing.mode = 'tts'; N.tts(b); });
    } else N.tts(b);
    try { if (navigator.mediaSession) { navigator.mediaSession.metadata = new MediaMetadata({ title: b.title, artist: 'Brodoit News', artwork: [{ src: location.origin + '/icon-512.png?v=5', sizes: '512x512', type: 'image/png' }] }); navigator.mediaSession.setActionHandler('pause', N.toggle); navigator.mediaSession.setActionHandler('play', N.toggle); } } catch (e) {}
    N.rerender();
  };
  N.tts = function (b) {
    const text = N.lang === 'hi' ? b.script_hi : b.script_en;
    if (!('speechSynthesis' in window) || !text) { toast(T('noAudio')); N.playing = null; N.rerender(); return; }
    speechSynthesis.cancel();
    const chunks = text.match(/[^.!?।\n]+[.!?।\n]*/g) || [text]; let i = 0;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => N.lang === 'hi' ? /^hi/i.test(x.lang) : (/en-IN/i.test(x.lang))) || vs.find(x => N.lang === 'hi' ? /hi/i.test(x.lang) : /^en/i.test(x.lang));
    const next = () => {
      if (!N.playing || N.playing.id !== b.id) return;
      if (N.playing.paused) { setTimeout(next, 200); return; }
      if (i >= chunks.length) { N.playing = null; N.rerender(); return; }
      N.paint(i / chunks.length * 100);
      const u = new SpeechSynthesisUtterance(chunks[i++]); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = N.lang === 'hi' ? 'hi-IN' : 'en-IN';
      u.rate = N.rate || 1; u.onend = next; u.onerror = next; speechSynthesis.speak(u);
    };
    if (!vs.length) { speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; N.tts(b); }; setTimeout(() => { if (speechSynthesis.getVoices().length) { speechSynthesis.onvoiceschanged = null; next(); } }, 300); return; }
    next();
    if (window._newsKeep) clearInterval(window._newsKeep);
    window._newsKeep = setInterval(() => { try { if (!N.playing) { clearInterval(window._newsKeep); return; } if (speechSynthesis.speaking && !speechSynthesis.paused && !N.playing.paused) { speechSynthesis.pause(); speechSynthesis.resume(); } } catch (e) {} }, 5000);
  };
  N.toggle = function () {
    if (!N.playing) return;
    N.playing.paused = !N.playing.paused;
    if (N.playing.mode === 'mp3' && N.audio) { if (N.playing.paused) N.audio.pause(); else N.audio.play(); }
    else { try { N.playing.paused ? speechSynthesis.pause() : speechSynthesis.resume(); } catch (e) {} }
    N.rerender();
  };
  // Called by the shell when leaving the tab: silence everything and close the reader.
  N.stop = function () {
    try { if (N.audio) { N.audio.pause(); N.audio.src = ''; } } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} N.playing = null;
    N.voiceStop(); if (N.reader || N.open) { N.reader = null; N.open = null; N._paintReader(); }
  };
  N.setRate = function (r) { N.rate = r; if (N.audio) N.audio.playbackRate = r; N.rerender(); };
  N.paint = function (pct, cur, dur) { if (N.playing) N.playing.pct = pct; const f = document.getElementById('nwFill'); if (f) f.style.width = pct + '%'; const t = document.getElementById('nwTime'); if (t && dur) t.textContent = Math.floor(cur / 60) + ':' + String(Math.floor(cur % 60)).padStart(2, '0') + ' / ' + Math.floor(dur / 60) + ':' + String(Math.floor(dur % 60)).padStart(2, '0'); };

  // ── explain any story simply (EN + HI + hard words) ──
  N.explainItem = function (i) { return N.explainObj((S.news && S.news.all || [])[i]); };
  N.explainObj = async function (it) {
    if (!it) return;
    N.open = { title: it.title, desc: it.desc || it.description || '', loading: true }; N.rerender();
    const k = it.title;
    if (!N.explain[k]) { try { N.explain[k] = await api('/news/explain', { method: 'POST', body: JSON.stringify({ title: it.title, desc: it.desc || it.description || it.content || '' }) }); } catch (e) { N.explain[k] = { error: 'Could not explain right now' }; } }
    N.open = { title: it.title, desc: it.desc || '', data: N.explain[k], link: it.link }; N.rerender();
  };
  N.closeExplain = function () { N.open = null; try { speechSynthesis.cancel(); } catch (e) {} N.voiceStop(); N.rerender(); };

  // ── studio voice: POST /api/voice/tts chunk by chunk through one <audio>; device voice when the server has none ──
  const splitChunks = (text, max) => {
    const out = []; let cur = '';
    for (const s of String(text).split(/(?<=[.!?।])\s+/)) {
      if (s.length > max) { if (cur) { out.push(cur); cur = ''; } for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
      if ((cur + ' ' + s).trim().length > max) { out.push(cur.trim()); cur = s; } else cur = (cur + ' ' + s).trim();
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
  };
  const silentClip = () => {
    const n = 200, b = new Uint8Array(44 + n);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    const u32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
    const u16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
    w(0, 'RIFF'); u32(4, 36 + n); w(8, 'WAVE'); w(12, 'fmt '); u32(16, 16); u16(20, 1); u16(22, 1); u32(24, 8000); u32(28, 8000); u16(32, 1); u16(34, 8); w(36, 'data'); u32(40, n); b.fill(128, 44);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  };
  N.say = function (text, key, lang) {
    text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text) return;
    key = key || 'txt:' + text.slice(0, 80);
    if (N.voice && N.voice.key === key) { N.voiceToggle(); return; }
    N.voiceStop(); if (N.playing) N.stop();
    lang = lang || (hasDev(text) ? 'hi' : 'en');
    const a = document.createElement('audio'); a.preload = 'auto'; a.setAttribute('playsinline', '');
    const v = N.voice = { key, state: 'loading', chunks: splitChunks(text, 1200), i: 0, audio: a, lang, urls: {}, mode: 'studio', unlocking: true };
    try { a.src = silentClip(); a.play().catch(() => {}); } catch (e) {}           // unlock playback inside the tap
    a.onended = () => { if (N.voice !== v || v.unlocking || v.state !== 'playing') return; v.i++; if (v.i >= v.chunks.length) N.voiceEnd(); else N.voicePlay(v); };
    a.onerror = () => { if (N.voice !== v || v.unlocking) return; if (v.i === 0) N.voiceFallback(v); else N.voiceEnd(); };
    N.voicePlay(v); N.rerender();
  };
  N.voiceFetch = async function (v, i) {
    if (v.urls[i]) return v.urls[i];
    const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok() }, body: JSON.stringify({ text: v.chunks[i], lang: v.lang }) });
    if (r.status === 404) { const e = new Error('no studio voice'); e.code = 404; throw e; }
    if (!r.ok) throw new Error('tts ' + r.status);
    const b = await r.blob(); if (!b.size) throw new Error('empty audio');
    return (v.urls[i] = URL.createObjectURL(b));
  };
  N.voicePlay = async function (v) {
    try {
      const u = await N.voiceFetch(v, v.i); if (N.voice !== v) return;
      v.unlocking = false; v.audio.src = u; v.state = 'playing'; N.rerender();
      await v.audio.play();
      if (v.i + 1 < v.chunks.length) N.voiceFetch(v, v.i + 1).catch(() => {});
    } catch (e) { if (N.voice !== v) return; if (v.i === 0) N.voiceFallback(v); else N.voiceEnd(); }
  };
  // Device voice for the rest of the text (server has no studio voice, or playback failed on chunk one).
  // A short message: inline in the reader when it is open (the overlay would hide the shell's toast), else a toast.
  N.note = function (msg) {
    if (N.reader) { const r = N.reader; r.note = msg; N.rerender(); setTimeout(() => { if (N.reader === r && r.note === msg) { r.note = ''; N.rerender(); } }, 3000); }
    else toast(msg);
  };
  N.voiceFallback = function (v) {
    if (!('speechSynthesis' in window)) { N.note(T('noVoice')); N.voiceEnd(); return; }
    v.mode = 'device'; v.unlocking = false; try { v.audio.pause(); v.audio.removeAttribute('src'); } catch (e) {}
    speechSynthesis.cancel();
    const parts = v.chunks.slice(v.i).join(' ').match(/[^.!?।\n]+[.!?।\n]*/g) || v.chunks.slice(v.i); let i = 0;
    const pick = () => { const vs = speechSynthesis.getVoices(); return vs.find(x => v.lang === 'hi' ? /^hi/i.test(x.lang) : /en-IN/i.test(x.lang)) || vs.find(x => v.lang === 'hi' ? /hi/i.test(x.lang) : /^en/i.test(x.lang)); };
    const next = () => {
      if (N.voice !== v) return;
      if (v.state === 'paused') { setTimeout(next, 200); return; }
      if (i >= parts.length) { N.voiceEnd(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]); const vc = pick(); if (vc) { u.voice = vc; u.lang = vc.lang; } else u.lang = v.lang === 'hi' ? 'hi-IN' : 'en-IN';
      u.onend = next; u.onerror = next; speechSynthesis.speak(u);
    };
    v.state = 'playing'; N.rerender(); next();
    if (v.keep) clearInterval(v.keep);
    v.keep = setInterval(() => { try { if (N.voice !== v) { clearInterval(v.keep); return; } if (speechSynthesis.speaking && !speechSynthesis.paused && v.state === 'playing') { speechSynthesis.pause(); speechSynthesis.resume(); } } catch (e) {} }, 5000);
  };
  N.voiceToggle = function () {
    const v = N.voice; if (!v || v.state === 'loading') return;
    if (v.state === 'playing') { v.state = 'paused'; if (v.mode === 'studio') v.audio.pause(); else { try { speechSynthesis.pause(); } catch (e) {} } }
    else { v.state = 'playing'; if (v.mode === 'studio') v.audio.play().catch(() => {}); else { try { speechSynthesis.resume(); } catch (e) {} } }
    N.rerender();
  };
  N.voiceStop = function () {
    const v = N.voice; if (!v) return; N.voice = null;
    try { v.audio.pause(); v.audio.removeAttribute('src'); v.audio.load(); } catch (e) {}
    try { if (v.mode === 'device') speechSynthesis.cancel(); } catch (e) {}
    if (v.keep) clearInterval(v.keep);
    Object.values(v.urls).forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  };
  N.voiceEnd = function () { N.voiceStop(); N.rerender(); };
  N.speakText = function (text) { N.say(text); };
  N.speakHeadline = function (id, idx) { const b = [N.latest, ...N.list, ...N.monthly].find(x => x && x.id === id); const h = b && b.headlines[idx]; if (h) N.say(N.lang === 'hi' ? h.hi : h.h + '. ' + h.easy, 'hl:' + id + ':' + idx, N.lang); };
  const voiceBtn = (key, size) => { const v = N.voice; const on = v && v.key === key; const s = on ? v.state : ''; return { on: !!on, s, icon: s === 'loading' ? '<span class="nx-spin">' + I('loader', size) + '</span>' : s === 'playing' ? I('pause', size) : s === 'paused' ? I('play', size) : I('headphones', size) }; };

  // ── reader: GET /api/news/read?url= → paragraphs; the feed summary shows while it loads ──
  N.read = function (i) { return N.readItem(items()[i], i); };
  N.readItem = function (it, i) {
    if (!it || !it.link) return;
    N.voiceStop();
    N.reader = { idx: i == null ? -1 : i, item: it, data: N.readCache[it.link] || null, loading: !N.readCache[it.link], scroll: 0, fresh: true };
    try { history.pushState({ nxr: 1 }, ''); } catch (e) {}
    N.rerender();
    if (!N.reader.loading) return;
    const r = N.reader;
    api('/news/read?url=' + encodeURIComponent(it.link)).then(d => { d = d && typeof d === 'object' ? d : { ok: false, error: 'offline' }; N.readCache[it.link] = d; if (N.reader === r) { r.data = d; r.loading = false; N.rerender(); } });
  };
  N.closeReader = function (fromHistory) {
    if (!N.reader) return;
    N.reader = null; N.voiceStop(); N.rerender();
    if (!fromHistory) { try { if (history.state && history.state.nxr) history.back(); } catch (e) {} }
  };
  window.addEventListener('popstate', () => { if (N.reader) N.closeReader(true); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && N.reader && !N.open) N.closeReader(); });
  N.fontStep = function () { const sizes = [17, 19, 21]; N.fs = sizes[(sizes.indexOf(N.fs) + 1) % sizes.length]; localStorage.setItem('news.fs', String(N.fs)); N.rerender(); };
  N.listenReader = function () {
    const r = N.reader; if (!r) return; const d = r.data;
    const body = d && d.ok && d.paragraphs && d.paragraphs.length ? d.paragraphs.join(' ') : desc(r.item);
    const text = ((d && d.title) || r.item.title) + '. ' + body;
    N.say(text.slice(0, 6000), 'rd:' + r.item.link, hasDev(text) ? 'hi' : 'en');
  };
  // Overlays (reader, explain sheet) live in a body-level host: the shell's .app is its own stacking context,
  // so anything rendered inside #newsRoot would sit under the fixed tab bar. Painted on the next frame
  // from state, after whichever render asked for it; untouched when nothing changed, so scroll and
  // animations survive the shell's re-renders.
  N.host = function () { let h = document.getElementById('nxHost'); if (!h) { h = document.createElement('div'); h.id = 'nxHost'; document.body.appendChild(h); } return h; };
  N._paintReader = function () {
    if (N._raf) return;
    N._raf = requestAnimationFrame(() => {
      N._raf = 0; const onTab = !window.S || S.tab === 'news';
      const open = !!N.reader && onTab;
      const html = (open ? N.readerHtml() : '') + (N.open && onTab ? N.sheetHtml() : '');
      const host = N.host();
      if (host._last !== html) { host.innerHTML = html; host._last = html; }
      if (N.reader) N.reader.fresh = false;
      document.documentElement.classList.toggle('nxr-open', open);
      if (open && N.reader.scroll) { const b = document.getElementById('nxrBody'); if (b && b.scrollTop !== N.reader.scroll) b.scrollTop = N.reader.scroll; }
    });
  };

  // ── markup ──
  const skelRows = n => { let h = ''; for (let i = 0; i < n; i++) h += '<div class="nx-row skel"><div class="nx-row-b"><i class="b-skel" style="width:38%;height:10px"></i><i class="b-skel" style="width:100%;height:18px;margin-top:9px"></i><i class="b-skel" style="width:72%;height:18px;margin-top:6px"></i></div><i class="b-skel" style="width:72px;height:72px;border-radius:12px"></i></div>'; return h; };
  N.row = function (it, i) {
    const t = ago(it.date || it.pubDate);
    return '<button class="nx-row" onclick="NewsChannel.read(' + i + ')"><div class="nx-row-b"><div class="b-eyebrow">' + esc(srcName(it)) + (t ? ' <em>· ' + esc(t) + '</em>' : '') + '</div><div class="nx-row-t">' + esc(it.title) + '</div></div>' + (it.img ? '<img src="' + esc(it.img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</button>';
  };
  N.bulletinCard = function (b, o) {
    if (!b) return ''; o = o || {};
    const hi = N.lang === 'hi'; const on = N.playing && N.playing.id === b.id; const paused = on && N.playing.paused;
    const hasMp3 = !!(b.audio && b.audio[N.lang]); const script = (hi ? b.script_hi : b.script_en) || '';
    const mins = Math.max(2, Math.round(script.length / 850));
    const monthly = b.kind === 'monthly';
    const when = monthly ? new Date(b.date + 'T00:00:00').toLocaleDateString(hi ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' }) : fmtDate(b.date);
    let h = '<div class="' + (o.hero ? 'nx-hero' : 'nx-card') + (on ? ' on' : '') + '">';
    h += '<div class="b-eyebrow">' + esc((monthly ? T('month') : o.hero ? T('today') : T('daily')) + ' · ' + (hi ? T('hindi') : T('english'))) + '</div>';
    h += '<div class="' + (o.hero ? 'nx-hero-title' : 'nx-card-title') + (hi ? ' hi' : '') + '">' + esc(hi && b.title_hi ? b.title_hi : b.title) + '</div>';
    h += '<div class="nx-hero-row"><button class="nx-play' + (on && !paused ? ' on' : '') + '" onclick="NewsChannel.play(\'' + b.id + '\')" aria-label="' + (on && !paused ? 'Pause' : 'Play') + '">' + (on && !paused ? I('pause', 26) : I('play', 26)) + '</button><div class="nx-hero-meta"><b>' + esc(when) + '</b>' + mins + ' ' + T('min') + ' · ' + (hasMp3 ? T('studio') : T('device')) + '</div></div>';
    if (on) h += '<div class="nx-prog"><i id="nwFill" style="width:' + (N.playing.pct || 0) + '%"></i></div><div class="nx-ctl"><span id="nwTime"></span>' + [1, 1.25, 1.5].map(r => '<button class="' + ((N.rate || 1) === r ? 'on' : '') + '" onclick="NewsChannel.setRate(' + r + ')">' + r + '×</button>').join('') + '<button onclick="NewsChannel.stop();NewsChannel.rerender()">' + T('stop') + '</button></div>';
    h += '</div>';
    if (o.full) {
      const heads = b.headlines || [];
      if (heads.length) h += '<div class="nx-sec"><h2>' + T('inThis') + '</h2></div><div class="nx-heads">' + heads.map((x, i) => { const vb = voiceBtn('hl:' + b.id + ':' + i, 18); return '<div class="nx-head"><div class="nx-head-b"><div class="b-eyebrow">' + esc(x.topic || '') + '</div><b>' + esc(x.h) + '</b><p' + (hi ? ' class="hi"' : '') + '>' + esc(hi ? x.hi : x.easy) + '</p></div><button class="icon-btn' + (vb.on ? ' on' : '') + '" onclick="NewsChannel.speakHeadline(\'' + b.id + '\',' + i + ')" aria-label="' + T('listen') + '">' + (vb.on ? vb.icon : I('volume-2', 18)) + '</button></div>'; }).join('') + '</div>';
      if (script) h += '<details class="nx-script"' + (N.scriptOpen ? ' open' : '') + ' ontoggle="NewsChannel.scriptOpen=this.open"><summary>' + I('chevron-right', 16) + T('readFull') + '</summary><div' + (hi ? ' class="hi"' : '') + '><p>' + esc(script).replace(/\n\n+/g, '</p><p>') + '</p></div></details>';
    }
    return h;
  };
  N.readerHtml = function () {
    const r = N.reader, it = r.item, d = r.data && r.data.ok ? r.data : null;
    const src = (d && d.site) || srcName(it); const title = (d && d.title) || it.title; const img = (d && d.image) || it.img; const link = it.link;
    const t = ago((d && d.published) || it.date || it.pubDate);
    const words = d && d.paragraphs ? d.paragraphs.join(' ').split(/\s+/).length : 0; const mins = words ? Math.max(1, Math.round(words / 220)) : 0;
    const by = [d && d.byline ? d.byline : '', t, mins ? mins + ' ' + T('minRead') : ''].filter(Boolean).join(' · ');
    const vb = voiceBtn('rd:' + link, 16);
    const lead = desc(it);
    let h = '<div class="nxr" role="dialog" aria-modal="true"><div class="nxr-top"><button class="icon-btn" onclick="NewsChannel.closeReader()" aria-label="Close">' + I('x', 20) + '</button><div class="b-eyebrow">' + esc(src) + '</div><button class="icon-btn" onclick="NewsChannel.fontStep()" aria-label="Text size"><span class="nxr-aa">Aa</span></button></div>';
    h += '<div class="nxr-body" id="nxrBody" onscroll="NewsChannel.reader&&(NewsChannel.reader.scroll=this.scrollTop)">';
    h += '<h1 class="nxr-title' + (hasDev(title) ? ' hi' : '') + '">' + esc(title) + '</h1>' + (by ? '<div class="nxr-by">' + esc(by) + '</div>' : '');
    if (img) h += '<img class="nxr-img" src="' + esc(img) + '" alt="" onerror="this.remove()">';
    h += '<div class="nxr-actions"><button class="b-btn' + (vb.on ? ' on' : '') + '" onclick="NewsChannel.listenReader()">' + vb.icon + ' ' + (vb.s === 'loading' ? T('loading') : vb.s === 'playing' ? T('pause') : vb.s === 'paused' ? T('resume') : T('listen')) + '</button><button class="b-chip" onclick="NewsChannel.explainItem(' + r.idx + ')">' + I('sparkles', 16) + T('explain') + '</button><a class="icon-btn" href="' + esc(link) + '" target="_blank" rel="noopener" aria-label="' + T('open') + '" title="' + T('open') + '">' + I('arrow-up-right', 18) + '</a></div>';
    if (r.note) h += '<div class="nxr-note">' + esc(r.note) + '</div>';
    const fs = ' style="--nxr-fs:' + N.fs + 'px"';
    if (r.loading) h += '<div class="nxr-text"' + fs + '>' + (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</div><div class="nxr-skel"><i class="b-skel" style="width:100%"></i><i class="b-skel" style="width:94%"></i><i class="b-skel" style="width:88%"></i><i class="b-skel" style="width:60%"></i></div>';
    else if (d && d.paragraphs && d.paragraphs.length) h += '<div class="nxr-text' + (hasDev(d.paragraphs[0]) ? ' hi' : '') + '"' + fs + '>' + d.paragraphs.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>';
    else h += '<div class="nxr-text"' + fs + '>' + (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</div><div class="nxr-fail"><span>' + T('noFull') + '</span><a class="b-chip" href="' + esc(link) + '" target="_blank" rel="noopener">' + T('open') + I('arrow-up-right', 14) + '</a></div>';
    h += '<div class="nxr-foot"><span>' + T('source') + ': ' + esc(src) + '</span><a href="' + esc(link) + '" target="_blank" rel="noopener">' + T('open') + I('arrow-up-right', 16) + '</a></div>';
    return h + '</div></div>';
  };
  // ── Brodoit Desk: our own 60-word stories, merged from many outlets (modules/newsdesk.js) ──
  N.loadDesk = function (force) {
    if (N._deskP || (N.desk.loaded && !force && Date.now() - (N.desk.at || 0) < 5 * 60e3)) return N._deskP;
    N._deskP = fetch('/api/news/desk?limit=40', { cache: 'no-store' }).then(r => r.json()).then(j => { N.desk = { stories: (j && j.stories) || [], loaded: true, at: Date.now(), writer: j && j.writer, updated: j && j.updated_at }; })
      .catch(() => { N.desk = { stories: N.desk.stories || [], loaded: true, at: Date.now() }; }).finally(() => { N._deskP = null; N.rerender(); });
    return N._deskP;
  };
  const agoD = d => { const t = Date.parse(d || ''); if (!t) return ''; const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  const pick = (st, k) => (N.lang === 'hi' && st[k + '_hi']) ? st[k + '_hi'] : st[k];
  N.storyText = st => [pick(st, 'headline'), pick(st, 'summary'), pick(st, 'why')].filter(Boolean).join('. ');
  N.card = function (st, i, n) {
    const src = st.sources || []; const first = src[0] || {};
    const names = src.slice(0, 2).map(x => esc(SRC[String(x.name || '').replace(/\.(com|in|co\.uk|org|net)$/,'').replace(/\./g, '')] || x.name)).join(' · ') + (src.length > 2 ? ' +' + (src.length - 2) : '');
    const key = 'desk:' + st.id; const v = voiceBtn(key, 18);
    let h = '<article class="nx-card' + (hasDev(pick(st, 'summary')) ? ' hi' : '') + '" data-i="' + i + '">';
    if (st.image) h += '<div class="nx-card-img"><img src="' + esc(st.image) + '" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>';
    h += '<div class="nx-card-b"><div class="nx-card-k"><span>' + esc(N.lang === 'hi' ? ({ india: 'भारत', world: 'दुनिया', business: 'कारोबार', tech: 'टेक', science: 'विज्ञान' }[st.category] || st.label || '') : (st.label || st.category || '')) + '</span>' + (agoD(st.published_at) ? ' · ' + agoD(st.published_at) : '') + '<em>' + (i + 1) + ' / ' + n + '</em></div>';
    h += '<h3>' + esc(pick(st, 'headline')) + '</h3><p>' + esc(pick(st, 'summary')) + '</p>';
    if (pick(st, 'why')) h += '<p class="nx-why"><b>' + (N.lang === 'hi' ? 'क्यों ज़रूरी' : 'Why it matters') + '</b> ' + esc(pick(st, 'why')) + '</p>';
    h += '</div><div class="nx-card-f"><div class="nx-card-src">' + I('newspaper', 14) + '<span>' + (src.length > 1 ? (N.lang === 'hi' ? src.length + ' स्रोत: ' : src.length + ' sources: ') : '') + names + '</span></div>';
    h += '<div class="nx-card-a"><button class="b-btn' + (v.on ? ' on' : '') + '" onclick="NewsChannel.sayStory(' + i + ')">' + v.icon + (v.on && v.s === 'playing' ? T('pause') : T('listen')) + '</button>';
    h += '<button class="b-chip" onclick="NewsChannel.explainStory(' + i + ')">' + I('sparkles', 16) + T('explain') + '</button>';
    if (first.link) h += '<button class="b-chip icon" aria-label="' + T('open') + '" onclick="NewsChannel.readStory(' + i + ')">' + I('book-open', 18) + '</button>';
    h += '</div></div></article>';
    return h;
  };
  N.sayStory = function (i) { const st = N.desk.stories[i]; if (st) N.say(N.storyText(st), 'desk:' + st.id, N.lang === 'hi' && st.summary_hi ? 'hi' : 'en'); };
  N.explainStory = function (i) { const st = N.desk.stories[i]; if (!st) return; const f = (st.sources || [])[0] || {}; N.explainObj({ title: st.headline, desc: st.summary + ' ' + (st.why || ''), link: f.link }); };
  N.readStory = function (i) { const st = N.desk.stories[i]; if (!st) return; const f = (st.sources || [])[0] || {}; N.readItem({ title: f.title || st.headline, link: f.link, source: f.name, desc: st.summary, img: st.image }); };
  N.deckHtml = function () {
    if (!N.desk.loaded) { N.loadDesk(); return skelRows(3); }
    N.loadDesk();
    const list = N.desk.stories || [];
    if (!list.length) {
      const live = items();
      return '<div class="nx-soon">' + (window.mascot ? window.mascot('idle', 44) : '') + '<span>' + (N.lang === 'hi' ? 'Brodoit डेस्क पहली ख़बरें लिख रहा है — कुछ मिनट में यहाँ।' : 'The Brodoit desk is writing its first stories — they land here within minutes.') + '</span></div>' + (live.length ? '<div class="nx-list">' + live.slice(0, 12).map(N.row).join('') + '</div>' : skelRows(4));
    }
    requestAnimationFrame(N.sizeDeck);
    return '<div class="nx-deck" id="nxDeck">' + list.map((st, i) => N.card(st, i, list.length)).join('') + '</div>';
  };
  // The deck fills exactly the space between the tabs and the bottom tab bar, whatever the phone.
  N.sizeDeck = function () {
    const d = document.getElementById('nxDeck'); if (!d) return;
    const bar = document.querySelector('.tabs.page-t'); const r = bar && bar.getBoundingClientRect();
    const bottom = r && r.top > innerHeight * 0.6 ? r.top : innerHeight;
    const hgt = Math.max(360, Math.floor(bottom - d.getBoundingClientRect().top - 10));
    if (Math.abs((parseFloat(d.style.height) || 0) - hgt) > 1) d.style.height = hgt + 'px';
  };
  window.addEventListener('resize', () => { if (window.S && S.tab === 'news') N.sizeDeck(); });

  N.html = function () {
    const hi = N.lang === 'hi';
    let h = '<div class="nw">';
    h += '<div class="nw-top"><div class="b-h1">' + (hi ? 'ख़बरें' : 'News') + '</div><div class="nw-lang"><button class="' + (N.lang === 'en' ? 'on' : '') + '" onclick="NewsChannel.setLang(\'en\')">English</button><button class="' + (N.lang === 'hi' ? 'on' : '') + '" onclick="NewsChannel.setLang(\'hi\')">हिंदी</button></div></div>';
    h += '<div class="nw-tabs">' + [['top', hi ? 'टॉप' : 'Top'], ['today', hi ? 'बुलेटिन' : 'Bulletin'], ['live', T('live')], ['archive', T('past')], ['monthly', T('monthly')]].map(x => '<button class="' + (N.view === x[0] ? 'on' : '') + '" onclick="NewsChannel.setView(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';
    const list = items();
    if (N.view === 'top') h += N.deckHtml();
    else if (!N.loaded) h += skelRows(4);
    else if (N.view === 'today') {
      h += N.latest ? N.bulletinCard(N.latest, { hero: true, full: true }) : '<div class="nx-soon">' + (window.mascot ? window.mascot('sleeping', 44) : '') + '<span>' + T('empty') + '</span></div>';
      if (list.length) h += '<div class="nx-sec"><h2>' + T('top') + '</h2><button class="b-chip" onclick="NewsChannel.setView(\'live\')">' + T('seeAll') + '</button></div><div class="nx-list">' + list.slice(0, 12).map(N.row).join('') + '</div>';
      else if (S.newsLoading || !(S.news && S.news.all)) h += '<div class="nx-sec"><h2>' + T('top') + '</h2></div>' + skelRows(4);
    } else if (N.view === 'live') {
      if (!list.length) h += (S.newsLoading || !(S.news && S.news.all)) ? skelRows(6) : '<div class="nw-empty">' + (window.mascot ? window.mascot('sleeping', 96) : '') + '<b>' + T('emptyLive') + '</b></div>';
      else { h += '<div class="nx-list">' + list.slice(0, N.liveLimit).map(N.row).join('') + '</div>'; if (list.length > N.liveLimit) h += '<div class="nx-more"><button class="b-chip" onclick="NewsChannel.liveLimit+=12;NewsChannel.rerender()">' + T('more') + ' · ' + (list.length - N.liveLimit) + '</button></div>'; }
    } else if (N.view === 'archive') {
      const past = N.list.filter(b => !N.latest || b.id !== N.latest.id);
      h += past.length ? past.map(b => N.bulletinCard(b, {})).join('') : '<div class="nw-empty">' + (window.mascot ? window.mascot('idle', 96) : '') + '<b>' + T('past') + '</b>' + T('past0') + '</div>';
    } else {
      h += N.monthly.length ? N.monthly.map(b => N.bulletinCard(b, { full: true })).join('') : '<div class="nw-empty">' + (window.mascot ? window.mascot('idle', 96) : '') + '<b>' + T('month') + '</b>' + T('monthly0') + '</div>';
    }
    h += '</div>';
    N._paintReader();
    return h;
  };
  // "Explain simply" sheet — unchanged markup.
  N.sheetHtml = function () {
    let h = '';
    const d = N.open.data;
    h += '<div class="nw-sheet-bg" onclick="NewsChannel.closeExplain()"></div><div class="nw-sheet"><div class="nw-sheet-h"><b>💡 In simple words</b><button onclick="NewsChannel.closeExplain()">✕</button></div><div class="nw-sheet-t">' + esc(N.open.title) + '</div>';
    if (!d) h += '<div class="nw-empty">Bro is reading the story…</div>';
    else if (d.error) h += '<div class="nw-empty">' + esc(d.error) + '</div>';
    else {
      h += '<div class="nw-x"><div class="nw-x-h">English <button onclick="NewsChannel.speakText(' + JSON.stringify(d.easy).replace(/"/g, '&quot;') + ')">🔈</button></div><p>' + esc(d.easy) + '</p></div>';
      h += '<div class="nw-x"><div class="nw-x-h">हिंदी <button onclick="NewsChannel.speakText(' + JSON.stringify(d.hi).replace(/"/g, '&quot;') + ')">🔈</button></div><p>' + esc(d.hi) + '</p></div>';
      if (d.words && d.words.length) h += '<div class="nw-x"><div class="nw-x-h">Hard words</div>' + d.words.map(w => '<div class="nw-w"><b>' + esc(w.w) + '</b> — ' + esc(w.m) + ' <span>· ' + esc(w.hi) + '</span></div>').join('') + '</div>';
      if (N.open.link) h += '<a class="b-btn ghost wide" href="' + esc(N.open.link) + '" target="_blank" rel="noopener" style="margin-top:12px">Read the original ↗</a>';
    }
    h += '</div>';
    return h;
  };
})();
