#!/usr/bin/env node
// Pre-render Pimsleur-style audio lessons with studio voices so learners hear a real narrator instead of the device voice.
// Voice: modules/studio.js — ElevenLabs while this month's credits allow (a reserve is kept for Bro and the news), else
// Gemini or OpenAI TTS. One provider is chosen per lesson so a lesson never switches voice halfway. Resumable; skips
// lessons already rendered and stops cleanly when no provider has budget left (the nightly sweep picks it up again).
//   ELEVENLABS_API_KEY=... node scripts/lang-audio.js            # every course
//   node scripts/lang-audio.js es fr                             # specific courses
// Output per lesson: lang/audio/<code>/<lessonId>.mp3 + <lessonId>.json ({steps:[{start,end}]})
// The player (lang/audio.html) prefers these files and falls back to speechSynthesis when absent.
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const VOICES = { // ElevenLabs narrator (learner language) and native (target language) voices — override with env
  en: process.env.ELEVEN_VOICE_EN || 'pNInz6obpgDQGcFmaJgB', hi: process.env.ELEVEN_VOICE_HI || 'pNInz6obpgDQGcFmaJgB',
  es: process.env.ELEVEN_VOICE_ES || 'EXAVITQu4vr4xnSDxMaL', fr: process.env.ELEVEN_VOICE_FR || 'EXAVITQu4vr4xnSDxMaL', de: process.env.ELEVEN_VOICE_DE || 'EXAVITQu4vr4xnSDxMaL',
};
const EV = require('../modules/elevenvoice.js');
const STUDIO = require('../modules/studio.js');
const env = k => process.env[k] || '';
async function resolveVoices(key) { if (!key) return; for (const l of Object.keys(VOICES)) { try { VOICES[l] = await EV.pickVoice(key, l); } catch (e) {} } console.log('voices', JSON.stringify(VOICES)); }
const ROOT = path.join(__dirname, '..', 'lang', 'audio');
// Recordings go to the persistent media dir (next to the DB on the Railway volume): rendered once, kept forever.
const MEDIA_DIR = process.env.MEDIA_DIR || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'media') : (fs.existsSync('/data') ? '/data/media' : path.join(__dirname, '..', 'media')));
const OUT_ROOT = path.join(MEDIA_DIR, 'lang-audio');
const only = process.argv.slice(2);
STUDIO.configure({ mediaDir: MEDIA_DIR });
if (!STUDIO.available(env).length) { console.log('No voice key (ElevenLabs, Gemini or OpenAI) — nothing to record'); process.exit(1); }
console.log('[lang-audio] output →', path.join(MEDIA_DIR, 'lang-audio'));
function ffprobeSec(f) { return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) || 0; }
async function tts(provider, text, lang, role, slow) {
  const out = await STUDIO.speak({ text, lang, purpose: 'bulk', role, slow, provider, mp3: true, getSetting: env, strict: true, voiceId: VOICES[lang], eleven: { format: 'mp3_44100_128', voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0 }, speed: slow ? 0.75 : 0.95 } });
  if (!out) throw new Error(provider + ' gave no audio');
  return out.buf;
}
(async () => {
  await resolveVoices(env('ELEVENLABS_API_KEY'));
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'langaudio-'));
  // Paid-for step audio is kept on the volume until its lesson is stitched, so a run that stops midway never pays twice.
  const PARTS = path.join(OUT_ROOT, '.parts'); fs.mkdirSync(PARTS, { recursive: true });
  for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.json'))) {
    const code = f.slice(0, -5); if (only.length && !only.includes(code)) continue;
    const course = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const outDir = path.join(OUT_ROOT, code); fs.mkdirSync(outDir, { recursive: true });
    const nLang = course.from === 'hi' ? 'hi' : 'en', tLang = code;
    for (const lesson of course.lessons) {
      const mp3 = path.join(outDir, lesson.id + '.mp3'); if (fs.existsSync(mp3)) continue;
      const chars = lesson.steps.reduce((n, s) => n + String(s.n || s.q || s.t || '').length, 0);
      const provider = await STUDIO.plan({ chars, purpose: 'bulk', mp3: true, getSetting: env });
      if (!provider) { console.log(`[lang-audio] stopping before ${code}/${lesson.id}: no voice budget left this month (ElevenLabs reserve kept for Bro and the news). The nightly sweep continues later.`); process.exit(0); }
      console.log(`[${code}] ${lesson.id} ${lesson.title} · ${provider} · ${chars} chars`);
      const parts = [], timings = []; let t = 0;
      for (let i = 0; i < lesson.steps.length; i++) {
        const s = lesson.steps[i]; let file = null, dur = 0;
        if (s.p) { dur = s.p; }
        else {
          const text = s.n || s.q || s.t; const isTarget = 't' in s;
          file = path.join(PARTS, `${code}-${lesson.id}-${provider}-${i}.mp3`);
          if (!(fs.existsSync(file) && fs.statSync(file).size > 0)) {
            let buf;
            try { buf = await tts(provider, text, isTarget ? tLang : nLang, isTarget ? 'native' : 'narrator', !!s.slow); }
            catch (e) {
              if (['credits', 'key', 'rate'].includes(e.code)) { console.log(`[lang-audio] stopping in ${code}/${lesson.id}: ${e.message.slice(0, 120)}. Finished steps are kept; the nightly sweep continues later.`); process.exit(0); }
              throw e;
            }
            fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
          }
          dur = ffprobeSec(file) + 0.35;
        }
        timings.push({ start: +t.toFixed(2), end: +(t + dur).toFixed(2) });
        parts.push(file ? `file '${file}'` : `file '${silence(dur)}'`); t += dur;
      }
      const list = path.join(tmp, `${code}-${lesson.id}.txt`); fs.writeFileSync(list, parts.join('\n'));
      execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '96k', mp3 + '.part']);
      fs.renameSync(mp3 + '.part', mp3);
      fs.writeFileSync(path.join(outDir, lesson.id + '.json'), JSON.stringify({ steps: timings, duration: +t.toFixed(2) }));
      for (const f of fs.readdirSync(PARTS)) if (f.startsWith(`${code}-${lesson.id}-`)) fs.unlinkSync(path.join(PARTS, f));
      console.log(`   → ${Math.round(t / 60)} min`);
    }
  }
  function silence(sec) { const f = path.join(tmp, `sil-${sec}.mp3`); if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(sec), '-c:a', 'libmp3lame', '-b:a', '64k', f]); return f; }
})();
