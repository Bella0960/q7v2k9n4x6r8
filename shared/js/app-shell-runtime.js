(function (global, document) {
  'use strict';

  var moduleRegistry = new Map();
  var scriptLoads = new Map();
  var controller = null;

  function isFunction(value) {
    return typeof value === 'function';
  }

  function assertAppId(id) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
      throw new TypeError('Invalid MAOMAO app id: ' + String(id));
    }
  }

  function registerModule(id, implementation) {
    assertAppId(id);
    if (!implementation || !isFunction(implementation.mount)) {
      throw new TypeError('App module must provide mount(root, context): ' + id);
    }
    if (moduleRegistry.has(id)) {
      throw new Error('App module already registered: ' + id);
    }
    moduleRegistry.set(id, implementation);
  }

  function create(options) {
    options = options || {};
    if (!options.root || !isFunction(options.root.appendChild)) {
      throw new TypeError('MAOMAOAppShell.create requires a root element');
    }
    if (controller && !controller.destroyed) {
      throw new Error('Only one MAOMAO app shell may be active at a time');
    }

    var root = options.root;
    var routeParam = options.routeParam || 'maomao_app';
    var defaultApp = options.defaultApp;
    var onError = isFunction(options.onError) ? options.onError : function () {};
    var definitions = new Map();
    var instances = new Map();
    var activeId = null;
    var navigationId = 0;
    var destroyed = false;
    var popstateHandler = null;

    if (typeof routeParam !== 'string' || !routeParam) {
      throw new TypeError('routeParam must be a non-empty string');
    }

    Object.keys(options.apps || {}).forEach(function (id) {
      assertAppId(id);
      definitions.set(id, options.apps[id] || {});
    });

    function contextFor(id, params) {
      return {
        appId: id,
        params: params || {},
        root: root,
        navigate: function (nextId, nextParams, navOptions) {
          return open(nextId, nextParams, navOptions);
        },
        getActiveApp: function () {
          return activeId;
        },
        isActive: function () {
          return activeId === id;
        }
      };
    }

    function loadScript(id, src) {
      if (scriptLoads.has(id)) return scriptLoads.get(id);
      var promise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.async = true;
        script.src = src;
        script.setAttribute('data-maomao-app-module', id);
        script.onload = function () {
          if (moduleRegistry.has(id)) {
            resolve(moduleRegistry.get(id));
          } else {
            reject(new Error('Module script loaded without registration: ' + id));
          }
        };
        script.onerror = function () {
          scriptLoads.delete(id);
          reject(new Error('Failed to load app module: ' + id));
        };
        (document.head || document.body).appendChild(script);
      });
      scriptLoads.set(id, promise);
      return promise;
    }

    function ensureModule(id) {
      if (moduleRegistry.has(id)) return Promise.resolve(moduleRegistry.get(id));
      var definition = definitions.get(id);
      if (!definition) return Promise.reject(new Error('Unknown MAOMAO app: ' + id));
      if (definition.module) {
        registerModule(id, definition.module);
        return Promise.resolve(definition.module);
      }
      if (!definition.src || typeof definition.src !== 'string') {
        return Promise.reject(new Error('App has no module or src: ' + id));
      }
      return loadScript(id, definition.src);
    }

    function createInstance(id, implementation) {
      var view = document.createElement('section');
      view.className = 'maomao-app-view';
      view.hidden = true;
      view.setAttribute('data-maomao-app-view', id);
      view.setAttribute('aria-hidden', 'true');
      root.appendChild(view);
      var instance = {
        id: id,
        view: view,
        implementation: implementation,
        mounted: false,
        mountPromise: null,
        dispose: null
      };
      instances.set(id, instance);
      return instance;
    }

    function ensureMounted(id, implementation, params) {
      var instance = instances.get(id) || createInstance(id, implementation);
      if (instance.mounted) return Promise.resolve(instance);
      if (instance.mountPromise) return instance.mountPromise;

      instance.mountPromise = Promise.resolve()
        .then(function () {
          return implementation.mount(instance.view, contextFor(id, params));
        })
        .then(function (cleanup) {
          if (isFunction(cleanup)) instance.dispose = cleanup;
          instance.mounted = true;
          instance.mountPromise = null;
          return instance;
        })
        .catch(function (error) {
          instance.mountPromise = null;
          if (!instance.mounted) {
            if (instance.view.parentNode) instance.view.parentNode.removeChild(instance.view);
            instances.delete(id);
          }
          throw error;
        });
      return instance.mountPromise;
    }

    function writeHistory(id, params, replace) {
      if (!global.history || !global.location) return;
      var url = new URL(global.location.href);
      url.searchParams.set(routeParam, id);
      if (params && params.sessionId) url.searchParams.set('session', String(params.sessionId));
      else url.searchParams.delete('session');
      var state = { maomaoAppShell: true, appId: id, params: params || {} };
      var method = replace ? 'replaceState' : 'pushState';
      if (isFunction(global.history[method])) {
        global.history[method](state, '', url.href);
      }
    }

    async function open(id, params, navOptions) {
      if (destroyed) throw new Error('MAOMAO app shell has been destroyed');
      assertAppId(id);
      navOptions = navOptions || {};
      params = params || {};
      var requestId = ++navigationId;
      var previousId = activeId;
      var previous = previousId ? instances.get(previousId) : null;

      try {
        var implementation = await ensureModule(id);
        var target = await ensureMounted(id, implementation, params);
        if (destroyed || requestId !== navigationId) return false;

        if (previous && previousId !== id && isFunction(previous.implementation.deactivate)) {
          await previous.implementation.deactivate(contextFor(previousId, {}));
        }
        if (destroyed || requestId !== navigationId) {
          if (previous && previousId !== id && isFunction(previous.implementation.activate)) {
            await previous.implementation.activate(contextFor(previousId, {}));
          }
          return false;
        }

        if (previous && previousId !== id) {
          previous.view.hidden = true;
          previous.view.setAttribute('aria-hidden', 'true');
        }

        target.view.hidden = false;
        target.view.setAttribute('aria-hidden', 'false');
        activeId = id;

        try {
          if (isFunction(target.implementation.activate)) {
            await target.implementation.activate(contextFor(id, params));
          }
        } catch (activationError) {
          target.view.hidden = true;
          target.view.setAttribute('aria-hidden', 'true');
          activeId = previousId;
          if (previous) {
            previous.view.hidden = false;
            previous.view.setAttribute('aria-hidden', 'false');
            if (isFunction(previous.implementation.activate)) {
              await previous.implementation.activate(contextFor(previousId, {}));
            }
          }
          throw activationError;
        }

        if (destroyed || requestId !== navigationId) return false;
        if (navOptions.history !== false) writeHistory(id, params, navOptions.replace === true);
        if (isFunction(options.onChange)) options.onChange({ appId: id, previousAppId: previousId, params: params });
        return true;
      } catch (error) {
        if (!destroyed && requestId === navigationId) onError(error, { appId: id, previousAppId: previousId });
        throw error;
      }
    }

    function routeFromLocation() {
      try {
        var url = new URL(global.location.href);
        return url.searchParams.get(routeParam) || defaultApp || null;
      } catch (error) {
        return defaultApp || null;
      }
    }

    popstateHandler = function () {
      var id = routeFromLocation();
      if (id) open(id, {}, { history: false }).catch(function () {});
    };
    if (isFunction(global.addEventListener)) global.addEventListener('popstate', popstateHandler);

    controller = {
      open: open,
      getActiveApp: function () { return activeId; },
      getLoadedApps: function () { return Array.from(instances.keys()); },
      destroy: async function () {
        if (destroyed) return;
        destroyed = true;
        navigationId += 1;
        if (isFunction(global.removeEventListener) && popstateHandler) {
          global.removeEventListener('popstate', popstateHandler);
        }
        for (var entry of instances.values()) {
          try {
            if (entry.mounted && isFunction(entry.implementation.deactivate)) {
              await entry.implementation.deactivate(contextFor(entry.id, {}));
            }
            if (entry.mounted && isFunction(entry.implementation.dispose)) {
              await entry.implementation.dispose(contextFor(entry.id, {}));
            }
            if (entry.dispose) await entry.dispose();
          } catch (error) {
            onError(error, { appId: entry.id, phase: 'dispose' });
          }
          if (entry.view.parentNode) entry.view.parentNode.removeChild(entry.view);
        }
        instances.clear();
        activeId = null;
        controller = null;
      }
    };

    return controller;
  }

  global.MAOMAOAppShell = {
    registerModule: registerModule,
    create: create
  };
})(window, document);
