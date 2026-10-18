#!/usr/bin/env node
// Encrypt settings for the live server (see modules/sealed.js). The values come from environment variables, so they never
// sit in shell history or in the repo in plain text.
//   curl -s https://brodoit.com/api/seal/pubkey > pub.json      (or the "Server public key" GitHub Action prints it)
//   GEMINI_API_KEY=... ELEVENLABS_API_KEY=... node scripts/seal.js pub.json GEMINI_API_KEY ELEVENLABS_API_KEY
// Writes config/sealed-settings.json (adds or replaces the named items). Commit it; the server applies it on its next boot.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [pubFile, ...names] = process.argv.slice(2);
if (!pubFile || !names.length) { console.log('usage: node scripts/seal.js <pubkey.json> NAME [NAME…]  (values from env)'); process.exit(1); }
const pub = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
const key = crypto.createPublicKey(pub.pem);
const fp = crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
if (pub.fp && pub.fp !== fp) { console.log('fingerprint mismatch'); process.exit(1); }
const out = path.join(__dirname, '..', 'config', 'sealed-settings.json');
let doc = { note: 'Encrypted for the live server only (RSA-OAEP-256). See modules/sealed.js.', items: [] };
try { doc = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
for (const n of names) {
  const v = String(process.env[n] || '').trim(); if (!v) { console.log('skip', n, '(not in env)'); continue; }
  const ct = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(v, 'utf8')).toString('base64');
  doc.items = (doc.items || []).filter(i => i.key !== n);
  doc.items.push({ id: crypto.randomBytes(8).toString('hex'), key: n, fp, ct, sealed_at: new Date().toISOString() });
  console.log('sealed', n);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
console.log('→', out);
