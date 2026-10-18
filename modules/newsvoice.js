// News voice, recorded in batches and kept: after every desk batch, each story in the feed gets its
// headline recorded (English + Hindi), and the day's top stories get a full read-out — through
// ElevenLabs only (NEWS_VOICE_PROVIDER=any opens the whole studio chain). Nothing is rendered when a
// reader taps play: the app plays these files, or the phone's own voice if a clip is not ready.
const fs = require('fs'), path = require('path');

const INTRO = { en: 'Here are the top headlines from Brodoit News.', hi: 'ये हैं Brodoit News की बड़ी ख़बरें।' };
const istDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function install(app, deps) {
  const { db, getSetting, mediaDir, STUDIO } = deps;
  const log = (...a) => console.log('[news-voice]', ...a);
  const DIR = path.join(mediaDir, 'news-voice');
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* read-only */ }
  db.exec(`CREATE TABLE IF NOT EXISTS news_voice(story_id TEXT, lang TEXT, part TEXT, provider TEXT, chars INTEGER, day TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(story_id, lang, part))`);
  const q = s => db.prepare(s);
  const state = { running: false, last: null, error: '' };
  const fileOf = (id, lang, part) => path.join(DIR, `${id}-${lang}-${part}.mp3`);
  const fullCap = () => Math.max(0, Math.min(60, parseInt(getSetting('NEWS_VOICE_FULL') || '10') || 0));
  const provider = () => (String(getSetting('NEWS_VOICE_PROVIDER') || 'eleven') === 'any' ? null : 'eleven');

  // Same ranking the app shows (modules/newsdesk.js /api/news/desk).
  const feed = () => q("SELECT * FROM news_stories WHERE created_at > datetime('now','-2 days') ORDER BY (source_count * 3 - (julianday('now') - julianday(published_at)) * 24 / 8) DESC LIMIT 40").all();

  async function speak(text, lang) {
    const out = await STUDIO.speak({ text, lang, role: 'narrator', purpose: 'daily', provider: provider(), getSetting, mp3: true, timeout: 40000, eleven: { format: 'mp3_44100_64', timeout: 35000, chunk: 1500, voice_settings: { stability: 0.5, similarity_boost: 0.8 } } });
    return out && out.buf && out.mime === 'audio/mpeg' ? out : null;
  }
  async function put(id, lang, part, text) {
    const f = fileOf(id, lang, part);
    if (fs.existsSync(f)) return 'have';
    const out = await speak(text, lang);
    if (!out) return null;
    const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, out.buf); fs.renameSync(tmp, f);
    q('INSERT OR REPLACE INTO news_voice(story_id,lang,part,provider,chars,day) VALUES(?,?,?,?,?,?)').run(id, lang, part, out.provider, text.length, istDay());
    return out.provider;
  }

  async function run(reason) {
    if (state.running) return { busy: true };
    if (!STUDIO.available(getSetting).length) return { skipped: 'no voice key' };
    state.running = true; const t0 = Date.now(); let made = 0, failed = 0;
    try {
      for (const lang of ['en', 'hi']) { const f = fileOf('intro', lang, 'h'); if (!fs.existsSync(f)) { const r = await put('intro', lang, 'h', INTRO[lang]); if (r && r !== 'have') made++; } }
      const stories = feed();
      // 1. every headline in the feed (short and cheap)
      for (const s of stories) for (const lang of ['en', 'hi']) {
        const text = lang === 'hi' ? s.headline_hi : s.headline;
        if (!text) continue;
        const r = await put(s.id, lang, 'h', text);
        if (r === null) { failed++; if (failed >= 3) throw new Error('voice provider unavailable or out of credit'); } else if (r !== 'have') made++;
      }
      // 2. full read-outs for the day's top stories, up to NEWS_VOICE_FULL per language per day
      for (const lang of ['en', 'hi']) {
        let used = q("SELECT COUNT(*) n FROM news_voice WHERE part='s' AND lang=? AND day=?").get(lang, istDay()).n;
        for (const s of stories) {
          if (used >= fullCap()) break;
          if (fs.existsSync(fileOf(s.id, lang, 's'))) continue;
          const h = lang === 'hi' ? s.headline_hi : s.headline, sum = lang === 'hi' ? s.summary_hi : s.summary, why = lang === 'hi' ? s.why_hi : s.why;
          if (!h || !sum) continue;
          const text = [h, sum, why ? (lang === 'hi' ? 'क्यों ज़रूरी है: ' : 'Why it matters: ') + why : ''].filter(Boolean).join('. ').replace(/\.\./g, '.');
          const r = await put(s.id, lang, 's', text);
          if (r === null) { failed++; break; }
          if (r !== 'have') { made++; used++; }
        }
      }
      // 3. drop clips of stories the desk has retired
      const live = new Set(q('SELECT id FROM news_stories').all().map(r => r.id)); live.add('intro');
      for (const f of fs.readdirSync(DIR)) { const id = f.replace(/-(en|hi)-[hs]\.mp3$/, ''); if (/\.mp3$/.test(f) && !live.has(id)) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* ignore */ } } }
      q('DELETE FROM news_voice WHERE story_id NOT IN (SELECT id FROM news_stories) AND story_id <> ?').run('intro');
      state.error = '';
    } catch (e) { state.error = e.message; log('batch stopped:', e.message); }
    finally { state.running = false; }
    state.last = { at: new Date().toISOString(), reason, made, failed, ms: Date.now() - t0 };
    if (made || failed) log(JSON.stringify(state.last));
    return state.last;
  }

  const flagStmt = () => q('SELECT lang, part FROM news_voice WHERE story_id=?');
  function flags(id) {
    const out = {};
    for (const r of flagStmt().all(id)) { if (fs.existsSync(fileOf(id, r.lang, r.part))) { out[r.lang] = out[r.lang] || {}; out[r.lang][r.part] = true; } }
    return out;
  }
  app.get('/api/news/voice/:file', (req, res) => {
    const m = /^([A-Za-z0-9_-]{1,80})-(en|hi)-([hs])\.mp3$/.exec(String(req.params.file || ''));
    if (!m) return res.status(404).end();
    const f = fileOf(m[1], m[2], m[3]);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=604800, immutable' });
    res.sendFile(f);
  });
  function stats() {
    const day = istDay();
    const r = q("SELECT COUNT(*) n, COALESCE(SUM(chars),0) c FROM news_voice WHERE day=?").get(day);
    const by = q("SELECT provider, COUNT(*) n FROM news_voice GROUP BY provider").all();
    return { today: { clips: r.n, chars: r.c }, providers: by, last: state.last, running: state.running, error: state.error, fullPerDay: fullCap(), provider: provider() || 'any' };
  }
  global._newsVoice = { flags, stats, run };
  if (deps.schedule !== false) {
    setTimeout(() => run('boot').catch(() => {}), 4 * 60 * 1000);
    setInterval(() => run('schedule').catch(() => {}), 30 * 60 * 1000);
  }
  log('ready · headlines for every story + ' + fullCap() + ' full read-outs a day per language · provider ' + (provider() || 'any'));
  return { run, flags, stats };
}

module.exports = { install };
