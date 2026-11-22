import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual shared policy used by private and group follow-up queues.
const source = readFileSync(new URL('../shared/js/phone/chat-followup-policy.js', import.meta.url), 'utf8');
const policyGlobal = {};
runInNewContext(source, { window: policyGlobal, globalThis: policyGlobal });
const policy = policyGlobal.ChatFollowUpPolicy;

test('explicit negative continue commands pause rather than resume proactive contact', () => {
  for (const message of [
    '不要继续追问',
    '别继续主动联系我',
    '不要再继续主动联系我了',
    '别再继续追问了',
    '不再继续联系我',
    '停止继续追问',
    '暂停继续主动联系'
  ]) {
    assert.equal(policy.classifyUserIntent(message), 'pause', message);
  }
});

test('stop commands preserve the existing 72-hour pause and cancel any pending follow-up', () => {
  const now = 1760000000000;
  const state = {
    pausedByUser: false,
    cooldownUntil: 0,
    dueAt: now + 30_000,
    ignoredCount: 2
  };
  const result = policy.applyUserIntent(state, '请不要再继续主动联系我', now);
  assert.equal(result.intent, 'pause');
  assert.equal(result.state, state);
  assert.equal(state.pausedByUser, true);
  assert.equal(state.cooldownUntil, now + 72 * 60 * 60 * 1000);
  assert.equal(state.dueAt, 0);
  assert.equal(policy.shouldBlock(state, now + 1000).blocked, true);
});

test('affirmative resumes still work without changing the persisted state contract', () => {
  for (const message of ['可以继续主动联系', '继续追问', '恢复主动联系', '重新开启追问']) {
    assert.equal(policy.classifyUserIntent(message), 'resume', message);
  }
  const now = 1760000000000;
  const state = { pausedByUser: true, cooldownUntil: now + 500000, ignoredCount: 3, followUpCount: 2, dueAt: 9 };
  const result = policy.applyUserIntent(state, '可以继续主动联系', now);
  assert.equal(result.intent, 'resume');
  assert.equal(state.pausedByUser, false);
  assert.equal(state.cooldownUntil, 0);
  assert.equal(state.ignoredCount, 0);
  assert.equal(state.followUpCount, 0);
  assert.equal(state.dueAt, 0);
});

test('unrelated sentences do not toggle proactive contact settings', () => {
  for (const message of ['今天继续聊天吧', '等会儿再说', '我要去睡觉了', '我想知道接下来会发生什么']) {
    assert.equal(policy.classifyUserIntent(message), 'normal', message);
  }
});
