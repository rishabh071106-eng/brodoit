// Flat illustrations for the five game tiles (inline SVG, drawn for a coloured background).
// art(id, deep) → '<svg …>' ; `deep` is the game's darker shade (shadows, ink on white tiles).
const F = "font-family=\"'Plus Jakarta Sans',system-ui,sans-serif\" font-weight=\"800\"";
const GOLD = '#FFD23F';

const spark = (x, y, r, fill, op = 1) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${op}"/>`;
const halo = `<circle cx="100" cy="78" r="68" fill="#fff" opacity=".09"/><circle cx="100" cy="78" r="48" fill="#fff" opacity=".06"/>`;

function memory(d) {
  const lit = new Set([1, 3, 5, 8]);
  let cells = '';
  for (let i = 0; i < 9; i++) {
    const x = 54 + (i % 3) * 33, y = 36 + Math.floor(i / 3) * 33;
    cells += lit.has(i)
      ? `<rect x="${x - 3}" y="${y - 3}" width="32" height="32" rx="10" fill="#fff" opacity=".28"/><rect x="${x}" y="${y}" width="26" height="26" rx="8" fill="#fff"/><rect x="${x + 5}" y="${y + 5}" width="9" height="5" rx="2.5" fill="${d}" opacity=".18"/>`
      : `<rect x="${x}" y="${y}" width="26" height="26" rx="8" fill="#fff" opacity=".2"/>`;
  }
  return `${halo}<g transform="rotate(-6 100 82)"><rect x="44" y="33" width="112" height="112" rx="24" fill="${d}" opacity=".45"/><rect x="44" y="26" width="112" height="112" rx="24" fill="${d}"/>${cells}</g>
    ${spark(164, 30, 13, GOLD)}${spark(34, 116, 8, '#fff', .85)}${spark(176, 108, 6, '#fff', .6)}`;
}

function clash(d) {
  const drop = (x, y, s, c) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-12C6-3 9 1 9 5.5A9 9 0 0 1-9 5.5C-9 1-6-3 0-12Z" fill="${c}"/>`;
  return `${halo}
    <g transform="rotate(-12 82 64)"><rect x="24" y="30" width="116" height="66" rx="16" fill="#fff" opacity=".26"/>
      <text x="82" y="73" text-anchor="middle" font-size="25" ${F} fill="#fff" letter-spacing="1">RED</text></g>
    <g transform="rotate(7 122 92)"><rect x="60" y="64" width="124" height="70" rx="18" fill="${d}" opacity=".55"/><rect x="60" y="57" width="124" height="70" rx="18" fill="#1D1B26"/>
      <text x="122" y="102" text-anchor="middle" font-size="30" ${F} fill="${GOLD}" letter-spacing="1">BLUE</text>
      <rect x="76" y="114" width="70" height="5" rx="2.5" fill="#fff" opacity=".85"/><rect x="146" y="114" width="22" height="5" rx="2.5" fill="#fff" opacity=".2"/></g>
    ${drop(36, 122, 1.15, '#4D8DFF')}${drop(58, 132, .75, '#2ECC71')}${drop(172, 30, .95, '#FF9533')}${spark(150, 22, 9, '#fff', .8)}`;
}

function hunt(d) {
  const nums = [7, 2, 9, 1, 5, 4, 3, 8, 6], found = new Set([1, 2, 3]);
  let t = '';
  nums.forEach((n, i) => {
    const x = 36 + (i % 3) * 37, y = 30 + Math.floor(i / 3) * 37, f = found.has(n);
    t += `<rect x="${x}" y="${y + 4}" width="31" height="31" rx="9" fill="${d}" opacity="${f ? .15 : .35}"/><rect x="${x}" y="${y}" width="31" height="31" rx="9" fill="#fff" opacity="${f ? .45 : 1}"/>
      <text x="${x + 15.5}" y="${y + 22}" text-anchor="middle" font-size="18" ${F} fill="${d}" opacity="${f ? .55 : 1}">${n}</text>`;
  });
  return `${halo}${t}
    <circle cx="125.5" cy="82.5" r="25" fill="#fff" opacity=".18"/><circle cx="125.5" cy="82.5" r="25" fill="none" stroke="#fff" stroke-width="6"/>
    <path d="M146 105 L166 125" stroke="${d}" stroke-width="13" stroke-linecap="round" opacity=".5"/><path d="M145 102 L165 122" stroke="#fff" stroke-width="11" stroke-linecap="round"/>
    ${spark(170, 34, 12, GOLD)}${spark(30, 128, 7, '#fff', .7)}`;
}

function math(d) {
  const tile = (x, y, r, sym, bg, ink, fs = 36) => `<g transform="rotate(${r} ${x + 24} ${y + 24})"><rect x="${x}" y="${y + 6}" width="48" height="48" rx="15" fill="${d}" opacity=".5"/><rect x="${x}" y="${y}" width="48" height="48" rx="15" fill="${bg}"/>
    <text x="${x + 24}" y="${y + 36}" text-anchor="middle" font-size="${fs}" ${F} fill="${ink}">${sym}</text></g>`;
  return `${halo}${tile(40, 22, -9, '+', '#fff', d)}${tile(108, 16, 7, '×', '#fff', d)}${tile(46, 84, 6, '−', '#fff', d)}${tile(112, 80, -7, '÷', GOLD, '#1D1B26')}
    ${spark(170, 64, 10, '#fff', .9)}${spark(28, 70, 7, GOLD)}`;
}

function words(d) {
  const L = ['W', 'O', 'R', 'D', 'S', 'A'], sel = [0, 1, 2, 3];
  const pos = L.map((_, i) => { const a = (-90 + i * 60) * Math.PI / 180; return [100 + Math.cos(a) * 33, 92 + Math.sin(a) * 33]; });
  const line = sel.map(i => pos[i].map(v => v.toFixed(1)).join(' ')).join(' L');
  let c = '';
  L.forEach((ch, i) => {
    const [x, y] = pos[i], on = sel.includes(i);
    c += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15" fill="${on ? GOLD : '#fff'}"/><text x="${x.toFixed(1)}" y="${(y + 5.5).toFixed(1)}" text-anchor="middle" font-size="16" ${F} fill="${on ? '#1D1B26' : d}">${ch}</text>`;
  });
  let tiles = '';
  'WORD'.split('').forEach((ch, i) => {
    const x = 50 + i * 26;
    tiles += `<rect x="${x}" y="13" width="22" height="22" rx="6" fill="${d}" opacity=".45"/><rect x="${x}" y="9" width="22" height="22" rx="6" fill="#fff"/><text x="${x + 11}" y="25" text-anchor="middle" font-size="13" ${F} fill="${d}">${ch}</text>`;
  });
  return `${halo}<circle cx="100" cy="92" r="52" fill="#fff" opacity=".18"/><circle cx="100" cy="92" r="52" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>
    <path d="M${line}" fill="none" stroke="${GOLD}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>${c}${tiles}
    ${spark(164, 22, 10, GOLD)}${spark(168, 128, 7, '#fff', .75)}`;
}

const ART = { memory, clash, hunt, math, words };
export function art(id, deep = '#000', cls = '') {
  const f = ART[id]; if (!f) return '';
  return `<svg class="m-art ${cls}" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${f(deep)}</svg>`;
}
