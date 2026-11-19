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

    // All operations use the same per-conversation lock. The entire
    // read/check/write/readback sequence runs inside the lock callback.
    async function withLatest(contactId, operation) {
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
                // Do not overwrite a missing primary: it may still have a
                // legacy phone_data_v2 copy or have just been deleted.
                if (raw === null) return fail('NOT_FOUND');
                var latest;
                try { latest = JSON.parse(raw); }
                catch (e) { return fail('CORRUPT_DATA'); }
                if (!Array.isArray(latest)) return fail('CORRUPT_DATA');

                var decision;
                try { decision = operation(latest); }
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
                var updated;
                try { updated = JSON.stringify(decision.value); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (typeof updated !== 'string') return fail('VALIDATION_FAILED');

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
