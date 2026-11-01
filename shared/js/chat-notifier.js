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
                    relationship: c.relationship || c.relationshipType || c.relationshipStage || 'friend',
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
    var proactiveSchedulerStarted = false;
    var proactiveRequestPending = false;
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
            global.ChatPresencePolicy && typeof global.ChatPresencePolicy.evaluateProactiveContact === 'function') {
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
            if (!ok) proactiveDependenciesPromise = null;
            return ok;
        }).catch(function () {
            proactiveDependenciesPromise = null;
            return false;
        });
        return proactiveDependenciesPromise;
    }

    function ensureFollowUpDependencies() {
        return ensureProactiveDependencies().then(function (ok) {
            if (!ok) return false;
            if (global.ChatFollowUpPolicy && typeof global.ChatFollowUpPolicy.calculateDelay === 'function') return true;
            return loadProactiveScript(
                proactiveAsset('shared/js/phone/chat-followup-policy.js?v=20261102v1'),
                function () { return !!global.ChatFollowUpPolicy && typeof global.ChatFollowUpPolicy.calculateDelay === 'function'; }
            );
        });
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
        if (proactiveRequestPending || followUpRequestPending || document.visibilityState === 'hidden' || currentDetailRoleId()) return;
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


    /* ---------- 独立追问调度：私聊与群聊分别保存状态 ---------- */
    var FOLLOW_UP_LOCK_KEY = 'chat_followup_request_lock';
    var followUpRequestPending = false;
    var followUpSchedulerStarted = false;

    function followUpStateKey(scope, id) {
        return 'chat_followup_state_' + scope + '_' + String(id);
    }
    function readFollowUpState(scope, id) {
        var value = safeJsonParse(safeGet(followUpStateKey(scope, id)));
        return value && typeof value === 'object' ? value : {
            followUpCount: 0,
            ignoredCount: 0,
            userReceptivityScore: 0.7,
            dueAt: 0,
            anchorMessageAt: 0,
            lastFollowUpAt: 0,
            lastFollowUpTopic: '',
            cooldownUntil: 0,
            pausedByUser: false
        };
    }
    function saveFollowUpState(scope, id, state) {
        safeSet(followUpStateKey(scope, id), state);
    }
    function followUpMessages(history) {
        return (Array.isArray(history) ? history : []).filter(function (item) {
            if (!item || item.silent || item.isError || item.role === 'system_error') return false;
            if (item.role !== 'user' && item.role !== 'sent' && item.role !== 'assistant' && item.role !== 'received') return false;
            if (!(Number(item.time || item.timestamp) > 0)) return false;
            var isUserMessage = item.role === 'user' || item.role === 'sent';
            var text = String(item.text || item.content || '').trim();
            // Any real user reply, including a one-character reply or an attachment,
            // cancels the pending chain. Internal silent turns remain excluded above.
            if (isUserMessage) return text.length >= 1 || !!item.type || !!item.image || !!item.voice;
            if (item.type && item.type !== 'text') return false;
            if (item.mode === 'date' || item.mode === 'narration' || item.mode === 'offline' ||
                item.voiceMode === 'date' || item.voiceMode === 'narration' || item.voiceMode === 'offline') return false;
            return text.length >= 2;
        });
    }
    function followUpHistoryContext(history, isGroup) {
        return followUpMessages(history).slice(-8).map(function (item) {
            var role = item.role === 'user' || item.role === 'sent' ? '用户' :
                (isGroup && item.name ? String(item.name).slice(0, 24) : '角色');
            var text = String(item.text || item.content || '')
                .replace(/<(think|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
                .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, ' ')
                .replace(/\[(?:记住|心声|红包|转账|图片|亲属卡|亲密付|发起语音通话|群关系互动|群关系变化|群动作|群投票|群接龙|群私聊)[^\]]*\]/g, ' ')
                .replace(/\s+/g, ' ').trim();
            if (!text && item.type) text = item.type === 'image' ? '[图片]' : item.type === 'audio' ? '[语音]' : '[附件]';
            text = text.slice(0, 360);
            return role + '：' + text;
        }).join('\n');
    }
    function followUpRoleForGroup(group, lastAssistant) {
        var memberId = String(lastAssistant && lastAssistant.memberId || '');
        if (!memberId || !group || !Array.isArray(group.members)) return null;
        var member = group.members.find(function (item) { return item && String(item.id) === memberId; });
        if (!member) return null;
        var characters = readCharacters();
        var character = characters.find(function (item) { return item && String(item.id) === memberId; });
        return {
            id: memberId,
            name: member.groupName || member.nickname || member.name || (character && character.name) || lastAssistant.name || '群成员',
            persona: character && (character.persona || character.prompt || character.description) || '',
            relationship: '群友'
        };
    }
    function getFollowUpCandidate(scope, contact, history, now) {
        var messages = followUpMessages(history);
        if (messages.length < 2) return null;
        var last = messages[messages.length - 1];
        var lastUser = null;
        var lastAssistant = null;
        for (var i = messages.length - 1; i >= 0; i--) {
            if (!lastUser && (messages[i].role === 'user' || messages[i].role === 'sent')) lastUser = messages[i];
            if (!lastAssistant && (messages[i].role === 'assistant' || messages[i].role === 'received')) lastAssistant = messages[i];
            if (lastUser && lastAssistant) break;
        }
        if (!lastUser || !lastAssistant) return null;
        var state = readFollowUpState(scope, contact.id);
        var policy = global.ChatFollowUpPolicy;
        var userTime = Number(lastUser.time || lastUser.timestamp) || 0;
        var assistantTime = Number(lastAssistant.time || lastAssistant.timestamp) || 0;

        if (userTime > Number(state.lastUserMessageAt || 0)) {
            var isReplyToPendingChain = !!state.anchorMessageAt && userTime > Number(state.anchorMessageAt);
            var intent = policy.applyUserIntent(state, lastUser.text || lastUser.content, now);
            if (intent.intent === 'normal' && isReplyToPendingChain) policy.noteUserReply(state);
            state.lastUserMessageAt = userTime;
            saveFollowUpState(scope, contact.id, state);
        }
        if (last.role !== 'assistant' && last.role !== 'received') {
            state.dueAt = 0;
            saveFollowUpState(scope, contact.id, state);
            return null;
        }
        if (userTime > assistantTime) return null;
        // Do not resurrect a stale conversation when the app or feature was off for days.
        if (now - assistantTime > 12 * 60 * 60 * 1000) {
            state.dueAt = 0;
            state.lastObservedAssistantAt = assistantTime;
            saveFollowUpState(scope, contact.id, state);
            return null;
        }
        if (!state.anchorMessageAt || assistantTime > Number(state.lastObservedAssistantAt || 0)) {
            var isFollowUpMessage = lastAssistant.proactiveFollowUp === true;
            var messageRound = Math.max(0, Number(lastAssistant.followUpRound) || 0);
            if (!isFollowUpMessage) {
                var newChain = assistantTime !== Number(state.anchorMessageAt);
                if (newChain) {
                    state.anchorMessageAt = assistantTime;
                    state.followUpCount = 0;
                    state.topicKey = policy.normalizeTopic(lastUser.text || lastAssistant.text || '');
                    var sameTopic = state.lastFollowUpTopic && state.lastFollowUpTopic === state.topicKey &&
                        now - Number(state.lastFollowUpAt || 0) < 12 * 60 * 60 * 1000;
                    if (sameTopic) {
                        state.dueAt = 0;
                        state.lastObservedAssistantAt = assistantTime;
                        saveFollowUpState(scope, contact.id, state);
                        return null;
                    }
                    var firstDelay = policy.calculateDelay(1, contact.relationship || 'friend', Math.random(), state.userReceptivityScore);
                    state.dueAt = assistantTime + firstDelay * 60 * 1000;
                    state.nextRound = 1;
                }
            } else if (messageRound > 0) {
                state.followUpCount = messageRound;
                state.lastObservedAssistantAt = assistantTime;
                if (messageRound >= 3) {
                    state.cooldownUntil = now + 24 * 60 * 60 * 1000;
                    state.dueAt = 0;
                    state.ignoredCount = 0;
                } else {
                    var nextRound = messageRound + 1;
                    state.nextRound = nextRound;
                    state.dueAt = assistantTime + policy.calculateDelay(nextRound, contact.relationship || 'friend', Math.random(), state.userReceptivityScore) * 60 * 1000;
                }
            }
            state.lastObservedAssistantAt = assistantTime;
            saveFollowUpState(scope, contact.id, state);
        }
        var blocked = policy.shouldBlock(state, now);
        if (blocked.blocked) {
            state.dueAt = 0;
            saveFollowUpState(scope, contact.id, state);
            return null;
        }
        if (!state.dueAt || Number(state.dueAt) > now) return null;
        if (now - assistantTime < 15 * 60 * 1000) return null;
        if (policy.isQuietTime(now)) {
            state.dueAt = policy.nextAllowedTime(now);
            saveFollowUpState(scope, contact.id, state);
            return null;
        }
        return {
            scope: scope,
            contact: contact,
            history: history,
            state: state,
            lastAssistantAt: assistantTime,
            lastUserAt: userTime,
            round: Math.max(1, Math.min(3, Number(state.nextRound) || 1)),
            topic: state.topicKey || policy.normalizeTopic(lastUser.text || ''),
            lastAssistant: lastAssistant,
            lastUser: lastUser
        };
    }
    function saveFollowUpHistory(id, history) {
        if (global.PhoneStorage && typeof global.PhoneStorage.saveChatHistory === 'function') {
            return !!global.PhoneStorage.saveChatHistory(id, history);
        }
        return safeSet('chat_history_' + id, history);
    }
    function followUpContactList() {
        var contacts = buildContactIndex();
        var result = [];
        Object.keys(contacts).forEach(function (id) {
            var contact = contacts[id];
            if (!contact) return;
            if (contact.isGroup) {
                var group = readGroups().find(function (item) { return item && String(item.id) === String(id); });
                if (!group || !group.settings || group.settings.followUpEnabled !== true || group.settings.chatMode === 'offline') return;
                contact.group = group;
                contact.relationship = 'friend';
                result.push({ scope: 'group', contact: contact });
            } else if (safeGet('chat_followup_enabled_' + id) === 'true') {
                result.push({ scope: 'private', contact: contact });
            }
        });
        return result;
    }
    async function runFollowUpCandidate(candidate) {
        var scope = candidate.scope;
        var contact = candidate.contact;
        var role = scope === 'group' ? followUpRoleForGroup(contact.group, candidate.lastAssistant) : {
            id: contact.id, name: contact.name, persona: contact.persona || '', relationship: contact.relationship || '朋友'
        };
        if (!role) {
            var missingRoleState = readFollowUpState(scope, contact.id);
            missingRoleState.dueAt = 0;
            saveFollowUpState(scope, contact.id, missingRoleState);
            return;
        }
        var config = global.PhoneStorage && global.PhoneStorage.getApiConfig ? global.PhoneStorage.getApiConfig() : {};
        if (!config || !String(config.apiKey || '').trim()) {
            var noKeyState = readFollowUpState(scope, contact.id);
            noKeyState.dueAt = Date.now() + 30 * 60 * 1000;
            saveFollowUpState(scope, contact.id, noKeyState);
            return;
        }
        var prompt = global.ChatFollowUpPolicy.buildPrompt({
            name: role.name,
            persona: role.persona,
            relationship: role.relationship,
            round: candidate.round,
            context: followUpHistoryContext(candidate.history, scope === 'group')
        });
        var messages = [{ role: 'system', content: prompt }];
        messages.push({
            role: 'user',
            content: '请根据上面的对话生成这一次追问。不要解释，只返回 JSON。'
        });
        var result = await global.PhoneAPI.completeJSON({
            messages: messages,
            temperature: 0.72,
            timeoutMs: 15000
        });
        if (!result || result.ok !== true || !result.data) {
            var retryState = readFollowUpState(scope, contact.id);
            retryState.dueAt = Date.now() + 30 * 60 * 1000;
            saveFollowUpState(scope, contact.id, retryState);
            return;
        }
        if (result.data.send !== true) {
            var skipped = readFollowUpState(scope, contact.id);
            skipped.dueAt = 0;
            saveFollowUpState(scope, contact.id, skipped);
            return;
        }
        var content = String(result.data.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (content.length < 2 || Array.from(content).length > 20 || /\[[^\]]{1,100}\]/.test(content) || /https?:\/\//i.test(content)) {
            var invalidState = readFollowUpState(scope, contact.id);
            invalidState.dueAt = 0;
            saveFollowUpState(scope, contact.id, invalidState);
            return;
        }

        if (scope === 'private' && safeGet('chat_followup_enabled_' + contact.id) !== 'true') return;
        if (scope === 'group') {
            var currentGroup = readGroups().find(function (item) { return item && String(item.id) === String(contact.id); });
            if (!currentGroup || !currentGroup.settings || currentGroup.settings.followUpEnabled !== true) return;
        }
        var freshHistory = readHistory(contact.id);
        var freshMessages = followUpMessages(freshHistory);
        var freshLast = freshMessages[freshMessages.length - 1];
        if (!freshLast || Number(freshLast.time || freshLast.timestamp) !== candidate.lastAssistantAt ||
            freshLast.proactiveFollowUp === true) return;
        var freshUser = null;
        for (var i = freshMessages.length - 1; i >= 0; i--) {
            if (freshMessages[i].role === 'user' || freshMessages[i].role === 'sent') { freshUser = freshMessages[i]; break; }
        }
        if (!freshUser || Number(freshUser.time || freshUser.timestamp) !== candidate.lastUserAt) return;
        if (global.document.visibilityState === 'hidden') return;

        var now = Date.now();
        var newMessage = {
            role: 'assistant',
            text: content,
            time: now,
            voiceMode: 'online',
            name: scope === 'group' ? role.name : undefined,
            memberId: scope === 'group' ? role.id : undefined,
            proactiveFollowUp: true,
            followUpRound: candidate.round,
            followUpTopic: candidate.topic
        };
        freshHistory.push(newMessage);
        if (!saveFollowUpHistory(contact.id, freshHistory)) return;
        try {
            if (typeof global.CustomEvent === 'function') {
                global.dispatchEvent(new global.CustomEvent('maomao:followup-message', {
                    detail: { contactId: String(contact.id), message: newMessage, scope: scope }
                }));
            }
        } catch (eventError) {}
        var state = readFollowUpState(scope, contact.id);
        global.ChatFollowUpPolicy.noteFollowUpSent(state, candidate.round, now, candidate.topic);
        state.lastObservedAssistantAt = candidate.lastAssistantAt;
        state.anchorMessageAt = candidate.state.anchorMessageAt;
        state.nextRound = candidate.round >= 3 ? 0 : candidate.round + 1;
        state.dueAt = 0;
        if (candidate.round >= 3) {
            state.cooldownUntil = now + 24 * 60 * 60 * 1000;
            state.ignoredCount = 0;
        }
        saveFollowUpState(scope, contact.id, state);
        tick();
    }
    async function checkFollowUpTasks() {
        if (followUpRequestPending || proactiveRequestPending || document.visibilityState === 'hidden') return;
        var now = Date.now();
        var lockAt = Number(safeGet(FOLLOW_UP_LOCK_KEY)) || 0;
        if (lockAt && now - lockAt >= 0 && now - lockAt < 2 * 60 * 1000) return;
        var enabled = followUpContactList();
        if (!enabled.length) return;
        var ready = await ensureFollowUpDependencies();
        if (!ready || !global.ChatFollowUpPolicy || !global.PhoneAPI ||
            typeof global.PhoneAPI.completeJSON !== 'function') return;
        if (document.visibilityState === 'hidden') return;
        var candidates = [];
        enabled.forEach(function (entry) {
            var history = readHistory(entry.contact.id);
            var candidate = getFollowUpCandidate(entry.scope, entry.contact, history, Date.now());
            if (candidate) candidates.push(candidate);
        });
        if (!candidates.length) return;
        candidates.sort(function (a, b) { return Number(a.state.dueAt) - Number(b.state.dueAt); });
        var candidate = candidates[0];
        followUpRequestPending = true;
        safeSet(FOLLOW_UP_LOCK_KEY, String(Date.now()));
        try {
            await runFollowUpCandidate(candidate);
        } catch (error) {
            try {
                var retryState = readFollowUpState(candidate.scope, candidate.contact.id);
                retryState.dueAt = Date.now() + 30 * 60 * 1000;
                saveFollowUpState(candidate.scope, candidate.contact.id, retryState);
            } catch (stateError) {}
            try { console.warn('[ChatNotifier] follow-up skipped:', error && error.message ? error.message : error); } catch (e) {}
        } finally {
            followUpRequestPending = false;
            safeSet(FOLLOW_UP_LOCK_KEY, '');
        }
    }

    function startFollowUpScheduler() {
        if (followUpSchedulerStarted) return;
        followUpSchedulerStarted = true;
        checkFollowUpTasks();
        setInterval(checkFollowUpTasks, PROACTIVE_CHECK_MS);
        global.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') checkFollowUpTasks();
        });
    }

    function startProactiveScheduler() {
        if (proactiveSchedulerStarted) return;
        proactiveSchedulerStarted = true;
        checkProactiveContacts();
        setInterval(checkProactiveContacts, PROACTIVE_CHECK_MS);
        startFollowUpScheduler();
        global.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') checkProactiveContacts();
        });
        global.addEventListener('storage', function (event) {
            if (event && event.key && event.key.indexOf('chat_proactive_contact_') === 0 &&
                event.newValue === 'true') checkProactiveContacts();
        });
    }

    var bootTs = Date.now();

    /* ---------- 启动 ---------- */
    ChatNotifier.start = function () {
        // 聊天详情页不轮询未读角标/主动联系，但仍运行追问调度，
        // 新追问通过自定义事件回到当前聊天界面。
        if (currentDetailRoleId()) {
            startFollowUpScheduler();
            return;
        }
        tick();
        setInterval(tick, POLL_MS);
        startProactiveScheduler();
        // 其它标签页/localStorage 变化时立刻响应
        global.addEventListener('storage', function (e) {
            if (e && e.key && e.key.indexOf('chat_history_') === 0) {
                tick();
                checkFollowUpTasks();
            }
            if (e && e.key && (e.key.indexOf('chat_followup_enabled_') === 0 || e.key === 'phone_groups')) checkFollowUpTasks();
        });
    };

    global.ChatNotifier = ChatNotifier;

    // nav.js 动态注入与 chat-detail 直接引入时均启动；详情页只运行追问调度。
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ChatNotifier.start);
    } else {
        ChatNotifier.start();
    }
})(window);
