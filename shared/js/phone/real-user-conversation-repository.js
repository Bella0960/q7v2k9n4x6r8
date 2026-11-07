/* ============================================================
 * real-user-conversation-repository.js
 *
 * Local-only message storage for accepted real-user contacts.
 * Deliberately separate from ConversationRepository and every
 * legacy chat_history_<id> slot used by AI roles / group chats.
 *
 * This repository stores only messages authored on this device.
 * It does not simulate incoming messages, delivery, or sync.
 * A future authenticated server adapter must enforce the same
 * capability allowlist on the server before enabling networking.
 * ============================================================ */
(function (root) {
    'use strict';

    var VERSION = 1;
    var KEY_PREFIX = 'real_user_chat_history_v1_';
    var ALLOWED_TYPES = {
        text: true,
        image: true,
        file: true,
        voice: true,
        sticker: true
    };
    var MAX_TEXT_LENGTH = 5000;
    var MAX_CAPTION_LENGTH = 240;

    function resultError(code, extra) {
        return Object.assign({ ok: false, error: code }, extra || {});
    }

    function cleanText(value, maxLength) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
            .trim()
            .slice(0, maxLength);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeRef(value) {
        var identity = root.PhoneContactIdentity;
        if (!identity || typeof identity.normalize !== 'function') return null;
        var ref = identity.normalize(value);
        if (!ref || ref.type !== 'real_user' || !ref.id || !ref.key) return null;
        return ref;
    }

    function contactState(ref) {
        var directory = root.PhoneContactDirectory;
        if (!directory || typeof directory.readResult !== 'function') {
            return resultError('contact_directory_unavailable');
        }
        var directoryResult = directory.readResult();
        if (!directoryResult || !directoryResult.ok || !Array.isArray(directoryResult.contacts)) {
            return resultError('contact_directory_unavailable');
        }
        var contact = directoryResult.contacts.find(function (item) {
            return item && String(item.id) === ref.id;
        }) || null;
        if (!contact || contact.status !== 'accepted') return resultError('not_accepted_friend');
        return { ok: true, contact: contact };
    }

    function storageKey(ref) {
        return KEY_PREFIX + encodeURIComponent(ref.id);
    }

    function normalizeMessage(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        var mid = cleanText(value.mid, 160);
        var type = cleanText(value.type, 24).toLowerCase();
        if (!mid || !ALLOWED_TYPES[type]) return null;

        var message = {
            mid: mid,
            type: type,
            sender: 'self',
            deliveryState: 'local_only',
            createdAt: Number(value.createdAt) > 0 ? Number(value.createdAt) : 0
        };

        if (type === 'text') {
            var text = String(value.text == null ? '' : value.text);
            if (!text.trim() || text.length > MAX_TEXT_LENGTH) return null;
            message.text = text;
        } else {
            var attachment = value.attachment && typeof value.attachment === 'object'
                ? value.attachment : value;
            var assetId = cleanText(attachment.assetId || attachment.attachmentId, 180);
            if (!assetId) return null;
            message.attachment = { assetId: assetId };
            var mimeType = cleanText(attachment.mimeType, 120);
            var fileName = cleanText(attachment.fileName || attachment.name, 120);
            var durationMs = Number(attachment.durationMs);
            if (mimeType) message.attachment.mimeType = mimeType;
            if (fileName) message.attachment.fileName = fileName;
            if (Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 3600000 &&
                (type === 'voice' || type === 'sticker')) {
                message.attachment.durationMs = Math.floor(durationMs);
            }
            var caption = cleanText(value.caption, MAX_CAPTION_LENGTH);
            if (caption) message.caption = caption;
        }

        if (!message.createdAt) return null;
        return message;
    }

    function readHistory(value) {
        var ref = normalizeRef(value);
        if (!ref) return resultError('invalid_real_user_ref');
        var accepted = contactState(ref);
        if (!accepted.ok) return accepted;

        var raw;
        try {
            raw = root.localStorage.getItem(storageKey(ref));
        } catch (error) {
            return resultError('storage_unavailable');
        }
        if (raw == null || raw === '') {
            return {
                ok: true,
                conversationRef: clone(ref),
                messages: [],
                meta: { found: false, localOnly: true, schemaVersion: VERSION }
            };
        }

        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (error) { return resultError('corrupt_history'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
            parsed.schemaVersion !== VERSION ||
            !parsed.conversationRef || parsed.conversationRef.type !== 'real_user' ||
            parsed.conversationRef.id !== ref.id || parsed.conversationRef.key !== ref.key ||
            !Array.isArray(parsed.messages)) {
            return resultError('corrupt_history');
        }

        var messages = [];
        for (var i = 0; i < parsed.messages.length; i++) {
            var normalized = normalizeMessage(parsed.messages[i]);
            if (!normalized || normalized.mid !== parsed.messages[i].mid ||
                normalized.type !== parsed.messages[i].type ||
                parsed.messages[i].sender !== 'self' ||
                parsed.messages[i].deliveryState !== 'local_only') {
                return resultError('corrupt_history', { invalidIndex: i });
            }
            messages.push(normalized);
        }

        return {
            ok: true,
            conversationRef: clone(ref),
            messages: messages,
            meta: {
                found: true,
                count: messages.length,
                localOnly: true,
                syncState: 'not_connected',
                schemaVersion: VERSION,
                updatedAt: Number(parsed.updatedAt) || 0
            }
        };
    }

    function writeHistory(ref, messages, createdAt) {
        var now = Date.now();
        var record = {
            schemaVersion: VERSION,
            conversationRef: clone(ref),
            createdAt: Number(createdAt) || now,
            updatedAt: now,
            messages: messages
        };
        try {
            root.localStorage.setItem(storageKey(ref), JSON.stringify(record));
            return {
                ok: true,
                conversationRef: clone(ref),
                messages: clone(messages),
                meta: { count: messages.length, localOnly: true, syncState: 'not_connected' }
            };
        } catch (error) {
            return resultError(error && error.name === 'QuotaExceededError' ? 'storage_full' : 'storage_unavailable');
        }
    }

    function appendMessage(value, input) {
        var ref = normalizeRef(value);
        if (!ref) return resultError('invalid_real_user_ref');
        var accepted = contactState(ref);
        if (!accepted.ok) return accepted;

        var capabilities = root.PhoneContactCapabilities;
        if (!capabilities || typeof capabilities.canMessageType !== 'function' ||
            !capabilities.canMessageType(ref, input && input.type)) {
            return resultError('message_type_not_allowed');
        }

        var now = Date.now();
        var incoming = Object.assign({}, input || {}, {
            createdAt: Number(input && input.createdAt) > 0 ? Number(input.createdAt) : now
        });
        var message = normalizeMessage(incoming);
        if (!message) return resultError('invalid_message');

        var current = readHistory(ref);
        if (!current.ok) return current;
        var existing = current.messages.find(function (item) { return item.mid === message.mid; });
        if (existing) {
            if (JSON.stringify(existing) === JSON.stringify(message)) {
                return {
                    ok: true,
                    action: 'duplicate_delivery',
                    message: clone(existing),
                    meta: { localOnly: true, syncState: 'not_connected' }
                };
            }
            return resultError('message_id_conflict');
        }

        var next = current.messages.concat([message]);
        var raw;
        try { raw = root.localStorage.getItem(storageKey(ref)); }
        catch (error) { return resultError('storage_unavailable'); }
        var createdAt = now;
        if (raw) {
            try {
                var stored = JSON.parse(raw);
                createdAt = Number(stored.createdAt) || now;
            } catch (error) {
                return resultError('corrupt_history');
            }
        }
        var saved = writeHistory(ref, next, createdAt);
        if (!saved.ok) return saved;
        return {
            ok: true,
            action: 'message_appended',
            message: clone(message),
            meta: { index: next.length - 1, total: next.length, localOnly: true, syncState: 'not_connected' }
        };
    }

    function getPage(value, pageSize, beforeMid) {
        var result = readHistory(value);
        if (!result.ok) return result;
        var messages = result.messages;
        var size = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 30)));
        var end = messages.length;
        if (beforeMid) {
            var cursor = messages.findIndex(function (item) { return item.mid === beforeMid; });
            if (cursor < 0) return resultError('message_cursor_not_found');
            end = cursor;
        }
        var start = Math.max(0, end - size);
        return {
            ok: true,
            conversationRef: result.conversationRef,
            messages: messages.slice(start, end),
            meta: Object.assign({}, result.meta, {
                pageSize: size,
                startIndex: start,
                endIndex: end,
                hasMore: start > 0
            })
        };
    }

    function clear(value) {
        var ref = normalizeRef(value);
        if (!ref) return resultError('invalid_real_user_ref');
        var accepted = contactState(ref);
        if (!accepted.ok) return accepted;
        try {
            root.localStorage.removeItem(storageKey(ref));
            return { ok: true, conversationRef: clone(ref), meta: { cleared: true, localOnly: true } };
        } catch (error) {
            return resultError('storage_unavailable');
        }
    }

    root.PhoneRealUserConversationRepository = {
        version: VERSION,
        storageKeyPrefix: KEY_PREFIX,
        allowedMessageTypes: Object.keys(ALLOWED_TYPES),
        readHistory: readHistory,
        getPage: getPage,
        appendMessage: appendMessage,
        clear: clear
    };
})(window);
