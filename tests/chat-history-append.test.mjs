import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atomicSource = readFileSync(resolve(root, 'shared/js/phone/chat-history-atomic.js'), 'utf8');
const appendSource = readFileSync(resolve(root, 'shared/js/phone/chat-history-append.js'), 'utf8');

// 真实的 ChatHistoryAtomic + 真实的 ChatHistoryAppend，只把 localStorage 和
// Web Locks 换成可观察的桩。backend 用来模拟「多个标签页共享同一份存储与同一把锁」。
function createBackend(records) {
  return {
    records: new Map(Object.entries(records || {})),
    queues: new Map(),
    storageWrites: [],   // { roleId, list, expectedPrimary, lockHeld }
    lockCalls: [],       // { name, tab }
    deadlocks: []
  };
}

function createTab(backend, options) {
  const opts = options || {};
  const executing = new Set();

  const realm = { Promise, console: { warn() {}, error() {}, log() {} } };
  realm.window = realm;
  realm.localStorage = {
    getItem: (key) => (backend.records.has(key) ? backend.records.get(key) : null),
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

  const legacy = opts.legacy || {};
  realm.PhoneStorage = {
    getChatHistory(roleId) {
      const raw = backend.records.get('chat_history_' + roleId);
      if (raw != null) return JSON.parse(raw);
      if (opts.seedThrows) throw new Error('legacy unreadable');
      return Array.isArray(legacy[roleId]) ? legacy[roleId] : [];
    },
    result: {
      saveChatHistory(roleId, list, expectedPrimary) {
        backend.storageWrites.push({
          roleId, list, expectedPrimary,
          // 关键回归断言：创建必须发生在会话锁回调内部。
          lockHeld: executing.size > 0
        });
        if (opts.beforeSave) opts.beforeSave(roleId, backend.records);
        const key = 'chat_history_' + roleId;
        const raw = backend.records.has(key) ? backend.records.get(key) : null;
        if (expectedPrimary !== undefined && raw !== expectedPrimary) {
          return { ok: false, error: { code: 'CONFLICT' } };
        }
        backend.records.set(key, JSON.stringify(list));
        return { ok: true, value: true };
      }
    }
  };

  runInNewContext(appendSource, realm);
  const tab = { realm, append: realm.ChatHistoryAppend.appendOrCreate };
  return tab;
}

function createRealm(options) {
  const opts = options || {};
  const backend = createBackend(opts.records);
  const tab = createTab(backend, { legacy: opts.legacy, dropWrites: opts.dropWrites, locks: opts.locks });
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

test('首次创建只在会话锁内发生，且不为同一会话重复申请锁', async () => {
  const backend = createBackend();
  const tab = createTab(backend, { legacy: { role_a: [{ mid: 'old', text: '旧版副本消息' }] } });
  const result = await tab.append('role_a', message('m2', '邀请消息'));

  expectOutcome(result, { ok: true, created: true });
  assert.equal(backend.storageWrites.length, 1);
  assert.equal(backend.storageWrites[0].lockHeld, true,
    'saveChatHistory 必须在会话锁回调内调用，不能在锁外补写');
  assert.equal(backend.lockCalls.length, 1, '整条序列只能申请一次会话锁');
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
  assert.equal(backend.lockCalls.length, 2, '重试必须重新申请会话锁，而不是锁内补写');
});

test('旧副本不可读时返回 LEGACY_UNREADABLE 且不创建主键', async () => {
  const backend = createBackend();
  const tab = createTab(backend, { seedThrows: true });
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
    result: { saveChatHistory: () => { throw new Error('must not be called'); } }
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
