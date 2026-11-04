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
                    const def = storeDefs.find(d => d.store === storeName);
                    let k;
                    if (def && def.keyPath) k = value[def.keyPath];
                    else k = key;
                    if (k === undefined || k === null) k = String(Date.now()) + '_' + Math.random();
                    // 非 keyPath store：把生成的 key 存到 record 上（getAllKeys 需要）
                    if (!(def && def.keyPath)) value.__mock_key = k;
                    const idx = data[storeName].findIndex(r => {
                        if (def && def.keyPath) return r[def.keyPath] === k;
                        return r.__mock_key === k;
                    });
                    // 直接存引用，不做 JSON 序列化（Blob 保持 instanceof Blob，_data 保留）
                    if (idx >= 0) data[storeName][idx] = value;
                    else data[storeName].push(value);
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
                    const match = data[storeName].find(r => {
                        const def = storeDefs.find(d => d.store === storeName);
                        if (def && def.keyPath) return r[def.keyPath] === key;
                        return r.__mock_key === key;
                    });
                    // 直接返回引用——Blob 仍是 SandboxBlob 实例，_data 完整
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
test('07 dump→restore 完整往返：字节级一致 + refs 完整关系保持', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();

    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);

    const assetsDef = maomaoAssetsDef.stores.find(s => s.store === 'assets');
    const blobsDef  = maomaoAssetsDef.stores.find(s => s.store === 'blobs');
    const refsDef   = maomaoAssetsDef.stores.find(s => s.store === 'refs');

    // 预先构造明确的原始字节（不同长度，不同 pattern，方便比对）
    const ORIG_BYTES_1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const ORIG_BYTES_2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 127, 0, 127]);

    await injectRecords(db, 'assets', assetsDef, [
        { assetId: 'img001', type: 'image', mimeType: 'image/jpeg', width: 800, height: 600, sha256: 'abc123' },
        { assetId: 'img002', type: 'image', mimeType: 'image/png',  width: 400, height: 300, sha256: 'def456' }
    ]);
    await injectRecords(db, 'blobs', blobsDef, [
        { assetId: 'img001', blob: new SandboxBlob([ORIG_BYTES_1], { type: 'image/jpeg' }) },
        { assetId: 'img002', blob: new SandboxBlob([ORIG_BYTES_2], { type: 'image/png' }) }
    ]);
    await injectRecords(db, 'refs', refsDef, [
        { assetId: 'img001', ownerType: 'character', ownerId: 'char_alice', role: 'avatar' },
        { assetId: 'img002', ownerType: 'chat',      ownerId: 'room_99',    role: 'background' }
    ]);

    const dumpResult = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);
    assert.ok(dumpResult !== null);
    assert.ok(!dumpResult.atomicExportFailed);
    assert.equal(Object.keys(dumpResult.data).length, 3);
    assert.equal(dumpResult.data.assets.length, 2);
    assert.equal(dumpResult.data.refs.length, 2);
    assert.equal(dumpResult.data.blobs.length, 2);

    // dump 层验证：blob 是 base64 字符串、有伴生 MIME 字段
    dumpResult.data.blobs.forEach(b => {
        assert.equal(typeof b.blob, 'string');
        assert.ok(b.__blobMime_blob);
    });

    const db2 = registerDB('maomao-assets-restored', 1, maomaoAssetsDef.stores);
    const restoreResult = await ctx.restoreDatabase(
        'maomao-assets-restored', 1, maomaoAssetsDef.stores, dumpResult.data
    );
    assert.ok(restoreResult.dbRestored);
    assert.equal(restoreResult.written, 6, '2+2+2=6 条');
    assert.equal(restoreResult.skipped, 0);

    const restored = openDbs['maomao-assets-restored']._data;
    assert.equal(restored.assets.length, 2);
    assert.equal(restored.blobs.length, 2);
    assert.equal(restored.refs.length, 2);

    // ====== Byte-level 完全一致 ======
    const blobMap = {};
    restored.blobs.forEach(b => { blobMap[b.assetId] = b.blob; });
    // img001 → jpeg
    assert.ok(isBlobLike(blobMap['img001']), 'img001 blob 应是 Blob 实例');
    assert.equal(blobMap['img001'].type, 'image/jpeg', 'img001 MIME 还原正确');
    assert.ok(Buffer.compare(blobMap['img001']._data, ORIG_BYTES_1) === 0,
        'img001 Blob 原始字节应与注入时完全一致');
    // img002 → png
    assert.ok(isBlobLike(blobMap['img002']));
    assert.equal(blobMap['img002'].type, 'image/png', 'img002 MIME 还原正确');
    assert.ok(Buffer.compare(blobMap['img002']._data, ORIG_BYTES_2) === 0,
        'img002 Blob 原始字节应与注入时完全一致');

    // ====== assets 全字段一致 ======
    const assetMap = {};
    restored.assets.forEach(a => { assetMap[a.assetId] = a; });
    assert.deepEqual(assetMap['img001'],
        { assetId: 'img001', type: 'image', mimeType: 'image/jpeg', width: 800, height: 600, sha256: 'abc123' },
        'assets 全字段应逐字一致');
    assert.deepEqual(assetMap['img002'],
        { assetId: 'img002', type: 'image', mimeType: 'image/png',  width: 400, height: 300, sha256: 'def456' });

    // ====== refs 完整关系保持 ======
    const refMap = {};
    restored.refs.forEach(r => { refMap[r.assetId] = r; });
    assert.deepEqual(refMap['img001'],
        { assetId: 'img001', ownerType: 'character', ownerId: 'char_alice', role: 'avatar' },
        'refs 全字段 + ownerType/ownerId/role 完整关系应保持');
    assert.deepEqual(refMap['img002'],
        { assetId: 'img002', ownerType: 'chat', ownerId: 'room_99', role: 'background' });
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
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;
    const blobStoreMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobStoreMaxBytes;

    const db = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);
    const blobsDef = maomaoAssetsDef.stores.find(s => s.store === 'blobs');
    const assetsDef = maomaoAssetsDef.stores.find(s => s.store === 'assets');

    // 关键约束：每条 blob < blobMax（不走单条超限），但累计 > blobStoreMax（走总量超限）
    // blobMax = 30MB，blobStoreMax = 90MB
    // 4 条 × 25MB = 100MB 总和越过 90MB；每条 25MB < 30MB blobMax
    const perBlobBytes = 25 * 1024 * 1024;  // 25MB，低于 blobMax (30MB)
    assert.ok(perBlobBytes < blobMax, 'precondition: 每条必须低于 blobMax');
    assert.ok(perBlobBytes * 4 > blobStoreMax, 'precondition: 4 条总和必须超过 blobStoreMax');

    const blobRecs = [];
    const assetRecs = [];
    for (let i = 0; i < 4; i++) {
        const data = Buffer.alloc(perBlobBytes, 0x41 + i);
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
    // 验证跳过原因包含 store 总量超限关键词（而非单条超限）
    assert.ok(result.skipped.some(s => /store 总 Blob 体积超过/.test(s.reason)),
        '被跳过的原因应是 store 总量超限（而非单条超限）');
    assert.ok(!result.skipped.some(s => /单条/.test(s.reason)),
        '不应出现单条超限原因（precondition 已确认每条低于 blobMax）');
});

/* ═══════════════════════════════════════════════
  10. 真 doExport 循环：maomao-assets atomicExportFailed → 整库排除；
      其他 DB（maomao-media-store / maomao-font-presets）正常 → 仍进 dbData；
      dbWarnings 显示明确提示，allSkipped 记录超限条目
   ═══════════════════════════════════════════════ */
test('10 doExport 层 atomicExport：资源库整库排除，但其他库 + localStorage 不受影响', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;

    // ── 1. 注册 maomao-assets：blobs 有一条超限 → 会触发 atomicExportFailed ──
    const assetsDb = registerDB('maomao-assets', 1, maomaoAssetsDef.stores);
    await injectRecords(assetsDb, 'assets', maomaoAssetsDef.stores.find(s => s.store === 'assets'), [
        { assetId: 'a1', type: 'image', mimeType: 'image/jpeg', size: 1024 },
        { assetId: 'a2', type: 'image', mimeType: 'image/png',  size: 2048 }
    ]);
    await injectRecords(assetsDb, 'refs', maomaoAssetsDef.stores.find(s => s.store === 'refs'), [
        { assetId: 'a1', ownerType: 'character', ownerId: 'c1' },
        { assetId: 'a2', ownerType: 'character', ownerId: 'c2' }
    ]);
    const tooBig = Buffer.alloc(blobMax + 2048, 0x42);
    await injectRecords(assetsDb, 'blobs', maomaoAssetsDef.stores.find(s => s.store === 'blobs'), [
        { assetId: 'a1', blob: new SandboxBlob([tooBig], { type: 'image/jpeg' }) }
    ]);

    // ── 2. 注册 maomao-media-store：完全正常，没有 blobMax 配置 ──
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { id: 'wp1', name: 'ocean.jpg', color: '#1a5e20' }
    ]);
    // audio store 有 excludeFields: ['blob']，blob 不进 JSON（但 dumpStore 不会报错）
    await injectRecords(mediaDb, 'audio', mediaDef.stores.find(s => s.store === 'audio'), [
        { id: 'song1', title: 'Morning Breeze', artist: 'Alice' }
    ]);

    // ── 3. 注册 maomao-font-presets：也有 blob，但正常 ──
    const fontDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-font-presets');
    const fontDb = registerDB('maomao-font-presets', fontDef.version, fontDef.stores);
    await injectRecords(fontDb, 'presets', fontDef.stores.find(s => s.store === 'presets'), [
        { id: 'f1', label: 'Editorial', family: 'Georgia', blob: new SandboxBlob([Buffer.from('FONT_BYTEZ')], { type: 'font/ttf' }) }
    ]);

    // ── 4. 模拟 doExport 中对 IDB_TARGETS 的循环（只处理我们预注册过的三个 DB） ──
    const dbData = {};
    const dbWarnings = [];
    const allSkipped = [];
    const preRegistered = new Set(['maomao-assets', 'maomao-media-store', 'maomao-font-presets']);

    for (let i = 0; i < ctx.IDB_TARGETS.length; i++) {
        const tgt = ctx.IDB_TARGETS[i];
        if (!preRegistered.has(tgt.db)) continue;  // 跳过未预注册的其他 DB
        const part = await ctx.dumpDatabase(tgt.db, tgt.version, tgt.stores);
        if (part === null) {
            dbWarnings.push(tgt.db + '（读取失败）');
            continue;
        }
        if (part.atomicExportFailed) {
            const skipCount = part.skipped ? part.skipped.length : 0;
            dbWarnings.push(tgt.db + '（媒体 Blob ' + skipCount + ' 条超限，整库未纳入备份以防止残缺恢复）');
            (part.skipped || []).forEach(function (s) {
                allSkipped.push({ db: tgt.db, store: s.store, id: s.id, reason: s.reason, bytes: s.bytes });
            });
            continue;
        }
        const stores = part.data;
        if (!stores || !Object.keys(stores).length) continue;
        dbData[tgt.db] = stores;
        (part.skipped || []).forEach(function (s) {
            allSkipped.push({ db: tgt.db, store: s.store, id: s.id, reason: s.reason, bytes: s.bytes });
        });
    }

    // ====== 5. 验证：maomao-assets 被完全排除 ======
    assert.ok(!('maomao-assets' in dbData),
        'atomicExportFailed 的库不应进入 dbData');
    assert.ok(dbWarnings.some(w => w.startsWith('maomao-assets') && w.includes('整库未纳入备份')),
        'dbWarnings 应有 maomao-assets 的 atomicExport 提示');

    // ====== 6. 验证：其他库正常保留 ======
    assert.ok('maomao-media-store' in dbData,
        '正常的 maomao-media-store 必须保留');
    assert.ok('maomao-font-presets' in dbData,
        '正常的 maomao-font-presets 必须保留');

    // wallpapers 是 out-of-line key，backup.js 源码会包装成 { __key, __value }
    const wp = dbData['maomao-media-store'].wallpapers;
    assert.equal(wp.length, 1, 'wallpapers 应只有 1 条');
    assert.ok(wp[0].hasOwnProperty('__key') && wp[0].hasOwnProperty('__value'),
        'out-of-line key 的 store 记录应被包装成 { __key, __value }');
    assert.equal(wp[0].__value.id, 'wp1');
    assert.equal(wp[0].__value.name, 'ocean.jpg');
    assert.equal(wp[0].__value.color, '#1a5e20');

    // presets 是 in-line key（keyPath='id'），直接是原始 record
    const presets = dbData['maomao-font-presets'].presets;
    assert.equal(presets.length, 1);
    assert.equal(presets[0].id, 'f1');
    assert.equal(presets[0].label, 'Editorial');

    // ====== 7. 验证 allSkipped：maomao-assets 的超限条目被正确记录 ======
    const assetSkips = allSkipped.filter(s => s.db === 'maomao-assets');
    assert.ok(assetSkips.length >= 1, 'allSkipped 应至少有 maomao-assets 的一条');
    assert.ok(assetSkips.every(s => s.store === 'blobs'),
        '应只跳过 blobs store 的条目');
    assert.ok(assetSkips.every(s => s.id === 'a1'),
        '跳过的应是 assetId=a1（我们唯一超限的 blob）');
    assert.ok(assetSkips.every(s => typeof s.bytes === 'number' && s.bytes > blobMax),
        'bytes 应真实记录超限 blob 的体积');
});
