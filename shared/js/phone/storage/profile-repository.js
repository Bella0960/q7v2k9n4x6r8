/* ============================================================
 * profile-repository.js  —— 玩家 Profile（单对象）仓储
 *
 * 底层存储：myProfile  (单对象，整数组读写不适用，override _readDomain/_writeDomain)
 * 字段保留：nickname / name / avatar / about / persona / createdAt / updatedAt / revision /
 *           schemaVersion ... 原有字段一律不删减。
 *
 * 与基类的差异：
 *   - 基类默认 _readDomain / _writeDomain 按"数组域"处理；
 *     Profile 是单对象，必须 override 这两个方法。
 *   - list() 语义上等于 get()（只有一个 profile），基类的 get(id) 在这里返回"不存在"是正常的。
 *   - save 不是"替换域中的一个元素"，而是"整对象覆盖写回"——本类 override save。
 *
 * migrate 0 → 1：同 CharacterRepository 补齐生命周期。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[ProfileRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY = 'myProfile';

    function ProfileRepository(storage) {
        _BASE.call(this, {
            key: KEY,
            schemaVersion: 1,
            idField: 'id',   // 保留但实际上 profile 没有 id 字段
            storage: storage || _PS.result
        });
    }
    ProfileRepository.prototype = Object.create(_BASE.prototype);
    ProfileRepository.prototype.constructor = ProfileRepository;

    /* ---------- override：单对象域读写 ---------- */

    ProfileRepository.prototype._readDomain = function () {
        var r = this._storage.rawGet(this._key, 'object');
        if (r.ok) return r;
        if (r.error && r.error.code === 'NOT_FOUND') {
            // 单对象域"不存在"→ 返回 null，list() 等方法据此判断
            return { ok: true, value: null, meta: { found: false, source: this._key } };
        }
        return r;
    };

    ProfileRepository.prototype._writeDomain = function (obj) {
        return this._storage.rawSet(this._key, obj);
    };

    /* ---------- override：list / get / save / remove ---------- */

    // list() → 返回唯一的 profile 对象（或 null），基类默认把 _readDomain 当数组用，这里改返回值
    ProfileRepository.prototype.list = function () {
        return this._readDomain();
    };

    // get(id) 对单对象域没有意义，直接返回 NOT_FOUND
    ProfileRepository.prototype.get = function (id) {
        return { ok: false, error: { code: 'NOT_FOUND',
            message: 'profile is single-object domain; use getProfile()', retryable: false } };
    };

    /** 单对象的快捷读取 */
    ProfileRepository.prototype.getProfile = function () {
        return this._readDomain();
    };

    // save：整对象覆盖写回，不做数组替换
    ProfileRepository.prototype.save = function (entity, expectedRevision) {
        var self = this;
        if (!entity || typeof entity !== 'object') {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'entity must be object', retryable: false } };
        }

        var cur = this._readDomain();
        if (!cur.ok && !(cur.error && cur.error.code === 'NOT_FOUND')) return cur;

        var existing = cur.ok ? cur.value : null;
        var existingRev = existing && existing.revision != null ? existing.revision : 0;

        // 乐观锁
        if (expectedRevision != null && existingRev !== expectedRevision) {
            return { ok: false, error: {
                code: 'CONFLICT',
                message: 'revision mismatch: expected ' + expectedRevision +
                         ', actual ' + existingRev,
                retryable: false
            }, meta: { domain: self._key, actualRevision: existingRev } };
        }

        var isNew = !existing;
        var toSave = JSON.parse(JSON.stringify(entity));
        self._applyTimestamps(toSave, isNew);

        var wr = this._writeDomain(toSave);
        if (!wr.ok) return wr;

        return { ok: true, value: toSave,
            meta: { saved: true, isNew: isNew, domain: self._key } };
    };

    // remove：清空整个 myProfile 对象
    ProfileRepository.prototype.remove = function () {
        return this._storage.rawRemove(this._key);
    };

    // clearScope：同 remove
    ProfileRepository.prototype.clearScope = function () {
        return this.remove();
    };

    /* ---------- migrate 0 → 1 ---------- */

    ProfileRepository.prototype.migrate = function (fromVersion) {
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
        var entity = r.value;
        if (!entity) {
            return { ok: true, value: { migrated: false, reason: 'domain null' } };
        }
        if (entity.schemaVersion != null && entity.schemaVersion >= 1) {
            return { ok: true, value: { migrated: false, reason: 'already migrated' } };
        }

        var changed = false;
        if (entity.createdAt == null) { entity.createdAt = 0; changed = true; }
        if (entity.updatedAt == null) { entity.updatedAt = 0; changed = true; }
        if (entity.revision == null)  { entity.revision  = 0; changed = true; }
        entity.schemaVersion = 1;

        if (!changed) {
            return { ok: true, value: { migrated: false, reason: 'nothing to fill' } };
        }

        var wr = this._writeDomain(entity);
        if (!wr.ok) return wr;
        return { ok: true, value: { migrated: true, migratedCount: 1 },
            meta: { key: KEY } };
    };

    /* ---------- 导出 ---------- */

    _PS.ProfileRepository = ProfileRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.profile = function (storage) { return new ProfileRepository(storage); };

})(window);
