// Brodoit Speaker & Teaching Agent — helps the user land college talks, guest lectures, workshops,
// panels and part-time / visiting faculty roles in India. Keeps a speaker profile, a pipeline of
// opportunities, scans Google News RSS for openings scored against the profile, and asks Gemini to
// write applications / proposals / course outlines / follow-ups in the user's voice.
'use strict';

const KINDS = ['talk', 'guest-lecture', 'teaching', 'workshop', 'panel', 'judge', 'mentoring'];
const MODES = ['in-person', 'online', 'hybrid'];
const STATUSES = ['interested', 'applied', 'shortlisted', 'confirmed', 'delivered', 'declined'];
const DRAFT_TYPES = ['application', 'proposal', 'outline', 'followup'];
const CACHE_MS = 30 * 60 * 1000;

// Small synonym map so "ML" in a headline still matches a profile topic of "machine learning".
const SYN = {
  ai: ['artificial intelligence', 'machine learning', 'ml', 'deep learning', 'genai', 'generative ai', 'llm', 'chatgpt'],
  'machine learning': ['ai', 'ml', 'deep learning', 'data science'],
  'data science': ['analytics', 'data', 'machine learning', 'statistics'],
  'web development': ['web dev', 'frontend', 'full stack', 'javascript', 'react'],
  cybersecurity: ['cyber security', 'security', 'infosec', 'ethical hacking'],
  entrepreneurship: ['startup', 'startups', 'founder', 'business', 'incubation'],
  finance: ['fintech', 'investing', 'stock market', 'banking', 'economics'],
  marketing: ['digital marketing', 'branding', 'growth', 'social media'],
  'product management': ['product', 'pm', 'product design'],
  'cloud computing': ['cloud', 'aws', 'azure', 'devops'],
  blockchain: ['web3', 'crypto', 'cryptocurrency'],
  'public speaking': ['communication', 'soft skills', 'leadership'],
  mathematics: ['maths', 'math', 'statistics'],
  physics: ['science', 'engineering'],
  'computer science': ['cs', 'programming', 'coding', 'software', 'engineering'],
  design: ['ux', 'ui', 'user experience', 'graphic design'],
  bengaluru: ['bangalore'], bangalore: ['bengaluru'],
  mumbai: ['bombay'], bombay: ['mumbai'],
  delhi: ['new delhi', 'ncr', 'noida', 'gurgaon', 'gurugram'],
  chennai: ['madras'], kolkata: ['calcutta'],
  pune: ['pimpri'], hyderabad: ['secunderabad'],
};
// Words that make a headline look like an actual opportunity rather than generic news.
const OPP_WORDS = ['guest lecture', 'visiting faculty', 'adjunct', 'call for speakers', 'call for papers', 'invites', 'invited',
  'speaker', 'speakers', 'workshop', 'webinar', 'seminar', 'conference', 'summit', 'symposium', 'panel', 'keynote', 'faculty',
  'lecture', 'masterclass', 'bootcamp', 'hackathon', 'judge', 'mentor', 'fdp', 'professor of practice', 'recruitment', 'hiring',
  'applications open', 'apply', 'college', 'university', 'institute', 'iit', 'iim', 'nit', 'campus', 'students'];

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const str = (v, max) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const strList = (v, max, n) => Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n)
  : typeof v === 'string' ? v.split(/[,\n]/).map(x => str(x, max)).filter(Boolean).slice(0, n) : [];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const safeUrl = u => { u = str(u, 800); return /^https?:\/\//i.test(u) ? u : ''; };
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9+#\s-]/g, ' ').replace(/\s+/g, ' ').trim();

function cleanProfile(b) {
  b = b && typeof b === 'object' ? b : {};
  return {
    name: str(b.name, 80), headline: str(b.headline, 140), bio: str(b.bio, 1200),
    topics: strList(b.topics, 40, 12), subjects: strList(b.subjects, 40, 12), cities: strList(b.cities, 40, 8),
    online: !!b.online, hoursPerWeek: Math.max(0, Math.min(60, parseInt(b.hoursPerWeek, 10) || 0)),
    resume: str(b.resume, 4000),
  };
}

function expand(terms) {
  const out = new Set();
  for (const t of terms) {
    const k = words(t); if (!k) continue;
    out.add(k);
    for (const s of SYN[k] || []) out.add(s);
    for (const w of k.split(' ')) if (w.length > 3) out.add(w);
  }
  return [...out];
}

// 0–100 keyword fit of an item against the profile. Opportunity words are worth a little on their
// own, each topic/subject match a lot, cities/online a bit; capped at 100.
function fitScore(text, prof) {
  const t = ' ' + words(text) + ' ';
  const has = k => t.includes(' ' + k + ' ') || (k.length > 5 && t.includes(k));
  let s = 0;
  let opp = 0; for (const w of OPP_WORDS) if (has(w)) opp++;
  s += Math.min(30, opp * 10);
  const tops = expand(prof.topics || []), subs = expand(prof.subjects || []), cities = expand(prof.cities || []);
  let hit = 0; for (const k of tops) if (has(k)) hit++;
  s += Math.min(40, hit * 20);
  hit = 0; for (const k of subs) if (has(k)) hit++;
  s += Math.min(20, hit * 12);
  hit = 0; for (const k of cities) if (has(k)) hit++;
  if (hit) s += 10; else if (prof.online && /\b(online|virtual|webinar|remote)\b/.test(t)) s += 8;
  if (/\bindia\b|\bindian\b/.test(t)) s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function guessKind(text) {
  const t = words(text);
  if (/visiting faculty|adjunct|professor of practice|faculty recruit|teaching position|lecturer/.test(t)) return 'teaching';
  if (/guest lecture/.test(t)) return 'guest-lecture';
  if (/workshop|bootcamp|masterclass|fdp/.test(t)) return 'workshop';
  if (/panel/.test(t)) return 'panel';
  if (/judge|jury|hackathon/.test(t)) return 'judge';
  if (/mentor/.test(t)) return 'mentoring';
  return 'talk';
}

function buildQueries(prof, q) {
  const yr = new Date().getFullYear(), ny = yr + 1;
  const list = [];
  if (q) list.push(q);
  list.push('guest lecture invitation college India');
  list.push(`call for speakers ${ny} India conference`);
  const t0 = (prof.topics || [])[0] || (prof.subjects || [])[0] || 'AI';
  list.push(`visiting faculty adjunct ${t0}`);
  list.push(`${t0} workshop college students India`);
  const t1 = (prof.topics || [])[1] || (prof.subjects || [])[1];
  if (t1 && list.length < 6) list.push(`${t1} speaker webinar invite`);
  if (list.length < 6) list.push(`professor of practice recruitment ${yr}`);
  return list.slice(0, 6);
}

function install(app, deps) {
  const { db, auth, callGemini, genId, fetchFeed, createTask } = deps;
  if (!db || !auth) throw new Error('speaker.install: db and auth are required');

  db.exec(`CREATE TABLE IF NOT EXISTS speaker_profile(user_phone TEXT PRIMARY KEY,data TEXT NOT NULL DEFAULT '{}',updated_at TEXT DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS speaker_events(id TEXT PRIMARY KEY,user_phone TEXT NOT NULL,title TEXT NOT NULL,org TEXT DEFAULT '',kind TEXT DEFAULT 'talk',mode TEXT DEFAULT 'in-person',location TEXT DEFAULT '',event_date TEXT DEFAULT '',deadline TEXT DEFAULT '',url TEXT DEFAULT '',contact TEXT DEFAULT '',source TEXT DEFAULT 'manual',status TEXT DEFAULT 'interested',notes TEXT DEFAULT '',draft TEXT DEFAULT '',fit INTEGER DEFAULT 0,created_at TEXT DEFAULT(datetime('now')),updated_at TEXT DEFAULT(datetime('now')));
    CREATE INDEX IF NOT EXISTS idx_speaker_events_user ON speaker_events(user_phone,status)`);

  const Q = {
    getProf: db.prepare('SELECT data,updated_at FROM speaker_profile WHERE user_phone=?'),
    putProf: db.prepare('INSERT INTO speaker_profile(user_phone,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_phone) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at'),
    list: db.prepare("SELECT * FROM speaker_events WHERE user_phone=? ORDER BY CASE WHEN deadline='' THEN 1 ELSE 0 END,deadline,created_at DESC"),
    get: db.prepare('SELECT * FROM speaker_events WHERE id=? AND user_phone=?'),
    ins: db.prepare('INSERT INTO speaker_events(id,user_phone,title,org,kind,mode,location,event_date,deadline,url,contact,source,status,notes,draft,fit,created_at,updated_at) VALUES(@id,@user_phone,@title,@org,@kind,@mode,@location,@event_date,@deadline,@url,@contact,@source,@status,@notes,@draft,@fit,@created_at,@updated_at)'),
    upd: db.prepare('UPDATE speaker_events SET title=@title,org=@org,kind=@kind,mode=@mode,location=@location,event_date=@event_date,deadline=@deadline,url=@url,contact=@contact,source=@source,status=@status,notes=@notes,draft=@draft,fit=@fit,updated_at=@updated_at WHERE id=@id AND user_phone=@user_phone'),
    del: db.prepare('DELETE FROM speaker_events WHERE id=? AND user_phone=?'),
    count: db.prepare('SELECT status,COUNT(*) n FROM speaker_events WHERE user_phone=? GROUP BY status'),
    next: db.prepare("SELECT title,event_date FROM speaker_events WHERE user_phone=? AND status IN ('confirmed','shortlisted') AND event_date>=date('now') ORDER BY event_date LIMIT 1"),
  };

  const loadProfile = phone => {
    const r = Q.getProf.get(phone);
    let d = {}; try { d = r ? JSON.parse(r.data) : {}; } catch (e) { d = {}; }
    return { ...cleanProfile(d), updated_at: r ? r.updated_at : null };
  };
  const newId = () => (typeof genId === 'function' ? genId() : 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const bad = (res, code, msg) => res.status(code).json({ error: msg });

  // Build a clean event row from a request body, merging over `base` (an existing row or defaults).
  function eventFrom(body, base, phone) {
    body = body && typeof body === 'object' ? body : {};
    const pick = (k, max) => (k in body ? str(body[k], max) : base[k] || '');
    const title = pick('title', 200);
    if (!title) return { error: 'title is required' };
    const kind = pick('kind', 20).toLowerCase(), mode = pick('mode', 20).toLowerCase(), status = pick('status', 20).toLowerCase();
    if (kind && !KINDS.includes(kind)) return { error: 'kind must be one of ' + KINDS.join(', ') };
    if (mode && !MODES.includes(mode)) return { error: 'mode must be one of ' + MODES.join(', ') };
    if (status && !STATUSES.includes(status)) return { error: 'status must be one of ' + STATUSES.join(', ') };
    const event_date = pick('event_date', 10), deadline = pick('deadline', 10);
    if (event_date && !isDate(event_date)) return { error: 'event_date must be YYYY-MM-DD' };
    if (deadline && !isDate(deadline)) return { error: 'deadline must be YYYY-MM-DD' };
    let fit = 'fit' in body ? parseInt(body.fit, 10) : base.fit;
    fit = isNaN(fit) ? 0 : Math.max(0, Math.min(100, fit));
    return {
      id: base.id, user_phone: phone, title, org: pick('org', 160), kind: kind || 'talk', mode: mode || 'in-person',
      location: pick('location', 120), event_date, deadline, url: 'url' in body ? safeUrl(body.url) : base.url || '',
      contact: pick('contact', 200), source: pick('source', 60) || 'manual', status: status || 'interested',
      notes: pick('notes', 2000), draft: pick('draft', 6000), fit, created_at: base.created_at || now(), updated_at: now(),
    };
  }

  // ── Profile ──────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/speaker/profile', auth, (req, res) => {
    try { res.json(loadProfile(req.user.phone)); } catch (e) { bad(res, 500, 'profile read failed'); }
  });
  app.put('/api/speaker/profile', auth, (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return bad(res, 400, 'JSON object body required');
      const p = cleanProfile(req.body);
      if (!p.name) p.name = str(req.user.name, 80);
      Q.putProf.run(req.user.phone, JSON.stringify(p), now());
      discoverCache.delete(req.user.phone); // profile changed → fit scores change
      res.json({ ok: true, ...p, updated_at: now() });
    } catch (e) { bad(res, 500, 'profile save failed'); }
  });

  // ── Events / pipeline ───────────────────────────────────────────────────────────────────────────
  app.get('/api/speaker/events', auth, (req, res) => {
    try {
      let rows = Q.list.all(req.user.phone);
      const st = str(req.query.status, 20).toLowerCase();
      if (st && STATUSES.includes(st)) rows = rows.filter(r => r.status === st);
      res.json({ events: rows, summary: summaryFor(req.user.phone) });
    } catch (e) { bad(res, 500, 'events read failed'); }
  });
  app.post('/api/speaker/events', auth, (req, res) => {
    try {
      const ev = eventFrom(req.body, { id: newId() }, req.user.phone);
      if (ev.error) return bad(res, 400, ev.error);
      // Fit falls back to the profile score when the caller did not send one.
      if (!ev.fit) ev.fit = fitScore(ev.title + ' ' + ev.org + ' ' + ev.notes + ' ' + ev.location, loadProfile(req.user.phone));
      Q.ins.run(ev);
      res.status(201).json(Q.get.get(ev.id, req.user.phone));
    } catch (e) { bad(res, 500, 'event create failed'); }
  });
  app.put('/api/speaker/events/:id', auth, (req, res) => {
    try {
      const cur = Q.get.get(str(req.params.id, 80), req.user.phone);
      if (!cur) return bad(res, 404, 'event not found');
      const ev = eventFrom(req.body, cur, req.user.phone);
      if (ev.error) return bad(res, 400, ev.error);
      Q.upd.run(ev);
      res.json(Q.get.get(cur.id, req.user.phone));
    } catch (e) { bad(res, 500, 'event update failed'); }
  });
  app.delete('/api/speaker/events/:id', auth, (req, res) => {
    try {
      const r = Q.del.run(str(req.params.id, 80), req.user.phone);
      if (!r.changes) return bad(res, 404, 'event not found');
      res.json({ ok: true });
    } catch (e) { bad(res, 500, 'event delete failed'); }
  });
  app.post('/api/speaker/events/:id/task', auth, async (req, res) => {
    try {
      const ev = Q.get.get(str(req.params.id, 80), req.user.phone);
      if (!ev) return bad(res, 404, 'event not found');
      if (typeof createTask !== 'function') return bad(res, 501, 'tasks not available');
      const due = ev.deadline || ev.event_date || '';
      const notes = [ev.org && 'Org: ' + ev.org, ev.kind && 'Kind: ' + ev.kind, ev.url && ev.url, ev.contact && 'Contact: ' + ev.contact, 'From Brodoit Speaker agent']
        .filter(Boolean).join('\n');
      const t = await createTask({ phone: req.user.phone, title: 'Apply: ' + ev.title, due_date: due, notes });
      res.json({ ok: true, task: t || null, due_date: due });
    } catch (e) { bad(res, 500, 'task create failed'); }
  });

  // ── Discover (Google News RSS) ─────────────────────────────────────────────────────────────────
  const discoverCache = new Map(); // phone → {key, at, items}
  const gnews = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

  app.get('/api/speaker/discover', auth, async (req, res) => {
    try {
      if (typeof fetchFeed !== 'function') return bad(res, 501, 'feed fetcher not available');
      const q = str(req.query.q, 120);
      const force = req.query.refresh === '1';
      const prof = loadProfile(req.user.phone);
      const queries = buildQueries(prof, q);
      const key = queries.join('|');
      const c = discoverCache.get(req.user.phone);
      if (!force && c && c.key === key && Date.now() - c.at < CACHE_MS) return res.json({ items: c.items, queries, cached: true, cached_at: c.at });

      const lists = await Promise.all(queries.map(u => Promise.resolve().then(() => fetchFeed(gnews(u))).catch(() => [])));
      const seen = new Set(); const items = [];
      lists.forEach((list, qi) => {
        for (const it of Array.isArray(list) ? list : []) {
          const title = str(it && it.title, 240); if (!title) continue;
          const k = words(title).replace(/\s-\s[^-]+$/, '').slice(0, 80);
          if (seen.has(k)) continue; seen.add(k);
          const desc = str(it.desc || it.description, 400);
          const text = title + ' ' + desc;
          let d = ''; try { if (it.date) { const dd = new Date(it.date); if (!isNaN(dd)) d = dd.toISOString().slice(0, 10); } } catch (e) {}
          // Google News titles end with " - Source".
          const m = title.match(/\s-\s([^-]{2,60})$/);
          items.push({
            id: 'd_' + Buffer.from(k).toString('base64url').slice(0, 24),
            title: m ? title.slice(0, m.index) : title, org: str(it.source || (m && m[1]), 80), desc, url: safeUrl(it.link),
            date: d, kind: guessKind(text), fit: fitScore(text, prof), query: queries[qi], source: 'google-news',
          });
        }
      });
      items.sort((a, b) => b.fit - a.fit || (b.date || '').localeCompare(a.date || ''));
      const top = items.slice(0, 30);
      discoverCache.set(req.user.phone, { key, at: Date.now(), items: top });
      res.json({ items: top, queries, cached: false, cached_at: Date.now() });
    } catch (e) { bad(res, 500, 'discover failed'); }
  });

  // ── Drafts (Gemini) ────────────────────────────────────────────────────────────────────────────
  app.post('/api/speaker/draft', auth, async (req, res) => {
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const type = str(b.type, 20).toLowerCase();
      if (!DRAFT_TYPES.includes(type)) return bad(res, 400, 'type must be one of ' + DRAFT_TYPES.join(', '));
      if (typeof callGemini !== 'function') return bad(res, 501, 'AI not available');
      let ev = null;
      if (b.id) { ev = Q.get.get(str(b.id, 80), req.user.phone); if (!ev) return bad(res, 404, 'event not found'); }
      const ctx = str(b.context, 1500);
      if (!ev && !ctx) return bad(res, 400, 'id or context is required');
      const prof = loadProfile(req.user.phone);
      const me = prof.name || req.user.name || 'the user';
      const profTxt = [
        `Name: ${me}`, prof.headline && `Headline: ${prof.headline}`, prof.bio && `Bio: ${prof.bio}`,
        prof.topics.length && `Talk topics: ${prof.topics.join(', ')}`, prof.subjects.length && `Can teach: ${prof.subjects.join(', ')}`,
        prof.cities.length && `Cities: ${prof.cities.join(', ')}`, `Online sessions: ${prof.online ? 'yes' : 'prefer in-person'}`,
        prof.hoursPerWeek && `Available: ~${prof.hoursPerWeek} hrs/week`, prof.resume && `Resume notes: ${prof.resume.slice(0, 1500)}`,
      ].filter(Boolean).join('\n');
      const evTxt = ev ? [
        `Opportunity: ${ev.title}`, ev.org && `Organisation: ${ev.org}`, `Kind: ${ev.kind} (${ev.mode})`, ev.location && `Location: ${ev.location}`,
        ev.event_date && `Event date: ${ev.event_date}`, ev.deadline && `Deadline: ${ev.deadline}`, ev.contact && `Contact: ${ev.contact}`, ev.notes && `Notes: ${ev.notes}`,
      ].filter(Boolean).join('\n') : '';
      const ask = {
        application: 'Write a short, warm, specific email (max 220 words) applying for / pitching this opportunity. Subject line first ("Subject: ..."). Open with one line on why this college/org, two or three lines on what I bring (concrete, from my profile), one line proposing a session format and timing, and a polite close with my name. No placeholders in square brackets except [phone] / [email]. Plain text, no markdown.',
        proposal: 'Write a talk / session proposal: a catchy title, a 90–120 word abstract pitched at Indian college students, "3 takeaways" as three one-line bullets, the ideal audience and duration, and a one-line speaker bio. Plain text with simple line headings, no markdown symbols.',
        outline: 'Write a 12-session course outline (a part-time / visiting faculty module) on the most relevant subject from my profile for this opportunity. For each session: "Session N — Title: one line on what is covered + one hands-on activity". Add a 2-line course objective at the top and one line on assessment at the end. Plain text, no markdown symbols.',
        followup: 'Write a polite, brief follow-up email (max 120 words) on my earlier application or proposal — friendly, zero pressure, one new nugget of value (e.g. a sample topic or a flexible date), and a clear ask. Subject line first. Plain text, no markdown.',
      }[type];
      const sys = `You are a ghostwriter for ${me}, an Indian professional seeking speaking and teaching opportunities (college talks, guest lectures, workshops, panels, visiting faculty roles). Write in first person in ${me}'s voice: confident, humble, concrete, Indian-English friendly, never salesy. Never invent credentials not in the profile. Output plain text only.`;
      const user = `MY PROFILE\n${profTxt}\n\n${evTxt ? 'THE OPPORTUNITY\n' + evTxt + '\n\n' : ''}${ctx ? 'EXTRA CONTEXT\n' + ctx + '\n\n' : ''}TASK\n${ask}`;
      const g = await callGemini([{ role: 'user', content: user }], { maxTokens: type === 'outline' ? 2200 : 900, systemPrompt: sys });
      const reply = String((g && g.reply) || '').trim().replace(/^```[a-z]*\s*|```$/g, '').slice(0, 12000);
      if (!reply) return bad(res, 502, 'AI returned nothing');
      if (ev && b.save !== false) { Q.upd.run({ ...ev, draft: reply, updated_at: now() }); }
      res.json({ type, text: reply, event_id: ev ? ev.id : null });
    } catch (e) { bad(res, 502, 'draft failed: ' + str(e && e.message, 120)); }
  });

  // Catch malformed JSON on our routes with a clean 400 instead of Express' HTML error page.
  app.use('/api/speaker', (err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return bad(res, 400, 'invalid JSON body');
    if (err && err.type === 'entity.too.large') return bad(res, 413, 'body too large');
    next(err);
  });

  function summaryFor(phone) {
    const out = { confirmed: 0, applied: 0, interested: 0, shortlisted: 0, delivered: 0, declined: 0, next: null };
    try {
      for (const r of Q.count.all(phone)) if (r.status in out) out[r.status] = r.n;
      const n = Q.next.get(phone); if (n) out.next = { title: n.title, event_date: n.event_date };
    } catch (e) {}
    return out;
  }
  install.summaryFor = summaryFor;
  module.exports.summaryFor = summaryFor;
  return { summaryFor, fitScore, buildQueries };
}

// summaryFor is bound after install(); before that it reports an empty pipeline.
module.exports = { install, summaryFor: () => ({ confirmed: 0, applied: 0, interested: 0, next: null }), fitScore, buildQueries, KINDS, MODES, STATUSES, DRAFT_TYPES };
