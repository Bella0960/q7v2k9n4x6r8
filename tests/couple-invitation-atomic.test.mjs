import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'couple/couple.html'), 'utf8');

function sliceSaveSet(source) {
  const start = source.indexOf('window.saveSet = function(){');
  assert.ok(start >= 0, 'couple.html should define saveSet');
  const end = source.indexOf('\n  window.closeSheet = closeSheet;', start);
  assert.ok(end > start, 'saveSet block should end before closeSheet wiring');
  return source.slice(start, end) + '\nwindow.saveSet;';
}

const saveSetSource = sliceSaveSet(page);

function createEnv(options) {
  const opts = options || {};
  const toasts = [];
  const calls = [];
  const writes = [];
  const values = {
    setNameA: '我', setNameB: 'TA', setDate: '2026-01-01',
    setPartner: opts.partnerId === undefined ? 'role-a' : opts.partnerId
  };
  const element = (id) => ({
    value: values[id] === undefined ? '' : values[id],
    style: {},
    classList: { add() {}, remove() {} }
  });
  const env = {
    Promise,
    console: { warn() {}, error() {}, log() {} },
    profile: { partnerId: opts.previousPartner || '', myAvatar: '', taAvatar: '' },
    K: { profile: 'couple_profile' },
    $: element,
    write: (key, value) => { writes.push([key, value]); },
    renderProfile() {},
    closeSet() {},
    toast(message) { toasts.push(String(message)); },
    localStorage: {
      getItem: () => '[]',
      setItem: (key, value) => { writes.push([key, value]); },
      removeItem() {}
    },
    window: {}
  };
  if (opts.append !== null) {
    env.window.ChatHistoryAppend = {
      appendOrCreate(roleId, message) {
        calls.push({ roleId, message });
        return opts.append(roleId, message);
      }
    };
  }
  return { env, toasts, calls, writes };
}

function flush() {
  return new Promise((done) => setTimeout(done, 8));
}

test('saveSet no longer writes the whole chat_history_ array by hand', () => {
  assert.doesNotMatch(saveSetSource, /localStorage\.setItem\('chat_history_/);
  assert.doesNotMatch(saveSetSource, /saveChatHistory\(/);
  assert.match(saveSetSource, /ChatHistoryAppend/);
  assert.match(page, /shared\/js\/phone\/chat-history-append\.js/);
  assert.match(page, /shared\/js\/phone\/chat-history-atomic\.js/);
});

test('first-time partner binding appends one invitation through the shared entry point', async () => {
  const { env, toasts, calls, writes } = createEnv({ append: async () => ({ ok: true, created: true }) });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.equal(calls.length, 1, '只允许写一次邀请消息');
  assert.equal(calls[0].roleId, 'role-a', '必须写入被绑定角色的会话');
  assert.equal(calls[0].message.role, 'user');
  assert.equal(calls[0].message.type, 'text');
  assert.ok(calls[0].message.text.startsWith('♡ 邀请你绑定我们的情侣空间'));
  assert.ok(calls[0].message.mid, '邀请消息必须带稳定 mid');
  assert.deepEqual(toasts, ['已保存']);
  assert.ok(writes.some(([key]) => key === 'couple_profile'), '资料始终先保存');
});

test('a lock failure keeps the profile saved and reports the invitation failure', async () => {
  const { env, toasts, calls } = createEnv({ append: async () => ({ ok: false, reason: 'LOCK_UNAVAILABLE' }) });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.equal(calls.length, 1);
  assert.deepEqual(toasts, ['资料已保存，但其他标签页正在写入聊天记录，请稍后在聊天中重试']);
});

test('missing atomic layer fails loudly instead of falling back to a whole-array write', async () => {
  const { env, toasts, writes } = createEnv({ append: null });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.deepEqual(toasts, ['资料已保存，但当前浏览器不支持安全的聊天记录写入，请更新浏览器后重试']);
  assert.equal(writes.filter(([key]) => String(key).startsWith('chat_history_')).length, 0);
});

test('an already bound partner does not write a second invitation', async () => {
  const { env, toasts, calls } = createEnv({
    previousPartner: 'role-a', append: async () => ({ ok: true, created: false })
  });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.equal(calls.length, 0);
  assert.deepEqual(toasts, ['已保存']);
});

test('saving without a partner writes nothing to chat history', async () => {
  const { env, toasts, calls } = createEnv({ partnerId: '', append: async () => ({ ok: true }) });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.equal(calls.length, 0);
  assert.deepEqual(toasts, ['已保存']);
});

test('an unexpected rejection falls back to the original invitation warning', async () => {
  const { env, toasts } = createEnv({
    append: async () => { throw new Error('boom'); }
  });
  const run = runInNewContext(saveSetSource, env);
  run();
  await flush();

  assert.deepEqual(toasts, ['资料已保存，但邀请消息没有写入聊天记录，请稍后在聊天中重试']);
});
