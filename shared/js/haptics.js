/* MAOMAO 触感反馈 v1：不影响音效、消息存储或导航；各模块可按事件名接入。 */
(function (root) {
    'use strict';

    if (root.MAOMAOHaptics) return;

    var STORAGE_KEY = 'maomao_haptics_enabled_v1';
    var profiles = Object.create(null);
    var defaults = {
        send: 12,
        receive: 9,
        navigate: 8,
        swipe: 11,
        longpress: 18,
        success: 12
    };
    Object.keys(defaults).forEach(function (name) { profiles[name] = defaults[name]; });

    var lastPulseAt = -Infinity;
    var lastByType = Object.create(null);

    function supported() {
        return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    }

    function isEnabled() {
        try { return root.localStorage.getItem(STORAGE_KEY) !== '0'; }
        catch (err) { return true; }
    }

    function setEnabled(value) {
        try {
            root.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
            root.dispatchEvent(new CustomEvent('maomao:hapticschange', {
                detail: { enabled: !!value }
            }));
            return true;
        } catch (err) {
            return false;
        }
    }

    function register(type, milliseconds) {
        if (typeof type !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(type) ||
            !Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 40) return false;
        profiles[type] = Math.round(milliseconds);
        return true;
    }

    /* 返回值只表示震动 API 已接受请求，不承诺物理设备实际震动。 */
    function trigger(type) {
        if (!Object.prototype.hasOwnProperty.call(profiles, type) ||
            !isEnabled() || !supported() ||
            (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false;

        var now = Date.now();
        // 防止短时间内多气泡/连续滑页导致密集震动。
        if (now - lastPulseAt < 70 || now - (lastByType[type] || -Infinity) < 170) return false;

        try {
            var ok = navigator.vibrate(profiles[type]);
            if (ok === false) return false;
            lastPulseAt = now;
            lastByType[type] = now;
            return true;
        } catch (err) {
            return false;
        }
    }

    root.MAOMAOHaptics = Object.freeze({
        key: STORAGE_KEY,
        supported: supported,
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        register: register,
        trigger: trigger
    });

    root.addEventListener('maomao:haptic', function (event) {
        var type = event && event.detail && event.detail.type;
        trigger(type);
    });
})(window);
