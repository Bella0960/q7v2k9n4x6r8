import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { randomToken, base64UrlToBytes } from '../worker/lib/crypto.js';
import {
  buildVapidAuthorization,
  encryptPayload,
  parseVapidKeys,
  PUSH_SEND_TIMEOUT_MS
} from '../worker/lib/webpush.js';
import { applyMigrations, MIGRATIONS, splitSql } from '../worker/lib/migrations.js';
import { createStore } from '../worker/lib/store.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const publicBytes = ecdh.getPublicKey();
  // OpenSSL may return a minimally encoded scalar (30–32 bytes). VAPID's
  // P-256 JWK requires the fixed-width 32-byte private scalar.
  const privateBytes = ecdh.getPrivateKey();
  const normalizedPrivateBytes = Buffer.alloc(32);
  privateBytes.copy(normalizedPrivateBytes, 32 - privateBytes.length);
  return {
    publicB64: Buffer.from(publicBytes).toString('base64url'),
    privateB64: normalizedPrivateBytes.toString('base64url'),
    publicBytes: new Uint8Array(publicBytes)
  };
}

function makeDevice() {
  return { deviceId: randomToken(16), secret: randomToken(32) };
}

async function makeBrowserSubscription() {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const authBytes = new Uint8Array(randomBytes(16));
  return {
    keyPair,
    p256dh: Buffer.from(publicBytes).toString('base64url'),
    auth: Buffer.from(authBytes).toString('base64url'),
    endpoint: `https://push.example.com/subscription/${randomToken(10)}`
  };
}

function createFakePushFetch(statusCode = 201) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response('', { status: statusCode });
  };
  impl.calls = calls;
  impl.setStatus = value => { statusCode = value; };
  return impl;
}

async function registerDevice(ctx, device, extra = {}) {
  return ctx.asJson('/api/devices/register', {
    method: 'POST',
    body: {
      ...device,
      label: 'test-device',
      platform: 'node',
      enrollmentToken: 'test-enrollment-token-for-contract-tests',
      ...extra
    }
  });
}

async function subscribeDevice(ctx, device, subscription) {
  return ctx.asJson('/api/push/subscriptions', {
    method: 'POST',
    device,
    body: {
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: null,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      }
    }
  });
}

/* ------------------------------------------------------------------ */

test('迁移 0001–0005 建立云推送、调度元数据与投递恢复结构', async () => {
  const testDb = openTestDb();
  applyMigrations(testDb.exec);
  const tables = testDb.query("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map(row => String(row.name));
  for (const expected of [
    'schema_migrations',
    'devices',
    'push_subscriptions',
    'activity_queue',
    'execution_log',
    'outbound_messages',
    'push_deliveries',
    'user_autonomy',
    'character_autonomy',
    'character_schedules',
    'device_presence',
    'character_leases',
    'device_pairing_tokens',
    'device_bootstrap',
    'character_context_versions',
    'character_context_events'
  ]) {
    assert.ok(tables.includes(expected), `缺少表 ${expected}`);
  }
  const indexes = testDb.query("SELECT name FROM sqlite_master WHERE type = 'index'")
    .map(row => String(row.name));
  assert.ok(indexes.includes('idx_push_endpoint'), 'endpoint 必须有唯一索引，防止重复订阅');
  assert.ok(indexes.includes('idx_outbound_server_id'), 'server message id 必须唯一，保证幂等');
  assert.ok(indexes.includes('idx_push_delivery_dedupe'), '推送投递必须按 dedupe_key + 订阅唯一');
  assert.ok(indexes.includes('idx_devices_user_id'), '设备必须归属单用户 owner');
  assert.ok(indexes.includes('idx_device_presence_heartbeat'), '设备前台心跳必须可按用户与时间查询');
  assert.ok(indexes.includes('idx_character_leases_owner'), '角色租约必须可按设备和用户查询');
  assert.ok(indexes.includes('idx_device_pairing_creator'), '配对码必须可按签发设备清理');
  assert.ok(indexes.includes('idx_device_pairing_expiry'), '配对码必须可按过期时间清理');
  assert.ok(indexes.includes('idx_context_events_device_created'), '上下文事件必须可按设备清理与审计');
  assert.ok(indexes.includes('idx_context_events_created'), '上下文事件必须可按保留期清理');
  assert.ok(indexes.includes('idx_push_delivery_retry'), '推送投递必须可按重试状态与租约查询');
  const deliveryColumns = testDb.query("PRAGMA table_info('push_deliveries')").map(row => String(row.name));
  for (const column of ['lease_owner', 'lease_until', 'next_attempt_at', 'attempt_count', 'updated_at']) {
    assert.ok(deliveryColumns.includes(column), `推送投递缺少恢复字段 ${column}`);
  }

  // 幂等：重复执行迁移不会重复建表，也不会重复记录版本。
  const applied = applyMigrations(testDb.exec);
  assert.deepEqual(applied, []);
  const versions = testDb.query('SELECT version FROM schema_migrations');
  assert.equal(versions.length, 5);
  assert.deepEqual(versions.map(row => row.version).sort(), [
    '0001_init',
    '0002_autonomy_metadata',
    '0003_device_pairing',
    '0004_character_context_version',
    '0005_push_delivery_retries'
  ]);
});

test('推送投递迁移只恢复历史临时失败，不重放成功与永久失败记录', () => {
  const legacy = openTestDb();
  legacy.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const migration of MIGRATIONS.slice(0, 4)) {
    for (const statement of splitSql(migration.sql)) legacy.exec(statement);
    legacy.exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      migration.version,
      1
    );
  }
  legacy.exec(
    \`INSERT INTO push_deliveries
      (id, dedupe_key, subscription_id, status, http_status, created_at)
     VALUES ('legacy-5xx', 'legacy-5xx', 'sub-1', 'failed', 503, 100)\`
  );
  legacy.exec(
    \`INSERT INTO push_deliveries
      (id, dedupe_key, subscription_id, status, http_status, created_at)
     VALUES ('legacy-400', 'legacy-400', 'sub-2', 'failed', 400, 200)\`
  );
  legacy.exec(
    \`INSERT INTO push_deliveries
      (id, dedupe_key, subscription_id, status, http_status, created_at)
     VALUES ('legacy-sent', 'legacy-sent', 'sub-3', 'sent', 201, 300)\`
  );

  const applied = applyMigrations(legacy.exec, 999);
  assert.deepEqual(applied, ['0005_push_delivery_retries']);

  const retryable = legacy.query(
    "SELECT status, http_status, next_attempt_at, attempt_count, updated_at FROM push_deliveries WHERE id = 'legacy-5xx'"
  )[0];
  assert.equal(retryable.status, 'error');
  assert.equal(retryable.http_status, 503);
  assert.equal(retryable.next_attempt_at, 100);
  assert.equal(retryable.attempt_count, 0);
  assert.equal(retryable.updated_at, 100);

  const permanent = legacy.query(
    "SELECT status, next_attempt_at FROM push_deliveries WHERE id = 'legacy-400'"
  )[0];
  assert.equal(permanent.status, 'failed');
  assert.equal(permanent.next_attempt_at, null);

  const sent = legacy.query(
    "SELECT status, next_attempt_at FROM push_deliveries WHERE id = 'legacy-sent'"
  )[0];
  assert.equal(sent.status, 'sent');
  assert.equal(sent.next_attempt_at, null);
});

test('推送限流名额通过单条 SQLite 语句原子预留，结果日志不重复计数', async () => {
  const ctx = setupTestStore(openTestDb());
  const deviceId = 'rate-limit-device';
  const since = 1000;
  const reserve = now => ctx.store.reserveExecutionAttempt({
    id: 'attempt-' + now,
    deviceId,
    kind: 'test_push',
    reasonCode: 'attempt_started',
    now
  }, { since, limit: 3 });

  assert.equal(reserve(1000), true);
  ctx.store.logExecution({
    id: 'result-1',
    deviceId,
    kind: 'test_push',
    status: 'failed',
    reasonCode: 'no_delivery',
    now: 1001
  });
  assert.equal(reserve(2000), true);
  ctx.store.logExecution({
    id: 'result-2',
    deviceId,
    kind: 'test_push',
    status: 'failed',
    reasonCode: 'no_delivery',
    now: 2001
  });
  assert.equal(reserve(3000), true);
  ctx.store.logExecution({
    id: 'result-3',
    deviceId,
    kind: 'test_push',
    status: 'success',
    reasonCode: 'delivered',
    now: 3001
  });
  assert.equal(reserve(4000), false, '三个已预留尝试后，第四次必须被拒绝');
  assert.equal(
    ctx.store.countRecentExecutions(deviceId, 'test_push', since),
    3,
    '发送后的成功/失败日志不能被重复算成新的尝试'
  );
});

test('并发到达的推送请求不能同时预留超过限额的名额', async () => {
  const ctx = setupTestStore(openTestDb());
  const reserveOne = index => Promise.resolve().then(() =>
    ctx.store.reserveExecutionAttempt({
      id: 'parallel-attempt-' + index,
      deviceId: 'parallel-rate-device',
      kind: 'test_push',
      now: 5000 + index
    }, { since: 0, limit: 1 })
  );
  const results = await Promise.all([reserveOne(1), reserveOne(2), reserveOne(3)]);
  assert.equal(results.filter(Boolean).length, 1);
});

test('推送投递租约可恢复过期 worker，并阻止旧 worker 覆盖新状态', () => {
  const ctx = setupTestStore(openTestDb());
  const first = ctx.store.claimDelivery({
    id: 'delivery-row-1',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-a',
    now: 1000,
    leaseUntil: 2000,
    maxAttempts: 3
  });
  assert.ok(first);
  assert.equal(first.status, 'sending');
  assert.equal(first.attempt_count, 1);

  const blocked = ctx.store.claimDelivery({
    id: 'delivery-row-2',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-b',
    now: 1999,
    leaseUntil: 2999,
    maxAttempts: 3
  });
  assert.equal(blocked, null, '租约未过期时，其他 worker 不得并发发送');

  const recovered = ctx.store.claimDelivery({
    id: 'delivery-row-3',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-b',
    now: 2000,
    leaseUntil: 3000,
    maxAttempts: 3
  });
  assert.ok(recovered, '租约过期后应允许接管');
  assert.equal(recovered.attempt_count, 2);

  const staleFinish = ctx.store.finishDelivery({
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-a',
    status: 'sent',
    httpStatus: 201,
    now: 2001
  });
  assert.equal(staleFinish, null, '旧 worker 迟到的成功结果不得覆盖新 owner');

  const retryFinish = ctx.store.finishDelivery({
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-b',
    status: 'error',
    httpStatus: 503,
    nextAttemptAt: 5000,
    now: 2100
  });
  assert.equal(retryFinish.status, 'error');
  assert.equal(retryFinish.lease_owner, null);

  const tooEarly = ctx.store.claimDelivery({
    id: 'delivery-row-4',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-c',
    now: 4999,
    leaseUntil: 5999,
    maxAttempts: 3
  });
  assert.equal(tooEarly, null, '退避时间未到时不得重试');

  const lastAttempt = ctx.store.claimDelivery({
    id: 'delivery-row-5',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-c',
    now: 5000,
    leaseUntil: 6000,
    maxAttempts: 3
  });
  assert.ok(lastAttempt);
  assert.equal(lastAttempt.attempt_count, 3);

  const finalFailure = ctx.store.finishDelivery({
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-c',
    status: 'error',
    httpStatus: 503,
    nextAttemptAt: 7000,
    now: 5100
  });
  assert.equal(finalFailure.status, 'error');

  const exhausted = ctx.store.claimDelivery({
    id: 'delivery-row-6',
    dedupeKey: 'lease-test',
    subscriptionId: 'subscription-1',
    owner: 'sender-d',
    now: 7000,
    leaseUntil: 8000,
    maxAttempts: 3
  });
  assert.equal(exhausted, null);
  assert.equal(ctx.store.findDelivery('lease-test', 'subscription-1').status, 'failed',
    '超过最大尝试次数后应进入终态，不能无限重试');
});

test('角色上下文版本事件：仅保存事件 ID、服务器递增、重复请求幂等且账号隔离', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);

  const initial = await ctx.asJson('/api/characters/char-a/context-version', { device });
  assert.equal(initial.status, 200);
  assert.equal(initial.payload.configured, false);
  assert.equal(initial.payload.version, 0);

  const event = {
    eventId: 'context_event_0001'
  };
  const first = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    device,
    body: event
  });
  assert.equal(first.status, 200);
  assert.equal(first.payload.changed, true);
  assert.equal(first.payload.version, 1);

  const duplicate = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    device,
    body: event
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.payload.changed, false);
  assert.equal(duplicate.payload.version, 1, '同一 eventId 重试不得重复递增');

  const second = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    device,
    body: { eventId: 'context_event_0002' }
  });
  assert.equal(second.status, 200);
  assert.equal(second.payload.version, 2);

  const rejectedContent = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    device,
    body: { eventId: 'context_event_0003', text: 'private chat body must be rejected' }
  });
  assert.equal(rejectedContent.status, 400);
  assert.equal(rejectedContent.payload.error.code, 'INVALID_CONTEXT_EVENT');

  const invalidEvent = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    device,
    body: { eventId: 'short' }
  });
  assert.equal(invalidEvent.status, 400);

  const anonymous = await ctx.asJson('/api/characters/char-a/context-version', {
    method: 'POST',
    body: event
  });
  assert.equal(anonymous.status, 401);

  const anotherUserNow = Date.now();
  const anotherAccountEvent = ctx.store.recordCharacterContextEvent({
    userId: 'another-user',
    characterId: 'char-a',
    eventId: 'context_event_other_1',
    deviceId: 'other-device',
    now: anotherUserNow
  });
  assert.equal(anotherAccountEvent.version, 1);
  assert.deepEqual(ctx.store.getCharacterContextVersionSummary('owner'), {
    roleCount: 1,
    maxVersion: 2,
    latestUpdatedAt: second.payload.updatedAt
  });
  assert.deepEqual(ctx.store.getCharacterContextVersionSummary('another-user'), {
    roleCount: 1,
    maxVersion: 1,
    latestUpdatedAt: anotherUserNow
  });

  const limitedEvent = ctx.store.recordCharacterContextEvent({
    userId: 'owner',
    characterId: 'char-a',
    eventId: 'context_event_rate_limit_1',
    deviceId: device.deviceId,
    now: Date.now(),
    eventLimit: 2,
    windowStart: 0
  });
  assert.equal(limitedEvent.limited, true, '同一设备一小时内的新事件应有上限');
  const duplicateAtLimit = ctx.store.recordCharacterContextEvent({
    userId: 'owner',
    characterId: 'char-a',
    eventId: 'context_event_0002',
    deviceId: device.deviceId,
    now: Date.now(),
    eventLimit: 2,
    windowStart: 0
  });
  assert.equal(duplicateAtLimit.changed, false, '幂等重试在达到上限后仍应正常返回');

  const readiness = await ctx.asJson('/api/autonomy/readiness', { device });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.payload.contextVersionReady, true);
  assert.equal(readiness.payload.contextVersionTrackedRoles, 1);
  assert.equal(readiness.payload.autonomousMessageGenerationReady, false);
  assert.deepEqual(readiness.payload.autonomyExecutionBlockers, ['executor_unavailable']);

  const snapshot = ctx.store.getSchedulerGateSnapshot({ userId: 'owner', characterId: 'char-a' });
  assert.equal(snapshot.contextVersion, 2);
  const missingRoleSnapshot = ctx.store.getSchedulerGateSnapshot({ userId: 'owner', characterId: 'char-b' });
  assert.equal(missingRoleSnapshot.contextVersion, null);
});

test('客户端只提交随机上下文事件 ID，不上传本地聊天正文，并可重试离线事件', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const local = new Map([[
    'cloud_device_v1',
    JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
  ]]);
  const calls = [];
  let failNext = true;
  const localStorageStub = {
    getItem(key) { return local.has(key) ? local.get(key) : null; },
    setItem(key, value) { local.set(key, String(value)); },
    removeItem(key) { local.delete(key); }
  };
  let randomFill = 0;
  const browserWindow = {
    crypto: {
      getRandomValues(bytes) {
        randomFill += 1;
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + 29 + randomFill) & 255;
        return bytes;
      }
    }
  };
  const fetchStub = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (failNext) {
      failNext = false;
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, error: { code: 'TEMPORARY', message: 'offline' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, changed: true, version: calls.length, updatedAt: Date.now() })
    };
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: { currentScript: null },
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn() {}, log() {}, error() {} },
    URL,
    btoa
  });

  const api = browserWindow.MaomaoCloud;
  const history = [{ role: 'user', text: 'this private message must stay on device', time: 100 }];
  await assert.rejects(api.noteCharacterContextChanged('char-a', history), /offline/);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['eventId']);
  assert.equal(JSON.stringify(calls).includes('this private message must stay on device'), false);

  const pendingEvent = calls[0].body.eventId;
  failNext = false;
  await api.flushCharacterContextVersion('char-a');
  assert.equal(calls.length, 2, '离线待同步事件恢复网络后应重试');
  assert.equal(calls[1].body.eventId, pendingEvent, '重试必须复用原事件 ID');

  await api.noteCharacterContextChanged('char-a', history);
  assert.equal(calls.length, 2, '历史未变时不得重复产生版本事件');

  const changedHistory = [{ role: 'user', text: 'a later private message', time: 101 }];
  await api.noteCharacterContextChanged('char-a', changedHistory);
  assert.equal(calls.length, 3, '本地历史变化后应提交新的事件 ID');
  assert.notEqual(calls[2].body.eventId, pendingEvent);
  assert.deepEqual(Object.keys(calls[2].body).sort(), ['eventId']);
});

test('多标签页并发上下文同步不会丢失较新的待同步事件', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const sharedStorage = new Map([[
    'cloud_device_v1',
    JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
  ]]);
  const calls = [];
  let resolveFirstTabRequest;
  const successResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, changed: true, version: 1, updatedAt: Date.now() })
  });
  const offlineResponse = () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: { code: 'TEMPORARY', message: 'offline' } })
  });

  function makeTab(tabId, randomSeed) {
    const localStorageStub = {
      getItem(key) { return sharedStorage.has(key) ? sharedStorage.get(key) : null; },
      setItem(key, value) { sharedStorage.set(key, String(value)); },
      removeItem(key) { sharedStorage.delete(key); }
    };
    let requestCount = 0;
    const fetchStub = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ tabId, url, body });
      if (url.includes('/context-version') && options.method === 'POST') {
        requestCount += 1;
        if (tabId === 'tab-a' && requestCount === 1) {
          return new Promise(resolve => { resolveFirstTabRequest = resolve; });
        }
        if (tabId === 'tab-b') return offlineResponse();
        return successResponse();
      }
      throw new Error('Unexpected request from ' + tabId + ': ' + url);
    };
    const browserWindow = {
      crypto: {
        getRandomValues(bytes) {
          for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = (randomSeed + i * 13) & 255;
          }
          return bytes;
        }
      }
    };
    vm.runInNewContext(clientSource, {
      window: browserWindow,
      document: { currentScript: null },
      localStorage: localStorageStub,
      fetch: fetchStub,
      console: { warn() {}, log() {}, error() {} },
      URL,
      btoa
    });
    return browserWindow.MaomaoCloud;
  }

  const tabA = makeTab('tab-a', 17);
  const tabB = makeTab('tab-b', 91);
  const olderSync = tabA.noteCharacterContextChanged('char-a', [
    { role: 'user', text: 'saved from tab A', time: 1 }
  ]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof resolveFirstTabRequest, 'function',
    '第一个标签页的请求应保持在途，模拟网络延迟');

  await assert.rejects(tabB.noteCharacterContextChanged('char-a', [
    { role: 'user', text: 'newer save from tab B', time: 2 }
  ]), /offline/);
  const newerEventId = calls[1].body.eventId;
  assert.notEqual(calls[0].body.eventId, newerEventId,
    '两个标签页的不同保存应生成不同事件 ID');
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['eventId']);

  resolveFirstTabRequest(successResponse());
  await olderSync;
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(calls.length, 3,
    '旧标签页请求完成后应接手并重试另一个标签页留下的待同步事件');
  assert.equal(calls[2].tabId, 'tab-a');
  assert.equal(calls[2].body.eventId, newerEventId,
    '补偿重试必须继续使用新标签页的原事件 ID');
  assert.equal(sharedStorage.has('cloud_context_pending_v1:char-a'), false,
    '补偿请求成功后应清除待同步事件');
  assert.equal(
    JSON.stringify(calls).includes('saved from tab A') ||
    JSON.stringify(calls).includes('newer save from tab B'),
    false,
    '两个标签页的消息正文都不得进入云端请求'
  );
});

test('本地角色上下文指纹覆盖嵌套消息字段并规范化对象键顺序', () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const browserWindow = {};
  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: { currentScript: null },
    console,
    URL
  });
  const fingerprint = browserWindow.MaomaoCloud._internal.fingerprintCharacterHistory;

  const original = [{
    role: 'user',
    text: 'interaction',
    payload: {
      poll: { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], votes: { a: 1, b: 0 } },
      transfer: { amount: 12, currency: 'USD' },
      reactions: [{ emoji: 'like', count: 1 }],
      attachment: { fileId: 'file-1', metadata: { width: 640, height: 480 } }
    }
  }];
  const reordered = [{
    payload: {
      attachment: { metadata: { height: 480, width: 640 }, fileId: 'file-1' },
      reactions: [{ count: 1, emoji: 'like' }],
      transfer: { currency: 'USD', amount: 12 },
      poll: { votes: { b: 0, a: 1 }, options: [{ label: 'A', id: 'a' }, { label: 'B', id: 'b' }] }
    },
    text: 'interaction',
    role: 'user'
  }];
  const originalFingerprint = fingerprint(original);
  assert.equal(fingerprint(reordered), originalFingerprint,
    '仅对象属性顺序变化不得产生无意义版本更新');

  const changedPoll = [{
    ...original[0],
    payload: {
      ...original[0].payload,
      poll: { ...original[0].payload.poll, votes: { a: 0, b: 1 } }
    }
  }];
  assert.notEqual(fingerprint(changedPoll), originalFingerprint,
    '投票结果等嵌套字段变化必须被记录');

  const changedTransfer = [{
    ...original[0],
    payload: {
      ...original[0].payload,
      transfer: { ...original[0].payload.transfer, amount: 13 }
    }
  }];
  assert.notEqual(fingerprint(changedTransfer), originalFingerprint,
    '转账等嵌套业务字段变化必须被记录');

  const dataHeader = 'data:image/png;base64,';
  const mediaA = dataHeader + 'A'.repeat(4096);
  const sample = 16;
  const offset = Math.floor(sample * (4096 - 64) / 31) + 12;
  const mediaB = mediaA.slice(0, dataHeader.length + offset) + 'B' +
    mediaA.slice(dataHeader.length + offset + 1);
  assert.notEqual(
    fingerprint([{ role: 'user', attachment: { preview: mediaA } }]),
    fingerprint([{ role: 'user', attachment: { preview: mediaB } }]),
    '嵌入式媒体数据的分布式采样变化也应触发本地指纹变化'
  );
});

test('设备注册、重复注册与凭据冲突', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();

  const first = await registerDevice(ctx, device);
  assert.equal(first.status, 200);
  assert.equal(first.payload.device.reenrolled, false);

  const again = await registerDevice(ctx, device);
  assert.equal(again.status, 200);
  assert.equal(again.payload.device.reenrolled, true);

  const conflict = await ctx.asJson('/api/devices/register', {
    method: 'POST',
    body: { deviceId: device.deviceId, secret: randomToken(32) }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.error.code, 'DEVICE_CONFLICT');

  const invalid = await ctx.asJson('/api/devices/register', {
    method: 'POST',
    body: { deviceId: 'short', secret: 'short' }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.error.code, 'INVALID_DEVICE_CREDENTIALS');

  const row = ctx.store.getDevice(device.deviceId);
  assert.ok(row, '设备必须落库');
  assert.equal(row.secret_hash.includes(device.secret), false, '不得明文保存设备密钥');
  assert.equal(row.user_id, 'owner', '旧版设备记录应归属当前单用户 owner');
});

test('新设备必须通过单次初始认领或已连接设备签发的一次性配对码', async () => {
  const ctx = setupTestStore(openTestDb());
  const primary = makeDevice();
  await registerDevice(ctx, primary);

  const unpaired = makeDevice();
  const rejected = await ctx.asJson('/api/devices/register', {
    method: 'POST',
    body: { ...unpaired, label: 'unpaired', platform: 'node' }
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.payload.error.code, 'DEVICE_PAIRING_REQUIRED');
  assert.equal(ctx.store.getDevice(unpaired.deviceId), null);

  const created = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: primary
  });
  assert.equal(created.status, 200);
  assert.equal(typeof created.payload.pairingToken, 'string');
  assert.ok(created.payload.pairingToken.length >= 32);
  assert.equal(created.payload.expiresAt - Date.now() > 0, true);

  const stored = ctx.query('SELECT token_hash FROM device_pairing_tokens');
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, created.payload.pairingToken, '数据库不得保存配对码明文');

  const secondary = makeDevice();
  const paired = await registerDevice(ctx, secondary, {
    pairingToken: created.payload.pairingToken
  });
  assert.equal(paired.status, 200);
  assert.equal(paired.payload.device.enrollmentMode, 'paired');
  assert.equal(ctx.store.getDevice(secondary.deviceId).user_id, 'owner');

  const replay = await registerDevice(ctx, makeDevice(), {
    pairingToken: created.payload.pairingToken
  });
  assert.equal(replay.status, 403);
  assert.equal(replay.payload.error.code, 'PAIRING_TOKEN_INVALID');

  const bootstrapReplay = await registerDevice(ctx, makeDevice());
  assert.equal(bootstrapReplay.status, 409);
  assert.equal(bootstrapReplay.payload.error.code, 'DEVICE_BOOTSTRAP_CLOSED');

  const outstanding = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: primary
  });
  assert.equal(outstanding.status, 200);
  const revoked = await ctx.asJson('/api/devices/revoke', {
    method: 'POST',
    device: primary
  });
  assert.equal(revoked.status, 200);
  const afterCreatorRevoked = await registerDevice(ctx, makeDevice(), {
    pairingToken: outstanding.payload.pairingToken
  });
  assert.equal(afterCreatorRevoked.status, 403);
  assert.equal(afterCreatorRevoked.payload.error.code, 'PAIRING_TOKEN_INVALID');
});

test('设置页暴露设备配对入口，客户端提供一次性配对流程', () => {
  const settingsHtml = fs.readFileSync(path.join(rootDir, 'settings/settings.html'), 'utf8');
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const chatDetail = fs.readFileSync(path.join(rootDir, 'chat/chat/chat-detail.html'), 'utf8');
  assert.ok(chatDetail.includes('../../shared/js/cloud-push-client.js'), '聊天页必须加载云端 presence 客户端');
  assert.ok(chatDetail.includes('startCharacterPresence(String(currentCharacter.id || currentRoleId))'));
  assert.ok(chatDetail.includes('window.MaomaoCloud.noteCharacterContextChanged('),
    '只有本地聊天历史保存并读回成功后才应通知角色版本变化');
  assert.ok(chatDetail.includes('isGroupChat || !currentRoleId'), '群聊不可误占单角色租约');
  for (const id of [
    'cloudReadinessCheck',
    'cloudReadinessResult',
    'cloudPairCreateRow',
    'cloudPairCodeOutput',
    'cloudPairCodeCopyButton',
    'cloudPairCodeInput',
    'cloudPairConnectButton',
    'cloudAutonomyToggle',
    'cloudRoleSelect',
    'cloudCharacterAutonomyMode',
    'cloudRoleAutonomySave',
    'cloudRoleTimezone',
    'cloudRoleActiveStart',
    'cloudRoleActiveEnd',
    'cloudRoleBusyStart',
    'cloudRoleBusyEnd',
    'cloudRoleAsleepStart',
    'cloudRoleAsleepEnd',
    'cloudRoleAway',
    'cloudRoleScheduleSave'
  ]) {
    assert.ok(settingsHtml.includes('id="' + id + '"'), '设置页缺少配对控件 ' + id);
  }
  const presenceClientStart = clientSource.indexOf('async function startCharacterPresence(');
  const presenceClientEnd = clientSource.indexOf('  async function disconnect()', presenceClientStart);
  assert.ok(presenceClientStart >= 0 && presenceClientEnd > presenceClientStart,
    '必须存在可独立核对的角色前台状态管理器');
  const presenceClientSource = clientSource.slice(presenceClientStart, presenceClientEnd);
  assert.ok(presenceClientSource.includes("if (document.visibilityState === 'hidden') return;"),
    '隐藏标签页不能覆盖设备级前台心跳');
  assert.equal(presenceClientSource.includes('updatePresenceHeartbeat(false)'), false,
    '设备级在线状态必须依靠心跳 TTL 过期，不能由单个标签页写离线');
  assert.equal(presenceClientSource.includes("addEventListener('pagehide'"), false,
    '单个页面离开不能将仍有其他可见页面的设备标记为离线');

  assert.ok(clientSource.includes('function getAutonomyReadiness()'));
  assert.ok(clientSource.includes("'/api/autonomy/readiness'"));
  assert.ok(clientSource.includes('function createDevicePairingToken()'));
  assert.ok(clientSource.includes('function connectDeviceWithPairingCode('));
  assert.ok(clientSource.includes('仅在用户主动输入一次性配对码时'));
  assert.ok(clientSource.includes("['DEVICE_REVOKED', 'DEVICE_CONFLICT', 'DEVICE_UNKNOWN']"));
  assert.ok(clientSource.includes('pushSupported: false'));
  assert.ok(clientSource.includes('error.deviceRegistered = true'));
  assert.ok(clientSource.includes("Web Push 不可用不应阻止设备配对状态"));
  assert.ok(clientSource.includes('setGlobalAutonomy(desired)'));
  assert.ok(clientSource.includes('getGlobalAutonomy()'));
  assert.ok(clientSource.includes('PhoneStorage.getCharacters()'));
  assert.ok(clientSource.includes('getCharacterAutonomy(roleId)'));
  assert.ok(clientSource.includes('setCharacterAutonomy(roleId, enabled)'));
  assert.ok(clientSource.includes('setCharacterSchedule(roleId, timeZone, schedule)'));
  assert.ok(clientSource.includes('function readOptionalWindow('));
  assert.ok(clientSource.includes('getPresenceRenewInterval'), 'presence renewer 必须使用安全的浏览器定时器间隔');
  assert.ok(clientSource.includes('不再因 DEVICE_UNKNOWN / DEVICE_CONFLICT 自动销毁本机凭据'));
});

test('前台心跳续期间隔限制在浏览器安全定时器范围内', () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const browserWindow = {};
  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: { currentScript: null },
    console,
    URL
  });
  const getInterval = browserWindow.MaomaoCloud._internal.getPresenceRenewInterval;

  assert.equal(getInterval(180000, 120000), 40000, '正常配置仍按较短租约的三分之一续期');
  assert.equal(getInterval(1, 5), 1, '极短配置至少保持 1ms 间隔');
  assert.equal(
    getInterval(9000000000, 9000000000),
    2147483647,
    '超出浏览器定时器上限时必须截断，不能被浏览器变成高频定时器'
  );
  assert.equal(getInterval(Number.MAX_SAFE_INTEGER + 1, 60000), null, '不安全整数必须 fail-closed');
  assert.equal(getInterval(Number.POSITIVE_INFINITY, 60000), null, '非有限配置必须 fail-closed');
});

test('前台聊天页会响应跨标签页保存和网络恢复事件重试版本同步', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const documentListeners = new Map();
  const windowListeners = new Map();
  const local = new Map([[
    'cloud_device_v1',
    JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
  ]]);
  const calls = [];
  let clearedInterval = null;
  const browserWindow = {
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (windowListeners.get(name) === callback) windowListeners.delete(name);
    },
    setInterval(callback, delay) {
      assert.equal(delay, 40000);
      return 55;
    },
    clearInterval(id) { clearedInterval = id; }
  };
  const browserDocument = {
    currentScript: null,
    visibilityState: 'visible',
    addEventListener(name, callback) { documentListeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (documentListeners.get(name) === callback) documentListeners.delete(name);
    }
  };
  const localStorageStub = {
    getItem(key) { return local.has(key) ? local.get(key) : null; },
    setItem(key, value) { local.set(key, String(value)); },
    removeItem(key) { local.delete(key); }
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  });
  const fetchStub = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (url === '/api/presence/config') {
      return response({ ok: true, heartbeatTtlMs: 120000, leaseDurationMs: 120000 });
    }
    if (url === '/api/presence/heartbeat') return response({ ok: true });
    if (url === '/api/characters/role-123/lease') {
      return body.action === 'renew'
        ? response({ ok: false, error: { code: 'LEASE_NOT_OWNED', message: 'not owner' } }, 409)
        : response({ ok: true, acquired: true });
    }
    if (url === '/api/characters/role-123/context-version' && options.method === 'POST') {
      return response({ ok: true, changed: true, version: 1, updatedAt: Date.now() });
    }
    throw new Error('Unexpected request: ' + url);
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: browserDocument,
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn() {}, log() {}, error() {} },
    URL,
    btoa
  });

  const manager = await browserWindow.MaomaoCloud.startCharacterPresence('role-123');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(windowListeners.has('storage'), true, '聊天页应监听其他标签页的待同步事件');
  assert.equal(windowListeners.has('online'), true, '聊天页应监听浏览器网络恢复事件');

  const pendingKey = 'cloud_context_pending_v1:role-123';
  local.set(pendingKey, 'cross_tab_context_event_0001');
  windowListeners.get('storage')({
    key: pendingKey,
    newValue: 'cross_tab_context_event_0001'
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  local.set(pendingKey, 'network_restore_event_0002');
  windowListeners.get('online')();
  await new Promise(resolve => setTimeout(resolve, 0));

  const contextCalls = calls.filter(call =>
    call.url === '/api/characters/role-123/context-version'
  );
  assert.deepEqual(contextCalls.map(call => call.body.eventId), [
    'cross_tab_context_event_0001',
    'network_restore_event_0002'
  ]);
  assert.ok(contextCalls.every(call =>
    Object.keys(call.body).length === 1 && Object.keys(call.body)[0] === 'eventId'
  ), '重试仍然只提交随机事件 ID');

  manager.stop();
  assert.equal(windowListeners.has('storage'), false, '停止管理器时必须移除 storage 监听');
  assert.equal(windowListeners.has('online'), false, '停止管理器时必须移除 online 监听');
  assert.equal(clearedInterval, 55);
});

test('首次心跳临时失败后前台管理器仍会在下一轮自动重试', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const listeners = new Map();
  const calls = [];
  const warnings = [];
  let intervalCallback = null;
  let clearedInterval = null;
  let heartbeatAttempts = 0;
  const browserWindow = {
    setInterval(callback, delay) {
      assert.equal(delay, 40000);
      intervalCallback = callback;
      return 17;
    },
    clearInterval(id) {
      clearedInterval = id;
    }
  };
  const browserDocument = {
    currentScript: null,
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const localStorageStub = {
    getItem(key) {
      return key === 'cloud_device_v1'
        ? JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
        : null;
    },
    setItem() {},
    removeItem() {}
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    json: async () => payload
  });
  const fetchStub = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/presence/config') {
      return response({ ok: true, heartbeatTtlMs: 120000, leaseDurationMs: 120000 });
    }
    if (url === '/api/presence/heartbeat') {
      heartbeatAttempts += 1;
      if (heartbeatAttempts === 1) {
        return response({ ok: false, error: { code: 'TEMPORARY', message: 'temporary outage' } }, 503);
      }
      return response({ ok: true });
    }
    if (url === '/api/characters/role-123/lease') {
      const action = JSON.parse(options.body || '{}').action;
      if (action === 'renew') {
        return response({ ok: false, error: { code: 'LEASE_NOT_OWNED', message: 'not owner' } }, 409);
      }
      if (action === 'acquire') return response({ ok: true, acquired: true });
    }
    throw new Error('Unexpected request: ' + url);
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: browserDocument,
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn: (...args) => warnings.push(args), log() {}, error() {} },
    URL
  });

  const manager = await browserWindow.MaomaoCloud.startCharacterPresence('role-123');
  assert.ok(manager && typeof manager.stop === 'function', 'presence manager 应在首次网络请求完成前即可返回');
  assert.equal(heartbeatAttempts, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof intervalCallback, 'function', '首次请求前就要建立续期重试计时器');
  assert.equal(warnings.length, 1, '首次失败应记录诊断信息');

  intervalCallback();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(heartbeatAttempts, 2, '下一次续期必须重新发送设备心跳');
  const leaseActions = calls
    .filter(call => call.url === '/api/characters/role-123/lease')
    .map(call => JSON.parse(call.options.body || '{}').action);
  assert.deepEqual(leaseActions, ['renew', 'acquire'], '重试成功后继续恢复角色租约');

  manager.stop();
  assert.equal(clearedInterval, 17);
  assert.equal(listeners.has('visibilitychange'), false);
});

test('标签页在心跳请求期间隐藏后不再继续写入角色租约', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const listeners = new Map();
  const calls = [];
  let intervalCallback = null;
  let heartbeatSignal = null;
  let heartbeatAttempts = 0;
  let markHeartbeatStarted;
  const heartbeatStarted = new Promise(resolve => { markHeartbeatStarted = resolve; });
  const browserWindow = {
    AbortController,
    setInterval(callback) {
      intervalCallback = callback;
      return 23;
    },
    clearInterval() {}
  };
  const browserDocument = {
    currentScript: null,
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const localStorageStub = {
    getItem(key) {
      return key === 'cloud_device_v1'
        ? JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
        : null;
    },
    setItem() {},
    removeItem() {}
  };
  const response = payload => ({ ok: true, json: async () => payload });
  const fetchStub = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/presence/config') {
      return response({ ok: true, heartbeatTtlMs: 120000, leaseDurationMs: 120000 });
    }
    if (url === '/api/presence/heartbeat') {
      heartbeatAttempts += 1;
      if (heartbeatAttempts > 1) return response({ ok: true });
      markHeartbeatStarted();
      heartbeatSignal = options.signal;
      return new Promise((resolve, reject) => {
        if (!options.signal) {
          reject(new Error('presence heartbeat should support AbortSignal'));
          return;
        }
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    if (url === '/api/characters/role-123/lease') {
      const action = JSON.parse(options.body || '{}').action;
      if (action === 'renew') {
        return { ok: false, json: async () => ({ ok: false, error: { code: 'LEASE_NOT_OWNED', message: 'not owner' } }) };
      }
      if (action === 'acquire') return response({ ok: true, acquired: true });
    }
    throw new Error('Unexpected request after visibility recovery: ' + url);
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: browserDocument,
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn() {}, log() {}, error() {} },
    URL
  });

  const startPromise = browserWindow.MaomaoCloud.startCharacterPresence('role-123');
  await heartbeatStarted;
  browserDocument.visibilityState = 'hidden';
  listeners.get('visibilitychange')();

  const manager = await startPromise;
  assert.ok(manager && typeof manager.stop === 'function');
  assert.equal(heartbeatSignal.aborted, true, '标签页隐藏时应取消自己的在途请求');
  assert.equal(calls.filter(call => call.url === '/api/presence/heartbeat').length, 1);
  assert.equal(
    calls.some(call => call.url === '/api/characters/role-123/lease'),
    false,
    '页面隐藏后，心跳请求返回也不能继续续租或抢租约'
  );

  browserDocument.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(heartbeatAttempts, 2, '页面重新可见后应立即重新同步');
  const leaseActions = calls
    .filter(call => call.url === '/api/characters/role-123/lease')
    .map(call => JSON.parse(call.options.body || '{}').action);
  assert.deepEqual(leaseActions, ['renew', 'acquire'], '恢复可见后应恢复角色租约');
  manager.stop();
});

test('停止前台管理器会中止当前标签页的在途请求', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  let intervalCallback = null;
  let resolveSecondHeartbeatStarted;
  const secondHeartbeatStarted = new Promise(resolve => { resolveSecondHeartbeatStarted = resolve; });
  let secondHeartbeatSignal = null;
  let heartbeatCount = 0;
  const browserWindow = {
    AbortController,
    setInterval(callback) {
      intervalCallback = callback;
      return 31;
    },
    clearInterval() {}
  };
  const browserDocument = {
    currentScript: null,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {}
  };
  const localStorageStub = {
    getItem(key) {
      return key === 'cloud_device_v1'
        ? JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
        : null;
    },
    setItem() {},
    removeItem() {}
  };
  const response = payload => ({ ok: true, json: async () => payload });
  const fetchStub = async (url, options = {}) => {
    if (url === '/api/presence/config') {
      return response({ ok: true, heartbeatTtlMs: 120000, leaseDurationMs: 120000 });
    }
    if (url === '/api/presence/heartbeat') {
      heartbeatCount += 1;
      if (heartbeatCount === 1) return response({ ok: true });
      secondHeartbeatSignal = options.signal;
      resolveSecondHeartbeatStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
    if (url === '/api/characters/role-123/lease') {
      return response({ ok: true, renewed: true });
    }
    throw new Error('Unexpected request: ' + url);
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: browserDocument,
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn() {}, log() {}, error() {} },
    URL
  });

  const manager = await browserWindow.MaomaoCloud.startCharacterPresence('role-123');
  intervalCallback();
  await secondHeartbeatStarted;
  manager.stop();
  assert.equal(secondHeartbeatSignal.aborted, true, '停止管理器时必须取消在途请求');
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('没有 AbortController 时，隐藏页面也能释放本地锁并隔离旧请求结果', async () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  const listeners = new Map();
  const calls = [];
  let heartbeatCount = 0;
  let resolveFirstHeartbeat;
  let markFirstHeartbeatStarted;
  const firstHeartbeatStarted = new Promise(resolve => { markFirstHeartbeatStarted = resolve; });
  const browserWindow = {
    setInterval() { return 41; },
    clearInterval() {}
  };
  const browserDocument = {
    currentScript: null,
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  const localStorageStub = {
    getItem(key) {
      return key === 'cloud_device_v1'
        ? JSON.stringify({ deviceId: 'device-id-123456', secret: 's'.repeat(32) })
        : null;
    },
    setItem() {},
    removeItem() {}
  };
  const response = payload => ({ ok: true, json: async () => payload });
  const fetchStub = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/presence/config') {
      return response({ ok: true, heartbeatTtlMs: 120000, leaseDurationMs: 120000 });
    }
    if (url === '/api/presence/heartbeat') {
      heartbeatCount += 1;
      if (heartbeatCount === 1) {
        assert.equal(options.signal, undefined, '此测试模拟没有 AbortController 的浏览器');
        markFirstHeartbeatStarted();
        return new Promise(resolve => { resolveFirstHeartbeat = resolve; });
      }
      return response({ ok: true });
    }
    if (url === '/api/characters/role-123/lease') {
      const action = JSON.parse(options.body || '{}').action;
      if (action === 'renew') return response({ ok: true, renewed: true });
      if (action === 'acquire') return response({ ok: true, acquired: true });
    }
    throw new Error('Unexpected request: ' + url);
  };

  vm.runInNewContext(clientSource, {
    window: browserWindow,
    document: browserDocument,
    localStorage: localStorageStub,
    fetch: fetchStub,
    console: { warn() {}, log() {}, error() {} },
    URL
  });

  const manager = await browserWindow.MaomaoCloud.startCharacterPresence('role-123');
  assert.ok(manager && typeof manager.stop === 'function',
    '首次网络请求挂起时也必须把管理器句柄交还给页面');
  await firstHeartbeatStarted;

  browserDocument.visibilityState = 'hidden';
  listeners.get('visibilitychange')();
  browserDocument.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(heartbeatCount, 2, '无 AbortController 时恢复可见也应启动新一轮心跳');
  const leaseCallsBeforeOldResponse = calls.filter(call => call.url === '/api/characters/role-123/lease');
  assert.equal(leaseCallsBeforeOldResponse.length, 1, '新一轮同步应只续租一次');

  resolveFirstHeartbeat(response({ ok: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const leaseCallsAfterOldResponse = calls.filter(call => call.url === '/api/characters/role-123/lease');
  assert.equal(leaseCallsAfterOldResponse.length, 1,
    '旧请求迟到返回后不得继续写租约，也不得覆盖新一轮运行状态');

  manager.stop();
});

test('清理任务不会提前删除超过一小时但仍有效的配对码', async () => {
  const ctx = setupTestStore(openTestDb(), {
    DEVICE_PAIRING_TOKEN_TTL_MS: String(2 * 60 * 60 * 1000)
  });
  const owner = makeDevice();
  await registerDevice(ctx, owner);

  const issued = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: owner
  });
  assert.equal(issued.status, 200);

  ctx.store.cleanupDevicePairingTokens(Date.now() + 60 * 60 * 1000 + 1000);
  const newDevice = makeDevice();
  const paired = await registerDevice(ctx, newDevice, {
    pairingToken: issued.payload.pairingToken
  });
  assert.equal(paired.status, 200);
  assert.equal(paired.payload.device.enrollmentMode, 'paired');
});

test('单设备每小时配对签发上限包含已消费配对码且由原子存储约束', async () => {
  const ctx = setupTestStore(openTestDb());
  const owner = makeDevice();
  await registerDevice(ctx, owner);

  for (let i = 0; i < 5; i += 1) {
    const response = await ctx.asJson('/api/devices/pairing-token', {
      method: 'POST',
      device: owner
    });
    assert.equal(response.status, 200, '前五次配对码签发应允许');

    const pairedDevice = makeDevice();
    const paired = await registerDevice(ctx, pairedDevice, {
      pairingToken: response.payload.pairingToken
    });
    assert.equal(paired.status, 200, '已签发的配对码应可单次消费');
  }

  const limited = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: owner
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'PAIRING_RATE_LIMITED');
  assert.equal(ctx.query('SELECT COUNT(*) AS total FROM device_pairing_tokens')[0].total, 5);
});

test('云端 readiness 只暴露配置状态与匿名队列汇总，且必须设备鉴权', async () => {
  const ctx = setupTestStore(openTestDb(), {
    DEVICE_SECRET_PEPPER: 'test-device-secret-pepper-for-contract-tests-32chars',
    ENROLLMENT_TOKEN: 'test-enrollment-token-for-contract-tests',
    DEVICE_PAIRING_TOKEN_TTL_MS: '300000',
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '60000',
    AUTONOMY_DEVICE_GRACE_MS: '30000',
    VAPID_PUBLIC_KEY: 'public-test-key',
    VAPID_PRIVATE_KEY: 'private-test-key',
    VAPID_SUBJECT: 'mailto:test@example.invalid'
  });
  const device = makeDevice();
  await registerDevice(ctx, device);

  const base = Date.now();
  const enqueueDiagnostic = id => ctx.store.enqueueActivity({
    id,
    deviceId: device.deviceId,
    characterId: 'private-character-id',
    kind: 'contact',
    scheduledAt: base - 1000,
    maxAttempts: 3,
    now: base,
    payload: { privateText: 'do-not-return-this-chat-like-payload' }
  });
  enqueueDiagnostic('readiness-waiting');
  enqueueDiagnostic('readiness-retry');
  enqueueDiagnostic('readiness-running');
  enqueueDiagnostic('readiness-completed');
  enqueueDiagnostic('readiness-failed');
  enqueueDiagnostic('readiness-superseded');

  const otherDevice = makeDevice();
  ctx.store.insertDevice({
    id: otherDevice.deviceId,
    userId: 'another-user',
    secretHash: 'synthetic-other-user-device-hash',
    now: base
  });
  ctx.store.enqueueActivity({
    id: 'readiness-other-user',
    deviceId: otherDevice.deviceId,
    characterId: 'another-private-character',
    kind: 'contact',
    scheduledAt: base - 1000,
    maxAttempts: 3,
    now: base,
    payload: { privateText: 'other-user-private-payload' }
  });
  ctx.store.logExecution({
    id: 'readiness-own-reason',
    deviceId: device.deviceId,
    kind: 'autonomy_tick',
    status: 'deferred',
    reasonCode: 'context_version_unavailable',
    detail: { taskId: 'private-task-id' },
    now: base
  });
  ctx.store.logExecution({
    id: 'readiness-own-success',
    deviceId: device.deviceId,
    kind: 'autonomy_tick',
    status: 'claimed',
    reasonCode: 'claimed',
    detail: { taskId: 'another-private-task-id' },
    now: base - 1000
  });
  ctx.store.logExecution({
    id: 'readiness-own-old-reason',
    deviceId: device.deviceId,
    kind: 'autonomy_tick',
    status: 'deferred',
    reasonCode: 'outside_window',
    detail: { taskId: 'old-private-task-id' },
    now: base - 86400001
  });
  ctx.store.logExecution({
    id: 'readiness-other-reason',
    deviceId: otherDevice.deviceId,
    kind: 'autonomy_tick',
    status: 'deferred',
    reasonCode: 'another_users_reason',
    detail: { taskId: 'another-private-task-id' },
    now: base
  });

  const claim = (id, owner) => ctx.store.claimActivity({
    id,
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    owner,
    leaseUntil: base + 60_000,
    now: base
  });
  assert.ok(claim('readiness-retry', 'retry-worker'));
  assert.equal(ctx.store.failActivity({
    id: 'readiness-retry',
    owner: 'retry-worker',
    attemptCount: 1,
    now: base + 1,
    nextAttemptAt: base + 30_000
  }), true);
  assert.ok(claim('readiness-running', 'running-worker'));
  assert.ok(claim('readiness-completed', 'completed-worker'));
  assert.equal(ctx.store.completeActivity({
    id: 'readiness-completed',
    owner: 'completed-worker',
    attemptCount: 1,
    now: base + 1
  }), true);
  assert.ok(claim('readiness-failed', 'failed-worker'));
  assert.equal(ctx.store.failActivity({
    id: 'readiness-failed',
    owner: 'failed-worker',
    attemptCount: 1,
    now: base + 1,
    nextAttemptAt: null
  }), true);
  assert.equal(ctx.store.supersedeActivity({
    id: 'readiness-superseded',
    expectedAttemptCount: 0,
    expectedStatus: 'waiting',
    now: base + 1
  }), true);

  const readiness = await ctx.asJson('/api/autonomy/readiness', { device });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.payload.deviceAuthorized, true);
  assert.equal(readiness.payload.deviceAuthConfigured, true);
  assert.equal(readiness.payload.bootstrapConfigured, true);
  assert.equal(readiness.payload.pairingConfigured, true);
  assert.equal(readiness.payload.webPushKeysConfigured, true);
  assert.equal(readiness.payload.activePushSubscriptions, 0);
  assert.equal(readiness.payload.testPushReady, false);
  assert.equal(readiness.payload.presenceConfigured, true);
  assert.deepEqual(readiness.payload.activityQueue, {
    total: 6,
    waiting: 1,
    retry: 1,
    running: 1,
    completed: 1,
    failed: 1,
    superseded: 1,
    other: 0
  });
  assert.equal(readiness.payload.activityExecutorAvailable, false);
  assert.equal(readiness.payload.contextVersionReady, false);
  assert.equal(readiness.payload.contextVersionTrackedRoles, 0);
  assert.equal(readiness.payload.autonomousMessageGenerationReady, false);
  assert.deepEqual(readiness.payload.autonomyExecutionBlockers, [
    'executor_unavailable',
    'context_version_unavailable'
  ]);
  assert.deepEqual(readiness.payload.recentSchedulerReasons, [
    { reasonCode: 'context_version_unavailable', count: 1 }
  ]);
  assert.equal(readiness.payload.schedulerDiagnosticsWindowMs, 86400000);
  const readinessJson = JSON.stringify(readiness.payload);
  assert.equal(readinessJson.includes('private-test-key'), false);
  assert.equal(readinessJson.includes('private-character-id'), false);
  assert.equal(readinessJson.includes('do-not-return-this-chat-like-payload'), false);
  assert.equal(readinessJson.includes('another-private-character'), false);
  assert.equal(readinessJson.includes('other-user-private-payload'), false);
  assert.equal(readinessJson.includes('another_users_reason'), false);
  assert.equal(readinessJson.includes('private-task-id'), false);
  assert.deepEqual(ctx.store.getActivityQueueSummary({ userId: 'another-user' }), {
    total: 1, waiting: 1, retry: 0, running: 0,
    completed: 0, failed: 0, superseded: 0, other: 0
  });
  assert.deepEqual(ctx.store.getRecentAutonomyReasonSummary({
    userId: 'another-user',
    since: base - 86400000
  }), [{ reasonCode: 'another_users_reason', count: 1 }]);

  const anonymous = await ctx.asJson('/api/autonomy/readiness');
  assert.equal(anonymous.status, 401);
});

test('设备 pepper 缺失或过短时注册与鉴权 fail-closed', async () => {
  const missing = setupTestStore(openTestDb(), {
    DEVICE_SECRET_PEPPER: ''
  });
  const response = await registerDevice(missing, makeDevice());
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, 'DEVICE_AUTH_NOT_CONFIGURED');

  const weak = setupTestStore(openTestDb(), {
    DEVICE_SECRET_PEPPER: 'too-short'
  });
  const weakResponse = await registerDevice(weak, makeDevice());
  assert.equal(weakResponse.status, 503);
  assert.equal(weakResponse.payload.error.code, 'DEVICE_AUTH_NOT_CONFIGURED');
});

test('初始认领与配对码配置缺失或过期时均 fail-closed', async () => {
  const noBootstrap = setupTestStore(openTestDb(), { ENROLLMENT_TOKEN: '' });
  const first = await registerDevice(noBootstrap, makeDevice());
  assert.equal(first.status, 403);
  assert.equal(first.payload.error.code, 'DEVICE_PAIRING_REQUIRED');

  const expiring = setupTestStore(openTestDb(), {
    DEVICE_PAIRING_TOKEN_TTL_MS: '1000'
  });
  const primary = makeDevice();
  await registerDevice(expiring, primary);
  const created = await expiring.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: primary
  });
  assert.equal(created.status, 200);

  expiring.timestamps.push(Date.now() + 1001);
  const expired = await registerDevice(expiring, makeDevice(), {
    pairingToken: created.payload.pairingToken
  });
  assert.equal(expired.status, 403);
  assert.equal(expired.payload.error.code, 'PAIRING_TOKEN_INVALID');

  const missingTtl = setupTestStore(openTestDb(), {
    DEVICE_PAIRING_TOKEN_TTL_MS: ''
  });
  const owner = makeDevice();
  await registerDevice(missingTtl, owner);
  const cannotMint = await missingTtl.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: owner
  });
  assert.equal(cannotMint.status, 503);
  assert.equal(cannotMint.payload.error.code, 'PAIRING_NOT_CONFIGURED');
});

test('受保护接口拒绝缺失、错误与被撤销的设备凭据', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);

  const anonymous = await ctx.asJson('/api/push/subscriptions');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.payload.error.code, 'UNAUTHORIZED');

  const wrongSecret = await ctx.asJson('/api/push/subscriptions', {
    device: { deviceId: device.deviceId, secret: randomToken(32) }
  });
  assert.equal(wrongSecret.status, 401);

  const unknown = await ctx.asJson('/api/push/subscriptions', {
    device: { deviceId: randomToken(16), secret: randomToken(32) }
  });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.payload.error.code, 'DEVICE_UNKNOWN');

  const subscription = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, subscription);

  // Pair a second real device. It cannot take over the active endpoint.
  const issuedPairing = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device
  });
  assert.equal(issuedPairing.status, 200);
  const otherDevice = makeDevice();
  const pairedOther = await registerDevice(ctx, otherDevice, {
    pairingToken: issuedPairing.payload.pairingToken
  });
  assert.equal(pairedOther.status, 200);

  const stolen = await subscribeDevice(ctx, otherDevice, subscription);
  assert.equal(stolen.status, 409);
  assert.equal(stolen.payload.error.code, 'SUBSCRIPTION_IN_USE');
  assert.equal(ctx.store.getSubscriptionByEndpoint(device.deviceId, subscription.endpoint).device_id, device.deviceId);
  const timestamp = Date.now();

  const revoked = await ctx.asJson('/api/devices/revoke', { method: 'POST', device });
  assert.equal(revoked.status, 200);
  const revokedSubscriptions = ctx.store.listSubscriptions(device.deviceId, { includeDisabled: true });
  assert.equal(revokedSubscriptions.length, 1);
  assert.equal(revokedSubscriptions[0].disabled_reason, 'revoked');
  assert.ok(revokedSubscriptions[0].disabled_at != null);
  assert.equal(ctx.store.listSubscriptions(device.deviceId).length, 0);

  // Simulate a request that passed authentication just before revocation and
  // reaches the storage write after the revocation has committed.
  const lateResubscribe = ctx.store.upsertSubscription({
    id: randomToken(12),
    deviceId: device.deviceId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    authKey: subscription.auth,
    expirationTime: null,
    now: timestamp + 1
  });
  assert.equal(lateResubscribe, null);
  const stillRevoked = ctx.store.getSubscriptionByEndpoint(device.deviceId, subscription.endpoint);
  assert.equal(stillRevoked.disabled_reason, 'revoked');
  assert.ok(stillRevoked.disabled_at != null);

  const afterRevoke = await ctx.asJson('/api/push/subscriptions', { device });
  assert.equal(afterRevoke.status, 401);
  assert.equal(afterRevoke.payload.error.code, 'DEVICE_REVOKED');

  // Once the previous owner is revoked, the paired device may safely reuse
  // the same browser endpoint and reactivate the subscription.
  const transferred = await subscribeDevice(ctx, otherDevice, subscription);
  assert.equal(transferred.status, 200);
  assert.equal(ctx.store.listSubscriptions(otherDevice.deviceId).length, 1);
  assert.equal(ctx.store.getSubscriptionByEndpoint(device.deviceId, subscription.endpoint), null);
});

test('readiness 的在线设备与前台租约计数按账号、心跳 TTL 和 grace 隔离', async () => {
  const timestamp = Date.now();
  const ctx = setupTestStore(openTestDb(), {
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '120000',
    AUTONOMY_DEVICE_GRACE_MS: '30000'
  });
  const activeDevice = makeDevice();
  const staleDevice = makeDevice();
  const revokedDevice = makeDevice();
  const futureDevice = makeDevice();
  await registerDevice(ctx, activeDevice);
  await registerDevice(ctx, staleDevice);
  await registerDevice(ctx, revokedDevice);
  await registerDevice(ctx, futureDevice);

  ctx.store.upsertDevicePresence({
    userId: 'owner',
    deviceId: activeDevice.deviceId,
    foregroundActive: true,
    now: timestamp - 5000
  });
  ctx.store.upsertDevicePresence({
    userId: 'owner',
    deviceId: staleDevice.deviceId,
    foregroundActive: true,
    now: timestamp - 120000
  });
  ctx.store.upsertDevicePresence({
    userId: 'owner',
    deviceId: revokedDevice.deviceId,
    foregroundActive: true,
    now: timestamp - 1000
  });
  ctx.store.upsertDevicePresence({
    userId: 'owner',
    deviceId: futureDevice.deviceId,
    foregroundActive: true,
    now: timestamp + 1000
  });

  const saveLease = (userId, characterId, deviceId, leaseUntil) => (
    ctx.store.acquireCharacterLease({
      userId,
      characterId,
      deviceId,
      now: timestamp,
      leaseUntil,
      graceMs: 30000
    })
  );
  saveLease('owner', 'role_active', activeDevice.deviceId, timestamp + 60000);
  saveLease('owner', 'role_grace', staleDevice.deviceId, timestamp - 10000);
  saveLease('owner', 'role_revoked', revokedDevice.deviceId, timestamp + 60000);

  ctx.query('UPDATE devices SET revoked_at = ? WHERE id = ?', timestamp, revokedDevice.deviceId);

  // A different account also has active heartbeat and lease rows; neither may leak.
  ctx.query(
    `INSERT INTO devices
      (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, '', '', '', '', ?, ?)`,
    'presence_other_user_device',
    'another-user',
    'unused-secret-hash',
    timestamp,
    timestamp
  );
  ctx.store.upsertDevicePresence({
    userId: 'another-user',
    deviceId: 'presence_other_user_device',
    foregroundActive: true,
    now: timestamp - 1000
  });
  saveLease('another-user', 'other_user_role', 'presence_other_user_device', timestamp + 60000);

  ctx.timestamps.push(timestamp);
  const response = await ctx.asJson('/api/autonomy/readiness', { device: activeDevice });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.presenceSummary, {
    authorizedDevices: 3,
    foregroundDevices: 1,
    validCharacterLeases: 1,
    graceCharacterLeases: 1
  });
});

test('推送订阅生命周期：订阅、去重、退订与失效', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();

  const created = await subscribeDevice(ctx, device, sub);
  assert.equal(created.status, 200);
  assert.equal(created.payload.subscription.created, true);

  // 同一 endpoint 重复订阅只更新，不新增记录。
  const repeated = await subscribeDevice(ctx, device, sub);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.subscription.created, false);
  const rows = ctx.store.listSubscriptions(device.deviceId);
  assert.equal(rows.length, 1);

  const listed = await ctx.asJson('/api/push/subscriptions', { device });
  assert.equal(listed.status, 200);
  assert.equal(listed.payload.subscriptions.length, 1);
  assert.equal(listed.payload.subscriptions[0].disabledAt, null);

  const unsubscribed = await ctx.asJson('/api/push/unsubscribe', {
    method: 'POST',
    device,
    body: { endpoint: sub.endpoint }
  });
  assert.equal(unsubscribed.status, 200);
  const active = ctx.store.listSubscriptions(device.deviceId);
  assert.equal(active.length, 0, '退订后不应再出现在有效订阅里');
  const all = ctx.store.listSubscriptions(device.deviceId, { includeDisabled: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].disabled_reason, 'user');
});

test('推送 endpoint 拒绝本机、内网名称、IP、凭据和非标准端口', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();

  const unsafeEndpoints = [
    'https://localhost/push',
    'https://device.local/push',
    'https://service.internal/push',
    'https://127.0.0.1/push',
    'https://2130706433/push',
    'https://[::1]/push',
    'https://user:pass@push.example.com/push',
    'https://push.example.com:8443/push'
  ];

  for (const endpoint of unsafeEndpoints) {
    const response = await ctx.asJson('/api/push/subscriptions', {
      method: 'POST',
      device,
      body: {
        subscription: {
          endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }
      }
    });
    assert.equal(response.status, 400, endpoint);
    assert.equal(response.payload.error.code, 'INVALID_SUBSCRIPTION', endpoint);
  }
  assert.equal(ctx.store.listSubscriptions(device.deviceId, { includeDisabled: true }).length, 0);
});

test('非法订阅被拒绝：协议、endpoint 与密钥格式', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();

  const insecure = await ctx.asJson('/api/push/subscriptions', {
    method: 'POST',
    device,
    body: { subscription: { endpoint: 'http://push.example.com/x', keys: { p256dh: sub.p256dh, auth: sub.auth } } }
  });
  assert.equal(insecure.status, 400);
  assert.equal(insecure.payload.error.code, 'INVALID_SUBSCRIPTION');

  const badAuth = await ctx.asJson('/api/push/subscriptions', {
    method: 'POST',
    device,
    body: { subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: 'bad' } } }
  });
  assert.equal(badAuth.status, 400);

  const badKey = await ctx.asJson('/api/push/subscriptions', {
    method: 'POST',
    device,
    body: { subscription: { endpoint: sub.endpoint, keys: { p256dh: 'bad', auth: sub.auth } } }
  });
  assert.equal(badKey.status, 400);

  const missing = await ctx.asJson('/api/push/subscriptions', {
    method: 'POST',
    device,
    body: {}
  });
  assert.equal(missing.status, 400);
});

test('test-push：授权、真实加密发送、过期订阅清理与重复通知抑制', async () => {
  const keys = makeVapidKeys();
  const pushFetch = createFakePushFetch(201);
  const ctx = setupTestStore(openTestDb(), {
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev',
    fetchImpl: pushFetch
  });
  const device = makeDevice();
  await registerDevice(ctx, device);

  // 未配置订阅时不应假装成功。
  const noSub = await ctx.asJson('/api/push/test', { method: 'POST', device, body: { dedupeKey: 'k1' } });
  assert.equal(noSub.status, 409);
  assert.equal(noSub.payload.error.code, 'NO_ACTIVE_SUBSCRIPTIONS');

  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);

  const unauthorized = await ctx.asJson('/api/push/test', {
    method: 'POST',
    body: { dedupeKey: 'k1' }
  });
  assert.equal(unauthorized.status, 401);

  const first = await ctx.asJson('/api/push/test', { method: 'POST', device, body: { dedupeKey: 'k1' } });
  assert.equal(first.status, 200);
  assert.equal(first.payload.summary.sent, 1);
  assert.equal(first.payload.summary.failed, 0);
  assert.equal(pushFetch.calls.length, 1);
  const request = pushFetch.calls[0];
  assert.match(String(request.init.headers.Authorization), /^vapid t=/);
  assert.equal(request.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(request.init.redirect, 'error', '推送 endpoint 不应把 Worker 重定向到其他目标');
  assert.ok(request.init.signal instanceof AbortSignal, '推送请求必须携带可取消的超时信号');
  assert.equal(PUSH_SEND_TIMEOUT_MS, 25000, '网络发送超时必须短于 60 秒投递租约');
  assert.ok(request.init.body instanceof Uint8Array, '请求体必须是加密后的字节');

  // 同一 dedupeKey 再发一次：不得再次 push（跨端/重试去重）。
  const duplicate = await ctx.asJson('/api/push/test', { method: 'POST', device, body: { dedupeKey: 'k1' } });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.payload.summary.skipped, 1);
  assert.equal(pushFetch.calls.length, 1, '同一条消息不得重复推送');

  // 推送服务返回 410 → 订阅必须被停用，后续不再发送。
  const goneSub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, goneSub);
  pushFetch.setStatus(410);
  const gone = await ctx.asJson('/api/push/test', { method: 'POST', device, body: { dedupeKey: 'k2' } });
  assert.equal(gone.status, 200);
  assert.equal(gone.payload.summary.gone, 2);
  const activeAfterGone = ctx.store.listSubscriptions(device.deviceId, { includeDisabled: true });
  assert.equal(activeAfterGone.filter(row => row.disabled_at === null).length, 0);
  for (const row of activeAfterGone) assert.equal(row.disabled_reason, 'gone');

  // 过期订阅清理。
  const stale = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, stale);
  // 直接把过期时间设为过去，模拟浏览器端已失效的订阅。
  ctx.query(
    'UPDATE push_subscriptions SET expiration_time = ? WHERE endpoint = ?',
    Date.now() - 1000,
    stale.endpoint
  );
  const removed = ctx.store.cleanupSubscriptions(Date.now(), { disabledRetentionMs: 86400000 });
  assert.ok(removed >= 1, '过期/长期停用的订阅应被清理');
  assert.equal(ctx.store.getSubscriptionByEndpoint(device.deviceId, stale.endpoint), null);
});

test('同一推送事件的临时失败可退避重试，成功后仍保持幂等', async () => {
  const keys = makeVapidKeys();
  const pushFetch = createFakePushFetch(503);
  const ctx = setupTestStore(openTestDb(), {
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev',
    fetchImpl: pushFetch
  });
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);

  const first = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'retryable-delivery' }
  });
  assert.equal(first.status, 200);
  assert.equal(first.payload.summary.failed, 1);
  assert.equal(first.payload.summary.retryScheduled, 1);
  assert.equal(first.payload.results[0].status, 'retry_scheduled');
  assert.equal(pushFetch.calls.length, 1);

  const failedRow = ctx.store.findDelivery('retryable-delivery', ctx.store.listSubscriptions(device.deviceId)[0].id);
  assert.equal(failedRow.status, 'error');
  assert.equal(failedRow.attempt_count, 1);
  assert.equal(failedRow.next_attempt_at, failedRow.updated_at + 30000);

  const tooEarly = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'retryable-delivery' }
  });
  assert.equal(tooEarly.status, 200);
  assert.equal(tooEarly.payload.summary.retryDeferred, 1);
  assert.equal(tooEarly.payload.results[0].status, 'retry_deferred');
  assert.equal(pushFetch.calls.length, 1, '退避时间未到不能反复敲推送服务');

  ctx.timestamps.push(failedRow.next_attempt_at);
  pushFetch.setStatus(201);
  const retried = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'retryable-delivery' }
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.payload.summary.sent, 1);
  assert.equal(pushFetch.calls.length, 2);
  const sentRow = ctx.store.findDelivery('retryable-delivery', ctx.store.listSubscriptions(device.deviceId)[0].id);
  assert.equal(sentRow.status, 'sent');
  assert.equal(sentRow.attempt_count, 2);
  assert.equal(sentRow.lease_owner, null);
  assert.equal(sentRow.lease_until, null);

  // Move outside the per-device 10-minute attempt window before checking
  // successful-delivery dedupe independently of rate limiting.
  ctx.timestamps.push(failedRow.next_attempt_at + 600001);
  const duplicate = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'retryable-delivery' }
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.payload.summary.skipped, 1);
  assert.equal(pushFetch.calls.length, 2, '成功后同一事件依旧不能重复推送');
});

test('并发的相同推送事件只有一个请求能取得订阅投递租约', async () => {
  const keys = makeVapidKeys();
  const calls = [];
  let resolveFetch;
  let markFetchStarted;
  const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    markFetchStarted();
    await new Promise(resolve => { resolveFetch = resolve; });
    return new Response('', { status: 201 });
  };
  const ctx = setupTestStore(openTestDb(), {
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev',
    fetchImpl
  });
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);

  const firstRequest = ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'concurrent-delivery' }
  });
  await fetchStarted;

  const concurrentRequest = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'concurrent-delivery' }
  });
  assert.equal(concurrentRequest.status, 200);
  assert.equal(concurrentRequest.payload.summary.inProgress, 1);
  assert.equal(calls.length, 1, '第二个请求不能在第一个发送尚未结束时重复推送');

  resolveFetch();
  const first = await firstRequest;
  assert.equal(first.status, 200);
  assert.equal(first.payload.summary.sent, 1);
  assert.equal(calls.length, 1);
});

test('连续失败的推送尝试也会计入每设备速率限制', async () => {
  const keys = makeVapidKeys();
  const pushFetch = createFakePushFetch(503);
  const ctx = setupTestStore(openTestDb(), {
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev',
    fetchImpl: pushFetch
  });
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);

  for (let index = 0; index < 3; index += 1) {
    const attempt = await ctx.asJson('/api/push/test', {
      method: 'POST',
      device,
      body: { dedupeKey: 'failing-key-' + index }
    });
    assert.equal(attempt.status, 200);
    assert.equal(attempt.payload.summary.retryScheduled, 1);
  }

  const limited = await ctx.asJson('/api/push/test', {
    method: 'POST',
    device,
    body: { dedupeKey: 'fourth-unique-key' }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'PUSH_RATE_LIMITED');
  assert.equal(pushFetch.calls.length, 3,
    '连续失败也必须受速率限制，不能靠每次换 dedupeKey 绕过');
});

test('并发 test-push HTTP 请求最多只有三个能取得设备限流名额', async () => {
  const keys = makeVapidKeys();
  const pushFetch = createFakePushFetch(201);
  const ctx = setupTestStore(openTestDb(), {
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev',
    fetchImpl: pushFetch
  });
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);

  const responses = await Promise.all(
    Array.from({ length: 4 }, (_, index) => ctx.asJson('/api/push/test', {
      method: 'POST',
      device,
      body: { dedupeKey: 'parallel-http-' + index }
    }))
  );
  const statuses = responses.map(response => response.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  assert.equal(
    pushFetch.calls.length,
    3,
    '并发 HTTP 请求中只有实际取得原子限流名额的三条可以访问推送服务'
  );
});

test('test-push 在未配置 VAPID 时返回明确的 503，而不是静默失败', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);
  const sub = await makeBrowserSubscription();
  await subscribeDevice(ctx, device, sub);
  const response = await ctx.asJson('/api/push/test', { method: 'POST', device, body: {} });
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, 'PUSH_NOT_CONFIGURED');
});

test('VAPID JWT 签名可被公钥验证，aud 为推送服务源', async () => {
  const keys = makeVapidKeys();
  const parsed = parseVapidKeys({
    VAPID_PUBLIC_KEY: keys.publicB64,
    VAPID_PRIVATE_KEY: keys.privateB64,
    VAPID_SUBJECT: 'mailto:test@maomao.dev'
  });
  const nowMs = Date.now();
  const header = await buildVapidAuthorization('https://push.example.com/send/abc', parsed, nowMs);
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match, 'Authorization 头格式必须是 vapid t=..., k=...');
  const [, token, key] = match;
  assert.equal(key, keys.publicB64, '必须下发公开的 VAPID public key');

  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const head = decode(headerPart);
  const body = decode(payloadPart);
  assert.equal(head.alg, 'ES256');
  assert.equal(head.typ, 'JWT');
  assert.equal(body.aud, 'https://push.example.com');
  assert.equal(body.sub, 'mailto:test@maomao.dev');
  assert.ok(body.exp > nowMs / 1000 + 3600, 'exp 至少还有 1 小时');

  const verifyKey = await crypto.subtle.importKey(
    'raw',
    keys.publicBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    Buffer.from(signaturePart, 'base64url'),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  assert.equal(valid, true, 'JWT 签名必须能用公钥验证');
});

test('aes128gcm 载荷可被订阅方的私钥解密（真实往返）', async () => {
  const sub = await makeBrowserSubscription();
  const plaintext = JSON.stringify({ title: 'hello', body: 'world', type: 'message' });
  const encrypted = await encryptPayload(sub, plaintext);
  assert.equal(encrypted.length > 86, true);

  const salt = encrypted.slice(0, 16);
  const recordSize = new DataView(encrypted.buffer, 16, 4).getUint32(0, false);
  assert.equal(recordSize, 4096);
  const keyIdLength = encrypted[20];
  assert.equal(keyIdLength, 65);
  const asPublic = encrypted.slice(21, 21 + keyIdLength);
  const ciphertext = encrypted.slice(21 + keyIdLength);

  const authSecret = base64UrlToBytes(sub.auth);
  const uaPublic = base64UrlToBytes(sub.p256dh);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    },
    sub.keyPair.privateKey,
    256
  ));

  const hkdf = async (ikm, hkdfSalt, info, bits) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info },
      key,
      bits
    ));
  };
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };

  const ikm = await hkdf(
    shared,
    authSecret,
    concat(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic),
    256
  );
  const cek = await hkdf(ikm, salt, concat(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 128);
  const nonce = await hkdf(ikm, salt, concat(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0])), 96);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    ciphertext
  ));
  assert.equal(decrypted[decrypted.length - 1], 2, '必须以 0x02 记录分隔符结尾');
  assert.equal(
    Buffer.from(decrypted.slice(0, -1)).toString('utf8'),
    plaintext,
    '解密结果必须与原文一致'
  );
});

test('云端消息幂等：同一 server message id 只落一条', async () => {
  const testDb = openTestDb();
  const ctx = setupTestStore(testDb);
  const message = {
    id: randomToken(12),
    serverMessageId: 'srv_1',
    deviceId: 'dev',
    characterId: 'heroine',
    payload: { text: 'hi' },
    dedupeKey: 'dedupe_1',
    now: Date.now()
  };
  const first = ctx.store.insertOutboundMessage(message);
  assert.equal(first.inserted, true);
  const second = ctx.store.insertOutboundMessage({ ...message, id: randomToken(12) });
  assert.equal(second.inserted, false);
  assert.equal(second.message.server_message_id, 'srv_1');
  const rows = testDb.query('SELECT COUNT(*) AS total FROM outbound_messages');
  assert.equal(Number(rows[0].total), 1);
});

/* ------------------------------------------------------------------ */
/* Service Worker 回归：保留缓存/离线导航，同时具备推送处理能力          */
/* ------------------------------------------------------------------ */

function loadServiceWorker() {
  const source = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  const handlers = { push: [], notificationclick: [], install: [], activate: [], fetch: [] };
  const notifications = [];
  const opened = [];
  const focused = [];
  const navigations = [];
  const clients = {
    matchAll: async () => [
      {
        url: 'https://mao.test/chat/chat/chat.html',
        focus: async () => { focused.push('existing'); return undefined; },
        navigate: async url => { navigations.push(url); return undefined; }
      }
    ],
    openWindow: async url => { opened.push(url); return undefined; }
  };
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
      location: { origin: 'https://mao.test' },
      registration: {
        scope: 'https://mao.test/',
        showNotification: async (title, options) => { notifications.push({ title, options }); }
      },
      clients,
      skipWaiting: () => undefined,
      console
    },
    caches: {
      open: async () => ({ add: async () => undefined, put: async () => undefined, match: async () => null }),
      match: async () => null,
      keys: async () => []
    },
    fetch: async () => new Response('', { status: 200 }),
    URL,
    Response,
    console,
    Date,
    Promise,
    JSON,
    Array,
    Set,
    Uint8Array,
    TextDecoder
  };
  vm.runInNewContext(source, sandbox, { filename: 'sw.js' });
  return { handlers, notifications, opened, focused, navigations };
}

test('sw.js 保留缓存与离线导航，并新增 push / notificationclick', async () => {
  const sw = loadServiceWorker();
  assert.ok(sw.handlers.install.length >= 1, 'install 处理器必须保留');
  assert.ok(sw.handlers.activate.length >= 1, 'activate 处理器必须保留');
  assert.ok(sw.handlers.fetch.length >= 1, 'fetch 处理器必须保留');
  assert.equal(sw.handlers.push.length, 1, '必须注册 push 处理器');
  assert.equal(sw.handlers.notificationclick.length, 1, '必须注册 notificationclick 处理器');

  // 推送展示
  const pushEvent = {
    data: { json: () => ({ title: '测试', body: 'hello', url: './chat/chat/chat-detail.html?id=heroine', tag: 't1' }) },
    waitUntil: promise => { pushEvent.wait = promise; }
  };
  sw.handlers.push[0](pushEvent);
  await pushEvent.wait;
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].title, '测试');
  assert.equal(sw.notifications[0].options.tag, 't1');
  assert.equal(
    sw.notifications[0].options.data.url,
    'https://mao.test/chat/chat/chat-detail.html?id=heroine',
    '合法聊天路径必须被解析为本站绝对地址'
  );

  // 外站 URL 必须被拒绝，回退到首页
  const evil = {
    data: { json: () => ({ title: 'x', body: 'y', url: 'https://evil.example/phish' }) },
    waitUntil: promise => { evil.wait = promise; }
  };
  sw.handlers.push[0](evil);
  await evil.wait;
  assert.equal(sw.notifications[1].options.data.url, 'https://mao.test/index.html');

  // 点击通知：已有本站窗口时在该窗口内跳转
  const clickEvent = {
    notification: { close: () => undefined, data: { url: 'https://mao.test/chat/chat/chat-detail.html?id=heroine' } },
    waitUntil: promise => { clickEvent.wait = promise; }
  };
  sw.handlers.notificationclick[0](clickEvent);
  await clickEvent.wait;
  assert.deepEqual(sw.navigations, ['https://mao.test/chat/chat/chat-detail.html?id=heroine']);
  assert.deepEqual(sw.opened, [], '已有窗口时不应重复开窗');
});

test('客户端代码不含任何私钥或 API Key 字面量', async () => {
  const client = fs.readFileSync(path.join(rootDir, 'shared/js/cloud-push-client.js'), 'utf8');
  assert.equal(/VAPID_PRIVATE_KEY/.test(client), false, '前端不得引用 VAPID 私钥');
  assert.equal(/apiKey|api_key|Authorization:\s*Bearer/i.test(client), false, '前端不得携带 AI API Key');
  assert.ok(client.includes('cloud_device_v1'), '设备凭据只保存于本机 localStorage');

  const settings = fs.readFileSync(path.join(rootDir, 'settings/settings.html'), 'utf8');
  assert.ok(settings.includes('cloudPushToggle'), '设置页必须提供推送开关');
  assert.ok(settings.includes('cloud-push-client.js'), '设置页必须加载云连接客户端');

  const serviceWorker = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
  assert.ok(serviceWorker.includes("'./shared/js/cloud-push-client.js'"), 'PWA 必须预缓存云连接客户端');
});


test('自主活动元数据 API：全局与角色开关、继承、IANA 时区和作息只接受已鉴权写入', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);

  const globalDefault = await ctx.asJson('/api/autonomy/global', { device });
  assert.equal(globalDefault.status, 200);
  assert.equal(globalDefault.payload.enabled, false);
  assert.equal(globalDefault.payload.configured, false);

  const globalOn = await ctx.asJson('/api/autonomy/global', {
    method: 'PUT',
    device,
    body: { enabled: true }
  });
  assert.equal(globalOn.status, 200);
  assert.equal(globalOn.payload.enabled, true);

  const inherited = await ctx.asJson('/api/autonomy/characters/char-a', { device });
  assert.equal(inherited.status, 200);
  assert.equal(inherited.payload.enabled, null);
  assert.equal(inherited.payload.inherited, true);

  const roleOff = await ctx.asJson('/api/autonomy/characters/char-a', {
    method: 'PUT',
    device,
    body: { enabled: false }
  });
  assert.equal(roleOff.status, 200);
  assert.equal(roleOff.payload.enabled, false);
  assert.equal(roleOff.payload.inherited, false);

  const roleInherit = await ctx.asJson('/api/autonomy/characters/char-a', {
    method: 'PUT',
    device,
    body: { enabled: null }
  });
  assert.equal(roleInherit.status, 200);
  assert.equal(roleInherit.payload.inherited, true);

  const invalidSchedule = await ctx.asJson('/api/characters/char-a/schedule', {
    method: 'PUT',
    device,
    body: { timeZone: 'Not/A_Real_Zone', schedule: { active: [{ start: '00:00', end: '24:00' }] } }
  });
  assert.equal(invalidSchedule.status, 400);
  assert.equal(invalidSchedule.payload.error.code, 'INVALID_TIME_ZONE');

  const savedSchedule = await ctx.asJson('/api/characters/char-a/schedule', {
    method: 'PUT',
    device,
    body: {
      timeZone: 'America/Los_Angeles',
      schedule: {
        active: [{ start: '09:00', end: '22:00' }],
        busy: [{ start: '13:00', end: '14:00' }],
        asleep: [{ start: '23:00', end: '07:00' }],
        away: []
      }
    }
  });
  assert.equal(savedSchedule.status, 200);
  assert.equal(savedSchedule.payload.configured, true);
  assert.equal(savedSchedule.payload.timeZone, 'America/Los_Angeles');

  const readSchedule = await ctx.asJson('/api/characters/char-a/schedule', { device });
  assert.equal(readSchedule.status, 200);
  assert.equal(readSchedule.payload.schedule.active[0].startMinute, 540);
  assert.equal(readSchedule.payload.schedule.active[0].endMinute, 1320);

  const unauthenticated = await ctx.asJson('/api/autonomy/global', {
    method: 'PUT',
    body: { enabled: true }
  });
  assert.equal(unauthenticated.status, 401);
});

test('设备前台心跳和角色租约：CAS 独占、grace 保护、只能由 owner 释放', async () => {
  const config = {
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '60000',
    AUTONOMY_DEVICE_GRACE_MS: '30000'
  };
  const ctx = setupTestStore(openTestDb(), config);
  const deviceA = makeDevice();
  const deviceB = makeDevice();
  await registerDevice(ctx, deviceA);
  const pairing = await ctx.asJson('/api/devices/pairing-token', {
    method: 'POST',
    device: deviceA
  });
  assert.equal(pairing.status, 200);
  await registerDevice(ctx, deviceB, { pairingToken: pairing.payload.pairingToken });

  const beatA = await ctx.asJson('/api/presence/heartbeat', {
    method: 'POST',
    device: deviceA,
    body: { foregroundActive: true }
  });
  assert.equal(beatA.status, 200);
  const beatB = await ctx.asJson('/api/presence/heartbeat', {
    method: 'POST',
    device: deviceB,
    body: { foregroundActive: true }
  });
  assert.equal(beatB.status, 200);

  const acquireA = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device: deviceA,
    body: { action: 'acquire' }
  });
  assert.equal(acquireA.status, 200);
  assert.equal(acquireA.payload.ownerDeviceId, deviceA.deviceId);

  // A hidden tab must not delete its role lease because another tab on the
  // same device may still be active; only the explicit lease release does so.
  const hiddenA = await ctx.asJson('/api/presence/heartbeat', {
    method: 'POST',
    device: deviceA,
    body: { foregroundActive: false }
  });
  assert.equal(hiddenA.status, 200);
  assert.equal(ctx.store.getCharacterLease('owner', 'char-a').owner_device_id, deviceA.deviceId);

  const acquireB = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device: deviceB,
    body: { action: 'acquire' }
  });
  assert.equal(acquireB.status, 409);
  assert.equal(acquireB.payload.error.code, 'CHARACTER_LEASE_HELD');

  const releaseByB = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device: deviceB,
    body: { action: 'release' }
  });
  assert.equal(releaseByB.status, 200);
  assert.equal(releaseByB.payload.released, false);
  assert.equal(ctx.store.getCharacterLease('owner', 'char-a').owner_device_id, deviceA.deviceId);

  const releaseByA = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device: deviceA,
    body: { action: 'release' }
  });
  assert.equal(releaseByA.status, 200);
  assert.equal(releaseByA.payload.released, true);

  const beatAOff = await ctx.asJson('/api/presence/heartbeat', {
    method: 'POST',
    device: deviceA,
    body: { foregroundActive: false }
  });
  assert.equal(beatAOff.status, 200);
  assert.equal(beatAOff.payload.foregroundActive, false);

  await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device: deviceB,
    body: { action: 'acquire' }
  });
  assert.equal(ctx.store.getCharacterLease('owner', 'char-a').owner_device_id, deviceB.deviceId);

  const revokeB = await ctx.asJson('/api/devices/revoke', { method: 'POST', device: deviceB });
  assert.equal(revokeB.status, 200);
  assert.equal(ctx.store.getCharacterLease('owner', 'char-a'), null);
});

test('设备租约缺少显式配置或缺少有效前台心跳时 fail-closed', async () => {
  const ctx = setupTestStore(openTestDb());
  const device = makeDevice();
  await registerDevice(ctx, device);

  const noConfig = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device,
    body: { action: 'acquire' }
  });
  assert.equal(noConfig.status, 503);
  assert.equal(noConfig.payload.error.code, 'PRESENCE_NOT_CONFIGURED');

  const noHeartbeat = await ctx.asJson('/api/characters/char-a/lease', {
    method: 'POST',
    device,
    body: { action: 'release' }
  });
  assert.equal(noHeartbeat.status, 200);
  assert.equal(noHeartbeat.payload.released, false);
});


test('presence config 只返回显式服务端参数，缺失配置或未鉴权时拒绝', async () => {
  const configured = setupTestStore(openTestDb(), {
    AUTONOMY_HEARTBEAT_TTL_MS: '90000',
    AUTONOMY_DEVICE_LEASE_MS: '120000',
    AUTONOMY_DEVICE_GRACE_MS: '0'
  });
  const device = makeDevice();
  await registerDevice(configured, device);

  const config = await configured.asJson('/api/presence/config', { device });
  assert.equal(config.status, 200);
  assert.equal(config.payload.heartbeatTtlMs, 90000);
  assert.equal(config.payload.leaseDurationMs, 120000);
  assert.equal(config.payload.graceMs, 0);

  const anonymous = await configured.asJson('/api/presence/config');
  assert.equal(anonymous.status, 401);

  const missing = setupTestStore(openTestDb());
  const missingDevice = makeDevice();
  await registerDevice(missing, missingDevice);
  const unavailable = await missing.asJson('/api/presence/config', { device: missingDevice });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.payload.error.code, 'PRESENCE_NOT_CONFIGURED');
});
