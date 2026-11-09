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
import { planTask, nextRetryAt } from './scheduler-policy.js';
import { createSchedulerGate } from './scheduler-gate.js';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_SUBSCRIPTIONS_PER_DEVICE = 10;
const REGISTRATIONS_PER_IP_PER_HOUR = 20;
const PAIRING_TOKENS_PER_DEVICE_PER_HOUR = 5;
const TEST_PUSH_PER_10_MINUTES = 3;
const CONTEXT_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

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

function isSafePushEndpointUrl(url) {
  const hostname = String(url?.hostname || '').toLowerCase().replace(/\.$/, '');
  if (
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  ) return false;

  // Browser push services use DNS hostnames, not IP literals or local names.
  // URL canonicalization also normalizes alternate IPv4 spellings before this check.
  if (!hostname || hostname.startsWith('[') || hostname.includes(':') || /^[0-9.]+$/.test(hostname)) {
    return false;
  }
  if (!hostname.includes('.')) return false;
  if (
    hostname === 'localhost' ||
    ['.localhost', '.local', '.internal', '.lan', '.home', '.test', '.invalid', '.onion']
      .some(suffix => hostname.endsWith(suffix))
  ) return false;

  return hostname.split('.').every(label =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
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
  if (!isSafePushEndpointUrl(url)) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTION', 'endpoint 必须是有效的公网 HTTPS 推送服务地址');
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

function readActivityExecutionConfig(env) {
  const leaseMs = parsePositiveEnv(env, 'AUTONOMY_LEASE_MS');
  const tickLimit = parsePositiveEnv(env, 'AUTONOMY_TICK_LIMIT');
  const rawBackoff = String(env?.AUTONOMY_RETRY_BACKOFF_MS || '').trim();
  const retryBackoffMs = rawBackoff
    ? rawBackoff.split(',').map(value => Number(value.trim()))
    : [];
  if (
    leaseMs == null || tickLimit == null || tickLimit > 50 ||
    retryBackoffMs.length === 0 || retryBackoffMs.length > 8 ||
    !retryBackoffMs.every(value => Number.isSafeInteger(value) && value > 0)
  ) return null;
  return { leaseMs, tickLimit, retryBackoffMs, maxAttempts: retryBackoffMs.length + 1 };
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
/**
 * Build a privacy-safe notification for an already-persisted chat outbox row.
 * Message text is intentionally omitted so lock-screen previews reveal no chat content.
 */
export function buildOutboundPushPayload({ characterId, serverMessageId, timestamp, accountId = OWNER_USER_ID }) {
  const roleId = String(characterId || '');
  const messageId = String(serverMessageId || '');
  const maoAccountId = String(accountId || OWNER_USER_ID);
  if (!roleId || roleId.length > 96 ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(messageId) ||
      !(maoAccountId === OWNER_USER_ID || /^MAO-[A-Z0-9]{12,24}$/.test(maoAccountId))) {
    throw new TypeError('outbound push target is invalid');
  }
  return {
    type: 'chat_message',
    accountId: maoAccountId,
    title: '新消息',
    body: '有一位角色刚刚联系你，打开聊天查看。',
    url: './chat/chat/chat-detail.html?id=' + encodeURIComponent(roleId),
    tag: 'maomao-chat-' + messageId,
    dedupeKey: ('outbound:' + messageId).slice(0, 96),
    timestamp: Number(timestamp)
  };
}

/**
 * Send due notifications for pending outbound chat rows. Every subscription
 * has its own durable lease/dedupe row, so Cron recovery and an API-triggered
 * immediate attempt can race safely.
 */
export async function dispatchPendingOutboundPushes({
  store,
  env = {},
  now = Date.now(),
  fetchImpl = fetch,
  limit = 50
} = {}) {
  const timestamp = Number(typeof now === 'function' ? now() : now);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !store ||
      typeof store.listOutboundPushCandidates !== 'function') {
    return { configured: false, reason: 'dispatcher_unavailable', attempted: 0, sent: 0, failed: 0 };
  }

  let keys;
  try {
    keys = parseVapidKeys(env);
  } catch (error) {
    return {
      configured: false,
      reason: error instanceof PushConfigError ? 'push_not_configured' : 'push_configuration_error',
      attempted: 0,
      sent: 0,
      failed: 0
    };
  }

  const candidates = store.listOutboundPushCandidates({ now: timestamp, limit });
  const summary = {
    configured: true,
    attempted: 0,
    sent: 0,
    failed: 0,
    gone: 0,
    skipped: 0,
    inProgress: 0,
    retryDeferred: 0,
    retryScheduled: 0,
    retryExhausted: 0
  };
  const maxDeliveryAttempts = 5;
  const deliveryLeaseMs = 60000;

  for (const candidate of candidates) {
    const deliveryTimestamp = Number(typeof now === 'function' ? now() : timestamp);
    const dedupeKey = 'outbound:' + String(candidate.server_message_id);
    const deliveryOwner = randomToken(12);
    const claim = store.claimDelivery({
      id: randomToken(12),
      dedupeKey,
      subscriptionId: candidate.subscription_id,
      outboundMessageId: candidate.outbound_message_id,
      owner: deliveryOwner,
      now: deliveryTimestamp,
      leaseUntil: deliveryTimestamp + deliveryLeaseMs,
      maxAttempts: maxDeliveryAttempts
    });

    if (!claim) {
      const existing = store.findDelivery(dedupeKey, candidate.subscription_id);
      if (existing?.status === 'sending') summary.inProgress += 1;
      else if (existing?.status === 'error' &&
               Number(existing.next_attempt_at || 0) > timestamp) summary.retryDeferred += 1;
      else if (existing?.status === 'failed' ||
               Number(existing?.attempt_count || 0) >= maxDeliveryAttempts) summary.retryExhausted += 1;
      else summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;
    let outcome;
    try {
      const payload = buildOutboundPushPayload({
        accountId: candidate.target_account_id || OWNER_USER_ID,
        characterId: candidate.character_id,
        serverMessageId: candidate.server_message_id,
        timestamp: Number(candidate.created_at || timestamp)
      });
      outcome = await sendWebPush(
        {
          endpoint: candidate.endpoint,
          p256dh: candidate.p256dh,
          auth: candidate.auth_key
        },
        JSON.stringify(payload),
        keys,
        {
          nowMs: deliveryTimestamp,
          fetchImpl,
          beforeSend: () => store.isActivePushSubscription(
            candidate.subscription_id,
            candidate.device_id
          )
        }
      );
    } catch (error) {
      outcome = {
        ok: false,
        statusCode: error instanceof PushConfigError ? 400 : Number(error?.statusCode || 0),
        gone: false
      };
    }

    if (outcome.skipped) {
      const finishedAt = Number(typeof now === 'function' ? now() : timestamp);
      const finalized = store.finishDelivery({
        dedupeKey,
        subscriptionId: candidate.subscription_id,
        owner: deliveryOwner,
        status: 'failed',
        httpStatus: 0,
        nextAttemptAt: null,
        now: finishedAt
      });
      if (!finalized) {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
      await store.logExecution({
        id: randomToken(12),
        deviceId: candidate.device_id,
        kind: 'outbound_push',
        status: finalized ? 'skipped' : 'failed',
        reasonCode: 'subscription_unavailable_before_send',
        detail: {
          outboundMessageId: candidate.outbound_message_id,
          serverMessageId: candidate.server_message_id,
          subscriptionId: candidate.subscription_id,
          httpStatus: 0,
          retryScheduled: false
        },
        now: finishedAt
      });
      continue;
    }

    const statusCode = Number(outcome.statusCode || 0);
    const retryable = !outcome.ok && !outcome.gone && (
      statusCode === 0 || statusCode === 408 || statusCode === 425 ||
      statusCode === 429 || statusCode >= 500
    );
    const canRetry = retryable && Number(claim.attempt_count) < maxDeliveryAttempts;
    const deliveryStatus = outcome.ok
      ? 'sent'
      : outcome.gone
        ? 'gone'
        : canRetry
          ? 'error'
          : 'failed';
    const retryDelayMs = Math.min(
      6 * 60 * 60 * 1000,
      30000 * (2 ** Math.max(0, Number(claim.attempt_count) - 1))
    );
    const finishedAt = Number(typeof now === 'function' ? now() : timestamp);
    const nextAttemptAt = canRetry ? finishedAt + retryDelayMs : null;
    const finalized = store.finishDelivery({
      dedupeKey,
      subscriptionId: candidate.subscription_id,
      owner: deliveryOwner,
      status: deliveryStatus,
      httpStatus: Number.isFinite(statusCode) ? statusCode : 0,
      nextAttemptAt,
      now: finishedAt
    });

    if (!finalized) {
      summary.failed += 1;
      continue;
    }
    if (outcome.ok) {
      summary.sent += 1;
      store.markPushSuccess(candidate.subscription_id, finishedAt);
      store.markOutboundPushAccepted({
        serverMessageId: candidate.server_message_id,
        now: finishedAt
      });
    } else if (outcome.gone) {
      summary.failed += 1;
      summary.gone += 1;
      store.disableSubscriptionById(candidate.subscription_id, 'gone', finishedAt);
      store.markPushFailure(candidate.subscription_id);
    } else {
      summary.failed += 1;
      store.markPushFailure(candidate.subscription_id);
      if (canRetry) summary.retryScheduled += 1;
    }

    await store.logExecution({
      id: randomToken(12),
      deviceId: candidate.device_id,
      kind: 'outbound_push',
      status: outcome.ok ? 'success' : canRetry ? 'retry' : 'failed',
      reasonCode: outcome.ok ? 'delivered' : outcome.gone ? 'subscription_gone' : 'push_delivery_failed',
      detail: {
        outboundMessageId: candidate.outbound_message_id,
        serverMessageId: candidate.server_message_id,
        subscriptionId: candidate.subscription_id,
        httpStatus: Number.isFinite(statusCode) ? statusCode : 0,
        retryScheduled: Boolean(canRetry)
      },
      now: finishedAt
    });
  }
  return summary;
}

export function createApp({ store, env = {}, now = () => Date.now(), fetchImpl = fetch }) {
  const accountAuth = createAccountAuth({ store, env, now });

  async function authenticate(request) {
    const parsed = deviceAuthHeader(request);
    if (!parsed) throw new ApiError(401, 'UNAUTHORIZED', '缺少或非法的设备凭据');
    const device = await store.getDevice(parsed.deviceId);
    if (!device) throw new ApiError(401, 'DEVICE_UNKNOWN', '设备未注册');
    const expected = await secretHash(env, parsed.deviceId, parsed.secret);
    if (!timingSafeEqualHex(expected, device.secret_hash)) {
      throw new ApiError(401, 'UNAUTHORIZED', '设备凭据校验失败');
    }
    const deviceUserId = String(device.user_id || OWNER_USER_ID);
    let authenticatedSessionId = null;
    if (deviceUserId === OWNER_USER_ID && store.hasMaoSuperAdminAccount()) {
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
    }
    if (deviceUserId !== OWNER_USER_ID) {
      const account = await store.getMaoAccountById(deviceUserId);
      if (!account || account.status === 'disabled' || account.status === 'revoked') {
        throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
      }
      if (account.status !== 'active') {
        throw new ApiError(403, 'INVITE_REQUIRED', '账号尚未获得 MAO 使用授权');
      }
      const accountSession = await accountAuth.getAuthenticatedAccount(request);
      if (!accountSession || accountSession.account_id !== deviceUserId) {
        throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
      }
      authenticatedSessionId = accountSession.session_id;
    }
    // Credential hashing and account-session validation above are asynchronous.
    // A device can be revoked while those checks are in flight, so never make the
    // final authorization decision from the stale row loaded at the start.
    const currentDevice = await store.getDevice(parsed.deviceId);
    if (!currentDevice) throw new ApiError(401, 'DEVICE_UNKNOWN', '设备未注册');
    if (currentDevice.revoked_at) {
      throw new ApiError(401, 'DEVICE_REVOKED', '设备授权已被撤销');
    }
    if (
      String(currentDevice.user_id || OWNER_USER_ID) !== deviceUserId ||
      !timingSafeEqualHex(String(currentDevice.secret_hash || ''), String(device.secret_hash || ''))
    ) {
      throw new ApiError(401, 'UNAUTHORIZED', '设备授权状态已变化，请重新连接');
    }

    const timestamp = now();
    // Re-check the exact MAO session that authenticated this device. A second
    // session for the same account must not keep an in-flight request alive
    // after its own session has been revoked or expired.
    if (!store.isActiveAccountDeviceSession(
      deviceUserId,
      currentDevice.id,
      authenticatedSessionId,
      timestamp
    )) {
      const latestAccount = deviceUserId === OWNER_USER_ID
        ? null
        : store.getMaoAccountById(deviceUserId);
      if (latestAccount && (latestAccount.status === 'disabled' || latestAccount.status === 'revoked')) {
        throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
      }
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '登录会话已失效，请重新登录后继续');
    }
    // Store writes are synchronous. Touch only after the final authorization
    // check and do not yield afterward, so rejected stale sessions leave no
    // device metadata changes behind.
    if (timestamp - Number(currentDevice.last_seen_at || 0) > 300000) {
      store.touchDevice(currentDevice.id, timestamp);
    }
    return currentDevice;
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
      if (!timingSafeEqualHex(hash, existing.secret_hash)) {
        throw new ApiError(409, 'DEVICE_CONFLICT', '设备 ID 已被其他凭据占用');
      }
      const existingUserId = String(existing.user_id || OWNER_USER_ID);
      let accountSessionId = null;
      if (existingUserId === OWNER_USER_ID && store.hasMaoSuperAdminAccount()) {
        throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
      }
      if (existingUserId !== OWNER_USER_ID) {
        const account = await store.getMaoAccountById(existingUserId);
        if (!account || account.status === 'disabled' || account.status === 'revoked') {
          throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
        }
        if (account.status !== 'active') {
          throw new ApiError(403, 'INVITE_REQUIRED', '账号尚未获得 MAO 使用授权');
        }
        const accountSession = await accountAuth.getAuthenticatedAccount(request);
        if (!accountSession || accountSession.account_id !== existingUserId) {
          throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
        }
        accountSessionId = accountSession.session_id;
      }
      if (existing.revoked_at) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销，不能自动恢复');
      const refreshed = await store.refreshActiveDeviceProfile(
        deviceId,
        existingUserId,
        existing.secret_hash,
        {
          label: String(body.label || '').slice(0, 64),
          platform: String(body.platform || '').slice(0, 64),
          now: timestamp,
          sessionId: accountSessionId
        }
      );
      if (!refreshed) {
        const current = await store.getDevice(deviceId);
        if (!current) throw new ApiError(401, 'DEVICE_UNKNOWN', '设备未注册');
        if (current.revoked_at) {
          throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销，不能自动恢复');
        }
        if (
          String(current.user_id || OWNER_USER_ID) !== existingUserId ||
          !timingSafeEqualHex(String(current.secret_hash || ''), String(existing.secret_hash || ''))
        ) {
          throw new ApiError(409, 'DEVICE_CONFLICT', '设备授权状态已变化，请重新连接');
        }
        if (existingUserId !== OWNER_USER_ID) {
          const latestSession = await accountAuth.getAuthenticatedAccount(request);
          if (!latestSession || latestSession.account_id !== existingUserId) {
            throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '登录会话已失效，请重新登录后添加设备');
          }
        }
        throw new ApiError(409, 'DEVICE_STATE_CHANGED', '设备状态已变化，请重新尝试连接');
      }
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

    // A signed-in, authorized MAO account may enroll another device directly.
    // The permanent account ID becomes the only tenant key for this device.
    const accountSession = await accountAuth.getAuthenticatedAccount(request);
    if (!accountSession && store.hasMaoSuperAdminAccount()) {
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录已获授权的 MAO 账号，再添加设备');
    }
    if (accountSession) {
      if (accountSession.status !== 'active') {
        throw new ApiError(403, 'INVITE_REQUIRED', '账号尚未获得 MAO 使用授权，请先验证专属邀请码');
      }
      const inserted = await store.insertMaoAccountDevice({
        ...commonDevice,
        userId: accountSession.account_id,
        sessionId: accountSession.session_id
      });
      if (!inserted) {
        const latestAccount = await store.getMaoAccountById(accountSession.account_id);
        if (!latestAccount || latestAccount.status === 'disabled' || latestAccount.status === 'revoked') {
          throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
        }
        if (latestAccount.status !== 'active') {
          throw new ApiError(403, 'INVITE_REQUIRED', '账号尚未获得 MAO 使用授权，请先验证专属邀请码');
        }
        throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '登录会话已失效，请重新登录后添加设备');
      }
      await store.logExecution({
        id: randomToken(12),
        deviceId,
        kind: 'device_register',
        status: 'success',
        reasonCode: 'mao_account_session',
        detail: { platform: String(body.platform || '').slice(0, 64) },
        now: timestamp
      });
      return ok({ device: { id: deviceId, createdAt: timestamp, reenrolled: false, enrollmentMode: 'account' } });
    }

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
    }, {
      maxSubscriptions: MAX_SUBSCRIPTIONS_PER_DEVICE
    });
    if (result?.limitReached) {
      throw new ApiError(409, 'SUBSCRIPTION_LIMIT', '该设备订阅数量已达上限');
    }
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

    // The SQLite statement checks the rolling window and reserves this
    // attempt atomically, so concurrent requests cannot all pass on the same count.
    const reserved = await store.reserveExecutionAttempt({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'test_push',
      reasonCode: 'attempt_started',
      now: timestamp
    }, {
      since: timestamp - 600000,
      limit: TEST_PUSH_PER_10_MINUTES
    });
    if (!reserved) {
      throw new ApiError(429, 'PUSH_RATE_LIMITED', '测试推送过于频繁，请稍后再试');
    }

    const dedupeKey = String(body.dedupeKey || `test:${device.id}:${timestamp}`).slice(0, 96);
    const payload = JSON.stringify({
      type: 'test',
      accountId: String(device.user_id || OWNER_USER_ID),
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

    const maxDeliveryAttempts = 5;
    const deliveryLeaseMs = 60000;
    let inProgress = 0;
    let retryDeferred = 0;
    let retryScheduled = 0;
    let retryExhausted = 0;

    for (const subscription of subscriptions) {
      const deliveryOwner = randomToken(12);
      const claim = await store.claimDelivery({
        id: randomToken(12),
        dedupeKey,
        subscriptionId: subscription.id,
        owner: deliveryOwner,
        now: timestamp,
        leaseUntil: timestamp + deliveryLeaseMs,
        maxAttempts: maxDeliveryAttempts
      });

      if (!claim) {
        const existing = await store.findDelivery(dedupeKey, subscription.id);
        if (existing?.status === 'sent' || existing?.status === 'gone') {
          results.push({ subscriptionId: subscription.id, status: 'duplicate' });
          skipped += 1;
        } else if (existing?.status === 'sending') {
          results.push({ subscriptionId: subscription.id, status: 'in_progress' });
          inProgress += 1;
          skipped += 1;
        } else if (existing?.status === 'error' &&
                   Number(existing.next_attempt_at || 0) > timestamp) {
          results.push({
            subscriptionId: subscription.id,
            status: 'retry_deferred',
            nextAttemptAt: Number(existing.next_attempt_at)
          });
          retryDeferred += 1;
          skipped += 1;
        } else {
          results.push({ subscriptionId: subscription.id, status: 'retry_exhausted' });
          retryExhausted += 1;
          skipped += 1;
        }
        continue;
      }

      let outcome;
      try {
        outcome = await sendWebPush(
          { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth_key },
          payload,
          keys,
          {
            nowMs: timestamp,
            fetchImpl,
            beforeSend: () => store.isActivePushSubscription(
              subscription.id,
              device.id
            )
          }
        );
      } catch (error) {
        // A network failure can happen after the push service accepted the
        // request but before the Worker received its response. Treat it as
        // retryable (at-least-once), never as a confirmed delivery.
        outcome = {
          ok: false,
          // Invalid local VAPID/crypto/subscription data is not a transient
          // network failure and should not be retried five times.
          statusCode: error instanceof PushConfigError
            ? 400
            : Number(error?.statusCode || 0),
          gone: false
        };
      }

      if (outcome.skipped) {
        const finishedAt = now();
        const finalized = await store.finishDelivery({
          dedupeKey,
          subscriptionId: subscription.id,
          owner: deliveryOwner,
          status: 'failed',
          httpStatus: 0,
          nextAttemptAt: null,
          now: finishedAt
        });
        if (!finalized) {
          failed += 1;
          results.push({ subscriptionId: subscription.id, status: 'lease_lost' });
        } else {
          skipped += 1;
          results.push({ subscriptionId: subscription.id, status: 'revoked' });
        }
        continue;
      }

      const statusCode = Number(outcome.statusCode || 0);
      const retryable = !outcome.ok && !outcome.gone && (
        statusCode === 0 ||
        statusCode === 408 ||
        statusCode === 425 ||
        statusCode === 429 ||
        statusCode >= 500
      );
      const canRetry = retryable && Number(claim.attempt_count) < maxDeliveryAttempts;
      const deliveryStatus = outcome.ok
        ? 'sent'
        : outcome.gone
          ? 'gone'
          : canRetry
            ? 'error'
            : 'failed';
      const retryDelayMs = Math.min(
        6 * 60 * 60 * 1000,
        30000 * (2 ** Math.max(0, Number(claim.attempt_count) - 1))
      );
      const finishedAt = now();
      const nextAttemptAt = canRetry ? finishedAt + retryDelayMs : null;
      const finalized = await store.finishDelivery({
        dedupeKey,
        subscriptionId: subscription.id,
        owner: deliveryOwner,
        status: deliveryStatus,
        httpStatus: Number.isFinite(statusCode) ? statusCode : 0,
        nextAttemptAt,
        now: finishedAt
      });

      if (!finalized) {
        failed += 1;
        results.push({ subscriptionId: subscription.id, status: 'lease_lost' });
        continue;
      }

      if (outcome.ok) {
        sent += 1;
        await store.markPushSuccess(subscription.id, timestamp);
        results.push({
          subscriptionId: subscription.id,
          status: 'sent',
          httpStatus: statusCode
        });
      } else if (outcome.gone) {
        failed += 1;
        gone += 1;
        await store.disableSubscriptionById(subscription.id, 'gone', timestamp);
        await store.markPushFailure(subscription.id);
        results.push({
          subscriptionId: subscription.id,
          status: 'gone',
          httpStatus: statusCode
        });
      } else {
        failed += 1;
        await store.markPushFailure(subscription.id);
        if (canRetry) retryScheduled += 1;
        results.push({
          subscriptionId: subscription.id,
          status: canRetry ? 'retry_scheduled' : 'failed',
          httpStatus: statusCode,
          nextAttemptAt
        });
      }
    }

    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'test_push',
      status: sent > 0 ? 'success' : 'failed',
      reasonCode: sent > 0 ? 'delivered' : 'no_delivery',
      detail: { sent, skipped, failed, gone, inProgress, retryDeferred, retryScheduled, retryExhausted },
      durationMs: Math.max(0, now() - startedAt),
      now: timestamp
    });
    await store.cleanupSubscriptions(timestamp);

    return ok({ dedupeKey, results, summary: { sent, skipped, failed, gone, inProgress, retryDeferred, retryScheduled, retryExhausted } });
  }

  async function revokeDevice(request) {
    const device = await authenticate(request);
    const timestamp = now();
    const revoked = await store.revokeMaoAccountDevice(
      device.user_id || OWNER_USER_ID,
      device.id,
      timestamp
    );
    if (!revoked) {
      throw new ApiError(409, 'DEVICE_REVOKED', '设备授权状态已变化，请刷新后重试');
    }
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
    const contextVersionSummary = await store.getCharacterContextVersionSummary(userId);
    const contextVersionReady = contextVersionSummary.roleCount > 0;
    const activityExecutorConfigured = readActivityExecutionConfig(env) !== null;
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
      // This account-level aggregate does not replace the exact per-character
      // version check performed by scheduler-gate for every context task.
      contextVersionReady,
      contextVersionTrackedRoles: contextVersionSummary.roleCount,
      contextVersionMaxObserved: contextVersionSummary.maxVersion,
      contextVersionLatestUpdatedAt: contextVersionSummary.latestUpdatedAt,
      activityExecutorAvailable: activityExecutorConfigured,
      deviceLocalModelRequired: true,
      autonomousMessageGenerationReady: false,
      autonomyExecutionBlockers: [
        ...(activityExecutorConfigured ? [] : ['activity_executor_config_missing']),
        'device_local_model_runtime_not_verified',
        ...(contextVersionReady ? [] : ['context_version_unavailable'])
      ],
      note: '云端只保存活动元数据与生成后的出站文字；生成由已配对前台设备调用本机 PhoneAPI 和本地 API 配置完成。聊天正文、角色设定和 API Key 不上传。应用关闭或页面后台时不会继续生成；完整运行与真机链路尚未验收。'
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
    const row = await store.setUserAutonomy(device.user_id || OWNER_USER_ID, body.enabled, now(), device.id);
    if (!row) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
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
      now(),
      device.id
    );
    if (!row) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
    return ok({
      enabled: row.enabled == null ? null : row.enabled === 1,
      inherited: row.enabled == null,
      updatedAt: Number(row.updated_at)
    });
  }

  async function getCharacterContextVersion(request, characterId) {
    const device = await authenticate(request);
    const row = await store.getCharacterContextVersion(device.user_id || OWNER_USER_ID, characterId);
    return ok({
      configured: Boolean(row),
      version: row ? Number(row.version) : 0,
      updatedAt: row ? Number(row.updated_at) : null,
      ownedByCurrentDevice: Boolean(row && row.updated_by_device_id === device.id)
    });
  }

  async function recordCharacterContextEvent(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'INVALID_CONTEXT_EVENT', '只接受版本事件对象');
    }
    // Explicit allowlist: this endpoint must never become a chat-content sync API.
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'eventId') {
      throw new ApiError(400, 'INVALID_CONTEXT_EVENT', '版本事件只允许包含 eventId，不接受聊天内容或其他字段');
    }
    const eventId = String(body.eventId || '').trim();
    if (!CONTEXT_EVENT_ID_PATTERN.test(eventId)) {
      throw new ApiError(400, 'INVALID_CONTEXT_EVENT', 'eventId 格式无效');
    }
    const timestamp = now();
    const result = await store.recordCharacterContextEvent({
      userId: device.user_id || OWNER_USER_ID,
      characterId,
      eventId,
      deviceId: device.id,
      now: timestamp,
      eventLimit: 600,
      windowStart: timestamp - 3600000,
      requireActiveDevice: true
    });
    if (result.revoked) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
    if (result.limited) {
      throw new ApiError(429, 'CONTEXT_VERSION_RATE_LIMITED', '角色上下文版本同步过于频繁，请稍后重试');
    }
    return ok({
      changed: result.changed,
      version: result.version,
      updatedAt: result.updatedAt
    });
  }

  async function listCharacterOutboundMessages(request, characterId, url) {
    const device = await authenticate(request);
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit == null ? 50 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new ApiError(400, 'INVALID_OUTBOUND_LIMIT', 'limit 必须是 1 到 50 的整数');
    }
    const rawAfterCreatedAt = url.searchParams.get('afterCreatedAt');
    const afterId = url.searchParams.get('afterId');
    const hasCursorTime = rawAfterCreatedAt != null;
    const hasCursorId = afterId != null;
    if (hasCursorTime !== hasCursorId) {
      throw new ApiError(400, 'INVALID_OUTBOUND_CURSOR', '游标必须同时包含 afterCreatedAt 与 afterId');
    }
    let afterCreatedAt = null;
    if (hasCursorTime) {
      afterCreatedAt = Number(rawAfterCreatedAt);
      if (
        !/^\d+$/.test(rawAfterCreatedAt) ||
        !Number.isSafeInteger(afterCreatedAt) || afterCreatedAt < 0 ||
        typeof afterId !== 'string' || afterId.length < 1 || afterId.length > 256
      ) {
        throw new ApiError(400, 'INVALID_OUTBOUND_CURSOR', '收件箱游标无效');
      }
    }
    const userId = device.user_id || OWNER_USER_ID;
    try {
      await store.repairStagedActivityOutbox({
        userId,
        deviceId: device.id,
        characterId,
        now: now(),
        limit
      });
    } catch (error) {
      // Recovery is best-effort; a repair failure must not block older inbox rows.
    }
    const rows = await store.listPendingOutboundMessages({
      userId,
      deviceId: device.id,
      characterId,
      limit,
      afterCreatedAt,
      afterId
    });
    const messages = rows.map(row => {
      let payload;
      let payloadError = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        // Isolate a damaged envelope: a single corrupt row must not turn the
        // whole account inbox page into HTTP 500 and block later valid rows.
        payload = null;
        payloadError = 'invalid_json';
      }
      const envelope = {
        serverMessageId: row.server_message_id,
        characterId: row.character_id,
        createdAt: Number(row.created_at),
        lifecycle: {
          pushAcceptedAt: row.push_accepted_at == null ? null : Number(row.push_accepted_at),
          deviceReceivedAt: row.device_received_at == null ? null : Number(row.device_received_at),
          localSavedAt: row.local_saved_at == null ? null : Number(row.local_saved_at),
          readAt: row.read_at == null ? null : Number(row.read_at),
          readByDeviceId: row.read_by_device_id || null
        },
        deviceLifecycle: {
          deviceReceivedAt: row.current_device_received_at == null ? null : Number(row.current_device_received_at),
          localSavedAt: row.current_device_local_saved_at == null ? null : Number(row.current_device_local_saved_at),
          readAt: row.current_device_read_at == null ? null : Number(row.current_device_read_at)
        },
        payload
      };
      if (payloadError) envelope.payloadError = payloadError;
      return envelope;
    });
    const lastRow = rows.length === limit ? rows[rows.length - 1] : null;
    const nextCursor = lastRow
      ? { createdAt: Number(lastRow.created_at), id: String(lastRow.id) }
      : null;
    return ok({ messages, nextCursor });
  }

  async function acknowledgeCharacterOutboundMessage(request, characterId, serverMessageId) {
    const device = await authenticate(request);
    const result = await store.acknowledgeOutboundMessage({
      userId: device.user_id || OWNER_USER_ID,
      deviceId: device.id,
      characterId,
      serverMessageId,
      now: now()
    });
    if (!result) {
      throw new ApiError(404, 'OUTBOUND_MESSAGE_NOT_FOUND', '消息不存在、不属于当前账号或当前设备已撤销');
    }
    return ok(result);
  }

  async function getCharacterOutboundLifecycle(request, characterId, serverMessageId) {
    const device = await authenticate(request);
    const row = await store.getOutboundLifecycle({
      userId: device.user_id || OWNER_USER_ID,
      deviceId: device.id,
      characterId,
      serverMessageId
    });
    if (!row) {
      throw new ApiError(404, 'OUTBOUND_MESSAGE_NOT_FOUND', '消息不存在、不属于当前账号或当前设备已撤销');
    }
    return ok({
      serverMessageId: row.server_message_id,
      characterId: row.character_id,
      createdAt: Number(row.created_at),
      deliveryStatus: row.delivery_status,
      lifecycle: {
        pushAcceptedAt: row.push_accepted_at == null ? null : Number(row.push_accepted_at),
        deviceReceivedAt: row.device_received_at == null ? null : Number(row.device_received_at),
        localSavedAt: row.local_saved_at == null ? null : Number(row.local_saved_at),
        readAt: row.read_at == null ? null : Number(row.read_at),
        readByDeviceId: row.read_by_device_id || null
      },
      deviceLifecycle: {
        deviceReceivedAt: row.current_device_received_at == null ? null : Number(row.current_device_received_at),
        localSavedAt: row.current_device_local_saved_at == null ? null : Number(row.current_device_local_saved_at),
        readAt: row.current_device_read_at == null ? null : Number(row.current_device_read_at)
      }
    });
  }

  async function markCharacterOutboundReceived(request, characterId, serverMessageId) {
    const device = await authenticate(request);
    const result = await store.markOutboundReceived({
      userId: device.user_id || OWNER_USER_ID,
      deviceId: device.id,
      characterId,
      serverMessageId,
      now: now()
    });
    if (!result) {
      throw new ApiError(404, 'OUTBOUND_MESSAGE_NOT_FOUND', '消息不存在、不属于当前账号或当前设备已撤销');
    }
    return ok(result);
  }

  async function markCharacterOutboundRead(request, characterId, serverMessageId) {
    const device = await authenticate(request);
    const result = await store.markOutboundRead({
      userId: device.user_id || OWNER_USER_ID,
      deviceId: device.id,
      characterId,
      serverMessageId,
      now: now()
    });
    if (!result) {
      throw new ApiError(404, 'OUTBOUND_MESSAGE_NOT_FOUND', '消息不存在、不属于当前账号或当前设备已撤销');
    }
    if (result.reason === 'not_saved') {
      throw new ApiError(409, 'OUTBOUND_NOT_SAVED', '消息尚未保存到本地聊天记录，不能标记已读');
    }
    return ok(result);
  }

  async function enqueueAutonomyActivity(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => key !== 'contextVersion')) {
      throw new ApiError(400, 'INVALID_ACTIVITY_REQUEST', '活动请求只允许包含 contextVersion，不接受聊天正文或角色设定');
    }
    const contextVersion = Number(body.contextVersion);
    if (!Number.isSafeInteger(contextVersion) || contextVersion < 1) {
      throw new ApiError(400, 'INVALID_ACTIVITY_CONTEXT', 'contextVersion 必须是正整数');
    }

    const userId = device.user_id || OWNER_USER_ID;
    const globalAutonomy = await store.getUserAutonomy(userId);
    const characterAutonomy = await store.getCharacterAutonomy(userId, characterId);
    const characterEnabled = characterAutonomy?.enabled == null
      ? globalAutonomy?.enabled === 1
      : characterAutonomy.enabled === 1;
    if (globalAutonomy?.enabled !== 1 || !characterEnabled) {
      throw new ApiError(403, 'AUTONOMY_NOT_AUTHORIZED', '当前账号或角色尚未授权自主活动');
    }

    const currentVersion = await store.getCharacterContextVersion(userId, characterId);
    if (!currentVersion || Number(currentVersion.version) !== contextVersion) {
      throw new ApiError(409, 'STALE_CONTEXT', '本机聊天上下文版本已变化，请刷新后重新评估');
    }
    if (currentVersion.updated_by_device_id !== device.id) {
      throw new ApiError(409, 'CONTEXT_NOT_ON_DEVICE', '最新聊天上下文由另一台设备更新，当前设备没有可验证的最新本地记录');
    }
    const config = readActivityExecutionConfig(env);
    if (!config) {
      throw new ApiError(503, 'ACTIVITY_EXECUTOR_NOT_CONFIGURED', '缺少自主活动租约、批量或重试配置');
    }
    const timestamp = now();
    const dedupeKey = [
      'autonomy-v1', encodeURIComponent(userId), encodeURIComponent(characterId),
      'contact', String(contextVersion)
    ].join(':');
    const existing = store.getActivityByDedupeKey(dedupeKey);
    if (existing) {
      return ok({
        queued: true,
        duplicate: true,
        activityId: existing.id,
        scheduledAt: Number(existing.scheduled_at)
      });
    }
    if (store.countPendingActivitiesForCharacter(userId, characterId) >= 5) {
      throw new ApiError(429, 'ACTIVITY_QUEUE_FULL', '该角色已有过多待处理活动');
    }

    const result = store.enqueueActivity({
      id: randomToken(16),
      deviceId: device.id,
      characterId,
      kind: 'contact',
      scheduledAt: timestamp,
      maxAttempts: config.maxAttempts,
      payload: { contextVersion, sourceDeviceId: device.id },
      dedupeKey,
      now: timestamp,
      userId,
      requireActiveDevice: true
    });
    if (result.revoked) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
    if (result.conflict) {
      throw new ApiError(409, 'ACTIVITY_IDEMPOTENCY_CONFLICT', '该活动幂等键已被不同任务占用');
    }
    return ok({
      queued: true,
      duplicate: result.duplicate === true,
      activityId: result.activity?.id || null,
      scheduledAt: result.activity ? Number(result.activity.scheduled_at) : timestamp
    });
  }

  async function claimAutonomyActivity(request, characterId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      throw new ApiError(400, 'INVALID_ACTIVITY_CLAIM', '认领请求不接受额外字段');
    }
    const config = readActivityExecutionConfig(env);
    if (!config) {
      throw new ApiError(503, 'ACTIVITY_EXECUTOR_NOT_CONFIGURED', '缺少自主活动租约、批量或重试配置');
    }

    const timestamp = now();
    const userId = device.user_id || OWNER_USER_ID;
    const gate = createSchedulerGate({
      store,
      now: () => timestamp,
      config: readPresenceConfig(env) || {},
      executorDeviceId: device.id
    });
    try {
      await store.repairStagedActivityOutbox({
        userId,
        deviceId: device.id,
        characterId,
        now: timestamp,
        limit: Math.min(config.tickLimit, 10)
      });
    } catch (error) {
      // Keep claiming other eligible work even if one staged outbox needs repair.
    }
    const tasks = await store.listDueActivitiesForUser({
      userId,
      characterId,
      now: timestamp,
      limit: Math.min(config.tickLimit, 20)
    });

    let blockedReason = 'no_due_activity';
    for (const task of tasks) {
      const decision = planTask(task, {
        now: timestamp,
        config,
        gate,
        owner: device.id
      });
      if (decision.action === 'supersede') {
        await store.supersedeActivity({
          id: decision.taskId,
          expectedAttemptCount: decision.expectedAttemptCount,
          expectedStatus: decision.expectedStatus,
          now: timestamp
        });
        blockedReason = decision.reason;
        continue;
      }
      if (decision.action === 'fail') {
        await store.failExhaustedActivity({
          id: decision.taskId,
          expectedAttemptCount: decision.expectedAttemptCount,
          expectedStatus: decision.expectedStatus,
          expectedLockedBy: decision.expectedLockedBy,
          expectedLockedUntil: decision.expectedLockedUntil,
          now: timestamp
        });
        blockedReason = decision.reason;
        continue;
      }
      if (decision.action !== 'claim') {
        blockedReason = decision.reason || blockedReason;
        continue;
      }

      const claimed = await store.claimActivityForDevice({
        id: decision.taskId,
        expectedAttemptCount: decision.expectedAttemptCount,
        expectedStatus: decision.expectedStatus,
        expectedDeviceId: task.device_id,
        expectedLockedBy: decision.expectedLockedBy || null,
        expectedLockedUntil: decision.expectedLockedUntil,
        deviceId: device.id,
        userId,
        owner: device.id,
        leaseUntil: decision.leaseUntil,
        now: timestamp
      });
      if (!claimed) {
        blockedReason = 'claim_lost';
        continue;
      }

      await store.logExecution({
        id: randomToken(12),
        deviceId: device.id,
        kind: 'autonomy_device_executor',
        status: 'claimed',
        reasonCode: 'device_executor_claimed',
        detail: { activityId: claimed.id, characterId, attemptCount: Number(claimed.attempt_count) },
        now: timestamp
      });
      let payload;
      try {
        payload = JSON.parse(claimed.payload_json);
      } catch {
        payload = null;
      }
      if (!payload || !Number.isSafeInteger(Number(payload.contextVersion)) || Number(payload.contextVersion) < 1) {
        await store.failActivity({
          id: claimed.id,
          owner: device.id,
          attemptCount: Number(claimed.attempt_count),
          now: timestamp,
          nextAttemptAt: null
        });
        throw new ApiError(500, 'ACTIVITY_PAYLOAD_INVALID', '活动上下文元数据无法解析');
      }
      return ok({
        activity: {
          id: claimed.id,
          characterId: claimed.character_id,
          kind: claimed.kind,
          attemptCount: Number(claimed.attempt_count),
          leaseUntil: Number(claimed.locked_until),
          payload: { contextVersion: Number(payload.contextVersion) }
        }
      });
    }
    return ok({ activity: null, reasonCode: blockedReason });
  }

  async function completeAutonomyActivity(request, activityId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['attemptCount', 'text'].includes(key)) ||
        !Object.prototype.hasOwnProperty.call(body, 'attemptCount') ||
        !Object.prototype.hasOwnProperty.call(body, 'text')) {
      throw new ApiError(400, 'INVALID_ACTIVITY_RESULT', '完成请求只允许包含 attemptCount 和 text');
    }
    const attemptCount = Number(body.attemptCount);
    const messageText = String(body.text || '').trim();
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 ||
        messageText.length < 2 || Array.from(messageText).length > 220 ||
        /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(messageText) ||
        /https?:\/\//i.test(messageText)) {
      throw new ApiError(400, 'INVALID_ACTIVITY_RESULT', '主动消息必须是 2–220 字的普通文字');
    }

    const timestamp = now();
    const activity = await store.getActivity(activityId);
    const serverMessageId = 'autonomy_' + activityId + '_' + attemptCount;
    const outboundDedupeKey = 'autonomy:' + activityId + ':' + attemptCount;
    const outboundPayload = { type: 'text', text: messageText };

    // A retry after a lost HTTP response is accepted only when it is byte-for-byte
    // the same completed message; different text cannot replace the first result.
    if (activity && activity.device_id === device.id && activity.status === 'completed' &&
        Number(activity.attempt_count) === attemptCount) {
      const repeated = await store.completeActivityWithOutbound({
        id: activityId,
        owner: device.id,
        attemptCount,
        now: timestamp,
        serverMessageId,
        dedupeKey: outboundDedupeKey,
        payload: outboundPayload
      });
      if (repeated) {
        let pushDispatch = null;
        try {
          pushDispatch = await dispatchPendingOutboundPushes({
            store, env, now: timestamp, fetchImpl, limit: 10
          });
        } catch (error) {
          pushDispatch = { configured: false, reason: 'dispatch_deferred' };
        }
        return ok({ ...repeated, pushDispatch });
      }
      throw new ApiError(409, 'ACTIVITY_RESULT_CONFLICT', '已完成任务的消息内容不可修改');
    }

    if (!activity || activity.device_id !== device.id ||
        activity.status !== 'running' || activity.locked_by !== device.id ||
        Number(activity.attempt_count) !== attemptCount ||
        Number(activity.locked_until || 0) <= timestamp) {
      throw new ApiError(409, 'ACTIVITY_LEASE_LOST', '活动租约已失效或已被其他设备接管');
    }

    const userId = device.user_id || OWNER_USER_ID;
    let activityPayload = null;
    try {
      activityPayload = JSON.parse(activity.payload_json);
    } catch {}
    const currentVersion = await store.getCharacterContextVersion(userId, activity.character_id);
    const contextStillCurrent = activityPayload &&
      Number.isSafeInteger(Number(activityPayload.contextVersion)) &&
      currentVersion &&
      Number(currentVersion.version) === Number(activityPayload.contextVersion);
    const gate = createSchedulerGate({
      store,
      now: () => timestamp,
      config: readPresenceConfig(env) || {},
      executorDeviceId: device.id
    });
    const gateResult = contextStillCurrent
      ? gate({
          ...activity,
          user_id: userId,
          source_device_revoked_at: null
        })
      : { autonomyAllowed: false, reasonCode: 'stale_context' };

    if (gateResult.autonomyAllowed !== true || gateResult.characterState !== 'active') {
      const finished = await store.completeActivity({
        id: activityId,
        owner: device.id,
        attemptCount,
        now: timestamp,
        userId,
        requireActiveDevice: true
      });
      if (!finished) {
        throw new ApiError(409, 'ACTIVITY_LEASE_LOST', '活动租约已失效或已被其他设备接管');
      }
      const reasonCode = gateResult.reasonCode || 'execution_gate_changed';
      await store.logExecution({
        id: randomToken(12),
        deviceId: device.id,
        kind: 'autonomy_device_executor',
        status: 'skipped',
        reasonCode,
        detail: { activityId, attemptCount },
        now: timestamp
      });
      return ok({ completed: true, skipped: true, reasonCode });
    }

    const result = await store.completeActivityWithOutbound({
      id: activityId,
      owner: device.id,
      attemptCount,
      now: timestamp,
      serverMessageId,
      dedupeKey: outboundDedupeKey,
      payload: outboundPayload
    });
    if (!result) {
      throw new ApiError(409, 'ACTIVITY_LEASE_LOST', '活动租约已失效或已被其他设备接管');
    }
    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'autonomy_device_executor',
      status: 'success',
      reasonCode: result.alreadyCompleted ? 'activity_already_completed' : 'activity_message_enqueued',
      detail: { activityId, serverMessageId },
      now: timestamp
    });
    let pushDispatch = null;
    try {
      pushDispatch = await dispatchPendingOutboundPushes({
        store, env, now: timestamp, fetchImpl, limit: 10
      });
    } catch (error) {
      // The durable outbox is already committed. Push failure must never
      // roll back or hide the generated chat message.
      pushDispatch = { configured: false, reason: 'dispatch_deferred' };
    }
    return ok({ ...result, pushDispatch });
  }

  async function skipAutonomyActivity(request, activityId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['attemptCount', 'reasonCode'].includes(key)) ||
        !Object.prototype.hasOwnProperty.call(body, 'attemptCount') ||
        !Object.prototype.hasOwnProperty.call(body, 'reasonCode')) {
      throw new ApiError(400, 'INVALID_ACTIVITY_SKIP', '跳过请求只允许包含 attemptCount 和 reasonCode');
    }
    const attemptCount = Number(body.attemptCount);
    const allowedReasons = new Set([
      'no_worthy_message', 'context_changed', 'feature_disabled', 'invalid_generation'
    ]);
    const reasonCode = String(body.reasonCode || '');
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || !allowedReasons.has(reasonCode)) {
      throw new ApiError(400, 'INVALID_ACTIVITY_SKIP', '活动跳过原因或 attemptCount 无效');
    }
    const timestamp = now();
    const completed = await store.completeActivity({
      id: activityId,
      owner: device.id,
      attemptCount,
      now: timestamp,
      userId: device.user_id || OWNER_USER_ID,
      requireActiveDevice: true
    });
    if (!completed) {
      throw new ApiError(409, 'ACTIVITY_LEASE_LOST', '活动租约已失效或已被其他设备接管');
    }
    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'autonomy_device_executor',
      status: 'skipped',
      reasonCode,
      detail: { activityId, attemptCount },
      now: timestamp
    });
    return ok({ skipped: true });
  }

  async function failAutonomyActivity(request, activityId) {
    const device = await authenticate(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['attemptCount', 'reasonCode'].includes(key)) ||
        !Object.prototype.hasOwnProperty.call(body, 'attemptCount') ||
        !Object.prototype.hasOwnProperty.call(body, 'reasonCode')) {
      throw new ApiError(400, 'INVALID_ACTIVITY_FAILURE', '失败请求只允许包含 attemptCount 和 reasonCode');
    }
    const attemptCount = Number(body.attemptCount);
    const allowedReasons = new Set([
      'model_unavailable', 'generation_failed', 'generation_empty', 'local_context_unavailable'
    ]);
    const reasonCode = String(body.reasonCode || '');
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || !allowedReasons.has(reasonCode)) {
      throw new ApiError(400, 'INVALID_ACTIVITY_FAILURE', '活动失败原因或 attemptCount 无效');
    }
    const config = readActivityExecutionConfig(env);
    if (!config) {
      throw new ApiError(503, 'ACTIVITY_EXECUTOR_NOT_CONFIGURED', '缺少自主活动重试配置');
    }
    const timestamp = now();
    const nextAttemptAt = nextRetryAt({
      attemptCount,
      now: timestamp,
      retryBackoffMs: config.retryBackoffMs,
      maxAttempts: config.maxAttempts
    });
    const failed = await store.failActivity({
      id: activityId,
      owner: device.id,
      attemptCount,
      now: timestamp,
      nextAttemptAt,
      userId: device.user_id || OWNER_USER_ID,
      requireActiveDevice: true
    });
    if (!failed) {
      throw new ApiError(409, 'ACTIVITY_LEASE_LOST', '活动租约已失效或已被其他设备接管');
    }
    await store.logExecution({
      id: randomToken(12),
      deviceId: device.id,
      kind: 'autonomy_device_executor',
      status: nextAttemptAt ? 'retry' : 'failed',
      reasonCode,
      detail: { activityId, attemptCount, retryScheduled: Boolean(nextAttemptAt) },
      now: timestamp
    });
    return ok({ failed: true, retryScheduled: Boolean(nextAttemptAt), nextAttemptAt });
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
      now(),
      device.id
    );
    if (!row) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
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
      now: timestamp,
      requireActiveDevice: true
    });
    if (!presence) throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
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
          graceMs: config.graceMs,
          requireActiveDevice: true
        })
      : await store.renewCharacterLease({
          userId,
          characterId,
          deviceId: device.id,
          now: timestamp,
          leaseUntil: timestamp + config.leaseDurationMs,
          graceMs: config.graceMs,
          requireActiveDevice: true
        });
    if (!lease) {
      if (!store.isActiveAccountDevice(userId, device.id)) {
        throw new ApiError(403, 'DEVICE_REVOKED', '设备授权已撤销');
      }
      throw new ApiError(409, action === 'acquire' ? 'CHARACTER_LEASE_HELD' : 'LEASE_NOT_OWNED', '当前设备无法取得该角色的前台租约');
    }
    return ok({
      characterId,
      leaseUntil: Number(lease.lease_until),
      ownerDeviceId: lease.owner_device_id
    });
  }

  function assertSameOriginMutation(request) {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

    const requestOrigin = new URL(request.url).origin;
    const originHeader = String(request.headers.get('origin') || '').trim();
    if (!originHeader) {
      throw new ApiError(403, 'ORIGIN_REQUIRED', '写入请求缺少可信来源信息');
    }

    let suppliedOrigin = '';
    try {
      suppliedOrigin = new URL(originHeader).origin;
    } catch {
      throw new ApiError(403, 'CROSS_ORIGIN_REQUEST_BLOCKED', '写入请求来源无效');
    }
    if (suppliedOrigin !== requestOrigin) {
      throw new ApiError(403, 'CROSS_ORIGIN_REQUEST_BLOCKED', '已拒绝跨来源写入请求');
    }

    const fetchSite = String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin') {
      throw new ApiError(403, 'CROSS_ORIGIN_REQUEST_BLOCKED', '已拒绝非同源浏览器请求');
    }
  }

  async function assertAccountPageContext(request, path) {
    const pageAccountId = String(request.headers.get('x-mao-account-context') || '').trim();
    const contextOptionalPaths = new Set([
      '/api/accounts/register',
      '/api/accounts/login',
      '/api/accounts/logout',
      '/api/accounts/me',
      '/api/admin/bootstrap/status',
      '/api/admin/bootstrap',
      '/api/health',
      '/api/push/config'
    ]);

    // Public account-entry and bootstrap calls must work before a page has an
    // authenticated account scope. Every other request carrying a valid MAO
    // session must prove which account namespace its page was opened for.
    if (!pageAccountId) {
      if (contextOptionalPaths.has(path)) return;
      const session = await accountAuth.getAuthenticatedAccount(request);
      if (session) {
        throw new ApiError(409, 'ACCOUNT_CONTEXT_REQUIRED', '当前请求缺少 MAO 账号上下文，请重新进入页面');
      }
      return;
    }
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(pageAccountId)) {
      throw new ApiError(400, 'INVALID_ACCOUNT_CONTEXT', '页面账号标识无效');
    }
    const session = await accountAuth.getAuthenticatedAccount(request);
    if (!session) {
      throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    }
    if (session.account_id !== pageAccountId) {
      throw new ApiError(409, 'ACCOUNT_CONTEXT_CHANGED', '当前页面所属 MAO 账号已切换，请重新进入');
    }
  }

  return async function handleApi(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method.toUpperCase();
    try {
      assertSameOriginMutation(request);
      await assertAccountPageContext(request, path);
      const accountResponse = await accountAuth.handle(request, path, method);
      if (accountResponse) return accountResponse;

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

      const characterContextVersionMatch = /^\/api\/characters\/([^/]+)\/context-version$/.exec(path);
      if (characterContextVersionMatch && readCharacterId(characterContextVersionMatch[1])) {
        const characterId = readCharacterId(characterContextVersionMatch[1]);
        if (method === 'GET') return await getCharacterContextVersion(request, characterId);
        if (method === 'POST') return await recordCharacterContextEvent(request, characterId);
      }

      const characterOutboundMatch = /^\/api\/characters\/([^/]+)\/outbound$/.exec(path);
      if (characterOutboundMatch && readCharacterId(characterOutboundMatch[1])) {
        const characterId = readCharacterId(characterOutboundMatch[1]);
        if (method === 'GET') return await listCharacterOutboundMessages(request, characterId, url);
      }

      const characterOutboundAckMatch = /^\/api\/characters\/([^/]+)\/outbound\/([A-Za-z0-9_-]{16,128})\/ack$/.exec(path);
      if (characterOutboundAckMatch && readCharacterId(characterOutboundAckMatch[1])) {
        const characterId = readCharacterId(characterOutboundAckMatch[1]);
        if (method === 'POST') {
          return await acknowledgeCharacterOutboundMessage(request, characterId, characterOutboundAckMatch[2]);
        }
      }

      const outboundStatusMatch = /^\/api\/characters\/([^/]+)\/outbound\/([A-Za-z0-9_-]{16,128})\/status$/.exec(path);
      if (outboundStatusMatch && readCharacterId(outboundStatusMatch[1]) && method === 'GET') {
        return await getCharacterOutboundLifecycle(
          request,
          readCharacterId(outboundStatusMatch[1]),
          outboundStatusMatch[2]
        );
      }

      const outboundReceivedMatch = /^\/api\/characters\/([^/]+)\/outbound\/([A-Za-z0-9_-]{16,128})\/received$/.exec(path);
      if (outboundReceivedMatch && readCharacterId(outboundReceivedMatch[1]) && method === 'POST') {
        return await markCharacterOutboundReceived(
          request,
          readCharacterId(outboundReceivedMatch[1]),
          outboundReceivedMatch[2]
        );
      }

      const outboundReadMatch = /^\/api\/characters\/([^/]+)\/outbound\/([A-Za-z0-9_-]{16,128})\/read$/.exec(path);
      if (outboundReadMatch && readCharacterId(outboundReadMatch[1]) && method === 'POST') {
        return await markCharacterOutboundRead(
          request,
          readCharacterId(outboundReadMatch[1]),
          outboundReadMatch[2]
        );
      }

      const autonomyActivityMatch = /^\/api\/autonomy\/characters\/([^/]+)\/activities$/.exec(path);
      if (autonomyActivityMatch && readCharacterId(autonomyActivityMatch[1])) {
        const characterId = readCharacterId(autonomyActivityMatch[1]);
        if (method === 'POST') return await enqueueAutonomyActivity(request, characterId);
      }

      const autonomyClaimMatch = /^\/api\/autonomy\/characters\/([^/]+)\/activities\/claim$/.exec(path);
      if (autonomyClaimMatch && readCharacterId(autonomyClaimMatch[1])) {
        const characterId = readCharacterId(autonomyClaimMatch[1]);
        if (method === 'POST') return await claimAutonomyActivity(request, characterId);
      }

      const autonomyCompleteMatch = /^\/api\/autonomy\/activities\/([A-Za-z0-9_-]{16,64})\/complete$/.exec(path);
      if (autonomyCompleteMatch && method === 'POST') {
        return await completeAutonomyActivity(request, autonomyCompleteMatch[1]);
      }

      const autonomySkipMatch = /^\/api\/autonomy\/activities\/([A-Za-z0-9_-]{16,64})\/skip$/.exec(path);
      if (autonomySkipMatch && method === 'POST') {
        return await skipAutonomyActivity(request, autonomySkipMatch[1]);
      }

      const autonomyFailMatch = /^\/api\/autonomy\/activities\/([A-Za-z0-9_-]{16,64})\/fail$/.exec(path);
      if (autonomyFailMatch && method === 'POST') {
        return await failAutonomyActivity(request, autonomyFailMatch[1]);
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
