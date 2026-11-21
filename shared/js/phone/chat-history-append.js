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
 *   - 首次创建会同时持有共享的 phone_data_v2 根锁：根是单键整对象，
 *     saveChatHistory 清理旧副本时要整体重写，不同会话的锁并不能保护它。
 *   - Web Locks 不可用（LOCK_UNAVAILABLE）一律失败，不退回整表覆盖写入。
 *   - 旧数据读不出来（损坏/异常/不可读）一律失败关闭，绝不解释成「没有记录」。
 *   - 返回 { ok: true, created } 或 { ok: false, reason, writeMayHavePersisted }，不抛异常。
 */
(function (global) {
    'use strict';

    function failure(reason, extra) {
        var out = { ok: false, reason: reason };
        if (extra && extra.writeMayHavePersisted === true) out.writeMayHavePersisted = true;
        return out;
    }

    function seedError(code) {
        var error = new Error(code);
        error.code = code;
        return error;
    }

    // 锁内调用：主键缺失时才走这里，取 phone_data_v2 旧副本当种子。
    //
    // 必须区分「真的没有旧记录」与「旧记录读不出来」，不能把后者当成空历史：
    //   缺少 phone_data_v2 / 该角色没有 bucket / bucket 没有 chat / chat 里没有 history
    //     → 真正的空历史，允许创建；
    //   根 JSON 损坏、根不是对象、bucket 不是对象、chat 不是对象、history 不是数组
    //     → LEGACY_CORRUPT，拒绝创建；
    //   根读不出来（存储异常、getRoot 结构不支持）→ LEGACY_UNREADABLE，拒绝创建。
    // 只用 PhoneStorage.result.getRoot()：PhoneStorage.getChatHistory() 会把损坏
    // 和读取异常统一折成 []，用它做种子等于拿空数组覆盖旧会话。
    function readLegacySeed(roleId) {
        var storage = global.PhoneStorage;
        var api = storage && storage.result;
        if (!api || typeof api.getRoot !== 'function') throw seedError('LEGACY_UNREADABLE');

        var rootRes;
        try { rootRes = api.getRoot(); }
        catch (e) { throw seedError('LEGACY_UNREADABLE'); }
        // getRoot 已把「压根没有 phone_data_v2」映射成 ok({}, { found: false })，
        // 剩下的失败只有两类：内容损坏，或者读不出来。
        if (!rootRes || rootRes.ok !== true) {
            var code = rootRes && rootRes.error ? rootRes.error.code : null;
            throw seedError(code === 'CORRUPT_DATA' ? 'LEGACY_CORRUPT' : 'LEGACY_UNREADABLE');
        }

        var root = rootRes.value;
        if (root == null) return [];
        if (typeof root !== 'object' || Array.isArray(root)) throw seedError('LEGACY_CORRUPT');
        if (!Object.prototype.hasOwnProperty.call(root, roleId)) return [];

        var bucket = root[roleId];
        if (bucket == null) return [];
        if (typeof bucket !== 'object' || Array.isArray(bucket)) throw seedError('LEGACY_CORRUPT');
        if (bucket.chat == null) return [];
        if (typeof bucket.chat !== 'object' || Array.isArray(bucket.chat)) throw seedError('LEGACY_CORRUPT');

        var history = bucket.chat.history;
        // chat 存在但没有 history 字段：没有任何消息会因此丢失，按空历史处理。
        if (history == null) return [];
        if (!Array.isArray(history)) throw seedError('LEGACY_CORRUPT');
        return history;
    }

    // 锁内调用：首次创建的落盘方式。只有主键仍缺失时才走这里；
    // 已被别的标签页创建则返回 undefined，交给默认的锁内写入。
    async function createPrimary(roleId, list, ctx) {
        if (!ctx || ctx.primaryMissing !== true) return undefined;
        var storage = global.PhoneStorage;
        if (!storage || !storage.result || typeof storage.result.saveChatHistory !== 'function') {
            return { ok: false, error: { code: 'CREATE_UNAVAILABLE' } };
        }
        var saved;
        try {
            // 落盘实现允许是异步的；原子层会一直持锁等到它结束。
            saved = await storage.result.saveChatHistory(roleId, list, ctx.raw === null ? null : ctx.raw);
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
            // 首次创建会在锁内重写 phone_data_v2 根来清理旧副本，
            // 因此必须同时持有共享的根锁，否则不同角色并发创建会互相覆盖。
            sharedRootLock: true,
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
                var meta = outcome && outcome.meta ? outcome.meta : null;
                if (code === 'CONFLICT' && attempts < 2) return attempt();
                // writeMayHavePersisted：写入可能已经落盘、只是读回没验证通过。
                // 调用方据此提示「可能已发送」，重试时必须复用同一个 mid。
                return failure(code, { writeMayHavePersisted: !!(meta && meta.writeMayHavePersisted === true) });
            }, function () {
                return failure('APPEND_FAILED');
            });
        }
        return attempt();
    }

    // 同一动作的幂等重试缓存：actionKey 恒定（例如「这张帖子分享给这个角色」），
    // 成功之前复用同一个 message 对象（含 mid 与 time）。
    // 写入已落盘但读回失败时，用户再点一次不会因为新 mid 变成第二条消息——
    // 原子层看到相同 mid 且内容一致，直接返回成功。
    var pendingActions = Object.create(null);

    function appendStable(actionKey, roleId, factory) {
        if (typeof actionKey !== 'string' || !actionKey.trim()) return Promise.resolve(failure('VALIDATION_FAILED'));
        if (typeof factory !== 'function') return Promise.resolve(failure('VALIDATION_FAILED'));

        var entry = pendingActions[actionKey];
        if (!entry || entry.roleId !== roleId) {
            var built;
            try { built = factory(); }
            catch (e) { return Promise.resolve(failure('VALIDATION_FAILED')); }
            if (!built || typeof built !== 'object' || Array.isArray(built)) {
                return Promise.resolve(failure('VALIDATION_FAILED'));
            }
            entry = { roleId: roleId, message: built };
            pendingActions[actionKey] = entry;
        }

        return appendOrCreate(roleId, entry.message).then(function (outcome) {
            if (outcome && outcome.ok === true) delete pendingActions[actionKey];
            return outcome;
        });
    }

    global.ChatHistoryAppend = {
        appendOrCreate: appendOrCreate,
        appendStable: appendStable
    };
})(window);
