import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atomicSource = readFileSync(resolve(root, 'shared/js/phone/chat-history-atomic.js'), 'utf8');
const appendSource = readFileSync(resolve(root, 'shared/js/phone/chat-history-append.js'), 'utf8');

// 真实的 ChatHistoryAtomic + 真实的 ChatHistoryAppend，只把 localStorage、
// Web Locks 和 PhoneStorage 换成可观察的桩。backend 模拟「多个标签页共享同一份
// 存储与同一把锁」。
function createBackend(records) {
  return {
    records: new Map(Object.entries(records || {})),
    queues: new Map(),
    storageWrites: [],   // { roleId, list, expectedPrimary, lockHeld }
    lockCalls: [],       // { name, tab }
    deadlocks: [],
    // saveChatHistory 的「写主键 + 清理 phone_data_v2 旧副本」临界区并发深度。
    rootDepth: 0,
    rootMaxDepth: 0,
    failNextRead: null
  };
}

// legacy: { roleId: [历史消息] } → 物化成 phone_data_v2 里 { roleId: { chat: { history } } }
function seedLegacy(backend, legacy) {
  if (!legacy || backend.legacySeeded) return;
  backend.legacySeeded = true;
  const raw = backend.records.get('phone_data_v2');
  const current = raw == null ? {} : JSON.parse(raw);
  for (const [roleId, history] of Object.entries(legacy)) {
    const bucket = current[roleId] && typeof current[roleId] === 'object' ? current[roleId] : {};
    current[roleId] = { ...bucket, chat: { history } };
  }
  backend.records.set('phone_data_v2', JSON.stringify(current));
}

function tick() {
  return new Promise((done) => setTimeout(done, 1));
}

function createTab(backend, options) {
  const opts = options || {};
  const executing = new Set();
  seedLegacy(backend, opts.legacy);

  const realm = { Promise, console: { warn() {}, error() {}, log() {} } };
  realm.window = realm;
  realm.localStorage = {
    getItem: (key) => {
      // 模拟「setItem 成功、随后的读回抛异常」：写入其实已落盘。
      if (backend.failNextRead && key === backend.failNextRead) {
        backend.failNextRead = null;
        throw new Error('storage read failed after write');
      }
      return backend.records.has(key) ? backend.records.get(key) : null;
    },
    setItem: (key, value) => {
      if (opts.dropWrites) return; // 模拟存储吞掉写入
      backend.records.set(key, String(value));
    },
    removeItem: (key) => { backend.records.delete(key); }
  };
  realm.navigator = {};
  if (opts.locks !== false) {
    realm.navigator.locks = {
      request(name, _lockOptions, callback) {
        // 同一个标签页在持锁期间再次申请同名锁 = 死锁。真实 Web Locks 会挂住，
        // 这里直接抛出，让死锁表现为可断言的失败而不是测试超时。
        if (executing.has(name)) {
          backend.deadlocks.push(name);
          throw new Error('deadlock: lock re-entered in the same tab: ' + name);
        }
        backend.lockCalls.push({ name, tab: realm.__name });
        const previous = backend.queues.get(name) || Promise.resolve();
        const next = previous.then(async () => {
          executing.add(name);
          try { return await callback(); } finally { executing.delete(name); }
        });
        backend.queues.set(name, next.then(() => undefined, () => undefined));
        return next;
      }
    };
  }

  runInNewContext(atomicSource, realm);

  realm.PhoneStorage = {
    // 旧门面：损坏/不可读一律折成 []，正是本次修复要绕开的东西。
    getChatHistory(roleId) {
      const raw = backend.records.get('chat_history_' + roleId);
      if (raw != null) return JSON.parse(raw);
      return [];
    },
    result: {
      // 三态根读取：缺失 → ok({})，损坏 → CORRUPT_DATA，不可读 → DB_UNAVAILABLE。
      getRoot() {
        if (opts.getRootThrows) throw new Error('root unreadable');
        if (opts.rootUnavailable) return { ok: false, error: { code: 'DB_UNAVAILABLE' } };
        const raw = backend.records.get('phone_data_v2');
        if (raw == null) return { ok: true, value: {}, meta: { found: false } };
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) { return { ok: false, error: { code: 'CORRUPT_DATA' } }; }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, error: { code: 'CORRUPT_DATA' } };
        }
        return { ok: true, value: parsed, meta: { found: true } };
      },
      // 真实 saveChatHistory 的两段式：写主键（带 expectedPrimary），
      // 再读-改-写 phone_data_v2 删掉旧副本。这里保留同一形状，
      // 并在两段之间插入 await，模拟另一标签页在真实进程里插进来的窗口。
      async saveChatHistory(roleId, list, expectedPrimary) {
        backend.storageWrites.push({
          roleId, list, expectedPrimary,
          // 关键回归断言：创建必须发生在锁回调内部。
          lockHeld: executing.size > 0
        });
        backend.rootDepth += 1;
        backend.rootMaxDepth = Math.max(backend.rootMaxDepth, backend.rootDepth);
        try {
          if (opts.beforeSave) opts.beforeSave(roleId, backend.records);
          const key = 'chat_history_' + roleId;
          const raw = backend.records.has(key) ? backend.records.get(key) : null;
          if (expectedPrimary !== undefined && raw !== expectedPrimary) {
            return { ok: false, error: { code: 'CONFLICT' } };
          }
          if (!opts.dropWrites) backend.records.set(key, JSON.stringify(list));

          const rootRaw = backend.records.get('phone_data_v2');
          const root = rootRaw == null ? {} : JSON.parse(rootRaw);
          if (opts.rootCleanupDelay) await tick();
          const bucket = root[roleId];
          if (bucket && bucket.chat != null) {
            delete bucket.chat;
            if (!Object.keys(bucket).length) delete root[roleId];
            backend.records.set('phone_data_v2', JSON.stringify(root));
          }
          if (opts.readBackFailsAfterWrite) backend.failNextRead = key;
          return { ok: true, value: true };
        } finally {
          backend.rootDepth -= 1;
        }
      }
    }
  };

  runInNewContext(appendSource, realm);
  const tab = {
    realm,
    append: realm.ChatHistoryAppend.appendOrCreate,
    appendStable: realm.ChatHistoryAppend.appendStable
  };
  return tab;
}

function createRealm(options) {
  const opts = options || {};
  const backend = createBackend(opts.records);
  const tab = createTab(backend, opts);
  return { realm: tab.realm, records: backend.records, storageWrites: backend.storageWrites, append: tab.append, backend };
}

// vm 里创建的对象与本 realm 的 Object.prototype 不同，deepStrictEqual 会误判，
// 因此只逐字段比较原始值。
function expectOutcome(result, expected) {
  assert.equal(result.ok, expected.ok);
  assert.equal(result.created, expected.created);
  assert.equal(result.reason, expected.reason);
}

function message(mid, text) {
  return { mid, role: 'user', text: text, time: 1, type: 'text' };
}

function readRoot(backend) {
  const raw = backend.records.get('phone_data_v2');
  return raw == null ? {} : JSON.parse(raw);
}

test('appendOrCreate appends to an existing history without touching other messages', async () => {
  const { append, records, backend } = createRealm({
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const result = await append('role_a', message('m2', '新消息'));

  expectOutcome(result, { ok: true, created: false });
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].text, '旧消息');
  assert.equal(saved[1].text, '新消息');
  assert.ok(backend.lockCalls.some((call) => call.name === 'maomao:chat-history:role_a'),
    '必须使用会话级锁');
});

test('appendOrCreate creates a missing primary from the legacy copy instead of overwriting it', async () => {
  const { append, records, storageWrites } = createRealm({
    legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] }
  });
  const result = await append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: true, created: true });
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.equal(saved.length, 2, '旧副本不得被覆盖成只剩新消息');
  assert.equal(saved[0].text, '旧版副本消息');
  assert.equal(saved[1].text, '邀请消息');
  assert.equal(storageWrites.length, 1);
  assert.equal(storageWrites[0].expectedPrimary, null, '创建必须带「主键缺失」前置条件');
});

test('appendOrCreate dedupes a replay with the same mid', async () => {
  const { append, records, storageWrites } = createRealm({
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const first = await append('role_a', message('m2', '邀请消息'));
  const replay = await append('role_a', message('m2', '邀请消息'));

  expectOutcome(first, { ok: true, created: false });
  expectOutcome(replay, { ok: true, created: false });
  assert.equal(JSON.parse(records.get('chat_history_role_a')).length, 2, '重放不得追加第二条');
  assert.equal(storageWrites.length, 0, '重放不得整表重写');
});

test('appendOrCreate refuses to write when Web Locks are unavailable', async () => {
  const { append, records } = createRealm({
    locks: false,
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const result = await append('role_a', message('m2', '新消息'));

  expectOutcome(result, { ok: false, reason: 'LOCK_UNAVAILABLE' });
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.equal(saved.length, 1, '锁不可用时历史必须保持不变');
});

test('appendOrCreate does not create a missing primary without a lock', async () => {
  const { append, records, storageWrites } = createRealm({
    locks: false,
    legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] }
  });
  const result = await append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: false, reason: 'LOCK_UNAVAILABLE' });
  assert.equal(records.get('chat_history_role_a'), undefined, '锁不可用时不得创建主键');
  assert.equal(storageWrites.length, 0, '锁不可用时不得退回 compare-then-write 创建');
});

test('two concurrent appends both survive because the lock serialises them', async () => {
  const { append, records } = createRealm({
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const [a, b] = await Promise.all([
    append('role_a', message('m2', '并发一')),
    append('role_a', message('m3', '并发二'))
  ]);

  expectOutcome(a, { ok: true, created: false });
  expectOutcome(b, { ok: true, created: false });
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.equal(saved.length, 3, '两个并发追加都不得丢失');
  assert.deepEqual(saved.map((item) => item.text), ['旧消息', '并发一', '并发二']);
});

test('appendOrCreate reports VERIFY_FAILED when the write is silently dropped', async () => {
  const { append, records } = createRealm({
    dropWrites: true,
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const result = await append('role_a', message('m2', '新消息'));

  expectOutcome(result, { ok: false, reason: 'VERIFY_FAILED' });
  assert.equal(JSON.parse(records.get('chat_history_role_a')).length, 1,
    '写入被吞掉时不得报告成功');
});

test('首次创建只在会话锁内发生，且先取根锁再取会话锁', async () => {
  const backend = createBackend();
  const tab = createTab(backend, { legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] } });
  const result = await tab.append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: true, created: true });
  assert.equal(backend.storageWrites.length, 1);
  assert.equal(backend.storageWrites[0].lockHeld, true,
    'saveChatHistory 必须在会话锁回调内调用，不能在锁外补写');
  assert.deepEqual(backend.lockCalls.map((call) => call.name), [
    'maomao:phone-data-root:phone_data_v2',
    'maomao:chat-history:role_a'
  ], '顺序固定为根锁 → 会话锁，且每把锁只申请一次');
  assert.deepEqual(backend.deadlocks, [], '持锁期间不得再次申请同名锁');
});

test('两个标签页同时创建同一缺失主键：只创建一次，旧副本与两条新消息都在', async () => {
  const backend = createBackend();
  const legacy = {
    role_a: [
      { mid: 'old1', text: '旧版副本一' },
      { mid: 'old2', text: '旧版副本二' }
    ]
  };
  const tabA = createTab(backend, { legacy });
  const tabB = createTab(backend, { legacy });

  const [a, b] = await Promise.all([
    tabA.append('role_a', message('mA', 'A 的消息')),
    tabB.append('role_a', message('mB', 'B 的消息'))
  ]);

  expectOutcome(a, { ok: true, created: true });
  expectOutcome(b, { ok: true, created: false });
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.deepEqual(saved.map((item) => item.text),
    ['旧版副本一', '旧版副本二', 'A 的消息', 'B 的消息'],
    '两个标签页不得各自写一份「旧副本 + 自己那条」');
  assert.equal(new Set(saved.map((item) => item.mid)).size, 4, '不得出现重复消息');
  assert.equal(backend.storageWrites.length, 1, '只有一个标签页真正创建主键');
  assert.equal(backend.storageWrites[0].lockHeld, true);
  assert.deepEqual(backend.deadlocks, []);
});

test('非协作写入抢先建立主键时重新申请锁重试，且不覆盖对方数据', async () => {
  const backend = createBackend();
  const tab = createTab(backend, {
    legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] },
    // 模拟另一个不参与会话锁的旧写入者，在创建前置条件成立后立刻写入。
    beforeSave(roleId, records) {
      if (!records.has('chat_history_' + roleId)) {
        records.set('chat_history_' + roleId, JSON.stringify([{ mid: 'other', text: '别的标签页' }]));
      }
    }
  });
  const result = await tab.append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: true, created: false });
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.deepEqual(saved.map((item) => item.text), ['别的标签页', '邀请消息'],
    '对方的写入必须保留，重试后改走追加');
  assert.equal(backend.storageWrites.length, 1, '重试不得在锁外再次创建');
  const conversationLocks = backend.lockCalls.filter((call) => call.name === 'maomao:chat-history:role_a');
  assert.equal(conversationLocks.length, 2, '重试必须重新申请会话锁，而不是锁内补写');
});

test('旧副本不可读时返回 LEGACY_UNREADABLE 且不创建主键', async () => {
  const backend = createBackend();
  const tab = createTab(backend, { getRootThrows: true });
  const result = await tab.append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: false, reason: 'LEGACY_UNREADABLE' });
  assert.equal(backend.records.get('chat_history_role_a'), undefined);
  assert.equal(backend.storageWrites.length, 0, '读不到旧副本时不得用空数组覆盖创建');
});

test('原子层缺少创建能力时明确失败，不退回整表覆盖', async () => {
  const records = new Map();
  const realm = { Promise, console: { warn() {}, error() {} } };
  realm.window = realm;
  realm.localStorage = {
    getItem: (key) => (records.has(key) ? records.get(key) : null),
    setItem: (key, value) => records.set(key, String(value)),
    removeItem: (key) => records.delete(key)
  };
  realm.navigator = { locks: { request: async (_n, _o, cb) => cb() } };
  realm.PhoneStorage = {
    getChatHistory: () => [],
    result: {
      getRoot: () => ({ ok: true, value: {} }),
      saveChatHistory: () => { throw new Error('must not be called'); }
    }
  };
  runInNewContext(appendSource, realm);
  const result = await realm.ChatHistoryAppend.appendOrCreate('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: false, reason: 'ATOMIC_UNAVAILABLE' });
  assert.equal(records.get('chat_history_role_a'), undefined, '旧版缓存脚本组合下不得写入');
});

test('appendIf / appendManyIf / replaceIfUnchanged 仍然保留「主键缺失即 NOT_FOUND」', async () => {
  const backend = createBackend();
  const tab = createTab(backend, { legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] } });
  const atomic = tab.realm.ChatHistoryAtomic;

  const single = await atomic.appendIf('role_a', message('m2', '分享'));
  const many = await atomic.appendManyIf('role_a', [message('m2', '分享')]);
  const replaced = await atomic.replaceIfUnchanged('role_a', [], [message('m3', '改写')]);

  assert.equal(single.ok, false);
  assert.equal(single.error.code, 'NOT_FOUND', 'appendIf 不得因为新增创建能力而自行创建主键');
  assert.equal(many.error.code, 'NOT_FOUND');
  assert.equal(replaced.error.code, 'NOT_FOUND');
  assert.equal(backend.records.get('chat_history_role_a'), undefined, '三个入口都不得写入');
  assert.equal(backend.storageWrites.length, 0);
});

test('论坛分享 / 情侣邀请 / 亲属卡通知同时首次写入同一会话：三条都在且只创建一次', async () => {
  const backend = createBackend();
  const legacy = { role_a: [{ mid: 'old', text: '旧版副本消息' }] };
  const forum = createTab(backend, { legacy });
  const couple = createTab(backend, { legacy });
  const wallet = createTab(backend, { legacy });

  const results = await Promise.all([
    forum.append('role_a', message('mForum', '【分享帖子】正文')),
    couple.append('role_a', message('mCouple', '♡ 邀请你绑定我们的情侣空间')),
    wallet.append('role_a', message('mWallet', '已领取亲属卡'))
  ]);

  assert.deepEqual(results.map((item) => item.ok), [true, true, true]);
  assert.equal(results.filter((item) => item.created).length, 1, '只能有一次创建');
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.deepEqual(saved.map((item) => item.mid), ['old', 'mForum', 'mCouple', 'mWallet']);
  assert.equal(backend.storageWrites.length, 1);
  assert.equal(backend.storageWrites[0].lockHeld, true);
  assert.deepEqual(backend.deadlocks, []);
});

/* ============================================================
 * 旧数据读取：必须失败关闭，不能把「读不出来」当成「没有记录」
 * ============================================================ */

test('phone_data_v2 是损坏 JSON 时拒绝创建，旧数据原样保留', async () => {
  const corrupt = '{"role_a": {"chat": {"history": [{"mid":"old"';
  const backend = createBackend({ phone_data_v2: corrupt });
  const tab = createTab(backend, {});
  const result = await tab.append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: false, reason: 'LEGACY_CORRUPT' });
  assert.equal(backend.records.get('chat_history_role_a'), undefined, '损坏时不得创建主键');
  assert.equal(backend.storageWrites.length, 0, '损坏时不得调用 saveChatHistory');
  assert.equal(backend.records.get('phone_data_v2'), corrupt, '旧根必须原样保留');
});

test('phone_data_v2 结构非法时拒绝创建（根是数组 / 桶不是对象 / history 不是数组）', async () => {
  const cases = [
    { name: '根是数组', root: '[]' },
    { name: '根是字符串', root: '"legacy"' },
    { name: '桶是字符串', root: JSON.stringify({ role_a: 'broken' }) },
    { name: 'chat 是数组', root: JSON.stringify({ role_a: { chat: [] } }) },
    { name: 'history 是对象', root: JSON.stringify({ role_a: { chat: { history: { 0: { text: 'x' } } } } }) }
  ];

  for (const item of cases) {
    const backend = createBackend({ phone_data_v2: item.root });
    const tab = createTab(backend, {});
    const result = await tab.append('role_a', message('m2', '邀请消息'));

    assert.equal(result.ok, false, item.name + '：必须失败');
    assert.equal(result.reason, 'LEGACY_CORRUPT', item.name + '：应报告 LEGACY_CORRUPT');
    assert.equal(backend.records.get('chat_history_role_a'), undefined, item.name + '：不得创建主键');
    assert.equal(backend.storageWrites.length, 0, item.name + '：不得调用 saveChatHistory');
    assert.equal(backend.records.get('phone_data_v2'), item.root, item.name + '：旧根必须原样保留');
  }
});

test('根读取异常（getRoot 报错或返回 DB_UNAVAILABLE）时拒绝创建', async () => {
  for (const opts of [{ getRootThrows: true }, { rootUnavailable: true }]) {
    const backend = createBackend({ phone_data_v2: JSON.stringify({ role_a: { chat: { history: [{ mid: 'old' }] } } }) });
    const tab = createTab(backend, opts);
    const result = await tab.append('role_a', message('m2', '邀请消息'));

    expectOutcome(result, { ok: false, reason: 'LEGACY_UNREADABLE' });
    assert.equal(backend.records.get('chat_history_role_a'), undefined, '读不出来时不得创建主键');
    assert.equal(backend.storageWrites.length, 0);
  }
});

test('真正没有旧记录时允许创建空历史（整根缺失 / 无该角色 / 无 chat / chat 无 history）', async () => {
  const cases = [
    { name: '整根缺失', records: {} },
    { name: '没有该角色', records: { phone_data_v2: JSON.stringify({ role_b: { chat: { history: [{ mid: 'b' }] } } }) } },
    { name: '该角色没有 chat', records: { phone_data_v2: JSON.stringify({ role_a: { memories: { items: ['记忆'] } } }) } },
    { name: 'chat 里没有 history', records: { phone_data_v2: JSON.stringify({ role_a: { chat: {} } }) } }
  ];

  for (const item of cases) {
    const backend = createBackend(item.records);
    const tab = createTab(backend, {});
    const result = await tab.append('role_a', message('m2', '邀请消息'));

    expectOutcome(result, { ok: true, created: true });
    const saved = JSON.parse(backend.records.get('chat_history_role_a'));
    assert.deepEqual(saved.map((msg) => msg.mid), ['m2'], item.name + '：应以单条消息创建');
  }
});

/* ============================================================
 * 跨角色首次创建：phone_data_v2 的整对象重写
 * ============================================================ */

test('两个不同角色同时首次创建：两份旧 chat 都被清理，其他领域数据不变', async () => {
  const backend = createBackend({
    phone_data_v2: JSON.stringify({
      role_a: { chat: { history: [{ mid: 'oldA', text: 'A 旧消息' }] }, memories: { items: ['A 记忆'] } },
      role_b: { chat: { history: [{ mid: 'oldB', text: 'B 旧消息' }] }, profile: { name: 'B' } },
      role_c: { memories: { items: ['C 记忆'] }, settings: { theme: 'dark' } }
    })
  });
  // rootCleanupDelay 让「写主键」和「重写根」之间出现真实的异步窗口。
  const tabA = createTab(backend, { rootCleanupDelay: true });
  const tabB = createTab(backend, { rootCleanupDelay: true });

  const [a, b] = await Promise.all([
    tabA.append('role_a', message('mA', 'A 的新消息')),
    tabB.append('role_b', message('mB', 'B 的新消息'))
  ]);

  expectOutcome(a, { ok: true, created: true });
  expectOutcome(b, { ok: true, created: true });
  assert.deepEqual(JSON.parse(backend.records.get('chat_history_role_a')).map((m) => m.text),
    ['A 旧消息', 'A 的新消息']);
  assert.deepEqual(JSON.parse(backend.records.get('chat_history_role_b')).map((m) => m.text),
    ['B 旧消息', 'B 的新消息']);

  const root = readRoot(backend);
  assert.equal(root.role_a.chat, undefined, 'role_a 的旧副本必须被清理');
  assert.equal(root.role_b.chat, undefined, 'role_b 的旧副本必须被清理（不得被对方的旧快照写回）');
  assert.deepEqual(root.role_a.memories, { items: ['A 记忆'] }, 'A 的记忆不得丢失');
  assert.deepEqual(root.role_b.profile, { name: 'B' }, 'B 的资料不得丢失');
  assert.deepEqual(root.role_c.memories, { items: ['C 记忆'] }, '无关角色的数据不得丢失');
  assert.deepEqual(root.role_c.settings, { theme: 'dark' }, '无关领域的数据不得丢失');
  assert.equal(backend.rootMaxDepth, 1, '根重写临界区必须串行，不得并发进入');
  assert.deepEqual(backend.deadlocks, []);
});

test('对照：绕过根锁直接并发调用 saveChatHistory 会互相覆盖（残余风险证据）', async () => {
  // 复刻 chat/date/date.html 这类「不参与统一入口」的写入者：不申请根锁，
  // 直接 saveChatHistory。这里完全不加锁，用同一个桩证明窗口真实存在。
  const backend = createBackend({
    phone_data_v2: JSON.stringify({
      role_a: { chat: { history: [{ mid: 'oldA' }] }, memories: { items: ['A 记忆'] } },
      role_b: { chat: { history: [{ mid: 'oldB' }] } },
      role_c: { memories: { items: ['C 记忆'] } }
    })
  });
  const tabA = createTab(backend, { rootCleanupDelay: true });
  const tabB = createTab(backend, { rootCleanupDelay: true });

  await Promise.all([
    tabA.realm.PhoneStorage.result.saveChatHistory('role_a', [{ mid: 'mA' }], null),
    tabB.realm.PhoneStorage.result.saveChatHistory('role_b', [{ mid: 'mB' }], null)
  ]);

  const root = readRoot(backend);
  const survived = ['role_a', 'role_b'].filter((id) => root[id] && root[id].chat);
  assert.equal(backend.rootMaxDepth, 2, '无锁时两个临界区会重叠');
  assert.equal(survived.length, 1, '无锁时必有一份旧副本被对方的旧快照写回');
  assert.deepEqual(root.role_c.memories, { items: ['C 记忆'] }, '本用例里 C 未被并发写入，数据仍在');
});

/* ============================================================
 * 失败重试的幂等性
 * ============================================================ */

test('写入已落盘但读回失败后重试：复用同一个 mid，不产生第二条消息', async () => {
  const backend = createBackend({});
  const tab = createTab(backend, { readBackFailsAfterWrite: true });

  const first = await tab.appendStable('forum-share:role_a:p1', 'role_a', () => message('mFixed', '【分享帖子】正文'));
  assert.equal(first.ok, false);
  assert.equal(first.reason, 'DB_UNAVAILABLE');
  assert.equal(first.writeMayHavePersisted, true, '必须告诉调用方写入可能已落盘');
  assert.equal(JSON.parse(backend.records.get('chat_history_role_a')).length, 1,
    '第一次其实已经写进去了');

  const retry = await tab.appendStable('forum-share:role_a:p1', 'role_a', () => message('mNew', '【分享帖子】正文'));
  assert.equal(retry.ok, true);
  assert.equal(retry.created, false, '重试走「已存在」分支');
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.equal(saved.length, 1, '重试不得产生第二条消息');
  assert.equal(saved[0].mid, 'mFixed', '重试必须复用第一次的 mid');
  assert.equal(backend.storageWrites.length, 1, '重试不得再写一次主键');
});

test('对照：每次点击都生成新 mid 时，读回失败会造成重复消息', async () => {
  const backend = createBackend({});
  const tab = createTab(backend, { readBackFailsAfterWrite: true });

  const first = await tab.append('role_a', message('mFirst', '【分享帖子】正文'));
  assert.equal(first.ok, false);
  assert.equal(first.writeMayHavePersisted, true);

  // 用户再点一次，页面重新生成 mid（修复前的行为）。
  await tab.append('role_a', message('mSecond', '【分享帖子】正文'));
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.equal(saved.length, 2, '这就是本次要消除的重复消息');
  assert.deepEqual(saved.map((msg) => msg.mid), ['mFirst', 'mSecond']);
});

test('appendStable 成功后清空缓存：再次分享同一帖子会生成新消息', async () => {
  const backend = createBackend({});
  const tab = createTab(backend, {});

  const first = await tab.appendStable('forum-share:role_a:p1', 'role_a', () => message('mA', '正文'));
  assert.equal(first.ok, true);
  const second = await tab.appendStable('forum-share:role_a:p1', 'role_a', () => message('mB', '正文'));
  assert.equal(second.ok, true);
  const saved = JSON.parse(backend.records.get('chat_history_role_a'));
  assert.deepEqual(saved.map((msg) => msg.mid), ['mA', 'mB'], '成功后的新动作应当是新消息');
});

test('appendStable 在写入被吞掉时明确失败，不得报告成功', async () => {
  const backend = createBackend({});
  const broken = createTab(backend, { dropWrites: true });

  const first = await broken.appendStable('couple-invite:role_a', 'role_a', () => message('mInvite', '邀请'));
  assert.equal(first.ok, false);
  assert.equal(first.reason, 'VERIFY_FAILED');
  assert.equal(first.writeMayHavePersisted, true, '写入被吞掉时也属于「结果未确认」');
  assert.equal(backend.records.get('chat_history_role_a'), undefined);
});
