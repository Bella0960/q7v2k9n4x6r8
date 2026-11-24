/**
 * ADMIN-CLOUD-001 — cloud service availability and operational health.
 *
 * Only signals that can be verified from inside the storage runtime are
 * reported: a live SQLite probe, schema migration state, and the PRESENCE
 * (never the value) of required Worker configuration. Anything that cannot be
 * observed here is reported as `unavailable` with a reason code.
 */

import { MIGRATIONS, runtimeMigrations } from '../../migrations.js';
import { validateConfig } from '../../scheduler-policy.js';
import { usesDelegatedIdentity } from '../../identity-bridge.js';
import { createRepository } from '../repository.js';
import { rollup } from '../states.js';
import { safeErrorName } from '../sanitize.js';

const MIN_SECRET_LENGTH = 32; // matches app.js / account-auth.js secret checks

function hasText(env, name) {
  return String(env?.[name] ?? '').trim().length > 0;
}

/** Mirrors app.js parsePositiveEnv. */
function positiveInt(env, name) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Mirrors app.js parseNonNegativeEnv. */
function nonNegativeInt(env, name) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Mirrors worker.js readSchedulerConfig (what runTick validates). */
function schedulerConfigFromEnv(env) {
  const config = {};
  if (env?.AUTONOMY_LEASE_MS != null) config.leaseMs = Number(env.AUTONOMY_LEASE_MS);
  if (env?.AUTONOMY_TICK_LIMIT != null) config.tickLimit = Number(env.AUTONOMY_TICK_LIMIT);
  if (env?.AUTONOMY_RETRY_BACKOFF_MS != null) {
    config.retryBackoffMs = String(env.AUTONOMY_RETRY_BACKOFF_MS)
      .split(',').map(value => value.trim()).filter(Boolean).map(Number);
  }
  return config;
}

/** Mirrors app.js readActivityExecutionConfig (stricter than validateConfig). */
function deviceExecutorConfigValid(env) {
  const leaseMs = positiveInt(env, 'AUTONOMY_LEASE_MS');
  const tickLimit = positiveInt(env, 'AUTONOMY_TICK_LIMIT');
  const rawBackoff = String(env?.AUTONOMY_RETRY_BACKOFF_MS || '').trim();
  const backoff = rawBackoff ? rawBackoff.split(',').map(value => Number(value.trim())) : [];
  return !(
    leaseMs == null || tickLimit == null || tickLimit > 50 ||
    backoff.length === 0 || backoff.length > 8 ||
    !backoff.every(value => Number.isSafeInteger(value) && value > 0)
  );
}

function runCheck(id, title, fn) {
  try {
    return { id, title, ...fn() };
  } catch (error) {
    console.error('[admin-cloud] health check failed', id, safeErrorName(error));
    return {
      id, title, state: 'error', reason: 'check_failed',
      facts: { errorName: safeErrorName(error) }
    };
  }
}

export const healthSection = {
  id: 'health',
  title: '云服务状态',
  order: 10,
  collect({ env, store, query }) {
    const repo = createRepository(query);
    const delegated = usesDelegatedIdentity(env);
    const checks = [];

    checks.push(runCheck('api_runtime', '云端接口运行时', () => ({
      // Reaching this code proves the Worker and the Durable Object are serving requests.
      state: 'ok',
      facts: { runtime: 'durable_object', identityMode: delegated ? 'delegated_preview' : 'local' }
    })));

    checks.push(runCheck('storage_sqlite', '云端存储（SQLite）', () => {
      if (!repo.probe()) return { state: 'error', reason: 'probe_returned_unexpected_value' };
      const facts = {};
      if (typeof store?.counts === 'function') {
        const counts = store.counts();
        facts.devices = Number(counts.devices || 0);
        facts.activePushSubscriptions = Number(counts.activeSubscriptions || 0);
      }
      return { state: 'ok', facts };
    }));

    checks.push(runCheck('schema_migrations', '数据库迁移', () => {
      const applied = new Set(repo.listMigrationVersions());
      // A delegated gateway must not require the authority's optional social
      // schema. Previously applied, recognized optional schema is retained
      // (not a drift or an invitation to delete data).
      const expected = runtimeMigrations(env).map(migration => migration.version);
      const knownSet = new Set(MIGRATIONS.map(migration => migration.version));
      const expectedSet = new Set(expected);
      const pending = expected.filter(version => !applied.has(version));
      const unknownApplied = [...applied].filter(version => !knownSet.has(version)).length;
      const retainedOptional = [...applied].filter(version => knownSet.has(version) && !expectedSet.has(version)).length;
      return {
        state: pending.length === 0 && unknownApplied === 0 ? 'ok' : 'degraded',
        facts: {
          applied: applied.size,
          expected: expected.length,
          pending: pending.slice(0, 20),
          unknownApplied,
          retainedOptional
        }
      };
    }));

    checks.push(runCheck('device_auth_config', '设备鉴权配置', () => ({
      state: String(env?.DEVICE_SECRET_PEPPER || '').length >= MIN_SECRET_LENGTH ? 'ok' : 'not_configured',
      reason: String(env?.DEVICE_SECRET_PEPPER || '').length >= MIN_SECRET_LENGTH ? undefined : 'secret_missing_or_short'
    })));

    checks.push(runCheck('web_push_config', 'Web Push 配置', () => {
      const configured = hasText(env, 'VAPID_PUBLIC_KEY') && hasText(env, 'VAPID_PRIVATE_KEY') && hasText(env, 'VAPID_SUBJECT');
      return { state: configured ? 'ok' : 'not_configured', reason: configured ? undefined : 'vapid_keys_missing' };
    }));

    checks.push(runCheck('scheduler_config', '调度参数配置', () => {
      const validated = validateConfig(schedulerConfigFromEnv(env));
      const executorValid = deviceExecutorConfigValid(env);
      if (!validated.ok) return { state: 'not_configured', reason: validated.reason, facts: { deviceExecutorConfigValid: executorValid } };
      return {
        state: executorValid ? 'ok' : 'degraded',
        reason: executorValid ? undefined : 'device_executor_config_invalid',
        facts: { deviceExecutorConfigValid: executorValid }
      };
    }));

    checks.push(runCheck('presence_config', '前台在线与租约配置', () => {
      const configured =
        positiveInt(env, 'AUTONOMY_HEARTBEAT_TTL_MS') != null &&
        positiveInt(env, 'AUTONOMY_DEVICE_LEASE_MS') != null &&
        nonNegativeInt(env, 'AUTONOMY_DEVICE_GRACE_MS') != null;
      return { state: configured ? 'ok' : 'not_configured', reason: configured ? undefined : 'presence_config_missing' };
    }));

    // No data source: stated explicitly instead of inventing a number.
    checks.push({
      id: 'platform_metrics',
      title: 'Cloudflare 平台指标（请求量、错误率、CPU 时间）',
      state: 'unavailable',
      reason: 'cloudflare_analytics_not_connected'
    });

    const rolled = rollup(checks.map(check => check.state));
    return { state: rolled.state, summary: rolled.summary, checks };
  }
};
