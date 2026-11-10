/**
 * Cloud-side autonomous message executor.
 *
 * It claims only due, already-authorized contact tasks; rechecks the role
 * schedule, foreground leases, consent and context version before committing.
 * Model input is a bounded snapshot and model output is stored as 1..4
 * independently identified outbound rows before push dispatch. The exact
 * source device and current snapshot are revalidated after the model call.
 */
import { planTask, validateConfig, nextRetryAt, REASON_CODES } from './scheduler-policy.js';
import { createSchedulerGate } from './scheduler-gate.js';
import { generateAutonomousMessages, readAutonomyModelConfig } from './model-executor.js';

const OWNER = 'cloud_model_executor';

function positive(env, name) {
  const value = Number(env?.[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readTickConfig(env) {
  const leaseMs = positive(env, 'AUTONOMY_LEASE_MS');
  const tickLimit = positive(env, 'AUTONOMY_TICK_LIMIT');
  const retryBackoffMs = String(env?.AUTONOMY_RETRY_BACKOFF_MS || '')
    .split(',').map(value => Number(value.trim())).filter(Number.isFinite);
  if (!leaseMs || !tickLimit || tickLimit > 50 || !retryBackoffMs.length ||
      retryBackoffMs.length > 8 || !retryBackoffMs.every(value => Number.isSafeInteger(value) && value > 0)) {
    return null;
  }
  return { leaseMs, tickLimit, retryBackoffMs, maxAttempts: retryBackoffMs.length + 1 };
}

function readGateConfig(env) {
  const config = {};
  for (const [name, key, allowZero] of [
    ['AUTONOMY_HEARTBEAT_TTL_MS', 'heartbeatTtlMs', false],
    ['AUTONOMY_DEVICE_LEASE_MS', 'leaseDurationMs', false],
    ['AUTONOMY_DEVICE_GRACE_MS', 'graceMs', true]
  ]) {
    const raw = env?.[name];
    if (raw == null || String(raw).trim() === '') continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)) config[key] = value;
    else config[key] = NaN;
  }
  return config;
}

function log(store, now, kind, status, reasonCode, task, extra = {}) {
  return store.logExecution({
    id: 'cloudtick_' + crypto.randomUUID(),
    deviceId: task?.device_id || null,
    kind,
    status,
    reasonCode,
    detail: { activityId: task?.id || null, characterId: task?.character_id || null, ...extra },
    now
  });
}

function decodeTaskPayload(task) {
  try {
    const payload = JSON.parse(String(task.payload_json || '{}'));
    const version = Number(payload.contextVersion);
    if (!Number.isSafeInteger(version) || version < 1) return null;
    return { ...payload, contextVersion: version };
  } catch {
    return null;
  }
}

function retryTime(attempt, now, config, maxAttempts) {
  return nextRetryAt({
    attemptCount: attempt,
    now,
    retryBackoffMs: config.retryBackoffMs,
    maxAttempts
  });
}

export async function runCloudModelTick({
  store, env = {}, now = Date.now(), fetchImpl = fetch
} = {}) {
  const timestamp = Number(typeof now === 'function' ? now() : now);
  const config = readTickConfig(env);
  const modelConfigured = Boolean(readAutonomyModelConfig(env));
  const validated = validateConfig(config);
  const summary = {
    ok: Boolean(validated.ok && modelConfigured),
    due: 0, claimed: 0, generatedGroups: 0, generatedMessages: 0,
    skipped: 0, deferred: 0, superseded: 0, failed: 0, pushed: 0,
    reason: null
  };
  if (!store || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    return { ...summary, ok: false, reason: 'invalid_executor_input' };
  }
  if (!validated.ok) {
    summary.reason = validated.reason;
    log(store, timestamp, 'autonomy_cloud_tick', 'skipped', validated.reason, null);
    return summary;
  }
  if (!modelConfigured) {
    summary.reason = 'model_not_configured';
    log(store, timestamp, 'autonomy_cloud_tick', 'skipped', 'server_model_credentials_missing', null);
    return summary;
  }

  const tasks = store.listDueActivities(timestamp, validated.config.tickLimit)
    .filter(task => task.kind === 'contact');
  summary.due = tasks.length;
  const gate = createSchedulerGate({
    store,
    now: () => timestamp,
    config: readGateConfig(env)
  });

  for (const task of tasks) {
    const decision = planTask(task, {
      now: timestamp,
      config: validated.config,
      gate,
      owner: OWNER
    });
    if (decision.action === 'supersede') {
      const changed = store.supersedeActivity({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        now: timestamp
      });
      if (changed) summary.superseded += 1;
      else summary.deferred += 1;
      log(store, timestamp, 'autonomy_cloud_tick',
        changed ? 'superseded' : 'deferred',
        changed ? decision.reason : REASON_CODES.CLAIM_LOST, task);
      continue;
    }
    if (decision.action === 'fail') {
      const changed = store.failExhaustedActivity({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        expectedLockedBy: decision.expectedLockedBy,
        expectedLockedUntil: decision.expectedLockedUntil,
        now: timestamp
      });
      if (changed) summary.failed += 1;
      else summary.deferred += 1;
      log(store, timestamp, 'autonomy_cloud_tick',
        changed ? 'failed' : 'deferred', decision.reason, task);
      continue;
    }
    if (decision.action !== 'claim') {
      summary.deferred += 1;
      log(store, timestamp, 'autonomy_cloud_tick', 'deferred', decision.reason, task);
      continue;
    }

    const claimed = store.claimActivity({
      id: decision.taskId,
      expectedAttemptCount: decision.expectedAttemptCount,
      expectedStatus: decision.expectedStatus,
      owner: OWNER,
      leaseUntil: decision.leaseUntil,
      now: timestamp
    });
    if (!claimed) {
      summary.deferred += 1;
      log(store, timestamp, 'autonomy_cloud_tick', 'deferred', REASON_CODES.CLAIM_LOST, task);
      continue;
    }
    summary.claimed += 1;
    const attemptCount = Number(claimed.attempt_count);
    const payload = decodeTaskPayload(claimed);
    const userId = String(task.user_id || 'owner');
    const contextVersion = payload && payload.contextVersion;
    const snapshot = contextVersion ? store.getCharacterContextSnapshot({
      userId, characterId: claimed.character_id, contextVersion
    }) : null;

    if (!payload || !snapshot) {
      store.supersedeActivity({
        id: claimed.id,
        expectedAttemptCount: attemptCount,
        expectedStatus: 'running',
        now: timestamp
      });
      summary.superseded += 1;
      log(store, timestamp, 'autonomy_cloud_tick', 'superseded',
        'context_snapshot_missing_or_revoked', claimed);
      continue;
    }

    const generation = await generateAutonomousMessages({ env, snapshot, fetchImpl });
    if (!generation.ok) {
      const nextAttemptAt = retryTime(attemptCount, timestamp, validated.config, Number(claimed.max_attempts));
      const failed = store.failActivity({
        id: claimed.id, owner: OWNER, attemptCount, now: timestamp, nextAttemptAt
      });
      if (failed && nextAttemptAt != null) summary.deferred += 1;
      else summary.failed += 1;
      log(store, timestamp, 'autonomy_cloud_model', failed ? 'retry' : 'failed',
        generation.reason || 'model_execution_failed', claimed, { attemptCount });
      continue;
    }

    if (!generation.send) {
      const completed = store.completeActivity({
        id: claimed.id, owner: OWNER, attemptCount, now: timestamp
      });
      if (completed) summary.skipped += 1;
      else summary.deferred += 1;
      log(store, timestamp, 'autonomy_cloud_model',
        completed ? 'skipped' : 'deferred', 'no_worthy_message', claimed);
      continue;
    }

    // Recheck the exact current version and all scheduling gates after the
    // network call; a user message or a foreground chat arriving meanwhile
    // invalidates this generated result instead of delivering stale content.
    const latestVersion = store.getCharacterContextVersion(userId, claimed.character_id);
    const latestSharing = store.getUserContextSharing(userId);
    const latestSnapshot = store.getCharacterContextSnapshot({
      userId,
      characterId: claimed.character_id,
      contextVersion
    });
    const stillCurrent = latestVersion &&
      Number(latestVersion.version) === contextVersion &&
      latestSharing && Number(latestSharing.enabled) === 1 &&
      latestSnapshot &&
      latestSnapshot.source_device_id === snapshot.source_device_id &&
      String(latestVersion.updated_by_device_id || '') === snapshot.source_device_id &&
      snapshot.source_device_id === task.device_id;
    const gateAfter = stillCurrent ? gate({
      ...claimed,
      user_id: userId,
      source_device_revoked_at: null
    }) : { autonomyAllowed: false, reasonCode: 'stale_context' };

    if (!stillCurrent || gateAfter.autonomyAllowed !== true || gateAfter.characterState !== 'active') {
      const isStale = !stillCurrent || gateAfter.reasonCode === 'stale_context';
      if (isStale) {
        store.supersedeActivity({
          id: claimed.id, expectedAttemptCount: attemptCount,
          expectedStatus: 'running', now: timestamp
        });
        summary.superseded += 1;
      } else {
        const nextAttemptAt = retryTime(attemptCount, timestamp, validated.config, Number(claimed.max_attempts));
        const retried = store.failActivity({
          id: claimed.id, owner: OWNER, attemptCount, now: timestamp, nextAttemptAt
        });
        if (retried && nextAttemptAt != null) summary.deferred += 1;
        else summary.failed += 1;
      }
      log(store, timestamp, 'autonomy_cloud_model',
        isStale ? 'superseded' : 'deferred',
        gateAfter.reasonCode || 'execution_gate_changed', claimed);
      continue;
    }

    const groupId = 'cloudgrp_' + claimed.id + '_' + attemptCount;
    const messages = generation.messages.map((text, index) => ({
      serverMessageId: groupId + '_' + String(index + 1).padStart(2, '0'),
      dedupeKey: groupId + ':' + String(index + 1),
      payload: { type: 'text', text }
    }));
    const completed = store.completeCloudActivityWithOutboundGroup({
      id: claimed.id,
      owner: OWNER,
      attemptCount,
      now: timestamp,
      groupId,
      messages
    });
    if (!completed || completed.completed !== true) {
      summary.failed += 1;
      log(store, timestamp, 'autonomy_cloud_model', 'failed',
        'outbound_group_commit_failed', claimed);
      continue;
    }
    summary.generatedGroups += 1;
    summary.generatedMessages += generation.messages.length;
    log(store, timestamp, 'autonomy_cloud_model', 'success',
      'outbound_group_committed', claimed, { messageCount: generation.messages.length });
  }
  return summary;
}
