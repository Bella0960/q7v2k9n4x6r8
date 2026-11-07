(function (root) {
    'use strict';

    var STORAGE_KEY = 'real_user_contacts_v1';
    var VERSION = 1;
    var STATUS = {
        PENDING_OUTGOING: 'pending_outgoing',
        PENDING_INCOMING: 'pending_incoming',
        ACCEPTED: 'accepted',
        BLOCKED: 'blocked'
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
        var acceptedAt = Number(value.acceptedAt);
        var blockedAt = Number(value.blockedAt);
        now = Number(now) || Date.now();
        if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = now;
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) updatedAt = createdAt;
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
            acceptedAt: Number.isFinite(acceptedAt) && acceptedAt > 0 ? acceptedAt : null,
            blockedAt: Number.isFinite(blockedAt) && blockedAt > 0 ? blockedAt : null
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
        var key = String(id).trim();
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

    function getContactRef(value) {
        var identity = root.PhoneContactIdentity;
        var id = value && typeof value === 'object' ? (value.id != null ? value.id : value.userId) : value;
        if (id == null) return null;
        if (identity && typeof identity.create === 'function') return identity.create('real_user', id);
        var safeId = cleanText(id, 160);
        return safeId ? {
            type: 'real_user',
            id: safeId,
            key: 'real_user:' + encodeURIComponent(safeId),
            conversationId: 'real_user:' + encodeURIComponent(safeId)
        } : null;
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
        getContactRef: getContactRef,
        getAcceptedRefs: getAcceptedRefs
    };
})(window);
