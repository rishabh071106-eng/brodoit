#!/usr/bin/env node
// Pre-records every line learners hear in the Python course and the five language courses, once,
// into MEDIA_DIR/learn-voice (the same files /api/learn/say serves). Resumable: existing clips are
// skipped. Uses the studio chain with the 'bulk' budget (ElevenLabs within its reserve, then Gemini,
// then OpenAI) and stops cleanly when every provider is out of credit.
// usage: node scripts/learn-audio.js [--only py|es|fr|de|hi|en] [--limit N]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MEDIA = process.env.MEDIA_DIR || path.join(ROOT, 'media');
const STUDIO = require(path.join(ROOT, 'modules', 'studio.js'));
const { catalog, VOICES } = require(path.join(ROOT, 'modules', 'learn.js'));
STUDIO.configure({ mediaDir: MEDIA });
const getSetting = k => process.env[k] || '';
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const only = arg('--only'), limit = parseInt(arg('--limit')) || Infinity;

(async () => {
  const DIR = path.join(MEDIA, 'learn-voice');
  fs.mkdirSync(DIR, { recursive: true });
  if (!STUDIO.available(getSetting).length) { console.log('No voice key (ElevenLabs, Gemini or OpenAI): nothing to record.'); process.exit(1); }
  const all = [...catalog(ROOT).values()].filter(it => !only || it.voice === only);
  const todo = all.filter(it => !fs.existsSync(path.join(DIR, it.id + '.mp3')));
  console.log(`Learning voice: ${all.length - todo.length}/${all.length} recorded, ${todo.length} to go.`);
  let made = 0, fails = 0; const by = {};
  for (const it of todo) {
    if (made >= limit) break;
    const v = VOICES[it.voice] || VOICES.py;
    let out = null;
    try { out = await STUDIO.speak({ text: it.text, lang: v.lang, role: v.role, purpose: 'bulk', getSetting, mp3: true, timeout: 60000, eleven: { format: 'mp3_44100_64', timeout: 50000, chunk: 1500 } }); }
    catch (e) { out = null; }
    if (!out || out.mime !== 'audio/mpeg') {
      fails++;
      if (fails >= 6) { console.log(`Stopping: providers are out of budget or failing (${made} recorded this run). The next run resumes here.`); break; }
      continue;
    }
    fails = 0;
    const f = path.join(DIR, it.id + '.mp3'), tmp = f + '.tmp';
    fs.writeFileSync(tmp, out.buf); fs.renameSync(tmp, f);
    made++; by[out.provider] = (by[out.provider] || 0) + 1;
    if (made % 20 === 0) console.log(`… ${made} recorded (${it.where}) via ${JSON.stringify(by)}`);
  }
  const have = all.filter(it => fs.existsSync(path.join(DIR, it.id + '.mp3'))).length;
  console.log(`Done: ${made} new clips ${JSON.stringify(by)} · ${have}/${all.length} recorded in total.`);
  process.exit(have === all.length ? 0 : (made ? 0 : 1));
})();
