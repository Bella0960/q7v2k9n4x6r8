import {
  ApiError, fail, ok, readJsonBody
} from './http.js';
import {
  base64UrlToBytes, randomToken, sha256Hex, timingSafeEqualHex
} from './crypto.js';
import {
  PushConfigError, parseVapidKeys, sendWebPush
} from './webpush.js';
import '../../shared/js/phone/character-schedule-policy.js';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_SUBSCRIPTIONS_PER_DEVICE = 10;
const REGISTRATIONS_PER_IP_PER_HOUR = 20;
const PAIRING_TOKENS_PER_DEVICE_PER_HOUR = 5;
const TEST_PUSH_PER_10_MINUTES = 3;

export const MILESTONE = '1';

function deviceAuthHeader(request) {
  const raw = String(request.headers.get('x-device-auth') || '').trim();
  const point = raw.indexOf('.');
  if (point <= 0) return null;
  const deviceId = raw.slice(0, point);
  const secret = raw.slice(point + 1);
  if (!DEVICE_ID_PATTERN.test(deviceId) || !DEVICE_SECRET_PATTERN.test(secret)) return null;
  return { deviceId, secret };
}

async function secretHash(env, deviceId, secret) {
  const pepper = String(env?.DEVICE_SECRET_PEPPER || '');
  if (pepper.length < 32) {
    throw new ApiError(503, 'DEVICE_AUTH_NOT_CONFIGURED', '设备鉴权密钥未配置或长度不足');
  }
  return sha256Hex(`${pepper}|${deviceId}|${secret}`);
}

async function clientIpHash(request, env) {
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim();
  if (!ip) return 'unavailable';
  return (await sha256Hex(`${String(env?.DEVICE_SECRET_PEPPER || '')}|ip|${ip}`)).slice(0, 32);
}

function validateSubscription(input) {
  if (!input || typeof input !== 'object') {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', '缺少 subscription 对象');
  }
  const endpoint = String(input.endpoint || '').trim();
  if (!endpoint || endpoint.length > 1024) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'endpoint 非法');
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'endpoint 不是合法 URL');
  }
  if (url.protocol !== 'https:') {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'endpoint 必须是 https');
  }
  const keys = input.keys || {};
  const p256dhBytes = base64UrlToBytes(String(keys.p256dh || ''));
  const authBytes = base64UrlToBytes(String(keys.auth || ''));
  if (!p256dhBytes || p256dhBytes.length !== 65 || p256dhBytes[0] !== 4) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'keys.p256dh 非法');
  }
  if (!authBytes || authBytes.length !== 16) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'keys.auth 非法');
  }
  let expirationTime = null;
  if (input.expirationTime !== null && input.expirationTime !== undefined) {
    expirationTime = Number(input.expirationTime);
    if (!Number.isFinite(expirationTime) || expirationTime <= 0) expirationTime = null;
  }
  return {
    endpoint,
    p256dh: String(keys.p256dh),
    authKey: String(keys.auth),
    expirationTime
  };
}

function vapidSummary(env) {
  return {
    configured: Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY && env?.VAPID_SUBJECT),
    publicKey: String(env?.VAPID_PUBLIC_KEY || '')
  };
}

const OWNER_USER_ID = 'owner';
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,96}$/;

function parsePositiveEnv(env, name) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseNonNegativeEnv(env, name) {
  const raw = env?.[name];
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readPresenceConfig(env) {
  const heartbeatTtlMs = parsePositiveEnv(env, 'AUTONOMY_HEARTBEAT_TTL_MS');
  const leaseDurationMs = parsePositiveEnv(env, 'AUTONOMY_DEVICE_LEASE_MS');
  const graceMs = parseNonNegativeEnv(env, 'AUTONOMY_DEVICE_GRACE_MS');
  if (heartbeatTtlMs == null || leaseDurationMs == null || graceMs == null) return null;
  return { heartbeatTtlMs, leaseDurationMs, graceMs };
}

function readCharacterId(raw) {
  let value = '';
  try {
    value = decodeURIComponent(String(raw || ''));
  } catch {
    return null;
  }
  return CHARACTER_ID_PATTERN.test(value) ? value : null;
}

function validateScheduleInput(body) {
  const policy = globalThis.CharacterSchedulePolicy;
  if (!policy || typeof policy.isValidTimeZone !== 'function') {
    throw new ApiError(503, 'SCHEDULE_POLICY_UNAVAILABLE', '角色作息策略暂不可用');
  }
  const timeZone = String(body?.timeZone || '').trim();
  if (!timeZone || timeZone.length > 96 || !policy.isValidTimeZone(timeZone)) {
    throw new ApiError(400, 'INVALID_TIME_ZONE', '必须提供有效的 IANA 时区');
  }
  const schedule = body?.schedule;
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new ApiError(400, 'INVALID_SCHEDULE', '必须提供角色作息对象');
  }
  const allowed = ['active', 'busy', 'asleep', 'away'];
  const normalizedSchedule = {};
  for (const key of Object.keys(schedule)) {
    if (!allowed.includes(key)) {
      throw new ApiError(400, 'INVALID_SCHEDULE', '角色作息包含未知状态');
    }
    if (key === 'away' && typeof schedule.away === 'boolean') {
      normalizedSchedule.away = schedule.away;
      continue;
    }
    const windows = Array.isArray(schedule[key]) ? schedule[key] : [schedule[key]];
    const normalizedWindows = [];
    for (const windowValue of windows) {
      const normalized = policy.normalizeWindow(windowValue);
      if (!normalized) {
        throw new ApiError(400, 'INVALID_SCHEDULE', '作息时间窗口格式无效');
      }
      normalizedWindows.push({
        startMinute: normalized.startMinute,
        endMinute: normalized.endMinute
      });
    }
    normalizedSchedule[key] = normalizedWindows;
  }
  if (!Object.prototype.hasOwnProperty.call(schedule, 'active')) {
    throw new ApiError(400, 'INVALID_SCHEDULE', '必须明确提供 active 时间窗口；留空数组表示当前不允许主动活动');
  }
  const serialized = JSON.stringify(normalizedSchedule);
  if (serialized.length > 4000) {
    throw new ApiError(413, 'SCHEDULE_TOO_LARGE', '作息配置过长');
  }
  return { timeZone, schedule: normalizedSchedule };
}

/**
 * 创建 API 处理器。不依赖 Workerd 专有 API，便于用 node:sqlite 直接跑契约测试。
 */
export function createApp({ store, env = {}, now = () => Date.now(), fetchImpl = fetch }) {
  async function authenticate(request) {
    const parsed = deviceAuthHeader(request);
    if (!parsed) throw new ApiError(401, 'UNAUTHORIZED', '缺少或非法的设备凭据');
    const device = await store.getDevice(parsed.deviceId);
    if (!device) throw new ApiError(401, 'DEVICE_UNKNOWN', '设备未注册');
    if (device.revoked_at) throw new ApiError(401, 'DEVICE_REVOKED', '设备授权已被撤销');
    const expected = await secretHash(env, parsed.deviceId, parsed.secret);
    if (!timingSafeEqualHex(expected, device.secret_hash)) {
      throw new ApiError(401, 'UNAUTHORIZED', '设备凭据校验失败');
    }
    const timestamp = now();
    if (timestamp - Number(device.last_seen_at || 0) > 300000) {
      await store.touchDevice(device.id, timestamp);
    }
    return device;
  }

  async function registerDevice(request) {
    const body = await readJsonBody(request);
    const deviceId = String(body.deviceId || '').trim();
    const secret = String(body.secret || '').trim();
    if (!DEVICE_ID_PATTERN.test(deviceId) || !DEVICE_SECRET_PATTERN.test(secret)) {
      throw new ApiError(400, 'INVALID_DEVICE_CREDENTIALS', '设备凭据格式不合法');
    }
    const timestamp = now();
    const existing = await store.getDevice(deviceId);
    const hash = await secretHash(env, deviceId, secret);
    if (existing) {
      if (existing.revoked_at) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销，不能自动恢复');
      if (!timingSafeEqualHex(hash, existing.secret_hash)) {
        throw new ApiError(409, 'DEVICE_CONFLICT', '设备 ID 已被其他凭据占用');
      }
      await store.updateDeviceProfile(deviceId, {
        label: String(body.label || '').slice(0, 64),
        platform: String(body.platform || '').slice(0, 64)
      });
      await store.touchDevice(deviceId, timestamp);
      return ok({ device: { id: deviceId, createdAt: Number(existing.created_at), reenrolled: true } });
    }

    const ipHash = await clientIpHash(request, env);
    const recent = await store.countDevicesByIp(ipHash, timestamp - 3600000);
    if (recent >= REGISTRATIONS_PER_IP_PER_HOUR) {
      throw new ApiError(429, 'REGISTRATION_RATE_LIMITED', '注册过于频繁，请稍后再试');
    }

    const commonDevice = {
      id: deviceId,
      secretHash: hash,
      label: String(body.label || '').slice(0, 64),
      platform: String(body.platform || '').slice(0, 64),
      userAgent: String(request.headers.get('user-agent') || '').slice(0, 200),
      ipHash,
      now: timestamp
    };

    let userId = OWNER_USER_ID;
    let enrollmentMode = '';
    const suppliedToken = String(body.pairingToken || body.enrollmentToken || '').trim();
    if (suppliedToken.length < 32 || suppliedToken.length > 512) {
      throw new ApiError(403, 'DEVICE_PAIRING_REQUIRED', '新设备需要有效的一次性配对码');
    }

    const pairingHash = await sha256Hex(
      `${String(env?.DEVICE_SECRET_PEPPER || '')}|pairing|${suppliedToken}`
    );
    const paired = await store.consumePairingTokenAndInsertDevice(
      pairingHash,
      timestamp,
      commonDevice
    );
    if (paired) {
      enrollmentMode = 'paired';
    } else {
      const configuredToken = String(env?.ENROLLMENT_TOKEN || '');
      if (configuredToken.length < 32) {
        throw new ApiError(403, 'DEVICE_PAIRING_REQUIRED', '新设备需要由已连接设备生成的一次性配对码');
      }
      const expected = await sha256Hex(`bootstrap|${configuredToken}`);
      const supplied = await sha256Hex(`bootstrap|${suppliedToken}`);
      if (!timingSafeEqualHex(expected, supplied)) {
        throw new ApiError(403, 'DEVICE_PAIRING_REQUIRED', '配对码无效、已使用或已过期');
      }
      const inserted = await store.insertBootstrapDevice({ ...commonDevice, userId });
      if (!inserted) {
        throw new ApiError(409, 'DEVICE_BOOTSTRAP_CLOSED', '首次设备认领已经完成，请使用已连接设备生成配对码');
      }
      enrollmentMode = 'bootstrap';
    }

    await store.logExecution({
      id: randomToken(12),
      deviceId,
      kind: 'device_register',
      status: 'success',
      reasonCode: enrollmentMode === 'paired' ? 'paired' : 'bootstrap_enrolled',
      detail: { platform: String(body.platform || '').slice(0, 64), enrollmentMode },
      now: timestamp
    });
    return ok({ device: { id: deviceId, createdAt: timestamp, reenrolled: false, enrollmentMode } });
  }

  async function createDevicePairingToken(request) {
    const device = await authenticate(request);
    const ttlMs = parsePositiveEnv(env, 'DEVICE_PAIRING_TOKEN_TTL_MS');
    if (ttlMs == null) {
      throw new ApiError(503, 'PAIRING_NOT_CONFIGURED', '缺少一次性配对码有效期配置');
    }
    const timestamp = now();
    const pairingToken = randomToken(32);
    const tokenHash = await sha256Hex(
      `${String(env?.DEVICE_SECRET_PEPPER || '')}|pairing|${pairingToken}`
    );
    await store.cleanupDevicePairingTokens(timestamp);
    const created = await store.createDevicePairingTokenWithLimit({
      tokenHash,
      userId: device.user_id || OWNER_USER_ID,
      createdByDeviceId: device.id,
      createdAt: timestamp,
      expiresAt: timestamp + ttlMs
    }, {
      since: timestamp - 3600000,
      limit: PAIRING_TOKENS_PER_DEVICE_PER_HOUR
    });
    if (!created) {
      const currentDevice = await store.getDevice(device.id);
      if (!currentDevice || currentDevice.revoked_at) {
        throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
      }
      throw new ApiError(429, 'PAIRING_RATE_LIMITED', '配对码生成过于频繁，请稍后再试');
    }
    return ok({ pairingToken, expiresAt: timestamp + ttlMs, ttlMs });
  }

  async function subscribe(request) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    const validated = validateSubscription(body.subscription || body);
    const existing = await store.listSubscriptions(device.id, { includeDisabled: true });
    if (existing.length >= MAX_SUBSCRIPTIONS_PER_DEVICE && !existing.some(item => item.endpoint === validated.endpoint)) {
      throw new ApiError(409, 'SUBSCRIPTION_LIMIT', '该设备订阅数量已达上限');
    }
    const timestamp = now();
    const result = await store.upsertSubscription({
      id: randomToken(12),
      deviceId: device.id,
      endpoint: validated.endpoint,
      p256dh: validated.p256dh,
      authKey: validated.authKey,
      expirationTime: validated.expirationTime,
      now: timestamp
    });
    if (!result) {
      const currentDevice = await store.getDevice(device.id);
      if (!currentDevice || currentDevice.revoked_at) {
        throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
      }
      throw new ApiError(409, 'SUBSCRIPTION_IN_USE', '该推送订阅仍属于另一台已授权设备');
    }
    return ok({
      subscription: {
        id: result.id,
        endpoint: validated.endpoint,
        created: !result.resurrected
      }
    });
  }

  async function unsubscribe(request) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    const endpoint = String(body.endpoint || '').trim();
    const timestamp = now();
    if (endpoint) {
      const found = await store.getSubscriptionByEndpoint(device.id, endpoint);
      if (!found) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND', '订阅不存在');
      await store.disableSubscriptionByEndpoint(device.id, endpoint, 'user', timestamp);
      return ok({ disabled: 1 });
    }
    await store.disableAllSubscriptions(device.id, 'user', timestamp);
    return ok({ disabled: 'all' });
  }

  async function listSubscriptions(request) {
    const device = await authenticate(request);
    const rows = await store.listSubscriptions(device.id, { includeDisabled: true });
    return ok({
      subscriptions: rows.map(row => ({
        id: row.id,
        endpoint: row.endpoint,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        lastSuccessAt: row.last_success_at ? Number(row.last_success_at) : null,
        failureCount: Number(row.failure_count || 0),
        disabledAt: row.disabled_at ? Number(row.disabled_at) : null,
        disabledReason: row.disabled_reason || ''
      }))
    });
  }

  async function testPush(request) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    const timestamp = now();
    const recent = await store.countRecentExecutions(device.id, 'test_push', timestamp - 600000);
    if (recent >= TEST_PUSH_PER_10_MINUTES) {
      throw new ApiError(429, 'PUSH_RATE_LIMITED', '测试推送过于频繁，请稍后再试');
    }
    let keys;
    try {
      keys = parseVapidKeys(env);
    } catch (error) {
      if (error instanceof PushConfigError) {
        throw new ApiError(503, 'PUSH_NOT_CONFIGURED', error.message);
      }
      throw error;
    }

    const subscriptions = await store.listSubscriptions(device.id);
    if (!subscriptions.length) {
      throw new ApiError(409, 'NO_ACTIVE_SUBSCRIPTIONS', '当前设备没有有效推送订阅');
    }

    const dedupeKey = String(body.dedupeKey || `test:${device.id}:${timestamp}`).slice(0, 96);
    const payload = JSON.stringify({
      type: 'test',
      title: 'MAOMAO 云端连接测试',
      body: '如果你看到这条通知，说明推送链路已经打通。',
      url: './settings/settings.html',
      tag: 'cloud-test',
      dedupeKey,
      timestamp
    });

    const startedAt = now();
    const results = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let gone = 0;

    for (const subscription of subscriptions) {
      if (await store.findDelivery(dedupeKey, subscription.id)) {
        results.push({ subscriptionId: subscription.id, status: 'duplicate' });
        skipped += 1;
        continue;
      }
      try {
        const outcome = await sendWebPush(
          { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth_key },
          payload,
          keys,
          { nowMs: timestamp, fetchImpl }
        );
        await store.recordDelivery({
          id: randomToken(12),
          dedupeKey,
          subscriptionId: subscription.id,
          status: outcome.ok ? 'sent' : outcome.gone ? 'gone' : 'failed',
          httpStatus: outcome.statusCode,
          now: timestamp
        });
        if (outcome.ok) {
          sent += 1;
          await store.markPushSuccess(subscription.id, timestamp);
        } else {
          failed += 1;
          if (outcome.gone) {
            gone += 1;
            await store.disableSubscriptionById(subscription.id, 'gone', timestamp);
          } else {
            await store.markPushFailure(subscription.id);
          }
        }
        results.push({
          subscriptionId: subscription.id,
          status: outcome.ok ? 'sent' : outcome.gone ? 'gone' : 'failed',
          httpStatus: outcome.statusCode
        });
      } catch (error) {
        failed += 1;
        await store.recordDelivery({
          id: randomToken(12),
          dedupeKey,
          subscriptionId: subscription.id,
          status: 'error',
          httpStatus: 0,
          now: timestamp
        });
        await store.markPushFailure(subscription.id);
        results.push({ subscriptionId: subscription.id, status: 'error' });
      }
    }

    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'test_push',
      status: sent > 0 ? 'success' : 'failed',
      reasonCode: sent > 0 ? 'delivered' : 'no_delivery',
      detail: { sent, skipped, failed, gone },
      durationMs: Math.max(0, now() - startedAt),
      now: timestamp
    });
    await store.cleanupSubscriptions(timestamp);

    return ok({ dedupeKey, results, summary: { sent, skipped, failed, gone } });
  }

  async function revokeDevice(request) {
    const device = await authenticate(request);
    const timestamp = now();
    await store.revokeDevice(device.id, timestamp);
    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'device_revoke',
      status: 'success',
      reasonCode: 'revoked',
      now: timestamp
    });
    return ok({ revoked: true });
  }

  async function getAutonomyReadiness(request) {
    const device = await authenticate(request);
    const presenceConfig = readPresenceConfig(env);
    const activeSubscriptions = await store.listSubscriptions(device.id);
    const pepper = String(env?.DEVICE_SECRET_PEPPER || '');
    const vapid = vapidSummary(env);
    const pairingTtl = parsePositiveEnv(env, 'DEVICE_PAIRING_TOKEN_TTL_MS');
    const enrollmentToken = String(env?.ENROLLMENT_TOKEN || '');
    const userId = device.user_id || OWNER_USER_ID;
    const globalAutonomy = await store.getUserAutonomy(userId);
    const activityQueue = await store.getActivityQueueSummary({ userId });
    const timestamp = now();
    const recentSchedulerReasons = await store.getRecentAutonomyReasonSummary({
      userId,
      since: timestamp - 86400000
    });
    const presenceSummary = presenceConfig
      ? await store.getPresenceSummary({
          userId,
          now: timestamp,
          heartbeatTtlMs: presenceConfig.heartbeatTtlMs,
          graceMs: presenceConfig.graceMs
        })
      : null;
    return ok({
      deviceAuthorized: true,
      deviceAuthConfigured: pepper.length >= 32,
      bootstrapConfigured: enrollmentToken.length >= 32,
      pairingConfigured: pairingTtl != null && pepper.length >= 32,
      webPushKeysConfigured: vapid.configured,
      activePushSubscriptions: activeSubscriptions.length,
      testPushReady: vapid.configured && activeSubscriptions.length > 0,
      presenceConfigured: Boolean(presenceConfig),
      presenceSummary,
      globalAutonomyEnabled: globalAutonomy?.enabled === 1,
      activityQueue,
      recentSchedulerReasons,
      schedulerDiagnosticsWindowMs: 86400000,
      // No generation executor is wired into the scheduled Worker yet.
      activityExecutorAvailable: false,
      contextVersionReady: false,
      autonomousMessageGenerationReady: false,
      autonomyExecutionBlockers: ['executor_unavailable', 'context_version_unavailable'],
      note: '此检查只核对配置与匿名队列汇总；当前没有 AI 执行器，不会生成角色消息、读取聊天正文或触发主动推送。'
    });
  }

  async function getGlobalAutonomy(request) {
    const device = await authenticate(request);
    const row = await store.getUserAutonomy(device.user_id || OWNER_USER_ID);
    return ok({ enabled: row ? row.enabled === 1 : false, configured: Boolean(row), updatedAt: row ? Number(row.updated_at) : null });
  }

  async function setGlobalAutonomy(request) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (typeof body.enabled !== 'boolean') {
      throw new ApiError(400, 'INVALID_AUTONOMY_SETTING', 'enabled 必须是布尔值');
    }
    const row = await store.setUserAutonomy(device.user_id || OWNER_USER_ID, body.enabled, now());
    return ok({ enabled: row.enabled === 1, updatedAt: Number(row.updated_at) });
  }

  async function getCharacterAutonomy(request, characterId) {
    const device = await authenticate(request);
    const row = await store.getCharacterAutonomy(device.user_id || OWNER_USER_ID, characterId);
    return ok({
      enabled: row?.enabled == null ? null : row.enabled === 1,
      inherited: !row || row.enabled == null,
      updatedAt: row ? Number(row.updated_at) : null
    });
  }

  async function setCharacterAutonomy(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (body.enabled !== null && typeof body.enabled !== 'boolean') {
      throw new ApiError(400, 'INVALID_AUTONOMY_SETTING', 'enabled 必须为 true、false 或 null（继承全局设置）');
    }
    const row = await store.setCharacterAutonomy(
      device.user_id || OWNER_USER_ID,
      characterId,
      body.enabled,
      now()
    );
    return ok({
      enabled: row.enabled == null ? null : row.enabled === 1,
      inherited: row.enabled == null,
      updatedAt: Number(row.updated_at)
    });
  }

  async function getCharacterSchedule(request, characterId) {
    const device = await authenticate(request);
    const row = await store.getCharacterSchedule(device.user_id || OWNER_USER_ID, characterId);
    if (!row) return ok({ configured: false, schedule: null, timeZone: null });
    let schedule = null;
    try {
      schedule = JSON.parse(row.schedule_json);
    } catch {
      throw new ApiError(500, 'SCHEDULE_DATA_INVALID', '已保存的作息数据无法解析');
    }
    return ok({ configured: true, timeZone: row.time_zone, schedule, updatedAt: Number(row.updated_at) });
  }

  async function setCharacterSchedule(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    const validated = validateScheduleInput(body);
    const row = await store.setCharacterSchedule(
      device.user_id || OWNER_USER_ID,
      characterId,
      validated.timeZone,
      validated.schedule,
      now()
    );
    return ok({ configured: true, timeZone: row.time_zone, schedule: validated.schedule, updatedAt: Number(row.updated_at) });
  }

  async function getPresenceConfig(request) {
    await authenticate(request);
    const config = readPresenceConfig(env);
    if (!config) {
      throw new ApiError(503, 'PRESENCE_NOT_CONFIGURED', '缺少心跳 TTL、设备租约时长或 grace 配置');
    }
    return ok(config);
  }

  async function updatePresenceHeartbeat(request) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (typeof body.foregroundActive !== 'boolean') {
      throw new ApiError(400, 'INVALID_PRESENCE', 'foregroundActive 必须是布尔值');
    }
    const timestamp = now();
    const userId = device.user_id || OWNER_USER_ID;
    const presence = await store.upsertDevicePresence({
      userId,
      deviceId: device.id,
      foregroundActive: body.foregroundActive,
      now: timestamp
    });
    // Device-level heartbeat and per-character leases are separate.
    // A hidden tab must not release every role lease owned by other tabs.
    return ok({
      foregroundActive: presence.foreground_active === 1,
      lastHeartbeatAt: Number(presence.last_heartbeat_at)
    });
  }

  async function updateCharacterLease(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    const action = String(body.action || '');
    if (!['acquire', 'renew', 'release'].includes(action)) {
      throw new ApiError(400, 'INVALID_LEASE_ACTION', 'action 必须为 acquire、renew 或 release');
    }
    const timestamp = now();
    const userId = device.user_id || OWNER_USER_ID;
    if (action === 'release') {
      const released = await store.releaseCharacterLease({ userId, characterId, deviceId: device.id });
      return ok({ released });
    }

    const config = readPresenceConfig(env);
    if (!config) {
      throw new ApiError(503, 'PRESENCE_NOT_CONFIGURED', '缺少心跳 TTL、设备租约时长或 grace 配置；为安全起见未申请租约');
    }
    if (!store.isDeviceForegroundFresh(userId, device.id, timestamp, config.heartbeatTtlMs)) {
      throw new ApiError(409, 'FOREGROUND_HEARTBEAT_REQUIRED', '需要先发送有效的前台心跳');
    }

    const lease = action === 'acquire'
      ? await store.acquireCharacterLease({
          userId,
          characterId,
          deviceId: device.id,
          now: timestamp,
          leaseUntil: timestamp + config.leaseDurationMs,
          graceMs: config.graceMs
        })
      : await store.renewCharacterLease({
          userId,
          characterId,
          deviceId: device.id,
          now: timestamp,
          leaseUntil: timestamp + config.leaseDurationMs,
          graceMs: config.graceMs
        });
    if (!lease) {
      throw new ApiError(409, action === 'acquire' ? 'CHARACTER_LEASE_HELD' : 'LEASE_NOT_OWNED', '当前设备无法取得该角色的前台租约');
    }
    return ok({
      characterId,
      leaseUntil: Number(lease.lease_until),
      ownerDeviceId: lease.owner_device_id
    });
  }

  return async function handleApi(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method.toUpperCase();
    try {
      if (path === '/api/health' && method === 'GET') {
        const counts = await store.counts();
        const vapid = vapidSummary(env);
        return ok({
          service: 'maomao-cloud',
          milestone: MILESTONE,
          storage: 'durable-object-sqlite',
          vapidConfigured: vapid.configured,
          counts,
          time: now()
        });
      }
      if (path === '/api/push/config' && method === 'GET') {
        const vapid = vapidSummary(env);
        if (!vapid.configured) {
          throw new ApiError(503, 'PUSH_NOT_CONFIGURED', '云端尚未配置 VAPID 密钥');
        }
        return ok({ publicKey: vapid.publicKey, subjectConfigured: true });
      }
      if (path === '/api/devices/register' && method === 'POST') return await registerDevice(request);
      if (path === '/api/devices/pairing-token' && method === 'POST') return await createDevicePairingToken(request);
      if (path === '/api/devices/revoke' && method === 'POST') return await revokeDevice(request);
      if (path === '/api/autonomy/readiness' && method === 'GET') return await getAutonomyReadiness(request);
      if (path === '/api/autonomy/global' && method === 'GET') return await getGlobalAutonomy(request);
      if (path === '/api/autonomy/global' && method === 'PUT') return await setGlobalAutonomy(request);

      const characterAutonomyMatch = /^\/api\/autonomy\/characters\/([^/]+)$/.exec(path);
      if (characterAutonomyMatch && readCharacterId(characterAutonomyMatch[1])) {
        const characterId = readCharacterId(characterAutonomyMatch[1]);
        if (method === 'GET') return await getCharacterAutonomy(request, characterId);
        if (method === 'PUT') return await setCharacterAutonomy(request, characterId);
      }

      const characterScheduleMatch = /^\/api\/characters\/([^/]+)\/schedule$/.exec(path);
      if (characterScheduleMatch && readCharacterId(characterScheduleMatch[1])) {
        const characterId = readCharacterId(characterScheduleMatch[1]);
        if (method === 'GET') return await getCharacterSchedule(request, characterId);
        if (method === 'PUT') return await setCharacterSchedule(request, characterId);
      }

      if (path === '/api/presence/config' && method === 'GET') return await getPresenceConfig(request);
      if (path === '/api/presence/heartbeat' && method === 'POST') return await updatePresenceHeartbeat(request);

      const characterLeaseMatch = /^\/api\/characters\/([^/]+)\/lease$/.exec(path);
      if (characterLeaseMatch && readCharacterId(characterLeaseMatch[1]) && method === 'POST') {
        return await updateCharacterLease(request, readCharacterId(characterLeaseMatch[1]));
      }
      if (path === '/api/push/subscriptions' && method === 'POST') return await subscribe(request);
      if (path === '/api/push/subscriptions' && method === 'GET') return await listSubscriptions(request);
      if (path === '/api/push/unsubscribe' && method === 'POST') return await unsubscribe(request);
      if (path === '/api/push/test' && method === 'POST') return await testPush(request);
      if (path.startsWith('/api/')) throw new ApiError(404, 'NOT_FOUND', '接口不存在');
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持该请求方法');
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.code, error.message);
      if (error instanceof PushConfigError) return fail(503, 'PUSH_NOT_CONFIGURED', error.message);
      console.error('[cloud-api]', error?.code || 'INTERNAL', error?.message || String(error));
      return fail(500, 'INTERNAL_ERROR', '云端处理失败');
    }
  };
}
