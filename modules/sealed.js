// Sealed settings — how API keys the owner hands over in chat reach the live server while every repo is public.
// The server makes an RSA-3072 key pair once and keeps the private half in DATA_DIR/secrets (next to the database on the
// volume; nothing serves that folder). GET /api/seal/pubkey publishes the public half. config/sealed-settings.json in the
// repo carries values encrypted to it (RSA-OAEP, SHA-256) — readable by this server only. On boot every item not applied
// before is decrypted and saved through setSetting, exactly like a paste in You → Admin. Applied ids are remembered, so a
// later change in Admin is never overwritten by the next deploy. Encrypt with: node scripts/seal.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function loadKeys(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privFile = path.join(dir, 'seal-private.pem');
  if (!fs.existsSync(privFile)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('[sealed] new server key pair created');
  }
  const priv = crypto.createPrivateKey(fs.readFileSync(privFile));
  const pub = crypto.createPublicKey(priv);
  const der = pub.export({ type: 'spki', format: 'der' });
  return { priv, pem: pub.export({ type: 'spki', format: 'pem' }), fp: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16) };
}

function install(app, deps) {
  const { dataDir, appRoot, setSetting, allowed } = deps;
  const dir = path.join(dataDir, 'secrets');
  const file = deps.file || path.join(appRoot, 'config', 'sealed-settings.json');
  const appliedFile = path.join(dir, 'applied.json');
  let keys = null, state = { fp: null, applied: [], skipped: [], error: '' };
  try { keys = loadKeys(dir); state.fp = keys.fp; } catch (e) { state.error = 'key pair: ' + e.message; console.log('[sealed]', state.error); }

  app.get('/api/seal/pubkey', (req, res) => {
    if (!keys) return res.status(503).json({ error: 'sealing unavailable' });
    res.set('Cache-Control', 'no-store'); res.json({ alg: 'RSA-OAEP-256', fp: keys.fp, pem: keys.pem });
  });

  function apply() {
    state.applied = []; state.skipped = [];
    if (!keys || !fs.existsSync(file)) return state;
    let doc, done;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { state.error = 'bad ' + path.basename(file); return state; }
    try { done = new Set(JSON.parse(fs.readFileSync(appliedFile, 'utf8'))); } catch (e) { done = new Set(); }
    for (const it of (doc && doc.items) || []) {
      const id = String(it.id || ''), key = String(it.key || '');
      if (!id || done.has(id)) continue;
      if (!allowed.includes(key)) { state.skipped.push(key + ' (not allowed)'); continue; }
      if (it.fp !== keys.fp) { state.skipped.push(key + ' (sealed for another server key)'); continue; }
      try {
        const value = crypto.privateDecrypt({ key: keys.priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(String(it.ct || ''), 'base64')).toString('utf8').trim();
        if (!value || value.length > 512 || /\s/.test(value)) { state.skipped.push(key + ' (bad value)'); continue; }
        setSetting(key, value); done.add(id); state.applied.push(key);
        console.log('[sealed] applied', key);
      } catch (e) { state.skipped.push(key + ' (' + String(e.message || 'cannot decrypt').slice(0, 60) + ')'); }
    }
    try { fs.writeFileSync(appliedFile, JSON.stringify([...done]), { mode: 0o600 }); } catch (e) {}
    if (state.skipped.length) console.log('[sealed] skipped', state.skipped.join(', '));
    return state;
  }
  apply();
  global._sealedStatus = () => ({ fp: state.fp, applied: state.applied.slice(), skipped: state.skipped.slice(), error: state.error });
  return { apply, fp: () => state.fp };
}

module.exports = { install, loadKeys };
