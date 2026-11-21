/*
 * Opt-in guarded history mutations for cooperating tabs.
 * Keep the existing chat_history_<id> key and every message field unchanged.
 * Legacy synchronous writers are not covered; never claim global atomicity.
 */
(function (global) {
    'use strict';

    function fail(code, meta) {
        var result = { ok: false, error: { code: code } };
        if (meta) result.meta = meta;
        return result;
    }

    function validMessage(message) {
        return !!message && typeof message === 'object' && !Array.isArray(message);
    }

    function findMessage(history, mid) {
        for (var i = 0; i < history.length; i++) {
            if (history[i] && history[i].mid != null && String(history[i].mid) === mid) return history[i];
        }
        return null;
    }

    // All operations use the same per-conversation lock. The entire
    // read/check/write/readback sequence runs inside the lock callback.
    //
    // options（可选，默认关闭，appendIf / appendManyIf / replaceIfUnchanged 的行为不变）：
    //   allowMissingPrimary —— 主键缺失时用 seed() 取到的旧副本继续，而不是直接 NOT_FOUND。
    //   seed()              —— 只在 allowMissingPrimary 且主键确实缺失时于锁内调用；
    //                          抛异常表示旧副本不可读，按 LEGACY_UNREADABLE 失败。
    //   commit(list, ctx)   —— 自定义落盘。返回 { ok: true } 表示写完并由本函数读回校验；
    //                          返回失败对象表示失败；返回 undefined 表示走默认的锁内 setItem。
    // 约定：调用方不得在持锁期间再次申请同名锁，本函数也绝不复用外层锁。
    async function withLatest(contactId, operation, options) {
        var opts = options || {};
        var id = String(contactId == null ? '' : contactId);
        if (!id) return fail('VALIDATION_FAILED');
        var lockManager = global.navigator && global.navigator.locks;
        if (!lockManager || typeof lockManager.request !== 'function') return fail('LOCK_UNAVAILABLE');

        // Authenticated MAO pages expose a scoped Storage proxy. Match its
        // account identity in the lock name so two users with the same role
        // ID cannot block each other's browser tabs. Legacy pages keep the
        // original lock name for backward compatibility.
        var accountScope = global.__MAO_ACCOUNT_SCOPE__;
        var identityMeta = global.document && typeof global.document.querySelector === 'function'
            ? global.document.querySelector('meta[name="mao-account-id"]') : null;
        var declaredAccount = identityMeta && String(identityMeta.content || '').trim();
        if (declaredAccount && (!accountScope || accountScope.ready !== true ||
            accountScope.accountId !== declaredAccount)) return fail('ACCOUNT_SCOPE_UNAVAILABLE');
        var lockScope = accountScope && accountScope.ready === true && accountScope.accountId
            ? encodeURIComponent(String(accountScope.accountId)) + ':' : '';
        var key = 'chat_history_' + id;
        try {
            return await lockManager.request('maomao:chat-history:' + lockScope + id, { mode: 'exclusive' }, function () {
                var raw;
                try { raw = global.localStorage.getItem(key); }
                catch (e) { return fail('DB_UNAVAILABLE'); }
                var ctx = { contactId: id, raw: raw, primaryMissing: raw === null };
                var latest;
                if (raw === null) {
                    // Do not overwrite a missing primary by default: it may still have a
                    // legacy phone_data_v2 copy or have just been deleted.
                    if (opts.allowMissingPrimary !== true) return fail('NOT_FOUND');
                    // 首次创建：旧副本也必须在同一把锁内读取，否则两个标签页会各自
                    // 读到同一份旧副本、各自写出一份「旧副本 + 自己那条」。
                    var seed;
                    try { seed = typeof opts.seed === 'function' ? opts.seed() : []; }
                    catch (e) { return fail('LEGACY_UNREADABLE'); }
                    if (seed == null) seed = [];
                    if (!Array.isArray(seed)) return fail('LEGACY_UNREADABLE');
                    latest = seed;
                } else {
                    try { latest = JSON.parse(raw); }
                    catch (e) { return fail('CORRUPT_DATA'); }
                    if (!Array.isArray(latest)) return fail('CORRUPT_DATA');
                }

                var decision;
                try { decision = operation(latest, ctx); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (!decision || decision.ok !== true) return decision || fail('VALIDATION_FAILED');

                if (!Array.isArray(decision.value)) return fail('VALIDATION_FAILED');
                var meta = { contactId: id, total: decision.value.length };
                if (decision.alreadyPersisted) meta.alreadyPersisted = true;
                // Replays with an already-persisted mid must not rewrite the
                // entire history, which would also risk clobbering metadata.
                if (decision.alreadyPersisted && decision.value === latest) {
                    return { ok: true, value: decision.output, meta: meta };
                }
                // 只有真的写下去才算创建了这个主键。
                if (ctx.primaryMissing) meta.createdPrimary = true;
                var updated;
                try { updated = JSON.stringify(decision.value); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (typeof updated !== 'string') return fail('VALIDATION_FAILED');

                // 自定义落盘（例如首次创建走 PhoneStorage 的 CAS 入口）。
                // 依然在本锁回调内调用与校验，绝不在锁外补写。
                if (typeof opts.commit === 'function') {
                    var committed;
                    try { committed = opts.commit(decision.value, ctx); }
                    catch (e) { return fail('CREATE_FAILED'); }
                    if (committed !== undefined) {
                        if (!committed || committed.ok !== true) {
                            return committed && committed.error ? committed : fail('CREATE_FAILED');
                        }
                        var afterCommit;
                        try { afterCommit = global.localStorage.getItem(key); }
                        catch (e) { return fail('DB_UNAVAILABLE', { writeMayHavePersisted: true }); }
                        if (afterCommit !== updated) {
                            return fail('VERIFY_FAILED', { writeMayHavePersisted: true });
                        }
                        return { ok: true, value: decision.output, meta: meta };
                    }
                }

                // A browser adapter can commit setItem then throw, or reject a
                // post-write read. Never tell a caller to roll back media refs
                // unless we know the write did not persist.
                var writeAttempted = false;
                try {
                    writeAttempted = true;
                    global.localStorage.setItem(key, updated);
                    if (global.localStorage.getItem(key) !== updated) {
                        return fail('VERIFY_FAILED', { writeMayHavePersisted: true });
                    }
                } catch (e) {
                    var failure = e && (e.name === 'QuotaExceededError' ||
                        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') ? 'QUOTA_EXCEEDED' : 'DB_UNAVAILABLE';
                    try {
                        var found = global.localStorage.getItem(key);
                        if (found === updated) {
                            meta.verifiedAfterWriteError = true;
                            return { ok: true, value: decision.output, meta: meta };
                        }
                        if (found === raw) return fail(failure);
                    } catch (probeError) {}
                    return fail(failure, writeAttempted ? { writeMayHavePersisted: true } : null);
                }
                return { ok: true, value: decision.output, meta: meta };
            });
        } catch (e) {
            return fail('LOCK_FAILED');
        }
    }

    function guardAllows(guard, latest) {
        if (!guard) return true;
        try {
            // Guards are observers, never storage mutators. Give callbacks a
            // separate snapshot so a badly behaved guard cannot alter data.
            return guard(JSON.parse(JSON.stringify(latest))) === true;
        } catch (e) { return null; }
    }

    var ChatHistoryAtomic = {
        // One or more ordinary/AI/group message bubbles are appended together.
        // The caller may check the latest state under the lock via guard.
        appendManyIf: async function (contactId, messages, guard) {
            if (!Array.isArray(messages) || !messages.length ||
                !messages.every(validMessage) ||
                (guard != null && typeof guard !== 'function')) return fail('VALIDATION_FAILED');

            return withLatest(contactId, function (latest) {
                var allowed = guardAllows(guard, latest);
                if (allowed === null) return fail('GUARD_FAILED');
                if (!allowed) return fail('STALE_CONTEXT');

                var pending = [];
                var seen = Object.create(null);
                for (var i = 0; i < messages.length; i++) {
                    var item = messages[i];
                    if (item.mid == null || String(item.mid) === '') {
                        pending.push(item);
                        continue;
                    }
                    var mid = String(item.mid);
                    if (Object.prototype.hasOwnProperty.call(seen, mid)) return fail('CONFLICT');
                    seen[mid] = true;
                    var existing = null;
                    for (var j = 0; j < latest.length; j++) {
                        if (latest[j] && latest[j].mid != null && String(latest[j].mid) === mid) {
                            existing = latest[j];
                            break;
                        }
                    }
                    if (existing) {
                        if (JSON.stringify(existing) !== JSON.stringify(item)) return fail('CONFLICT');
                    } else {
                        pending.push(item);
                    }
                }
                var skipped = messages.length - pending.length;
                return {
                    ok: true, value: pending.length ? latest.concat(pending) : latest,
                    alreadyPersisted: pending.length === 0,
                    output: { appended: pending.length, skipped: skipped }
                };
            });
        },

        // Backward compatible response shape for the existing notifier.
        appendIf: async function (contactId, message, guard) {
            if (!validMessage(message)) return fail('VALIDATION_FAILED');
            var outcome = await ChatHistoryAtomic.appendManyIf(contactId, [message], guard);
            if (!outcome.ok) return outcome;
            return { ok: true, value: message, meta: outcome.meta };
        },

        // 首次创建 + 追加：读取旧副本、mid 去重、写入、读回全在同一把会话锁内完成。
        // 两个标签页同时创建同一个缺失主键时，只有一个真正创建，另一个在锁内
        // 看到已存在的主键后按普通追加处理，不会各写一份。
        // 与 appendIf 的差别仅在「主键缺失」：appendIf 仍返回 NOT_FOUND，行为不变。
        appendOrCreateIfMissing: async function (contactId, message, options) {
            if (!validMessage(message)) return fail('VALIDATION_FAILED');
            var opts = options || {};
            if (opts.seed != null && typeof opts.seed !== 'function') return fail('VALIDATION_FAILED');
            if (opts.commit != null && typeof opts.commit !== 'function') return fail('VALIDATION_FAILED');

            return withLatest(contactId, function (latest, ctx) {
                var mid = message.mid == null ? '' : String(message.mid);
                if (mid !== '') {
                    var existing = findMessage(latest, mid);
                    if (existing) {
                        // 同 mid 不同内容：不静默覆盖，交给调用方处理。
                        if (JSON.stringify(existing) !== JSON.stringify(message)) return fail('CONFLICT');
                        return {
                            ok: true, value: latest, alreadyPersisted: true,
                            output: { appended: 0, skipped: 1, created: false }
                        };
                    }
                }
                return {
                    ok: true, value: latest.concat([message]),
                    output: { appended: 1, skipped: 0, created: ctx.primaryMissing === true }
                };
            }, { allowMissingPrimary: true, seed: opts.seed, commit: opts.commit });
        },

        // For edits, removals or regenerated replies: reject changes when
        // any other tab has modified this conversation since it was read.
        // Do not silently merge destructive operations with newer messages.
        replaceIfUnchanged: async function (contactId, expected, replacement) {
            if (!Array.isArray(expected) || !Array.isArray(replacement)) {
                return fail('VALIDATION_FAILED');
            }
            return withLatest(contactId, function (latest) {
                if (JSON.stringify(latest) !== JSON.stringify(expected)) {
                    return fail('CONFLICT');
                }
                return { ok: true, value: replacement, output: {
                    replaced: true
                } };
            });
        }
    };

    global.ChatHistoryAtomic = ChatHistoryAtomic;
})(window);
