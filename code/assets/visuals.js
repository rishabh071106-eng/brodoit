// Animated visuals for lesson slides. render(v) returns HTML; mount(el) runs after insertion
// (draws arrows, starts sequences). Every element animates in with a stagger (--i).
import { esc } from './lib.js';
import { highlight } from './hl.js';

const I = (k, html, cls = '', extra = '') => `<div class="${cls}" style="--i:${k}"${extra}>${html}</div>`;

const R = {
  boxes(v) {
    return `<div class="vx vx-boxes">${(v.vars || []).map((b, k) => I(k, `<span class="vx-name">${esc(b[0])}</span><span class="vx-val">${esc(b[1])}</span>${b[2] ? `<span class="vx-type">${esc(b[2])}</span>` : ''}`, 'vx-box')).join('')}</div>`;
  },
  memory(v) {
    const names = (v.names || []).map((n, k) => I(k, esc(n), 'vx-mname', ` data-name="${esc(n)}"`)).join('');
    const objs = (v.objects || []).map((o, k) => I(k + 1, `<small>${esc(o.t || '')}</small><span>${esc(o.r)}</span>`, 'vx-mobj', ` data-obj="${esc(o.id)}"`)).join('');
    return `<div class="vx vx-memory" data-links='${esc(JSON.stringify(v.links || []))}'><div class="vx-mcol"><div class="vx-mhead">Names</div>${names}</div><div class="vx-mcol"><div class="vx-mhead">Objects</div>${objs}</div><svg class="vx-arrows" aria-hidden="true"></svg></div>`;
  },
  list(v) {
    const items = v.items || [], n = items.length, mark = new Set(v.mark || []);
    const sl = v.slice || null;
    const cells = items.map((x, k) => {
      const inSlice = sl && k >= sl[0] && k < sl[1];
      return I(k, `<span class="vx-idx">${k}</span><span class="vx-cell${mark.has(k) ? ' mark' : ''}${inSlice ? ' sl' : ''}">${esc(x)}</span>${v.neg ? `<span class="vx-idx neg">${k - n}</span>` : ''}`, 'vx-lcell');
    }).join('');
    return `<div class="vx vx-list">${v.name ? `<div class="vx-lname">${esc(v.name)} =</div>` : ''}<div class="vx-lrow">${cells}</div>${sl ? `<div class="vx-cap">${esc(v.name || 'items')}[${sl[0]}:${sl[1]}] → the highlighted cells</div>` : ''}</div>`;
  },
  dict(v) {
    return `<div class="vx vx-dict">${v.name ? `<div class="vx-lname">${esc(v.name)} = {</div>` : ''}${(v.pairs || []).map((p, k) => I(k, `<span class="vx-key">${esc(p[0])}</span><span class="vx-arrow">→</span><span class="vx-dval">${esc(p[1])}</span>`, 'vx-pair')).join('')}${v.name ? '<div class="vx-lname">}</div>' : ''}</div>`;
  },
  flow(v) {
    const nodes = v.nodes || [];
    return `<div class="vx vx-flow">${nodes.map((nd, k) => {
      const shape = nd.s || 'box';
      const branch = shape === 'diamond' && (nd.yes || nd.no) ? `<div class="vx-branch">${nd.yes ? `<span class="yes">yes → ${esc(nd.yes)}</span>` : ''}${nd.no ? `<span class="no">no → ${esc(nd.no)}</span>` : ''}</div>` : '';
      return I(k, `<div class="vx-node ${shape}"><span>${esc(nd.t)}</span></div>${branch}${k < nodes.length - 1 ? '<div class="vx-link"><i></i></div>' : ''}`, 'vx-fstep');
    }).join('')}</div>`;
  },
  stack(v) {
    const fr = v.frames || [];
    return `<div class="vx vx-stack"><div class="vx-cap">Call stack · newest on top</div>${fr.slice().reverse().map((f, k) => I(fr.length - 1 - k, `<div class="vx-fname">${esc(f.name)}${f.ret != null ? `<span class="vx-ret">returns ${esc(f.ret)}</span>` : ''}</div><div class="vx-fvars">${(f.vars || []).map(x => `<span><b>${esc(x[0])}</b> ${esc(x[1])}</span>`).join('')}</div>`, 'vx-frame' + (k === 0 ? ' top' : ''))).join('')}</div>`;
  },
  terminal(v) {
    return `<div class="vx vx-term"><div class="vx-tbar"><i></i><i></i><i></i><span>terminal</span></div><div class="vx-tbody">${(v.lines || []).map((l, k) => I(k, l[0] ? `<span class="vx-prompt">${esc(l[0])}</span> <span class="vx-cmd">${esc(l[1])}</span>` : `<span class="vx-tout">${esc(l[1])}</span>`, 'vx-tline' + (l[0] ? ' cmd' : ''))).join('')}<span class="vx-caret"></span></div></div>`;
  },
  compare(v) {
    const side = (s, k, cls) => I(k, `<div class="vx-chead">${esc((s && s.title) || '')}</div><pre class="vx-code">${highlight((s && s.code) || '')}</pre>`, 'vx-cside ' + cls);
    return `<div class="vx vx-compare"><div class="vx-cgrid">${side(v.left, 0, 'l')}${side(v.right, 1, 'r')}</div>${v.verdict ? I(2, esc(v.verdict), 'vx-verdict') : ''}</div>`;
  },
  steps(v) {
    return `<div class="vx vx-steps">${(v.items || []).map((s, k) => I(k, `<span class="vx-num">${k + 1}</span><span>${esc(s)}</span>`, 'vx-step')).join('')}</div>`;
  },
  table(v) {
    return `<div class="vx vx-table"><table><thead><tr>${(v.head || []).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(v.rows || []).map((r, k) => `<tr style="--i:${k}">${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  },
  tree(v) {
    let k = 0;
    const node = n => `<li style="--i:${k++}"><span class="vx-tn">${esc(n.t)}</span>${n.c && n.c.length ? `<ul>${n.c.map(node).join('')}</ul>` : ''}</li>`;
    return `<div class="vx vx-tree"><ul>${v.root ? node(v.root) : ''}</ul></div>`;
  },
  chart(v) {
    const bars = v.bars || [], max = Math.max(1, ...bars.map(b => +b[1] || 0));
    const log = max / Math.max(1, Math.min(...bars.map(b => +b[1] || 1))) > 50;
    const h = x => log ? Math.log10(1 + x) / Math.log10(1 + max) : x / max;
    return `<div class="vx vx-chart">${v.title ? `<div class="vx-cap">${esc(v.title)}${log ? ' (log scale)' : ''}</div>` : ''}<div class="vx-bars">${bars.map((b, k) => I(k, `<span class="vx-bv">${esc(Number(b[1]).toLocaleString('en-IN'))}</span><i style="--h:${Math.max(0.03, h(+b[1] || 0))}"></i><span class="vx-bl">${esc(b[0])}</span>`, 'vx-bar')).join('')}</div></div>`;
  },
};

export function render(v) {
  if (!v || !R[v.kind]) return '';
  try { return R[v.kind](v); } catch (e) { return ''; }
}

// Draws memory arrows once the layout exists; redraws on resize.
export function mount(root) {
  root.querySelectorAll('.vx-memory').forEach(box => {
    const draw = () => {
      const svg = box.querySelector('.vx-arrows'); if (!svg) return;
      const b = box.getBoundingClientRect();
      let links = []; try { links = JSON.parse(box.dataset.links || '[]'); } catch (e) { /* ignore */ }
      svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
      svg.innerHTML = '<defs><marker id="vxah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>' + links.map((l, k) => {
        const a = box.querySelector(`[data-name="${CSS.escape(l[0])}"]`), o = box.querySelector(`[data-obj="${CSS.escape(l[1])}"]`);
        if (!a || !o) return '';
        const ra = a.getBoundingClientRect(), ro = o.getBoundingClientRect();
        const x1 = ra.right - b.left + 4, y1 = ra.top + ra.height / 2 - b.top, x2 = ro.left - b.left - 6, y2 = ro.top + ro.height / 2 - b.top;
        const mx = (x1 + x2) / 2;
        return `<path class="vx-ar" style="--i:${k + 2}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="url(#vxah)"/>`;
      }).join('');
    };
    requestAnimationFrame(() => requestAnimationFrame(draw));
    setTimeout(draw, 700);
    if (!box._ro && window.ResizeObserver) { box._ro = new ResizeObserver(draw); box._ro.observe(box); }
  });
}
