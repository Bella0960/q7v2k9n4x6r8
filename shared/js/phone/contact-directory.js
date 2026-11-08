(function (root) {
    'use strict';

    var STORAGE_KEY = 'real_user_contacts_v1';
    var VERSION = 3;
    var activeAccountId = '';
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
            ownerAccountId: cleanText(value.ownerAccountId, 96),
            handle: cleanText(value.handle, 24).toLowerCase(),
            displayName: displayName,
            avatarAssetId: /^av_[a-f0-9]{32}$/.test(String(value.avatarAssetId || ''))
                ? String(value.avatarAssetId) : '',
            avatarUrl: safeAvatarUrl(value.avatarUrl != null ? value.avatarUrl : value.avatar),
            status: status,
            source: cleanText(value.source, 32) || 'unknown',
            requestId: cleanText(value.requestId, 160),
            createdAt: createdAt,
            updatedAt: updatedAt,
            serverUpdatedAt: timestamp('serverUpdatedAt'),
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
            var recordKey = record.ownerAccountId
                ? 'owner:' + record.ownerAccountId + ':' + record.id
                : 'local:' + record.id;
            var current = byId[recordKey];
            if (!current) {
                byId[recordKey] = record;
            } else {
                duplicateCount += 1;
                if (record.updatedAt > current.updatedAt) byId[recordKey] = record;
            }
        }
        return {
            ok: true,
            contacts: Object.keys(byId).map(function (id) { return byId[id]; }),
            duplicateCount: duplicateCount
        };
    }

    function isVisibleForActiveAccount(record) {
        // Legacy rows without an owner are local-only, not shared across every
        // signed-in account on this device. Keep them readable while logged out,
        // and keep account-owned rows scoped to their exact active account.
        if (record.ownerAccountId) {
            return !!activeAccountId && record.ownerAccountId === activeAccountId;
        }
        return !activeAccountId;
    }

    function sameIdentity(left, right) {
        return !!(left && right && left.id === right.id &&
            left.ownerAccountId === right.ownerAccountId);
    }

    function read(options) {
        var result = readResult();
        if (!result.ok) return result;
        options = options && typeof options === 'object' ? options : {};
        var contacts = result.contacts.filter(isVisibleForActiveAccount);
        if (options.status) contacts = contacts.filter(function (item) { return item.status === options.status; });
        return { ok: true, contacts: contacts.slice(), duplicateCount: result.duplicateCount };
    }

    function setActiveAccountId(value) {
        activeAccountId = cleanText(value, 96);
        return { ok: true, activeAccountId: activeAccountId || null };
    }

    function getActiveAccountId() {
        return activeAccountId || null;
    }

    function get(id) {
        var result = readResult();
        if (!result.ok || id == null) return null;
        var key = cleanText(id, 160);
        return result.contacts.find(function (item) {
            return item.id === key && isVisibleForActiveAccount(item);
        }) || null;
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

    // Low-level snapshots may refresh profile fields, but they must never
    // change relationship state or request identity. All lifecycle mutations
    // go through the request-ID-guarded transition methods below.
    function mergeProfileSnapshot(existing, incoming) {
        if (incoming.status !== existing.status || incoming.requestId !== existing.requestId) {
            return { ok: false, error: 'lifecycle_transition_required' };
        }
        if (incoming.updatedAt < existing.updatedAt) {
            return { ok: false, error: 'stale_snapshot' };
        }
        var updatedAt = Math.max(incoming.updatedAt, existing.updatedAt);
        var merged = normalizeRecord(Object.assign({}, existing, {
            handle: incoming.handle,
            displayName: incoming.displayName,
            avatarAssetId: incoming.avatarAssetId,
            avatarUrl: incoming.avatarUrl,
            updatedAt: updatedAt
        }), updatedAt);
        if (!merged) return { ok: false, error: 'invalid_contact' };
        return { ok: true, record: merged };
    }

    // Safe profile-refresh API. New records may be imported, but an existing
    // relationship cannot be accepted, blocked, removed, or restarted here.
    // This prevents generic persistence calls from bypassing lifecycle guards.
    function save(value) {
        var current = readResult();
        if (!current.ok) return current;
        var record = normalizeRecord(value);
        if (!record) return { ok: false, error: 'invalid_contact', contacts: [] };
        var contacts = current.contacts.slice();
        var index = contacts.findIndex(function (item) {
            return item.id === record.id && item.ownerAccountId === record.ownerAccountId;
        });
        if (index >= 0) {
            var previous = contacts[index];
            var merged = mergeProfileSnapshot(previous, record);
            if (!merged.ok) {
                return { ok: false, error: merged.error, contact: previous, contacts: contacts };
            }
            record = merged.record;
            contacts[index] = record;
        } else {
            contacts.push(record);
        }
        return writeContacts(contacts);
    }

    // Batch refresh is all-or-nothing. A single attempted lifecycle mutation
    // rejects the whole batch, so earlier profile updates are never partially saved.
    function saveMany(values) {
        if (!Array.isArray(values)) return { ok: false, error: 'invalid_contacts', contacts: [] };
        var current = readResult();
        if (!current.ok) return current;
        var contacts = current.contacts.slice();
        for (var i = 0; i < values.length; i++) {
            var record = normalizeRecord(values[i]);
            if (!record) return { ok: false, error: 'invalid_contact', invalidIndex: i, contacts: current.contacts };
            var index = contacts.findIndex(function (item) {
                return item.id === record.id && item.ownerAccountId === record.ownerAccountId;
            });
            if (index >= 0) {
                var previous = contacts[index];
                var merged = mergeProfileSnapshot(previous, record);
                if (!merged.ok) {
                    return {
                        ok: false,
                        error: merged.error,
                        invalidIndex: i,
                        contact: previous,
                        contacts: current.contacts
                    };
                }
                record = merged.record;
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
        var next = current.contacts.filter(function (item) {
            return !(item.id === key && isVisibleForActiveAccount(item));
        });
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
        var contact = result.contacts.find(function (item) {
            return item.id === key && isVisibleForActiveAccount(item);
        }) || null;
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
        input.ownerAccountId = activeAccountId;
        var existing = current.contacts.find(function (item) {
            return item.id === input.id && isVisibleForActiveAccount(item);
        });
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
            var replaced = current.contacts.map(function (item) { return sameIdentity(item, existing) ? input : item; });
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
        input.ownerAccountId = activeAccountId;
        var existing = current.contacts.find(function (item) {
            return item.id === input.id && isVisibleForActiveAccount(item);
        });
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
            var replaced = current.contacts.map(function (item) { return sameIdentity(item, existing) ? input : item; });
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
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? accepted : item; });
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
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? declined : item; });
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
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? cancelled : item; });
        return resultWithContact(writeContacts(next), cancelled, 'request_cancelled');
    }

    // Apply the other party's response to a request initiated on this device.
    // This event must come from an authenticated server adapter and match the
    // exact outgoing request ID before the local relationship becomes accepted.
    function confirmOutgoingAccepted(id, options) {
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
        if (existing.status !== STATUS.PENDING_OUTGOING) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var accepted = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.ACCEPTED,
            acceptedAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? accepted : item; });
        return resultWithContact(writeContacts(next), accepted, 'outgoing_request_accepted');
    }

    // A remote rejection is terminal for this request ID, but a new request
    // with a different ID may be sent later.
    function applyOutgoingDeclined(id, options) {
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
        if (existing.status !== STATUS.PENDING_OUTGOING) {
            return { ok: false, error: 'invalid_transition', contact: existing, contacts: current.contacts };
        }
        var now = nextUpdatedAt(transitionTime(options), existing);
        var declined = normalizeRecord(Object.assign({}, existing, {
            status: STATUS.DECLINED,
            declinedAt: now,
            updatedAt: now
        }), now);
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? declined : item; });
        return resultWithContact(writeContacts(next), declined, 'outgoing_request_declined');
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
        var targetOwnerId = existing ? existing.ownerAccountId : activeAccountId;
        var blocked = normalizeRecord({
            id: current.id,
            ownerAccountId: targetOwnerId,
            handle: existing ? existing.handle : '',
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
        var next = current.contacts.filter(function (item) {
            return !(item.id === current.id && item.ownerAccountId === targetOwnerId);
        });
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
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? unblocked : item; });
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
        var next = current.contacts.map(function (item) { return sameIdentity(item, existing) ? removed : item; });
        return resultWithContact(writeContacts(next), removed, 'friend_removed');
    }

    // Reconcile a complete, authenticated server snapshot. This is the only
    // path allowed to apply remote lifecycle changes to server-owned contact rows.
    // It requires stable accepted request IDs and an all-pages-complete marker.
    function syncServerSnapshot(snapshot, ownerId, options) {
        options = options && typeof options === 'object' ? options : {};
        var owner = cleanText(ownerId, 96);
        if (!owner) return { ok: false, error: 'invalid_owner_account_id', contacts: [] };
        if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.relationships)) {
            return { ok: false, error: 'incomplete_server_snapshot', contacts: [] };
        }
        if (cleanText(snapshot.ownerAccountId, 96) !== owner) {
            return { ok: false, error: 'server_snapshot_account_mismatch', contacts: [] };
        }
        var snapshotAt = Number(snapshot.snapshotAt);
        if (!Number.isSafeInteger(snapshotAt) || snapshotAt <= 0) {
            return { ok: false, error: 'invalid_server_snapshot_time', contacts: [] };
        }
        var now = transitionTime(options);
        var current = readResult();
        if (!current.ok) return current;

        var seen = Object.create(null);
        var next = current.contacts.slice();
        for (var i = 0; i < snapshot.relationships.length; i++) {
            var remote = snapshot.relationships[i];
            if (!remote || typeof remote !== 'object' || Array.isArray(remote)) {
                return { ok: false, error: 'invalid_server_relationship', invalidIndex: i, contacts: current.contacts };
            }
            var id = cleanText(remote.id, 160);
            var requestId = cleanText(remote.acceptedRequestId, 160);
            var status = cleanText(remote.status, 16);
            var serverUpdatedAt = Number(remote.updatedAt);
            var acceptedAt = Number(remote.acceptedAt);
            if (!id || !/^[A-Za-z0-9_-]{8,96}$/.test(requestId) ||
                (status !== 'accepted' && status !== 'removed') ||
                !Number.isSafeInteger(serverUpdatedAt) || serverUpdatedAt <= 0) {
                return { ok: false, error: 'invalid_server_relationship', invalidIndex: i, contacts: current.contacts };
            }
            if (seen[id]) return { ok: false, error: 'duplicate_server_relationship', invalidIndex: i, contacts: current.contacts };
            seen[id] = true;

            var index = next.findIndex(function (item) {
                return item.id === id && item.ownerAccountId === owner;
            });
            // A legacy ownerless row is migrated only after the authenticated
            // server explicitly confirms the same ID in this account's roster.
            if (index < 0) {
                index = next.findIndex(function (item) {
                    return item.id === id && !item.ownerAccountId;
                });
            }
            var existing = index >= 0 ? next[index] : null;
            if (existing && existing.serverUpdatedAt && serverUpdatedAt < existing.serverUpdatedAt) {
                return { ok: false, error: 'stale_server_snapshot', invalidIndex: i, contact: existing, contacts: current.contacts };
            }

            if (status === 'removed') {
                if (!existing) continue;
                var removedAt = Math.max(now, existing.updatedAt + 1);
                var removed = normalizeRecord(Object.assign({}, existing, {
                    ownerAccountId: owner,
                    status: STATUS.REMOVED,
                    requestId: requestId,
                    avatarAssetId: '',
                    avatarUrl: '',
                    acceptedAt: null,
                    removedAt: removedAt,
                    updatedAt: removedAt,
                    serverUpdatedAt: serverUpdatedAt,
                    source: 'server_snapshot'
                }), removedAt);
                if (!removed) return { ok: false, error: 'invalid_server_relationship', invalidIndex: i, contacts: current.contacts };
                if (index >= 0) next[index] = removed;
                continue;
            }

            var displayName = cleanText(remote.displayName, 48);
            var handle = cleanText(remote.handle, 24).toLowerCase();
            var avatarAssetId = /^av_[a-f0-9]{32}$/.test(String(remote.avatarAssetId || ''))
                ? String(remote.avatarAssetId) : '';
            if (!displayName || !handle || !Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) {
                return { ok: false, error: 'invalid_server_profile', invalidIndex: i, contacts: current.contacts };
            }
            if (existing && existing.status !== STATUS.ACCEPTED &&
                existing.requestId === requestId &&
                [STATUS.BLOCKED, STATUS.DECLINED, STATUS.CANCELLED, STATUS.REMOVED, STATUS.UNBLOCKED].indexOf(existing.status) !== -1) {
                return { ok: false, error: 'stale_server_relationship_revival', invalidIndex: i, contact: existing, contacts: current.contacts };
            }

            var localUpdatedAt = existing ? Math.max(now, existing.updatedAt + 1) : Math.max(now, acceptedAt);
            var refreshed = normalizeRecord({
                id: id,
                ownerAccountId: owner,
                handle: handle,
                displayName: displayName,
                avatarAssetId: avatarAssetId,
                avatarUrl: avatarAssetId ? '/api/real-user-chat/v1/profile/avatars/' + encodeURIComponent(avatarAssetId) : '',
                status: STATUS.ACCEPTED,
                source: 'server_snapshot',
                requestId: requestId,
                createdAt: existing && existing.requestId === requestId ? existing.createdAt : acceptedAt,
                updatedAt: localUpdatedAt,
                serverUpdatedAt: serverUpdatedAt,
                acceptedAt: acceptedAt,
                blockedAt: null,
                declinedAt: null,
                cancelledAt: null,
                removedAt: null,
                unblockedAt: null
            }, localUpdatedAt);
            if (!refreshed) return { ok: false, error: 'invalid_server_profile', invalidIndex: i, contacts: current.contacts };
            if (index >= 0) next[index] = refreshed;
            else next.push(refreshed);
        }

        // A complete roster is authoritative for this owner. Any previously accepted
        // server-owned row absent from it has been removed (or its account was deleted).
        // Local-only records and other account owners are never touched.
        next = next.map(function (item) {
            if (item.ownerAccountId !== owner || item.status !== STATUS.ACCEPTED || seen[item.id]) return item;
            if (item.serverUpdatedAt && snapshotAt < item.serverUpdatedAt) return item;
            var removedAt = Math.max(now, item.updatedAt + 1);
            return normalizeRecord(Object.assign({}, item, {
                status: STATUS.REMOVED,
                avatarAssetId: '',
                avatarUrl: '',
                acceptedAt: null,
                removedAt: removedAt,
                updatedAt: removedAt,
                serverUpdatedAt: snapshotAt,
                source: 'server_snapshot'
            }), removedAt);
        });

        var saved = writeContacts(next);
        if (!saved.ok) return saved;
        return {
            ok: true,
            ownerAccountId: owner,
            snapshotAt: snapshotAt,
            contacts: next.filter(function (item) {
                return item.ownerAccountId === owner && item.status === STATUS.ACCEPTED;
            })
        };
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
            incoming: result.contacts.filter(function (item) {
                return isVisibleForActiveAccount(item) && item.status === STATUS.PENDING_INCOMING;
            }),
            outgoing: result.contacts.filter(function (item) {
                return isVisibleForActiveAccount(item) && item.status === STATUS.PENDING_OUTGOING;
            })
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
        setActiveAccountId: setActiveAccountId,
        getActiveAccountId: getActiveAccountId,
        syncServerSnapshot: syncServerSnapshot,
        save: save,
        saveMany: saveMany,
        remove: remove,
        requestOutgoing: requestOutgoing,
        applyIncomingRequest: applyIncomingRequest,
        acceptIncoming: acceptIncoming,
        confirmOutgoingAccepted: confirmOutgoingAccepted,
        applyOutgoingDeclined: applyOutgoingDeclined,
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
