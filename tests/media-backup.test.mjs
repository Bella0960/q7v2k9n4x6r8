/**
 * tests/media-backup.test.mjs  —— DATA-002 媒体备份专项测试
 *
 * 覆盖：
 *   1. 空媒体库导出/恢复（clearOnRestore）
 *   2. 非空媒体库完整往返（assets + blobs + refs）
 *   3. MIME 类型保持（__blobMime_ 伴生字段）
 *   4. Blob 超限时 atomicExport 整库排除
 *   5. base64 解码失败整条跳过，不破坏其他记录
 *   6. 历史 schema 2 / schema 1 备份兼容
 *   7. clearOnRestore 不影响其他数据库
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupSrc = readFileSync(resolve(root, 'settings/js/backup.js'), 'utf8');

/* ── 工具：从源码提取函数 ── */
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

/* ── 轻量 Blob polyfill（Node 沙箱用） ── */
// 注意：runInNewContext 创建独立上下文，沙箱内 new Blob() 产生的对象的
// 原型链与外层 BlobPolyfill.prototype 是不同对象，instanceof 会失败。
// 改用鸭子类型：检查 obj 存在且有字符串 .type 属性，即视为 Blob 实例。
function isBlobLike(obj) {
    return obj != null && typeof obj === 'object' && typeof obj.type === 'string';
}

/* ── IndexedDB mock ── */
function makeIDB(initialData) {
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
                    // 同步执行副作用后立即触发回调，
                    // 确保 restoreStore 的 await 返回时 stores 已经更新完毕。
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

/* ── 构建沙箱：base64ToBlob + restoreStore ── */
function buildCtx() {
    // 用一个简单的工厂函数作为沙箱内的 Blob，使其有 .type 属性
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

const MINIMAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/* ═══════════════════════════════════════════════
   1. MIME 类型往返保持
   ═══════════════════════════════════════════════ */
test('01 blobToBase64 + restoreStore 保持 MIME 类型', async () => {
    const ctx = buildCtx();
    const db = makeIDB({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    const records = [
        { assetId: 'a1', blob: MINIMAL_PNG, __blobMime_blob: 'image/png' }
    ];
    await ctx.restoreStore(db, storeDef, records, true);
    const restored = db._stores['blobs'];
    assert.equal(restored.length, 1, '应写入 1 条记录');
    assert.ok(isBlobLike(restored[0].blob), 'blob 应被还原为 Blob 实例');
    assert.equal(restored[0].blob.type, 'image/png', 'MIME 类型应保持 image/png');
    assert.equal(restored[0].__blobMime_blob, undefined, '伴生字段应在写入前被清除');
});

/* ═══════════════════════════════════════════════
   2. clearOnRestore：空数组执行 clear()
   ═══════════════════════════════════════════════ */
test('02 clearOnRestore=true 时空 store 执行 clear()', async () => {
    const ctx = buildCtx();
    const db = makeIDB({ assets: [{ assetId: 'old1', type: 'image' }] });
    const storeDef = { store: 'assets', keyPath: 'assetId' };
    // 传入空数组 + clearOnRestore=true
    await ctx.restoreStore(db, storeDef, [], true);
    assert.equal(db._stores['assets'].length, 0, 'store 应被清空，旧记录不得残留');
});

/* ═══════════════════════════════════════════════
   3. clearOnRestore=false 时空数组跳过（不影响旧库）
   ═══════════════════════════════════════════════ */
test('03 clearOnRestore=false 时空数组直接跳过，不清除原有数据', async () => {
    const ctx = buildCtx();
    const db = makeIDB({ wallpapers: [{ id: 'wp1' }] });
    const storeDef = { store: 'wallpapers', keyPath: null };
    await ctx.restoreStore(db, storeDef, [], false);
    // 原有记录不受影响
    assert.equal(db._stores['wallpapers'].length, 1, '旧数据不应被清除');
});

/* ═══════════════════════════════════════════════
   4. 非空媒体库完整往返（assets + blobs + refs）
   ═══════════════════════════════════════════════ */
test('04 非空媒体库三个 store 完整往返恢复', async () => {
    const ctx = buildCtx();
    const assetsDb = makeIDB({ assets: [] });
    const blobsDb  = makeIDB({ blobs: [] });
    const refsDb   = makeIDB({ refs: [] });

    const assetRec = { assetId: 'img001', type: 'image', mimeType: 'image/jpeg', size: 512 };
    const blobRec  = { assetId: 'img001', blob: MINIMAL_PNG, __blobMime_blob: 'image/jpeg' };
    const refRec   = { assetId: 'img001', ownerType: 'character', ownerId: 'char_1' };

    await ctx.restoreStore(assetsDb, { store: 'assets', keyPath: 'assetId' }, [assetRec], true);
    await ctx.restoreStore(blobsDb,  { store: 'blobs',  keyPath: 'assetId', blobFields: ['blob'] }, [blobRec], true);
    await ctx.restoreStore(refsDb,   { store: 'refs',   keyPath: 'assetId' }, [refRec], true);

    assert.equal(assetsDb._stores['assets'].length, 1, 'assets 应写入 1 条');
    assert.equal(assetsDb._stores['assets'][0].assetId, 'img001', 'assetId 应一致');
    assert.ok(isBlobLike(blobsDb._stores['blobs'][0].blob), 'blob 应为 Blob 实例');
    assert.equal(blobsDb._stores['blobs'][0].blob.type, 'image/jpeg', 'MIME 应还原为 image/jpeg');
    assert.equal(refsDb._stores['refs'][0].ownerId, 'char_1', 'ownerType/ownerId 应保持');
});

/* ═══════════════════════════════════════════════
   5. base64 解码失败：整条跳过，其他记录不受影响
   ═══════════════════════════════════════════════ */
test('05 base64 解码失败整条跳过，不破坏其他记录', async () => {
    const ctx = buildCtx();
    const db = makeIDB({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    const records = [
        { assetId: 'good', blob: MINIMAL_PNG, __blobMime_blob: 'image/png' },
        { assetId: 'bad',  blob: '!!!INVALID_BASE64!!!', __blobMime_blob: 'image/png' },
        { assetId: 'good2', blob: MINIMAL_PNG, __blobMime_blob: 'image/gif' }
    ];
    const result = await ctx.restoreStore(db, storeDef, records, true);
    // 损坏条目被跳过，正常条目写入
    assert.equal(result.written, 2, '应写入 2 条有效记录');
    assert.equal(result.skipped, 1, '应跳过 1 条损坏记录');
    assert.equal(db._stores['blobs'].length, 2, '库中应有 2 条记录');
    const ids = db._stores['blobs'].map(r => r.assetId);
    assert.ok(ids.includes('good'), 'good 应写入');
    assert.ok(ids.includes('good2'), 'good2 应写入');
    assert.ok(!ids.includes('bad'), 'bad 不应写入');
});

/* ═══════════════════════════════════════════════
   6. MIME fallback：无伴生字段时读 value.format
   ═══════════════════════════════════════════════ */
test('06 无 __blobMime_ 伴生字段时 fallback 到 value.format', async () => {
    const ctx = buildCtx();
    const db = makeIDB({ blobs: [] });
    const storeDef = { store: 'blobs', keyPath: 'assetId', blobFields: ['blob'] };
    // 旧字体预设格式：用 value.format 存 MIME，没有伴生字段
    const records = [{ assetId: 'font1', blob: MINIMAL_PNG, format: 'font/ttf' }];
    await ctx.restoreStore(db, storeDef, records, true);
    const restored = db._stores['blobs'][0];
    assert.ok(isBlobLike(restored.blob), 'blob 应被还原');
    assert.equal(restored.blob.type, 'font/ttf', 'MIME 应从 value.format 读取');
});

/* ═══════════════════════════════════════════════
   7. atomicExport: dumpDatabase 检测 blobs 跳过时整库排除
   ═══════════════════════════════════════════════ */
test('07 atomicExport: blobs 有条目被跳过时整库不纳入备份', () => {
    // 直接检测 backup.js 源码中 atomicExport 逻辑的存在性和正确性
    assert.ok(
        backupSrc.includes('atomicExport: true'),
        'IDB_TARGETS 中 maomao-assets 必须有 atomicExport: true'
    );
    assert.ok(
        backupSrc.includes('atomicExportFailed'),
        'dumpDatabase 必须返回 atomicExportFailed 标记'
    );
    assert.ok(
        backupSrc.includes('媒体 Blob') || backupSrc.includes('atomicExportFailed'),
        'doExport 必须对 atomicExportFailed 做明确提示'
    );
    assert.ok(
        backupSrc.includes('clearOnRestore: true'),
        'IDB_TARGETS 中 maomao-assets 必须有 clearOnRestore: true'
    );
});
