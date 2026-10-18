// Small Python syntax highlighter (keywords, builtins, strings incl. f-strings and triple quotes,
// numbers, comments, decorators, def/class names). Returns HTML; one <span> per token kind.
const KW = new Set('False None True and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield'.split(' '));
const BI = new Set('print input len range int float str bool list dict set tuple type isinstance sum min max abs round sorted reversed enumerate zip map filter any all open super object property staticmethod classmethod iter next repr format hash id dir help vars getattr setattr hasattr divmod pow chr ord hex bin oct frozenset bytes Exception ValueError TypeError KeyError IndexError ZeroDivisionError NameError AttributeError RuntimeError StopIteration self cls'.split(' '));
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function highlight(src) {
  let out = '', i = 0, prev = '';
  const n = src.length;
  const push = (cls, t) => { out += cls ? '<span class="h-' + cls + '">' + esc(t) + '</span>' : esc(t); };
  while (i < n) {
    const c = src[i];
    if (c === '#') { const j = src.indexOf('\n', i); const e = j < 0 ? n : j; push('c', src.slice(i, e)); i = e; continue; }
    const sm = /^([rRbBfFuU]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (sm && (sm[1] === '' || /[rRbBfFuU]/.test(c))) {
      const q = sm[2], start = i; i += sm[0].length;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src.startsWith(q, i)) { i += q.length; break; }
        if (q.length === 1 && src[i] === '\n') break;
        i++;
      }
      push('s', src.slice(start, i)); prev = 's'; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xob][0-9a-f_]+|[0-9_]*\.?[0-9_]+(e[+-]?[0-9]+)?j?)/i.exec(src.slice(i));
      const t = m ? m[0] : c; push('n', t); i += t.length; prev = 'n'; continue;
    }
    if (c === '@' && (i === 0 || src[i - 1] === '\n' || /^\s*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i)))) {
      const m = /^@[\w.]+/.exec(src.slice(i)); if (m) { push('d', m[0]); i += m[0].length; continue; }
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][\wÀ-￿]*/.exec(src.slice(i)); const w = m[0];
      if (prev === 'def' || prev === 'class') push('f', w);
      else if (KW.has(w)) push('k', w);
      else if (BI.has(w)) push('b', w);
      else if (src[i + w.length] === '(') push('call', w);
      else push('', w);
      prev = (w === 'def' || w === 'class') ? w : 'w'; i += w.length; continue;
    }
    if (/[+\-*/%=<>!&|^~]/.test(c)) { push('o', c); i++; continue; }
    push('', c); if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
