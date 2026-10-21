// v21 Bro hears quiet voices: a gentle automatic gain for the microphone, shared by the Languages speak-back
// (lang/assets/lang.js) and voice notes (app/voicenote.js). A soft speaker's recording reaches Bro's hearing at a normal
// level (the server raises it again if needed; this keeps a phone with weak mic gain from sending near-silence).
//   MicGain.wrap(stream, { ac?, maxDb = 24, targetDb = -24, key = 'bd.micGainDb' })
//     → { stream (record this one), ac, analyser (before the gain), level() (0…1, before the gain), gainDb(), close() }
// Chain: mic → high-pass 80 Hz → gain → limiter (compressor at -3 dBFS, 20:1) → a ceiling at -1 dBFS → a new MediaStream.
// The gain follows the speech level of the last 3 s (floor = 15th percentile; speech = frames 6 dB or more above it, power
// mean), toward targetDb, between 0 and maxDb: up at most 1.5 dB per 100 ms, down up to 6 dB; it holds while nobody speaks. The last gain is
// remembered on the phone (localStorage key), so a soft speaker's next recording starts boosted.
(function () {
  'use strict';
  const read = k => { try { const v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? v : null; } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, String(Math.round(v * 10) / 10)); } catch (e) { /* private mode */ } };
  function wrap(stream, o) {
    o = o || {};
    const maxDb = o.maxDb != null ? o.maxDb : 24, target = o.targetDb != null ? o.targetDb : -24, key = o.key || 'bd.micGainDb';
    const AC = window.AudioContext || window.webkitAudioContext;
    const own = !o.ac, ac = o.ac || new AC();
    try { ac.resume(); } catch (e) { /* resumes on the next gesture */ }
    const src = ac.createMediaStreamSource(stream);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
    const an = ac.createAnalyser(); an.fftSize = 1024;
    const g = ac.createGain();
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
    // a ceiling at -1 dBFS after the limiter (its make-up gain and 3 ms attack can let a peak through)
    const ceil = ac.createWaveShaper(), N = 2049, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.191 * Math.tanh((a - 0.7) / 0.191)); }
    ceil.curve = curve; ceil.oversample = '2x';
    const dest = ac.createMediaStreamDestination();
    src.connect(hp); hp.connect(an); hp.connect(g); g.connect(lim); lim.connect(ceil); ceil.connect(dest);
    let db = Math.max(0, Math.min(maxDb, read(key) != null ? read(key) : 0));
    const setGain = v => { db = v; try { g.gain.setTargetAtTime(Math.pow(10, db / 20), ac.currentTime, 0.05); } catch (e) { g.gain.value = Math.pow(10, db / 20); } };
    g.gain.value = Math.pow(10, db / 20);
    const buf = new Float32Array(an.fftSize);
    const level = () => { an.getFloatTimeDomainData(buf); let e = 0; for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i]; return Math.sqrt(e / buf.length); };
    const hist = []; let tick = 0, saved = db;
    const iv = setInterval(() => {
      const l = level(); hist.push(l > 1e-6 ? 20 * Math.log10(l) : -120); if (hist.length > 60) hist.shift(); // 3 s of 50 ms frames
      if (++tick % 2 || hist.length < 10) return;
      const s = hist.slice().sort((a, b) => a - b), floor = s[Math.floor((s.length - 1) * 0.15)];
      const loud = hist.filter(d => d >= floor + 6 && d > -75);
      if (loud.length < 4) return; // nobody speaking: hold the gain
      const speech = 10 * Math.log10(loud.reduce((a, d) => a + Math.pow(10, d / 10), 0) / loud.length);
      const want = Math.max(0, Math.min(maxDb, target - speech));
      const next = db + Math.max(-6, Math.min(1.5, want - db)); // up gently, down fast (a loud voice must not clip)
      if (Math.abs(next - db) >= 0.1) setGain(next);
      if (Math.abs(db - saved) >= 1) { saved = db; write(key, db); }
    }, 50);
    let closed = false;
    return {
      stream: dest.stream, ac, analyser: an, level, gainDb: () => db,
      close() {
        if (closed) return; closed = true; clearInterval(iv); write(key, db);
        try { src.disconnect(); hp.disconnect(); g.disconnect(); lim.disconnect(); ceil.disconnect(); } catch (e) { /* gone */ }
        if (own) { try { ac.close().catch(() => {}); } catch (e) { /* closed */ } }
      },
    };
  }
  window.MicGain = { wrap };
})();
