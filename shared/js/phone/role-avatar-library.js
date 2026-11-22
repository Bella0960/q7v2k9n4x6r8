/* ============================================================
 * role-avatar-library.js — 角色专属头像库
 *
 * 图片二进制由 MediaRepository 存入 maomao-assets；本模块仅保存
 * 角色级 assetId 引用与轻量元数据。不同角色完全隔离。
 * 旧版 role.avatar DataURL 暂时保留给尚未迁移的页面读取。
 * ============================================================ */
(function (global) {
    'use strict';

    var KEY_PREFIX = 'maomao_role_avatar_library_v1_';
    var DELETED_KEY_PREFIX = 'maomao_role_avatar_library_deleted_v1_';
    var OWNER_TYPE = 'role-avatar';
    var ASSET_RE = /^as_[A-Z2-7]{32}$/;

    function failure(code, message) {
        return { ok: false, error: { code: code, message: message, retryable: false } };
    }

    function validRoleId(roleId) {
        return roleId != null && String(roleId).trim() !== '' && String(roleId).length <= 180;
    }

    function storageKey(roleId) {
        return KEY_PREFIX + encodeURIComponent(String(roleId));
    }

    // A persistent tombstone prevents late chat/vision promises from recreating a
    // character's portrait library after that character has been deleted.
    function deletedStorageKey(roleId) {
        return DELETED_KEY_PREFIX + encodeURIComponent(String(roleId));
    }

    function isDeletionTombstone(value) {
        return value === '1' || value === 'done';
    }

    function roleMutationBlock(roleId) {
        try {
            if (!global.localStorage) return failure('STORAGE_FAILED', 'role deletion state cannot be checked');
            if (isDeletionTombstone(global.localStorage.getItem(deletedStorageKey(roleId)))) {
                return failure('ROLE_DELETED', 'this character was deleted; its portrait library is read-only');
            }
            return null;
        } catch (error) {
            return failure('STORAGE_FAILED', 'role deletion state cannot be checked');
        }
    }

    function isRoleDeleted(roleId) {
        try {
            return !!(global.localStorage && isDeletionTombstone(global.localStorage.getItem(deletedStorageKey(roleId))));
        } catch (error) {
            return false;
        }
    }

    function markRoleDeleted(roleId) {
        try {
            if (!global.localStorage) return false;
            global.localStorage.setItem(deletedStorageKey(roleId), '1');
            return true;
        } catch (error) {
            return false;
        }
    }

    function markRoleDeletionComplete(roleId) {
        try {
            if (!global.localStorage) return false;
            global.localStorage.setItem(deletedStorageKey(roleId), 'done');
            return true;
        } catch (error) {
            return false;
        }
    }

    // The cleanup queue is a convenience index, not the source of truth. A page may
    // close after the tombstone is written but before the queue is updated; discover
    // those interrupted deletions directly from localStorage on the next profile load.
    function listPendingRoleCleanups() {
        var storage = global.localStorage;
        if (!storage || typeof storage.key !== 'function') {
            return failure('STORAGE_FAILED', 'pending role cleanup markers cannot be enumerated');
        }
        try {
            var pending = [];
            var seen = Object.create(null);
            var length = Number(storage.length);
            if (!isFinite(length) || length < 0) {
                return failure('STORAGE_FAILED', 'pending role cleanup markers cannot be enumerated');
            }
            for (var i = 0; i < length; i++) {
                var key = storage.key(i);
                if (typeof key !== 'string' || key.indexOf(DELETED_KEY_PREFIX) !== 0) continue;
                var status = storage.getItem(key);
                if (status !== '1' && status !== 'pending') continue;
                var roleId;
                try { roleId = decodeURIComponent(key.slice(DELETED_KEY_PREFIX.length)); }
                catch (error) { continue; }
                if (!validRoleId(roleId) || seen[roleId]) continue;
                seen[roleId] = true;
                pending.push(roleId);
            }
            pending.sort();
            return { ok: true, value: pending };
        } catch (error) {
            return failure('STORAGE_FAILED', 'pending role cleanup markers cannot be read');
        }
    }

    function cleanupStaleRoleAsset(media, assetId, roleId) {
        return Promise.resolve().then(function () {
            return media.removeRef(assetId, OWNER_TYPE, String(roleId));
        }).then(function (released) {
            if (!released || !released.ok) {
                return failure('PARTIAL_ROLLBACK', 'the deleted character no longer accepts portraits; a stale media reference needs cleanup');
            }
            if (typeof media.removeAsset !== 'function') {
                return failure('PARTIAL_ROLLBACK', 'the deleted character no longer accepts portraits; an unowned media asset could not be checked');
            }
            // MediaRepository removes the blob only when its transaction finds zero references.
            // A chat message or another role may still own the same asset; that is expected.
            return Promise.resolve(media.removeAsset(assetId)).then(function (removed) {
                if (removed && removed.ok) {
                    return failure('ROLE_DELETED', 'this character was deleted; the unowned portrait was reclaimed');
                }
                var meta = removed && removed.meta ? removed.meta : {};
                var retainedRefs = Array.isArray(meta.refs) ? meta.refs.length : 0;
                if (Number(meta.refCount) > 0 || retainedRefs > 0) {
                    return failure('ROLE_DELETED', 'this character was deleted; the source image is retained because another feature still references it');
                }
                return failure('PARTIAL_ROLLBACK', 'the deleted character no longer accepts portraits; an unowned media asset needs cleanup');
            });
        }).catch(function () {
            return failure('PARTIAL_ROLLBACK', 'the deleted character no longer accepts portraits; a stale media reference needs cleanup');
        });
    }

    function cleanupRejectedRoleAsset(media, assetId, roleId, rejectedResult) {
        return Promise.resolve().then(function () {
            return media.removeRef(assetId, OWNER_TYPE, String(roleId));
        }).then(function (released) {
            if (!released || !released.ok) {
                return failure('PARTIAL_ROLLBACK', 'the portrait operation was rejected, but its new media reference could not be rolled back');
            }
            if (typeof media.removeAsset !== 'function') {
                return failure('PARTIAL_ROLLBACK', 'the portrait operation was rejected, but its media asset could not be checked for cleanup');
            }
            return Promise.resolve(media.removeAsset(assetId)).then(function (removed) {
                if (removed && removed.ok) return rejectedResult;
                var meta = removed && removed.meta ? removed.meta : {};
                var retainedRefs = Array.isArray(meta.refs) ? meta.refs.length : 0;
                if (Number(meta.refCount) > 0 || retainedRefs > 0) return rejectedResult;
                return failure('PARTIAL_ROLLBACK', 'the portrait operation was rejected and an unowned media asset still needs cleanup');
            });
        }).catch(function () {
            return failure('PARTIAL_ROLLBACK', 'the portrait operation was rejected, but media cleanup could not be completed');
        });
    }

    function emptyState() {
        return { version: 2, activeId: '', items: [], pairs: [] };
    }

    function normalizeState(raw) {
        var input = raw && typeof raw === 'object' ? raw : {};
        var source = Array.isArray(input.items) ? input.items : [];
        var seen = Object.create(null);
        var items = [];
        source.forEach(function (item) {
            if (!item || typeof item !== 'object') return;
            var assetId = String(item.assetId || '');
            if (!ASSET_RE.test(assetId) || seen[assetId]) return;
            seen[assetId] = true;
            items.push({
                id: 'avatar_' + assetId.slice(3),
                assetId: assetId,
                label: String(item.label || '角色头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '角色头像',
                source: item.source === 'legacy' ? 'legacy' : (item.source === 'chat' ? 'chat' : 'upload'),
                createdAt: Math.max(0, Number(item.createdAt) || 0)
            });
        });
        items.sort(function (a, b) { return b.createdAt - a.createdAt; });
        var activeId = String(input.activeId || '');
        if (!items.some(function (item) { return item.id === activeId; })) activeId = '';

        // Pair metadata links two existing portraits; it never duplicates image bytes.
        var itemById = Object.create(null);
        items.forEach(function (item) { itemById[item.id] = item; });
        var pairSeen = Object.create(null);
        var pairedAvatarIds = Object.create(null);
        var pairs = [];
        (Array.isArray(input.pairs) ? input.pairs : []).forEach(function (pair) {
            if (!pair || typeof pair !== 'object' || !Array.isArray(pair.avatarIds) || pair.avatarIds.length !== 2) return;
            var firstId = String(pair.avatarIds[0] || '');
            var secondId = String(pair.avatarIds[1] || '');
            if (!firstId || !secondId || firstId === secondId || !itemById[firstId] || !itemById[secondId]) return;
            if (pairedAvatarIds[firstId] || pairedAvatarIds[secondId]) return;
            var canonical = [firstId, secondId].sort();
            var key = canonical.join('|');
            if (pairSeen[key]) return;
            pairSeen[key] = true;
            pairedAvatarIds[firstId] = true;
            pairedAvatarIds[secondId] = true;
            pairs.push({
                id: 'pair_' + canonical.map(function (id) { return id.replace(/^avatar_/, ''); }).join('_'),
                avatarIds: [firstId, secondId],
                label: String(pair.label || '配对头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '配对头像',
                source: pair.source === 'chat' ? 'chat' : 'manual',
                createdAt: Math.max(0, Number(pair.createdAt) || 0)
            });
        });
        pairs.sort(function (a, b) { return b.createdAt - a.createdAt; });
        return { version: 2, activeId: activeId, items: items, pairs: pairs };
    }

    function readStateResult(roleId) {
        if (!validRoleId(roleId) || !global.localStorage) {
            return failure('STORAGE_FAILED', 'role avatar data cannot be read');
        }
        try {
            var raw = global.localStorage.getItem(storageKey(roleId));
            return { ok: true, value: raw ? normalizeState(JSON.parse(raw)) : emptyState() };
        } catch (error) {
            return failure('STORAGE_FAILED', 'role avatar data cannot be read');
        }
    }

    function readState(roleId) {
        var result = readStateResult(roleId);
        return result && result.ok ? result.value : emptyState();
    }

    function writeState(roleId, state) {
        if (!validRoleId(roleId) || !global.localStorage) return false;
        try {
            global.localStorage.setItem(storageKey(roleId), JSON.stringify(normalizeState(state)));
            return true;
        } catch (error) {
            return false;
        }
    }

    function mediaRepository() {
        var phoneStorage = global.PhoneStorage || {};
        if (typeof phoneStorage.MediaRepository !== 'function') return null;
        try { return new phoneStorage.MediaRepository(); } catch (error) { return null; }
    }

    function copyItem(item, activeId) {
        return {
            id: item.id,
            assetId: item.assetId,
            label: item.label,
            source: item.source,
            createdAt: item.createdAt,
            active: item.id === activeId
        };
    }

    function list(roleId) {
        var state = readState(roleId);
        return state.items.map(function (item) { return copyItem(item, state.activeId); });
    }

    function getActive(roleId) {
        var state = readState(roleId);
        var item = state.items.find(function (entry) { return entry.id === state.activeId; });
        return item ? copyItem(item, state.activeId) : null;
    }

    function find(roleId, avatarId) {
        var state = readState(roleId);
        var item = state.items.find(function (entry) { return entry.id === String(avatarId || ''); });
        return item ? copyItem(item, state.activeId) : null;
    }

    function copyPair(pair, state) {
        return {
            id: pair.id,
            label: pair.label,
            avatarIds: pair.avatarIds.slice(),
            avatars: pair.avatarIds.map(function (avatarId) {
                var item = state.items.find(function (entry) { return entry.id === avatarId; });
                return item ? copyItem(item, state.activeId) : null;
            }),
            source: pair.source,
            createdAt: pair.createdAt
        };
    }

    function getPairs(roleId) {
        var state = readState(roleId);
        return state.pairs.map(function (pair) { return copyPair(pair, state); });
    }

    function getPairForAvatar(roleId, avatarId) {
        if (!validRoleId(roleId)) return null;
        avatarId = String(avatarId || '');
        if (!avatarId) return null;
        var state = readState(roleId);
        var pair = state.pairs.find(function (item) { return item.avatarIds.indexOf(avatarId) >= 0; });
        return pair ? copyPair(pair, state) : null;
    }

    function linkPair(roleId, firstAvatarId, secondAvatarId, options) {
        options = options || {};
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        firstAvatarId = String(firstAvatarId || '');
        secondAvatarId = String(secondAvatarId || '');
        if (!firstAvatarId || !secondAvatarId || firstAvatarId === secondAvatarId) {
            return failure('VALIDATION_FAILED', 'a pair must contain two different portraits');
        }
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return stateResult;
        var state = stateResult.value;
        var first = state.items.find(function (item) { return item.id === firstAvatarId; });
        var second = state.items.find(function (item) { return item.id === secondAvatarId; });
        if (!first || !second) return failure('NOT_FOUND', 'both portraits must belong to this character library');
        var canonical = [firstAvatarId, secondAvatarId].sort();
        var key = canonical.join('|');
        var duplicate = state.pairs.find(function (pair) { return pair.avatarIds.slice().sort().join('|') === key; });
        if (duplicate) return { ok: true, value: copyPair(duplicate, state), meta: { reused: true } };
        var conflict = state.pairs.find(function (pair) {
            return pair.avatarIds.indexOf(firstAvatarId) >= 0 || pair.avatarIds.indexOf(secondAvatarId) >= 0;
        });
        if (conflict) return failure('PAIR_CONFLICT', 'a portrait can belong to only one pair; unlink its existing pair first');

        var pair = {
            id: 'pair_' + canonical.map(function (id) { return id.replace(/^avatar_/, ''); }).join('_'),
            avatarIds: [firstAvatarId, secondAvatarId],
            label: String(options.label || '配对头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '配对头像',
            source: options.source === 'chat' ? 'chat' : 'manual',
            createdAt: Number(options.createdAt) || Date.now()
        };
        var next = { version: 2, activeId: state.activeId, items: state.items, pairs: state.pairs.concat([pair]) };
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair relationship could not be saved');
        return { ok: true, value: copyPair(pair, next), meta: { reused: false } };
    }

    function unlinkPair(roleId, pairId) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return stateResult;
        var state = stateResult.value;
        pairId = String(pairId || '');
        var pair = state.pairs.find(function (item) { return item.id === pairId; });
        if (!pair) return failure('NOT_FOUND', 'paired avatar set was not found');
        var next = {
            version: 2,
            activeId: state.activeId,
            items: state.items,
            pairs: state.pairs.filter(function (item) { return item.id !== pairId; })
        };
        // The old chat-side assignment must not silently resurrect if the
        // same two pictures are later linked again (pair IDs are deterministic).
        // Snapshot both records before the first write so a failed clear can
        // restore the exact old library without deleting either image.
        var libraryKey = storageKey(roleId);
        var selectionKey = chatPairKey(roleId);
        var previousLibrary, previousSelection, clearsCurrentSelection = false;
        try {
            previousLibrary = global.localStorage.getItem(libraryKey);
            previousSelection = global.localStorage.getItem(selectionKey);
            if (previousSelection) {
                try {
                    clearsCurrentSelection = JSON.parse(previousSelection).pairId === pairId;
                } catch (parseError) {
                    // A corrupt legacy selection is already ignored on read.
                }
            }
        } catch (error) {
            return failure('STORAGE_FAILED', 'pair selection could not be read');
        }
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair relationship could not be removed');
        if (clearsCurrentSelection) {
            try {
                global.localStorage.removeItem(selectionKey);
            } catch (error) {
                // Keep the pair linked if its chat assignment could not be
                // cleared; never report unlink as successful in this case.
                try {
                    if (previousLibrary == null) global.localStorage.removeItem(libraryKey);
                    else global.localStorage.setItem(libraryKey, previousLibrary);
                } catch (rollbackError) {
                    return failure('PARTIAL_ROLLBACK', 'pair unlink could not fully restore its metadata');
                }
                return failure('STORAGE_FAILED', 'chat pair selection could not be cleared');
            }
        }
        return { ok: true, value: copyPair(pair, state), meta: { portraitsRetained: true, chatSelectionCleared: clearsCurrentSelection } };
    }

    function renamePair(roleId, pairId, label) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        pairId = String(pairId || '');
        label = String(label == null ? '' : label)
            .replace(/[\u0000-\u001F<>]/g, '')
            .trim()
            .slice(0, 36);
        if (!label) return failure('VALIDATION_FAILED', 'pair name cannot be empty');

        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return stateResult;
        var state = stateResult.value;
        var pair = state.pairs.find(function (item) { return item.id === pairId; });
        if (!pair) return failure('NOT_FOUND', 'paired avatar set was not found');
        var renamed = {
            id: pair.id,
            avatarIds: pair.avatarIds.slice(),
            label: label,
            source: pair.source,
            createdAt: pair.createdAt
        };
        var next = {
            version: 2,
            activeId: state.activeId,
            items: state.items,
            pairs: state.pairs.map(function (item) { return item.id === pairId ? renamed : item; })
        };
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair name could not be saved');
        return { ok: true, value: copyPair(renamed, next), meta: { renamed: true } };
    }

    function swapPair(roleId, pairId) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return stateResult;
        var state = stateResult.value;
        pairId = String(pairId || '');
        var pair = state.pairs.find(function (item) { return item.id === pairId; });
        if (!pair) return failure('NOT_FOUND', 'paired avatar set was not found');

        var swapped = {
            id: pair.id,
            avatarIds: [pair.avatarIds[1], pair.avatarIds[0]],
            label: pair.label,
            source: pair.source,
            createdAt: pair.createdAt
        };
        var next = {
            version: 2,
            activeId: state.activeId,
            items: state.items,
            pairs: state.pairs.map(function (item) { return item.id === pairId ? swapped : item; })
        };
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair order could not be saved');
        return { ok: true, value: copyPair(swapped, next), meta: { swapped: true } };
    }

    function setActive(roleId, avatarId) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return stateResult;
        var state = stateResult.value;
        avatarId = String(avatarId || '');
        if (avatarId && !state.items.some(function (item) { return item.id === avatarId; })) {
            return failure('NOT_FOUND', 'avatar does not belong to this character');
        }
        state.activeId = avatarId;
        if (!writeState(roleId, state)) return failure('STORAGE_FAILED', 'avatar selection could not be saved');
        return { ok: true, value: getActive(roleId), meta: { activeId: avatarId } };
    }

    async function applyToCharacter(roleId, avatarId, options) {
        options = options || {};
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var item = find(roleId, avatarId);
        if (!item) return failure('NOT_FOUND', 'avatar does not belong to this character');
        var charactersBefore;
        var indexBefore;
        try {
            charactersBefore = global.localStorage.getItem('ai_custom_characters');
            indexBefore = global.localStorage.getItem(storageKey(roleId));
        } catch (error) { return failure('STORAGE_FAILED', 'character data cannot be read'); }
        var resolved;
        try { resolved = await toDataUrl(item.assetId); }
        catch (error) { return failure('DB_UNAVAILABLE', 'avatar image cannot be read'); }
        if (!resolved || !resolved.ok || !/^data:image\//i.test(resolved.value || '')) {
            return failure('DB_UNAVAILABLE', 'avatar image cannot be read');
        }
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        try {
            // Do not overwrite a newer portrait, role edit, deletion or account switch
            // while the asynchronous media read was in flight.
            if ((options.isCurrent && options.isCurrent() !== true) ||
                global.localStorage.getItem('ai_custom_characters') !== charactersBefore ||
                global.localStorage.getItem(storageKey(roleId)) !== indexBefore) {
                return failure('STALE_SELECTION', 'character data changed while reading the image');
            }
            var characters = JSON.parse(charactersBefore);
            if (!Array.isArray(characters)) return failure('CORRUPT_DATA', 'character list is invalid');
            var character = characters.find(function (entry) { return entry && String(entry.id) === String(roleId); });
            if (!character) return failure('NOT_FOUND', 'character no longer exists');
            var activated = setActive(roleId, avatarId);
            if (!activated.ok) return activated;
            character.avatar = resolved.value;
            character.avatarAssetId = item.assetId;
            try {
                global.localStorage.setItem('ai_custom_characters', JSON.stringify(characters));
            } catch (error) {
                try {
                    if (indexBefore == null) global.localStorage.removeItem(storageKey(roleId));
                    else global.localStorage.setItem(storageKey(roleId), indexBefore);
                } catch (rollbackError) { return failure('PARTIAL_ROLLBACK', 'portrait selection needs repair'); }
                return failure('STORAGE_FAILED', 'character portrait could not be saved');
            }
            return { ok: true, value: character };
        } catch (error) { return failure('STORAGE_FAILED', 'character portrait could not be saved'); }
    }


    // A matching-pair assignment changes only this chat's user portrait.
    // The user's global myProfile avatar is intentionally never modified.
    var CHAT_PAIR_KEY_PREFIX = 'maomao_chat_pair_user_avatar_v1_';
    function chatPairKey(roleId) {
        return CHAT_PAIR_KEY_PREFIX + encodeURIComponent(String(roleId));
    }

    function getChatPairUserSelection(roleId) {
        if (!validRoleId(roleId)) return null;
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return null;
        try {
            var raw = global.localStorage.getItem(chatPairKey(roleId));
            if (!raw) return null;
            var selected = JSON.parse(raw);
            if (!selected || !ASSET_RE.test(String(selected.assetId || ''))) return null;
            var pair = stateResult.value.pairs.find(function (entry) {
                // A/B swapping is a draft ordering change, not an implicit
                // re-application of the chat's already-selected user picture.
                return entry.id === selected.pairId &&
                    entry.avatarIds.indexOf(selected.avatarId) >= 0;
            });
            var userItem = stateResult.value.items.find(function (entry) {
                return entry.id === selected.avatarId && entry.assetId === selected.assetId;
            });
            return pair && userItem ? {
                pairId: pair.id, avatarId: userItem.id, assetId: userItem.assetId
            } : null;
        } catch (error) { return null; }
    }

    async function applyPairToChat(roleId, pairId, options) {
        options = options || {};
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
        var blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        var beforeState = readStateResult(roleId);
        if (!beforeState.ok) return beforeState;
        var pair = beforeState.value.pairs.find(function (entry) {
            return entry.id === String(pairId || '');
        });
        if (!pair) return failure('NOT_FOUND', 'paired portraits were not found');
        var roleAvatar = beforeState.value.items.find(function (item) {
            return item.id === pair.avatarIds[0];
        });
        var userAvatar = beforeState.value.items.find(function (item) {
            return item.id === pair.avatarIds[1];
        });
        if (!roleAvatar || !userAvatar) return failure('NOT_FOUND', 'pair portraits are unavailable');

        var oldCharacters, oldLibrary, oldChatUser;
        var libraryKey = storageKey(roleId);
        var userKey = chatPairKey(roleId);
        try {
            oldCharacters = global.localStorage.getItem('ai_custom_characters');
            oldLibrary = global.localStorage.getItem(libraryKey);
            oldChatUser = global.localStorage.getItem(userKey);
        } catch (error) { return failure('STORAGE_FAILED', 'pair selection could not be read'); }

        var images;
        try {
            images = await Promise.all([toDataUrl(roleAvatar.assetId), toDataUrl(userAvatar.assetId)]);
        } catch (error) { return failure('DB_UNAVAILABLE', 'pair portraits cannot be read'); }
        if (images.some(function (result) {
            return !result || !result.ok || !/^data:image\//i.test(result.value || '');
        })) return failure('DB_UNAVAILABLE', 'pair portraits cannot be read');

        blocked = roleMutationBlock(roleId);
        if (blocked) return blocked;
        try {
            if ((options.isCurrent && options.isCurrent() !== true) ||
                global.localStorage.getItem('ai_custom_characters') !== oldCharacters ||
                global.localStorage.getItem(libraryKey) !== oldLibrary ||
                global.localStorage.getItem(userKey) !== oldChatUser) {
                return failure('STALE_SELECTION', 'pair or character changed during image loading');
            }
            var roles = JSON.parse(oldCharacters);
            if (!Array.isArray(roles)) return failure('CORRUPT_DATA', 'character list is invalid');
            var role = roles.find(function (entry) { return entry && String(entry.id) === String(roleId); });
            if (!role) return failure('NOT_FOUND', 'character no longer exists');
            role.avatar = images[0].value;
            role.avatarAssetId = roleAvatar.assetId;

            // All three writes are synchronous, with snapshots to restore if any fail.
            // No image bytes are copied into the chat-scoped assignment.
            var nextState = normalizeState(beforeState.value);
            nextState.activeId = roleAvatar.id;
            var writes = { library: false, characters: false, chat: false };
            try {
                global.localStorage.setItem(libraryKey, JSON.stringify(nextState));
                writes.library = true;
                global.localStorage.setItem('ai_custom_characters', JSON.stringify(roles));
                writes.characters = true;
                global.localStorage.setItem(userKey, JSON.stringify({
                    pairId: pair.id, avatarId: userAvatar.id, assetId: userAvatar.assetId
                }));
                writes.chat = true;
            } catch (error) {
                var restored = true;
                function rollback(key, raw) {
                    try {
                        if (raw == null) global.localStorage.removeItem(key);
                        else global.localStorage.setItem(key, raw);
                    } catch (rollbackError) { restored = false; }
                }
                if (writes.chat) rollback(userKey, oldChatUser);
                if (writes.characters) rollback('ai_custom_characters', oldCharacters);
                if (writes.library) rollback(libraryKey, oldLibrary);
                return restored
                    ? failure('STORAGE_FAILED', 'pair assignment was not saved; previous portraits were retained')
                    : failure('PARTIAL_ROLLBACK', 'pair assignment failed and a portrait snapshot needs repair');
            }
            return { ok: true, value: {
                role: role, pairId: pair.id, roleAssetId: roleAvatar.assetId, userAssetId: userAvatar.assetId
            } };
        } catch (error) {
            return failure('STORAGE_FAILED', 'pair assignment could not be completed');
        }
    }

    function add(roleId, input, options) {
        options = options || {};
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
        var blocked = roleMutationBlock(roleId);
        if (blocked) return Promise.resolve(blocked);
        if (!input) return Promise.resolve(failure('VALIDATION_FAILED', 'image input is required'));
        var mime = String(options.mimeType || input.type || '');
        if (typeof input === 'string') {
            var match = input.match(/^data:(image\/[a-z0-9.+-]+)[;,]/i);
            mime = match ? match[1] : mime;
            if (!match) return Promise.resolve(failure('VALIDATION_FAILED', 'only image data URLs are accepted'));
        }
        if (mime && mime.toLowerCase().indexOf('image/') !== 0) {
            return Promise.resolve(failure('VALIDATION_FAILED', 'only image files are accepted'));
        }

        var media = mediaRepository();
        if (!media || typeof media.putBlob !== 'function') {
            return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));
        }

        return media.putBlob(input, {
            ownerType: OWNER_TYPE,
            ownerId: String(roleId),
            type: 'image',
            mimeType: mime || 'image/jpeg'
        }).then(function (saved) {
            if (!saved || !saved.ok || !saved.value || !ASSET_RE.test(String(saved.value.assetId || ''))) {
                return saved && saved.ok === false ? saved : failure('CORRUPT_DATA', 'image asset could not be stored');
            }

            var assetId = String(saved.value.assetId);
            var roleRefAdded = saved.meta && typeof saved.meta.refAdded === 'boolean'
                ? saved.meta.refAdded : saved.value.reused !== true;
            var deletedBlock = roleMutationBlock(roleId);
            if (deletedBlock) {
                if (deletedBlock.error && deletedBlock.error.code === 'ROLE_DELETED') {
                    return cleanupStaleRoleAsset(media, assetId, roleId);
                }
                return roleRefAdded
                    ? cleanupRejectedRoleAsset(media, assetId, roleId, deletedBlock)
                    : deletedBlock;
            }
            // Re-read after the asynchronous media write so parallel uploads cannot overwrite
            // another portrait added to this role while putBlob was pending.
            var latestResult = readStateResult(roleId);
            if (!latestResult.ok) {
                return roleRefAdded
                    ? cleanupRejectedRoleAsset(media, assetId, roleId, latestResult)
                    : latestResult;
            }
            var latest = latestResult.value;
            var existing = latest.items.find(function (item) { return item.assetId === assetId; });
            if (existing) return { ok: true, value: copyItem(existing, latest.activeId), meta: { reused: true } };

            var item = {
                id: 'avatar_' + assetId.slice(3),
                assetId: assetId,
                label: String(options.label || ('头像 ' + String(latest.items.length + 1))).replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '角色头像',
                source: options.source === 'legacy' ? 'legacy' : 'upload',
                createdAt: Number(options.createdAt) || Date.now()
            };
            var next = { version: 2, activeId: latest.activeId, items: [item].concat(latest.items), pairs: latest.pairs };
            if (!writeState(roleId, next)) {
                var writeFailure = failure('STORAGE_FAILED', 'avatar metadata could not be saved; original profile was not changed');
                return roleRefAdded
                    ? cleanupRejectedRoleAsset(media, assetId, roleId, writeFailure)
                    : writeFailure;
            }
            return { ok: true, value: copyItem(item, next.activeId), meta: { reused: !!saved.value.reused } };
        }).catch(function (error) {
            return failure('STORAGE_FAILED', error && error.message ? error.message : 'avatar could not be added');
        });
    }

    function addAsset(roleId, assetId, options) {
        options = options || {};
        assetId = String(assetId || '');
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
        var blocked = roleMutationBlock(roleId);
        if (blocked) return Promise.resolve(blocked);
        if (!ASSET_RE.test(assetId)) return Promise.resolve(failure('VALIDATION_FAILED', 'invalid assetId'));

        var media = mediaRepository();
        if (!media || typeof media.getAsset !== 'function' || typeof media.addRef !== 'function') {
            return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository cannot link an existing image asset'));
        }

        var previousResult = readStateResult(roleId);
        if (!previousResult.ok) return Promise.resolve(previousResult);
        var previous = previousResult.value;
        var existing = previous.items.find(function (item) { return item.assetId === assetId; });
        if (existing) {
            return Promise.resolve({ ok: true, value: copyItem(existing, previous.activeId), meta: { reused: true } });
        }

        return media.getAsset(assetId).then(function (found) {
            if (!found || !found.ok || !found.value || !found.value.asset || !found.value.blob) {
                return found && found.ok === false ? found : failure('NOT_FOUND', 'source image asset is unavailable');
            }
            var afterLookupBlock = roleMutationBlock(roleId);
            if (afterLookupBlock) {
                if (afterLookupBlock.error && afterLookupBlock.error.code === 'ROLE_DELETED') {
                    return cleanupStaleRoleAsset(media, assetId, roleId);
                }
                return afterLookupBlock;
            }
            var mime = String(found.value.asset.mimeType || found.value.blob.type || '').toLowerCase();
            if (mime.indexOf('image/') !== 0) return failure('VALIDATION_FAILED', 'source asset is not an image');

            return media.addRef(assetId, OWNER_TYPE, String(roleId)).then(function (linked) {
                if (!linked || !linked.ok) return linked || failure('STORAGE_FAILED', 'avatar asset reference could not be created');
                var afterLinkBlock = roleMutationBlock(roleId);
                if (afterLinkBlock) {
                    if (afterLinkBlock.error && afterLinkBlock.error.code === 'ROLE_DELETED') {
                        return cleanupStaleRoleAsset(media, assetId, roleId);
                    }
                    if (linked.value && linked.value.added === false) return afterLinkBlock;
                    return Promise.resolve(media.removeRef(assetId, OWNER_TYPE, String(roleId))).then(function (released) {
                        return released && released.ok
                            ? afterLinkBlock
                            : failure('PARTIAL_ROLLBACK', 'temporary storage failure prevented saving the portrait and its reference could not be rolled back');
                    }).catch(function () {
                        return failure('PARTIAL_ROLLBACK', 'temporary storage failure prevented saving the portrait and its reference could not be rolled back');
                    });
                }
                // Another async upload/link may have committed while getAsset/addRef was pending.
                // Merge into that latest role state instead of writing the stale preflight snapshot.
                var latestResult = readStateResult(roleId);
                if (!latestResult.ok) {
                    if (linked.value && linked.value.added === false) return latestResult;
                    return Promise.resolve(media.removeRef(assetId, OWNER_TYPE, String(roleId))).then(function (released) {
                        return released && released.ok ? latestResult
                            : failure('PARTIAL_ROLLBACK', 'role library could not be read and the new media reference could not be rolled back');
                    }).catch(function () {
                        return failure('PARTIAL_ROLLBACK', 'role library could not be read and the new media reference could not be rolled back');
                    });
                }
                var latest = latestResult.value;
                var current = latest.items.find(function (entry) { return entry.assetId === assetId; });
                if (current) return { ok: true, value: copyItem(current, latest.activeId), meta: { reused: true } };
                var item = {
                    id: 'avatar_' + assetId.slice(3),
                    assetId: assetId,
                    label: String(options.label || '聊天候选头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '聊天候选头像',
                    source: options.source === 'legacy' ? 'legacy' : (options.source === 'chat' ? 'chat' : 'upload'),
                    createdAt: Number(options.createdAt) || Date.now()
                };
                var next = { version: 2, activeId: latest.activeId, items: [item].concat(latest.items), pairs: latest.pairs };
                if (!writeState(roleId, next)) {
                    if (linked.value && linked.value.added === false) {
                        return failure('STORAGE_FAILED', 'avatar candidate metadata could not be saved; an existing media reference was left intact');
                    }
                    return media.removeRef(assetId, OWNER_TYPE, String(roleId)).then(function (released) {
                        return released && released.ok
                            ? failure('STORAGE_FAILED', 'avatar candidate metadata could not be saved')
                            : failure('PARTIAL_ROLLBACK', 'avatar candidate metadata could not be saved and its new media reference could not be rolled back');
                    });
                }
                return { ok: true, value: copyItem(item, next.activeId), meta: { linked: true } };
            });
        }).catch(function (error) {
            return failure('STORAGE_FAILED', error && error.message ? error.message : 'avatar candidate could not be linked');
        });
    }

    function addAssetPair(roleId, firstAssetId, secondAssetId, options) {
        options = options || {};
        firstAssetId = String(firstAssetId || '');
        secondAssetId = String(secondAssetId || '');
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
        var blocked = roleMutationBlock(roleId);
        if (blocked) return Promise.resolve(blocked);
        if (!ASSET_RE.test(firstAssetId) || !ASSET_RE.test(secondAssetId)) {
            return Promise.resolve(failure('VALIDATION_FAILED', 'both pair image assets must be valid'));
        }
        if (firstAssetId === secondAssetId) {
            return Promise.resolve(failure('VALIDATION_FAILED', 'a pair must contain two different image assets'));
        }

        var roleKey = String(roleId);
        var label = String(options.label || '聊天配对头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '聊天配对头像';
        var pairItems = [];
        var pairFailure = null;
        var linkedPair = null;

        function rollbackNewItems() {
            // removeRole owns cleanup once the tombstone exists; the pair rollback must not
            // mistake its already-removed entries for a failed cleanup.
            if (isRoleDeleted(roleKey)) return Promise.resolve({ failed: false });
            return pairItems.reduce(function (chain, result) {
                return chain.then(function (state) {
                    if (!result.meta || result.meta.linked !== true) return state;
                    return remove(roleKey, result.value.id).then(function (removed) {
                        if (!removed || !removed.ok) state.failed = true;
                        return state;
                    }).catch(function () {
                        state.failed = true;
                        return state;
                    });
                });
            }, Promise.resolve({ failed: false }));
        }

        return addAsset(roleKey, firstAssetId, {
            source: 'chat',
            label: String(options.firstLabel || (label + ' · A'))
        }).then(function (first) {
            if (!first || !first.ok || !first.value) {
                pairFailure = first || failure('STORAGE_FAILED', 'first pair image could not be saved');
                return;
            }
            pairItems.push(first);
            return addAsset(roleKey, secondAssetId, {
                source: 'chat',
                label: String(options.secondLabel || (label + ' · B'))
            }).then(function (second) {
                if (!second || !second.ok || !second.value) {
                    pairFailure = second || failure('STORAGE_FAILED', 'second pair image could not be saved');
                    return;
                }
                pairItems.push(second);
            });
        }).then(function () {
            if (!pairFailure && pairItems.length === 2) {
                linkedPair = linkPair(roleKey, pairItems[0].value.id, pairItems[1].value.id, {
                    source: 'chat',
                    label: label,
                    createdAt: options.createdAt
                });
                if (!linkedPair || !linkedPair.ok) {
                    pairFailure = linkedPair || failure('STORAGE_FAILED', 'pair relationship could not be saved');
                }
            }

            if (!pairFailure && linkedPair && linkedPair.ok) {
                return {
                    ok: true,
                    value: linkedPair.value,
                    meta: {
                        reused: !!(linkedPair.meta && linkedPair.meta.reused),
                        avatarIds: pairItems.map(function (result) { return result.value.id; })
                    }
                };
            }

            return rollbackNewItems().then(function (rollback) {
                if (rollback.failed) {
                    return {
                        ok: false,
                        error: {
                            code: 'PARTIAL_ROLLBACK',
                            message: 'pair creation failed; a newly added unpaired portrait could not be cleaned up',
                            retryable: true
                        },
                        meta: { cleanupRequired: true, originalError: pairFailure && pairFailure.error ? pairFailure.error.code : 'UNKNOWN' }
                    };
                }
                return pairFailure || failure('STORAGE_FAILED', 'pair could not be saved');
            });
        }).catch(function (error) {
            return rollbackNewItems().then(function (rollback) {
                if (rollback.failed) {
                    return {
                        ok: false,
                        error: {
                            code: 'PARTIAL_ROLLBACK',
                            message: 'pair creation failed; a newly added unpaired portrait could not be cleaned up',
                            retryable: true
                        },
                        meta: { cleanupRequired: true, originalError: error && error.message ? error.message : 'UNKNOWN' }
                    };
                }
                return failure('STORAGE_FAILED', error && error.message ? error.message : 'pair could not be saved');
            });
        });
    }

    function toDataUrl(assetId) {
        if (!ASSET_RE.test(String(assetId || ''))) return Promise.resolve(failure('VALIDATION_FAILED', 'invalid assetId'));
        var media = mediaRepository();
        if (!media || typeof media.toDataUrl !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));
        return media.toDataUrl(assetId);
    }

    function toObjectUrl(assetId) {
        if (!ASSET_RE.test(String(assetId || ''))) return Promise.resolve(failure('VALIDATION_FAILED', 'invalid assetId'));
        var media = mediaRepository();
        if (!media || typeof media.toObjectUrl !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));
        return media.toObjectUrl(assetId);
    }

    function remove(roleId, avatarId) {
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
        var blocked = roleMutationBlock(roleId);
        if (blocked) return Promise.resolve(blocked);
        var previousResult = readStateResult(roleId);
        if (!previousResult.ok) return Promise.resolve(previousResult);
        var previous = previousResult.value;
        var item = previous.items.find(function (entry) { return entry.id === String(avatarId || ''); });
        if (!item) return Promise.resolve(failure('NOT_FOUND', 'avatar not found in this character library'));
        if (previous.activeId === item.id) return Promise.resolve(failure('VALIDATION_FAILED', 'select another avatar before removing the current one'));
        if (previous.pairs.some(function (pair) { return pair.avatarIds.indexOf(item.id) >= 0; })) {
            return Promise.resolve(failure('PAIR_EXISTS', 'unlink this portrait pair before removing an image'));
        }

        var media = mediaRepository();
        if (!media || typeof media.removeRef !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));

        function restoreReference(result) {
            if (typeof media.addRef !== 'function') return Promise.resolve(result);
            return media.addRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (restored) {
                return restored && restored.ok ? result : failure('STORAGE_FAILED', 'avatar reference could not be restored');
            }).catch(function () {
                return failure('STORAGE_FAILED', 'avatar reference could not be restored');
            });
        }

        return media.removeRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (removedRef) {
            if (!removedRef || !removedRef.ok) return removedRef || failure('STORAGE_FAILED', 'avatar reference could not be removed');

            var deletedBlock = roleMutationBlock(roleId);
            if (deletedBlock) {
                if (deletedBlock.error && deletedBlock.error.code === 'ROLE_DELETED') return deletedBlock;
                if (removedRef.value && removedRef.value.removed) return restoreReference(deletedBlock);
                return deletedBlock;
            }
            // The library may have changed while IndexedDB was releasing the reference.
            // Revalidate active/pair state and merge against the latest role snapshot.
            var latestResult = readStateResult(roleId);
            if (!latestResult.ok) {
                if (removedRef.value && removedRef.value.removed) return restoreReference(latestResult);
                return latestResult;
            }
            var latest = latestResult.value;
            var latestItem = latest.items.find(function (entry) { return entry.id === item.id; });
            if (!latestItem) return failure('NOT_FOUND', 'avatar was already removed from this character library');
            if (latest.activeId === latestItem.id) {
                return restoreReference(failure('VALIDATION_FAILED', 'select another avatar before removing the current one'));
            }
            if (latest.pairs.some(function (pair) { return pair.avatarIds.indexOf(latestItem.id) >= 0; })) {
                return restoreReference(failure('PAIR_EXISTS', 'unlink this portrait pair before removing an image'));
            }

            var next = {
                version: 2,
                activeId: latest.activeId,
                items: latest.items.filter(function (entry) { return entry.id !== latestItem.id; }),
                pairs: latest.pairs
            };
            if (!writeState(roleId, next)) {
                return restoreReference(failure('STORAGE_FAILED', 'avatar library could not be updated'));
            }
            return media.removeAsset(latestItem.assetId).then(function (removedAsset) {
                var retained = !removedAsset || !removedAsset.ok;
                return {
                    ok: true,
                    value: latestItem,
                    meta: { assetRetained: retained, reason: retained ? (removedAsset.error && removedAsset.error.code || 'referenced_elsewhere') : '' }
                };
            });
        }).catch(function (error) {
            return failure('STORAGE_FAILED', error && error.message ? error.message : 'avatar could not be removed');
        });
    }

    function removeRole(roleId) {
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
        // Persist deletion intent before the first async media operation. Any request that
        // resumes later sees this marker and cannot repopulate the just-deleted library.
        if (!markRoleDeleted(roleId)) return Promise.resolve(failure('STORAGE_FAILED', 'role deletion marker could not be saved'));
        var stateResult = readStateResult(roleId);
        if (!stateResult.ok) return Promise.resolve(stateResult);
        var state = stateResult.value;
        var media = mediaRepository();
        if (!media || typeof media.removeRef !== 'function' || typeof media.removeAsset !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));

        var released = [];
        var cleanupItems = [];
        var referencesReleased = false;
        function addCleanupAsset(assetId) {
            assetId = String(assetId || '');
            if (!ASSET_RE.test(assetId) || cleanupItems.some(function (item) { return item.assetId === assetId; })) return;
            cleanupItems.push({ assetId: assetId });
        }
        state.items.forEach(function (item) { addCleanupAsset(item.assetId); });

        function restoreReferences() {
            if (!released.length) return Promise.resolve({ ok: true });
            if (typeof media.addRef !== 'function') return Promise.resolve({ ok: false });
            return released.reduce(function (chain, item) {
                return chain.then(function (result) {
                    var restore;
                    try {
                        restore = media.addRef(item.assetId, OWNER_TYPE, String(roleId));
                    } catch (error) {
                        return { ok: false, failedAssetIds: result.failedAssetIds.concat([item.assetId]) };
                    }
                    return Promise.resolve(restore).then(function (restored) {
                        return restored && restored.ok
                            ? result
                            : { ok: false, failedAssetIds: result.failedAssetIds.concat([item.assetId]) };
                    }, function () {
                        return { ok: false, failedAssetIds: result.failedAssetIds.concat([item.assetId]) };
                    });
                });
            }, Promise.resolve({ ok: true, failedAssetIds: [] }));
        }

        function returnAfterRestore(originalResult) {
            return restoreReferences().then(function (restored) {
                if (restored && restored.ok) return originalResult;
                return failure('PARTIAL_ROLLBACK', 'role deletion was interrupted and one or more released portrait references could not be restored; retry deletion cleanup');
            });
        }

        var listOwnedAssets = typeof media.listByOwner === 'function'
            ? Promise.resolve().then(function () { return media.listByOwner(OWNER_TYPE, String(roleId)); })
            : Promise.resolve({ ok: true, value: [] });

        return listOwnedAssets.then(function (listed) {
            if (!listed || !listed.ok) return listed || failure('STORAGE_FAILED', 'role-owned media references could not be listed');
            (Array.isArray(listed.value) ? listed.value : []).forEach(function (asset) {
                if (asset) addCleanupAsset(asset.assetId);
            });
            var missingIds = listed.meta && Array.isArray(listed.meta.missingIds) ? listed.meta.missingIds : [];
            missingIds.forEach(addCleanupAsset);

            return cleanupItems.reduce(function (chain, item) {
                return chain.then(function (result) {
                    if (!result.ok) return result;
                    return media.removeRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (removed) {
                        if (!removed || !removed.ok) return removed || failure('STORAGE_FAILED', 'avatar reference could not be released');
                        if (removed.value && removed.value.removed) released.push(item);
                        return { ok: true };
                    });
                });
            }, Promise.resolve({ ok: true }));
        }).then(function (result) {
            if (!result.ok) {
                return returnAfterRestore(result);
            }

            // Once every owner reference has been released, keep the local index until
            // every unowned blob is either deleted or proven to be shared. That index is
            // the retry manifest if a transient IndexedDB failure interrupts blob cleanup.
            referencesReleased = true;
            return cleanupItems.reduce(function (chain, item) {
                return chain.then(function (meta) {
                    return media.removeAsset(item.assetId).then(function (removed) {
                        if (!removed || !removed.ok) {
                            meta.retained = meta.retained + 1;
                            var code = removed && removed.error ? removed.error.code : '';
                            if (code !== 'VALIDATION_FAILED') meta.retryRequired = true;
                        }
                        return meta;
                    }).catch(function () {
                        meta.retained = meta.retained + 1;
                        meta.retryRequired = true;
                        return meta;
                    });
                });
            }, Promise.resolve({ retained: 0, retryRequired: false })).then(function (meta) {
                if (meta.retryRequired) {
                    return failure('STORAGE_FAILED', 'role references were released, but some unowned media could not be verified or deleted; retry cleanup');
                }
                try {
                    global.localStorage.removeItem(storageKey(roleId));
                    // A deleted role must never leave a chat-scoped user photo
                    // assignment that could reappear if its ID is reimported.
                    global.localStorage.removeItem(chatPairKey(roleId));
                } catch (error) {
                    return failure('STORAGE_FAILED', 'role portrait metadata or chat assignment could not be cleared; retry cleanup');
                }
                if (!markRoleDeletionComplete(roleId)) {
                    return failure('STORAGE_FAILED', 'role media references were released, but deletion completion could not be saved; retry cleanup');
                }
                return { ok: true, value: { removed: cleanupItems.length, retained: meta.retained } };
            });
        }).catch(function (error) {
            if (referencesReleased) {
                return failure('STORAGE_FAILED', error && error.message ? error.message : 'role avatar asset cleanup was incomplete; retry cleanup');
            }
            return returnAfterRestore(failure('STORAGE_FAILED', error && error.message ? error.message : 'role avatar library could not be removed'));
        });
    }

    global.RoleAvatarLibrary = {
        list: list,
        getActive: getActive,
        find: find,
        getPairs: getPairs,
        getPairForAvatar: getPairForAvatar,
        linkPair: linkPair,
        unlinkPair: unlinkPair,
        renamePair: renamePair,
        swapPair: swapPair,
        add: add,
        addAsset: addAsset,
        addAssetPair: addAssetPair,
        setActive: setActive,
        applyToCharacter: applyToCharacter,
        applyPairToChat: applyPairToChat,
        getChatPairUserSelection: getChatPairUserSelection,
        toDataUrl: toDataUrl,
        toObjectUrl: toObjectUrl,
        remove: remove,
        removeRole: removeRole,
        listPendingRoleCleanups: listPendingRoleCleanups,
        _normalizeState: normalizeState,
        _storageKey: storageKey
    };
})(window);

