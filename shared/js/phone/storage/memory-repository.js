/* ============================================================
 * memory-repository.js  —— 记忆（chat memories）仓储
 *
 * 底层存储：chat_memories_<contactId>  (per-contact，整数组读写)
 *   contactId = 角色 id
 *
 * 条目结构：历史上已有 { text, summary, tag, createdAt, ... } 等字段，
 *   本 Repository 只做透传，不规定、不裁剪任何字段。
 *
 * 与基类的差异：同 ConversationRepository ——
 *   per-contact 键动态拼接，override _readDomain / _writeDomain，
 *   所有公开方法带 contactId 第一参数。
 *
 * migrate 0 → 1：补齐 lifecycle 字段（若缺失），策略同 CharacterRepository。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[MemoryRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY_PREFIX = 'chat_memories_';

    function MemoryRepository(storage) {
        _BASE.call(this, {
            key: KEY_PREFIX + '__template__',
            schemaVersion: 1,
            idField: 'id',
            storage: storage || _PS.result
        });
    }
    MemoryRepository.prototype = Object.create(_BASE.prototype);
    MemoryRepository.prototype.constructor = MemoryRepository;

    function _key(contactId) { return KEY_PREFIX + contactId; }

    MemoryRepository.prototype._readDomain = function () {
        return { ok: false, error: { code: 'VALIDATION_FAILED',
            message: 'MemoryRepository: use methods with contactId', retryable: false } };
    };
    MemoryRepository.prototype._writeDomain = function () {
        return this._readDomain();
    };

    /* ---------- 按 contactId 读取 ---------- */

    MemoryRepository.prototype.readMemories = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        var r = this._storage.rawGet(_key(contactId), 'array');
        if (r.ok) return r;
        if (r.error && r.error.code === 'NOT_FOUND') {
            return { ok: true, value: [], meta: { found: false, contactId: contactId } };
        }
        return r;
    };

    /* ---------- 领域 API ---------- */

    MemoryRepository.prototype.list = function (contactId) {
        return this.readMemories(contactId);
    };

    MemoryRepository.prototype.save = function (contactId, list) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        if (!Array.isArray(list)) list = [];
        return this._storage.rawSet(_key(contactId), list);
    };

    MemoryRepository.prototype.saveMemory = function (contactId, memory, expectedRevision) {
        // 单条保存：读 → 查同 id → 乐观锁 → 覆盖 → 写回
        var self = this;
        if (!memory || typeof memory !== 'object') {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'memory must be object', retryable: false } };
        }
        var id = memory.id;
        if (id == null) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'memory.id is required', retryable: false } };
        }

        var r = this.readMemories(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var arr = r.ok ? r.value.slice() : [];

        var foundIdx = -1;
        var existingRev = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].id === id) {
                foundIdx = i;
                existingRev = arr[i].revision != null ? arr[i].revision : 0;
                break;
            }
        }

        if (foundIdx >= 0 && expectedRevision != null && existingRev !== expectedRevision) {
            return { ok: false, error: {
                code: 'CONFLICT',
                message: 'revision mismatch: expected ' + expectedRevision +
                         ', actual ' + existingRev,
                retryable: false
            }, meta: { contactId: contactId, memoryId: id, actualRevision: existingRev } };
        }

        var now = Date.now();
        var toSave = JSON.parse(JSON.stringify(memory));
        if (foundIdx >= 0) {
            if (toSave.createdAt == null) toSave.createdAt = arr[foundIdx].createdAt || now;
            toSave.updatedAt = now;
            toSave.revision = (existingRev || 0) + 1;
        } else {
            if (toSave.createdAt == null) toSave.createdAt = now;
            toSave.updatedAt = now;
            toSave.revision = 0;
        }
        toSave.schemaVersion = 1;

        if (foundIdx >= 0) arr[foundIdx] = toSave;
        else arr.push(toSave);

        var wr = this.save(contactId, arr);
        if (!wr.ok) return wr;

        return { ok: true, value: toSave,
            meta: { saved: true, isNew: foundIdx < 0, contactId: contactId } };
    };

    MemoryRepository.prototype.removeMemory = function (contactId, memoryId) {
        var r = this.readMemories(contactId);
        if (!r.ok) return r;
        var arr = r.value;
        var found = false;
        var filtered = arr.filter(function (m) {
            if (m && m.id === memoryId) { found = true; return false; }
            return true;
        });
        if (!found) {
            return { ok: false, error: { code: 'NOT_FOUND',
                message: 'memory not found: ' + memoryId, retryable: false } };
        }
        return this.save(contactId, filtered);
    };

    MemoryRepository.prototype.remove = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        return this._storage.rawRemove(_key(contactId));
    };

    MemoryRepository.prototype.clearScope = function (contactId) {
        return this.remove(contactId);
    };

    /* ---------- override update / import / export ---------- */

    /**
     * 局部更新：按 memory id 找到那条记忆，把 patch 合并进去并写回。
     * 签名：update(contactId, memoryId, patch, expectedRevision?)
     */
    MemoryRepository.prototype.update = function (contactId, memoryId, patch, expectedRevision) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.update: contactId is required', retryable: false,
                hint: '正确签名是 update(contactId, memoryId, patch, expectedRevision?)' } };
        }
        if (memoryId == null) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.update: memoryId is required', retryable: false,
                hint: '正确签名是 update(contactId, memoryId, patch, expectedRevision?)' } };
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.update: patch must be non-null object', retryable: false } };
        }

        var r = this.readMemories(contactId);
        if (!r.ok) return r;
        var arr = r.value;
        var foundIdx = -1;
        var existingRev = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].id === memoryId) {
                foundIdx = i;
                existingRev = arr[i].revision != null ? arr[i].revision : 0;
                break;
            }
        }

        if (foundIdx < 0) {
            return { ok: false, error: { code: 'NOT_FOUND',
                message: 'memory not found: ' + memoryId, retryable: false } };
        }

        if (expectedRevision != null && existingRev !== expectedRevision) {
            return { ok: false, error: {
                code: 'CONFLICT',
                message: 'revision mismatch: expected ' + expectedRevision +
                         ', actual ' + existingRev,
                retryable: false
            }, meta: { contactId: contactId, memoryId: memoryId, actualRevision: existingRev } };
        }

        var merged = JSON.parse(JSON.stringify(arr[foundIdx]));
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        merged.id = memoryId;
        merged.updatedAt = Date.now();
        merged.revision = existingRev + 1;

        arr[foundIdx] = merged;
        var wr = this.save(contactId, arr);
        if (!wr.ok) return wr;

        return { ok: true, value: merged,
            meta: { updated: true, index: foundIdx, contactId: contactId } };
    };

    MemoryRepository.prototype.export = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.export: contactId is required', retryable: false,
                hint: '正确签名是 export(contactId)' } };
        }
        var r = this.readMemories(contactId);
        if (!r.ok) return r;
        return { ok: true, value: {
            contactId: contactId,
            key: _key(contactId),
            schemaVersion: this._schemaVersion,
            items: r.value
        }, meta: { count: r.value.length } };
    };

    MemoryRepository.prototype.import = function (contactId, data, overwrite) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.import: contactId is required', retryable: false,
                hint: '正确签名是 import(contactId, data, overwrite?)' } };
        }
        var items;
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.items)) {
            items = data.items;
        } else {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'MemoryRepository.import: data must be array or { items: [...] }',
                retryable: false } };
        }

        if (overwrite) {
            var wr = this.save(contactId, items.slice());
            if (!wr.ok) return wr;
            return { ok: true, value: { imported: items.length, overwrite: true, contactId: contactId } };
        }

        var r = this.readMemories(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var existing = r.ok ? r.value.slice() : [];
        var map = {};
        existing.forEach(function (m) { if (m && m.id != null) map[m.id] = m; });
        items.forEach(function (m) { if (m && m.id != null) map[m.id] = m; });
        var merged = [];
        existing.forEach(function (m) {
            if (m && m.id != null && map[m.id]) { merged.push(map[m.id]); delete map[m.id]; }
        });
        Object.keys(map).forEach(function (id) { merged.push(map[id]); });

        var wr2 = this.save(contactId, merged);
        if (!wr2.ok) return wr2;
        return { ok: true, value: { imported: items.length, mergedInto: merged.length,
            overwrite: false, contactId: contactId } };
    };

    /* ---------- migrate 0 → 1 ---------- */

    MemoryRepository.prototype.migrate = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        var r = this.readMemories(contactId);
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
        var wr = this.save(contactId, list);
        if (!wr.ok) return wr;
        return { ok: true, value: { migrated: true, migratedCount: migratedCount },
            meta: { contactId: contactId } };
    };

    /* ---------- 导出 ---------- */

    _PS.MemoryRepository = MemoryRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.memories = function (storage) { return new MemoryRepository(storage); };

})(window);
