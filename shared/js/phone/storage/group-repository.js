/* ============================================================
 * group-repository.js  —— 群组（Group）仓储
 *
 * 底层存储：phone_groups  (数组，整数组读写)
 * 字段保留：id / name / avatar / members / description / createdAt / updatedAt /
 *           revision / schemaVersion ... 原有字段一律不删减。
 *
 * migrate 0 → 1：补齐生命周期，策略同 CharacterRepository。
 * 与 CharacterRepository 基本一致，仅键名和领域快捷方法不同。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[GroupRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY = 'phone_groups';

    function GroupRepository(storage) {
        _BASE.call(this, {
            key: KEY,
            schemaVersion: 1,
            idField: 'id',
            storage: storage || _PS.result
        });
    }
    GroupRepository.prototype = Object.create(_BASE.prototype);
    GroupRepository.prototype.constructor = GroupRepository;

    /* ---------- 领域快捷方法 ---------- */

    /** 按 name 查 */
    GroupRepository.prototype.getByName = function (name) {
        var r = this._readDomain();
        if (!r.ok) return r;
        var target = (name || '').trim().toLowerCase();
        for (var i = 0; i < r.value.length; i++) {
            var g = r.value[i];
            if (g && (g.name || '').trim().toLowerCase() === target) {
                return { ok: true, value: g, meta: { found: true } };
            }
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'group not found by name: ' + name, retryable: false } };
    };

    /** 列出某成员所在的所有群（memberId 可能是角色 id 或玩家 id） */
    GroupRepository.prototype.listByMember = function (memberId) {
        var r = this._readDomain();
        if (!r.ok) return r;
        var out = [];
        for (var i = 0; i < r.value.length; i++) {
            var g = r.value[i];
            if (!g || !Array.isArray(g.members)) continue;
            for (var j = 0; j < g.members.length; j++) {
                if (g.members[j] === memberId) { out.push(g); break; }
            }
        }
        return { ok: true, value: out, meta: { count: out.length } };
    };

    /* ---------- migrate 0 → 1 ---------- */

    GroupRepository.prototype.migrate = function (fromVersion) {
        if (fromVersion >= 1) {
            return { ok: true, value: { migrated: false, reason: 'already migrated' } };
        }
        var r = this._readDomain();
        if (!r.ok) {
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

    _PS.GroupRepository = GroupRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.groups = function (storage) { return new GroupRepository(storage); };

})(window);
