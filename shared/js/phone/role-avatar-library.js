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

    function roleMutationBlock(roleId) {
        try {
            if (!global.localStorage) return failure('STORAGE_FAILED', 'role deletion state cannot be checked');
            if (global.localStorage.getItem(deletedStorageKey(roleId)) === '1') {
                return failure('ROLE_DELETED', 'this character was deleted; its portrait library is read-only');
            }
            return null;
        } catch (error) {
            return failure('STORAGE_FAILED', 'role deletion state cannot be checked');
        }
    }

    function isRoleDeleted(roleId) {
        try {
            return !!(global.localStorage && global.localStorage.getItem(deletedStorageKey(roleId)) === '1');
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

    function readState(roleId) {
        if (!validRoleId(roleId) || !global.localStorage) return emptyState();
        try {
            var raw = global.localStorage.getItem(storageKey(roleId));
            return raw ? normalizeState(JSON.parse(raw)) : emptyState();
        } catch (error) {
            return emptyState();
        }
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
        var state = readState(roleId);
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
        var state = readState(roleId);
        pairId = String(pairId || '');
        var pair = state.pairs.find(function (item) { return item.id === pairId; });
        if (!pair) return failure('NOT_FOUND', 'paired avatar set was not found');
        var next = {
            version: 2,
            activeId: state.activeId,
            items: state.items,
            pairs: state.pairs.filter(function (item) { return item.id !== pairId; })
        };
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair relationship could not be removed');
        return { ok: true, value: copyPair(pair, state), meta: { portraitsRetained: true } };
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

        var state = readState(roleId);
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
        var state = readState(roleId);
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
        var state = readState(roleId);
        avatarId = String(avatarId || '');
        if (avatarId && !state.items.some(function (item) { return item.id === avatarId; })) {
            return failure('NOT_FOUND', 'avatar does not belong to this character');
        }
        state.activeId = avatarId;
        if (!writeState(roleId, state)) return failure('STORAGE_FAILED', 'avatar selection could not be saved');
        return { ok: true, value: getActive(roleId), meta: { activeId: avatarId } };
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
            var deletedBlock = roleMutationBlock(roleId);
            if (deletedBlock) return cleanupStaleRoleAsset(media, assetId, roleId);
            // Re-read after the asynchronous media write so parallel uploads cannot overwrite
            // another portrait added to this role while putBlob was pending.
            var latest = readState(roleId);
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
                return media.removeRef(assetId, OWNER_TYPE, String(roleId)).then(function () {
                    return media.removeAsset(assetId);
                }).then(function () {
                    return failure('STORAGE_FAILED', 'avatar metadata could not be saved; original profile was not changed');
                });
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

        var previous = readState(roleId);
        var existing = previous.items.find(function (item) { return item.assetId === assetId; });
        if (existing) {
            return Promise.resolve({ ok: true, value: copyItem(existing, previous.activeId), meta: { reused: true } });
        }

        return media.getAsset(assetId).then(function (found) {
            if (!found || !found.ok || !found.value || !found.value.asset || !found.value.blob) {
                return found && found.ok === false ? found : failure('NOT_FOUND', 'source image asset is unavailable');
            }
            var afterLookupBlock = roleMutationBlock(roleId);
            if (afterLookupBlock) return cleanupStaleRoleAsset(media, assetId, roleId);
            var mime = String(found.value.asset.mimeType || found.value.blob.type || '').toLowerCase();
            if (mime.indexOf('image/') !== 0) return failure('VALIDATION_FAILED', 'source asset is not an image');

            return media.addRef(assetId, OWNER_TYPE, String(roleId)).then(function (linked) {
                if (!linked || !linked.ok) return linked || failure('STORAGE_FAILED', 'avatar asset reference could not be created');
                var afterLinkBlock = roleMutationBlock(roleId);
                if (afterLinkBlock) return cleanupStaleRoleAsset(media, assetId, roleId);
                // Another async upload/link may have committed while getAsset/addRef was pending.
                // Merge into that latest role state instead of writing the stale preflight snapshot.
                var latest = readState(roleId);
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
                    return media.removeRef(assetId, OWNER_TYPE, String(roleId)).then(function () {
                        return failure('STORAGE_FAILED', 'avatar candidate metadata could not be saved');
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
        var previous = readState(roleId);
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
            if (deletedBlock) return deletedBlock;
            // The library may have changed while IndexedDB was releasing the reference.
            // Revalidate active/pair state and merge against the latest role snapshot.
            var latest = readState(roleId);
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
        var state = readState(roleId);
        var media = mediaRepository();
        if (!media || typeof media.removeRef !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));

        var released = [];
        var metadataCleared = false;
        function restoreReferences() {
            if (typeof media.addRef !== 'function') return Promise.resolve();
            return released.reduce(function (chain, item) {
                return chain.then(function () {
                    return media.addRef(item.assetId, OWNER_TYPE, String(roleId)).catch(function () {});
                });
            }, Promise.resolve());
        }

        return state.items.reduce(function (chain, item) {
            return chain.then(function (result) {
                if (!result.ok) return result;
                return media.removeRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (removed) {
                    if (!removed || !removed.ok) return removed || failure('STORAGE_FAILED', 'avatar reference could not be released');
                    if (removed.value && removed.value.removed) released.push(item);
                    return { ok: true };
                });
            });
        }, Promise.resolve({ ok: true })).then(function (result) {
            if (!result.ok) {
                return restoreReferences().then(function () { return result; });
            }

            try {
                global.localStorage.removeItem(storageKey(roleId));
                metadataCleared = true;
            } catch (error) {
                return restoreReferences().then(function () {
                    return failure('STORAGE_FAILED', 'role avatar metadata could not be cleared');
                });
            }

            return state.items.reduce(function (chain, item) {
                return chain.then(function (meta) {
                    return media.removeAsset(item.assetId).then(function (removed) {
                        if (!removed || !removed.ok) meta.retained = meta.retained + 1;
                        return meta;
                    }).catch(function () {
                        meta.retained = meta.retained + 1;
                        return meta;
                    });
                });
            }, Promise.resolve({ retained: 0 })).then(function (meta) {
                return { ok: true, value: { removed: state.items.length, retained: meta.retained } };
            });
        }).catch(function (error) {
            if (metadataCleared) {
                return failure('STORAGE_FAILED', error && error.message ? error.message : 'role avatar asset cleanup was incomplete');
            }
            return restoreReferences().then(function () {
                return failure('STORAGE_FAILED', error && error.message ? error.message : 'role avatar library could not be removed');
            });
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
        toDataUrl: toDataUrl,
        toObjectUrl: toObjectUrl,
        remove: remove,
        removeRole: removeRole,
        _normalizeState: normalizeState,
        _storageKey: storageKey
    };
})(window);
