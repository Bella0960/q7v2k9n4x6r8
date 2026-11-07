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
                label: String(pair.label || '配对头像').replace(/[\\u0000-\\u001F<>]/g, '').trim().slice(0, 36) || '配对头像',
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

    function linkPair(roleId, firstAvatarId, secondAvatarId, options) {
        options = options || {};
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
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
            label: String(options.label || '配对头像').replace(/[\\u0000-\\u001F<>]/g, '').trim().slice(0, 36) || '配对头像',
            source: options.source === 'chat' ? 'chat' : 'manual',
            createdAt: Number(options.createdAt) || Date.now()
        };
        var next = { version: 2, activeId: state.activeId, items: state.items, pairs: state.pairs.concat([pair]) };
        if (!writeState(roleId, next)) return failure('STORAGE_FAILED', 'pair relationship could not be saved');
        return { ok: true, value: copyPair(pair, next), meta: { reused: false } };
    }

    function unlinkPair(roleId, pairId) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
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

    function setActive(roleId, avatarId) {
        if (!validRoleId(roleId)) return failure('VALIDATION_FAILED', 'roleId is required');
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

        var previous = readState(roleId);
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
            var existing = previous.items.find(function (item) { return item.assetId === assetId; });
            if (existing) return { ok: true, value: copyItem(existing, previous.activeId), meta: { reused: true } };

            var item = {
                id: 'avatar_' + assetId.slice(3),
                assetId: assetId,
                label: String(options.label || ('头像 ' + String(previous.items.length + 1))).replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '角色头像',
                source: options.source === 'legacy' ? 'legacy' : 'upload',
                createdAt: Number(options.createdAt) || Date.now()
            };
            var next = { version: 2, activeId: previous.activeId, items: [item].concat(previous.items), pairs: previous.pairs };
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
            var mime = String(found.value.asset.mimeType || found.value.blob.type || '').toLowerCase();
            if (mime.indexOf('image/') !== 0) return failure('VALIDATION_FAILED', 'source asset is not an image');

            return media.addRef(assetId, OWNER_TYPE, String(roleId)).then(function (linked) {
                if (!linked || !linked.ok) return linked || failure('STORAGE_FAILED', 'avatar asset reference could not be created');
                var item = {
                    id: 'avatar_' + assetId.slice(3),
                    assetId: assetId,
                    label: String(options.label || '聊天候选头像').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 36) || '聊天候选头像',
                    source: options.source === 'legacy' ? 'legacy' : (options.source === 'chat' ? 'chat' : 'upload'),
                    createdAt: Number(options.createdAt) || Date.now()
                };
                var next = { version: 2, activeId: previous.activeId, items: [item].concat(previous.items), pairs: previous.pairs };
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
        var previous = readState(roleId);
        var item = previous.items.find(function (entry) { return entry.id === String(avatarId || ''); });
        if (!item) return Promise.resolve(failure('NOT_FOUND', 'avatar not found in this character library'));
        if (previous.activeId === item.id) return Promise.resolve(failure('VALIDATION_FAILED', 'select another avatar before removing the current one'));
        if (previous.pairs.some(function (pair) { return pair.avatarIds.indexOf(item.id) >= 0; })) {
            return Promise.resolve(failure('PAIR_EXISTS', 'unlink this portrait pair before removing an image'));
        }

        var media = mediaRepository();
        if (!media || typeof media.removeRef !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));
        return media.removeRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (removedRef) {
            if (!removedRef || !removedRef.ok) return removedRef || failure('STORAGE_FAILED', 'avatar reference could not be removed');
            var next = {
                version: 2,
                activeId: previous.activeId,
                items: previous.items.filter(function (entry) { return entry.id !== item.id; }),
                pairs: previous.pairs
            };
            if (!writeState(roleId, next)) {
                if (typeof media.addRef === 'function') {
                    return media.addRef(item.assetId, OWNER_TYPE, String(roleId)).then(function () {
                        return failure('STORAGE_FAILED', 'avatar library could not be updated');
                    });
                }
                return failure('STORAGE_FAILED', 'avatar library could not be updated');
            }
            return media.removeAsset(item.assetId).then(function (removedAsset) {
                var retained = !removedAsset || !removedAsset.ok;
                return {
                    ok: true,
                    value: item,
                    meta: { assetRetained: retained, reason: retained ? (removedAsset.error && removedAsset.error.code || 'referenced_elsewhere') : '' }
                };
            });
        }).catch(function (error) {
            return failure('STORAGE_FAILED', error && error.message ? error.message : 'avatar could not be removed');
        });
    }

    function removeRole(roleId) {
        if (!validRoleId(roleId)) return Promise.resolve(failure('VALIDATION_FAILED', 'roleId is required'));
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
        linkPair: linkPair,
        unlinkPair: unlinkPair,
        add: add,
        addAsset: addAsset,
        setActive: setActive,
        toDataUrl: toDataUrl,
        toObjectUrl: toObjectUrl,
        remove: remove,
        removeRole: removeRole,
        _normalizeState: normalizeState,
        _storageKey: storageKey
    };
})(window);
