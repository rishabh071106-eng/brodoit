// Brodoit game sounds: short Web Audio effects shared by the Python course (/code/) and Mind games (/mind/).
// No voice — just tap / flip / tick / go / correct / combo / wrong / star / levelup / unlock: window.Sfx.play('correct').
// Muting is remembered per device (localStorage 'bd.sfx' = 'off'). Plain script (no module) so any page can load it.
(function () {
  'use strict';
  let ctx = null;
  const muted = () => { try { return localStorage.getItem('bd.sfx') === 'off'; } catch (e) { return false; } };
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function tone(c, freq, start, dur, gain, type) {
    const t = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.14, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    tap: c => tone(c, 660, 0, 0.05, 0.06),
    flip: c => tone(c, 520, 0, 0.07, 0.07, 'triangle'),
    tick: c => tone(c, 1200, 0, 0.03, 0.04, 'square'),
    go: c => { tone(c, 880, 0, 0.09); tone(c, 1320, 0.11, 0.12); },
    correct: c => { tone(c, 523, 0, 0.14); tone(c, 784, 0.08, 0.18); },
    combo: c => { tone(c, 659, 0, 0.1); tone(c, 880, 0.06, 0.1); tone(c, 1175, 0.12, 0.16); },
    wrong: c => { const t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.linearRampToValueAtTime(120, t + 0.22); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.26); },
    star: c => { tone(c, 988, 0, 0.12, 0.1, 'triangle'); tone(c, 1319, 0.07, 0.18, 0.1, 'triangle'); },
    levelup: c => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.08, 0.22, 0.12)),
    unlock: c => { tone(c, 392, 0, 0.12, 0.1, 'triangle'); tone(c, 587, 0.1, 0.14, 0.1, 'triangle'); tone(c, 784, 0.2, 0.26, 0.12, 'triangle'); },
  };
  window.Sfx = {
    play(kind) { if (muted()) return; const c = ac(); const f = SOUNDS[kind]; if (c && f) { try { f(c); } catch (e) { /* audio is optional */ } } },
    muted,
    setMuted(on) { try { localStorage.setItem('bd.sfx', on ? 'off' : 'on'); } catch (e) {} },
    unlock() { const c = ac(); if (c) { try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {} } },
  };
})();
