// Every SSB task with an illustration, what happens, how it's judged and tips.
import { art, svg, lin, person, sun, uid } from './art.js?v=9';

const ground = (c = '#4D7C0F') => `<rect x="0" y="232" width="400" height="68" fill="${c}"/>`;
const sky = (a, b) => { const g = uid('k'); return [`<rect width="400" height="300" fill="url(#${g})"/>`, lin(g, [a, b])]; };
const label = (x, y, t, c = '#0E0E10', size = 12) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="${size}" fill="${c}">${t}</text>`;
const bubble = (x, y, w, t) => `<g><rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="#fff"/><path d="M${x + 14} ${y + 26} l-4 9 l12 -9z" fill="#fff"/>${label(x + w / 2, y + 17, t, '#0E0E10', 11)}</g>`;
const plank = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#92400E" stroke-width="8" stroke-linecap="round"/>`;
// Structure painted with SSB colour rules: white = usable, red = out of bounds, blue = body only.
const post = (x, h, c) => `<rect x="${x}" y="${232 - h}" width="14" height="${h}" fill="${c}" stroke="#1F2937" stroke-width="1.5"/>`;

const ART = {
  oir() {
    const [bg, d] = sky('#EEF2FF', '#C7D2FE');
    return svg(`${bg}
      <g transform="translate(40 50)"><rect width="150" height="190" rx="12" fill="#fff"/>${label(75, 26, 'OIR · Set 1')}
      ${[0, 1, 2, 3].map(r => `<rect x="16" y="${44 + r * 34}" width="80" height="10" rx="5" fill="#E2E8F0"/>${[0, 1, 2, 3].map(c => `<circle cx="${110 + c * 0}" cy="0" r="0"/>`).join('')}<circle cx="${112}" cy="${49 + r * 34}" r="6" fill="${r % 2 ? '#5B2BD9' : 'none'}" stroke="#5B2BD9" stroke-width="2"/><circle cx="${130}" cy="${49 + r * 34}" r="6" fill="${r % 2 ? 'none' : '#5B2BD9'}" stroke="#5B2BD9" stroke-width="2"/>`).join('')}</g>
      <g transform="translate(220 60)"><rect width="140" height="110" rx="12" fill="#fff"/>
      ${[[18, 18, '▲'], [58, 18, '■'], [98, 18, '●'], [18, 60, '■'], [58, 60, '●'], [98, 60, '?']].map(([x, y, t]) => `<rect x="${x}" y="${y}" width="28" height="28" rx="6" fill="${t === '?' ? '#FF5A1F' : '#EDE9FE'}"/>${label(x + 14, y + 20, t, t === '?' ? '#fff' : '#5B2BD9', 14)}`).join('')}</g>
      <g transform="translate(290 225)"><circle r="34" fill="#fff"/><circle r="28" fill="none" stroke="#FF5A1F" stroke-width="6" stroke-dasharray="120 200" transform="rotate(-90)"/>${label(0, 5, '30m', '#0E0E10', 14)}</g>`, d);
  },
  ppdt: () => art.screening(),
  tat() {
    const [bg, d] = sky('#F5F3FF', '#DDD6FE');
    return svg(`${bg}
      ${[0, 1, 2].map(i => `<g transform="translate(${60 + i * 18} ${40 + i * 10}) rotate(${-6 + i * 5})"><rect width="160" height="120" rx="8" fill="#fff" stroke="#E5E7EB"/><rect x="10" y="10" width="140" height="100" rx="4" fill="${['#E5E7EB', '#D1D5DB', '#CBD5E1'][i]}"/></g>`).join('')}
      <g transform="translate(96 60) rotate(4)">${person(60, 100, .9, '#6B7280', '#E5E7EB')}${person(100, 100, .7, '#9CA3AF', '#E5E7EB')}</g>
      <rect x="250" y="70" width="110" height="150" rx="8" fill="#fff"/>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="264" y="${92 + i * 18}" width="${i === 5 ? 50 : 82}" height="7" rx="3.5" fill="#C4B5FD"/>`).join('')}
      ${label(305, 250, '30 s look · 4 min write', '#4C1D95', 12)}${label(130, 250, '11 pictures + 1 blank', '#4C1D95', 12)}`, d);
  },
  wat() {
    const [bg, d] = sky('#111827', '#312E81');
    const words = ['COURAGE', 'FAILURE', 'TEAM', 'MOTHER', 'RISK'];
    return svg(`${bg}${words.map((w, i) => `<g opacity="${1 - i * .17}" transform="translate(200 ${70 + i * 42})"><rect x="-90" y="-20" width="180" height="34" rx="10" fill="${i ? '#1F2937' : '#FDE68A'}"/>${label(0, 4, w, i ? '#C7D2FE' : '#111827', 16)}</g>`).join('')}
      <g transform="translate(340 60)"><circle r="26" fill="#1F2937"/><circle r="20" fill="none" stroke="#FDE68A" stroke-width="5" stroke-dasharray="80 130" transform="rotate(-90)"/>${label(0, 5, '15s', '#fff', 12)}</g>`, d);
  },
  srt() {
    const [bg, d] = sky('#ECFEFF', '#A5F3FC');
    return svg(`${bg}
      <rect x="40" y="40" width="320" height="70" rx="16" fill="#fff"/>${label(200, 70, 'On the way to the exam he sees an', '#0E7490', 13)}${label(200, 90, 'accident on the road. He…', '#0E7490', 13)}
      <rect x="70" y="130" width="260" height="46" rx="14" fill="#0E7490"/>${label(200, 158, '…calls 108, gives first aid, then', '#fff', 12)}
      <rect x="110" y="186" width="220" height="40" rx="14" fill="#0E7490" opacity=".85"/>${label(220, 211, 'informs the centre & reaches on time.', '#fff', 11)}
      ${person(60, 262, 1, '#0E7490')}${label(330, 270, '60 situations · 30 min', '#0E7490', 12)}`, d);
  },
  sd() {
    const [bg, d] = sky('#FFF7ED', '#FED7AA');
    const heads = ['Parents think…', 'Teachers think…', 'Friends think…', 'I think…', 'I want to improve…'];
    return svg(`${bg}<rect x="90" y="24" width="220" height="250" rx="12" fill="#fff"/><rect x="90" y="24" width="18" height="250" rx="6" fill="#FB923C"/>
      ${heads.map((h, i) => `<text x="124" y="${62 + i * 46}" font-family="Plus Jakarta Sans,sans-serif" font-weight="800" font-size="12" fill="#9A3412">${h}</text><rect x="124" y="${70 + i * 46}" width="160" height="6" rx="3" fill="#FED7AA"/><rect x="124" y="${82 + i * 46}" width="120" height="6" rx="3" fill="#FED7AA"/>`).join('')}
      ${label(345, 280, '15 min', '#9A3412', 13)}`, d);
  },
  gd() {
    const [bg, d] = sky('#F0FDF4', '#BBF7D0');
    return svg(`${bg}<ellipse cx="200" cy="200" rx="150" ry="40" fill="#166534"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = Math.PI * (0.05 + i * 0.13); return person(200 - Math.cos(a) * 170, 205 - Math.sin(a) * 50, .75, ['#DC2626', '#2563EB', '#16A34A', '#F59E0B', '#7C3AED', '#0EA5E9', '#BE123C', '#0F172A'][i]); }).join('')}
      ${bubble(40, 40, 120, 'In my opinion…')}${bubble(230, 30, 130, 'Let\'s also add…')}${bubble(150, 85, 110, 'I agree, but…')}
      ${label(200, 285, '2 topics · leaderless discussion', '#14532D', 12)}`, d);
  },
  gpe() {
    const g = uid('m');
    return svg(`<rect width="400" height="300" fill="#ECFCCB"/>
      <path d="M0 120 C80 90 140 160 220 130 S340 90 400 120" stroke="#38BDF8" stroke-width="22" fill="none"/>
      <path d="M40 300 L120 40 M120 40 L360 260" stroke="#A8A29E" stroke-width="10" fill="none"/>
      <rect x="260" y="40" width="70" height="44" rx="6" fill="#FCA5A5"/>${label(295, 66, 'VILLAGE', '#7F1D1D', 10)}
      <rect x="40" y="190" width="70" height="40" rx="6" fill="#FDE68A"/>${label(75, 214, 'CAMP', '#713F12', 10)}
      <g transform="translate(190 210)"><circle r="16" fill="#EF4444"/>${label(0, 5, '🔥', '#fff', 14)}</g>
      <g transform="translate(150 100)"><circle r="16" fill="#F59E0B"/>${label(0, 5, '!', '#fff', 16)}</g>
      <g transform="translate(320 170)"><circle r="16" fill="#7C3AED"/>${label(0, 5, '?', '#fff', 16)}</g>
      <g transform="translate(360 40)"><circle r="20" fill="#fff"/>${label(0, -5, 'N', '#0E0E10', 11)}<path d="M0 -2 l5 14 l-5 -4 l-5 4z" fill="#DC2626"/></g>
      <rect x="10" y="10" width="150" height="26" rx="13" fill="#0E0E10"/>${label(85, 28, 'GPE · map problem', '#fff', 11)}`, lin(g, ['#fff', '#fff']));
  },
  pgt() {
    const [bg, d] = sky('#E0F2FE', '#FEF9C3');
    return svg(`${bg}${sun(350, 50, 20, '#FDE68A')}${ground()}
      ${post(40, 70, '#fff')}${post(130, 90, '#EF4444')}${post(220, 70, '#3B82F6')}${post(330, 80, '#fff')}
      ${plank(47, 162, 137, 142)}${plank(137, 142, 227, 162)}
      <path d="M227 162 Q280 120 337 152" stroke="#FDE68A" stroke-width="3" fill="none"/>
      ${person(80, 155, .7, '#DC2626')}${person(170, 150, .7, '#2563EB')}${person(260, 232, .75, '#16A34A')}${person(300, 232, .75, '#F59E0B')}
      <rect x="270" y="210" width="26" height="22" rx="4" fill="#78350F"/>
      <g transform="translate(10 12)"><rect width="220" height="26" rx="13" fill="#fff"/>
        <rect x="10" y="7" width="12" height="12" fill="#fff" stroke="#111"/>${label(48, 18, 'usable', '#111', 10)}
        <rect x="82" y="7" width="12" height="12" fill="#EF4444"/>${label(124, 18, 'out of bounds', '#111', 10)}
        <rect x="160" y="7" width="12" height="12" fill="#3B82F6"/>${label(196, 18, 'body only', '#111', 10)}</g>`, d);
  },
  hgt() {
    const [bg, d] = sky('#DBEAFE', '#FEF3C7');
    return svg(`${bg}${ground()}${post(90, 80, '#fff')}${post(260, 80, '#fff')}
      <rect x="140" y="226" width="110" height="6" fill="#EF4444"/>${label(195, 220, 'out of bounds', '#B91C1C', 10)}
      ${plank(97, 152, 267, 152)}${person(140, 150, .75, '#DC2626')}${person(180, 150, .75, '#2563EB')}${person(220, 150, .75, '#16A34A')}${person(110, 232, .75, '#F59E0B')}
      <rect x="250" y="130" width="24" height="20" rx="4" fill="#78350F"/>
      ${label(200, 40, 'Half group · one obstacle', '#1E3A8A', 14)}${label(200, 60, 'more chances to stand out', '#1E3A8A', 11)}`, d);
  },
  snake() {
    const [bg, d] = sky('#DCFCE7', '#FEF3C7');
    return svg(`${bg}${ground('#65A30D')}
      <rect x="150" y="200" width="20" height="32" fill="#92400E"/><rect x="270" y="180" width="60" height="52" fill="#A16207"/>
      <path d="M40 200 C90 180 130 190 170 195 S240 175 300 170" stroke="#15803D" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="M40 200 C90 180 130 190 170 195 S240 175 300 170" stroke="#4ADE80" stroke-width="6" fill="none" stroke-dasharray="4 10" stroke-linecap="round"/>
      ${[60, 110, 160, 210, 255].map((x, i) => person(x, 232 - (i > 2 ? 8 : 0), .75, ['#DC2626', '#2563EB', '#F59E0B', '#7C3AED', '#0EA5E9'][i])).join('')}
      ${bubble(40, 40, 170, 'Jai Hind! Group 3!')}${label(300, 130, 'Snake race', '#14532D', 15)}${label(300, 150, '6 obstacles · as a team', '#14532D', 11)}`, d);
  },
  lecturette() {
    const [bg, d] = sky('#FDF2F8', '#FBCFE8');
    return svg(`${bg}<rect x="0" y="240" width="400" height="60" fill="#831843"/>
      ${person(195, 240, 1.3, '#0F172A')}<path d="M150 175 h90 l-8 65 h-74z" fill="#9D174D"/><rect x="146" y="168" width="98" height="12" rx="4" fill="#BE185D"/>
      ${['Startups', 'Space', 'Women in Army', 'Climate'].map((t, i) => `<g transform="translate(${20 + (i % 2) * 290} ${40 + Math.floor(i / 2) * 80}) rotate(${i % 2 ? 4 : -4})"><rect width="90" height="56" rx="8" fill="#fff"/>${label(45, 32, t, '#831843', 10)}</g>`).join('')}
      ${label(195, 280, 'Pick 1 of 4 · 3 min prep · 3 min talk', '#fff', 12)}`, d);
  },
  io() {
    const [bg, d] = sky('#FEF9C3', '#D9F99D');
    const names = ['Single ramp', 'Double barrel', 'Balancing beam', 'Screen jump', 'Burma bridge', 'Tiger leap', 'Rope climb', 'Double ditch', 'Commando walk', 'Tarzan swing'];
    return svg(`${bg}<path d="M30 60 H370 V130 H30 V200 H370" stroke="#A3A3A3" stroke-width="3" stroke-dasharray="6 6" fill="none"/>
      ${names.map((n, i) => { const row = Math.floor(i / 5), col = row === 1 ? 4 - (i % 5) : i % 5; const x = 50 + col * 75, y = 60 + row * 70 + (i >= 10 ? 0 : 0); return `<g transform="translate(${x} ${y})"><circle r="20" fill="${i < 5 ? '#16A34A' : '#F59E0B'}"/>${label(0, 5, i + 1, '#fff', 14)}${label(0, 36, n, '#3F3F46', 8.5)}</g>`; }).join('')}
      <rect x="20" y="236" width="360" height="50" rx="14" fill="#fff"/>${label(200, 258, '10 obstacles · 3 minutes · points = obstacle number', '#0E0E10', 11)}${label(200, 276, 'repeat what you can, in any order', '#71717A', 10)}`, d);
  },
  command() {
    const [bg, d] = sky('#E0E7FF', '#FEF3C7');
    return svg(`${bg}${ground()}${post(220, 70, '#fff')}${post(330, 70, '#EF4444')}
      ${person(90, 232, 1.05, '#B45309')}<path d="M98 190 l50 -20" stroke="#F2C29B" stroke-width="6" stroke-linecap="round"/>
      ${bubble(30, 120, 150, 'Plank to the white!')}
      ${person(180, 232, .85, '#1E3A8A')}${person(250, 162, .85, '#1E3A8A')}${plank(170, 196, 250, 166)}
      ${label(300, 40, 'You are the commander', '#1E3A8A', 13)}${label(300, 58, 'pick 1–2 subordinates', '#1E3A8A', 11)}`, d);
  },
  fgt() {
    const [bg, d] = sky('#CFFAFE', '#FEF3C7');
    return svg(`${bg}${ground()}${post(60, 60, '#fff')}${post(190, 90, '#fff')}${post(320, 60, '#3B82F6')}
      ${plank(67, 172, 197, 142)}${plank(197, 142, 327, 172)}
      ${person(110, 158, .7, '#DC2626')}${person(150, 150, .7, '#2563EB')}${person(240, 150, .7, '#16A34A')}${person(280, 158, .7, '#F59E0B')}
      <rect x="182" y="118" width="30" height="24" rx="4" fill="#78350F"/>${label(200, 40, 'Final Group Task', '#0E7490', 15)}${label(200, 58, 'last chance to show teamwork', '#0E7490', 11)}`, d);
  },
  interview: () => art.interview(),
  conference: () => art.conference(),
  cpss() {
    const g = uid('cp');
    return svg(`<rect width="400" height="300" fill="#0B1220"/><rect x="40" y="30" width="320" height="170" rx="16" fill="#111827" stroke="#334155" stroke-width="3"/>
      <defs>${lin(g, ['#38BDF8', '#0369A1'])}</defs>
      <g transform="translate(200 115)"><circle r="62" fill="#78350F"/><path d="M-62 0 A62 62 0 0 1 62 0Z" fill="url(#${g})" transform="rotate(-10)"/><path d="M-30 0 h20 l10 10 l10 -10 h20" stroke="#FDE047" stroke-width="5" fill="none"/></g>
      <g transform="translate(90 115)"><circle r="30" fill="#1F2937"/><path d="M0 0 L18 -14" stroke="#4ADE80" stroke-width="4"/>${label(0, 22, 'SPD', '#94A3B8', 9)}</g>
      <g transform="translate(310 115)"><circle r="30" fill="#1F2937"/><path d="M0 0 L-12 -18" stroke="#4ADE80" stroke-width="4"/>${label(0, 22, 'ALT', '#94A3B8', 9)}</g>
      <rect x="185" y="215" width="30" height="60" rx="10" fill="#374151"/><circle cx="200" cy="215" r="16" fill="#DC2626"/>
      <rect x="80" y="255" width="60" height="22" rx="6" fill="#374151"/><rect x="260" y="255" width="60" height="22" rx="6" fill="#374151"/>
      ${label(200, 22, 'CPSS · flying branch only', '#E2E8F0', 12)}`);
  },
};

const T = (o) => o;
export const TASK_GROUPS = [
  { title: 'Day 1 · Screening', color: '#5B2BD9', tasks: [
    T({ id: 'oir', name: 'OIR Test', time: '2 papers · ~30 min', what: 'Officer Intelligence Rating — quick verbal and non-verbal reasoning: series, coding, odd-one-out, analogies, figure patterns.', judged: 'Your OIR rating is combined with PPDT performance to decide screening.', tips: ['Practise 20 mixed reasoning questions daily with a timer.', 'Don\'t get stuck — skip and come back.'] }),
    T({ id: 'ppdt', name: 'PPDT', time: '30 s view · 1 + 3 min write · GD', what: 'Picture Perception & Description Test. A hazy picture for 30 s, note the characters in 1 min, write a story in 3 min, narrate it, then discuss as a group.', judged: 'Perception, a positive and practical story, clear narration, and how you behave in the group discussion.', tips: ['Story = what led to it, what\'s happening, how it ends.', 'In the GD, add to others\' points and help the group agree.'], drill: 'ppdt' }),
  ] },
  { title: 'Day 2 · Psychology', color: '#7C3AED', tasks: [
    T({ id: 'tat', name: 'TAT', time: '12 pictures · 4 min each', what: 'Thematic Apperception Test: 11 pictures plus one blank slide where you write any story you like.', judged: 'The psychologist reads your heroes\' thoughts and actions for OLQs.', tips: ['Different hero, different setting each time — but always active and resourceful.', 'For the blank slide, prepare a real story from your life.'] }),
    T({ id: 'wat', name: 'WAT', time: '60 words · 15 s each', what: 'Word Association Test: one sentence per word, as it comes.', judged: 'Your natural, spontaneous thinking.', tips: ['Positive, practical sentences — not proverbs.', 'If you blank, write something simple and move on.'], drill: 'wat' }),
    T({ id: 'srt', name: 'SRT', time: '60 situations · 30 min', what: 'Situation Reaction Test: everyday problems; write your reaction in a few words.', judged: 'Practical, responsible and quick decisions.', tips: ['Write action, not intention: "calls 108, gives first aid".', 'Try to finish all 60.'], drill: 'srt' }),
    T({ id: 'sd', name: 'Self Description', time: '15 min', what: 'Five short paragraphs: what parents, teachers/employers, friends and you think of you, and what you want to improve.', judged: 'Self-awareness and honesty — it must match everything else you wrote.', tips: ['Use real examples, not just adjectives.', 'Name genuine weaknesses you\'re working on.'] }),
  ] },
  { title: 'Day 3–4 · Group testing (GTO)', color: '#16A34A', tasks: [
    T({ id: 'gd', name: 'Group Discussion', time: '2 topics · ~20 min each', what: 'A leaderless discussion on current or social topics.', judged: 'Ideas, how you express them, and how you influence the group.', tips: ['Facts beat volume.', 'Bring quiet members in — it shows leadership.'] }),
    T({ id: 'gpe', name: 'Group Planning Exercise', time: 'model + 10 min write + discussion', what: 'The GTO explains a map/model with several problems happening at once. You write your plan, then the group agrees one plan and someone presents it.', judged: 'Priorities, use of resources and time, and reasoning.', tips: ['Save lives first, then property, then the mission.', 'Check time and distance maths.'] }),
    T({ id: 'pgt', name: 'Progressive Group Task', time: '4 obstacles · ~40 min', what: 'The group crosses 4 obstacles of rising difficulty with planks, ballies, ropes and a load, following colour rules.', judged: 'Ideas, teamwork, effort and following rules.', tips: ['White = usable, red = out of bounds, blue = body only (check the GTO\'s briefing).', 'Help carry the load, not just give orders.'] }),
    T({ id: 'hgt', name: 'Half Group Task', time: '1 obstacle · ~15 min', what: 'Same as PGT but with half the group, so each person is more visible.', judged: 'Your individual contribution.', tips: ['Offer a clear idea early.'] }),
    T({ id: 'snake', name: 'Group Obstacle Race', time: '6 obstacles · race', what: 'The "snake race": your group carries a snake-like rope tube over obstacles, competing with other groups.', judged: 'Group spirit, stamina and cooperation.', tips: ['Shout your group slogan, help the weakest member.'] }),
    T({ id: 'lecturette', name: 'Lecturette', time: '3 min prep · 3 min talk', what: 'Pick one of 4 topics on a card and speak to the group.', judged: 'Power of expression and confidence.', tips: ['Intro – 3 points – conclusion.', 'Read the news so you can talk on anything.'] }),
    T({ id: 'io', name: 'Individual Obstacles', time: '10 obstacles · 3 min', what: 'Single ramp, double barrel, balancing beam, screen jump, Burma bridge, tiger leap, rope climb, double ditch, commando walk, Tarzan swing.', judged: 'Courage, stamina and determination; points equal the obstacle number.', tips: ['Plan a route before the whistle.', 'Attempt every obstacle — never freeze.'] }),
    T({ id: 'command', name: 'Command Task', time: '~15 min', what: 'You are the commander for one obstacle and choose 1–2 candidates to help you.', judged: 'Leadership, clear orders and keeping calm.', tips: ['Give short, clear orders and explain the plan.', 'If something fails, take responsibility.'] }),
    T({ id: 'fgt', name: 'Final Group Task', time: '1 obstacle', what: 'One last group obstacle like the PGT.', judged: 'Whether you still cooperate and contribute at the end of a tiring day.', tips: ['Stay energetic — it\'s the last impression.'] }),
  ] },
  { title: 'Interview & last day', color: '#B45309', tasks: [
    T({ id: 'interview', name: 'Personal Interview', time: '30–60 min · one evening', what: 'A long conversation with the President or Deputy President, mostly built on your PIQ form.', judged: 'All OLQs — how honest, consistent and mature you are.', tips: ['Know every line of your PIQ.', 'Expect rapid-fire questions; answer in the order asked.'] }),
    T({ id: 'conference', name: 'Conference', time: 'Day 5 · a few minutes', what: 'All assessors meet; you walk in for a short chat; results are announced the same day.', judged: 'A final look before the board decides.', tips: ['Formal dress, calm and honest.'] }),
    T({ id: 'cpss', name: 'CPSS (Air Force)', time: 'flying branch only', what: 'Computerised Pilot Selection System at the Air Force Selection Board — hand-eye coordination and instrument tasks on a cockpit-like setup.', judged: 'Aptitude for flying. Candidates who have failed CPSS/PABT before cannot be considered for flying.', tips: ['Sleep well; it\'s a one-time test.', 'Follow the instructions slowly and exactly.'] }),
  ] },
];
export const taskArt = id => (ART[id] || art.ssb)();
