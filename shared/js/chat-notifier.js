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
                    persona: c.persona || c.prompt || '',
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


    /* ---------- 自主联系：仅在 MAOMAO 前台打开时检查 ---------- */
    var PROACTIVE_CHECK_MS = 5 * 60 * 1000;
    var PROACTIVE_GLOBAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    var PROACTIVE_MIN_IDLE_MS = 8 * 60 * 60 * 1000;
    var PROACTIVE_LOCK_KEY = 'chat_proactive_request_lock';
    var FOLLOWUP_STATE_KEY = 'chat_followup_state_v1';
    var FOLLOWUP_LOCK_KEY = 'chat_followup_request_lock';
    var proactiveSchedulerStarted = false;
    var proactiveRequestPending = false;
    var followUpRequestPending = false;
    var proactiveDependenciesPromise = null;

    function proactiveAsset(path) {
        return appBase + (appBase.charAt(appBase.length - 1) === '/' ? '' : '/') + path;
    }

    function loadProactiveScript(src, ready) {
        if (ready()) return Promise.resolve(true);
        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = function () { resolve(!!ready()); };
            script.onerror = function () { resolve(false); };
            document.head.appendChild(script);
        });
    }

    function ensureProactiveDependencies() {
        if (global.PhoneStorage && global.PhoneAPI && typeof global.PhoneAPI.completeJSON === 'function' &&
            global.ChatPresencePolicy && typeof global.ChatPresencePolicy.evaluateProactiveContact === 'function' &&
            global.ChatFollowupPolicy && typeof global.ChatFollowupPolicy.shouldBlockFollowUp === 'function') {
            return Promise.resolve(true);
        }
        if (proactiveDependenciesPromise) return proactiveDependenciesPromise;
        proactiveDependenciesPromise = loadProactiveScript(
            proactiveAsset('shared/js/phone/phone_storage.js'),
            function () { return !!global.PhoneStorage; }
        ).then(function (ok) {
            if (!ok) return false;
            return loadProactiveScript(
                proactiveAsset('shared/js/phone/phone_api.js'),
                function () { return !!global.PhoneAPI && typeof global.PhoneAPI.completeJSON === 'function'; }
            );
        }).then(function (ok) {
            if (!ok) return false;
            return loadProactiveScript(
                proactiveAsset('shared/js/phone/chat-presence-policy.js?v=20261102v17'),
                function () { return !!global.ChatPresencePolicy && typeof global.ChatPresencePolicy.evaluateProactiveContact === 'function'; }
            );
        }).then(function (ok) {
            if (!ok) return false;
            return loadProactiveScript(
                proactiveAsset('shared/js/phone/chat-followup-policy.js?v=20261102v1'),
                function () { return !!global.ChatFollowupPolicy && typeof global.ChatFollowupPolicy.shouldBlockFollowUp === 'function'; }
            );
        }).then(function (ok) {
            if (!ok) proactiveDependenciesPromise = null;
            return ok;
        }).catch(function () {
            proactiveDependenciesPromise = null;
            return false;
        });
        return proactiveDependenciesPromise;
    }

    function proactiveIntervalHours(roleId) {
        var value = parseInt(safeGet('chat_proactive_interval_' + roleId), 10);
        return [24, 48, 72].indexOf(value) !== -1 ? value : 24;
    }

    function getBlockedIds() {
        var ids = safeJsonParse(safeGet('chat_blocked_ids'));
        return Array.isArray(ids) ? ids.map(String) : [];
    }

    function newestMeaningfulMessage(history) {
        for (var i = history.length - 1; i >= 0; i--) {
            var item = history[i];
            if (!item || item.silent || item.isError || item.role === 'system_error') continue;
            if (item.type && item.type !== 'text') continue;
            if (item.mode === 'date' || item.mode === 'narration' || item.mode === 'offline' ||
                item.voiceMode === 'date' || item.voiceMode === 'narration' || item.voiceMode === 'offline') continue;
            if (item.role !== 'user' && item.role !== 'sent' &&
                item.role !== 'assistant' && item.role !== 'received') continue;
            var text = String(item.text || item.content || '').trim();
            if (text.length < 2) continue;
            return { time: Number(item.time || item.timestamp) || 0, text: text, role: item.role };
        }
        return null;
    }

    function chooseProactiveCandidate(now) {
        var globalAttemptAt = Number(safeGet('chat_proactive_global_attempt_at')) || 0;
        if (globalAttemptAt && now - globalAttemptAt >= 0 &&
            now - globalAttemptAt < PROACTIVE_GLOBAL_COOLDOWN_MS) return null;

        var blocked = getBlockedIds();
        var contacts = buildContactIndex();
        var candidates = [];
        Object.keys(contacts).forEach(function (id) {
            var contact = contacts[id];
            if (!contact || contact.isGroup || safeGet('chat_proactive_contact_' + id) !== 'true') return;
            if (blocked.indexOf(String(id)) !== -1) return;

            var history = readHistory(id);
            var intervalMs = proactiveIntervalHours(id) * 60 * 60 * 1000;
            var roleAttemptAt = Number(safeGet('chat_proactive_last_attempt_' + id)) || 0;
            var evaluation = global.ChatPresencePolicy.evaluateProactiveContact(history, {
                enabled: true,
                blocked: false,
                pageVisible: true,
                now: now,
                minIdleMs: PROACTIVE_MIN_IDLE_MS,
                maxInactiveMs: 30 * 24 * 60 * 60 * 1000,
                globalCooldownMs: PROACTIVE_GLOBAL_COOLDOWN_MS,
                roleCooldownMs: intervalMs,
                globalLastAttemptAt: globalAttemptAt,
                roleLastAttemptAt: roleAttemptAt,
                quietStartHour: 9,
                quietEndHour: 22
            });
            if (!evaluation.eligible) return;
            var latest = newestMeaningfulMessage(history);
            if (!latest || latest.time !== evaluation.lastMessageAt) return;
            candidates.push({
                contact: contact,
                history: history,
                evaluation: evaluation,
                latest: latest,
                lastUserMessageAt: evaluation.lastUserMessageAt
            });
        });

        candidates.sort(function (a, b) {
            return b.lastUserMessageAt - a.lastUserMessageAt;
        });
        return candidates[0] || null;
    }

    function historyForProactivePrompt(history) {
        var result = [];
        (Array.isArray(history) ? history : []).slice(-14).forEach(function (item) {
            if (!item || item.silent || item.isError || item.role === 'system_error') return;
            if (item.type && item.type !== 'text') return;
            if (item.role !== 'user' && item.role !== 'sent' &&
                item.role !== 'assistant' && item.role !== 'received') return;
            var content = String(item.text || item.content || '')
                .replace(/<(think|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
                .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, ' ')
                .replace(/\[中译[:：][^\]]{0,800}\]/g, ' ')
                .replace(/\[(?:记住|心声|红包|转账|图片|亲属卡|亲密付|调整亲属卡|撤销亲属卡|发起语音通话|群关系互动|群关系变化|群私聊|群动作|群投票|群接龙)[^\]]*\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (content.length < 2) return;
            result.push({
                role: item.role === 'user' || item.role === 'sent' ? 'user' : 'assistant',
                content: content.slice(0, 700)
            });
        });
        return result;
    }

    function cleanProactiveMessage(value) {
        var text = String(value == null ? '' : value)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\[(?:红包|转账|图片|亲属卡|亲密付|心声|记住|发起语音通话|群动作|群投票|群接龙|群私聊)[^\]]*\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length < 2 || text.length > 220) return '';
        if (/\[[^\]]{1,100}\]/.test(text) || /https?:\/\//i.test(text)) return '';
        return text;
    }

    async function checkProactiveContacts() {
        if (proactiveRequestPending || document.visibilityState === 'hidden' || currentDetailRoleId()) return;
        var now = Date.now();
        var lockAt = Number(safeGet(PROACTIVE_LOCK_KEY)) || 0;
        if (lockAt && now - lockAt >= 0 && now - lockAt < 20 * 60 * 1000) return;
        if (safeGet(PROACTIVE_LOCK_KEY)) safeSet(PROACTIVE_LOCK_KEY, '');
        if (!Object.keys(buildContactIndex()).some(function (id) {
            return safeGet('chat_proactive_contact_' + id) === 'true';
        })) return;

        var globalAttemptAt = Number(safeGet('chat_proactive_global_attempt_at')) || 0;
        if (globalAttemptAt && now - globalAttemptAt >= 0 &&
            now - globalAttemptAt < PROACTIVE_GLOBAL_COOLDOWN_MS) return;

        var ready = await ensureProactiveDependencies();
        if (!ready || !global.ChatPresencePolicy ||
            typeof global.ChatPresencePolicy.evaluateProactiveContact !== 'function' ||
            typeof global.ChatPresencePolicy.buildProactiveContactPrompt !== 'function' ||
            !global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') return;

        var currentLockAt = Number(safeGet(PROACTIVE_LOCK_KEY)) || 0;
        if (currentLockAt && Date.now() - currentLockAt >= 0 &&
            Date.now() - currentLockAt < 20 * 60 * 1000) return;
        var candidate = chooseProactiveCandidate(Date.now());
        if (!candidate) return;
        var config = global.PhoneStorage && global.PhoneStorage.getApiConfig
            ? global.PhoneStorage.getApiConfig() : {};
        if (!config || !String(config.apiKey || '').trim()) return;

        proactiveRequestPending = true;
        var requestAt = Date.now();
        safeSet(PROACTIVE_LOCK_KEY, String(requestAt));
        safeSet('chat_proactive_global_attempt_at', String(requestAt));
        safeSet('chat_proactive_last_attempt_' + candidate.contact.id, String(requestAt));

        try {
            var voiceProfile = null;
            try {
                var voiceKey = 'chat_voice_habits_v1_' +
                    encodeURIComponent(String(candidate.contact.id)) + '_direct';
                voiceProfile = safeJsonParse(safeGet(voiceKey));
            } catch (e) {}

            var currentTime = new Date();
            var localTime = currentTime.getFullYear() + '-' +
                String(currentTime.getMonth() + 1).padStart(2, '0') + '-' +
                String(currentTime.getDate()).padStart(2, '0') + ' ' +
                String(currentTime.getHours()).padStart(2, '0') + ':' +
                String(currentTime.getMinutes()).padStart(2, '0');

            var system = global.ChatPresencePolicy.buildProactiveContactPrompt(
                candidate.contact,
                candidate.history,
                { localTime: localTime, voiceProfile: voiceProfile }
            );
            var messages = [{ role: 'system', content: system }];
            messages.push.apply(messages, historyForProactivePrompt(candidate.history));
            messages.push({
                role: 'user',
                content: '请判断现在是否真的有值得主动分享的一件事。若没有，请明确返回 send=false。只按系统要求输出 JSON。'
            });

            var result = await global.PhoneAPI.completeJSON({
                messages: messages,
                temperature: 0.78,
                timeoutMs: 15000
            });
            if (!result || result.ok !== true || !result.data || result.data.send !== true) return;

            var content = cleanProactiveMessage(result.data.text);
            if (!content || safeGet('chat_proactive_contact_' + candidate.contact.id) !== 'true') return;
            if (document.visibilityState === 'hidden') return;

            // 请求期间若用户又发了消息，放弃这条过时的主动联系。
            var freshHistory = readHistory(candidate.contact.id);
            var freshLatest = newestMeaningfulMessage(freshHistory);
            if (!freshLatest || freshLatest.time !== candidate.latest.time ||
                freshLatest.text !== candidate.latest.text) return;

            var newMessage = {
                role: 'assistant',
                text: content,
                time: Date.now(),
                voiceMode: 'online',
                proactiveContact: true
            };
            freshHistory.push(newMessage);
            var saved = global.PhoneStorage && typeof global.PhoneStorage.saveChatHistory === 'function'
                ? global.PhoneStorage.saveChatHistory(candidate.contact.id, freshHistory)
                : safeSet('chat_history_' + candidate.contact.id, freshHistory);
            if (!saved) return;
            tick();
        } catch (error) {
            // 自动联系失败不打断当前页面；本次尝试已有冷却记录，避免重复消耗 API。
            try { console.warn('[ChatNotifier] proactive contact skipped:', error && error.message ? error.message : error); } catch (e) {}
        } finally {
            proactiveRequestPending = false;
            safeSet(PROACTIVE_LOCK_KEY, '');
        }
    }

    /* ---------- 主动追问节奏：持久化时间戳比对，不依赖 setTimeout 主线 ---------- */

    function readFollowUpStates() {
        return safeJsonParse(safeGet(FOLLOWUP_STATE_KEY)) || {};
    }

    function writeFollowUpStates(obj) {
        try { localStorage.setItem(FOLLOWUP_STATE_KEY, JSON.stringify(obj)); return true; }
        catch (e) { return false; }
    }

    function getFollowUpState(chatId) {
        var all = readFollowUpStates();
        var raw = all[String(chatId)];
        return global.ChatFollowupPolicy
            ? global.ChatFollowupPolicy.normalizeState(raw)
            : (raw || null);
    }

    function setFollowUpState(chatId, state) {
        var all = readFollowUpStates();
        all[String(chatId)] = state;
        writeFollowUpStates(all);
    }

    // 多标签页互斥：Web Locks API 优先，不支持时退回 localStorage 锁
    // 降级风险：localStorage 锁在某些浏览器的隐私模式下可能不生效；锁过期时间设为 2 分钟
    function acquireFollowUpLock(chatId) {
        var lockKey = FOLLOWUP_LOCK_KEY + '_' + String(chatId);
        if (global.navigator && navigator.locks && typeof navigator.locks.request === 'function') {
            // Web Locks API：返回一个 Promise，持锁直到释放
            return navigator.locks.request(lockKey, { mode: 'exclusive' }, function () {
                // 在锁内执行，返回一个 release 函数标记持锁结束
                return function webLockReleased() {};
            }).then(function (release) {
                return { ok: true, release: release };
            }).catch(function () {
                // 拿不到锁 → 视为被其它标签页持有
                return { ok: false, release: null };
            });
        }
        // 降级：localStorage 锁（2 分钟过期）
        return new Promise(function (resolve) {
            var now = Date.now();
            var existing = Number(safeGet(lockKey)) || 0;
            if (existing && now - existing >= 0 && now - existing < 2 * 60 * 1000) {
                resolve({ ok: false, release: null });
                return;
            }
            safeSet(lockKey, String(now));
            resolve({
                ok: true,
                release: function () { safeSet(lockKey, ''); }
            });
        });
    }

    function chooseFollowUpCandidate(now) {
        var blocked = getBlockedIds();
        var contacts = buildContactIndex();
        var candidates = [];
        Object.keys(contacts).forEach(function (id) {
            var contact = contacts[id];
            if (!contact || contact.isGroup) return;
            if (blocked.indexOf(String(id)) !== -1) return;

            var state = getFollowUpState(id);
            if (!state || !state.nextFollowUpAt || Number(state.nextFollowUpAt) > now) return;

            var history = readHistory(id);
            var latest = newestMeaningfulMessage(history);
            if (!latest) return;

            // 刚发过追问的会话不计入
            if (latest.proactiveContact || latest.followUp) return;

            var blockedResult = global.ChatFollowupPolicy.shouldBlockFollowUp(state, now, {
                lastMessageAt: latest.time,
                hasUserRepliedRecently: global.ChatFollowupPolicy.hasUserRepliedInWindow
                    ? global.ChatFollowupPolicy.hasUserRepliedInWindow(history, now, 10 * 60 * 1000)
                    : false
            });
            if (blockedResult.blocked) return;

            candidates.push({
                contact: contact,
                history: history,
                state: state,
                latest: latest,
                nextFollowUpAt: Number(state.nextFollowUpAt) || 0
            });
        });

        // nextFollowUpAt 最早的优先（最急需追问的）
        candidates.sort(function (a, b) {
            return a.nextFollowUpAt - b.nextFollowUpAt;
        });
        return candidates[0] || null;
    }

    async function checkFollowUps() {
        if (followUpRequestPending || document.visibilityState === 'hidden' || currentDetailRoleId()) return;

        var ready = await ensureProactiveDependencies();
        if (!ready || !global.ChatFollowupPolicy ||
            typeof global.ChatFollowupPolicy.shouldBlockFollowUp !== 'function' ||
            typeof global.PhoneAPI !== 'undefined' && typeof global.PhoneAPI.completeJSON !== 'function') {
            // PhoneAPI 未加载时也不阻塞——依赖可能还在加载
            if (!global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') return;
        }

        var now = Date.now();
        var candidate = chooseFollowUpCandidate(now);
        if (!candidate) return;
        var config = global.PhoneStorage && global.PhoneStorage.getApiConfig
            ? global.PhoneStorage.getApiConfig() : {};
        if (!config || !String(config.apiKey || '').trim()) return;

        // 获取多标签页互斥锁
        var lockHandle = null;
        try {
            var lockResult = await acquireFollowUpLock(candidate.contact.id);
            if (!lockResult.ok) return;
            lockHandle = lockResult;
        } catch (e) {
            return;
        }

        followUpRequestPending = true;

        try {
            // 锁内二次检查（状态可能已被其它标签页更新）
            var freshState = getFollowUpState(candidate.contact.id);
            if (!freshState || Number(freshState.nextFollowUpAt) > Date.now()) return;

            var tone = candidate.state.followUpRound >= 2 ? 'farewell'
                : (candidate.state.followUpRound === 1 ? 'slight' : 'curious');
            var template = global.ChatFollowupPolicy.pickTemplate(
                candidate.state.followUpRound || 0,
                candidate.state.lastTopic,
                tone
            );

            if (!template || !template.text) return;

            // 构造追问 prompt：轻量模式——只要求一条追问消息
            var prompt = [
                '【主动追问模式】',
                '你是「' + String(candidate.contact.name || '角色').trim() + '」。',
                '上一轮对话已经结束（最后一条是你的消息，对方没回）。现在是考虑是否值得再主动追一句。',
                '语气要求：' + (template.tone === 'curious' ? '自然好奇，可以用问句'
                    : template.tone === 'slight' ? '带点小在意的陈述，不要施压'
                    : '告别收手，不要用问句，自然收尾即可'),
                '长度：一句话，不超过 40 字。',
                '禁止制造愧疚、催促、制造压力。如果真的没什么可说的，返回 send=false。',
                '输出 JSON：{"send":true,"text":"一句话"} 或 {"send":false,"text":""}。'
            ].join('\n');

            var messages = [{ role: 'system', content: prompt }];
            messages.push.apply(messages, historyForProactivePrompt(candidate.history));
            messages.push({
                role: 'user',
                content: '这是上次对话的历史。如果你觉得值得追一句就回复 send=true；否则 send=false。'
            });

            var result = await global.PhoneAPI.completeJSON({
                messages: messages,
                temperature: 0.72,
                timeoutMs: 15000
            });

            if (!result || result.ok !== true || !result.data || result.data.send !== true) {
                // AI 说不值得发 → 推进轮次但设下一个时间点
                var skipState = global.ChatFollowupPolicy.normalizeState(candidate.state);
                var nextDelay = global.ChatFollowupPolicy.computeDelayMinutes(
                    Math.min(skipState.followUpRound + 1, global.ChatFollowupPolicy.CONSTANTS.MAX_ROUNDS - 1),
                    1.0 // relationshipMultiplier 固定 1.0，当前无关系等级字段
                );
                skipState.followUpRound = Math.min(skipState.followUpRound + 1,
                    global.ChatFollowupPolicy.CONSTANTS.MAX_ROUNDS - 1);
                skipState.nextFollowUpAt = Date.now() + nextDelay * 60 * 1000;
                setFollowUpState(candidate.contact.id, skipState);
                return;
            }

            var content = cleanProactiveMessage(result.data.text);
            if (!content) return;
            if (document.visibilityState === 'hidden') return;

            // 请求期间用户若已回复，放弃
            var freshHistory = readHistory(candidate.contact.id);
            var replyNow = global.ChatFollowupPolicy.hasUserRepliedInWindow
                ? global.ChatFollowupPolicy.hasUserRepliedInWindow(freshHistory, Date.now(), 10 * 60 * 1000)
                : false;
            if (replyNow) {
                var clearedState = global.ChatFollowupPolicy.applyUserReply(candidate.state, Date.now());
                setFollowUpState(candidate.contact.id, clearedState);
                return;
            }

            // 同话题重复检测：即将发出的模板与 history 里最近一条 assistant 消息高度相似
            // 只看"去掉标点后完全相同"的情况，避免误伤
            var lastAssistantMsg = null;
            for (var k = freshHistory.length - 1; k >= 0; k--) {
                var _hm = freshHistory[k];
                if (_hm && !_hm.silent && !_hm.isError &&
                    (_hm.role === 'assistant' || _hm.role === 'received') &&
                    (!_hm.type || _hm.type === 'text')) {
                    lastAssistantMsg = _hm;
                    break;
                }
            }
            if (lastAssistantMsg) {
                var _strippedNow = String(content).replace(/[\s\p{P}]/gu, '').toLowerCase();
                var _strippedLast = String(lastAssistantMsg.text || lastAssistantMsg.content || '')
                    .replace(/[\s\p{P}]/gu, '').toLowerCase();
                // 8 字以上才做同话题检测，避免短词误伤
                if (_strippedNow.length >= 8 && _strippedNow === _strippedLast) {
                    var _sameTopicState = global.ChatFollowupPolicy.applySameTopicCooldown(candidate.state, Date.now());
                    setFollowUpState(candidate.contact.id, _sameTopicState);
                    return;
                }
            }

            var newMessage = {
                role: 'assistant',
                text: content,
                time: Date.now(),
                voiceMode: 'online',
                proactiveContact: true,  // 复用现有标记（追问本质上也是主动发起的消息）
                followUp: true,          // 额外标记：这条是追问节奏里的
                followUpRound: (candidate.state.followUpRound || 0)
            };
            freshHistory.push(newMessage);
            var saved = global.PhoneStorage && typeof global.PhoneStorage.saveChatHistory === 'function'
                ? global.PhoneStorage.saveChatHistory(candidate.contact.id, freshHistory)
                : safeSet('chat_history_' + candidate.contact.id, freshHistory);
            if (!saved) return;

            // 轮次推进：调 applyIgnore 算下一轮 nextFollowUpAt（或达上限后自动设冷却）
            var newState = global.ChatFollowupPolicy.applyIgnore(candidate.state, Date.now());
            newState.lastTopic = template.text;
            setFollowUpState(candidate.contact.id, newState);

            tick();
        } catch (error) {
            try { console.warn('[ChatNotifier] follow-up skipped:', error && error.message ? error.message : error); } catch (e) {}
        } finally {
            followUpRequestPending = false;
            if (lockHandle && typeof lockHandle.release === 'function') {
                try { lockHandle.release(); } catch (e) {}
            }
        }
    }

    function startProactiveScheduler() {
        if (proactiveSchedulerStarted) return;
        proactiveSchedulerStarted = true;
        checkProactiveContacts();
        checkFollowUps();
        setInterval(function () {
            checkProactiveContacts();
            checkFollowUps();
        }, PROACTIVE_CHECK_MS);
        global.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                checkProactiveContacts();
                checkFollowUps();
            }
        });
        global.addEventListener('storage', function (event) {
            if (event && event.key && event.key.indexOf('chat_proactive_contact_') === 0 &&
                event.newValue === 'true') {
                checkProactiveContacts();
                checkFollowUps();
            }
            // chat_followup_state_v1 被别的标签页更新时，本页立刻重新扫描
            if (event && event.key === FOLLOWUP_STATE_KEY) checkFollowUps();
        });
    }

    var bootTs = Date.now();

    /* ---------- 启动 ---------- */
    ChatNotifier.start = function () {
        // 聊天详情页本身不需要轮询（它就是"正在看"的那个会话）
        if (currentDetailRoleId()) return;
        tick();
        setInterval(tick, POLL_MS);
        startProactiveScheduler();
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
