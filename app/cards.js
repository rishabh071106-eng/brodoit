// Brodoit cards v12 — HTML builders for the card UI (styles in app/cards.css).
// Photos live in app/img/cards/<key>.jpg, fetched by CI from Wikimedia Commons (scripts/fetch-images.js); credits.json lists
// which exist and who made them (shown at /credits). A card without a photo gets a designed art cover (tone + big icon), so a
// missing photo never looks broken. onclick values are JS strings; they are HTML-escaped here, so quotes inside are safe.
(function () {
  const C = window.Cards = window.Cards || {};
  const PHOTO_VER = 1;
  C.avail = C.avail || null; C.credits = C.credits || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, s) => (window.ico ? window.ico(n, s || 20) : '');
  C.esc = esc;

  C.load = function () {
    if (C._loading) return C._loading;
    C._loading = fetch('/app/img/cards/credits.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(j => {
      C.credits = j || {}; C.avail = new Set(Object.keys(C.credits));
      try { if (C.avail.size && typeof render === 'function') render(); } catch (e) {}
      return C.avail;
    });
    return C._loading;
  };
  C.photo = key => (key && C.avail && C.avail.has(key) ? '/app/img/cards/' + key + '.jpg?v=' + PHOTO_VER : '');

  const go = k => (k ? '<span class="cv-go" aria-hidden="true">' + icon(k === 'play' ? 'play' : k === 'mic' ? 'mic' : 'arrow-right', 20) + '</span>' : '');
  const media = o => {
    const src = o.img || C.photo(o.key);
    // the art layer always renders underneath; a photo that fails to load simply disappears and the art shows through
    return '<span class="cv-art" aria-hidden="true">' + (o.icon ? icon(o.icon, 120) : '') + '</span>' +
      (src ? '<img class="cv-img" src="' + esc(src) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '');
  };

  // cover({ key, img, icon, tone, size, cls, kick, title, sub, tag, tagL, go, onclick, href, id, aria, extra })
  C.cover = function (o) {
    const cls = 'cv ' + (o.size || '') + ' tone-' + (o.tone || 'ink') + (o.cls ? ' ' + o.cls : '');
    const text = (o.kick ? '<span class="cv-kick">' + esc(o.kick) + '</span>' : '') + '<span class="cv-title">' + esc(o.title) + '</span>' + (o.sub ? '<span class="cv-sub">' + esc(o.sub) + '</span>' : '');
    const body = '<span class="cv-body">' + (o.go ? '<span class="cv-row"><span>' + text + '</span>' + go(o.go) + '</span>' : text) + (o.extra || '') + '</span>';
    const tags = (o.tag ? '<span class="cv-tag">' + o.tag + '</span>' : '') + (o.tagL ? '<span class="cv-tag l">' + o.tagL + '</span>' : '');
    const a = (o.id ? ' id="' + esc(o.id) + '"' : '') + ' aria-label="' + esc(o.aria || [o.kick, o.title, o.sub].filter(Boolean).join(', ')) + '"';
    if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + a + '>' + media(o) + tags + body + '</a>';
    return '<button type="button" class="' + cls + '"' + a + (o.onclick ? ' onclick="' + esc(o.onclick) + '"' : '') + '>' + media(o) + tags + body + '</button>';
  };

  // row({ key, img, icon, tone, title, sub, onclick, right })
  C.row = function (o) {
    const src = o.img || C.photo(o.key);
    const th = '<span class="rc-th tone-' + (o.tone || 'ink') + '" aria-hidden="true">' + (o.icon ? icon(o.icon, 24) : '') + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '') + '</span>';
    return '<button type="button" class="rowc" onclick="' + esc(o.onclick || '') + '">' + th + '<span class="rc-tx"><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span>' + (o.right != null ? o.right : '<span class="rc-go" aria-hidden="true">' + icon('chevron-right', 20) + '</span>') + '</button>';
  };

  // mini({ icon, title, sub, num, onclick, cls })
  C.mini = function (o) {
    return '<button type="button" class="mini' + (o.cls ? ' ' + o.cls : '') + '" onclick="' + esc(o.onclick || '') + '">' + (o.icon ? '<span class="mi-ic" aria-hidden="true">' + icon(o.icon, 20) + '</span>' : '') +
      (o.num != null ? '<span class="mi-num">' + esc(o.num) + '</span>' : '') + '<span><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span></button>';
  };

  // sec('Today', 'See all', "switchTab('news')")
  C.sec = (title, action, onclick) => '<div class="sec-h"><h2>' + esc(title) + '</h2>' + (action ? '<button type="button" onclick="' + esc(onclick || '') + '">' + esc(action) + '</button>' : '') + '</div>';

  C.load();
})();
