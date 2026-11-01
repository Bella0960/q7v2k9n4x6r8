/* ============================================================
 * worldbook-repository.js  —— 世界书（Worldbook）仓储
 *
 * 两个存储域，边界如下：
 *   1. phone_worldbooks            → 全局世界书定义（数组域，整仓储级）
 *      每条世界书 { id, name, description, entries:[...], ... }
 *      entries 的内部结构由业务定义，本 Repository 不裁剪。
 *
 *   2. chat_worldbooks_<contactId>  → 角色/会话级的世界书挂载关系
 *      { worldbookIds: [ 'wb_1', 'wb_2' ], enabled: true, ... }
 *      或简化为 [ 'wb_1', 'wb_2' ]（数组形式也可）。
 *      本 Repository 只存储 id 引用，不复制世界书内容——
 *      世界书内容改动后，挂载关系不受影响（引用式关联）。
 *      此键目前 grep 未在其他 JS 文件发现调用（属于预留结构），
 *      本 Repository 负责提前建立安全的读写接口，避免将来直接裸写 localStorage。
 *
 * 为什么分两个域：
 *   - 全局世界书定义是"主数据"，所有角色共享；
 *   - 每个角色/会话挂载哪些世界书是"关系数据"，per-contact 独一份；
 *   - 二者独立读写、独立迁移，互不阻塞。
 *
 * 与基类的差异：
 *   - 基类默认按"一个 key 一个数组域"工作，本 Repository 的"全局定义域"
 *     完全符合基类假设，直接继承即可；
 *   - "挂载关系域"是 per-contact 的，需要 override 或单独方法，
 *     做法同 ConversationRepository / MemoryRepository。
 *
 * migrate 0 → 1：同 CharacterRepository，补齐 worldbook 定义的 lifecycle 字段。
 *   挂载关系域因为是引用列表（标量 id 数组），不需要 migration。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[WorldbookRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY_DEFS = 'phone_worldbooks';
    var KEY_PREFIX_BIND = 'chat_worldbooks_';

    /* ---------- 全局定义域（继承基类） ---------- */

    function WorldbookRepository(storage) {
        _BASE.call(this, {
            key: KEY_DEFS,
            schemaVersion: 1,
            idField: 'id',
            storage: storage || _PS.result
        });
    }
    WorldbookRepository.prototype = Object.create(_BASE.prototype);
    WorldbookRepository.prototype.constructor = WorldbookRepository;

    function _bindKey(contactId) { return KEY_PREFIX_BIND + contactId; }

    /* ---------- 领域快捷方法 ---------- */

    /** 按 name 查 */
    WorldbookRepository.prototype.getByName = function (name) {
        var r = this._readDomain();
        if (!r.ok) return r;
        var target = (name || '').trim().toLowerCase();
        for (var i = 0; i < r.value.length; i++) {
            var wb = r.value[i];
            if (wb && (wb.name || '').trim().toLowerCase() === target) {
                return { ok: true, value: wb, meta: { found: true } };
            }
        }
        return { ok: false, error: { code: 'NOT_FOUND',
            message: 'worldbook not found by name: ' + name, retryable: false } };
    };

    /* ---------- 挂载关系域 ---------- */

    /**
     * 读某 contactId 的世界书挂载关系。
     * 返回引用数组（id 字符串数组），不是世界书对象。
     * 如果存储结构是对象（如 { worldbookIds: [...] }），统一降级为数组返回。
     */
    WorldbookRepository.prototype.getBindings = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        var r = this._storage.rawGet(_bindKey(contactId));
        if (!r.ok) {
            if (r.error && r.error.code === 'NOT_FOUND') {
                return { ok: true, value: [], meta: { found: false, contactId: contactId } };
            }
            return r;
        }
        var val = r.value;
        // 兼容：可能是数组，也可能是 { worldbookIds: [...] } 对象
        if (Array.isArray(val)) return { ok: true, value: val, meta: r.meta };
        if (val && Array.isArray(val.worldbookIds)) {
            return { ok: true, value: val.worldbookIds, meta: r.meta };
        }
        // 其他情况（空对象、字符串）视为损坏
        return { ok: false, error: { code: 'CORRUPT_DATA',
            message: 'unexpected bindings shape for ' + contactId, retryable: false },
            meta: r.meta };
    };

    /** 覆盖写挂载关系（数组形式） */
    WorldbookRepository.prototype.saveBindings = function (contactId, worldbookIds) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        var arr = Array.isArray(worldbookIds) ? worldbookIds.slice() : [];
        return this._storage.rawSet(_bindKey(contactId), arr);
    };

    /** 追加一个 worldbookId 到挂载列表（去重） */
    WorldbookRepository.prototype.addBinding = function (contactId, worldbookId) {
        if (!worldbookId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'worldbookId is required', retryable: false } };
        }
        var r = this.getBindings(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var arr = r.ok ? r.value.slice() : [];
        if (arr.indexOf(worldbookId) !== -1) {
            return { ok: true, value: arr, meta: { alreadyBound: true } };
        }
        arr.push(worldbookId);
        return this.saveBindings(contactId, arr);
    };

    /** 从挂载列表移除 */
    WorldbookRepository.prototype.removeBinding = function (contactId, worldbookId) {
        var r = this.getBindings(contactId);
        if (!r.ok) return r;
        var arr = r.value;
        var idx = arr.indexOf(worldbookId);
        if (idx === -1) {
            return { ok: true, value: arr, meta: { notBound: true } };
        }
        var filtered = arr.filter(function (x) { return x !== worldbookId; });
        return this.saveBindings(contactId, filtered);
    };

    /** 清空某 contactId 的挂载关系 */
    WorldbookRepository.prototype.clearBindings = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        return this._storage.rawRemove(_bindKey(contactId));
    };

    /* ---------- migrate 0 → 1 ---------- */

    WorldbookRepository.prototype.migrate = function (fromVersion) {
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
            meta: { key: KEY_DEFS } };
    };

    /* ---------- 导出 ---------- */

    _PS.WorldbookRepository = WorldbookRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.worldbooks = function (storage) { return new WorldbookRepository(storage); };

})(window);
