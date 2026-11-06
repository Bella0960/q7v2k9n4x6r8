import test from 'node:test';
import assert from 'node:assert/strict';

import { openTestDb } from './helpers/cloud-helpers.mjs';
import { applyMigrations } from '../worker/lib/migrations.js';
import { createStore } from '../worker/lib/store.js';
import {
  buildDedupeKey,
  evaluateTask,
  nextRetryAt,
  planTask,
  REASON_CODES,
  validateConfig
} from '../worker/lib/scheduler-policy.js';
import { runTick } from '../worker/lib/scheduler.js';

const NOW = 1_800_000_000_000;
const CONFIG = Object.freeze({
  leaseMs: 60_000,
  tickLimit: 10,
  retryBackoffMs: [60_000, 300_000]
});

function freshStore() {
  const testDb = openTestDb();
  const store = createStore(testDb.exec);
  applyMigrations(testDb.exec);
  return { store, query: testDb.query };
}

function enqueue(store, overrides = {}) {
  return store.enqueueActivity({
    id: overrides.id || 'act_demo_1',
    deviceId: overrides.deviceId || 'dev_test',
    characterId: overrides.characterId || 'char_test',
    kind: overrides.kind || 'contact',
    scheduledAt: overrides.scheduledAt ?? NOW - 1_000,
    maxAttempts: overrides.maxAttempts ?? 3,
    now: overrides.now ?? NOW,
    payload: overrides.payload || { contextVersion: 1, synthetic: true }
  });
}

test('配置缺失与非法分别 fail-closed，且不内置默认值', () => {
  assert.deepEqual(validateConfig(undefined), { ok: false, reason: REASON_CODES.MISSING_CONFIG });
  assert.deepEqual(validateConfig({ leaseMs: 1 }), { ok: false, reason: REASON_CODES.MISSING_CONFIG });
  assert.deepEqual(validateConfig({ leaseMs: 0, tickLimit: 10, retryBackoffMs: [1] }), {
    ok: false,
    reason: REASON_CODES.INVALID_CONFIG
  });
  assert.deepEqual(validateConfig({ leaseMs: 10, tickLimit: 10, retryBackoffMs: [] }), {
    ok: false,
    reason: REASON_CODES.INVALID_CONFIG
  });
  assert.deepEqual(validateConfig(CONFIG), { ok: true, config: CONFIG });
});

test('幂等键对同一时间桶稳定，跨桶与其他角色不同', () => {
  const base = { deviceId: 'dev_a', characterId: 'char_a', kind: 'contact', bucket: 100 };
  const first = buildDedupeKey(base);
  assert.equal(first, buildDedupeKey({ ...base }));
  assert.notEqual(first, buildDedupeKey({ ...base, bucket: 101 }));
  assert.notEqual(first, buildDedupeKey({ ...base, characterId: 'char_b' }));
  assert.equal(buildDedupeKey({ deviceId: '', characterId: 'c', kind: 'contact', bucket: 1 }), null);
  assert.equal(buildDedupeKey({ deviceId: 'd', characterId: 'c', kind: 'contact', bucket: 1.5 }), null);
});

test('到期判定：未到点、到期边界、租约未过期与终态', () => {
  const waiting = { id: 'a', status: 'waiting', scheduled_at: NOW + 1, attempt_count: 0, max_attempts: 3 };
  assert.deepEqual(evaluateTask(waiting, { now: NOW }), { due: false, reason: REASON_CODES.NOT_DUE });
  assert.deepEqual(evaluateTask({ ...waiting, scheduled_at: NOW }, { now: NOW }), {
    due: true,
    reason: REASON_CODES.CLAIMED
  });
  assert.deepEqual(
    evaluateTask({ ...waiting, locked_until: NOW + 1 }, { now: NOW }),
    { due: false, reason: REASON_CODES.LEASE_HELD }
  );
  assert.deepEqual(
    evaluateTask({ ...waiting, scheduled_at: NOW, locked_until: NOW }, { now: NOW }),
    { due: true, reason: REASON_CODES.CLAIMED }
  );
  assert.deepEqual(
    evaluateTask({ ...waiting, status: 'running' }, { now: NOW }),
    { due: false, reason: REASON_CODES.NOT_DUE }
  );
  assert.deepEqual(
    evaluateTask({ ...waiting, status: 'superseded' }, { now: NOW }),
    { due: false, reason: REASON_CODES.SUPERSEDED }
  );
});

test('重试次数耗尽后不再到期', () => {
  const task = { id: 'a', status: 'retry', scheduled_at: NOW, attempt_count: 3, max_attempts: 3 };
  assert.deepEqual(evaluateTask(task, { now: NOW }), {
    due: false,
    reason: REASON_CODES.RETRY_EXHAUSTED
  });
});

test('缺少 gate 时 fail-closed，不认领任何活动', () => {
  const task = { id: 'a', status: 'waiting', scheduled_at: NOW, attempt_count: 0, max_attempts: 3 };
  assert.equal(planTask(task, { now: NOW, config: CONFIG }).reason, REASON_CODES.AUTONOMY_DENIED);
});

test('autonomy 未授权时不认领', () => {
  const task = { id: 'a', status: 'waiting', scheduled_at: NOW, attempt_count: 0, max_attempts: 3 };
  const decision = planTask(task, {
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: false, characterState: 'active' })
  });
  assert.equal(decision.action, 'defer');
  assert.equal(decision.reason, REASON_CODES.AUTONOMY_DENIED);
});

test('busy / asleep / away / inactive 都阻止云端认领', () => {
  const task = { id: 'a', status: 'waiting', scheduled_at: NOW, attempt_count: 0, max_attempts: 3 };
  for (const characterState of ['busy', 'asleep', 'away', 'inactive']) {
    const decision = planTask(task, {
      now: NOW,
      config: CONFIG,
      gate: () => ({ autonomyAllowed: true, characterState })
    });
    assert.equal(decision.action, 'defer');
    assert.equal(decision.reason, REASON_CODES.CHARACTER_NOT_ACTIVE);
  }
});

test('仅 active + 双授权 + 到期时可认领，并生成租约', () => {
  const task = { id: 'a', status: 'waiting', scheduled_at: NOW, attempt_count: 0, max_attempts: 3 };
  const decision = planTask(task, {
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active', latestContextVersion: 1 }),
    owner: 'cloud'
  });
  assert.equal(decision.action, 'claim');
  assert.equal(decision.attemptCount, 1);
  assert.equal(decision.leaseUntil, NOW + CONFIG.leaseMs);
});

test('较新的 context version 会把旧任务标记为 stale 并作废', () => {
  const task = {
    id: 'a',
    status: 'waiting',
    scheduled_at: NOW,
    attempt_count: 0,
    max_attempts: 3,
    payload: { contextVersion: 1 }
  };
  const decision = planTask(task, {
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active', latestContextVersion: 2 })
  });
  assert.equal(decision.action, 'supersede');
  assert.equal(decision.reason, REASON_CODES.STALE_CONTEXT);
});

test('重试退避按显式数组计算，耗尽返回 null', () => {
  assert.equal(nextRetryAt({ attemptCount: 1, now: NOW, retryBackoffMs: [60_000], maxAttempts: 3 }), NOW + 60_000);
  assert.equal(
    nextRetryAt({ attemptCount: 2, now: NOW, retryBackoffMs: [60_000, 300_000], maxAttempts: 3 }),
    NOW + 300_000
  );
  assert.equal(nextRetryAt({ attemptCount: 3, now: NOW, retryBackoffMs: [60_000], maxAttempts: 3 }), null);
  assert.equal(nextRetryAt({ attemptCount: 1, now: NOW, retryBackoffMs: [], maxAttempts: 3 }), null);
});

test('入队幂等：同一 id 不会产生第二条活动', () => {
  const { store } = freshStore();
  const first = enqueue(store, { id: 'act_same' });
  const second = enqueue(store, { id: 'act_same' });
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(store.getActivity('act_same').status, 'waiting');
});

test('到期查询排除未到点与租约未过期的活动', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_future', scheduledAt: NOW + 5_000 });
  enqueue(store, { id: 'act_leased', scheduledAt: NOW - 1_000 });
  enqueue(store, { id: 'act_due', scheduledAt: NOW - 1_000 });
  store.claimActivity({
    id: 'act_leased',
    expectedAttemptCount: 0,
    owner: 'foreground',
    leaseUntil: NOW + 30_000,
    now: NOW
  });

  const due = store.listDueActivities(NOW, 10).map(row => row.id);
  assert.deepEqual(due, ['act_due']);
});

test('CAS 认领只有一个赢家，第二个认领返回 null', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_cas' });
  const first = store.claimActivity({
    id: 'act_cas',
    expectedAttemptCount: 0,
    owner: 'cloud',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });
  assert.ok(first);
  assert.equal(first.attempt_count, 1);
  assert.equal(first.status, 'running');

  const second = store.claimActivity({
    id: 'act_cas',
    expectedAttemptCount: 0,
    owner: 'foreground',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });
  assert.equal(second, null);
});

test('失败后按退避进入 retry，耗尽后进入 failed', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_retry', maxAttempts: 2 });
  store.claimActivity({
    id: 'act_retry',
    expectedAttemptCount: 0,
    owner: 'cloud',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });

  const retryAt = nextRetryAt({
    attemptCount: 1,
    now: NOW,
    retryBackoffMs: CONFIG.retryBackoffMs,
    maxAttempts: 2
  });
  store.failActivity({ id: 'act_retry', now: NOW, nextAttemptAt: retryAt });
  assert.equal(store.getActivity('act_retry').status, 'retry');
  assert.equal(store.listDueActivities(NOW + 59_999, 10).length, 0);
  assert.equal(store.listDueActivities(NOW + 60_000, 10).length, 1);

  store.claimActivity({
    id: 'act_retry',
    expectedAttemptCount: 1,
    owner: 'cloud',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW + 60_000
  });
  const exhausted = nextRetryAt({
    attemptCount: 2,
    now: NOW + 60_000,
    retryBackoffMs: CONFIG.retryBackoffMs,
    maxAttempts: 2
  });
  assert.equal(exhausted, null);
  store.failActivity({ id: 'act_retry', now: NOW + 60_000, nextAttemptAt: exhausted });
  assert.equal(store.getActivity('act_retry').status, 'failed');
});

test('作废后不再出现在到期列表', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_stale' });
  store.supersedeActivity('act_stale', NOW);
  assert.equal(store.getActivity('act_stale').status, 'superseded');
  assert.equal(store.listDueActivities(NOW, 10).length, 0);
});

test('配置缺失时 tick 跳过并写入日志，不认领活动', () => {
  const { store, query } = freshStore();
  enqueue(store, { id: 'act_noconfig' });
  const result = runTick({ store, now: NOW, config: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REASON_CODES.MISSING_CONFIG);
  assert.equal(store.getActivity('act_noconfig').status, 'waiting');
  const logs = query('SELECT * FROM execution_log WHERE kind = ?', 'autonomy_tick');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].reason_code, REASON_CODES.MISSING_CONFIG);
});

test('gate 缺失时 tick 全部延后，活动保持 waiting', () => {
  const { store, query } = freshStore();
  enqueue(store, { id: 'act_nogate' });
  const result = runTick({ store, now: NOW, config: CONFIG });
  assert.equal(result.ok, true);
  assert.equal(result.due, 1);
  assert.equal(result.claimed, 0);
  assert.equal(result.deferred, 1);
  assert.equal(store.getActivity('act_nogate').status, 'waiting');
  const logs = query('SELECT * FROM execution_log WHERE kind = ?', 'autonomy_tick');
  assert.equal(logs[0].reason_code, REASON_CODES.AUTONOMY_DENIED);
});

test('gate 允许时 tick 认领一次，且不写消息或推送记录', () => {
  const { store, query } = freshStore();
  enqueue(store, { id: 'act_tick' });
  const result = runTick({
    store,
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active', latestContextVersion: 1 })
  });
  assert.equal(result.claimed, 1);
  assert.equal(result.lost, 0);
  const activity = store.getActivity('act_tick');
  assert.equal(activity.status, 'running');
  assert.equal(activity.attempt_count, 1);
  assert.equal(activity.locked_by, 'cloud');
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 0);
  assert.equal(query('SELECT COUNT(*) AS total FROM push_deliveries')[0].total, 0);
  const logs = query('SELECT * FROM execution_log WHERE kind = ?', 'autonomy_tick');
  assert.equal(logs[0].reason_code, REASON_CODES.CLAIMED);
});

test('tick 的 stale 任务被作废且不认领', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_stale_tick', payload: { contextVersion: 1 } });
  const result = runTick({
    store,
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active', latestContextVersion: 2 })
  });
  assert.equal(result.superseded, 1);
  assert.equal(result.claimed, 0);
  assert.equal(store.getActivity('act_stale_tick').status, 'superseded');
});
