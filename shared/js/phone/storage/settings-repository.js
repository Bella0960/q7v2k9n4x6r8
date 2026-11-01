/* ============================================================
 * settings-repository.js  —— 轻量设置仓储
 *
 * 本 Repository 只覆盖"每个键独立存放、互不依赖"的轻量设置项，
 * 不包办全部设置。未来重量级设置（如 API profiles 列表）继续由
 * 各自的 Repository 或 PhoneStorage.result 处理。
 *
 * 被本类管理的键：
 *   phone_current_contact       → 当前选中角色指针（字符串 id）
 *   maomao_theme                → 全局主题（字符串，'liquid-glass' / 'default' ...）
 *   maomao_chat_theme_preset    → 聊天主题预设（'default' / 'imessage' / 'qq'）
 *   font_size_global            → 全局字号（数字字符串，12-20）
 *   custom_font_color           → 自定义字体颜色（#RRGGBB 字符串）
 *   sound_settings              → 声音设置对象（JSON，如 { enabled:true, volume:80 }）
 *   api_active_profile          → 当前激活 API 方案 id（字符串）
 *
 * 不管理的：
 *   api_settings / api_profiles_v1   → 各自 Repository
 *   phone_data_v2                    → phone 数据根
 *   旧迁移标志（maomao_chat_theme_migrated_v1、theme_bubble_*）
 *
 * 与基类的差异：
 *   - 基类假设"一个 key 存一个数组域"；本类是"一个 key 存一个标量或对象"，
 *     所以完全 override _readDomain / _writeDomain，让每个 key 成为独立域。
 *   - get(key) / set(key, value) 是本类的核心 API，基类的 list/save/remove
 *     语义变成"列出全部受管键 / 覆盖写 / 移除该键"。
 *   - migrate 在这里意义不大（标量没有 revision 概念），保持为空实现。
 *
 * 本类不注入任何业务默认值，调用方需在 get() 返回 NOT_FOUND 时自行兜底。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[SettingsRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    /**
     * 受管键清单（声明式）。每个条目：
     *   key          — localStorage 键名
     *   expectedType — 'string' / 'object' / 'any'；仅做校验，不做类型转换
     *   label        — 人类可读的设置项描述（仅用于错误信息）
     */
    var SETTING_KEYS = [
        { key: 'phone_current_contact',    expectedType: 'string', label: 'current contact' },
        { key: 'maomao_theme',              expectedType: 'string', label: 'global theme' },
        { key: 'maomao_chat_theme_preset',  expectedType: 'string', label: 'chat theme preset' },
        { key: 'font_size_global',          expectedType: 'string', label: 'font size' },
        { key: 'custom_font_color',         expectedType: 'string', label: 'font color' },
        { key: 'sound_settings',            expectedType: 'object', label: 'sound settings' },
        { key: 'api_active_profile',        expectedType: 'string', label: 'active API profile' }
    ];

    function SettingsRepository(storage) {
        _BASE.call(this, {
            key: '__settings__',    // 虚拟 key，不对应真实 localStorage 键
            schemaVersion: 1,
            idField: 'key',         // 用设置项 key 作为"实体 id"
            storage: storage || _PS.result
        });
        this._keys = {};
        for (var i = 0; i < SETTING_KEYS.length; i++) {
            this._keys[SETTING_KEYS[i].key] = SETTING_KEYS[i];
        }
    }
    SettingsRepository.prototype = Object.create(_BASE.prototype);
    SettingsRepository.prototype.constructor = SettingsRepository;

    /* ---------- override：SettingsRepository 没有一个统一域 ---------- */

    SettingsRepository.prototype._readDomain = function () {
        return { ok: false, error: {
            code: 'VALIDATION_FAILED',
            message: 'SettingsRepository 没有统一域存储；请改用 list() 读取全部受管键值，' +
                     '或用 get(key) 按单键读取。基类 list/get/save/remove/update/import/export 不适用于本类。',
            retryable: false,
            hint: '推荐：list() 返回所有受管键当前值，get(key) 读单键，set(key, value) 写单键'
        } };
    };

    SettingsRepository.prototype._writeDomain = function () {
        return { ok: false, error: {
            code: 'VALIDATION_FAILED',
            message: 'SettingsRepository 没有统一域存储；请改用 set(key, value) 写单键，' +
                     '或用 saveMany({k1:v1, ...}) 批量写入。基类 save/import 不适用于本类。',
            retryable: false,
            hint: '推荐：set(key, value) 写单键，saveMany(pairs) 批量写'
        } };
    };

    /* ---------- 受管键查询 ---------- */

    SettingsRepository.prototype.isManaged = function (key) {
        return !!this._keys[key];
    };

    SettingsRepository.prototype.listManagedKeys = function () {
        var arr = [];
        for (var k in this._keys) arr.push(k);
        return arr;
    };

    /* ---------- 核心 API：get / set / remove ---------- */

    /**
     * 读取一个设置项
     * @param {string} key - 必须是受管键之一；非受管键返回 VALIDATION_FAILED
     */
    SettingsRepository.prototype.get = function (key) {
        var self = this;
        var meta = this._keys[key];
        if (!meta) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'unmanaged settings key: ' + key, retryable: false } };
        }
        var r = this._storage.rawGet(key, meta.expectedType === 'object' ? 'object' : undefined);
        return r;  // 透传 NOT_FOUND / CORRUPT_DATA / DB_UNAVAILABLE
    };

    /**
     * 写入一个设置项（不做任何业务默认值注入）
     */
    SettingsRepository.prototype.set = function (key, value) {
        var meta = this._keys[key];
        if (!meta) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'unmanaged settings key: ' + key, retryable: false } };
        }
        // 简单类型校验：expectedType 为 'string' 但 value 不是字符串 → 拒绝
        if (meta.expectedType === 'string' && typeof value !== 'string') {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'settings key "' + key + '" expects string', retryable: false } };
        }
        if (meta.expectedType === 'object' && (value == null || typeof value !== 'object' || Array.isArray(value))) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'settings key "' + key + '" expects object', retryable: false } };
        }
        return this._storage.rawSet(key, value);
    };

    /**
     * 移除（恢复默认）
     */
    SettingsRepository.prototype.remove = function (key) {
        if (!this._keys[key]) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'unmanaged settings key: ' + key, retryable: false } };
        }
        return this._storage.rawRemove(key);
    };

    /* ---------- 聚合读写 ---------- */

    /** 把所有受管键读出来，返回 { key: value, ... } */
    SettingsRepository.prototype.list = function () {
        var self = this;
        var out = {};
        var errors = [];
        Object.keys(this._keys).forEach(function (k) {
            var r = self.get(k);
            if (r.ok) out[k] = r.value;
            else errors.push({ key: k, error: r.error });
        });
        return { ok: true, value: out,
            meta: { count: Object.keys(this._keys).length, errors: errors } };
    };

    /** 批量 set；任一失败时已写入的不回滚（尽力而为） */
    SettingsRepository.prototype.saveMany = function (pairs) {
        var self = this;
        var results = [];
        Object.keys(pairs || {}).forEach(function (k) {
            results.push({ key: k, result: self.set(k, pairs[k]) });
        });
        var allOk = true;
        for (var i = 0; i < results.length; i++) { if (!results[i].result.ok) allOk = false; }
        return { ok: allOk, value: results };
    };

    /* ---------- migrate（空实现：标量无 revision） ---------- */

    SettingsRepository.prototype.migrate = function () {
        return { ok: true, value: { migrated: false, reason: 'scalar settings do not need migration' } };
    };

    /* ---------- 导出 ---------- */

    _PS.SettingsRepository = SettingsRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.settings = function (storage) { return new SettingsRepository(storage); };

})(window);
