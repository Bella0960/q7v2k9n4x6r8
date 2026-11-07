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
import { createSchedulerGate } from '../worker/lib/scheduler-gate.js';

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
    expectedStatus: 'waiting',
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
    expectedStatus: 'waiting',
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
    expectedStatus: 'waiting',
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
    expectedStatus: 'waiting',
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
  store.failActivity({ id: 'act_retry', owner: 'cloud', attemptCount: 1, now: NOW, nextAttemptAt: retryAt });
  assert.equal(store.getActivity('act_retry').status, 'retry');
  assert.equal(store.listDueActivities(NOW + 59_999, 10).length, 0);
  assert.equal(store.listDueActivities(NOW + 60_000, 10).length, 1);

  store.claimActivity({
    id: 'act_retry',
    expectedAttemptCount: 1,
    expectedStatus: 'retry',
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
  store.failActivity({ id: 'act_retry', owner: 'cloud', attemptCount: 2, now: NOW + 60_000, nextAttemptAt: exhausted });
  assert.equal(store.getActivity('act_retry').status, 'failed');
});

test('作废后不再出现在到期列表', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_stale' });
  store.supersedeActivity({ id: 'act_stale', expectedAttemptCount: 0, expectedStatus: 'waiting', now: NOW });
  assert.equal(store.getActivity('act_stale').status, 'superseded');
  assert.equal(store.listDueActivities(NOW, 10).length, 0);
});



test('没有消息执行器时 tick 不认领活动，避免制造孤儿 running 任务', () => {
  const { store, query } = freshStore();
  store.insertDevice({
    id: 'dev_test',
    userId: 'owner',
    secretHash: 'synthetic-test-hash',
    now: NOW
  });
  enqueue(store, { id: 'act_without_executor' });
  const result = runTick({
    store,
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active' })
  });
  assert.equal(result.claimed, 0);
  assert.equal(result.deferred, 1);
  assert.equal(store.getActivity('act_without_executor').status, 'waiting');
  const logs = query('SELECT * FROM execution_log WHERE reason_code = ?', REASON_CODES.EXECUTOR_UNAVAILABLE);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].device_id, 'dev_test');
  assert.equal(store.getRecentAutonomyReasonSummary({
    userId: 'owner',
    since: NOW - 1
  })[0].reasonCode, REASON_CODES.EXECUTOR_UNAVAILABLE);
  assert.deepEqual(store.getRecentAutonomyReasonSummary({
    userId: 'other-user',
    since: NOW - 1
  }), []);
});

test('缺少执行器时释放过期 running lease 回 retry，不消耗重试次数', () => {
  const { store, query } = freshStore();
  store.insertDevice({
    id: 'dev_test',
    userId: 'owner',
    secretHash: 'synthetic-test-hash',
    now: NOW
  });
  enqueue(store, { id: 'act_expired_no_executor' });
  store.claimActivity({
    id: 'act_expired_no_executor',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'worker-gone',
    leaseUntil: NOW + 15_000,
    now: NOW
  });

  const result = runTick({
    store,
    now: NOW + 15_000,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active' })
  });
  const activity = store.getActivity('act_expired_no_executor');
  assert.equal(result.claimed, 0);
  assert.equal(result.deferred, 1);
  assert.equal(activity.status, 'retry');
  assert.equal(activity.attempt_count, 1, '释放过期 lease 不应消耗 attempt');
  assert.equal(activity.locked_by, null);
  assert.equal(activity.locked_until, null);
  assert.equal(activity.next_attempt_at, NOW + 15_000);
  const logs = query('SELECT * FROM execution_log WHERE reason_code = ?', REASON_CODES.EXECUTOR_UNAVAILABLE);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].device_id, 'dev_test');
  assert.equal(store.getRecentAutonomyReasonSummary({
    userId: 'owner',
    since: NOW - 1
  })[0].reasonCode, REASON_CODES.EXECUTOR_UNAVAILABLE);
  assert.deepEqual(store.getRecentAutonomyReasonSummary({
    userId: 'other-user',
    since: NOW - 1
  }), []);
});

test('过期 running 租约会被重新列入并安全 CAS 认领，旧 worker 写入被 fencing 拒绝', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_recover' });
  const first = store.claimActivity({
    id: 'act_recover',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'worker-old',
    leaseUntil: NOW + 30_000,
    now: NOW
  });
  assert.ok(first);
  assert.equal(store.listDueActivities(NOW + 29_999, 10).length, 0);
  const expiredTasks = store.listDueActivities(NOW + 30_000, 10);
  assert.equal(expiredTasks.length, 1);
  assert.equal(expiredTasks[0].status, 'running');

  const recovered = runTick({
    store,
    now: NOW + 30_000,
    config: CONFIG,
    owner: 'worker-new',
    executorAvailable: true,
    gate: () => ({ autonomyAllowed: true, characterState: 'active' })
  });
  assert.equal(recovered.claimed, 1);
  const current = store.getActivity('act_recover');
  assert.equal(current.status, 'running');
  assert.equal(current.locked_by, 'worker-new');
  assert.equal(current.attempt_count, 2);

  assert.equal(store.completeActivity({
    id: 'act_recover', owner: 'worker-old', attemptCount: 1, now: NOW + 31_000
  }), false, '旧 worker 不得完成新 worker 的任务');
  assert.equal(store.failActivity({
    id: 'act_recover', owner: 'worker-old', attemptCount: 1,
    now: NOW + 31_000, nextAttemptAt: NOW + 60_000
  }), false, '旧 worker 不得把新 worker 的任务改成 retry');

  assert.equal(store.completeActivity({
    id: 'act_recover', owner: 'worker-new', attemptCount: 2, now: NOW + 32_000
  }), true);
  assert.equal(store.getActivity('act_recover').status, 'completed');
});

test('worker 即使尚未被新 owner 接管，也不能在原 lease 过期后提交结果', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_late_completion' });
  store.claimActivity({
    id: 'act_late_completion',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'worker-slow',
    leaseUntil: NOW + 10_000,
    now: NOW
  });
  assert.equal(store.completeActivity({
    id: 'act_late_completion',
    owner: 'worker-slow',
    attemptCount: 1,
    now: NOW + 10_000
  }), false);
  assert.equal(store.failActivity({
    id: 'act_late_completion',
    owner: 'worker-slow',
    attemptCount: 1,
    now: NOW + 10_000,
    nextAttemptAt: NOW + 20_000
  }), false);
  assert.equal(store.getActivity('act_late_completion').status, 'running');
});

test('过期 running 任务耗尽重试次数后会终止为 failed', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_reclaim_exhausted', maxAttempts: 1 });
  store.claimActivity({
    id: 'act_reclaim_exhausted',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'worker-crashed',
    leaseUntil: NOW + 10_000,
    now: NOW
  });
  const result = runTick({
    store,
    now: NOW + 10_000,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: true, characterState: 'active' })
  });
  assert.equal(result.failed, 1);
  assert.equal(store.getActivity('act_reclaim_exhausted').status, 'failed');
});

test('stale 决策不能覆盖并发 worker 已经认领的任务', () => {
  const { store } = freshStore();
  enqueue(store, { id: 'act_stale_race', payload: { contextVersion: 1 } });
  const staleDecision = planTask(store.getActivity('act_stale_race'), {
    now: NOW,
    config: CONFIG,
    gate: () => ({ autonomyAllowed: false, reasonCode: REASON_CODES.STALE_CONTEXT, supersede: true })
  });
  assert.equal(staleDecision.action, 'supersede');

  const claimed = store.claimActivity({
    id: 'act_stale_race',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'worker-won-race',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });
  assert.ok(claimed);
  assert.equal(store.supersedeActivity({
    id: staleDecision.taskId,
    expectedAttemptCount: staleDecision.expectedAttemptCount,
    expectedStatus: staleDecision.expectedStatus,
    now: NOW
  }), false);
  assert.equal(store.getActivity('act_stale_race').status, 'running');
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
    gate: () => ({ autonomyAllowed: true, characterState: 'active', latestContextVersion: 1 }),
    executorAvailable: true
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


const GATE_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const GATE_POLICY_CONFIG = Object.freeze({
  heartbeatTtlMs: 60_000,
  leaseDurationMs: 60_000,
  graceMs: 30_000
});

function validGateSnapshot(overrides = {}) {
  return {
    userId: 'owner',
    timeZone: 'UTC',
    schedule: {
      active: [{ start: '00:00', end: '24:00' }]
    },
    authorization: {
      globalAutonomyEnabled: true,
      characterAutonomyEnabled: null
    },
    presence: {
      devices: [],
      leases: []
    },
    policyConfig: GATE_POLICY_CONFIG,
    contextVersion: 7,
    ...overrides
  };
}

function contactTask(overrides = {}) {
  return {
    id: 'gate_contact_1',
    user_id: 'owner',
    kind: 'contact',
    character_id: 'character-a',
    payload_json: JSON.stringify({ contextVersion: 7, synthetic: true }),
    status: 'waiting',
    scheduled_at: GATE_NOW,
    attempt_count: 0,
    max_attempts: 3,
    ...overrides
  };
}

function makeGate(snapshot, options = {}) {
  const store = options.store || {
    getSchedulerGateSnapshot: () => snapshot
  };
  return createSchedulerGate({
    store,
    now: options.now || (() => GATE_NOW),
    config: options.config || GATE_POLICY_CONFIG,
    executorDeviceId: options.executorDeviceId || null
  });
}

test('scheduler gate 使用队列所属设备的用户范围，不会退回 owner', () => {
  const requested = [];
  const store = {
    getSchedulerGateSnapshot(options) {
      requested.push(options);
      return validGateSnapshot({ userId: options.userId });
    }
  };
  const gate = makeGate(null, { store });
  const allowed = gate(contactTask({ user_id: 'another-user' }));
  assert.equal(allowed.autonomyAllowed, true);
  assert.deepEqual(requested, [{ userId: 'another-user', characterId: 'character-a' }]);

  const missingTenant = gate(contactTask({ user_id: null }));
  assert.equal(missingTenant.autonomyAllowed, false);
  assert.equal(missingTenant.reasonCode, REASON_CODES.GATE_DATA_MISSING);
  assert.equal(requested.length, 1, '缺少设备用户归属时不得读取任何用户的快照');

  const mismatchedSnapshot = makeGate(validGateSnapshot({ userId: 'owner' }), {
    store: {
      getSchedulerGateSnapshot() {
        return validGateSnapshot({ userId: 'owner' });
      }
    }
  })(contactTask({ user_id: 'another-user' }));
  assert.equal(mismatchedSnapshot.autonomyAllowed, false);
  assert.equal(mismatchedSnapshot.reasonCode, REASON_CODES.GATE_DATA_MISSING);
});

test('本机执行器只能在自己持有有效前台心跳与角色租约时通过门禁', () => {
  const snapshot = validGateSnapshot({
    contextSourceDeviceId: 'device_local_executor',
    presence: {
      devices: [{
        deviceId: 'device_local_executor',
        userId: 'owner',
        authorized: true,
        foregroundActive: true,
        lastHeartbeatAt: GATE_NOW
      }],
      leases: [{
        deviceId: 'device_local_executor',
        userId: 'owner',
        characterId: 'character-a',
        authorized: true,
        leaseUntil: GATE_NOW + 60_000
      }]
    }
  });

  const localGate = makeGate(snapshot, { executorDeviceId: 'device_local_executor' });
  const localTask = contactTask({
    payload_json: JSON.stringify({ contextVersion: 7, sourceDeviceId: 'device_local_executor' })
  });
  const allowed = localGate(localTask);
  assert.equal(allowed.autonomyAllowed, true);
  assert.equal(allowed.characterState, 'active');
  assert.equal(allowed.latestContextVersion, 7);

  const wrongContextDevice = makeGate(snapshot, { executorDeviceId: 'device_other_executor' })(localTask);
  assert.equal(wrongContextDevice.autonomyAllowed, false);
  assert.equal(wrongContextDevice.reasonCode, REASON_CODES.DEVICE_CONTEXT_NOT_LOCAL);

  const noLease = makeGate(validGateSnapshot({
    contextSourceDeviceId: 'device_local_executor',
    presence: {
      devices: snapshot.presence.devices,
      leases: []
    }
  }), { executorDeviceId: 'device_local_executor' })(localTask);
  assert.equal(noLease.autonomyAllowed, false);
  assert.equal(noLease.reasonCode, REASON_CODES.DEVICE_EXECUTOR_LEASE_REQUIRED);

  const cloudGate = makeGate(snapshot)(localTask);
  assert.equal(cloudGate.autonomyAllowed, false);
  assert.equal(cloudGate.reasonCode, REASON_CODES.FOREGROUND_LEASE_HELD);
  const staleSource = makeGate(validGateSnapshot({
    contextSourceDeviceId: 'device_newer_context',
    presence: snapshot.presence
  }), { executorDeviceId: 'device_local_executor' })(localTask);
  assert.equal(staleSource.autonomyAllowed, false);
  assert.equal(staleSource.reasonCode, REASON_CODES.STALE_CONTEXT);
  assert.equal(staleSource.supersede, true);
});

test('scheduler gate 缺少持久化数据源时明确 fail-closed', () => {
  const gate = makeGate(null, { store: {} });
  const result = gate(contactTask());
  assert.equal(result.autonomyAllowed, false);
  assert.equal(result.reasonCode, REASON_CODES.GATE_DATA_SOURCE_MISSING);
});

test('scheduler gate 对缺失快照和读取异常分别 fail-closed', () => {
  const missing = makeGate(null)(contactTask());
  assert.equal(missing.reasonCode, REASON_CODES.GATE_DATA_MISSING);

  const broken = makeGate(null, {
    store: { getSchedulerGateSnapshot() { throw new Error('synthetic read failure'); } }
  })(contactTask());
  assert.equal(broken.reasonCode, REASON_CODES.GATE_PROVIDER_ERROR);
});

test('scheduler gate 只在明确全局授权、角色继承授权、active 作息和同版本上下文时放行', () => {
  const result = makeGate(validGateSnapshot())(contactTask());
  assert.equal(result.autonomyAllowed, true);
  assert.equal(result.characterState, 'active');
  assert.equal(result.latestContextVersion, 7);
  assert.equal(result.policyChecked, true);
});

test('scheduler gate 拒绝全局未授权和角色显式关闭', () => {
  const globalOff = makeGate(validGateSnapshot({
    authorization: { globalAutonomyEnabled: false, characterAutonomyEnabled: true }
  }))(contactTask());
  assert.equal(globalOff.autonomyAllowed, false);
  assert.equal(globalOff.reasonCode, REASON_CODES.AUTONOMY_DENIED);

  const roleOff = makeGate(validGateSnapshot({
    authorization: { globalAutonomyEnabled: true, characterAutonomyEnabled: false }
  }))(contactTask());
  assert.equal(roleOff.autonomyAllowed, false);
  assert.equal(roleOff.reasonCode, REASON_CODES.AUTONOMY_DENIED);
});

test('scheduler gate 拒绝无 active 作息、无效时区和不允许的角色状态', () => {
  const noSchedule = makeGate(validGateSnapshot({ schedule: {} }))(contactTask());
  assert.equal(noSchedule.autonomyAllowed, false);
  assert.equal(noSchedule.reasonCode, REASON_CODES.CHARACTER_NOT_ACTIVE);

  const invalidTimeZone = makeGate(validGateSnapshot({ timeZone: 'Not/A_Real_Zone' }))(contactTask());
  assert.equal(invalidTimeZone.autonomyAllowed, false);
  assert.equal(invalidTimeZone.reasonCode, REASON_CODES.GATE_POLICY_INVALID);

  for (const state of ['busy', 'asleep', 'away']) {
    const schedule = {
      active: [{ start: '00:00', end: '24:00' }],
      [state]: [{ start: '12:00', end: '13:00' }]
    };
    const result = makeGate(validGateSnapshot({ schedule }))(contactTask());
    assert.equal(result.autonomyAllowed, false, state);
    assert.equal(result.reasonCode, REASON_CODES.CHARACTER_NOT_ACTIVE, state);
  }
});

test('任一设备持有角色前台租约时云端 defer，不受另一设备离线影响', () => {
  const result = makeGate(validGateSnapshot({
    presence: {
      devices: [{ deviceId: 'device-b', authorized: true, userId: 'owner', lastHeartbeatAt: GATE_NOW - 600_000 }],
      leases: [{
        deviceId: 'device-a',
        authorized: true,
        userId: 'owner',
        characterId: 'character-a',
        leaseUntil: GATE_NOW + 10_000
      }]
    }
  }))(contactTask());
  assert.equal(result.autonomyAllowed, false);
  assert.equal(result.reasonCode, REASON_CODES.FOREGROUND_LEASE_HELD);
});

test('前台租约 grace 期内 defer，超过 grace 且无其他 lease 后才允许', () => {
  const grace = makeGate(validGateSnapshot({
    presence: {
      devices: [],
      leases: [{
        deviceId: 'device-a',
        authorized: true,
        userId: 'owner',
        characterId: 'character-a',
        leaseUntil: GATE_NOW - 1_000
      }]
    }
  }))(contactTask());
  assert.equal(grace.autonomyAllowed, false);
  assert.equal(grace.reasonCode, REASON_CODES.FOREGROUND_LEASE_GRACE);

  const expired = makeGate(validGateSnapshot({
    presence: {
      devices: [],
      leases: [{
        deviceId: 'device-a',
        authorized: true,
        userId: 'owner',
        characterId: 'character-a',
        leaseUntil: GATE_NOW - 60_000
      }]
    }
  }))(contactTask());
  assert.equal(expired.autonomyAllowed, true);
});

test('上下文任务缺少可信版本时阻止，版本变化则作废旧任务', () => {
  const noVersion = makeGate(validGateSnapshot({ contextVersion: null }))(contactTask());
  assert.equal(noVersion.autonomyAllowed, false);
  assert.equal(noVersion.reasonCode, REASON_CODES.CONTEXT_VERSION_UNAVAILABLE);

  const taskNoVersion = makeGate(validGateSnapshot())(contactTask({
    payload_json: JSON.stringify({ synthetic: true })
  }));
  assert.equal(taskNoVersion.autonomyAllowed, false);
  assert.equal(taskNoVersion.reasonCode, REASON_CODES.CONTEXT_VERSION_UNAVAILABLE);

  const stale = makeGate(validGateSnapshot({ contextVersion: 8 }))(contactTask());
  assert.equal(stale.autonomyAllowed, false);
  assert.equal(stale.supersede, true);
  assert.equal(stale.reasonCode, REASON_CODES.STALE_CONTEXT);
});

test('runTick 真实调用 scheduler gate；仅合成且合格的同版本任务可被 CAS 认领', () => {
  const { store, query } = freshStore();
  store.insertDevice({
    id: 'dev_test',
    userId: 'owner',
    secretHash: 'synthetic-test-hash',
    now: NOW
  });
  enqueue(store, {
    id: 'act_gate_integration',
    kind: 'contact',
    payload: { contextVersion: 7, synthetic: true }
  });
  store.getSchedulerGateSnapshot = () => validGateSnapshot();

  const result = runTick({
    store,
    now: GATE_NOW,
    config: CONFIG,
    gate: createSchedulerGate({
      store,
      now: () => GATE_NOW,
      config: GATE_POLICY_CONFIG
    }),
    executorAvailable: true
  });

  assert.equal(result.claimed, 1);
  assert.equal(store.getActivity('act_gate_integration').status, 'running');
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 0);
  assert.equal(query('SELECT COUNT(*) AS total FROM push_deliveries')[0].total, 0);
});

test('runTick 将 context version 变化的任务标记 superseded，不认领', () => {
  const { store } = freshStore();
  store.insertDevice({
    id: 'dev_test',
    userId: 'owner',
    secretHash: 'synthetic-test-hash',
    now: NOW
  });
  enqueue(store, {
    id: 'act_gate_stale',
    kind: 'contact',
    payload: { contextVersion: 7, synthetic: true }
  });
  store.getSchedulerGateSnapshot = () => validGateSnapshot({ contextVersion: 8 });

  const result = runTick({
    store,
    now: GATE_NOW,
    config: CONFIG,
    gate: createSchedulerGate({
      store,
      now: () => GATE_NOW,
      config: GATE_POLICY_CONFIG
    })
  });

  assert.equal(result.claimed, 0);
  assert.equal(result.superseded, 1);
  assert.equal(store.getActivity('act_gate_stale').status, 'superseded');
});


test('真实 SQLite store gate snapshot 只读取非聊天元数据，缺少上下文版本保持 null', () => {
  const { store } = freshStore();
  const empty = store.getSchedulerGateSnapshot({ userId: 'owner', characterId: 'char-real' });
  assert.equal(empty.authorization.globalAutonomyEnabled, false);
  assert.equal(empty.authorization.characterAutonomyEnabled, null);
  assert.equal(empty.schedule, null);
  assert.equal(empty.contextVersion, null);
  assert.deepEqual(empty.presence.devices, []);
  assert.deepEqual(empty.presence.leases, []);

  store.setUserAutonomy('owner', true, NOW);
  store.setCharacterAutonomy('owner', 'char-real', null, NOW);
  store.setCharacterSchedule('owner', 'char-real', 'UTC', {
    active: [{ startMinute: 0, endMinute: 1440 }],
    busy: [],
    asleep: []
  }, NOW);

  const configured = store.getSchedulerGateSnapshot({ userId: 'owner', characterId: 'char-real' });
  assert.equal(configured.authorization.globalAutonomyEnabled, true);
  assert.equal(configured.authorization.characterAutonomyEnabled, null);
  assert.equal(configured.schedule.active.length, 1);
  assert.equal(configured.timeZone, 'UTC');
  assert.equal(configured.contextVersion, null, '不得从时间戳或任务字段伪造服务端上下文版本');
});

test('真实 SQLite due queue 将任务绑定到设备所属用户，孤儿任务保持 fail-closed', () => {
  const { store } = freshStore();
  store.insertDevice({
    id: 'device_other_account',
    userId: 'another-user',
    secretHash: 'synthetic-other-account-hash',
    now: GATE_NOW
  });
  store.setUserAutonomy('another-user', true, GATE_NOW);
  store.setCharacterAutonomy('another-user', 'character-other', null, GATE_NOW);
  store.setCharacterSchedule('another-user', 'character-other', 'UTC', {
    active: [{ startMinute: 0, endMinute: 1440 }],
    busy: [],
    asleep: []
  }, GATE_NOW);
  store.enqueueActivity({
    id: 'activity_other_account',
    deviceId: 'device_other_account',
    characterId: 'character-other',
    kind: 'contact',
    scheduledAt: GATE_NOW,
    maxAttempts: 3,
    now: GATE_NOW,
    payload: { contextVersion: 1, synthetic: true }
  });
  store.enqueueActivity({
    id: 'activity_orphan_device',
    deviceId: 'device_that_does_not_exist',
    characterId: 'character-other',
    kind: 'contact',
    scheduledAt: GATE_NOW,
    maxAttempts: 3,
    now: GATE_NOW,
    payload: { contextVersion: 1, synthetic: true }
  });
  store.insertDevice({
    id: 'device_revoked_account',
    userId: 'another-user',
    secretHash: 'synthetic-revoked-device-hash',
    now: GATE_NOW
  });
  store.enqueueActivity({
    id: 'activity_revoked_device',
    deviceId: 'device_revoked_account',
    characterId: 'character-other',
    kind: 'contact',
    scheduledAt: GATE_NOW,
    maxAttempts: 3,
    now: GATE_NOW,
    payload: { contextVersion: 1, synthetic: true }
  });
  store.revokeDevice('device_revoked_account', GATE_NOW);

  const tasks = store.listDueActivities(GATE_NOW, 10);
  const otherTask = tasks.find(task => task.id === 'activity_other_account');
  const orphanTask = tasks.find(task => task.id === 'activity_orphan_device');
  const revokedTask = tasks.find(task => task.id === 'activity_revoked_device');
  assert.equal(otherTask.user_id, 'another-user');
  assert.equal(revokedTask.source_device_revoked_at, GATE_NOW);

  const gate = createSchedulerGate({
    store,
    now: () => GATE_NOW,
    config: GATE_POLICY_CONFIG
  });
  const otherResult = gate(otherTask);
  assert.equal(otherResult.reasonCode, REASON_CODES.CONTEXT_VERSION_UNAVAILABLE,
    '应读取 another-user 的已开启授权与作息，而不是 owner 的关闭授权');
  const orphanResult = gate(orphanTask);
  assert.equal(orphanResult.reasonCode, REASON_CODES.GATE_DATA_MISSING);
  const revokedResult = gate(revokedTask);
  assert.equal(revokedResult.reasonCode, REASON_CODES.SOURCE_DEVICE_REVOKED);
  assert.equal(revokedResult.supersede, true);

  const tick = runTick({
    store,
    now: GATE_NOW,
    config: CONFIG,
    gate,
    executorAvailable: true
  });
  assert.equal(tick.claimed, 0);
  assert.equal(tick.superseded, 1);
  assert.equal(store.getActivity('activity_revoked_device').status, 'superseded');
  assert.equal(store.getActivity('activity_other_account').status, 'waiting');
  assert.equal(store.getActivity('activity_orphan_device').status, 'waiting');
});

test('真实 SQLite store snapshot 不会把后台心跳视为前台活跃设备', () => {
  const { store } = freshStore();
  store.insertDevice({
    id: 'device_background_123',
    secretHash: 'hash-only-test',
    label: '',
    platform: '',
    userAgent: '',
    ipHash: '',
    now: NOW
  });
  store.upsertDevicePresence({
    userId: 'owner',
    deviceId: 'device_background_123',
    foregroundActive: false,
    now: NOW
  });

  const snapshot = store.getSchedulerGateSnapshot({ userId: 'owner', characterId: 'char-real' });
  assert.equal(snapshot.presence.devices[0].foregroundActive, false);
  assert.equal(snapshot.presence.devices[0].lastHeartbeatAt, 0);
});


test('真实 SQLite 角色上下文版本接入 gate：同版本允许、旧版本作废、未跟踪角色拒绝', () => {
  const { store } = freshStore();
  const gate = createSchedulerGate({
    store,
    now: () => GATE_NOW,
    config: GATE_POLICY_CONFIG
  });
  const noSchedule = gate(contactTask());
  assert.equal(noSchedule.autonomyAllowed, false);
  assert.equal(noSchedule.reasonCode, REASON_CODES.GATE_DATA_MISSING);

  store.setUserAutonomy('owner', true, GATE_NOW);
  store.setCharacterAutonomy('owner', 'character-a', null, GATE_NOW);
  store.setCharacterSchedule('owner', 'character-a', 'UTC', {
    active: [{ startMinute: 0, endMinute: 1440 }],
    busy: [],
    asleep: []
  }, GATE_NOW);

  const noServerVersion = gate(contactTask({
    payload_json: JSON.stringify({ contextVersion: 1 })
  }));
  assert.equal(noServerVersion.autonomyAllowed, false);
  assert.equal(noServerVersion.reasonCode, REASON_CODES.CONTEXT_VERSION_UNAVAILABLE);

  const recorded = store.recordCharacterContextEvent({
    userId: 'owner',
    characterId: 'character-a',
    eventId: 'scheduler_context_event_0001',
    deviceId: 'device_context_test_0001',
    now: GATE_NOW
  });
  assert.equal(recorded.version, 1);

  const matching = gate(contactTask({
    payload_json: JSON.stringify({ contextVersion: 1 })
  }));
  assert.equal(matching.autonomyAllowed, true);
  assert.equal(matching.characterState, 'active');
  assert.equal(matching.latestContextVersion, 1);

  const stale = gate(contactTask({
    payload_json: JSON.stringify({ contextVersion: 0 })
  }));
  assert.equal(stale.autonomyAllowed, false);
  assert.equal(stale.supersede, true);
  assert.equal(stale.reasonCode, REASON_CODES.STALE_CONTEXT);

  const untrackedRole = gate(contactTask({
    character_id: 'character-b',
    payload_json: JSON.stringify({ contextVersion: 1 })
  }));
  assert.equal(untrackedRole.autonomyAllowed, false);
  assert.equal(untrackedRole.reasonCode, REASON_CODES.CONTEXT_VERSION_UNAVAILABLE);
});


test('活动幂等键跨同账号配对设备去重，且由实际执行设备接管收件归属', () => {
  const { store, query } = freshStore();
  store.insertDevice({ id: 'device_source_123456', userId: 'owner', secretHash: 'a', now: NOW });
  store.insertDevice({ id: 'device_runner_123456', userId: 'owner', secretHash: 'b', now: NOW });

  const activity = {
    id: 'act_owner_context_0001',
    deviceId: 'device_source_123456',
    characterId: 'char_test',
    kind: 'contact',
    scheduledAt: NOW,
    maxAttempts: 3,
    payload: { contextVersion: 7 },
    dedupeKey: 'autonomy-v1:owner:char_test:contact:7',
    now: NOW
  };
  const first = store.enqueueActivity(activity);
  const duplicateFromOtherDevice = store.enqueueActivity({
    ...activity,
    id: 'act_other_device_0002',
    deviceId: 'device_runner_123456'
  });
  assert.equal(first.inserted, true);
  assert.equal(duplicateFromOtherDevice.duplicate, true);
  assert.equal(duplicateFromOtherDevice.activity.id, first.activity.id);
  assert.equal(query('SELECT COUNT(*) AS total FROM activity_queue')[0].total, 1);

  const claimed = store.claimActivityForDevice({
    id: first.activity.id,
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    expectedDeviceId: 'device_source_123456',
    deviceId: 'device_runner_123456',
    userId: 'owner',
    owner: 'device_runner_123456',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });
  assert.ok(claimed);
  assert.equal(claimed.device_id, 'device_runner_123456');
  assert.equal(claimed.locked_by, 'device_runner_123456');
  assert.equal(claimed.attempt_count, 1);

  const completed = store.completeActivityWithOutbound({
    id: claimed.id,
    owner: 'device_runner_123456',
    attemptCount: 1,
    now: NOW + 1,
    serverMessageId: 'autonomy_act_owner_context_0001_1',
    dedupeKey: 'autonomy:act_owner_context_0001:1',
    payload: { type: 'text', text: '本机模型生成的主动消息' }
  });
  assert.equal(completed.completed, true);
  assert.equal(completed.outboundInserted, true);

  const repeated = store.completeActivityWithOutbound({
    id: claimed.id,
    owner: 'device_runner_123456',
    attemptCount: 1,
    now: NOW + 2,
    serverMessageId: 'autonomy_act_owner_context_0001_1',
    dedupeKey: 'autonomy:act_owner_context_0001:1',
    payload: { type: 'text', text: '本机模型生成的主动消息' }
  });
  assert.equal(repeated.alreadyCompleted, true);
  const inbox = store.listPendingOutboundMessages({
    userId: 'owner',
    deviceId: 'device_runner_123456',
    characterId: 'char_test',
    limit: 10
  });
  assert.equal(inbox.length, 1);
  assert.equal(JSON.parse(inbox[0].payload_json).text, '本机模型生成的主动消息');
});

test('活动幂等冲突不允许用不同载荷覆盖原任务', () => {
  const { store } = freshStore();
  store.insertDevice({ id: 'device_source_123456', userId: 'owner', secretHash: 'a', now: NOW });
  const first = store.enqueueActivity({
    id: 'act_immutable_context_0001',
    deviceId: 'device_source_123456',
    characterId: 'char_test',
    kind: 'contact',
    scheduledAt: NOW,
    maxAttempts: 3,
    payload: { contextVersion: 7 },
    dedupeKey: 'autonomy-v1:owner:char_test:contact:7',
    now: NOW
  });
  const conflict = store.enqueueActivity({
    id: 'act_immutable_context_0002',
    deviceId: 'device_source_123456',
    characterId: 'char_test',
    kind: 'contact',
    scheduledAt: NOW,
    maxAttempts: 3,
    payload: { contextVersion: 8 },
    dedupeKey: 'autonomy-v1:owner:char_test:contact:7',
    now: NOW
  });
  assert.equal(first.inserted, true);
  assert.equal(conflict.conflict, true);
  assert.deepEqual(JSON.parse(store.getActivity('act_immutable_context_0001').payload_json), { contextVersion: 7 });
});


test('活动结果先不可变落库，收件箱短暂失败后可用同一正文幂等修复', () => {
  const { store, query } = freshStore();
  store.insertDevice({
    id: 'device_recovery_123456',
    userId: 'owner',
    secretHash: 'recovery-test',
    now: NOW
  });
  const queued = store.enqueueActivity({
    id: 'act_result_recovery_0001',
    deviceId: 'device_recovery_123456',
    characterId: 'char_recovery',
    kind: 'contact',
    scheduledAt: NOW,
    maxAttempts: 3,
    payload: { contextVersion: 7 },
    dedupeKey: 'autonomy-v1:owner:char_recovery:contact:7',
    now: NOW
  });
  assert.equal(queued.inserted, true);
  const claimed = store.claimActivity({
    id: queued.activity.id,
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner: 'device_recovery_123456',
    leaseUntil: NOW + CONFIG.leaseMs,
    now: NOW
  });
  assert.ok(claimed);

  const originalEnqueue = store.enqueueOutboundMessage.bind(store);
  let rejectOnce = true;
  store.enqueueOutboundMessage = message => {
    if (rejectOnce) {
      rejectOnce = false;
      return { inserted: false, conflict: true, message: null };
    }
    return originalEnqueue(message);
  };

  const result = {
    id: claimed.id,
    owner: 'device_recovery_123456',
    attemptCount: 1,
    serverMessageId: 'autonomy_act_result_recovery_0001_1',
    dedupeKey: 'autonomy:act_result_recovery_0001:1',
    payload: { type: 'text', text: '这条生成结果必须保持不变。' }
  };
  assert.equal(store.completeActivityWithOutbound({ ...result, now: NOW + 1 }), null);
  const staged = store.getActivity(claimed.id);
  assert.equal(staged.status, 'completed');
  assert.equal(staged.result_server_message_id, result.serverMessageId);
  assert.deepEqual(JSON.parse(staged.result_json), result.payload);
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 0);

  const wrongDeviceRepair = store.repairStagedActivityOutbox({
    userId: 'owner',
    deviceId: 'device_other_123456',
    characterId: 'char_recovery',
    now: NOW + 2,
    limit: 10
  });
  assert.deepEqual(wrongDeviceRepair, { repaired: 0, deferred: 0 });

  const repaired = store.repairStagedActivityOutbox({
    userId: 'owner',
    deviceId: 'device_recovery_123456',
    characterId: 'char_recovery',
    now: NOW + 2,
    limit: 10
  });
  assert.deepEqual(repaired, { repaired: 1, deferred: 0 });
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 1);

  const repeated = store.completeActivityWithOutbound({ ...result, now: NOW + 3 });
  assert.equal(repeated.completed, true);
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal(repeated.outboundInserted, false);
  assert.equal(repeated.outboundIdempotent, true);

  const changedText = store.completeActivityWithOutbound({
    ...result,
    now: NOW + 3,
    payload: { type: 'text', text: '不允许替换已经暂存的结果。' }
  });
  assert.equal(changedText, null);
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 1);
});


test('全局维护可从不可变暂存结果恢复收件箱，且不会恢复已撤销设备的内容', () => {
  const { store, query } = freshStore();
  store.insertDevice({
    id: 'device_maintenance_123',
    userId: 'owner',
    secretHash: 'maintenance-test',
    now: NOW
  });
  store.insertDevice({
    id: 'device_revoked_456',
    userId: 'owner',
    secretHash: 'revoked-test',
    now: NOW
  });

  const prepareStaged = (id, deviceId, characterId, messageText) => {
    const queued = store.enqueueActivity({
      id,
      deviceId,
      characterId,
      kind: 'contact',
      scheduledAt: NOW,
      maxAttempts: 3,
      payload: { contextVersion: 1 },
      dedupeKey: 'maintenance:' + id,
      now: NOW
    });
    const claimed = store.claimActivity({
      id: queued.activity.id,
      expectedAttemptCount: 0,
      expectedStatus: 'waiting',
      owner: deviceId,
      leaseUntil: NOW + CONFIG.leaseMs,
      now: NOW
    });
    assert.ok(claimed);
    const staged = store.completeActivityWithOutbound({
      id,
      owner: deviceId,
      attemptCount: 1,
      now: NOW + 1,
      serverMessageId: 'autonomy_' + id + '_1',
      dedupeKey: 'autonomy:' + id + ':1',
      payload: { type: 'text', text: messageText }
    });
    assert.equal(staged.completed, true);
  };

  prepareStaged('act_maintenance_recovery_01', 'device_maintenance_123', 'char-maintenance',
    '可由后台维护恢复的消息。');
  prepareStaged('act_revoked_recovery_01', 'device_revoked_456', 'char-revoked',
    '撤销设备的消息不得重新出站。');

  store.revokeDevice('device_revoked_456', NOW + 2);
  const recovery = store.repairAllStagedActivityOutboxes({ now: NOW + 3, limit: 20 });
  assert.deepEqual(recovery, { scanned: 1, repaired: 1, deferred: 0 });
  assert.equal(query('SELECT COUNT(*) AS total FROM outbound_messages')[0].total, 1);
  assert.equal(store.getOutboundMessage('autonomy_act_maintenance_recovery_01_1').server_message_id,
    'autonomy_act_maintenance_recovery_01_1');
});
