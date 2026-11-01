/* ============================================================
 * character-repository.js  —— 角色（Character）仓储
 *
 * 底层存储：ai_custom_characters  (数组，整数组读写)
 * 字段保留：name / avatar / description / persona / greeting /
 *           tags / createdAt / updatedAt / revision / schemaVersion ...
 *           原有字段一律不删减，只在缺失时补齐生命周期。
 *
 * 生命周期补齐规则（migrate 0 → 1）：
 *   - createdAt：若缺失，统一补为 0（"历史数据"占位，调用方可按 updatedAt 兜底）
 *   - updatedAt：若缺失，同上，补为 0
 *   - revision：若缺失，补为 0
 *   - schemaVersion：一律补为 1
 *   若域不存在或已经有至少一条记录带 schemaVersion >= 1，跳过迁移。
 *
 * 本文件仅做读写、校验、迁移，不弹 toast、不碰布局。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[CharacterRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY = 'ai_custom_characters';

    function CharacterRepository(storage) {
        _BASE.call(this, {
            key: KEY,
            schemaVersion: 1,
            idField: 'id',
            storage: storage || _PS.result
        });
    }
    CharacterRepository.prototype = Object.create(_BASE.prototype);
    CharacterRepository.prototype.constructor = CharacterRepository;

    /* ---------- 领域快捷方法 ---------- */

    /** 按 name 查（大小写不敏感 trim） */
    CharacterRepository.prototype.getByName = function (name) {
        var r = this._readDomain();
        if (!r.ok) return r;
        var target = (name || '').trim().toLowerCase();
        for (var i = 0; i < r.value.length; i++) {
            var c = r.value[i];
            if (c && (c.name || '').trim().toLowerCase() === target) {
                return { ok: true, value: c, meta: { found: true } };
            }
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'character not found by name: ' + name, retryable: false } };
    };

    /** 返回 id → entity 的映射表（方便外部按 id 快速查） */
    CharacterRepository.prototype.idMap = function () {
        var r = this._readDomain();
        if (!r.ok) return r;
        var map = {};
        for (var i = 0; i < r.value.length; i++) {
            var c = r.value[i];
            if (c && c.id != null) map[c.id] = c;
        }
        return { ok: true, value: map, meta: { count: r.value.length } };
    };

    /* ---------- migrate 0 → 1 ---------- */

    CharacterRepository.prototype.migrate = function (fromVersion) {
        if (fromVersion >= 1) {
            return { ok: true, value: { migrated: false, reason: 'already migrated' } };
        }
        var self = this;
        var r = this._readDomain();
        if (!r.ok) {
            // NOT_FOUND 视为无需迁移，其他错误透传
            if (r.error && r.error.code === 'NOT_FOUND') {
                return { ok: true, value: { migrated: false, reason: 'domain empty' } };
            }
            return r;
        }

        var list = r.value;
        var migratedCount = 0;
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (!e || typeof e !== 'object') continue;
            // 跳过条件收紧：必须同时具备 schemaVersion >= 1 且三字段都不缺
            if (e.schemaVersion != null && e.schemaVersion >= 1 &&
                e.createdAt != null && e.updatedAt != null && e.revision != null) {
                continue;
            }
            if (e.createdAt == null) e.createdAt = 0;
            if (e.updatedAt == null) e.updatedAt = 0;
            if (e.revision == null) e.revision = 0;
            e.schemaVersion = 1;
            migratedCount++;
        }

        if (migratedCount === 0) {
            return { ok: true, value: { migrated: false, reason: 'all records already migrated' } };
        }

        var wr = this._writeDomain(list);
        if (!wr.ok) return wr;

        return { ok: true, value: { migrated: true, migratedCount: migratedCount },
            meta: { key: KEY } };
    };

    /* ---------- 导出 ---------- */

    _PS.CharacterRepository = CharacterRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.characters = function (storage) { return new CharacterRepository(storage); };

})(window);
