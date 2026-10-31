// v28: Thought of the day, in the News tab. One short original thought and the story behind it (a scene from everyday
// Indian life or a simple parable, about 120–180 words), in English and Hindi, with a free photo (the News Desk's photo
// finder: Wikimedia Commons, then Openverse, then the "life" pool; always credited). Written once a day (India time) by
// the background writer: Gemini Flash when its key is set, else Bro Core's background lane, else the ElevenLabs brain
// when Bro Core's emergency switch is on. Never a famous quote or a saying passed off as ours: the brief asks for a new
// line, and a check refuses a reply that names a speaker. With no writer, one of the seven thoughts below (written for
// Brodoit, 31 Oct 2026) stands in, so the section is never empty.
//   GET /api/news/thought → { items: [today, …the 6 days before] }
'use strict';
const GEM = require('./gemini.js');

const IST_MIN = 330;
const dayOf = t => new Date((t || Date.now()) + IST_MIN * 60e3).toISOString().slice(0, 10);
const deva = t => (String(t || '').match(/[ऀ-ॿ]/g) || []).length;
const letters = t => (String(t || '').match(/[A-Za-zऀ-ॿ]/g) || []).length;
const isHindi = t => { const n = letters(t); return n > 0 && deva(t) / n >= 0.6; };
const wc = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const clean = t => String(t || '').replace(/\s+/g, ' ').replace(/[*#_[\]]/g, '').trim();

const SEEDS = [
  { thought: 'Big shade starts as a small seed that someone was patient enough to water.', image_query: 'neem tree',
    story: 'When Ramesh moved into his building in Pune, the courtyard was bare concrete. He planted a neem sapling by the gate and watered it every morning before work. The neighbours smiled at him; the sapling was thinner than a broom handle. For two summers it hardly grew. Some days he forgot, and some days it rained so hard he wondered why he bothered. In the third year it shot past the first-floor balconies. Now the watchman eats his lunch under it, children tie a swing to its lowest branch, and the scooters parked below stay cool in May. Ramesh still waters it, though it no longer needs him. Most good things grow like that: slowly, quietly, and then all at once.',
    thought_hi: 'बड़ी छाँव एक छोटे बीज से शुरू होती है, जिसे किसी ने धीरज से सींचा हो।',
    story_hi: 'रमेश जब पुणे की अपनी नई बिल्डिंग में आया, तो आँगन में सिर्फ़ सीमेंट था। उसने गेट के पास नीम का एक पौधा लगाया और रोज़ सुबह काम पर जाने से पहले उसे पानी देने लगा। पड़ोसी मुस्कुराते थे, पौधा झाड़ू की डंडी से भी पतला था। दो गर्मियों तक वह मुश्किल से बढ़ा। कभी रमेश भूल जाता, कभी इतनी बारिश होती कि वह सोचता, मेहनत किसलिए। तीसरे साल पेड़ पहली मंज़िल की बालकनी से ऊपर निकल गया। अब चौकीदार उसकी छाँव में खाना खाता है, बच्चे उसकी सबसे नीची डाल पर झूला बाँधते हैं और मई में नीचे खड़े स्कूटर ठंडे रहते हैं। रमेश अब भी उसे पानी देता है, भले ही उसे अब उसकी ज़रूरत नहीं। ज़्यादातर अच्छी चीज़ें ऐसे ही बढ़ती हैं: धीरे, चुपचाप, और फिर अचानक।' },
  { thought: 'A long road gets shorter the day you stop measuring it and start walking it.', image_query: 'Marina Beach Chennai',
    story: 'Anjali signed up for a 10 km run in Chennai and then panicked. She had never run more than the distance to the bus stop. Every evening she opened a map, looked at the route along Marina Beach and felt tired just reading it. Her neighbour, a retired PT teacher, told her to close the map. "Tomorrow, walk for twenty minutes. That is all." She walked. The next week she jogged one lamp post and walked the next. Some evenings were slow and some were sweaty and wonderful. She stopped counting kilometres and started counting evenings. On race morning the sea breeze was cool and the finish line came sooner than she expected. The road had not changed. She had.',
    thought_hi: 'लंबा रास्ता उस दिन छोटा होने लगता है, जिस दिन हम उसे नापना छोड़कर चलना शुरू करते हैं।',
    story_hi: 'अंजलि ने चेन्नई की 10 किलोमीटर दौड़ में नाम लिखवा दिया और फिर घबरा गई। वह कभी बस स्टॉप से ज़्यादा दूर नहीं दौड़ी थी। हर शाम वह नक़्शा खोलती, मरीना बीच के किनारे का रास्ता देखती और पढ़ते-पढ़ते ही थक जाती। उसके पड़ोसी, एक रिटायर्ड पीटी टीचर, ने कहा कि नक़्शा बंद कर दो। कल बस बीस मिनट चलना, इतना ही। वह चली। अगले हफ़्ते वह एक खंभे तक दौड़ती और अगले तक चलती। कुछ शामें धीमी रहीं, कुछ पसीने से भरी और शानदार। उसने किलोमीटर गिनना छोड़कर शामें गिनना शुरू किया। दौड़ की सुबह समुद्र की हवा ठंडी थी और फ़िनिश लाइन उम्मीद से पहले आ गई। रास्ता नहीं बदला था, अंजलि बदल गई थी।' },
  { thought: 'Kindness costs a minute and is remembered for years.', image_query: 'auto rickshaw',
    story: 'It was raining hard in Kolkata when an old man with a cloth bag waved at autos that would not stop. Bablu, driving home after a twelve-hour day, pulled over. The man needed to reach a hospital across the city and had only forty rupees. Bablu said forty was fine. On the way the man talked about his daughter, a nurse in that hospital, whom he was surprising with homemade sweets. At the gate he pressed a sweet into Bablu\'s hand. Two years later Bablu\'s own son had a high fever at midnight, and the nurse who stayed with them through the night recognised the auto. She did not let him pay for the medicines. Neither of them had planned any of it. Small kindness has a way of travelling.',
    thought_hi: 'दया में बस एक मिनट लगता है, और वह सालों याद रहती है।',
    story_hi: 'कोलकाता में तेज़ बारिश हो रही थी और कपड़े का थैला लिए एक बुज़ुर्ग ऑटो वालों को हाथ दे रहे थे, पर कोई रुक नहीं रहा था। बारह घंटे की ड्यूटी के बाद घर लौट रहे बबलू ने ऑटो रोक दिया। बुज़ुर्ग को शहर के दूसरे छोर के एक अस्पताल जाना था और उनके पास सिर्फ़ चालीस रुपये थे। बबलू ने कहा, चालीस ठीक है। रास्ते में उन्होंने अपनी बेटी के बारे में बताया, जो उसी अस्पताल में नर्स थी और जिसके लिए वे घर की बनी मिठाई ले जा रहे थे। गेट पर उन्होंने एक मिठाई बबलू के हाथ में रख दी। दो साल बाद आधी रात को बबलू के बेटे को तेज़ बुखार हुआ। रात भर साथ रहने वाली नर्स ने ऑटो पहचान लिया और दवाइयों के पैसे नहीं लेने दिए। किसी ने कुछ सोचा नहीं था। छोटी-सी दया अपना रास्ता ख़ुद ढूँढ लेती है।' },
  { thought: 'A mistake only costs you twice when you pay for it and learn nothing.', image_query: 'tea stall India',
    story: 'Farhan opened a tea stall near a college in Hyderabad and lost money in his first month. Every evening he poured away milk that had gone sour, because he had guessed how much to buy. His uncle did not lecture him. He handed him a thin notebook and said, "Write down how many cups you sell, every hour." Farhan felt silly doing it. By the second week the notebook showed a pattern: a rush at eight, another at four, almost nothing at noon on Fridays. He started buying milk for the pattern instead of his hopes. The waste stopped, and the money he saved bought a second kettle. He still keeps a notebook. He says the sour milk was the most expensive teacher he ever had, and worth it only because he listened.',
    thought_hi: 'ग़लती दो बार तभी महँगी पड़ती है, जब उसकी क़ीमत चुकाकर भी हम कुछ न सीखें।',
    story_hi: 'फ़रहान ने हैदराबाद में एक कॉलेज के पास चाय की दुकान खोली और पहले ही महीने घाटा हुआ। हर शाम वह खट्टा हो चुका दूध फेंकता, क्योंकि वह अंदाज़े से दूध ख़रीदता था। उसके चाचा ने उसे भाषण नहीं दिया। उन्होंने एक पतली कॉपी दी और कहा, हर घंटे कितने कप बिके, लिखते जाओ। फ़रहान को यह अजीब लगा। दूसरे हफ़्ते तक कॉपी में एक पैटर्न दिखने लगा: सुबह आठ बजे भीड़, फिर चार बजे, और शुक्रवार दोपहर लगभग कुछ नहीं। अब वह उम्मीद के हिसाब से नहीं, पैटर्न के हिसाब से दूध ख़रीदने लगा। बर्बादी रुक गई और बचे पैसों से दूसरी केतली आ गई। वह आज भी कॉपी रखता है। कहता है, खट्टा दूध उसका सबसे महँगा टीचर था, और वह भी सिर्फ़ इसलिए काम का निकला क्योंकि उसने सुना।' },
  { thought: 'Most arguments end sooner when one person starts listening instead of waiting to speak.', image_query: 'Lucknow',
    story: 'Two brothers in Lucknow had run their father\'s cloth shop together for ten years, and for the last two they had argued about the same thing: whether to sell online. Every discussion was louder than the last. One evening the elder brother, tired, decided to try something new. He asked his younger brother to explain the whole plan, and promised not to interrupt even once. It took twenty minutes. Halfway through he realised his brother was not trying to replace the shop at all; he wanted the old customers who had moved to Bengaluru and Dubai to keep buying from them. When he finished, the elder brother asked only one question: "Where do we start?" The argument had never been about the internet. It had been about not feeling heard.',
    thought_hi: 'ज़्यादातर बहसें जल्दी ख़त्म हो जाती हैं, जब कोई एक बोलने का इंतज़ार छोड़कर सुनने लगता है।',
    story_hi: 'लखनऊ में दो भाई दस साल से पिता की कपड़े की दुकान साथ चला रहे थे, और पिछले दो साल से एक ही बात पर बहस कर रहे थे: ऑनलाइन बेचें या नहीं। हर बार आवाज़ पहले से ऊँची हो जाती। एक शाम थके हुए बड़े भाई ने कुछ नया करने की सोची। उसने छोटे भाई से कहा कि पूरा प्लान समझाओ, मैं एक बार भी नहीं टोकूँगा। इसमें बीस मिनट लगे। आधे रास्ते में उसे समझ आया कि छोटा भाई दुकान की जगह कुछ नहीं लाना चाहता, वह बस चाहता था कि बेंगलुरु और दुबई चले गए पुराने ग्राहक भी उनसे ख़रीदते रहें। जब बात पूरी हुई, बड़े भाई ने बस एक सवाल पूछा: शुरुआत कहाँ से करें? बहस कभी इंटरनेट की थी ही नहीं। वह इस बात की थी कि किसी को सुना नहीं जा रहा था।' },
  { thought: 'Start the day by noticing one thing that is already going right.', image_query: 'sunrise Brahmaputra',
    story: 'Kavita works night shifts as a nurse in Guwahati. For months she came home at dawn feeling that the whole night had been one long list of problems. A senior colleague suggested a small habit: before sleeping, write one thing that went right on a sticky note and put it on the fridge. The first note said only, "Bed 12 smiled today." The next said, "The new intern remembered the dosage chart." Within a month the fridge door was covered in yellow squares. Her nights were not easier. The wards were as busy as ever. But on the bad mornings she would stand in front of the fridge for a minute, read a few notes, and remember that the work was doing some good. The problems were real. So were the notes.',
    thought_hi: 'दिन की शुरुआत उस एक चीज़ को देखकर करें, जो पहले से ठीक चल रही है।',
    story_hi: 'कविता गुवाहाटी में नर्स है और रात की शिफ़्ट करती है। महीनों तक वह सुबह घर लौटती तो लगता कि पूरी रात बस परेशानियों की एक लंबी सूची थी। एक सीनियर साथी ने एक छोटी आदत सुझाई: सोने से पहले एक स्टिकी नोट पर लिखो कि आज क्या अच्छा हुआ, और उसे फ़्रिज पर चिपका दो। पहले नोट पर बस लिखा था, बेड 12 वाले मरीज़ आज मुस्कुराए। अगले पर, नए इंटर्न को दवा का चार्ट याद रहा। एक महीने में फ़्रिज का दरवाज़ा पीले चौकोर कागज़ों से भर गया। रातें आसान नहीं हुईं, वार्ड पहले जितने ही व्यस्त थे। पर बुरी सुबहों में वह एक मिनट फ़्रिज के सामने खड़ी होकर कुछ नोट पढ़ती और याद करती कि उसका काम किसी का भला कर रहा है। परेशानियाँ सच थीं, और नोट भी।' },
  { thought: 'Courage is often just saying the first sentence out loud.', image_query: 'classroom India',
    story: 'Rohit sat in the last row of his engineering class in Patna and had not asked a single question all semester. He understood less than he pretended to, and he was sure everyone else understood everything. One afternoon the professor drew a circuit he could not follow at all. His heart was pounding. He raised his hand halfway, lowered it, then raised it fully and said, "Sir, I did not understand the second step." The room went quiet. Then a girl in the front row turned around and said, "Neither did I." The professor smiled and explained it again, slowly, with a new drawing. After class three people thanked Rohit. The hardest part had taken five seconds: the first sentence. Everything after it was easier.',
    thought_hi: 'हिम्मत अक्सर बस पहला वाक्य ज़ोर से बोल देने का नाम है।',
    story_hi: 'पटना के इंजीनियरिंग कॉलेज में रोहित आख़िरी बेंच पर बैठता था और पूरे सेमेस्टर में उसने एक भी सवाल नहीं पूछा था। वह जितना दिखाता था, उससे कम समझता था, और उसे यक़ीन था कि बाक़ी सब सब कुछ समझते हैं। एक दोपहर प्रोफ़ेसर ने बोर्ड पर एक सर्किट बनाया, जो उसे बिल्कुल समझ नहीं आया। दिल ज़ोर से धड़क रहा था। उसने आधा हाथ उठाया, नीचे किया, फिर पूरा उठाकर कहा, सर, मुझे दूसरा स्टेप समझ नहीं आया। कमरे में चुप्पी छा गई। फिर आगे बैठी एक लड़की ने मुड़कर कहा, मुझे भी नहीं। प्रोफ़ेसर मुस्कुराए और नई ड्रॉइंग के साथ धीरे-धीरे फिर से समझाया। क्लास के बाद तीन लोगों ने रोहित को शुक्रिया कहा। सबसे मुश्किल हिस्सा पाँच सेकंड का था: पहला वाक्य। उसके बाद सब आसान था।' },
];

const SYS = 'You write the Thought of the day for Brodoit, an Indian app people read on their phones in the morning. ' +
  'Write ONE new, original thought and the short story behind it. The thought: a single plain sentence of 8-20 words, in your own words, warm and practical, never preachy. ' +
  'It must NOT be a famous quote, a proverb, a line from a book, film or song, or attributed to anyone. ' +
  'The story: 120-180 words, an invented, believable scene from everyday Indian life (or a simple parable) with one or two invented characters, a small turn, and a last line that ties back to the thought. ' +
  'No real people, no brands, no religion or politics, nothing sad without hope. Simple English a 14-year-old enjoys. ' +
  'Then the same thought and story in natural, warm Hindi (Devanagari), written the way a good Hindi magazine would, not word for word. ' +
  'Return strict JSON with keys: thought, story, thought_hi, story_hi, image_query (2-4 English words naming a calm scene or object a free photo could show, e.g. "banyan tree", "Mumbai local train", "tea garden").';

function check(o, recent) {
  const bad = [];
  if (!o || typeof o !== 'object') return ['not a JSON object'];
  const t = clean(o.thought), s = clean(o.story);
  if (wc(t) < 6 || wc(t) > 26) bad.push('the thought must be one sentence of 8-20 words');
  if (wc(s) < 100 || wc(s) > 230) bad.push('the story must be 120-180 words');
  if (/[ऀ-ॿ]/.test(t + s)) bad.push('the English must contain no Devanagari');
  if (!isHindi(o.thought_hi) || !isHindi(o.story_hi) || wc(o.story_hi) < 80) bad.push('thought_hi and story_hi must be full Hindi in Devanagari');
  // a quote passed off as ours: "… — Gandhi", "as Einstein said", a line in quotation marks with a speaker
  if (/(\s[-–—]\s?[A-Z][a-z]+|\b(once said|famously said|as [A-Z][a-z]+ (said|wrote|put it))\b)/.test(t)) bad.push('the thought must be your own line, not a quote');
  const low = t.toLowerCase();
  if ((recent || []).some(r => r && r.toLowerCase() === low)) bad.push('the thought repeats a recent one');
  return bad;
}

function create(o) {
  const { db, app } = o;
  const getSetting = o.getSetting || (k => process.env[k] || '');
  const log = (...a) => console.log('[thought]', ...a);
  const nowOf = () => (o.now ? o.now() : Date.now());
  try { db.exec("CREATE TABLE IF NOT EXISTS news_thoughts(day TEXT PRIMARY KEY, thought TEXT, story TEXT, thought_hi TEXT, story_hi TEXT, image_query TEXT, image_credit TEXT, writer TEXT, created_at TEXT DEFAULT (datetime('now')))"); } catch (e) { log('schema', e.message); }
  const q = s => db.prepare(s);

  async function write(text) {
    const g = getSetting('GEMINI_API_KEY');
    if (g && !((global._geminiDownUntil || 0) > Date.now())) {
      try {
        const { json: j } = await GEM.generate(g, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }, { tier: 'flash', getSetting, timeout: 40000 });
        return [JSON.parse(GEM.textOf(j)), 'gemini'];
      } catch (e) { log('gemini:', String(e.message || e).slice(0, 100)); }
    }
    const BC = global._broCore;
    if (BC && BC.brainReady && BC.brainReady()) {
      try {
        const r = await BC.chat({ system: SYS, messages: [{ role: 'user', content: text }], json: true, maxTokens: 3000, temperature: 0.8, purpose: 'news', effort: 'low', emergency: false });
        const m = String(r && r.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
        if (m) return [JSON.parse(m[0]), 'brocore'];
      } catch (e) { log('brocore:', String(e.message || e).slice(0, 100)); }
    }
    const B = global._elevenBrain;
    if (BC && BC.emergencyOn && BC.emergencyOn() && B && B.available && B.available()) {
      try { const out = await B.ask({ system: SYS + ' Reply with the JSON object only.', messages: [{ role: 'user', content: text }], timeout: 40000 }); const m = String(out).match(/\{[\s\S]*\}/); if (m) return [JSON.parse(m[0]), 'elevenlabs']; } catch (e) { log('elevenlabs:', String(e.message || e).slice(0, 100)); }
    }
    return [null, ''];
  }

  const state = { running: false, at: null, last: '' };
  async function make(day) {
    day = day || dayOf(nowOf());
    if (state.running || q('SELECT 1 FROM news_thoughts WHERE day=?').get(day)) return null;
    state.running = true;
    try {
      const recent = q('SELECT thought FROM news_thoughts ORDER BY day DESC LIMIT 30').all().map(r => r.thought);
      const ask = 'Today is ' + day + '.' + (recent.length ? '\nRecent thoughts (write something different):\n' + recent.slice(0, 14).map(t => '- ' + t).join('\n') : '');
      let [out, by] = await write(ask), bad = check(out, recent);
      if (bad.length && out) { const [fixed, by2] = await write(ask + '\n\nYOUR DRAFT:\n' + JSON.stringify(out) + '\n\nProblems: ' + bad.join('; ') + '. Fix every one and return the corrected JSON.'); if (fixed && check(fixed, recent).length < bad.length) { out = fixed; by = by2; bad = check(out, recent); } }
      if (bad.length) {
        // the seed for this day (in turn), never one already used in the last week
        const used = new Set(recent.slice(0, 7));
        const n = Math.floor(Date.parse(day + 'T00:00:00Z') / 864e5);
        let k = n % SEEDS.length; for (let g = 0; g < SEEDS.length && used.has(SEEDS[k].thought); g++) k = (k + 1) % SEEDS.length;
        out = SEEDS[k]; by = 'seed'; if (bad[0] !== 'not a JSON object') state.last = bad.join('; ');
      }
      q('INSERT OR IGNORE INTO news_thoughts(day, thought, story, thought_hi, story_hi, image_query, writer) VALUES(?,?,?,?,?,?,?)')
        .run(day, clean(out.thought), clean(out.story), clean(out.thought_hi), clean(out.story_hi), clean(out.image_query).slice(0, 60), by);
      await photo(day);
      log('today', day, 'by', by);
      return day;
    } catch (e) { state.last = e.message; log('make', e.message); return null; }
    finally { state.running = false; state.at = new Date().toISOString(); }
  }
  // its photo: the scene it names, else the "life" pool (the News Desk's finder, so the same free licences and credit)
  async function photo(day) {
    const P = global._newsPhotos; if (!P) return false;
    const r = q('SELECT * FROM news_thoughts WHERE day=?').get(day); if (!r) return false;
    if (P.file('th_' + day) && r.image_credit) return true;
    const cr = await P.into('th_' + day, r.image_query, r.thought, 'life');
    if (cr && cr !== 'have') { delete cr._url; q('UPDATE news_thoughts SET image_credit=? WHERE day=?').run(JSON.stringify(cr), day); return true; }
    return cr === 'have';
  }
  const pubT = r => {
    const P = global._newsPhotos; let cr = null; try { cr = JSON.parse(r.image_credit || 'null'); } catch (e) { cr = null; }
    const has = P && P.file('th_' + r.day);
    return { id: 'th_' + r.day, day: r.day, thought: r.thought, story: r.story, thought_hi: r.thought_hi, story_hi: r.story_hi, image: has ? P.url('th_' + r.day) : null, image_credit: has && cr && cr.license ? cr : null, writer: r.writer };
  };
  if (app) {
    app.get('/api/news/thought', async (req, res) => {
      res.set('Cache-Control', 'no-cache');
      try {
        const today = dayOf(nowOf());
        // today's is written in the background; only a first-ever visit waits for it (8 s at most)
        if (!q('SELECT 1 FROM news_thoughts WHERE day=?').get(today)) {
          const p = state.running ? null : make(today).catch(() => null);
          if (p && !q('SELECT 1 FROM news_thoughts LIMIT 1').get()) await Promise.race([p, new Promise(r => setTimeout(r, 8000))]);
        }
        const rows = q('SELECT * FROM news_thoughts WHERE day <= ? ORDER BY day DESC LIMIT 7').all(today);
        res.json({ items: rows.map(pubT) });
      } catch (e) { res.status(500).json({ error: 'thought unavailable', items: [] }); }
    });
  }
  if (o.schedule !== false && process.env.NEWS_THOUGHT !== '0') {
    const tick = () => { make().catch(() => {}); try { for (const r of q("SELECT day FROM news_thoughts WHERE image_credit IS NULL OR image_credit='' ORDER BY day DESC LIMIT 3").all()) photo(r.day).catch(() => {}); } catch (e) { /* ignore */ } };
    const t1 = setTimeout(tick, 150e3), t2 = setInterval(tick, 30 * 60e3);
    for (const t of [t1, t2]) if (t.unref) t.unref();
  }
  return { make, photo, state, check, dayOf };
}

module.exports = { create, check, SEEDS, dayOf };
