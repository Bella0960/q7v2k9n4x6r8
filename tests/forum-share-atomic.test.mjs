import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'forum/forum-detail.html'), 'utf8');

function sliceSharePost(source) {
  const start = source.indexOf('function sharePost() {');
  assert.ok(start >= 0, 'forum-detail.html should define sharePost');
  const end = source.indexOf('\n  function getFollows()', start);
  assert.ok(end > start, 'sharePost block should end before getFollows');
  return source.slice(start, end) + '\nsharePost;';
}

const sharePostSource = sliceSharePost(page);

function createStorage(initial) {
  const records = new Map();
  for (const [roleId, list] of Object.entries(initial || {})) {
    records.set('chat_history_' + roleId, JSON.stringify(list));
  }
  const NS = {
    getChatHistory(roleId) {
      const raw = records.get('chat_history_' + roleId);
      return raw == null ? [] : JSON.parse(raw);
    },
    saveChatHistory() {
      throw new Error('the whole-array facade must not be used on the append path');
    },
    result: {
      saveChatHistory(roleId, list, expectedPrimary) {
        const key = 'chat_history_' + roleId;
        const raw = records.has(key) ? records.get(key) : null;
        if (expectedPrimary !== undefined && raw !== expectedPrimary) {
          return { ok: false, error: { code: 'CONFLICT' } };
        }
        records.set(key, JSON.stringify(list));
        return { ok: true };
      }
    }
  };
  return { NS, records };
}

function createAtomic(records, plan) {
  const calls = [];
  const queue = Array.isArray(plan) ? plan.slice() : null;
  return {
    calls,
    appendIf(roleId, message) {
      calls.push({ roleId, message });
      const step = queue && queue.length ? queue.shift() : { code: 'APPEND' };
      if (step.code !== 'APPEND') return Promise.resolve({ ok: false, error: { code: step.code } });
      const key = 'chat_history_' + roleId;
      const raw = records.has(key) ? records.get(key) : null;
      if (raw === null) return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND' } });
      const list = JSON.parse(raw);
      if (message.mid != null && list.some((item) => String(item.mid) === String(message.mid))) {
        return Promise.resolve({ ok: true, meta: { alreadyPersisted: true } });
      }
      list.push(message);
      records.set(key, JSON.stringify(list));
      return Promise.resolve({ ok: true, meta: { total: list.length } });
    }
  };
}

function createEnv({ history, atomic, storage }) {
  const alerts = [];
  const localWrites = [];
  const sto = storage || createStorage(history);
  const env = {
    Promise,
    console: { warn() {}, error() {}, log() {} },
    alert(message) { alerts.push(String(message)); },
    postBody: () => '帖子正文',
    postTitle: () => '帖子标题',
    localStorage: {
      getItem: (key) => key === 'ai_custom_characters'
        ? JSON.stringify([{ id: 'role-a', name: '晚风' }]) : null,
      setItem: (key, value) => { localWrites.push([key, value]); },
      removeItem() {}
    },
    window: { PhoneStorage: sto.NS }
  };
  const atom = atomic === undefined ? createAtomic(sto.records) : atomic;
  if (atom) env.window.ChatHistoryAtomic = atom;
  return { env, alerts, localWrites, storage: sto, atomic: atom };
}

function flush() {
  return new Promise((done) => setTimeout(done, 8));
}

test('sharePost no longer overwrites the whole chat_history_ array', () => {
  assert.doesNotMatch(sharePostSource, /localStorage\.setItem\('chat_history_/,
    '整表覆盖写入必须移除');
  assert.match(page, /shared\/js\/phone\/chat-history-atomic\.js/,
    '页面必须加载 ChatHistoryAtomic，否则无法安全追加');
});

test('sharePost appends through the atomic lock and reports success once', async () => {
  const { env, alerts, storage, atomic } = createEnv({ history: { 'role-a': [{ text: '旧消息', role: 'agent' }] } });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['已分享给 晚风']);
  assert.equal(atomic.calls.length, 1);
  assert.equal(atomic.calls[0].roleId, 'role-a', '只允许写入目标角色的 key');
  const saved = JSON.parse(storage.records.get('chat_history_role-a'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].text, '旧消息', '既有消息必须原样保留');
  assert.equal(saved[1].text, '【分享帖子】帖子正文');
  assert.ok(saved[1].mid, '分享消息必须带稳定 mid，便于原子层去重');
});

test('sharePost fails loudly instead of writing when Web Locks are unavailable', async () => {
  const { env, alerts, localWrites, storage, atomic } = createEnv({
    history: { 'role-a': [{ text: '旧消息' }] },
    atomic: createAtomic(new Map(), [{ code: 'LOCK_UNAVAILABLE' }])
  });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['其他标签页正在写入聊天记录，请稍后重试']);
  assert.equal(localWrites.length, 0, '不得退回 localStorage 整表写入');
  assert.equal(atomic.calls.length, 1);
  assert.equal(JSON.parse(storage.records.get('chat_history_role-a')).length, 1, '历史保持不变');
});

test('sharePost refuses to write when ChatHistoryAtomic is missing', async () => {
  const { env, alerts, localWrites } = createEnv({ history: { 'role-a': [] }, atomic: null });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['当前浏览器不支持安全的聊天记录写入，帖子没有分享成功']);
  assert.equal(localWrites.length, 0);
});

test('sharePost creates a missing primary only when the key is still absent', async () => {
  const storage = createStorage({});
  // Legacy phone_data_v2 copy is what getChatHistory falls back to.
  storage.NS.getChatHistory = (roleId) => {
    const raw = storage.records.get('chat_history_' + roleId);
    return raw == null ? [{ text: '旧版副本消息', role: 'agent' }] : JSON.parse(raw);
  };
  const { env, alerts } = createEnv({ storage, atomic: createAtomic(storage.records, [{ code: 'NOT_FOUND' }]) });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['已分享给 晚风']);
  const saved = JSON.parse(storage.records.get('chat_history_role-a'));
  assert.equal(saved.length, 2, '旧副本不得被覆盖成只剩分享消息');
  assert.equal(saved[0].text, '旧版副本消息');
  assert.equal(saved[1].text, '【分享帖子】帖子正文');
});

test('sharePost retries the atomic append when another tab creates the primary first', async () => {
  const storage = createStorage({});
  storage.NS.getChatHistory = (roleId) => {
    const raw = storage.records.get('chat_history_' + roleId);
    return raw == null ? [] : JSON.parse(raw);
  };
  const { env, alerts, atomic } = createEnv({ storage, atomic: createAtomic(storage.records, [{ code: 'NOT_FOUND' }]) });
  // Make the create attempt race: the key appears between NOT_FOUND and create.
  const realSave = storage.NS.result.saveChatHistory;
  storage.NS.result.saveChatHistory = (roleId, list, expected) => {
    storage.records.set('chat_history_' + roleId, JSON.stringify([]));
    return realSave(roleId, list, expected);
  };
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['已分享给 晚风']);
  assert.equal(atomic.calls.length, 2, 'CONFLICT 后必须重试原子追加');
  assert.equal(JSON.parse(storage.records.get('chat_history_role-a')).length, 1);
});

test('a double tap while the write is in flight only appends one message', async () => {
  const { env, alerts, storage, atomic } = createEnv({ history: { 'role-a': [{ text: '旧消息' }] } });
  const run = runInNewContext(sharePostSource, env);
  run();
  run();
  await flush();

  assert.equal(atomic.calls.length, 1, '连点不得产生第二条分享消息');
  assert.equal(alerts.length, 1);
  assert.equal(JSON.parse(storage.records.get('chat_history_role-a')).length, 2);
});
