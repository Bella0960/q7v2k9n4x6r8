import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

/* ============================================================================
 * 覆盖边界说明（2026-11-02 快照）
 *
 * 这份测试文件覆盖以下契约：
 *   - PhoneStorage.result 读路径三态（NOT_FOUND / CORRUPT_DATA / ok）、ERR 枚举
 *   - PhoneStorage.Repository 基类：构造参数校验、save（新实体/替换/乐观锁冲突）、
 *     get/list/remove/clearScope、import 的 overwrite 与 merge 两种模式
 *   - PhoneStorage.MediaRepository：所有不依赖 IndexedDB / crypto.subtle 的早期
 *     参数校验分支（空值、assetId 正则、owner 缺失）
 *   - backup.js 受控导出的 formatToMime、carryOverSecrets（含四条路径与 setItem
 *     抛异常失败路径）、verifyRestore（全匹配 / 缺键 / 值不等）、IDB_TARGETS
 *     常量结构
 *   - 受控导出 guard：window.MAOMAOBackupInternals 应恰好四个键，不包含
 *     dumpStore / restoreStore 等内部实现
 *
 * 未覆盖（当前状态：未覆盖）：
 *   - backup.js::dumpStore 体积上限跳过逻辑（单条超限 / 总量超限 / Blob→base64
 *     失败计数）：原因是整个 dumpStore 函数仍在 IIFE 闭包内部、未导出。要测
 *     需要二选一：(a) 把 blobMaxBytes 比较的纯函数抽出来单独导出；
 *     (b) 构造完整的假 IndexedDB（含事务回调时序）。两条路都属于后续单独
 *     决策，不在本文件范围。
 *
 *   - 任何涉及真实 IndexedDB / crypto.subtle.digest / Blob 实例 / FileReader
 *     的读写路径（MediaRepository.putBlob/getAsset/removeAsset 的 DB 事务
 *     部分、PhoneStorage.result 的 QUOTA_EXCEEDED 捕获、backup.js 的
 *     rpWriteSnapshot / dumpDatabase / restoreDatabase）：Node 环境下无浏览器
 *     存储层，且 mock 代价过高，暂不覆盖。
 *
 *   - Repository 子类（CharacterRepository / ConversationRepository /
 *     WorldbooksRepository 等）的专属逻辑：基类的通用契约已覆盖，子类另作。
 *
 * 注意：本文件的 VM 沙箱提供了 localStorage 的可枚举键名 mock，是
 * verifyRestore 能正常工作的前提——backup.js 的 snapshot/verifyRestore 用
 * Object.keys(localStorage) 枚举键，普通 host object 风格的 mock 做不到这一点。
 * ========================================================================== */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

// ---------------------------------------------------------------------------
// 沙箱环境：伪造浏览器全局，让源码里的 window.PhoneStorage / localStorage /
// indexedDB / Blob / FileReader / crypto / URL / atob / document 等不抛错。
// 每个 test 用 freshSandbox() 拿到全新 mock，避免前一个 test 的 localStorage
// 状态污染后一个。
// ---------------------------------------------------------------------------

// 关键：backup.js 的 snapshot() / verifyRestore() 都调用 Object.keys(localStorage)
// 来枚举键名。普通的 host-object 风格 localStorage 不能被 Object.keys 正常
// 枚举，所以这里改成"普通对象 + 不可枚举方法"的组合：
//   - 键名是可枚举属性 → Object.keys(ls) 只返回键名
//   - getItem/setItem/removeItem/clear/key 是不可枚举方法
//   - length 是 getter（不可枚举）
function makeLocalStorage(state = {}) {
    const ls = Object.create(null);
    const _thrownOn = new Set();  // 累计被 throw 的键（诊断用）

    // 初始键 → 直接挂成可枚举属性
    for (const k of Object.keys(state)) {
        Object.defineProperty(ls, k, { value: String(state[k]),
            writable: true, configurable: true, enumerable: true });
    }

    // 让外部可以让 setItem 抛异常（用于 carryOverSecrets 的失败路径测试）
    // 设了之后下一次写这个 key 会 throw，只 throw 一次。
    let _nextThrowKey = null;

    const getItem = (k) => {
        if (k == null) return null;
        return Object.prototype.hasOwnProperty.call(ls, k) ? String(ls[k]) : null;
    };
    const setItem = (k, v) => {
        if (k == null) throw new Error('localStorage: key is null');
        if (_nextThrowKey === k) {
            _nextThrowKey = null;
            _thrownOn.add(k);
            const err = new Error('QuotaExceededError (test stub)');
            err.name = 'QuotaExceededError';
            throw err;
        }
        const sv = String(v);
        Object.defineProperty(ls, k, { value: sv, writable: true,
            configurable: true, enumerable: true });
    };
    const removeItem = (k) => {
        if (Object.prototype.hasOwnProperty.call(ls, k)) delete ls[k];
    };
    const clear = () => {
        for (const k of Object.keys(ls)) delete ls[k];
    };
    const key = (i) => {
        const names = Object.keys(ls);
        return i >= 0 && i < names.length ? names[i] : null;
    };
    Object.defineProperty(ls, 'length', {
        get() { return Object.keys(ls).length; },
        configurable: true, enumerable: false
    });

    for (const [name, fn] of [
        ['getItem', getItem], ['setItem', setItem],
        ['removeItem', removeItem], ['clear', clear], ['key', key]
    ]) {
        Object.defineProperty(ls, name, { value: fn, writable: false,
            configurable: false, enumerable: false });
    }

    // 测试辅助（也不可枚举）
    Object.defineProperty(ls, '_setThrowNextForTest', {
        value(k) { _nextThrowKey = k; },
        writable: false, configurable: false, enumerable: false
    });
    Object.defineProperty(ls, '_thrownOn', {
        get() { return Array.from(_thrownOn); },
        configurable: true, enumerable: false
    });

    return ls;
}

function freshSandbox() {
    // 关键设计：contextObject 同时就是 window 对象本身。
    // 源码里 (function(g){...})(window) 会把 window（= contextObject）作为参数传入，
    // 源码内部直接写 localStorage.getItem / document.getElementById / Blob / Date.now()
    // 等自由变量时，runInNewContext 的全局 Proxy 会从 contextObject 自身查找。
    // 这样一套 mock 同时满足两种引用方式。
    const localStorage = makeLocalStorage();

    const document = {
        getElementById() { return null; },
        createElement() { return { addEventListener() {}, appendChild() {}, click() {}, remove() {} }; },
        body: { appendChild() {} }
    };
    const BlobCtor = globalThis.Blob || function () { this.size = 0; this.type = ''; };
    const FileReaderCtor = function () {
        this.readAsArrayBuffer = function () { this.onerror && this.onerror(new Error('stub')); };
        this.readAsDataURL = function () { this.onerror && this.onerror(new Error('stub')); };
    };

    const ctx = {
        localStorage,
        document,
        Blob: BlobCtor,
        FileReader: FileReaderCtor,
        indexedDB: undefined,
        crypto: undefined,
        URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
        atob() { throw new Error('atob not available in sandbox'); },
        location: { reload() {} },
        alert() {},
        confirm() { return true; },
        setTimeout() {},
        clearTimeout() {},
        Date, JSON, Object, Array, String, Number, Boolean, Error,
        console
    };
    // 让源码里的 window 也指向 ctx 自身（IIFE 传参用）
    ctx.window = ctx;

    return { window: ctx, context: ctx, localStorage };
}

// 源码字符串：一次性读好，避免每个 test 都重读
const PHONE_STORAGE_SRC = read('shared/js/phone/phone_storage.js');
const REPOSITORY_BASE_SRC = read('shared/js/phone/storage/repository.js');
const MEDIA_REPO_SRC = read('shared/js/phone/storage/media-repository.js');
const BACKUP_SRC = read('settings/js/backup.js');

function loadPhoneStorage(sandbox) {
    runInNewContext(PHONE_STORAGE_SRC, sandbox.context);
    return sandbox.context.PhoneStorage;
}

function loadRepositoryBase(sandbox) {
    runInNewContext(REPOSITORY_BASE_SRC, sandbox.context);
    return sandbox.context.PhoneStorage;
}

function loadMediaRepository(sandbox) {
    runInNewContext(MEDIA_REPO_SRC, sandbox.context);
    return sandbox.context.PhoneStorage;
}

function loadBackupInternal(sandbox) {
    runInNewContext(BACKUP_SRC, sandbox.context);
    return sandbox.context.MAOMAOBackupInternals;
}

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
    // 源码语义：revision 从 0 起（entity.revision == null → 0），不是 1
    assert.equal(r.value.revision, 0, '新建实体 revision 从 0 起，非自增 1');
    assert.equal(r.value.schemaVersion, 3);
    assert.equal(r.meta.isNew, true);
    const got = storage._dataForTest().k;
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 'a');
});

test('Repository.save: 已有同 id 实体，调用方未传 revision/createdAt → 都从域里已有值继承；meta.isNew=false', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', name: 'old', createdAt: 100, updatedAt: 100, revision: 5, schemaVersion: 3 }];
    const storage = makeMockStorage({ k: existing });
    const repo = new Repository({ key: 'k', schemaVersion: 3, storage });
    // 调用方只传 name 和 id，不传 revision / createdAt
    const r = repo.save({ id: 'a', name: 'new' });
    assert.equal(r.ok, true);
    assert.equal(r.meta.isNew, false);
    assert.equal(r.value.name, 'new');
    // revision 未传 → 保留域里已有值 5（不是 0，也不是 +1 自增）
    assert.equal(r.value.revision, 5, '未传 revision → 保留域里已有值');
    // createdAt 未传 → 保留域里已有值 100
    assert.equal(r.value.createdAt, 100, '未传 createdAt → 保留域里已有值');
    // updatedAt 每次保存都刷新为 now
    assert.ok(r.value.updatedAt >= 100);
});

test('Repository.save: expectedRevision 与实际不符 → CONFLICT，meta 带 actualRevision', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', name: 'x', revision: 5 }];
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: existing }) });
    const r = repo.save({ id: 'a', name: 'y' }, 7);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'CONFLICT');
    assert.equal(r.meta.actualRevision, 5);
});

test('Repository.save: expectedRevision 匹配 → 正常写入，revision 尊重调用方显式值（不自动 +1）', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const existing = [{ id: 'a', revision: 5 }];
    const repo = new Repository({ key: 'k', storage: makeMockStorage({ k: existing }) });
    // 调用方显式传 revision=5，expectedRevision=5（乐观锁通过）
    const r = repo.save({ id: 'a', revision: 5 }, 5);
    assert.equal(r.ok, true);
    // 显式传入 revision=5 → 保留 5，不做 +1 自增
    assert.equal(r.value.revision, 5, '显式传入 revision 时尊重调用方值，不自动 +1');
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
    // 注意：strict assert 的 deepEqual 等价于 deepStrictEqual，跨 VM 上下文的空数组构造函数不同，引用不等
    assert.ok(Array.isArray(r.value));
    assert.equal(r.value.length, 0);
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

test('Repository.update: 乐观锁冲突 → CONFLICT；正常 patch 合并后 revision / createdAt 保留旧值（update 不自动 +1 也不覆盖 createdAt）', () => {
    const sandbox = freshSandbox();
    loadPhoneStorage(sandbox);
    loadRepositoryBase(sandbox);
    const { Repository } = sandbox.context.PhoneStorage;
    const storage = makeMockStorage({ k: [{ id: 'a', name: 'A', age: 20, revision: 3, createdAt: 1 }] });
    const repo = new Repository({ key: 'k', storage });
    const conflict = repo.update('a', { name: 'B' }, 99);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, 'CONFLICT');
    // 正常 patch：只改 age 一个普通字段
    const ok = repo.update('a', { age: 21 });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.name, 'A');
    assert.equal(ok.value.age, 21);
    // revision 保留旧值 3（不自动 +1）
    assert.equal(ok.value.revision, 3, 'update 后 revision 应保留旧值，不做 +1 自增');
    // createdAt 保留旧值 1（update 是局部更新，不应覆盖为 now）
    assert.equal(ok.value.createdAt, 1, 'update 后 createdAt 应保留旧值，不被覆盖');
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
// F 组：MediaRepository 参数校验（不依赖 IndexedDB / crypto 的早期 return 分支）
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
        'as_',
        'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789',
        'as_lowercaseshouldfail0123',
        'as_AABB_XX_notbase32chars'
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
    const validId = 'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    assert.equal((await mr.removeAsset('')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.removeAsset('bad')).error.code, 'VALIDATION_FAILED');

    assert.equal((await mr.addRef('', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef('bad', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef(validId, '', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.addRef(validId, 'c', '')).error.code, 'VALIDATION_FAILED');

    assert.equal((await mr.removeRef('', 'c', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.removeRef('bad', 'c', '1')).error.code, 'VALIDATION_FAILED');

    assert.equal((await mr.listByOwner('', '1')).error.code, 'VALIDATION_FAILED');
    assert.equal((await mr.listByOwner('c', '')).error.code, 'VALIDATION_FAILED');
});

// ===========================================================================
// B 组：formatToMime 真测试（受控导出）
// ===========================================================================

test('formatToMime: 字体格式映射 + 含 "/" 原样返回 + 未知/空值 → null + 大小写不敏感', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    assert.ok(bi, 'MAOMAOBackupInternals 应存在');
    const f = bi.formatToMime;
    assert.equal(typeof f, 'function');

    const cases = [
        ['truetype', 'font/ttf'],
        ['TTF',       'font/ttf'],
        ['opentype',  'font/otf'],
        ['OTF',       'font/otf'],
        ['woff',      'font/woff'],
        ['WOFF',      'font/woff'],
        ['woff2',     'font/woff2'],
        ['Woff2',     'font/woff2'],
        ['image/png', 'image/png'],     // 含 "/"，原样返回
        ['FONT/OTF',  'font/otf'],      // 含 "/"，原样返回；但实现里先检查 "/" 再小写，这里应该原样返回 FONT/OTF
        ['', null],                      // 空字符串 → null
        [null, null],
        [undefined, null],
        ['unknown-format-xyz', null],
        ['mp3', null],
        ['jpeg', null]
    ];

    // 注意：backup.js 的 formatToMime 里先做 "/" 检查再转小写，
    // 所以含 "/" 的值是原样返回、不做 lowercasing。单独验证这一点：
    assert.equal(f('FONT/OTF'), 'FONT/OTF');       // 含 "/" → 原样返回，不 lower
    assert.equal(f('image/png'), 'image/png');
    assert.equal(f('APPLICATION/OCTET-STREAM'), 'APPLICATION/OCTET-STREAM');

    // 不含 "/" 的 case：
    const plainCases = [
        ['truetype', 'font/ttf'],
        ['TTF',      'font/ttf'],
        ['opentype', 'font/otf'],
        ['OTF',      'font/otf'],
        ['woff',     'font/woff'],
        ['WOFF',     'font/woff'],
        ['woff2',    'font/woff2'],
        ['Woff2',    'font/woff2'],
        ['', null],
        [null, null],
        [undefined, null],
        ['unknown-format-xyz', null],
        ['mp3', null],
        ['jpeg', null]
    ];
    for (const [input, expected] of plainCases) {
        assert.equal(f(input), expected, `formatToMime(${JSON.stringify(input)})`);
    }
});

// ===========================================================================
// C 组：carryOverSecrets 真测试（四条路径 + P0-1 核心修复 + 失败路径）
// ===========================================================================

test('carryOverSecrets 四条路径：备份自带→跳过；快照没有→跳过；成功→shouldKeep/written+1；写回失败→failed+1 且 failedKeys 记键名', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const fn = bi.carryOverSecrets;
    assert.equal(typeof fn, 'function');

    // SECRET_KEYS 在 backup.js 闭包里，我们不知道具体值；可以从测试间接推断：
    // 但更稳妥的做法是用三个都在 SECRET_KEYS 里的已知键来组合测试：
    // backup.js 源码里 SECRET_KEYS = ['api_settings', 'api_profiles_v1', 'minimax_tts_config']
    // 我们只在测试里引用这些字符串，源码里硬编码是公开事实。
    const K1 = 'api_settings';
    const K2 = 'api_profiles_v1';
    const K3 = 'minimax_tts_config';

    // ---- 场景 a + b 混合 ----
    // incoming 自带 K1 → 跳过
    // beforeSnap 没有 K2 → 跳过
    // K3 在 beforeSnap 里有，且 localStorage.setItem 会成功 → shouldKeep + written 各 +1
    const result = fn(
        { [K1]: 'from-backup' },                                    // incoming：有 K1
        { [K3]: 'REAL_VALUE_FROM_SNAPSHOT' }                        // beforeSnap：只有 K3，没有 K2
    );

    assert.equal(result.shouldKeep, 1, 'K3 应计入 shouldKeep');
    assert.equal(result.written, 1, 'K3 写回成功应计入 written');
    assert.equal(result.failed, 0);
    // 跨 VM 上下文数组构造函数不同，deepEqual 会判引用不等
    assert.ok(Array.isArray(result.failedKeys));
    assert.equal(result.failedKeys.length, 0);

    // ---- 场景 c：K3 应被写进 localStorage，且值来自 beforeSnap 而非 localStorage 旧值 ----
    // 调用前 localStorage 里是空的（freshSandbox），所以 K3 现在应该出现
    assert.equal(sandbox.localStorage.getItem(K3), 'REAL_VALUE_FROM_SNAPSHOT',
        'K3 的值应来自 beforeSnap，而非 localStorage 旧值');
});

test('carryOverSecrets P0-1 核心修复：写回值来自 beforeSnap 参数，不读取 localStorage 旧值', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const fn = bi.carryOverSecrets;

    const K = 'api_settings';

    // 关键：localStorage 里放一个完全不同的值
    sandbox.localStorage.setItem(K, 'STALE_VALUE_ALREADY_IN_LOCALSTORAGE');

    // beforeSnap 里放另一个值
    const incoming = {};  // 备份里没有 K
    const beforeSnap = { [K]: 'THE_REAL_SECRET_FROM_SNAPSHOT' };

    fn(incoming, beforeSnap);

    // 断言 localStorage 里现在是 beforeSnap 的值，而不是旧值
    assert.equal(sandbox.localStorage.getItem(K), 'THE_REAL_SECRET_FROM_SNAPSHOT',
        'carryOverSecrets 应从 beforeSnap 参数取值写回，不应读 localStorage 旧值');
});

test('carryOverSecrets 写回抛异常：failed+1，failedKeys 记录键名，其他 secret 不受影响', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const fn = bi.carryOverSecrets;

    const K_OK = 'api_profiles_v1';
    const K_FAIL = 'minimax_tts_config';

    // 让 setItem 在写 K_FAIL 时 throw（只 throw 一次）
    sandbox.localStorage._setThrowNextForTest(K_FAIL);

    const result = fn(
        {},                                                    // incoming 空
        { [K_OK]: 'ok-val', [K_FAIL]: 'fail-val' }            // beforeSnap 有两个
    );

    // K_FAIL 抛异常：shouldKeep+1（因为它确实存在）、failed+1、written 只算 K_OK
    assert.equal(result.shouldKeep, 2, 'K_OK 与 K_FAIL 都应计入 shouldKeep');
    assert.equal(result.written, 1, '只有 K_OK 写回成功');
    assert.equal(result.failed, 1, 'K_FAIL 抛异常应计入 failed');
    assert.ok(Array.isArray(result.failedKeys));
    assert.equal(result.failedKeys.length, 1);
    assert.equal(result.failedKeys[0], K_FAIL);

    // K_OK 确实被写进了 localStorage
    assert.equal(sandbox.localStorage.getItem(K_OK), 'ok-val');
    // K_FAIL 没被写进去
    assert.equal(sandbox.localStorage.getItem(K_FAIL), null);
});

test('carryOverSecrets 额外边界：beforeSnap 为 null / K 值为 null 都跳过不计入', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const fn = bi.carryOverSecrets;

    // beforeSnap 整体为 null
    let r = fn({}, null);
    assert.equal(r.shouldKeep, 0);
    assert.equal(r.written, 0);
    assert.equal(r.failed, 0);
    assert.equal(r.failedKeys.length, 0);

    // beforeSnap 整体为 undefined
    r = fn({}, undefined);
    assert.equal(r.shouldKeep, 0);
    assert.equal(r.written, 0);
    assert.equal(r.failed, 0);
    assert.equal(r.failedKeys.length, 0);

    // K 在 beforeSnap 里但值是 null / undefined
    // 我们不能确定 SECRET_KEYS 全部，但至少有 api_settings
    const resultNull = fn({}, { api_settings: null });
    assert.equal(resultNull.shouldKeep, 0);
    assert.equal(resultNull.written, 0);
    assert.equal(resultNull.failed, 0);

    const resultUndef = fn({}, { api_settings: undefined });
    assert.equal(resultUndef.shouldKeep, 0);
    assert.equal(resultUndef.written, 0);
    assert.equal(resultUndef.failed, 0);
});

// ===========================================================================
// verifyRestore 真测试
// ===========================================================================

test('verifyRestore 全匹配：ok=true，matched=total，missing/mismatched 均为空数组', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const fn = bi.verifyRestore;
    assert.equal(typeof fn, 'function');

    const snap = { a: '1', b: '2', c: '3' };
    // 先把 localStorage 状态设好（makeLocalStorage 的初始状态构造器直接挂可枚举属性）
    // freshSandbox 返回的 localStorage 是 makeLocalStorage() 无参数创建的，用 setItem 写入
    sandbox.localStorage.setItem('a', '1');
    sandbox.localStorage.setItem('b', '2');
    sandbox.localStorage.setItem('c', '3');

    const r = fn(snap);
    assert.equal(r.ok, true);
    assert.equal(r.total, 3);
    assert.equal(r.matched, 3);
    assert.ok(Array.isArray(r.missing));
    assert.equal(r.missing.length, 0);
    assert.ok(Array.isArray(r.mismatched));
    assert.equal(r.mismatched.length, 0);
});

test('verifyRestore：snap 有键但 localStorage 缺键 → missing 数组列出', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const snap = { a: '1', b: '2', c: '3' };
    sandbox.localStorage.setItem('a', '1');
    sandbox.localStorage.setItem('b', '2');
    // c 故意不写

    const r = bi.verifyRestore(snap);
    assert.equal(r.ok, false);
    assert.equal(r.total, 3);
    assert.equal(r.matched, 2);
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0], 'c');
    assert.equal(r.mismatched.length, 0);
});

test('verifyRestore：snap 与 localStorage 值不等 → mismatched 数组列出', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const snap = { a: '1', b: 'expected', c: '3' };
    sandbox.localStorage.setItem('a', '1');
    sandbox.localStorage.setItem('b', 'actual-mismatch');
    sandbox.localStorage.setItem('c', '3');

    const r = bi.verifyRestore(snap);
    assert.equal(r.ok, false);
    assert.equal(r.total, 3);
    assert.equal(r.matched, 2);
    assert.equal(r.missing.length, 0);
    assert.equal(r.mismatched.length, 1);
    assert.equal(r.mismatched[0], 'b');
});

test('verifyRestore：snap 为空对象 → ok=true 且 matched=0', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    // localStorage 有一堆东西，但 snap 空
    sandbox.localStorage.setItem('foo', 'bar');
    sandbox.localStorage.setItem('baz', 'qux');
    const r = bi.verifyRestore({});
    assert.equal(r.ok, true);
    assert.equal(r.total, 0);
    assert.equal(r.matched, 0);
    assert.equal(r.missing.length, 0);
    assert.equal(r.mismatched.length, 0);
});

// ===========================================================================
// IDB_TARGETS 常量真测试
// ===========================================================================

test('IDB_TARGETS 常量非空、是数组、包含预期的库定义与 store 结构', () => {
    const sandbox = freshSandbox();
    const bi = loadBackupInternal(sandbox);
    const targets = bi.IDB_TARGETS;

    assert.ok(Array.isArray(targets), 'IDB_TARGETS 应是数组');
    assert.ok(targets.length > 0, 'IDB_TARGETS 不应为空');

    // backup.js 源码里硬编码的五个库名
    const dbNames = new Set(targets.map(t => t.db));
    const expectedDbs = [
        'maomao-media-store',
        'maomao_diary_photo_store_v1',
        'maomao-reading-library',
        'maomao-font-presets',
        'maomao-assets'
    ];
    for (const expected of expectedDbs) {
        assert.ok(dbNames.has(expected),
            `IDB_TARGETS 缺少预期的 db: ${expected}`);
    }

    // 每个条目都应带 version 与 stores（数组）
    for (const t of targets) {
        assert.equal(typeof t.db, 'string');
        assert.equal(typeof t.version, 'number');
        assert.ok(Array.isArray(t.stores), `db ${t.db} 的 stores 应为数组`);
        for (const s of t.stores) {
            assert.equal(typeof s.store, 'string');
        }
    }

    // 含 blobFields 的 store（maomao-font-presets.presets、maomao-assets.blobs）
    const blobStores = [];
    targets.forEach(t => {
        (t.stores || []).forEach(s => {
            if (s.blobFields && s.blobFields.length) {
                blobStores.push(t.db + '.' + s.store);
                assert.equal(typeof s.blobMaxBytes, 'number',
                    `${t.db}.${s.store} 有 blobFields 时应同时声明 blobMaxBytes`);
                assert.equal(typeof s.blobStoreMaxBytes, 'number',
                    `${t.db}.${s.store} 有 blobFields 时应同时声明 blobStoreMaxBytes`);
            }
        });
    });
    assert.ok(blobStores.includes('maomao-font-presets.presets'),
        'maomao-font-presets.presets 应带 blobFields');
    assert.ok(blobStores.includes('maomao-assets.blobs'),
        'maomao-assets.blobs 应带 blobFields');

    // maomao-assets.blobs 应带 attachFrom
    const maomaoAssets = targets.find(t => t.db === 'maomao-assets');
    assert.ok(maomaoAssets, '应有 maomao-assets 条目');
    const blobsDef = maomaoAssets.stores.find(s => s.store === 'blobs');
    assert.ok(blobsDef.attachFrom && blobsDef.attachFrom.store === 'assets',
        'maomao-assets.blobs 应声明 attachFrom.store = assets');
});

// ===========================================================================
// 受控导出 guard：MAOMAOBackupInternals 应恰好四个键，且不包含内部实现
// ===========================================================================

test('受控导出 guard：window.MAOMAOBackupInternals 存在、恰好含四个键、不包含 dumpStore/restoreStore/blobToBase64', () => {
    const sandbox = freshSandbox();
    runInNewContext(BACKUP_SRC, sandbox.context);
    const bi = sandbox.context.MAOMAOBackupInternals;

    assert.ok(bi, 'window.MAOMAOBackupInternals 应存在');
    assert.equal(typeof bi, 'object');

    const keys = Object.keys(bi).sort();
    assert.deepEqual(keys, [
        'IDB_TARGETS',
        'carryOverSecrets',
        'formatToMime',
        'verifyRestore'
    ], '受控导出应恰好这四个标识符，按字母序排列');

    // 关键：这些内部实现**不能**被顺手暴露
    const forbidden = [
        'dumpStore', 'restoreStore', 'restoreDatabase', 'dumpDatabase',
        'blobToBase64', 'base64ToBlob', 'snapshot', 'validateBackup', 'restore',
        'downloadSnapshot', 'stringifyIndexedDB', 'doExport', 'handleImportFile'
    ];
    for (const name of forbidden) {
        assert.equal(name in bi, false,
            `受控导出不应包含内部实现 ${name}——如需公开请显式加入导出列表`);
    }
});


