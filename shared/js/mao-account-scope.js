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

  function verifyAccountSession() {
    if (typeof global.fetch !== 'function') return;
    global.fetch('/api/accounts/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'accept': 'application/json' }
    }).then(function (response) {
      if (response.ok) return null;
      return response.json().catch(function () { return {}; }).then(function (payload) {
        var disabled = payload && payload.error && payload.error.code === 'ACCOUNT_DISABLED';
        var destination = '/account/index.html' + (disabled ? '?disabled=1' : '');
        if (global.location && typeof global.location.replace === 'function') {
          global.location.replace(destination);
        }
        return false;
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
    // Existing MAO content belongs to the creator. Keep the original keys/DB names
    // for this one account so the first authorized release does not hide old data.
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
        if (property === 'match') return function (request, options) {
          return target.keys().then(function (items) {
            var scopedNames = items.filter(function (name) { return name.indexOf(prefix) === 0; });
            return scopedNames.reduce(function (chain, name) {
              return chain.then(function (found) {
                if (found) return found;
                return target.open(name).then(function (cache) {
                  return cache.match(request, options);
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
    global.__MAO_ACCOUNT_SCOPE__ = Object.freeze({ accountId: accountId, ready: true });
  } catch (error) {}
})(window);
