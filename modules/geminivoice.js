// Gemini text-to-speech — natural studio voices on the same Google key as Bro's brain, at roughly 1.5 US cents per minute of
// audio. The API returns raw 24 kHz 16-bit mono PCM; we join the chunks and encode one MP3 with ffmpeg (WAV when ffmpeg is
// missing). Voices are prebuilt names (Charon, Iapetus, Puck…); the language is read from the text itself.
'use strict';
const { spawn, spawnSync } = require('child_process');
const GEM = require('./gemini.js');
const MODELS = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];
const VOICES = { narrator: 'Charon', native: 'Iapetus', bro: 'Puck' }; // calm male narrator · clear second voice · warm friend
let FFMPEG = null;
const hasFfmpeg = () => { if (FFMPEG === null) { try { FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0; } catch (e) { FFMPEG = false; } } return FFMPEG; };

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// Async so a long Hindi book chunk never blocks the server's event loop while it encodes.
function mp3(pcm, rate) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1']);
    const out = [], err = []; const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.stdout.on('data', c => out.push(c)); p.stderr.on('data', c => err.push(c));
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); const b = Buffer.concat(out); if (code === 0 && b.length) resolve(b); else reject(new Error('ffmpeg encode failed ' + Buffer.concat(err).toString().slice(0, 160))); });
    p.stdin.on('error', () => {}); p.stdin.end(pcm);
  });
}

const STYLE = {
  narrator: 'Read this aloud in a warm, clear, unhurried voice, like a friendly radio presenter',
  native: 'Say this clearly and naturally, like a native speaker teaching a learner',
  bro: 'Say this like a warm, relaxed friend talking to you',
};

// text → { buf, mime }. opts: role (narrator|native|bro), slow, voice, getSetting, mp3 (true = must be mp3), fetch, timeout
async function speak(key, text, lang, opts) {
  opts = opts || {};
  const role = VOICES[opts.role] ? opts.role : 'narrator';
  const gs = typeof opts.getSetting === 'function' ? opts.getSetting : () => '';
  const voice = opts.voice || gs(role === 'native' ? 'GEMINI_TTS_VOICE_NATIVE' : role === 'bro' ? 'GEMINI_TTS_VOICE_BRO' : 'GEMINI_TTS_VOICE') || VOICES[role];
  const models = [...new Set([gs('GEMINI_TTS_MODEL'), process.env.GEMINI_TTS_MODEL, ...MODELS].filter(Boolean))];
  if (opts.mp3 && !hasFfmpeg()) throw new Error('ffmpeg needed for mp3');
  const style = (STYLE[role] || STYLE.narrator) + (opts.slow ? ', slowly, with a short pause between words' : '') + (lang === 'hi' ? ', in natural spoken Hindi' : '');
  const pcm = []; let rate = 24000;
  for (const c of require('./elevenvoice.js').chunk(text, opts.chunk || 1800)) {
    const { json } = await GEM.generate(key, {
      contents: [{ role: 'user', parts: [{ text: style + ':\n\n' + c }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }, { models, fetch: opts.fetch, timeout: opts.timeout || 90000 });
    const part = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    const inl = (part.find(p => p.inlineData || p.inline_data) || {});
    const d = inl.inlineData || inl.inline_data;
    if (!d || !d.data) throw new Error('Gemini TTS returned no audio');
    const m = /rate=(\d+)/.exec(d.mimeType || d.mime_type || ''); if (m) rate = +m[1];
    pcm.push(Buffer.from(d.data, 'base64'));
  }
  const raw = Buffer.concat(pcm);
  if (hasFfmpeg()) return { buf: await mp3(raw, rate), mime: 'audio/mpeg', secs: raw.length / (rate * 2) };
  return { buf: wav(raw, rate), mime: 'audio/wav', secs: raw.length / (rate * 2) };
}

module.exports = { speak, MODELS, VOICES, hasFfmpeg, wav };
