/* Silver Butterfly page theme bridge.
 * Reuses ChatBeauty's existing global theme choice; no independent settings are created.
 */
(function (global) {
  'use strict';

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

  function applyTheme() {
    var theme = getTheme();
    // iMessage is a chat-detail-only theme. Other pages keep their base
    // presentation rather than inheriting a mismatched blue profile skin.
    // This is visual only; the selected preset remains globally persisted.
    if (theme === 'imessage') {
      var pathname = String(global.location && global.location.pathname || '');
      if (pathname.split('/').pop().toLowerCase() !== 'chat-detail.html') theme = 'default';
    }
    var shells = document.querySelectorAll('.phone-mockup');
    for (var i = 0; i < shells.length; i++) {
      shells[i].setAttribute('data-chat-theme-preset', theme);
    }
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
