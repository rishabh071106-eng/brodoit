// The SSB journey: stages from the written exam to the academy, plus drill material.
// Timings follow the standard 5-day SSB procedure; boards vary slightly, so the copy says "usually".
const L = (s, c) => `lecture.html?exam=ssb&s=${s}&c=${c}&from=ssb`;

export const STAGES = [
  {
    id: 'written', art: 'written', step: 'Before SSB', title: 'Clear the written exam', when: 'Months before',
    color: '#2B4C8C',
    what: [
      'NDA and CDS are conducted by UPSC; AFCAT by the Indian Air Force. Each is held twice a year.',
      'Some entries skip the written test and are shortlisted on marks — TES (10+2 PCM), NCC Special Entry, TGC and SSC Tech.',
      'Your written score is not enough on its own: final merit = written marks + SSB marks.',
    ],
    tips: ['Start SSB prep before the result — screening is where most people get out.', 'Read a newspaper daily from now; it pays off in GD, lecturette and interview.'],
    avoid: ['Waiting for the result to start preparing.', 'Ignoring fitness — GTO and medicals are physical.'],
    lesson: L('basics', 'ssb-overview'),
  },
  {
    id: 'callup', art: 'callup', step: 'Before SSB', title: 'Result & call-up letter', when: '2–8 weeks after result',
    color: '#F2A541',
    what: [
      'After the written result, follow the result notice: register on the service portal (Army: joinindianarmy.nic.in) or wait for the Navy / Air Force call-up email.',
      'You get a board (selection centre) and a reporting date. Boards are spread across India — Prayagraj, Bhopal, Bengaluru, Kapurthala, Dehradun, Mysuru, Varanasi, Gandhinagar, Coimbatore, Visakhapatnam, Kolkata and more.',
      'The call-up letter lists the documents to carry. Read it twice.',
    ],
    tips: ['Book train tickets early — first-time candidates usually get travel fare reimbursed, so keep tickets.', 'Fill a practice PIQ form now; your interview is built on it.'],
    avoid: ['Missing the date-selection window on the portal.', 'Carrying only originals — take photocopies too.'],
    lesson: L('basics', 'ssb-piq'),
  },
  {
    id: 'day0', art: 'arrival', step: 'Day 0', title: 'Reporting at the board', when: 'Arrival day',
    color: '#F59E0B',
    what: [
      'Board vehicles pick candidates up from a reception point at the railway station, usually in the morning.',
      'Document check, a chest number for the week, room allotment and an opening address that explains the 5 days.',
      'You meet 20–100+ candidates from every background. This is where it starts feeling real.',
    ],
    tips: ['Wear neat formals. First impressions with the staff matter.', 'Talk to other candidates — social adaptability is an OLQ and it starts here.'],
    avoid: ['Showing up late or without documents — you can be sent back.', 'Comparing coaching notes all night instead of sleeping.'],
    lesson: L('basics', 'ssb-overview'),
  },
  {
    id: 'day1', art: 'screening', step: 'Day 1', title: 'Screening: OIR + PPDT', when: 'Full day · results same evening',
    color: '#5B2BD9',
    what: [
      '**OIR test** — two quick verbal and non-verbal reasoning papers.',
      '**PPDT** — a hazy picture is shown for 30 seconds. You get 1 minute to note the characters (number, age, sex, mood) and 3 minutes to write a story.',
      'Then each candidate narrates their story (about 1 minute) and the group discusses to reach a common story.',
      'Results come the same evening. Screened-out candidates leave that day; the rest stay for 4 more days. Air Force flying candidates also take the CPSS.',
    ],
    tips: ['Your PPDT story needs a hero, a clear problem, positive action and a realistic ending.', 'In the GD, speak early, stay calm and bring the group together — don\'t shout over people.'],
    avoid: ['Writing tragic or unrealistic stories.', 'Staying silent in the group discussion.'],
    lesson: L('screening', 'ssb-ppdt'), drill: 'ppdt',
  },
  {
    id: 'day2', art: 'psych', step: 'Day 2', title: 'Psychology tests', when: 'Morning · interviews may start in the evening',
    color: '#7C3AED',
    what: [
      '**TAT** — 11 pictures plus 1 blank slide; 30 seconds to view each, 4 minutes to write a story.',
      '**WAT** — 60 words, 15 seconds each. Write the first useful sentence that comes to mind.',
      '**SRT** — 60 everyday situations in 30 minutes. Write what you would actually do.',
      '**SD** — 15 minutes to write what your parents, teachers, friends and you think of you, and what you want to improve.',
    ],
    tips: ['Speed matters — practise until 15 seconds feels long.', 'Be consistent: the psychologist compares your TAT, WAT, SRT, SD and PIQ.'],
    avoid: ['Writing "ideal" answers you don\'t believe — they contradict each other.', 'Leaving many items blank.'],
    lesson: L('psychology', 'ssb-wat-srt'), drill: 'wat',
  },
  {
    id: 'day3', art: 'gto', step: 'Day 3', title: 'GTO — group tasks', when: 'Outdoors · full day',
    color: '#16A34A',
    what: [
      '**Group Discussion** — usually two topics.',
      '**Group Planning Exercise (GPE)** — solve a map-based problem on your own, then agree a plan as a group.',
      '**Progressive Group Task (PGT)** — cross obstacles as a team with planks, ropes and a load.',
      '**Half Group Task** and the **Group Obstacle Race** (snake race) — teamwork under time pressure.',
    ],
    tips: ['Give ideas, but help put other people\'s good ideas into action.', 'Learn the colour rules (out-of-bounds, usable parts) before you start.'],
    avoid: ['Grabbing the rope and doing everything yourself.', 'Breaking a rule and hiding it.'],
    lesson: L('gto', 'ssb-gto-indoor'),
  },
  {
    id: 'day4', art: 'interview', step: 'Day 4', title: 'GTO individual + interview', when: 'Outdoors + one-on-one',
    color: '#B45309',
    what: [
      '**Lecturette** — pick one of 4 topics, prepare for 3 minutes, speak for 3.',
      '**Individual obstacles** — 10 obstacles in about 3 minutes, scored by difficulty.',
      '**Command Task** — you lead two or three candidates through an obstacle. Then the **Final Group Task**.',
      '**Personal interview** (held on one evening between Day 2 and Day 4) — a long talk with the President or Deputy President, based on your PIQ.',
    ],
    tips: ['Know every word you wrote in your PIQ — family, school, hobbies, achievements.', 'In the command task, give clear orders and own the result.'],
    avoid: ['Bluffing in the interview — they will cross-question.', 'Skipping obstacles out of fear; attempt and keep moving.'],
    lesson: L('interview-conference', 'ssb-interview'),
  },
  {
    id: 'day5', art: 'conference', step: 'Day 5', title: 'Conference & results', when: 'Last day · formal dress',
    color: '#15803D',
    what: [
      'All assessors meet as a board. Each candidate walks in for a short conversation (a few minutes).',
      'Typical questions: how was your stay, what did you learn, would you try again?',
      'Results are announced the same day. Recommended candidates stay back for medicals.',
    ],
    tips: ['Be honest and relaxed — the decision is mostly made already.', 'If you\'re not recommended, ask for nothing but leave with a plan; many officers cleared on a later attempt.'],
    avoid: ['Arguing with the board.', 'Changing your story from the interview.'],
    lesson: L('interview-conference', 'ssb-conference'),
  },
  {
    id: 'medical', art: 'medical', step: 'After SSB', title: 'Medical examination', when: '3–5 days at a military hospital',
    color: '#E5484D',
    what: [
      'A detailed check: eyes, ears, teeth, height-weight, X-ray, blood and urine tests, and more.',
      'If declared unfit, you can request an Appeal Medical Board, and after that a Review Medical Board.',
    ],
    tips: ['Get ear wax cleaned and teeth checked before SSB.', 'Fix minor issues (overweight, wax, tonsils) early — they cause many temporary rejections.'],
    avoid: ['Hiding a medical history — it comes out later and costs more.'],
  },
  {
    id: 'merit', art: 'merit', step: 'After SSB', title: 'Merit list & joining letter', when: 'Weeks to months later',
    color: '#16A34A',
    what: [
      'Final merit adds written + SSB marks (for example NDA: 900 + 900).',
      'Seats depend on vacancies, your service/branch preferences and medical fitness.',
      'Joining instructions arrive by post/email with the date and kit list.',
    ],
    tips: ['Keep checking UPSC / service portals and your email.', 'Start running daily — academy training starts at full speed.'],
    avoid: ['Assuming recommended = selected. Merit decides.'],
  },
  {
    id: 'academy', art: 'academy', step: 'The goal', title: 'Walk through the academy gate', when: 'You made it',
    color: '#7C3AED',
    what: [
      'NDA, Khadakwasla (Pune) · IMA, Dehradun · Indian Naval Academy, Ezhimala · Air Force Academy, Dundigal · OTA, Chennai.',
      'Training builds on exactly the qualities the SSB looked for.',
    ],
    tips: ['Your SSB prep habits — fitness, reading, discipline — become your daily routine here.'],
    avoid: [],
  },
];

export const OLQS = [
  { f: 'Planning & organising', c: '#2B4C8C', q: [
    ['Effective intelligence', 'Solving practical problems with what you have.'],
    ['Reasoning ability', 'Thinking logically and grasping things quickly.'],
    ['Organising ability', 'Using people, time and resources well.'],
    ['Power of expression', 'Putting ideas across clearly and confidently.'],
  ] },
  { f: 'Social adjustment', c: '#16A34A', q: [
    ['Social adaptability', 'Fitting in with people and new places.'],
    ['Cooperation', 'Working with others towards a shared goal.'],
    ['Sense of responsibility', 'Doing your duty without being watched.'],
  ] },
  { f: 'Social effectiveness', c: '#F59E0B', q: [
    ['Initiative', 'Taking the first step without being told.'],
    ['Self-confidence', 'Believing you can handle what comes.'],
    ['Speed of decision', 'Deciding well, and quickly.'],
    ['Ability to influence the group', 'Getting others to follow your lead willingly.'],
    ['Liveliness', 'Staying cheerful and energetic under pressure.'],
  ] },
  { f: 'Dynamic', c: '#E5484D', q: [
    ['Determination', 'Sticking with a goal despite setbacks.'],
    ['Courage', 'Taking calculated risks, physically and morally.'],
    ['Stamina', 'Physical and mental endurance.'],
  ] },
];

export const PACK = [
  ['Documents', ['Call-up letter (print + soft copy)', 'Photo ID — Aadhaar / PAN / passport', '10th & 12th mark sheets and certificates (originals + 2 photocopies)', 'Graduation mark sheets / degree or bonafide letter (CDS, AFCAT)', 'Passport-size photos (as many as the call-up asks, plus extra)', 'NCC / sports certificates if you have any', 'Train ticket copies for fare reimbursement']],
  ['Clothes', ['2–3 formal shirts and trousers', 'Tie, belt and polished formal shoes', 'Tracksuit, shorts, white T-shirts', 'Sports shoes with good grip', 'Sleepwear and a light jacket']],
  ['Daily kit', ['Toiletries and a small towel', 'Blue/black pens, pencil, eraser, clipboard', 'Water bottle and a small lock', 'Any medicines you take', 'A newspaper or magazine for downtime', 'Some cash and an ATM card']],
];

export const WAT_WORDS = ['Courage', 'Fear', 'Team', 'Failure', 'Leader', 'Mother', 'Defeat', 'Help', 'Risk', 'Discipline', 'Friend', 'Duty', 'Nation', 'Win', 'Death', 'Rain', 'Dark', 'Challenge', 'Trust', 'Enemy', 'Struggle', 'Weak', 'Success', 'Problem', 'Village', 'Exam', 'Honest', 'Night', 'River', 'Money', 'Teacher', 'Sports', 'Army', 'Alone', 'Accident', 'Fire', 'Mountain', 'Decision', 'Hope', 'Crowd', 'Book', 'Doctor', 'Punish', 'Lazy', 'Brave', 'Peace', 'Flag', 'Plan', 'Smile', 'Wound'];

export const SRT_ITEMS = [
  'On the way to his exam he saw an accident on the road. He…',
  'His team was losing badly at half-time and the captain was injured. He…',
  'He reached the station and found his wallet had been stolen. He…',
  'While trekking, his friend slipped and twisted an ankle far from the road. He…',
  'His neighbour\'s house caught fire at night. He…',
  'He was made class monitor but the class kept ignoring him. He…',
  'His father lost his job a month before his college fees were due. He…',
  'During a group project, one member refused to do any work. He…',
  'He noticed a classmate copying in the exam hall. He…',
  'The village he was visiting had no doctor and a child fell seriously ill. He…',
  'He was lost in an unknown city at night with a dead phone. He…',
  'His senior asked him to sign a register for a friend who was absent. He…',
  'Floods cut off his area and the elders were panicking. He…',
  'He failed the SSB at screening for the second time. He…',
  'A stranger on the train offered him food and insisted he eat. He…',
];

export const PPDT_PICS = ['ppdt1', 'ppdt2', 'ppdt3'];
