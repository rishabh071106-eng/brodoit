// Does a follow-up in the same call reuse the engine's cache? Two ways to give node-llama-cpp the next turn:
//   set:  setChatHistory(system, question 1, answer 1) and then prompt(question 2)    (what the engine did)
//   keep: prompt(question 2) on the session as it stands                              (the session's own history)
// Prints how many tokens each turn read and where the cached tokens and the new ones first differ.
//   node brocore/bench/kv-probe.mjs <model.gguf> [threads]      (run by .github/workflows/brain-bench.yml)
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
const [file, threadsArg] = process.argv.slice(2);
const llama = await getLlama({ gpu: false, build: 'never', logLevel: 'error' });
const model = await llama.loadModel({ modelPath: file });
const ctx = await model.createContext({ contextSize: 2048, sequences: 2, threads: Number(threadsArg) || 3 });
const SYS = 'You are Bro: a warm, deep-voiced friend and guide on a live voice call. Talk like a real person: answer exactly what was asked, first, in one to three short spoken sentences.\n\nLanguage: this conversation is in English.\n\nToday is Tuesday, 20 October 2026 in India. The user\'s name is Rishabh.';
const ASK = 'Looked up just now (reference only; answer in your own words):\n- New Delhi: New Delhi is the capital of India and the seat of all three branches of the Government of India. (Wikipedia)\n\nWhat is the capital of India?';
const Q2 = 'And which river flows through it?';
const show = t => JSON.stringify(model.detokenize(t));
for (const variant of ['set', 'keep']) {
  const seq = ctx.getSequence(); const chat = new LlamaChatSession({ contextSequence: seq });
  chat.setChatHistory([{ type: 'system', text: SYS }]); await chat.preloadPrompt('');
  const w = seq.contextTokens.slice(), t0 = seq.tokenMeter.usedInputTokens;
  if (variant === 'set') chat.setChatHistory([{ type: 'system', text: SYS }]);
  const ans = await chat.prompt(ASK, { maxTokens: 40, budgets: { thoughtTokens: 0 } });
  const a = seq.contextTokens.slice(), t1 = seq.tokenMeter.usedInputTokens;
  if (variant === 'set') chat.setChatHistory([{ type: 'system', text: SYS }, { type: 'user', text: ASK }, { type: 'model', response: [ans.trim()] }]);
  await chat.prompt(Q2, { maxTokens: 20, budgets: { thoughtTokens: 0 } });
  const b = seq.contextTokens.slice(), t2 = seq.tokenMeter.usedInputTokens;
  const diff = (x, y) => { let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };
  const d1 = diff(w, a), d2 = diff(a, b);
  console.log('KV ' + JSON.stringify({ variant, wrapper: chat.chatWrapper && chat.chatWrapper.wrapperName, warmTokens: w.length, turn1Read: t1 - t0, turn1Tokens: a.length, warmVsTurn1Diff: d1, turn2Read: t2 - t1, turn1VsTurn2Diff: d2, answer: ans.slice(0, 80) }));
  console.log('KV ' + variant + ' warm→turn1 at ' + d1 + ': cached ' + show(w.slice(Math.max(0, d1 - 6), d1 + 6)) + ' | new ' + show(a.slice(Math.max(0, d1 - 6), d1 + 6)));
  console.log('KV ' + variant + ' turn1→turn2 at ' + d2 + ': cached ' + show(a.slice(Math.max(0, d2 - 6), d2 + 6)) + ' | new ' + show(b.slice(Math.max(0, d2 - 6), d2 + 6)));
  chat.dispose(); await seq.dispose();
}
process.exit(0);
