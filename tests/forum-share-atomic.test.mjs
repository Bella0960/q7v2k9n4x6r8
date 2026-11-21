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
    post: { id: 'p-1' },
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
      // appendStable 的缓存由真实实现负责；页面层的契约是「同一个动作传同一个 key」。
      appendStable(actionKey, roleId, factory) {
        const message = factory();
        calls.push({ actionKey, roleId, message });
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
  assert.match(sharePostSource, /appendStable\(shareKey, target\.id/, '必须走共享的幂等追加入口');
  assert.doesNotMatch(sharePostSource, /appendOrCreate\(/, '页面层不得绕过动作 key 直接追加');
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
  assert.equal(calls[0].actionKey, 'forum-share:role-a:p-1', '动作 key 必须能唯一标识「这张帖子 → 这个角色」');
  assert.equal(localWrites.length, 0);
});

test('sharePost fails loudly and writes nothing when the lock is unavailable', async () => {
  const { env, alerts, calls, localWrites } = createEnv(async () => ({ ok: false, reason: 'LOCK_UNAVAILABLE' }));
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.deepEqual(alerts, ['当前环境无法安全写入聊天记录，帖子未分享。']);
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

test('写入可能已落盘时提示「结果未确认」，不得显示分享成功', async () => {
  const { env, alerts } = createEnv(async () => ({
    ok: false, reason: 'DB_UNAVAILABLE', writeMayHavePersisted: true
  }));
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /聊天通知结果尚未确认，请先进入对应聊天检查，避免重复操作。/);
  assert.doesNotMatch(alerts[0], /已分享给/);
});

test('旧聊天记录损坏或读不出来时明确提示，不得显示分享成功', async () => {
  for (const [reason, pattern] of [['LEGACY_CORRUPT', /旧聊天记录格式异常/], ['LEGACY_UNREADABLE', /旧聊天记录暂时读不出来/]]) {
    const { env, alerts } = createEnv(async () => ({ ok: false, reason }));
    const run = runInNewContext(sharePostSource, env);
    run();
    await flush();

    assert.equal(alerts.length, 1);
    assert.match(alerts[0], pattern);
    assert.doesNotMatch(alerts[0], /已分享给/);
  }
});

test('两次重试使用同一个动作 key，交给共享缓存复用同一个 mid', async () => {
  let attempt = 0;
  const { env, calls } = createEnv(async () => {
    attempt += 1;
    return attempt === 1
      ? { ok: false, reason: 'VERIFY_FAILED', writeMayHavePersisted: true }
      : { ok: true, created: false };
  });
  const run = runInNewContext(sharePostSource, env);
  run();
  await flush();
  run();
  await flush();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].actionKey, calls[1].actionKey, '同一个「帖子 → 角色」必须产生同一个动作 key');
});
