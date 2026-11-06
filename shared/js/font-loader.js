/* 全局字体加载器：所有页面在 <head> 中最先引入本文件。
 * 职责：
 *   1. 字号：读 localStorage['font_size_global']（12-20px，迁移旧键 font_size），
 *      写入 --base-font-size；注入 html { font-size: calc(...) } 根字号公式，
 *      全站 rem 文本自动缩放。同时导出无单位倍率 --global-font-scale（px 消费方用）。
 *   2. 字体颜色：读 custom_font_color（font-settings.html 色卡），写入
 *      --global-font-color，并在非暗色模式下把 body 文字色设为该颜色
 *      （显式指定了颜色的元素不受影响，聊天气泡由聊天美化系统接管，属刻意设计）。
 *   3. 兜底默认值同时写在 shared/css/mobile-fit.css 的 :root，双保险。
 */
(function () {
    var DEFAULT_COLOR = '#111111';

    /* 1. 注入根变量默认值与根字号公式：14px 基准时 1rem = 16px */
    var style = document.createElement('style');
    style.textContent = ':root { --base-font-size: 14px; --global-font-scale: 1; --global-font-color: ' + DEFAULT_COLOR + '; }'
        + 'html { font-size: calc(var(--base-font-size, 14px) / 14 * 16); }';
    document.head.appendChild(style);

    /* 2. 字号：读取 + 迁移 + 应用 */
    function clamp(n) { return Math.min(20, Math.max(12, n)); }
    function validColor(c) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c); }
    var size = null;
    var color = '';
    try {
        var raw = localStorage.getItem('font_size_global');
        if (raw === null) {
            /* 旧键迁移（旧范围 10-20，钳制到 12-20） */
            var old = parseInt(localStorage.getItem('font_size'), 10);
            if (!isNaN(old)) {
                size = clamp(old);
                try { localStorage.setItem('font_size_global', String(size)); } catch (e) { }
            }
        } else {
            var n = parseInt(raw, 10);
            if (!isNaN(n)) size = clamp(n);
        }
        var c = (localStorage.getItem('custom_font_color') || '').trim();
        if (validColor(c)) color = c;
    } catch (e) { }

    var root = document.documentElement;
    if (size !== null) {
        root.style.setProperty('--base-font-size', size + 'px');
        /* px 写死方的缩放倍率：calc(11px * var(--global-font-scale, 1)) */
        root.style.setProperty('--global-font-scale', String(Math.round(size / 14 * 1000) / 1000));
    }
    if (color) {
        root.style.setProperty('--global-font-color', color);
        /* body 文字色需等 body 存在后再以内联方式写入（内联 > 页面样式表的 body 色）。
           暗色模式页面跳过：黑白色卡在深底上会不可读。 */
        var applyBodyColor = function () {
            try {
                if (!root.classList.contains('dark')) {
                    document.body.style.color = color;
                }
            } catch (e) { }
        };
        if (document.body) applyBodyColor();
        else document.addEventListener('DOMContentLoaded', applyBodyColor);
    }

    /* 3. 自定义字体：支持旧 URL 与 IndexedDB 中的 TTF / WOFF 文件方案 */
    var fontObjectUrl = '';
    var fontStyleId = 'maomao-global-custom-font-style';
    var globalFontStack = '"MAOMAOUserFont", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif';

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

    function applyFontSource(url, format) {
        if (!url) return;
        var tag = getFontStyle();
        var safeUrl = safeFontUrl(url);
        var fontFormat = format || 'woff';
        tag.textContent = '@font-face{font-family:"MAOMAOUserFont";src:url("' + safeUrl + '") format("' + fontFormat + '");font-style:normal;font-display:swap;}'
            + 'body,body h1,body h2,body h3,body h4,body h5,body h6,body p,body span:not([class*="icon"]):not([class*="Icon"]),body a,body button,body input,body textarea,body select,body label,body small,body strong,body b,body em,body li,body td,body th'
            + '{font-family:' + globalFontStack + ' !important;}';
    }

    window.MAOMAOFontRuntime = {
        applyUrl: function (url, format) {
            if (fontObjectUrl) {
                try { URL.revokeObjectURL(fontObjectUrl); } catch (e) {}
                fontObjectUrl = '';
            }
            applyFontSource(url, format);
        },
        applyBlob: function (blob, format) {
            if (!blob || !window.URL || !URL.createObjectURL) return;
            if (fontObjectUrl) {
                try { URL.revokeObjectURL(fontObjectUrl); } catch (e) {}
            }
            fontObjectUrl = URL.createObjectURL(blob);
            applyFontSource(fontObjectUrl, format || 'truetype');
        },
        clear: function () {
            var tag = document.getElementById(fontStyleId);
            if (tag) tag.remove();
            if (fontObjectUrl) {
                try { URL.revokeObjectURL(fontObjectUrl); } catch (e) {}
                fontObjectUrl = '';
            }
        }
    };

    var lastLoadedFontKey = null;
    var fontLoadGeneration = 0;
    var fontLoadScheduled = false;

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

        if (!window.indexedDB) return;
        var request;
        try { request = indexedDB.open('maomao-font-presets', 1); }
        catch (e) { return; }

        request.onupgradeneeded = function () {
            if (!request.result.objectStoreNames.contains('presets')) request.result.createObjectStore('presets', { keyPath: 'id' });
        };
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
            } catch (e) { try { db.close(); } catch (err) {} }
        };
        request.onerror = function () {};
    }

    // 先让页面完成首屏绘制，再在浏览器空闲时读取/解析用户字体。
    // 页面从 BFCache 恢复时也只做空闲同步，不再每次 pageshow 重复读取字体库。
    function scheduleFontLoad() {
        if (fontLoadScheduled) return;
        fontLoadScheduled = true;
        var run = function () {
            fontLoadScheduled = false;
            loadActiveFontPreset();
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: 1800 });
        } else {
            window.setTimeout(run, 700);
        }
    }

    scheduleFontLoad();

    window.addEventListener('pageshow', function (event) {
        if (event && event.persisted) scheduleFontLoad();
    });
    window.addEventListener('storage', function (event) {
        if (!event.key || event.key === 'active_font_preset_id' || event.key === 'custom_font_url') {
            // 新字体设置只在首屏稳定后应用；不会阻塞页面打开。
            scheduleFontLoad();
        }
    });

})();
