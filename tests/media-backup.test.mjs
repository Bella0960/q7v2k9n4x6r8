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
 *  11-14. 多 store / 跨数据库恢复回滚、私有 Blob 恢复点与容量边界
 *  15-24. 完整导入链故障注入：localStorage / IndexedDB / 恢复点异常
 *  25-30. 恢复点内容指纹、原生事务生命周期、删除后读回校验
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
        },
        readAsArrayBuffer(blob) {
            Promise.resolve().then(() => {
                if (!blob || !blob._data) throw new Error('mock Blob has no bytes');
                this.result = Uint8Array.from(blob._data).buffer;
                if (this.onload) this.onload();
            }).catch(error => {
                this.error = error;
                if (this.onerror) this.onerror();
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
        _closeCount: 0,
        _deferComplete: false,
        _pendingComplete: null,
        _lastTransaction: null,
        _requestSuccessCount: 0,
        _flushComplete() {
            const pending = this._pendingComplete;
            this._pendingComplete = null;
            if (pending) pending();
        },
        close() { this._closeCount++; },
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
            const transactionNames = Array.isArray(storeName) ? storeName.slice() : [storeName];
            transactionNames.forEach(name => {
                assert.ok(data[name] !== undefined, `store ${name} 不存在`);
            });
            const before = mode === 'readwrite'
                ? Object.fromEntries(transactionNames.map(name => [name, data[name].slice()]))
                : null;
            db._transactions = db._transactions || [];
            db._transactions.push({ storeNames: transactionNames.slice(), mode });

            let oncompleteCb = null;
            let onabortCb = null;
            let aborted = false;
            const stores = {};
            function makeStore(name) {
                if (stores[name]) return stores[name];
                const store = {
                    _name: name,
                    _defs: storeDefs.find(d => d.store === name),
                    clear() {
                        data[name] = [];
                        return { onsuccess: null, result: undefined };
                    },
                    put(value, key) {
                        const def = storeDefs.find(d => d.store === name);
                        const failure = db._failPut;
                        if (failure && failure.store === name
                                && (!failure.assetId || String(value && value.assetId) === String(failure.assetId))
                                && (!failure.id || String(value && value.id) === String(failure.id))) {
                            db._failPut = null;
                            throw new Error(failure.message || 'mock IndexedDB put failed');
                        }
                        const drop = db._dropPut;
                        if (drop && drop.store === name
                                && (!drop.assetId || String(value && value.assetId) === String(drop.assetId))
                                && (!drop.id || String(value && value.id) === String(drop.id))) {
                            db._dropPut = null;
                            return { onsuccess: null, result: undefined };
                        }
                        let k;
                        if (def && def.keyPath) k = value[def.keyPath];
                        else k = key;
                        if (k === undefined || k === null) k = String(Date.now()) + '_' + Math.random();
                        if (!(def && def.keyPath)) value.__mock_key = k;
                        const idx = data[name].findIndex(r => {
                            if (def && def.keyPath) return r[def.keyPath] === k;
                            return r.__mock_key === k;
                        });
                        if (idx >= 0) data[name][idx] = value;
                        else data[name].push(value);
                        return { onsuccess: null, result: k };
                    },
                    getAll() {
                        const req = { result: data[name].slice(), onsuccess: null };
                        Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
                        return req;
                    },
                    getAllKeys() {
                        const keys = data[name].map(r => {
                            const def = storeDefs.find(d => d.store === name);
                            if (def && def.keyPath) return r[def.keyPath];
                            return r.__mock_key;
                        });
                        const req = { result: keys, onsuccess: null };
                        Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
                        return req;
                    },
                    get(key) {
                        const match = data[name].find(r => {
                            const def = storeDefs.find(d => d.store === name);
                            if (def && def.keyPath) return r[def.keyPath] === key;
                            return r.__mock_key === key;
                        });
                        const req = { result: match || undefined, onsuccess: null, onerror: null };
                        Promise.resolve().then(() => {
                            db._requestSuccessCount++;
                            if (req.onsuccess) req.onsuccess({ target: req });
                        });
                        return req;
                    },
                    delete(key) {
                        const def = storeDefs.find(d => d.store === name);
                        const index = data[name].findIndex(r => {
                            if (def && def.keyPath) return r[def.keyPath] === key;
                            return r.__mock_key === key;
                        });
                        if (index >= 0) data[name].splice(index, 1);
                        return { onsuccess: null, result: undefined };
                    }
                };
                stores[name] = store;
                return store;
            }

            const tx = {
                objectStore(name) {
                    const target = name || transactionNames[0];
                    assert.ok(transactionNames.includes(target), `store ${target} 不在事务中`);
                    return makeStore(target);
                },
                error: null,
                abort() {
                    if (aborted) return;
                    aborted = true;
                    this.error = this.error || new Error('mock transaction aborted');
                    if (before) Object.keys(before).forEach(name => { data[name] = before[name].slice(); });
                    db._pendingComplete = null;
                    if (onabortCb) Promise.resolve().then(() => onabortCb());
                },
                set oncomplete(fn) {
                    oncompleteCb = fn;
                    const complete = () => {
                        if (oncompleteCb && !aborted) oncompleteCb();
                    };
                    if (db._deferComplete) db._pendingComplete = complete;
                    else Promise.resolve().then(complete);
                },
                get oncomplete() { return oncompleteCb; },
                set onerror(fn) { this._onerror = fn; },
                get onerror() { return this._onerror; },
                set onabort(fn) {
                    onabortCb = fn;
                    if (aborted && onabortCb) Promise.resolve().then(() => onabortCb());
                },
                get onabort() { return this._onabort; }
            };
            db._lastTransaction = tx;
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
    Blob.prototype.slice = function (start, end) {
        return new Blob([this._data.subarray(start || 0, end === undefined ? this._data.length : end)], { type: this.type });
    };
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
        extractVar(backupSrc, 'IDB_TARGETS'),
        extractVar(backupSrc, 'RP_DB_NAME'),
        extractVar(backupSrc, 'RP_DB_VERSION'),
        extractVar(backupSrc, 'RP_STORE_NAME'),
        extractVar(backupSrc, 'RP_ROLE_PRE'),
        extractVar(backupSrc, 'RP_ROLE_IDB_PRE'),
        extractVar(backupSrc, 'RESTORE_POINT_IDB_MAX_BYTES')
    ];
    const fnNames = [
        '$', 'toast', 'includeSecretsEnabled', 'snapshot',
        'stringifyIndexedDB',
        'base64ToBlob', 'blobToBase64', 'idbOpen',
        'dumpStore', 'dumpDatabase',
        'restoreStore', 'restoreDatabase', 'validateBackup', 'restore', 'verifyRestore',
        'rpOpen', 'rpWriteSnapshot', 'rpReadSnapshot', 'rpDeleteRole',
        'clearRestorePoints', 'downloadSnapshot', 'carryOverSecrets', 'checkFontPresetOrphan',
        'estimateRestorePointBytes', 'fingerprintRestorePoint', 'dumpDatabaseForRestorePoint',
        'captureIndexedDbRestorePoint', 'restoreIndexedDBWithRollback',
        'doExport', 'handleImportFile'
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
        confirmResult: opts.confirmResult || false, // 默认用户不确认带密钥
        reloads: 0,
        deletedRestorePoints: []
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
        location: { reload() { intercepted.reloads++; } },
        alert(msg) { intercepted.toasts.push({ kind: 'alert', msg }); },
        confirm(msg) { return intercepted.confirmResult; }
    };
    runInNewContext(ctxSrc, ctx, { filename: 'backup.js (sandbox)' });

    // 文件导入仍调用生产 handleImportFile；只把浏览器 FileReader 的文本读取
    // 接到测试 Promise，便于等待 async onload 完整结束，不复制导入流程逻辑。
    const OriginalFileReader = ctx.FileReader;
    ctx.FileReader = function MockImportFileReader() {
        const reader = new OriginalFileReader();
        reader.readAsText = function (file) {
            ctx.__pendingImport = Promise.resolve().then(() => {
                reader.result = file && file.content !== undefined ? file.content : String(file || '');
                return reader.onload && reader.onload({ target: reader });
            });
        };
        return reader;
    };

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

    const restorePointRows = new Map();
    ctx.__realRestorePointApi = {
        rpOpen: ctx.rpOpen,
        rpWriteSnapshot: ctx.rpWriteSnapshot,
        rpReadSnapshot: ctx.rpReadSnapshot,
        rpDeleteRole: ctx.rpDeleteRole
    };
    ctx.rpWriteSnapshot = async (snap, role) => { restorePointRows.set(role, { snap, createdAt: Date.now() }); };
    ctx.rpReadSnapshot = async (role) => restorePointRows.get(role) || null;
    ctx.rpDeleteRole = async (role) => {
        restorePointRows.delete(role);
        intercepted.deletedRestorePoints.push(role);
    };
    ctx.__restorePointRows = restorePointRows;
    ctx.__intercepted = intercepted;
    ctx.__lsStore = mockLocalStorage;
    assert.ok(ctx.IDB_TARGETS, 'runInNewContext 后 IDB_TARGETS 应挂在 ctx 上');
    return ctx;
}



/* ── 完整导入流程测试辅助：使用生产 handleImportFile，只替换浏览器文件读取 ── */
function makeImportPayload(indexedDB) {
    const databases = indexedDB || {};
    const summary = {};
    Object.keys(databases).forEach(dbName => {
        summary[dbName] = Object.values(databases[dbName]).reduce(
            (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0
        );
    });
    return {
        __backup: {
            app: 'phone-app',
            schema: 2,
            exportedAt: '2026-11-08T00:00:00.000Z',
            indexedDB: summary
        },
        data: {
            ai_custom_characters: JSON.stringify({ profile: 'imported-character-state' }),
            phone_data_v2: 'imported-phone-state'
        },
        indexedDB: databases
    };
}

async function runImport(ctx, payload) {
    ctx.handleImportFile({ content: JSON.stringify(payload) });
    assert.ok(ctx.__pendingImport, 'handleImportFile must start a waitable FileReader import');
    await ctx.__pendingImport;
}

async function seedCrossDatabaseImportFixture(ctx) {
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);
    await injectRecords(mediaDb, 'audio', mediaDef.stores.find(s => s.store === 'audio'), [
        { id: 'audio-old', title: 'Old local audio',
          blob: new SandboxBlob([Buffer.from('original-local-audio')], { type: 'audio/mpeg' }) }
    ]);

    const fontDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-font-presets');
    const fontDb = registerDB('maomao-font-presets', fontDef.version, fontDef.stores);
    await injectRecords(fontDb, 'presets', fontDef.stores.find(s => s.store === 'presets'), [
        { id: 'font-old', label: 'Old font',
          blob: new SandboxBlob([Buffer.from('old-font-bytes')], { type: 'font/ttf' }) }
    ]);
    return { mediaDb, fontDb };
}

function makeCrossDatabaseIncoming() {
    return makeImportPayload({
        'maomao-media-store': {
            wallpapers: [{
                __key: 'wallpaper-new-key',
                __value: { id: 'wallpaper-new', name: 'New wallpaper' }
            }],
            audio: []
        },
        'maomao-font-presets': {
            presets: [{
                id: 'font-new',
                label: 'Incoming font',
                blob: 'aGVsbG8=',
                __blobMime_blob: 'font/ttf'
            }]
        }
    });
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
    const db = registerDB('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);

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

    const dumpResult = await ctx.dumpDatabase('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);
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
        'maomao-assets-restored', maomaoAssetsDef.version, maomaoAssetsDef.stores, dumpResult.data
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
    registerDB('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);
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

    const result = await ctx.restoreDatabase('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores, incomingData);
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
   9. restoreDatabase 多 store 原子性：后续 store 写入失败时整库回滚
   ═══════════════════════════════════════════════ */
test('09 restoreDatabase：任一 store 写入失败会回滚同一 DB 的全部 store', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const definition = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const db = registerDB('maomao-assets', definition.version, definition.stores);

    await injectRecords(db, 'assets', definition.stores.find(s => s.store === 'assets'), [
        { assetId: 'old-asset', type: 'image', mimeType: 'image/png' }
    ]);
    await injectRecords(db, 'blobs', definition.stores.find(s => s.store === 'blobs'), [
        { assetId: 'old-asset', blob: new SandboxBlob([Buffer.from('original-bytes')], { type: 'image/png' }) }
    ]);
    await injectRecords(db, 'refs', definition.stores.find(s => s.store === 'refs'), [
        { assetId: 'old-asset', ownerType: 'character', ownerId: 'char_old' }
    ]);
    await injectRecords(db, 'image_records', definition.stores.find(s => s.store === 'image_records'), [
        { id: 'old-record', assetId: 'old-asset', characterId: 'char_old', isPrivate: true }
    ]);

    const incoming = {
        assets: [{ assetId: 'new-asset', type: 'image', mimeType: 'image/jpeg' }],
        blobs: [{
            assetId: 'broken-blob',
            blob: 'aGVsbG8=',
            __blobMime_blob: 'image/jpeg'
        }],
        refs: [{ assetId: 'new-asset', ownerType: 'character', ownerId: 'char_new' }],
        image_records: [{ id: 'new-record', assetId: 'new-asset', characterId: 'char_new', isPrivate: false }]
    };
    db._failPut = { store: 'blobs', assetId: 'broken-blob', message: 'injected restore failure' };

    await assert.rejects(
        ctx.restoreDatabase('maomao-assets', definition.version, definition.stores, incoming),
        /injected restore failure/
    );

    assert.deepEqual(db._data.assets.map(x => x.assetId), ['old-asset'],
        'assets written before the failure must be rolled back');
    assert.equal(db._data.blobs.length, 1);
    assert.equal(db._data.blobs[0].assetId, 'old-asset');
    assert.ok(isBlobLike(db._data.blobs[0].blob));
    assert.equal(db._data.blobs[0].blob._data.toString('utf8'), 'original-bytes');
    assert.deepEqual(db._data.refs.map(x => x.ownerId), ['char_old'],
        'later stores must keep their original values');
    assert.deepEqual(db._data.image_records.map(x => x.id), ['old-record']);

    const atomicTx = db._transactions.findLast(tx =>
        tx.mode === 'readwrite' && tx.storeNames.length === 4
    );
    assert.ok(atomicTx, 'all four stores must share one readwrite transaction');
    assert.deepEqual(atomicTx.storeNames, ['assets', 'blobs', 'refs', 'image_records']);
});

/* ═══════════════════════════════════════════════
   10. atomicExport：store 总量超限（多条累加越过 blobStoreMaxBytes）
   ═══════════════════════════════════════════════ */
test('10 dumpDatabase：store 总 Blob 超限 → 多条被跳过 → atomicExportFailed', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const maomaoAssetsDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-assets');
    const blobMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobMaxBytes;
    const blobStoreMax = maomaoAssetsDef.stores.find(s => s.store === 'blobs').blobStoreMaxBytes;

    const db = registerDB('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);
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

    const result = await ctx.dumpDatabase('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);

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
test('11 生产 doExport：localStorage 有数据 + atomicExportFailed 的 DB 被排除', async () => {
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
    const assetsDb = registerDB('maomao-assets', maomaoAssetsDef.version, maomaoAssetsDef.stores);
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

test('12 restoreIndexedDBWithRollback: later database failure rolls back earlier database and preserves audio Blob', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();

    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);
    const originalAudioBytes = Buffer.from('original-local-audio');
    await injectRecords(mediaDb, 'audio', mediaDef.stores.find(s => s.store === 'audio'), [
        { id: 'audio-old', title: 'Old local audio', blob: new SandboxBlob([originalAudioBytes], { type: 'audio/mpeg' }) }
    ]);

    const fontDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-font-presets');
    const fontDb = registerDB('maomao-font-presets', fontDef.version, fontDef.stores);
    await injectRecords(fontDb, 'presets', fontDef.stores.find(s => s.store === 'presets'), [
        { id: 'font-old', label: 'Old font', blob: new SandboxBlob([Buffer.from('old-font-bytes')], { type: 'font/ttf' }) }
    ]);

    const incoming = {
        'maomao-media-store': {
            wallpapers: [{ __key: 'wallpaper-new-key', __value: { id: 'wallpaper-new', name: 'New wallpaper' } }],
            audio: [{ id: 'audio-new', title: 'New local audio' }]
        },
        'maomao-font-presets': {
            presets: [{ id: 'font-new', label: 'Broken incoming font', blob: 'aGVsbG8=', __blobMime_blob: 'font/ttf' }]
        }
    };
    fontDb._failPut = { store: 'presets', id: 'font-new', message: 'injected font database failure' };

    const restorePoint = await ctx.captureIndexedDbRestorePoint(incoming);
    assert.deepEqual(restorePoint.targets.map(t => t.db), ['maomao-media-store', 'maomao-font-presets']);
    assert.ok(ctx.__restorePointRows.has('pre-import-indexeddb'));

    const result = await ctx.restoreIndexedDBWithRollback(incoming, restorePoint);
    assert.equal(result.ok, false);
    assert.equal(result.failedDb, 'maomao-font-presets');
    assert.deepEqual(result.rollbackFailures, []);

    assert.deepEqual(mediaDb._data.wallpapers.map(x => x.id), ['wallpaper-old'],
        'the first restored database must be rolled back');
    assert.equal(mediaDb._data.audio.length, 1);
    assert.equal(mediaDb._data.audio[0].id, 'audio-old');
    assert.ok(isBlobLike(mediaDb._data.audio[0].blob),
        'excluded audio blobs in regular exports must still exist in the private restore point');
    assert.equal(mediaDb._data.audio[0].blob.type, 'audio/mpeg');
    assert.equal(mediaDb._data.audio[0].blob._data.toString('utf8'), 'original-local-audio');
    assert.equal(fontDb._data.presets.length, 1,
        'the failing database transaction itself must leave the original store unchanged');
    assert.equal(fontDb._data.presets[0].id, 'font-old');
});

test('13 IndexedDB restore failure rolls back globally and retains recovery points if rollback is uncertain', () => {
    assert.match(backupSrc, /var allRollbackOk = localRollbackOk && localRollbackVerify\.ok/);
    assert.match(backupSrc, /idbRestoreResult\.rollbackFailures\.length === 0/);
    assert.match(backupSrc, /await rpDeleteRole\(RP_ROLE_PRE\);\s*await rpDeleteRole\(RP_ROLE_IDB_PRE\);/);
    assert.match(backupSrc, /部分回滚未能确认；本机恢复点已保留/);
    assert.match(backupSrc, /captureIndexedDbRestorePoint\(obj\.indexedDB\)/);
});

test('14 restore-point snapshot keeps excluded local fields and enforces a size ceiling', () => {
    const snapshotStart = backupSrc.indexOf('function dumpDatabaseForRestorePoint(');
    const snapshotEnd = backupSrc.indexOf('function captureIndexedDbRestorePoint(', snapshotStart);
    assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
    const snapshotFn = backupSrc.slice(snapshotStart, snapshotEnd);
    assert.match(snapshotFn, /db\.transaction\(storeNames, 'readonly'\)/);
    assert.match(snapshotFn, /store\.getAll\(\)/);
    assert.match(snapshotFn, /store\.getAllKeys\(\)/);
    assert.match(snapshotFn, /__key: key, __value: values\[index\]/);
    assert.match(backupSrc, /RESTORE_POINT_IDB_MAX_BYTES = 150 \* 1024 \* 1024/);
    assert.match(backupSrc, /estimateRestorePointBytes\(snapshots\)/);
    assert.match(backupSrc, /超过本机安全恢复点上限/);
    assert.match(backupSrc, /estimateRestorePointBytes\(stored\.snap\) !== estimatedBytes/);
});



/* ═══════════════════════════════════════════════
   15. 完整导入链：localStorage 新数据写入失败后恢复原样
   ═══════════════════════════════════════════════ */
test('15 完整导入：localStorage 写入失败时回滚原值且不触碰业务数据库', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state',
            keep_local_setting: 'keep-me'
        }
    });
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);

    const originalSetItem = ctx.localStorage.setItem;
    let injected = false;
    Object.defineProperty(ctx.localStorage, 'setItem', {
        configurable: true,
        value: function (key, value) {
            if (key === 'phone_data_v2' && !injected) {
                injected = true;
                throw new Error('injected localStorage import write failure');
            }
            return originalSetItem.call(this, key, value);
        }
    });

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': {
            wallpapers: [{ __key: 'wallpaper-new-key', __value: { id: 'wallpaper-new', name: 'New wallpaper' } }],
            audio: []
        }
    }));

    assert.equal(injected, true, '故障注入必须发生在 localStorage 导入写入阶段');
    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.equal(ctx.localStorage.keep_local_setting, 'keep-me');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-old'],
        'localStorage 阶段失败时不得开始业务 IndexedDB 覆盖');
    assert.equal(ctx.__restorePointRows.size, 0, '确认完整回滚后应清理两份临时恢复点');
    assert.ok(ctx.__intercepted.toasts.some(item => /已从本机恢复点回滚到导入前状态/.test(item.msg)));
    assert.equal(ctx.__intercepted.reloads, 0, '失败导入不得刷新页面');
});

/* ═══════════════════════════════════════════════
   16. 完整导入链：后一个数据库失败，前一个库与 localStorage 一起回滚
   ═══════════════════════════════════════════════ */
test('16 完整导入：第二个数据库失败时逆序回滚首库和 localStorage', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state',
            keep_local_setting: 'keep-me'
        }
    });
    const { mediaDb, fontDb } = await seedCrossDatabaseImportFixture(ctx);
    fontDb._failPut = {
        store: 'presets',
        id: 'font-new',
        message: 'injected second database failure'
    };

    await runImport(ctx, makeCrossDatabaseIncoming());

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.equal(ctx.localStorage.keep_local_setting, 'keep-me');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-old']);
    assert.equal(mediaDb._data.audio.length, 1);
    assert.equal(mediaDb._data.audio[0].id, 'audio-old');
    assert.ok(isBlobLike(mediaDb._data.audio[0].blob));
    assert.equal(mediaDb._data.audio[0].blob.type, 'audio/mpeg');
    assert.equal(mediaDb._data.audio[0].blob._data.toString('utf8'), 'original-local-audio',
        '跨库回滚必须保留普通备份不会导出的本地音乐 Blob');
    assert.equal(fontDb._data.presets.length, 1);
    assert.equal(fontDb._data.presets[0].id, 'font-old');
    assert.equal(ctx.__restorePointRows.size, 0, '所有回滚均确认后才清理恢复点');
    assert.ok(ctx.__intercepted.toasts.some(item => /已将其他数据全部回滚到导入前状态/.test(item.msg)));
    assert.equal(ctx.__intercepted.reloads, 0);
});

/* ═══════════════════════════════════════════════
   17. 完整导入链：跨库回滚失败时保留两份本机恢复点
   ═══════════════════════════════════════════════ */
test('17 完整导入：前序数据库回滚失败时保留 localStorage 与 IndexedDB 恢复点', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const { mediaDb, fontDb } = await seedCrossDatabaseImportFixture(ctx);

    // 首库导入写入 wallpaper-new 不触发；只有回滚写回 wallpaper-old 时故意失败。
    mediaDb._failPut = {
        store: 'wallpapers',
        id: 'wallpaper-old',
        message: 'injected first database rollback failure'
    };
    fontDb._failPut = {
        store: 'presets',
        id: 'font-new',
        message: 'injected second database failure'
    };

    await runImport(ctx, makeCrossDatabaseIncoming());

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state',
        'localStorage 应尽力恢复，即使 IndexedDB 回滚失败');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-new'],
        '故意失败的首库回滚应留下可识别的部分恢复状态');
    assert.equal(fontDb._data.presets.length, 1);
    assert.equal(fontDb._data.presets[0].id, 'font-old');
    assert.ok(ctx.__restorePointRows.has('pre-import'),
        'localStorage 原始快照必须保留');
    assert.ok(ctx.__restorePointRows.has('pre-import-indexeddb'),
        '包含本地 Blob 的 IndexedDB 原始快照必须保留');
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /部分回滚未能确认；本机恢复点已保留/.test(item.msg)
        && /请勿清理网站数据/.test(item.msg)
    ));
    assert.equal(ctx.__intercepted.reloads, 0);
});

/* ═══════════════════════════════════════════════
   18. 完整导入链：localStorage 自身回滚失败时保留可恢复快照
   ═══════════════════════════════════════════════ */
test('18 完整导入：localStorage 写入及其回滚均失败时保留两份恢复点', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);

    const originalSetItem = ctx.localStorage.setItem;
    let failuresRemaining = 2;
    Object.defineProperty(ctx.localStorage, 'setItem', {
        configurable: true,
        value: function (key, value) {
            if (key === 'phone_data_v2' && failuresRemaining > 0) {
                failuresRemaining--;
                throw new Error('injected persistent localStorage write failure');
            }
            return originalSetItem.call(this, key, value);
        }
    });

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': {
            wallpapers: [{ __key: 'wallpaper-new-key', __value: { id: 'wallpaper-new', name: 'New wallpaper' } }],
            audio: []
        }
    }));

    assert.equal(failuresRemaining, 0, '导入写入和本地回滚各应触发一次故障');
    assert.equal(ctx.localStorage.phone_data_v2, undefined,
        '模拟回滚失败后，受影响 key 应保持缺失而不是伪报完整恢复');
    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-old'],
        'localStorage 阶段失败时业务数据库仍不得被覆盖');
    assert.ok(ctx.__restorePointRows.has('pre-import'));
    assert.ok(ctx.__restorePointRows.has('pre-import-indexeddb'));
    const retainedLocal = ctx.__restorePointRows.get('pre-import').snap;
    assert.equal(retainedLocal.phone_data_v2, 'old-phone-state',
        '保留的恢复点必须仍包含失败回滚前的原始 localStorage 值');
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /回滚未完全成功/.test(item.msg) && /本机恢复点已保留/.test(item.msg)
    ));
    assert.equal(ctx.__intercepted.reloads, 0);
});

/* ═══════════════════════════════════════════════
   19. 完整导入链：IndexedDB 快照建立失败时在修改业务数据前中止
   ═══════════════════════════════════════════════ */
test('19 完整导入：IndexedDB 恢复点写入失败时提前中止且不修改原数据', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);

    const writeSnapshot = ctx.rpWriteSnapshot;
    ctx.rpWriteSnapshot = async (snap, role) => {
        if (role === 'pre-import-indexeddb') {
            throw new Error('injected IndexedDB restore-point quota failure');
        }
        return writeSnapshot(snap, role);
    };

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': {
            wallpapers: [{ __key: 'wallpaper-new-key', __value: { id: 'wallpaper-new', name: 'New wallpaper' } }],
            audio: []
        }
    }));

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-old']);
    assert.equal(ctx.__restorePointRows.size, 0,
        '未能建立完整快照时应删除本轮不完整恢复点并保持业务数据原样');
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /无法建立完整的 IndexedDB 回滚恢复点/.test(item.msg)
        && /现有业务数据未修改/.test(item.msg)
    ));
    assert.equal(ctx.__intercepted.reloads, 0);
});


/* ═══════════════════════════════════════════════
   20. 完整导入链成功：验证数据提交、恢复点清理与刷新
   ═══════════════════════════════════════════════ */
test('20 完整导入成功：业务数据写入后清理两份恢复点并刷新', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state',
            keep_local_setting: 'keep-me'
        }
    });
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-old-key', id: 'wallpaper-old', name: 'Old wallpaper' }
    ]);

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': {
            wallpapers: [{
                __key: 'wallpaper-new-key',
                __value: { id: 'wallpaper-new', name: 'Imported wallpaper' }
            }],
            audio: []
        }
    }));

    assert.equal(ctx.localStorage.ai_custom_characters,
        JSON.stringify({ profile: 'imported-character-state' }));
    assert.equal(ctx.localStorage.phone_data_v2, 'imported-phone-state');
    assert.equal(ctx.localStorage.keep_local_setting, undefined,
        '成功导入按备份内容覆盖普通 localStorage 键');
    assert.deepEqual(mediaDb._data.wallpapers.map(row => row.id), ['wallpaper-new']);
    assert.equal(ctx.__restorePointRows.size, 0, '成功提交后应清理两份临时恢复点');
    assert.equal(ctx.__intercepted.reloads, 1, '成功导入应触发一次页面刷新');
    assert.ok(ctx.__intercepted.toasts.some(item => /导入成功/.test(item.msg)));
});

/* ═══════════════════════════════════════════════
   21. 完整导入链：无法完整读取旧 localStorage 时拒绝开始导入
   ═══════════════════════════════════════════════ */
test('21 完整导入：导入前 localStorage 读取失败时中止且不建立不完整恢复点', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const originalGetItem = ctx.localStorage.getItem;
    Object.defineProperty(ctx.localStorage, 'getItem', {
        configurable: true,
        value: function (key) {
            if (key === 'phone_data_v2') throw new Error('injected localStorage read failure');
            return originalGetItem.call(this, key);
        }
    });

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': { wallpapers: [] }
    }));

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.equal(ctx.__restorePointRows.size, 0,
        '不完整的 localStorage 快照不得写成可用恢复点');
    assert.equal(ctx.__intercepted.reloads, 0);
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /无法完整读取本机数据/.test(item.msg) && /phone_data_v2/.test(item.msg)
    ));
});

/* ═══════════════════════════════════════════════
   22. localStorage.clear 故障：不得产生异步未处理异常，且应尝试恢复
   ═══════════════════════════════════════════════ */
test('22 完整导入：localStorage.clear 抛错时安全中止并从恢复点恢复原值', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const originalClear = ctx.localStorage.clear;
    let failOnce = true;
    Object.defineProperty(ctx.localStorage, 'clear', {
        configurable: true,
        value: function () {
            if (failOnce) {
                failOnce = false;
                throw new Error('injected localStorage clear failure');
            }
            return originalClear.call(this);
        }
    });

    await runImport(ctx, makeImportPayload({
        'maomao-media-store': { wallpapers: [] }
    }));

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.equal(ctx.__restorePointRows.size, 0,
        '回滚成功后应清理恢复点');
    assert.equal(ctx.__intercepted.reloads, 0);
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /已从本机恢复点回滚到导入前状态/.test(item.msg)
    ));
});

/* ═══════════════════════════════════════════════
   23. localStorage 恢复校验必须拒绝额外残留键
   ═══════════════════════════════════════════════ */
test('23 verifyRestore：检测导入前快照之外的额外残留键', () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        localStorage: {
            ai_custom_characters: 'old-character-state',
            unexpected_residue: 'should-not-remain'
        }
    });
    const result = ctx.verifyRestore({
        ai_custom_characters: 'old-character-state'
    });
    assert.equal(result.ok, false);
    assert.equal(Array.from(result.extra).join(','), 'unexpected_residue');
    assert.equal(result.missing.length, 0);
    assert.equal(result.mismatched.length, 0);
});


/* ═══════════════════════════════════════════════
   24. localStorage 键清单不可读时，恢复校验必须失败
   ═══════════════════════════════════════════════ */
test('24 verifyRestore：无法读取 localStorage 键清单时不能把空快照判为成功', () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    ctx.localStorage = new Proxy(ctx.localStorage, {
        ownKeys() { throw new Error('injected localStorage key enumeration failure'); }
    });
    const result = ctx.verifyRestore({});
    assert.equal(result.ok, false);
    assert.equal(result.keyReadOk, false);
});


/* ═══════════════════════════════════════════════
   25. 恢复点指纹识别等大小文本内容被改写
   ═══════════════════════════════════════════════ */
test('25 captureIndexedDbRestorePoint：读回内容同长度被改写时指纹校验失败', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const mediaDef = ctx.IDB_TARGETS.find(t => t.db === 'maomao-media-store');
    const mediaDb = registerDB('maomao-media-store', mediaDef.version, mediaDef.stores);
    await injectRecords(mediaDb, 'wallpapers', mediaDef.stores.find(s => s.store === 'wallpapers'), [
        { __key: 'wallpaper-key', id: 'wallpaper-1', name: 'Old wallpaper' }
    ]);

    const readSnapshot = ctx.rpReadSnapshot;
    ctx.rpReadSnapshot = async role => {
        const stored = await readSnapshot(role);
        if (role !== 'pre-import-indexeddb' || !stored) return stored;
        const dbData = stored.snap['maomao-media-store'];
        const rows = dbData.wallpapers.map(row => ({
            ...row,
            __value: { ...row.__value, name: 'Bad wallpaper' }
        }));
        return {
            ...stored,
            snap: {
                ...stored.snap,
                'maomao-media-store': { ...dbData, wallpapers: rows }
            }
        };
    };

    await assert.rejects(
        ctx.captureIndexedDbRestorePoint({
            'maomao-media-store': { wallpapers: [] }
        }),
        /内容指纹校验失败/
    );
});

/* ═══════════════════════════════════════════════
   26. 恢复点指纹读取真实 Blob 字节，不只比较 MIME 和体积
   ═══════════════════════════════════════════════ */
test('26 fingerprintRestorePoint：同 MIME、同体积但二进制不同的 Blob 指纹不同', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const first = new SandboxBlob([Buffer.from('original-audio')], { type: 'audio/mpeg' });
    const changed = new SandboxBlob([Buffer.from('original-audiX')], { type: 'audio/mpeg' });
    assert.equal(first.size, changed.size);
    assert.equal(first.type, changed.type);

    const firstFingerprint = await ctx.fingerprintRestorePoint({ blob: first });
    const changedFingerprint = await ctx.fingerprintRestorePoint({ blob: changed });
    assert.notEqual(firstFingerprint, changedFingerprint,
        '校验必须读取 Blob 实际字节，不能只依赖 size/type');
    const clonedFingerprint = await ctx.fingerprintRestorePoint({
        blob: new SandboxBlob([Buffer.from('original-audio')], { type: 'audio/mpeg' })
    });
    assert.equal(firstFingerprint, clonedFingerprint,
        '结构化克隆后的相同 Blob 内容必须产生相同指纹');
});


/* ═══════════════════════════════════════════════
   27. 恢复点 IndexedDB API：真实写入、事务完成后读回和清理
   ═══════════════════════════════════════════════ */
test('27 恢复点 API：真实写入/读回/清理使用完整事务并关闭数据库连接', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const restoreDb = registerDB('maomao-restore-point', 1, [
        { store: 'restores', keyPath: 'role' }
    ]);
    const api = ctx.__realRestorePointApi;
    const snapshot = {
        profile: 'before-import',
        nested: { enabled: true, values: [1, 2, 3] }
    };

    await api.rpWriteSnapshot(snapshot, 'pre-import');
    assert.equal(restoreDb._data.restores.length, 1);
    assert.equal(restoreDb._data.restores[0].role, 'pre-import');

    const restored = await api.rpReadSnapshot('pre-import');
    assert.deepEqual(restored.snap, snapshot);
    assert.ok(restoreDb._closeCount >= 2,
        'write and read operations must close their IndexedDB connections');

    await api.rpDeleteRole('pre-import');
    assert.equal(restoreDb._data.restores.length, 0);
    assert.ok(restoreDb._closeCount >= 3,
        'delete operation must close its IndexedDB connection');
});

/* ═══════════════════════════════════════════════
   28. 恢复点读取：request success 不等于只读事务完成
   ═══════════════════════════════════════════════ */
test('28 rpReadSnapshot：必须等 readonly 事务 complete 后才 resolve', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const restoreDb = registerDB('maomao-restore-point', 1, [
        { store: 'restores', keyPath: 'role' }
    ]);
    const api = ctx.__realRestorePointApi;
    await api.rpWriteSnapshot({ value: 'durable-snapshot' }, 'pre-import');

    restoreDb._deferComplete = true;
    let settled = false;
    const pendingRead = api.rpReadSnapshot('pre-import').then(value => {
        settled = true;
        return value;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(restoreDb._requestSuccessCount > 0,
        'the object-store get request should already have succeeded');
    assert.equal(settled, false,
        'the read promise must not resolve before its transaction completes');

    restoreDb._flushComplete();
    const result = await pendingRead;
    assert.equal(result.snap.value, 'durable-snapshot');
    assert.equal(settled, true);
    restoreDb._deferComplete = false;
});

/* ═══════════════════════════════════════════════
   29. 恢复点读取：请求成功后事务中止仍必须判失败
   ═══════════════════════════════════════════════ */
test('29 rpReadSnapshot：request success 后 readonly 事务 abort 必须 reject', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    const restoreDb = registerDB('maomao-restore-point', 1, [
        { store: 'restores', keyPath: 'role' }
    ]);
    const api = ctx.__realRestorePointApi;
    await api.rpWriteSnapshot({ value: 'durable-snapshot' }, 'pre-import');

    restoreDb._deferComplete = true;
    const pendingRead = api.rpReadSnapshot('pre-import');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(restoreDb._requestSuccessCount > 0);
    restoreDb._lastTransaction.abort();
    await assert.rejects(pendingRead, /mock transaction aborted|aborted/);
    restoreDb._deferComplete = false;
});


/* ═══════════════════════════════════════════════
   30. 恢复点删除失败：必须读回发现残留并告知用户
   ═══════════════════════════════════════════════ */
test('30 clearRestorePoints：删除后仍可读到恢复点时返回失败列表', async () => {
    clearAllDBs();
    const ctx = buildCtxFull();
    ctx.__restorePointRows.set('pre-import', {
        snap: { ai_custom_characters: 'old-state' },
        createdAt: Date.now()
    });
    ctx.__restorePointRows.set('pre-import-indexeddb', {
        snap: { 'maomao-media-store': { wallpapers: [] } },
        createdAt: Date.now()
    });

    const deleteRole = ctx.rpDeleteRole;
    ctx.rpDeleteRole = async role => {
        if (role === 'pre-import-indexeddb') return;
        return deleteRole(role);
    };

    const result = await ctx.clearRestorePoints();
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0], 'pre-import-indexeddb');
    assert.equal(ctx.__restorePointRows.has('pre-import'), false);
    assert.equal(ctx.__restorePointRows.has('pre-import-indexeddb'), true,
        '未确认删除的恢复点必须保留');
});


/* ═══════════════════════════════════════════════
   31. 数据库回滚事务成功但静默漏写：必须回读发现并保留恢复点
   ═══════════════════════════════════════════════ */
test('31 完整导入：数据库回滚事务成功但数据未完整写回时判定回滚失败', async () => {
    clearAllDBs();
    const ctx = buildCtxFull({
        confirmResult: true,
        localStorage: {
            ai_custom_characters: 'old-character-state',
            phone_data_v2: 'old-phone-state'
        }
    });
    const { mediaDb, fontDb } = await seedCrossDatabaseImportFixture(ctx);

    // rollback restoreDatabase 的事务正常 complete，但故意静默丢弃原 wallpaper。
    mediaDb._dropPut = {
        store: 'wallpapers',
        id: 'wallpaper-old'
    };
    // 第二库导入失败，触发首库回滚。
    fontDb._failPut = {
        store: 'presets',
        id: 'font-new',
        message: 'injected second database failure'
    };

    await runImport(ctx, makeCrossDatabaseIncoming());

    assert.equal(ctx.localStorage.ai_custom_characters, 'old-character-state');
    assert.equal(ctx.localStorage.phone_data_v2, 'old-phone-state');
    assert.equal(mediaDb._data.wallpapers.length, 0,
        '故障注入应模拟事务成功但原记录静默漏写');
    assert.ok(ctx.__restorePointRows.has('pre-import'),
        'localStorage 恢复点必须继续保留');
    assert.ok(ctx.__restorePointRows.has('pre-import-indexeddb'),
        '含本地 Blob 的数据库恢复点必须继续保留');
    assert.ok(ctx.__intercepted.toasts.some(item =>
        /部分回滚未能确认/.test(item.msg)
        && /maomao-media-store/.test(item.msg)
        && /请勿清理网站数据/.test(item.msg)
    ));
    assert.equal(ctx.__intercepted.reloads, 0);
});
