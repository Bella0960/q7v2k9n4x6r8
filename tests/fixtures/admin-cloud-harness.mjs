/**
 * Test harness for ADMIN-CLOUD-001.
 *
 * Uses the REAL migrations, REAL store, REAL createApp router and REAL account
 * authentication (bootstrap -> login -> session cookie) against an in-memory
 * node:sqlite database. Nothing about the auth path is mocked.
 *
 * All identifiers and secrets below are synthetic sentinels so tests can prove
 * they never appear in any administrator response.
 */
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, runtimeMigrations } from '../../worker/lib/migrations.js';
import { createStore } from '../../worker/lib/store.js';
import { createApp } from '../../worker/lib/app.js';

export const ORIGIN = 'https://mao.test';
export const T0 = Date.UTC(2026, 10, 22, 12, 0, 0); // 2026-11-22T12:00:00Z
export const HOUR = 3600000;

export const SENTINELS = Object.freeze({
  chat: 'PRIVATE-CHAT-SENTINEL-8f3a91',
  character: 'character-sentinel-lin-yue-77',
  activity: 'activity-sentinel-id-5521',
  device: 'DEVICE-SENTINEL-0123456789abcdef',
  device2: 'DEVICE-SENTINEL-fedcba9876543210',
  platform: 'PlatformSentinelPixel9',
  pepper: 'PEPPER-SENTINEL-0123456789abcdef0123456789abcdef',
  vapidPrivate: 'VAPID-PRIVATE-SENTINEL-abcdefghijklmnopqrstuvwxyz0123456789',
  bootstrap: 'BOOTSTRAP-SENTINEL-0123456789abcdef0123456789abcdef',
  enrollment: 'ENROLLMENT-SENTINEL-0123456789abcdef0123456789',
  password: 'sentinel-password-123456',
  email: '10001@qq.com'
});

export function fullEnv(overrides = {}) {
  return {
    DEVICE_SECRET_PEPPER: SENTINELS.pepper,
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: SENTINELS.bootstrap,
    ENROLLMENT_TOKEN: SENTINELS.enrollment,
    VAPID_PUBLIC_KEY: 'public-key-value',
    VAPID_PRIVATE_KEY: SENTINELS.vapidPrivate,
    VAPID_SUBJECT: 'mailto:ops@example.test',
    AUTONOMY_LEASE_MS: '60000',
    AUTONOMY_TICK_LIMIT: '10',
    AUTONOMY_RETRY_BACKOFF_MS: '1000,2000,4000',
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '120000',
    AUTONOMY_DEVICE_GRACE_MS: '5000',
    ...overrides
  };
}

export function createHarness({ env = fullEnv(), start = T0 } = {}) {
  const db = new DatabaseSync(':memory:');
  const exec = (sql, ...params) => db.prepare(sql).all(...params).map(row => ({ ...row }));
  const clock = { t: start };
  const now = () => clock.t;
  applyMigrations(exec, now(), null, runtimeMigrations(env));
  const store = createStore(exec);
  const handleApi = createApp({ store, env, now });

  async function call(path, { method = 'GET', cookie = '', accountId = '', headers = {}, body } = {}) {
    const init = { method, headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (accountId) init.headers['x-mao-account-context'] = accountId;
    if (method !== 'GET' && method !== 'HEAD') {
      init.headers.origin = ORIGIN;
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }
    const response = await handleApi(new Request(ORIGIN + path, init));
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: response.status, headers: response.headers, text, json };
  }

  function cookieFrom(response) {
    const raw = response.headers.get('set-cookie') || '';
    const match = /MAO_SESSION=([^;]+)/.exec(raw);
    return match ? 'MAO_SESSION=' + match[1] : '';
  }

  async function bootstrapAdmin(username = 'founder_admin') {
    const response = await call('/api/admin/bootstrap', {
      method: 'POST',
      body: {
        bootstrapSecret: env.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET,
        username,
        password: SENTINELS.password,
        confirmPassword: SENTINELS.password,
        qqEmail: SENTINELS.email
      }
    });
    if (response.status !== 200) throw new Error('bootstrap failed: ' + response.status + ' ' + response.text);
    return { accountId: response.json.account.id, cookie: cookieFrom(response) };
  }

  /** Register a normal account, activate it directly in the DB, then log in for real. */
  async function createActiveUser(username = 'plain_user') {
    const registered = await call('/api/accounts/register', {
      method: 'POST',
      body: { username, password: SENTINELS.password, confirmPassword: SENTINELS.password, qqEmail: '10002@qq.com' }
    });
    if (registered.status !== 201) throw new Error('register failed: ' + registered.status + ' ' + registered.text);
    exec("UPDATE mao_accounts SET status = 'active', authorized_at = ? WHERE id = ?", now(), registered.json.account.id);
    const login = await call('/api/accounts/login', {
      method: 'POST', body: { identifier: username, password: SENTINELS.password }
    });
    if (login.status !== 200) throw new Error('login failed: ' + login.status + ' ' + login.text);
    return { accountId: registered.json.account.id, cookie: cookieFrom(login) };
  }

  const admin = (path, session, extra = {}) =>
    call(path, { cookie: session.cookie, accountId: session.accountId, ...extra });

  // ---- seed helpers (direct inserts; test data only, never production) ----
  function seedDevice(id, userId = 'owner') {
    exec(
      'INSERT INTO devices (id, secret_hash, platform, created_at, last_seen_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      id, 'hash-' + id, SENTINELS.platform, now(), now(), userId
    );
  }
  function seedActivity({ id, status, deviceId = SENTINELS.device, scheduledAt, nextAttemptAt = null,
    lockedUntil = null, updatedAt = now(), result = false, serverMessageId = null }) {
    exec(
      `INSERT INTO activity_queue
        (id, device_id, character_id, kind, status, scheduled_at, next_attempt_at, locked_until,
         payload_json, created_at, updated_at, result_json, result_server_message_id)
       VALUES (?, ?, ?, 'contact', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, deviceId, SENTINELS.character, status, scheduledAt, nextAttemptAt, lockedUntil,
      JSON.stringify({ text: SENTINELS.chat }), now(), updatedAt,
      result ? JSON.stringify({ text: SENTINELS.chat }) : null, serverMessageId
    );
  }
  function seedOutbound({ id, status = 'pending', createdAt = now(), serverMessageId = 'srv-' + id }) {
    exec(
      `INSERT INTO outbound_messages
        (id, device_id, character_id, payload_json, server_message_id, created_at, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, SENTINELS.device, SENTINELS.character, JSON.stringify({ text: SENTINELS.chat }),
      serverMessageId, createdAt, status
    );
  }
  function seedPushDelivery({ id, status, nextAttemptAt = null, leaseUntil = null }) {
    exec(
      `INSERT INTO push_deliveries
        (id, dedupe_key, subscription_id, status, created_at, updated_at, next_attempt_at, lease_until, attempt_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id, 'dk-' + id, 'sub-' + id, status, now(), now(), nextAttemptAt, leaseUntil
    );
  }
  let logSeq = 0;
  function seedLog({ kind, status, reasonCode = '', deviceId = SENTINELS.device, at = now(), detail = {}, durationMs = 0 }) {
    logSeq += 1;
    store.logExecution({
      id: 'log-' + logSeq + '-' + Math.random().toString(16).slice(2, 10),
      deviceId, kind, status, reasonCode, detail, durationMs, now: at
    });
  }
  function rawLog({ kind, status, reasonCode, detailJson, deviceId = SENTINELS.device, at = now() }) {
    logSeq += 1;
    exec(
      `INSERT INTO execution_log (id, device_id, kind, status, reason_code, detail_json, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      'raw-' + logSeq, deviceId, kind, status, reasonCode, detailJson, at
    );
  }

  /** Full-table dump (minus session bookkeeping that existing auth touches on every request). */
  function snapshot(skip = ['mao_account_sessions']) {
    const tables = exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(row => row.name).filter(name => !skip.includes(name));
    const dump = {};
    for (const name of tables) dump[name] = exec('SELECT * FROM "' + name + '" ORDER BY rowid');
    return JSON.stringify(dump);
  }

  return {
    db, exec, store, clock, call, admin, bootstrapAdmin, createActiveUser, cookieFrom,
    seedDevice, seedActivity, seedOutbound, seedPushDelivery, seedLog, rawLog, snapshot, env, handleApi
  };
}

export function sectionOf(json, id) {
  return (json.sections || []).find(section => section.id === id);
}
