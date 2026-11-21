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

function createEnv(appendOrCreate) {
  const alerts = [];
  const calls = [];
  const localWrites = [];
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
    window: {}
  };
  if (appendOrCreate !== null) {
    env.window.ChatHistoryAppend = {
      appendOrCreate(roleId, message) {
        calls.push({ roleId, message });
        return appendOrCreate(roleId, message);
      }
    };
  }
  return { env, alerts, calls, localWrites };
}

function flush() {
  return new Promise((done) => setTimeout(done, 8));
}

test('sharePost delegates to the shared append entry point and never writes the whole array', () => {
  assert.doesNotMatch(sharePostSource, /localStorage\.setItem\('chat_history_/, '整表覆盖写入必须移除');
  assert.match(sharePostSource, /appendOrCreate\(target\.id/);
  assert.match(page, /shared\/js\/phone\/chat-history-atomic\.js/);
  assert.match(page, /shared\/js\/phone\/chat-history-append\.js/);
});

test('sharePost reports success once and targets the first contact only', async () => {
  const { env, alerts, calls, localWrites } = createEnv(async () => ({ ok: true, created: false }));
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['已分享给 晚风']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].roleId, 'role-a', '只允许写入目标角色的 key');
  assert.equal(calls[0].message.role, 'user');
  assert.equal(calls[0].message.type, 'text');
  assert.equal(calls[0].message.text, '【分享帖子】帖子正文');
  assert.ok(calls[0].message.mid, '分享消息必须带稳定 mid');
  assert.equal(localWrites.length, 0);
});

test('sharePost fails loudly and writes nothing when the lock is unavailable', async () => {
  const { env, alerts, calls, localWrites } = createEnv(async () => ({ ok: false, reason: 'LOCK_UNAVAILABLE' }));
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['其他标签页正在写入聊天记录，请稍后重试']);
  assert.equal(calls.length, 1);
  assert.equal(localWrites.length, 0, '不得退回 localStorage 整表写入');
});

test('sharePost refuses to write when the append entry point is missing', async () => {
  const { env, alerts, localWrites } = createEnv(null);
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['当前浏览器不支持安全的聊天记录写入，帖子没有分享成功']);
  assert.equal(localWrites.length, 0);
});

test('a double tap while the write is in flight only appends one message', async () => {
  const { env, alerts, calls } = createEnv(async () => {
    await new Promise((done) => setTimeout(done, 4));
    return { ok: true, created: false };
  });
  const run = runInNewContext(sharePostSource, env);
  run();
  run();
  await flush();

  assert.equal(calls.length, 1, '连点不得产生第二条分享消息');
  assert.equal(alerts.length, 1);
  assert.equal(run.inFlight, false, '写入结束后必须释放连点锁');
});

test('an unexpected rejection is reported and releases the in-flight guard', async () => {
  let attempt = 0;
  const { env, alerts, calls } = createEnv(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('boom');
    return { ok: true, created: false };
  });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();
  assert.deepEqual(alerts, ['帖子分享失败：聊天记录没有保存成功，请检查存储空间后重试']);

  run();
  await flush();
  assert.deepEqual(alerts, ['帖子分享失败：聊天记录没有保存成功，请检查存储空间后重试', '已分享给 晚风'],
    '异常后必须能再次分享');
  assert.equal(calls.length, 2);
});

test('an incomplete contact record is rejected before any write', async () => {
  const { env, alerts, calls } = createEnv(async () => ({ ok: true }));
  env.localStorage.getItem = () => JSON.stringify([{ id: '   ', name: '晚风' }]);
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['联系人信息不完整，请重新选择联系人后再分享']);
  assert.equal(calls.length, 0);
});
