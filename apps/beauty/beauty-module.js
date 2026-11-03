/* MAOMAO beauty editor native app module.
 * The legacy editor keeps its original markup, storage keys and ChatBeauty data model.
 * Only its document boundary and event wiring are adapted to the persistent app shell.
 */
(function (global, document) {
  'use strict';

  var SCRIPT_URL = new URL(document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : 'apps/beauty/beauty-module.js', document.baseURI);
  var PAGE_URL = new URL('../../beauty/beauty.html', SCRIPT_URL);
  var PAGE_FETCH_URL = new URL(PAGE_URL.href);
  PAGE_FETCH_URL.searchParams.set('maomao_native', '20261103v1');
  var STYLE_CACHE = new Map();
  var SCRIPT_CACHE = new Map();

  function fetchText(url, label) {
    var cache = label === '样式' ? STYLE_CACHE : SCRIPT_CACHE;
    var key = url.href;
    if (cache.has(key)) return cache.get(key);
    var pending = global.fetch(url.href, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('无法加载美化编辑器' + label + '（HTTP ' + response.status + '）');
      return response.text();
    });
    cache.set(key, pending);
    pending.catch(function () { cache.delete(key); });
    return pending;
  }

  function runSharedScript(url, source) {
    var path = url.pathname;
    if (path.endsWith('/native-feel.js') || path.endsWith('/statusbar-control.js')) return;
    if (path.endsWith('/font-loader.js')) {
      if (!global.MAOMAOFontRuntime) {
        new Function(source + '\n//# sourceURL=maomao-beauty-font-loader.js')();
      }
      return;
    }
    if (path.endsWith('/wallpaper-store.js')) {
      if (!global.MAOMAOWallpaperStore) {
        new Function('window', 'document', source + '\n//# sourceURL=maomao-beauty-wallpaper-store.js')(
          global,
          document
        );
      }
      return;
    }
    if (path.endsWith('/chat-beauty.js')) {
      if (!global.ChatBeauty) {
        new Function('window', source + '\n//# sourceURL=maomao-beauty-chat-beauty.js')(global);
      }
      return;
    }
    throw new Error('未配置原生加载方式的美化编辑器脚本：' + path);
  }

  function scopeBeautyCss(source) {
    return String(source || '')
      .replace(/(^|[,{]\s*)(?:html|body)(?=[\s.#:[>+~,{])/gm, '$1:host')
      .replace(/:root\b/g, ':host');
  }

  function createDocumentFacade(shadow, host, bodyElement) {
    function getById(id) {
      if (typeof shadow.getElementById === 'function') return shadow.getElementById(id);
      return shadow.querySelector('[id="' + String(id).replace(/"/g, '\\"') + '"]');
    }

    return {
      getElementById: getById,
      querySelector: function (selector) { return shadow.querySelector(selector); },
      querySelectorAll: function (selector) { return shadow.querySelectorAll(selector); },
      createElement: function (tagName, options) { return document.createElement(tagName, options); },
      createTextNode: function (value) { return document.createTextNode(value); },
      addEventListener: function (type, listener, options) { shadow.addEventListener(type, listener, options); },
      removeEventListener: function (type, listener, options) { shadow.removeEventListener(type, listener, options); },
      dispatchEvent: function (event) { return shadow.dispatchEvent(event); },
      execCommand: function (command) {
        return typeof document.execCommand === 'function' ? document.execCommand(command) : false;
      },
      get body() { return bodyElement || shadow; },
      get documentElement() { return host; },
      get head() { return shadow; },
      get readyState() { return 'complete'; },
      get currentScript() { return null; }
    };
  }

  function createPageLocation(pageUrl) {
    var location = {};
    [
      'href', 'origin', 'protocol', 'host', 'hostname', 'port',
      'pathname', 'search', 'hash', 'searchParams'
    ].forEach(function (key) {
      Object.defineProperty(location, key, {
        enumerable: true,
        get: function () { return pageUrl[key]; }
      });
    });
    location.assign = function (value) {
      var destination = new URL(String(value), pageUrl);
      global.__MAOMAO_LEGACY_HOST__ &&
        global.__MAOMAO_LEGACY_HOST__.open(destination.href);
    };
    location.replace = function (value) {
      var destination = new URL(String(value), pageUrl);
      global.__MAOMAO_LEGACY_HOST__ &&
        global.__MAOMAO_LEGACY_HOST__.open(destination.href, { replace: true });
    };
    location.toString = function () { return pageUrl.href; };
    location.valueOf = function () { return pageUrl.href; };
    return location;
  }

  function createPageWindow(pageUrl, trackedListeners) {
    var location = createPageLocation(pageUrl);
    var localValues = Object.create(null);
    var fetchForPage = function (input, init) {
      var url = input instanceof URL ? input : new URL(String(input), pageUrl);
      return global.fetch(url.href, init);
    };

    return new Proxy(global, {
      get: function (target, key) {
        if (key === 'location') return location;
        if (key === 'history') return global.history;
        if (key === 'fetch') return fetchForPage;
        if (Object.prototype.hasOwnProperty.call(localValues, key)) return localValues[key];
        if (key === 'addEventListener') {
          return function (type, listener, options) {
            global.addEventListener(type, listener, options);
            trackedListeners.push({ type: type, listener: listener, options: options });
          };
        }
        if (key === 'removeEventListener') {
          return function (type, listener, options) {
            global.removeEventListener(type, listener, options);
            var remaining = trackedListeners.filter(function (entry) {
              return entry.type !== type || entry.listener !== listener;
            });
            trackedListeners.splice(0, trackedListeners.length);
            remaining.forEach(function (entry) { trackedListeners.push(entry); });
          };
        }
        var value = Reflect.get(target, key, target);
        if (typeof value === 'function' &&
            (key === 'dispatchEvent' || key === 'getComputedStyle' ||
             key === 'matchMedia' || key === 'requestAnimationFrame' ||
             key === 'cancelAnimationFrame' || key === 'confirm' ||
             key === 'prompt' || key === 'scrollTo')) {
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

  function bindInlineActions(shadow, exports, moduleWindow) {
    shadow.querySelectorAll('[onclick]').forEach(function (element) {
      var expression = (element.getAttribute('onclick') || '').trim();
      element.removeAttribute('onclick');

      var call = expression.match(/^([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?$/);
      if (call) {
        var handler = exports[call[1]] ||
          (moduleWindow.__MAOMAOBeautyCallbacks && moduleWindow.__MAOMAOBeautyCallbacks[call[1]]);
        if (typeof handler === 'function') {
          element.addEventListener('click', function () { handler(); });
        }
        return;
      }

      var clickTarget = expression.match(/^document\.getElementById\(['"]([^'"]+)['"]\)\.click\(\)\s*;?$/);
      if (clickTarget) {
        element.addEventListener('click', function () {
          var target = shadow.getElementById
            ? shadow.getElementById(clickTarget[1])
            : shadow.querySelector('[id="' + clickTarget[1] + '"]');
          if (target) target.click();
        });
      }
    });
  }

  function bindAnchorNavigation(shadow, pageUrl) {
    shadow.addEventListener('click', function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest('a[href]')
        : null;
      if (!target || !shadow.contains(target)) return;
      if (target.hasAttribute('download') || target.target === '_blank') return;
      var href = target.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || /^(?:javascript:|mailto:|tel:)/i.test(href)) return;

      var destination;
      try { destination = new URL(href, pageUrl); } catch (error) { return; }
      if (destination.origin !== global.location.origin) return;

      var bridge = global.__MAOMAO_LEGACY_HOST__;
      if (bridge && typeof bridge.open === 'function' && bridge.open(destination.href)) {
        event.preventDefault();
      }
    }, true);
  }

  function createBeautyModule() {
    return {
      async mount(host, context) {
        if (!host || typeof host.attachShadow !== 'function') {
          throw new Error('Beauty editor requires a Shadow DOM-capable host');
        }

        var params = context && context.params ? context.params : {};
        var pageUrl = params.url ? new URL(params.url, PAGE_URL) : new URL(PAGE_URL.href);
        var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
        var trackedListeners = [];
        var moduleWindow = createPageWindow(pageUrl, trackedListeners);
        host.setAttribute('aria-busy', 'true');

        try {
          var html = await fetchText(PAGE_FETCH_URL, '页面');
          var parsed = new DOMParser().parseFromString(html, 'text/html');
          var scriptNodes = Array.from(parsed.querySelectorAll('script'));
          var styleNodes = Array.from(parsed.querySelectorAll('style'));
          var cssLinks = Array.from(parsed.querySelectorAll('link[rel~="stylesheet"]'));
          var scriptSources = await Promise.all(scriptNodes.map(function (node) {
            var src = node.getAttribute('src');
            if (!src) return Promise.resolve({ node: node, source: node.textContent || '', url: null });
            var url = new URL(src, PAGE_URL);
            return fetchText(url, '脚本').then(function (source) {
              return { node: node, source: source, url: url };
            });
          }));
          var cssSources = await Promise.all(cssLinks.map(function (node) {
            var url = new URL(node.getAttribute('href'), PAGE_URL);
            return fetchText(url, '样式').then(function (source) {
              return { url: url, source: source };
            });
          }));

          shadow.innerHTML = '';
          var styleElement = document.createElement('style');
          var styles = cssSources.map(function (item) { return item.source; });
          styles.push.apply(styles, styleNodes.map(function (node) { return node.textContent || ''; }));
          styles.push([
            '',
            ':host { width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:#fff; }',
            ':host > .maomao-beauty-page { display:flex; width:100%; height:100%; min-width:0; min-height:0; justify-content:center; align-items:stretch; overflow:hidden; }',
            ':host .phone { width:100% !important; max-width:none !important; height:100% !important; max-height:none !important; min-height:0 !important; margin:0 !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; }',
            ':host .content { min-height:0; overscroll-behavior:contain; }'
          ].join('\n'));
          styleElement.textContent = styles.map(scopeBeautyCss).join('\n\n');
          shadow.appendChild(styleElement);

          parsed.querySelectorAll('script, style, link[rel~="stylesheet"]').forEach(function (node) {
            node.remove();
          });
          var markup = document.createElement('div');
          markup.className = 'maomao-beauty-page';
          markup.innerHTML = parsed.body.innerHTML;
          shadow.appendChild(markup);

          var documentFacade = createDocumentFacade(shadow, host, markup);
          var inlineSources = [];
          for (var i = 0; i < scriptSources.length; i++) {
            var item = scriptSources[i];
            if (item.url) runSharedScript(item.url, item.source);
            else if (item.source.trim()) inlineSources.push(item.source);
          }

          if (inlineSources.length) {
            var secondScript = inlineSources[1];
            if (secondScript) {
              var closeIndex = secondScript.lastIndexOf('})();');
              if (closeIndex >= 0) {
                inlineSources[1] = secondScript.slice(0, closeIndex) +
                  '\nwindow.__MAOMAOBeautyCallbacks = { clearVisualBg: clearVisualBg };\n' +
                  secondScript.slice(closeIndex);
              }
            }

            var combinedSource = 'var rightAction;\n' + inlineSources.join('\n;\n') + [
              '',
              'var __beautyRenderList = renderList;',
              'renderList = function () {',
              '  __beautyRenderList();',
              '  var box = document.getElementById("presetList");',
              '  if (!box) return;',
              '  Array.prototype.forEach.call(box.querySelectorAll(".preset-item"), function (row, index) {',
              '    var removeButton = row.querySelector(".preset-del");',
              '    if (removeButton) {',
              '      removeButton.removeAttribute("onclick");',
              '      removeButton.addEventListener("click", function (event) { delPreset(event, index); });',
              '    }',
              '    row.removeAttribute("onclick");',
              '    row.addEventListener("click", function () { usePreset(index); });',
              '  });',
              '};',
              'return {',
              '  goBack: goBack,',
              '  leftAction: function () { leftAction(); },',
              '  rightAction: function () { rightAction(); },',
              '  copyRef: copyRef,',
              '  renderList: function () { renderList(); }',
              '};',
              '\n//# sourceURL=maomao-beauty-editor.js'
            ].join('\n');
            var exports = new Function(
              'document', 'window', 'navigator', 'history', 'localStorage', 'fetch',
              'FileReader', 'URL', 'Image', 'Event', 'CustomEvent', 'setTimeout',
              'clearTimeout', 'confirm', 'console',
              combinedSource
            )(
              documentFacade,
              moduleWindow,
              global.navigator,
              global.history,
              global.localStorage,
              moduleWindow.fetch,
              global.FileReader,
              global.URL,
              global.Image,
              global.Event,
              global.CustomEvent,
              global.setTimeout.bind(global),
              global.clearTimeout.bind(global),
              global.confirm.bind(global),
              global.console
            );

            bindInlineActions(shadow, exports, moduleWindow);
            exports.renderList();
          }
          bindAnchorNavigation(shadow, pageUrl);

          host.removeAttribute('aria-busy');
          return function dispose() {
            trackedListeners.forEach(function (entry) {
              global.removeEventListener(entry.type, entry.listener, entry.options);
            });
            trackedListeners.length = 0;
            shadow.innerHTML = '';
            host.removeAttribute('aria-busy');
          };
        } catch (error) {
          host.removeAttribute('aria-busy');
          shadow.innerHTML = '';
          throw error;
        }
      }
    };
  }

  global.MAOMAOAppShell.registerModule('beauty', createBeautyModule());
})(window, document);
