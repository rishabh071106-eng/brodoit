// Brodoit mini-app chrome — shared by /lang, /prep and /speaker. Classic script (load with `defer`,
// after /app/icons.js) so ES-module pages and plain pages get the same markup from one place.
//
//   window.bdTopbar({ back, backLabel, title, subtitle, right, mount, inner })
//     → <header class="bd-top"> with: [← Brodoit] [parent back if `back`] [title] [right slot].
//     `mount` (default: prepend to body) is an element to prepend into; `inner: true` returns only the
//     inner markup so a page can place the bar in its own layout. `title`/`right` are HTML.
//   window.bdLearnHref — where "← Brodoit" goes (the app's Learn tab).
//
// Back guard: when a mini-app page is opened cold (push, app shortcut, pasted link) the tab has no
// history, so the Android back button closes the app. We insert one entry so the first back press lands
// on the Brodoit app instead.
(function () {
  var HOME = '/?tab=learn';
  window.bdLearnHref = HOME;

  var ICON = {
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'home': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  };
  function ic(name, size) {
    try { if (window.ico && (!window.ico.has || window.ico.has(name))) { var s = window.ico(name, size); if (s) return s; } } catch (e) { /* fall through */ }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || '') + '</svg>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function inner(o) {
    o = o || {};
    // One back control only: the parent back (‹) when the page has a parent, else "← Brodoit". When there is a
    // parent, the way home is a small house button on the right (iOS-style), so the two never sit side by side.
    var h = o.back
      ? '<a class="bd-back press" href="' + esc(o.back) + '" aria-label="' + esc(o.backLabel || 'Back') + '">' + ic(o.backIcon === 'x' ? 'x' : 'chevron-left', 24) + '</a>'
      : '<a class="bd-home press" href="' + HOME + '" aria-label="Back to Brodoit">' + ic('arrow-left', 16) + '<span>Brodoit</span></a>';
    h += '<div class="bd-title">' + (o.title || '') + (o.subtitle ? '<small>' + o.subtitle + '</small>' : '') + '</div>';
    h += '<div class="bd-right">' + (o.right || '') + (o.back ? '<a class="bd-homeic press" href="' + HOME + '" aria-label="Back to Brodoit">' + ic('home', 20) + '</a>' : '') + '</div>';
    return h;
  }
  window.bdTopbar = function (o) {
    o = o || {};
    if (o.inner) return inner(o);
    var top = document.createElement('header');
    top.className = 'bd-top';
    top.innerHTML = '<div class="bd-top-in">' + inner(o) + '</div>';
    (o.mount || document.body).prepend(top);
    return top;
  };

  // ---- back guard ----
  try {
    // Cold open = no same-origin page before us in this tab (push, shortcut, pasted link, fresh tab).
    var ref = ''; try { ref = document.referrer ? new URL(document.referrer).origin : ''; } catch (e) {}
    var guarded = false; try { guarded = sessionStorage.getItem('bd_guard') === location.pathname + location.search; } catch (e) {}
    if (ref !== location.origin && !guarded && !(history.state && history.state.bd)) {
      var here = location.href;
      history.replaceState({ bd: 1 }, '', HOME);
      history.pushState({ bd: 2 }, '', here);
      try { sessionStorage.setItem('bd_guard', location.pathname + location.search); } catch (e) {}
    }
    window.addEventListener('popstate', function (e) {
      if (e.state && e.state.bd === 1) location.replace(HOME);
    });
  } catch (e) { /* history API unavailable (sandboxed frame) */ }
})();
