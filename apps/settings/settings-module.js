(function (global, document) {
  'use strict';

  var phoneStoragePromise = null;
  var settingsModule = {
    async mount(host) {
      if (!host || typeof host.attachShadow !== 'function') {
        throw new Error('Settings module requires a Shadow DOM-capable host');
      }

      var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
      host.setAttribute('aria-busy', 'true');
      host.classList.remove('dark');

      var moduleScriptUrl = document.currentScript && document.currentScript.src
        ? document.currentScript.src
        : new URL('apps/settings/settings-module.js', document.baseURI).href;
      var settingsUrl = new URL('../../settings/settings.html', moduleScriptUrl);
      var cssUrl = new URL('settings.css', moduleScriptUrl);
      var settingsScriptUrl = new URL('js/settings.js', settingsUrl);
      var backupScriptUrl = new URL('js/backup.js', settingsUrl);
      var phoneStorageUrl = new URL('../shared/js/phone/phone_storage.js', settingsUrl);

      function fetchText(url, label) {
        return global.fetch(url.href, { credentials: 'same-origin' }).then(function (response) {
          if (!response.ok) throw new Error('无法加载' + label + '（HTTP ' + response.status + '）');
          return response.text();
        });
      }

      function ensurePhoneStorage() {
        if (global.PhoneStorage) return Promise.resolve();
        if (phoneStoragePromise) return phoneStoragePromise;
        phoneStoragePromise = new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = phoneStorageUrl.href;
          script.async = true;
          script.onload = function () {
            if (global.PhoneStorage) resolve();
            else reject(new Error('PhoneStorage 脚本已加载，但没有注册 PhoneStorage'));
          };
          script.onerror = function () {
            phoneStoragePromise = null;
            reject(new Error('PhoneStorage 加载失败'));
          };
          document.head.appendChild(script);
        });
        return phoneStoragePromise;
      }

      var loaded = await Promise.all([
        fetchText(settingsUrl, '设置页面'),
        fetchText(cssUrl, '设置样式'),
        fetchText(settingsScriptUrl, '设置逻辑'),
        fetchText(backupScriptUrl, '备份恢复逻辑'),
        ensurePhoneStorage()
      ]);

      var parser = new DOMParser();
      var parsed = parser.parseFromString(loaded[0], 'text/html');
      var inlineScripts = Array.from(parsed.querySelectorAll('script:not([src])'));
      var bottomInlineScript = inlineScripts.length
        ? inlineScripts[inlineScripts.length - 1].textContent
        : '';

      parsed.querySelectorAll('script').forEach(function (script) {
        script.remove();
      });

      shadow.innerHTML = '';
      var style = document.createElement('style');
      style.textContent = scopeSettingsCss(loaded[1]);
      shadow.appendChild(style);

      var markup = document.createElement('div');
      markup.className = 'maomao-settings-root';
      markup.innerHTML = parsed.body.innerHTML;
      shadow.appendChild(markup);

      var documentFacade = {
        getElementById: function (id) {
          if (typeof shadow.getElementById === 'function') return shadow.getElementById(id);
          return shadow.querySelector('[id="' + String(id).replace(/"/g, '\\\"') + '"]');
        },
        createElement: function (tagName, options) {
          return document.createElement(tagName, options);
        },
        get body() {
          return shadow;
        },
        get documentElement() {
          return host;
        },
        get head() {
          return document.head;
        }
      };

      var moduleWindowValues = Object.create(null);
      var moduleWindow = new Proxy(global, {
        get: function (target, key) {
          if (Object.prototype.hasOwnProperty.call(moduleWindowValues, key)) {
            return moduleWindowValues[key];
          }
          var value = Reflect.get(target, key, target);
          if (typeof value === 'function' &&
              (key === 'addEventListener' || key === 'removeEventListener' ||
               key === 'dispatchEvent' || key === 'getComputedStyle' ||
               key === 'requestAnimationFrame' || key === 'cancelAnimationFrame')) {
            return value.bind(target);
          }
          return value;
        },
        set: function (target, key, value) {
          moduleWindowValues[key] = value;
          return true;
        },
        has: function (target, key) {
          return Object.prototype.hasOwnProperty.call(moduleWindowValues, key) || key in target;
        }
      });

      var settingsFactory = new Function(
        'document',
        'window',
        loaded[2] + '\nreturn { toggleKeyVisibility: toggleKeyVisibility, fetchModels: fetchModels, showToast: showToast };\n//# sourceURL=maomao-settings-module.js'
      );
      var settingsApi = settingsFactory(documentFacade, moduleWindow);
      moduleWindowValues.showToast = settingsApi.showToast;

      if (loaded[3]) {
        var backupFactory = new Function(
          'document',
          'window',
          loaded[3] + '\n//# sourceURL=maomao-settings-backup-module.js'
        );
        backupFactory(documentFacade, moduleWindow);
      }

      if (bottomInlineScript) {
        var inlineFactory = new Function(
          'document',
          'window',
          'showToast',
          bottomInlineScript + '\n//# sourceURL=maomao-settings-inline-module.js'
        );
        inlineFactory(documentFacade, moduleWindow, settingsApi.showToast);
      }

      host.classList.toggle('dark', global.localStorage.getItem('settings_dark_mode') === '1');
      bindInlineActions(shadow, settingsApi, settingsUrl, moduleWindow);

      host.removeAttribute('aria-busy');

      return function disposeSettingsModule() {
        shadow.innerHTML = '';
        host.classList.remove('dark');
      };
    }
  };

  function scopeSettingsCss(source) {
    var css = String(source || '');
    css = css.replace(/html\.dark\s+body/g, ':host(.dark)');
    css = css.replace(/html\.dark/g, ':host(.dark)');
    css = css.replace(/:root\s*\{/g, ':host {');
    css = css.replace(/(^|[,\s>+~])body(?=\s*\{)/gm, '$1:host');
    css += [
      '',
      ':host { display:flex; width:100%; height:100%; min-width:0; min-height:0; justify-content:stretch; align-items:stretch; overflow:hidden; background:var(--bg,#fff); }',
      ':host(.dark) { background:#000; }',
      '.phone-mockup { width:100% !important; max-width:none !important; height:100% !important; max-height:none !important; min-height:0 !important; margin:0 !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; }',
      '.phone-mockup > .content { min-height:0; }',
      '#chatLangSheet { position:absolute !important; }'
    ].join('\n');
    return css;
  }

  function bindInlineActions(shadow, settingsApi, settingsUrl, moduleWindow) {
    var hostBridge = global.__MAOMAO_LEGACY_HOST__;
    var inlineElements = Array.from(shadow.querySelectorAll('[onclick]'));

    inlineElements.forEach(function (element) {
      var expression = element.getAttribute('onclick') || '';
      var routeMatch = expression.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/);
      element.removeAttribute('onclick');

      if (routeMatch) {
        element.addEventListener('click', function (event) {
          event.preventDefault();
          if (!hostBridge) return;
          var destination = new URL(routeMatch[1], settingsUrl);
          if (destination.pathname.endsWith('/index.html') || destination.pathname === '/') {
            hostBridge.home();
          } else {
            hostBridge.open(destination.href);
          }
        });
        return;
      }

      if (expression.indexOf("document.getElementById('api-panel').style.display='flex'") !== -1) {
        element.addEventListener('click', function () {
          var panel = shadow.getElementById('api-panel');
          if (panel) panel.style.display = 'flex';
        });
        return;
      }
      if (expression.indexOf("document.getElementById('api-panel').style.display='none'") !== -1) {
        element.addEventListener('click', function () {
          var panel = shadow.getElementById('api-panel');
          if (panel) panel.style.display = 'none';
        });
        return;
      }
      if (expression.indexOf('toggleKeyVisibility()') !== -1) {
        element.addEventListener('click', function () { settingsApi.toggleKeyVisibility(); });
        return;
      }
      if (expression.indexOf('fetchModels()') !== -1) {
        element.addEventListener('click', function () { settingsApi.fetchModels(); });
        return;
      }
      if (expression.indexOf('openChatLangSheet()') !== -1) {
        element.addEventListener('click', function () {
          if (typeof moduleWindow.openChatLangSheet === 'function') moduleWindow.openChatLangSheet();
        });
        return;
      }
      if (expression.indexOf('closeChatLangSheet()') !== -1) {
        element.addEventListener('click', function () {
          if (typeof moduleWindow.closeChatLangSheet === 'function') moduleWindow.closeChatLangSheet();
        });
        return;
      }
      if (expression.indexOf('event.target===this') !== -1) {
        element.addEventListener('click', function (event) {
          if (event.target === element && typeof moduleWindow.closeChatLangSheet === 'function') {
            moduleWindow.closeChatLangSheet();
          }
        });
      }
    });
  }

  if (!global.MAOMAOAppShell || typeof global.MAOMAOAppShell.registerModule !== 'function') {
    throw new Error('MAOMAO app-shell runtime must load before settings-module.js');
  }
  global.MAOMAOAppShell.registerModule('settings', settingsModule);
})(window, document);
