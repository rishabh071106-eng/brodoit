// Meera, the animated phrase-lesson host (ported from AI Academy): an inline SVG presenter that breathes, blinks, nods,
// gestures and lip-syncs to whatever is speaking.
//   const host = createPresenter(el);
//   host.setLevel(0..1)     mouth openness for this frame (from an audio analyser or simulated)
//   host.setGesture('idle' | 'wave' | 'point' | 'explain' | 'listen')
//   host.setTalking(bool)   adds head/eyebrow motion while she speaks

const SVG = `
<svg viewBox="0 0 320 480" class="presenter-svg" role="img" aria-label="Meera, your language coach">
  <defs>
    <radialGradient id="pz-spot" cx="50%" cy="38%" r="60%">
      <stop offset="0" stop-color="#6C4CF1" stop-opacity=".28"/><stop offset=".55" stop-color="#FF5A36" stop-opacity=".07"/><stop offset="1" stop-color="#6C4CF1" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="pz-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2a982"/><stop offset="1" stop-color="#cf9169"/></linearGradient>
    <linearGradient id="pz-blazer" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a5cf0"/><stop offset="1" stop-color="#4a33b5"/></linearGradient>
    <linearGradient id="pz-sleeve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6c50e6"/><stop offset="1" stop-color="#4f38bf"/></linearGradient>
    <linearGradient id="pz-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2219"/><stop offset="1" stop-color="#1d110c"/></linearGradient>
    <linearGradient id="pz-tab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2a44"/><stop offset="1" stop-color="#0e1424"/></linearGradient>
    <clipPath id="pz-mouth-clip"><ellipse class="pz-mclip" cx="160" cy="152" rx="11" ry="1"/></clipPath>
  </defs>

  <ellipse cx="160" cy="230" rx="158" ry="230" fill="url(#pz-spot)"/>
  <ellipse cx="160" cy="470" rx="105" ry="10" fill="#000" opacity=".16"/>

  <g class="pz-body">
    <!-- trousers -->
    <path d="M108 408 L104 480 L156 480 L160 420 L164 480 L216 480 L212 408 Z" fill="#1c2238"/>
    <!-- back hair (falls behind shoulders) -->
    <g class="pz-hairback"><path d="M101 112 C96 60 132 38 162 38 C198 38 226 62 220 116 C224 160 230 200 236 236 C214 246 190 240 176 230 L146 230 C130 242 104 246 86 236 C94 196 100 160 101 112 Z" fill="url(#pz-hair)"/></g>
    <!-- torso -->
    <g class="pz-torso">
      <path d="M128 196 L192 196 L198 250 L122 250 Z" fill="#f4f5fa"/>
      <path d="M92 222 C104 204 124 198 138 196 L160 262 L182 196 C196 198 216 204 228 222 L222 330 L218 414 L102 414 L98 330 Z" fill="url(#pz-blazer)"/>
      <path d="M138 196 L160 262 L148 300 L126 218 Z" fill="#5b42cf"/>
      <path d="M182 196 L160 262 L172 300 L194 218 Z" fill="#5b42cf"/>
      <path d="M150 300 L160 262 L170 300 L160 410 Z" fill="#3d2a9a" opacity=".55"/>
      <circle cx="160" cy="330" r="3.2" fill="#c9b8ff"/><circle cx="160" cy="362" r="3.2" fill="#c9b8ff"/>
      <rect x="186" y="244" width="16" height="3" rx="1.5" fill="#00d4ff" opacity=".9"/>
    </g>
    <!-- left arm (viewer's left) holds a tablet -->
    <g class="pz-armL" style="transform-origin:100px 226px">
      <rect x="86" y="222" width="28" height="92" rx="14" fill="url(#pz-sleeve)"/>
      <g class="pz-foreL" style="transform-origin:100px 306px">
        <rect x="88" y="298" width="24" height="76" rx="12" fill="url(#pz-sleeve)"/>
        <circle cx="100" cy="380" r="12" fill="url(#pz-skin)"/>
        <g transform="rotate(14 100 380)"><rect x="80" y="352" width="40" height="56" rx="6" fill="url(#pz-tab)" stroke="#3b4a6e" stroke-width="2"/><rect x="85" y="358" width="30" height="40" rx="3" fill="#00d4ff" opacity=".18"/></g>
        <ellipse cx="108" cy="374" rx="7" ry="9" fill="url(#pz-skin)"/>
      </g>
    </g>
    <!-- neck -->
    <path d="M146 166 L174 166 L176 202 C166 210 154 210 144 202 Z" fill="#c4865f"/>
    <!-- head -->
    <g class="pz-head" style="transform-origin:160px 196px">
      <ellipse cx="104" cy="128" rx="8" ry="13" fill="#cf9169"/><ellipse cx="216" cy="128" rx="8" ry="13" fill="#cf9169"/>
      <circle cx="104" cy="146" r="3.5" fill="#f5c542"/><circle cx="216" cy="146" r="3.5" fill="#f5c542"/>
      <path d="M106 112 C106 70 130 52 160 52 C190 52 214 70 214 112 C214 150 194 182 160 186 C126 182 106 150 106 112 Z" fill="url(#pz-skin)"/>
      <!-- cheeks -->
      <ellipse cx="128" cy="146" rx="11" ry="6" fill="#e77f6d" opacity=".22"/><ellipse cx="192" cy="146" rx="11" ry="6" fill="#e77f6d" opacity=".22"/>
      <!-- eyebrows -->
      <g class="pz-brows">
        <path d="M124 104 Q138 96 150 103" stroke="#2a1812" stroke-width="3.6" fill="none" stroke-linecap="round"/>
        <path d="M170 103 Q182 96 196 104" stroke="#2a1812" stroke-width="3.6" fill="none" stroke-linecap="round"/>
      </g>
      <!-- eyes -->
      <g class="pz-eye" style="transform-origin:138px 120px">
        <ellipse cx="138" cy="120" rx="10" ry="7" fill="#fff"/>
        <circle class="pz-iris" cx="139" cy="120" r="5.4" fill="#3b2316"/><circle cx="141" cy="118" r="1.7" fill="#fff"/>
        <path d="M127 117 Q138 109 149 117" stroke="#1d110c" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      </g>
      <g class="pz-eye" style="transform-origin:182px 120px">
        <ellipse cx="182" cy="120" rx="10" ry="7" fill="#fff"/>
        <circle class="pz-iris" cx="183" cy="120" r="5.4" fill="#3b2316"/><circle cx="185" cy="118" r="1.7" fill="#fff"/>
        <path d="M171 117 Q182 109 193 117" stroke="#1d110c" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      </g>
      <circle cx="160" cy="98" r="2.6" fill="#c2185b" opacity=".85"/>
      <!-- nose -->
      <path d="M160 124 Q156 138 153 141 Q160 145 167 141" stroke="#b47452" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <!-- mouth: a smile when closed, an opening that grows with the voice level -->
      <g class="pz-mouth">
        <ellipse class="pz-mopen" cx="160" cy="152" rx="11" ry="1" fill="#6b1f26"/>
        <g clip-path="url(#pz-mouth-clip)">
          <rect x="146" y="140" width="28" height="8" class="pz-teeth" fill="#fff"/>
          <ellipse cx="160" cy="166" rx="8" ry="6" fill="#d9566b"/>
        </g>
        <path class="pz-lips" d="M147 151 Q160 160 173 151" stroke="#b54a55" stroke-width="3" fill="none" stroke-linecap="round"/>
      </g>
      <!-- front hair -->
      <path d="M104 116 C98 64 132 40 166 42 C200 44 222 70 216 116 C212 96 204 80 188 72 C170 86 140 92 116 86 C110 94 106 104 104 116 Z" fill="url(#pz-hair)"/>
      <path d="M116 86 C140 92 170 86 188 72 C176 64 150 62 132 70 Z" fill="#4a2c20" opacity=".55"/>
    </g>
    <!-- right arm (viewer's right) gestures towards the board -->
    <g class="pz-armR" style="transform-origin:220px 226px">
      <rect x="206" y="222" width="28" height="92" rx="14" fill="url(#pz-sleeve)"/>
      <g class="pz-foreR" style="transform-origin:220px 306px">
        <rect x="208" y="298" width="24" height="76" rx="12" fill="url(#pz-sleeve)"/>
        <rect x="210" y="368" width="20" height="8" rx="3" fill="#f4f5fa"/>
        <g class="pz-hand" style="transform-origin:220px 382px">
          <ellipse cx="220" cy="388" rx="11" ry="13" fill="url(#pz-skin)"/>
          <rect class="pz-finger" x="216" y="390" width="7" height="20" rx="3.5" fill="#d99c75"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;

// Target joint angles per gesture: [armR, foreR, armL, foreL, handR]
const POSES = {
  idle:    [6, -14, -6, -70, 0],
  listen:  [4, -24, -6, -70, 0],
  explain: [-14, -100, -6, -70, -20],
  point:   [-72, -18, -6, -70, -8],
  wave:    [-150, 22, -6, -70, 0],
};

export function createPresenter(container) {
  container.innerHTML = SVG;
  const q = sel => container.querySelector(sel);
  const qa = sel => [...container.querySelectorAll(sel)];
  const el = {
    body: q('.pz-body'), torso: q('.pz-torso'), head: q('.pz-head'), brows: q('.pz-brows'), eyes: qa('.pz-eye'),
    irises: qa('.pz-iris'), mopen: q('.pz-mopen'), mclip: q('.pz-mclip'), lips: q('.pz-lips'), teeth: q('.pz-teeth'),
    armR: q('.pz-armR'), foreR: q('.pz-foreR'), armL: q('.pz-armL'), foreL: q('.pz-foreL'), hand: q('.pz-hand'),
    hairBack: q('.pz-hairback'),
  };
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let target = 0, level = 0, talking = false, gesture = 'idle';
  let pose = [...POSES.idle];
  let blinkAt = performance.now() + 1500, blinkT = -1;
  let gaze = 0, gazeTarget = 0, gazeAt = 0, raf = 0;

  function frame(now) {
    const t = now / 1000;
    // Mouth: fast attack, slower release, like real jaw motion.
    level += (target - level) * (target > level ? 0.55 : 0.25);
    const open = Math.max(0, Math.min(1, level));
    const ry = 1 + open * 10, rx = 11 - open * 2.5;
    for (const m of [el.mopen, el.mclip]) { m.setAttribute('ry', ry.toFixed(2)); m.setAttribute('rx', rx.toFixed(2)); m.setAttribute('cy', (152 + open * 3).toFixed(2)); }
    el.teeth.setAttribute('y', (152 - ry + 0.5).toFixed(2));
    el.lips.setAttribute('d', `M${147 + open * 2} 151 Q160 ${160 - open * 9} ${173 - open * 2} 151`);
    el.lips.style.opacity = open > 0.12 ? 0.35 : 1;

    // Breathing + gentle sway.
    const breathe = reduceMotion ? 0 : Math.sin(t * 1.6);
    el.torso.style.transform = `translateY(${breathe * 0.8}px) scaleY(${1 + breathe * 0.006})`;
    el.body.style.transform = reduceMotion ? '' : `rotate(${Math.sin(t * 0.5) * 0.6}deg)`;
    el.body.style.transformOrigin = '160px 470px';

    // Head: nods and tilts with the voice, idles slowly otherwise.
    const nod = talking ? Math.sin(t * 5.2) * 1.6 * (0.4 + open) : 0;
    const tilt = Math.sin(t * 0.8) * 2 + (gesture === 'point' ? 3 : gesture === 'listen' ? -4 : 0);
    el.head.style.transform = reduceMotion ? '' : `translateY(${nod * 0.6 + breathe * 0.5}px) rotate(${tilt + nod * 0.5}deg)`;
    el.hairBack.style.transform = el.head.style.transform;
    el.hairBack.style.transformOrigin = '160px 196px';
    el.brows.style.transform = `translateY(${talking ? -Math.max(0, Math.sin(t * 2.3)) * 2.4 - open * 1.2 : 0}px)`;

    // Blink every 2–5 s.
    if (now > blinkAt && blinkT < 0) blinkT = now;
    let lid = 1;
    if (blinkT >= 0) {
      const p = (now - blinkT) / 160;
      lid = p < 1 ? Math.abs(1 - p * 2) : 1;
      if (p >= 1) { blinkT = -1; blinkAt = now + 2000 + Math.random() * 3000; }
    }
    for (const e of el.eyes) e.style.transform = `scaleY(${Math.max(0.08, lid)})`;
    // Glance towards the board when pointing, at the learner otherwise.
    if (now > gazeAt) { gazeTarget = gesture === 'point' ? 2.5 : (Math.random() - 0.5) * 2.4; gazeAt = now + 1200 + Math.random() * 2000; }
    gaze += (gazeTarget - gaze) * 0.08;
    for (const i of el.irises) i.style.transform = `translateX(${gaze}px)`;

    // Arms ease towards the gesture pose; waving and explaining add motion on top.
    const goal = POSES[gesture] || POSES.idle;
    pose = pose.map((v, i) => v + (goal[i] - v) * 0.09);
    let [aR, fR, aL, fL, h] = pose;
    if (!reduceMotion) {
      if (gesture === 'wave') fR += Math.sin(t * 9) * 16;
      else if (gesture === 'explain' && talking) { aR += Math.sin(t * 2.6) * 6; fR += Math.sin(t * 3.4 + 1) * 10; h += Math.sin(t * 4) * 8; }
      else if (gesture === 'point') fR += Math.sin(t * 2) * 2;
      aL += Math.sin(t * 1.6) * 0.8;
    }
    el.armR.style.transform = `rotate(${aR}deg)`;
    el.foreR.style.transform = `rotate(${fR}deg)`;
    el.hand.style.transform = `rotate(${h}deg)`;
    el.armL.style.transform = `rotate(${aL}deg)`;
    el.foreL.style.transform = `rotate(${fL}deg)`;

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setLevel(v) { target = v; },
    setTalking(v) { talking = v; if (!v) target = 0; },
    setGesture(g) { gesture = POSES[g] ? g : 'idle'; },
    destroy() { cancelAnimationFrame(raf); },
  };
}
