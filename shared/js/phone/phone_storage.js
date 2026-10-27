/* ============================================================
 * phone_storage.js  —  公共存储层
 *
 * 职责：
 *   1. 统一 localStorage 读写（加 try/catch + JSON 安全）
 *   2. 新结构：phoneData[contactId][appId] = {...}
 *   3. 兼容旧 key：ai_custom_characters / chat_history_xxx / finance_records / moments ...
 *      旧 key 不会自动删除，读的时候两边都查，写的时候两边都写（渐进迁移）
 *
 * 被 phone_context / phone_api / phone_engine 等上层引用，
 * 不依赖任何业务页面。
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
    NS.getMyProfile = function () {
        return NS.rawGet('myProfile', null);
    };

    NS.saveMyProfile = function (profile) {
        NS.rawSet('myProfile', profile || {});
    };

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

    // 启动时安全回收旧版本双份保存的聊天/记忆数据，其他内容不作改动。
    try { NS.compactDuplicateData(); } catch (error) {
        console.warn('[PhoneStorage] storage compaction skipped', error);
    }

})(window);
