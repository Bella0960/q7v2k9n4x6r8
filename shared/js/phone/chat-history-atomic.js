/*
 * Opt-in, append-only chat writer for asynchronous background messages.
 * Protects cooperating browser tabs via Web Locks without changing legacy
 * chat_history_<id> keys, message objects, or any read/export format.
 * Legacy synchronous writers are not covered; do not claim global atomicity.
 */
(function (global) {
    'use strict';

    function fail(code) {
        return { ok: false, error: { code: code } };
    }

    var ChatHistoryAtomic = {
        appendIf: async function (contactId, message, guard) {
            var id = String(contactId == null ? '' : contactId);
            if (!id || !message || typeof message !== 'object' || Array.isArray(message) ||
                (guard != null && typeof guard !== 'function')) return fail('VALIDATION_FAILED');

            // Never fall back to a non-exclusive read-modify-write. Automatic
            // messages may be postponed, but existing history must not be lost.
            var lockManager = global.navigator && global.navigator.locks;
            if (!lockManager || typeof lockManager.request !== 'function') return fail('LOCK_UNAVAILABLE');

            var key = 'chat_history_' + id;
            try {
                return await lockManager.request('maomao:chat-history:' + id, { mode: 'exclusive' }, function () {
                    var raw;
                    try { raw = global.localStorage.getItem(key); }
                    catch (e) { return fail('DB_UNAVAILABLE'); }
                    // A missing primary must not be recreated over an unknown
                    // phone_data_v2 legacy copy or a concurrent deletion.
                    if (raw === null) return fail('NOT_FOUND');
                    var latest;
                    try { latest = JSON.parse(raw); }
                    catch (e) { return fail('CORRUPT_DATA'); }
                    if (!Array.isArray(latest)) return fail('CORRUPT_DATA');
                    if (guard) {
                        var allowed;
                        try { allowed = guard(latest) === true; }
                        catch (e) { return fail('GUARD_FAILED'); }
                        if (!allowed) return fail('STALE_CONTEXT');
                    }
                    var updated;
                    try { updated = JSON.stringify(latest.concat([message])); }
                    catch (e) { return fail('VALIDATION_FAILED'); }
                    try {
                        global.localStorage.setItem(key, updated);
                        if (global.localStorage.getItem(key) !== updated) return fail('VERIFY_FAILED');
                    } catch (e) {
                        return fail(e && e.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'DB_UNAVAILABLE');
                    }
                    return { ok: true, value: message, meta: { contactId: id, total: latest.length + 1 } };
                });
            } catch (e) {
                return fail('LOCK_FAILED');
            }
        }
    };

    global.ChatHistoryAtomic = ChatHistoryAtomic;
})(window);
