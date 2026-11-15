/**
 * 云端调度 tick 骨架。
 *
 * 只做：读取到期活动 -> 纯逻辑决策 -> 认领/作废/延后 -> 写执行日志。
 * 不做：调用模型、生成或读取聊天正文、上传数据、真实推送。
 *
 * gate 未提供时整体 fail-closed（所有活动延后），因此生产环境在授权数据
 * 和配置值未确认前不会真正执行任何活动。
 */

import { planTick, REASON_CODES, validateConfig, nextRetryAt } from './scheduler-policy.js';

function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `tick_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function log(store, now, status, reasonCode, detail, deviceId = null) {
  store.logExecution({
    id: makeId(),
    deviceId,
    kind: 'autonomy_tick',
    status,
    reasonCode,
    detail: detail || {},
    durationMs: 0,
    now
  });
}

export function runTick({ store, now, config, gate = null, owner = 'cloud', executorAvailable = false } = {}) {
  const validated = validateConfig(config);
  if (!validated.ok) {
    log(store, now, 'skipped', validated.reason, {});
    return { ok: false, reason: validated.reason, due: 0, claimed: 0, deferred: 0, superseded: 0, failed: 0, lost: 0 };
  }

  const tasks = store.listDueActivities(now, validated.config.tickLimit);
  const decisions = planTick(tasks, {
    now,
    config: validated.config,
    gate,
    owner
  });

  const summary = { ok: true, due: tasks.length, claimed: 0, deferred: 0, superseded: 0, failed: 0, lost: 0 };
  const taskDeviceById = new Map(tasks.map(task => [task.id, task.device_id || null]));

  for (const decision of decisions) {
    const deviceId = taskDeviceById.get(decision.taskId) || null;
    if (decision.action === 'claim') {
      // The current Worker has no message-generation executor. Do not reserve
      // a task and leave it in "running" until an executor is actually wired.
      if (executorAvailable !== true) {
        if (decision.expectedStatus === 'running') {
          const released = store.releaseExpiredActivity({
            id: decision.taskId,
            expectedAttemptCount: decision.expectedAttemptCount,
            expectedLockedBy: decision.expectedLockedBy,
            expectedLockedUntil: decision.expectedLockedUntil,
            now
          });
          if (!released) {
            summary.lost += 1;
            log(store, now, 'deferred', REASON_CODES.CLAIM_LOST, { taskId: decision.taskId }, deviceId);
            continue;
          }
        }
        summary.deferred += 1;
        log(store, now, 'deferred', REASON_CODES.EXECUTOR_UNAVAILABLE, {
          taskId: decision.taskId,
          releasedExpiredLease: decision.expectedStatus === 'running'
        }, deviceId);
        continue;
      }

      const claimed = store.claimActivity({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        owner: decision.owner,
        leaseUntil: decision.leaseUntil,
        now
      });
      if (claimed) {
        summary.claimed += 1;
        log(store, now, 'claimed', REASON_CODES.CLAIMED, {
          taskId: decision.taskId,
          attemptCount: decision.attemptCount
        }, deviceId);
      } else {
        summary.lost += 1;
        log(store, now, 'deferred', REASON_CODES.CLAIM_LOST, { taskId: decision.taskId }, deviceId);
      }
      continue;
    }

    if (decision.action === 'fail') {
      const failed = store.failExhaustedActivity({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        expectedLockedBy: decision.expectedLockedBy,
        expectedLockedUntil: decision.expectedLockedUntil,
        now
      });
      if (failed) summary.failed += 1;
      else summary.lost += 1;
      log(store, now, failed ? 'failed' : 'deferred',
        failed ? decision.reason : REASON_CODES.CLAIM_LOST,
        { taskId: decision.taskId }, deviceId);
      continue;
    }

    if (decision.action === 'supersede') {
      const superseded = store.supersedeActivity({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        now
      });
      if (superseded) {
        summary.superseded += 1;
        log(store, now, 'superseded', decision.reason, { taskId: decision.taskId }, deviceId);
      } else {
        summary.lost += 1;
        log(store, now, 'deferred', REASON_CODES.CLAIM_LOST, { taskId: decision.taskId }, deviceId);
      }
      continue;
    }

    summary.deferred += 1;
    log(store, now, 'deferred', decision.reason, { taskId: decision.taskId }, deviceId);
  }

  return summary;
}

export { nextRetryAt, REASON_CODES };
