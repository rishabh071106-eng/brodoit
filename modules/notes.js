// Voice notes (v20): what the Notes recorder (app/voicenote.js) needs from the server.
//  • POST /api/transcribe — the old Notes endpoint (it always answered 401) now is Bro's hearing: it is the same as
//    POST /api/voice/transcribe (raw audio body, ?lang= hint; Groq Whisper through Bro Core, rate-limited there).
//  • POST /api/notes/translate { text, to } → { text } — Bro Core's brain translates a note (English, Hindi, …).
const LANGS = { en: 'English', hi: 'Hindi (in Devanagari script)', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese (Simplified)', ar: 'Arabic', bn: 'Bengali', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', gu: 'Gujarati', pa: 'Punjabi' };

function install(app, deps) {
  const { auth } = deps;
  const core = () => deps.core || global._broCore || null;
  const log = (...a) => console.log('[notes]', ...a);
  // must be registered before modules/voice.js: the request continues to its /api/voice/transcribe route
  app.post('/api/transcribe', (req, res, next) => { const q = req.url.indexOf('?'); req.url = '/api/voice/transcribe' + (q >= 0 ? req.url.slice(q) : ''); next(); });

  const hits = new Map();
  const limited = who => { const now = Date.now(), h = (hits.get(who) || []).filter(t => t > now - 60e3); if (h.length >= 20) return true; h.push(now); hits.set(who, h); return false; };
  app.post('/api/notes/translate', auth, async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 8000) : '';
    const to = typeof b.to === 'string' && LANGS[b.to] ? b.to : '';
    if (!text) return res.status(400).json({ error: 'text required' });
    if (!to) return res.status(400).json({ error: 'to: ' + Object.keys(LANGS).join(', ') });
    const who = String((req.user && (req.user.phone || req.user.id)) || req.ip || '');
    if (limited(who)) return res.status(429).json({ error: 'slow down' });
    const B = core();
    if (!B || typeof B.chat !== 'function' || !(B.brainReady ? B.brainReady() : true)) return res.status(503).json({ error: 'Bro is waking up, try again in a moment' });
    try {
      const r = await B.chat({ purpose: 'notes', maxTokens: Math.min(4000, 200 + Math.ceil(text.length / 2)), messages: [
        { role: 'system', content: `You translate the user's note into ${LANGS[to]}. Keep its meaning, tone, names, numbers and line breaks. Output only the translation: no quotes, no notes, no explanation.` },
        { role: 'user', content: text },
      ] });
      const out = String((r && r.text) || '').trim();
      if (!out) return res.status(502).json({ error: 'no translation' });
      res.json({ text: out, to });
    } catch (e) { log('translate failed:', String(e && e.message).slice(0, 160)); res.status(502).json({ error: 'translation failed' }); }
  });
  return { LANGS };
}

module.exports = { install, LANGS };
