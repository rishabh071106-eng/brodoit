// Brodoit Steps tab — ring, status pill, friends podium, streak, 7-day bars, leaderboard, sheets,
// Walk mode (DeviceMotion pedometer), share cards (Canvas → navigator.share). Plain script, no modules.
// Uses the SPA globals: S, api(path,{method,body}), token, esc, toast, switchTab; optional window.ico / window.haptic.
// Public API: window.StepsTab = { html(), mount(), load(), rerender(), openSheet(kind,arg), closeSheet(), share(kind),
//   walkStart(), walkStop(), enableTap(), ringSVG(pct,size,opts), miniCard(), setPeriod(p), setScope(s) }
(function () {
  'use strict';
  const T = window.StepsTab = {
    sum: null, loaded: false, loading: false, failed: false,
    board: { scope: 'friends', period: 'today', data: null, loading: false, cache: {} },
    friends: null, mascot: null, sheet: null, _ringPct: 0, _uid: 0,
    // base = server count when the walk started; absorbs = does the server's counted() grow with device deltas (false once a trust≥2 sample owns the day)
    walk: { on: false, steps: 0, sent: 0, base: 0, absorbs: null, started: 0, lastFlush: 0, lock: null, timer: null, flushTimer: null, _lp: 0, _sm: 0, _lastStep: 0, _handler: null },
    manual: { value: '', app: 'googlefit', date: 'today', saving: false },
    goalDraft: null, ios: { token: null, busy: false, test: null, poll: null }, enable: { busy: false, left: 0, poll: null, failed: false }, shareBusy: false,
  };

  // ───────────────────────── shell shims (the SPA defines these; harnesses may not) ─────────────────────────
  const _S = () => (typeof S !== 'undefined' && S) || window.S || (window.S = { tab: 'health' });
  const _esc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const _toast = (m, t) => { try { if (typeof toast === 'function') toast(m, t); } catch (e) {} };
  const _api = (p, o) => { try { return typeof api === 'function' ? Promise.resolve(api(p, o)) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } };
  // JS string literal for inline onclick="" handlers: escape for JS first, then for the HTML attribute (the parser decodes entities before JS sees them)
  const jsStr = s => "'" + _esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n|\u2028|\u2029/g, '\\n').replace(/<\/(script)/gi, '<\\/$1')) + "'";
  const hap = k => { try { if (window.haptic) haptic(k || 'light'); } catch (e) {} };
  const fmt = n => { n = Math.max(0, Math.round(Number(n) || 0)); try { return n.toLocaleString('en-IN'); } catch (e) { return String(n); } };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const isHi = () => { try { return document.documentElement.lang === 'hi' || localStorage.getItem('bd_lang') === 'hi'; } catch (e) { return document.documentElement.lang === 'hi'; } };
  const isTWA = () => { try { if (localStorage.getItem('bd_twa') === '1') return true; } catch (e) {} const r = /^android-app:\/\/com\.brodoit\./.test(document.referrer || ''); const q = /[?&](bd=|twa=1|device_id=)/.test(location.search || ''); if (r || q) { try { localStorage.setItem('bd_twa', '1'); } catch (e) {} } return r || q; };
  const UA = () => navigator.userAgent || '';
  const isIOS = () => /iPhone|iPad|iPod/i.test(UA()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/i.test(UA());

  // ───────────────────────── i18n (pill + nudge copy) ─────────────────────────
  const STR = {
    en: {
      bg: 'Auto-syncing', bgSub: 'synced {t}', enable: 'Turn on step counting', ios: 'Set up iPhone sync', play: 'Get the app · auto-sync', web: 'Counting manually', walk: 'Walking · live',
      of: 'of {g}', km: 'km', kcal: 'kcal', min: 'active min', goalDone: 'Goal done. Legend.',
      left: '{n} more to hit your goal', almost: 'So close — {n} to go!', start: 'Take the first step. A short walk counts.',
      noData: 'Log a walk or turn on syncing to see today.', streak: '{n}-day streak', streak1: '1-day streak', noStreak: 'Start a streak', streakSub: 'Hit your goal daily', longest: 'best {n}',
      freeze: '{n} freeze', freezes: '{n} freezes', noFreeze: 'No freezes', invite: 'Invite a friend', emptyH: 'Walk with friends', emptyP: 'Race a friend to your goal.',
      friends: 'Friends', today: 'Today', week: 'Week', city: 'City', india: 'India', opensAt: 'opens at 20 walkers', you: 'You', provisional: 'Provisional — final at midnight',
      walkLearn: 'Walk & Learn', log: 'Log steps', share: 'Share today', goal: 'Goal', stop: 'Stop', walking: 'Walking with Bro', keepOn: 'Keep the screen on, phone in your pocket or hand.',
      share1: 'Day {d}', shareRank: '#{r} among friends', shareWith: 'Walking with Brodoit',
      walkSaved: 'Walk saved · {n} steps', walkStopped: 'Walk stopped', walkNoCount: 'today’s total comes from {src}', walkNoCountHint: 'Saved as a walk — today’s total comes from {src}, so the ring won’t move.',
    },
    hi: {
      bg: 'ऑटो-सिंक चालू', bgSub: '{t} सिंक हुआ', enable: 'स्टेप काउंट चालू करें', ios: 'iPhone सिंक सेट करें', play: 'ऐप लें · ऑटो-सिंक', web: 'मैन्युअल गिनती', walk: 'चल रहे हैं · लाइव',
      of: '{g} में से', km: 'किमी', kcal: 'कैलोरी', min: 'सक्रिय मिनट', goalDone: 'लक्ष्य पूरा — शानदार! अब हर कदम बोनस है।',
      left: 'लक्ष्य के लिए {n} और', almost: 'बस {n} और — बहुत करीब!', start: 'पहला कदम लें। छोटी सैर भी गिनती है।',
      noData: 'आज देखने के लिए सैर लॉग करें या सिंक चालू करें।', streak: '{n} दिन की स्ट्रीक', streak1: '1 दिन की स्ट्रीक', noStreak: 'आज स्ट्रीक शुरू करें', streakSub: 'रोज़ लक्ष्य पूरा करें', longest: 'सबसे लंबी {n}',
      freeze: '{n} फ़्रीज़', freezes: '{n} फ़्रीज़', noFreeze: 'फ़्रीज़ नहीं', invite: 'दोस्त को बुलाएँ', emptyH: 'दोस्तों के साथ चलें', emptyP: 'दोस्त के साथ रेस लगाएँ।',
      friends: 'दोस्त', today: 'आज', week: 'हफ़्ता', city: 'शहर', india: 'भारत', opensAt: '20 वॉकर पर खुलेगा', you: 'आप', provisional: 'अस्थायी — आधी रात को फ़ाइनल',
      walkLearn: 'चलें और सीखें', log: 'स्टेप लॉग करें', share: 'आज शेयर करें', goal: 'लक्ष्य', stop: 'रोकें', walking: 'Bro के साथ सैर', keepOn: 'स्क्रीन चालू रखें, फ़ोन जेब या हाथ में।',
      share1: 'दिन {d}', shareRank: 'दोस्तों में #{r}', shareWith: 'Brodoit के साथ सैर',
      walkSaved: 'सैर सेव हुई · {n} कदम', walkStopped: 'सैर रुकी', walkNoCount: 'आज का कुल {src} से है', walkNoCountHint: 'सैर सेव हुई — आज का कुल {src} से आता है, इसलिए रिंग नहीं बढ़ेगी।',
    },
  };
  const t = (k, v) => { let s = (STR[isHi() ? 'hi' : 'en'][k] != null ? STR[isHi() ? 'hi' : 'en'][k] : STR.en[k]) || k; if (v) Object.keys(v).forEach(x => { s = s.split('{' + x + '}').join(v[x]); }); return s; };
  T.t = t;

  // ───────────────────────── icons: window.ico(name,size) with inline fallbacks ─────────────────────────
  const P = {
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    snowflake: '<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    footprints: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m8 22 2.5-7.5L8 12l2-5 3 1 2 3 3 1"/><path d="m16 22-2.5-6"/><path d="M8 13 6 17"/>',
    'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    'qr-code': '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    sparkles: '<path d="M9.9 2.6 11.6 7a1 1 0 0 0 .6.6l4.4 1.7a1 1 0 0 1 0 1.9l-4.4 1.7a1 1 0 0 0-.6.6l-1.7 4.4a1 1 0 0 1-1.9 0l-1.7-4.4a1 1 0 0 0-.6-.6L1.4 11.2a1 1 0 0 1 0-1.9l4.4-1.7a1 1 0 0 0 .6-.6L8.1 2.6a1 1 0 0 1 1.8 0Z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  };
  const ic = (name, size) => {
    size = size || 20; let s = '';
    try { if (window.ico) s = ico(name, size) || ''; } catch (e) { s = ''; }
    if (s) return s;
    const p = P[name]; if (!p) return '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  };
  T.ic = ic;

  // ───────────────────────── tiny QR encoder (byte mode, versions 1–10, EC level M/L) ─────────────────────────
  // Port of the well-known compact algorithm: data codewords → Reed–Solomon → interleave → zigzag place → mask → format bits.
  const QR = (function () {
    const ECC = { L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] };
    const BLK = { L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] };
    const FMT = { L: 1, M: 0 };
    function rawModules(v) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; } return r; }
    function dataCap(v, ecl) { return Math.floor(rawModules(v) / 8) - ECC[ecl][v] * BLK[ecl][v]; }
    function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
    function rsDivisor(d) { const r = []; for (let i = 0; i < d - 1; i++) r.push(0); r.push(1); let root = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 0x02); } return r; }
    function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); } return r; }
    function encode(text, ecl) {
      ecl = ecl || 'M';
      const bytes = Array.from(new TextEncoder().encode(text));
      let v = 1; for (; v <= 10; v++) { if (dataCap(v, ecl) * 8 >= 4 + (v < 10 ? 8 : 16) + bytes.length * 8) break; }
      if (v > 10) return null;
      const cap = dataCap(v, ecl) * 8; const bits = [];
      const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
      put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
      put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
      for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
      const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
      // split into blocks + ECC, interleave
      const nb = BLK[ecl][v], el = ECC[ecl][v], raw = Math.floor(rawModules(v) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
      const blocks = []; const div = rsDivisor(el);
      for (let i = 0, k = 0; i < nb; i++) { const dl = shortLen - el + (i < nShort ? 0 : 1); const d = data.slice(k, k + dl); k += dl; const ecc = rsRemainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(ecc)); }
      const out = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) out.push(b[i]); });
      // matrix
      const size = v * 4 + 17; const M = [], F = []; for (let y = 0; y < size; y++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
      const setF = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
      for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
      const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4); } };
      finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
      let ap = []; if (v >= 2) { const na = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2; ap = [6]; for (let pos = size - 7; ap.length < na; pos -= step) ap.splice(1, 0, pos); }
      for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) { if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
      const fmtBits = (mask) => { const d = FMT[ecl] << 3 | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = (d << 10 | r) ^ 0x5412; const g = i => ((b >>> i) & 1) === 1; for (let i = 0; i <= 5; i++) setF(8, i, g(i)); setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8)); for (let i = 9; i < 15; i++) setF(14 - i, 8, g(i)); for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) setF(8, size - 15 + i, g(i)); setF(8, size - 8, true); };
      fmtBits(0);
      // version information (mandatory for v≥7): 6-bit version + 12-bit BCH remainder, placed in two 3×6 blocks beside the finders
      if (v >= 7) { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25); const vb = v << 12 | rem; for (let i = 0; i < 18; i++) { const bit = ((vb >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); setF(a, b, bit); setF(b, a, bit); } }
      // zigzag data placement
      let i = 0; for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!F[y][x] && i < out.length * 8) { M[y][x] = ((out[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; } } }
      // mask selection by penalty (runs, 2x2 blocks, balance)
      const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
      const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && maskFn[m](x, y)) M[y][x] = !M[y][x]; };
      const penalty = () => { let p = 0, dark = 0; for (let y = 0; y < size; y++) { let run = 0, c = null; for (let x = 0; x < size; x++) { if (M[y][x] === c) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { c = M[y][x]; run = 1; } if (M[y][x]) dark++; } } for (let x = 0; x < size; x++) { let run = 0, c = null; for (let y = 0; y < size; y++) { if (M[y][x] === c) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { c = M[y][x]; run = 1; } } } for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; } const total = size * size; const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1; return p + Math.max(0, k) * 10; };
      let best = 0, bestP = Infinity; for (let m = 0; m < 8; m++) { apply(m); fmtBits(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
      apply(best); fmtBits(best);
      return { size, modules: M, version: v, mask: best, ecl, blocks, eccLen: el };
    }
    function svg(text, opts) { opts = opts || {}; const q = encode(text, opts.ecl); if (!q) return ''; const b = opts.border == null ? 2 : opts.border, n = q.size + b * 2; let d = ''; for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + b) + ' ' + (y + b) + 'h1v1h-1z'; return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="' + (opts.bg || '#fff') + '"/><path d="' + d + '" fill="' + (opts.fg || '#17141F') + '"/></svg>'; }
    return { encode, svg, gfMul, _rsDivisor: rsDivisor };
  })();
  T.qr = QR;

  // ───────────────────────── derived state ─────────────────────────
  const STATES = ['bg', 'enable', 'ios', 'play', 'web', 'walk'];
  const guessState = () => isTWA() ? 'enable' : isIOS() ? 'ios' : isAndroid() ? 'play' : 'web';
  T.stateNow = () => T.walk.on ? 'walk' : (T.sum && STATES.indexOf(T.sum.state) >= 0 && T.sum.state !== 'walk') ? T.sum.state : guessState();
  T.goal = () => (T.sum && Number(T.sum.goal)) || 8000;
  T.serverCounted = () => (T.sum && T.sum.today && Number(T.sum.today.counted)) || 0;
  T.pending = () => Math.max(0, T.walk.steps - T.walk.sent);
  // Ring count. While walking: never below server counted, never below (count at walk start + steps this walk) → monotonic, no
  // snap-back on each flush even when the server's counted() is owned by a higher-trust sample. After the walk: server truth, plus
  // deltas still queued for this user unless we already know the server ignores device deltas today (absorbs === false).
  T.counted = () => { const s = T.serverCounted(); if (T.walk.absorbs === false) return s; if (T.walk.on) return Math.max(s, (Number(T.walk.base) || 0) + T.walk.steps); return s + queuedAdd(); };
  T.pct = () => clamp(T.counted() / T.goal(), 0, 1);
  const metrics = n => ({ km: (n * 0.00076).toFixed(n * 0.00076 >= 10 ? 0 : 1), kcal: Math.round(n * 0.04), min: Math.round(n / 100) });
  const ago = iso => { if (!iso) return ''; const d = (Date.now() - new Date(iso).getTime()) / 60000; if (!(d >= 0)) return ''; if (d < 2) return isHi() ? 'अभी' : 'just now'; if (d < 60) return Math.round(d) + (isHi() ? ' मिनट पहले' : ' min ago'); if (d < 36 * 60) return Math.round(d / 60) + (isHi() ? ' घं पहले' : ' h ago'); return Math.round(d / 1440) + (isHi() ? ' दिन पहले' : ' d ago'); };
  const initials = n => ((n || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2) || '?').toUpperCase();
  const avatar = (row, cls) => '<span class="b-avatar ' + (cls || '') + '" style="--hue:' + (Number(row.hue) || 20) + '">' + _esc(initials(row.name)) + '</span>';
  // Days: the user's tz (users.tz, default IST) decides the day key — never the device's local zone. Labels are formatted from the
  // key at UTC noon so the weekday/date can't drift when the device sits in another zone.
  const userTz = () => (_S().user && _S().user.tz) || 'Asia/Kolkata';
  const dayKey = (d, tz) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || userTz() }).format(d); } catch (e) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); } };
  const keyDate = k => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; };
  const keyShift = (k, days) => { const d = keyDate(k); if (!d) return k; const x = new Date(d.getTime() + days * 86400000); const p = n => (n < 10 ? '0' : '') + n; return x.getUTCFullYear() + '-' + p(x.getUTCMonth() + 1) + '-' + p(x.getUTCDate()); };
  const fmtKey = (k, opts) => { const d = keyDate(k); if (!d) return ''; try { return d.toLocaleDateString(isHi() ? 'hi-IN' : 'en-IN', Object.assign({ timeZone: 'UTC' }, opts || {})); } catch (e) { return ''; } };
  const todayKey = () => (T.sum && T.sum.today && keyDate(T.sum.today.date) ? T.sum.today.date : dayKey(new Date()));
  const dateLabel = () => fmtKey(todayKey(), { weekday: 'short', day: 'numeric', month: 'short' });
  const SRC = { manual: ['Manual', 0], device: ['Walk', 1], googlefit: ['Fit', 2], shortcut: ['iPhone', 2], android: ['Android', 3], healthconnect: ['Health', 3] };
  const srcLabel = (src, fallback) => _esc((SRC[src] || [src || fallback || ''])[0]);
  const srcBadge = (src, trust) => { const s = SRC[src] || [src || 'Manual', trust || 0]; const tr = clamp(Math.round(Number(trust != null ? trust : s[1])) || 0, 0, 3); return '<span class="st-src t' + tr + '">' + _esc(s[0]) + '</span>'; };
  T.friendCount = () => T.friends && T.friends.friends ? T.friends.friends.length : (T.board.cache['friends:today'] && T.board.cache['friends:today'].top ? Math.max(0, T.board.cache['friends:today'].top.filter(r => !r.isMe).length) : 0);

  // ───────────────────────── ring ─────────────────────────
  T.ringSVG = function (pct, size, o) {
    o = o || {}; size = size || 200; const sw = o.stroke || Math.round(size * 0.08); const r = (size - sw) / 2, cx = size / 2, c = 2 * Math.PI * r;
    pct = clamp(Number(pct) || 0, 0, 1); const from = o.from == null ? pct : clamp(o.from, 0, 1); const id = 'stg' + (++T._uid);
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + Math.round(pct * 100) + '%">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--move,#B5402A)"/><stop offset="1" style="stop-color:var(--b-mint,#2F7D4F)"/></linearGradient></defs>' +
      '<circle class="st-ring-track" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="st-ring-prog" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="url(#' + id + ')" stroke-width="' + sw + '" stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - from)).toFixed(2) + '" data-target="' + (c * (1 - pct)).toFixed(2) + '"/></svg>';
  };
  T.animateRings = function (root) {
    const els = (root || document).querySelectorAll('.st-ring-prog[data-target]');
    if (!els.length) return;
    const go = () => els.forEach(el => { el.style.strokeDashoffset = el.getAttribute('data-target'); el.removeAttribute('data-target'); });
    if (reduced()) return go();
    requestAnimationFrame(() => requestAnimationFrame(go));
  };

  // ───────────────────────── screen pieces ─────────────────────────
  const skel = (cls, w, h) => '<span class="b-skel sk ' + (cls || '') + '" style="' + (w ? 'width:' + w + ';' : '') + (h ? 'height:' + h : '') + '"></span>';
  function hero() {
    const has = !!T.sum; const n = T.counted(), g = T.goal(), pct = T.pct(), done = has && n >= g; const m = metrics(n);
    let h = '<section class="st-hero">';
    h += '<div class="st-ring' + (done ? ' done' : '') + '">' + T.ringSVG(has ? pct : 0, 200, { stroke: 16, from: T._ringPct }) + (done ? '<span class="st-done-check">' + ic('check', 16) + '</span>' : '') + '<div class="st-ring-in">';
    const failed = !has && T.loaded && !T.loading;
    if (has || failed) h += '<div class="st-count' + (T.walk.on ? ' live' : '') + '" id="stCount">' + fmt(n) + '</div><div class="st-of">' + _esc(t('of', { g: fmt(g) })) + '</div>';
    else h += skel('st-sk-count') + skel('st-sk-of');
    h += '</div></div>';
    if (has || failed) h += '<div class="st-metrics" id="stMetrics"><span><b>' + m.km + '</b> ' + _esc(t('km')) + '</span><i></i><span><b>' + fmt(m.kcal) + '</b> ' + _esc(t('kcal')) + '</span><i></i><span><b>' + fmt(m.min) + '</b> ' + _esc(t('min')) + '</span></div>';
    else h += '<div class="st-metrics">' + skel('', '180px', '12px') + '</div>';
    h += pill();
    if (has) h += '<p class="st-nudge" id="stNudge">' + _esc(nudge(n, g)) + '</p>';
    else if (failed) h += '<p class="st-nudge">' + _esc(t('noData')) + '</p><button class="b-chip" onclick="StepsTab.load(true)">' + ic('refresh-cw', 14) + (isHi() ? 'फिर कोशिश' : 'Retry') + '</button>';
    h += '</section>';
    return h;
  }
  const nudge = (n, g) => { const left = g - n; return n >= g ? t('goalDone') : n === 0 ? t('start') : left <= 1000 ? t('almost', { n: fmt(left) }) : t('left', { n: fmt(left) }); };
  function pill() {
    if (!T.sum && !T.loaded && !T.walk.on) return skel('st-sk-pill');
    const st = T.stateNow(); let label = t(st), sub = '';
    if (st === 'bg' && T.sum && T.sum.today && T.sum.today.synced_at) sub = ' · ' + ago(T.sum.today.synced_at);
    const icon = st === 'walk' ? 'walk' : st === 'bg' ? 'zap' : st === 'ios' || st === 'play' || st === 'enable' ? 'smartphone' : 'footprints';
    return '<button class="st-pill s-' + st + '" id="stPill" data-state="' + st + '" onclick="StepsTab.pillTap()" aria-label="' + _esc(label) + '"><span class="st-dot"></span>' + ic(icon, 16) + '<span>' + _esc(label) + _esc(sub) + '</span>' + (st !== 'bg' && st !== 'walk' ? ic('chevron-right', 14) : '') + '</button>';
  }
  T.pillTap = function () {
    hap('light'); const st = T.stateNow();
    if (st === 'enable' || st === 'play') return T.openSheet('enable');
    if (st === 'ios') return T.openSheet('ios');
    if (st === 'web') return T.openSheet('manual');
    if (st === 'walk') { const el = document.getElementById('stWalk'); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); return; }
    const td = (T.sum && T.sum.today) || {}; _toast((isHi() ? 'स्रोत: ' : 'Source: ') + ((SRC[td.source] || [td.source || 'device'])[0]) + (td.synced_at ? ' · ' + ago(td.synced_at) : ''));
  };
  function walkCard() {
    if (!T.walk.on) return '';
    const n = T.walk.steps, m = metrics(n);
    return '<section class="b-card st-walk" id="stWalk"><div class="st-walk-head"><span class="b-eyebrow"><span class="st-dot" style="width:8px;height:8px;border-radius:50%;background:var(--move);display:inline-block"></span>' + _esc(t('walking')) + '</span><button class="b-btn ghost sm" onclick="StepsTab.walkStop()">' + ic('x', 16) + _esc(t('stop')) + '</button></div>' +
      '<div class="st-walk-nums"><div><b id="stWalkSteps">' + fmt(n) + '</b><small>' + (isHi() ? 'कदम' : 'steps') + '</small></div><div><b id="stWalkTime">' + walkTime() + '</b><small>' + (isHi() ? 'समय' : 'time') + '</small></div><div><b id="stWalkKm">' + m.km + '</b><small>' + _esc(t('km')) + '</small></div></div>' +
      '<div class="st-chiprow" style="justify-content:center"><button class="b-chip move" onclick="StepsTab.learn(\'news\')">' + ic('play', 14) + (isHi() ? 'ख़बरें सुनें' : 'Listen to news') + '</button><button class="b-chip move" onclick="StepsTab.learn(\'bro\')">' + ic('sparkles', 14) + (isHi() ? 'Bro से बात करें' : 'Talk to Bro') + '</button></div>' +
      '<div class="st-walk-hint">' + _esc(t('keepOn')) + '</div>' +
      (T.walk.absorbs === false ? '<div class="st-note" id="stWalkNote">' + ic('info', 14) + _esc(t('walkNoCountHint', { src: srcName() })) + '</div>' : '') + '</section>';
  }
  const srcName = () => { const td = (T.sum && T.sum.today) || {}; return (SRC[td.source] || [td.source || 'sync'])[0]; };
  const walkTime = () => { const s = T.walk.started ? Math.floor((Date.now() - T.walk.started) / 1000) : 0; const mm = Math.floor(s / 60), ss = s % 60; return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss; };
  T.learn = function (tab) { hap('light'); if (typeof switchTab === 'function') switchTab(tab); };
  const mascotSVG = () => '<svg viewBox="0 0 96 96" fill="none" aria-hidden="true"><circle cx="48" cy="80" r="34" fill="var(--move-soft,#CFF3EC)"/><circle cx="46" cy="26" r="13" fill="var(--move,#B5402A)"/><circle cx="50" cy="24" r="2" fill="#17141F"/><path d="M44 30q4 3 8-1" stroke="#17141F" stroke-width="2" stroke-linecap="round"/><path d="M46 39v20" stroke="var(--move-deep,#8E2F1E)" stroke-width="9" stroke-linecap="round"/><path d="M46 56 36 76" stroke="var(--move-deep,#8E2F1E)" stroke-width="8" stroke-linecap="round"/><path d="M46 56l12 10 2 12" stroke="var(--move-deep,#8E2F1E)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M46 42 34 52" stroke="var(--move,#B5402A)" stroke-width="7" stroke-linecap="round"/><path d="M46 42l12 8 8-4" stroke="var(--move,#B5402A)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="72" cy="20" r="3" fill="#B5402A"/><circle cx="20" cy="40" r="2" fill="#B5402A"/><circle cx="78" cy="48" r="2" fill="#1F1E1C"/></svg>';
  const mascot = () => (window.mascot ? window.mascot('walking', 96) : (T.mascot === true ? '<img src="/app/mascot.svg" alt="" width="96" height="96">' : mascotSVG()));
  function podium() {
    const d = T.board.cache['friends:today'];
    if (!T.loaded && !d) return '<section class="b-card st-podium"><div class="st-podium-head">' + skel('', '90px', '12px') + skel('', '60px', '12px') + '</div><div class="st-podium-row">' + [40, 56, 28].map(hh => '<div class="st-pod">' + skel('', '48px', '48px').replace('b-skel', 'b-skel round') + skel('', '56px', '10px') + skel('', '100%', hh + 'px') + '</div>').join('') + '</div></section>';
    if (T.friendCount() === 0 || !d || !d.top || d.top.length < 2) {
      return '<section class="b-card st-empty" id="stEmpty">' + mascot() + '<div><h3>' + _esc(t('emptyH')) + '</h3><p>' + _esc(t('emptyP')) + '</p><button class="b-btn move sm" onclick="StepsTab.openSheet(\'invite\')">' + ic('user-plus', 16) + _esc(t('invite')) + '</button></div></section>';
    }
    const top = d.top.slice(0, 3); const order = [top[1], top[0], top[2]]; const cls = ['p2', 'p1', 'p3'];
    let h = '<section class="b-card st-podium"><div class="st-podium-head"><span class="b-eyebrow">' + _esc(t('friends')) + ' · ' + _esc(t('today')) + '</span><button class="b-chip" onclick="StepsTab.openSheet(\'invite\')">' + ic('user-plus', 14) + _esc(t('invite')) + '</button></div><div class="st-podium-row">';
    order.forEach((r, i) => { if (!r) { h += '<div></div>'; return; } h += '<button class="st-pod ' + cls[i] + (r.isMe ? ' me' : '') + '" onclick="StepsTab.podTap()">' + avatar(r) + '<span class="st-pod-name">' + _esc(r.isMe ? t('you') : r.name) + '</span><span class="st-pod-steps">' + fmt(r.steps) + '</span><span class="st-pod-bar">' + (i === 1 ? 1 : i === 0 ? 2 : 3) + '</span></button>'; });
    return h + '</div></section>';
  }
  T.podTap = function () { hap('light'); const el = document.getElementById('stBoard'); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); };
  function streak() {
    if (!T.sum) return '<section class="b-card st-streak"><div class="st-streak-l">' + skel('', '36px', '36px').replace('b-skel', 'b-skel round') + '<div>' + skel('', '110px', '16px') + skel('', '70px', '10px') + '</div></div>' + skel('', '80px', '36px') + '</section>';
    const n = Number(T.sum.streak) || 0, fz = Number(T.sum.freezes_left) || 0, lg = Number(T.sum.longest) || 0;
    return '<section class="b-card st-streak" id="stStreak"><div class="st-streak-l"><span class="st-flame' + (n ? '' : ' cold') + '">' + ic('flame', 20) + '</span><div><b>' + _esc(n === 0 ? t('noStreak') : n === 1 ? t('streak1') : t('streak', { n: fmt(n) })) + '</b><small>' + _esc(lg > n ? t('longest', { n: fmt(lg) }) : t('streakSub')) + '</small></div></div>' +
      '<button class="st-freeze' + (fz ? '' : ' none') + '" onclick="StepsTab.openSheet(\'freeze\')" aria-label="Streak freeze">' + ic('snowflake', 14) + _esc(fz === 0 ? t('noFreeze') : fz === 1 ? t('freeze', { n: 1 }) : t('freezes', { n: fz })) + '</button></section>';
  }
  function week() {
    const W = 358, BW = 28, slot = W / 7, top = 16, barH = 96, lblH = 20, H = top + barH + lblH;
    let h = '<section class="b-card st-week"><div class="st-week-head"><span class="b-eyebrow">' + (isHi() ? 'पिछले 7 दिन' : 'Last 7 days') + '</span>';
    const days = weekDays();
    if (days) { const met = days.filter(d => d && d.goalMet).length; h += '<span class="b-cap">' + met + '/7 ' + (isHi() ? 'लक्ष्य पूरे' : 'goals met') + '</span>'; }
    h += '</div><svg viewBox="0 0 ' + W + ' ' + H + '" aria-label="7-day steps">';
    const g = T.goal(); const vals = days ? days.map(d => Number(d.counted) || 0) : [0, 0, 0, 0, 0, 0, 0]; const max = Math.max(g * 1.15, ...vals, 1);
    const yOf = v => top + barH - clamp(v / max, 0, 1) * barH;
    const gy = yOf(g);
    h += '<line class="goal-line" x1="0" x2="' + W + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '"/><text class="goal-lbl" x="0" y="' + (gy - 5).toFixed(1) + '">' + (isHi() ? 'लक्ष्य ' : 'goal ') + fmt(g) + '</text>';
    for (let i = 0; i < 7; i++) {
      const x = slot * i + (slot - BW) / 2, d = days ? days[i] : null, v = vals[i], last = i === 6;
      const hh = days ? Math.max(v > 0 ? 6 : 3, barH - (yOf(v) - top)) : 3 + ((i * 37) % 50);
      const y = top + barH - hh;
      h += '<rect class="bar' + (d && d.goalMet ? ' met' : '') + (last && days ? ' today' : '') + (!days ? ' b-skel' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + BW + '" height="' + hh.toFixed(1) + '" rx="8"/>';
      if (days && last && v > 0) h += '<text class="val" x="' + (x + BW / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '">' + fmt(v) + '</text>';
      let lbl = ''; if (d && d.date) lbl = fmtKey(d.date, { weekday: isHi() ? 'short' : 'narrow' }).replace(/\.$/, '').slice(0, 2);
      h += '<text class="day' + (last ? ' today' : '') + '" x="' + (x + BW / 2).toFixed(1) + '" y="' + (H - 4) + '">' + _esc(lbl) + '</text>';
    }
    return h + '</svg></section>';
  }
  // Always exactly 7 entries ending today: match the server's entries by date key and fill gaps with empty days (a short or
  // unordered array must never produce NaN bars); if no dates match at all, right-align what we got.
  function weekDays() {
    const src = T.sum && Array.isArray(T.sum.week) ? T.sum.week.filter(d => d && typeof d === 'object') : [];
    if (!src.length) return null;
    const tk = todayKey(), byDate = {}; src.forEach(d => { if (keyDate(d.date)) byDate[d.date] = d; });
    const empty = k => ({ date: k, counted: 0, goalMet: false, empty: true });
    const out = []; let hits = 0;
    for (let i = 6; i >= 0; i--) { const k = keyShift(tk, -i); if (byDate[k]) hits++; out.push(byDate[k] || empty(k)); }
    if (hits) return out;
    const tail = src.slice(-7); const pad = []; for (let i = 7 - tail.length; i > 0; i--) pad.push(empty(keyShift(tk, -(tail.length + i - 1))));
    return pad.concat(tail);
  }
  function boardRow(r, rank, opts) {
    opts = opts || {}; const me = !!r.isMe; const rk = Math.max(0, Math.round(Number(rank || r.rank) || 0)); const stk = Math.max(0, Math.round(Number(r.streak) || 0));
    return '<div class="st-row' + (me ? ' me' : '') + (opts.sticky ? ' sticky' : '') + '" data-id="' + _esc(r.id || '') + '">' +
      (rk >= 1 && rk <= 3 ? '<span class="st-medal m' + rk + '">' + rk + '</span>' : '<span class="st-rank">' + (rk ? '#' + fmt(rk) : '·') + '</span>') + avatar(r) +
      '<div class="st-name"><b>' + _esc(me ? t('you') : r.name) + '</b><small>' + (stk ? '<span style="display:inline-flex;align-items:center;gap:2px;color:var(--b-primary)">' + ic('flame', 11) + fmt(stk) + '</span>' : '') + srcBadge(r.source, r.trust) + '</small></div>' +
      '<div class="st-steps">' + fmt(r.steps) + '<small>' + (T.board.period === 'week' ? (isHi() ? 'इस हफ़्ते' : 'this week') : (isHi() ? 'कदम' : 'steps')) + '</small></div>' +
      (me ? '<span></span>' : '<button class="st-more" onclick="StepsTab.openSheet(\'report\',' + jsStr(r.id || '') + ')" aria-label="Report">' + ic('more-horizontal', 18) + '</button>') + '</div>';
  }
  function board() {
    const key = T.board.scope + ':' + T.board.period, d = T.board.cache[key], loading = !d && (T.board.loading || !T.loaded);
    const hidden = s => { const c = T.board.cache[s + ':today'] || T.board.cache[s + ':week']; return c ? !!c.hidden : null; };
    let h = '<section class="b-card st-board" id="stBoard"><div class="st-board-head"><div><span class="b-eyebrow">' + (isHi() ? 'लीडरबोर्ड' : 'Leaderboard') + '</span><div class="b-h3">' + _esc(t(T.board.scope)) + '</div></div>' +
      '<div class="st-seg" role="tablist">' + ['today', 'week'].map(p => '<button role="tab" aria-selected="' + (T.board.period === p) + '" class="' + (T.board.period === p ? 'on' : '') + '" onclick="StepsTab.setPeriod(\'' + p + '\')">' + _esc(t(p)) + '</button>').join('') + '</div></div>';
    h += '<div class="st-scopes">' + ['friends', 'city', 'india'].map(s => { const hd = s !== 'friends' && hidden(s) === true; return '<button class="b-chip' + (T.board.scope === s ? ' on' : '') + '"' + (hd ? ' disabled title="' + _esc(t('opensAt')) + '"' : '') + ' onclick="StepsTab.setScope(\'' + s + '\')">' + _esc(t(s)) + (hd ? '<small>' + _esc(t('opensAt')) + '</small>' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="st-rows">';
    if (loading) { h += [0, 1, 2].map(() => '<div class="st-sk-row">' + skel('c') + skel('l') + skel('n') + '</div>').join(''); }
    else if (!d) { h += '<div class="st-board-empty"><p>' + (isHi() ? 'लीडरबोर्ड लोड नहीं हुआ।' : 'Could not load the leaderboard.') + '</p><button class="b-chip" onclick="StepsTab.loadBoard(true)">' + ic('refresh-cw', 14) + (isHi() ? 'फिर कोशिश' : 'Retry') + '</button></div>'; }
    else if (d.hidden) { h += '<div class="st-board-empty"><p>' + _esc(t('opensAt')) + (d.cohort != null ? ' · ' + fmt(d.cohort) + '/20' : '') + '</p><button class="b-btn move sm" onclick="StepsTab.openSheet(\'invite\')">' + ic('user-plus', 16) + _esc(t('invite')) + '</button></div>'; }
    else {
      const top = (d.top || []).slice(0, 3), ids = {}; top.forEach(r => { ids[r.id] = 1; });
      const around = (d.around || []).filter(r => !ids[r.id]); const all = top.concat(around);
      let meShown = false; all.forEach((r, i) => { if (r.isMe) meShown = true; h += boardRow(r, r.rank || i + 1, { sticky: r.isMe }); });
      if (!meShown && d.me) h += boardRow({ isMe: true, name: (_S().user && _S().user.name) || t('you'), hue: (T.sum && T.sum.hue) || 180, steps: d.me.steps, streak: d.me.streak, source: T.sum && T.sum.today && T.sum.today.source, trust: T.sum && T.sum.today && T.sum.today.trust }, d.me.rank, { sticky: true });
      if (all.length <= 1) h += '<div class="st-board-empty"><p>' + _esc(t('emptyP')) + '</p><button class="b-btn move sm" onclick="StepsTab.openSheet(\'invite\')">' + ic('user-plus', 16) + _esc(t('invite')) + '</button></div>';
    }
    h += '</div>';
    if (d && !d.hidden) h += '<div class="st-board-foot">' + ic('info', 12) + (d.provisional ? _esc(t('provisional')) : (T.board.scope === 'friends' ? (isHi() ? 'मैन्युअल कदम बोर्ड में नहीं गिने जाते' : 'Manual steps don’t count on boards') : (isHi() ? 'सिर्फ़ ऑटो-सिंक वाले' : 'Auto-synced walkers only'))) + '</div>';
    return h + '</section>';
  }
  function chips() {
    const on = T.walk.on;
    return '<nav class="st-chips" aria-label="Actions">' +
      '<button class="st-chip move' + (on ? ' on' : '') + '" onclick="StepsTab.' + (on ? 'walkStop' : 'walkStart') + '()"><span>' + ic('walk', 18) + '</span>' + _esc(on ? t('stop') : t('walkLearn')) + '</button>' +
      (T.stateNow() === 'bg' ? '<button class="st-chip on" onclick="StepsTab.pillTap()"><span>' + ic('zap', 18) + '</span>' + (isHi() ? 'ऑटो ✓' : 'Auto ✓') + '</button>' : '<button class="st-chip" onclick="StepsTab.pillTap()"><span>' + ic('smartphone', 18) + '</span>' + (isHi() ? 'ऑटो गिनती' : 'Auto-count') + '</button>') +
      '<button class="st-chip" onclick="StepsTab.openSheet(\'share\')"><span>' + ic('share', 18) + '</span>' + _esc(t('share')) + '</button>' +
      '<button class="st-chip" onclick="StepsTab.openSheet(\'goal\')"><span>' + ic('target', 18) + '</span>' + _esc(t('goal')) + '</button></nav>';
  }
  T.html = function () {
    let h = '<div class="st' + (isHi() ? ' hi' : '') + '" id="stRootIn">';
    h += '<header class="st-top"><span class="b-eyebrow"><i></i>' + (isHi() ? 'मूव' : 'Move') + ' · ' + _esc(dateLabel()) + '</span><div class="st-top-acts"><button class="icon-btn" onclick="StepsTab.openSheet(\'invite\')" aria-label="Invite">' + ic('user-plus', 20) + '</button></div></header>';
    h += hero() + walkCard() + podium() + streak() + week() + board() + chips();
    return h + '</div>';
  };
  T.miniCard = function () {
    const has = !!T.sum; const n = T.counted(), g = T.goal(); const fr = has && T.sum.friendsRank; const me = T.board.cache['friends:today'] && T.board.cache['friends:today'].me;
    let right;
    if (!has) right = '<span class="b-skel"></span>';
    else if (fr && Number(fr.rank) > 0) { const dl = me && Number(me.delta) || 0; right = '<b>#' + fmt(fr.rank) + '<small style="font:var(--t-cap);color:var(--b-mute)"> / ' + fmt(fr.of) + '</small></b><small class="' + (dl > 0 ? 'up' : dl < 0 ? 'dn' : '') + '">' + (dl > 0 ? '↑' + dl : dl < 0 ? '↓' + (-dl) : (isHi() ? 'दोस्तों में' : 'among friends')) + '</small>'; }
    else right = '<b>' + ic('user-plus', 16) + '</b><small>' + _esc(t('invite')) + '</small>';
    return '<button class="st-mini" onclick="StepsTab.go()"><span class="st-ring">' + T.ringSVG(has ? T.pct() : 0, 56, { stroke: 6 }) + '<span class="st-mini-ic">' + ic('footprints', 18) + '</span></span><span class="st-mini-t"><span class="b-eyebrow">' + (isHi() ? 'कदम · आज' : 'Steps · today') + '</span>' + (has ? '<b>' + fmt(n) + '<small>/ ' + fmt(g) + '</small></b>' : skel('', '90px', '20px')) + '</span><span class="st-mini-r">' + right + '</span></button>';
  };
  T.go = function () { hap('light'); if (typeof switchTab === 'function') switchTab('steps'); };

  // ───────────────────────── sheets (.b-sheet from theme.css, mounted on body so re-renders keep them) ─────────────────────────
  const sh = (title, sub) => '<div class="st-sheet-h"><div><h2 class="b-h2" id="stSheetTitle">' + _esc(title) + '</h2>' + (sub ? '<p id="stSheetSub">' + _esc(sub) + '</p>' : '') + '</div><button class="icon-btn" onclick="StepsTab.closeSheet()" aria-label="' + (isHi() ? 'बंद करें' : 'Close') + '">' + ic('x', 20) + '</button></div>';
  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const sheetDialog = () => document.querySelector('#stSheet [role=dialog]');
  const focusables = d => Array.from(d.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
  // Esc closes; Tab/Shift+Tab stay inside the dialog (focus trap)
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); T.closeSheet(); return; }
    if (e.key !== 'Tab') return; const d = sheetDialog(); if (!d) return;
    const f = focusables(d); if (!f.length) { e.preventDefault(); d.focus(); return; }
    const first = f[0], last = f[f.length - 1], inside = d.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === d)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  };
  const focusSig = el => el ? (el.id || '') + '|' + (el.getAttribute('onclick') || '') + '|' + (el.getAttribute('aria-label') || '') + '|' + (el.getAttribute('type') || '') : '';
  const safeFocus = el => { try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} } };
  T.openSheet = function (kind, arg) {
    hap('light');
    if (kind === 'manual') T.manual = { value: '', app: T.manual.app || 'googlefit', date: 'today', saving: false };
    if (kind === 'goal') T.goalDraft = null;
    if (kind === 'enable') { stopEnablePoll(); T.enable.failed = false; }
    T.sheet = { kind, arg };
    let w = document.getElementById('stSheet');
    if (!w) {
      T._sheetReturn = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      try { T._bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; } catch (e) {}
      w = document.createElement('div'); w.id = 'stSheet'; w.className = 'st-sheet-wrap';
      w.innerHTML = '<div class="b-sheet-bg" onclick="StepsTab.closeSheet()"></div><div class="b-sheet st-sheet" role="dialog" aria-modal="true" aria-labelledby="stSheetTitle" aria-describedby="stSheetSub" tabindex="-1"><div class="b-sheet-grab"></div><div id="stSheetBody"></div></div>';
      document.body.appendChild(w); document.addEventListener('keydown', onKey);
    }
    T.renderSheet();
    const d = sheetDialog(); if (d && !d.contains(document.activeElement)) safeFocus(d);
    if (kind === 'ios' && !T.ios.token && !T.ios.busy) T.iosToken();
    if (kind === 'invite' && !(T.sum && T.sum.invite && T.sum.invite.code) && !T.invite) _api('/me/invite').then(r => { if (r && r.code) { T.invite = r; T.renderSheet(); } });
    if (kind === 'share') T.drawPreviews();
  };
  T.closeSheet = function () {
    const w = document.getElementById('stSheet'); if (w) w.remove(); document.removeEventListener('keydown', onKey); T.sheet = null;
    if (T.ios.poll) { clearInterval(T.ios.poll); T.ios.poll = null; } T.ios.test = null; stopEnablePoll();
    try { document.body.style.overflow = T._bodyOverflow || ''; } catch (e) {}
    const back = T._sheetReturn; T._sheetReturn = null; if (back && document.contains(back)) safeFocus(back);
  };
  // re-render keeps keyboard focus on the "same" control (keypad, chips…) or falls back to the dialog itself
  T.renderSheet = function () {
    const b = document.getElementById('stSheetBody'); if (!b || !T.sheet) return;
    const d = sheetDialog(); const act = document.activeElement; const had = d && act && d.contains(act) && act !== d; const sig = had ? focusSig(act) : '';
    b.innerHTML = sheetHTML(T.sheet.kind, T.sheet.arg);
    if (!d) return;
    if (had) { const again = Array.from(d.querySelectorAll(FOCUSABLE)).find(el => focusSig(el) === sig); safeFocus(again || d); }
    else if (!d.contains(document.activeElement)) safeFocus(d);
  };
  function sheetHTML(kind, arg) {
    switch (kind) {
      case 'enable': return sheetEnable();
      case 'manual': return sheetManual();
      case 'invite': return sheetInvite();
      case 'ios': return sheetIOS();
      case 'goal': return sheetGoal();
      case 'share': return sheetShare();
      case 'report': return sheetReport(arg);
      case 'freeze': return sheetFreeze();
      default: return sh(kind);
    }
  }
  const hi = isHi;
  // Enable (Android TWA / Play)
  function sheetEnable() {
    const st = T.stateNow(); const enable = st === 'enable' || (st === 'walk' && isTWA());
    let h = sh(enable ? (hi() ? 'बैकग्राउंड में कदम गिनें' : 'Count steps in the background') : (hi() ? 'Brodoit ऐप लें' : 'Get the Brodoit app'), enable ? (hi() ? 'ऐप बंद होने पर भी पूरे दिन गिनती — बैटरी पर असर नहीं।' : 'Counts all day, even with the app closed. Nothing to remember.') : (hi() ? 'Android ऐप आपके कदम अपने आप सिंक करता है।' : 'The Android app syncs your steps automatically.'));
    h += '<ul class="st-why"><li><span>' + ic('zap', 18) + '</span>' + (hi() ? 'फ़ोन का स्टेप सेंसर — बैटरी नहीं खाता' : 'Uses the phone’s step sensor — no battery drain') + '</li><li><span>' + ic('trophy', 18) + '</span>' + (hi() ? 'दोस्तों के बोर्ड पर असली सैर गिनती है' : 'Real walks count on the friends board') + '</li><li><span>' + ic('info', 18) + '</span>' + (hi() ? 'निजी: सिर्फ़ रोज़ का कुल सिंक होता है' : 'Private: only your daily total is synced') + '</li></ul>';
    if (!enable) {
      const A = T.android || {};
      if (A.ready) h += '<div class="st-actions"><a class="b-btn wide" style="background:#17141F;box-shadow:0 4px 0 0 #000" href="/download/brodoit.apk" onclick="StepsTab.hapOnly()">' + ic('download', 18) + (hi() ? 'Brodoit ऐप इंस्टॉल करें' : 'Install Brodoit for Android') + '</a><p class="st-foot">' + (hi() ? 'v' + _esc(A.version) + ' · मुफ़्त · Install → Open → Allow' : 'v' + _esc(A.version) + ' · free · Install → Open → Allow') + '</p></div>';
      else if (A.loaded) h += '<div class="st-test">' + ic('info', 16) + (hi() ? 'Android ऐप अभी बन रहा है — कुछ मिनट में फिर देखें।' : 'The Android app is being built — check again in a few minutes.') + '</div><div class="st-actions"><button class="b-btn ghost wide" onclick="StepsTab.closeSheet()">' + (hi() ? 'ठीक है' : 'OK') + '</button></div>';
      else { h += '<div class="st-test"><span class="st-spin"></span>' + (hi() ? 'देख रहे हैं…' : 'Checking…') + '</div>'; T.loadAndroid(); }
      h += '<div class="st-actions"><button class="b-btn ghost wide" onclick="StepsTab.openSheet(\'manual\')">' + (hi() ? 'आज के कदम ख़ुद लिखें' : 'Or log today by hand') + '</button></div>';
      return h;
    }
    const E = T.enable;
    if (E.busy) h += '<div class="st-test" id="stEnableWait" role="status"><span class="st-spin"></span>' + (hi() ? 'ऐप से पहला सिंक आने का इंतज़ार…' : 'Waiting for the app’s first sync…') + '<span style="margin-left:auto;font-variant-numeric:tabular-nums">' + E.left + 's</span></div><div class="st-actions"><button class="b-btn ghost wide" onclick="StepsTab.enableCancel()">' + (hi() ? 'रद्द करें' : 'Cancel') + '</button></div>';
    else if (E.failed) {
      h += '<div class="st-test" id="stEnableFail">' + ic('info', 16) + (hi() ? 'अभी कुछ सिंक नहीं हुआ।' : 'Nothing synced yet.') + '</div>';
      h += '<ol class="st-steps-list" id="stEnableHow"><li><div><b>' + (hi() ? 'ऐप को अनुमति दें' : 'Allow the app') + '</b><p>' + (hi() ? 'Android Settings → Apps → Brodoit → Permissions → Physical activity → Allow।' : 'Android Settings → Apps → Brodoit → Permissions → Physical activity → Allow.') + '</p></div></li><li><div><b>' + (hi() ? 'वापस आएँ' : 'Come back here') + '</b><p>' + (hi() ? 'पहला सिंक कुछ मिनट में आता है — फिर यह पिल “ऑटो-सिंक चालू” दिखाएगी।' : 'The first sync lands within a few minutes — this pill then reads “Auto-syncing”.') + '</p></div></li></ol>';
      h += '<div class="st-actions"><button class="b-btn move wide" id="stEnableBtn" onclick="StepsTab.enableTap()">' + ic('refresh-cw', 18) + (hi() ? 'फिर जाँचें' : 'Check again') + '</button><button class="b-btn ghost wide" onclick="StepsTab.enableWalk()">' + ic('walk', 18) + (hi() ? 'अभी Bro के साथ चलें' : 'Walk with Bro instead') + '</button><button class="b-btn ghost wide" onclick="StepsTab.openSheet(\'manual\')">' + ic('plus', 18) + (hi() ? 'कदम मैन्युअल लॉग करें' : 'Log steps manually') + '</button></div>';
    }
    else h += '<div class="st-actions"><button class="b-btn move wide" id="stEnableBtn" onclick="StepsTab.enableTap()">' + ic('check', 18) + (hi() ? 'चालू करें' : 'Turn on') + '</button><button class="b-btn ghost wide" onclick="StepsTab.closeSheet()">' + (hi() ? 'अभी नहीं' : 'Not now') + '</button></div>';
    return h;
  }
  T.hapOnly = () => hap('medium');
  T.loadAndroid = async function () { if (T._androidP) return T._androidP; T._androidP = fetch('/api/android/status', { cache: 'no-store' }).then(r => r.json()).then(j => { T.android = Object.assign({ loaded: true }, j || {}); }).catch(() => { T.android = { loaded: true, ready: false }; }).finally(() => { T._androidP = null; if (T.sheet && T.sheet.kind === 'enable') T.renderSheet(); }); return T._androidP; };
  // "Turn on" (inside the Android app, no bound device yet). There is no deep link for this: the native wrapper is asked through
  // any bridge it exposes (JS interface or a DOM event), a claim pair handed over on the URL is redeemed, and then the summary
  // is polled for state 'bg'. Success closes the sheet with a toast; a timeout shows what to do next — never a silent close.
  const nativeBridge = () => { for (const k of ['BrodoitNative', 'Brodoit', 'AndroidBridge', 'Android']) { const b = window[k]; if (b && typeof b === 'object') for (const fn of ['enableSteps', 'requestSteps', 'startStepSync', 'requestActivityPermission']) if (typeof b[fn] === 'function') return () => b[fn](); } return null; };
  function stopEnablePoll() { if (T.enable.poll) { clearInterval(T.enable.poll); T.enable.poll = null; } T.enable.busy = false; }
  T.enableTap = async function () {
    if (T.enable.busy) return; hap('medium');
    let asked = false; try { const fn = nativeBridge(); if (fn) { fn(); asked = true; } } catch (e) {}
    if (!asked && isTWA()) { try { location.href = 'intent://enable#Intent;scheme=brodoit;package=com.brodoit.app;S.browser_fallback_url=' + encodeURIComponent(location.origin + '/android') + ';end'; asked = true; } catch (e) {} }
    try { document.dispatchEvent(new CustomEvent('brodoit:enable-steps', { bubbles: true })); } catch (e) {}
    try { window.postMessage({ type: 'brodoit:enable-steps' }, location.origin); } catch (e) {}
    const claimed = await claimFromURL();
    const E = T.enable; E.busy = true; E.failed = false; E.left = E.timeout ? Math.max(3, Math.round(E.timeout / 1000)) : (asked || claimed ? 45 : 30); T.renderSheet();
    const start = Date.now(), total = E.left;
    E.poll = setInterval(async () => {
      if (!E.busy) return; E.left = Math.max(0, total - Math.round((Date.now() - start) / 1000));
      if (E.left % 3 === 0 || E.left === 0) { const r = await _api('/steps/summary?twa=1'); if (r && !r.error && r.state === 'bg') { T.sum = r; T.failed = false; stopEnablePoll(); hap('success'); _toast(hi() ? 'स्टेप काउंट चालू — अब अपने आप सिंक होगा' : 'Step counting is on — syncing automatically'); if (T.sheet && T.sheet.kind === 'enable') T.closeSheet(); T.rerender(); return; } }
      if (E.left <= 0) { stopEnablePoll(); E.failed = true; hap('error'); T.renderSheet(); return; }
      const el = document.querySelector('#stEnableWait span[style]'); if (el) el.textContent = E.left + 's'; else T.renderSheet();
    }, 1000);
  };
  T.enableCancel = function () { hap('light'); stopEnablePoll(); T.enable.failed = false; T.renderSheet(); };
  T.enableWalk = function () { T.closeSheet(); T.walkStart(); };
  // The wrapper may launch the web app with ?device_id=…&ct=… after registering its step sensor: bind it to this account once.
  function claimFromURL() {
    if (T._claimP) return T._claimP;
    T._claimP = (async () => {
      let q; try { q = new URLSearchParams(location.search || ''); } catch (e) { return false; }
      let id = q.get('device_id'), ct = q.get('ct');
      if (!id || !ct) { try { const st = JSON.parse(localStorage.getItem('bd_pending_claim') || 'null'); if (st && st.id && st.ct) { id = st.id; ct = st.ct; } } catch (e) {} }
      if (!id || !ct) return false;
      const tag = 'bd_claimed:' + id; try { if (sessionStorage.getItem(tag)) return false; } catch (e) {}
      if (!((typeof token !== 'undefined' && token) || _S().user)) { try { localStorage.setItem('bd_pending_claim', JSON.stringify({ id, ct })); } catch (e) {} return false; }
      const r = await _api('/steps/device/claim', { method: 'POST', body: JSON.stringify({ device_id: id, ct }) });
      if (r && !r.error) { try { sessionStorage.setItem(tag, '1'); localStorage.removeItem('bd_pending_claim'); } catch (e) {} try { q.delete('device_id'); q.delete('ct'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) {} return true; }
      if (r && r.error) _toast(r.error, 'err');
      return false;
    })().catch(() => false).finally(() => { T._claimP = null; });
    return T._claimP;
  }
  // Manual entry
  const APPS = [['googlefit', 'Google Fit'], ['samsung', 'Samsung Health'], ['apple', 'Apple Health'], ['mi', 'Mi Fitness'], ['fitbit', 'Fitbit'], ['other', hi() ? 'अन्य' : 'Other']];
  function sheetManual() {
    const m = T.manual, v = Number(m.value) || 0, over = v > 20000;
    let h = sh(hi() ? 'कदम लॉग करें' : 'Log steps', hi() ? 'अपने फ़ोन या घड़ी के ऐप से आज की संख्या।' : 'Today’s count from your phone or watch app.');
    h += '<div class="st-seg" style="justify-self:center">' + [['today', hi() ? 'आज' : 'Today'], ['yesterday', hi() ? 'कल' : 'Yesterday']].map(x => '<button class="' + (m.date === x[0] ? 'on' : '') + '" onclick="StepsTab.manualDate(\'' + x[0] + '\')">' + x[1] + '</button>').join('') + '</div>';
    h += '<div class="st-keyval' + (over ? ' over' : '') + '" id="stKeyVal">' + (v ? fmt(v) : '0') + '<small>' + (over ? (hi() ? 'अधिकतम 20,000 प्रति दिन' : 'Max 20,000 a day') : (hi() ? 'कदम' : 'steps')) + '</small></div>';
    h += '<div class="st-keys">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => '<button onclick="StepsTab.key(\'' + k + '\')">' + k + '</button>').join('') + '<button class="fn" onclick="StepsTab.key(\'000\')">000</button><button onclick="StepsTab.key(\'0\')">0</button><button class="fn" onclick="StepsTab.key(\'back\')" aria-label="Delete">' + ic('x', 18) + '</button></div>';
    h += '<div class="st-lbl">' + (hi() ? 'किस ऐप से?' : 'From which app?') + '</div><div class="st-chiprow">' + APPS.map(a => '<button class="b-chip' + (m.app === a[0] ? ' on' : '') + '" onclick="StepsTab.manualApp(\'' + a[0] + '\')">' + a[1] + '</button>').join('') + '</div>';
    h += '<div class="st-note">' + ic('info', 14) + (hi() ? 'आपके लक्ष्य में गिनती है, बोर्ड में नहीं' : 'Counts for your goal, not boards') + '</div>';
    h += '<button class="b-btn move wide" id="stManualSave" onclick="StepsTab.manualSave()"' + (!v || over || m.saving ? ' disabled style="opacity:.5"' : '') + '>' + (m.saving ? '<span class="st-spin"></span>' : ic('check', 18)) + (hi() ? 'सेव करें' : 'Save') + '</button>';
    return h;
  }
  T.key = function (k) { hap('light'); let v = T.manual.value || ''; if (k === 'back') v = v.slice(0, -1); else if (v.length < 6) v = (v + k).replace(/^0+(?=\d)/, '').slice(0, 6); T.manual.value = v; T.renderSheet(); };
  T.manualApp = function (a) { hap('light'); T.manual.app = a; T.renderSheet(); };
  T.manualDate = function (d) { hap('light'); T.manual.date = d; T.renderSheet(); };
  T.manualSave = async function () {
    const m = T.manual, v = Number(m.value) || 0; if (!v || v > 20000 || m.saving) return;
    m.saving = true; T.renderSheet(); hap('medium');
    const body = { count: v, source: 'manual', app: m.app }; if (m.date === 'yesterday') body.date = dayKey(new Date(Date.now() - 86400000));
    const r = await _api('/steps', { method: 'POST', body: JSON.stringify(body) });
    m.saving = false;
    if (!r || r.error) { T.renderSheet(); _toast((r && r.error) || (hi() ? 'सेव नहीं हुआ' : 'Could not save'), 'err'); hap('error'); return; }
    if (r.today) { T.sum = Object.assign({}, T.sum || {}, r); }
    hap('success'); if (window.Motion && T.counted() >= T.goal()) Motion.confetti(); _toast(hi() ? fmt(v) + ' कदम लॉग हुए' : 'Logged ' + fmt(v) + ' steps'); T.closeSheet(); T.rerender(); T.loadBoard(true);
  };
  // Invite
  const inviteData = () => (T.sum && T.sum.invite && T.sum.invite.code) ? T.sum.invite : T.invite;
  const inviteURL = inv => (inv && inv.url) || (location.origin + '/join/' + (inv && inv.code || ''));
  const inviteMsg = inv => (hi() ? 'Brodoit पर मेरे साथ चलो! मेरा कोड ' + inv.code + ' — ' : 'Walk with me on Brodoit! My code is ' + inv.code + ' — ') + inviteURL(inv);
  function sheetInvite() {
    const inv = inviteData();
    let h = sh(t('invite'), hi() ? 'वे आपके कोड से जुड़ते हैं — फिर दोनों एक-दूसरे को बोर्ड पर देखते हैं।' : 'They join with your code; you both show up on each other’s board.');
    if (!inv) { h += '<div style="display:grid;justify-items:center;gap:12px">' + skel('', '168px', '168px') + skel('', '200px', '48px') + '</div>'; }
    else {
      const url = inviteURL(inv), qr = QR.svg(url);
      if (qr) h += '<div class="st-qr">' + qr + '</div>';
      h += '<div class="st-code" id="stCode">' + _esc(inv.code) + '<button class="icon-btn" onclick="StepsTab.copy(\'code\')" aria-label="Copy code" style="margin-left:8px">' + ic('copy', 18) + '</button></div>';
      h += '<div class="st-url">' + _esc(url.replace(/^https?:\/\//, '')) + '</div>';
      h += '<div class="st-actions two"><a class="b-btn st-wa" id="stWa" href="https://wa.me/?text=' + encodeURIComponent(inviteMsg(inv)) + '" target="_blank" rel="noopener" onclick="StepsTab.hapOnly()">' + ic('message-circle', 18) + 'WhatsApp</a>' +
        (navigator.share ? '<button class="b-btn move" onclick="StepsTab.shareInvite()">' + ic('share', 18) + (hi() ? 'शेयर' : 'Share') + '</button>' : '<button class="b-btn ghost" onclick="StepsTab.copy(\'link\')">' + ic('link', 18) + (hi() ? 'लिंक कॉपी' : 'Copy link') + '</button>') + '</div>';
    }
    h += '<div class="st-lbl" style="margin-top:4px">' + (hi() ? 'कोड मिला है?' : 'Have a friend’s code?') + '</div><form class="st-inline" onsubmit="event.preventDefault();StepsTab.addCode()"><input class="st-input sm" id="stCodeIn" maxlength="8" placeholder="ABC123" autocomplete="off" autocapitalize="characters"><button class="b-btn move sm" type="submit">' + ic('plus', 16) + (hi() ? 'जोड़ें' : 'Add') + '</button></form>';
    const fr = T.friends && T.friends.friends || [];
    if (fr.length) { h += '<div class="st-lbl">' + _esc(t('friends')) + ' · ' + fr.length + '</div><div>' + fr.map(f => { const stk = Math.max(0, Math.round(Number(f.streak) || 0)); return '<div class="st-friend">' + avatar(f) + '<b>' + _esc(f.name) + '</b><small>' + fmt(f.today) + ' ' + (hi() ? 'आज' : 'today') + (stk ? ' · ' + fmt(stk) + 'd' : '') + '</small><button class="st-more" onclick="StepsTab.removeFriend(' + jsStr(f.id) + ')" aria-label="' + _esc((hi() ? 'हटाएँ ' : 'Remove ') + (f.name || '')) + '">' + ic('x', 16) + '</button></div>'; }).join('') + '</div>'; }
    return h;
  }
  T.copy = async function (what) {
    const inv = inviteData(); if (!inv) return; const txt = what === 'code' ? inv.code : inviteURL(inv);
    let ok = false; try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e2) {} }
    hap(ok ? 'success' : 'error'); _toast(ok ? (hi() ? 'कॉपी हो गया' : 'Copied') : (hi() ? 'कॉपी नहीं हुआ' : 'Could not copy'), ok ? undefined : 'err');
  };
  T.shareInvite = async function () { const inv = inviteData(); if (!inv) return; hap('medium'); try { await navigator.share({ title: 'Brodoit', text: inviteMsg(inv), url: inviteURL(inv) }); _api('/share', { method: 'POST', body: JSON.stringify({ kind: 'invite' }) }); } catch (e) {} };
  T.addCode = async function () {
    const el = document.getElementById('stCodeIn'); const code = (el && el.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!code) return;
    hap('medium'); const r = await _api('/friends/code', { method: 'POST', body: JSON.stringify({ code }) });
    if (!r || r.error) { hap('error'); _toast((r && r.error) || (hi() ? 'कोड नहीं मिला' : 'Code not found'), 'err'); return; }
    hap('success'); _toast(hi() ? 'दोस्त जुड़ गया!' : 'Friend added!'); if (el) el.value = ''; await T.loadFriends(); T.renderSheet(); T.rerender();
  };
  T.removeFriend = async function (id) {
    const f = ((T.friends && T.friends.friends) || []).find(x => x && x.id === id); const name = f && f.name || '';
    if (!confirm((hi() ? 'हटाएँ ' : 'Remove ') + name + '?')) return;
    const r = await _api('/friends/' + encodeURIComponent(id), { method: 'DELETE' }); if (!r || r.error) { _toast((r && r.error) || (hi() ? 'नहीं हटा' : 'Could not remove'), 'err'); return; }
    hap('light'); await T.loadFriends(); T.renderSheet(); T.rerender();
  };
  // iOS shortcut setup
  function sheetIOS() {
    const ep = location.origin + '/api/steps/shortcut', tk = T.ios.token, ts = T.ios.test;
    let h = sh(hi() ? 'iPhone से सिंक' : 'Sync from iPhone', hi() ? 'एक Shortcut आपके Health कदम Brodoit को भेजता है — ऐप की ज़रूरत नहीं।' : 'A Shortcut sends your Health steps to Brodoit — no app needed.');
    h += '<ol class="st-steps-list"><li><div><b>' + (hi() ? 'Shortcut बनाएँ' : 'Build the shortcut') + '</b><p>' + (hi() ? 'Shortcuts ऐप → + → “Find Health Samples” (Steps, आज) → “Get Contents of URL” (POST)। URL:' : 'Shortcuts app → + → “Find Health Samples” (Steps, today) → “Get Contents of URL” (POST). URL:') + '</p><div class="st-token"><span>' + _esc(ep) + '</span><button class="icon-btn" onclick="StepsTab.copyText(' + jsStr(ep) + ')" aria-label="Copy URL">' + ic('copy', 16) + '</button></div></div></li>';
    h += '<li><div><b>' + (hi() ? 'अपना टोकन जोड़ें' : 'Add your token') + '</b><p>' + (hi() ? 'Header: Authorization = Bearer <टोकन>; Body JSON: count = कदम' : 'Header Authorization = Bearer ‹token›; JSON body: count = steps') + '</p>' +
      (T.ios.busy ? '<div class="st-test"><span class="st-spin"></span>' + (hi() ? 'टोकन बन रहा है…' : 'Creating token…') + '</div>' : tk ? '<div class="st-token" id="stIosToken"><span>' + _esc(tk) + '</span><button class="icon-btn" onclick="StepsTab.copyText(' + jsStr(tk) + ')" aria-label="Copy token">' + ic('copy', 16) + '</button></div>' : '<button class="b-chip" onclick="StepsTab.iosToken()">' + ic('refresh-cw', 14) + (hi() ? 'टोकन बनाएँ' : 'Create token') + '</button>') +
      (tk ? '<div class="st-chiprow" style="margin-top:8px;align-items:center"><button class="b-chip" onclick="StepsTab.iosToken(true)">' + ic('refresh-cw', 14) + (hi() ? 'नया टोकन' : 'Regenerate') + '</button><span class="b-cap">' + (hi() ? 'नया टोकन पुराने को बंद कर देता है।' : 'A new token revokes the old one.') + '</span></div>' : '') + '</div></li>';
    h += '<li><div><b>' + (hi() ? 'एक बार चलाएँ, फिर ऑटोमेट करें' : 'Run once, then automate') + '</b><p>' + (hi() ? 'Automation → Time of Day → रोज़ 9 pm → यह shortcut। बिना पूछे चलने दें।' : 'Automation → Time of Day → daily 9 pm → this shortcut. Allow it to run without asking.') + '</p></div></li></ol>';
    if (ts && ts.ok) h += '<div class="st-test ok">' + ic('check', 16) + (hi() ? 'iPhone से ' + fmt(ts.count) + ' कदम मिले!' : 'Got ' + fmt(ts.count) + ' steps from your iPhone!') + '</div>';
    else if (ts && ts.waiting) h += '<div class="st-test"><span class="st-spin"></span>' + (hi() ? 'सुन रहे हैं… अब shortcut चलाएँ' : 'Listening… run the shortcut now') + ' <span style="margin-left:auto;font-variant-numeric:tabular-nums">' + ts.left + 's</span></div>';
    else if (ts && ts.timeout) h += '<div class="st-test">' + ic('info', 16) + (hi() ? 'कुछ नहीं आया। टोकन और URL जाँचें।' : 'Nothing arrived yet. Check the token and URL.') + '</div>';
    h += '<button class="b-btn violet wide" onclick="StepsTab.iosTest()"' + (ts && ts.waiting ? ' disabled style="opacity:.6"' : '') + '>' + ic('zap', 18) + (hi() ? 'अभी टेस्ट करें' : 'Test now') + '</button>';
    return h;
  }
  T.copyText = async function (txt) { let ok = false; try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) {} hap(ok ? 'success' : 'error'); _toast(ok ? (hi() ? 'कॉपी हो गया' : 'Copied') : (hi() ? 'कॉपी नहीं हुआ' : 'Could not copy'), ok ? undefined : 'err'); };
  T.iosToken = async function (force) {
    if (T.ios.busy) return; if (T.ios.token && !force) return; T.ios.busy = true; T.renderSheet();
    const r = await _api('/steps/shortcut/token', { method: 'POST', body: '{}' });
    T.ios.busy = false; if (r && r.token) T.ios.token = r.token; else _toast((r && r.error) || (hi() ? 'टोकन नहीं बना' : 'Could not create token'), 'err');
    T.renderSheet();
  };
  T.iosTest = function () {
    if (T.ios.poll) clearInterval(T.ios.poll); hap('medium');
    const start = Date.now(), base = T.sum && T.sum.today && T.sum.today.synced_at; let left = 60;
    T.ios.test = { waiting: true, left }; T.renderSheet();
    T.ios.poll = setInterval(async () => {
      left = Math.max(0, 60 - Math.round((Date.now() - start) / 1000)); if (T.ios.test) T.ios.test.left = left;
      if (left % 3 === 0 || left === 0) { const r = await _api('/steps/summary' + (isTWA() ? '?twa=1' : '')); if (r && r.today && (r.today.source === 'shortcut' && r.today.synced_at !== base)) { T.sum = r; T.ios.test = { ok: true, count: r.today.counted }; clearInterval(T.ios.poll); T.ios.poll = null; hap('success'); T.renderSheet(); T.rerender(); return; } }
      if (left <= 0) { clearInterval(T.ios.poll); T.ios.poll = null; T.ios.test = { timeout: true }; T.renderSheet(); return; }
      const el = document.querySelector('.st-test span[style]'); if (el) el.textContent = left + 's'; else T.renderSheet();
    }, 1000);
  };
  // Goal
  function sheetGoal() {
    const g = T.goal(), d = T.goalDraft; const presets = [[6000, hi() ? 'आसान' : 'Easy'], [8000, hi() ? 'संतुलित' : 'Balanced'], [10000, hi() ? 'कड़ा' : 'Strong']];
    let h = sh(hi() ? 'रोज़ का लक्ष्य' : 'Daily goal', hi() ? '7–10 हज़ार अच्छा है। वह चुनें जो ज़्यादातर दिन पूरा हो।' : 'WHO suggests 7–10k. Pick what you can hit most days.');
    h += '<div class="st-goals">' + presets.map(p => '<button class="' + (g === p[0] && d == null ? 'on' : '') + '" onclick="StepsTab.setGoal(' + p[0] + ')">' + fmt(p[0]) + '<small>' + p[1] + '</small></button>').join('') + '</div>';
    h += '<div class="st-lbl">' + (hi() ? 'कस्टम' : 'Custom') + '</div><form class="st-inline" novalidate onsubmit="event.preventDefault();StepsTab.setGoal()"><input class="st-input" id="stGoalIn" type="number" inputmode="numeric" min="500" max="100000" step="500" placeholder="' + fmt(g) + '" value="' + (d != null ? d : '') + '"><button class="b-btn move" type="submit">' + ic('check', 18) + (hi() ? 'सेट' : 'Set') + '</button></form>';
    h += '<div class="st-note">' + ic('info', 14) + (hi() ? 'स्ट्रीक रोज़ के लक्ष्य से गिनती है' : 'Your streak counts days you hit this goal') + '</div>';
    return h;
  }
  T.setGoal = async function (g) {
    if (g == null) { const el = document.getElementById('stGoalIn'); g = Number(el && el.value); }
    g = Math.round(Number(g) || 0); if (g < 500 || g > 100000) { hap('error'); _toast(hi() ? '500 से 1,00,000 के बीच' : 'Between 500 and 1,00,000', 'err'); return; }
    hap('medium'); const r = await _api('/steps/goal', { method: 'PUT', body: JSON.stringify({ goal: g }) });
    if (!r || r.error) { hap('error'); _toast((r && r.error) || (hi() ? 'सेव नहीं हुआ' : 'Could not save'), 'err'); return; }
    T.sum = Object.assign({}, T.sum || {}, r.today ? r : { goal: g }); if (!r.today) T.sum.goal = g; hap('success'); _toast(hi() ? 'लक्ष्य: ' + fmt(g) : 'Goal set to ' + fmt(g)); T.closeSheet(); T.rerender();
  };
  // Share
  function sheetShare() {
    const can = !!navigator.share;
    let h = sh(t('share'), hi() ? 'स्टोरी या चैट के लिए कार्ड।' : 'A card for your story or chat.');
    h += '<div class="st-share-prev"><figure><canvas id="stPrevStory" width="270" height="480"></canvas><figcaption>Story · 9:16</figcaption><button class="b-btn move sm" onclick="StepsTab.share(\'story\')">' + ic(can ? 'share' : 'download', 16) + (can ? (hi() ? 'शेयर' : 'Share') : (hi() ? 'सेव' : 'Save')) + '</button></figure><figure><canvas id="stPrevSquare" width="270" height="270"></canvas><figcaption>Square · 1:1</figcaption><button class="b-btn move sm" onclick="StepsTab.share(\'square\')">' + ic(can ? 'share' : 'download', 16) + (can ? (hi() ? 'शेयर' : 'Share') : (hi() ? 'सेव' : 'Save')) + '</button></figure></div>';
    h += '<div class="st-note">' + ic('info', 14) + (hi() ? 'आपका कोड कार्ड पर है — दोस्त स्कैन या टाइप करके जुड़ सकते हैं' : 'Your invite code is on the card — friends can join by typing it') + '</div>';
    return h;
  }
  // Report
  const findRow = id => { for (const k in T.board.cache) { const d = T.board.cache[k]; if (!d) continue; const r = (d.top || []).concat(d.around || []).find(x => x.id === id); if (r) return r; } return null; };
  function sheetReport(id) {
    const r = findRow(id) || { id, name: '?', hue: 20 };
    let h = sh((hi() ? 'रिपोर्ट करें: ' : 'Report ') + (r.name || ''), hi() ? 'रिपोर्ट गुमनाम हैं। 3 रिपोर्ट पर वॉकर बोर्ड से हट जाता है।' : 'Reports are anonymous. Three reports hide a walker from boards.');
    h += '<div class="st-report-target">' + avatar(r) + '<div><b style="font:var(--t-h3);color:var(--b-ink)">' + _esc(r.name || '') + '</b><div class="b-cap">' + fmt(r.steps) + ' ' + (hi() ? 'कदम' : 'steps') + ' · ' + srcLabel(r.source) + '</div></div></div>';
    h += '<div class="st-actions">' + [['fake', hi() ? 'गिनती असली नहीं लगती' : 'Steps look fake'], ['bot', hi() ? 'असली व्यक्ति नहीं' : 'Not a real person'], ['other', hi() ? 'कुछ और' : 'Something else']].map(x => '<button class="b-btn ghost wide" onclick="StepsTab.report(' + jsStr(id) + ',\'' + x[0] + '\')">' + ic('flag', 16) + x[1] + '</button>').join('') + '</div>';
    return h;
  }
  T.report = async function (id, reason) {
    hap('medium'); const r = await _api('/steps/report', { method: 'POST', body: JSON.stringify({ id, reason }) });
    if (!r || r.error) { hap('error'); _toast((r && r.error) || (hi() ? 'रिपोर्ट नहीं हुई' : 'Could not report'), 'err'); return; }
    hap('success'); _toast(hi() ? 'धन्यवाद — हम देखेंगे' : 'Thanks — we’ll take a look'); T.closeSheet();
  };
  // Freeze
  function sheetFreeze() {
    const fz = (T.sum && Number(T.sum.freezes_left)) || 0, n = (T.sum && Number(T.sum.streak)) || 0;
    let h = sh(hi() ? 'स्ट्रीक फ़्रीज़' : 'Streak freeze', hi() ? 'एक दिन छूट जाए तो फ़्रीज़ आपकी स्ट्रीक बचाता है। हर हफ़्ते 1 मिलता है।' : 'Miss a day and a freeze keeps your streak alive. You get one each week.');
    h += '<div class="st-note">' + ic('snowflake', 14) + (fz ? (hi() ? fz + ' फ़्रीज़ बचे' : fz + ' freeze' + (fz > 1 ? 's' : '') + ' left') : (hi() ? 'इस हफ़्ते कोई फ़्रीज़ नहीं बचा' : 'No freezes left this week')) + (n ? ' · ' + (hi() ? n + ' दिन की स्ट्रीक' : n + '-day streak') : '') + '</div>';
    if (fz && n) h += '<button class="b-btn wide" style="background:var(--b-sky);box-shadow:0 4px 0 0 #0B6FB0" onclick="StepsTab.useFreeze()">' + ic('snowflake', 18) + (hi() ? 'आज के लिए फ़्रीज़ लगाएँ' : 'Use a freeze for today') + '</button>';
    h += '<button class="b-btn ghost wide" onclick="StepsTab.closeSheet()">' + (hi() ? 'ठीक है' : 'Got it') + '</button>';
    return h;
  }
  T.useFreeze = async function () {
    hap('medium'); const r = await _api('/steps/freeze', { method: 'POST', body: '{}' });
    if (!r || r.error) { hap('error'); _toast((r && r.error) || (hi() ? 'फ़्रीज़ नहीं लगा' : 'Could not freeze'), 'err'); return; }
    hap('success'); _toast(hi() ? 'स्ट्रीक सुरक्षित' : 'Streak protected'); T.closeSheet(); if (r.today) T.sum = Object.assign({}, T.sum, r); else await T.loadSummary(); T.rerender();
  };

  // ───────────────────────── share card (Canvas 1080×1920 story / 1080×1080 square) ─────────────────────────
  const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; } ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const flamePath = (ctx, x, y, s) => { ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.beginPath(); ctx.moveTo(12, 2); ctx.bezierCurveTo(9, 7, 6, 9, 6, 15); ctx.bezierCurveTo(6, 19, 9, 22, 12, 22); ctx.bezierCurveTo(15, 22, 18, 19, 18, 15); ctx.bezierCurveTo(18, 12, 16, 10, 15, 8); ctx.bezierCurveTo(14.5, 10.5, 13.5, 11, 13, 11); ctx.bezierCurveTo(13.5, 8, 13, 5, 12, 2); ctx.closePath(); ctx.fillStyle = '#B5402A'; ctx.fill(); ctx.beginPath(); ctx.moveTo(12, 13); ctx.bezierCurveTo(10.5, 15, 9.5, 16, 9.5, 18); ctx.bezierCurveTo(9.5, 20, 10.8, 21.5, 12, 21.5); ctx.bezierCurveTo(13.2, 21.5, 14.5, 20, 14.5, 18); ctx.bezierCurveTo(14.5, 16, 13.5, 15, 12, 13); ctx.closePath(); ctx.fillStyle = '#B5402A'; ctx.fill(); ctx.restore(); };
  const cardData = () => {
    const n = T.counted(), g = T.goal(), pct = clamp(n / g, 0, 1), m = metrics(n), inv = inviteData() || { code: '' };
    const d = T.board.cache['friends:today'], me = d && d.me, fr = T.sum && T.sum.friendsRank; const streak = (T.sum && Number(T.sum.streak)) || 0;
    let rank = ''; if (fr && fr.rank && fr.of > 1) { rank = t('shareRank', { r: fr.rank }); const dl = me && Number(me.delta) || 0; if (dl) rank += ' · ' + (dl > 0 ? '↑' : '↓') + Math.abs(dl); } else if (streak > 1) rank = t('share1', { d: streak }); else rank = t('shareWith');
    return { n, g, pct, m, inv, rank, streak, date: dateLabel(), url: inviteURL(inv).replace(/^https?:\/\//, '') };
  };
  T.drawCard = async function (kind, target) {
    const story = kind !== 'square'; const W = 1080, H = story ? 1920 : 1080; const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); const D = cardData();
    try { if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load('800 160px "Plus Jakarta Sans"'), document.fonts.load('600 40px "Plus Jakarta Sans"')]), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
    ctx.fillStyle = '#17141F'; ctx.fillRect(0, 0, W, H);
    const cy = story ? 760 : 520, R = story ? 300 : 230, LW = story ? 44 : 36;
    const glow = ctx.createRadialGradient(540, cy, R * 0.3, 540, cy, R * 2.4); glow.addColorStop(0, 'rgba(0,194,168,.32)'); glow.addColorStop(1, 'rgba(0,194,168,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // wordmark + eyebrow
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '800 ' + (story ? 60 : 48) + 'px ' + FONT; ctx.fillText('Brodoit', 80, story ? 150 : 110);
    const ww = ctx.measureText('Brodoit').width; ctx.fillStyle = '#B5402A'; ctx.beginPath(); ctx.arc(80 + ww + (story ? 22 : 18), story ? 136 : 98, story ? 10 : 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 ' + (story ? 30 : 26) + 'px ' + FONT; try { ctx.letterSpacing = '4px'; } catch (e) {} ctx.fillText((isHi() ? 'मूव' : 'MOVE') + ' · ' + D.date.toUpperCase(), 80, story ? 206 : 158); try { ctx.letterSpacing = '0px'; } catch (e) {}
    // ring
    ctx.lineWidth = LW; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(540, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (D.pct > 0) { const gr = ctx.createLinearGradient(540 - R, cy - R, 540 + R, cy + R); gr.addColorStop(0, '#B5402A'); gr.addColorStop(1, '#2F7D4F'); ctx.strokeStyle = gr; ctx.beginPath(); ctx.arc(540, cy, R, -Math.PI / 2, -Math.PI / 2 + D.pct * Math.PI * 2); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 ' + (story ? 160 : 140) + 'px ' + FONT; try { ctx.letterSpacing = '-6px'; } catch (e) {} ctx.fillText(fmt(D.n), 540, cy + (story ? 48 : 42)); try { ctx.letterSpacing = '0px'; } catch (e) {}
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '600 ' + (story ? 44 : 40) + 'px ' + FONT; ctx.fillText(t('of', { g: fmt(D.g) }) + (isHi() ? '' : ' steps'), 540, cy + (story ? 118 : 104));
    // rank line
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + (story ? 50 : 44) + 'px ' + FONT; ctx.fillText(D.rank, 540, story ? 1200 : 850);
    if (story) {
      // streak pill
      const txt = D.streak === 0 ? t('noStreak') : D.streak === 1 ? t('streak1') : t('streak', { n: D.streak }); ctx.font = '700 44px ' + FONT; const tw = ctx.measureText(txt).width, pw = tw + 150, px = 540 - pw / 2, py = 1255;
      ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(ctx, px, py, pw, 92, 46); ctx.fill(); flamePath(ctx, px + 40, py + 20, 52); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, px + 110, py + 61);
      // metrics
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '600 40px ' + FONT; ctx.fillText(D.m.km + ' ' + t('km') + '   ·   ' + fmt(D.m.kcal) + ' ' + t('kcal') + '   ·   ' + fmt(D.m.min) + ' ' + t('min'), 540, 1440);
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(80, 1540, 920, 2);
      // invite
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 34px ' + FONT; ctx.fillText((isHi() ? 'मेरे साथ चलो · ' : 'Join me · ') + D.url, 540, 1640);
      if (D.inv.code) { ctx.font = '800 84px ' + FONT; try { ctx.letterSpacing = '14px'; } catch (e) {} const cw = ctx.measureText(D.inv.code).width + 120; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; rr(ctx, 540 - cw / 2, 1700, cw, 128, 32); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillText(D.inv.code, 540 + 7, 1790); try { ctx.letterSpacing = '0px'; } catch (e) {} }
    } else {
      const txt = D.streak === 0 ? t('noStreak') : D.streak === 1 ? t('streak1') : t('streak', { n: D.streak }); ctx.textAlign = 'left'; ctx.font = '700 36px ' + FONT; flamePath(ctx, 80, 928, 44); ctx.fillStyle = '#fff'; ctx.fillText(txt, 136, 962);
      if (D.inv.code) { ctx.textAlign = 'right'; ctx.font = '800 52px ' + FONT; try { ctx.letterSpacing = '8px'; } catch (e) {} const cw = ctx.measureText(D.inv.code).width + 70; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; rr(ctx, 1000 - cw, 906, cw, 84, 24); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillText(D.inv.code, 1000 - 28, 964); try { ctx.letterSpacing = '0px'; } catch (e) {} ctx.font = '600 24px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText((isHi() ? 'मेरे साथ चलो · ' : 'Join me · ') + D.url, 1000, 1030); }
    }
    if (target) { const tc = target.getContext('2d'); tc.clearRect(0, 0, target.width, target.height); tc.drawImage(c, 0, 0, target.width, target.height); }
    return c;
  };
  T.drawPreviews = function () { const a = document.getElementById('stPrevStory'), b = document.getElementById('stPrevSquare'); if (a) T.drawCard('story', a).catch(() => {}); if (b) T.drawCard('square', b).catch(() => {}); };
  T.share = async function (kind) {
    kind = kind === 'square' ? 'square' : 'story'; if (T.shareBusy) return; T.shareBusy = true; hap('medium');
    try {
      const c = await T.drawCard(kind); const blob = await new Promise(res => c.toBlob(res, 'image/png')); if (!blob) throw new Error('no blob');
      const name = 'brodoit-steps-' + dayKey(new Date()) + (kind === 'square' ? '-square' : '') + '.png'; let shared = false;
      try { const file = new File([blob], name, { type: 'image/png' }); if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) { await navigator.share({ files: [file], title: 'Brodoit', text: (isHi() ? 'आज ' : 'Today: ') + fmt(T.counted()) + (isHi() ? ' कदम' : ' steps') + ' · Brodoit' }); shared = true; } } catch (e) { if (e && e.name === 'AbortError') { T.shareBusy = false; return; } }
      if (!shared) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); _toast(isHi() ? 'इमेज सेव हुई' : 'Image saved'); }
      hap('success'); _api('/share', { method: 'POST', body: JSON.stringify({ kind: kind === 'square' ? 'square' : 'today' }) });
    } catch (e) { hap('error'); _toast(isHi() ? 'शेयर नहीं हो पाया' : 'Could not share', 'err'); }
    T.shareBusy = false;
  };

  // ───────────────────────── Walk mode: DeviceMotion pedometer + wake lock + 60-s delta flushes ─────────────────────────
  const W = T.walk; W.sent = 0;
  const TH = 1.05, MIN_GAP = 280;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return; const x = a.x || 0, y = a.y || 0, z = a.z || 0; const m = Math.sqrt(x * x + y * y + z * z); if (!(m > 0)) return;
    const now = performance.now();
    if (!W._init) { W._lp = m; W._sm = 0; W._init = true; return; }
    W._lp += (m - W._lp) * 0.04;            // slow gravity baseline
    const hp = m - W._lp; W._sm += (hp - W._sm) * 0.35; // smoothed dynamic acceleration
    if (W._sm > TH) { if (!W._above) { W._above = true; if (now - W._lastStep >= MIN_GAP) { W._lastStep = now; if (W.steps - W.sent < 25000) W.steps++; } } }
    else if (W._sm < TH * 0.45) W._above = false;
  }
  async function wakeLock() { try { if (!navigator.wakeLock || W.lock) return; W.lock = await navigator.wakeLock.request('screen'); W.lock.addEventListener && W.lock.addEventListener('release', () => { W.lock = null; }); } catch (e) { W.lock = null; } }
  function onVis() { if (!W.on) return; if (document.visibilityState === 'visible') wakeLock(); else T.walkFlush(true); }
  function onHide() { if (W.on) T.walkFlush(true); }
  function tickWalk() {
    if (!W.on) return; const n = T.counted(); let el;
    if ((el = document.getElementById('stWalkSteps'))) el.textContent = fmt(W.steps);
    if ((el = document.getElementById('stWalkTime'))) el.textContent = walkTime();
    if ((el = document.getElementById('stWalkKm'))) el.textContent = metrics(W.steps).km;
    if ((el = document.getElementById('stCount'))) el.textContent = fmt(n);
    if ((el = document.querySelector('.st-hero .st-ring-prog'))) { const c = parseFloat(el.getAttribute('stroke-dasharray')) || 0; el.style.strokeDashoffset = (c * (1 - T.pct())).toFixed(2); }
    if ((el = document.getElementById('stMetrics'))) { const m = metrics(n); const b = el.querySelectorAll('b'); if (b.length === 3) { b[0].textContent = m.km; b[1].textContent = fmt(m.kcal); b[2].textContent = fmt(m.min); } }
    if ((el = document.getElementById('stNudge'))) { const txt = nudge(n, T.goal()); if (el.textContent !== txt) { el.textContent = txt; if (n >= T.goal() && !W._celebrated) { W._celebrated = true; hap('success'); T.rerender(); } } }
  }
  T.walkStart = async function () {
    if (W.on) return;
    if (!('DeviceMotionEvent' in window)) { hap('error'); _toast(isHi() ? 'यह ब्राउज़र कदम नहीं गिन सकता — ऐप लें या लॉग करें' : 'This browser can’t count steps — get the app or log steps', 'err'); return; }
    try { if (typeof DeviceMotionEvent.requestPermission === 'function') { const p = await DeviceMotionEvent.requestPermission(); if (p !== 'granted') { hap('error'); _toast(isHi() ? 'मोशन की अनुमति नहीं मिली' : 'Motion access was denied', 'err'); return; } } } catch (e) { /* permission prompt needs a gesture; continue — events may still arrive */ }
    hap('medium');
    // absorbs: a trust≥2 sample already owns today → the server's counted() will ignore our deltas; say so up front instead of climbing and snapping back
    const td = (T.sum && T.sum.today) || {};
    Object.assign(W, { on: true, steps: 0, sent: 0, base: T.serverCounted(), absorbs: Number(td.trust) >= 2 ? false : null, started: Date.now(), lastFlush: Date.now(), _lp: 0, _sm: 0, _lastStep: 0, _above: false, _init: false, _celebrated: false });
    window.addEventListener('devicemotion', onMotion); document.addEventListener('visibilitychange', onVis); window.addEventListener('pagehide', onHide);
    wakeLock(); W.timer = setInterval(tickWalk, 1000); W.flushTimer = setInterval(() => T.walkFlush(false), 60000);
    T.rerender(); const el = document.getElementById('stWalk'); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
  };
  // lastFlush gates the 60-s timer (reset at walk start); lastPost is the last real POST (the server's ≤1 flush/60 s rule, shared with the retry queue)
  const canPost = () => Date.now() - (W.lastPost || 0) >= 60000;
  const absorbFrom = r => { if (r && r.today && r.today.trust != null) W.absorbs = !(Number(r.today.trust) >= 2); };
  T.walkFlush = async function (force) {
    const pending = W.steps - W.sent; if (pending <= 0) return null;
    const since = Date.now() - W.lastFlush; if (!force && since < 60000) return null;
    if (!canPost()) { queuePending(pending, 60000 - (Date.now() - W.lastPost) + 500); W.sent += pending; return null; }
    W.lastFlush = W.lastPost = Date.now(); W.sent += pending;
    const r = await _api('/steps', { method: 'POST', body: JSON.stringify({ add: pending, source: 'device' }), keepalive: true });
    if (!r || r.error) { queuePending(pending, 61000); return r; }
    absorbFrom(r); if (r.today) { T.sum = Object.assign({}, T.sum || {}, r); T.rerender(); }
    return r;
  };
  // Deltas the server could not take yet (rate limit / offline) wait in localStorage and retry. The store is keyed per account —
  // { [ownerId]: {add, ts, date} } under bd_walk_pending, ownerId = FNV-1a of this login's x-token (phone as fallback) — so a queue left by
  // one login is never posted under the next account on the same browser; it is flushed only when its owner is signed in, and expires after 36 h.
  const QKEY = 'bd_walk_pending', QTTL = 36 * 3600000;
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
  const ownerId = () => { const u = _S().user; const k = (typeof token !== 'undefined' && token) || (u && (u.token || u.phone)) || ''; return k ? 'u' + fnv(String(k)) : ''; };
  let qCache = null;
  function readQueue() {
    if (qCache) return qCache; let q = null; try { q = JSON.parse(localStorage.getItem(QKEY) || 'null'); } catch (e) {}
    let dirty = false;
    if (!q || typeof q !== 'object' || q.add != null) { dirty = !!q; q = {}; }   // legacy unscoped entry: owner unknown → dropped
    Object.keys(q).forEach(k => { const e = q[k]; if (!e || !(e.add > 0) || !(Date.now() - (e.ts || 0) <= QTTL)) { delete q[k]; dirty = true; } });
    qCache = q; if (dirty) writeQueue(q); return q;
  }
  function writeQueue(q) { qCache = q; try { if (!q || !Object.keys(q).length) localStorage.removeItem(QKEY); else localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} }
  function queuedAdd() { const o = ownerId(); if (!o) return 0; const e = readQueue()[o]; return e ? Math.round(e.add) : 0; }
  function queuePending(add, delay, date) {
    const o = ownerId(); add = Math.round(Number(add) || 0);
    if (o && add > 0) { const q = readQueue(); const e = q[o] || { add: 0, ts: Date.now(), date: date || dayKey(new Date()) }; e.add += add; q[o] = e; writeQueue(q); }
    if (W._retry) clearTimeout(W._retry); W._retry = setTimeout(flushStored, delay || 61000);
  }
  async function flushStored() {
    W._retry = null; const o = ownerId(); if (!o) return;                 // nobody signed in → leave every queue alone
    qCache = null; const q = readQueue(); const e = q[o]; if (!e) return;
    if (!canPost()) { W._retry = setTimeout(flushStored, 60000 - (Date.now() - W.lastPost) + 500); return; }
    delete q[o]; writeQueue(q); W.lastPost = Date.now();
    const r = await _api('/steps', { method: 'POST', body: JSON.stringify({ add: e.add, source: 'device', date: e.date || dayKey(new Date(e.ts)) }) });
    if (!r || r.error) { if (r && /day|date|cap|25/i.test(r.error || '')) return; queuePending(e.add, 61000, e.date); return; }
    absorbFrom(r); if (r.today) { T.sum = Object.assign({}, T.sum || {}, r); } T.rerender();
  }
  T.walkStop = async function () {
    if (!W.on) return; hap('success'); const n = W.steps;
    window.removeEventListener('devicemotion', onMotion); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide);
    clearInterval(W.timer); clearInterval(W.flushTimer); W.timer = W.flushTimer = null;
    try { if (W.lock) { await W.lock.release(); } } catch (e) {} W.lock = null;
    const p = T.walkFlush(true); W.on = false; T.rerender();
    _toast(n ? t('walkSaved', { n: fmt(n) }) + (W.absorbs === false ? ' — ' + t('walkNoCount', { src: srcName() }) : '') : t('walkStopped'));
    await p; W.sent = W.steps = 0; T.loadBoard(true).then(() => T.rerender());
  };

  // ───────────────────────── loading, mount, rerender ─────────────────────────
  T.loadSummary = async function () { const r = await _api('/steps/summary' + (isTWA() ? '?twa=1' : '')); if (r && !r.error) { T.sum = r; T.failed = false; if (r.today && Number(r.today.trust) >= 2) W.absorbs = false; else if (r.today && r.today.source === 'device') W.absorbs = true; } else T.failed = true; return r; };
  T.loadBoard = async function (force, scope, period) {
    scope = scope || T.board.scope; period = period || T.board.period; const key = scope + ':' + period;
    if (!force && T.board.cache[key]) return T.board.cache[key];
    if (key === T.board.scope + ':' + T.board.period) T.board.loading = true;
    const r = await _api('/steps/leaderboard?scope=' + scope + '&period=' + period);
    if (key === T.board.scope + ':' + T.board.period) T.board.loading = false;
    if (r && !r.error) T.board.cache[key] = r; return r;
  };
  T.loadFriends = async function () { const r = await _api('/friends'); if (r && !r.error) T.friends = r; return r; };
  T.setPeriod = function (p) { if (p !== 'today' && p !== 'week') return; hap('light'); T.board.period = p; T.rerender(); T.loadBoard().then(() => T.rerender()); };
  T.setScope = function (s) { if (['friends', 'city', 'india'].indexOf(s) < 0) return; const c = T.board.cache[s + ':today'] || T.board.cache[s + ':week']; if (s !== 'friends' && c && c.hidden) { hap('error'); _toast(t('opensAt')); return; } hap('light'); T.board.scope = s; T.rerender(); T.loadBoard().then(() => T.rerender()); };
  function checkMascot() { if (T.mascot != null || T._mascotBusy) return; T._mascotBusy = true; fetch('/app/mascot.svg', { method: 'HEAD' }).then(r => { T.mascot = !!(r && r.ok && /svg/i.test(r.headers.get('content-type') || '')); }).catch(() => { T.mascot = false; }).finally(() => { T._mascotBusy = false; if (document.getElementById('stEmpty')) T.rerender(); }); }
  // The shell redeems localStorage.join_code at boot (server.js) — but only when a token exists at that moment; after an in-app
  // login nothing redeems it until the next reload. This fallback waits 8 s (so it never races the shell's own boot request), then
  // redeems a code that is still there, clearing it only on success or "not found" — the same semantics as the shell.
  T.joinDelay = 8000;
  function redeemJoinFallback() {
    if (T._joinTimer || window.__joinRedeemed) return;
    T._joinTimer = setTimeout(async () => {
      T._joinTimer = null; let code = null; try { code = localStorage.getItem('join_code'); } catch (e) {}
      if (!code || window.__joinRedeemed || !((typeof token !== 'undefined' && token) || _S().user)) return;
      window.__joinRedeemed = true;
      const r = await _api('/friends/code', { method: 'POST', body: JSON.stringify({ code: String(code).toUpperCase().slice(0, 12) }) });
      if (r && !r.error) { try { localStorage.removeItem('join_code'); } catch (e) {} hap('success'); _toast(isHi() ? 'दोस्त जुड़ गया!' : 'You’re now friends!'); await Promise.all([T.loadFriends(), T.loadBoard(true)]); T.rerender(); }
      else if (r && /not found|invalid|already|yourself|own code/i.test(r.error || '')) { try { localStorage.removeItem('join_code'); } catch (e) {} }
      else window.__joinRedeemed = false;                                  // offline / 5xx: keep the code for the next load()
    }, Math.max(0, Number(T.joinDelay) || 0));
  }
  T.load = async function (force) {
    if (T.loading) return; T.loading = true; checkMascot();
    await Promise.all([T.loadSummary(), T.loadBoard(force), T.loadFriends()]);
    T.loading = false; T.loaded = true; T.lastLoad = Date.now(); T.rerender();
    redeemJoinFallback(); flushStored();
    claimFromURL().then(ok => { if (ok) { hap('success'); _toast(isHi() ? 'स्टेप काउंट चालू — अब अपने आप सिंक होगा' : 'Step counting is on — syncing automatically'); T.loadSummary().then(() => T.rerender()); } });
    // learn whether city/india boards are open (cohort ≥ 20) so the chips can say so
    Promise.all(['city', 'india'].map(s => T.board.cache[s + ':today'] ? null : T.loadBoard(false, s, 'today'))).then(() => T.rerender());
  };
  T.rerender = function () {
    const root = document.getElementById('stepsRoot'); if (root) { root.innerHTML = T.html(); T.animateRings(root); T._ringPct = T.sum ? T.pct() : 0; }
    const mini = document.getElementById('stepsMini'); if (mini) { mini.innerHTML = T.miniCard(); T.animateRings(mini); }
  };
  T.mount = function () {
    const root = document.getElementById('stepsRoot'); if (root) T.animateRings(root); T._ringPct = T.sum ? T.pct() : 0;
    if (!T.loaded && !T.loading) T.load(); else if (T.lastLoad && Date.now() - T.lastLoad > 60000) T.load();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && T.loaded && document.getElementById('stepsRoot') && Date.now() - (T.lastLoad || 0) > 60000 && !W.on) T.load(); });
  // expose a few internals for the test harness / integrator
  T._internals = { onMotion, metrics, guessState, isTWA, isHi, STR, flushStored, queuedAdd, ownerId, weekDays, jsStr, dayKey, claimFromURL };
})();
