/**
 * 云端自主活动调度纯逻辑（M2.2 骨架）。
 *
 * 约束：
 *  - 不依赖 Durable Object、DOM、网络或持久化，可直接单元测试。
 *  - 心跳/租约/重试/批量等时间参数必须由调用方显式传入，不内置产品默认值。
 *  - 只做"是否到期、是否可认领、是否应作废"的判定，不生成消息、不推送。
 */

export const REASON_CODES = Object.freeze({
  MISSING_CONFIG: 'missing_config',
  INVALID_CONFIG: 'invalid_config',
  INVALID_TASK: 'invalid_task',
  NOT_DUE: 'not_due',
  LEASE_HELD: 'task_lease_held',
  RETRY_EXHAUSTED: 'retry_exhausted',
  AUTONOMY_DENIED: 'autonomy_denied',
  CHARACTER_NOT_ACTIVE: 'character_not_active',
  STALE_CONTEXT: 'stale_context',
  SUPERSEDED: 'superseded',
  CLAIMED: 'claimed',
  CLAIM_LOST: 'claim_lost',
  GATE_DATA_SOURCE_MISSING: 'gate_data_source_missing',
  GATE_DATA_MISSING: 'gate_data_missing',
  GATE_PROVIDER_ERROR: 'gate_provider_error',
  GATE_POLICY_UNAVAILABLE: 'gate_policy_unavailable',
  GATE_POLICY_INVALID: 'gate_policy_invalid',
  FOREGROUND_LEASE_HELD: 'foreground_lease_held',
  FOREGROUND_LEASE_GRACE: 'foreground_lease_grace',
  CONTEXT_VERSION_UNAVAILABLE: 'context_version_unavailable'
});

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * 校验调度配置。缺失与非法分开返回，便于日志区分运维问题与代码问题。
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ok: false, reason: REASON_CODES.MISSING_CONFIG };
  }
  if (!hasOwn(config, 'leaseMs') || !hasOwn(config, 'tickLimit') || !hasOwn(config, 'retryBackoffMs')) {
    return { ok: false, reason: REASON_CODES.MISSING_CONFIG };
  }
  const leaseMs = Number(config.leaseMs);
  const tickLimit = Number(config.tickLimit);
  const backoff = Array.isArray(config.retryBackoffMs)
    ? config.retryBackoffMs.map(Number)
    : null;
  if (!isPositiveInteger(leaseMs) || !isPositiveInteger(tickLimit)) {
    return { ok: false, reason: REASON_CODES.INVALID_CONFIG };
  }
  if (!backoff || backoff.length === 0 || !backoff.every(isPositiveInteger)) {
    return { ok: false, reason: REASON_CODES.INVALID_CONFIG };
  }
  return {
    ok: true,
    config: {
      leaseMs,
      tickLimit,
      retryBackoffMs: backoff.slice()
    }
  };
}

/** 幂等键：同一设备、角色、活动类型、时间桶只应产生一条活动。 */
export function buildDedupeKey({ deviceId, characterId, kind, bucket } = {}) {
  if (!deviceId || !characterId || !kind || !Number.isInteger(bucket)) return null;
  return ['v1', deviceId, characterId, kind, String(bucket)]
    .map(value => encodeURIComponent(String(value)))
    .join('|');
}

function readContextVersion(task) {
  let payload = task?.payload == null ? task?.payload_json : task.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;
  const value = Number(payload.contextVersion);
  return Number.isInteger(value) ? value : null;
}

/**
 * 活动是否到期。租约未过期只表示"其他人正在处理"，不是到期判定。
 */
export function evaluateTask(task, { now } = {}) {
  if (!Number.isFinite(now) || now <= 0) return { due: false, reason: REASON_CODES.INVALID_TASK };
  if (!task || typeof task.id !== 'string' || !task.id) {
    return { due: false, reason: REASON_CODES.INVALID_TASK };
  }
  if (task.status === 'superseded' || task.status === 'completed' || task.status === 'failed') {
    return { due: false, reason: REASON_CODES.SUPERSEDED };
  }
  const reclaimingExpiredRun = task.status === 'running' &&
    task.locked_until != null && Number(task.locked_until) <= now;
  if (task.status !== 'waiting' && task.status !== 'retry' && !reclaimingExpiredRun) {
    return { due: false, reason: REASON_CODES.NOT_DUE };
  }
  if (task.locked_until != null && Number(task.locked_until) > now) {
    return { due: false, reason: REASON_CODES.LEASE_HELD };
  }
  const dueAt = Number(task.next_attempt_at == null ? task.scheduled_at : task.next_attempt_at);
  if (!Number.isFinite(dueAt)) return { due: false, reason: REASON_CODES.INVALID_TASK };
  if (now < dueAt) return { due: false, reason: REASON_CODES.NOT_DUE };
  const attempts = Number(task.attempt_count || 0);
  const maxAttempts = Number(task.max_attempts || 0);
  if (maxAttempts > 0 && attempts >= maxAttempts) {
    return { due: false, reason: REASON_CODES.RETRY_EXHAUSTED };
  }
  return { due: true, reason: REASON_CODES.CLAIMED };
}

/**
 * 单个活动的调度决策。gate 为授权/作息快照提供者；缺失时 fail-closed。
 * gate(task) => { autonomyAllowed, characterState, latestContextVersion }
 */
export function planTask(task, { now, config, gate, owner = 'cloud' } = {}) {
  const validated = validateConfig(config);
  if (!validated.ok) return { action: 'defer', reason: validated.reason, taskId: task?.id || null };

  const due = evaluateTask(task, { now });
  if (!due.due) {
    return {
      action: 'defer',
      reason: due.reason,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }

  if (typeof gate !== 'function') {
    return {
      action: 'defer',
      reason: REASON_CODES.AUTONOMY_DENIED,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }

  let snapshot;
  try {
    snapshot = gate(task, { now, config: validated.config }) || {};
  } catch (error) {
    return {
      action: 'defer',
      reason: REASON_CODES.GATE_PROVIDER_ERROR,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }

  if (snapshot.supersede === true || snapshot.reasonCode === REASON_CODES.STALE_CONTEXT) {
    return {
      action: 'supersede',
      reason: REASON_CODES.STALE_CONTEXT,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0),
      expectedStatus: task.status
    };
  }

  if (snapshot.autonomyAllowed !== true) {
    return {
      action: 'defer',
      reason: snapshot.reasonCode || REASON_CODES.AUTONOMY_DENIED,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }
  if (snapshot.characterState !== 'active') {
    return {
      action: 'defer',
      reason: snapshot.reasonCode || REASON_CODES.CHARACTER_NOT_ACTIVE,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }

  const taskVersion = readContextVersion(task);
  const latestVersion = Number(snapshot.latestContextVersion);
  if (taskVersion != null && Number.isInteger(latestVersion) && latestVersion > taskVersion) {
    return {
      action: 'supersede',
      reason: REASON_CODES.STALE_CONTEXT,
      taskId: task.id,
      expectedAttemptCount: Number(task.attempt_count || 0)
    };
  }

  const attemptCount = Number(task.attempt_count || 0) + 1;
  return {
    action: 'claim',
    reason: REASON_CODES.CLAIMED,
    taskId: task.id,
    expectedAttemptCount: Number(task.attempt_count || 0),
    attemptCount,
    leaseUntil: now + validated.config.leaseMs,
    owner
  };
}

export function planTick(tasks, options = {}) {
  return (Array.isArray(tasks) ? tasks : []).map(task => planTask(task, options));
}

/**
 * 认领失败后的下一次重试时间。attemptCount 为认领后的次数（从 1 开始）。
 * 超过 maxAttempts 返回 null，调用方应把活动置为 failed。
 */
export function nextRetryAt({ attemptCount, now, retryBackoffMs, maxAttempts } = {}) {
  const attempt = Number(attemptCount);
  const max = Number(maxAttempts);
  if (!isPositiveInteger(attempt) || !Number.isFinite(now) || !Array.isArray(retryBackoffMs)) return null;
  if (!Number.isFinite(max) || max <= 0 || attempt >= max) return null;
  const index = Math.min(attempt, retryBackoffMs.length) - 1;
  const delay = Number(retryBackoffMs[index]);
  if (!isPositiveInteger(delay)) return null;
  return now + delay;
}
