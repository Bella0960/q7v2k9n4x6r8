/* ============================================================
 * diary-repository.js  —— 日记仓储
 *
 * 双存储：
 *   文字条目 → localStorage 键 maomao_diary_entries_v1
 *              结构 [{ id, date, title, type, content, mood, tags, ... }]
 *              写回时会 strip 掉 photos / photo 字段（照片独立存）
 *   照片     → IndexedDB  maomao_diary_photo_store_v1 / store "photos"
 *              key 形如 "{entryId}::{index}"  (0 .. 7)
 *              每条约 { key: "...", data: "dataURL", updatedAt: timestamp }
 *              沿用 diary.html 里的 photoKey / openPhotoDB / photoDbRequest 模式
 *
 * 所有公开方法返回 Promise<{ ok, value?, error?, meta? }>
 * 错误码来自 PhoneStorage.result.ERR：
 *   NOT_FOUND / CORRUPT_DATA / QUOTA_EXCEEDED / DB_BLOCKED /
 *   DB_UNAVAILABLE / VALIDATION_FAILED
 *
 * 加载顺序：
 *   phone_storage.js → storage/repository.js → storage/diary-repository.js
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage || {};
    var _BASE = _PS.Repository;
    var _ERR = (_PS.result && _PS.result.ERR) || {
        DB_UNAVAILABLE: 'DB_UNAVAILABLE', DB_BLOCKED: 'DB_BLOCKED',
        QUOTA_EXCEEDED: 'QUOTA_EXCEEDED', VALIDATION_FAILED: 'VALIDATION_FAILED',
        NOT_FOUND: 'NOT_FOUND', CORRUPT_DATA: 'CORRUPT_DATA'
    };

    if (!_BASE) {
        console.warn('[DiaryRepository] Repository base class not loaded; ' +
                     'did you forget to load storage/repository.js first?');
        return;
    }

    /* ---------- 常量 ---------- */

    var ENTRIES_KEY = 'maomao_diary_entries_v1';
    var PHOTO_DB = 'maomao_diary_photo_store_v1';
    var PHOTO_STORE = 'photos';
    var MAX_PHOTOS_PER_ENTRY = 8;

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
        if (/unavailable|不支持|无法打开/.test(msg)) {
            return { code: _ERR.DB_UNAVAILABLE, message: msg, retryable: true };
        }
        if (/corrupt|invalid|parse/i.test(msg) || name === 'DataError') {
            return { code: _ERR.CORRUPT_DATA, message: msg, retryable: false };
        }
        return { code: _ERR.DB_UNAVAILABLE, message: msg, retryable: true };
    }

    /* ---------- localStorage 层 ---------- */

    function _readEntriesRaw() {
        var raw;
        try { raw = global.localStorage.getItem(ENTRIES_KEY); }
        catch (e) {
            return { ok: false, error: _mapError(e) };
        }
        if (raw == null) {
            return { ok: true, value: [], meta: { found: false } };
        }
        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) {
            return { ok: false, error: {
                code: _ERR.CORRUPT_DATA,
                message: 'diary entries JSON parse failed',
                retryable: false
            }, meta: { raw: raw, rawLength: raw.length } };
        }
        if (!Array.isArray(parsed)) {
            return { ok: false, error: {
                code: _ERR.CORRUPT_DATA,
                message: 'diary entries root is not an array (got ' + typeof parsed + ')',
                retryable: false
            }, meta: { raw: raw, rawLength: raw.length, parsed: String(parsed).slice(0, 200) } };
        }
        // 过滤掉缺 id 或缺 date 的坏条目，但返回 ok: true（坏条目不是库损坏，是数据质量）
        var valid = parsed.filter(function (x) { return x && x.id && x.date; });
        var skipped = parsed.length - valid.length;
        return { ok: true, value: valid,
            meta: { found: true, skippedInvalid: skipped, totalRaw: parsed.length } };
    }

    function _writeEntries(arr) {
        // 写回前 strip 掉 photos / photo 字段（照片独立存）
        var safe = arr.map(function (entry) {
            var copy = Object.assign({}, entry);
            delete copy.photos;
            delete copy.photo;
            return copy;
        });
        try {
            global.localStorage.setItem(ENTRIES_KEY, JSON.stringify(safe));
            return { ok: true, meta: { written: safe.length } };
        } catch (e) {
            return { ok: false, error: _mapError(e) };
        }
    }

    /* ---------- IndexedDB 照片层 ---------- */

    var _photoDbPromise = null;

    function _openPhotoDb() {
        if (_photoDbPromise) return _photoDbPromise;
        try {
            if (!global.indexedDB) {
                _photoDbPromise = null;
                return Promise.reject(new Error('IndexedDB unavailable'));
            }
            _photoDbPromise = new Promise(function (resolve, reject) {
                var req;
                try { req = global.indexedDB.open(PHOTO_DB, 1); } catch (e) { reject(e); return; }
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                        db.createObjectStore(PHOTO_STORE, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function () {
                    var db = req.result;
                    db.onversionchange = function () { db.close(); };
                    resolve(db);
                };
                req.onerror = function () {
                    _photoDbPromise = null;
                    reject(req.error || new Error('open failed'));
                };
                req.onblocked = function () {
                    _photoDbPromise = null;
                    reject(new Error('db blocked'));
                };
            }).catch(function (err) { _photoDbPromise = null; throw err; });
            return _photoDbPromise;
        } catch (e) {
            _photoDbPromise = null;
            return Promise.reject(e);
        }
    }

    function _photoKey(entryId, index) {
        return String(entryId) + '::' + String(index);
    }

    function _photoTx(mode, work) {
        return _openPhotoDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(PHOTO_STORE, mode);
                var store = tx.objectStore(PHOTO_STORE);
                var result;
                try { result = work(store); } catch (e) { reject(e); return; }
                tx.oncomplete = function () {
                    resolve(result && result.result !== undefined ? result.result : result);
                };
                tx.onerror = function () { reject(tx.error || new Error('tx error')); };
                tx.onabort = function () { reject(tx.error || new Error('tx aborted')); };
            });
        });
    }

    /* ============================================================
     * DiaryRepository
     * ============================================================ */

    function DiaryRepository() {}

    /* ---------- list ---------- */

    DiaryRepository.prototype.list = function () {
        var r = _readEntriesRaw();
        if (!r.ok) return Promise.resolve(r);
        // 按 date 倒序、同 date 按 id 倒序（与 diary.html 原排序一致）
        var arr = r.value.slice();
        arr.sort(function (a, b) {
            if (b.date !== a.date) return b.date < a.date ? -1 : 1;
            return (b.id || '').localeCompare(a.id || '');
        });
        return Promise.resolve({ ok: true, value: arr, meta: r.meta });
    };

    /* ---------- get ---------- */

    DiaryRepository.prototype.get = function (id) {
        if (!id) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'id is required', retryable: false } });
        }
        return this.list().then(function (r) {
            if (!r.ok) return r;
            for (var i = 0; i < r.value.length; i++) {
                if (r.value[i].id === id) {
                    return { ok: true, value: r.value[i],
                        meta: { found: true, index: i } };
                }
            }
            return { ok: false, error: {
                code: _ERR.NOT_FOUND, message: 'diary entry not found: ' + id, retryable: false } };
        });
    };

    /* ---------- save ---------- */

    DiaryRepository.prototype.save = function (entry, expectedRevision) {
        if (!entry || typeof entry !== 'object') {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'entry must be non-null object', retryable: false } });
        }
        if (!entry.id || !entry.date) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED,
                message: 'entry.id and entry.date are required', retryable: false } });
        }
        var self = this;
        return this.list().then(function (r) {
            if (!r.ok) return r;
            var arr = r.value;
            var existingIdx = -1;
            var existingRev = 0;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].id === entry.id) {
                    existingIdx = i;
                    existingRev = arr[i].revision != null ? arr[i].revision : 0;
                    break;
                }
            }

            // 乐观锁（只有 expectedRevision 传了且 existingRev 不一致时才冲突）
            if (expectedRevision != null && existingIdx >= 0 && existingRev !== expectedRevision) {
                return { ok: false, error: {
                    code: _ERR.CONFLICT,
                    message: 'revision mismatch: expected ' + expectedRevision +
                             ', actual ' + existingRev,
                    retryable: false
                }, meta: { id: entry.id, actualRevision: existingRev } };
            }

            var merged = JSON.parse(JSON.stringify(entry));
            merged.updatedAt = Date.now();
            merged.revision = (existingIdx >= 0 ? existingRev : 0) + 1;
            merged.schemaVersion = merged.schemaVersion || 1;
            merged.createdAt = existingIdx >= 0 ? (arr[existingIdx].createdAt || 0) : (merged.createdAt || Date.now());

            if (existingIdx >= 0) arr[existingIdx] = merged;
            else arr.push(merged);

            var wr = _writeEntries(arr);
            if (!wr.ok) return wr;
            return { ok: true, value: merged,
                meta: { saved: existingIdx >= 0 ? 'update' : 'create', index: arr.length - 1 } };
        });
    };

    /* ---------- update ---------- */

    DiaryRepository.prototype.update = function (id, patch, expectedRevision) {
        if (!id) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'id is required', retryable: false } });
        }
        if (!patch || typeof patch !== 'object') {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'patch must be non-null object', retryable: false } });
        }
        var self = this;
        return this.list().then(function (r) {
            if (!r.ok) return r;
            var existingIdx = -1;
            var existing = null;
            for (var i = 0; i < r.value.length; i++) {
                if (r.value[i].id === id) { existingIdx = i; existing = r.value[i]; break; }
            }
            if (existingIdx < 0) {
                return { ok: false, error: {
                    code: _ERR.NOT_FOUND, message: 'diary entry not found: ' + id, retryable: false } };
            }
            var existingRev = existing.revision != null ? existing.revision : 0;
            if (expectedRevision != null && existingRev !== expectedRevision) {
                return { ok: false, error: {
                    code: _ERR.CONFLICT,
                    message: 'revision mismatch: expected ' + expectedRevision +
                             ', actual ' + existingRev,
                    retryable: false
                }, meta: { id: id, actualRevision: existingRev } };
            }

            var merged = JSON.parse(JSON.stringify(existing));
            Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
            merged.id = id;
            merged.updatedAt = Date.now();
            merged.revision = existingRev + 1;

            r.value[existingIdx] = merged;
            var wr = _writeEntries(r.value);
            if (!wr.ok) return wr;
            return { ok: true, value: merged,
                meta: { updated: true, index: existingIdx } };
        });
    };

    /* ---------- remove ---------- */

    DiaryRepository.prototype.remove = function (id) {
        if (!id) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'id is required', retryable: false } });
        }
        var self = this;
        return this.list().then(function (r) {
            if (!r.ok) return r;
            var arr = r.value;
            var idx = -1;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].id === id) { idx = i; break; }
            }
            if (idx < 0) {
                return { ok: false, error: {
                    code: _ERR.NOT_FOUND, message: 'diary entry not found: ' + id, retryable: false } };
            }
            arr.splice(idx, 1);
            var wr = _writeEntries(arr);
            if (!wr.ok) return wr;

            // 清掉所有 8 张照片
            return _removePhotosInternal(id).then(function (pr) {
                return { ok: true,
                    value: { removed: true, id: id, photosCleared: pr.ok ? pr.value.count : 0 },
                    meta: { listIndex: idx } };
            }, function (err) {
                // 照片删不掉不阻塞正文删除（正文已删），但要告诉调用方
                return { ok: true,
                    value: { removed: true, id: id, photosCleared: 0, photoCleanupError: String(err.message || err) },
                    meta: { listIndex: idx } };
            });
        });
    };

    /* ---------- 照片层 ---------- */

    /**
     * savePhotos(entryId, photos)
     * photos 是数组（最多 MAX_PHOTOS_PER_ENTRY 个），单事务原子写：
     * 存在的 put、不存在的 delete，遍历 0..MAX_PHOTOS_PER_ENTRY-1。
     */
    DiaryRepository.prototype.savePhotos = function (entryId, photos) {
        if (!entryId) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'entryId is required', retryable: false } });
        }
        var arr = Array.isArray(photos) ? photos : [];
        if (arr.length > MAX_PHOTOS_PER_ENTRY) arr = arr.slice(0, MAX_PHOTOS_PER_ENTRY);

        return _openPhotoDb().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(PHOTO_STORE, 'readwrite');
                var store = tx.objectStore(PHOTO_STORE);
                var settled = false;
                function done(r) { if (!settled) { settled = true; resolve(r); } }
                try {
                    for (var i = 0; i < MAX_PHOTOS_PER_ENTRY; i++) {
                        var p = arr[i];
                        if (p != null && p !== '') {
                            store.put({ key: _photoKey(entryId, i), data: p, updatedAt: Date.now() });
                        } else {
                            store.delete(_photoKey(entryId, i));
                        }
                    }
                } catch (e) {
                    done({ ok: false, error: _mapError(e) });
                    return;
                }
                tx.oncomplete = function () {
                    done({ ok: true, meta: { savedCount: arr.length, entryId: entryId } });
                };
                tx.onerror = function () { done({ ok: false, error: _mapError(tx.error) }); };
                tx.onabort = function () { done({ ok: false, error: _mapError(tx.error) }); };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    };

    DiaryRepository.prototype.listPhotos = function (entryId) {
        if (!entryId) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'entryId is required', retryable: false } });
        }
        return _photoTx('readonly', function (store) { return store.getAll(); }).then(function (rows) {
            var photos = [];
            (rows || []).forEach(function (row) {
                var k = String(row.key);
                var prefix = String(entryId) + '::';
                if (k.indexOf(prefix) === 0) {
                    var idx = Number(k.slice(prefix.length));
                    if (Number.isFinite(idx) && idx >= 0 && idx < MAX_PHOTOS_PER_ENTRY && row.data) {
                        photos[idx] = row.data;
                    }
                }
            });
            photos = photos.filter(function (p) { return p != null; });
            return { ok: true, value: photos, meta: { count: photos.length, entryId: entryId } };
        }, function (err) { return { ok: false, error: _mapError(err) }; });
    };

    DiaryRepository.prototype.getPhoto = function (entryId, index) {
        if (!entryId) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'entryId is required', retryable: false } });
        }
        if (!Number.isFinite(index) || index < 0 || index >= MAX_PHOTOS_PER_ENTRY) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'index must be 0..' + (MAX_PHOTOS_PER_ENTRY - 1), retryable: false } });
        }
        return _photoTx('readonly', function (store) {
            return store.get(_photoKey(entryId, index));
        }).then(function (row) {
            if (!row || !row.data) {
                return { ok: false, error: {
                    code: _ERR.NOT_FOUND,
                    message: 'photo not found: ' + _photoKey(entryId, index), retryable: false } };
            }
            return { ok: true, value: row.data, meta: { entryId: entryId, index: index } };
        }, function (err) { return { ok: false, error: _mapError(err) }; });
    };

    DiaryRepository.prototype.removePhotos = function (entryId) {
        if (!entryId) {
            return Promise.resolve({ ok: false, error: {
                code: _ERR.VALIDATION_FAILED, message: 'entryId is required', retryable: false } });
        }
        return _removePhotosInternal(entryId);
    };

    function _removePhotosInternal(entryId) {
        return _openPhotoDb().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(PHOTO_STORE, 'readwrite');
                var store = tx.objectStore(PHOTO_STORE);
                var settled = false, count = 0;
                function done(r) { if (!settled) { settled = true; resolve(r); } }
                try {
                    for (var i = 0; i < MAX_PHOTOS_PER_ENTRY; i++) {
                        store.delete(_photoKey(entryId, i));
                    }
                } catch (e) {
                    done({ ok: false, error: _mapError(e) }); return;
                }
                tx.oncomplete = function () {
                    done({ ok: true, value: { count: MAX_PHOTOS_PER_ENTRY, entryId: entryId } });
                };
                tx.onerror = function () { done({ ok: false, error: _mapError(tx.error) }); };
                tx.onabort = function () { done({ ok: false, error: _mapError(tx.error) }); };
            });
        }).catch(function (err) { return { ok: false, error: _mapError(err) }; });
    }

    /* ---------- 导出 ---------- */

    DiaryRepository.prototype.export = function () {
        var self = this;
        return this.list().then(function (r) {
            if (!r.ok) return r;
            return _photoTx('readonly', function (store) { return store.getAll(); }).then(function (rows) {
                var photosByEntry = {};
                (rows || []).forEach(function (row) {
                    var k = String(row.key);
                    var split = k.indexOf('::');
                    if (split < 0) return;
                    var eid = k.slice(0, split);
                    if (!photosByEntry[eid]) photosByEntry[eid] = [];
                    photosByEntry[eid].push(row.data);
                });
                return { ok: true,
                    value: { entries: r.value, photosByEntry: photosByEntry },
                    meta: { entryCount: r.value.length, photoEntries: Object.keys(photosByEntry).length } };
            }, function (err) {
                // 照片库打不开也能导出文字
                return { ok: true,
                    value: { entries: r.value, photosByEntry: {} },
                    meta: { entryCount: r.value.length, photoDbUnavailable: true,
                        photoDbError: String(err.message || err) } };
            });
        });
    };

    /* ---------- 手动关闭（测试用） ---------- */

    DiaryRepository._forceClose = function () { _photoDbPromise = null; };

    /* ---------- 导出到 PhoneStorage ---------- */

    _PS.DiaryRepository = DiaryRepository;

})(window);
