// Game icons: simple geometric marks drawn in currentColor, made to sit in a tinted .ui-ic tile.
// No colours, no fonts, no DOM: safe to import anywhere (the main app's Learn page uses icon()).
//   icon(id, size = 24) → '<svg …>' on a 24-unit grid; '' for an unknown id.
//   art(id)             → the same mark on a tinted square (kept for older call sites).
const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';

const MARKS = {
  // 3×3 grid, three cells lit
  memory: (() => {
    const lit = new Set([1, 3, 8]);
    let h = '';
    for (let i = 0; i < 9; i++) {
      const x = 3 + (i % 3) * 6.5, y = 3 + Math.floor(i / 3) * 6.5;
      h += `<rect x="${x}" y="${y}" width="5" height="5" rx="1.4" fill="currentColor"${lit.has(i) ? '' : ' opacity=".28"'}/>`;
    }
    return h;
  })(),
  // two overlapping squares: one outlined, one filled
  clash: '<rect x="3" y="3" width="12.5" height="12.5" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/>'
    + '<rect x="8.5" y="8.5" width="12.5" height="12.5" rx="3.2" fill="currentColor"/>',
  // the numerals 1 2 3
  hunt: `<g ${S}><path d="M3.2 8.6 5.6 6.8V17.2"/><path d="M9.6 9.1a2.45 2.45 0 0 1 4.9.1c0 1.3-.9 2.2-1.9 3.2L9.6 17.2h5"/>`
    + '<path d="M17.6 7.6a2.4 2.4 0 0 1 4.1 1.6c0 1.3-1 2.2-2.3 2.2 1.5 0 2.6 1 2.6 2.6a2.6 2.6 0 0 1-4.6 1.7"/></g>',
  // four operators: + − × ÷
  math: `<g ${S}><path d="M6.6 3.4v7M3.1 6.9h7"/><path d="M14.2 6.9h6.8"/><path d="m4.1 14.6 5 5M9.1 14.6l-5 5"/><path d="M14.2 17.1h6.8"/></g>`
    + '<circle cx="17.6" cy="13.9" r="1.1" fill="currentColor"/><circle cx="17.6" cy="20.3" r="1.1" fill="currentColor"/>',
  // the letterform Aa
  words: `<g ${S}><path d="M2.8 18.5 7.6 5.5l4.8 13"/><path d="M4.6 14h6"/><circle cx="17.6" cy="15.1" r="3.4"/><path d="M21 11.2v7.3"/></g>`,
};

export const ICON_IDS = Object.keys(MARKS);

export function icon(id, size = 24) {
  const m = MARKS[id];
  if (!m) return '';
  const s = Math.max(8, +size || 24);
  return `<svg class="m-icon" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${m}</svg>`;
}

// Compatibility: the mark centred on a tinted rounded square (12% of currentColor). The old `deep` and `cls`
// arguments are accepted; size the result with CSS (width/height) like the old art.
export function art(id, deep, cls = '') {
  const m = MARKS[id];
  if (!m) return '';
  return `<svg class="m-art ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect width="48" height="48" rx="12" fill="currentColor" opacity=".12"/><g transform="translate(12 12)">${m}</g></svg>`;
}
