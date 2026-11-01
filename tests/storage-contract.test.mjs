import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

// ---------------------------------------------------------------------------
// 沙箱环境：伪造浏览器全局，让源码里的 window.PhoneStorage / localStorage /
// indexedDB / Blob / FileReader / crypto / URL / atob / document 等不抛错。
// 每个 test 用 freshSandbox() 拿到全新 mock，避免前一个 test 的 localStorage
// 状态污染后一个。
// ---------------------------------------------------------------------------

function makeLocalStorage(state = {}) {
    // localStorage 必须是 host object 风格：用 prototype 上挂方法
    const store = Object.create(null);
    Object.assign(store, state);
    return {
        _store: store,
        _keysForOrder: Object.keys(state),
        get length() { return this._keysForOrder.length; },
        key(i) { return this._keysForOrder[i] != null ? this._keysForOrder[i] : null; },
        getItem(k) {
            if (k == null) return null;
            return Object.prototype.hasOwnProperty.call(this._store, k)
                ? String(this._store[k]) : null;
        },
        setItem(k, v) {
            if (k == null) throw new Error('localStorage: key is null');
            const sv = String(v);
            this._store[k] = sv;
            if (!this._keysForOrder.includes(k)) this._keysForOrder.push(k);
        },
        removeItem(k) {
            delete this._store[k];
            const idx = this._keysForOrder.indexOf(k);
            if (idx !== -1) this._keysForOrder.splice(idx, 1);
        },
        clear() {
            for (const k of this._keysForOrder.slice()) delete this._store[k];
            this._keysForOrder.length = 0;
        }
    };
}

function freshSandbox() {
    const localStorage = makeLocalStorage();
    const window = {
        localStorage,
        indexedDB: undefined,                // media-repository 的 _openDB 会 reject，方便测 NOT_FOUND/VALIDATION_FAILED 前置分支
        crypto: undefined,
        Blob: function () { this.size = 0; this.type = ''; },
        FileReader: function () {
            // 空壳：_hashBlob / _coerceToBlob 会因 crypto 缺失提前 reject，不会走到 FileReader
            this.readAsArrayBuffer = function () { this.onerror && this.onerror(new Error('stub')); };
            this.readAsDataURL = function () { this.onerror && this.onerror(new Error('stub')); };
        },
        URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
        atob() { throw new Error('atob not available'); },
        document: {},
        alert() {},
        setTimeout() {}
    };
    // 让源码里 `(function(global){ ... })(window)` 里的 global === window
    // 同时源码里直接用 window 的地方也能工作
    return { window, context: window, localStorage };
}

// 统一装载：先 phone_storage.js（PhoneStorage + PhoneStorage.result），
// 再 repository.js（PhoneStorage.Repository 基类），
// 最后 media-repository.js（PhoneStorage.MediaRepository）。
// 备份脚本 backup.js 不加载——它完全闭包，没有对外导出任何函数。
const PHONE_STORAGE_SRC = read('shared/js/phone/phone_storage.js');
const REPOSITORY_BASE_SRC = read('shared/js/phone/storage/repository.js');
const MEDIA_REPO_SRC = read('shared/js/phone/storage/media-repository.js');

function loadPhoneStorage(sandbox) {
    runInNewContext(PHONE_STORAGE_SRC, { window: sandbox.context });
    return sandbox.context.PhoneStorage;
}

function loadRepositoryBase(sandbox) {
    runInNewContext(REPOSITORY_BASE_SRC, { window: sandbox.context });
    return sandbox.context.PhoneStorage;
}

function loadMediaRepository(sandbox) {
    runInNewContext(MEDIA_REPO_SRC, { window: sandbox.context });
    return sandbox.context.PhoneStorage;
}

// ===========================================================================
// 探测先声（不作为 test 断言，而是作为加载时的 guard）
// ===========================================================================

// 1. backup.js 全闭包探测
const backupSrc = read('settings/js/backup.js');
const backupExportsFound = /window\.[A-Za-z_][\w\.]*\s*=/.test(backupSrc)
    || /global\.[A-Za-z_][\w\.]*\s*=/.test(backupSrc)
    || /module\.exports/.test(backupSrc)
    || /\bexport\s+(default|const|function|let|var)/.test(backupSrc);
// backup.js 里确实还有 var 但那是 IIFE 内部，不对外。Grep 搜索过，零命中真正导出赋值。

// ===========================================================================
// A 组：PhoneStorage.result 读路径三态
// ===========================================================================

test('PhoneStorage.result.rawGet: 读不到 key → NOT_FOUND，ok=false，error.retryable=false', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    const r = PS.result.rawGet('never_seen_key');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, PS.result.ERR.NOT_FOUND);
    assert.equal(r.error.retryable, false);
    assert.equal(r.meta, undefined);
});

test('PhoneStorage.result.rawGet: 合法 JSON 成功 → ok=true，value 为解析后对象，meta 带 found/source', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    sandbox.localStorage.setItem('k', JSON.stringify([1, 2, 3]));
    const r = PS.result.rawGet('k');
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, [1, 2, 3]);
    assert.equal(r.meta.found, true);
    assert.equal(r.meta.source, 'k');
});

test('PhoneStorage.result.rawGet: 合法 JSON 但形状与 expectedShape 不符 → CORRUPT_DATA，meta.raw 带原始串', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    sandbox.localStorage.setItem('k', JSON.stringify({ a: 1 }));
    const r = PS.result.rawGet('k', 'array');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, PS.result.ERR.CORRUPT_DATA);
    assert.equal(r.meta.raw, sandbox.localStorage.getItem('k'));
    assert.match(r.error.message, /expected array/);
});

test('PhoneStorage.result.rawGet: 非法 JSON → CORRUPT_DATA，meta.raw 就是损坏字符串', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    sandbox.localStorage.setItem('k', '}{not-json');
    const r = PS.result.rawGet('k');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, PS.result.ERR.CORRUPT_DATA);
    assert.equal(r.meta.raw, '}{not-json');
    assert.equal(r.error.retryable, false);
});

test('PhoneStorage.result.rawGet: expectedShape=object，值是数组 → CORRUPT_DATA（数组不是 object 形状）', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    sandbox.localStorage.setItem('k', JSON.stringify([1, 2]));
    const r = PS.result.rawGet('k', 'object');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, PS.result.ERR.CORRUPT_DATA);
    assert.equal(r.meta.raw, sandbox.localStorage.getItem('k'));
});

test('PhoneStorage.result.ERR: 错误码枚举包含全部契约值', () => {
    const sandbox = freshSandbox();
    const PS = loadPhoneStorage(sandbox);
    assert.equal(PS.result.ERR.NOT_FOUND, 'NOT_FOUND');
    assert.equal(PS.result.ERR.CORRUPT_DATA, 'CORRUPT_DATA');
    assert.equal(PS.result.ERR.QUOTA_EXCEEDED, 'QUOTA_EXCEEDED');
    assert.equal(PS.result.ERR.DB_UNAVAILABLE, 'DB_UNAVAILABLE');
    assert.equal(PS.result.ERR.CONFLICT, 'CONFLICT');
    assert.equal(PS.result.ERR.VALIDATION_FAILED, 'VALIDATION_FAILED');
});

// ===========================================================================
// E 组：PhoneStorage.Repository 基类（注入 mock storage）
// ===========================================================================

function makeMockStorage(records, behavior = {}) {
    // records: { keyName: <array | null> }，null 代表 NOT_FOUND
    // behavior.write 可以被外部替换来模拟失败
    let data = {};
    for (const k of Object.keys(records)) {
        data[k] = records[k] == null ? null : JSON.parse(JSON.stringify(records[k]));
    }
    return {
        rawGet(key, expectedShape) {
            if (data[key] == null) return { ok: false, error: { code: 'NOT_FOUND', message: 'nope', retryable: false } };
            let v = data[key];
            if (expectedShape === 'array' && !Array.isArray(v)) {
                return { ok: false, error: { code: 'CORRUPT_DATA', message: 'bad', retryable: false },
                    meta: { raw: JSON.stringify(v) } };
            }
            return { ok: true, value: v, meta: { found: true, source: key } };
        },
        rawSet(key, value) {
            if (behavior.failNextWrite) { behavior.failNextWrite = false; return { ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'full', retryable: false } }; }
            data[key] = JSON.parse(JSON.stringify(value));
            return { ok: true, value: true, meta: { written: key } };
        },
        rawRemove(key) {
            data[key] = null;
            return { ok: true, value: true, meta: { removed: key } };
        },
        _dataForTest: () => data
    };
}

test('Repository: 缺少 key 选项 → 构造时直接抛 Error', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    assert.throws(() => new Repository({}), /key is required/);
});

test('Repository.save: null / 非对象 entity → VALIDATION_FAILED', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [] }) });
    const r = repo.save(null);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    const r2 = repo.save('string instead');
    assert.equal(r2.ok, false);
    assert.equal(r2.error.code, 'VALIDATION_FAILED');
});

test('Repository.save: entity 缺少 idField → VALIDATION_FAILED（用默认 id 字段名）', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [] }) });
    const r = repo.save({ name: 'no id here' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.match(r.error.message, /entity\.id is required/);
});

test('Repository.save: 新实体自动补全 createdAt/updatedAt/revision/schemaVersion，meta.isNew=true', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const storage = makeMockStorage({ k: [] });
    const repo = new Repository({ key: 'k', schemaVersion: 3, storage });
    const r = repo.save({ id: 'a', name: 'Alice' });
    assert.equal(r.ok, true);
    assert.equal(r.value.id, 'a');
    assert.equal(r.value.name, 'Alice');
    assert.equal(typeof r.value.createdAt, 'number');
    assert.equal(typeof r.value.updatedAt, 'number');
    assert.equal(r.value.revision, 1);
    assert.equal(r.value.schemaVersion, 3);
    assert.equal(r.meta.isNew, true);
    // 确认真的进了 storage
    const got = storage._dataForTest().k;
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 'a');
});

test('Repository.save: 已有同 id 实体 → revision 自增、createdAt 保留旧值、meta.isNew=false', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', name: 'old', createdAt: 100, updatedAt: 100, revision: 5, schemaVersion: 3 }];
    const storage = makeMockStorage({ k: existing });
    const repo = new Repository({ key: 'k', schemaVersion: 3, storage });
    const r = repo.save({ id: 'a', name: 'new' });
    assert.equal(r.ok, true);
    assert.equal(r.meta.isNew, false);
    assert.equal(r.value.name, 'new');
    assert.equal(r.value.revision, 6);
    assert.equal(r.value.createdAt, 100);   // 保留旧 createdAt
    assert.ok(r.value.updatedAt >= 100);
});

test('Repository.save: expectedRevision 与实际不符 → CONFLICT，meta 带 actualRevision', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', name: 'x', revision: 5 }];
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: existing }) });
    const r = repo.save({ id: 'a', name: 'y' }, 7);  // 期望 7 实际 5
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'CONFLICT');
    assert.equal(r.meta.actualRevision, 5);
});

test('Repository.save: expectedRevision 匹配 → 正常写入', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', revision: 5 }];
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: existing }) });
    const r = repo.save({ id: 'a', revision: 5 }, 5);
    assert.equal(r.ok, true);
    assert.equal(r.value.revision, 6);
});

test('Repository.get: 存在 id → ok=true；不存在 → NOT_FOUND', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [{ id: 'a', n: 1 }] }) });
    const hit = repo.get('a');
    assert.equal(hit.ok, true);
    assert.equal(hit.value.n, 1);
    const miss = repo.get('x');
    assert.equal(miss.ok, false);
    assert.equal(miss.error.code, 'NOT_FOUND');
    assert.equal(miss.meta.domain, 'k');
});

test('Repository.list: 空域 → ok=true 且 value 是空数组（不是 NOT_FOUND）', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: null }) });
    const r = repo.list();
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, []);
    assert.equal(r.meta.found, false);
});

test('Repository.remove: 找不到 id → NOT_FOUND；找到 → ok=true', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [{ id: 'a' }] }) });
    const miss = repo.remove('x');
    assert.equal(miss.ok, false);
    assert.equal(miss.error.code, 'NOT_FOUND');
    const hit = repo.remove('a');
    assert.equal(hit.ok, true);
});

test('Repository.update: 乐观锁冲突 → CONFLICT；正常 patch 合并', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const storage = makeMockStorage({ k: [{ id: 'a', name: 'A', age: 20, revision: 3, createdAt: 1 }] });
    const repo = new Repository({ key: 'k', storage });
    const conflict = repo.update('a', { name: 'B' }, 99);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, 'CONFLICT');
    const ok = repo.update('a', { age: 21 });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.name, 'A');       // 原字段保留
    assert.equal(ok.value.age, 21);          // patch 字段合并
    assert.equal(ok.value.revision, 4);       // revision 自增
    assert.equal(ok.value.createdAt, 1);      // 旧 createdAt 保留
});

test('Repository.import: 纯数组 overwrite=true → 全量替换', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const storage = makeMockStorage({ k: [{ id: 'a' }] });
    const repo = new Repository({ key: 'k', storage });
    const r = repo.import([{ id: 'b' }, { id: 'c' }], true);
    assert.equal(r.ok, true);
    assert.equal(r.value.overwrite, true);
    assert.equal(storage._dataForTest().k.length, 2);
    assert.equal(storage._dataForTest().k[0].id, 'b');
});

test('Repository.import: 纯数组 overwrite=false → 同 id 覆盖、无同 id 追加', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const storage = makeMockStorage({ k: [{ id: 'a', name: 'old' }] });
    const repo = new Repository({ key: 'k', storage });
    const r = repo.import([{ id: 'a', name: 'new' }, { id: 'b' }], false);
    assert.equal(r.ok, true);
    const arr = storage._dataForTest().k;
    assert.equal(arr.length, 2);
    // 同 id 的 a 应该被覆盖
    const a = arr.find(e => e.id === 'a');
    assert.equal(a.name, 'new');
});

test('Repository.import: 传入非法数据形状 → VALIDATION_FAILED', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [] }) });
    assert.equal(repo.import(null).error.code, 'VALIDATION_FAILED');
    assert.equal(repo.import('abc').error.code, 'VALIDATION_FAILED');
    assert.equal(repo.import({ foo: 'bar' }).error.code, 'VALIDATION_FAILED');
});

test('Repository.clearScope: 调用 storage.rawRemove → meta 带 removed 标记', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: [{ id: 'a' }] }) });
    const r = repo.clearScope();
    assert.equal(r.ok, true);
    assert.equal(r.meta.removed, 'k');
});

// ===========================================================================
// F 组：MediaRepository 参数校验（所有不依赖 IndexedDB / crypto 的早期 return 分支）
// ===========================================================================

test('MediaRepository.putBlob: input 为空 → VALIDATION_FAILED，retryable=false', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    const r = await mr.putBlob(null, { ownerType: 'character', ownerId: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.equal(r.error.retryable, false);
});

test('MediaRepository.putBlob: 缺少 ownerType / ownerId → VALIDATION_FAILED', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    const r = await mr.putBlob(new Blob(['hi']), {});
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.match(r.error.message, /ownerType and ownerId are required/);
});

test('MediaRepository.putBlob: 合法参数但环境无 crypto.subtle → VALIDATION_FAILED（明确提示）', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    // freshSandbox 默认 crypto 为 undefined
    const r = await mr.putBlob(new Blob(['x']), { ownerType: 'c', ownerId: '1' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.match(r.error.message, /crypto\.subtle\.digest is unavailable/);
    assert.ok(r.error.hint);
});

test('MediaRepository.getAsset: assetId 为空 → VALIDATION_FAILED', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    const r = await mr.getAsset('');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'VALIDATION_FAILED');
    assert.match(r.error.message, /assetId is required/);
});

test('MediaRepository.getAsset: assetId 格式无效 → VALIDATION_FAILED，提示期望 "as_" + 32 base32', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    const badIds = [
        'plain-string',
        'as_',                   // 前缀对了但 hash 空
        'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789',  // 长度超 32
        'as_lowercaseshouldfail0123',              // 小写
        'as_AABB_XX_notbase32chars'                // 非 base32 字符
    ];
    for (const id of badIds) {
        const r = await mr.getAsset(id);
        assert.equal(r.ok, false, id);
        assert.equal(r.error.code, 'VALIDATION_FAILED', id);
        assert.match(r.error.message, /assetId format invalid/, id);
    }
});

test('MediaRepository.removeAsset / addRef / removeRef / listByOwner: assetId 或 owner 缺失 → VALIDATION_FAILED', async () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadMediaRepository(sandbox);
    const { MediaRepository } = sandbox.context.PhoneStorage;
    const mr = new MediaRepository();
    const validId = 'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';  // 32 字符

    // removeAsset: 空 id / 格式错
    assert.equal((await mr.removeAsset('')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.removeAsset('bad')).error.code, 'VALIDATION_FAILED');

    // addRef: 空 id / 格式错 / owner 缺
    assert.equal((await mr.addRef('', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef('bad', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef(validId, '', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef(validId, 'c', '')).error.code, 'VALIDATION_FAILED');

    // removeRef: 同 addRef
    assert.equal((await mr.removeRef('', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.removeRef('bad', 'c', '1')).error.code, 'VALIDATION_FAILED');

    // listByOwner: ownerType / ownerId 缺失
    assert.equal((await mr.listByOwner('', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.listByOwner('c', '')).error.code, 'VALIDATION_FAILED');
});

// ===========================================================================
// B / C / D 组：backup.js 闭包函数
// ===========================================================================

// backup.js 全 IIFE 内部，零 window 赋值、零 export，
// formatToMime / carryOverSecrets / verifyRestore / IDB_TARGETS /
// dumpStore 体积跳过逻辑全都不可从外部访问。
// 这里显式标注 skip，避免永远为真的假测试。

test.skip('formatToMime: truetype→font/ttf、opentype→font/otf、woff、woff2、含 `/` 原样返回、未知→null（backup.js 全闭包，未导出）');

test.skip('carryOverSecrets 计数：备份自带密钥→跳过不计；本机没有→跳过不计；本机有且写回成功→shouldKeep/written 各 +1；写回抛异常→failed+1 且 failedKeys 记录键名（backup.js 全闭包，未导出）');

test.skip('verifyRestore: 快照全匹配→ok=true、matched=total、missing/mismatched 空数组；值不等或键缺失→结构化列出（backup.js 全闭包，未导出）');

test.skip('IDB_TARGETS 常量：应包含 maomao-media-store / maomao-font-presets / maomao-assets 等库定义与 blobMaxBytes 上限（backup.js 全闭包，未导出）');

test.skip('体积上限跳过逻辑：单条超限被跳过、总量超限后续被跳过、未超限的正常处理（backup.js dumpStore 内部闭包，未导出）');

// 最后一个 guard：backup.js 没有对外导出
test('探测：settings/js/backup.js 未对外导出任何函数/常量，全在 IIFE 闭包里', () => {
    assert.equal(backupExportsFound, false,
        'backup.js 应保持全闭包；若此断言失败说明有人加了对外赋值，需重新评估测试策略');
});
