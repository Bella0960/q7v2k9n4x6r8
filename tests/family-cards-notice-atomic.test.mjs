import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'wallet/family-cards.html'), 'utf8');

function sliceNoticeHelper(source) {
  const start = source.indexOf('  function appendRoleNotice(card, message, actionKey) {');
  assert.ok(start >= 0, 'family-cards.html should define appendRoleNotice');
  const end = source.indexOf('\n  function runAction(action, id) {', start);
  assert.ok(end > start, 'appendRoleNotice block should end before runAction');
  return source.slice(start, end) + '\n({ appendRoleNotice: appendRoleNotice, noticeFailureMessage: noticeFailureMessage });';
}

const helpersSource = sliceNoticeHelper(page);

function createEnv(append) {
  const calls = [];
  const env = {
    Promise,
    String,
    Math,
    Date,
    console: { warn() {}, error() {}, log() {} },
    window: {}
  };
  if (append !== null) {
    env.window.ChatHistoryAppend = {
      appendStable(actionKey, roleId, factory) {
        const message = factory();
        calls.push({ actionKey, roleId, message });
        return append(roleId, message);
      }
    };
  }
  return { env, calls };
}

function load(env) {
  // runInNewContext returns the object literal appended by the slice.
  return runInNewContext(helpersSource, env);
}

test('family cards no longer write the whole chat_history_ array', () => {
  assert.doesNotMatch(page, /localStorage\.setItem\('chat_history_/);
  assert.match(page, /shared\/js\/phone\/chat-history-append\.js/);
  assert.match(page, /shared\/js\/phone\/chat-history-atomic\.js/);
  assert.match(page, /appendRoleNotice\(card, verb, 'family-card:' \+ \(card\.id \|\| ''\) \+ ':' \+ action\)\.then\(/,
    '通知写入是异步的，结果必须通过 then 处理');
});

test('appendRoleNotice sends one notice with a stable mid to the card role', async () => {
  const { env, calls } = createEnv(async () => ({ ok: true, created: false }));
  const helpers = load(env);
  const result = await helpers.appendRoleNotice({ roleId: 'role-a' }, '我收下你送给我的卡了，谢谢你。');

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].roleId, 'role-a');
  assert.equal(calls[0].message.role, 'user');
  assert.equal(calls[0].message.type, 'text');
  assert.equal(calls[0].message.text, '我收下你送给我的卡了，谢谢你。');
  assert.ok(calls[0].message.mid, '通知必须带稳定 mid');
  assert.equal(typeof calls[0].message.time, 'number');
});

test('a lock failure is surfaced instead of silently degrading', async () => {
  const { env, calls } = createEnv(async () => ({ ok: false, reason: 'LOCK_UNAVAILABLE' }));
  const helpers = load(env);
  const result = await helpers.appendRoleNotice({ roleId: 'role-a' }, '卡片已暂停');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOCK_UNAVAILABLE');
  assert.equal(calls.length, 1);
  assert.equal(helpers.noticeFailureMessage(result.reason),
    '卡片操作已保存，但当前环境无法安全写入聊天记录，请稍后在对应聊天中补发通知。');
});

test('a missing atomic layer fails loudly', async () => {
  const { env } = createEnv(null);
  const helpers = load(env);
  const result = await helpers.appendRoleNotice({ roleId: 'role-a' }, '卡片已恢复使用');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ATOMIC_UNAVAILABLE');
  assert.match(helpers.noticeFailureMessage(result.reason), /不支持安全的聊天记录写入/);
});

test('a card without roleId writes nothing', async () => {
  const { env, calls } = createEnv(async () => ({ ok: true }));
  const helpers = load(env);
  const result = await helpers.appendRoleNotice({ roleId: '' }, '已领取');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_ROLE');
  assert.equal(calls.length, 0);
});

test('an unexpected rejection is reported as a failure, not a success', async () => {
  const { env } = createEnv(async () => { throw new Error('boom'); });
  const helpers = load(env);
  const result = await helpers.appendRoleNotice({ roleId: 'role-a' }, '已领取');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'UNEXPECTED');
  assert.equal(helpers.noticeFailureMessage(result.reason),
    '卡片操作已保存，但聊天通知未写入，请稍后在对应聊天中补发',
    '默认文案必须与改动前一致');
});

test('旧聊天记录损坏时给出「为避免覆盖」的提示', () => {
  const helpers = load(createEnv(async () => ({ ok: true })).env);
  assert.match(helpers.noticeFailureMessage('LEGACY_CORRUPT'), /为避免覆盖/);
  assert.match(helpers.noticeFailureMessage('LEGACY_UNREADABLE'), /为避免覆盖/);
  assert.match(page, /聊天通知结果尚未确认，请先进入对应聊天检查，避免重复操作。/);
});
