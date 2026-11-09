/* 全局字体加载器：所有页面在 <head> 中最先引入本文件。
 * 1. 字号与颜色沿用全站 CSS 变量。
 * 2. 自定义字体优先走 Service Worker + Cache Storage 的同源字体地址：
 *    导入后只预热一次，应用页面不再逐页从 IndexedDB 取出完整 Blob。
 * 3. 首次迁移/缓存不可用时仍回退到 IndexedDB + Blob URL，不丢失旧字体方案。
 *
 * 性能约束（PERF-FONT-001）：
 * - 默认字体模式下本文件不读取 IndexedDB / Cache Storage，也不创建 ObjectURL；
 * - 字体在首帧之后的空闲时段应用，避免 10-30MB 字体文件与首屏资源竞争；
 * - 同一文档内同一字体只注册一次，不重复创建 ObjectURL、不重写样式表；
 * - Cache Storage 已有副本时不再回读 IndexedDB，也不重复写缓存；
 * - 字体损坏、丢失或加载失败时移除自定义字体规则，自动回退系统字体。
 */
(function () {
    'use strict';

    var DEFAULT_COLOR = '#111111';
    var FONT_CACHE_NAME = 'maomao-font-assets-v1';
    var FONT_CACHE_FORMAT_PREFIX = 'maomao_font_cache_format_';
    var loaderScript = document.currentScript;
    var fontAssetBaseUrl = '';
    try {
        fontAssetBaseUrl = new URL('../../__maomao_fonts/', loaderScript && loaderScript.src ? loaderScript.src : document.baseURI).href;
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
    var appliedFontKey = null;
    var failedFontKey = '';
    var fontLoadGeneration = 0;
    var fontLoadScheduled = false;
    /* 记录进行中的 IndexedDB 读取及其所属加载代次：
       同一代次内的重复触发才跳过；A→B→A 这类新代次必须允许重新读取。 */
    var fontDbRequestKey = '';
    var fontDbRequestGeneration = -1;
    /* 缓存重建失败只影响持久化：同一文档同一字体不再重复尝试写入。 */
    var failedCacheRebuildKeys = {};

    function getFontStyle() {
        var tag = document.getElementById(fontStyleId);
        if (!tag) {
            tag = document.createElement('style');
            tag.id = fontStyleId;
            document.head.appendChild(tag);
        }
        return tag;
    }

    function hasAppliedFontStyle() {
        var tag = document.getElementById(fontStyleId);
        return !!(tag && tag.textContent);
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

    function rememberCachedFormat(id, format) {
        try { localStorage.setItem(FONT_CACHE_FORMAT_PREFIX + id, format || 'truetype'); } catch (e) {}
    }

    /* 只有缓存中确实不存在同一字体时才写入，避免每页重复写入 10-30MB Blob。 */
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
            return cache.match(url).then(function (existing) {
                if (existing) {
                    rememberCachedFormat(id, format);
                    return url;
                }
                return cache.put(url, response).then(function () {
                    rememberCachedFormat(id, format);
                    return url;
                });
            });
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

    function removeAppliedFontStyle() {
        var tag = document.getElementById(fontStyleId);
        if (tag) tag.remove();
        var preload = document.getElementById(fontPreloadId);
        if (preload) preload.remove();
        appliedFontKey = 'none';
    }

    /* 加载失败/数据损坏：撤掉自定义字体规则，页面自动回到系统字体。 */
    function fallbackToSystemFont(key) {
        failedFontKey = key || '';
        replaceObjectUrl('');
        removeAppliedFontStyle();
    }

    function warmFont(key) {
        try {
            if (document.fonts && typeof document.fonts.load === 'function') {
                var warmPromise = document.fonts.load('14px "MAOMAOUserFont"', '小手机 MAOMAO Aa 0123456789');
                if (warmPromise && typeof warmPromise.then === 'function') {
                    warmPromise.then(function (faces) {
                        if (appliedFontKey !== key) return;
                        if (!faces || !faces.length) fallbackToSystemFont(key);
                    }, function () {
                        if (appliedFontKey !== key) return;
                        fallbackToSystemFont(key);
                    });
                }
            }
        } catch (e) {}
    }

    function applyFontSource(url, format, key) {
        if (!url) return false;
        if (key && key === appliedFontKey && hasAppliedFontStyle()) return false;
        var tag = getFontStyle();
        var safeUrl = safeFontUrl(url);
        var fontFormat = format || 'woff';
        preloadFont(safeUrl, fontFormat);
        tag.textContent = '@font-face{font-family:"MAOMAOUserFont";src:url("' + safeUrl + '") format("' + fontFormat + '");font-style:normal;font-display:swap;}'
            + 'body,body h1,body h2,body h3,body h4,body h5,body h6,body p,body span:not([class*="icon"]):not([class*="Icon"]),body a,body button,body input,body textarea,body select,body label,body small,body strong,body b,body em,body li,body td,body th'
            + '{font-family:' + globalFontStack + ' !important;}';
        appliedFontKey = key || null;
        failedFontKey = '';
        /* 空闲时段开始抓取并解码，避免与首屏资源竞争。 */
        warmFont(key || ('url:' + safeUrl));
        return true;
    }

    window.MAOMAOFontRuntime = {
        applyUrl: function (url, format) {
            var source = readActiveFontSource();
            if (source.key !== 'none' && source.key === appliedFontKey && hasAppliedFontStyle()) return true;
            fontLoadGeneration++;
            applyFontSource(url, format, source.key);
            replaceObjectUrl('');
            return true;
        },
        applyBlob: function (blob, format) {
            if (!blob || !window.URL || !URL.createObjectURL) return Promise.resolve(false);
            var source = readActiveFontSource();
            if (source.key !== 'none' && source.key === appliedFontKey && hasAppliedFontStyle()) {
                return Promise.resolve(!!getCachedFontFormat(source.activeId));
            }
            if (!blob.size) {
                fallbackToSystemFont(source.key);
                return Promise.resolve(false);
            }
            var objectUrl = '';
            try { objectUrl = URL.createObjectURL(blob); } catch (e) {}
            if (!objectUrl) return Promise.resolve(false);
            fontLoadGeneration++;
            applyFontSource(objectUrl, format || 'truetype', source.key);
            replaceObjectUrl(objectUrl);
            if (!source.activeId) return Promise.resolve(true);
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
            replaceObjectUrl('');
            removeAppliedFontStyle();
            failedFontKey = '';
        }
    };

    /* 缓存被清理后从 IndexedDB 原件恢复：应用字体并重建专用缓存。
       字体可用即保留显示；缓存重建属于持久化优化，失败只记录、不回退当前页面。 */
    function applyRecoveredBlob(record, source) {
        if (!record.blob.size) { fallbackToSystemFont(source.key); return; }
        if (source.key === appliedFontKey && hasAppliedFontStyle()) return;
        var objectUrl = '';
        try { objectUrl = URL.createObjectURL(record.blob); } catch (e) {}
        if (!objectUrl) { fallbackToSystemFont(source.key); return; }
        applyFontSource(objectUrl, record.format || 'truetype', source.key);
        replaceObjectUrl(objectUrl);
        if (failedCacheRebuildKeys[source.activeId]) return;
        cacheFontBlob(source.activeId, record.blob, record.format || 'truetype').then(function (url) {
            if (url) return;
            /* 写入失败/配额不足：仅标记本文件不再重试，已加载字体继续使用。 */
            failedCacheRebuildKeys[source.activeId] = true;
        });
    }

    function loadPresetFromIndexedDb(source, isStillCurrent, recoverFromCache) {
        if (!source.activeId) return;
        var requestGeneration = fontLoadGeneration;
        /* 同一代次内同一字体只允许一次未完成的 IndexedDB 读取；
           新代次（例如 A→B→A 快速切换后重新激活 A）必须允许重新读取，否则会残留旧字体或空白。 */
        if (fontDbRequestKey === source.activeId && fontDbRequestGeneration === requestGeneration) return;
        fontDbRequestKey = source.activeId;
        fontDbRequestGeneration = requestGeneration;
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            if (fontDbRequestKey === source.activeId && fontDbRequestGeneration === requestGeneration) {
                fontDbRequestKey = '';
                fontDbRequestGeneration = -1;
            }
        }
        function failToSystemFont() {
            finish();
            if (isStillCurrent()) fallbackToSystemFont(source.key);
        }
        if (!window.indexedDB) { failToSystemFont(); return; }
        var request;
        try { request = indexedDB.open('maomao-font-presets', 1); }
        catch (e) { failToSystemFont(); return; }

        request.onsuccess = function () {
            var db = request.result;
            if (failedFontKey === source.key || !isStillCurrent()) {
                finish();
                try { db.close(); } catch (e) {}
                return;
            }
            try {
                var tx = db.transaction('presets', 'readonly');
                var get = tx.objectStore('presets').get(source.activeId);
                get.onsuccess = function () {
                    if (!isStillCurrent()) { finish(); return; }
                    var record = get.result;
                    finish();
                    if (!record) {
                        /* 记录已删除：记录失败 key，同一文档不再重复打开数据库。 */
                        fallbackToSystemFont(source.key);
                        return;
                    }
                    if (record.type === 'file' && record.blob) {
                        if (recoverFromCache) applyRecoveredBlob(record, source);
                        else window.MAOMAOFontRuntime.applyBlob(record.blob, record.format || 'truetype');
                    } else if (record.type === 'url' && record.url) {
                        window.MAOMAOFontRuntime.applyUrl(record.url, record.format || 'woff');
                    } else {
                        fallbackToSystemFont(source.key);
                    }
                };
                get.onerror = failToSystemFont;
                tx.oncomplete = function () { try { db.close(); } catch (e) {} };
                tx.onerror = function () { try { db.close(); } catch (e) {} };
                tx.onabort = function () { try { db.close(); } catch (e) {} };
            } catch (e) {
                finish();
                try { db.close(); } catch (err) {}
                if (isStillCurrent()) fallbackToSystemFont(source.key);
            }
        };
        request.onerror = failToSystemFont;
        request.onblocked = failToSystemFont;
    }

    function loadActiveFontPreset() {
        var source = readActiveFontSource();
        var sourceKey = source.key;
        if (sourceKey === appliedFontKey || sourceKey === failedFontKey) return;
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
            return;
        }

        var cachedFormat = getCachedFontFormat(source.activeId);
        var cachedUrl = cachedFormat ? getFontCacheUrl(source.activeId, cachedFormat) : '';
        if (cachedUrl && hasFontServiceWorker()) {
            /* 已预热过：先用 Cache Storage 确认专用缓存项仍存在，再走同源字体地址。
               缓存被浏览器清理/驱逐时，SW 会对缺失字体返回 404；此时从 IndexedDB 恢复并重建缓存。 */
            if (!isStillCurrent()) return;
            if (!window.caches) {
                window.MAOMAOFontRuntime.applyUrl(cachedUrl, cachedFormat);
                return;
            }
            caches.match(cachedUrl).then(function (response) {
                if (!isStillCurrent()) return;
                if (response) {
                    window.MAOMAOFontRuntime.applyUrl(cachedUrl, cachedFormat);
                    return;
                }
                loadPresetFromIndexedDb(source, isStillCurrent, true);
            }, function () {
                /* Cache Storage 读取被拒绝：不能据此判定字体缺失，仍从 IndexedDB 恢复原件。 */
                loadPresetFromIndexedDb(source, isStillCurrent, true);
            });
            return;
        }
        if (cachedUrl && window.caches) {
            /* 没有 SW 控制器时（首次启动、直开子页面、Safari）：直接命中 Cache Storage，
               避免每页重复读取 IndexedDB，也避免每页重写同等大小的缓存。 */
            caches.match(cachedUrl).then(function (response) {
                if (!response) {
                    if (isStillCurrent()) loadPresetFromIndexedDb(source, isStillCurrent);
                    return;
                }
                return response.blob().then(function (blob) {
                    if (!isStillCurrent()) return;
                    window.MAOMAOFontRuntime.applyBlob(blob, cachedFormat);
                });
            }).catch(function () {
                if (isStillCurrent()) loadPresetFromIndexedDb(source, isStillCurrent);
            });
            return;
        }
        loadPresetFromIndexedDb(source, isStillCurrent);
    }

    function whenIdle(callback) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(callback, { timeout: 1000 });
        } else {
            window.setTimeout(callback, 0);
        }
    }

    /* 首帧之后再应用字体：导航、桌面与聊天首屏都先使用系统字体立即渲染。 */
    function scheduleFontLoad() {
        if (fontLoadScheduled) return;
        fontLoadScheduled = true;
        var run = function () {
            fontLoadScheduled = false;
            loadActiveFontPreset();
        };
        var afterFrame = function () {
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(function () { whenIdle(run); });
            else whenIdle(run);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', afterFrame, { once: true });
        } else {
            afterFrame();
        }
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
