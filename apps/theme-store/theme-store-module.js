/* Native Theme Store app-shell module.
 * Keeps the original theme catalog, ChatBeauty data model, localStorage keys and font DB.
 */
(function (global, document) {
  'use strict';

  var SCRIPT_URL = new URL(document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : 'apps/theme-store/theme-store-module.js', document.baseURI);
  var PAGE_URL = new URL('../../theme-store/theme-store.html', SCRIPT_URL);
  var PAGE_FETCH_URL = new URL(PAGE_URL.href);
  PAGE_FETCH_URL.searchParams.set('maomao_native', '20261103v1');
  var APP_BASE = new URL('../../', SCRIPT_URL);
  var STYLE_CACHE = new Map();
  var SCRIPT_CACHE = new Map();

  function fetchText(url, label) {
    var cache = label === '样式' ? STYLE_CACHE : SCRIPT_CACHE;
    var key = url.href;
    if (cache.has(key)) return cache.get(key);
    var pending = global.fetch(url.href, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('无法加载主题商城' + label + '（HTTP ' + response.status + '）');
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
        new Function('window', source + '\n//# sourceURL=maomao-theme-store-font-loader.js')(global);
      }
      return;
    }
    if (path.endsWith('/chat-beauty.js')) {
      if (!global.ChatBeauty) {
        new Function('window', source + '\n//# sourceURL=maomao-theme-store-chat-beauty.js')(global);
      }
      return;
    }
    throw new Error('未配置原生加载方式的主题商城脚本：' + path);
  }

  function scopeAndResolveCss(source, baseUrl) {
    var scoped = String(source || '')
      .replace(/(^|[,{]\s*)(?:html|body)(?=[\s.#:[>+~,{])/gm, '$1:host')
      .replace(/:root\b/g, ':host');

    return scoped.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi, function (whole, quote, quoted, plain) {
      var value = String(quote ? quoted : plain || '').trim();
      if (!value || /^(?:data:|blob:|https?:|\/\/|#|var\()/i.test(value)) return whole;
      try {
        return 'url("' + new URL(value, baseUrl).href.replace(/"/g, '%22') + '")';
      } catch (error) {
        return whole;
      }
    });
  }

  function createDocumentFacade(shadow, host, pageRoot, trackedListeners) {
    function getById(id) {
      if (typeof shadow.getElementById === 'function') return shadow.getElementById(id);
      return shadow.querySelector('[id="' + String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    }

    return {
      getElementById: getById,
      querySelector: function (selector) { return shadow.querySelector(selector); },
      querySelectorAll: function (selector) { return shadow.querySelectorAll(selector); },
      createElement: function (tagName, options) { return document.createElement(tagName, options); },
      createTextNode: function (value) { return document.createTextNode(value); },
      addEventListener: function (type, listener, options) {
        document.addEventListener(type, listener, options);
        trackedListeners.push({ target: document, type: type, listener: listener, options: options });
      },
      removeEventListener: function (type, listener, options) {
        document.removeEventListener(type, listener, options);
        removeTrackedListener(trackedListeners, document, type, listener);
      },
      dispatchEvent: function (event) { return document.dispatchEvent(event); },
      get body() { return pageRoot || shadow; },
      get documentElement() { return host; },
      get head() { return shadow; },
      get fonts() { return document.fonts; },
      get hidden() { return document.hidden; },
      get visibilityState() { return document.visibilityState; },
      get readyState() { return 'complete'; },
      get baseURI() { return PAGE_URL.href; },
      get currentScript() { return null; }
    };
  }

  function removeTrackedListener(list, target, type, listener) {
    for (var i = list.length - 1; i >= 0; i--) {
      var entry = list[i];
      if (entry.target === target && entry.type === type && entry.listener === listener) {
        list.splice(i, 1);
      }
    }
  }

  function createPageLocation(pageUrl) {
    function navigate(value, replace) {
      var destination = new URL(String(value), pageUrl);
      var bridge = global.__MAOMAO_LEGACY_HOST__;
      if (bridge && typeof bridge.open === 'function') {
        bridge.open(destination.href, replace ? { replace: true } : undefined);
      } else if (replace) {
        global.location.replace(destination.href);
      } else {
        global.location.assign(destination.href);
      }
    }

    var location = {};
    [
      'origin', 'protocol', 'host', 'hostname', 'port',
      'pathname', 'search', 'hash'
    ].forEach(function (key) {
      Object.defineProperty(location, key, {
        enumerable: true,
        get: function () { return pageUrl[key]; }
      });
    });
    Object.defineProperty(location, 'href', {
      enumerable: true,
      get: function () { return pageUrl.href; },
      set: function (value) { navigate(value, false); }
    });
    location.assign = function (value) { navigate(value, false); };
    location.replace = function (value) { navigate(value, true); };
    location.toString = function () { return pageUrl.href; };
    location.valueOf = function () { return pageUrl.href; };
    return location;
  }

  function createPageWindow(pageUrl, trackedListeners, urlApi) {
    var location = createPageLocation(pageUrl);
    var localValues = Object.create(null);
    var pageHistory = {
      get length() { return global.history.length; },
      back: function () {
        if (global.history.length > 1) {
          global.history.back();
          return;
        }
        var bridge = global.__MAOMAO_LEGACY_HOST__;
        if (bridge && typeof bridge.home === 'function') {
          bridge.home();
        } else {
          global.history.back();
        }
      }
    };

    return new Proxy(global, {
      get: function (target, key) {
        if (key === 'location') return location;
        if (key === 'history') return pageHistory;
        if (key === 'URL') return urlApi;
        if (Object.prototype.hasOwnProperty.call(localValues, key)) return localValues[key];
        if (key === 'addEventListener') {
          return function (type, listener, options) {
            global.addEventListener(type, listener, options);
            trackedListeners.push({ target: global, type: type, listener: listener, options: options });
          };
        }
        if (key === 'removeEventListener') {
          return function (type, listener, options) {
            global.removeEventListener(type, listener, options);
            removeTrackedListener(trackedListeners, global, type, listener);
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

  function createTrackedUrlApi(objectUrls) {
    function TrackedURL() {
      return Reflect.construct(global.URL, Array.prototype.slice.call(arguments), global.URL);
    }
    TrackedURL.prototype = global.URL.prototype;
    TrackedURL.createObjectURL = function (value) {
      var url = global.URL.createObjectURL(value);
      objectUrls.push(url);
      return url;
    };
    TrackedURL.revokeObjectURL = function (url) {
      var index = objectUrls.indexOf(url);
      if (index >= 0) objectUrls.splice(index, 1);
      return global.URL.revokeObjectURL(url);
    };
    TrackedURL.canParse = global.URL.canParse ? global.URL.canParse.bind(global.URL) : undefined;
    TrackedURL.parse = global.URL.parse ? global.URL.parse.bind(global.URL) : undefined;
    return TrackedURL;
  }

  function createThemeStoreModule() {
    return {
      async mount(host, context) {
        if (!host || typeof host.attachShadow !== 'function') {
          throw new Error('Theme Store requires a Shadow DOM-capable host');
        }

        var params = context && context.params ? context.params : {};
        var pageUrl = params.url ? new URL(params.url, PAGE_URL) : new URL(PAGE_URL.href);
        var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
        var trackedListeners = [];
        var objectUrls = [];
        var urlApi = createTrackedUrlApi(objectUrls);
        var moduleWindow = createPageWindow(pageUrl, trackedListeners, urlApi);
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
          var styles = cssSources.map(function (item) {
            return scopeAndResolveCss(item.source, item.url);
          });
          styles.push.apply(styles, styleNodes.map(function (node) {
            return scopeAndResolveCss(node.textContent || '', PAGE_URL);
          }));
          styles.push([
            '',
            ':host { width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:#fff; }',
            ':host > .maomao-theme-store-page { display:flex; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; }',
            ':host .store-app { width:100% !important; max-width:none !important; height:100% !important; min-height:0 !important; margin:0 !important; }',
            ':host .main-content { min-height:0 !important; }'
          ].join('\n'));
          styleElement.textContent = styles.join('\n\n');
          shadow.appendChild(styleElement);

          parsed.querySelectorAll('script, style, link[rel~="stylesheet"]').forEach(function (node) {
            node.remove();
          });
          var markup = document.createElement('div');
          markup.className = 'maomao-theme-store-page';
          markup.innerHTML = parsed.body.innerHTML;
          shadow.appendChild(markup);

          var documentFacade = createDocumentFacade(shadow, host, markup, trackedListeners);

          for (var i = 0; i < scriptSources.length; i++) {
            var item = scriptSources[i];
            if (item.url) runSharedScript(item.url, item.source);
            else if (item.source.trim()) {
              new Function(
                'document', 'window', 'localStorage', 'indexedDB',
                'CustomEvent', 'FontFace', 'URL', 'setTimeout', 'clearTimeout', 'console',
                item.source + '\n//# sourceURL=maomao-theme-store.js'
              )(
                documentFacade,
                moduleWindow,
                global.localStorage,
                global.indexedDB,
                global.CustomEvent,
                global.FontFace,
                urlApi,
                global.setTimeout.bind(global),
                global.clearTimeout.bind(global),
                global.console
              );
            }
          }

          host.removeAttribute('aria-busy');
          return function dispose() {
            trackedListeners.forEach(function (entry) {
              entry.target.removeEventListener(entry.type, entry.listener, entry.options);
            });
            trackedListeners.length = 0;
            objectUrls.slice().forEach(function (url) {
              try { urlApi.revokeObjectURL(url); } catch (error) {}
            });
            objectUrls.length = 0;
            shadow.innerHTML = '';
            host.removeAttribute('aria-busy');
          };
        } catch (error) {
          trackedListeners.forEach(function (entry) {
            entry.target.removeEventListener(entry.type, entry.listener, entry.options);
          });
          trackedListeners.length = 0;
          host.removeAttribute('aria-busy');
          shadow.innerHTML = '';
          throw error;
        }
      }
    };
  }

  global.MAOMAOAppShell.registerModule('theme_store', createThemeStoreModule());
})(window, document);
