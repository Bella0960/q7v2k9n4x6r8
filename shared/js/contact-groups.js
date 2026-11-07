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

    function getGroups() {
        try {
            var raw = root.localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            return normalizeGroups(JSON.parse(raw));
        } catch (error) {
            return [];
        }
    }

    function saveGroups(groups) {
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
        var groups = getGroups();
        var validGroups = Object.create(null);
        groups.forEach(function (group) { validGroups[group.id] = group; });
        var selectedGroupIds = uniqueIds(groupIds).filter(function (id) {
            return Object.prototype.hasOwnProperty.call(validGroups, id);
        });
        var selectedContactIds = uniqueIds(contactIds);
        var memberIds = selectedContactIds.slice();
        selectedGroupIds.forEach(function (id) {
            memberIds = memberIds.concat(validGroups[id].memberIds);
        });
        return {
            groupIds: selectedGroupIds,
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
        return visibility === 'public' || visibility === 'friends' || true;
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
        getGroupIdsForContact: getGroupIdsForContact,
        normalizeGroups: normalizeGroups
    };
})(window);
