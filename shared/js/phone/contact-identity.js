(function (root) {
    'use strict';

    var VERSION = 1;
    var TYPES = {
        AI_ROLE: 'ai_role',
        REAL_USER: 'real_user',
        CHAT_GROUP: 'chat_group'
    };
    var ALLOWED = {
        ai_role: true,
        real_user: true,
        chat_group: true
    };
    var TYPE_ALIASES = {
        role: 'ai_role',
        character: 'ai_role',
        ai: 'ai_role',
        friend: 'real_user',
        user: 'real_user',
        group: 'chat_group',
        conversation_group: 'chat_group'
    };

    function normalizeType(value) {
        var type = String(value == null ? '' : value).trim().toLowerCase();
        type = TYPE_ALIASES[type] || type;
        return ALLOWED[type] ? type : '';
    }

    function encodeId(value) {
        return encodeURIComponent(String(value));
    }

    function create(typeValue, idValue) {
        var type = normalizeType(typeValue);
        if (!type || idValue == null) return null;
        var id = String(idValue).trim();
        if (!id) return null;
        var key = type + ':' + encodeId(id);
        return {
            type: type,
            id: id,
            key: key,
            // Preserve existing local chat-history keys for current roles/groups.
            // A future real-user conversation gets its own namespaced key.
            conversationId: type === TYPES.REAL_USER ? key : id
        };
    }

    function parseKey(value) {
        if (value == null) return null;
        var key = String(value).trim();
        var separator = key.indexOf(':');
        if (separator <= 0 || separator === key.length - 1) return null;
        var type = normalizeType(key.slice(0, separator));
        if (!type) return null;
        var encoded = key.slice(separator + 1);
        var id;
        try { id = decodeURIComponent(encoded); }
        catch (error) { return null; }
        var normalized = create(type, id);
        // Reject malformed or non-canonical encodings to keep equality deterministic.
        return normalized && normalized.key === key ? normalized : null;
    }

    function normalize(value, fallbackType) {
        if (typeof value === 'string') {
            var parsed = parseKey(value);
            if (parsed) return parsed;
            return create(fallbackType, value);
        }
        if (!value || typeof value !== 'object') return null;
        if (value.key && (value.id == null || value.type == null)) {
            var byKey = parseKey(value.key);
            if (byKey) return byKey;
        }
        var type = value.type || value.kind || value.contactType || fallbackType;
        var id = value.id != null ? value.id : value.legacyId;
        return create(type, id);
    }

    function fromRole(role) {
        return role && typeof role === 'object' ? create(TYPES.AI_ROLE, role.id) : null;
    }

    function fromUser(user) {
        if (!user || typeof user !== 'object') return null;
        return create(TYPES.REAL_USER, user.id != null ? user.id : user.userId);
    }

    function fromGroup(group) {
        return group && typeof group === 'object' ? create(TYPES.CHAT_GROUP, group.id) : null;
    }

    function toLegacyConversationId(value) {
        var ref = normalize(value);
        return ref ? ref.conversationId : null;
    }

    function equals(left, right) {
        var a = normalize(left);
        var b = normalize(right);
        return !!(a && b && a.key === b.key);
    }

    root.PhoneContactIdentity = {
        version: VERSION,
        types: TYPES,
        create: create,
        normalizeType: normalizeType,
        normalize: normalize,
        parseKey: parseKey,
        fromRole: fromRole,
        fromUser: fromUser,
        fromGroup: fromGroup,
        toLegacyConversationId: toLegacyConversationId,
        equals: equals
    };
})(window);
