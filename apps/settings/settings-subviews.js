(function (global, document) {
  'use strict';

  var SETTINGS_BASE = new URL('../../settings/', document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('apps/settings/settings-subviews.js', document.baseURI).href);

  var PAGES = [
    { id: 'settings_appearance', path: 'appearance.html', title: '外观' },
    { id: 'settings_font', path: 'font-settings.html', title: '字体设置' },
    { id: 'settings_sound', path: 'sound-settings.html', title: '音效设置' },
    { id: 'settings_icons', path: 'icon-settings.html', title: '自定义图标' }
  ];

  var scriptCache = new Map();
  var styleCache = new Map();

  function fetchText(url, label) {
    return global.fetch(url.href, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('无法加载' + label + '（HTTP ' + response.status + '）');
      return response.text();
    });
  }

  function loadScriptSource(url) {
    var key = url.href;
    if (scriptCache.has(key)) return scriptCache.get(key);
    var pending = fetchText(url, '设置功能脚本');
    scriptCache.set(key, pending);
    pending.catch(function () { scriptCache.delete(key); });
    return pending;
  }

  function loadStyleSource(url) {
    var key = url.href;
    if (styleCache.has(key)) return styleCache.get(key);
    var pending = fetchText(url, '设置样式');
    styleCache.set(key, pending);
    pending.catch(function () { styleCache.delete(key); });
    return pending;
  }

  function createModuleWindow(pageUrl, localValues) {
    return new Proxy(global, {
      get: function (target, key) {
        if (key === 'location') return pageUrl;
        if (Object.prototype.hasOwnProperty.call(localValues, key)) return localValues[key];
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
        localValues[key] = value;
        return true;
      },
      has: function (target, key) {
        return Object.prototype.hasOwnProperty.call(localValues, key) || key in target;
      }
    });
  }

  function createDocumentFacade(shadow, host, bodyElement) {
    function getById(id) {
      if (typeof shadow.getElementById === 'function') return shadow.getElementById(id);
      return shadow.querySelector('[id="' + String(id).replace(/"/g, '\\\"') + '"]');
    }

    return {
      getElementById: getById,
      querySelector: function (selector) { return shadow.querySelector(selector); },
      querySelectorAll: function (selector) { return shadow.querySelectorAll(selector); },
      createElement: function (tagName, options) { return document.createElement(tagName, options); },
      addEventListener: function (type, listener, options) { shadow.addEventListener(type, listener, options); },
      removeEventListener: function (type, listener, options) { shadow.removeEventListener(type, listener, options); },
      dispatchEvent: function (event) { return shadow.dispatchEvent(event); },
      get body() { return bodyElement || shadow; },
      get documentElement() { return host; },
      get head() { return shadow; },
      get readyState() { return 'complete'; },
      get currentScript() { return null; }
    };
  }

  function scopePageCss(source) {
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
      '.phone-mockup > .content, .phone-mockup > .stage { min-height:0; }'
    ].join('\n');
    return css;
  }

  function shouldSkipExternalScript(url, moduleWindow) {
    var path = url.pathname;
    if (path.endsWith('/font-loader.js')) return !!moduleWindow.MAOMAOFontRuntime;
    if (path.endsWith('/wallpaper-store.js')) return !!moduleWindow.MAOMAOWallpaperStore;
    if (path.endsWith('/native-feel.js')) return true;
    if (path.endsWith('/statusbar-control.js')) return true;
    return false;
  }

  function runExternalScript(url, source, documentFacade, moduleWindow) {
    var path = url.pathname;
    if (shouldSkipExternalScript(url, moduleWindow)) return;
    if (path.endsWith('/sound-system.js')) {
      if (!global.SoundSystem) {
        global.SoundSystem = new Function('window', source + '\nreturn SoundSystem;\n//# sourceURL=maomao-sound-system.js')(global);
      }
      return;
    }
    if (path.endsWith('/liquid-glass-controls.js')) {
      new Function('document', 'window', source + '\n//# sourceURL=maomao-liquid-glass-controls.js')(
        documentFacade,
        moduleWindow
      );
      return;
    }
    throw new Error('未配置原生加载方式的设置脚本：' + path);
  }

  function bindNavigation(shadow, pageUrl) {
    var hostBridge = global.__MAOMAO_LEGACY_HOST__;
    function navigate(rawUrl, event) {
      if (!hostBridge || !rawUrl || rawUrl === '#') return false;
      var destination;
      try { destination = new URL(rawUrl, pageUrl); } catch (error) { return false; }
      if (destination.origin !== global.location.origin) return false;
      if (!/^\/settings\/(?:settings|appearance|font-settings|sound-settings|icon-settings)\.html$/.test(destination.pathname)) {
        return false;
      }
      if (event) event.preventDefault();
      hostBridge.open(destination.href, destination.pathname.endsWith('/settings/settings.html') ? { replace: true } : undefined);
      return true;
    }

    shadow.querySelectorAll('[onclick]').forEach(function (element) {
      var expression = element.getAttribute('onclick') || '';
      var match = expression.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (!match) return;
      element.removeAttribute('onclick');
      element.addEventListener('click', function (event) { navigate(match[1], event); });
    });

    shadow.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!target || !shadow.contains(target)) return;
      var href = target.getAttribute('href');
      if (href && href.charAt(0) === '#') return;
      navigate(href, event);
    }, true);
  }

  function createPageModule(page) {
    return {
      async mount(host) {
        if (!host || typeof host.attachShadow !== 'function') {
          throw new Error('Settings subview requires a Shadow DOM-capable host');
        }

        var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
        host.setAttribute('aria-busy', 'true');
        host.classList.toggle('dark', global.localStorage.getItem('settings_dark_mode') === '1');

        var pageUrl = new URL(page.path, SETTINGS_BASE);
        var html = await fetchText(pageUrl, page.title + '页面');
        var parser = new DOMParser();
        var parsed = parser.parseFromString(html, 'text/html');
        var styleNodes = Array.from(parsed.querySelectorAll('style'));
        var scriptNodes = Array.from(parsed.querySelectorAll('script'));
        var styleTexts = styleNodes.map(function (node) { return node.textContent || ''; });
        var externalCss = Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'))
          .map(function (node) { return new URL(node.getAttribute('href'), pageUrl); })
          .filter(function (url) { return url.pathname.endsWith('/settings/css/settings.css'); });
        var scriptSources = await Promise.all(scriptNodes.map(function (node) {
          var src = node.getAttribute('src');
          if (!src) return Promise.resolve({ node: node, source: node.textContent || '', url: null });
          var url = new URL(src, pageUrl);
          return loadScriptSource(url).then(function (source) {
            return { node: node, source: source, url: url };
          });
        }));
        var cssTexts = await Promise.all(externalCss.map(loadStyleSource));

        parsed.querySelectorAll('script, link[rel="stylesheet"]').forEach(function (node) { node.remove(); });
        shadow.innerHTML = '';

        var styles = [];
        if (cssTexts.length) styles.push.apply(styles, cssTexts);
        styles.push.apply(styles, styleTexts);
        var styleElement = document.createElement('style');
        styleElement.textContent = scopePageCss(styles.join('\n\n'));
        shadow.appendChild(styleElement);

        var markup = document.createElement('div');
        markup.className = 'maomao-settings-subview';
        markup.innerHTML = parsed.body.innerHTML;
        shadow.appendChild(markup);

        var documentFacade = createDocumentFacade(shadow, host, markup);
        var localWindowValues = Object.create(null);
        var moduleWindow = createModuleWindow(pageUrl, localWindowValues);

        // 原页面脚本的执行顺序不变：头部依赖 → 页面初始化脚本 → 页面末尾控件脚本。
        for (var i = 0; i < scriptSources.length; i++) {
          var item = scriptSources[i];
          if (item.url) {
            runExternalScript(item.url, item.source, documentFacade, moduleWindow);
          } else if (item.source.trim()) {
            new Function('document', 'window', item.source + '\n//# sourceURL=maomao-settings-' + page.id + '.js')(
              documentFacade,
              moduleWindow
            );
          }
        }

        bindNavigation(shadow, pageUrl);
        var themeListener = function () {
          var theme = global.MAOMAOTheme && global.MAOMAOTheme.get
            ? global.MAOMAOTheme.get()
            : global.localStorage.getItem('maomao_theme') || 'classic';
          host.setAttribute('data-theme', theme);
        };
        global.addEventListener('maomao:themechange', themeListener);
        themeListener();

        host.removeAttribute('aria-busy');

        return function dispose() {
          global.removeEventListener('maomao:themechange', themeListener);
          shadow.innerHTML = '';
          host.classList.remove('dark');
        };
      }
    };
  }

  PAGES.forEach(function (page) {
    var implementation = createPageModule(page);
    global.MAOMAOAppShell.registerModule(page.id, {
      mount: async function (host, context) {
        try {
          return await implementation.mount(host, context);
        } catch (error) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[MAOMAO settings subview]', page.id, error);
          }
          throw error;
        }
      }
    });
  });
})(window, document);
