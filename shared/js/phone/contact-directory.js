(function (root) {
    'use strict';

    var STORAGE_KEY = 'real_user_contacts_v1';
    var VERSION = 2;
    var STATUS = {
        PENDING_OUTGOING: 'pending_outgoing',
        PENDING_INCOMING: 'pending_incoming',
        ACCEPTED: 'accepted',
        BLOCKED: 'blocked',
        DECLINED: 'declined',
        CANCELLED: 'cancelled',
        REMOVED: 'removed',
        UNBLOCKED: 'unblocked'
    };
    var ALLOWED_STATUS = Object.create(null);
    Object.keys(STATUS).forEach(function (key) { ALLOWED_STATUS[STATUS[key]] = true; });

    function cleanText(value, maxLength) {
        var text = String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
        return text.slice(0, maxLength);
    }

    function safeAvatarUrl(value) {
        var url = cleanText(value, 1000);
        if (!url) return '';
        if (/^https?:\/\//i.test(url) || /^(?:\.|\/)[^\\]*$/.test(url)) return url;
        return '';
    }

    function normalizeRecord(value, now) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        var id = cleanText(value.id != null ? value.id : value.userId, 160);
        var displayName = cleanText(value.displayName != null ? value.displayName : value.name, 48);
        var status = cleanText(value.status != null ? value.status : value.relationshipStatus, 32).toLowerCase();
        if (!id || !displayName || !ALLOWED_STATUS[status]) return null;

        var createdAt = Number(value.createdAt);
        var updatedAt = Number(value.updatedAt);
        now = Number(now) || Date.now();
        if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = now;
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) updatedAt = createdAt;

        function timestamp(field) {
            var number = Number(value[field]);
            return Number.isFinite(number) && number > 0 ? number : null;
        }

        return {
            id: id,
            type: 'real_user',
            displayName: displayName,
            avatarAssetId: cleanText(value.avatarAssetId, 180),
            avatarUrl: safeAvatarUrl(value.avatarUrl != null ? value.avatarUrl : value.avatar),
            status: status,
            source: cleanText(value.source, 32) || 'unknown',
            requestId: cleanText(value.requestId, 160),
            createdAt: createdAt,
            updatedAt: updatedAt,
            acceptedAt: timestamp('acceptedAt'),
            blockedAt: timestamp('blockedAt'),
            declinedAt: timestamp('declinedAt'),
            cancelledAt: timestamp('cancelledAt'),
            removedAt: timestamp('removedAt'),
            unblockedAt: timestamp('unblockedAt')
        };
    }

    function readResult() {
        var raw;
        try {
            raw = root.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            return { ok: false, error: 'storage_unavailable', contacts: [], cause: error };
        }
        if (raw == null || raw === '') return { ok: true, contacts: [], duplicateCount: 0 };
        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (error) { return { ok: false, error: 'corrupt_data', contacts: [], cause: error }; }
        if (!Array.isArray(parsed)) return { ok: false, error: 'corrupt_data', contacts: [] };

        var byId = Object.create(null);
        var duplicateCount = 0;
        for (var i = 0; i < parsed.length; i++) {
            var record = normalizeRecord(parsed[i]);
            if (!record) return { ok: false, error: 'corrupt_data', contacts: [], invalidIndex: i };
            var current = byId[record.id];
            if (!current) {
                byId[record.id] = record;
            } else {
                duplicateCount += 1;
                if (record.updatedAt > current.updatedAt) byId[record.id] = record;
            }
        }
        return {
            ok: true,
            contacts: Object.keys(byId).map(function (id) { return byId[id]; }),
            duplicateCount: duplicateCount
        };
    }

    function read(options) {
        var result = readResult();
        if (!result.ok) return result;
        options = options && typeof options === 'object' ? options : {};
        var contacts = result.contacts;
        if (options.status) contacts = contacts.filter(function (item) { return item.status === options.status; });
        return { ok: true, contacts: contacts.slice(), duplicateCount: result.duplicateCount };
    }

    function get(id) {
        var result = readResult();
        if (!result.ok || id == null) return null;
        var key = cleanText(id, 160);
        return result.contacts.find(function (item) { return item.id === key; }) || null;
    }

    function writeContacts(contacts) {
        try {
            root.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
            return { ok: true, contacts: contacts };
        } catch (error) {
            return {
                ok: false,
                error: error && error.name === 'QuotaExceededError' ? 'storage_full' : 'storage_unavailable',
                contacts: [],
                cause: error
            };
        }
    }

    // Low-level import/repair API. Product flows should use the guarded lifecycle
    // methods below so a stale request cannot silently restore an old relationship.
    function save(value) {
        var current = readResult();
        if (!current.ok) return current;
        var record = normalizeRecord(value);
        if (!record) return { ok: false, error: 'invalid_contact', contacts: [] };
        var contacts = current.contacts.slice();
        var index = contacts.findIndex(function (item) { return item.id === record.id; });
        if (index >= 0) {
            var previous = contacts[index];
            if (record.updatedAt < previous.updatedAt) {
                return { ok: false, error: 'stale_snapshot', contact: previous, contacts: contacts };
            }
            record.createdAt = previous.createdAt;
            contacts[index] = record;
        } else {
            contacts.push(record);
        }
        return writeContacts(contacts);
    }

    function saveMany(values) {
        if (!Array.isArray(values)) return { ok: false, error: 'invalid_contacts', contacts: [] };
        var current = readResult();
        if (!current.ok) return current;
        var contacts = current.contacts.slice();
        for (var i = 0; i < values.length; i++) {
            var record = normalizeRecord(values[i]);
            if (!record) return { ok: false, error: 'invalid_contact', invalidIndex: i, contacts: [] };
            var index = contacts.findIndex(function (item) { return item.id === record.id; });
            if (index >= 0) {
                if (record.updatedAt < contacts[index].updatedAt) {
                    return { ok: false, error: 'stale_snapshot', invalidIndex: i, contacts: contacts };
                }
                record.createdAt = contacts[index].createdAt;
                contacts[index] = record;
            } else {
                contacts.push(record);
            }
        }
        return writeContacts(contacts);
    }

    // Physical deletion is retained for authoritative roster repair and test fixtures.
    // A user-facing "remove friend" action must use removeFriend() to keep a replay tombstone.
    function remove(id) {
        var current = readResult();
        if (!current.ok) return current;
        var key = cleanText(id, 160);
        var next = current.contacts.filter(function (item) { return item.id !== key; });
        if (next.length === current.contacts.length) {
            return { ok: false, error: 'not_found', contacts: current.contacts };
        }
        return writeContacts(next);
    }

    function resultWithContact(result, contact, action) {
        if (!result.ok) return result;
        return {
            ok: true,
            action: action,
            contact: contact || null,
            contacts: result.contacts
        };
    }

    function readContactForTransition(id) {
        var result = readResult();
        if (!result.ok) return result;
        var key = cleanText(id, 160);
        if (!key) return { ok: false, error: 'invalid_contact_id', contacts: [] };
        var contact = result.contacts.find(function (item) { return item.id === key; }) || null;
        return { ok: true, contact: contact, contacts: result.contacts, id: key };
    }

    function transitionTime(options) {
        options = options && typeof options === 'object' ? options : {};
        var value = Number(options.now);
        return Number.isFinite(value) && value > 0 ? value : Date.now();
    }

    function nextUpdatedAt(now, existing) {
        return existing ? Math.max(now, existing.updatedAt + 1) : now;
    }

    function makeRequestId(options, now) {
        options = options && typeof options === 'object' ? options : {};
        return cleanText(options.requestId, 160) ||
            ('fr_' + Number(now).toString(36) + '_' + Math.random().toString(36).slice(2, 10));
    }

    function duplicateTerminal(existing, requestId) {
        return !!(existing && existing.requestId && existing.requestId === requestId &&
            (existing.status === STATUS.DECLINED || existing.status === STATUS.CANCELLED ||
             existing.status === STATUS.REMOVED || existing.status === STATUS.UNBLOCKED));
    }

    // These methods are local lifecycle primitives, not network operations.
    // A future adapter must authenticate the remote account and verify server
    // authorization before applying incoming requests or accepted states.
    function requestOutgoing(value, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readResult();
        if (!current.ok) return current;
        var now = transitionTime(options);
        var requestId = makeRequestId(options, now);
        var input = normalizeRecord({
            id: value && (value.id != null ? value.id : value.userId),
            displayName: value && (value.displayName != null ? value.displayName : value.name),
            avatarUrl: value && value.avatarUrl,
            avatarAssetId: value && value.avatarAssetId,
            status: STATUS.PENDING_OUTGOING,
            source: value && value.source || 'manual',
            requestId: requestId,
            createdAt: now,
            updatedAt: now
        }, now);
        if (!input) return { ok: false, error: 'invalid_contact', contacts: current.contacts };
        var existing = current.contacts.find(function (item) { return item.id === input.id; });
        if (existing) {
            if (existing.status === STATUS.ACCEPTED) return { ok: false, error: 'already_friends', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.BLOCKED) return { ok: false, error: 'blocked', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.PENDING_INCOMING) return { ok: false, error: 'incoming_request_exists', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.PENDING_OUTGOING) {
                if (existing.requestId === requestId) return { ok: true, action: 'duplicate_delivery', contact: existing, contacts: current.contacts };
                return { ok: false, error: 'outgoing_request_exists', contact: existing, contacts: current.contacts };
            }
            if (duplicateTerminal(existing, requestId)) {
                return { ok: false, error: 'stale_request', contact: existing, contacts: current.contacts };
            }
            input.createdAt = existing.createdAt;
            input.updatedAt = nextUpdatedAt(now, existing);
            var replaced = current.contacts.map(function (item) { return item.id === existing.id ? input : item; });
            return resultWithContact(writeContacts(replaced), input, 'request_restarted');
        }
        return resultWithContact(writeContacts(current.contacts.concat([input])), input, 'request_created');
    }

    // requestId is supplied by the authenticated server event and is mandatory:
    // it is the idempotency key used to reject duplicate and stale deliveries.
    function applyIncomingRequest(value, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readResult();
        if (!current.ok) return current;
        var now = transitionTime(options);
        var requestId = cleanText(value && value.requestId, 160);
        if (!requestId) return { ok: false, error: 'missing_request_id', contacts: current.contacts };
        var input = normalizeRecord({
            id: value && (value.id != null ? value.id : value.userId),
            displayName: value && (value.displayName != null ? value.displayName : value.name),
            avatarUrl: value && value.avatarUrl,
            avatarAssetId: value && value.avatarAssetId,
            status: STATUS.PENDING_INCOMING,
            source: value && value.source || 'server',
            requestId: requestId,
            createdAt: now,
            updatedAt: now
        }, now);
        if (!input) return { ok: false, error: 'invalid_contact', contacts: current.contacts };
        var existing = current.contacts.find(function (item) { return item.id === input.id; });
        if (existing) {
            if (existing.status === STATUS.ACCEPTED) return { ok: false, error: 'already_friends', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.BLOCKED) return { ok: false, error: 'blocked', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.PENDING_OUTGOING) return { ok: false, error: 'request_collision', contact: existing, contacts: current.contacts };
            if (existing.status === STATUS.PENDING_INCOMING) {
                if (existing.requestId === requestId) return { ok: true, action: 'duplicate_delivery', contact: existing, contacts: current.contacts };
                return { ok: false, error: 'incoming_request_exists', contact: existing, contacts: current.contacts };
            }
            if (duplicateTerminal(existing, requestId)) {
                return { ok: true, action: 'duplicate_terminal_delivery', contact: existing, contacts: current.contacts };
            }
            input.createdAt = existing.createdAt;
            input.updatedAt = nextUpdatedAt(now, existing);
            var replaced = current.contacts.map(function (item) { return item.id === existing.id ? input : item; });
            return resultWithContact(writeContacts(replaced), input, 'incoming_request_received');
        }
        return resultWithContact(writeContacts(current.contacts.concat([input])), input, 'incoming_request_received');
    }

    function validateRequestId(existing, options) {
        var requestId = cleanText(options && options.requestId, 160);
        if (!requestId) return { ok: false, error: 'missing_request_id' };
        if (!existing || existing.requestId !== requestId) return { ok: false, error: 'stale_request' };
        if (options.expectedUpdatedAt != null && Number(options.expectedUpdatedAt) !== existing.updatedAt) {
            return { ok: false, error: 'stale_snapshot' };
        }
        return { ok: true, requestId: requestId };
    }

    function acceptIncoming(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (!existing) return { ok: false, error: 'not_found', contacts: current.contacts };
        var validation = validateRequestId(existing, options);
        if (!validation.ok) return { ok: false, error: validation.error, contact: existing, contacts: current.contacts };
        if (existing.status === STATUS.ACCEPTED) {
            return { ok: true, action: 'already_accepted', contact: existing, contacts: current.contacts };
        }
        if (existing.status !== STATUS.PENDING_INCOMING) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var accepted = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.ACCEPTED,
            acceptedAt: now,
            blockedAt: null,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return item.id === existing.id ? accepted : item; });
        return resultWithContact(writeContacts(next), accepted, 'request_accepted');
    }

    function declineIncoming(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (!existing) return { ok: false, error: 'not_found', contacts: current.contacts };
        var validation = validateRequestId(existing, options);
        if (!validation.ok) return { ok: false, error: validation.error, contact: existing, contacts: current.contacts };
        if (existing.status === STATUS.DECLINED) {
            return { ok: true, action: 'already_declined', contact: existing, contacts: current.contacts };
        }
        if (existing.status !== STATUS.PENDING_INCOMING) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var declined = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.DECLINED,
            declinedAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return item.id === existing.id ? declined : item; });
        return resultWithContact(writeContacts(next), declined, 'request_declined');
    }

    function cancelOutgoing(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (!existing) return { ok: false, error: 'not_found', contacts: current.contacts };
        var validation = validateRequestId(existing, options);
        if (!validation.ok) return { ok: false, error: validation.error, contact: existing, contacts: current.contacts };
        if (existing.status === STATUS.CANCELLED) {
            return { ok: true, action: 'already_cancelled', contact: existing, contacts: current.contacts };
        }
        if (existing.status !== STATUS.PENDING_OUTGOING) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var cancelled = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.CANCELLED,
            cancelledAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return item.id === existing.id ? cancelled : item; });
        return resultWithContact(writeContacts(next), cancelled, 'request_cancelled');
    }

    function blockContact(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (existing && existing.status === STATUS.BLOCKED) {
            return { ok: true, action: 'already_blocked', contact: existing, contacts: current.contacts };
        }
        var displayName = cleanText(options.displayName || options.name || (existing && existing.displayName), 48);
        if (!displayName) return { ok: false, error: 'invalid_contact', contacts: current.contacts };
        var now = transitionTime(options);
        var updatedAt = nextUpdatedAt(now, existing);
        var blocked = normalizeRecord({
            id: current.id,
            displayName: displayName,
            avatarUrl: options.avatarUrl != null ? options.avatarUrl : (existing && existing.avatarUrl),
            avatarAssetId: options.avatarAssetId != null ? options.avatarAssetId : (existing && existing.avatarAssetId),
            status: STATUS.BLOCKED,
            source: existing ? existing.source : 'manual',
            requestId: existing ? existing.requestId : '',
            createdAt: existing ? existing.createdAt : now,
            updatedAt: updatedAt,
            acceptedAt: existing ? existing.acceptedAt : null,
            blockedAt: updatedAt
        }, updatedAt);
        var next = current.contacts.filter(function (item) { return item.id !== current.id; });
        next.push(blocked);
        return resultWithContact(writeContacts(next), blocked, 'contact_blocked');
    }

    function unblockContact(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (!existing) return { ok: false, error: 'not_found', contacts: current.contacts };
        if (existing.status === STATUS.UNBLOCKED) {
            return { ok: true, action: 'already_unblocked', contact: existing, contacts: current.contacts };
        }
        if (existing.status !== STATUS.BLOCKED) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var unblocked = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.UNBLOCKED,
            acceptedAt: null,
            unblockedAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return item.id === existing.id ? unblocked : item; });
        return resultWithContact(writeContacts(next), unblocked, 'contact_unblocked');
    }

    // Removing a friend keeps the last request ID as a replay tombstone. A later
    // relationship requires a fresh request ID from the authenticated service.
    function removeFriend(id, options) {
        options = options && typeof options === 'object' ? options : {};
        var current = readContactForTransition(id);
        if (!current.ok) return current;
        var existing = current.contact;
        if (!existing) return { ok: false, error: 'not_found', contacts: current.contacts };
        if (existing.status === STATUS.REMOVED) {
            return { ok: true, action: 'already_removed', contact: existing, contacts: current.contacts };
        }
        if (existing.status !== STATUS.ACCEPTED) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var removed = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.REMOVED,
            acceptedAt: null,
            removedAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return item.id === existing.id ? removed : item; });
        return resultWithContact(writeContacts(next), removed, 'friend_removed');
    }

    function getContactRef(value) {
        var identity = root.PhoneContactIdentity;
        var id = value && typeof value === 'object' ? (value.id != null ? value.id : value.userId) : value;
        id = cleanText(id, 160);
        if (!id) return null;
        if (identity && typeof identity.create === 'function') return identity.create('real_user', id);
        return {
            type: 'real_user',
            id: id,
            key: 'real_user:' + encodeURIComponent(id),
            conversationId: 'real_user:' + encodeURIComponent(id)
        };
    }

    function getAcceptedRefs() {
        var result = read({ status: STATUS.ACCEPTED });
        if (!result.ok) return result;
        return {
            ok: true,
            refs: result.contacts.map(function (item) { return getContactRef(item.id); }).filter(Boolean),
            contacts: result.contacts
        };
    }

    function getPendingRequests() {
        var result = readResult();
        if (!result.ok) return result;
        return {
            ok: true,
            incoming: result.contacts.filter(function (item) { return item.status === STATUS.PENDING_INCOMING; }),
            outgoing: result.contacts.filter(function (item) { return item.status === STATUS.PENDING_OUTGOING; })
        };
    }

    root.PhoneContactDirectory = {
        version: VERSION,
        storageKey: STORAGE_KEY,
        statuses: STATUS,
        normalizeRecord: normalizeRecord,
        readResult: readResult,
        read: read,
        get: get,
        save: save,
        saveMany: saveMany,
        remove: remove,
        requestOutgoing: requestOutgoing,
        applyIncomingRequest: applyIncomingRequest,
        acceptIncoming: acceptIncoming,
        declineIncoming: declineIncoming,
        cancelOutgoing: cancelOutgoing,
        block: blockContact,
        unblock: unblockContact,
        removeFriend: removeFriend,
        getPendingRequests: getPendingRequests,
        getContactRef: getContactRef,
        getAcceptedRefs: getAcceptedRefs
    };
})(window);
