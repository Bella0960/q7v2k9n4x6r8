/* MAO account data namespace.
 * Injected by the authenticated Worker before any app script executes.
 * The sole super-admin keeps the pre-account creator data; every normal account
 * receives its own localStorage, sessionStorage, IndexedDB and CacheStorage namespace.
 */
(function (global) {
  'use strict';

  var idMeta = document.querySelector('meta[name="mao-account-id"]');
  var roleMeta = document.querySelector('meta[name="mao-account-role"]');
  var accountId = idMeta && String(idMeta.content || '').trim();
  var role = roleMeta && String(roleMeta.content || '').trim();

  if (!accountId || !/^MAO-[A-Z0-9]{12,24}$/.test(accountId)) return;

  // 仅在账号 API 和所有存储命名空间安装成功后声明 ready，避免半初始化误放行。

  // Bind every same-origin API request to the MAO account whose data namespace
  // this page opened with. This closes the interval before the 30-second tab
  // recheck when another tab signs into a different account on the same device.
  function installAccountBoundFetch() {
    if (typeof global.fetch !== 'function' ||
        typeof global.Headers !== 'function' ||
        typeof global.URL !== 'function' ||
        !global.location) return false;
    try {
      var nativeFetch = global.fetch.bind(global);
      var wrappedFetch = function (input, init) {
        var requestUrl;
        try {
          var rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
          requestUrl = new global.URL(rawUrl, global.location.href);
        } catch (error) {
          return nativeFetch(input, init);
        }
        if (requestUrl.origin !== global.location.origin) {
          return nativeFetch(input, init);
        }

        var headers = new global.Headers(input && input.headers ? input.headers : undefined);
        if (init && init.headers) {
          new global.Headers(init.headers).forEach(function (value, key) {
            headers.set(key, value);
          });
        }
        headers.set('x-mao-account-context', accountId);
        var nextInit = Object.assign({}, init || {});
        nextInit.headers = headers;
        return nativeFetch(input, nextInit);
      };
      Object.defineProperty(global, 'fetch', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: wrappedFetch
      });
      return true;
    } catch (error) {
      console.error('[MAO account scope] unable to bind API requests to the account');
      return false;
    }
  }

  // Older screens still use XMLHttpRequest in a few legacy modules. Bind those
  // same-origin API calls too; the server rejects authenticated private requests
  // that arrive without an explicit page-account context.
  function installAccountBoundXHR() {
    var XHR = global.XMLHttpRequest;
    if (!XHR || !XHR.prototype) return true;
    var prototype = XHR.prototype;
    var nativeOpen = prototype.open;
    var nativeSend = prototype.send;
    var nativeSetRequestHeader = prototype.setRequestHeader;
    if (typeof nativeOpen !== 'function' ||
        typeof nativeSend !== 'function' ||
        typeof nativeSetRequestHeader !== 'function') return false;

    var marker = '__maoAccountBoundApiV1';
    try {
      prototype.open = function (method, url) {
        var bindContext = false;
        try {
          var requestUrl = new global.URL(String(url), global.location.href);
          bindContext = requestUrl.origin === global.location.origin &&
            /^\/api(?:\/|$)/.test(requestUrl.pathname);
        } catch (error) {}
        this[marker] = bindContext;
        return nativeOpen.apply(this, arguments);
      };
      prototype.send = function () {
        if (this[marker]) {
          try {
            nativeSetRequestHeader.call(this, 'x-mao-account-context', accountId);
          } catch (error) {
            try { this.abort(); } catch (abortError) {}
            throw error;
          }
        }
        return nativeSend.apply(this, arguments);
      };
      return true;
    } catch (error) {
      console.error('[MAO account scope] unable to bind XMLHttpRequest to the account');
      return false;
    }
  }

  if (!installAccountBoundFetch() || !installAccountBoundXHR()) {
    // Do not open app storage if same-origin requests cannot be account-bound.
    try {
      global.stop();
      document.open();
      document.write('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAO</title><body style="margin:0;padding:12vh 8vw;font:16px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#222;background:#f7f7f8"><h2>账号会话隔离暂不可用</h2><p>为保护不同账号的数据，MAO 已阻止打开此页面。请更新浏览器后重试。</p></body></html>');
      document.close();
    } catch (error) {}
    return;
  }

  var redirectingToAccountEntry = false;

  function redirectToAccountEntry(query) {
    if (redirectingToAccountEntry) return;
    redirectingToAccountEntry = true;
    var destination = '/account/index.html' + (query ? '?' + query : '');
    if (global.location && typeof global.location.replace === 'function') {
      global.location.replace(destination);
    }
  }

  function verifyAccountSession() {
    if (typeof global.fetch !== 'function' || redirectingToAccountEntry) return;
    global.fetch('/api/accounts/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'accept': 'application/json' }
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        var current = payload && payload.account;
        if (response.ok &&
            current &&
            current.id === accountId &&
            current.role === role &&
            current.status === 'active') {
          return null;
        }
        var errorCode = payload && payload.error && payload.error.code;
        if (response.ok && current && (current.id !== accountId || current.role !== role)) {
          redirectToAccountEntry('switched=1');
        } else if (errorCode === 'ACCOUNT_DISABLED' ||
                   (response.ok && current && (current.status === 'disabled' || current.status === 'revoked'))) {
          redirectToAccountEntry('disabled=1');
        } else if (response.status === 401) {
          redirectToAccountEntry('');
        } else if (errorCode === 'IDENTITY_AUTHORITY_CHANGED' || errorCode === 'ACCOUNT_CONTEXT_CHANGED') {
          redirectToAccountEntry('switched=1');
        } else if (response.ok && current && current.status !== 'active') {
          redirectToAccountEntry('');
        }
        // 403 without confirmed identity change, 5xx, and invalid responses
        // do not establish that this account logged out. Keep local data intact
        // while server-enforced API and page protections remain fail-closed.
        return null;
      });
    }).catch(function () {
      // A transient network error does not erase local data. Cloud APIs remain
      // individually session-checked and the next focus/heartbeat retries.
    });
  }

  verifyAccountSession();
  if (typeof global.setInterval === 'function') {
    global.setInterval(verifyAccountSession, 30000);
  }
  if (global.addEventListener) global.addEventListener('focus', verifyAccountSession);
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) verifyAccountSession();
    });
  }

  if (role === 'super_admin') {
    // 唯一创始管理员继续使用原始本地存储；API 身份绑定已成功时才宣告就绪。
    try {
      global.__MAO_ACCOUNT_SCOPE__ = Object.freeze({ accountId: accountId, role: role, ready: true });
    } catch (error) {
      stopUnsafeAccountPage();
    }
    return;
  }

  var prefix = '__mao_account_v1__' + encodeURIComponent(accountId) + '__';

  function scopedStorage(nativeStorage) {
    function keys() {
      var result = [];
      for (var i = 0; i < nativeStorage.length; i += 1) {
        var key = nativeStorage.key(i);
        if (key && key.indexOf(prefix) === 0) result.push(key);
      }
      return result;
    }
    function physical(key) {
      return prefix + String(key);
    }

    return new Proxy(nativeStorage, {
      get: function (target, property) {
        if (property === 'length') return keys().length;
        if (property === 'getItem') return function (key) {
          var value = nativeStorage.getItem(physical(key));
          return value == null ? null : value;
        };
        if (property === 'setItem') return function (key, value) {
          nativeStorage.setItem(physical(key), String(value));
        };
        if (property === 'removeItem') return function (key) {
          nativeStorage.removeItem(physical(key));
        };
        if (property === 'clear') return function () {
          keys().forEach(function (key) { nativeStorage.removeItem(key); });
        };
        if (property === 'key') return function (index) {
          var list = keys();
          var key = list[Number(index)];
          return key == null ? null : key.slice(prefix.length);
        };
        if (property === Symbol.toStringTag) return 'Storage';
        if (property === Symbol.iterator) return function () {
          return keys().map(function (key) { return key.slice(prefix.length); })[Symbol.iterator]();
        };
        if (typeof property === 'string') {
          var value = nativeStorage.getItem(physical(property));
          return value == null ? undefined : value;
        }
        return Reflect.get(target, property, target);
      },
      set: function (target, property, value) {
        if (typeof property !== 'string') return false;
        nativeStorage.setItem(physical(property), String(value));
        return true;
      },
      deleteProperty: function (target, property) {
        if (typeof property === 'string') nativeStorage.removeItem(physical(property));
        return true;
      },
      has: function (target, property) {
        return typeof property === 'string' && nativeStorage.getItem(physical(property)) !== null;
      },
      ownKeys: function () {
        return keys().map(function (key) { return key.slice(prefix.length); });
      },
      getOwnPropertyDescriptor: function (target, property) {
        if (typeof property !== 'string') return undefined;
        var value = nativeStorage.getItem(physical(property));
        if (value === null) return undefined;
        return { configurable: true, enumerable: true, writable: true, value: value };
      },
      defineProperty: function (target, property, descriptor) {
        if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return false;
        }
        nativeStorage.setItem(physical(property), String(descriptor.value));
        return true;
      }
    });
  }

  function replaceWindowProperty(name, value) {
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: true,
        get: function () { return value; }
      });
      return true;
    } catch (error) {
      console.error('[MAO account scope] unable to protect ' + name);
      return false;
    }
  }

  function stopUnsafeAccountPage() {
    try {
      global.stop();
      document.open();
      document.write('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAO</title><body style="margin:0;padding:12vh 8vw;font:16px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#222;background:#f7f7f8"><h2>账号数据隔离暂不可用</h2><p>为保护不同账号的私人数据，MAO 已阻止打开此页面。请更新浏览器后重试，或联系创作者。</p></body></html>');
      document.close();
    } catch (error) {}
  }

  var rawLocalStorage;
  var rawSessionStorage;
  try {
    rawLocalStorage = global.localStorage;
    rawSessionStorage = global.sessionStorage;
    if (!replaceWindowProperty('localStorage', scopedStorage(rawLocalStorage))) {
      stopUnsafeAccountPage();
      return;
    }
    if (!replaceWindowProperty('sessionStorage', scopedStorage(rawSessionStorage))) {
      stopUnsafeAccountPage();
      return;
    }
  } catch (error) {
    console.error('[MAO account scope] storage namespace unavailable');
    stopUnsafeAccountPage();
    return;
  }

  // Native storage events are shared across same-origin tabs. Hide events
  // from other MAO namespaces so a page cannot read another account's changed
  // key/value through the StorageEvent payload.
  if (global.addEventListener) {
    global.addEventListener('storage', function (event) {
      if (event.storageArea !== rawLocalStorage && event.storageArea !== rawSessionStorage) return;
      if (!event.key || event.key.indexOf(prefix) !== 0) {
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    }, true);
  }

  // Every local IndexedDB database is account-prefixed. The one super-admin
  // deliberately retains the original database names to preserve creator data.
  var nativeIndexedDB = global.indexedDB;
  if (nativeIndexedDB) {
    var idbProxy = new Proxy(nativeIndexedDB, {
      get: function (target, property) {
        if (property === 'open') return function (name, version) {
          var nextName = prefix + String(name);
          return version === undefined ? target.open(nextName) : target.open(nextName, version);
        };
        if (property === 'deleteDatabase') return function (name) {
          return target.deleteDatabase(prefix + String(name));
        };
        if (property === 'databases' && typeof target.databases === 'function') {
          return function () {
            return target.databases().then(function (items) {
              return items.filter(function (item) {
                return String(item.name || '').indexOf(prefix) === 0;
              }).map(function (item) {
                return { name: String(item.name).slice(prefix.length), version: item.version };
              });
            });
          };
        }
        var value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    if (!replaceWindowProperty('indexedDB', idbProxy)) {
      stopUnsafeAccountPage();
      return;
    }
  } else {
    stopUnsafeAccountPage();
    return;
  }

  // Imported fonts and user-generated style assets also use CacheStorage from pages.
  // Prefix page-created named caches while leaving the service worker's own shell cache
  // untouched (the service worker has a separate global scope).
  var nativeCaches = global.caches;
  if (nativeCaches) {
    var cacheProxy = new Proxy(nativeCaches, {
      get: function (target, property) {
        if (property === 'open') return function (name) {
          return target.open(prefix + String(name));
        };
        if (property === 'delete') return function (name) {
          return target.delete(prefix + String(name));
        };
        if (property === 'has') return function (name) {
          return target.has(prefix + String(name));
        };
        if (property === 'keys') return function () {
          return target.keys().then(function (items) {
            return items.filter(function (name) { return name.indexOf(prefix) === 0; })
              .map(function (name) { return name.slice(prefix.length); });
          });
        };
        // CacheStorage.match() searches the origin-wide cache list by
        // default. Walk only this account's physical caches so a shared shell
        // cache or another account's Cache cannot leak a private Response.
        if (property === 'match') return function (request, options) {
          var queryOptions = options ? Object.assign({}, options) : {};
          return target.keys().then(function (items) {
            var scopedNames = items.filter(function (name) { return name.indexOf(prefix) === 0; });
            return scopedNames.reduce(function (chain, name) {
              return chain.then(function (found) {
                if (found) return found;
                return target.open(name).then(function (cache) {
                  return cache.match(request, queryOptions);
                });
              });
            }, Promise.resolve(null));
          });
        };
        var value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    if (!replaceWindowProperty('caches', cacheProxy)) {
      stopUnsafeAccountPage();
      return;
    }
  } else {
    stopUnsafeAccountPage();
    return;
  }

  try {
    global.__MAO_ACCOUNT_SCOPE__ = Object.freeze({ accountId: accountId, role: role, ready: true });
  } catch (error) {
    stopUnsafeAccountPage();
    return;
  }

})(window);
