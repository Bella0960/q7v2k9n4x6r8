/* ============================================================
 * statusbar-control.js
 * 全局状态栏控制：根据 localStorage 开关隐藏/显示 时间 与 电量图标
 *   settings_statusbar_time    = '0' 时隐藏时间
 *   settings_statusbar_battery = '0' 时隐藏电量/状态图标
 *   settings_home_indicator_visible = '0' 时隐藏桌面最底部的小横条
 * 所有页面在 </body> 前引入本脚本即可自动生效。
 * ============================================================ */
(function () {
    'use strict';

    function getPref(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function collectRoots() {
        var roots = [document];
        var views = document.querySelectorAll('.maomao-app-view');
        for (var i = 0; i < views.length; i++) {
            if (views[i].shadowRoot) roots.push(views[i].shadowRoot);
        }
        return roots;
    }

    function applyRoot(root, hideTime, hideBattery, hideHomeIndicator) {
        var bars = root.querySelectorAll('.status-bar');
        for (var i = 0; i < bars.length; i++) {
            var sb = bars[i];
            /* ---- 时间元素：优先 .status-time / time / 无 class 的第一个 span ---- */
            var timeEl = sb.querySelector('.status-time') || sb.querySelector('time');
            if (!timeEl && sb.children && sb.children.length) {
                var c0 = sb.children[0];
                if (c0.tagName === 'SPAN' && !c0.className) timeEl = c0;
            }
            if (timeEl) timeEl.style.display = hideTime ? 'none' : '';

            /* ---- 电量/状态图标组 ---- */
            var icons = sb.querySelector('.status-icons');
            if (icons) icons.style.display = hideBattery ? 'none' : '';
            var bat = sb.querySelector('.battery-icon');
            if (bat) bat.style.display = hideBattery ? 'none' : '';
        }

        var homeIndicators = root.querySelectorAll('.gesture-bar');
        for (var j = 0; j < homeIndicators.length; j++) {
            homeIndicators[j].style.display = hideHomeIndicator ? 'none' : '';
            homeIndicators[j].setAttribute('aria-hidden', 'true');
        }
    }

    function apply() {
        var hideTime = getPref('settings_statusbar_time') === '0';
        var hideBattery = getPref('settings_statusbar_battery') === '0';
        var hideHomeIndicator = getPref('settings_home_indicator_visible') === '0';
        collectRoots().forEach(function (root) {
            applyRoot(root, hideTime, hideBattery, hideHomeIndicator);
        });
    }

    var shadowObserver = null;
    function observeAppViews() {
        if (typeof MutationObserver === 'undefined') return;
        if (!shadowObserver) {
            shadowObserver = new MutationObserver(function () {
                observeAppViews();
                apply();
            });
        }
        var views = document.querySelectorAll('.maomao-app-view');
        for (var i = 0; i < views.length; i++) {
            var shadow = views[i].shadowRoot;
            if (shadow && !shadow.__maomaoStatusbarObserved) {
                shadow.__maomaoStatusbarObserved = true;
                shadowObserver.observe(shadow, { childList: true, subtree: true });
                applyRoot(
                    shadow,
                    getPref('settings_statusbar_time') === '0',
                    getPref('settings_statusbar_battery') === '0',
                    getPref('settings_home_indicator_visible') === '0'
                );
            }
        }
    }

    if (typeof MutationObserver !== 'undefined') {
        shadowObserver = new MutationObserver(function () {
            observeAppViews();
            apply();
        });
        shadowObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            observeAppViews();
            apply();
        });
    } else {
        observeAppViews();
        apply();
    }
    window.addEventListener('pageshow', apply);
    window.addEventListener('storage', function (event) {
        if (!event.key || event.key === 'settings_home_indicator_visible' ||
            event.key === 'settings_statusbar_time' || event.key === 'settings_statusbar_battery') apply();
    });
    /* 暴露给设置页开关联动 */
    window.__statusbarControlApply = apply;
})();
