/* ============================================================
 * media-repository.js  —— 媒体资源仓储（IndexedDB）
 *
 * 底层：独立数据库 maomao-assets (version 2)
 *   stores:
 *     assets / blobs / refs → Blob 资源及引用关系
 *     image_records → 按角色索引的生图记录（只存 assetId，不存图片二进制）
 *
 *   与 maomao-media-store / diary 等库完全独立，谁也不依赖谁。
 *   整库由 settings/js/backup.js 备份，Blob 超限时按 atomicExport 规则整体跳过并报告。
 *
 * 契约：
 *   - 业务方只保存 assetId，不保存 DataURL / objectURL / Blob 引用
 *   - 同 hash 重复 putBlob 时复用已有 assetId（不复制、不重复占空间）
 *   - removeAsset 前必须先清理 refs；有遗留引用时返回 VALIDATION_FAILED
 *
 * 加载顺序：
 *   phone_storage.js → storage/repository.js → storage/media-repository.js
 *   （不依赖领域 Repository 子类，但共用 PhoneStorage.result 的错误码）
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _ERR = (_PS.result && _PS.result.ERR) || {
        DB_UNAVAILABLE: 'DB_UNAVAILABLE', DB_BLOCKED: 'DB_BLOCKED',
        QUOTA_EXCEEDED: 'QUOTA_EXCEEDED', VALIDATION_FAILED: 'VALIDATION_FAILED',
        NOT_FOUND: 'NOT_FOUND', CORRUPT_DATA: 'CORRUPT_DATA'
    };

    var DB_NAME = 'maomao-assets';
    var DB_VERSION = 2;
    var STORES = {
        ASSETS: 'assets',   // keyPath: assetId, index on hash
        BLOBS:  'blobs',    // keyPath: assetId
        REFS:   'refs',     // keyPath: assetId, compound index owner
        IMAGES: 'image_records' // keyPath: id; role/time indexed metadata only
    };

    var _dbPromise = null;

    function _openDB() {
        if (_dbPromise) return _dbPromise;
        try {
            if (!('indexedDB' in global)) {
                _dbPromise = null;
                return Promise.reject(new Error('IndexedDB unavailable'));
            }
            _dbPromise = new Promise(function (resolve, reject) {
                var req;
                try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(STORES.ASSETS)) {
                        var s1 = db.createObjectStore(STORES.ASSETS, { keyPath: 'assetId' });
                        s1.createIndex('hash', 'hash', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(STORES.BLOBS)) {
                        db.createObjectStore(STORES.BLOBS, { keyPath: 'assetId' });
                    }
                    if (!db.objectStoreNames.contains(STORES.REFS)) {
                        var s3 = db.createObjectStore(STORES.REFS, { keyPath: 'assetId' });
                        s3.createIndex('owner', ['ownerType', 'ownerId'], { unique: false });
                    }
                    if (!db.objectStoreNames.contains(STORES.IMAGES)) {
                        var imageStore = db.createObjectStore(STORES.IMAGES, { keyPath: 'id' });
                        imageStore.createIndex('characterId', 'characterId', { unique: false });
                        imageStore.createIndex('characterCreatedAt', ['characterId', 'createdAt'], { unique: false });
                        imageStore.createIndex('createdAt', 'createdAt', { unique: false });
                    }
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('open failed')); };
                req.onblocked = function () { reject(new Error('db blocked')); };
            }).catch(function (error) {
                _dbPromise = null;  // 失败后置 null 以便下一次重试
                throw error;
            });
            return _dbPromise;
        } catch (e) {
            _dbPromise = null;
            return Promise.reject(e);
        }
    }

    /* ---------- 工具：hash 与 assetId ----------
     *
     * 固定使用 crypto.subtle.digest('SHA-256', ...)，截取前 20 字节
     * (160-bit) 做 base32-url 编码 → 32 字符。
     * 160-bit 碰撞概率：按 Birthday Paradox，需要约 2^80 个不同 Blob
     * 才有 50% 碰撞概率，对单用户本地媒体库完全足够。
     *
     * 为什么截 20 字节而不是全 32 字节：
     *   - base32 每 5 bit 一个字符，20×8=160 bit → 32 字符
     *   - 全 32 字节 → 52 字符，assetId 过长影响存储键可读性 / URL 长度
     *   - 128-bit (16 字节) → 26 字符，也够，但 160-bit 多留 4 字节冗余
     *     对极端场景（用户上万张图）更稳妥，开销仅 6 字符
     *
     * 为什么 base32 而不是 hex：
     *   - hex 每字节 2 字符，20 字节 → 40 字符
     *   - base32 每 5 bit 1 字符 → 32 字符，短 20%
     *   - 全大写、无特殊字符，做 localStorage 键 / IDB key / URL fragment 都安全
     *
     * crypto.subtle 不可用时（http 非安全上下文、老浏览器、被禁用）：
     *   必须明确报错，不静默降级。降级会导致同一张图在不同环境
     *   下生成不同 assetId，引用对不上、去重失效。
     */

    var HASH_BYTES = 20;
    var ASSET_ID_PREFIX = 'as_';
    // 32 字符 base32-url，大写字母 A-Z + 数字 2-7
    var ASSET_ID_REGEX = /^as_[A-Z2-7]{32}$/;

    /** 校验 assetId 格式（不校验它是否存在） */
    function _isValidAssetId(id) {
        return typeof id === 'string' && ASSET_ID_REGEX.test(id);
    }

    /**
     * 对 Blob 内容做 SHA-256，截 HASH_BYTES 字节 → base32 → 固定 32 字符 hash。
     * 不支持 crypto.subtle 时 reject（明确错误，不降级）。
     */
    function _hashBlob(blob) {
        return new Promise(function (resolve, reject) {
            // 预检 crypto.subtle 是否可用
            if (!global.crypto || !global.crypto.subtle || typeof global.crypto.subtle.digest !== 'function') {
                reject(new Error('[MediaRepository] crypto.subtle.digest is unavailable. ' +
                    'This requires a secure context (https:// localhost, or file://). ' +
                    'Non-secure http pages will not be able to compute asset hashes.'));
                return;
            }

            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('[MediaRepository] FileReader failed')); };
            reader.onload = function () {
                try {
                    var arr = new Uint8Array(reader.result);
                    global.crypto.subtle.digest('SHA-256', arr).then(function (buf) {
                        var full = new Uint8Array(buf);
                        var trimmed = full.slice(0, HASH_BYTES);
                        resolve(_base32(trimmed));
                    }).catch(function (e) {
                        reject(new Error('[MediaRepository] SHA-256 digest failed: ' +
                            (e && e.message ? e.message : String(e))));
                    });
                } catch (e) {
                    reject(e);
                }
            };
            try { reader.readAsArrayBuffer(blob); } catch (e) { reject(e); }
        });
    }

    function _base32(bytes) {
        var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        var out = '';
        var bits = 0, acc = 0;
        for (var i = 0; i < bytes.length; i++) {
            acc = (acc << 8) | bytes[i]; bits += 8;
            while (bits >= 5) { out += ALPHA[(acc >>> (bits - 5)) & 0x1f]; bits -= 5; }
        }
        if (bits > 0) { out += ALPHA[(acc << (5 - bits)) & 0x1f]; }
        return out;
    }

    function _assetIdFromHash(hash) { return ASSET_ID_PREFIX + hash; }

    /* ---------- Blob / DataURL 解析 ---------- */

    function _coerceToBlob(input, mimeType) {
        if (input instanceof Blob) return Promise.resolve(input);
        if (typeof input === 'string' && input.indexOf('data:') === 0) {
            // data URL → Blob
            var idx = input.indexOf(',');
            var meta = input.slice(0, idx);
            var data = input.slice(idx + 1);
            var mimeMatch = meta.match(/data:([^;]+)/);
            var mime = (mimeMatch && mimeMatch[1]) || mimeType || 'application/octet-stream';
            var isBase64 = meta.indexOf(';base64') !== -1;
            return new Promise(function (resolve, reject) {
                try {
                    var bin = isBase64
                        ? atob(data)
                        : decodeURIComponent(data);
                    var arr = new Uint8Array(bin.length);
                    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    resolve(new Blob([arr], { type: mime }));
                } catch (e) { reject(e); }
            });
        }
        if (input instanceof ArrayBuffer) return Promise.resolve(new Blob([input], { type: mimeType || 'application/octet-stream' }));
        return Promise.reject(new Error('unsupported input type'));
    }

    /* ---------- Promise 包装的 tx 操作 ---------- */

    function _txRun(tx, operationFn) {
        return new Promise(function (resolve, reject) {
            var req = operationFn(tx);
            if (!req) { resolve(undefined); return; }
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('tx op failed')); };
        });
    }

    /* ---------- 错误映射 ---------- */

    function _mapError(err) {
        var msg = err && err.message ? err.message : String(err);
        var name = err && err.name ? err.name : '';
        if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
            return { code: _ERR.QUOTA_EXCEEDED, message: msg, retryable: false };
        }
        if (/blocked/i.test(msg)) {
            return { code: _ERR.DB_BLOCKED, message: msg, retryable: true };
        }
        if (name === 'DataError' || /corrupt|invalid/i.test(msg)) {
            return { code: _ERR.CORRUPT_DATA, message: msg, retryable: false };
        }
        if (/unavailable/i.test(msg)) {
            return { code: _ERR.DB_UNAVAILABLE, message: msg, retryable: true };
        }
        return { code: _ERR.DB_UNAVAILABLE, message: msg, retryable: true };
    }

    /* ============================================================
     * MediaRepository
     *
     * 所有公开方法返回 Promise<{ ok, value?, error?, meta? }>。
     * async/await 会在 IE 11 等环境报错——本库只用 Promise + IIFE + var。
     * ============================================================ */

    function MediaRepository(storage) {
        // storage 参数保留以兼容 Repository 基类签名，但我们自己用 IndexedDB
        this._storage = storage || (_PS.result || null);
    }

    /**
     * putBlob(blobOrDataUrl, {type, mimeType, ownerType, ownerId})
     * → Promise<{ ok:true, value:{ assetId, size, hash, reused } } | { ok:false, error:{code, message, retryable} }>
     * 同 hash 已存在时复用已有 assetId（reused=true），不复制 Blob。
     */
    MediaRepository.prototype.putBlob = function (input, opts) {
        var self = this;
        opts = opts || {};
        if (!input) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED, message: 'input is required', retryable: false } });
        }
        if (!opts.ownerType || !opts.ownerId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'ownerType and ownerId are required', retryable: false } });
        }

        return _coerceToBlob(input, opts.mimeType).then(function (blob) {
            return _hashBlob(blob).then(function (hash) {
                var assetId = _assetIdFromHash(hash);
                var size = blob.size;
                var mimeType = opts.mimeType || blob.type || 'application/octet-stream';
                var type = opts.type || _inferType(mimeType);

                return _openDB().then(function (db) {
                    return new Promise(function (resolve) {
                        var tx = db.transaction([STORES.ASSETS, STORES.BLOBS, STORES.REFS], 'readwrite');
                        var assets = tx.objectStore(STORES.ASSETS);
                        var blobs  = tx.objectStore(STORES.BLOBS);
                        var refs   = tx.objectStore(STORES.REFS);

                        // 先查 hash 索引（assets）；同一 asset 可以被多个帖子/评论引用。
                        var hashIdx = assets.index('hash');
                        var checkReq = hashIdx.get(hash);
                        var settled = false;
                        function finishError(error) {
                            if (settled) return;
                            settled = true;
                            resolve({ ok: false, error: _mapError(error || new Error('media transaction failed')) });
                        }
                        tx.oncomplete = function () {
                            if (settled) return;
                            settled = true;
                            var existing = checkReq.result;
                            resolve({ ok: true,
                                value: { assetId: finalAssetId, size: size, hash: hash, reused: reused, type: type },
                                meta: { reused: reused } });
                        };
                        tx.onerror = function () { finishError(tx.error); };
                        tx.onabort = function () { finishError(tx.error); };
                        var finalAssetId = assetId;
                        var reused = false;
                        checkReq.onsuccess = function () {
                            var existing = checkReq.result;
                            finalAssetId = existing ? existing.assetId : assetId;
                            reused = !!existing;
                            if (!existing) {
                                assets.put({
                                    assetId: assetId, type: type, mimeType: mimeType,
                                    size: size, ownerType: opts.ownerType, ownerId: opts.ownerId,
                                    createdAt: Date.now(), hash: hash
                                });
                                blobs.put({ assetId: assetId, blob: blob });
                            }
                            var refReq = refs.get(finalAssetId);
                            refReq.onsuccess = function () {
                                var record = refReq.result || null;
                                var refList = record && Array.isArray(record.refs) ? record.refs.slice() : [];
                                // 兼容早期 v1 写入的扁平 { ownerType, ownerId } 记录。
                                if (record && !Array.isArray(record.refs) && record.ownerType && record.ownerId) {
                                    refList.push({ ownerType: record.ownerType, ownerId: record.ownerId });
                                }
                                var exists = refList.some(function (item) {
                                    return item && item.ownerType === opts.ownerType && item.ownerId === opts.ownerId;
                                });
                                if (!exists) refList.push({ ownerType: opts.ownerType, ownerId: opts.ownerId });
                                var primary = refList[0] || { ownerType: opts.ownerType, ownerId: opts.ownerId };
                                refs.put({
                                    assetId: finalAssetId,
                                    refs: refList,
                                    ownerType: primary.ownerType,
                                    ownerId: primary.ownerId
                                });
                            };
                            refReq.onerror = function () { finishError(refReq.error); };
                        };
                        checkReq.onerror = function () { finishError(checkReq.error); };
                    });
                });
            });
        }).catch(function (err) {
            // hashBlob 失败时会带明确前缀：[MediaRepository] crypto.subtle.digest...
            // 这不是 DB 不可用，是环境不支持 hash 算法，应该映射为 VALIDATION_FAILED
            var msg = err && err.message ? err.message : String(err);
            if (msg.indexOf('[MediaRepository] crypto.subtle') === 0) {
                return { ok: false, error: {
                    code: _ERR.VALIDATION_FAILED,
                    message: msg,
                    retryable: false,
                    hint: '需要安全上下文 (https / localhost / file://) 才能计算 hash'
                } };
            }
            return { ok: false, error: _mapError(err) };
        });
    };

    function _inferType(mime) {
        if (!mime) return 'file';
        if (mime.indexOf('image/') === 0) return 'image';
        if (mime.indexOf('audio/') === 0) return 'audio';
        if (mime.indexOf('video/') === 0) return 'video';
        return 'file';
    }

    /**
     * getAsset(assetId) → Promise<{ ok, value:{ asset, blob } } | NOT_FOUND | CORRUPT_DATA>
     * 找不到返回 NOT_FOUND；store 有 asset 但 blob 丢失返回 CORRUPT_DATA。
     */
    MediaRepository.prototype.getAsset = function (assetId) {
        if (!assetId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED, message: 'assetId is required', retryable: false } });
        }
        if (!_isValidAssetId(assetId)) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId format invalid: expected "as_" + 32 uppercase base32 chars, got "' +
                             assetId + '"', retryable: false } });
        }
        var self = this;
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.ASSETS, STORES.BLOBS], 'readonly');
                var assets = tx.objectStore(STORES.ASSETS);
                var blobs  = tx.objectStore(STORES.BLOBS);

                var gotAsset = false, gotBlob = false;
                var assetRec = null, blobRec = null;
                var done = 0, total = 2;
                function check() {
                    done++;
                    if (done < total) return;
                    if (!assetRec) {
                        resolve({ ok: false, error: { code: _ERR.NOT_FOUND,
                            message: 'asset not found: ' + assetId, retryable: false } });
                    } else if (!blobRec || !blobRec.blob) {
                        resolve({ ok: false, error: { code: _ERR.CORRUPT_DATA,
                            message: 'asset metadata exists but blob missing: ' + assetId, retryable: false } });
                    } else {
                        resolve({ ok: true,
                            value: { asset: assetRec, blob: blobRec.blob },
                            meta: { found: true } });
                    }
                }

                var ar = assets.get(assetId);
                ar.onsuccess = function () { assetRec = ar.result; check(); };
                ar.onerror = function () { resolve({ ok: false, error: _mapError(ar.error) }); return; };

                var br = blobs.get(assetId);
                br.onsuccess = function () { blobRec = br.result; check(); };
                br.onerror = function () { resolve({ ok: false, error: _mapError(br.error) }); return; };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    MediaRepository.prototype.getBlob = function (assetId) {
        return this.getAsset(assetId).then(function (r) {
            if (!r.ok) return r;
            return { ok: true, value: r.value.blob, meta: r.meta };
        });
    };

    MediaRepository.prototype.toDataUrl = function (assetId) {
        var self = this;
        return this.getBlob(assetId).then(function (r) {
            if (!r.ok) return r;
            return new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onerror = function () {
                    resolve({ ok: false, error: _mapError(reader.error || new Error('read failed')) });
                };
                reader.onload = function () {
                    resolve({ ok: true, value: reader.result });
                };
                try { reader.readAsDataURL(r.value); } catch (e) {
                    resolve({ ok: false, error: _mapError(e) });
                }
            });
        });
    };

    /**
     * toObjectUrl(assetId) → Promise<{ ok:true, value:{ url, revoke() } }>
     * 必须显式调 revoke()，不要长期持有。
     */
    MediaRepository.prototype.toObjectUrl = function (assetId) {
        var self = this;
        return this.getBlob(assetId).then(function (r) {
            if (!r.ok) return r;
            var url = URL.createObjectURL(r.value);
            return { ok: true, value: { url: url, revoke: function () { URL.revokeObjectURL(url); } },
                meta: { assetId: assetId } };
        });
    };

    /**
     * removeAsset(assetId)
     * 有遗留引用 → VALIDATION_FAILED（含 refs 详情）；否则真删。
     */
    MediaRepository.prototype.removeAsset = function (assetId) {
        if (!assetId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED, message: 'assetId is required', retryable: false } });
        }
        if (!_isValidAssetId(assetId)) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId format invalid: expected "as_" + 32 uppercase base32 chars, got "' +
                             assetId + '"', retryable: false } });
        }
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.REFS, STORES.ASSETS, STORES.BLOBS], 'readwrite');
                var refs  = tx.objectStore(STORES.REFS);
                var assets = tx.objectStore(STORES.ASSETS);
                var blobs  = tx.objectStore(STORES.BLOBS);

                // 查 refs：本 assetId 在 refs store 里被当成 key（keyPath 是 assetId）
                var refReq = refs.get(assetId);
                refReq.onsuccess = function () {
                    var refRec = refReq.result;
                    // refs 的 keyPath 是 assetId，但一个 assetId 可以有多个引用——
                    // 所以我们 getAll，而不是 get
                    var allReq = refs.getAll();
                    allReq.onsuccess = function () {
                        var all = allReq.result || [];
                        // 过滤出属于这个 assetId 的 refs
                        // 注意 keyPath 是 assetId，所以 getAll 会返回全部 refs，需要二次过滤
                        var myRefs = [];
                        for (var i = 0; i < all.length; i++) {
                            if (all[i] && all[i].assetId === assetId) myRefs.push(all[i]);
                        }

                        if (myRefs.length > 0) {
                            resolve({ ok: false, error: {
                                code: _ERR.VALIDATION_FAILED,
                                message: 'asset ' + assetId + ' has ' + myRefs.length +
                                         ' reference(s); call removeRef first',
                                retryable: false
                            }, meta: { refCount: myRefs.length, refs: myRefs } });
                            return;
                        }

                        // 无引用，真删
                        assets.delete(assetId);
                        blobs.delete(assetId);
                        // refs 里可能残留之前的记录（key 是 assetId），也一并删
                        refs.delete(assetId);

                        tx.oncomplete = function () {
                            resolve({ ok: true, value: { removed: true, assetId: assetId } });
                        };
                        tx.onerror = function () {
                            resolve({ ok: false, error: _mapError(tx.error) });
                        };
                        tx.onabort = function () {
                            resolve({ ok: false, error: _mapError(tx.error) });
                        };
                    };
                    allReq.onerror = function () {
                        resolve({ ok: false, error: _mapError(allReq.error) });
                    };
                };
                refReq.onerror = function () {
                    resolve({ ok: false, error: _mapError(refReq.error) });
                };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    /** addRef / removeRef：维护 refs 表 */
    MediaRepository.prototype.addRef = function (assetId, ownerType, ownerId) {
        if (!assetId || !ownerType || !ownerId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId, ownerType and ownerId are all required', retryable: false } });
        }
        if (!_isValidAssetId(assetId)) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId format invalid: expected "as_" + 32 uppercase base32 chars, got "' +
                             assetId + '"', retryable: false } });
        }
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.REFS], 'readwrite');
                var refs = tx.objectStore(STORES.REFS);
                // refs 的 keyPath 是 assetId，所以一个 assetId 只能有一条记录。
                // 我们把该 assetId 的所有 refs 放进一个数组字段里。
                var getAll = refs.getAll();
                getAll.onsuccess = function () {
                    var found = null;
                    var all = getAll.result || [];
                    for (var i = 0; i < all.length; i++) {
                        if (all[i] && all[i].assetId === assetId) { found = all[i]; break; }
                    }
                    var refList = found && Array.isArray(found.refs) ? found.refs.slice() : [];
                    // 兼容 putBlob 旧版本写入的扁平引用。
                    if (found && !Array.isArray(found.refs) && found.ownerType && found.ownerId) {
                        refList.push({ ownerType: found.ownerType, ownerId: found.ownerId });
                    }
                    var exists = refList.some(function (item) {
                        return item && item.ownerType === ownerType && item.ownerId === ownerId;
                    });
                    if (!exists) refList.push({ ownerType: ownerType, ownerId: ownerId });
                    var primary = refList[0] || { ownerType: ownerType, ownerId: ownerId };
                    refs.put({ assetId: assetId, refs: refList, ownerType: primary.ownerType, ownerId: primary.ownerId });
                    tx.oncomplete = function () {
                        resolve({ ok: true,
                            value: { added: !exists, refCount: refList.length },
                            meta: { assetId: assetId } });
                    };
                    tx.onerror = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                    tx.onabort = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                };
                getAll.onerror = function () { resolve({ ok: false, error: _mapError(getAll.error) }); };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    MediaRepository.prototype.removeRef = function (assetId, ownerType, ownerId) {
        if (!assetId || !ownerType || !ownerId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId, ownerType and ownerId are all required', retryable: false } });
        }
        if (!_isValidAssetId(assetId)) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'assetId format invalid: expected "as_" + 32 uppercase base32 chars, got "' +
                             assetId + '"', retryable: false } });
        }
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.REFS], 'readwrite');
                var refs = tx.objectStore(STORES.REFS);
                var getAll = refs.getAll();
                getAll.onsuccess = function () {
                    var found = null;
                    var all = getAll.result || [];
                    for (var i = 0; i < all.length; i++) {
                        if (all[i] && all[i].assetId === assetId) { found = all[i]; break; }
                    }
                    if (!found) {
                        resolve({ ok: true, value: { removed: false, reason: 'no refs for this asset' } });
                        return;
                    }
                    var refList = Array.isArray(found.refs) ? found.refs.slice() : [];
                    // 扁平 v1 引用在第一次编辑时迁移成 refs 数组。
                    if (!Array.isArray(found.refs) && found.ownerType && found.ownerId) {
                        refList.push({ ownerType: found.ownerType, ownerId: found.ownerId });
                    }
                    var before = refList.length;
                    refList = refList.filter(function (r) {
                        return !(r && r.ownerType === ownerType && r.ownerId === ownerId);
                    });
                    var after = refList.length;

                    if (after === 0) {
                        refs.delete(assetId);
                    } else {
                        var primary = refList[0];
                        refs.put({ assetId: assetId, refs: refList, ownerType: primary.ownerType, ownerId: primary.ownerId });
                    }

                    tx.oncomplete = function () {
                        resolve({ ok: true,
                            value: { removed: after < before, refCount: after },
                            meta: { assetId: assetId } });
                    };
                    tx.onerror = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                    tx.onabort = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                };
                getAll.onerror = function () { resolve({ ok: false, error: _mapError(getAll.error) }); };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    /** listByOwner(ownerType, ownerId) → 返回该 owner 引用的全部 asset 元数据 */
    MediaRepository.prototype.listByOwner = function (ownerType, ownerId) {
        if (!ownerType || !ownerId) {
            return Promise.resolve({ ok: false,
                error: { code: _ERR.VALIDATION_FAILED,
                    message: 'ownerType and ownerId are required', retryable: false } });
        }
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.REFS, STORES.ASSETS], 'readonly');
                var refs  = tx.objectStore(STORES.REFS);
                var assets = tx.objectStore(STORES.ASSETS);
                var allReq = refs.getAll();
                allReq.onsuccess = function () {
                    var allRefs = allReq.result || [];
                    var matchedAssetIds = [];
                    for (var i = 0; i < allRefs.length; i++) {
                        var ref = allRefs[i];
                        if (!ref) continue;
                        var refList = Array.isArray(ref.refs) ? ref.refs : [];
                        if (!refList.length && ref.ownerType && ref.ownerId) {
                            refList = [{ ownerType: ref.ownerType, ownerId: ref.ownerId }];
                        }
                        for (var j = 0; j < refList.length; j++) {
                            if (refList[j].ownerType === ownerType && refList[j].ownerId === ownerId) {
                                matchedAssetIds.push(ref.assetId); break;
                            }
                        }
                    }
                    if (matchedAssetIds.length === 0) {
                        resolve({ ok: true, value: [], meta: { count: 0 } });
                        return;
                    }
                    var got = 0;
                    var results = [];
                    matchedAssetIds.forEach(function (aid) {
                        var ar = assets.get(aid);
                        ar.onsuccess = function () {
                            if (ar.result) results.push(ar.result);
                            got++;
                            if (got === matchedAssetIds.length) {
                                resolve({ ok: true, value: results,
                                    meta: { count: results.length } });
                            }
                        };
                        ar.onerror = function () {
                            got++;
                            if (got === matchedAssetIds.length) {
                                resolve({ ok: true, value: results,
                                    meta: { count: results.length, missingIds: matchedAssetIds.filter(function (x) {
                                        return !results.find(function (r) { return r.assetId === x; });
                                    }) } });
                            }
                        };
                    });
                };
                allReq.onerror = function () { resolve({ ok: false, error: _mapError(allReq.error) }); };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    /**
     * integrityCheck({ assetIds: [...] })
     * 对给定 assetId 列表逐个检查元数据 + blob 是否都能找到。
     * 返回 { missingAssets, corruptAssets, okAssets }。
     */
    MediaRepository.prototype.integrityCheck = function (opts) {
        opts = opts || {};
        var assetIds = opts.assetIds;
        if (!Array.isArray(assetIds) || assetIds.length === 0) {
            return Promise.resolve({ ok: true, value: { missingAssets: [], corruptAssets: [], okAssets: [] },
                meta: { checked: 0, note: 'no assetIds provided; provide { assetIds: [...] } to check' } });
        }
        var self = this;
        var missing = [], corrupt = [], ok = [], invalid = [];
        // 预过滤：格式无效的 assetId 直接归入 missing，不做 DB 查询
        var validIds = [];
        assetIds.forEach(function (id) {
            if (!_isValidAssetId(id)) { invalid.push(id); missing.push(id); }
            else { validIds.push(id); }
        });

        if (validIds.length === 0) {
            return Promise.resolve({ ok: true,
                value: { missingAssets: missing, corruptAssets: [], okAssets: [] },
                meta: { checked: assetIds.length, invalidAssets: invalid.length,
                    note: 'all assetIds have invalid format; expected "as_" + 32 uppercase base32 chars' } });
        }

        var chain = Promise.resolve();
        validIds.forEach(function (id) {
            chain = chain.then(function () {
                return self.getAsset(id).then(function (r) {
                    if (!r.ok) {
                        if (r.error.code === _ERR.NOT_FOUND) missing.push(id);
                        else if (r.error.code === _ERR.CORRUPT_DATA) corrupt.push(id);
                        else missing.push(id);
                    } else {
                        ok.push(id);
                    }
                });
            });
        });
        return chain.then(function () {
            return { ok: true,
                value: { missingAssets: missing, corruptAssets: corrupt, okAssets: ok },
                meta: { checked: assetIds.length, invalidAssets: invalid.length,
                    summary: 'ok:' + ok.length + ' missing:' + missing.length +
                             ' corrupt:' + corrupt.length + ' invalid:' + invalid.length } };
        });
    };

    /**
     * gc({ actuallyDelete: false })
     * 扫描全部 assets 和 refs，找出孤儿资源（无任何 ownerRef 的 asset）。
     * 默认 dry-run：只返回 { orphans: [...] } 清单。
     * actuallyDelete=true 才真删，并返回 { deleted: [...], remaining: [...] }。
     */
    MediaRepository.prototype.gc = function (opts) {
        opts = opts || {};
        var actuallyDelete = !!opts.actuallyDelete;
        var self = this;

        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.ASSETS, STORES.REFS], 'readonly');
                var assets = tx.objectStore(STORES.ASSETS);
                var refs   = tx.objectStore(STORES.REFS);

                var aReq = assets.getAll();
                var rReq = refs.getAll();
                var got = 0, assetsList = [], refsList = [];

                aReq.onsuccess = function () { assetsList = aReq.result || []; finish(); };
                aReq.onerror = function () { resolve({ ok: false, error: _mapError(aReq.error) }); };
                rReq.onsuccess = function () { refsList = rReq.result || []; finish(); };
                rReq.onerror = function () { resolve({ ok: false, error: _mapError(rReq.error) }); };

                function finish() {
                    got++;
                    if (got < 2) return;

                    // 收集所有有 refs 的 assetId
                    var referenced = {};
                    refsList.forEach(function (r) {
                        if (r && r.assetId) referenced[r.assetId] = true;
                    });
                    // 如果 refs store 没用 refs 数组（旧格式），也要兼容
                    refsList.forEach(function (r) {
                        if (r && r.ownerType && r.ownerId) referenced[r.assetId] = true;
                    });

                    var orphans = [];
                    assetsList.forEach(function (a) {
                        if (!referenced[a.assetId]) orphans.push(a.assetId);
                    });

                    if (!actuallyDelete) {
                        resolve({ ok: true,
                            value: { orphans: orphans },
                            meta: { totalAssets: assetsList.length, orphanCount: orphans.length,
                                dryRun: true, note: 'pass { actuallyDelete: true } to really delete' } });
                        return;
                    }

                    // 真删：启动新 tx
                    var tx2 = db.transaction([STORES.ASSETS, STORES.BLOBS, STORES.REFS], 'readwrite');
                    var a2 = tx2.objectStore(STORES.ASSETS);
                    var b2 = tx2.objectStore(STORES.BLOBS);
                    var r2 = tx2.objectStore(STORES.REFS);
                    orphans.forEach(function (aid) {
                        a2.delete(aid);
                        b2.delete(aid);
                        r2.delete(aid);
                    });
                    tx2.oncomplete = function () {
                        resolve({ ok: true,
                            value: { deleted: orphans },
                            meta: { deletedCount: orphans.length, totalBefore: assetsList.length,
                                actuallyDeleted: true } });
                    };
                    tx2.onerror = function () { resolve({ ok: false, error: _mapError(tx2.error) }); };
                    tx2.onabort = function () { resolve({ ok: false, error: _mapError(tx2.error) }); };
                }
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    /* ============================================================
     * ImageRepository —— 生成图片记录（同库 metadata store）
     *
     * 记录只持有 assetId；实际图片始终保存在 blobs store。
     * isPrivate 默认为 true，图库筛选只影响展示，不改变媒体引用。
     * ============================================================ */

    function ImageRepository(mediaRepository) {
        this._media = mediaRepository || new MediaRepository();
    }

    ImageRepository.prototype.save = function (record) {
        if (!record || !record.id || !record.characterId || !record.assetId) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED,
                message: 'image record requires id, characterId and assetId',
                retryable: false
            } });
        }
        if (!_isValidAssetId(record.assetId)) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED,
                message: 'image record assetId format is invalid',
                retryable: false
            } });
        }
        var value = {
            id: String(record.id),
            characterId: String(record.characterId),
            assetId: String(record.assetId),
            prompt: String(record.prompt || ''),
            sceneDescription: String(record.sceneDescription || ''),
            isPrivate: record.isPrivate !== false,
            createdAt: Number(record.createdAt) || Date.now()
        };
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx;
                try {
                    tx = db.transaction([STORES.IMAGES], 'readwrite');
                    tx.objectStore(STORES.IMAGES).put(value);
                } catch (error) {
                    resolve({ ok: false, error: _mapError(error) });
                    return;
                }
                tx.oncomplete = function () { resolve({ ok: true, value: value }); };
                tx.onerror = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                tx.onabort = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
            });
        }).catch(function (error) { return { ok: false, error: _mapError(error) }; });
    };

    ImageRepository.prototype.get = function (imageId) {
        if (!imageId) return Promise.resolve({ ok: false, error: {
            code: _ERR.VALIDATION_FAILED, message: 'image id is required', retryable: false
        } });
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.IMAGES], 'readonly');
                var req = tx.objectStore(STORES.IMAGES).get(String(imageId));
                req.onsuccess = function () {
                    if (!req.result) {
                        resolve({ ok: false, error: { code: _ERR.NOT_FOUND,
                            message: 'image record not found', retryable: false } });
                    } else resolve({ ok: true, value: req.result });
                };
                req.onerror = function () { resolve({ ok: false, error: _mapError(req.error) }); };
            });
        }).catch(function (error) { return { ok: false, error: _mapError(error) }; });
    };

    ImageRepository.prototype.listByCharacter = function (characterId, type) {
        if (!characterId) return Promise.resolve({ ok: false, error: {
            code: _ERR.VALIDATION_FAILED, message: 'characterId is required', retryable: false
        } });
        type = type === 'public' || type === 'private' ? type : 'all';
        return _openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction([STORES.IMAGES], 'readonly');
                var store = tx.objectStore(STORES.IMAGES);
                var req;
                try {
                    req = store.index('characterId').getAll(String(characterId));
                } catch (error) {
                    resolve({ ok: false, error: _mapError(error) });
                    return;
                }
                req.onsuccess = function () {
                    var list = (req.result || []).filter(function (item) {
                        if (type === 'private') return item.isPrivate !== false;
                        if (type === 'public') return item.isPrivate === false;
                        return true;
                    });
                    list.sort(function (a, b) { return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); });
                    resolve({ ok: true, value: list, meta: { count: list.length, type: type } });
                };
                req.onerror = function () { resolve({ ok: false, error: _mapError(req.error) }); };
            });
        }).catch(function (error) { return { ok: false, error: _mapError(error) }; });
    };

    ImageRepository.prototype.setPrivacy = function (imageId, isPrivate) {
        var self = this;
        return this.get(imageId).then(function (result) {
            if (!result.ok) return result;
            var record = Object.assign({}, result.value, { isPrivate: !!isPrivate });
            return self.save(record);
        });
    };

    ImageRepository.prototype.remove = function (imageId) {
        var self = this;
        return this.get(imageId).then(function (found) {
            if (!found.ok) return found;
            return _openDB().then(function (db) {
                return new Promise(function (resolve) {
                    var tx = db.transaction([STORES.IMAGES], 'readwrite');
                    tx.objectStore(STORES.IMAGES).delete(String(imageId));
                    tx.oncomplete = function () { resolve({ ok: true, value: found.value }); };
                    tx.onerror = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                    tx.onabort = function () { resolve({ ok: false, error: _mapError(tx.error) }); };
                });
            }).then(function (deleted) {
                if (!deleted.ok) return deleted;
                return self._media.removeRef(found.value.assetId, 'generated-image', String(imageId))
                    .then(function (refResult) {
                        if (!refResult.ok) return { ok: false, error: refResult.error, value: found.value };
                        return self._media.removeAsset(found.value.assetId).then(function (assetResult) {
                            // A chat message or another feature may still reference this asset.
                            // In that case removeAsset safely refuses; the gallery record is still removed.
                            if (!assetResult.ok && assetResult.error && assetResult.error.code === _ERR.VALIDATION_FAILED) {
                                return { ok: true, value: found.value, meta: { assetRetained: true } };
                            }
                            if (!assetResult.ok) return { ok: false, error: assetResult.error, value: found.value };
                            return { ok: true, value: found.value };
                        });
                    });
            });
        }).catch(function (error) { return { ok: false, error: _mapError(error) }; });
    };

    /* ---------- 手动关闭（供测试用） ---------- */

    MediaRepository._forceClose = function () {
        _dbPromise = null;
    };

    /* ---------- 导出 ---------- */

    _PS.MediaRepository = MediaRepository;
    _PS.ImageRepository = ImageRepository;
    _PS.repository = _PS.repository || {};
    _PS.repository.media = function (storage) { return new MediaRepository(storage); };
    _PS.repository.images = function (media) { return new ImageRepository(media); };

})(window);
