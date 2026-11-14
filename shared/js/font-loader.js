/* 全局字体加载器：所有页面在 <head> 中最先引入本文件。
 * 1. 字号与颜色沿用全站 CSS 变量。
 * 2. 自定义字体优先走 Service Worker + Cache Storage 的同源字体地址：
 *    导入后只预热一次，应用页面不再逐页从 IndexedDB 取出完整 Blob。
 * 3. 首次迁移/缓存不可用时仍回退到 IndexedDB + Blob URL，不丢失旧字体方案。
 */
(function () {
    'use strict';

    var DEFAULT_COLOR = '#111111';
    var FONT_CACHE_NAME = 'maomao-font-assets-v1';
    var FONT_CACHE_FORMAT_PREFIX = 'maomao_font_cache_format_';
    var loaderScript = document.currentScript;
    var fontAssetBaseUrl = '';
    var maoScope = window.__MAO_ACCOUNT_SCOPE__ || null;
    var fontAssetPath = '../../__maomao_fonts/';
    if (maoScope && maoScope.ready && maoScope.role !== 'super_admin' &&
        /^MAO-[A-Z0-9]{12,24}$/.test(String(maoScope.accountId || ''))) {
        // Ordinary accounts get a stable account-qualified URL. The Service
        // Worker compares this path to the current HttpOnly session before
        // returning a cached font, including requests made by CSS (which do
        // not carry custom fetch headers).
        fontAssetPath += encodeURIComponent(maoScope.accountId) + '/';
    }
    try {
        fontAssetBaseUrl = new URL(fontAssetPath, loaderScript && loaderScript.src ? loaderScript.src : document.baseURI).href;
    } catch (e) {}

    /* 1. 注入根变量默认值与根字号公式：14px 基准时 1rem = 16px */
    var rootStyle = document.createElement('style');
    rootStyle.textContent = ':root { --base-font-size: 14px; --global-font-scale: 1; --global-font-color: ' + DEFAULT_COLOR + '; }'
        + 'html { font-size: calc(var(--base-font-size, 14px) / 14 * 16); }';
    document.head.appendChild(rootStyle);

    /* 2. 字号：读取 + 迁移 + 应用 */
    function clamp(n) { return Math.min(20, Math.max(12, n)); }
    function validColor(c) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c); }
    var size = null;
    var color = '';
    try {
        var raw = localStorage.getItem('font_size_global');
        if (raw === null) {
            var old = parseInt(localStorage.getItem('font_size'), 10);
            if (!isNaN(old)) {
                size = clamp(old);
                try { localStorage.setItem('font_size_global', String(size)); } catch (e) {}
            }
        } else {
            var n = parseInt(raw, 10);
            if (!isNaN(n)) size = clamp(n);
        }
        var c = (localStorage.getItem('custom_font_color') || '').trim();
        if (validColor(c)) color = c;
    } catch (e) {}

    var root = document.documentElement;
    if (size !== null) {
        root.style.setProperty('--base-font-size', size + 'px');
        root.style.setProperty('--global-font-scale', String(Math.round(size / 14 * 1000) / 1000));
    }
    if (color) {
        root.style.setProperty('--global-font-color', color);
        var applyBodyColor = function () {
            try {
                if (!root.classList.contains('dark') && document.body) document.body.style.color = color;
            } catch (e) {}
        };
        if (document.body) applyBodyColor();
        else document.addEventListener('DOMContentLoaded', applyBodyColor, { once: true });
    }

    /* 3. 自定义字体运行时 */
    var fontObjectUrl = '';
    var fontPreloadId = 'maomao-global-custom-font-preload';
    var fontStyleId = 'maomao-global-custom-font-style';
    var globalFontStack = '"MAOMAOUserFont", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif';
    var lastLoadedFontKey = null;
    var fontLoadGeneration = 0;
    var fontLoadScheduled = false;

    function getFontStyle() {
        var tag = document.getElementById(fontStyleId);
        if (!tag) {
            tag = document.createElement('style');
            tag.id = fontStyleId;
            document.head.appendChild(tag);
        }
        return tag;
    }

    function safeFontUrl(url) {
        return String(url || '').replace(/["'\\\r\n]/g, '');
    }

    function fontExtension(format) {
        return format === 'woff2' ? 'woff2' : (format === 'woff' ? 'woff' : 'ttf');
    }

    function fontMime(format) {
        return format === 'woff2' ? 'font/woff2' : (format === 'woff' ? 'font/woff' : 'font/ttf');
    }

    function getFontCacheUrl(id, format) {
        if (!fontAssetBaseUrl || !id) return '';
        try {
            return new URL(encodeURIComponent(String(id)) + '.' + fontExtension(format), fontAssetBaseUrl).href;
        } catch (e) {
            return '';
        }
    }

    function getCachedFontFormat(id) {
        try {
            var value = localStorage.getItem(FONT_CACHE_FORMAT_PREFIX + id) || '';
            return value === 'woff' || value === 'woff2' || value === 'truetype' ? value : '';
        } catch (e) {
            return '';
        }
    }

    function cacheFontBlob(id, blob, format) {
        if (!id || !blob || !window.caches || typeof window.Response !== 'function') return Promise.resolve('');
        var url = getFontCacheUrl(id, format);
        if (!url) return Promise.resolve('');
        var response;
        try {
            response = new Response(blob, {
                headers: {
                    'Content-Type': fontMime(format),
                    'Cache-Control': 'public, max-age=31536000, immutable'
                }
            });
        } catch (e) {
            return Promise.resolve('');
        }
        return caches.open(FONT_CACHE_NAME).then(function (cache) {
            return cache.put(url, response);
        }).then(function () {
            try { localStorage.setItem(FONT_CACHE_FORMAT_PREFIX + id, format || 'truetype'); } catch (e) {}
            return url;
        }).catch(function () {
            return '';
        });
    }

    function hasFontServiceWorker() {
        return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    }

    function releaseObjectUrlLater(url) {
        if (!url || !window.URL || !URL.revokeObjectURL) return;
        var released = false;
        function release() {
            if (released) return;
            released = true;
            try { URL.revokeObjectURL(url); } catch (e) {}
        }
        if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(release, release);
            window.setTimeout(release, 12000);
        } else {
            window.setTimeout(release, 1200);
        }
    }

    function preloadFont(url, format) {
        var previous = document.getElementById(fontPreloadId);
        if (previous) previous.remove();
        if (!url) return;
        var link = document.createElement('link');
        link.id = fontPreloadId;
        link.rel = 'preload';
        link.as = 'font';
        link.type = fontMime(format);
        link.crossOrigin = 'anonymous';
        link.href = url;
        document.head.appendChild(link);
    }

    function applyFontSource(url, format) {
        if (!url) return;
        var tag = getFontStyle();
        var safeUrl = safeFontUrl(url);
        var fontFormat = format || 'woff';
        preloadFont(safeUrl, fontFormat);
        tag.textContent = '@font-face{font-family:"MAOMAOUserFont";src:url("' + safeUrl + '") format("' + fontFormat + '");font-style:normal;font-display:swap;}'
            + 'body,body h1,body h2,body h3,body h4,body h5,body h6,body p,body span:not([class*="icon"]):not([class*="Icon"]),body a,body button,body input,body textarea,body select,body label,body small,body strong,body b,body em,body li,body td,body th'
            + '{font-family:' + globalFontStack + ' !important;}';
        /* Start fetching and decoding while the page is still parsing, not after the user taps an app. */
        try {
            if (document.fonts && typeof document.fonts.load === 'function') {
                var warmPromise = document.fonts.load('14px "MAOMAOUserFont"', '小手机 MAOMAO Aa 0123456789');
                if (warmPromise && typeof warmPromise.catch === 'function') warmPromise.catch(function () {});
            }
        } catch (e) {}
    }

    function readActiveFontSource() {
        var activeId = '';
        var legacyUrl = '';
        try {
            activeId = localStorage.getItem('active_font_preset_id') || '';
            legacyUrl = localStorage.getItem('custom_font_url') || '';
        } catch (e) {}
        return {
            activeId: activeId,
            legacyUrl: legacyUrl,
            key: activeId ? 'preset:' + activeId : (legacyUrl ? 'url:' + legacyUrl : 'none')
        };
    }

    function replaceObjectUrl(nextUrl) {
        var previous = fontObjectUrl;
        fontObjectUrl = nextUrl || '';
        if (previous && previous !== nextUrl) releaseObjectUrlLater(previous);
    }

    window.MAOMAOFontRuntime = {
        applyUrl: function (url, format) {
            applyFontSource(url, format);
            replaceObjectUrl('');
            lastLoadedFontKey = readActiveFontSource().key;
        },
        applyBlob: function (blob, format) {
            if (!blob || !window.URL || !URL.createObjectURL) return Promise.resolve(false);
            var objectUrl = '';
            try { objectUrl = URL.createObjectURL(blob); } catch (e) {}
            if (!objectUrl) return Promise.resolve(false);
            applyFontSource(objectUrl, format || 'truetype');
            replaceObjectUrl(objectUrl);
            var source = readActiveFontSource();
            lastLoadedFontKey = source.key;
            if (!source.activeId) return Promise.resolve(false);
            return cacheFontBlob(source.activeId, blob, format || 'truetype').then(function (url) {
                return !!url;
            });
        },
        removeCached: function (id) {
            var format = getCachedFontFormat(id);
            var url = format ? getFontCacheUrl(id, format) : '';
            var removeMeta = function () {
                try { localStorage.removeItem(FONT_CACHE_FORMAT_PREFIX + id); } catch (e) {}
            };
            if (!url || !window.caches) {
                removeMeta();
                return Promise.resolve(false);
            }
            return caches.open(FONT_CACHE_NAME).then(function (cache) {
                return cache.delete(url);
            }).then(function (removed) {
                removeMeta();
                return removed;
            }).catch(function () {
                removeMeta();
                return false;
            });
        },
        clear: function () {
            var tag = document.getElementById(fontStyleId);
            if (tag) tag.remove();
            var preload = document.getElementById(fontPreloadId);
            if (preload) preload.remove();
            replaceObjectUrl('');
            lastLoadedFontKey = 'none';
        }
    };

    function loadActiveFontPreset() {
        var source = readActiveFontSource();
        var sourceKey = source.key;
        if (sourceKey === lastLoadedFontKey) return;
        var generation = ++fontLoadGeneration;

        function isStillCurrent() {
            return generation === fontLoadGeneration && readActiveFontSource().key === sourceKey;
        }

        if (!source.activeId) {
            if (source.legacyUrl) {
                var match = source.legacyUrl.toLowerCase().match(/\.(ttf|woff2?)(?:[?#]|$)/);
                var format = match && match[1] === 'ttf' ? 'truetype' : (match && match[1] === 'woff2' ? 'woff2' : 'woff');
                if (!isStillCurrent()) return;
                window.MAOMAOFontRuntime.applyUrl(source.legacyUrl, format);
            } else {
                if (!isStillCurrent()) return;
                window.MAOMAOFontRuntime.clear();
            }
            lastLoadedFontKey = sourceKey;
            return;
        }

        /* 预热过的文件直接通过同源字体地址读取；无需每个页面重新打开 IndexedDB、复制大 Blob。 */
        var cachedFormat = getCachedFontFormat(source.activeId);
        if (cachedFormat && hasFontServiceWorker()) {
            var cachedUrl = getFontCacheUrl(source.activeId, cachedFormat);
            if (cachedUrl && isStillCurrent()) {
                window.MAOMAOFontRuntime.applyUrl(cachedUrl, cachedFormat);
                lastLoadedFontKey = sourceKey;
                return;
            }
        }

        if (!window.indexedDB) return;
        var request;
        try { request = indexedDB.open('maomao-font-presets', 1); }
        catch (e) { return; }

        request.onsuccess = function () {
            var db = request.result;
            if (!isStillCurrent()) { try { db.close(); } catch (e) {} return; }
            try {
                var tx = db.transaction('presets', 'readonly');
                var get = tx.objectStore('presets').get(source.activeId);
                get.onsuccess = function () {
                    if (!isStillCurrent()) return;
                    var record = get.result;
                    if (!record) {
                        window.MAOMAOFontRuntime.clear();
                        lastLoadedFontKey = sourceKey;
                        return;
                    }
                    if (record.type === 'file' && record.blob) {
                        /* 兼容旧预设：先立即应用，后台将 Blob 预热进 Cache Storage。 */
                        window.MAOMAOFontRuntime.applyBlob(record.blob, record.format || 'truetype');
                    } else if (record.type === 'url' && record.url) {
                        window.MAOMAOFontRuntime.applyUrl(record.url, record.format || 'woff');
                    } else {
                        window.MAOMAOFontRuntime.clear();
                    }
                    lastLoadedFontKey = sourceKey;
                };
                tx.oncomplete = function () { db.close(); };
                tx.onerror = function () { db.close(); };
                tx.onabort = function () { db.close(); };
            } catch (e) {
                try { db.close(); } catch (err) {}
            }
        };
        request.onerror = function () {};
    }

    function scheduleFontLoad() {
        if (fontLoadScheduled) return;
        fontLoadScheduled = true;
        var run = function () {
            fontLoadScheduled = false;
            loadActiveFontPreset();
        };
        /* 在 head 阶段尽早启动字体请求，避免固定等到首屏 1.8 秒后才换字体。 */
        if (document.readyState === 'loading') run();
        else if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
        else window.setTimeout(run, 0);
    }

    scheduleFontLoad();
    window.addEventListener('pageshow', function (event) {
        if (event && event.persisted) scheduleFontLoad();
    });
    window.addEventListener('storage', function (event) {
        if (!event.key || event.key === 'active_font_preset_id' || event.key === 'custom_font_url') {
            scheduleFontLoad();
        }
    });
})();
