/* MAOMAO · shared wallpaper persistence
   IndexedDB avoids localStorage quota failures for large wallpaper data URLs.
   Falls back to the legacy localStorage key for older browsers and existing saved wallpapers. */
(function (window, document) {
  'use strict';

  var DB_NAME = 'maomao-media-store';
  var DB_VERSION = 1;
  var STORE_NAME = 'wallpapers';
  var WALLPAPER_KEY = 'home_custom_wallpaper';
  var dbPromise = null;

  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Could not open wallpaper storage')); };
      request.onblocked = function () { reject(new Error('Wallpaper storage is blocked')); };
    }).catch(function (error) {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  function readDB(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var request = tx.objectStore(STORE_NAME).get(key || WALLPAPER_KEY);
        request.onsuccess = function () {
          var value = request.result;
          resolve(typeof value === 'string' ? value : (value && value.dataUrl) || '');
        };
        request.onerror = function () { reject(request.error || new Error('Could not read wallpaper')); };
        tx.onabort = function () { reject(tx.error || new Error('Wallpaper read was aborted')); };
      });
    });
  }

  function writeDB(key, dataUrl) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          dataUrl: dataUrl,
          updatedAt: Date.now()
        }, key || WALLPAPER_KEY);
        tx.oncomplete = function () {
          try { window.localStorage.removeItem(key || WALLPAPER_KEY); } catch (error) {}
          resolve(true);
        };
        tx.onerror = function () { reject(tx.error || new Error('Could not save wallpaper')); };
        tx.onabort = function () { reject(tx.error || new Error('Wallpaper save was aborted')); };
      });
    });
  }

  function readLegacy(key) {
    try { return window.localStorage.getItem(key || WALLPAPER_KEY) || ''; }
    catch (error) { return ''; }
  }

  /* 按独立 key 读取图片。旧的 localStorage 图片会在成功后迁移到 IndexedDB。 */
  function getByKey(key) {
    key = String(key || WALLPAPER_KEY);
    return readDB(key).then(function (value) {
      if (value) return value;
      var legacy = readLegacy(key);
      if (!legacy) return '';
      writeDB(key, legacy).catch(function () {});
      return legacy;
    }).catch(function () {
      return readLegacy(key);
    });
  }

  /* 图片优先进入 IndexedDB，避免和聊天记录/记忆挤占 localStorage 配额。 */
  function saveByKey(key, dataUrl) {
    key = String(key || WALLPAPER_KEY);
    if (typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) {
      return Promise.reject(new Error('Invalid wallpaper image'));
    }
    return writeDB(key, dataUrl).catch(function () {
      try {
        window.localStorage.setItem(key, dataUrl);
        return true;
      } catch (error) {
        throw new Error('本机存储空间不足，壁纸无法保存；请尝试较小的图片或检查浏览器存储权限');
      }
    });
  }

  function removeByKey(key) {
    key = String(key || WALLPAPER_KEY);
    var legacyRemoved = false;
    try {
      window.localStorage.removeItem(key);
      legacyRemoved = true;
    } catch (error) {}
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('Could not clear wallpaper')); };
        tx.onabort = function () { reject(tx.error || new Error('Could not clear wallpaper')); };
      });
    }).catch(function (error) {
      if (legacyRemoved) return true;
      throw error || new Error('无法清除已保存的壁纸');
    });
  }

  function getWallpaper() { return getByKey(WALLPAPER_KEY); }
  function saveWallpaper(dataUrl) { return saveByKey(WALLPAPER_KEY, dataUrl); }
  function clearWallpaper() { return removeByKey(WALLPAPER_KEY); }

  /* 壁纸明暗判定：任何上传的背景图都走同一套规则，深色壁纸自动切白字，浅色壁纸保持黑字。
     取小尺寸缩略图的 relative luminance 平均值；0.179 是黑白字体对比度相等的临界点。 */
  function srgbToLinear(channel) {
    var c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function detectTone(source) {
    if (typeof source !== 'string' || !source) return Promise.resolve('light');
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var size = 32;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Canvas is unavailable');
          ctx.drawImage(img, 0, 0, size, size);
          var pixels = ctx.getImageData(0, 0, size, size).data;
          var total = 0;
          var count = 0;
          for (var i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 24) continue;
            total += 0.2126 * srgbToLinear(pixels[i]) +
                     0.7152 * srgbToLinear(pixels[i + 1]) +
                     0.0722 * srgbToLinear(pixels[i + 2]);
            count++;
          }
          resolve(count && total / count > 0.179 ? 'light' : 'dark');
        } catch (error) {
          resolve('light');
        }
      };
      img.onerror = function () { resolve('light'); };
      img.src = source;
    });
  }

  /* 把判定结果写到 <html data-wallpaper-tone="light|dark">，样式表据此切换文字颜色。 */
  function applyTone(source) {
    var root = document.documentElement;
    if (!source) {
      root.removeAttribute('data-wallpaper-tone');
      return Promise.resolve('light');
    }
    return detectTone(source).then(function (tone) {
      root.setAttribute('data-wallpaper-tone', tone);
      return tone;
    });
  }

  window.MAOMAOContrast = {
    detect: detectTone,
    apply: applyTone
  };

  window.MAOMAOWallpaperStore = {
    get: getWallpaper,
    save: saveWallpaper,
    clear: clearWallpaper,
    detectTone: detectTone,
    applyTone: applyTone,
    key: WALLPAPER_KEY,
    getByKey: getByKey,
    saveByKey: saveByKey,
    removeByKey: removeByKey
  };
})(window, document);