(function (global, document) {
  'use strict';

  function createLegacyHost(options) {
    options = options || {};
    var win = options.window || global;
    var doc = options.document || document;
    var root = options.root || doc.getElementById('maomao-app-host');
    if (!root) throw new Error('MAOMAO app host root was not found');

    var routeParam = options.routeParam || 'maomao_app';
    var maxFrames = Math.max(2, Number(options.maxFrames) || 8);
    var baseUrl = new URL('.', win.location.href);
    var basePath = baseUrl.pathname;
    var homePath = new URL('index.html', baseUrl).pathname;
    var routeMap = new Map();
    var records = [];
    var activeRecord = null;
    var activeRoute = null;
    var destroyed = false;
    var useSequence = 0;

    function safeUrl(input, sourceWindow) {
      try {
        var sourceUrl = sourceWindow && sourceWindow.location
          ? new URL(sourceWindow.location.href)
          : baseUrl;
        var url = new URL(String(input), sourceUrl);
        if (url.origin !== baseUrl.origin) return null;
        if (url.pathname.indexOf(basePath) !== 0) return null;
        return url;
      } catch (error) {
        return null;
      }
    }

    function isHomeUrl(url) {
      return url.pathname === homePath && !url.searchParams.has(routeParam);
    }

    function routeForUrl(url) {
      var relativePath = url.pathname.slice(basePath.length);
      if (!relativePath) relativePath = 'index.html';
      return relativePath + url.search + url.hash;
    }

    function keyForUrl(url) {
      return url.pathname + url.search;
    }

    function urlForRoute(route) {
      return safeUrl(route, null);
    }

    function writeParentRoute(route, replace) {
      if (!win.history || !win.location) return;
      var next = new URL(win.location.href);
      if (route) next.searchParams.set(routeParam, route);
      else next.searchParams.delete(routeParam);
      var state = route
        ? { maomaoAppShell: true, route: route }
        : { maomaoAppShell: true, route: null };
      var method = replace ? 'replaceState' : 'pushState';
      if (typeof win.history[method] === 'function') {
        win.history[method](state, '', next.href);
      }
    }

    function dispatchFrameEvent(record, name, detail) {
      try {
        var frameWindow = record.frame.contentWindow;
        if (!frameWindow || typeof frameWindow.dispatchEvent !== 'function' || !win.CustomEvent) return;
        frameWindow.dispatchEvent(new win.CustomEvent(name, {
          detail: detail || {},
          bubbles: false
        }));
      } catch (error) {
        // The frame may still be navigating or may already have been removed.
      }
    }

    function showHost() {
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      root.setAttribute('data-state', 'active');
    }

    function hideHost() {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      root.setAttribute('data-state', 'home');
    }

    function touch(record) {
      record.lastUsed = ++useSequence;
    }

    function removeRecord(record) {
      if (!record || record === activeRecord) return;
      if (record.currentKey && routeMap.get(record.currentKey) === record) {
        routeMap.delete(record.currentKey);
      }
      dispatchFrameEvent(record, 'maomao:app:dispose', { route: record.route });
      if (record.frame && record.frame.parentNode) {
        record.frame.parentNode.removeChild(record.frame);
      }
      records = records.filter(function (item) { return item !== record; });
    }

    function evictOldFrames() {
      while (records.length > maxFrames) {
        var candidate = null;
        records.forEach(function (record) {
          if (record === activeRecord) return;
          if (!candidate || record.lastUsed < candidate.lastUsed) candidate = record;
        });
        if (!candidate) break;
        removeRecord(candidate);
      }
    }

    function navigateFromFrame(record, input) {
      return open(input, { sourceWindow: record.frame.contentWindow });
    }

    function bindFrameDocument(record) {
      var frameDocument;
      try {
        frameDocument = record.frame.contentDocument;
      } catch (error) {
        return;
      }
      if (!frameDocument || frameDocument.__maomaoHostBound) return;
      frameDocument.__maomaoHostBound = true;

      frameDocument.addEventListener('click', function (event) {
        if (!event || event.defaultPrevented || event.button === 2 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        var actionable = target.closest('[data-href], a[href]');
        if (!actionable) return;
        if (actionable.hasAttribute && actionable.hasAttribute('download')) return;
        if (actionable.getAttribute && actionable.getAttribute('target') === '_blank') return;

        var href = actionable.dataset && actionable.dataset.href;
        if (!href && actionable.getAttribute) href = actionable.getAttribute('href');
        if (!href || href === '#' || /^javascript:/i.test(href)) return;

        var url = safeUrl(href, record.frame.contentWindow);
        if (!url) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        navigateFromFrame(record, url.href);
      }, true);

      frameDocument.addEventListener('submit', function (event) {
        // Native form submission stays inside the legacy frame; only page/app links are routed.
      }, true);
    }

    function syncFrameLocation(record, addHistory) {
      var url;
      try {
        url = new URL(record.frame.contentWindow.location.href);
      } catch (error) {
        return;
      }
      if (url.origin !== baseUrl.origin || url.pathname.indexOf(basePath) !== 0) return;
      if (isHomeUrl(url)) {
        if (record === activeRecord) goHome({ history: addHistory !== false });
        return;
      }

      var nextKey = keyForUrl(url);
      if (record.currentKey && record.currentKey !== nextKey &&
          routeMap.get(record.currentKey) === record) {
        routeMap.delete(record.currentKey);
      }
      record.currentKey = nextKey;
      record.route = routeForUrl(url);
      routeMap.set(nextKey, record);
      bindFrameDocument(record);

      if (record === activeRecord) {
        if (addHistory !== false && record.lastReportedRoute !== record.route) {
          writeParentRoute(record.route, false);
        }
        activeRoute = record.route;
      }
      record.lastReportedRoute = record.route;
      touch(record);
      dispatchFrameEvent(record, 'maomao:app:ready', { route: record.route });
    }

    function createRecord(url) {
      var route = routeForUrl(url);
      var key = keyForUrl(url);
      var frame = doc.createElement('iframe');
      frame.className = 'maomao-legacy-app-frame';
      frame.title = 'MAOMAO 应用';
      frame.setAttribute('loading', 'eager');
      frame.setAttribute('allow', 'clipboard-read; clipboard-write; camera; microphone');
      frame.setAttribute('referrerpolicy', 'same-origin');
      frame.setAttribute('data-maomao-route', route);
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('frameborder', '0');

      var record = {
        frame: frame,
        currentKey: key,
        route: route,
        lastReportedRoute: route,
        loaded: false,
        lastUsed: 0
      };

      frame.addEventListener('load', function () {
        record.loaded = true;
        bindFrameDocument(record);
        syncFrameLocation(record, true);
      });
      frame.addEventListener('error', function () {
        if (record === activeRecord) {
          root.setAttribute('data-load-error', 'true');
          if (typeof options.onError === 'function') {
            options.onError(new Error('应用页面加载失败：' + route), { route: route });
          }
        }
      });

      routeMap.set(key, record);
      records.push(record);
      root.appendChild(frame);
      frame.src = url.href;
      touch(record);
      evictOldFrames();
      return record;
    }

    function activateRecord(record, route) {
      if (activeRecord && activeRecord !== record) {
        activeRecord.frame.hidden = true;
        activeRecord.frame.setAttribute('aria-hidden', 'true');
        dispatchFrameEvent(activeRecord, 'maomao:app:deactivate', {
          route: activeRecord.route,
          nextRoute: route
        });
      }

      showHost();
      records.forEach(function (item) {
        var isActive = item === record;
        item.frame.hidden = !isActive;
        item.frame.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });

      activeRecord = record;
      activeRoute = route;
      record.route = route;
      touch(record);
      dispatchFrameEvent(record, 'maomao:app:activate', { route: route });
    }

    function open(input, openOptions) {
      if (destroyed) return false;
      openOptions = openOptions || {};
      var url = input instanceof URL ? input : safeUrl(input, openOptions.sourceWindow);
      if (!url) return false;

      if (isHomeUrl(url)) {
        goHome({ history: openOptions.history !== false });
        return true;
      }

      var route = routeForUrl(url);
      var key = keyForUrl(url);
      var record = routeMap.get(key);

      if (!record) {
        record = createRecord(url);
      } else if (record === activeRecord && url.hash !== '') {
        try {
          if (record.frame.contentWindow.location.hash !== url.hash) {
            record.frame.contentWindow.location.hash = url.hash;
          }
        } catch (error) {}
      }

      var wasAlreadyActive = record === activeRecord && activeRoute === route;
      activateRecord(record, route);

      if (!wasAlreadyActive && openOptions.history !== false) {
        writeParentRoute(route, openOptions.replace === true);
      }
      evictOldFrames();
      return true;
    }

    function goHome(homeOptions) {
      if (destroyed) return false;
      homeOptions = homeOptions || {};
      if (activeRecord) {
        dispatchFrameEvent(activeRecord, 'maomao:app:deactivate', {
          route: activeRecord.route,
          nextRoute: null
        });
      }
      records.forEach(function (record) {
        record.frame.hidden = true;
        record.frame.setAttribute('aria-hidden', 'true');
      });
      activeRecord = null;
      activeRoute = null;
      hideHost();
      if (homeOptions.history !== false) writeParentRoute(null, homeOptions.replace === true);
      return true;
    }

    function routeFromParent() {
      try {
        var url = new URL(win.location.href);
        return url.searchParams.get(routeParam);
      } catch (error) {
        return null;
      }
    }

    function onParentClick(event) {
      if (!event || event.defaultPrevented || event.button === 2 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (doc.body && doc.body.classList &&
          doc.body.classList.contains('home-editing')) return;

      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var tile = target.closest('#homeScreen [data-href], .dock-wrapper [data-href]');
      if (!tile || !tile.dataset || !tile.dataset.href) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      open(tile.dataset.href);
    }

    function onPopState() {
      var route = routeFromParent();
      if (route) open(route, { history: false });
      else goHome({ history: false });
    }

    function onVisibilityChange() {
      if (!activeRecord) return;
      dispatchFrameEvent(
        activeRecord,
        doc.hidden ? 'maomao:app:suspend' : 'maomao:app:resume',
        { route: activeRoute }
      );
    }

    doc.addEventListener('click', onParentClick, true);
    win.addEventListener('popstate', onPopState);
    doc.addEventListener('visibilitychange', onVisibilityChange);

    var initialRoute = routeFromParent();
    if (initialRoute) {
      open(initialRoute, { history: false });
    } else {
      hideHost();
    }

    return {
      open: open,
      home: goHome,
      getActiveRoute: function () { return activeRoute; },
      getLoadedRoutes: function () {
        return records.map(function (record) { return record.route; });
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        doc.removeEventListener('click', onParentClick, true);
        win.removeEventListener('popstate', onPopState);
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        records.slice().forEach(function (record) {
          if (record === activeRecord) activeRecord = null;
          if (record.frame && record.frame.parentNode) {
            record.frame.parentNode.removeChild(record.frame);
          }
        });
        records = [];
        routeMap.clear();
        activeRoute = null;
        hideHost();
      }
    };
  }

  var api = global.MAOMAOAppShell || (global.MAOMAOAppShell = {});
  api.createLegacyHost = createLegacyHost;

  function boot() {
    if (global.__MAOMAO_LEGACY_HOST__) return;
    var root = document.getElementById('maomao-app-host');
    if (!root) return;
    global.__MAOMAO_LEGACY_HOST__ = createLegacyHost({ root: root });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window, document);
