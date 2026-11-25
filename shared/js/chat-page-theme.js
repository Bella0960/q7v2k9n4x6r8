/* Silver Butterfly page theme bridge.
 * Reuses ChatBeauty's existing global theme choice; no independent settings are created.
 */
(function (global) {
  'use strict';

  // POLISH-011: the iMessage preset's own stylesheet is injected by this shared
  // bridge so the refinements load on both list and detail pages. It stays
  // idempotent: the injected link is removed again when the preset leaves iMessage,
  // and skipped if the page already declares a static <link> for the same file.
  var IMSG_CSS_ID = 'maomao-imessage-theme-css';
  var IMSG_CSS_HREF = '../../shared/css/imessage-theme-refinements.css?v=20261125v1';

  function getTheme() {
    try {
      if (global.ChatBeauty && typeof global.ChatBeauty.getThemePreset === 'function') {
        return global.ChatBeauty.getThemePreset();
      }
      return global.localStorage.getItem('maomao_chat_theme_preset') || 'default';
    } catch (e) {
      return 'default';
    }
  }

  // The refinements sheet only targets the chat list / detail shells; do not
  // inject it on contacts, moments, profile or other non-chat pages.
  function isChatPage() {
    var b = document.body;
    return !!(b && (b.classList.contains('chat-light-list') || b.classList.contains('chat-light-detail')));
  }

  function ensureImessageStylesheet(on) {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    var injected = head.querySelector('#' + IMSG_CSS_ID);
    if (on) {
      if (!isChatPage()) return;
      if (injected) return;
      var runtimeLink = null;
      var links = head.querySelectorAll('link[rel="stylesheet"]');
      for (var j = 0; j < links.length; j++) {
        var href = links[j].getAttribute('href') || '';
        if (href.indexOf('imessage-theme-refinements.css') !== -1) return;
        if (href.indexOf('theme-studio-runtime.css') !== -1) runtimeLink = links[j];
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = IMSG_CSS_ID;
      link.href = IMSG_CSS_HREF;
      // Keep the same order as the static markup: refinements load before the
      // theme-studio runtime, so saved user overrides (header bg, input radius,
      // etc.) still win over this preset's defaults.
      if (runtimeLink) runtimeLink.parentNode.insertBefore(link, runtimeLink);
      else head.appendChild(link);
    } else if (injected) {
      injected.parentNode.removeChild(injected);
    }
  }

  function applyTheme() {
    var theme = getTheme();
    var shells = document.querySelectorAll('.phone-mockup');
    for (var i = 0; i < shells.length; i++) {
      shells[i].setAttribute('data-chat-theme-preset', theme);
    }
    ensureImessageStylesheet(theme === 'imessage');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
  } else {
    applyTheme();
  }

  global.addEventListener('pageshow', applyTheme);
  global.addEventListener('maomao:chat-theme-change', applyTheme);
  global.addEventListener('storage', function (event) {
    if (!event || event.key === 'maomao_chat_theme_preset') applyTheme();
  });
})(window);
