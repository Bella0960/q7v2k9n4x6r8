/*
 * Opt-in guarded history mutations for cooperating tabs.
 * Keep the existing chat_history_<id> key and every message field unchanged.
 * Legacy synchronous writers are not covered; never claim global atomicity.
 */
(function (global) {
    'use strict';

    function fail(code) {
        return { ok: false, error: { code: code } };
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

        var key = 'chat_history_' + id;
        try {
            return await lockManager.request('maomao:chat-history:' + id, { mode: 'exclusive' }, function () {
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

                var updated;
                try { updated = JSON.stringify(decision.value); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (typeof updated !== 'string') return fail('VALIDATION_FAILED');
                try {
                    global.localStorage.setItem(key, updated);
                    if (global.localStorage.getItem(key) !== updated) return fail('VERIFY_FAILED');
                } catch (e) {
                    return fail(e && (e.name === 'QuotaExceededError' ||
                        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') ? 'QUOTA_EXCEEDED' : 'DB_UNAVAILABLE');
                }
                return { ok: true, value: decision.output, meta: {
                    contactId: id, total: decision.value.length
                } };
            });
        } catch (e) {
            return fail('LOCK_FAILED');
        }
    }

    function guardAllows(guard, latest) {
        if (!guard) return true;
        try { return guard(latest) === true; }
        catch (e) { return null; }
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
                return { ok: true, value: latest.concat(messages), output: {
                    appended: messages.length
                } };
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
