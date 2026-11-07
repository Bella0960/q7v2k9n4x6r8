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
  parseVapidKeys
} from '../worker/lib/webpush.js';
import { applyMigrations } from '../worker/lib/migrations.js';
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
    body: { ...device, label: 'test-device', platform: 'node', ...extra }
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

test('迁移 0001/0002 建立云推送与非聊天自主活动元数据表', async () => {
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
    'character_leases'
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

  // 幂等：重复执行迁移不会重复建表，也不会重复记录版本。
  const applied = applyMigrations(testDb.exec);
  assert.deepEqual(applied, []);
  const versions = testDb.query('SELECT version FROM schema_migrations');
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.map(row => row.version).sort(), ['0001_init', '0002_autonomy_metadata']);
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

  const revoked = await ctx.asJson('/api/devices/revoke', { method: 'POST', device });
  assert.equal(revoked.status, 200);
  const afterRevoke = await ctx.asJson('/api/push/subscriptions', { device });
  assert.equal(afterRevoke.status, 401);
  assert.equal(afterRevoke.payload.error.code, 'DEVICE_REVOKED');
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
  assert.equal(readSchedule.payload.schedule.active[0].start, '09:00');

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
  await registerDevice(ctx, deviceB);

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
