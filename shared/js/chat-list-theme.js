(function (global) {
  'use strict';

  var STORAGE_KEY = 'maomao_chat_list_theme_preset_v1';
  var THEME_ID = 'editorial';

  function readTheme() {
    try {
      return global.localStorage.getItem(STORAGE_KEY) === THEME_ID ? THEME_ID : '';
    } catch (error) {
      return '';
    }
  }

  function applyTheme() {
    var shell = document.querySelector('.phone-mockup');
    if (!shell) return;

    if (readTheme() === THEME_ID) {
      shell.setAttribute('data-chat-list-theme', THEME_ID);
    } else {
      shell.removeAttribute('data-chat-list-theme');
    }
  }

  function setTheme(theme) {
    try {
      if (theme === THEME_ID) global.localStorage.setItem(STORAGE_KEY, THEME_ID);
      else global.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      return false;
    }
    applyTheme();
    return true;
  }

  global.MAOMAOChatListTheme = {
    get: readTheme,
    set: setTheme,
    refresh: applyTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
  } else {
    applyTheme();
  }

  global.addEventListener('pageshow', applyTheme);
  global.addEventListener('maomao:chat-list-theme-change', applyTheme);
  global.addEventListener('storage', function (event) {
    if (!event || event.key === STORAGE_KEY) applyTheme();
  });
})(window);
