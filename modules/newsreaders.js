// v28: readers write for Brodoit News. A signed-in reader sends a news tip (something they saw or know), a thought, or
// a short story. Brodoit's AI editor reads every one before anyone else does:
//   - it publishes what is safe and worth reading: only light edits (spelling, grammar, clarity), the reader's own
//     meaning and voice kept, a Hindi version added, a section picked;
//   - it declines the rest with a short reason the reader sees: hate, harassment, threats, sexual content, self-harm,
//     illegal acts, spam or ads, personal details (phone numbers, addresses, ID numbers), accusations against a named
//     private person, risky medical or money advice, plain misinformation, text copied from somewhere else, gibberish.
// Nothing is published without that review: with no AI writer available a piece waits. A published piece is labelled
// as a reader's (their first name, "not checked by Brodoit" on news tips), gets a free photo (the News Desk's finder,
// credited), and two reports from different people hide it at once. A reader can delete their own piece any time.
//   POST   /api/news/submit {kind: news|thought|story, title, text, link?, lang?, show_name, own: true}  (sign-in)
//   GET    /api/news/submit/mine      → { items: [{ id, kind, title, status, reason, created_at }] }  (sign-in)
//   DELETE /api/news/submit/:id       (their own)
//   GET    /api/news/readers?before=  → { items: [published…], next }
//   POST   /api/news/readers/:id/report
'use strict';
const crypto = require('crypto');
const GEM = require('./gemini.js');

const KINDS = { news: 'News tip', thought: 'Thought', story: 'Story' };
const CATS = ['india', 'world', 'ai', 'business', 'tech', 'science', 'life'];
const DAY_MAX = +(process.env.NEWS_SUBMIT_PER_DAY || 3);
const clean = t => String(t || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const deva = t => (String(t || '').match(/[ऀ-ॿ]/g) || []).length;
const letters = t => (String(t || '').match(/[A-Za-zऀ-ॿ]/g) || []).length;
const isHindi = t => { const n = letters(t); return n > 0 && deva(t) / n >= 0.6; };
const wc = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
// contact details a reader must not publish (theirs or anyone's)
const PHONE = /(\+?\d[\d\s-]{8,}\d)/, EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, AADHAAR = /\b\d{4}\s?\d{4}\s?\d{4}\b/;
const firstName = n => String(n || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 24);

const SYS = 'You are the reader-submissions editor of Brodoit News, an Indian news app. A reader sent the piece below. Decide whether to publish it and prepare it. ' +
  'REJECT (decision "reject", with a short, kind reason addressed to the reader, in English) if it has: hate or contempt for any group; harassment, insults or bullying; threats or praise of violence; sexual content; self-harm encouragement; help with illegal acts; spam, ads, promotions or requests for money; ' +
  'personal details (phone numbers, addresses, emails, ID numbers); accusations of crimes or wrongdoing against a named private person; medical, legal or money advice that could hurt someone; claims that are plainly false or conspiracy theories; election campaigning; text that reads as copied from a newspaper, book or website; gibberish or nothing worth reading. ' +
  'Otherwise PUBLISH (decision "publish"): fix spelling, grammar and clarity only; keep the reader\'s meaning, facts, voice and first person; never add facts, names, numbers or opinions; keep it 40-250 words. ' +
  'For a news tip, keep it as what the reader saw or knows (it is labelled "from a reader, not checked by Brodoit"). ' +
  'Return strict JSON with keys: decision, reason, category (one of india, world, ai, business, tech, science, life), title (English, 4-12 words, sentence case, no full stop), text (English), ' +
  'title_hi, text_hi (natural Hindi in Devanagari, the same meaning), image_query (2-4 English words naming a scene, place or object a free photo could show; never a person).';

function create(o) {
  const { db, app, auth } = o;
  const getSetting = o.getSetting || (k => process.env[k] || '');
  const log = (...a) => console.log('[readers]', ...a);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS news_submissions(id TEXT PRIMARY KEY, user_phone TEXT NOT NULL, name TEXT DEFAULT '', show_name INTEGER DEFAULT 1, kind TEXT, title TEXT, text TEXT, link TEXT DEFAULT '', lang TEXT DEFAULT 'en',
      status TEXT DEFAULT 'pending', reason TEXT DEFAULT '', category TEXT DEFAULT '', pub_title TEXT DEFAULT '', pub_text TEXT DEFAULT '', pub_title_hi TEXT DEFAULT '', pub_text_hi TEXT DEFAULT '',
      image_query TEXT DEFAULT '', image_credit TEXT DEFAULT '', reviewer TEXT DEFAULT '', tries INTEGER DEFAULT 0, reports TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), decided_at TEXT, published_at TEXT)`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_news_sub_user ON news_submissions(user_phone, created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_news_sub_status ON news_submissions(status, published_at)');
  } catch (e) { log('schema', e.message); }
  const q = s => db.prepare(s);

  async function write(text) {
    const g = getSetting('GEMINI_API_KEY');
    if (g && !((global._geminiDownUntil || 0) > Date.now())) {
      try {
        const { json: j } = await GEM.generate(g, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, { tier: 'flash', getSetting, timeout: 40000 });
        return [JSON.parse(GEM.textOf(j)), 'gemini'];
      } catch (e) { log('gemini:', String(e.message || e).slice(0, 100)); }
    }
    const BC = global._broCore;
    if (BC && BC.brainReady && BC.brainReady()) {
      try {
        const r = await BC.chat({ system: SYS, messages: [{ role: 'user', content: text }], json: true, maxTokens: 2500, temperature: 0.2, purpose: 'news', effort: 'low', emergency: false });
        const m = String(r && r.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
        if (m) return [JSON.parse(m[0]), 'brocore'];
      } catch (e) { log('brocore:', String(e.message || e).slice(0, 100)); }
    }
    const B = global._elevenBrain;
    if (BC && BC.emergencyOn && BC.emergencyOn() && B && B.available && B.available()) {
      try { const out = await B.ask({ system: SYS + ' Reply with the JSON object only.', messages: [{ role: 'user', content: text }], timeout: 40000 }); const m = String(out).match(/\{[\s\S]*\}/); if (m) return [JSON.parse(m[0]), 'elevenlabs']; } catch (e) { log('elevenlabs:', String(e.message || e).slice(0, 100)); }
    }
    return [null, ''];
  }
  // the editor's answer must be complete and clean before anything is published
  function checkOut(out) {
    const bad = [];
    if (!out || typeof out !== 'object' || !/^(publish|reject)$/.test(String(out.decision || ''))) return ['no decision'];
    if (out.decision === 'reject') return String(out.reason || '').trim() ? [] : ['a rejection needs a reason'];
    const t = clean(out.title), x = clean(out.text);
    if (wc(t) < 3 || wc(t) > 14) bad.push('title must be 4-12 words');
    if (wc(x) < 25 || wc(x) > 300) bad.push('text must be 40-250 words');
    if (/[ऀ-ॿ]/.test(t + x)) bad.push('English fields must have no Devanagari');
    if (!isHindi(out.title_hi) || !isHindi(out.text_hi)) bad.push('title_hi and text_hi must be Hindi in Devanagari');
    if (PHONE.test(x) || EMAIL.test(x) || AADHAAR.test(x)) bad.push('no personal details');
    return bad;
  }
  const state = { running: false, at: null, reviewed: 0, error: '' };
  async function review(limit) {
    if (state.running) return state;
    state.running = true;
    try {
      const rows = q("SELECT * FROM news_submissions WHERE status='pending' ORDER BY created_at LIMIT ?").all(limit || 5);
      for (const r of rows) {
        const text = 'KIND: ' + (KINDS[r.kind] || r.kind) + '\nLANGUAGE THE READER WROTE IN: ' + (r.lang === 'hi' ? 'Hindi' : 'English') + '\nTITLE: ' + r.title + '\nTEXT:\n' + r.text + (r.link ? '\nLINK THE READER GAVE: ' + r.link : '');
        let [out, by] = await write(text), bad = checkOut(out);
        if (bad.length && out && out.decision === 'publish') { const [fixed, by2] = await write(text + '\n\nYOUR DRAFT:\n' + JSON.stringify(out) + '\n\nProblems: ' + bad.join('; ') + '. Fix every one and return the corrected JSON.'); if (fixed && checkOut(fixed).length < bad.length) { out = fixed; by = by2; bad = checkOut(out); } }
        if (!out) { q('UPDATE news_submissions SET tries=tries+1 WHERE id=?').run(r.id); state.error = 'no AI editor available'; break; } // waits for the next round
        if (out.decision === 'reject' && !bad.length) {
          q("UPDATE news_submissions SET status='rejected', reason=?, reviewer=?, decided_at=datetime('now') WHERE id=?").run(clean(out.reason).slice(0, 240), by, r.id);
        } else if (out.decision === 'publish' && !bad.length) {
          const cat = CATS.includes(out.category) ? out.category : 'life';
          q("UPDATE news_submissions SET status='published', reason='', category=?, pub_title=?, pub_text=?, pub_title_hi=?, pub_text_hi=?, image_query=?, reviewer=?, decided_at=datetime('now'), published_at=datetime('now') WHERE id=?")
            .run(cat, clean(out.title).slice(0, 140), clean(out.text).slice(0, 2400), clean(out.title_hi).slice(0, 200), clean(out.text_hi).slice(0, 3200), clean(out.image_query).slice(0, 60), by, r.id);
          await photo(r.id);
        } else {
          q("UPDATE news_submissions SET tries=tries+1 WHERE id=?").run(r.id);
          if (r.tries >= 2) q("UPDATE news_submissions SET status='rejected', reason=?, reviewer=?, decided_at=datetime('now') WHERE id=?").run('Our editor could not prepare this piece. Please try writing it again in your own words.', by, r.id);
        }
        state.reviewed++;
      }
    } catch (e) { state.error = e.message; log('review', e.message); }
    finally { state.running = false; state.at = new Date().toISOString(); }
    return state;
  }
  async function photo(id) {
    const P = global._newsPhotos; if (!P) return false;
    const r = q('SELECT * FROM news_submissions WHERE id=?').get(id); if (!r || r.status !== 'published') return false;
    const cr = await P.into('rd_' + id, r.image_query, r.pub_title, r.category === 'life' ? 'life' : r.category);
    if (cr && cr !== 'have') { delete cr._url; q('UPDATE news_submissions SET image_credit=? WHERE id=?').run(JSON.stringify(cr), id); }
    return !!cr;
  }
  const pubR = r => {
    const P = global._newsPhotos; let cr = null; try { cr = JSON.parse(r.image_credit || 'null'); } catch (e) { cr = null; }
    const has = P && P.file('rd_' + r.id);
    return { id: 'rd_' + r.id, reader: true, kind: r.kind, category: r.category || 'life', headline: r.pub_title, summary: r.pub_text, headline_hi: r.pub_title_hi, summary_hi: r.pub_text_hi, why: '', why_hi: '',
      name: r.show_name ? firstName(r.name) : '', sources: r.link && /^https?:\/\//.test(r.link) ? [{ name: (() => { try { return new URL(r.link).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; } })(), link: r.link, title: 'The link the reader shared' }] : [],
      image: has ? P.url('rd_' + r.id) : null, image_credit: has && cr && cr.license ? cr : null, published_at: r.published_at ? r.published_at.replace(' ', 'T') + 'Z' : null };
  };
  const reportHash = (req) => crypto.createHash('sha1').update(String((req.user && req.user.phone) || String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim())).digest('hex').slice(0, 10);

  if (app && auth) {
    app.post('/api/news/submit', auth, (req, res) => {
      const b = req.body || {};
      const kind = KINDS[b.kind] ? b.kind : '';
      const title = clean(b.title).slice(0, 140), text = clean(b.text).slice(0, 3000), link = clean(b.link).slice(0, 400);
      const lang = b.lang === 'hi' ? 'hi' : 'en';
      if (!kind) return res.status(400).json({ error: 'Pick what you are sending: a news tip, a thought or a story.' });
      if (b.own !== true) return res.status(400).json({ error: 'Please confirm this is your own writing.' });
      if (title.length < 6) return res.status(400).json({ error: 'Add a short title.' });
      if (wc(text) < 25) return res.status(400).json({ error: 'Write a little more: at least 25 words.' });
      if (link && !/^https?:\/\/[^\s]+$/.test(link)) return res.status(400).json({ error: 'The link should start with https://' });
      if (PHONE.test(title + ' ' + text) || EMAIL.test(title + ' ' + text) || AADHAAR.test(title + ' ' + text)) return res.status(400).json({ error: 'Please remove phone numbers, email addresses and ID numbers. Brodoit never publishes anyone\'s contact details.' });
      const today = q("SELECT COUNT(*) n FROM news_submissions WHERE user_phone=? AND created_at > datetime('now','-1 day')").get(req.user.phone).n;
      if (today >= DAY_MAX) return res.status(429).json({ error: 'You can send ' + DAY_MAX + ' pieces a day. Thank you for writing so much! Try again tomorrow.' });
      const id = crypto.randomBytes(6).toString('hex');
      q('INSERT INTO news_submissions(id, user_phone, name, show_name, kind, title, text, link, lang) VALUES(?,?,?,?,?,?,?,?,?)').run(id, req.user.phone, String(req.user.name || ''), b.show_name === false ? 0 : 1, kind, title, text, link, lang);
      setTimeout(() => review(3).catch(() => {}), o.reviewDelayMs != null ? o.reviewDelayMs : 2000);
      res.json({ ok: true, id, status: 'pending' });
    });
    app.get('/api/news/submit/mine', auth, (req, res) => {
      res.set('Cache-Control', 'no-store');
      const rows = q("SELECT id, kind, title, status, reason, created_at, published_at FROM news_submissions WHERE user_phone=? AND status != 'deleted' ORDER BY created_at DESC LIMIT 30").all(req.user.phone);
      res.json({ items: rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, status: r.status === 'hidden' ? 'published' : r.status, reason: r.reason, created_at: r.created_at })) });
    });
    app.delete('/api/news/submit/:id', auth, (req, res) => {
      const n = q("UPDATE news_submissions SET status='deleted' WHERE id=? AND user_phone=?").run(String(req.params.id || ''), req.user.phone).changes;
      if (n) { try { const P = global._newsPhotos; const f = P && P.file('rd_' + req.params.id); if (f) require('fs').unlinkSync(f); } catch (e) { /* ignore */ } }
      res.json({ ok: !!n });
    });
  }
  if (app) {
    app.get('/api/news/readers', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      const lim = Math.max(1, Math.min(40, parseInt(req.query.limit) || 20));
      const before = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/.test(String(req.query.before || '')) ? String(req.query.before).replace('T', ' ').slice(0, 19) : '';
      const hi = String(req.query.lang || '') === 'hi';
      const rows = q("SELECT * FROM news_submissions WHERE status='published'" + (hi ? " AND pub_title_hi != '' AND pub_text_hi != ''" : '') + (before ? ' AND published_at < ?' : '') + ' ORDER BY published_at DESC LIMIT ?').all(...(before ? [before, lim] : [lim]));
      const last = rows[rows.length - 1];
      res.json({ items: rows.map(pubR), next: rows.length === lim && last ? last.published_at : null });
    });
    const hits = new Map();
    app.post('/api/news/readers/:id/report', (req, res) => {
      const id = String(req.params.id || '').replace(/^rd_/, '');
      const who = reportHash(req), now = Date.now(), h = hits.get(who) || [];
      const recent = h.filter(t => now - t < 3600e3); if (recent.length >= 10) return res.status(429).json({ error: 'slow down' });
      recent.push(now); hits.set(who, recent); if (hits.size > 5000) hits.clear();
      const r = q("SELECT reports, status FROM news_submissions WHERE id=?").get(id);
      if (!r || r.status !== 'published') return res.json({ ok: true });
      const set = new Set(String(r.reports || '').split(',').filter(Boolean)); set.add(who);
      q('UPDATE news_submissions SET reports=? WHERE id=?').run([...set].join(','), id);
      if (set.size >= 2) { q("UPDATE news_submissions SET status='hidden', reason='Hidden after readers reported it' WHERE id=?").run(id); log('hidden after reports', id); }
      res.json({ ok: true, hidden: set.size >= 2 });
    });
  }
  if (o.schedule !== false && process.env.NEWS_READERS !== '0') {
    const t1 = setInterval(() => { review(5).catch(() => {}); try { for (const r of q("SELECT id FROM news_submissions WHERE status='published' AND (image_credit IS NULL OR image_credit='') ORDER BY published_at DESC LIMIT 3").all()) photo(r.id).catch(() => {}); } catch (e) { /* ignore */ } }, 5 * 60e3);
    if (t1.unref) t1.unref();
  }
  global._newsReadersStatus = () => Object.assign({ pending: q("SELECT COUNT(*) n FROM news_submissions WHERE status='pending'").get().n }, state);
  return { review, photo, state, checkOut };
}

module.exports = { create, KINDS };
