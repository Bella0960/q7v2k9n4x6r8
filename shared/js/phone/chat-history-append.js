/*
 * ChatHistoryAppend —— 追加单条聊天消息的统一入口。
 *
 * 只做一件事：把「追加一条消息」收敛到一个地方，内部复用
 * ChatHistoryAtomic（Web Locks 串行化 + mid 去重 + 写后读回）。
 *
 * 约定：
 *   - 主键 chat_history_<id> 不存在时，先用 PhoneStorage.getChatHistory() 取出
 *     旧 phone_data_v2 副本当种子，再以「主键必须缺失」为前置条件创建，
 *     不把老会话覆盖成只剩这条新消息。
 *   - Web Locks 不可用（LOCK_UNAVAILABLE）、账号作用域未就绪等情况一律返回失败，
 *     调用方必须明确提示用户，禁止退回整表覆盖写入。
 *   - 返回 { ok: true, created } 或 { ok: false, reason }，不抛异常。
 */
(function (global) {
    'use strict';

    function failure(reason) { return { ok: false, reason: reason }; }

    function presentIn(history, mid) {
        if (!Array.isArray(history)) return false;
        for (var i = 0; i < history.length; i++) {
            var item = history[i];
            if (item && item.mid != null && String(item.mid) === String(mid)) return true;
        }
        return false;
    }

    // 读取当前历史：主键缺失时 PhoneStorage 会回退到 phone_data_v2 旧副本。
    function readHistory(roleId) {
        var storage = global.PhoneStorage;
        if (!storage || typeof storage.getChatHistory !== 'function') return null;
        var history;
        try { history = storage.getChatHistory(roleId); } catch (e) { return null; }
        return Array.isArray(history) ? history : null;
    }

    // 只确认这条消息（mid）确实落盘，不比较整表长度：别的标签页同时追加
    // 会让长度断言误报失败。
    function verify(roleId, message) {
        var storage = global.PhoneStorage;
        if (!storage || typeof storage.getChatHistory !== 'function') return true;
        return presentIn(readHistory(roleId), message.mid);
    }

    function appendOrCreate(roleId, message) {
        var atomic = global.ChatHistoryAtomic;
        if (!atomic || typeof atomic.appendIf !== 'function') {
            return Promise.resolve(failure('ATOMIC_UNAVAILABLE'));
        }
        if (typeof roleId !== 'string' || !roleId.trim()) return Promise.resolve(failure('VALIDATION_FAILED'));
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return Promise.resolve(failure('VALIDATION_FAILED'));
        }

        var attempts = 0;
        function attempt() {
            attempts += 1;
            return atomic.appendIf(roleId, message).then(function (outcome) {
                if (outcome && outcome.ok) {
                    return verify(roleId, message) ? { ok: true, created: false } : failure('VERIFY_FAILED');
                }
                var code = outcome && outcome.error ? outcome.error.code : 'APPEND_FAILED';
                if (code === 'CONFLICT' && attempts < 2) return attempt();
                if (code !== 'NOT_FOUND') return failure(code);

                var legacy = readHistory(roleId);
                if (legacy === null) return failure('LEGACY_UNREADABLE');
                var storage = global.PhoneStorage;
                if (!storage || !storage.result ||
                    typeof storage.result.saveChatHistory !== 'function') {
                    return failure('CREATE_UNAVAILABLE');
                }
                var created = storage.result.saveChatHistory(roleId, legacy.concat([message]), null);
                if (created && created.ok) {
                    return verify(roleId, message) ? { ok: true, created: true } : failure('VERIFY_FAILED');
                }
                var createCode = created && created.error ? created.error.code : 'CREATE_FAILED';
                if (createCode === 'CONFLICT' && attempts < 2) return attempt();
                return failure(createCode);
            }, function () {
                return failure('APPEND_FAILED');
            });
        }
        return attempt();
    }

    global.ChatHistoryAppend = { appendOrCreate: appendOrCreate };
})(window);
