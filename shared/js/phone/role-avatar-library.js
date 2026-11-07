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
        return { version: 1, activeId: '', items: [] };
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
        return { version: 1, activeId: activeId, items: items };
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
            var next = { version: 1, activeId: previous.activeId, items: [item].concat(previous.items) };
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
                var next = { version: 1, activeId: previous.activeId, items: [item].concat(previous.items) };
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

        var media = mediaRepository();
        if (!media || typeof media.removeRef !== 'function') return Promise.resolve(failure('DB_UNAVAILABLE', 'MediaRepository is unavailable'));
        return media.removeRef(item.assetId, OWNER_TYPE, String(roleId)).then(function (removedRef) {
            if (!removedRef || !removedRef.ok) return removedRef || failure('STORAGE_FAILED', 'avatar reference could not be removed');
            var next = {
                version: 1,
                activeId: previous.activeId,
                items: previous.items.filter(function (entry) { return entry.id !== item.id; })
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
