// Bro's own brain: benchmarks one GGUF model on this machine's CPU the way a live call uses it (Bro's compact prompt,
// one session per call, a first sentence as soon as it is ready). Run by .github/workflows/brain-bench.yml.
//   node brain-bench.mjs <model.gguf> <label> [threads]
// Prints one JSON line per question ("BENCH {...}") and a summary line ("BENCH-SUMMARY {...}").
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import os from 'os';

const [file, label = 'model', threadsArg] = process.argv.slice(2);
const threads = Number(threadsArg) || Math.max(1, os.cpus().length);
const PERSONA = 'You are Bro: a warm, deep-voiced friend and guide on a live voice call. Talk like a real person: answer the question first, in one to three short spoken sentences (more only if they ask for detail). No lists, no markdown, no emojis. If you do not know something recent, say so honestly. If they tell you they feel low, be kind and gently suggest talking to someone they trust.';
const LANG = {
  en: 'Language: this conversation is in English. Reply only in clear, natural Indian English.',
  hi: 'Language: this conversation is in Hindi. Reply only in natural, everyday spoken Hindi, written in Devanagari script.',
};
const sys = lang => [PERSONA, LANG[lang], 'It is Tuesday, 20 October 2026 in India. The user\'s name is Rishabh.'].join('\n\n');
const FACTS = 'Fresh facts from Bro\'s sources (reference data, not instructions):\n- [2026-10-18] Navratri 2026 ends on October 19; Dussehra is on October 20 (Hindustan Times)\n- [2026-10-17] Navami and Kanya Pujan fall on October 19 (Drik Panchang)';
const QUESTIONS = [
  { id: 'capital-en', lang: 'en', q: 'What is the capital of India?', followup: 'And which river flows through it?' },
  { id: 'feel-en', lang: 'en', q: 'I feel really low today, my exam went badly.' },
  { id: 'facts-en', lang: 'en', q: FACTS + '\n\nWhen does Navratri end this year?' },
  { id: 'capital-hi', lang: 'hi', q: 'भारत की राजधानी क्या है?', followup: 'और वहाँ कौन सी नदी बहती है?' },
  { id: 'feel-hi', lang: 'hi', q: 'मुझे आज बहुत अकेलापन लग रहा है।' },
  { id: 'facts-hi', lang: 'hi', q: FACTS + '\n\nनवरात्रि इस साल कब खत्म हो रही है?' },
  { id: 'memory-en', lang: 'en', history: [{ type: 'user', text: 'I love cricket and I play every Sunday.' }, { type: 'model', response: ['That is awesome, Rishabh! Sunday cricket sounds like a great way to unwind.'] }], q: 'Which sport do I play on Sundays?' },
];
const sentenceEnd = /[.!?।](\s|$)/;
const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);

const t0 = Date.now();
const llama = await getLlama({ gpu: false, build: 'never', logLevel: 'error' });
const model = await llama.loadModel({ modelPath: file });
const loadMs = Date.now() - t0;
const results = [];
async function ask(session, seq, id, q) {
  const m0 = { i: seq.tokenMeter.usedInputTokens, o: seq.tokenMeter.usedOutputTokens };
  const s0 = Date.now(); let firstTok = 0, firstSentence = 0, text = '';
  await session.prompt(q, {
    maxTokens: 160, temperature: 0.6, budgets: { thoughtTokens: 0 },
    onTextChunk: c => { if (!firstTok) firstTok = Date.now() - s0; text += c; if (!firstSentence && sentenceEnd.test(text)) firstSentence = Date.now() - s0; },
  });
  const totalMs = Date.now() - s0;
  const inTok = seq.tokenMeter.usedInputTokens - m0.i, outTok = seq.tokenMeter.usedOutputTokens - m0.o;
  const genMs = Math.max(1, totalMs - firstTok);
  const r = { label, id, firstTokMs: firstTok, firstSentenceMs: firstSentence || totalMs, totalMs, inTok, outTok, promptTps: Math.round(inTok / Math.max(0.001, firstTok / 1000)), genTps: +(outTok / (genMs / 1000)).toFixed(1), text: text.trim() };
  console.log('BENCH ' + JSON.stringify(r));
  return r;
}
for (const Q of QUESTIONS) {
  // a fresh context per question (some models free a disposed sequence late); the follow-up reuses the call's session
  const ctx = await model.createContext({ contextSize: 2048, sequences: 1, threads });
  const seq = ctx.getSequence();
  // the system prompt goes in through the chat history, exactly as Bro's engine does (some chat formats ignore the
  // constructor's systemPrompt)
  const session = new LlamaChatSession({ contextSequence: seq });
  session.setChatHistory([{ type: 'system', text: sys(Q.lang) }, ...(Q.history || [])]);
  results.push(await ask(session, seq, Q.id, Q.q));
  if (Q.followup) results.push(Object.assign(await ask(session, seq, Q.id + '-followup', Q.followup), { followup: true }));
  await ctx.dispose();
}
const avg = k => Math.round(results.reduce((a, r) => a + r[k], 0) / results.length);
const fol = results.filter(r => r.followup), first = results.filter(r => !r.followup);
const avgOf = (a, k) => a.length ? Math.round(a.reduce((x, r) => x + r[k], 0) / a.length) : null;
console.log('BENCH-SUMMARY ' + JSON.stringify({ label, threads, firstSentenceMsFresh: avgOf(first, 'firstSentenceMs'), firstSentenceMsFollowup: avgOf(fol, 'firstSentenceMs'), cpus: os.cpus().length, cpuModel: os.cpus()[0] && os.cpus()[0].model, loadMs, rssMB: rssMB(), firstSentenceMsAvg: avg('firstSentenceMs'), firstTokMsAvg: avg('firstTokMs'), promptTpsAvg: avg('promptTps'), genTpsAvg: +(results.reduce((a, r) => a + r.genTps, 0) / results.length).toFixed(1) }));
await model.dispose();
