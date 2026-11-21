/*
 * ChatHistoryAppend —— 追加单条聊天消息的统一入口。
 *
 * 只做一件事：把「追加一条消息（必要时先创建主键）」收敛到一个地方，
 * 全部工作交给 ChatHistoryAtomic.appendOrCreateIfMissing 在同一把会话锁内完成：
 *
 *   锁内读取主键（缺失则读旧 phone_data_v2 副本）→ mid 去重 → 写入 → 读回校验
 *
 * 因此本文件不再持有任何「锁外补写」的路径：
 *   - 主键缺失时不再调用 appendIf 再自行创建；appendIf 的 NOT_FOUND 语义保持不变。
 *   - 首次创建通过 commit 回调在**锁内**复用 PhoneStorage 的 CAS 入口
 *     （expectedPrimary 取锁内读到的原始字节），并沿用它的写后读回与旧副本清理。
 *   - Web Locks 不可用（LOCK_UNAVAILABLE）一律失败，不退回整表覆盖写入。
 *   - 返回 { ok: true, created } 或 { ok: false, reason }，不抛异常。
 */
(function (global) {
    'use strict';

    function failure(reason) { return { ok: false, reason: reason }; }

    // 锁内调用：主键缺失时才走这里，取旧 phone_data_v2 副本当种子。
    // 抛异常表示旧副本不可读（损坏/存储不可用），不能当成空历史继续创建，
    // 否则会把老会话覆盖成只剩这条新消息。
    function readLegacySeed(roleId) {
        var storage = global.PhoneStorage;
        if (!storage || typeof storage.getChatHistory !== 'function') {
            throw new Error('PhoneStorage.getChatHistory unavailable');
        }
        var history = storage.getChatHistory(roleId);
        if (history == null) return [];
        if (!Array.isArray(history)) throw new Error('legacy chat history is not an array');
        return history;
    }

    // 锁内调用：首次创建的落盘方式。只有主键仍缺失时才走这里；
    // 已被别的标签页创建则返回 undefined，交给默认的锁内写入。
    function createPrimary(roleId, list, ctx) {
        if (!ctx || ctx.primaryMissing !== true) return undefined;
        var storage = global.PhoneStorage;
        if (!storage || !storage.result || typeof storage.result.saveChatHistory !== 'function') {
            return { ok: false, error: { code: 'CREATE_UNAVAILABLE' } };
        }
        var saved;
        try {
            saved = storage.result.saveChatHistory(roleId, list, ctx.raw === null ? null : ctx.raw);
        } catch (e) {
            return { ok: false, error: { code: 'CREATE_FAILED' } };
        }
        if (saved && saved.ok === true) return { ok: true };
        return { ok: false, error: { code: (saved && saved.error && saved.error.code) || 'CREATE_FAILED' } };
    }

    function appendOrCreate(roleId, message) {
        var atomic = global.ChatHistoryAtomic;
        if (!atomic || typeof atomic.appendOrCreateIfMissing !== 'function') {
            return Promise.resolve(failure('ATOMIC_UNAVAILABLE'));
        }
        if (typeof roleId !== 'string' || !roleId.trim()) return Promise.resolve(failure('VALIDATION_FAILED'));
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return Promise.resolve(failure('VALIDATION_FAILED'));
        }

        var options = {
            seed: function () { return readLegacySeed(roleId); },
            commit: function (list, ctx) { return createPrimary(roleId, list, ctx); }
        };

        // 仅 CONFLICT 重试：只可能来自「不参与会话锁的旧写入者」在锁内读之后抢先
        // 建立主键。重试是重新申请一次锁、重跑整条序列，绝不在锁外补写。
        var attempts = 0;
        function attempt() {
            attempts += 1;
            return atomic.appendOrCreateIfMissing(roleId, message, options).then(function (outcome) {
                if (outcome && outcome.ok === true) {
                    // 原子层沿用 appendManyIf 的约定：value 承载操作输出。
                    var output = outcome.value && typeof outcome.value === 'object' ? outcome.value : {};
                    return { ok: true, created: output.created === true };
                }
                var code = outcome && outcome.error ? outcome.error.code : 'APPEND_FAILED';
                if (code === 'CONFLICT' && attempts < 2) return attempt();
                return failure(code);
            }, function () {
                return failure('APPEND_FAILED');
            });
        }
        return attempt();
    }

    global.ChatHistoryAppend = { appendOrCreate: appendOrCreate };
})(window);
