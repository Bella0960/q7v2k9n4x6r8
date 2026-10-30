/* ============================================================
 * chat-notifier.js — 跨页未读角标 + 顶部消息弹窗（仿 QQ/微信 heads-up）
 *
 * 原理（last-read 指针，不依赖页面常驻）：
 *   - 每个会话一个 last-read 时间戳：localStorage['chat_lastread_<id>']
 *   - 聊天详情页打开某会话时把指针推到最新一条消息；
 *     之后该会话再落库的 role==='assistant' 消息，全部视为未读。
 *   - 其它带底部导航的页面（聊天列表/联系人/空间/我的）每 1.5s 轮询一次：
 *       1) 汇总所有会话未读总数 → 刷底部「聊天」Tab 的红色数字角标；
 *       2) 发现一条比上次弹窗更新的未读消息 → 从手机顶部滑下通知条，
 *          点头像/卡片直接跳回该会话。
 *
 * 被两处加载：
 *   - nav.js 动态注入 → 负责刷角标 + 弹通知；
 *   - chat-detail.html 直接 <script> → 负责 markOpen / markSeen / 中途退出保文。
 * ============================================================ */
(function (global) {
    'use strict';

    var scriptEl = document.currentScript;
    // chat-notifier.js 位于 <root>/shared/js/，故站点根 = 再上两级
    var appBase = scriptEl ? new URL('../../', scriptEl.src).pathname : '/';
    // 去除可能的尾斜杠，方便拼接
    if (appBase.length > 1 && appBase.charAt(appBase.length - 1) === '/') {
        appBase = appBase.slice(0, -1);
    }

    var POLL_MS = 1500;
    var POPUP_DURATION_MS = 3600;
    var POPUP_SEEN_KEY = 'chat_popup_seen_ts'; // sessionStorage，关页面即忘
    var BADGE_ID = 'navChatBadge';

    var ChatNotifier = {};

    /* ---------- 小工具 ---------- */
    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val) {
        try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); return true; }
        catch (e) { return false; }
    }
    function safeJsonParse(s) {
        if (!s) return null;
        try { return JSON.parse(s); } catch (e) { return null; }
    }
    function safeImgSrc(u) {
        var s = String(u == null ? '' : u).trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        if (!s) return '';
        if (/^data\s*:\s*image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif);/i.test(s)) return s;
        if (/^https?:\/\//i.test(s)) return s;
        if (/^blob:/i.test(s)) return s;
        if (/^(?:\.|\/)/.test(s)) return s;
        return '';
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function readHistory(roleId) {
        var arr = safeJsonParse(safeGet('chat_history_' + roleId));
        return Array.isArray(arr) ? arr : [];
    }
    function readCharacters() {
        var arr = safeJsonParse(safeGet('ai_custom_characters'));
        return Array.isArray(arr) ? arr : [];
    }
    function readGroups() {
        var arr = safeJsonParse(safeGet('phone_groups'));
        return Array.isArray(arr) ? arr : [];
    }
    // 判断当前页面是不是某个会话的聊天详情页
    function currentDetailRoleId() {
        if (location.pathname.replace(/\\/g, '/').toLowerCase().indexOf('chat-detail.html') === -1) return '';
        try {
            var p = new URLSearchParams(window.location.search);
            return p.get('id') || '';
        } catch (e) { return ''; }
    }

    /* ---------- 会话展示信息（角色/群聊统一） ---------- */
    function buildContactIndex() {
        var map = {}; // id -> {id, name, avatar, isGroup}
        readCharacters().forEach(function (c) {
            if (c && c.id != null) {
                map[String(c.id)] = {
                    id: String(c.id),
                    name: c.name || c.nickname || '角色',
                    avatar: c.avatar || '',
                    isGroup: false
                };
            }
        });
        readGroups().forEach(function (g) {
            if (g && g.id != null) {
                map[String(g.id)] = {
                    id: String(g.id),
                    name: g.name || '群聊',
                    avatar: g.avatar || '',
                    isGroup: true
                };
            }
        });
        return map;
    }

    /* ---------- 未读统计 ---------- */
    // 统计单个会话未读：该会话里 time > lastread 的 assistant 消息条数
    function unreadOf(contact) {
        var history = readHistory(contact.id);
        var lastread = Number(safeGet('chat_lastread_' + contact.id)) || 0;
        var count = 0, newest = null;
        for (var i = 0; i < history.length; i++) {
            var m = history[i];
            if (!m) continue;
            if (m.role !== 'assistant') continue;
            if (m.isError || m.type === 'call' || m.type === 'system') continue;
            var t = Number(m.time) || 0;
            if (t > lastread) {
                count++;
                if (!newest || t > Number(newest.time)) newest = m;
            }
        }
        return { count: count, newest: newest };
    }

    /* ---------- 聊天详情页调用：打开会话 = 全部已读 ---------- */
    ChatNotifier.markOpen = function (roleId) {
        if (!roleId) return;
        var history = readHistory(roleId);
        var lastT = 0;
        for (var i = 0; i < history.length; i++) {
            var t = Number(history[i] && history[i].time) || 0;
            if (t > lastT) lastT = t;
        }
        safeSet('chat_lastread_' + roleId, String(lastT || Date.now()));
    };

    /* ---------- 聊天详情页调用：用户正在看的这条回复算已读 ---------- */
    ChatNotifier.markSeen = function (roleId, time) {
        if (!roleId) return;
        var cur = Number(safeGet('chat_lastread_' + roleId)) || 0;
        var t = Number(time) || Date.now();
        if (t > cur) safeSet('chat_lastread_' + roleId, String(t));
    };

    /* ---------- 底部角标 ---------- */
    function ensureBadgeEl() {
        var navTab = document.querySelector('.floating-nav .nav-tab[href*="chat/chat/chat.html"]');
        if (!navTab) return null;
        var badge = document.getElementById(BADGE_ID);
        if (!badge) {
            badge = document.createElement('span');
            badge.id = BADGE_ID;
            badge.className = 'nav-chat-badge';
            badge.style.cssText = [
                'position:absolute',
                'top:-4px',
                'right:-8px',
                'min-width:16px',
                'height:16px',
                'padding:0 4px',
                'border-radius:999px',
                'background:#FA5151',
                'color:#fff',
                'font-size:10px',
                'font-weight:700',
                'line-height:16px',
                'text-align:center',
                'box-shadow:0 0 0 1.5px #fff',
                'display:none',
                'z-index:10',
                'box-sizing:border-box'
            ].join(';');
            navTab.appendChild(badge);
        }
        return badge;
    }
    function refreshBadge(total) {
        var badge = ensureBadgeEl();
        if (!badge) return;
        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    /* ---------- 顶部通知弹窗 ---------- */
    function ensurePopupStyles() {
        if (document.getElementById('chatNotifierStyles')) return;
        var style = document.createElement('style');
        style.id = 'chatNotifierStyles';
        style.textContent = [
            '.cn-popup {',
            '  position:absolute;',
            '  top:8px; left:10px; right:10px;',
            '  display:flex; align-items:center; gap:10px;',
            '  padding:10px 12px;',
            '  background:rgba(255,255,255,0.92);',
            '  backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);',
            '  border:1px solid rgba(0,0,0,0.06);',
            '  border-radius:16px;',
            '  box-shadow:0 8px 28px rgba(0,0,0,0.14);',
            '  z-index:900;',
            '  cursor:pointer;',
            '  transform:translateY(-140%);',
            '  opacity:0;',
            '  transition:transform .32s cubic-bezier(.22,.9,.3,1.1), opacity .28s ease;',
            '  -webkit-tap-highlight-color:transparent;',
            '}',
            '.cn-popup.show { transform:translateY(0); opacity:1; }',
            '.cn-popup .cn-avatar {',
            '  width:38px; height:38px; border-radius:9px; flex:0 0 38px;',
            '  background:#f0f0f0; overflow:hidden;',
            '  display:flex; align-items:center; justify-content:center;',
            '  font-size:16px; font-weight:700; color:#666;',
            '}',
            '.cn-popup .cn-avatar img { width:100%; height:100%; object-fit:cover; }',
            '.cn-popup .cn-body { flex:1; min-width:0; }',
            '.cn-popup .cn-name {',
            '  font-size:13px; font-weight:600; color:#111;',
            '  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;',
            '}',
            '.cn-popup .cn-text {',
            '  font-size:12px; color:#888; margin-top:2px;',
            '  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;',
            '}',
            '.cn-popup .cn-tag {',
            '  flex:0 0 auto; font-size:10px; color:#aaa; margin-left:4px;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    var popupEl = null;
    var popupTimer = null;

    function dismissPopup() {
        if (!popupEl) return;
        popupEl.classList.remove('show');
        var el = popupEl;
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
        popupEl = null;
        if (popupTimer) { clearTimeout(popupTimer); popupTimer = null; }
    }

    function showPopup(contact, message) {
        ensurePopupStyles();
        dismissPopup();

        var host = document.querySelector('.phone-mockup') || document.body;
        popupEl = document.createElement('div');
        popupEl.className = 'cn-popup';

        var avSrc = safeImgSrc(contact.avatar);
        var avatarInner = avSrc
            ? '<img src="' + escapeHtml(avSrc) + '" alt="">'
            : escapeHtml(String(contact.name || '?').slice(0, 1));

        var preview = String(message.text || '').replace(/\s+/g, ' ').trim();
        if (message.type === 'image') preview = '[图片]';
        else if (message.type === 'gift') preview = '[礼物] ' + (message.gift && message.gift.name ? message.gift.name : '');
        else if (message.type === 'redpacket') preview = '[红包]';
        else if (message.type === 'transfer') preview = '[转账]';

        var dispName = contact.name;
        if (contact.isGroup && message.name) dispName = message.name + ' 在' + contact.name;

        popupEl.innerHTML =
            '<div class="cn-avatar">' + avatarInner + '</div>' +
            '<div class="cn-body">' +
              '<div class="cn-name">' + escapeHtml(dispName) + '</div>' +
              '<div class="cn-text">' + escapeHtml(preview) + '</div>' +
            '</div>' +
            '<div class="cn-tag">现在</div>';

        popupEl.addEventListener('click', function () {
            var id = encodeURIComponent(contact.id);
            dismissPopup();
            window.location.href = appBase + '/chat/chat/chat-detail.html?id=' + id;
        });

        host.appendChild(popupEl);
        // 下一帧再加 show，触发过渡
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (popupEl) popupEl.classList.add('show');
            });
        });
        popupTimer = setTimeout(dismissPopup, POPUP_DURATION_MS);
    }

    /* ---------- 轮询：刷角标 + 发现新未读就弹窗 ---------- */
    function tick() {
        var detailId = currentDetailRoleId();
        var contacts = buildContactIndex();
        var total = 0;
        var newest = null; // {contact, message, time}

        Object.keys(contacts).forEach(function (id) {
            var contact = contacts[id];
            var u = unreadOf(contact);
            if (u.count > 0) {
                total += u.count;
                // 不把自己正在看的会话算作"需要弹窗"的新消息
                if (id !== detailId && u.newest) {
                    var t = Number(u.newest.time) || 0;
                    if (!newest || t > newest.time) {
                        newest = { contact: contact, message: u.newest, time: t };
                    }
                }
            }
        });

        refreshBadge(total);

        // 决定是否弹窗：只对"本次页面生命周期内第一次见到的更新消息"弹一次。
        // 门槛放宽松：页面加载前 4 秒内落库的消息（典型就是刚退出聊天页时
        // pagehide 把流式半截消息存下来那一下）也弹；更早的历史未读不弹，避免一进页面就吓人一跳。
        var seen = 0;
        try { seen = Number(sessionStorage.getItem(POPUP_SEEN_KEY)) || 0; } catch (e) {}
        if (newest && newest.time > seen) {
            try { sessionStorage.setItem(POPUP_SEEN_KEY, String(newest.time)); } catch (e) {}
            if (newest.time > bootTs - 4000) {
                showPopup(newest.contact, newest.message);
            }
        }
    }

    var bootTs = Date.now();

    /* ---------- 启动 ---------- */
    ChatNotifier.start = function () {
        // 聊天详情页本身不需要轮询（它就是"正在看"的那个会话）
        if (currentDetailRoleId()) return;
        tick();
        setInterval(tick, POLL_MS);
        // 其它标签页/localStorage 变化时立刻响应
        global.addEventListener('storage', function (e) {
            if (e && e.key && e.key.indexOf('chat_history_') === 0) tick();
        });
    };

    global.ChatNotifier = ChatNotifier;

    // nav.js 动态注入时自动启动；chat-detail 直接引入时不启动轮询。
    if (!currentDetailRoleId()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ChatNotifier.start);
        } else {
            ChatNotifier.start();
        }
    }
})(window);
