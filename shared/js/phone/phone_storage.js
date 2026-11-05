/* ============================================================
 * phone_storage.js  —  公共存储层
 *
 * 职责：
 *   1. 统一 localStorage 读写（加 try/catch + JSON 安全）
 *   2. 新结构：phoneData[contactId][appId] = {...}（键名 phone_data_v2）
 *   3. 兼容旧 key：ai_custom_characters / chat_history_xxx / finance_records / moments ...
 *      旧 key 不会自动删除；读取时部分 getter 会先查新结构再回退旧 key，
 *      但并非所有写入方法都双写——多数全局数据（角色/群组/世界书/财务等）
 *      目前只写各自的旧键，phone_data_v2 主要承载 per-contact 的 appId 分桶。
 *
 * 被 phone_context / phone_api / phone_engine 等上层引用，
 * 不依赖任何业务页面。
 *
 * ─── 返回值契约（历史遗留，本阶段不改动）───────────────────
 *   rawSet            → boolean（写入是否成功）
 *   rawRemove         → undefined
 *   _setRoot / setData / deleteData /
 *   saveCharacters / saveGroups / saveWorldbooks /
 *   saveMyProfile / saveFinanceRecords / ...
 *                     → undefined（调用方无反馈）
 *   getCharacters / getGroups / getWorldbooks /
 *   getChatHistory / getMemories / getFinanceRecords ...
 *                     → 数组（JSON 解析失败时退化为空数组，
 *                        调用方无法区分"无数据"与"数据损坏"）
 *
 *   如需区分 NOT_FOUND / CORRUPT_DATA / QUOTA_EXCEEDED 等显式状态，
 *   请使用追加在本文件末尾的 PhoneStorage.result 命名空间。
 * ============================================================ */

(function (global) {
    'use strict';

    var NS = global.PhoneStorage = {};

    /* ========== 原始读写 ========== */

    NS.rawGet = function (key, fallback) {
        try {
            var v = localStorage.getItem(key);
            if (v == null) return fallback;
            // 尝试 JSON 解析，失败则返回原始字符串
            try { return JSON.parse(v); }
            catch (e) { return v; }
        } catch (e) { return fallback; }
    };

    NS.rawSet = function (key, value) {
        try {
            if (typeof value === 'string') {
                localStorage.setItem(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
            return true;
        } catch (e) {
            console.warn('[PhoneStorage] set failed', key, e);
            return false;
        }
    };

    NS.rawRemove = function (key) {
        try { localStorage.removeItem(key); } catch (e) {}
    };

    /* ========== 角色 App 层级 ========== */

    var PHONE_DATA_KEY = 'phone_data_v2';
    var CONTACT_KEY = 'phone_current_contact';

    NS._getRoot = function () {
        var v = NS.rawGet(PHONE_DATA_KEY, null);
        if (!v || typeof v !== 'object') { v = {}; }
        return v;
    };

    NS._setRoot = function (root) {
        NS.rawSet(PHONE_DATA_KEY, root);
    };

    // phoneData[contactId][appId]
    NS.getData = function (contactId, appId) {
        var root = NS._getRoot();
        var bucket = root[contactId];

        // 聊天记录/记忆以现有旧 key 为主，避免读取到旧的重复副本。
        if (appId === 'chat') {
            var history = NS.rawGet('chat_history_' + contactId, null);
            if (Array.isArray(history)) return { history: history };
            if (bucket && bucket.chat != null) return bucket.chat;
        }
        if (appId === 'memories') {
            var memories = NS.rawGet('chat_memories_' + contactId, null);
            if (Array.isArray(memories)) return { items: memories };
            if (bucket && bucket.memories != null) return bucket.memories;
        }

        if (bucket && bucket[appId] != null) return bucket[appId];
        return null;
    };

    NS.setData = function (contactId, appId, value) {
        var root = NS._getRoot();
        if (!root[contactId]) root[contactId] = {};
        root[contactId][appId] = value;
        NS._setRoot(root);
    };

    NS.deleteData = function (contactId, appId) {
        var root = NS._getRoot();
        if (root[contactId] && root[contactId][appId] != null) {
            delete root[contactId][appId];
            NS._setRoot(root);
        }
    };

    NS.listAppIds = function (contactId) {
        var root = NS._getRoot();
        if (!root[contactId]) return [];
        return Object.keys(root[contactId]);
    };

    /* ========== 当前选中角色 ========== */

    NS.getCurrentContactId = function () {
        var v = localStorage.getItem(CONTACT_KEY);
        return v || null;
    };

    NS.setCurrentContactId = function (id) {
        if (id) {
            localStorage.setItem(CONTACT_KEY, String(id));
        } else {
            localStorage.removeItem(CONTACT_KEY);
        }
    };

    /* ========== 旧 key 兼容读取 ==========
     * 文档要求 phoneData[contactId][appId] 统一管理，
     * 但现有项目是散装 key，所以每个 getter 做新旧双查：
     *   先查 phoneData[contactId][appId]，
     *   没有再查旧 key（localStorage 顶层 key）。
     * 这样重构期间新旧两套都能跑。
     */

    // 角色列表（全局）
    NS.getCharacters = function () {
        var v = NS.rawGet('ai_custom_characters', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveCharacters = function (list) {
        NS.rawSet('ai_custom_characters', list || []);
    };

    // 我（玩家 profile）
    // 新安装或旧资料没有头像时，从三款内置头像中自动分配一款。
    // 只补空头像；用户已上传或选择的头像永远优先。
    var DEFAULT_AVATAR_PRESETS = [
        { id: "bunny", name: "兔子", dataUrl: "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20200%20200%22%20width%3D%22200%22%20height%3D%22200%22%3E%0A%20%20%3Cellipse%20cx%3D%2268.75%22%20cy%3D%2250%22%20rx%3D%2215.625%22%20ry%3D%2243.75%22%20fill%3D%22%23e8e8ea%22%20transform%3D%22rotate(-8%2068.75%2050)%22%2F%3E%0A%20%20%3Cellipse%20cx%3D%22131.25%22%20cy%3D%2250%22%20rx%3D%2215.625%22%20ry%3D%2243.75%22%20fill%3D%22%23e8e8ea%22%20transform%3D%22rotate(8%20131.25%2050)%22%2F%3E%0A%20%20%3Cellipse%20cx%3D%22100%22%20cy%3D%22118.75%22%20rx%3D%2262.5%22%20ry%3D%2256.25%22%20fill%3D%22%23f5f5f6%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2278.125%22%20cy%3D%22118.75%22%20r%3D%226.25%22%20fill%3D%22%23555%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%22121.875%22%20cy%3D%22118.75%22%20r%3D%226.25%22%20fill%3D%22%23555%22%2F%3E%0A%3C%2Fsvg%3E" },
        { id: "cat", name: "眼镜猫", dataUrl: "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20200%20200%22%20width%3D%22200%22%20height%3D%22200%22%3E%0A%20%20%3Ccircle%20cx%3D%22100%22%20cy%3D%22100%22%20r%3D%22100%22%20fill%3D%22%23f5f5f6%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M44%2068%20L32%2020%20L76%2044%20Z%22%20fill%3D%22%23e8e8ea%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M156%2068%20L168%2020%20L124%2044%20Z%22%20fill%3D%22%23e8e8ea%22%2F%3E%0A%20%20%3Cellipse%20cx%3D%22100%22%20cy%3D%22106%22%20rx%3D%2268%22%20ry%3D%2262%22%20fill%3D%22%23fafafb%22%2F%3E%0A%20%20%3Crect%20x%3D%2244%22%20y%3D%2286%22%20width%3D%2250%22%20height%3D%2238%22%20rx%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23222%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Crect%20x%3D%22106%22%20y%3D%2286%22%20width%3D%2250%22%20height%3D%2238%22%20rx%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23222%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Cline%20x1%3D%2294%22%20y1%3D%22103%22%20x2%3D%22106%22%20y2%3D%22103%22%20stroke%3D%22%23222%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2272%22%20cy%3D%22103%22%20r%3D%226%22%20fill%3D%22%23222%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%22128%22%20cy%3D%22103%22%20r%3D%226%22%20fill%3D%22%23222%22%2F%3E%0A%3C%2Fsvg%3E" },
        { id: "cat-dark", name: "深色眼镜猫", dataUrl: "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20200%20200%22%20width%3D%22200%22%20height%3D%22200%22%3E%0A%20%20%3Ccircle%20cx%3D%22100%22%20cy%3D%22100%22%20r%3D%22100%22%20fill%3D%22%23e8e8ea%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M44%2068%20L32%2020%20L76%2044%20Z%22%20fill%3D%22%23c8c8ca%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M156%2068%20L168%2020%20L124%2044%20Z%22%20fill%3D%22%23c8c8ca%22%2F%3E%0A%20%20%3Cellipse%20cx%3D%22100%22%20cy%3D%22106%22%20rx%3D%2268%22%20ry%3D%2262%22%20fill%3D%22%23e0e0e2%22%2F%3E%0A%20%20%3Crect%20x%3D%2244%22%20y%3D%2286%22%20width%3D%2250%22%20height%3D%2238%22%20rx%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23333%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Crect%20x%3D%22106%22%20y%3D%2286%22%20width%3D%2250%22%20height%3D%2238%22%20rx%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23333%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Cline%20x1%3D%2294%22%20y1%3D%22103%22%20x2%3D%22106%22%20y2%3D%22103%22%20stroke%3D%22%23333%22%20stroke-width%3D%226%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2272%22%20cy%3D%22103%22%20r%3D%226%22%20fill%3D%22%23333%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%22128%22%20cy%3D%22103%22%20r%3D%226%22%20fill%3D%22%23333%22%2F%3E%0A%3C%2Fsvg%3E" }
    ];

    NS.getDefaultAvatarPresets = function () {
        return DEFAULT_AVATAR_PRESETS.map(function (item) {
            return { id: item.id, name: item.name, dataUrl: item.dataUrl };
        });
    };

    NS.ensureDefaultMyAvatar = function () {
        var profile = NS.rawGet('myProfile', null);
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) profile = {};
        if (typeof profile.avatar === 'string' && profile.avatar.trim()) return profile;

        var index = 0;
        try {
            index = Math.floor(Math.random() * DEFAULT_AVATAR_PRESETS.length);
        } catch (error) {}
        if (index < 0 || index >= DEFAULT_AVATAR_PRESETS.length) index = 0;

        profile.avatar = DEFAULT_AVATAR_PRESETS[index].dataUrl;
        if (!NS.rawSet('myProfile', profile)) {
            console.warn('[PhoneStorage] default avatar could not be persisted');
        }
        return profile;
    };

    NS.getMyProfile = function () {
        return NS.ensureDefaultMyAvatar();
    };

    NS.saveMyProfile = function (profile) {
        NS.rawSet('myProfile', profile || {});
    };

    // 早期初始化：让直接读取 myProfile 的旧页面也能拿到已分配头像。
    try { NS.ensureDefaultMyAvatar(); } catch (error) {
        console.warn('[PhoneStorage] default avatar initialization skipped', error);
    }

    // 世界书
    NS.getWorldbooks = function () {
        var v = NS.rawGet('phone_worldbooks', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveWorldbooks = function (list) {
        NS.rawSet('phone_worldbooks', list || []);
    };

    // 群组（全局）
    NS.getGroups = function () {
        var v = NS.rawGet('phone_groups', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveGroups = function (list) {
        NS.rawSet('phone_groups', list || []);
    };

    // 聊天记录（按角色）
    NS.getChatHistory = function (contactId) {
        var v = NS.rawGet('chat_history_' + contactId, null);
        if (Array.isArray(v)) return v;
        // 兼容历史版本：如果旧 key 不存在，尝试读取 phone_data_v2 中已有的副本。
        var root = NS._getRoot();
        var bucket = root[contactId];
        if (bucket && bucket.chat && Array.isArray(bucket.chat.history)) return bucket.chat.history;
        return [];
    };

    NS.saveChatHistory = function (contactId, list) {
        // 聊天记录可能很大。先写入当前主 key，成功后再移除 phone_data_v2 中的重复副本。
        var saved = NS.rawSet('chat_history_' + contactId, Array.isArray(list) ? list : []);
        if (!saved) return false;
        var root = NS._getRoot();
        var bucket = root[contactId];
        if (bucket && bucket.chat != null) {
            delete bucket.chat;
            if (!Object.keys(bucket).length) delete root[contactId];
            NS.rawSet(PHONE_DATA_KEY, root);
        }
        return true;
    };

    // 记忆（按角色）
    NS.getMemories = function (contactId) {
        var v = NS.rawGet('chat_memories_' + contactId, null);
        if (Array.isArray(v)) return v;
        var root = NS._getRoot();
        var bucket = root[contactId];
        if (bucket && bucket.memories && Array.isArray(bucket.memories.items)) return bucket.memories.items;
        return [];
    };

    NS.saveMemories = function (contactId, list) {
        // 与聊天记录一样，先确认主 key 写入成功，再清除重复副本。
        var saved = NS.rawSet('chat_memories_' + contactId, Array.isArray(list) ? list : []);
        if (!saved) return false;
        var root = NS._getRoot();
        var bucket = root[contactId];
        if (bucket && bucket.memories != null) {
            delete bucket.memories;
            if (!Object.keys(bucket).length) delete root[contactId];
            NS.rawSet(PHONE_DATA_KEY, root);
        }
        return true;
    };

    /* ========== 本地空间整理 ========== */

    // 删除 phone_data_v2 中与旧 key 完全相同的聊天/记忆副本。
    // 只有确认另一份副本存在且内容完全一致时才删除，不碰角色头像、世界书、其他应用数据。
    NS.compactDuplicateData = function () {
        var root = NS._getRoot();
        var changed = false;
        Object.keys(root).forEach(function (contactId) {
            var bucket = root[contactId];
            if (!bucket || typeof bucket !== 'object') return;

            var legacyHistory = NS.rawGet('chat_history_' + contactId, null);
            if (Array.isArray(legacyHistory) && bucket.chat &&
                Array.isArray(bucket.chat.history) &&
                JSON.stringify(legacyHistory) === JSON.stringify(bucket.chat.history)) {
                delete bucket.chat;
                changed = true;
            }

            var legacyMemories = NS.rawGet('chat_memories_' + contactId, null);
            if (Array.isArray(legacyMemories) && bucket.memories &&
                Array.isArray(bucket.memories.items) &&
                JSON.stringify(legacyMemories) === JSON.stringify(bucket.memories.items)) {
                delete bucket.memories;
                changed = true;
            }

            if (!Object.keys(bucket).length) delete root[contactId];
        });

        if (changed) {
            var ok = NS.rawSet(PHONE_DATA_KEY, root);
            if (!ok) console.warn('[PhoneStorage] duplicate-data compaction could not be saved');
        }
        return changed;
    };

    // 统计 localStorage 当前占用，方便设置页后续展示；只计算 UTF-16 粗略字节数。
    NS.getLocalStorageUsage = function () {
        var total = 0;
        var entries = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                var value = key == null ? '' : (localStorage.getItem(key) || '');
                var bytes = ((key || '').length + value.length) * 2;
                total += bytes;
                entries.push({ key: key, bytes: bytes });
            }
        } catch (error) {}
        entries.sort(function (a, b) { return b.bytes - a.bytes; });
        return { usedBytes: total, entries: entries };
    };

    // 动态（moments）
    NS.getMoments = function () {
        var v = NS.rawGet('moments', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveMoments = function (list) {
        NS.rawSet('moments', list || []);
    };

    // 动态通知
    NS.getMomentsNotifications = function () {
        var v = NS.rawGet('moments_notifications', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveMomentsNotifications = function (list) {
        NS.rawSet('moments_notifications', list || []);
    };

    NS.pushMomentsNotification = function (entry) {
        var arr = NS.getMomentsNotifications();
        arr.unshift(entry);
        while (arr.length > 100) arr.pop();
        NS.saveMomentsNotifications(arr);
    };

    // 论坛通知
    NS.getForumNotifications = function () {
        var v = NS.rawGet('forum_notifications', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveForumNotifications = function (list) {
        NS.rawSet('forum_notifications', list || []);
    };

    // 财务记录（钱包）
    NS.getFinanceRecords = function () {
        var v = NS.rawGet('finance_records', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.saveFinanceRecords = function (list) {
        NS.rawSet('finance_records', list || []);
    };

    // API 配置
    NS.getApiConfig = function () {
        return NS.rawGet('api_settings', null) || {};
    };

    NS.saveApiConfig = function (cfg) {
        NS.rawSet('api_settings', cfg || {});
    };

    // ===== API 多方案（profiles）=====
    // 结构：api_profiles_v1 = [{id, name, provider, baseUrl, apiKey, model, temperature,
    //                          maxTokens, topP, prompt, createdAt, updatedAt }]
    //       api_active_profile = 激活方案 id
    //       api_settings = 激活方案的镜像（由 settings.js 双写维护）——
    //       chat-detail / forum / memory 等全站读取方继续直接读镜像，零改动兼容。
    NS.getApiProfiles = function () {
        var v = NS.rawGet('api_profiles_v1', null);
        return Array.isArray(v) ? v : [];
    };

    NS.saveApiProfiles = function (list) {
        NS.rawSet('api_profiles_v1', Array.isArray(list) ? list : []);
    };

    NS.getActiveProfileId = function () {
        var v = NS.rawGet('api_active_profile', '');
        return v ? String(v) : '';
    };

    NS.setActiveProfileId = function (id) {
        if (id) NS.rawSet('api_active_profile', String(id));
        else NS.rawRemove('api_active_profile');
    };

    // API 调用日志
    NS.getApiLogs = function () {
        var v = NS.rawGet('api_call_logs', null);
        if (Array.isArray(v)) return v;
        return [];
    };

    NS.pushApiLog = function (entry) {
        var logs = NS.getApiLogs();
        entry = entry || {};
        // 统一补齐展示所需字段，避免写入方遗漏导致时间/耗时显示异常
        if (entry.time == null) entry.time = Date.now();
        if (entry.duration == null) entry.duration = 0;
        logs.unshift(entry);
        while (logs.length > 50) logs.pop();
        NS.rawSet('api_call_logs', logs);
    };

    /* ============================================================
     * Result 协议：对现有 getter/setter 的显式状态封装
     *
     * 目标：
     *   - 读路径区分三态：NOT_FOUND / CORRUPT_DATA / ok
     *   - 写路径带回 QUOTA_EXCEEDED / DB_UNAVAILABLE 等真实结果
     *   - 原有 rawSet/saveCharacters/getCharacters 等签名与返回值不变，
     *     旧页面零改动即可继续工作
     * ============================================================ */

    NS.result = (function () {

        /* ---------- 错误码集合 ---------- */
        var ERR = {
            NOT_FOUND:       'NOT_FOUND',
            CORRUPT_DATA:    'CORRUPT_DATA',
            QUOTA_EXCEEDED:  'QUOTA_EXCEEDED',
            DB_BLOCKED:      'DB_BLOCKED',
            DB_UNAVAILABLE:  'DB_UNAVAILABLE',
            CONFLICT:        'CONFLICT',
            VALIDATION_FAILED:'VALIDATION_FAILED'
        };

        /* ---------- 构造函数 ---------- */
        function okResult(value, meta) {
            return { ok: true, value: value, meta: meta || {} };
        }
        function failResult(code, message, retryable, extra) {
            var r = {
                ok: false,
                error: {
                    code: code,
                    message: message || code,
                    retryable: !!retryable
                }
            };
            if (extra) r.meta = extra;
            return r;
        }

        /* ---------- 私有：带状态的原始读取 ----------
         * 返回 { state, raw, parsed, error, key }
         *   state: 'missing' | 'unavailable' | 'corrupt' | 'ok'
         */
        function _probe(key) {
            var result = { key: key, state: 'missing', raw: null, parsed: null, error: null };
            try {
                var raw = localStorage.getItem(key);
                if (raw == null) { result.state = 'missing'; return result; }
                try {
                    result.parsed = JSON.parse(raw);
                    result.raw = raw;
                    result.state = 'ok';
                } catch (pe) {
                    result.raw = raw;
                    result.state = 'corrupt';
                    result.error = pe;
                }
            } catch (le) {
                result.state = 'unavailable';
                result.error = le;
            }
            return result;
        }

        /* ---------- 私有：写入，捕获配额 ---------- */
        function _write(key, value) {
            try {
                var serialized = typeof value === 'string' ? value : JSON.stringify(value);
                localStorage.setItem(key, serialized);
                return { state: 'ok' };
            } catch (e) {
                var name = (e && e.name) || '';
                if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                    name === 'QUOTA_EXCEEDED_ERR') {
                    return { state: 'quota', error: e };
                }
                return { state: 'error', error: e };
            }
        }

        function _remove(key) {
            try { localStorage.removeItem(key); return { state: 'ok' }; }
            catch (e) { return { state: 'error', error: e }; }
        }

        /* ---------- 私有：把 probe 结果映射为最终 Result ---------- */
        function _probeToResult(probe, expectedShape) {
            expectedShape = expectedShape || 'any';
            if (probe.state === 'missing') {
                return failResult(ERR.NOT_FOUND, 'key not found: ' + probe.key, false);
            }
            if (probe.state === 'unavailable') {
                return failResult(ERR.DB_UNAVAILABLE,
                    'localStorage unavailable: ' + (probe.error && probe.error.message || probe.key), true);
            }
            if (probe.state === 'corrupt') {
                return failResult(ERR.CORRUPT_DATA,
                    'JSON parse failed: ' + probe.key, false, { raw: probe.raw });
            }
            // state === 'ok'，再检查形状
            if (expectedShape === 'array' && !Array.isArray(probe.parsed)) {
                return failResult(ERR.CORRUPT_DATA,
                    'expected array, got ' + typeof probe.parsed + ': ' + probe.key, false,
                    { raw: probe.raw });
            }
            if (expectedShape === 'object' &&
                (probe.parsed == null || typeof probe.parsed !== 'object' || Array.isArray(probe.parsed))) {
                return failResult(ERR.CORRUPT_DATA,
                    'expected object, got ' + typeof probe.parsed + ': ' + probe.key, false,
                    { raw: probe.raw });
            }
            return okResult(probe.parsed, { found: true, source: probe.key });
        }

        function _writeToResult(writeOutcome, key) {
            if (writeOutcome.state === 'ok') {
                return okResult(true, { written: key });
            }
            if (writeOutcome.state === 'quota') {
                return failResult(ERR.QUOTA_EXCEEDED,
                    'localStorage quota exceeded on ' + key, false);
            }
            // error 或 unavailable 都归 DB_UNAVAILABLE
            return failResult(ERR.DB_UNAVAILABLE,
                'localStorage write failed on ' + key + ': ' +
                (writeOutcome.error && writeOutcome.error.message || 'unknown'),
                true);
        }

        /* ============================================================
         * 暴露方法
         * ============================================================ */
        var R = {};
        R.ERR = ERR;  // 便于外部对照错误码

        /* ---------- 原始读写 ---------- */

        // rawGet: 返回结果对象，不再返回 fallback 或原始字符串
        R.rawGet = function (key, expectedShape) {
            var probe = _probe(key);
            return _probeToResult(probe, expectedShape);
        };

        R.rawSet = function (key, value) {
            var out = _write(key, value);
            return _writeToResult(out, key);
        };

        R.rawRemove = function (key) {
            var out = _remove(key);
            if (out.state === 'ok') return okResult(true, { removed: key });
            return failResult(ERR.DB_UNAVAILABLE,
                'localStorage remove failed on ' + key, true);
        };

        /* ---------- phone_data_v2 根 ---------- */

        function _probeRoot() { return _probe(NS._PHONE_DATA_KEY || 'phone_data_v2'); }

        // getRoot —— 三态
        R.getRoot = function () {
            // 需要先知道 PHONE_DATA_KEY 的值，它在 NS 闭包里
            // 用 NS._getRoot() 间接读取是可以的，但要先 probe
            // 因为闭包外拿不到 PHONE_DATA_KEY 常量，所以用 _probe 里动态查找
            var probe = _probe('phone_data_v2');
            var r = _probeToResult(probe, 'object');
            // 如果 NOT_FOUND，value 给 {} 方便调用方，meta 里仍然标记 found:false
            if (!r.ok && r.error.code === ERR.NOT_FOUND) {
                return okResult({}, { found: false, source: 'phone_data_v2' });
            }
            return r;
        };

        // setRoot
        R.setRoot = function (root) {
            return R.rawSet('phone_data_v2', root);
        };

        /* ---------- 角色 App 层级 ---------- */

        // getData —— 重现 getData 的双查逻辑，但给结果对象
        R.getData = function (contactId, appId) {
            // 先查 phone_data_v2
            var rootRes = R.getRoot();
            var bucket;
            if (rootRes.ok && rootRes.value) bucket = rootRes.value[contactId];

            if (appId === 'chat') {
                var hist = _probe('chat_history_' + contactId);
                if (hist.state === 'ok') {
                    if (Array.isArray(hist.parsed)) {
                        return okResult({ history: hist.parsed },
                            { found: true, source: 'chat_history_' + contactId });
                    }
                }
                // 旧 key 损坏 → 直接返回 CORRUPT_DATA，不要回退到新 key 掩盖问题
                if (hist.state === 'corrupt') {
                    return failResult(ERR.CORRUPT_DATA,
                        'chat_history_' + contactId + ' corrupt', false, { raw: hist.raw });
                }
                if (bucket && bucket.chat != null) {
                    return okResult(bucket.chat, { found: true, source: 'phone_data_v2' });
                }
                return failResult(ERR.NOT_FOUND, 'chat data not found for ' + contactId, false);
            }
            if (appId === 'memories') {
                var mem = _probe('chat_memories_' + contactId);
                if (mem.state === 'ok') {
                    if (Array.isArray(mem.parsed)) {
                        return okResult({ items: mem.parsed },
                            { found: true, source: 'chat_memories_' + contactId });
                    }
                }
                if (mem.state === 'corrupt') {
                    return failResult(ERR.CORRUPT_DATA,
                        'chat_memories_' + contactId + ' corrupt', false, { raw: mem.raw });
                }
                if (bucket && bucket.memories != null) {
                    return okResult(bucket.memories, { found: true, source: 'phone_data_v2' });
                }
                return failResult(ERR.NOT_FOUND, 'memories data not found for ' + contactId, false);
            }

            if (bucket && bucket[appId] != null) {
                return okResult(bucket[appId],
                    { found: true, source: 'phone_data_v2' });
            }
            return failResult(ERR.NOT_FOUND, appId + ' not found for ' + contactId, false);
        };

        // setData —— 写入 phone_data_v2
        R.setData = function (contactId, appId, value) {
            var rootRes = R.getRoot();
            if (!rootRes.ok && rootRes.error.code !== ERR.NOT_FOUND) return rootRes;
            var root = rootRes.value || {};
            if (!root[contactId]) root[contactId] = {};
            root[contactId][appId] = value;
            return R.setRoot(root);
        };

        R.deleteData = function (contactId, appId) {
            var rootRes = R.getRoot();
            if (!rootRes.ok && rootRes.error.code !== ERR.NOT_FOUND) return rootRes;
            var root = rootRes.value || {};
            if (root[contactId] && root[contactId][appId] != null) {
                delete root[contactId][appId];
                if (!Object.keys(root[contactId]).length) delete root[contactId];
                return R.setRoot(root);
            }
            return okResult(true, { deleted: false });  // 本来就没有
        };

        /* ---------- 全局数组：characters / groups / worldbooks / moments / financeRecords ---------- */

        function _arrayGet(key) {
            var probe = _probe(key);
            return _probeToResult(probe, 'array');
        }
        function _arraySave(key, list) {
            return R.rawSet(key, Array.isArray(list) ? list : []);
        }

        R.getCharacters = function ()    { return _arrayGet('ai_custom_characters'); };
        R.saveCharacters = function (l)  { return _arraySave('ai_custom_characters', l); };

        R.getGroups = function ()        { return _arrayGet('phone_groups'); };
        R.saveGroups = function (l)      { return _arraySave('phone_groups', l); };

        R.getWorldbooks = function ()    { return _arrayGet('phone_worldbooks'); };
        R.saveWorldbooks = function (l)  { return _arraySave('phone_worldbooks', l); };

        R.getMoments = function ()       { return _arrayGet('moments'); };
        R.saveMoments = function (l)     { return _arraySave('moments', l); };

        R.getFinanceRecords = function ()  { return _arrayGet('finance_records'); };
        R.saveFinanceRecords = function (l){ return _arraySave('finance_records', l); };

        R.getForumNotifications = function ()   { return _arrayGet('forum_notifications'); };
        R.saveForumNotifications = function (l){ return _arraySave('forum_notifications', l); };

        R.getMomentsNotifications = function ()   { return _arrayGet('moments_notifications'); };
        R.saveMomentsNotifications = function (l){ return _arraySave('moments_notifications', l); };

        /* ---------- MyProfile（对象） ---------- */

        R.getMyProfile = function () {
            var probe = _probe('myProfile');
            if (probe.state === 'missing') {
                // 历史行为：rawGet 返回 null。这里按对象处理，NOT_FOUND 返回 null 值便于调用方
                return failResult(ERR.NOT_FOUND, 'myProfile not found', false);
            }
            if (probe.state === 'corrupt') {
                return failResult(ERR.CORRUPT_DATA, 'myProfile corrupt', false, { raw: probe.raw });
            }
            if (probe.state === 'unavailable') {
                return failResult(ERR.DB_UNAVAILABLE, 'localStorage unavailable', true);
            }
            return okResult(probe.parsed, { found: true, source: 'myProfile' });
        };
        R.saveMyProfile = function (profile) {
            return R.rawSet('myProfile', profile || {});
        };

        /* ---------- Chat history / Memories（per-contact，旧 key 为主） ---------- */

        R.getChatHistory = function (contactId) {
            var probe = _probe('chat_history_' + contactId);
            if (probe.state === 'corrupt') {
                return failResult(ERR.CORRUPT_DATA,
                    'chat_history_' + contactId + ' corrupt', false, { raw: probe.raw });
            }
            if (probe.state === 'ok' && Array.isArray(probe.parsed)) {
                return okResult(probe.parsed,
                    { found: true, source: 'chat_history_' + contactId });
            }
            // 回退到 phone_data_v2
            var rootRes = R.getRoot();
            if (rootRes.ok && rootRes.value) {
                var bucket = rootRes.value[contactId];
                if (bucket && bucket.chat && Array.isArray(bucket.chat.history)) {
                    return okResult(bucket.chat.history,
                        { found: true, source: 'phone_data_v2' });
                }
            }
            return failResult(ERR.NOT_FOUND, 'chat history not found for ' + contactId, false);
        };

        R.saveChatHistory = function (contactId, list) {
            var arr = Array.isArray(list) ? list : [];
            var out = _write('chat_history_' + contactId, arr);
            if (out.state !== 'ok') return _writeToResult(out, 'chat_history_' + contactId);
            // 清除 phone_data_v2 中的重复副本（与原 saveChatHistory 行为一致）
            var rootRes = R.getRoot();
            if (rootRes.ok && rootRes.value) {
                var root = rootRes.value;
                var bucket = root[contactId];
                if (bucket && bucket.chat != null) {
                    delete bucket.chat;
                    if (!Object.keys(bucket).length) delete root[contactId];
                    var sub = _write('phone_data_v2', root);
                    if (sub.state !== 'ok') {
                        // 主 key 已写成功，phone_data_v2 写不回去不算致命
                        console.warn('[PhoneStorage.result] phone_data_v2 cleanup failed', sub.error);
                    }
                }
            }
            return okResult(true, { written: 'chat_history_' + contactId });
        };

        R.getMemories = function (contactId) {
            var probe = _probe('chat_memories_' + contactId);
            if (probe.state === 'corrupt') {
                return failResult(ERR.CORRUPT_DATA,
                    'chat_memories_' + contactId + ' corrupt', false, { raw: probe.raw });
            }
            if (probe.state === 'ok' && Array.isArray(probe.parsed)) {
                return okResult(probe.parsed,
                    { found: true, source: 'chat_memories_' + contactId });
            }
            var rootRes = R.getRoot();
            if (rootRes.ok && rootRes.value) {
                var bucket = rootRes.value[contactId];
                if (bucket && bucket.memories && Array.isArray(bucket.memories.items)) {
                    return okResult(bucket.memories.items,
                        { found: true, source: 'phone_data_v2' });
                }
            }
            return failResult(ERR.NOT_FOUND, 'memories not found for ' + contactId, false);
        };

        R.saveMemories = function (contactId, list) {
            var arr = Array.isArray(list) ? list : [];
            var out = _write('chat_memories_' + contactId, arr);
            if (out.state !== 'ok') return _writeToResult(out, 'chat_memories_' + contactId);
            var rootRes = R.getRoot();
            if (rootRes.ok && rootRes.value) {
                var root = rootRes.value;
                var bucket = root[contactId];
                if (bucket && bucket.memories != null) {
                    delete bucket.memories;
                    if (!Object.keys(bucket).length) delete root[contactId];
                    var sub = _write('phone_data_v2', root);
                    if (sub.state !== 'ok') {
                        console.warn('[PhoneStorage.result] phone_data_v2 cleanup failed', sub.error);
                    }
                }
            }
            return okResult(true, { written: 'chat_memories_' + contactId });
        };

        /* ---------- API profiles / config ---------- */

        R.getApiProfiles = function () { return _arrayGet('api_profiles_v1'); };
        R.saveApiProfiles = function (l) { return _arraySave('api_profiles_v1', l); };

        R.getApiLogs = function () { return _arrayGet('api_call_logs'); };
        R.saveApiLogs = function (l) { return _arraySave('api_call_logs', l); };

        R.pushApiLog = function (entry) {
            var logs;
            var res = R.getApiLogs();
            if (res.ok) logs = res.value;
            else if (res.error.code === ERR.NOT_FOUND) logs = [];
            else return res;
            entry = entry || {};
            if (entry.time == null) entry.time = Date.now();
            if (entry.duration == null) entry.duration = 0;
            logs.unshift(entry);
            while (logs.length > 50) logs.pop();
            return R.saveApiLogs(logs);
        };

        R.getApiConfig = function () {
            var probe = _probe('api_settings');
            if (probe.state === 'missing') {
                return okResult({}, { found: false, source: 'api_settings' });
            }
            return _probeToResult(probe, 'object');
        };
        R.saveApiConfig = function (cfg) {
            return R.rawSet('api_settings', cfg || {});
        };

        R.getActiveProfileId = function () {
            var probe = _probe('api_active_profile');
            if (probe.state === 'missing') return okResult('', { found: false });
            if (probe.state === 'corrupt') {
                // 这个 key 历史上可能直接存字符串而非 JSON，"corrupt" 不一定是真损坏
                return okResult(probe.raw, { found: true, source: 'api_active_profile', raw: probe.raw });
            }
            return okResult(String(probe.parsed || ''),
                { found: true, source: 'api_active_profile' });
        };
        R.setActiveProfileId = function (id) {
            if (id) return R.rawSet('api_active_profile', String(id));
            return R.rawRemove('api_active_profile');
        };

        R.pushMomentsNotification = function (entry) {
            var res = R.getMomentsNotifications();
            var arr;
            if (res.ok) arr = res.value;
            else if (res.error.code === ERR.NOT_FOUND) arr = [];
            else return res;
            entry = entry || {};
            arr.unshift(entry);
            while (arr.length > 100) arr.pop();
            return R.saveMomentsNotifications(arr);
        };

        return R;
    })();

    // 启动时安全回收旧版本双份保存的聊天/记忆数据，其他内容不作改动。
    try { NS.compactDuplicateData(); } catch (error) {
        console.warn('[PhoneStorage] storage compaction skipped', error);
    }

})(window);
