// Step-by-step pictures of how each SSB task is actually done (shown in the task sheet).
import { art, svg, lin, person, sun, uid } from './art.js?v=9';

const scene = (body, a = '#E0F2FE', b = '#FEF9C3', groundColor = '#65A30D') => {
  const g = uid('st');
  return svg(`<rect width="400" height="300" fill="url(#${g})"/>${sun(350, 45, 16, '#FDE68A')}<rect x="0" y="236" width="400" height="64" fill="${groundColor}"/>${body}`, lin(g, [a, b]));
};
const T = (x, y, t, c = '#0E0E10', s = 13) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="${s}" fill="${c}">${t}</text>`;
const wood = '#92400E';
const plank = (x1, y1, x2, y2, w = 8) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${wood}" stroke-width="${w}" stroke-linecap="round"/>`;
const post = (x, h, c = '#fff', w = 14) => `<rect x="${x}" y="${236 - h}" width="${w}" height="${h}" fill="${c}" stroke="#1F2937" stroke-width="1.5"/>`;
const rope = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#D6A75C" stroke-width="4" stroke-linecap="round"/>`;
// Person in motion: arms up / leaning. dx,dy shift; r = rotation.
const runner = (x, y, r = 0, c = '#DC2626', s = 1) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">
  <rect x="-8" y="-44" width="16" height="26" rx="7" fill="${c}"/><path d="M-6 -20 l-8 20 M6 -20 l10 18" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
  <path d="M-7 -40 l-14 -12 M7 -40 l14 -12" stroke="#F2C29B" stroke-width="5" stroke-linecap="round"/><circle cx="0" cy="-53" r="9" fill="#F2C29B"/></g>`;

const O = {
  // ---- the 10 individual obstacles ----
  io1: () => scene(`<path d="M60 236 L220 150 L260 150 L260 236Z" fill="#B45309"/>${runner(150, 186, -25)}${runner(300, 200, 15, '#2563EB')}<path d="M262 150 q20 0 30 30" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 40, '1 · Single ramp')}`),
  io2: () => scene(`<rect x="150" y="196" width="40" height="40" rx="6" fill="#475569"/><rect x="200" y="196" width="40" height="40" rx="6" fill="#475569"/>${runner(195, 170, -10)}<path d="M120 230 q75 -110 150 0" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 40, '2 · Double barrel')}`),
  io3: () => scene(`<rect x="60" y="176" width="280" height="8" fill="${wood}"/>${post(80, 60, '#78350F', 8)}${post(312, 60, '#78350F', 8)}${runner(200, 176, 0)}${T(200, 40, '3 · Balancing beam')}`),
  io4: () => scene(`<rect x="60" y="176" width="70" height="60" fill="#B45309"/><rect x="190" y="140" width="6" height="96" fill="#1F2937"/><rect x="196" y="140" width="40" height="40" fill="#E5E7EB" stroke="#1F2937"/><rect x="250" y="226" width="100" height="10" fill="#A16207"/>${runner(170, 150, 20)}<path d="M130 176 q60 -80 140 45" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 40, '4 · Screen jump')}`),
  io5: () => scene(`${post(60, 110, '#78350F', 10)}${post(330, 110, '#78350F', 10)}${rope(65, 190, 335, 190)}${rope(65, 140, 335, 140)}${rope(65, 140, 200, 185)}${rope(335, 140, 200, 185)}${runner(200, 190, 0, '#16A34A')}${T(200, 40, '5 · Burma bridge')}`),
  io6: () => scene(`<rect x="50" y="146" width="80" height="90" fill="#B45309"/><rect x="230" y="70" width="120" height="8" fill="${wood}"/>${rope(290, 78, 290, 200)}${runner(200, 150, -40)}<path d="M130 146 q60 -40 150 0" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 40, '6 · Tiger leap')}`),
  io7: () => scene(`<rect x="140" y="50" width="160" height="10" fill="${wood}"/>${post(140, 186, '#78350F', 10)}${post(290, 186, '#78350F', 10)}${rope(220, 60, 220, 236)}${runner(220, 150, 0, '#7C3AED')}${T(200, 34, '7 · Rope climbing')}`),
  io8: () => scene(`<rect x="90" y="236" width="70" height="40" fill="#78350F"/><rect x="230" y="236" width="70" height="40" fill="#78350F"/>${runner(195, 220, 10)}<path d="M60 232 q65 -70 130 0 q65 -70 130 0" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 40, '8 · Double ditch')}`),
  io9: () => scene(`${post(60, 120, '#78350F', 8)}${post(200, 120, '#78350F', 8)}${post(340, 120, '#78350F', 8)}<path d="M60 116 L204 100 L344 116" stroke="${wood}" stroke-width="7" fill="none"/>${runner(140, 108, 0, '#0EA5E9')}${T(200, 40, '9 · Commando walk')}`),
  io10: () => scene(`<rect x="40" y="130" width="70" height="106" fill="#B45309"/><rect x="180" y="50" width="160" height="10" fill="${wood}"/>${post(330, 186, '#78350F', 10)}${rope(240, 60, 180, 150)}${runner(180, 190, -30, '#E5484D')}<path d="M110 130 q80 120 200 60" stroke="#94A3B8" stroke-dasharray="4 4" fill="none"/>${T(200, 34, '10 · Tarzan swing')}`),

  // ---- PPDT ----
  ppdt1: () => svg(`<rect width="400" height="300" fill="#111827"/><rect x="60" y="40" width="280" height="190" rx="10" fill="#9CA3AF" filter="blur(0)"/><g opacity=".6">${person(160, 210, 1, '#4B5563', '#D1D5DB')}${person(230, 215, .9, '#374151', '#D1D5DB')}</g>${T(200, 265, 'Step 1 · Look at the hazy picture — 30 s', '#FDE68A')}`),
  ppdt2: () => svg(`<rect width="400" height="300" fill="#FFF7ED"/><rect x="80" y="40" width="240" height="190" rx="10" fill="#fff" stroke="#FED7AA" stroke-width="3"/>
    ${['Characters: 3', 'Age: 20 · M · +ve', 'Mood: worried → hopeful', 'Action: truck stuck'].map((t, i) => `<text x="100" y="${82 + i * 36}" font-family="Plus Jakarta Sans,sans-serif" font-weight="700" font-size="14" fill="#9A3412">${t}</text>`).join('')}
    ${T(200, 265, 'Step 2 · Note characters in the box — 1 min', '#9A3412')}`),
  ppdt3: () => svg(`<rect width="400" height="300" fill="#EEF2FF"/><rect x="70" y="30" width="260" height="200" rx="10" fill="#fff"/>
    ${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="90" y="${54 + i * 24}" width="${i === 6 ? 120 : 220}" height="8" rx="4" fill="#C7D2FE"/>`).join('')}
    <g transform="rotate(35 320 170)"><rect x="312" y="110" width="10" height="90" rx="3" fill="#FFC24B"/></g>${T(200, 265, 'Step 3 · Write the story — 3 min', '#3730A3')}`),
  ppdt4: () => art.screening(),

  // ---- GPE ----
  gpe1: () => svg(`<rect width="400" height="300" fill="#F0FDF4"/><rect x="60" y="80" width="280" height="130" rx="14" fill="#BBF7D0" stroke="#15803D" stroke-width="3"/><path d="M60 150 C140 120 220 190 340 140" stroke="#38BDF8" stroke-width="12" fill="none"/>
    ${person(40, 260, 1.1, '#14532D')}<path d="M52 205 L120 160" stroke="#78350F" stroke-width="4"/>${[0, 1, 2, 3, 4].map(i => person(150 + i * 45, 270, .7, ['#DC2626', '#2563EB', '#F59E0B', '#7C3AED', '#0EA5E9'][i])).join('')}${T(220, 40, 'Step 1 · GTO explains the model', '#14532D')}`),
  gpe2: () => svg(`<rect width="400" height="300" fill="#FEFCE8"/>${[0, 1, 2].map(i => `<g transform="translate(${40 + i * 120} 80)"><rect width="100" height="130" rx="8" fill="#fff" stroke="#E5E7EB"/>${[0, 1, 2, 3, 4].map(r => `<rect x="12" y="${18 + r * 20}" width="${70 - r * 6}" height="7" rx="3" fill="#FDE68A"/>`).join('')}</g>`).join('')}${T(200, 40, 'Step 2 · Everyone writes a plan — 10 min', '#713F12')}`),
  gpe3: () => art.screening(),

  // ---- PGT / HGT / FGT ----
  pgt1: () => scene(`${post(60, 70)}${post(170, 90, '#EF4444')}${post(280, 70, '#3B82F6')}${person(40, 236, 1.1, '#14532D')}${T(200, 40, 'Step 1 · Briefing: rules & colours')}${T(200, 60, 'white usable · red out · blue body only', '#334155', 11)}`),
  pgt2: () => scene(`${post(60, 70)}${post(190, 90)}${plank(67, 166, 197, 146)}${runner(110, 156, -10)}${person(240, 236, .8, '#2563EB')}${person(280, 236, .8, '#16A34A')}${T(200, 40, 'Step 2 · Place the plank, first man across')}`),
  pgt3: () => scene(`${post(60, 70)}${post(190, 90)}${plank(67, 166, 197, 146)}<rect x="115" y="128" width="26" height="22" rx="4" fill="#78350F"/>${person(100, 160, .8, '#DC2626')}${person(155, 152, .8, '#2563EB')}${T(200, 40, 'Step 3 · Pass the load together')}`),
  pgt4: () => scene(`${post(60, 70)}${post(190, 90)}${post(320, 70)}${plank(197, 146, 327, 166)}${[220, 250, 280, 300].map((x, i) => person(x, 166 - (x - 197) / 6.5, .75, ['#DC2626', '#2563EB', '#16A34A', '#F59E0B'][i])).join('')}${T(200, 40, 'Step 4 · Whole group + load at finish')}`),
  // ---- Command task ----
  cmd1: () => scene(`${person(110, 236, 1.2, '#B45309')}<rect x="60" y="120" width="110" height="34" rx="17" fill="#fff"/>${T(115, 142, 'Plan: plank → drum', '#0E0E10', 11)}${person(200, 236, .9, '#1E3A8A')}${person(240, 236, .9, '#1E3A8A')}${T(200, 40, 'Step 1 · Explain your plan clearly')}`),
  cmd2: () => scene(`${post(250, 70)}${plank(170, 200, 257, 166)}${person(160, 236, .9, '#1E3A8A')}${person(230, 236, .9, '#1E3A8A')}${person(90, 236, 1.1, '#B45309')}<path d="M100 196 l40 -16" stroke="#F2C29B" stroke-width="5" stroke-linecap="round"/>${T(200, 40, 'Step 2 · Short, clear orders')}`),
  cmd3: () => scene(`${post(250, 70)}${person(257, 166, .9, '#1E3A8A')}${person(285, 166, .9, '#1E3A8A')}${person(330, 236, 1.1, '#B45309')}${T(200, 40, 'Step 3 · Finish, report to the GTO')}`),
  // ---- Snake race ----
  sn1: () => scene(`<path d="M40 210 C120 190 200 215 330 195" stroke="#15803D" stroke-width="16" fill="none" stroke-linecap="round"/>${[70, 130, 190, 250, 300].map((x, i) => person(x, 236, .8, ['#DC2626', '#2563EB', '#F59E0B', '#7C3AED', '#0EA5E9'][i])).join('')}${T(200, 40, 'Step 1 · Lift the snake together')}`),
  sn2: () => scene(`<rect x="170" y="190" width="60" height="46" fill="#A16207"/><path d="M60 200 C140 160 200 150 330 190" stroke="#15803D" stroke-width="16" fill="none" stroke-linecap="round"/>${person(190, 190, .8, '#2563EB')}${person(110, 236, .8, '#DC2626')}${person(280, 236, .8, '#F59E0B')}${T(200, 40, 'Step 2 · Cross obstacles, snake never drops')}`),
  sn3: () => scene(`<path d="M120 210 C200 200 260 215 340 200" stroke="#15803D" stroke-width="16" fill="none" stroke-linecap="round"/>${[150, 200, 250, 300].map((x, i) => runner(x, 236, 0, ['#DC2626', '#2563EB', '#F59E0B', '#7C3AED'][i], .9)).join('')}<rect x="360" y="150" width="6" height="86" fill="#1F2937"/><path d="M366 150 h26 l-6 10 l6 10 h-26z" fill="#DC2626"/>${T(200, 40, 'Step 3 · Sprint to the finish, shout your slogan!')}`),
  // ---- Lecturette ----
  lec1: () => svg(`<rect width="400" height="300" fill="#FDF2F8"/>${['Startups', 'Space', 'Women in Army', 'Climate'].map((t, i) => `<g transform="translate(${50 + (i % 2) * 170} ${70 + Math.floor(i / 2) * 90})"><rect width="140" height="70" rx="12" fill="${i === 1 ? '#BE185D' : '#fff'}"/>${T(70, 40, t, i === 1 ? '#fff' : '#831843', 13)}</g>`).join('')}${T(200, 40, 'Step 1 · Pick 1 of 4 topics', '#831843')}`),
  lec2: () => svg(`<rect width="400" height="300" fill="#FFF1F2"/><rect x="110" y="70" width="180" height="170" rx="12" fill="#fff"/>${['Intro', 'Point 1', 'Point 2', 'Point 3', 'Conclusion'].map((t, i) => `<text x="130" y="${102 + i * 28}" font-family="Plus Jakarta Sans,sans-serif" font-weight="700" font-size="14" fill="#9F1239">${i + 1}. ${t}</text>`).join('')}${T(200, 40, 'Step 2 · 3 minutes to plan', '#9F1239')}`),
  lec3: () => svg(`<rect width="400" height="300" fill="#FCE7F3"/><rect x="0" y="236" width="400" height="64" fill="#831843"/>${person(200, 236, 1.4, '#0F172A')}<path d="M150 170 h100 l-8 66 h-84z" fill="#9D174D"/>${[60, 100, 300, 340].map((x, i) => person(x, 290, .7, ['#DC2626', '#2563EB', '#16A34A', '#F59E0B'][i])).join('')}<rect x="250" y="80" width="120" height="34" rx="17" fill="#fff"/>${T(310, 102, '…and that is why', '#831843', 11)}${T(200, 40, 'Step 3 · Speak for 3 minutes', '#831843')}`),
};

export const STEPS = {
  io: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ cap: ['Single ramp', 'Double barrel', 'Balancing beam', 'Screen jump', 'Burma bridge', 'Tiger leap', 'Rope climbing', 'Double ditch', 'Commando walk', 'Tarzan swing'][n - 1] + ` · ${n} point${n > 1 ? 's' : ''}`, a: O['io' + n] })),
  ppdt: [['Look closely for 30 s', 'ppdt1'], ['Note characters — 1 min', 'ppdt2'], ['Write your story — 3 min', 'ppdt3'], ['Narrate, then discuss as a group', 'ppdt4']].map(([cap, k]) => ({ cap, a: O[k] })),
  gpe: [['GTO explains the model', 'gpe1'], ['Write your own plan — 10 min', 'gpe2'], ['Discuss, agree, one person presents', 'gpe3']].map(([cap, k]) => ({ cap, a: O[k] })),
  pgt: [['Briefing & colour rules', 'pgt1'], ['Plank across, first person over', 'pgt2'], ['Pass the load together', 'pgt3'], ['Everyone + load at the finish', 'pgt4']].map(([cap, k]) => ({ cap, a: O[k] })),
  hgt: [['Half the group, one obstacle', 'pgt1'], ['Same rules — your ideas count more', 'pgt2'], ['Finish together', 'pgt4']].map(([cap, k]) => ({ cap, a: O[k] })),
  fgt: [['One last obstacle', 'pgt1'], ['Keep the energy up', 'pgt3'], ['Finish as a team', 'pgt4']].map(([cap, k]) => ({ cap, a: O[k] })),
  command: [['Explain your plan', 'cmd1'], ['Give clear orders', 'cmd2'], ['Finish & report', 'cmd3']].map(([cap, k]) => ({ cap, a: O[k] })),
  snake: [['Lift the snake together', 'sn1'], ['Over the obstacles', 'sn2'], ['Sprint to the flag', 'sn3']].map(([cap, k]) => ({ cap, a: O[k] })),
  lecturette: [['Pick 1 of 4 topics', 'lec1'], ['Plan in 3 minutes', 'lec2'], ['Speak for 3 minutes', 'lec3']].map(([cap, k]) => ({ cap, a: O[k] })),
};
