// Brodoit News Channel — spoken daily bulletin (English / हिंदी), explain-it-simply, monthly review,
// and the live headline feed. Mounted into the SPA's News tab; uses S, api, esc, toast from the shell.
(function () {
  'use strict';
  const N = window.NewsChannel = { lang: localStorage.getItem('news.lang') || 'en', latest: null, list: [], monthly: [], view: 'today', playing: null, audio: null, open: null, explain: {}, loaded: false };
  const hasDev = s => /[ऀ-ॿ]/.test(s || '');
  const fmtDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; } };
  const PLAY = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
  const PAUSE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>';

  N.load = async function () {
    try { const r = await fetch('/api/bulletins/latest', { cache: 'no-store' }).then(r => r.json()); N.latest = r.daily; N.hasAudio = r.hasAudio; N.monthlyLatest = r.monthly; } catch (e) {}
    try { const r = await fetch('/api/bulletins?kind=daily', { cache: 'no-store' }).then(r => r.json()); N.list = r.items || []; } catch (e) {}
    try { const r = await fetch('/api/bulletins?kind=monthly', { cache: 'no-store' }).then(r => r.json()); N.monthly = r.items || []; } catch (e) {}
    N.loaded = true; N.rerender();
  };
  N.setLang = function (l) { N.lang = l; localStorage.setItem('news.lang', l); if (N.playing) N.stop(); N.rerender(); };
  N.setView = function (v) { N.view = v; N.rerender(); };
  N.rerender = function () { const r = document.getElementById('newsRoot'); if (r && S.tab === 'news') r.innerHTML = N.html(); };

  // ── bulletin player: pre-recorded mp3 when present, else device voice reading the same script ──
  N.play = function (id) {
    const b = [N.latest, ...N.list, ...N.monthly].find(x => x && x.id === id); if (!b) return;
    if (N.playing && N.playing.id === id) { N.toggle(); return; }
    N.stop();
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
    if (!('speechSynthesis' in window) || !text) { toast('No audio yet for this bulletin'); N.playing = null; N.rerender(); return; }
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
  N.stop = function () { try { if (N.audio) { N.audio.pause(); N.audio.src = ''; } } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} N.playing = null; };
  N.setRate = function (r) { N.rate = r; if (N.audio) N.audio.playbackRate = r; N.rerender(); };
  N.paint = function (pct, cur, dur) { const f = document.getElementById('nwFill'); if (f) f.style.width = pct + '%'; const t = document.getElementById('nwTime'); if (t && dur) t.textContent = Math.floor(cur / 60) + ':' + String(Math.floor(cur % 60)).padStart(2, '0') + ' / ' + Math.floor(dur / 60) + ':' + String(Math.floor(dur % 60)).padStart(2, '0'); };

  // ── explain any story simply (EN + HI + hard words) ──
  N.explainItem = async function (i) {
    const it = (S.news && S.news.all || [])[i]; if (!it) return;
    N.open = { title: it.title, desc: it.desc || it.description || '', loading: true }; N.rerender();
    const k = it.title;
    if (!N.explain[k]) { try { N.explain[k] = await api('/news/explain', { method: 'POST', body: JSON.stringify({ title: it.title, desc: it.desc || it.description || it.content || '' }) }); } catch (e) { N.explain[k] = { error: 'Could not explain right now' }; } }
    N.open = { title: it.title, desc: it.desc || '', data: N.explain[k], link: it.link }; N.rerender();
  };
  N.closeExplain = function () { N.open = null; try { speechSynthesis.cancel(); } catch (e) {} N.rerender(); };
  N.speakText = function (text) { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); const hi = hasDev(text); const v = speechSynthesis.getVoices().find(x => hi ? /^hi/i.test(x.lang) : /en-IN/i.test(x.lang)); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = hi ? 'hi-IN' : 'en-IN'; speechSynthesis.speak(u); };
  N.speakHeadline = function (id, idx) { const b = [N.latest, ...N.list, ...N.monthly].find(x => x && x.id === id); const h = b && b.headlines[idx]; if (h) N.speakText(N.lang === 'hi' ? h.hi : h.h + '. ' + h.easy); };

  // ── markup ──
  N.bulletinCard = function (b, big) {
    if (!b) return '';
    const on = N.playing && N.playing.id === b.id; const paused = on && N.playing.paused;
    const hasMp3 = !!(b.audio && b.audio[N.lang]);
    let h = '<div class="nw-card' + (big ? ' big' : '') + (on ? ' on' : '') + '">';
    h += '<div class="nw-row"><button class="nw-play" onclick="NewsChannel.play(\'' + b.id + '\')" aria-label="Play">' + (on && !paused ? PAUSE : PLAY) + '</button><div class="nw-meta"><div class="nw-kicker">' + (b.kind === 'monthly' ? '📅 Month in review' : '📻 Daily bulletin') + ' · ' + (b.kind === 'monthly' ? new Date(b.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : fmtDate(b.date)) + '</div><div class="nw-title">' + esc(N.lang === 'hi' && b.title_hi ? b.title_hi : b.title) + '</div><div class="nw-sub">' + (hasMp3 ? '🎙️ Studio voice' : '🔈 Device voice') + ' · ' + Math.max(2, Math.round(((N.lang === 'hi' ? b.script_hi : b.script_en) || '').length / 850)) + ' min · ' + (N.lang === 'hi' ? 'हिंदी' : 'English') + '</div></div></div>';
    if (on) h += '<div class="nw-prog"><i id="nwFill" style="width:' + (N.playing.pct || 0) + '%"></i></div><div class="nw-ctl"><span id="nwTime"></span><span class="nw-rates">' + [1, 1.25, 1.5].map(r => '<button class="' + ((N.rate || 1) === r ? 'on' : '') + '" onclick="NewsChannel.setRate(' + r + ')">' + r + '×</button>').join('') + '</span><button onclick="NewsChannel.stop();NewsChannel.rerender()">Stop</button></div>';
    if (big) {
      h += '<div class="nw-heads">' + (b.headlines || []).map((x, i) => '<div class="nw-head"><div class="nw-head-top"><span class="nw-topic">' + esc(x.topic || '') + '</span><button class="nw-spk" onclick="NewsChannel.speakHeadline(\'' + b.id + '\',' + i + ')" aria-label="Listen">🔈</button></div><b>' + esc(x.h) + '</b><p>' + esc(N.lang === 'hi' ? x.hi : x.easy) + '</p></div>').join('') + '</div>';
      if (b.script_en) h += '<details class="nw-script"><summary>Read the full bulletin</summary><p>' + esc(N.lang === 'hi' ? b.script_hi : b.script_en).replace(/\n\n/g, '</p><p>') + '</p></details>';
    }
    return h + '</div>';
  };
  N.html = function () {
    let h = '<div class="nw">';
    h += '<div class="nw-top"><div class="b-h1">' + (N.lang === 'hi' ? 'ख़बरें' : 'News') + '</div><div class="nw-lang"><button class="' + (N.lang === 'en' ? 'on' : '') + '" onclick="NewsChannel.setLang(\'en\')">English</button><button class="' + (N.lang === 'hi' ? 'on' : '') + '" onclick="NewsChannel.setLang(\'hi\')">हिंदी</button></div></div>';
    h += '<div class="nw-tabs">' + [['today', 'Today'], ['live', 'Live headlines'], ['archive', 'Past days'], ['monthly', 'Monthly']].map(x => '<button class="' + (N.view === x[0] ? 'on' : '') + '" onclick="NewsChannel.setView(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';
    if (!N.loaded) h += '<div class="nw-empty">Loading…</div>';
    else if (N.view === 'today') {
      h += N.latest ? N.bulletinCard(N.latest, true) : '<div class="nw-empty">' + (window.mascot ? window.mascot('sleeping', 110) : '<div style="font-size:40px">📻</div>') + '<b>' + (N.lang === 'hi' ? 'आज का बुलेटिन आ रहा है' : 'Today\'s bulletin is on its way') + '</b><button class="b-chip" onclick="NewsCh.setView(\'live\')">' + (N.lang === 'hi' ? 'अभी की ख़बरें' : 'Live headlines') + '</button></div>';
      h += '<button class="nw-ask" onclick="switchTab(\'bro\');setTimeout(function(){BroVoice.setPersona(\'news\');BroVoice.start()},300)">🤙 Ask Bro to explain</button>';
    } else if (N.view === 'live') {
      const items = (S.news && S.news.all) || [];
      if (!items.length) h += '<div class="nw-empty">Loading live headlines…</div>';
      items.slice(0, 25).forEach((it, i) => { h += '<article class="nw-item">' + (it.img ? '<img src="' + esc(it.img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<div class="nw-item-b"><div class="nw-kicker">' + esc(it.source || '') + '</div><b>' + esc(it.title) + '</b><p>' + esc(String(it.desc || '').slice(0, 160)) + '</p><div class="nw-item-a"><button class="b-chip on" onclick="NewsChannel.explainItem(' + i + ')">💡 Explain simply</button><button class="b-chip" onclick="NewsChannel.speakText(' + JSON.stringify(it.title + '. ' + String(it.desc || '').slice(0, 300)).replace(/"/g, '&quot;') + ')">🔈 Listen</button><a class="b-chip" href="' + esc(it.link) + '" target="_blank" rel="noopener">Source ↗</a></div></div></article>'; });
    } else if (N.view === 'archive') {
      const past = N.list.filter(b => !N.latest || b.id !== N.latest.id);
      h += past.length ? past.map(b => N.bulletinCard(b, false)).join('') : '<div class="nw-empty">Past bulletins will appear here, one per day.</div>';
    } else {
      h += N.monthly.length ? N.monthly.map(b => N.bulletinCard(b, true)).join('') : '<div class="nw-empty"><div style="font-size:40px">📅</div><b>Month in review</b><p>On the 1st of every month Bro records a 5-minute review of the month\'s biggest stories, in English and Hindi.</p></div>';
    }
    h += '</div>';
    if (N.open) {
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
    }
    return h;
  };
})();
