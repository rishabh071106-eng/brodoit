// Bro Core · how hard is this question? Instant rules, no extra model call (v20 "smartest first").
//   difficulty(text) → { hard, filler, why }
//     hard   — maths, code, planning, comparisons, "why / how does it work", several questions at once, or a long
//              message: the brain thinks harder (brain.js: reasoning medium on a call, high in typed chat)
//     filler — a hard question that is clearly a puzzle to work out (maths, code, a plan, a comparison) and not about
//              feelings: on a call Bro says "Ooh, good one! Let me think." at once, so there is no dead air
//     why    — the rule names that matched (for logs and tests)
// Everything else is easy: short, quick answers. English, Hindi and Hinglish.
'use strict';

const RULES = {
  math: [/\d\s*[-+*/^×÷%]\s*\d/, /\b(calculate|compute|solve|equation|derivative|integral|probability|percentage|interest|emi|compound|average|formula|proof|prove|square root|factorial|convert \d)/i, /(हिसाब|गणना|जोड़|घटा|गुणा|भाग|प्रतिशत|ब्याज)/, /\b(hisaab|hisab|kitna hoga|percent nikalo)\b/i],
  code: [/\b(code|coding|program|programming|function|python|javascript|typescript|java|c\+\+|sql|regex|api|bug|debug|compile|algorithm|script|html|css|react|node\.?js)\b/i, /(कोड|प्रोग्राम)/],
  plan: [/\b(plan|planning|itinerary|strategy|roadmap|budget|step[- ]by[- ]step|steps to|how (do|can|should) i (start|prepare|build|learn|become|crack|get)|study plan|diet plan|workout plan)\b/i, /(योजना|प्लान|तैयारी कैसे)/, /\b(plan bana|kaise shuru|taiyari kaise)\b/i],
  compare: [/\b(compare|comparison|difference between|differ from|vs\.?|versus|pros and cons|which (one )?(is|should|would) (better|best)|better than|trade-?offs?)\b/i, /(तुलना|फर्क|फ़र्क|अंतर|कौन सा बेहतर)/, /\b(farak|fark|antar|kaun sa better|kaunsa better)\b/i],
  explain: [/\b(why|how come|explain|analy[sz]e|in detail|what if|how does .{2,40} work|how do .{2,40} work|what causes|reason for)\b/i, /(क्यों|समझाओ|समझाइए|कैसे काम|विस्तार से)/, /\b(kyun|kyu|samjhao|samjha do|detail me)\b/i],
};
// feelings come first: never "Ooh, good one!" to someone who is hurting
const CARE = /\b(sad|depress\w*|stress\w*|anxious|anxiety|lonely|alone|hurt\w*|cry\w*|died|death|grief|breakup|broke up|scared|afraid|upset|heartbroken|miss (him|her|them)|worthless|hopeless)\b|(दुख|दुःख|उदास|परेशान|अकेला|अकेली|डर|रोना|टूट गया)|\b(udaas|pareshan|akela|dukhi)\b/i;

function difficulty(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const out = { hard: false, filler: false, why: [] };
  if (!t) return out;
  const words = t.split(' ').length;
  for (const [k, list] of Object.entries(RULES)) if (list.some(r => r.test(t))) out.why.push(k);
  if (t.length > 200) out.why.push('long');
  if ((t.match(/[?？]/g) || []).length >= 2) out.why.push('multi');
  if (/(^|\s)(1[.)]|first,?)\s.+(\s2[.)]|second(ly)?,?)\s/i.test(t)) out.why.push('multi');
  // a few casual words ("why not", "explain later") are small talk, not a puzzle
  if (words <= 3 && !out.why.includes('math')) out.why = [];
  out.hard = out.why.length > 0;
  const care = CARE.test(t);
  out.filler = out.hard && !care && out.why.some(k => k === 'math' || k === 'code' || k === 'plan' || k === 'compare');
  if (care) out.why.push('care');
  return out;
}

// what Bro says at once on a call before a hard answer (Bro's voice, the call's language)
const THINKING = { en: 'Ooh, good one! Let me think.', hi: 'अरे वाह, बढ़िया सवाल! एक सेकंड सोचने दो।' };

module.exports = { difficulty, THINKING, CARE };
