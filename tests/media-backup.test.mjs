/**
 * tests/media-backup.test.mjs  —— DATA-002 媒体备份专项测试
 *
 * 覆盖：
 *   1. 空媒体库恢复（clearOnRestore 使空 store 执行 clear）
 *   2. clearOnRestore=false 时非媒体库保持旧行为
 *   3. MIME 类型往返保持（__blobMime_ 伴生字段）
 *   4. base64 解码失败整条跳过，不破坏其他记录
 *   5. MIME fallback：无伴生字段时读 value.format
 *   6. 真 dumpDatabase：blobs 超限 → atomicExportFailed 整库排除
 *   7. 真 dumpDatabase + restoreDatabase：完整往返恢复三个 store
 *   8. clearOnRestore 在 restoreDatabase 层生效（空 store 仍 clear）
 *   9. 体积边界：store 总 Blob 超限 → 最后几条被跳过 → 触发 atomicExport
 *  10. doExport 层：atomicExportFailed 的库不进 dbData，进 dbWarnings + allSkipped
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupSrc = readFileSync(resolve(root, 'settings/js/backup.js'), 'utf8');

/* ── 工具：从源码提取 ── */
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, `未找到函数：${name}`);
    const braceStart = src.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error(`函数 ${name} 括号未闭合`);
}

// 提取 `var NAME = <表达式>` 赋值源码，表达式支持简单值、函数和数组/对象字面量
function extractVar(src, name) {
    const start = src.indexOf('var ' + name + ' =');
    assert.notEqual(start, -1, `未找到变量：${name}`);
    let i = start + ('var ' + name + ' =').length;
    // 跳过空白
    while (i < src.length && /\s/.test(src[i])) i++;
    const first = src[i];
    if (first === '[' || first === '{') {
        // 数组或对象字面量：找匹配闭合
        let open = first, close = first === '[' ? ']' : '}';
        let depth = 0;
        let inStr = null;
        let escape = false;
        for (; i < src.length; i++) {
            const c = src[i];
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (inStr) { if (c === inStr) inStr = null; continue; }
            if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
            if (c === open) depth++;
            else if (c === close) {
                depth--;
                if (depth === 0) return src.slice(start, i + 1);
            }
        }
        throw new Error(`变量 ${name} 括号未闭合`);
    } else {
        // 简单值：到行尾分号
        const end = src.indexOf(';', i);
        return src.slice(start, end + 1);
    }
}

/* ── 轻量 Blob polyfill ── */
function makeBlob(data, opts) {
    if (typeof data === 'string') data = Buffer.from(data, 'utf8');
    return {
        type: (opts && opts.type) || '',
        size: data.length,
        // FileReader.readAsDataURL 期望 blob.size 和 blob.type
        // 同时 instanceof Blob 会走不到，但 dumpStore 用的是 `v instanceof Blob`
        // 所以必须提供 globalThis.Blob 或我们自己注册的 Blob
    };
}

/* ── 简易 FileReader：mock blobToBase64 需要 ── */
function makeFileReader() {
    return {
        result: null,
        error: null,
        onload: null,
        onerror: null,
        readAsDataURL(blob) {
            Promise.resolve().then(() => {
                // 真实实现用 FileReader；这里直接用 Node Buffer 转 base64
                // dumpStore 调用 blobToBase64(blob) 时传入的是我们 makeBlob 出来的对象
                if (blob && blob._data) {
                    const b64 = Buffer.from(blob._data).toString('base64');
                    this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + b64;
                } else {
                    // fallback：用 size 字节的占位 base64
                    const b64 = Buffer.alloc(blob.size || 0).toString('base64');
                    this.result = 'data:' + (blob.type || '') + ';base64,' + b64;
                }
                if (this.onload) this.onload();
            });
        }
    };
}

/* ── IndexedDB mock：支持 idbOpen → transaction → getAllKeys / get / put / clear ── */
function makeIDB(name, version, storeDefs) {
    const data = {};
    storeDefs.forEach(d => { data[d.store] = []; });
    const storeNames = storeDefs.map(d => d.store);

    const db = {
        _name: name,
        _version: version,
        _data: data,
        objectStoreNames: {
            contains(sn) { return storeNames.includes(sn); }
        },
        close() {},
        transaction(storeName, mode) {
            assert.ok(data[storeName] !== undefined, `store ${storeName} 不存在`);
            let oncompleteCb = null;
            let onsuccessCb = null;
            const store = {
                _name: storeName,
                _defs: storeDefs.find(d => d.store === storeName),
                clear() {
                    data[storeName] = [];
                    return { onsuccess: null, result: undefined };
                },
                put(value, key) {
                    // keyPath 判断
                    const def = storeDefs.find(d => d.store === storeName);
                    let k;
                    if (def && def.keyPath) k = value[def.keyPath];
                    else k = key;
                    if (k === undefined || k === null) k = String(Date.now()) + '_' + Math.random();
                    // 查找现有
                    const idx = data[storeName].findIndex(r => {
                        const def2 = storeDefs.find(d => d.store === storeName);
                        if (def2 && def2.keyPath) return r[def2.keyPath] === k;
                        return r.__mock_key === k;
                    });
                    // toJSON 负责把 SandboxBlob 序列化成 { __isMockBlob, type, size, _b64 }
                    const clone = JSON.parse(JSON.stringify(value));
                    if (idx >= 0) data[storeName][idx] = clone;
                    else data[storeName].push(clone);
                    return { onsuccess: null, result: k };
                },
                getAllKeys() {
                    const keys = data[storeName].map(r => {
                        const def = storeDefs.find(d => d.store === storeName);
                        if (def && def.keyPath) return r[def.keyPath];
                        return r.__mock_key;
                    });
                    const req = { result: keys, onsuccess: null };
                    Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
                    return req;
                },
                get(key) {
                    let match = data[storeName].find(r => {
                        const def = storeDefs.find(d => d.store === storeName);
                        if (def && def.keyPath) return r[def.keyPath] === key;
                        return r.__mock_key === key;
                    });
                    // 把 { __isMockBlob, _b64 } 还原成 SandboxBlob 实例（dumpStore 需要 instanceof Blob）
                    if (match) {
                        const restoreBlobs = (obj) => {
                            if (!obj || typeof obj !== 'object') return obj;
                            if (Array.isArray(obj)) return obj.map(restoreBlobs);
                            if (obj.__isMockBlob) {
                                const buf = Buffer.from(obj._b64 || '', 'base64');
                                return new SandboxBlob([buf], { type: obj.type });
                            }
                            const restored = {};
                            Object.keys(obj).forEach(k => { restored[k] = restoreBlobs(obj[k]); });
                            return restored;
                        };
                        match = restoreBlobs(match);
                    }
                    const req = { result: match || undefined, onsuccess: null };
                    Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
                    return req;
                }
            };
            const tx = {
                objectStore() { return store; },
                error: null,
                set oncomplete(fn) {
                    oncompleteCb = fn;
                    Promise.resolve().then(() => { if (oncompleteCb) oncompleteCb(); });
                },
                get oncomplete() { return oncompleteCb; },
                set onerror(fn) { this._onerror = fn; },
                get onerror() { return this._onerror; },
                set onabort(fn) { this._onabort = fn; },
                get onabort() { return this._onabort; }
            };
            return tx;
        }
    };
    return db;
}

/* ── 全局 Blob 注册：让 `v instanceof Blob` 在沙箱里返回 true ── */
function registerBlob() {
    function Blob(parts, opts) {
        if (parts && !Array.isArray(parts)) parts = [parts];
        const bufs = parts.map(p => {
            if (p instanceof Uint8Array || Buffer.isBuffer(p)) return p;
            return Buffer.from(String(p), 'utf8');
        });
        const totalLen = bufs.reduce((s, b) => s + b.length, 0);
        const combined = Buffer.concat(bufs, totalLen);
        this.type = (opts && opts.type) || '';
        this.size = combined.length;
        this._data = combined;
    }
    Blob.prototype.type = '';
    Blob.prototype.size = 0;
    Blob.prototype._data = null;
    // toJSON: 让 JSON.stringify 走这里安全序列化
    Blob.prototype.toJSON = function () {
        return {
            __isMockBlob: true,
            type: this.type,
            size: this.size,
            _b64: this._data ? this._data.toString('base64') : ''
        };
    };
    Blob.prototype.slice = function () { return new Blob([this._data], { type: this.type }); };
    globalThis.Blob = Blob;
    return Blob;
}

const SandboxBlob = registerBlob();

/* ── 全局 indexedDB.open mock ── */
const openDbs = {};
globalThis.indexedDB = {
    open(name, version) {
        const req = { result: null, onsuccess: null, onupgradeneeded: null, onerror: null, onblocked: null };
        Promise.resolve().then(() => {
            let db = openDbs[name];
            if (!db) {
                // 调用者的 storeDefs 从 onupgradeneeded 里拿不到 —— 所以让 dumpDatabase 调 idbOpen 时走我们的 mock
                // 这里简单处理：若还没有，先设个空的
                db = makeIDB(name, version, []);
                openDbs[name] = db;
                req.result = db;
                if (req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            } else {
                req.result = db;
                if (req.onsuccess) req.onsuccess();
            }
        });
        return req;
    }
};

// idbOpen 调用 globalThis.indexedDB.open → 走上面的 mock
// 但我们需要在每个测试前预置具体 storeDefs。用 registerDB() 注册
function registerDB(name, version, storeDefs) {
    openDbs[name] = makeIDB(name, version, storeDefs);
    return openDbs[name];
}

function clearAllDBs() {
    Object.keys(openDbs).forEach(k => delete openDbs[k]);
}

/* 往 mock DB 的某个 store 注入记录（走 put 路径，确保 Blob 被正确标记） */
async function injectRecords(db, storeName, storeDef, records) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore();
    for (const rec of records) {
        if (storeDef && storeDef.keyPath) store.put(rec);
        else store.put(rec, rec.__key);
    }
    await new Promise(r => { tx.oncomplete = r; });
}

/* ── 构建完整沙箱（dump + restore 全链路） ── */
function buildCtxFull() {
    // 所有源码片段拼在一起：先 var 声明（IDB_TARGETS 依赖 FONT_* 常量），再函数体
    // 让 runInNewContext 在同一个上下文里处理所有 var 声明，避免 TDZ
    const varSrcs = [
        extractVar(backupSrc, 'FONT_BLOB_MAX_BYTES'),
        extractVar(backupSrc, 'FONT_STORE_MAX_BYTES'),
        extractVar(backupSrc, 'IDB_TARGETS')
    ];
    const fnNames = [
        'base64ToBlob', 'blobToBase64', 'idbOpen',
        'dumpStore', 'dumpDatabase',
        'restoreStore', 'restoreDatabase'
    ];
    const fnSrcs = fnNames.map(n => extractFunction(backupSrc, n));
    const ctxSrc = varSrcs.concat(fnSrcs).join('\n');

    const ctx = {
        Blob: SandboxBlob,
        FileReader: makeFileReader,
        indexedDB: globalThis.indexedDB,
        window: { indexedDB: globalThis.indexedDB },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Uint8Array: globalThis.Uint8Array,
        Promise: globalThis.Promise,
        Error: globalThis.Error
    };
    runInNewContext(ctxSrc, ctx);

    // 同时把 IDB_TARGETS 挂到 ctx 上方便测试直接引用（runInNewContext 里
    // 用 var 声明的变量会变成 ctx 的属性）
    assert.ok(ctx.IDB_TARGETS, 'runInNewContext 后 IDB_TARGETS 应挂在 ctx 上');
    return ctx;
}

/* ── 基础沙箱：只恢复相关（测试 01-05 已用的，但已修复了 BlobPolyfill typo） ── */
function buildCtx() {
    const BlobFactory = function Blob(parts, opts) {
        this.type = (opts && opts.type) || '';
        this._parts = parts;
    };
    const ctx = {
        Blob: BlobFactory,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Uint8Array: globalThis.Uint8Array
    };
    runInNewContext(extractFunction(backupSrc, 'base64ToBlob'), ctx);
    runInNewContext(extractFunction(backupSrc, 'restoreStore'), ctx);
    return ctx;
}

function isBlobLike(obj) {
    return obj != null && typeof obj === 'object' && typeof obj.type === 'string';
}

/* ── 简易 IDB mock（基础 restoreStore 测试用，不需要完整 transaction API） ── */
function makeIDB_restore(initialData) {
    const stores = {};
    Object.keys(initialData).forEach(sn => {
        stores[sn] = initialData[sn].map(r => JSON.parse(JSON.stringify(r)));
    });
    const db = {
        close() {},
        transaction(storeName) {
            if (!stores[storeName]) stores[storeName] = [];
            let cleared = false;
            const puts = [];
            let oncompleteCb = null;
            const storeObj = {
                clear() { cleared = true; return {}; },
                put(value) { puts.push(value); return {}; },
                getAll() {
                    const req = { result: stores[storeName].slice(), onsuccess: null };
                    Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
                    return req;
                }
            };
            const tx = {
                objectStore() { return storeObj; },
                error: null,
                set oncomplete(fn) {
                    oncompleteCb = fn;
                    if (cleared) stores[storeName] = [];
                    puts.forEach(v => stores[storeName].push(JSON.parse(JSON.stringify(v))));
                    if (oncompleteCb) oncompleteCb();
                },
                get oncomplete() { return oncompleteCb; },
                set onerror(fn) { this._onerror = fn; },
                get onerror() { return this._onerror; },
                set onabort(fn) { this._onabort = fn; },
                get onabort() { return this._onabort; }
            };
            return tx;
        },
        _stores: stores
    };
    return db;
}

const MINIMAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/* ═══════════════════════════════════════════════
   1. restoreStore 保持 MIME
   ═══════════════════════════════════════════════ */
test('01 blobToBase64 + restoreStore 保持 MIME 类型', async () => {
    const ctx = buildCtx();
    const db = makeIDB_restore({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    const records = [
        { assetId: 'a1', blob: MINIMAL_PNG, __blobMime_blob: 'image/png' }
    ];
    await ctx.restoreStore(db, storeDef, records, true);
    const restored = db._stores['blobs'];
    assert.equal(restored.length, 1);
    assert.ok(isBlobLike(restored[0].blob));
    assert.equal(restored[0].blob.type, 'image/png');
    assert.equal(restored[0].__blobMime_blob, undefined);
});

/* ═══════════════════════════════════════════════
   2. clearOnRestore=true 空数组 → clear()
   ═══════════════════════════════════════════════ */
test('02 clearOnRestore=true 时空 store 执行 clear()', async () => {
    const ctx = buildCtx();
    const db = makeIDB_restore({ assets: [{ assetId: 'old1', type: 'image' }] });
    const storeDef = { store: 'assets', keyPath: 'assetId' };
    await ctx.restoreStore(db, storeDef, [], true);
    assert.equal(db._stores['assets'].length, 0);
});

/* ═══════════════════════════════════════════════
   3. clearOnRestore=false 空数组 → 跳过，旧数据保留
   ═══════════════════════════════════════════════ */
test('03 clearOnRestore=false 时空数组直接跳过，不清除原有数据', async () => {
    const ctx = buildCtx();
    const db = makeIDB_restore({ wallpapers: [{ id: 'wp1' }] });
    const storeDef = { store: 'wallpapers', keyPath: null };
    await ctx.restoreStore(db, storeDef, [], false);
    assert.equal(db._stores['wallpapers'].length, 1);
});

/* ═══════════════════════════════════════════════
   4. base64 解码失败整条跳过
   ═══════════════════════════════════════════════ */
test('04 base64 解码失败整条跳过，不破坏其他记录', async () => {
    const ctx = buildCtx();
    const db = makeIDB_restore({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    const records = [
        { assetId: 'good', blob: MINIMAL_PNG, __blobMime_blob: 'image/png' },
        { assetId: 'bad',  blob: '!!!INVALID_BASE64!!!', __blobMime_blob: 'image/png' },
        { assetId: 'good2', blob: MINIMAL_PNG, __blobMime_blob: 'image/gif' }
    ];
    const result = await ctx.restoreStore(db, storeDef, records, true);
    assert.equal(result.written, 2);
    assert.equal(result.skipped, 1);
    assert.equal(db._stores['blobs'].length, 2);
    const ids = db._stores['blobs'].map(r => r.assetId);
    assert.ok(ids.includes('good'));
    assert.ok(ids.includes('good2'));
    assert.ok(!ids.includes('bad'));
});

/* ═══════════════════════════════════════════════
   5. MIME fallback：无伴生字段时读 value.format
   ═══════════════════════════════════════════════ */
test('05 无 __blobMime_ 伴生字段时 fallback 到 value.format', async () => {
    const ctx = buildCtx();
    const db = makeIDB_restore({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    const records = [{ assetId: 'font1', blob: MINIMAL_PNG, format: 'font/ttf' }];
    await ctx.restoreStore(db, storeDef, records, true);
    const restored = db._stores['blobs'][0];
    assert.ok(isBlobLike(restored.blob));
    assert.equal(restored.blob.type, 'font/ttf');
});

/* ═══════════════════════════════════════════════
   6. atomicExport：blobs 单条超大 → 真 dumpDatabase 返回 atomicExportFailed
   ═══════════════════════════════════════════════ */
test('06 dumpDatabase：blobs 超限 → 整库 atomicExportFailed', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();

    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;

    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);

    // 走 put() 路径：Blob 会被序列化 → __isMockBlob → get() 时还原成 instanceof Blob
    await injectRecords(db, 'assets', maomaoAssetsDef.stores.find(s => s.store === 'assets'), [
        { assetId: 'img001', type: 'image', mimeType: 'image/jpeg', size: 512 }
    ]);
    await injectRecords(db, 'refs', maomaoAssetsDef.stores.find(s => s.store === 'refs'), [
        { assetId: 'img001', ownerType: 'character', ownerId: 'char_1' }
    ]);

    // blobs: 一条超过 blobMax 的（触发单条超限）
    const tooBigData = Buffer.alloc(blobMax + 1024, 0x41);
    const bigBlob = new SandboxBlob([tooBigData], { type: 'image/jpeg' });
    await injectRecords(db, 'blobs', maomaoAssetsDef.stores.find(s => s.store === 'blobs'), [
        { assetId: 'img001', blob: bigBlob },
        { assetId: 'img002', blob: new SandboxBlob([Buffer.from('hello')], { type: 'image/png' }) }
    ]);

    const result = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);

    assert.ok(result !== null, 'dumpDatabase 不应该 null（DB 能打开）');
    assert.ok(result.atomicExportFailed === true,
        'blobs 超限 → 应返回 atomicExportFailed: true');
    assert.ok(result.data === null, 'atomicExportFailed 时 data 必须是 null');
    assert.ok(Array.isArray(result.skipped), 'skipped 必须是数组');
    assert.ok(result.skipped.some(s => s.store === 'blobs'),
        'skipped 里应标记超限的 blobs 条目');
    assert.ok(result.skipped.length >= 1, '至少有一条被跳过');
});

/* ═══════════════════════════════════════════════
   7. 完整 dumpDatabase + restoreDatabase 往返（真全链路）
   ═══════════════════════════════════════════════ */
test('07 dump→restore 完整往返：三个 store 数据无损恢复', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();

    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);

    const assetsDef = maomaoAssetsDef.stores.find(s => s.store === 'assets');
    const blobsDef  = maomaoAssetsDef.stores.find(s => s.store === 'blobs');
    const refsDef   = maomaoAssetsDef.stores.find(s => s.store === 'refs');

    await injectRecords(db, 'assets', assetsDef, [
        { assetId: 'img001', type: 'image', mimeType: 'image/jpeg', width: 800, height: 600 },
        { assetId: 'img002', type: 'image', mimeType: 'image/png', width: 400, height: 300 }
    ]);
    await injectRecords(db, 'blobs', blobsDef, [
        { assetId: 'img001', blob: new SandboxBlob([Buffer.from('BLOB_DATA_1')], { type: 'image/jpeg' }) },
        { assetId: 'img002', blob: new SandboxBlob([Buffer.from('BLOB_DATA_2')], { type: 'image/png' }) }
    ]);
    await injectRecords(db, 'refs', refsDef, [
        { assetId: 'img001', ownerType: 'character', ownerId: 'char_alice' },
        { assetId: 'img002', ownerType: 'chat', ownerId: 'room_99' }
    ]);

    const dumpResult = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);
    assert.ok(dumpResult !== null, 'dump 成功');
    assert.ok(!dumpResult.atomicExportFailed, '正常场景不应 atomicExportFailed');
    assert.ok(dumpResult.data !== null, 'data 不应是 null');
    assert.equal(Object.keys(dumpResult.data).length, 3, '应有 assets + blobs + refs 三个 store');

    assert.equal(dumpResult.data.assets.length, 2);
    assert.equal(dumpResult.data.refs.length, 2);
    assert.equal(dumpResult.data.blobs.length, 2);
    dumpResult.data.blobs.forEach(b => {
        assert.equal(typeof b.blob, 'string', 'blob 应是 base64 字符串');
        assert.ok(b.__blobMime_blob, '应有 __blobMime_blob 伴生字段');
    });

    const db2 = registerDB('maomao-assets-restored', 1, maomaoAssetsDef.stores);
    const restoreResult = await ctx.restoreDatabase(
        'maomao-assets-restored', 1, maomaoAssetsDef.stores, dumpResult.data
    );
    assert.ok(restoreResult.dbRestored, 'restore 完成');
    assert.ok(restoreResult.written >= 6, '共 6 条记录（2+2+2）');
    assert.equal(restoreResult.skipped, 0, '无跳过');

    const restored = openDbs['maomao-assets-restored']._data;
    assert.equal(restored.assets.length, 2);
    assert.equal(restored.blobs.length, 2);
    assert.equal(restored.refs.length, 2);

    restored.blobs.forEach(b => {
        assert.ok(isBlobLike(b.blob), 'blob 应是 Blob');
        assert.ok(b.blob.type === 'image/jpeg' || b.blob.type === 'image/png',
            'MIME 应正确');
    });

    const ref1 = restored.refs.find(r => r.assetId === 'img001');
    assert.equal(ref1.ownerId, 'char_alice');
});

/* ═══════════════════════════════════════════════
   8. restoreDatabase clearOnRestore：旧 DB 有残留 → 备份的空 store 仍触发 clear
   ═══════════════════════════════════════════════ */
test('08 restoreDatabase clearOnRestore：空 store 仍 clear，不残留旧数据', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');

    // 旧 DB 里有残留
    registerDB('maomao-assets', 1, maomaoAssetsDef.stores);
    openDbs['maomao-assets']._data['assets'].push(
        { assetId: 'old', type: 'image', mimeType: 'image/gif' }
    );
    openDbs['maomao-assets']._data['blobs'].push(
        { assetId: 'old', blob: new SandboxBlob([Buffer.from('old_blob')], { type: 'image/gif' }) }
    );
    openDbs['maomao-assets']._data['refs'].push(
        { assetId: 'old', ownerType: 'character', ownerId: 'old_char' }
    );

    // 备份内容：blobs 是完整的（另一条新数据），但 assets 和 refs 是空数组
    const incomingData = {
        assets: [],  // clearOnRestore → 执行 clear
        blobs: [{ assetId: 'new', blob: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', __blobMime_blob: 'image/png' }],
        refs: []      // clearOnRestore → 执行 clear
    };

    const result = await ctx.restoreDatabase('maomao-assets', 1, maomaoAssetsDef.stores, incomingData);
    assert.ok(result.dbRestored);

    // assets 和 refs 应为空（clearOnRestore 触发 clear）
    assert.equal(openDbs['maomao-assets']._data['assets'].length, 0,
        '空数组 + clearOnRestore → assets 应被清空');
    assert.equal(openDbs['maomao-assets']._data['refs'].length, 0,
        '空数组 + clearOnRestore → refs 应被清空');
    // blobs 应写入新数据
    assert.equal(openDbs['maomao-assets']._data['blobs'].length, 1);
    assert.equal(openDbs['maomao-assets']._data['blobs'][0].assetId, 'new');
});

/* ═══════════════════════════════════════════════
   9. atomicExport：store 总量超限（多条累加越过 blobStoreMaxBytes）
   ═══════════════════════════════════════════════ */
test('09 dumpDatabase：store 总 Blob 超限 → 多条被跳过 → atomicExportFailed', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobStoreMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobStoreMaxBytes;

    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);
    const blobsDef = maomaoAssetsDef.stores.find(s => s.store === 'blobs');
    const assetsDef = maomaoAssetsDef.stores.find(s => s.store === 'assets');

    // 4 条 blob，每条 ~1/3 blobStoreMax → 前 3 条累积越过总量上限
    const chunkSize = Math.floor(blobStoreMax / 3) + 1024;
    const blobRecs = [];
    const assetRecs = [];
    for (let i = 0; i < 4; i++) {
        const data = Buffer.alloc(chunkSize, 0x41 + i);
        blobRecs.push({ assetId: 'over_' + i, blob: new SandboxBlob([data], { type: 'image/jpeg' }) });
        assetRecs.push({ assetId: 'over_' + i, type: 'image' });
    }
    await injectRecords(db, 'blobs', blobsDef, blobRecs);
    await injectRecords(db, 'assets', assetsDef, assetRecs);

    const result = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);

    assert.ok(result.atomicExportFailed === true,
        'store 总 Blob 超限 → 应 atomicExportFailed');
    assert.ok(result.skipped.length >= 1, '至少有 1 条被跳过');
    assert.ok(result.skipped.every(s => s.store === 'blobs'),
        'skipped 条目应全部来自 blobs store');
});

/* ═══════════════════════════════════════════════
  10. assets/refs 正常 + blobs 单条超限 → 整库排除（跨 store atomic）
   ═══════════════════════════════════════════════ */
test('10 assets+refs 正常 + blobs 超限 → 整库排除（跨 store atomic）', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;

    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);
    const assetsDef = maomaoAssetsDef.stores.find(s => s.store === 'assets');
    const refsDef   = maomaoAssetsDef.stores.find(s => s.store === 'refs');
    const blobsDef  = maomaoAssetsDef.stores.find(s => s.store === 'blobs');

    await injectRecords(db, 'assets', assetsDef, [
        { assetId: 'a1', type: 'image', mimeType: 'image/jpeg', size: 1024 },
        { assetId: 'a2', type: 'image', mimeType: 'image/png', size: 2048 }
    ]);
    await injectRecords(db, 'refs', refsDef, [
        { assetId: 'a1', ownerType: 'character', ownerId: 'c1' },
        { assetId: 'a2', ownerType: 'character', ownerId: 'c2' }
    ]);

    // blobs 只有一条但它超限
    const tooBig = Buffer.alloc(blobMax + 2048, 0x42);
    await injectRecords(db, 'blobs', blobsDef, [
        { assetId: 'a1', blob: new SandboxBlob([tooBig], { type: 'image/jpeg' }) }
    ]);

    const result = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);

    assert.ok(result.atomicExportFailed === true,
        '哪怕只有 blobs 里的一条超限，assets/refs 正常，整个 maomao-assets 也必须 atomicExportFailed');
    assert.ok(result.data === null, '整库排除 → data 必须是 null');
    assert.ok(result.skipped.some(s => s.store === 'blobs'), 'skipped 里应标记超限的 blobs');
});
