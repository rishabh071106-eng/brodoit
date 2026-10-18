// App settings — API keys and voice names pasted from You → Admin live in the app's own database
// (table app_settings on the persistent volume) and take effect immediately; Railway env vars stay
// the fallback. Only the whitelisted keys below are ever stored; getSetting() for any other key
// simply reads process.env so callers can treat it as the single source of truth.
'use strict';

const KEYS = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_REALTIME_VOICE', 'ELEVEN_VOICE_EN', 'ELEVEN_VOICE_HI'];

// "sk-…k9Qz" — enough to recognise a key, never enough to use it.
function maskKey(v) {
  v = String(v == null ? '' : v);
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return v.slice(0, 3) + '…' + v.slice(-4);
}

function install(db) {
  db.exec("CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_at TEXT DEFAULT(datetime('now')))");
  const qGet = db.prepare('SELECT value FROM app_settings WHERE key=?');
  const qPut = db.prepare("INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now'))");
  const qDel = db.prepare('DELETE FROM app_settings WHERE key=?');

  function appValue(k) {
    if (!KEYS.includes(k)) return '';
    try { const r = qGet.get(k); return r && r.value ? String(r.value) : ''; } catch (e) { return ''; }
  }
  // Value the app should use right now: pasted-in-app first, env second, '' when neither.
  function getSetting(k) {
    k = String(k || '');
    return appValue(k) || process.env[k] || '';
  }
  // Where the current value comes from: 'app' | 'env' | null.
  function settingSource(k) {
    k = String(k || '');
    if (appValue(k)) return 'app';
    if (process.env[k]) return 'env';
    return null;
  }
  // Store (or, with an empty value, remove) a whitelisted key. Returns the new source.
  function setSetting(k, v) {
    k = String(k || '');
    if (!KEYS.includes(k)) throw new Error('unknown setting ' + k);
    v = String(v == null ? '' : v).trim();
    if (!v) qDel.run(k); else qPut.run(k, v);
    return settingSource(k);
  }
  return { getSetting, setSetting, settingSource, maskKey, KEYS };
}

module.exports = { install, maskKey, KEYS };
