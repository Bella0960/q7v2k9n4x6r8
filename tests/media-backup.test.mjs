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
 *   7. 真 dumpDatabase + restoreDatabase：完整往返恢复四个 store（含 image_records）
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
    // 同时匹配 `function name(` 和 `async function name(`
    const re = new RegExp('(async\\s+)?function\\s+' + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*\\(');
    const m = re.exec(src);
    if (!m) throw new Error(`未找到函数：${name}`);
    const start = m.index;
    const braceStart = src.indexOf('{', start);
    let depth = 0;
    let inStr = null, escape = false;
    for (let i = braceStart; i < src.length; i++) {
        const c = src[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
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
        // idbOpen 的 onupgradeneeded 回调会调这个——未预注册的 DB 需能动态建空 store
        createObjectStore(storeName, opts) {
            if (!storeNames.includes(storeName)) {
                storeNames.push(storeName);
                data[storeName] = [];
            }
            return {
                createIndex() {}, deleteIndex() {}, index() {},
                put() {}, add() {}, get() {}, getAll() {}, getAllKeys() {},
                clear() {}, openCursor() {}, count() {}, delete() {}
            };
        },
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

/* ── 构建完整沙箱（dump + restore + doExport 全链路） ── */
function buildCtxFull(opts) {
    opts = opts || {};

    const varSrcs = [
        extractVar(backupSrc, 'FONT_BLOB_MAX_BYTES'),
        extractVar(backupSrc, 'FONT_STORE_MAX_BYTES'),
        extractVar(backupSrc, 'BACKUP_APP'),
        extractVar(backupSrc, 'BACKUP_SCHEMA'),
        extractVar(backupSrc, 'EXPORT_WARN_CHARS'),
        extractVar(backupSrc, 'EXCLUDE_KEYS'),
        extractVar(backupSrc, 'SECRET_KEYS'),
        extractVar(backupSrc, 'CORE_HINTS'),
        extractVar(backupSrc, 'IDB_TARGETS')
    ];
    const fnNames = [
        '$', 'toast', 'includeSecretsEnabled', 'snapshot',
        'stringifyIndexedDB',
        'base64ToBlob', 'blobToBase64', 'idbOpen',
        'dumpStore', 'dumpDatabase',
        'restoreStore', 'restoreDatabase',
        'doExport'
    ];
    const fnSrcs = fnNames.map(n => extractFunction(backupSrc, n));
    const ctxSrc = varSrcs.concat(fnSrcs).join('\n');

    // localStorage mock：数据直接挂在 mock 对象上，方法设为不可枚举，
    // 这样 Object.keys(localStorage) 能拿到真实数据键，而不会被 getItem 等污染
    const mockLocalStorage = opts.localStorage ? Object.assign({}, opts.localStorage) : {};
    Object.defineProperty(mockLocalStorage, 'getItem', {
        value(k) { return this.hasOwnProperty(k) ? String(this[k]) : null; },
        enumerable: false, configurable: true
    });
    Object.defineProperty(mockLocalStorage, 'setItem', {
        value(k, v) { this[k] = String(v); },
        enumerable: false, configurable: true
    });
    Object.defineProperty(mockLocalStorage, 'removeItem', {
        value(k) { delete this[k]; },
        enumerable: false, configurable: true
    });
    Object.defineProperty(mockLocalStorage, 'clear', {
        value() { for (const k of Object.keys(this)) delete this[k]; },
        enumerable: false, configurable: true
    });
    Object.defineProperty(mockLocalStorage, 'length', {
        get() { return Object.keys(this).length; },
        enumerable: false, configurable: true
    });

    // doExport 副作用拦截器
    const intercepted = {
        downloads: [],   // 被拦截的 Blob { name, bodyStr }
        toasts: [],
        confirmResult: opts.confirmResult || false  // 默认用户不确认带密钥
    };

    const mockEl = () => ({
        textContent: '', classList: { add() {}, remove() {} },
        href: '', download: '', click() {}, remove() {}, appendChild() {}, style: {}
    });

    const ctx = {
        Blob: SandboxBlob,
        FileReader: makeFileReader,
        indexedDB: globalThis.indexedDB,
        window: { indexedDB: globalThis.indexedDB },
        localStorage: mockLocalStorage,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Uint8Array: globalThis.Uint8Array,
        Promise: globalThis.Promise,
        Error: globalThis.Error,
        Date: globalThis.Date,
        setTimeout: (fn) => { fn(); return 0; },
        // URL.createObjectURL → 返回假 URL，不访问 DOM
        URL: {
            createObjectURL(blob) {
                // 拦截下载的 Blob：读出内容
                let bodyStr = null;
                try {
                    const b64 = blob._data ? blob._data.toString('base64') : '';
                    // Blob.prototype.arrayBuffer 不存在，SandboxBlob 也没有 text()；
                    // doExport 用 new Blob([bodyStr], { type: ... })，把 bodyStr 读一下
                    bodyStr = '';
                    if (blob instanceof SandboxBlob && blob._data) {
                        // bodyStr 在 SandboxBlob 构造时被当作 parts 第一个元素传入
                        // doExport 的 bodyStr 是 JSON 文本 → SandboxBlob 里就是这个字符串的 utf8 bytes
                        bodyStr = blob._data.toString('utf8');
                    }
                } catch (_) {}
                intercepted.downloads.push({ name: '(unknown)', bodyStr });
                return 'blob:mock/' + Math.random();
            },
            revokeObjectURL() {}
        },
        // document.createElement('a') → 返回 mock 元素；a.click 触发拦截
        document: {
            createElement(tag) { return mockEl(); },
            body: { appendChild() {} }
        },
        alert(msg) { intercepted.toasts.push({ kind: 'alert', msg }); },
        confirm(msg) { return intercepted.confirmResult; }
    };
    runInNewContext(ctxSrc, ctx, { filename: 'backup.js (sandbox)' });

    // 替换 doExport 内部的 toast / $ 以便拦截
    const origToast = ctx.toast;
    ctx.toast = function (msg) {
        intercepted.toasts.push({ kind: 'toast', msg });
        // 仍保留原 toast 行为（原 toast 在沙箱里依赖 $('toastMsg') 返回 null，
        // 会走 alert 分支，但 alert 已被我们拦截，所以是 no-op）
        origToast(msg);
    };
    // 覆盖 $('toastMsg') 返回 null，让原 toast 走 alert 分支 → 被我们拦截
    ctx.$ = function (id) { return null; };

    ctx.__intercepted = intercepted;
    ctx.__lsStore = mockLocalStorage;
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

    const db = registerDB('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);

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

    const result = await ctx.dumpDatabase('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);

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
    const imageRecordsDef = maomaoAssetsDef.stores.find(s => s.store === 'image_records');

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
    await injectRecords(db, 'image_records', imageRecordsDef, [
        {
            id: 'image_record_001', characterId: 'char_alice', assetId: 'img001',
            prompt: 'Fixed silver hair; quiet garden portrait',
            sceneDescription: 'A quiet garden in late afternoon',
            isPrivate: true, createdAt: 1793900000000
        }
    ]);

    const dumpResult = await ctx.dumpDatabase('maomao-assets', 1, maomaoAssetsDef.stores);
    assert.ok(dumpResult !== null);
    assert.ok(!dumpResult.atomicExportFailed);
    assert.equal(Object.keys(dumpResult.data).length, 4);
    assert.equal(dumpResult.data.assets.length, 2);
    assert.equal(dumpResult.data.refs.length, 2);
    assert.equal(dumpResult.data.blobs.length, 2);
    assert.equal(dumpResult.data.image_records.length, 1);
    assert.equal(dumpResult.data.image_records[0].id, 'image_record_001');
    assert.equal(dumpResult.data.image_records[0].assetId, 'img001');

    // dump 层验证：blob 是 base64 字符串、有伴生 MIME 字段
    dumpResult.data.blobs.forEach(b => {
        assert.equal(typeof b.blob, 'string');
        assert.ok(b.__blobMime_blob);
    });

    const db2 = registerDB('maomao-assets-restored', maomaoAssetsDef.version, maomaoAssetsDef.stores);
    const restoreResult = await ctx.restoreDatabase(
        'maomao-assets-restored', 1, maomaoAssetsDef.stores, dumpResult.data
    );
    assert.ok(restoreResult.dbRestored);
    assert.equal(restoreResult.written, 7, '2+2+2+1=7 条');
    assert.equal(restoreResult.skipped, 0);

    const restored = openDbs['maomao-assets-restored']._data;
    assert.equal(restored.assets.length, 2);
    assert.equal(restored.blobs.length, 2);
    assert.equal(restored.refs.length, 2);
    assert.equal(restored.image_records.length, 1);
    assert.equal(restored.image_records[0].characterId, 'char_alice');
    assert.equal(restored.image_records[0].prompt, 'Fixed silver hair; quiet garden portrait');
    assert.equal(restored.image_records[0].isPrivate, true);
    assert.equal(restored.image_records[0].assetId, 'img001');

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
  10. 直接调用生产代码 doExport()
      - localStorage 数据正常打进备份
      - maomao-assets 整库 atomicExportFailed → 从最终备份里消失
      - maomao-media-store / maomao-font-presets 正常保留
      - dbWarnings + allSkipped 在 toast 文案里出现
      - 最终 JSON body 可 parse 且结构正确
   ═══════════════════════════════════════════════ */
test('10 生产 doExport：localStorage 有数据 + atomicExportFailed 的 DB 被排除', async () => {
    clearAllDBs();

    // ── localStorage mock 里预置若干键值（snapshot 会读它们） ──
    const fakeLS = {
        ai_custom_characters: JSON.stringify({ list: ['char_a', 'char_b'] }),
        phone_data_v2: JSON.stringify({ theme: 'editorial', wallpaper: 'ocean' }),
        chat_history_99: JSON.stringify({ lastSeen: '2026-11-04' }),
        api_call_logs: 'should_be_excluded_by_EXCLUDE_KEYS',   // 会被 snapshot(dropCaches=true) 排除
        api_settings: 'SHOULD_BE_EXCLUDED_AS_SECRET'           // 会被 snapshot(dropSecrets=true) 排除
    };
    const ctx = buildCtxFull({ localStorage: fakeLS });
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;

    // ── maomao-assets：blobs 有一条超限 → atomicExportFailed ──
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

    // ── maomao-media-store：正常 ──
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { id: 'wp1', name: 'ocean.jpg', color: '#1a5e20' }
    ]);
    await injectRecords(mediaDb, 'audio', mediaDef.stores.find(s => s.store === 'audio'), [
        { id: 'song1', title: 'Morning Breeze', artist: 'Alice' }
    ]);

    // ── maomao-font-presets：正常 ──
    const fontDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-font-presets');
    const fontDb = registerDB('maomao-font-presets', fontDef.version, fontDef.stores);
    await injectRecords(fontDb, 'presets', fontDef.stores.find(s => s.store === 'presets'), [
        { id: 'f1', label: 'Editorial', family: 'Georgia', blob: new SandboxBlob([Buffer.from('FONT_BYTEZ')], { type: 'font/ttf' }) }
    ]);

    // ═══════════════════════════════════════════════
    // 直接调用生产代码 doExport()
    // ═══════════════════════════════════════════════
    await ctx.doExport();

    const inter = ctx.__intercepted;
    assert.ok(inter.downloads.length >= 1, '应至少触发一次下载');
    const download = inter.downloads[inter.downloads.length - 1];
    assert.ok(download.bodyStr && download.bodyStr.length > 100, '下载内容应有正文');

    // ====== 1. 最终 JSON 可 parse 且结构正确 ======
    const parsed = JSON.parse(download.bodyStr);
    assert.ok(parsed.__backup, '应有 __backup 元信息');
    assert.equal(parsed.__backup.app, 'phone-app');
    assert.equal(parsed.__backup.schema, 2);
    assert.ok(parsed.data && typeof parsed.data === 'object', '应有 data 段（localStorage 快照）');
    assert.ok(parsed.indexedDB && typeof parsed.indexedDB === 'object', '应有 indexedDB 段');

    // ====== 2. localStorage 数据：snapshot 正确排除 EXCLUDE_KEYS 和 SECRET_KEYS ======
    // snapshot(true, true) 排除 api_call_logs 和 api_settings
    const dataKeys = Object.keys(parsed.data);
    assert.ok(dataKeys.includes('ai_custom_characters'), '应保留 ai_custom_characters');
    assert.ok(dataKeys.includes('phone_data_v2'), '应保留 phone_data_v2');
    assert.ok(dataKeys.includes('chat_history_99'), '应保留 chat_history_99');
    assert.ok(!dataKeys.includes('api_call_logs'), 'api_call_logs 属于 EXCLUDE_KEYS，应被排除');
    assert.ok(!dataKeys.includes('api_settings'), 'api_settings 属于 SECRET_KEYS，应被排除');

    // ====== 3. maomao-assets atomicExportFailed → 不应出现在 indexedDB 段 ======
    assert.ok(!('maomao-assets' in parsed.indexedDB),
        'atomicExportFailed 的库不应进最终 JSON 的 indexedDB 段');

    // ====== 4. 其他 DB 正常保留 ======
    assert.ok('maomao-media-store' in parsed.indexedDB,
        'maomao-media-store 应正常保留');
    assert.ok('maomao-font-presets' in parsed.indexedDB,
        'maomao-font-presets 应正常保留');

    // ====== 5. indexedDB 概览（__backup.indexedDB）里也不应有 maomao-assets ======
    const dbOverview = parsed.__backup.indexedDB || {};
    assert.ok(!('maomao-assets' in dbOverview),
        'dbOverview 也应排除 atomicExportFailed 的库');
    assert.ok('maomao-media-store' in dbOverview);
    assert.ok('maomao-font-presets' in dbOverview);

    // ====== 6. toast 文案里应提到 atomicExport 警告 + 超限条目 ======
    const lastToast = inter.toasts[inter.toasts.length - 1];
    assert.ok(lastToast, '应触发 toast');
    assert.ok(/已导出/.test(lastToast.msg), 'toast 应说已导出');
    assert.ok(/媒体 Blob.*超限/.test(lastToast.msg) || /atomicExport/.test(lastToast.msg) || /maomao-assets/.test(lastToast.msg) || /1 个 IndexedDB/.test(lastToast.msg),
        'toast 应提到 maomao-assets atomicExportFailed 警告');
});
