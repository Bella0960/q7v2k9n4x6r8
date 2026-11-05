/* ============================================================
 * statusbar-control.js
 * 全局状态栏控制：根据 localStorage 开关隐藏/显示整个状态栏
 *   settings_statusbar = '0' 时隐藏整个状态栏（时间+电量全部隐藏）
 *   settings_home_indicator_visible = '0' 时隐藏桌面最底部的小横条
 * 所有页面在 </body> 前引入本脚本即可自动生效。
 * ============================================================ */
(function () {
    'use strict';

    function getPref(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function apply() {
        var hideStatusbar = getPref('settings_statusbar') === '0';
        var hideHomeIndicator = getPref('settings_home_indicator_visible') === '0';
        var bars = document.querySelectorAll('.status-bar');
        for (var i = 0; i < bars.length; i++) {
            var sb = bars[i];
            sb.style.display = hideStatusbar ? 'none' : '';
        }

        /* The bottom home indicator is separate from the top status bar and has its own setting. */
        var homeIndicators = document.querySelectorAll('.gesture-bar');
        for (var j = 0; j < homeIndicators.length; j++) {
            homeIndicators[j].style.display = hideHomeIndicator ? 'none' : '';
            homeIndicators[j].setAttribute('aria-hidden', 'true');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
    window.addEventListener('pageshow', apply);
    window.addEventListener('storage', function (event) {
        if (!event.key || event.key === 'settings_home_indicator_visible' ||
            event.key === 'settings_statusbar') apply();
    });
    /* 暴露给设置页开关联动 */
    window.__statusbarControlApply = apply;
})();
