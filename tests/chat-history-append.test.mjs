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
// Web Locks 换成可观察的桩，验证串行化、去重与创建分支。
function createRealm(options) {
  const opts = options || {};
  const records = new Map();
  for (const [key, value] of Object.entries(opts.records || {})) records.set(key, value);

  const locks = [];
  const queues = new Map();
  const storageWrites = [];

  const realm = {
    Promise,
    console: { warn() {}, error() {}, log() {} }
  };
  realm.window = realm;
  realm.localStorage = {
    getItem: (key) => (records.has(key) ? records.get(key) : null),
    setItem: (key, value) => {
      if (opts.dropWrites) return; // 模拟存储吞掉写入
      records.set(key, String(value));
    },
    removeItem: (key) => { records.delete(key); }
  };
  realm.navigator = {};
  if (opts.locks !== false) {
    realm.navigator.locks = {
      request(name, _options, callback) {
        locks.push(name);
        const previous = queues.get(name) || Promise.resolve();
        const next = previous.then(() => callback());
        queues.set(name, next.then(() => undefined, () => undefined));
        return next;
      }
    };
  }

  runInNewContext(atomicSource, realm);

  const legacy = opts.legacy || {};
  realm.PhoneStorage = {
    getChatHistory(roleId) {
      if (opts.onRead) return opts.onRead(roleId, records);
      const raw = records.get('chat_history_' + roleId);
      if (raw != null) return JSON.parse(raw);
      return Array.isArray(legacy[roleId]) ? legacy[roleId] : [];
    },
    result: {
      saveChatHistory(roleId, list, expectedPrimary) {
        storageWrites.push({ roleId, list, expectedPrimary });
        const key = 'chat_history_' + roleId;
        const raw = records.has(key) ? records.get(key) : null;
        if (expectedPrimary !== undefined && raw !== expectedPrimary) {
          return { ok: false, error: { code: 'CONFLICT' } };
        }
        records.set(key, JSON.stringify(list));
        return { ok: true, value: true };
      }
    }
  };

  runInNewContext(appendSource, realm);
  return { realm, records, locks, storageWrites, append: realm.ChatHistoryAppend.appendOrCreate };
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
  const { append, records, locks } = createRealm({
    records: { chat_history_role_a: JSON.stringify([{ mid: 'm1', text: '旧消息' }]) }
  });
  const result = await append('role_a', message('m2', '新消息'));

  expectOutcome(result, { ok: true, created: false });
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].text, '旧消息');
  assert.equal(saved[1].text, '新消息');
  assert.ok(locks.includes('maomao:chat-history:role_a'), '必须使用会话级锁');
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

test('appendOrCreate retries when another tab creates the primary first', async () => {
  const { append, records, storageWrites } = createRealm({
    legacy: { role_a: [] }
  });
  // 第一次 appendIf 命中 NOT_FOUND，创建前置条件被打破（主键被抢先建立）。
  const originalSetItem = records.set.bind(records);
  let raced = false;
  const p = append('role_a', message('m2', '邀请消息'));
  queueMicrotask(() => {
    if (raced) return;
    raced = true;
    originalSetItem('chat_history_role_a', JSON.stringify([{ mid: 'other', text: '别的标签页' }]));
  });
  const result = await p;

  assert.equal(result.ok, true, 'CONFLICT 后必须重试而不是失败');
  const saved = JSON.parse(records.get('chat_history_role_a'));
  assert.ok(saved.some((item) => item.text === '邀请消息'));
  assert.ok(saved.some((item) => item.text === '别的标签页'), '别的标签页的消息不得被覆盖');
});
