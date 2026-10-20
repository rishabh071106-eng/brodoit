// Bro's own brain, end to end with a real model and the real services: the engine (modules/brocore/mind.js) runs the GGUF
// in its child process, the router (modules/brocore/own.js) looks things up live (Google News, Wikipedia, Open-Meteo,
// Frankfurter, Nager.Date), and Bro answers questions in English and Hindi, a follow-up in the same call included.
//   node brocore/bench/own-e2e.mjs <model.gguf> <sha256> [threads]      (run by .github/workflows/brain-bench.yml)
// Prints "E2E {...}" per question and "E2E-SUMMARY {...}"; exits 1 when an answer is missing or wrong.
import { createRequire } from 'module';
import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { createMind } = require(ROOT + '/modules/brocore/mind.js');
const { createOwn } = require(ROOT + '/modules/brocore/own.js');
const { createKnowledge } = require(ROOT + '/modules/brocore/knowledge.js');
const Database = require('better-sqlite3');

const [file, sha256, threadsArg] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-e2e-'));
fs.symlinkSync(path.resolve(file), path.join(dir, 'model.gguf'));
const log = (...a) => console.log('[e2e]', ...a);
const mind = createMind({ dir, models: { only: { name: path.basename(file), file: 'model.gguf', url: '', bytes: fs.statSync(file).size, sha256: '', minRamMB: 100 } }, threads: Number(threadsArg) || 2, log });
const db = new Database(':memory:');
const knowledge = createKnowledge({ db, log: () => {} });
const memory = { top: () => [{ text: 'Plays cricket every Sunday' }] };
const own = createOwn({ mind, knowledge, memory, log });
const t0 = Date.now(); mind.init({});
while (!mind.ready()) { if (['error', 'crashed', 'too-small', 'no-space'].includes(mind.state())) { console.log('E2E-FAILED engine', mind.health()); process.exit(1); } await new Promise(r => setTimeout(r, 200)); }
const loadMs = Date.now() - t0;
const user = { phone: '+910000000000', name: 'Rishabh' };
const CASES = [
  { id: 'capital-en', lang: 'en', q: 'What is the capital of India?', want: /delhi/i },
  { id: 'river-followup', lang: 'en', q: 'And which river flows through it?', want: /yamuna/i, same: 'capital-en' },
  { id: 'weather-en', lang: 'en', q: 'What is the weather in Pune today?', want: /°|degree|rain|cloud|sun|clear|humid/i, facts: 'weather' },
  { id: 'fx-en', lang: 'en', q: 'What is the dollar rate in rupees right now?', want: /\d/, facts: 'fx' },
  { id: 'news-en', lang: 'en', q: 'What is the latest news about India?', want: /./, facts: 'news' },
  { id: 'feel-en', lang: 'en', q: 'I feel really low today, my exam went badly.', want: /./ },
  { id: 'capital-hi', lang: 'hi', q: 'भारत की राजधानी क्या है?', want: /दिल्ली|delhi/i },
  { id: 'festival-hi', lang: 'hi', q: 'दिवाली इस साल कब है?', want: /./, facts: 'news' },
];
const sessions = {}; const results = []; let bad = 0;
for (const C of CASES) {
  const session = C.same ? sessions[C.same].session : 'e2e-' + C.id;
  const history = C.same ? sessions[C.same].history.concat([{ role: 'user', content: C.q }]) : [{ role: 'user', content: C.q }];
  own.warm({ session, user, lang: C.lang }); if (!C.same) await new Promise(r => setTimeout(r, 300));
  const s0 = Date.now(); let first = 0, text = '', done = null, looked = false;
  for await (const ev of own.answer({ user, lang: C.lang, history, session })) {
    if (ev.type === 'lookup') looked = true;
    else if (ev.type === 'text') { text += ev.delta; if (!first && /[.!?।](\s|$)/.test(text)) first = Date.now() - s0; }
    else if (ev.type === 'done') done = ev;
  }
  const ok = !!text.trim() && C.want.test(text) && (!C.facts || (done && done.facts.includes(C.facts)));
  if (!ok) bad++;
  const r = { id: C.id, ok, firstSentenceMs: first || Date.now() - s0, totalMs: Date.now() - s0, factsMs: done && done.factsMs, facts: done && done.facts, looked, genTps: done && done.stats && done.stats.genTps, inTok: done && done.stats && done.stats.inTok, text: text.trim() };
  results.push(r); console.log('E2E ' + JSON.stringify(r));
  sessions[C.id] = { session, history: history.concat([{ role: 'assistant', content: text.trim() }]) };
}
const h = mind.health();
console.log('E2E-SUMMARY ' + JSON.stringify({ model: path.basename(file), loadMs, threads: h.threads, ok: results.filter(r => r.ok).length + '/' + results.length, firstMsP50: h.firstMs, genTps: h.genTps, promptTps: h.promptTps, rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
mind.shutdown();
process.exit(bad ? 1 : 0);
