/* ============================================================
 * repository.js  ——  存储层通用 Repository 基类
 *
 * 职责：
 *   对某一实体域（characters / groups / conversations / worldbooks ...）
 *   提供统一的 get / list / save / update / remove / clearScope /
 *   export / import / migrate 接口，内置 schemaVersion / revision /
 *   createdAt / updatedAt 生命周期字段与乐观锁（expectedRevision）。
 *
 * 本基类只管读写校验与持久化，不做 UI、不弹 toast、不碰布局。
 * 所有方法返回 PhoneStorage.result 协议对象：
 *   { ok: true, value, meta: {...} }
 *   { ok: false, error: { code, message, retryable }, meta?: {...} }
 *
 * 持久化默认通过 PhoneStorage.result 完成；若调用方注入了不同的
 * storage 引擎（例如将来上 IndexedDB 或远程同步），基类不关心。
 *
 * 被谁引用：预期下一阶段的 CharactersRepository / GroupsRepository /
 *   ConversationRepository / WorldbooksRepository 继承本类。
 *
 *   var repo = new Repository({
 *       key: 'ai_custom_characters',
 *       schemaVersion: 1,
 *       idField: 'id',
 *       storage: PhoneStorage.result
 *   });
 *
 *   var r = repo.list();       // → { ok, value, meta }
 *   var s = repo.save(entity); // → { ok, value: savedEntity }
 *   var u = repo.save(entity, expectedRevision); // 乐观锁
 *
 * ============================================================ */

(function (global) {
    'use strict';

    // 依赖 PhoneStorage.result；如果缺失（极端情况），降级到旧接口。
    var _PS = global.PhoneStorage || {};
    var _R = _PS.result;

    /* ---------- 构造 ---------- */

    /**
     * @param {object} options
     * @param {string} options.key            - localStorage 键名（必填）
     * @param {number} [options.schemaVersion] - schema 版本号，默认 1
     * @param {string} [options.idField]       - 实体 id 字段名，默认 'id'
     * @param {object} [options.storage]       - 结果式存储引擎，默认 PhoneStorage.result
     */
    function Repository(options) {
        options = options || {};
        if (!options.key) {
            throw new Error('Repository: key is required');
        }
        this._key = options.key;
        this._schemaVersion = options.schemaVersion || 1;
        this._idField = options.idField || 'id';
        this._storage = options.storage || _R;

        // 校验 storage 引擎最基本的方法存在
        if (!this._storage || typeof this._storage.rawGet !== 'function') {
            // 降级：允许在 PhoneStorage 本身存在时构造（虽然会在调用方法时失败，
            // 但给调用方留下了注入 storage 的灵活性）
            this._storage = null;
        }
    }

    /* ---------- 私有工具 ---------- */

    function _now() { return Date.now(); }

    // 浅克隆一个对象（不处理 Date / RegExp 等）
    function _clone(obj) {
        if (obj == null) return obj;
        if (typeof obj !== 'object') return obj;
        return JSON.parse(JSON.stringify(obj));
    }

    // 给实体补全生命周期字段（在保存前调用）
    Repository.prototype._applyTimestamps = function (entity, isNew) {
        var now = _now();
        if (isNew || entity.createdAt == null) entity.createdAt = now;
        entity.updatedAt = now;
        entity.revision = (entity.revision == null ? 0 : entity.revision + 1);
        entity.schemaVersion = this._schemaVersion;
        return entity;
    };

    // 从存储中读取整个域的数据。基类默认约定：每个 key 存一个数组。
    // 将来如果某实体域需要单对象存储（比如 settings），子类可 override。
    Repository.prototype._readDomain = function () {
        var self = this;
        if (!this._storage) {
            return { ok: false, error: { code: 'DB_UNAVAILABLE', message: 'no storage engine', retryable: true } };
        }
        var r = this._storage.rawGet(this._key, 'array');
        if (r.ok) return r;
        if (r.error && r.error.code === 'NOT_FOUND') {
            // 域不存在 → 返回空数组，meta 里标记 found:false
            return { ok: true, value: [], meta: { found: false, source: self._key } };
        }
        return r;  // 透传 CORRUPT_DATA / DB_UNAVAILABLE 等
    };

    Repository.prototype._writeDomain = function (list) {
        if (!this._storage) {
            return { ok: false, error: { code: 'DB_UNAVAILABLE', message: 'no storage engine', retryable: true } };
        }
        return this._storage.rawSet(this._key, list);
    };

    /* ---------- 公开方法 ---------- */

    /**
     * 按 id 查询
     */
    Repository.prototype.get = function (id) {
        var self = this;
        var r = this._readDomain();
        if (!r.ok) return r;
        var list = r.value;
        var found = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i][self._idField] === id) {
                found = list[i];
                break;
            }
        }
        if (!found) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'entity not found: ' + id, retryable: false },
                meta: { domain: self._key } };
        }
        return { ok: true, value: found, meta: { found: true, source: self._key } };
    };

    /**
     * 列出全部
     */
    Repository.prototype.list = function () {
        return this._readDomain();
    };

    /**
     * 保存（新增或替换）。
     * @param {object} entity            - 待保存实体（应含 idField）
     * @param {number} [expectedRevision] - 乐观锁：如果提供且域中已存在同 id 实体的 revision 不同，返回 CONFLICT
     */
    Repository.prototype.save = function (entity, expectedRevision) {
        var self = this;
        if (!entity || typeof entity !== 'object') {
            return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'entity must be object', retryable: false } };
        }
        var id = entity[this._idField];
        if (id == null || id === '') {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'entity.' + self._idField + ' is required', retryable: false } };
        }

        var r = this._readDomain();
        if (!r.ok) return r;
        var list = r.value;

        // 查找同 id 已有实体
        var existingIdx = -1;
        var existingRevision = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i][self._idField] === id) {
                existingIdx = i;
                existingRevision = list[i].revision != null ? list[i].revision : 0;
                break;
            }
        }

        // 乐观锁
        if (existingIdx >= 0 && expectedRevision != null) {
            if (existingRevision !== expectedRevision) {
                return { ok: false, error: {
                    code: 'CONFLICT',
                    message: 'revision mismatch: expected ' + expectedRevision +
                             ', actual ' + existingRevision,
                    retryable: false
                }, meta: { domain: self._key, id: id, actualRevision: existingRevision } };
            }
        }

        var isNew = existingIdx < 0;
        var toSave = _clone(entity);
        this._applyTimestamps(toSave, isNew);

        if (isNew) {
            list.push(toSave);
        } else {
            list[existingIdx] = toSave;
        }

        var wr = this._writeDomain(list);
        if (!wr.ok) return wr;

        return { ok: true, value: toSave,
            meta: { saved: true, isNew: isNew, domain: self._key } };
    };

    /**
     * 局部更新（只 patch 指定字段）
     * @param {string} id
     * @param {object} patch
     * @param {number} [expectedRevision]
     */
    Repository.prototype.update = function (id, patch, expectedRevision) {
        var self = this;
        var r = this.get(id);
        if (!r.ok) return r;
        var existing = r.value;

        if (expectedRevision != null && (existing.revision != null ? existing.revision : 0) !== expectedRevision) {
            return { ok: false, error: {
                code: 'CONFLICT',
                message: 'revision mismatch: expected ' + expectedRevision +
                         ', actual ' + (existing.revision != null ? existing.revision : 0),
                retryable: false
            }, meta: { domain: self._key, id: id, actualRevision: existing.revision } };
        }

        var merged = _clone(existing);
        if (patch && typeof patch === 'object') {
            Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        }

        // 移除旧实体，用 save 重新写回去（带 expectedRevision 避免递归冲突）
        var rem = this._removeInDomain(id);
        if (!rem.ok) return rem;

        return this.save(merged);
    };

    // 私有：只从域数组里移除 id，不写存储（供 update 在 save 前用）
    Repository.prototype._removeInDomain = function (id) {
        var self = this;
        var r = this._readDomain();
        if (!r.ok) return r;
        var list = r.value;
        var filtered = list.filter(function (e) { return e && e[self._idField] !== id; });
        return this._writeDomain(filtered);
    };

    /**
     * 删除
     */
    Repository.prototype.remove = function (id) {
        var self = this;
        var r = this._readDomain();
        if (!r.ok) return r;
        var list = r.value;
        var found = false;
        var filtered = list.filter(function (e) {
            if (e && e[self._idField] === id) { found = true; return false; }
            return true;
        });
        if (!found) {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'entity not found: ' + id, retryable: false },
                meta: { domain: self._key } };
        }
        return this._writeDomain(filtered);
    };

    /**
     * 清空整个域
     */
    Repository.prototype.clearScope = function () {
        if (!this._storage) {
            return { ok: false, error: { code: 'DB_UNAVAILABLE', message: 'no storage engine', retryable: true } };
        }
        return this._storage.rawRemove(this._key);
    };

    /**
     * 导出：纯数据（带生命周期字段，便于迁移时用）
     */
    Repository.prototype.export = function () {
        var r = this._readDomain();
        if (!r.ok) return r;
        return { ok: true, value: { key: this._key, schemaVersion: this._schemaVersion, items: r.value },
            meta: { count: r.value.length } };
    };

    /**
     * 导入
     * @param {Array|object} data - 数组或 { items: [...] } 结构
     * @param {boolean} [overwrite] - true 时覆盖现有；false 时合并（同 id 取 data 中版本）
     */
    Repository.prototype.import = function (data, overwrite) {
        var self = this;
        var items;
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.items)) {
            items = data.items;
        } else {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'import data must be array or { items: [...] }', retryable: false } };
        }

        if (overwrite) {
            var wr = this._writeDomain(items.slice());
            if (!wr.ok) return wr;
            return { ok: true, value: { imported: items.length, overwrite: true } };
        }

        // 合并：已存在的 id 被覆盖，不存在的新增
        var r = this._readDomain();
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var existing = r.ok ? r.value : [];
        var map = {};
        existing.forEach(function (e) { if (e) map[e[self._idField]] = e; });
        items.forEach(function (e) { if (e) map[e[self._idField]] = e; });
        var merged = Object.keys(map).map(function (k) { return map[k]; });
        var wr2 = this._writeDomain(merged);
        if (!wr2.ok) return wr2;
        return { ok: true, value: { imported: items.length, mergedInto: merged.length, overwrite: false } };
    };

    /**
     * schema 迁移入口。
     * 子类 override 以提供具体的版本迁移逻辑；基类只做骨架。
     * @param {number} fromVersion - 源 schema 版本
     */
    Repository.prototype.migrate = function (fromVersion) {
        var self = this;
        return { ok: false, error: {
            code: 'VALIDATION_FAILED',
            message: 'migrate not implemented for ' + self._key +
                     ' (from ' + fromVersion + ' to ' + self._schemaVersion + ')',
            retryable: false
        } };
    };

    /* ---------- 静态工厂 ---------- */

    // 便于快速创建：Repository.create({ key: '...', schemaVersion: 1 })
    Repository.create = function (options) {
        return new Repository(options);
    };

    /* ---------- 导出 ---------- */

    global.PhoneStorage = global.PhoneStorage || {};
    global.PhoneStorage.Repository = Repository;
    global.PhoneStorage.repository = {
        // 便捷别名集合：下一阶段各实体域可能常用的配置
        characters: function () { return new Repository({ key: 'ai_custom_characters', schemaVersion: 1 }); },
        groups:     function () { return new Repository({ key: 'phone_groups',         schemaVersion: 1 }); },
        worldbooks: function () { return new Repository({ key: 'phone_worldbooks',     schemaVersion: 1 }); },
        finance:    function () { return new Repository({ key: 'finance_records',        schemaVersion: 1 }); },
        moments:    function () { return new Repository({ key: 'moments',               schemaVersion: 1 }); }
    };

})(window);
