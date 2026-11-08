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
const FRIEND_ACCOUNT_ID_PATTERN = /^u_[A-Za-z0-9_-]{16,48}$/;
const FRIEND_ACCOUNT_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const FRIEND_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const FRIEND_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const FRIEND_MESSAGE_LIMIT = 50;
const FRIEND_MESSAGE_MAX_CHARS = 2000;
const FRIEND_MESSAGES_PER_MINUTE = 60;
const FRIEND_REGISTRATIONS_PER_IP_PER_HOUR = 20;
const FRIEND_REQUESTS_PER_HOUR = 30;
const MAX_SUBSCRIPTIONS_PER_DEVICE = 10;
const REGISTRATIONS_PER_IP_PER_HOUR = 20;
const PAIRING_TOKENS_PER_DEVICE_PER_HOUR = 5;
const TEST_PUSH_PER_10_MINUTES = 3;
const CONTEXT_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export const MILESTONE = '1';

function friendAccountAuthHeader(request) {
  const raw = String(request.headers.get('x-maomao-account') || '').trim();
  const point = raw.indexOf('.');
  if (point <= 0) return null;
  const userId = raw.slice(0, point);
  const secret = raw.slice(point + 1);
  if (!FRIEND_ACCOUNT_ID_PATTERN.test(userId) || !FRIEND_ACCOUNT_SECRET_PATTERN.test(secret)) return null;
  return { userId, secret };
}

async function friendAccountSecretHash(env, userId, secret) {
  const pepper = String(env?.DEVICE_SECRET_PEPPER || '');
  if (pepper.length < 32) {
    throw new ApiError(503, 'ACCOUNT_AUTH_NOT_CONFIGURED', '真人账号服务尚未配置');
  }
  return sha256Hex(`${pepper}|friend-account|${userId}|${secret}`);
}

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

  async function authenticateFriendAccount(request) {
    const parsed = friendAccountAuthHeader(request);
    if (!parsed) throw new ApiError(401, 'FRIEND_ACCOUNT_UNAUTHORIZED', '请先创建或连接 MAOMAO 真人账号');
    const account = await store.getFriendAccount(parsed.userId);
    if (!account || account.revoked_at) {
      throw new ApiError(401, 'FRIEND_ACCOUNT_UNKNOWN', '真人账号不存在或已停用');
    }
    const expected = await friendAccountSecretHash(env, parsed.userId, parsed.secret);
    if (!timingSafeEqualHex(expected, account.secret_hash)) {
      throw new ApiError(401, 'FRIEND_ACCOUNT_UNAUTHORIZED', '真人账号凭据校验失败');
    }
    return account;
  }

  function normalizeDisplayName(value) {
    return String(value || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 24);
  }

  function friendRequestView(row, currentUserId) {
    return {
      id: row.id,
      requesterId: row.requester_id,
      recipientId: row.recipient_id,
      requesterName: row.requester_name || '',
      recipientName: row.recipient_name || '',
      message: row.message || '',
      status: row.status,
      direction: row.recipient_id === currentUserId ? 'incoming' : 'outgoing',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  async function registerFriendAccount(request) {
    const body = await readJsonBody(request);
    const userId = String(body.userId || '').trim();
    const secret = String(body.secret || '').trim();
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(userId) || !FRIEND_ACCOUNT_SECRET_PATTERN.test(secret)) {
      throw new ApiError(400, 'INVALID_FRIEND_ACCOUNT', '真人账号凭据格式无效');
    }
    const displayName = normalizeDisplayName(body.displayName);
    const hash = await friendAccountSecretHash(env, userId, secret);
    const existing = await store.getFriendAccount(userId);
    if (existing) {
      if (existing.revoked_at) throw new ApiError(403, 'FRIEND_ACCOUNT_REVOKED', '该真人账号已停用');
      if (!timingSafeEqualHex(hash, existing.secret_hash)) {
        throw new ApiError(409, 'FRIEND_ACCOUNT_CONFLICT', '该账号 ID 已被其他凭据占用');
      }
      const account = displayName && displayName !== existing.display_name
        ? await store.updateFriendAccountProfile(userId, displayName, now())
        : existing;
      return ok({
        account: {
          userId: account.user_id,
          displayName: account.display_name,
          createdAt: Number(account.created_at)
        },
        created: false
      });
    }

    const timestamp = now();
    const ipHash = await clientIpHash(request, env);
    if (await store.countRecentFriendRegistrations(ipHash, timestamp - 3600000) >= FRIEND_REGISTRATIONS_PER_IP_PER_HOUR) {
      throw new ApiError(429, 'FRIEND_ACCOUNT_RATE_LIMITED', '账号创建过于频繁，请稍后再试');
    }
    const created = await store.createFriendAccount({
      userId,
      secretHash: hash,
      displayName,
      registrationIpHash: ipHash,
      now: timestamp
    });
    const account = created || await store.getFriendAccount(userId);
    if (!account || account.revoked_at || !timingSafeEqualHex(hash, account.secret_hash)) {
      throw new ApiError(409, 'FRIEND_ACCOUNT_CONFLICT', '账号创建冲突，请重新尝试');
    }
    return ok({
      account: {
        userId: account.user_id,
        displayName: account.display_name,
        createdAt: Number(account.created_at)
      },
      created: Boolean(created)
    });
  }

  async function getFriendAccountMe(request) {
    const account = await authenticateFriendAccount(request);
    return ok({
      account: {
        userId: account.user_id,
        displayName: account.display_name,
        createdAt: Number(account.created_at)
      }
    });
  }

  async function updateFriendAccountMe(request) {
    const account = await authenticateFriendAccount(request);
    const body = await readJsonBody(request);
    const displayName = normalizeDisplayName(body.displayName);
    if (!displayName) throw new ApiError(400, 'INVALID_DISPLAY_NAME', '昵称不能为空');
    const updated = await store.updateFriendAccountProfile(account.user_id, displayName, now());
    return ok({
      account: {
        userId: updated.user_id,
        displayName: updated.display_name,
        createdAt: Number(updated.created_at)
      }
    });
  }

  async function getPublicFriendProfile(userId) {
    const account = await store.getFriendAccount(userId);
    if (!account || account.revoked_at) throw new ApiError(404, 'FRIEND_ACCOUNT_NOT_FOUND', '没有找到这个 MAOMAO 用户');
    return ok({ profile: { userId: account.user_id, displayName: account.display_name } });
  }

  async function getFriendList(request) {
    const account = await authenticateFriendAccount(request);
    const friends = await store.listFriends(account.user_id);
    return ok({
      friends: friends.map(item => ({
        userId: item.friend_id,
        displayName: item.display_name || '',
        createdAt: Number(item.created_at),
        unreadCount: Number(item.unread_count || 0)
      }))
    });
  }

  async function getFriendRequestList(request) {
    const account = await authenticateFriendAccount(request);
    const requests = await store.listFriendRequests(account.user_id);
    return ok({ requests: requests.map(item => friendRequestView(item, account.user_id)) });
  }

  async function sendFriendRequest(request) {
    const account = await authenticateFriendAccount(request);
    const body = await readJsonBody(request);
    const targetUserId = String(body.targetUserId || '').trim();
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(targetUserId)) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    if (targetUserId === account.user_id) {
      throw new ApiError(400, 'CANNOT_ADD_SELF', '不能添加自己为好友');
    }
    const target = await store.getFriendAccount(targetUserId);
    if (!target || target.revoked_at) {
      throw new ApiError(404, 'FRIEND_ACCOUNT_NOT_FOUND', '没有找到这个 MAOMAO 用户');
    }
    const message = String(body.message || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120);
    const timestamp = now();
    const result = await store.createFriendRequest({
      id: randomToken(16),
      requesterId: account.user_id,
      recipientId: targetUserId,
      message,
      now: timestamp,
      limit: FRIEND_REQUESTS_PER_HOUR,
      windowStart: timestamp - 3600000
    });
    if (result.kind === 'already_friends') {
      throw new ApiError(409, 'ALREADY_FRIENDS', '你们已经是好友了');
    }
    if (result.kind === 'incoming_request_exists') {
      throw new ApiError(409, 'INCOMING_REQUEST_EXISTS', '对方已经向你发送好友申请，请先处理好友申请');
    }
    if (result.kind === 'request_conflict') {
      throw new ApiError(409, 'FRIEND_REQUEST_CONFLICT', '好友关系刚刚发生变化，请刷新好友申请后重试');
    }
    if (result.kind === 'rate_limited') {
      throw new ApiError(429, 'FRIEND_REQUEST_RATE_LIMITED', '好友申请过于频繁，请稍后再试');
    }
    return ok({
      request: {
        id: result.request.id,
        targetUserId,
        status: result.request.status,
        createdAt: Number(result.request.created_at)
      },
      duplicate: result.kind === 'pending'
    });
  }

  async function respondFriendRequest(request, requestId, status) {
    const account = await authenticateFriendAccount(request);
    const updated = await store.respondToFriendRequest({
      requestId,
      userId: account.user_id,
      status,
      now: now()
    });
    if (!updated) {
      throw new ApiError(404, 'FRIEND_REQUEST_NOT_FOUND', '好友申请不存在、已处理或不属于当前账号');
    }
    return ok({
      request: {
        id: updated.id,
        requesterId: updated.requester_id,
        recipientId: updated.recipient_id,
        status: updated.status,
        updatedAt: Number(updated.updated_at)
      },
      friendshipCreated: status === 'accepted' && !updated.duplicate,
      duplicate: Boolean(updated.duplicate)
    });
  }

  async function removeFriend(request, friendId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId)) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    const removed = await store.removeFriendship(account.user_id, friendId);
    return ok({ removed });
  }

  function friendMessageView(row) {
    return {
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      body: row.body,
      createdAt: Number(row.created_at)
    };
  }

  function parseFriendMessageCursor(raw) {
    if (!raw) return null;
    const value = String(raw);
    const separator = value.indexOf('.');
    if (separator <= 0) {
      throw new ApiError(400, 'INVALID_MESSAGE_CURSOR', '消息游标格式无效');
    }
    const createdAt = Number(value.slice(0, separator));
    const id = value.slice(separator + 1);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !FRIEND_MESSAGE_ID_PATTERN.test(id)) {
      throw new ApiError(400, 'INVALID_MESSAGE_CURSOR', '消息游标格式无效');
    }
    return { createdAt, id };
  }

  async function getFriendMessages(request, friendId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId) || friendId === account.user_id) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    if (!store.getFriendship(account.user_id, friendId)) {
      throw new ApiError(403, 'NOT_FRIENDS', '只有已经互相同意的好友才能查看聊天记录');
    }
    const friend = await store.getFriendAccount(friendId);
    if (!friend || friend.revoked_at) {
      throw new ApiError(404, 'FRIEND_ACCOUNT_NOT_FOUND', '这位好友账号暂不可用');
    }
    const url = new URL(request.url);
    const afterRaw = url.searchParams.get('after');
    const beforeRaw = url.searchParams.get('before');
    if (afterRaw && beforeRaw) {
      throw new ApiError(400, 'INVALID_MESSAGE_CURSOR', '不能同时使用 after 和 before 游标');
    }
    const after = parseFriendMessageCursor(afterRaw);
    const before = parseFriendMessageCursor(beforeRaw);
    const fetchedRows = await store.listFriendMessages({
      userId: account.user_id,
      friendId,
      after,
      before,
      limit: FRIEND_MESSAGE_LIMIT + 1
    });
    const hasMore = fetchedRows.length > FRIEND_MESSAGE_LIMIT;
    // An older-page query returns the nearest preceding rows in ascending order;
    // keep the last 50. An initial page keeps the newest 50; polling keeps the
    // first 50 newer rows so the next cursor can drain the remainder.
    const rows = afterRaw
      ? fetchedRows.slice(0, FRIEND_MESSAGE_LIMIT)
      : fetchedRows.slice(-FRIEND_MESSAGE_LIMIT);
    const first = rows.length ? rows[0] : null;
    const last = rows.length ? rows[rows.length - 1] : null;
    const cursorOf = row => row
      ? String(Number(row.created_at)) + '.' + String(row.id)
      : null;
    const viewState = await store.getFriendConversationViewState({
      userId: account.user_id,
      friendId
    });
    return ok({
      friend: {
        userId: friend.user_id,
        displayName: friend.display_name || ''
      },
      messages: rows.map(friendMessageView),
      nextCursor: cursorOf(last) || afterRaw || null,
      olderCursor: cursorOf(first) || beforeRaw || null,
      hasMore,
      viewState
    });
  }

  async function sendFriendMessage(request, friendId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId) || friendId === account.user_id) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    const body = await readJsonBody(request);
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== 'body' || keys[1] !== 'clientMessageId') {
      throw new ApiError(400, 'INVALID_FRIEND_MESSAGE', '真人好友聊天目前只接受 clientMessageId 和纯文字 body');
    }
    const clientMessageId = String(body.clientMessageId || '').trim();
    if (!FRIEND_MESSAGE_ID_PATTERN.test(clientMessageId)) {
      throw new ApiError(400, 'INVALID_CLIENT_MESSAGE_ID', '消息客户端 ID 格式无效');
    }
    if (typeof body.body !== 'string') {
      throw new ApiError(400, 'INVALID_FRIEND_MESSAGE', '消息内容必须是文字');
    }
    const messageBody = body.body
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    const charCount = Array.from(messageBody).length;
    if (!charCount) throw new ApiError(400, 'EMPTY_FRIEND_MESSAGE', '不能发送空消息');
    if (charCount > FRIEND_MESSAGE_MAX_CHARS) {
      throw new ApiError(400, 'FRIEND_MESSAGE_TOO_LONG', '单条文字消息最多 2000 个字符');
    }
    const timestamp = now();
    const result = await store.insertFriendMessage({
      id: randomToken(16),
      senderId: account.user_id,
      recipientId: friendId,
      clientMessageId,
      body: messageBody,
      now: timestamp,
      windowStart: timestamp - 60000,
      rateLimit: FRIEND_MESSAGES_PER_MINUTE
    });
    if (result.kind === 'not_friends') {
      throw new ApiError(403, 'NOT_FRIENDS', '只有已经互相同意的好友才能发送消息');
    }
    if (result.kind === 'friend_unavailable') {
      throw new ApiError(404, 'FRIEND_ACCOUNT_NOT_FOUND', '这位好友账号暂不可用');
    }
    if (result.kind === 'rate_limited') {
      throw new ApiError(429, 'FRIEND_MESSAGE_RATE_LIMITED', '一分钟内发送消息过多，请稍后再试');
    }
    if (result.kind === 'idempotency_conflict') {
      throw new ApiError(409, 'MESSAGE_IDEMPOTENCY_CONFLICT', '这条消息的发送凭据已被其他内容使用，请重新发送');
    }
    if (result.kind === 'stale_relationship_retry') {
      throw new ApiError(409, 'STALE_FRIENDSHIP_MESSAGE_RETRY', '这条消息属于之前的好友关系，不能在重新添加好友后重放；请作为新消息重新发送');
    }
    if (!result.message) {
      throw new ApiError(500, 'FRIEND_MESSAGE_NOT_SAVED', '消息没有成功保存，请重试');
    }
    return ok({
      message: friendMessageView(result.message),
      duplicate: result.kind === 'duplicate'
    });
  }


  async function markFriendMessagesRead(request, friendId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId) || friendId === account.user_id) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    const body = await readJsonBody(request);
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'messageId') {
      throw new ApiError(400, 'INVALID_READ_RECEIPT', '已读确认只接受 messageId');
    }
    const messageId = String(body.messageId || '').trim();
    if (!FRIEND_MESSAGE_ID_PATTERN.test(messageId)) {
      throw new ApiError(400, 'INVALID_READ_RECEIPT', '消息 ID 格式无效');
    }
    const result = await store.markFriendConversationRead({
      userId: account.user_id,
      friendId,
      messageId,
      now: now()
    });
    if (result.kind === 'not_friends') {
      throw new ApiError(403, 'NOT_FRIENDS', '只有仍然有效的好友才能更新已读状态');
    }
    if (result.kind === 'message_not_found') {
      throw new ApiError(404, 'FRIEND_MESSAGE_NOT_FOUND', '只能确认已收到的好友消息');
    }
    return ok({
      read: {
        friendId,
        lastReadMessageId: result.read.last_read_message_id,
        lastReadAt: Number(result.read.last_read_created_at),
        updatedAt: Number(result.read.updated_at)
      },
      alreadyRead: result.kind === 'already_read'
    });
  }



  async function hideFriendMessage(request, friendId, messageId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId) || friendId === account.user_id ||
        !FRIEND_MESSAGE_ID_PATTERN.test(messageId)) {
      throw new ApiError(400, 'INVALID_FRIEND_MESSAGE', '好友或消息 ID 格式无效');
    }
    const result = await store.hideFriendMessage({
      userId: account.user_id,
      friendId,
      messageId,
      now: now()
    });
    if (result.kind === 'not_friends') {
      throw new ApiError(403, 'NOT_FRIENDS', '只有仍然有效的好友才能管理聊天消息');
    }
    if (result.kind === 'message_not_found') {
      throw new ApiError(404, 'FRIEND_MESSAGE_NOT_FOUND', '没有找到这条好友消息');
    }
    return ok({ hidden: result.kind === 'hidden', alreadyHidden: result.kind === 'already_hidden', scope: 'current_user_only' });
  }

  async function clearFriendConversation(request, friendId) {
    const account = await authenticateFriendAccount(request);
    if (!FRIEND_ACCOUNT_ID_PATTERN.test(friendId) || friendId === account.user_id) {
      throw new ApiError(400, 'INVALID_FRIEND_TARGET', '好友 ID 格式无效');
    }
    const result = await store.clearFriendConversation({
      userId: account.user_id,
      friendId,
      now: now()
    });
    if (result.kind === 'not_friends') {
      throw new ApiError(403, 'NOT_FRIENDS', '只有仍然有效的好友才能清理聊天记录');
    }
    return ok({
      cleared: result.cleared,
      empty: result.kind === 'empty',
      alreadyCleared: result.kind === 'already_cleared',
      clearedThrough: result.clearedThrough || null,
      scope: 'current_user_only'
    });
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
    const contextVersionSummary = await store.getCharacterContextVersionSummary(userId);
    const contextVersionReady = contextVersionSummary.roleCount > 0;
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
      activityExecutorAvailable: false,
      autonomousMessageGenerationReady: false,
      autonomyExecutionBlockers: [
        'executor_unavailable',
        ...(contextVersionReady ? [] : ['context_version_unavailable'])
      ],
      note: '角色聊天版本只记录服务端递增版本和设备事件 ID，不接收聊天正文；当前仍没有 AI 执行器，不会生成角色消息或触发主动推送。'
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

  async function getCharacterContextVersion(request, characterId) {
    const device = await authenticate(request);
    const row = await store.getCharacterContextVersion(device.user_id || OWNER_USER_ID, characterId);
    return ok({
      configured: Boolean(row),
      version: row ? Number(row.version) : 0,
      updatedAt: row ? Number(row.updated_at) : null
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
      windowStart: timestamp - 3600000
    });
    if (result.limited) {
      throw new ApiError(429, 'CONTEXT_VERSION_RATE_LIMITED', '角色上下文版本同步过于频繁，请稍后重试');
    }
    return ok({
      changed: result.changed,
      version: result.version,
      updatedAt: result.updatedAt
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
      if (path === '/api/accounts/register' && method === 'POST') return await registerFriendAccount(request);
      if (path === '/api/accounts/me' && method === 'GET') return await getFriendAccountMe(request);
      if (path === '/api/accounts/me' && method === 'PUT') return await updateFriendAccountMe(request);

      const publicFriendProfileMatch = /^\/api\/friend-profiles\/([^/]+)$/.exec(path);
      if (publicFriendProfileMatch && method === 'GET' && FRIEND_ACCOUNT_ID_PATTERN.test(publicFriendProfileMatch[1])) {
        return await getPublicFriendProfile(publicFriendProfileMatch[1]);
      }
      if (path === '/api/friends' && method === 'GET') return await getFriendList(request);
      if (path === '/api/friend-requests' && method === 'GET') return await getFriendRequestList(request);
      if (path === '/api/friend-requests' && method === 'POST') return await sendFriendRequest(request);

      const friendRequestActionMatch = /^\/api\/friend-requests\/([A-Za-z0-9_-]{16,64})\/(accept|reject)$/.exec(path);
      if (friendRequestActionMatch && method === 'POST') {
        return await respondFriendRequest(
          request,
          friendRequestActionMatch[1],
          friendRequestActionMatch[2] === 'accept' ? 'accepted' : 'rejected'
        );
      }
      const friendReadMatch = /^\/api\/friends\/([^/]+)\/read$/.exec(path);
      if (friendReadMatch && method === 'POST') return await markFriendMessagesRead(request, friendReadMatch[1]);

      const friendMessageItemMatch = /^\/api\/friends\/([^/]+)\/messages\/([^/]+)$/.exec(path);
      if (friendMessageItemMatch && method === 'DELETE') {
        return await hideFriendMessage(request, friendMessageItemMatch[1], friendMessageItemMatch[2]);
      }

      const friendMessagesMatch = /^\/api\/friends\/([^/]+)\/messages$/.exec(path);
      if (friendMessagesMatch) {
        const friendId = friendMessagesMatch[1];
        if (method === 'GET') return await getFriendMessages(request, friendId);
        if (method === 'POST') return await sendFriendMessage(request, friendId);
        if (method === 'DELETE') return await clearFriendConversation(request, friendId);
      }

      const removeFriendMatch = /^\/api\/friends\/([^/]+)$/.exec(path);
      if (removeFriendMatch && method === 'DELETE') return await removeFriend(request, removeFriendMatch[1]);

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
