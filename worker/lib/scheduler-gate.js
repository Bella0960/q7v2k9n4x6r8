/**
 * M2.2b scheduler eligibility adapter.
 *
 * This is deliberately fail-closed until the repository has an approved,
 * durable source for autonomy settings, character schedules, presence/leases,
 * and a trustworthy context version. It adapts those future records through
 * the existing M2.1 policy rather than reimplementing its rules.
 *
 * It never reads chat bodies, persona data, browser storage, or secrets.
 */
import '../../shared/js/phone/character-schedule-policy.js';
import { REASON_CODES } from './scheduler-policy.js';

const POLICY = globalThis.CharacterSchedulePolicy;
const OWNER_USER_ID = 'owner';
const CONTEXT_TASK_KINDS = new Set(['contact', 'follow_up', 'busy_reply', 'diary']);

function deny(reasonCode, extra = {}) {
  return {
    autonomyAllowed: false,
    characterState: 'inactive',
    reasonCode,
    ...extra
  };
}

function readPayload(task) {
  let payload = task?.payload == null ? task?.payload_json : task.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload && typeof payload === 'object' ? payload : null;
}

function readVersion(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function hasRequiredSnapshot(snapshot) {
  return Boolean(
    snapshot &&
    typeof snapshot === 'object' &&
    snapshot.authorization &&
    typeof snapshot.authorization === 'object' &&
    snapshot.schedule &&
    typeof snapshot.schedule === 'object' &&
    typeof snapshot.timeZone === 'string' &&
    snapshot.timeZone.trim() &&
    snapshot.presence &&
    typeof snapshot.presence === 'object' &&
    Array.isArray(snapshot.presence.devices) &&
    Array.isArray(snapshot.presence.leases)
  );
}

/**
 * Create the gate consumed by scheduler-policy.planTask.
 *
 * store.getSchedulerGateSnapshot({ userId, characterId }) is intentionally an
 * explicit adapter contract. The current M1 store does not implement it yet,
 * so production remains blocked with gate_data_source_missing instead of
 * assuming that autonomy is enabled or that a role is active.
 *
 * Tests may provide synthetic snapshots; production must only provide
 * persisted, authorized metadata after the corresponding data-source work
 * has been separately reviewed and approved.
 */
export function createSchedulerGate({ store, now = Date.now, config = {} } = {}) {
  return function schedulerGate(task) {
    const timestamp = Number(typeof now === 'function' ? now() : now);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return deny(REASON_CODES.INVALID_TASK);
    }

    const characterId = String(task?.character_id || task?.characterId || '');
    if (!characterId) return deny(REASON_CODES.INVALID_TASK);

    if (!store || typeof store.getSchedulerGateSnapshot !== 'function') {
      return deny(REASON_CODES.GATE_DATA_SOURCE_MISSING);
    }

    let snapshot;
    try {
      snapshot = store.getSchedulerGateSnapshot({
        userId: OWNER_USER_ID,
        characterId
      });
    } catch {
      return deny(REASON_CODES.GATE_PROVIDER_ERROR);
    }

    if (!hasRequiredSnapshot(snapshot)) {
      return deny(REASON_CODES.GATE_DATA_MISSING);
    }
    if (!POLICY || typeof POLICY.evaluate !== 'function') {
      return deny(REASON_CODES.GATE_POLICY_UNAVAILABLE);
    }

    let evaluated;
    try {
      evaluated = POLICY.evaluate({
        nowMs: timestamp,
        userId: snapshot.userId || OWNER_USER_ID,
        characterId,
        timeZone: snapshot.timeZone,
        schedule: snapshot.schedule,
        authorization: snapshot.authorization,
        presence: snapshot.presence,
        config: snapshot.policyConfig || config
      });
    } catch {
      return deny(REASON_CODES.GATE_PROVIDER_ERROR);
    }

    if (!evaluated || evaluated.ok !== true) {
      return deny(REASON_CODES.GATE_POLICY_INVALID);
    }
    if (evaluated.autonomy?.allowed !== true) {
      return deny(REASON_CODES.AUTONOMY_DENIED);
    }
    if (evaluated.presence?.hasValidForegroundLease) {
      return deny(REASON_CODES.FOREGROUND_LEASE_HELD);
    }
    if (evaluated.presence?.gracePending) {
      return deny(REASON_CODES.FOREGROUND_LEASE_GRACE);
    }
    if (
      evaluated.character?.state !== 'active' ||
      evaluated.execution?.owner !== POLICY.EXECUTION_OWNERS.CLOUD ||
      evaluated.execution?.contactAllowed !== true
    ) {
      return deny(REASON_CODES.CHARACTER_NOT_ACTIVE, {
        characterState: evaluated.character?.state || 'inactive'
      });
    }

    if (CONTEXT_TASK_KINDS.has(String(task?.kind || ''))) {
      const payload = readPayload(task);
      const taskVersion = readVersion(payload?.contextVersion);
      const currentVersion = readVersion(snapshot.contextVersion);
      if (taskVersion == null || currentVersion == null) {
        return deny(REASON_CODES.CONTEXT_VERSION_UNAVAILABLE);
      }
      if (taskVersion !== currentVersion) {
        return deny(REASON_CODES.STALE_CONTEXT, {
          supersede: true,
          latestContextVersion: currentVersion
        });
      }
      return {
        autonomyAllowed: true,
        characterState: evaluated.character.state,
        latestContextVersion: currentVersion,
        reasonCode: REASON_CODES.CLAIMED,
        policyChecked: true
      };
    }

    return {
      autonomyAllowed: true,
      characterState: evaluated.character.state,
      latestContextVersion: readVersion(snapshot.contextVersion),
      reasonCode: REASON_CODES.CLAIMED,
      policyChecked: true
    };
  };
}
