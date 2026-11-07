(function (root) {
    'use strict';

    var STORAGE_KEY = 'contact_groups_v1';

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

    function normalizeGroups(values) {
        var ids = Object.create(null);
        return (Array.isArray(values) ? values : []).reduce(function (result, group) {
            if (!group || typeof group !== 'object') return result;
            var id = String(group.id == null ? '' : group.id).trim();
            var name = String(group.name == null ? '' : group.name).trim().slice(0, 24);
            if (!id || !name || ids[id]) return result;
            ids[id] = true;
            result.push({
                id: id,
                name: name,
                memberIds: uniqueIds(group.memberIds)
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

    function buildAudienceSnapshot(groupIds, contactIds) {
        var requestedGroupIds = uniqueIds(groupIds);
        var selectedContactIds = uniqueIds(contactIds);
        var stored = readStoredGroups();

        // A direct-contact selection remains usable when group storage is unavailable.
        // A selected group, however, must never be silently dropped from the audience.
        if (!stored.ok && requestedGroupIds.length) {
            return {
                ok: false,
                error: stored.error || 'storage_unavailable',
                groupIds: requestedGroupIds,
                contactIds: selectedContactIds,
                memberIds: []
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
                memberIds: []
            };
        }

        var memberIds = selectedContactIds.slice();
        requestedGroupIds.forEach(function (id) {
            memberIds = memberIds.concat(validGroups[id].memberIds);
        });
        return {
            ok: true,
            groupIds: requestedGroupIds,
            contactIds: selectedContactIds,
            memberIds: uniqueIds(memberIds)
        };
    }

    function canViewPost(post, contactId) {
        if (!post || contactId == null) return false;
        var id = String(contactId);
        var visibility = post.visibility || 'public';
        if (visibility === 'private') return false;
        if (visibility === 'custom') {
            return uniqueIds(post.visibleTo).indexOf(id) !== -1;
        }
        if (visibility === 'excluded') {
            return uniqueIds(post.hiddenTo).indexOf(id) === -1;
        }
        // 未知旧权限值沿用历史行为；新增受限权限必须在上方显式定义。
        return true;
    }

    function canRoleReceivePost(post, roleId, profile) {
        if (!post || roleId == null) return false;
        profile = profile && typeof profile === 'object' ? profile : {};
        var authorId = String(post.authorId == null ? '' : post.authorId);
        var profileId = String(profile.id == null ? 'me' : profile.id);
        var profileName = String(profile.name == null ? '我' : profile.name);
        var isUserAuthored = authorId === 'me' || authorId === profileId ||
            (!authorId && (!post.author || String(post.author) === profileName || String(post.author) === '我'));
        // This phone renders the owner's own feed. Only apply the owner's audience
        // policy when deciding whether an AI role may receive a user-authored post.
        if (!isUserAuthored) return true;
        return canViewPost(post, roleId);
    }

    function getGroupIdsForContact(contactId) {
        var id = String(contactId == null ? '' : contactId);
        if (!id) return [];
        return getGroups().filter(function (group) {
            return group.memberIds.indexOf(id) !== -1;
        }).map(function (group) { return group.id; });
    }

    root.PhoneContactGroups = {
        storageKey: STORAGE_KEY,
        getGroups: getGroups,
        saveGroups: saveGroups,
        buildAudienceSnapshot: buildAudienceSnapshot,
        canViewPost: canViewPost,
        canRoleReceivePost: canRoleReceivePost,
        getGroupIdsForContact: getGroupIdsForContact,
        normalizeGroups: normalizeGroups,
        readStoredGroups: readStoredGroups
    };
})(window);
