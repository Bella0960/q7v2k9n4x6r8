(function (root) {
    'use strict';

    var STORAGE_KEY = 'contact_groups_v1';
    var TYPES = { AI_ROLE: 'ai_role', REAL_USER: 'real_user', CHAT_GROUP: 'chat_group' };

    function uniqueIds(values) {
        var result = [];
        var seen = Object.create(null);
        (Array.isArray(values) ? values : []).forEach(function (value) {
            if (value == null) return;
            var id = String(value).trim();
            if (!id || seen[id]) return;
            seen[id] = true;
            result.push(id);
        });
        return result;
    }

    function createRef(type, id) {
        var identity = root.PhoneContactIdentity;
        if (identity && typeof identity.create === 'function') return identity.create(type, id);
        type = String(type || '').trim();
        id = id == null ? '' : String(id).trim();
        if (!id || ['ai_role', 'real_user', 'chat_group'].indexOf(type) === -1) return null;
        return { type: type, id: id, key: type + ':' + encodeURIComponent(id), conversationId: type === 'real_user' ? type + ':' + encodeURIComponent(id) : id };
    }

    function normalizeRef(value, fallbackType) {
        var identity = root.PhoneContactIdentity;
        if (identity && typeof identity.normalize === 'function') {
            return identity.normalize(value, fallbackType);
        }
        if (typeof value === 'string') {
            var separator = value.indexOf(':');
            if (separator > 0) {
                try {
                    var parsed = createRef(value.slice(0, separator), decodeURIComponent(value.slice(separator + 1)));
                    if (parsed && parsed.key === value) return parsed;
                } catch (error) {}
            }
            return createRef(fallbackType, value);
        }
        if (!value || typeof value !== 'object') return null;
        return createRef(value.type || value.kind || fallbackType, value.id != null ? value.id : value.legacyId);
    }

    function uniqueRefs(values, fallbackType) {
        var result = [];
        var seen = Object.create(null);
        (Array.isArray(values) ? values : []).forEach(function (value) {
            var ref = normalizeRef(value, fallbackType);
            if (!ref || seen[ref.key]) return;
            seen[ref.key] = true;
            result.push(ref);
        });
        return result;
    }

    function normalizeGroups(values) {
        var ids = Object.create(null);
        return (Array.isArray(values) ? values : []).reduce(function (result, group) {
            if (!group || typeof group !== 'object') return result;
            var id = String(group.id == null ? '' : group.id).trim();
            var name = String(group.name == null ? '' : group.name).trim().slice(0, 24);
            if (!id || !name || ids[id]) return result;
            ids[id] = true;

            // memberIds is the legacy AI-role list. memberRefs is the typed,
            // collision-safe relationship list used by new code.
            var memberRefs = uniqueRefs(group.memberRefs, null);
            uniqueIds(group.memberIds).forEach(function (memberId) {
                var roleRef = createRef(TYPES.AI_ROLE, memberId);
                if (roleRef && !memberRefs.some(function (item) { return item.key === roleRef.key; })) {
                    memberRefs.push(roleRef);
                }
            });
            var memberIds = memberRefs.filter(function (item) { return item.type === TYPES.AI_ROLE; })
                .map(function (item) { return item.id; });
            result.push({
                id: id,
                name: name,
                memberIds: uniqueIds(memberIds),
                memberRefs: memberRefs.map(function (item) { return item.key; })
            });
            return result;
        }, []);
    }

    function readStoredGroups() {
        var raw;
        try {
            raw = root.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            return { ok: false, error: 'storage_unavailable', cause: error };
        }
        if (raw == null || raw === '') return { ok: true, groups: [] };
        try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return { ok: false, error: 'corrupt_data' };
            return { ok: true, groups: normalizeGroups(parsed) };
        } catch (error) {
            return { ok: false, error: 'corrupt_data', cause: error };
        }
    }

    function getGroups() {
        var result = readStoredGroups();
        return result.ok ? result.groups : [];
    }

    function saveGroups(groups) {
        var current = readStoredGroups();
        if (!current.ok) return current;
        var normalized = normalizeGroups(groups);
        try {
            root.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
            return { ok: true, groups: normalized };
        } catch (error) {
            return {
                ok: false,
                error: error && error.name === 'QuotaExceededError' ? 'storage_full' : 'storage_unavailable',
                cause: error
            };
        }
    }

    function buildAudienceSnapshot(groupIds, contactIds, options) {
        var requestedGroupIds = uniqueIds(groupIds);
        var selectedContactIds = uniqueIds(contactIds);
        options = options && typeof options === 'object' ? options : {};
        var hasContactRoster = Array.isArray(options.availableContactIds);
        var availableContactIds = hasContactRoster ? uniqueIds(options.availableContactIds) : [];
        var availableLookup = Object.create(null);
        availableContactIds.forEach(function (id) { availableLookup[id] = true; });
        var selectedRefs = uniqueRefs(options.selectedContactRefs, null);
        selectedContactIds.forEach(function (id) {
            var roleRef = createRef(TYPES.AI_ROLE, id);
            if (roleRef && !selectedRefs.some(function (item) { return item.key === roleRef.key; })) selectedRefs.push(roleRef);
        });
        var stored = readStoredGroups();

        if (!stored.ok && requestedGroupIds.length) {
            return {
                ok: false,
                error: stored.error || 'storage_unavailable',
                groupIds: requestedGroupIds,
                contactIds: selectedContactIds,
                memberIds: [],
                memberRefs: []
            };
        }

        var groups = stored.ok ? stored.groups : [];
        var validGroups = Object.create(null);
        groups.forEach(function (group) { validGroups[group.id] = group; });
        var missingGroupIds = requestedGroupIds.filter(function (id) {
            return !Object.prototype.hasOwnProperty.call(validGroups, id);
        });
        if (missingGroupIds.length) {
            return {
                ok: false,
                error: 'missing_groups',
                missingGroupIds: missingGroupIds,
                groupIds: requestedGroupIds,
                contactIds: selectedContactIds,
                memberIds: [],
                memberRefs: []
            };
        }

        if (hasContactRoster) {
            var missingContactIds = selectedContactIds.filter(function (id) {
                return !Object.prototype.hasOwnProperty.call(availableLookup, id);
            });
            if (missingContactIds.length) {
                return {
                    ok: false,
                    error: 'missing_contacts',
                    missingContactIds: missingContactIds,
                    groupIds: requestedGroupIds,
                    contactIds: selectedContactIds,
                    memberIds: [],
                    memberRefs: []
                };
            }
        }

        var selectedMemberRefs = selectedRefs.slice();
        requestedGroupIds.forEach(function (id) {
            selectedMemberRefs = selectedMemberRefs.concat(uniqueRefs(validGroups[id].memberRefs, null));
            // Legacy data may be loaded from a record that has not yet been rewritten.
            uniqueIds(validGroups[id].memberIds).forEach(function (memberId) {
                selectedMemberRefs.push(createRef(TYPES.AI_ROLE, memberId));
            });
        });
        selectedMemberRefs = uniqueRefs(selectedMemberRefs, null);

        var staleMemberIds = [];
        if (hasContactRoster) {
            staleMemberIds = selectedMemberRefs.filter(function (item) {
                return item.type === TYPES.AI_ROLE && !Object.prototype.hasOwnProperty.call(availableLookup, item.id);
            }).map(function (item) { return item.id; });
            selectedMemberRefs = selectedMemberRefs.filter(function (item) {
                return item.type !== TYPES.AI_ROLE || Object.prototype.hasOwnProperty.call(availableLookup, item.id);
            });
        }

        var memberIds = selectedMemberRefs.filter(function (item) { return item.type === TYPES.AI_ROLE; })
            .map(function (item) { return item.id; });
        return {
            ok: true,
            groupIds: requestedGroupIds,
            contactIds: selectedContactIds,
            memberIds: uniqueIds(memberIds),
            memberRefs: selectedMemberRefs.map(function (item) { return item.key; }),
            staleMemberIds: uniqueIds(staleMemberIds)
        };
    }

    function getContactRef(value, fallbackType) {
        return normalizeRef(value, fallbackType);
    }

    function canViewPost(post, contactId) {
        if (!post || contactId == null) return false;
        var id = String(contactId);
        var visibility = post.visibility || 'public';
        if (visibility === 'private') return false;
        if (visibility === 'custom') return uniqueIds(post.visibleTo).indexOf(id) !== -1;
        if (visibility === 'excluded') return uniqueIds(post.hiddenTo).indexOf(id) === -1;
        return true;
    }

    function canContactViewPost(post, contactValue) {
        if (!post) return false;
        var contact = normalizeRef(contactValue);
        if (!contact) return false;
        var visibility = post.visibility || 'public';
        if (visibility === 'private') return false;
        if (visibility !== 'custom' && visibility !== 'excluded') return true;

        var fieldName = visibility === 'custom' ? 'visibleContactRefs' : 'hiddenContactRefs';
        var legacyField = visibility === 'custom' ? 'visibleTo' : 'hiddenTo';
        if (Array.isArray(post[fieldName])) {
            var refs = uniqueRefs(post[fieldName], null);
            var included = refs.some(function (item) { return item.key === contact.key; });
            return visibility === 'custom' ? included : !included;
        }

        // Old posts have only bare role IDs. Never match a real account to a role
        // simply because their underlying IDs happen to be identical.
        if (contact.type === TYPES.AI_ROLE) {
            var legacyIds = uniqueIds(post[legacyField]);
            var legacyMatch = legacyIds.indexOf(contact.id) !== -1;
            return visibility === 'custom' ? legacyMatch : !legacyMatch;
        }
        return visibility === 'excluded';
    }

    function isUserAuthored(post, profile) {
        profile = profile && typeof profile === 'object' ? profile : {};
        var authorId = String(post.authorId == null ? '' : post.authorId);
        var profileId = String(profile.id == null ? 'me' : profile.id);
        var profileName = String(profile.name == null ? '我' : profile.name);
        return authorId === 'me' || authorId === profileId ||
            (!authorId && (!post.author || String(post.author) === profileName || String(post.author) === '我'));
    }

    function canContactReceivePost(post, contactValue, profile) {
        if (!post || !contactValue) return false;
        if (!isUserAuthored(post, profile)) return true;
        return canContactViewPost(post, contactValue);
    }

    function canRoleReceivePost(post, roleId, profile) {
        if (roleId == null) return false;
        return canContactReceivePost(post, createRef(TYPES.AI_ROLE, roleId), profile);
    }

    function getGroupIdsForContactRef(contactValue) {
        var contact = normalizeRef(contactValue);
        if (!contact) return [];
        return getGroups().filter(function (group) {
            return uniqueRefs(group.memberRefs, null).some(function (item) { return item.key === contact.key; });
        }).map(function (group) { return group.id; });
    }

    function getGroupIdsForContact(contactId) {
        return getGroupIdsForContactRef(createRef(TYPES.AI_ROLE, contactId));
    }

    root.PhoneContactGroups = {
        storageKey: STORAGE_KEY,
        types: TYPES,
        getGroups: getGroups,
        saveGroups: saveGroups,
        buildAudienceSnapshot: buildAudienceSnapshot,
        getContactRef: getContactRef,
        canViewPost: canViewPost,
        canContactViewPost: canContactViewPost,
        canContactReceivePost: canContactReceivePost,
        canRoleReceivePost: canRoleReceivePost,
        getGroupIdsForContact: getGroupIdsForContact,
        getGroupIdsForContactRef: getGroupIdsForContactRef,
        normalizeGroups: normalizeGroups,
        readStoredGroups: readStoredGroups
    };
})(window);
