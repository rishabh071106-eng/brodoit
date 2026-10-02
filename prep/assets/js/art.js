// Hand-drawn style SVG scenes used across Prep (no external images, works offline).
// Every scene is 400x300 and fills its box (slice), so it can be used as a card or banner.
let n = 0;
const uid = p => `${p}${++n}`;
const svg = (body, defs = '') =>
  `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
const lin = (id, stops, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`;
// A simple person: x,y = feet position; s = scale; c = shirt colour.
const person = (x, y, s = 1, c = '#1F2937', skin = '#F2C29B') =>
  `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-9" y="-46" width="18" height="30" rx="8" fill="${c}"/><rect x="-8" y="-18" width="7" height="18" rx="3" fill="#1E293B"/><rect x="1" y="-18" width="7" height="18" rx="3" fill="#1E293B"/><circle cx="0" cy="-56" r="9" fill="${skin}"/><path d="M-9 -58a9 9 0 0 1 18 0v-3a9 7 0 0 0-18 0z" fill="#2B1B12"/></g>`;
const sun = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r * 1.7}" fill="${c}" opacity=".18"/>`;

export const art = {
  defence() {
    const g = uid('d');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(300, 90, 34, '#FFE7A3')}
      <path d="M0 210 L80 140 L150 200 L230 120 L320 190 L400 150 V300 H0Z" fill="#0F3D2E" opacity=".8"/>
      <path d="M0 240 L100 190 L200 235 L300 185 L400 230 V300 H0Z" fill="#0A2A20"/>
      <g fill="#fff"><path d="M70 80 l40 -8 l8 -12 l6 12 l30 4 l-30 4 l-6 12 l-8 -12z"/><path d="M150 110 l28 -6 l6 -9 l4 9 l22 3 l-22 3 l-4 9 l-6 -9z" opacity=".85"/></g>
      <path d="M118 74 Q60 78 0 70" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/><path d="M184 105 Q120 110 0 112" stroke="#fff" stroke-width="1.5" opacity=".4" fill="none"/>
      <rect x="330" y="150" width="3" height="70" fill="#E5E7EB"/><path d="M333 150 h34 v8 h-34z" fill="#FF9933"/><path d="M333 158 h34 v8 h-34z" fill="#fff"/><path d="M333 166 h34 v8 h-34z" fill="#138808"/>`,
      lin(g, ['#1F7A4D', '#7FB069', '#F2D492']));
  },
  ssb(sign = true) {
    const g = uid('s'), r = uid('r');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(200, 120, 40, '#FFD27A')}
      <path d="M0 200 Q100 170 200 190 T400 185 V300 H0Z" fill="#1B2A4A"/>
      <path d="M170 300 L195 196 h10 L230 300Z" fill="url(#${r})"/>
      <g fill="#0E1A33"><rect x="120" y="120" width="16" height="80"/><rect x="264" y="120" width="16" height="80"/><path d="M112 118 h176 v18 h-176z"/></g>
      ${sign ? `<text x="200" y="132" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="13" fill="#FFD27A" letter-spacing="3">SELECTION CENTRE</text>` : ''}
      <g fill="#0E1A33"><circle cx="50" cy="180" r="22"/><rect x="47" y="180" width="6" height="25"/><circle cx="350" cy="176" r="26"/><rect x="347" y="176" width="6" height="28"/></g>
      ${person(212, 260, .9, '#F2A541')}`,
      lin(g, ['#2B4C8C', '#8C6BB1', '#F2A541']) + lin(r, ['#C9D3E6', '#5B6B8C']));
  },
  civil() {
    const g = uid('c');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(80, 80, 28, '#FFF0C2')}
      <ellipse cx="200" cy="140" rx="70" ry="44" fill="#FBE3C2"/><rect x="190" y="80" width="20" height="20" fill="#FBE3C2"/><rect x="198" y="58" width="4" height="24" fill="#FBE3C2"/>
      <rect x="100" y="140" width="200" height="16" fill="#F6D6A8"/>
      <g fill="#F6D6A8">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `<rect x="${108 + i * 21}" y="158" width="10" height="70"/>`).join('')}</g>
      <rect x="90" y="226" width="220" height="14" fill="#F6D6A8"/><rect x="70" y="240" width="260" height="60" fill="#7A3A12"/>
      <path d="M0 260 h70 v40 h-70z M330 260 h70 v40 h-70z" fill="#5A2A0E"/>`,
      lin(g, ['#B5541B', '#E58A3C', '#FFC46B']));
  },
  banking() {
    const g = uid('b');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <path d="M60 230 L120 190 L170 205 L230 140 L290 160 L350 90" stroke="#5FD3E8" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="350" cy="90" r="9" fill="#fff"/>
      <g transform="translate(110 70)"><path d="M0 40 L70 0 L140 40Z" fill="#E6F4FA"/><rect x="5" y="40" width="130" height="10" fill="#E6F4FA"/>${[0, 1, 2, 3].map(i => `<rect x="${15 + i * 32}" y="52" width="14" height="60" fill="#E6F4FA"/>`).join('')}<rect x="0" y="112" width="140" height="12" fill="#E6F4FA"/></g>
      <circle cx="300" cy="225" r="38" fill="#FFC24B"/><circle cx="300" cy="225" r="30" fill="#FFD66E"/>
      <text x="300" y="238" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="36" fill="#9A6200">₹</text>`,
      lin(g, ['#0B2545', '#13568C', '#2E86C1']));
  },
  it() {
    const g = uid('i');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <circle cx="320" cy="70" r="60" fill="#FF7AC6" opacity=".35"/><circle cx="70" cy="240" r="70" fill="#7C5CFF" opacity=".35"/>
      <rect x="95" y="70" width="210" height="140" rx="12" fill="#120A2A"/><rect x="103" y="78" width="194" height="124" rx="6" fill="#1E1446"/>
      ${[[115, 95, 80, '#FF7AC6'], [125, 112, 120, '#9B87FF'], [125, 129, 60, '#5FD3E8'], [135, 146, 100, '#FFD27A'], [125, 163, 70, '#9B87FF'], [115, 180, 40, '#FF7AC6']].map(([x, y, w, c]) => `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${c}"/>`).join('')}
      <path d="M70 214 h260 l-20 18 h-220z" fill="#2A1A5E"/>
      <text x="40" y="110" font-family="monospace" font-weight="700" font-size="34" fill="#fff" opacity=".8">{</text><text x="340" y="200" font-family="monospace" font-weight="700" font-size="34" fill="#fff" opacity=".8">}</text>`,
      lin(g, ['#1B0B3A', '#5B2BD9', '#C04BD9']));
  },
  me() {
    const g = uid('m');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <path d="M200 60 C240 110 260 130 250 180 C245 215 220 235 200 235 C175 235 150 215 150 182 C150 150 175 140 180 110 C195 125 200 140 196 160 C215 140 215 100 200 60Z" fill="#FFE07A"/>
      <path d="M200 140 C215 165 222 180 216 200 C212 214 205 220 200 220 C190 220 182 210 183 198 C184 185 195 178 196 165 C202 172 204 178 203 186 C210 176 208 160 200 140Z" fill="#fff"/>
      ${[[60, 70], [330, 60], [80, 230], [320, 240], [40, 150], [360, 150]].map(([x, y]) => `<path d="M${x} ${y - 8} l2.5 5.5 l5.5 2.5 l-5.5 2.5 l-2.5 5.5 l-2.5 -5.5 l-5.5 -2.5 l5.5 -2.5z" fill="#fff" opacity=".85"/>`).join('')}`,
      lin(g, ['#2A0A0A', '#FF5A1F', '#FFC24B']));
  },

  // ---- SSB journey stages ----
  written() {
    const g = uid('w');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="70" y="190" width="260" height="14" rx="4" fill="#5B3A1E"/><rect x="90" y="204" width="10" height="70" fill="#5B3A1E"/><rect x="300" y="204" width="10" height="70" fill="#5B3A1E"/>
      <g transform="rotate(-6 200 140)"><rect x="130" y="70" width="140" height="120" rx="6" fill="#fff"/>
      ${[0, 1, 2, 3, 4, 5].map(r => [0, 1, 2, 3].map(c => `<circle cx="${160 + c * 26}" cy="${92 + r * 16}" r="5" fill="${(r + c) % 3 === 0 ? '#1F2937' : 'none'}" stroke="#94A3B8" stroke-width="1.5"/>`).join('')).join('')}</g>
      <g transform="rotate(35 300 120)"><rect x="290" y="60" width="12" height="110" rx="3" fill="#FFC24B"/><path d="M290 170 l6 16 l6 -16z" fill="#F2C29B"/><rect x="290" y="56" width="12" height="10" fill="#F472B6"/></g>`,
      lin(g, ['#DCE7F7', '#B7C9E8']));
  },
  callup() {
    const g = uid('cu');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="140" y="40" width="120" height="220" rx="20" fill="#111827"/><rect x="148" y="56" width="104" height="188" rx="10" fill="#F8FAFC"/>
      <rect x="160" y="80" width="80" height="54" rx="6" fill="#FFF7E6" stroke="#F2A541" stroke-width="2"/><path d="M160 82 L200 112 L240 82" stroke="#F2A541" stroke-width="2" fill="none"/>
      <rect x="160" y="148" width="80" height="8" rx="4" fill="#CBD5E1"/><rect x="160" y="164" width="60" height="8" rx="4" fill="#CBD5E1"/>
      <rect x="160" y="190" width="80" height="26" rx="13" fill="#16A34A"/><text x="200" y="208" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="11" fill="#fff">QUALIFIED ✓</text>
      ${[[90, 80], [320, 110], [80, 210], [330, 220]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#F2A541"/>`).join('')}`,
      lin(g, ['#FFE9C7', '#FFC98A']));
  },
  arrival() {
    const g = uid('a');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(320, 70, 24, '#FFF3C4')}
      <rect x="0" y="230" width="400" height="70" fill="#4B5563"/><rect x="0" y="226" width="400" height="6" fill="#9CA3AF"/>
      <g><rect x="20" y="150" width="250" height="70" rx="14" fill="#1E3A8A"/><rect x="20" y="150" width="250" height="16" rx="8" fill="#F59E0B"/>
      ${[0, 1, 2, 3, 4].map(i => `<rect x="${36 + i * 46}" y="176" width="34" height="24" rx="4" fill="#BFDBFE"/>`).join('')}
      <circle cx="60" cy="224" r="9" fill="#111"/><circle cx="230" cy="224" r="9" fill="#111"/></g>
      <rect x="300" y="110" width="6" height="120" fill="#374151"/><rect x="282" y="96" width="44" height="22" rx="4" fill="#111827"/>
      <text x="304" y="111" text-anchor="middle" font-family="monospace" font-size="11" fill="#FBBF24">06:40</text>
      ${person(340, 262, 1, '#F2A541')}<rect x="350" y="214" width="16" height="22" rx="3" fill="#7C2D12"/>`,
      lin(g, ['#FDE68A', '#FDBA74']));
  },
  screening() {
    const g = uid('sc');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="40" y="40" width="150" height="110" rx="10" fill="#fff"/><rect x="50" y="50" width="130" height="90" rx="6" fill="#CBD5E1" filter="blur(0)"/>
      <g opacity=".55">${person(90, 132, .7, '#64748B')}${person(130, 132, .7, '#475569')}</g><rect x="50" y="50" width="130" height="90" rx="6" fill="#E2E8F0" opacity=".45"/>
      <text x="115" y="170" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="12" fill="#1E293B">PPDT · 30 sec</text>
      <g transform="translate(250 60)"><rect width="110" height="90" rx="10" fill="#fff"/>
      ${[[15, 15, '#5B2BD9'], [45, 15, '#FF5A1F'], [75, 15, '#5B2BD9'], [15, 45, '#FF5A1F'], [45, 45, '#5B2BD9'], [75, 45, '#94A3B8']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="22" height="22" rx="4" fill="${c}"/>`).join('')}
      <text x="86" y="62" text-anchor="middle" font-weight="800" font-size="18" fill="#fff">?</text></g>
      <text x="305" y="172" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="12" fill="#1E293B">OIR test</text>
      <ellipse cx="200" cy="250" rx="120" ry="26" fill="#94A3B8" opacity=".5"/>
      ${[0, 1, 2, 3, 4, 5, 6].map(i => { const a = Math.PI + i * Math.PI / 6; return person(200 + Math.cos(a) * 110, 262 + Math.sin(a) * 8, .62, ['#F2A541', '#2B4C8C', '#1F7A4D', '#FF5A1F', '#5B2BD9', '#0EA5E9', '#BE123C'][i]); }).join('')}`,
      lin(g, ['#E0E7FF', '#C7D2FE']));
  },
  psych() {
    const g = uid('p');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <g transform="rotate(-8 120 130)"><rect x="60" y="70" width="120" height="150" rx="10" fill="#fff"/><rect x="72" y="82" width="96" height="80" rx="6" fill="#DDD6FE"/>${person(120, 158, .7, '#6D28D9')}<rect x="72" y="172" width="80" height="6" rx="3" fill="#E5E7EB"/><rect x="72" y="184" width="60" height="6" rx="3" fill="#E5E7EB"/></g>
      <rect x="210" y="60" width="150" height="56" rx="14" fill="#111827"/><text x="285" y="96" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="22" fill="#FDE68A" letter-spacing="2">COURAGE</text>
      <circle cx="285" cy="190" r="48" fill="#fff"/><circle cx="285" cy="190" r="40" fill="none" stroke="#7C3AED" stroke-width="8" stroke-dasharray="180 260" transform="rotate(-90 285 190)"/>
      <text x="285" y="198" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="22" fill="#111827">15s</text>`,
      lin(g, ['#EDE9FE', '#C4B5FD']));
  },
  gto() {
    const g = uid('gt');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(340, 60, 22, '#FFF7D6')}
      <rect x="0" y="230" width="400" height="70" fill="#4D7C0F"/>
      <rect x="60" y="190" width="40" height="40" rx="6" fill="#B45309"/><rect x="250" y="190" width="40" height="40" rx="6" fill="#B45309"/>
      <rect x="50" y="182" width="250" height="10" rx="3" fill="#78350F"/>
      <rect x="320" y="120" width="8" height="110" fill="#78350F"/><rect x="370" y="120" width="8" height="110" fill="#78350F"/><path d="M324 130 Q350 150 374 130" stroke="#FDE68A" stroke-width="3" fill="none"/>
      ${person(150, 182, .8, '#DC2626')}${person(185, 182, .8, '#2563EB')}${person(120, 230, .8, '#16A34A')}${person(220, 230, .8, '#F59E0B')}${person(30, 230, .8, '#7C3AED')}
      <path d="M20 120 v-40 l24 10 l-24 10" fill="#DC2626"/><rect x="18" y="80" width="3" height="150" fill="#1F2937"/>`,
      lin(g, ['#BAE6FD', '#FEF3C7']));
  },
  interview() {
    const g = uid('iv');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="0" y="220" width="400" height="80" fill="#3F2A1D"/><rect x="250" y="40" width="100" height="70" rx="6" fill="#FDF6E3" opacity=".9"/><path d="M300 50 l10 20 h-20z" fill="#B45309" opacity=".5"/>
      <rect x="120" y="170" width="160" height="12" rx="4" fill="#7C4A2D"/><rect x="135" y="182" width="8" height="40" fill="#7C4A2D"/><rect x="257" y="182" width="8" height="40" fill="#7C4A2D"/>
      <rect x="70" y="150" width="34" height="70" rx="8" fill="#1F2937"/>${person(100, 222, 1.05, '#0F172A')}
      <rect x="296" y="150" width="34" height="70" rx="8" fill="#1F2937"/>${person(300, 222, 1.05, '#F2A541')}
      <rect x="185" y="150" width="30" height="20" rx="3" fill="#fff"/><rect x="230" y="156" width="10" height="14" rx="2" fill="#93C5FD"/>`,
      lin(g, ['#FDE7C8', '#E9B98B']));
  },
  conference() {
    const g = uid('cf');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="40" y="150" width="320" height="18" rx="6" fill="#14532D"/>
      ${[80, 140, 200, 260, 320].map((x, i) => person(x, 150, .8, ['#0F172A', '#1E3A8A', '#14532D', '#7F1D1D', '#0F172A'][i])).join('')}
      <rect x="40" y="168" width="320" height="60" fill="#166534"/>
      ${person(200, 285, 1.1, '#F2A541')}
      <g transform="translate(200 70)"><circle r="26" fill="#FBBF24"/><circle r="19" fill="#F59E0B"/><path d="M0 -10 l3 7 l8 0 l-6 5 l2 8 l-7 -4 l-7 4 l2 -8 l-6 -5 l8 0z" fill="#fff"/><path d="M-12 22 l-6 30 l18 -10 l18 10 l-6 -30" fill="#DC2626"/></g>`,
      lin(g, ['#DCFCE7', '#86EFAC']));
  },
  medical() {
    const g = uid('md');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="60" y="70" width="280" height="150" rx="16" fill="#fff"/>
      <path d="M80 150 h60 l14 -40 l20 80 l18 -60 l12 20 h96" stroke="#E5484D" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="320" cy="90" r="16" fill="#E5484D"/><path d="M320 82 v16 M312 90 h16" stroke="#fff" stroke-width="4"/>
      <path d="M110 230 q0 40 40 40 q40 0 40 -40" stroke="#334155" stroke-width="6" fill="none"/><circle cx="190" cy="226" r="10" fill="#334155"/>`,
      lin(g, ['#FEE2E2', '#FBCFE8']));
  },
  academy() {
    const g = uid('ac');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(200, 90, 36, '#FFE7A3')}
      <rect x="0" y="230" width="400" height="70" fill="#1F2937"/>
      <g fill="#7F1D1D"><rect x="70" y="100" width="40" height="130"/><rect x="290" y="100" width="40" height="130"/><path d="M60 92 h290 v22 h-290z"/></g>
      <text x="200" y="108" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="12" fill="#FDE68A" letter-spacing="3">ACADEMY</text>
      ${[130, 160, 190, 220, 250].map(x => person(x, 262, .8, '#14532D')).join('')}
      <rect x="198" y="20" width="3" height="50" fill="#E5E7EB"/><path d="M201 20 h30 v7 h-30z" fill="#FF9933"/><path d="M201 27 h30 v7 h-30z" fill="#fff"/><path d="M201 34 h30 v7 h-30z" fill="#138808"/>`,
      lin(g, ['#FDBA74', '#F472B6', '#7C3AED']));
  },
  merit() {
    const g = uid('mt');
    return svg(`<rect width="400" height="300" fill="url(#${g})"/>
      <rect x="110" y="40" width="180" height="230" rx="12" fill="#fff"/><rect x="130" y="60" width="140" height="14" rx="7" fill="#111827"/>
      ${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="130" y="${92 + i * 24}" width="20" height="12" rx="3" fill="#CBD5E1"/><rect x="158" y="${92 + i * 24}" width="${i === 2 ? 112 : 90}" height="12" rx="6" fill="${i === 2 ? '#16A34A' : '#E2E8F0'}"/>`).join('')}
      <circle cx="300" cy="150" r="26" fill="#16A34A"/><path d="M288 150 l9 9 l16 -18" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`,
      lin(g, ['#D1FAE5', '#A7F3D0']));
  },

  // ---- practice pictures (deliberately vague, like real PPDT/TAT slides) ----
  ppdt1() {
    return svg(`<rect width="400" height="300" fill="#9CA3AF"/><rect y="200" width="400" height="100" fill="#6B7280"/>
      <path d="M0 200 Q200 180 400 205" stroke="#4B5563" stroke-width="30" fill="none"/>
      <rect x="230" y="160" width="90" height="40" rx="8" fill="#374151"/><circle cx="250" cy="202" r="10" fill="#1F2937"/><circle cx="300" cy="202" r="10" fill="#1F2937"/>
      ${person(200, 220, 1.1, '#4B5563', '#D1D5DB')}${person(150, 230, 1, '#374151', '#D1D5DB')}${person(340, 210, .8, '#4B5563', '#D1D5DB')}
      <circle cx="80" cy="140" r="40" fill="#6B7280"/><rect x="76" y="140" width="8" height="70" fill="#4B5563"/>`);
  },
  ppdt2() {
    return svg(`<rect width="400" height="300" fill="#A8A29E"/><rect y="210" width="400" height="90" fill="#78716C"/>
      <path d="M0 230 Q120 200 200 230 T400 225 V300 H0Z" fill="#57534E"/>
      <rect x="40" y="110" width="90" height="100" fill="#78716C"/><path d="M30 112 L85 70 L140 112Z" fill="#57534E"/><rect x="72" y="160" width="24" height="50" fill="#44403C"/>
      ${person(230, 245, 1.1, '#57534E', '#D6D3D1')}${person(270, 250, .9, '#44403C', '#D6D3D1')}
      <rect x="300" y="190" width="40" height="30" rx="4" fill="#57534E"/><path d="M180 150 q30 -40 60 0" stroke="#57534E" stroke-width="4" fill="none" opacity=".6"/>`);
  },
  ppdt3() {
    return svg(`<rect width="400" height="300" fill="#94A3B8"/><rect y="190" width="400" height="110" fill="#64748B"/>
      <path d="M0 260 C80 230 160 280 240 250 S360 240 400 255 V300 H0Z" fill="#475569"/>
      <rect x="250" y="80" width="110" height="110" fill="#64748B"/><rect x="270" y="100" width="22" height="22" fill="#CBD5E1" opacity=".6"/><rect x="310" y="100" width="22" height="22" fill="#475569"/>
      ${person(150, 250, 1.1, '#475569', '#E2E8F0')}${person(110, 255, .7, '#334155', '#E2E8F0')}
      <path d="M190 210 l40 -10" stroke="#334155" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="90" r="22" fill="#CBD5E1" opacity=".6"/>`);
  },
};

export const categoryArt = { defence: art.defence, civil: art.civil, banking: art.banking, it: art.it };
export const examArt = id => ({ ssb: art.ssb, nda: art.defence, cds: art.defence, afcat: art.defence, 'upsc-cse': art.civil, 'gate-cse': art.it }[id]);
