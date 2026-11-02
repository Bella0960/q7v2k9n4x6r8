/* ============================================================
 * chat-beauty.js  —  聊天美化中心（结构化参数版）底层
 *
 * 职责：
 *   1. 统一存储聊天外观参数：全局默认 + 单聊覆盖（稀疏存储，未存的字段跟随全局）
 *        全局：beauty_chat_global_v1
 *        单聊：beauty_chat_<contactId>
 *   2. resolve(contactId)          合并最终参数：内置默认 < 全局 < 单聊
 *   3. applyVars(vars, rootEl)     把一份参数写成 CSS 变量，挂到聊天容器或预览容器上
 *      apply(contactId, rootEl)    = resolve + applyVars（聊天页加载时调用）
 *      双写新 --chat-* 变量与旧 --avatar-size/--my-bubble-* 变量（过渡期兼容）
 *   4. save(scope, partial)        稀疏保存；字段传 null 表示"恢复跟随全局"
 *   5. 加载时静默迁移旧 theme_bubble_* 配置（只跑一次，不删除旧 key）
 *   6. 未配置背景时回落旧 chat_bg_<id>（保持原有 72% 白遮罩观感）
 *
 * 无依赖，仅需 localStorage。被 chat-detail.html 与聊天美化中心（beauty.html）引用。
 * ============================================================ */

(function (global) {
    'use strict';

    var NS = global.ChatBeauty = {};

    var GLOBAL_KEY = 'beauty_chat_global_v1';
    var ROLE_PREFIX = 'beauty_chat_';
    var MIGRATED_FLAG = 'beauty_chat_migrated_v1';

    // 内置默认 = chat-detail 页面当前视觉（无任何配置时的效果）
    var DEFAULTS = {
        avatarSize: 30,          // px
        avatarRadius: 50,        // %，0 = 方形，50 = 正圆，中间值 = 圆角矩形
        bubbleGap: 13,           // px，消息行间距
        bubbleGapX: 0,           // px，气泡左右外边距（0 = 与旧版视觉一致）
        bubbleMaxWidth: 86,      // %，消息行最大宽度（限制气泡能有多宽）
        bubblePadding: 10,       // px，气泡内边距基准；实际 = (n-0.5px) 上下 / (n+3px) 左右，默认即 9.5px 13px
        myBubbleBg: '#111111', myBubbleOpacity: 100,
        myBubbleColor: '#FFFFFF',
        myBubbleRadius: '15px 15px 4px 15px',
        myBubbleRadiusTL: 15, myBubbleRadiusTR: 15, myBubbleRadiusBR: 4, myBubbleRadiusBL: 15,
        myBubbleBorderStyle: 'solid',
        myBubbleLineHeight: 1.4,
        myBubbleShadowVisible: false, myBubbleShadowColor: '#000000', myBubbleShadowX: 0, myBubbleShadowY: 2, myBubbleShadowBlur: 6, myBubbleShadowSpread: 0,
        partnerBubbleBg: '#FFFFFF', partnerBubbleOpacity: 100,
        partnerBubbleColor: '#111111',
        partnerBubbleRadius: '15px 15px 15px 4px',
        partnerBubbleRadiusTL: 15, partnerBubbleRadiusTR: 15, partnerBubbleRadiusBR: 15, partnerBubbleRadiusBL: 4,
        partnerBubbleBorderStyle: 'solid',
        partnerBubbleLineHeight: 1.4,
        partnerBubbleShadowVisible: false, partnerBubbleShadowColor: '#000000', partnerBubbleShadowX: 0, partnerBubbleShadowY: 2, partnerBubbleShadowBlur: 6, partnerBubbleShadowSpread: 0,
        myBubbleBorderColor: '#111111', myBubbleBorderWidth: 0,
        partnerBubbleBorderColor: '#DADAE0', partnerBubbleBorderWidth: 1,
        myBubbleRadiusSize: '', partnerBubbleRadiusSize: '',
        myBubblePadding: 10, partnerBubblePadding: 10,
        myBubbleFontSize: 12, partnerBubbleFontSize: 12,
        myBubbleFontFamily: 'system', partnerBubbleFontFamily: 'system',
        myBubbleTailSize: 0, myBubbleTailX: 0, myBubbleTailY: 12,
        myBubbleTailShape: 'triangle', myBubbleTailColor: '',
        partnerBubbleTailSize: 0, partnerBubbleTailX: 0, partnerBubbleTailY: 12,
        partnerBubbleTailShape: 'triangle', partnerBubbleTailColor: '',
        myBubbleDecorations: [], partnerBubbleDecorations: [],
        myBubbleAvatarPosition: 'side', partnerBubbleAvatarPosition: 'side',
        myBubbleBadge: '', partnerBubbleBadge: '',    // 头像旁边的自定义小标签文字（空=不显示）
        myBubbleBadgeColor: '#999999', partnerBubbleBadgeColor: '#999999',
        myBubbleBadgeX: 6, partnerBubbleBadgeX: 6,    // 标签水平偏移 px（正值=朝屏幕中间推）
        myBubbleBadgeY: -2, partnerBubbleBadgeY: -2,    // 标签垂直偏移 px
        partnerBubbleBadgeAnchor: 'avatar', myBubbleBadgeAnchor: 'avatar',  // avatar=钉头像旁 / bubble-tl/tr/bl/br=钉气泡角落
        partnerBubbleBadgeSize: 7, myBubbleBadgeSize: 7,   // 标签字号 px
        avatarBorderColor: '#FFFFFF', avatarBorderWidth: 1,
        messageTimeVisible: false, messageTimeColor: '#999999', messageTimeSize: 8,
        messageTimePosition: 'below',   // 'above' = 气泡上方（与头像同行）；'below' = 气泡下方；'side' = 气泡侧边（与气泡同行，靠中间）
        messageTimeShowRead: false,      // 是否在我的消息后面显示"已读"
        messageReadPosition: 'inline',   // 'inline' = 时间同行右侧；'below' = 时间下面单独一行；'bubble' = 气泡右下角外侧
        messageShowDate: true,            // 时间戳是否显示日期（false = 只显示几点几分）
        imageBubbleOpacity: 100, imageBubbleRadius: 16,
        redPacketBg: '#111111', redPacketBgOpacity: 100, redPacketImage: '', redPacketImageOpacity: 100,
        redPacketBorderColor: '#111111', redPacketBorderWidth: 0, redPacketRadius: 10,
        redPacketShowStatus: true, redPacketTextColor: '#FFFFFF', redPacketFontSize: 12,
        redPacketTitle: '', redPacketTitleColor: '#8E8E93', redPacketAmountTemplate: '', redPacketAmountColor: '#FFFFFF',
        transferBg: '#FFFFFF', transferBorderColor: '#E5E5EA', transferBorderWidth: 1, transferTextColor: '#111111',
        transferImage: '', transferImageOpacity: 100,
        chatBg: '',
        chatBgDim: 0,
        themePreset: 'default' // built-in theme preset metadata
    };
    NS.DEFAULTS = DEFAULTS;
    NS.getDefaults = function () {
        var copy = {};
        for (var key in DEFAULTS) copy[key] = Array.isArray(DEFAULTS[key]) ? DEFAULTS[key].slice() : DEFAULTS[key];
        return copy;
    };

    function readJSON(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (raw == null) return fallback;
            var v = JSON.parse(raw);
            return (v && typeof v === 'object') ? v : fallback;
        } catch (e) { return fallback; }
    }

    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }

    function num(v, fb) {
        var n = Number(v);
        return isNaN(n) ? fb : n;
    }

    function readScope(scope) {
        var key = scope === 'global' ? GLOBAL_KEY : ROLE_PREFIX + scope;
        var cfg = readJSON(key, null);
        return (cfg && cfg.vars && typeof cfg.vars === 'object') ? cfg.vars : {};
    }

    var CHAT_THEME_KEY = 'maomao_chat_theme_preset';
    // Only values written by the old built-in iMessage preset are eligible for automatic cleanup.
    var LEGACY_IMESSAGE_VALUES = {
        bubbleGap: 9, bubbleGapX: 0, bubbleMaxWidth: 80, bubblePadding: 10,
        myBubbleBg: '#007AFF', myBubbleOpacity: 100, myBubbleColor: '#FFFFFF',
        myBubbleRadius: '18px 18px 5px 18px', myBubbleRadiusTL: 18, myBubbleRadiusTR: 18,
        myBubbleRadiusBR: 5, myBubbleRadiusBL: 18, myBubbleBorderColor: '#007AFF',
        myBubbleBorderWidth: 0, myBubbleBorderStyle: 'solid', myBubbleLineHeight: 1.45,
        myBubbleShadowVisible: false, myBubbleRadiusSize: '', myBubblePadding: 10,
        myBubbleFontSize: 12, myBubbleFontFamily: 'system', myBubbleTailSize: 7,
        myBubbleTailX: 5, myBubbleTailY: 10, myBubbleTailShape: 'round', myBubbleTailColor: '#007AFF',
        partnerBubbleBg: '#E9E9EB', partnerBubbleOpacity: 100, partnerBubbleColor: '#111111',
        partnerBubbleRadius: '18px 18px 18px 5px', partnerBubbleRadiusTL: 18,
        partnerBubbleRadiusTR: 18, partnerBubbleRadiusBR: 18, partnerBubbleRadiusBL: 5,
        partnerBubbleBorderColor: '#E9E9EB', partnerBubbleBorderWidth: 0,
        partnerBubbleBorderStyle: 'solid', partnerBubbleLineHeight: 1.45,
        partnerBubbleShadowVisible: false, partnerBubbleRadiusSize: '', partnerBubblePadding: 10,
        partnerBubbleFontSize: 12, partnerBubbleFontFamily: 'system', partnerBubbleTailSize: 7,
        partnerBubbleTailX: -5, partnerBubbleTailY: 10, partnerBubbleTailShape: 'round',
        partnerBubbleTailColor: '#E9E9EB', messageTimeVisible: true, messageTimeColor: '#8E8E93',
        messageTimeSize: 10, messageTimePosition: 'above', messageTimeShowRead: true,
        messageReadPosition: 'inline', messageShowDate: false, imageBubbleRadius: 16
    };
    function cleanupLegacyThemeValues() {
        var keys = [];
        try { keys = Object.keys(localStorage); } catch (e) { return; }
        keys.forEach(function (key) {
            if (key !== GLOBAL_KEY && key.indexOf(ROLE_PREFIX) !== 0) return;
            var cfg = readJSON(key, null);
            if (!cfg || !cfg.vars || cfg.vars.themePreset !== 'imessage') return;
            Object.keys(LEGACY_IMESSAGE_VALUES).forEach(function (field) {
                if (Object.prototype.hasOwnProperty.call(cfg.vars, field) &&
                    JSON.stringify(cfg.vars[field]) === JSON.stringify(LEGACY_IMESSAGE_VALUES[field])) {
                    delete cfg.vars[field];
                }
            });
            delete cfg.vars.themePreset;
            cfg.updatedAt = Date.now();
            writeJSON(key, cfg);
        });
    }
    // Defaults for the page-wide iMessage theme; explicit bubble settings remain higher priority.
    var IMESSAGE_BUBBLE_DEFAULTS = {
        myBubbleBg: '#007AFF', myBubbleOpacity: 100, myBubbleColor: '#FFFFFF',
        myBubbleRadius: '18px 18px 5px 18px', myBubbleRadiusTL: 18, myBubbleRadiusTR: 18,
        myBubbleRadiusBR: 5, myBubbleRadiusBL: 18, myBubbleBorderColor: '#007AFF', myBubbleBorderWidth: 0,
        myBubbleBorderStyle: 'solid', myBubbleLineHeight: 1.42, myBubbleShadowVisible: false,
        myBubblePadding: 10, myBubbleFontSize: 14, myBubbleFontFamily: 'system',
        myBubbleTailSize: 7, myBubbleTailX: -5, myBubbleTailY: 12, myBubbleTailShape: 'triangle', myBubbleTailColor: '#007AFF',
        partnerBubbleBg: '#FFFFFF', partnerBubbleOpacity: 52, partnerBubbleColor: '#1C1C1E',
        partnerBubbleRadius: '18px 18px 18px 5px', partnerBubbleRadiusTL: 18, partnerBubbleRadiusTR: 18,
        partnerBubbleRadiusBR: 18, partnerBubbleRadiusBL: 5, partnerBubbleBorderColor: 'rgba(255,255,255,.62)',
        partnerBubbleBorderWidth: 1, partnerBubbleBorderStyle: 'solid', partnerBubbleLineHeight: 1.42,
        partnerBubbleShadowVisible: false, partnerBubblePadding: 10, partnerBubbleFontSize: 14,
        partnerBubbleFontFamily: 'system', partnerBubbleTailSize: 7, partnerBubbleTailX: -5,
        partnerBubbleTailY: 12, partnerBubbleTailShape: 'triangle', partnerBubbleTailColor: '#2C2C31',
        messageTimeVisible: true, messageTimeColor: '#FFFFFF', messageTimeSize: 10,
        messageTimePosition: 'above', messageTimeShowRead: true, messageReadPosition: 'inline',
        messageShowDate: false, imageBubbleRadius: 16
    };

    // Silver Butterfly supplies a quiet glass palette by default. Explicit global and per-role
    // customizations still layer above these values in resolve(), so saved bubble work is preserved.
    var SILVER_BUTTERFLY_BUBBLE_DEFAULTS = {
        myBubbleBg: '#E7E7EA', myBubbleOpacity: 82, myBubbleColor: '#27272B',
        myBubbleRadius: '18px 18px 5px 18px', myBubbleRadiusTL: 18, myBubbleRadiusTR: 18,
        myBubbleRadiusBR: 5, myBubbleRadiusBL: 18, myBubbleBorderColor: 'rgba(255,255,255,.9)',
        myBubbleBorderWidth: 1, myBubbleBorderStyle: 'solid', myBubbleLineHeight: 1.45,
        myBubbleShadowVisible: true, myBubbleShadowColor: 'rgba(70,70,78,.07)',
        myBubbleShadowX: 0, myBubbleShadowY: 3, myBubbleShadowBlur: 14, myBubbleShadowSpread: 0,
        myBubblePadding: 11, myBubbleFontSize: 14, myBubbleFontFamily: 'system',
        partnerBubbleBg: '#FFFFFF', partnerBubbleOpacity: 82, partnerBubbleColor: '#222226',
        partnerBubbleRadius: '18px 18px 18px 5px', partnerBubbleRadiusTL: 18, partnerBubbleRadiusTR: 18,
        partnerBubbleRadiusBR: 18, partnerBubbleRadiusBL: 5, partnerBubbleBorderColor: 'rgba(255,255,255,.94)',
        partnerBubbleBorderWidth: 1, partnerBubbleBorderStyle: 'solid', partnerBubbleLineHeight: 1.45,
        partnerBubbleShadowVisible: true, partnerBubbleShadowColor: 'rgba(70,70,78,.06)',
        partnerBubbleShadowX: 0, partnerBubbleShadowY: 2, partnerBubbleShadowBlur: 12, partnerBubbleShadowSpread: 0,
        partnerBubblePadding: 11, partnerBubbleFontSize: 14, partnerBubbleFontFamily: 'system',
        messageTimeVisible: true, messageTimeColor: '#77777D', messageTimeSize: 10,
        messageTimePosition: 'above', messageTimeShowRead: true, messageReadPosition: 'inline',
        messageShowDate: false, imageBubbleRadius: 18
    };

    var CHAT_THEME_MIGRATED_FLAG = 'maomao_chat_theme_migrated_v1';
    // Migrate the former page-wide preset into its own global key once, then detach
    // the exact built-in values it previously wrote into the bubble customization configs.
    (function migrateLegacyPageTheme() {
        try {
            if (localStorage.getItem(CHAT_THEME_MIGRATED_FLAG) === '1') return;
            var saved = localStorage.getItem(CHAT_THEME_KEY);
            if (saved !== 'default' && saved !== 'imessage' &&
                readScope('global').themePreset === 'imessage') {
                localStorage.setItem(CHAT_THEME_KEY, 'imessage');
            }
            cleanupLegacyThemeValues();
            localStorage.setItem(CHAT_THEME_MIGRATED_FLAG, '1');
        } catch (e) {}
    })();
    NS.getThemePreset = function () {
        try {
            var saved = localStorage.getItem(CHAT_THEME_KEY);
            if (saved === 'default' || saved === 'imessage' || saved === 'qq' || saved === 'silver-butterfly') return saved;
        } catch (e) {}
        var legacy = readScope('global').themePreset;
        return legacy === 'imessage' ? 'imessage' : 'default';
    };
    NS.setThemePreset = function (theme) {
        if (theme !== 'imessage' && theme !== 'qq' && theme !== 'silver-butterfly') theme = 'default';
        cleanupLegacyThemeValues();
        try {
            localStorage.setItem(CHAT_THEME_KEY, theme);
            return localStorage.getItem(CHAT_THEME_KEY) === theme;
        } catch (e) { return false; }
    };

    function paddingCss(sideValue, fallback) {
        var pad = Math.max(2, Math.min(28, num(sideValue, num(fallback, 10))));
        return (pad - 0.5) + 'px ' + (pad + 3) + 'px';
    }

    function fontFamily(key) {
        if (key === 'serif') return 'Georgia, "Songti SC", serif';
        if (key === 'mono') return '"SF Mono", Menlo, monospace';
        return '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    }

    function colorWithAlpha(color, alpha) {
        var m = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
        if (!m) return 'rgba(17,17,17,' + Math.max(0, Math.min(1, alpha)) + ')';
        var hex = m[1];
        return 'rgba(' + parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' +
            parseInt(hex.slice(4, 6), 16) + ',' + Math.max(0, Math.min(1, alpha)) + ')';
    }

    function sideForBubble(bubble) {
        var row = bubble.closest('.vbp-row, .msg-row');
        return row && (row.classList.contains('me') || row.classList.contains('sent') || row.classList.contains('right')) ? 'my' : 'partner';
    }

    function renderDecorations(layer, list) {
        var signature;
        try { signature = JSON.stringify(Array.isArray(list) ? list : []); } catch (e) { signature = '[]'; }
        if (layer.getAttribute('data-signature') === signature) return;
        layer.setAttribute('data-signature', signature);
        layer.textContent = '';
        (Array.isArray(list) ? list : []).slice(0, 8).forEach(function (item) {
            if (!item || !item.url) return;
            var img = document.createElement('img');
            img.className = 'chat-beauty-decoration';
            img.alt = '';
            img.draggable = false;
            img.src = String(item.url);
            img.style.left = Math.max(0, Math.min(100, num(item.x, 62))) + '%';
            img.style.top = Math.max(0, Math.min(100, num(item.y, 8))) + '%';
            img.style.width = Math.max(8, Math.min(100, num(item.width, 30))) + '%';
            img.style.opacity = String(Math.max(0, Math.min(1, num(item.opacity, 0.82))));
            layer.appendChild(img);
        });
    }

    function applyBubbleDecorations(rootEl, v) {
        if (!rootEl || !rootEl.querySelectorAll) return;
        var bubbles = [];
        if (rootEl.matches && rootEl.matches('.msg-bubble, .vbp-bubble')) bubbles.push(rootEl);
        rootEl.querySelectorAll('.msg-bubble, .vbp-bubble').forEach(function (b) { bubbles.push(b); });
        bubbles.forEach(function (bubble) {
            var side = sideForBubble(bubble);
            var list = v[side === 'my' ? 'myBubbleDecorations' : 'partnerBubbleDecorations'];
            var layer = bubble.querySelector(':scope > .chat-beauty-decoration-layer');
            var content = bubble.querySelector(':scope > .chat-beauty-content');
            if (!layer || !content) {
                var nodes = Array.prototype.slice.call(bubble.childNodes);
                layer = document.createElement('span');
                layer.className = 'chat-beauty-decoration-layer';
                layer.setAttribute('aria-hidden', 'true');
                content = document.createElement('span');
                content.className = 'chat-beauty-content';
                nodes.forEach(function (node) { content.appendChild(node); });
                bubble.textContent = '';
                bubble.appendChild(layer);
                bubble.appendChild(content);
            }
            renderDecorations(layer, list);
        });
    }

    function applyPaymentText(rootEl, v) {
        if (!rootEl || !rootEl.querySelectorAll) return;
        rootEl.querySelectorAll('.pay-card-red .pay-card-label, .vbp-pay-title').forEach(function (label) {
            if (!label.hasAttribute('data-chat-beauty-original')) label.setAttribute('data-chat-beauty-original', label.textContent || '');
            var chosenTitle = String(v.redPacketTitle || '').trim() || label.getAttribute('data-chat-beauty-original') || '红包';
            if (label.textContent !== chosenTitle) label.textContent = chosenTitle;
        });
        rootEl.querySelectorAll('.pay-card-red .pay-card-amount, #vbPreview .vbp-pay:not(.is-transfer) .vbp-pay-amount').forEach(function (amount) {
            if (!amount.hasAttribute('data-chat-beauty-original')) amount.setAttribute('data-chat-beauty-original', amount.textContent || '');
            var template = String(v.redPacketAmountTemplate || '');
            var desiredAmount;
            if (!template) desiredAmount = amount.getAttribute('data-chat-beauty-original') || '';
            else {
                var raw = (amount.getAttribute('data-chat-beauty-original') || '').replace(/^[¥￥]\\s*/, '');
                desiredAmount = template.replace(/\\{amount\\}/g, raw).replace(/\\{currency\\}/g, '¥');
            }
            if (amount.textContent !== desiredAmount) amount.textContent = desiredAmount;
        });
    }

    function applyDynamic(rootEl, v) {
        applyBubbleDecorations(rootEl, v);
        applyPaymentText(rootEl, v);
    }

    function observeDynamic(rootEl) {
        if (!rootEl || rootEl.__chatBeautyObserver || !global.MutationObserver) return;
        rootEl.__chatBeautyObserver = new MutationObserver(function (records) {
            var config = rootEl.__chatBeautyVars;
            if (!config) return;
            // Only inspect newly inserted message rows/subtrees; do not rescan the full history for each new message.
            records.forEach(function (record) {
                Array.prototype.forEach.call(record.addedNodes || [], function (node) {
                    if (!node || node.nodeType !== 1) return;
                    applyBubbleDecorations(node, config);
                    applyPaymentText(node, config);
                });
            });
        });
        rootEl.__chatBeautyObserver.observe(rootEl, { childList: true, subtree: true });
    }

    /* ========== 读取与合并 ========== */

    // 最终参数 = 内置默认 < 全局 < 单聊；null / 空串视为"未设置"，继续下沉
    NS.resolve = function (contactId) {
        var out = {};
        for (var k in DEFAULTS) out[k] = DEFAULTS[k];
        var activeThemePreset = NS.getThemePreset();
        // A page theme supplies default bubble values only. Explicit global and per-role
        // bubble customizations are then layered over it, preserving the editor's purpose.
        var pageBubbleDefaults = activeThemePreset === 'imessage' ? IMESSAGE_BUBBLE_DEFAULTS :
            (activeThemePreset === 'silver-butterfly' ? SILVER_BUTTERFLY_BUBBLE_DEFAULTS : null);
        if (pageBubbleDefaults) {
            for (var themeKey in pageBubbleDefaults) {
                if (themeKey in DEFAULTS) out[themeKey] = pageBubbleDefaults[themeKey];
            }
        }
        var layers = [readScope('global')];
        if (contactId != null && contactId !== '') layers.push(readScope(String(contactId)));
        layers.forEach(function (vars) {
            for (var k in vars) {
                if (k in DEFAULTS && vars[k] !== null && vars[k] !== '') out[k] = vars[k];
            }
        });
        // Ignore any old per-role themePreset: page layout selection is global only.
        out.themePreset = activeThemePreset;
        return out;
    };

    /* ========== 应用到容器 ========== */

    // 把一份最终参数写成 CSS 变量。rootEl：聊天容器（.chat-stage）或美化中心的预览容器。
    // ta = 对方（partner）。双写：新 --chat-* 变量（预览/新 UI 消费）+ 旧变量（现有页面 CSS 消费）。
    NS.applyVars = function (v, rootEl) {
        if (!rootEl || !v) return v;
        var s = rootEl.style;
        // The page shell and the message stage share the same built-in theme.
        // This lets iMessage update the header/composer together with the bubbles.
        var activeThemePreset = (v.themePreset === 'imessage' || v.themePreset === 'qq' || v.themePreset === 'silver-butterfly') ? v.themePreset : 'default';
        try {
            rootEl.setAttribute('data-chat-theme-preset', activeThemePreset);
            var phoneShell = rootEl.closest ? rootEl.closest('.phone-mockup') : null;
            if (phoneShell) phoneShell.setAttribute('data-chat-theme-preset', activeThemePreset);
        } catch (e) {}

        s.setProperty('--chat-avatar-size', num(v.avatarSize, 30) + 'px');
        s.setProperty('--chat-avatar-radius', num(v.avatarRadius, 50) + '%');
        s.setProperty('--chat-bubble-gap', num(v.bubbleGap, 13) + 'px');
        s.setProperty('--chat-bubble-gap-x', num(v.bubbleGapX, 0) + 'px');
        s.setProperty('--chat-bubble-max-width', num(v.bubbleMaxWidth, 86) + '%');
        var pad = num(v.bubblePadding, 10);
        s.setProperty('--chat-bubble-padding', (pad - 0.5) + 'px ' + (pad + 3) + 'px');
        s.setProperty('--chat-bubble-my-bg', 'color-mix(in srgb, ' + v.myBubbleBg + ' ' + num(v.myBubbleOpacity,100) + '%, transparent)');
        s.setProperty('--chat-bubble-my-color', v.myBubbleColor);
        s.setProperty('--chat-bubble-my-radius', v.myBubbleRadius);
        s.setProperty('--chat-bubble-ta-bg', 'color-mix(in srgb, ' + v.partnerBubbleBg + ' ' + num(v.partnerBubbleOpacity,100) + '%, transparent)');
        s.setProperty('--chat-bubble-ta-color', v.partnerBubbleColor);
        s.setProperty('--chat-bubble-ta-radius', v.partnerBubbleRadius);

        s.setProperty('--chat-bubble-my-border-color', v.myBubbleBorderColor || '#111111');
        s.setProperty('--chat-bubble-my-border-width', num(v.myBubbleBorderWidth, 0) + 'px');
        s.setProperty('--chat-bubble-ta-border-color', v.partnerBubbleBorderColor || '#DADAE0');
        s.setProperty('--chat-bubble-ta-border-width', num(v.partnerBubbleBorderWidth, 1) + 'px');
        s.setProperty('--chat-bubble-my-border-style', v.myBubbleBorderStyle || 'solid');
        s.setProperty('--chat-bubble-ta-border-style', v.partnerBubbleBorderStyle || 'solid');
        s.setProperty('--chat-bubble-my-line-height', String(num(v.myBubbleLineHeight, 1.4)));
        s.setProperty('--chat-bubble-ta-line-height', String(num(v.partnerBubbleLineHeight, 1.4)));
        // 四角独立圆角：若任一角被显式设置过（非空），则用四角值覆盖统一 radius
        if (v.myBubbleRadiusTL != null || v.myBubbleRadiusTR != null || v.myBubbleRadiusBR != null || v.myBubbleRadiusBL != null) {
            s.setProperty('--chat-bubble-my-radius', num(v.myBubbleRadiusTL,15)+'px '+num(v.myBubbleRadiusTR,15)+'px '+num(v.myBubbleRadiusBR,4)+'px '+num(v.myBubbleRadiusBL,15)+'px');
        }
        if (v.partnerBubbleRadiusTL != null || v.partnerBubbleRadiusTR != null || v.partnerBubbleRadiusBR != null || v.partnerBubbleRadiusBL != null) {
            s.setProperty('--chat-bubble-ta-radius', num(v.partnerBubbleRadiusTL,15)+'px '+num(v.partnerBubbleRadiusTR,15)+'px '+num(v.partnerBubbleRadiusBR,15)+'px '+num(v.partnerBubbleRadiusBL,4)+'px');
        }
        // 阴影
        function shadowStr(prefix) {
            var vis = v[prefix+'ShadowVisible'];
            if (vis === false) return 'none';
            var c = v[prefix+'ShadowColor'] || '#000000';
            var x = num(v[prefix+'ShadowX'], 0), y = num(v[prefix+'ShadowY'], 2);
            var b = num(v[prefix+'ShadowBlur'], 6), sp = num(v[prefix+'ShadowSpread'], 0);
            return x+'px '+y+'px '+b+'px '+sp+'px '+c;
        }
        s.setProperty('--chat-bubble-my-shadow', shadowStr('myBubble'));
        s.setProperty('--chat-bubble-ta-shadow', shadowStr('partnerBubble'));
        if (v.myBubbleRadiusSize !== '' && v.myBubbleRadiusSize != null) s.setProperty('--chat-bubble-my-radius-size', num(v.myBubbleRadiusSize, 15) + 'px');
        else s.removeProperty('--chat-bubble-my-radius-size');
        s.setProperty('--chat-bubble-my-padding', paddingCss(v.myBubblePadding, v.bubblePadding));
        if (v.partnerBubbleRadiusSize !== '' && v.partnerBubbleRadiusSize != null) s.setProperty('--chat-bubble-ta-radius-size', num(v.partnerBubbleRadiusSize, 15) + 'px');
        else s.removeProperty('--chat-bubble-ta-radius-size');
        s.setProperty('--chat-bubble-ta-padding', paddingCss(v.partnerBubblePadding, v.bubblePadding));
        s.setProperty('--chat-bubble-my-font-size', num(v.myBubbleFontSize, 12) + 'px');
        s.setProperty('--chat-bubble-ta-font-size', num(v.partnerBubbleFontSize, 12) + 'px');
        s.setProperty('--chat-bubble-my-font-family', fontFamily(v.myBubbleFontFamily));
        s.setProperty('--chat-bubble-ta-font-family', fontFamily(v.partnerBubbleFontFamily));
        s.setProperty('--chat-bubble-my-tail-size', num(v.myBubbleTailSize, 0) + 'px');
        s.setProperty('--chat-bubble-my-tail-x', num(v.myBubbleTailX, 0) + 'px');
        s.setProperty('--chat-bubble-my-tail-y', num(v.myBubbleTailY, 12) + 'px');
        s.setProperty('--chat-bubble-my-tail-color', v.myBubbleTailColor || '');
        s.setProperty('--chat-bubble-ta-tail-size', num(v.partnerBubbleTailSize, 0) + 'px');
        s.setProperty('--chat-bubble-ta-tail-x', num(v.partnerBubbleTailX, 0) + 'px');
        s.setProperty('--chat-bubble-ta-tail-y', num(v.partnerBubbleTailY, 12) + 'px');
        s.setProperty('--chat-bubble-ta-tail-color', v.partnerBubbleTailColor || '');
        // 尾巴形状：triangle 用 clip-path 三角，round 用圆角+旋转
        var myShape = v.myBubbleTailShape || 'triangle';
        var taShape = v.partnerBubbleTailShape || 'triangle';
        if (myShape === 'round') {
            s.setProperty('--chat-bubble-my-tail-clip', 'none');
            s.setProperty('--chat-bubble-my-tail-radius', '0 70% 0 0');
            s.setProperty('--chat-bubble-my-tail-transform', 'rotate(45deg)');
        } else {
            s.setProperty('--chat-bubble-my-tail-clip', 'polygon(0 0, 100% 0, 0 100%)');
            s.setProperty('--chat-bubble-my-tail-radius', '0');
            s.setProperty('--chat-bubble-my-tail-transform', 'none');
        }
        if (taShape === 'round') {
            s.setProperty('--chat-bubble-ta-tail-clip', 'none');
            s.setProperty('--chat-bubble-ta-tail-radius', '0 0 0 70%');
            s.setProperty('--chat-bubble-ta-tail-transform', 'rotate(-45deg)');
        } else {
            s.setProperty('--chat-bubble-ta-tail-clip', 'polygon(0 0, 100% 0, 100% 100%)');
            s.setProperty('--chat-bubble-ta-tail-radius', '0');
            s.setProperty('--chat-bubble-ta-tail-transform', 'none');
        }
        s.setProperty('--chat-avatar-border-color', v.avatarBorderColor || '#FFFFFF');
        s.setProperty('--chat-avatar-border-width', num(v.avatarBorderWidth, 1) + 'px');
        s.setProperty('--chat-my-avatar-pos', v.myBubbleAvatarPosition || 'side');
        s.setProperty('--chat-ta-avatar-pos', v.partnerBubbleAvatarPosition || 'side');
        // 头像位置：side=旁边(默认), top=上方, bottom=下方
        var myPos = v.myBubbleAvatarPosition || 'side';
        var taPos = v.partnerBubbleAvatarPosition || 'side';
        // sent 行 DOM: bubble 在前, avatar 在后
        s.setProperty('--chat-my-flex-dir', myPos === 'top' ? 'column-reverse' : myPos === 'bottom' ? 'column' : 'row');
        s.setProperty('--chat-my-align', myPos === 'side' ? 'flex-start' : 'flex-end');
        // received 行 DOM: avatar 在前, bubble 在后
        s.setProperty('--chat-ta-flex-dir', taPos === 'top' ? 'column' : taPos === 'bottom' ? 'column-reverse' : 'row');
        s.setProperty('--chat-ta-align', taPos === 'side' ? 'flex-start' : 'flex-start');
        s.setProperty('--chat-time-color', v.messageTimeColor || '#999999');
        s.setProperty('--chat-time-size', num(v.messageTimeSize, 8) + 'px');
        s.setProperty('--chat-time-display', v.messageTimeVisible === false ? 'none' : 'flex');
        s.setProperty('--chat-time-position', v.messageTimePosition === 'above' ? 'above' : 'below');
        s.setProperty('--chat-time-show-read', v.messageTimeShowRead === true ? 'flex' : 'none');
        s.setProperty('--chat-read-position', v.messageReadPosition || 'inline');
        s.setProperty('--chat-show-date', v.messageShowDate === false ? 'none' : 'block');
        s.setProperty('--chat-ta-badge', v.partnerBubbleBadge ? '"' + String(v.partnerBubbleBadge).replace(/["\\]/g,'\\$&') + '"' : '');
        s.setProperty('--chat-my-badge', v.myBubbleBadge ? '"' + String(v.myBubbleBadge).replace(/["\\]/g,'\\$&') + '"' : '');
        s.setProperty('--chat-ta-badge-color', v.partnerBubbleBadgeColor || '#999999');
        s.setProperty('--chat-my-badge-color', v.myBubbleBadgeColor || '#999999');
        s.setProperty('--chat-ta-badge-x', num(v.partnerBubbleBadgeX, 6) + 'px');
        s.setProperty('--chat-ta-badge-y', num(v.partnerBubbleBadgeY, -2) + 'px');
        s.setProperty('--chat-my-badge-x', num(v.myBubbleBadgeX, -6) + 'px');
        s.setProperty('--chat-my-badge-y', num(v.myBubbleBadgeY, -2) + 'px');
        s.setProperty('--chat-ta-badge-anchor', v.partnerBubbleBadgeAnchor || 'avatar');
        s.setProperty('--chat-my-badge-anchor', v.myBubbleBadgeAnchor || 'avatar');
        s.setProperty('--chat-ta-badge-size', num(v.partnerBubbleBadgeSize, 7) + 'px');
        s.setProperty('--chat-my-badge-size', num(v.myBubbleBadgeSize, 7) + 'px');
        s.setProperty('--chat-image-opacity', (num(v.imageBubbleOpacity, 100) / 100).toFixed(2));
        s.setProperty('--chat-image-radius', num(v.imageBubbleRadius, 16) + 'px');
        s.setProperty('--chat-redpacket-bg', v.redPacketBg || '#111111');
        s.setProperty('--chat-redpacket-bg-rgba', colorWithAlpha(v.redPacketBg || '#111111', num(v.redPacketBgOpacity, 100) / 100));
        s.setProperty('--chat-redpacket-image', v.redPacketImage ? 'url("' + String(v.redPacketImage).replace(/["\\]/g, '') + '")' : 'none');
        s.setProperty('--chat-redpacket-image-opacity', (num(v.redPacketImageOpacity, 100) / 100).toFixed(2));
        s.setProperty('--chat-redpacket-border-color', v.redPacketBorderColor || '#111111');
        s.setProperty('--chat-redpacket-border-width', num(v.redPacketBorderWidth, 0) + 'px');
        s.setProperty('--chat-redpacket-radius', num(v.redPacketRadius, 10) + 'px');
        s.setProperty('--chat-redpacket-status-display', v.redPacketShowStatus === false ? 'none' : 'block');
        s.setProperty('--chat-redpacket-text-color', v.redPacketTextColor || '#FFFFFF');
        s.setProperty('--chat-redpacket-font-size', num(v.redPacketFontSize, 12) + 'px');
        s.setProperty('--chat-redpacket-title-color', v.redPacketTitleColor || '#8E8E93');
        s.setProperty('--chat-redpacket-amount-color', v.redPacketAmountColor || '#FFFFFF');
        s.setProperty('--chat-transfer-bg', v.transferBg || '#FFFFFF');
        s.setProperty('--chat-transfer-border-color', v.transferBorderColor || '#E5E5EA');
        s.setProperty('--chat-transfer-border-width', num(v.transferBorderWidth, 1) + 'px');
        s.setProperty('--chat-transfer-text-color', v.transferTextColor || '#111111');
        s.setProperty('--chat-transfer-image', v.transferImage ? 'url("'+v.transferImage+'")' : 'none');
        s.setProperty('--chat-transfer-image-opacity', (num(v.transferImageOpacity, 100)/100));

        // 过渡期双写：chat-detail 现有 CSS 仍消费这批旧变量名
        s.setProperty('--avatar-size', num(v.avatarSize, 30) + 'px');
        s.setProperty('--avatar-radius', num(v.avatarRadius, 50) + '%');
        s.setProperty('--my-bubble-bg', v.myBubbleBg);
        s.setProperty('--my-bubble-color', v.myBubbleColor);
        s.setProperty('--my-bubble-radius', v.myBubbleRadius);
        s.setProperty('--partner-bubble-bg', v.partnerBubbleBg);
        s.setProperty('--partner-bubble-color', v.partnerBubbleColor);
        s.setProperty('--partner-bubble-radius', v.partnerBubbleRadius);

        // 背景：大图由 IndexedDB 保存，配置里只保留 idb-image: 引用，读取完成后再应用。
        if (v.chatBg && String(v.chatBg).indexOf('idb-image:') !== 0) {
            var dim = Math.min(Math.max(num(v.chatBgDim, 0), 0), 0.85);
            var img = 'url("' + v.chatBg + '")';
            var layers = dim > 0
                ? 'linear-gradient(rgba(0,0,0,' + dim + '), rgba(0,0,0,' + dim + ')),' + img
                : img;
            s.setProperty('--chat-bg-image', layers);
        } else {
            s.removeProperty('--chat-bg-image');
        }
        rootEl.__chatBeautyVars = v;
        applyDynamic(rootEl, v);
        observeDynamic(rootEl);
        return v;
    };

    // 聊天页加载入口：resolve 出最终参数并应用。
    // 美化未配置背景时，回落旧单聊背景 chat_bg_<id>（72% 白遮罩，沿用原 applyChatBackground 观感）。
    NS.apply = function (contactId, rootEl) {
        if (!rootEl) return null;
        var roleVars = contactId != null && contactId !== '' ? readScope(String(contactId)) : {};
        var hasRoleSpecificBeautyBg = Object.prototype.hasOwnProperty.call(roleVars, 'chatBg') &&
            roleVars.chatBg !== null && roleVars.chatBg !== '';
        var v = NS.applyVars(NS.resolve(contactId), rootEl);
        var phoneShell = rootEl.closest ? rootEl.closest('.phone-mockup') : null;

        function syncShellWallpaper() {
            if (!phoneShell) return;
            if (v.themePreset === 'imessage') {
                var shellBackground = rootEl.style.getPropertyValue('--chat-bg-image');
                if (!shellBackground) {
                    try {
                        shellBackground = window.getComputedStyle(rootEl).getPropertyValue('--chat-bg-image').trim();
                    } catch (e) {}
                }
                if (!shellBackground || shellBackground === 'none') {
                    try {
                        var computedStageBackground = window.getComputedStyle(rootEl).backgroundImage;
                        if (computedStageBackground && computedStageBackground !== 'none') shellBackground = computedStageBackground;
                    } catch (e) {}
                }
                if (shellBackground && shellBackground !== 'none') {
                    phoneShell.style.setProperty('--chat-theme-bg-image', shellBackground);
                    phoneShell.style.removeProperty('background-image');
                } else {
                    phoneShell.style.removeProperty('--chat-theme-bg-image');
                    phoneShell.style.removeProperty('background-image');
                }
            } else {
                phoneShell.style.removeProperty('--chat-theme-bg-image');
                phoneShell.style.removeProperty('background-image');
            }
        }

        function applyLegacyWallpaper(legacyBg) {
            if (!hasRoleSpecificBeautyBg) {
                if (legacyBg) {
                    // iMessage 直接显示原图；默认主题延续旧版 72% 白色遮罩效果。
                    var legacyOverlay = v.themePreset === 'imessage' ? '' :
                        'linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)),';
                    rootEl.style.setProperty('--chat-bg-image', legacyOverlay + 'url("' + legacyBg + '")');
                } else {
                    rootEl.style.removeProperty('--chat-bg-image');
                }
            }
            syncShellWallpaper();
        }

        // 角色专属美化背景若使用 IndexedDB 引用，读取真实图片后再刷新舞台和 iMessage 壳层。
        // 只解析角色专属背景，避免把全局美化图自动铺给所有聊天角色。
        if (hasRoleSpecificBeautyBg && typeof v.chatBg === 'string' && v.chatBg.indexOf('idb-image:') === 0) {
            var referencedBgKey = v.chatBg.slice('idb-image:'.length);
            var backgroundStore = window.MAOMAOWallpaperStore;
            if (backgroundStore && typeof backgroundStore.getByKey === 'function') {
                try {
                    backgroundStore.getByKey(referencedBgKey).then(function (imageData) {
                        if (!imageData) return;
                        v.chatBg = imageData;
                        NS.applyVars(v, rootEl);
                        syncShellWallpaper();
                    }).catch(function () {});
                } catch (e) {}
            }
        }

        // 先同步显示仍存在于 localStorage 的旧壁纸，随后从独立图片存储读取最新版。
        // 这样旧数据无闪断迁移，新上传的壁纸也不再占用聊天记录的 localStorage 配额。
        if (!hasRoleSpecificBeautyBg && contactId != null && contactId !== '') {
            var legacyBg = '';
            var bgKey = 'chat_bg_' + String(contactId);
            try { legacyBg = localStorage.getItem(bgKey) || ''; } catch (e) {}
            applyLegacyWallpaper(legacyBg);

            var mediaStore = window.MAOMAOWallpaperStore;
            if (mediaStore && typeof mediaStore.getByKey === 'function') {
                try {
                    var pendingBg = mediaStore.getByKey(bgKey);
                    if (pendingBg && typeof pendingBg.then === 'function') {
                        pendingBg.then(function (storedBg) {
                            applyLegacyWallpaper(storedBg || '');
                        }).catch(function () {
                            applyLegacyWallpaper(legacyBg);
                        });
                    }
                } catch (e) {
                    applyLegacyWallpaper(legacyBg);
                }
            }
        } else {
            syncShellWallpaper();
        }
        return v;
    };

    /* ========== 保存（稀疏） ========== */

    // partial: { 字段: 值 }；字段传 null = 删除该字段（恢复跟随全局/内置默认）。scope: 'global' 或角色 id。
    NS.save = function (scope, partial) {
        if (!scope || !partial || typeof partial !== 'object') return false;
        var key = scope === 'global' ? GLOBAL_KEY : ROLE_PREFIX + scope;
        var cfg = readJSON(key, { v: 1, updatedAt: 0, vars: {} });
        if (!cfg.vars || typeof cfg.vars !== 'object') cfg.vars = {};
        for (var k in partial) {
            if (!(k in DEFAULTS)) continue;      // 白名单：拒绝未知字段，防脏数据进存储
            if (partial[k] === null) delete cfg.vars[k];
            else cfg.vars[k] = partial[k];
        }
        cfg.v = 1;
        cfg.updatedAt = Date.now();
        return writeJSON(key, cfg);
    };

    // 清空某个作用域的配置（恢复跟随上层）
    NS.reset = function (scope) {
        var key = scope === 'global' ? GLOBAL_KEY : ROLE_PREFIX + scope;
        try { localStorage.removeItem(key); } catch (e) {}
    };

    /* ========== 一次性迁移：theme_bubble_* → beauty_chat_* ========== */
    // 静默执行：仅在旧配置存在且新 key 尚未写入时转换；不删除旧 key；打标记防重放。
    (function migrate() {
        try {
            if (localStorage.getItem(MIGRATED_FLAG) === '1') return;

            // 旧字段名（bubble-theme.html）→ 新字段名
            var MAP = {
                myBg: 'myBubbleBg', myColor: 'myBubbleColor', myRadius: 'myBubbleRadius',
                partnerBg: 'partnerBubbleBg', partnerColor: 'partnerBubbleColor',
                partnerRadius: 'partnerBubbleRadius',
                avatarSize: 'avatarSize', avatarRadius: 'avatarRadius'
            };

            function convert(oldConf) {
                if (!oldConf || typeof oldConf !== 'object') return null;
                var vars = {};
                var hit = false;
                for (var old in MAP) {
                    if (oldConf[old] !== undefined && oldConf[old] !== null && oldConf[old] !== '') {
                        vars[MAP[old]] = oldConf[old];
                        hit = true;
                    }
                }
                return hit ? vars : null;
            }

            // 全局
            if (localStorage.getItem(GLOBAL_KEY) == null) {
                var gv = convert(readJSON('theme_bubble_global', null));
                if (gv) writeJSON(GLOBAL_KEY, { v: 1, updatedAt: Date.now(), vars: gv });
            }
            // 单聊：theme_bubble_role_<id> → beauty_chat_<id>
            var keys = [];
            try { keys = Object.keys(localStorage); } catch (e) {}
            keys.forEach(function (k) {
                var m = /^theme_bubble_role_(.+)$/.exec(k);
                if (!m) return;
                var newKey = ROLE_PREFIX + m[1];
                if (localStorage.getItem(newKey) != null) return;
                var rv = convert(readJSON(k, null));
                if (rv) writeJSON(newKey, { v: 1, updatedAt: Date.now(), vars: rv });
            });

            localStorage.setItem(MIGRATED_FLAG, '1');
        } catch (e) {}
    })();
})(window);
