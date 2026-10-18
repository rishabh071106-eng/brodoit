// Sealed settings — how API keys the owner hands over in chat reach the live server while every repo is public.
// The server makes an RSA-3072 key pair once and keeps the private half in DATA_DIR/secrets (next to the database on the
// volume; nothing serves that folder, and secrets/ is git- and docker-ignored). GET /api/seal/pubkey publishes the public
// half. config/sealed-settings.json in the repo carries values encrypted to it (RSA-OAEP, SHA-256) — readable by this server
// only. On boot every item not applied before is decrypted and saved through setSetting, exactly like a paste in You → Admin.
// Rules: an id is applied once (recorded in applied.json, written atomically right after each save); a value the owner saved
// in Admin after the item was sealed is never overwritten; what was applied shows in the Admin card (names + masked hints),
// so a swapped key is visible. Encryption is not authentication: only merge sealed files from the owner's own claude/*
// branches. Encrypt with: node scripts/seal.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const writeAtomic = (file, data) => { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, data, { mode: 0o600 }); fs.renameSync(tmp, file); };
const mask = v => { v = String(v || ''); return v.length <= 8 ? '•'.repeat(v.length) : v.slice(0, 3) + '…' + v.slice(-4); };

function loadKeys(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privFile = path.join(dir, 'seal-private.pem');
  let priv = null;
  if (fs.existsSync(privFile)) {
    try { priv = crypto.createPrivateKey(fs.readFileSync(privFile)); }
    catch (e) { fs.renameSync(privFile, privFile + '.broken-' + Date.now()); console.log('[sealed] unreadable key pair moved aside; making a new one'); }
  }
  if (!priv) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    writeAtomic(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    priv = privateKey;
    console.log('[sealed] new server key pair created');
  }
  const pub = crypto.createPublicKey(priv);
  const der = pub.export({ type: 'spki', format: 'der' });
  return { priv, pem: pub.export({ type: 'spki', format: 'pem' }), fp: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16) };
}

function install(app, deps) {
  const { dataDir, appRoot, setSetting, allowed } = deps;
  const updatedAt = typeof deps.settingUpdatedAt === 'function' ? deps.settingUpdatedAt : () => 0;
  const dir = path.join(dataDir, 'secrets');
  const file = deps.file || path.join(appRoot, 'config', 'sealed-settings.json');
  const appliedFile = path.join(dir, 'applied.json');
  let keys = null; const state = { fp: null, applied: [], skipped: [], error: '' };
  try { keys = loadKeys(dir); state.fp = keys.fp; } catch (e) { state.error = 'key pair: ' + e.message; console.log('[sealed]', state.error); }

  app.get('/api/seal/pubkey', (req, res) => {
    if (!keys) return res.status(503).json({ error: 'sealing unavailable' });
    res.set('Cache-Control', 'no-store'); res.json({ alg: 'RSA-OAEP-256', fp: keys.fp, pem: keys.pem });
  });

  function apply() {
    state.applied = []; state.skipped = []; state.error = state.error.startsWith('key pair') ? state.error : '';
    if (!keys || !fs.existsSync(file)) return state;
    let doc, done;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { state.error = 'unreadable ' + path.basename(file); return state; }
    if (!doc || !Array.isArray(doc.items)) { state.error = path.basename(file) + ' has no items list'; return state; }
    if (fs.existsSync(appliedFile)) {
      try { done = new Set(JSON.parse(fs.readFileSync(appliedFile, 'utf8'))); }
      catch (e) { state.error = 'applied.json unreadable — nothing applied (fix or delete it)'; console.log('[sealed]', state.error); return state; }
    } else done = new Set();
    for (const it of doc.items) {
      if (!it || typeof it !== 'object') continue;
      const id = String(it.id || ''), key = String(it.key || '');
      if (!id || done.has(id)) continue;
      const skip = why => { state.skipped.push({ key, why }); };
      if (!allowed.includes(key)) { skip('not allowed'); continue; }
      if (it.fp !== keys.fp) { skip('sealed for another server key'); continue; }
      const sealedAt = Date.parse(it.sealed_at || '') || 0;
      if (updatedAt(key) > sealedAt) { done.add(id); writeAtomic(appliedFile, JSON.stringify([...done])); skip('Admin value is newer'); continue; }
      let value;
      try { value = crypto.privateDecrypt({ key: keys.priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(String(it.ct || ''), 'base64')).toString('utf8').trim(); }
      catch (e) { skip('cannot decrypt'); continue; }
      if (!value || value.length > 512 || /\s/.test(value)) { skip('bad value'); continue; }
      try { setSetting(key, value); } catch (e) { skip('save failed: ' + String(e.message || '').slice(0, 60)); continue; }
      done.add(id); writeAtomic(appliedFile, JSON.stringify([...done]));
      state.applied.push({ key, hint: mask(value), sealed_at: it.sealed_at || null, at: new Date().toISOString() });
      console.log('[sealed] applied', key);
    }
    if (state.skipped.length) console.log('[sealed] skipped', state.skipped.map(s => s.key + ' (' + s.why + ')').join(', '));
    return state;
  }
  try { apply(); } catch (e) { state.error = 'apply: ' + e.message; console.log('[sealed]', state.error); }
  // For the Admin card only (admin-authenticated): names, masked hints and reasons — never values.
  global._sealedStatus = () => ({ fp: state.fp, applied: state.applied.slice(), skipped: state.skipped.slice(), error: state.error });
  return { apply, fp: () => state.fp };
}

module.exports = { install, loadKeys };
