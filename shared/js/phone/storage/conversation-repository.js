/* ============================================================
 * conversation-repository.js  —— 会话（chat history）仓储
 *
 * 底层存储：chat_history_<contactId>  (per-contact，整数组读写)
 *   contactId = 角色 id（单聊）或 group id（群聊，本批不区分，调用方负责传正确 id）
 *
 * 消息结构：本 Repository 不规定、不裁剪、不重写任何消息字段。
 *   历史上已有 mid / type / text / image / audio / transfer / redpacket /
 *   senderRole / senderName / mode / scene / createdAt / ... 等字段，全部原样保留。
 *   saveMessage / appendMessage 只做"把消息 push 到数组末尾并写回"，
 *   不碰任何消息内部字段。
 *
 * 与基类的差异：
 *   - 基类假设"一个 key 对应一个域"；本类是"每个 contactId 一个独立域"，
 *     所以完全 override _readDomain / _writeDomain，用 contactId 动态拼键名。
 *   - 基类的 list() / get(id) 语义变成"列出该 contactId 的全部消息 /
 *     按 mid 查单条消息"。
 *   - clearScope() / remove() 语义变成"删除 chat_history_<contactId> 这个键"。
 *
 * 存储结构说明（本批不改）：
 *   chat_history_<id> = [
 *     { mid, role, sender, type, content, image, audio, ... },
 *     ...
 *   ]
 *   本批不做消息级分桶 / 不做 IndexedDB 迁移 / 不做消息裁剪。
 *   改存储结构留到下一批单独评审。
 *
 * migrate 0 → 1：域是消息数组，每条消息可能没有 schemaVersion 字段；
 *   消息本身不适合带 revision（消息是 append-only 的），本批不改消息粒度。
 *   migrate 返回 "no-op"，调用方感知为 ok:true, migrated:false。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    if (!_BASE) {
        console.warn('[ConversationRepository] Repository base class not loaded; did you forget to load storage/repository.js first?');
        return;
    }

    var KEY_PREFIX = 'chat_history_';

    function ConversationRepository(storage) {
        _BASE.call(this, {
            key: KEY_PREFIX + '__template__',  // 占位 key，实际运行时用 contactId 动态拼接
            schemaVersion: 1,
            idField: 'mid',
            storage: storage || _PS.result
        });
    }
    ConversationRepository.prototype = Object.create(_BASE.prototype);
    ConversationRepository.prototype.constructor = ConversationRepository;

    /* ---------- 私有 ---------- */

    function _key(contactId) { return KEY_PREFIX + contactId; }

    /* ---------- override：per-contact 域读写 ---------- */

    // 基类会调用 this._key 构造键，但我们需要动态 contactId，
    // 所以 override 所有基类方法让它们接受 contactId 作为第一参数。
    // 为避免双写、同时保留基类 _readDomain/_writeDomain 作为底层能力，
    // 基类原型上的方法（list/get/save/remove 等）全部显式 override。

    ConversationRepository.prototype._readDomain = function () {
        // 无 contactId 调用 → 错误
        return { ok: false, error: { code: 'VALIDATION_FAILED',
            message: 'ConversationRepository: use methods with contactId', retryable: false } };
    };
    ConversationRepository.prototype._writeDomain = function () {
        return this._readDomain();
    };

    /* ---------- 按 contactId 读取 ---------- */

    ConversationRepository.prototype.readHistory = function (contactId) {
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

    /** 列出全部消息 */
    ConversationRepository.prototype.list = function (contactId) {
        return this.readHistory(contactId);
    };

    /** 按 mid 查单条消息 */
    ConversationRepository.prototype.get = function (contactId, mid) {
        var r = this.readHistory(contactId);
        if (!r.ok) return r;
        var msgs = r.value;
        for (var i = 0; i < msgs.length; i++) {
            if (msgs[i] && msgs[i].mid === mid) {
                return { ok: true, value: msgs[i], meta: { found: true, index: i } };
            }
        }
        return { ok: false, error: { code: 'NOT_FOUND',
            message: 'message not found: ' + mid, retryable: false } };
    };

    /** 分页读取（最新 pageSize 条） */
    ConversationRepository.prototype.getPage = function (contactId, pageSize, beforeMid) {
        var r = this.readHistory(contactId);
        if (!r.ok) return r;
        var msgs = r.value;
        var size = Math.max(1, pageSize || 50);
        var startIdx = msgs.length;
        if (beforeMid) {
            for (var i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i] && msgs[i].mid === beforeMid) { startIdx = i; break; }
            }
        }
        var end = startIdx;
        startIdx = Math.max(0, startIdx - size);
        var slice = msgs.slice(startIdx, end);
        return { ok: true, value: slice,
            meta: { pageSize: size, total: msgs.length, startIdx: startIdx } };
    };

    /** 保存整段历史（覆盖写） */
    ConversationRepository.prototype.save = function (contactId, history) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        if (!Array.isArray(history)) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'history must be array', retryable: false } };
        }
        return this._storage.rawSet(_key(contactId), history);
    };

    /** 追加单条消息（append-only，符合对话历史的自然语义） */
    ConversationRepository.prototype.appendMessage = function (contactId, message) {
        if (!message || typeof message !== 'object') {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'message must be object', retryable: false } };
        }
        var r = this.readHistory(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var arr = r.ok ? r.value : [];
        arr.push(message);
        var wr = this.save(contactId, arr);
        if (!wr.ok) return wr;
        return { ok: true, value: message, meta: { index: arr.length - 1, total: arr.length } };
    };

    /** 批量追加 */
    ConversationRepository.prototype.appendMessages = function (contactId, messages) {
        if (!Array.isArray(messages)) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'messages must be array', retryable: false } };
        }
        var r = this.readHistory(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var arr = r.ok ? r.value : [];
        for (var i = 0; i < messages.length; i++) arr.push(messages[i]);
        var wr = this.save(contactId, arr);
        if (!wr.ok) return wr;
        return { ok: true, value: { appended: messages.length, total: arr.length } };
    };

    /** 按 mid 移除单条 */
    ConversationRepository.prototype.removeMessage = function (contactId, mid) {
        var r = this.readHistory(contactId);
        if (!r.ok) return r;
        var arr = r.value;
        var found = false;
        var filtered = arr.filter(function (m) {
            if (m && m.mid === mid) { found = true; return false; }
            return true;
        });
        if (!found) {
            return { ok: false, error: { code: 'NOT_FOUND',
                message: 'message not found: ' + mid, retryable: false } };
        }
        return this.save(contactId, filtered);
    };

    /** 删除整个会话的历史 */
    ConversationRepository.prototype.remove = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'contactId is required', retryable: false } };
        }
        return this._storage.rawRemove(_key(contactId));
    };

    ConversationRepository.prototype.clearScope = function (contactId) {
        return this.remove(contactId);
    };

    /* ---------- override update / import / export ---------- */

    /**
     * 局部更新：按 mid 找到那条消息，把 patch 合并进去并写回。
     * 签名与领域方法一致：update(contactId, mid, patch, expectedRevision?)
     * 不再依赖基类 update（基类只传一个 id，per-contact 场景会静默失败）。
     */
    ConversationRepository.prototype.update = function (contactId, mid, patch, expectedRevision) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.update: contactId is required', retryable: false,
                hint: '正确签名是 update(contactId, mid, patch, expectedRevision?)' } };
        }
        if (mid == null) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.update: mid is required', retryable: false,
                hint: '正确签名是 update(contactId, mid, patch, expectedRevision?)' } };
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.update: patch must be non-null object', retryable: false } };
        }

        var r = this.readHistory(contactId);
        if (!r.ok) return r;
        var arr = r.value;
        var foundIdx = -1;
        var existingRev = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].mid === mid) {
                foundIdx = i;
                existingRev = arr[i].revision != null ? arr[i].revision : 0;
                break;
            }
        }

        if (foundIdx < 0) {
            return { ok: false, error: { code: 'NOT_FOUND',
                message: 'message not found: ' + mid, retryable: false } };
        }

        // 乐观锁
        if (expectedRevision != null && existingRev !== expectedRevision) {
            return { ok: false, error: {
                code: 'CONFLICT',
                message: 'revision mismatch: expected ' + expectedRevision +
                         ', actual ' + existingRev,
                retryable: false
            }, meta: { contactId: contactId, mid: mid, actualRevision: existingRev } };
        }

        var merged = JSON.parse(JSON.stringify(arr[foundIdx]));
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        merged.mid = mid;  // 保护 mid 不被 patch 覆盖
        merged.updatedAt = Date.now();
        merged.revision = existingRev + 1;

        arr[foundIdx] = merged;
        var wr = this.save(contactId, arr);
        if (!wr.ok) return wr;

        return { ok: true, value: merged,
            meta: { updated: true, index: foundIdx, contactId: contactId } };
    };

    /**
     * 导出整个会话：export(contactId)
     * 基类 export() 假设 _readDomain() 返回数组，per-contact 场景不适用。
     */
    ConversationRepository.prototype.export = function (contactId) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.export: contactId is required', retryable: false,
                hint: '正确签名是 export(contactId)' } };
        }
        var r = this.readHistory(contactId);
        if (!r.ok) return r;
        return { ok: true, value: {
            contactId: contactId,
            key: _key(contactId),
            schemaVersion: this._schemaVersion,
            items: r.value
        }, meta: { count: r.value.length } };
    };

    /**
     * 导入会话：import(contactId, data, overwrite?)
     * data 可以是数组（直接作为历史）或 { items: [...] } 结构。
     * overwrite=true → 覆盖写；overwrite=false/undefined → 合并（同 mid 取 data 版本）。
     */
    ConversationRepository.prototype.import = function (contactId, data, overwrite) {
        if (!contactId) {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.import: contactId is required', retryable: false,
                hint: '正确签名是 import(contactId, data, overwrite?)' } };
        }
        var items;
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.items)) {
            items = data.items;
        } else {
            return { ok: false, error: { code: 'VALIDATION_FAILED',
                message: 'ConversationRepository.import: data must be array or { items: [...] }',
                retryable: false } };
        }

        if (overwrite) {
            var wr = this.save(contactId, items.slice());
            if (!wr.ok) return wr;
            return { ok: true, value: { imported: items.length, overwrite: true, contactId: contactId } };
        }

        // 合并：已存在的 mid 被 data 覆盖，不存在的新增
        var r = this.readHistory(contactId);
        if (!r.ok && !(r.error && r.error.code === 'NOT_FOUND')) return r;
        var existing = r.ok ? r.value.slice() : [];
        var map = {};
        existing.forEach(function (m) { if (m && m.mid != null) map[m.mid] = m; });
        items.forEach(function (m) { if (m && m.mid != null) map[m.mid] = m; });
        // 保持原有顺序：先 existing 的位置，再追加新的
        var merged = [];
        existing.forEach(function (m) {
            if (m && m.mid != null && map[m.mid]) { merged.push(map[m.mid]); delete map[m.mid]; }
        });
        Object.keys(map).forEach(function (mid) { merged.push(map[mid]); });

        var wr2 = this.save(contactId, merged);
        if (!wr2.ok) return wr2;
        return { ok: true, value: { imported: items.length, mergedInto: merged.length,
            overwrite: false, contactId: contactId } };
    };

    /* ---------- migrate（空实现） ---------- */

    ConversationRepository.prototype.migrate = function () {
        return { ok: true, value: { migrated: false,
            reason: 'conversation messages are append-only; no schema migration needed yet' } };
    };

    /* ---------- 导出 ---------- */

    _PS.ConversationRepository = ConversationRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.conversations = function (storage) { return new ConversationRepository(storage); };

})(window);
