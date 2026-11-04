/* native-feel.js —— 全局"原生手感"增强
   1. 禁文本选择/长按菜单、去点按高亮、惯性滚动、防页面回弹
   2. 页面转场：进入右滑入 / 返回左滑回 / 切 tab 原地淡入；跳转前淡出+微缩（刷新不触发）
   3. 点击震动反馈（安卓生效，iOS 自动跳过）
   引入方式：每个页面 <head> 中、font-loader.js 之后同步引入 */
(function () {
'use strict';

    /* ---------- Theme layer: default stays Classic; glass is strictly opt-in ---------- */
    var MAOMAO_THEME_KEY = 'maomao_theme';
    var maomaoThemeRoot = document.documentElement;
    var maomaoThemeLink = null;
    function normalizeMaoMaoTheme(value) {
        return value === 'liquid-glass' ? 'liquid-glass' : 'classic';
    }
    function readMaoMaoTheme() {
        try { return normalizeMaoMaoTheme(window.localStorage.getItem(MAOMAO_THEME_KEY)); }
        catch (err) { return 'classic'; }
    }
    function ensureMaoMaoThemeStylesheet() {
        maomaoThemeLink = document.getElementById('maomao-liquid-glass-theme');
        if (!maomaoThemeLink) {
            var current = document.currentScript ||
                document.querySelector('script[src*="shared/js/native-feel.js"]');
            if (!current || !current.src) return null;
            try {
                maomaoThemeLink = document.createElement('link');
                maomaoThemeLink.id = 'maomao-liquid-glass-theme';
                maomaoThemeLink.rel = 'stylesheet';
                var themeCssUrl = new URL('../css/liquid-glass-theme.css', current.src);
                themeCssUrl.searchParams.set('v', '20261024v1');
                maomaoThemeLink.href = themeCssUrl.href;
                maomaoThemeLink.media = 'all';
            } catch (err) {
                maomaoThemeLink = null;
                return null;
            }
        }

        /* Keep the theme layer after all page CSS so its higher-specificity glass rules win. */
        if (document.head && maomaoThemeLink.parentNode !== document.head) {
            document.head.appendChild(maomaoThemeLink);
        } else if (document.head && document.readyState !== 'loading' &&
                   document.head.lastElementChild !== maomaoThemeLink) {
            document.head.appendChild(maomaoThemeLink);
        }
        return maomaoThemeLink;
    }
    maomaoThemeRoot.setAttribute('data-theme', readMaoMaoTheme());
    ensureMaoMaoThemeStylesheet();
    /* The parser adds page styles after this early script; move glass CSS to the end once parsing is done. */
    document.addEventListener('DOMContentLoaded', function () {
        if (readMaoMaoTheme() === 'liquid-glass') ensureMaoMaoThemeStylesheet();
    }, { once: true });
    window.MAOMAOTheme = {
        key: MAOMAO_THEME_KEY,
        get: readMaoMaoTheme,
        set: function (value) {
            var theme = normalizeMaoMaoTheme(value);
            try { window.localStorage.setItem(MAOMAO_THEME_KEY, theme); } catch (err) {}
            maomaoThemeRoot.setAttribute('data-theme', theme);
            ensureMaoMaoThemeStylesheet();
            try {
                window.dispatchEvent(new CustomEvent('maomao:themechange', { detail: { theme: theme } }));
            } catch (err) {}
            return theme;
        }
    };


    /* ---------- 一、全局原生 CSS（脚本在 head 同步执行，先于首屏绘制注入） ---------- */
    var css = [
        'html {',
        '    -webkit-user-select: none;',
        '    user-select: none;',
        '    -webkit-touch-callout: none;',            /* 长按不弹出系统复制菜单 */
        '    -webkit-tap-highlight-color: transparent;',
        '    overscroll-behavior-y: none;',            /* 防止页面橡皮筋回弹/下拉刷新 */
        '    -webkit-overflow-scrolling: touch;',      /* 继承属性，所有滚动容器获得 iOS 惯性滚动 */
        '    transition: opacity 0.08s ease, transform 0.08s ease;',  /* 淡入/淡出/微缩共用过渡（缩短以免跳转白屏） */
        '    opacity: 1;',
        '}',
        /* 页面入场动画三选一：push 从右滑入 / pop 从左滑回 / tab 原地淡入 */
        '@keyframes nfPushIn { from { opacity: 0; transform: translateX(22px) scale(0.97); } to { opacity: 1; transform: none; } }',
        '@keyframes nfPopIn  { from { opacity: 0; transform: translateX(-22px); } to { opacity: 1; transform: none; } }',
        '@keyframes nfTabIn  { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }',
        'html.nf-enter {',
        '    animation-duration: 0.12s;',
        '    animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1);',
        '    animation-fill-mode: backwards;',
        '    will-change: transform, opacity;',
        '}',
        'html.nf-enter-push { animation-name: nfPushIn; }',
        'html.nf-enter-pop  { animation-name: nfPopIn; }',
        'html.nf-enter-tab  { animation-name: nfTabIn; }',
        /* 出场：淡出 + 微缩到 0.96，像被"推走" */
        'html.nf-hide { opacity: 0; transform: scale(0.96); }',
        /* 系统"减弱动态效果"时全部关闭 */
        '@media (prefers-reduced-motion: reduce) {',
        '    html.nf-enter { animation: none !important; }',
        '    html { transition: none !important; }',
        '}',
        '* { -webkit-tap-highlight-color: transparent; }',
        /* 不强制覆盖各页面状态栏的背景，由页面自己的顶层排版决定是否透明。 */
        'html, body { overscroll-behavior-y: none; }',
        /* 内层滚动容器：阻止滚动到底后把回弹传给页面 */
        '[class*="scroll"], .chat-stage { overscroll-behavior-y: none; }',
        /* 输入类元素恢复可选中，否则无法打字/选字/粘贴 */
        'input, textarea, select, [contenteditable="true"] {',
        '    -webkit-user-select: text;',
        '    user-select: text;',
        '    -webkit-touch-callout: default;',
        '}',
        /* 消除双击缩放延迟 */
        'a, button, [role="button"] { touch-action: manipulation; }',
        /* 按压反馈：瞬间缩放，最接近原生手感（不加过渡，避免覆盖各按钮已有 transition） */
        'a:active, button:active, [role="button"]:active { transform: scale(0.97); }'
    ].join('\n');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    /* ---------- 二、首屏可见 + 页面入场转场 ---------- */
    function showPage() {
        var de = document.documentElement;
        de.classList.remove('nf-boot');
        de.classList.remove('nf-hide');
    }

    /* 播放入场动画：push 从右滑入 / pop 从左滑回 / tab 原地淡入。
       动画结束(animationend)立即摘掉类，避免 transform 长期挂在 html 上
       影响 fixed 定位与毛玻璃；reduced-motion 下动画被禁用、无 animationend，
       由 600ms 超时兜底摘除。 */
    function playEnter(mode) {
        var de = document.documentElement;
        var enterCls = 'nf-enter-' + mode;
        de.classList.add('nf-enter', enterCls);
        var done = false;
        function cleanup() {
            if (done) return;
            done = true;
            de.classList.remove('nf-enter', enterCls);
        }
        de.addEventListener('animationend', function (e) {
            if (e.target === de) cleanup();   /* 子元素动画冒泡不算 */
        });
        setTimeout(cleanup, 600);
    }

    showPage();

    /* 方向判定：优先用跳转前写入 sessionStorage 的标记（读到即删），
       其次用导航类型：back_forward(浏览器前进/后退)→pop，reload(刷新)→不做动画，其余→push */
    var nfDir = null;
    try {
        nfDir = sessionStorage.getItem('nf_dir');
        if (nfDir) sessionStorage.removeItem('nf_dir');
    } catch (err) { /* 隐私模式等异常场景忽略 */ }
    var navType = 'navigate';
    try {
        var navEntry = performance.getEntriesByType('navigation')[0];
        if (navEntry && navEntry.type) navType = navEntry.type;
    } catch (err) { /* 忽略 */ }
    if (navType !== 'reload') {
        playEnter(nfDir === 'tab' ? 'tab'
            : (nfDir === 'pop' || navType === 'back_forward') ? 'pop'
            : 'push');
    }

    /* 安卓返回键/前进从缓存(bfcache)恢复页面时：强制立即显示，并播放"滑回"入场 */
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) {
            showPage();
            playEnter('pop');
        }
    });

    /* ---------- 三、跳转淡出：仅点击链接/跳转按钮时触发，刷新与返回键不触发 ---------- */
    var FADE_MS = 80;
    var hideTimer = null;
    var navigating = false;   /* 跳转已发起后忽略后续点击，防双击竞态 */

    function startFadeOut() {
        navigating = true;
        document.documentElement.classList.add('nf-hide');
        /* 兜底：500ms 内页面没真正跳走（如条件跳转被拦截），自动恢复显示并清脏标记 */
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            document.documentElement.classList.remove('nf-hide');
            navigating = false;
            try { sessionStorage.removeItem('nf_dir'); } catch (err) { /* 忽略 */ }
        }, 500);
    }

    function markDir(dir) {
        try { sessionStorage.setItem('nf_dir', dir); } catch (err) { /* 忽略 */ }
    }

    /* 判断链接是否属于"返回"：返回类按钮，或目标目录是当前路径的上级（../ 式返回） */
    function isBackLink(link) {
        if (link.closest('.back-btn, .back-button, [aria-label="返回"]')) return true;
        var here = location.pathname;
        var there = link.pathname;
        var hereDir = here.slice(0, here.lastIndexOf('/') + 1);
        var thereDir = there.slice(0, there.lastIndexOf('/') + 1);
        return thereDir !== hereDir && hereDir.indexOf(thereDir) === 0;
    }

    function isPlainHref(href) {
        return !href || href.charAt(0) === '#' ||
            /^(javascript|mailto|tel):/i.test(href);
    }

    document.addEventListener('click', function (e) {
        /* 跳转已在进行中：吞掉所有后续点击，防双击竞态 */
        if (navigating) { e.preventDefault(); return; }
        if (e.defaultPrevented || e.button !== 0 ||
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        /* 1. 普通 <a> 链接：接管跳转，先淡出 80ms 再真正跳转 */
        var link = (e.target.closest) ? e.target.closest('a[href]') : null;
        if (link && !isPlainHref(link.getAttribute('href')) &&
            link.target !== '_blank' && !link.hasAttribute('download') &&
            link.href !== location.href) {
            e.preventDefault();
            if (link.closest('.nav-tab')) markDir('tab');
            else if (isBackLink(link)) markDir('pop');
            startFadeOut();
            setTimeout(function () { location.href = link.href; }, FADE_MS);
            return;
        }

        /* 2. onclick 里写了 location.href 的按钮：只加淡出+方向标记，完全不干涉原逻辑 */
        var btn = (e.target.closest) ? e.target.closest('[onclick]') : null;
        if (btn) {
            var code = btn.getAttribute('onclick') || '';
            if (/location\s*\.\s*(href\s*=|replace\s*\(|assign\s*\()/i.test(code)) {
                if (btn.closest('.back-btn, .back-button, [aria-label="返回"]') ||
                    /href\s*=\s*['"]?\.\.\//.test(code)) markDir('pop');
                startFadeOut();
            }
        }
    }, false);

    /* ---------- 四、触觉反馈：捕获阶段委托，覆盖按钮与链接 ---------- */
    var TAP_SELECTOR = 'button, a, [role="button"], .nav-tab, .nav-circle-btn, .dock-item, .tab-item, .app-card';
    document.addEventListener('click', function (e) {
        var el = (e.target.closest) ? e.target.closest(TAP_SELECTOR) : null;
        if (!el || el.disabled) return;
        if (navigator.vibrate) {
            try { navigator.vibrate(15); } catch (err) { /* 不支持时忽略 */ }
        }
    }, true);

    /* ---------- 五、Service Worker 更新后自动刷新一次 ----------
       本地开发改了代码，浏览器可能仍被旧 SW 缓存命中。
       新 SW 接管页面时 controllerchange 触发，自动刷新一次拿到最新版。
       首访安装时本来没有 controller，skipWaiting + clients.claim() 会让本页
       立刻收到 controllerchange；此时缓存已就绪，跳过刷新，避免二次文档加载。
       sessionStorage 标记防循环刷新。 */
    if ('serviceWorker' in navigator) {
        var swHadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (!swHadController) { swHadController = true; return; }
            try {
                if (sessionStorage.getItem('sw_reloaded')) return;
                sessionStorage.setItem('sw_reloaded', '1');
                location.reload();
            } catch (err) { /* 隐私模式等异常场景直接忽略 */ }
        });
    }

    /* ---------- 六、全站底部 Home Indicator：应用内点击返回桌面 ---------- */
    (function loadMaoMaoHomeIndicator() {
        if (document.querySelector('script[data-maomao-home-indicator-loader]')) return;
        var nativeScript = document.currentScript || document.querySelector('script[src*="native-feel.js"]');
        if (!nativeScript || !nativeScript.src) return;
        var helper = document.createElement('script');
        helper.src = new URL('home-indicator.js?v=20261023v1', nativeScript.src).href;
        helper.async = false;
        helper.setAttribute('data-maomao-home-indicator-loader', '1');
        (document.head || document.documentElement).appendChild(helper);
    })();


    /* ---------- MAOMAO PWA：令 Android 系统状态栏跟随当前应用顶部底色 ---------- */
    (function MAOMAOSystemBarColor() {
        function colorChannels(value) {
            var m = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
            if (!m) return null;
            return {
                r: Math.max(0, Math.min(255, Number(m[1]))),
                g: Math.max(0, Math.min(255, Number(m[2]))),
                b: Math.max(0, Math.min(255, Number(m[3]))),
                a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4])))
            };
        }

        function compositeColor(element) {
            var chain = [];
            var node = element;
            var depth = 0;
            while (node && node.nodeType === 1 && depth < 18) {
                chain.push(node);
                node = node.parentElement;
                depth++;
            }
            var color = { r: 255, g: 255, b: 255, a: 1 };
            for (var i = chain.length - 1; i >= 0; i--) {
                var parsed = colorChannels(window.getComputedStyle(chain[i]).backgroundColor);
                if (!parsed || parsed.a <= 0) continue;
                var a = parsed.a;
                color = {
                    r: parsed.r * a + color.r * (1 - a),
                    g: parsed.g * a + color.g * (1 - a),
                    b: parsed.b * a + color.b * (1 - a),
                    a: 1
                };
            }
            function hex(v) { return Math.round(v).toString(16).padStart(2, '0'); }
            return '#' + hex(color.r) + hex(color.g) + hex(color.b);
        }

        function colorAtTop(x, y, statusBar) {
            var stack = [];
            try {
                stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
            } catch (err) {}
            for (var i = 0; i < stack.length; i++) {
                var el = stack[i];
                if (!el || el === statusBar || (statusBar && statusBar.contains(el))) continue;
                if (el === document.documentElement) continue;
                return compositeColor(el);
            }
            return null;
        }

        function update() {
            if (!document.body || document.body.classList.contains('maomao-home')) return;

            var meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = 'theme-color';
                meta.content = '#FFFFFF';
                document.head.appendChild(meta);
            }

            var statusBar = document.querySelector('.status-bar');
            var rect = statusBar && statusBar.getBoundingClientRect();
            /* 采样状态栏实际覆盖的屏幕最上方，而不是用整页 body 或手机壳颜色代替。 */
            var y = rect
                ? (window.getComputedStyle(statusBar).position === 'absolute' || window.getComputedStyle(statusBar).position === 'fixed'
                    ? rect.top + Math.min(6, Math.max(1, rect.height / 4))
                    : Math.max(1, rect.bottom + 1))
                : 1;
            y = Math.max(1, Math.min(Math.max(1, window.innerHeight - 1), y));
            var w = Math.max(1, window.innerWidth);
            var points = [Math.max(1, Math.round(w * 0.12)), Math.round(w * 0.5), Math.min(w - 1, Math.round(w * 0.88))];
            var samples = [];
            for (var i = 0; i < points.length; i++) {
                var c = colorAtTop(points[i], y, statusBar);
                if (c) samples.push(c);
            }

            var chosen = null;
            var counts = {};
            var best = 0;
            samples.forEach(function (c) {
                counts[c] = (counts[c] || 0) + 1;
                if (counts[c] > best) {
                    chosen = c;
                    best = counts[c];
                }
            });

            /* 屏幕采样被浏览器遮挡时退回到实际应用容器，而非任意写死颜色。 */
            if (!chosen) {
                var shell = (statusBar && statusBar.closest('.phone-screen, .phone-mockup, .app-frame, .phone')) ||
                    document.querySelector('.phone-screen, .phone-mockup, .app-frame, .phone') ||
                    document.body;
                chosen = compositeColor(shell);
            }
            if (meta.getAttribute('content').toLowerCase() !== chosen.toLowerCase()) {
                meta.setAttribute('content', chosen);
            }
        }

        var queued = false;
        function schedule() {
            if (queued) return;
            queued = true;
            window.requestAnimationFrame(function () {
                queued = false;
                update();
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', schedule, { once: true });
        } else {
            schedule();
        }
        window.addEventListener('pageshow', schedule);
        window.addEventListener('load', schedule);
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
        window.addEventListener('maomao:themechange', schedule);
        if (window.MutationObserver) {
            var observer = new MutationObserver(schedule);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-wallpaper-tone'] });
            if (document.body) observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        }
    })();

})();
