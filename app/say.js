// Bro's voice, everywhere the app speaks (v20). One player for every screen: meditations, tab intros, the coach, lessons,
// book narration, the language courses. It reads text in Bro's own voice from the server (POST /api/voice/tts, Bro Core on
// our CPU) sentence by sentence, fetching the next sentence while the current one plays, and falls back to the phone's
// voice only when Bro's voice cannot answer (not signed in, not loaded yet, busy): then BroSay.lastFallback says why.
// Plain script, no modules; works in the SPA and in the standalone pages (lang/, mind/, code/).
//   BroSay.speak(text, { lang, mood, rate, onstart, onend, onprogress(i, n) }) → handle { stop(), pause(), resume() }
//   BroSay.one(text, opts) → the same for one short line (no splitting)
//   BroSay.clip(url, opts) → play a ready-made clip (course lines from /api/learn/say), same handle
//   BroSay.stop() stops whatever is playing; BroSay.speaking() → true while Bro talks
(function () {
  'use strict';
  const B = window.BroSay = {};
  let cur = null; // the playing handle
  const tok = () => { try { return localStorage.getItem('tf_token') || ''; } catch (e) { return ''; } };
  // sentences, packed up to ~260 characters, so each request is quick to make and the next one is ready in time
  B.split = function (text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return [];
    const parts = t.match(/[^.!?…।]+[.!?…।]+["'’”)]*\s*|[^.!?…।]+$/g) || [t];
    const out = []; let acc = '';
    for (const p of parts) {
      if ((acc + p).length > 260 && acc) { out.push(acc.trim()); acc = ''; }
      if (p.length > 260) { let s = p; while (s.length > 260) { let cut = s.lastIndexOf(' ', 240); if (cut < 120) cut = 240; out.push(s.slice(0, cut).trim()); s = s.slice(cut); } acc = s; continue; }
      acc += p;
    }
    if (acc.trim()) out.push(acc.trim());
    return out.filter(Boolean);
  };
  // Bro's voice for one piece of text → a blob URL, or null when it can't (then the phone's voice reads it)
  async function fetchVoice(text, o, signal) {
    const t = tok(); if (!t) { B.lastFallback = 'signed out'; return null; }
    try {
      const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': t }, body: JSON.stringify({ text, lang: o.lang || '', mood: o.mood || '' }), signal });
      if (!r.ok) { B.lastFallback = r.status === 503 ? 'busy' : r.status === 429 ? 'limit' : 'unavailable'; return null; }
      const blob = await r.blob(); if (!blob.size) return null;
      return URL.createObjectURL(blob);
    } catch (e) { if (!(e && e.name === 'AbortError')) B.lastFallback = 'offline'; return null; }
  }
  // the phone's voice, for one piece (only when Bro's voice could not)
  function device(text, o, done) {
    try {
      if (!('speechSynthesis' in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      const want = String(o.lang || 'en').toLowerCase();
      const v = (speechSynthesis.getVoices() || []).find(x => (x.lang || '').toLowerCase().startsWith(want));
      if (v) { u.voice = v; u.lang = v.lang; } else if (o.lang) u.lang = o.lang;
      u.rate = o.rate || 1; u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } catch (e) { done(); }
  }
  function handle(o) {
    const h = { stopped: false, paused: false, audio: new Audio(), ac: new AbortController(), urls: [], born: Date.now() };
    h.stop = () => { if (h.stopped) return; h.stopped = true; try { h.ac.abort(); } catch (e) {} try { h.audio.pause(); h.audio.removeAttribute('src'); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} h.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} }); if (cur === h) cur = null; };
    h.pause = () => { h.paused = true; try { h.audio.pause(); } catch (e) {} try { speechSynthesis.pause(); } catch (e) {} };
    h.resume = () => { if (!h.paused) return; h.paused = false; try { if (h.audio.src) h.audio.play().catch(() => {}); } catch (e) {} try { speechSynthesis.resume(); } catch (e) {} };
    return h;
  }
  function playUrl(h, url, rate) {
    return new Promise(res => {
      const a = h.audio; a.src = url; a.playbackRate = rate || 1;
      a.onended = () => res(true); a.onerror = () => res(false);
      const p = a.play(); if (p && p.catch) p.catch(() => res(false));
    });
  }
  B.speak = function (text, opts) {
    const o = opts || {}; B.stop();
    const parts = o.whole ? [String(text || '').trim()].filter(Boolean) : B.split(text);
    const h = handle(o); cur = h;
    (async () => {
      if (!parts.length) { if (o.onend) o.onend(); return; }
      let next = fetchVoice(parts[0], o, h.ac.signal);
      for (let i = 0; i < parts.length; i++) {
        if (h.stopped) return;
        const url = await next; if (h.stopped) { if (url) URL.revokeObjectURL(url); return; }
        if (url) h.urls.push(url);
        next = i + 1 < parts.length ? fetchVoice(parts[i + 1], o, h.ac.signal) : null; // the next one is made while this one plays
        if (i === 0 && o.onstart) o.onstart(url ? 'bro' : 'device');
        if (o.onprogress) o.onprogress(i, parts.length);
        while (h.paused && !h.stopped) await new Promise(r => setTimeout(r, 150));
        if (url) { const ok = await playUrl(h, url, o.rate); if (!ok && !h.stopped) await new Promise(r => device(parts[i], o, r)); }
        else await new Promise(r => device(parts[i], o, r));
      }
      if (!h.stopped) { if (cur === h) cur = null; if (o.onend) o.onend(); }
    })();
    return h;
  };
  B.one = (text, opts) => B.speak(text, Object.assign({}, opts, { whole: true }));
  B.clip = function (url, opts) {
    const o = opts || {}; B.stop();
    const h = handle(o); cur = h;
    (async () => {
      if (o.onstart) o.onstart('bro');
      const ok = await playUrl(h, url, o.rate);
      if (h.stopped) return;
      if (!ok && o.text) { const h2 = B.speak(o.text, o); h.stop = h2.stop; return; } // the clip failed: say it live
      if (cur === h) cur = null; if (o.onend) o.onend();
    })();
    return h;
  };
  B.stop = () => { if (cur) cur.stop(); cur = null; };
  // every place that silences the phone's voice (closing a meditation, stopping a book, the coach's stop) silences Bro too
  try {
    if (window.speechSynthesis && !speechSynthesis.__bro) {
      const orig = speechSynthesis.cancel.bind(speechSynthesis);
      // (a cancel fired by the old engine's own clean-up right before Bro started, e.g. _ttsStop's second cancel 60 ms later,
      // must not silence the line Bro just began)
      speechSynthesis.cancel = function () { const h = cur; if (h && Date.now() - h.born < 250) return orig(); cur = null; if (h && !h.stopped) { h.stopped = true; try { h.ac.abort(); } catch (e) {} try { h.audio.pause(); h.audio.removeAttribute('src'); } catch (e) {} } return orig(); };
      speechSynthesis.__bro = true;
    }
  } catch (e) { /* read-only on this browser: the explicit stops still work */ }
  B.speaking = () => !!cur && !cur.stopped;
})();
