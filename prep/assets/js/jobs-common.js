// Shared bits for the government jobs pages.
import { esc } from './app.js?v=9';

export const CAT = {
  central: { name: 'Central Govt', sub: 'UPSC · SSC · Ministries', emoji: '🏛️', c: '#B5541B' },
  defence: { name: 'Defence', sub: 'Army · Navy · Air Force', emoji: '🎖️', c: '#1F7A4D' },
  police: { name: 'Police & CAPF', sub: 'BSF · CRPF · CISF · State', emoji: '🛡️', c: '#1E3A8A' },
  banking: { name: 'Banking', sub: 'IBPS · SBI · RBI · LIC', emoji: '🏦', c: '#13568C' },
  railways: { name: 'Railways', sub: 'RRB · RRC · Metro', emoji: '🚆', c: '#B91C1C' },
  teaching: { name: 'Teaching', sub: 'KVS · NVS · TET', emoji: '📚', c: '#7C3AED' },
  psu: { name: 'PSU & Research', sub: 'ONGC · NTPC · ISRO · DRDO', emoji: '🏭', c: '#0F766E' },
  state: { name: 'State Govt', sub: 'State PSC · SSB', emoji: '🗺️', c: '#C2410C' },
  health: { name: 'Health', sub: 'AIIMS · ESIC · Nursing', emoji: '🩺', c: '#DB2777' },
  other: { name: 'Other', sub: 'Courts · Post · EPFO · FCI', emoji: '📮', c: '#475569' },
};

const DAY = 86400000;
const today = () => new Date(new Date().toISOString().slice(0, 10)).getTime();
export const daysLeft = j => j.lastDate ? Math.round((Date.parse(j.lastDate) - today()) / DAY) : null;
export const isNew = j => (today() - Date.parse(j.postedDate)) / DAY <= 7;
export const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const ageText = j => j.ageMin != null && j.ageMax != null ? `${j.ageMin}–${j.ageMax} yrs` : j.ageMax != null ? `Up to ${j.ageMax} yrs` : j.ageMin != null ? `${j.ageMin}+ yrs` : 'See notice';

export function deadlinePill(j) {
  const d = daysLeft(j);
  if (d === null) return '<span class="jp">Date in notice</span>';
  if (d < 0) return '<span class="jp closed">Closed</span>';
  if (d === 0) return '<span class="jp hot">Last day today</span>';
  return `<span class="jp${d <= 7 ? ' hot' : ''}">${d} day${d > 1 ? 's' : ''} left</span>`;
}

export function shareText(j) {
  const link = `${location.origin}/j/${encodeURIComponent(j.id)}`;
  return [
    `🇮🇳 *${j.title}*`,
    `🏛️ ${j.org}`,
    j.posts ? `👥 Posts: ${j.posts.toLocaleString('en-IN')}` : null,
    j.qualification ? `🎓 ${j.qualification}` : null,
    `🎂 Age: ${ageText(j)}`,
    `⏳ Last date: ${j.lastDate ? fmtDate(j.lastDate) : 'see notification'}`,
    '',
    `Full details, how to apply & official link 👉 ${link}`,
    '',
    '— shared via *Brodoit* 📲 Government jobs, every day',
  ].filter(x => x !== null).join('\n');
}
export const whatsappUrl = j => `https://wa.me/?text=${encodeURIComponent(shareText(j))}`;
export const WA_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

export function jobCard(j) {
  const cat = CAT[j.category] || CAT.other;
  return `<article class="job${j.open ? '' : ' is-closed'}">
    <a class="jtop" href="job.html?id=${encodeURIComponent(j.id)}">
      <div class="jav" style="background:${cat.c}">${cat.emoji}</div>
      <div class="jmeta"><div class="jorg">${esc(j.org)}${isNew(j) ? '<span class="jnew">NEW</span>' : ''}</div>
        <div class="jtitle">${esc(j.title)}</div></div></a>
    <div class="jchips">${j.posts ? `<span>👥 ${j.posts.toLocaleString('en-IN')} posts</span>` : ''}${j.qualification ? `<span>🎓 ${esc(j.qualification)}</span>` : ''}<span>🎂 ${ageText(j)}</span></div>
    <div class="jfoot">${deadlinePill(j)}<span class="jdate">Last date ${fmtDate(j.lastDate)}</span>
      <a class="jwa press" href="${whatsappUrl(j)}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">${WA_ICON}</a>
      <a class="jgo press" href="job.html?id=${encodeURIComponent(j.id)}">Details →</a></div>
  </article>`;
}

export const JOB_CSS = `
.job{background:var(--card);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:14px;margin-top:12px}
.job.is-closed{opacity:.6}
.jtop{display:flex;gap:12px;align-items:flex-start}
.jav{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;font-size:22px;flex-shrink:0}
.jmeta{flex:1;min-width:0}
.jorg{font-size:12px;font-weight:800;color:var(--mute);letter-spacing:.02em}
.jnew{background:#16A34A;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px;letter-spacing:.06em}
.jtitle{font-size:16px;font-weight:800;letter-spacing:-.01em;line-height:1.3;margin-top:2px}
.jchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.jchips span{font-size:12px;font-weight:700;background:var(--card-2);border-radius:999px;padding:5px 10px}
.jfoot{display:flex;align-items:center;gap:8px;margin-top:12px}
.jp{font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:color-mix(in srgb,var(--ok) 14%,var(--card));color:var(--ok);white-space:nowrap}
.jp.hot{background:color-mix(in srgb,var(--bad) 14%,var(--card));color:var(--bad)}
.jp.closed{background:var(--card-2);color:var(--mute)}
.jdate{flex:1;font-size:11.5px;color:var(--mute);font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jwa{width:44px;height:44px;border-radius:50%;background:#25D366;color:#fff;display:grid;place-items:center;flex-shrink:0}
.jgo{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:800;background:var(--ink);color:var(--bg);padding:0 14px;border-radius:999px;flex-shrink:0}
`;
