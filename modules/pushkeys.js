// v21: the server's push identity (VAPID) and one sender for every push the app sends.
// The private key was once committed to this public repo, so it is refused (only its sha256 is kept here). Order:
//   1. VAPID_PRIVATE_KEY on the server (its public key is derived from it), unless it is the published one;
//   2. DATA_DIR/secrets/vapid.json (made once, mode 600; secrets/ is git- and docker-ignored, nothing serves it).
// Every subscription records the public key it was made with (push_subs.vapid). A push to a subscription made with
// another key is skipped (the app re-subscribes on its next start); one the push service rejects (401/403/404/410)
// is deleted.
//   load({ dataDir, env }) → { publicKey, privateKey, source }
//   sender({ db, webpush, keys, log }) → { send(phone, payload) → n, sendSub(sub, payload) → Promise<bool> }
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const PUBLISHED = ['9712ccd1ab0b4cc125d04998b0f11dfeffa9ed12c86d3eeaa4f074348636bf98'];
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const isPublished = k => PUBLISHED.includes(crypto.createHash('sha256').update(String(k)).digest('hex'));

function publicOf(privateKey) {
  const raw = unb64u(privateKey);
  if (raw.length !== 32) throw new Error('a VAPID private key is 32 bytes');
  const ec = crypto.createECDH('prime256v1'); ec.setPrivateKey(raw);
  return b64u(ec.getPublicKey(null, 'uncompressed'));
}
function generate() {
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  return { publicKey: b64u(ec.getPublicKey(null, 'uncompressed')), privateKey: b64u(ec.getPrivateKey()) };
}

function load(o) {
  o = o || {};
  const env = o.env || process.env, log = o.log || (() => {});
  const fromEnv = String(env.VAPID_PRIVATE_KEY || '').trim();
  if (fromEnv && isPublished(fromEnv)) log('[push] VAPID_PRIVATE_KEY is the key that was published in the repo: refused, using the server\'s own key');
  else if (fromEnv) { try { return { publicKey: publicOf(fromEnv), privateKey: fromEnv, source: 'env' }; } catch (e) { log('[push] VAPID_PRIVATE_KEY unusable:', e.message); } }
  const dir = path.join(o.dataDir || '.', 'secrets'), file = path.join(dir, 'vapid.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.privateKey && !isPublished(j.privateKey)) return { publicKey: publicOf(j.privateKey), privateKey: j.privateKey, source: 'file' };
  } catch (e) { /* none yet */ }
  const k = generate();
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ privateKey: k.privateKey, created_at: new Date().toISOString() }), { mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { log('[push] could not save the new key (pushes stop working after a restart):', e.message); }
  log('[push] made the server\'s own VAPID key');
  return Object.assign(k, { source: 'new' });
}

function sender(o) {
  const { db, webpush, keys } = o, log = o.log || (() => {});
  const subject = o.subject || 'https://brodoit.com';
  const opts = { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600 };
  const stats = { sent: 0, failed: 0, dropped: 0, stale: 0 };
  function sendSub(sub, payload) {
    if (sub.vapid && sub.vapid !== keys.publicKey) { stats.stale++; return Promise.resolve(false); }
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return Promise.resolve().then(() => webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } }, body, opts))
      .then(() => { stats.sent++; return true; })
      .catch(err => {
        stats.failed++;
        const code = err && err.statusCode;
        if (code === 401 || code === 403 || code === 404 || code === 410) { try { db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(sub.endpoint); stats.dropped++; } catch (e) { /* ignore */ } }
        else log('[push] send failed', code || (err && err.message));
        return false;
      });
  }
  function subsOf(phone) { try { return db.prepare('SELECT * FROM push_subs WHERE user_phone=?').all(phone); } catch (e) { return []; } }
  // fire-and-forget; returns how many of the user's subscriptions it went to (made with the current key)
  function send(phone, payload) { const subs = subsOf(phone).filter(s => !s.vapid || s.vapid === keys.publicKey); for (const s of subs) sendSub(s, payload); return subs.length; }
  // the same, but waits for the push services' answers → how many accepted it
  async function sendNow(phone, payload) { const r = await Promise.all(subsOf(phone).map(s => sendSub(s, payload))); return r.filter(Boolean).length; }
  return { send, sendNow, sendSub, stats: () => Object.assign({}, stats), publicKey: keys.publicKey };
}

module.exports = { load, sender, publicOf, generate, isPublished };
