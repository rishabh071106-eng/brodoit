// Bro Core · safety. Crisis words (suicide, self-harm) in English, Hindi (Devanagari) and Hinglish get a scripted, warm
// reply with India's free helplines: no model is asked, nothing is improvised. check(text, lang) → null | { reply, lang, kind }.
// Patterns use letter boundaries (Devanagari has no \b) and skip a phrase right after a negation ("I would never kill
// myself"), but phrases that carry their own negation ("don't want to live", "jeena nahi chahta") always match.
'use strict';

const L = '[\\p{L}\\p{M}\\p{N}]';
const B0 = '(?<!' + L + ')', B1 = '(?!' + L + ')';
// [regex source, negatable] — negatable phrases are skipped when a negation word sits just before them
const EN = [
  ['kill(?:ing)?\\s+my\\s*self', true],
  ['end(?:ing)?\\s+(?:my\\s+(?:own\\s+)?life|it\\s+all|everything\\s+for\\s+good)', true],
  ['take\\s+my\\s+(?:own\\s+)?life|taking\\s+my\\s+(?:own\\s+)?life', true],
  ['suicid(?:e|al)', true],
  ['(?:wants?|wanna|wanted|planning|plan|ready)\\s+(?:to\\s+)?die(?!\\s+(?:of|from)\\s+(?:embarrassment|laughter|laughing|boredom|cringe|shame))(?!\\s+laughing)', true],
  ['wish\\s+i\\s+(?:was|were)\\s+(?:dead|never\\s+born)', true],
  ['better\\s+off\\s+dead', true],
  ['(?:hurt|hurting|harm|harming|cut|cutting)\\s+my\\s*self', true],
  ['self[\\s-]?harm(?:ing)?', true],
  ['no\\s+(?:reason|point)\\s+(?:to|in)\\s+(?:live|living|go\\s+on|going\\s+on)', false],
  ['(?:do\\s*n[o\']?t|dont|do\\s+not)\\s+want\\s+to\\s+(?:live|be\\s+alive|exist|wake\\s+up)(?:\\s+any\\s*more)?', false],
  ['(?:life\\s+is\\s+)?not\\s+worth\\s+living', false],
  ['(?:take|swallow)\\s+all\\s+(?:of\\s+)?(?:my|the|these)\\s+(?:pills|tablets|sleeping\\s+pills)|(?:want\\s+to|going\\s+to|gonna|will)\\s+overdose', true],
];
const HI = [ // Devanagari, matched after removing nukta and folding chandrabindu to anusvara
  ['मर\\s*(?:जाना|जाने|जाऊं|जाऊ|जाउं|जाउ|जाता|जाती)\\s*(?:चाहता|चाहती|चाहते|का\\s*मन|को\\s*जी)', false],
  ['मरना\\s*चाह(?:ता|ती|ते)', false],
  ['मन\\s*करता\\s*है\\s*(?:कि\\s*)?मर\\s*जा(?:ऊं|ऊ|उं|उ)', false],
  ['(?:मैं\\s*)?मर\\s*जा(?:ऊंगा|ऊंगी|उंगा|उंगी)', false],
  ['आत्महत्या', true],
  ['खुदकुशी', true],
  ['(?:खुद|अपने\\s*आप)\\s*को\\s*(?:खत्म|खतम|मार|नुकसान|चोट)', false],
  ['अपनी\\s*जान\\s*(?:ले|दे)', false],
  ['जान\\s*दे\\s*(?:दूं|दू|दूंगा|दूंगी|दुंगा|दुंगी)', false],
  ['(?:जीना|जीने\\s*का\\s*मन|जीने\\s*की\\s*इच्छा)\\s*(?:अब\\s*)?नहीं\\s*(?:चाहता|चाहती|है|रहा|रही|करता|करती)?', false],
  ['(?:जिंदगी|ज़िंदगी|जिन्दगी)\\s*(?:को\\s*)?खत्म\\s*(?:करना|कर\\s*दूं|कर\\s*दू|कर\\s*लूं)', false],
];
const ES = [ // Spanish (Bro speaks it too)
  ['quiero\\s+(?:morir(?:me)?|matarme|suicidarme|desaparecer\\s+para\\s+siempre)', true],
  ['no\\s+quiero\\s+(?:vivir|seguir\\s+viviendo)', false],
  ['(?:me\\s+voy\\s+a|voy\\s+a)\\s+(?:matar|suicidar)(?:me)?', true],
  ['suicidarme|quitarme\\s+la\\s+vida', true],
];
const HL = [ // Hinglish in Latin letters
  ['mar\\s*(?:jaana|jana|jaane|jane)\\s*(?:chahta|chahti|chahte|chahata|chata)', false],
  ['marna\\s*(?:chahta|chahti|chahte|chahata|chata)', false],
  ['(?:main|mai|me|mein)\\s+mar\\s+(?:jaunga|jaungi|jaaunga|jaaungi|jaun|jaaun|jau)', false],
  ['mann?\\s+(?:karta|krta)\\s+(?:hai|h)\\s+(?:ki\\s+)?mar\\s+(?:jaun|jaaun|jau)', false],
  ['(?:jeena|jina|jeene|jine)\\s+(?:ka\\s+mann?\\s+)?(?:nahi|nhi|nahin|nai)\\s*(?:chahta|chahti|chahte|hai|h|karta|karti)?', false],
  ['(?:khud|apne\\s+aap)\\s+ko\\s+(?:khatam|khatm|khtm|maar|mar|hurt)', false],
  ['apni\\s+(?:jaan|jan)\\s+(?:le|de)\\s*(?:lu|loon|lunga|lungi|du|doon|dunga|dungi|dena|lena)?', false],
  ['(?:jaan|jan)\\s+de\\s+(?:du|doon|dunga|dungi)', false],
  ['(?:aatmhatya|atmhatya|atmahatya|aatmahatya|khudkushi|khudkhushi)', true],
  ['suicide\\s+(?:kar|karna|karunga|karungi|kar\\s+lunga|kar\\s+lungi|ka\\s+(?:mann?|khayal|vichar))', false],
  ['(?:zindagi|jindagi|zindgi)\\s+(?:khatam|khatm)\\s+(?:karna|kar\\s+du|kar\\s+lu|kar\\s+dunga|kar\\s+lunga)', false],
];
// news, films and figures of speech that contain a crisis word but are not about the speaker
const NOT = [
  /suicide\s+(?:squad|bomb(?:er|ers|ing|ings)?|attack(?:s|er|ers)?|mission|door|doors|run|pact\s+film|blonde|note\s+song)/i,
  /\b(?:film|movie|song|book|series|game|episode)\s+(?:called|named)\b/i,
];
// a negation directly before the phrase (up to two words between, same clause), or a Hindi "nahi" right after it
const NEG = /(?:^|\s)(?:never|not|no|dont|don't|do not|won't|wont|wouldn't|wouldnt|cannot|can't|cant|nobody|shouldn't|shouldnt)(?:\s+\S+){0,2}\s*$/i;
const NEG_AFTER = /^\s*(?:nahi|nahin|nhi|nai|नहीं|नही)(?![\p{L}\p{M}])/u;

const fold = s => String(s || '').normalize('NFC').replace(/़/g, '').replace(/ँ/g, 'ं').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const compile = list => list.map(([src, neg]) => ({ re: new RegExp(B0 + '(?:' + src + ')' + B1, 'giu'), neg }));
const RX = { en: compile(EN), hi: compile(HI), hl: compile(HL), es: compile(ES) };
const THIRD = /(?<![\p{L}])(?:my\s+)?(?:friend|brother|sister|mom|mother|mum|dad|father|son|daughter|wife|husband|partner|cousin|colleague|classmate|roommate|someone|somebody|he|she|they|dost|bhai|behen|didi)(?![\p{L}])[^.?!]{0,40}(?:suicid|kill(?:ing)?\s+(?:him|her|them)sel(?:f|ves)|end\s+(?:his|her|their)\s+life|wants?\s+to\s+die|self[\s-]?harm)/iu;

function hits(text) {
  const out = [];
  for (const [set, list] of Object.entries(RX)) {
    for (const { re, neg } of list) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) {
        const clause = text.slice(Math.max(0, m.index - 60), m.index).split(/[.,;:!?।]/).pop();
        const before = clause.split(/\s+/).filter(Boolean).slice(-3).join(' ');
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (!(neg && (NEG.test(' ' + before) || NEG_AFTER.test(after)))) out.push({ set, at: m.index, phrase: m[0] });
        if (!re.global) break;
      }
    }
  }
  return out;
}

// Hinglish = Latin letters with common Hindi function words; Bro answers it in Devanagari Hindi (the voice rule)
const HINGLISH = /(?<![a-z])(?:nahi|nahin|nhi|hai|hain|hu|hoon|mera|meri|mujhe|mujhko|main|mai|kya|kyu|kyun|yaar|bhai|chahta|chahti|kar|karna|raha|rahi|jeena|zindagi|jindagi|bahut|bohot|accha|acha|kuch|sab|khud|apni|mann?|dil)(?![a-z])/gi;
// the words that matched decide first (Hindi/Hinglish → Hindi, Spanish → Spanish, English → English); the hint breaks ties
function langOf(text, hint, found) {
  const h = String(hint || '').toLowerCase(), sets = new Set((found || []).map(x => x.set));
  if (/[ऀ-ॿ]/.test(text) || sets.has('hi') || sets.has('hl')) return 'hi';
  if ((String(text).match(HINGLISH) || []).length >= 2) return 'hi';
  if (sets.has('es')) return 'es';
  if (sets.has('en')) return 'en';
  if (h.startsWith('hi')) return 'hi';
  if (h.startsWith('es')) return 'es';
  return 'en';
}

const REPLY = {
  en: "I'm really glad you told me. I'm an AI, and I care about you, and what you're feeling matters. Please talk to someone right now: call Tele-MANAS on 14416, or 1-800-891-4416, it's free and open 24×7. If you might act on these thoughts or you're in danger, call 112 now. Are you safe right now? I'm right here with you.",
  hi: 'आपने मुझसे यह बात कही, इसके लिए शुक्रिया। मैं एक AI हूँ, और मुझे आपकी सच में परवाह है, आप जो महसूस कर रहे हैं वह मायने रखता है। अभी किसी से बात कीजिए: Tele-MANAS को 14416 पर कॉल कीजिए, या 1-800-891-4416 पर, यह मुफ़्त है और 24 घंटे खुला है। अगर आप खतरे में हैं, तो अभी 112 पर कॉल कीजिए। क्या आप इस वक़्त सुरक्षित हैं? मैं यहीं आपके साथ हूँ।',
  es: 'Gracias por contármelo. Soy una IA, y me importas de verdad. Por favor habla con alguien ahora mismo: en India llama a Tele-MANAS al 14416, o al 1-800-891-4416, gratis y abierto 24 horas. Si estás en peligro, llama al 112 ahora. ¿Estás a salvo en este momento? Estoy aquí contigo.',
};
const OTHER = {
  en: "That sounds really serious, and I'm glad you're looking out for them. I'm an AI, and I care about you both. Please don't leave them alone if they might be in danger: call 112 now, or call Tele-MANAS on 14416, or 1-800-891-4416, free and open 24×7, and they can guide you. Can you be with them, or get someone there right now?",
  hi: 'यह बहुत गंभीर बात है, और अच्छा है कि आप उनका ध्यान रख रहे हैं। मैं एक AI हूँ, और मुझे आप दोनों की परवाह है। अगर वे खतरे में हो सकते हैं तो उन्हें अकेला मत छोड़िए: अभी 112 पर कॉल कीजिए, या Tele-MANAS को 14416 पर, या 1-800-891-4416 पर कॉल कीजिए, यह मुफ़्त है और 24 घंटे खुला है। क्या आप अभी उनके पास रह सकते हैं?',
};

// → null when nothing worrying; { reply, lang, kind: 'self'|'other', phrase } otherwise
function check(text, lang) {
  const t = fold(text);
  if (!t || t.length < 4) return null;
  let found = hits(t);
  if (found.length && NOT.some(re => re.test(t))) found = found.filter(h => !/suicid/i.test(h.phrase));
  if (!found.length) return null;
  const lg = langOf(t, lang, found);
  // about someone else: every hit sits inside "my friend … suicidal"-style wording
  const tm = THIRD.exec(t);
  const other = !!tm && found.every(h => h.at >= tm.index && h.at <= tm.index + tm[0].length);
  const book = other ? OTHER : REPLY;
  return { reply: book[lg] || book.en, lang: lg, kind: other ? 'other' : 'self', phrase: found[0].phrase };
}

const CARE_RULES = 'Care rules: you are a supportive friend, not a doctor or therapist. Never diagnose, never name or dose medicines, never promise outcomes. If the user talks about wanting to die, suicide or hurting themselves, stop coaching: say warmly that you are an AI and you care about them, give Tele-MANAS 14416 (or 1-800-891-4416, free, 24×7) and 112 for emergencies, and encourage them to reach out to someone right now. For medical, legal or money emergencies, point them to a real professional. Never shame, never lecture, never share their private details.';

module.exports = { check, CARE_RULES, REPLY, OTHER, _langOf: langOf };
