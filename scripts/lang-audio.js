#!/usr/bin/env node
// Pre-render Pimsleur-style audio lessons with ElevenLabs so learners hear studio voices
// instead of the device voice. Resumable; skips lessons already rendered.
//   ELEVENLABS_API_KEY=... node scripts/lang-audio.js            # every course
//   node scripts/lang-audio.js es fr                             # specific courses
// Output per lesson: lang/audio/<code>/<lessonId>.mp3 + <lessonId>.json ({steps:[{start,end}]})
// The player (lang/audio.html) prefers these files and falls back to speechSynthesis when absent.
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const KEY = process.env.ELEVENLABS_API_KEY || '';
const VOICES = { // narrator (learner language) and native (target language) voices — override with env
  en: process.env.ELEVEN_VOICE_EN || 'pNInz6obpgDQGcFmaJgB', hi: process.env.ELEVEN_VOICE_HI || 'pNInz6obpgDQGcFmaJgB',
  es: process.env.ELEVEN_VOICE_ES || 'EXAVITQu4vr4xnSDxMaL', fr: process.env.ELEVEN_VOICE_FR || 'EXAVITQu4vr4xnSDxMaL', de: process.env.ELEVEN_VOICE_DE || 'EXAVITQu4vr4xnSDxMaL',
};
const ROOT = path.join(__dirname, '..', 'lang', 'audio');
// Recordings go to the persistent media dir (next to the DB on the Railway volume): rendered once, kept forever.
const MEDIA_DIR = process.env.MEDIA_DIR || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'media') : (fs.existsSync('/data') ? '/data/media' : path.join(__dirname, '..', 'media')));
const OUT_ROOT = path.join(MEDIA_DIR, 'lang-audio');
const only = process.argv.slice(2);
if (!KEY) { console.log('ELEVENLABS_API_KEY missing'); process.exit(1); }
console.log('[lang-audio] output →', path.join(MEDIA_DIR, 'lang-audio'));
function ffprobeSec(f) { return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) || 0; }
async function tts(text, voice, lang, slow) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', language_code: lang, voice_settings: { stability: 0.6, similarity_boost: 0.8, speed: slow ? 0.75 : 0.95 } }),
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return Buffer.from(await r.arrayBuffer());
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'langaudio-'));
  for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.json'))) {
    const code = f.slice(0, -5); if (only.length && !only.includes(code)) continue;
    const course = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const outDir = path.join(OUT_ROOT, code); fs.mkdirSync(outDir, { recursive: true });
    const nLang = course.from === 'hi' ? 'hi' : 'en', tLang = code;
    for (const lesson of course.lessons) {
      const mp3 = path.join(outDir, lesson.id + '.mp3'); if (fs.existsSync(mp3)) continue;
      console.log(`[${code}] ${lesson.id} ${lesson.title}`);
      const parts = [], timings = []; let t = 0;
      for (let i = 0; i < lesson.steps.length; i++) {
        const s = lesson.steps[i]; let file = null, dur = 0;
        if (s.p) { dur = s.p; }
        else {
          const text = s.n || s.q || s.t; const isTarget = 't' in s;
          const buf = await tts(text, VOICES[isTarget ? tLang : nLang], isTarget ? tLang : nLang, !!s.slow);
          file = path.join(tmp, `${code}-${lesson.id}-${i}.mp3`); fs.writeFileSync(file, buf); dur = ffprobeSec(file) + 0.35;
        }
        timings.push({ start: +t.toFixed(2), end: +(t + dur).toFixed(2) });
        parts.push(file ? `file '${file}'` : `file '${silence(dur)}'`); t += dur;
      }
      const list = path.join(tmp, `${code}-${lesson.id}.txt`); fs.writeFileSync(list, parts.join('\n'));
      execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '96k', mp3 + '.part']);
      fs.renameSync(mp3 + '.part', mp3);
      fs.writeFileSync(path.join(outDir, lesson.id + '.json'), JSON.stringify({ steps: timings, duration: +t.toFixed(2) }));
      console.log(`   → ${Math.round(t / 60)} min`);
    }
  }
  function silence(sec) { const f = path.join(tmp, `sil-${sec}.mp3`); if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(sec), '-c:a', 'libmp3lame', '-b:a', '64k', f]); return f; }
})();
