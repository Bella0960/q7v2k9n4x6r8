import { ApiError, ok, json, readJsonBody } from './http.js';
import { randomToken, sha256Hex, base64UrlToBytes, timingSafeEqualHex } from './crypto.js';

const SESSION_COOKIE = 'MAO_SESSION';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_MAX_ATTEMPTS = 120;
const LOGIN_ACCOUNT_IP_MAX_ATTEMPTS = 8;
const LOGIN_RATE_RETENTION_MS = 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210000;
const USERNAME_RE = /^[\p{L}\p{N}_-]{2,24}$/u;
const ACCOUNT_ID_RE = /^MAO-[A-Z0-9]{12,24}$/;
const INVITE_RE = /^[A-Za-z0-9_-]{32,128}$/;

function toHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function passwordDigest(password, saltText) {
  const salt = base64UrlToBytes(saltText);
  if (!salt || salt.length < 16) throw new ApiError(500, 'ACCOUNT_CREDENTIAL_INVALID', '账号凭据异常');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    material,
    256
  );
  return toHex(new Uint8Array(bits));
}

function adminDirectoryOptions(request, allowedStatuses, idPattern) {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit == null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'INVALID_DIRECTORY_LIMIT', '每页读取数量必须在 1–100 之间');
  }
  const search = String(url.searchParams.get('search') || '').trim();
  if (search.length > 120) {
    throw new ApiError(400, 'INVALID_DIRECTORY_SEARCH', '搜索内容不能超过 120 个字符');
  }
  const status = String(url.searchParams.get('status') || 'all');
  if (!allowedStatuses.includes(status)) {
    throw new ApiError(400, 'INVALID_DIRECTORY_FILTER', '列表筛选条件不正确');
  }
  const cursorText = String(url.searchParams.get('cursor') || '');
  let cursor = null;
  if (cursorText) {
    const separator = cursorText.indexOf(':');
    const createdAtText = cursorText.slice(0, separator);
    const id = cursorText.slice(separator + 1);
    const createdAt = Number(createdAtText);
    if (separator < 1 || !/^\d{1,16}$/.test(createdAtText) ||
        !Number.isSafeInteger(createdAt) || createdAt < 0 || !idPattern.test(id)) {
      throw new ApiError(400, 'INVALID_DIRECTORY_CURSOR', '列表游标无效，请刷新后重试');
    }
    cursor = { createdAt, id };
  }
  return { limit, search, status, cursor };
}

function normalizedUsername(value) {
  const username = String(value || '').trim();
  if (!USERNAME_RE.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', '用户名需要为 2–24 位字母、数字、下划线或连字符');
  }
  return { username, usernameKey: username.toLocaleLowerCase('en-US') };
}

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (
    email.length > 254 ||
    !/^[^\s@]+@(?:qq\.com|vip\.qq\.com|foxmail\.com)$/.test(email)
  ) {
    throw new ApiError(400, 'INVALID_EMAIL', '请输入有效的 QQ 邮箱地址');
  }
  return email;
}

function cookieValue(request) {
  const raw = String(request.headers.get('cookie') || '');
  for (const item of raw.split(';')) {
    const point = item.indexOf('=');
    if (point < 0) continue;
    if (item.slice(0, point).trim() === SESSION_COOKIE) return item.slice(point + 1).trim();
  }
  const authorization = String(request.headers.get('authorization') || '');
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization);
  return match ? match[1] : '';
}

function withSessionCookie(response, token, request, maxAge = SESSION_TTL_MS / 1000) {
  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  headers.append(
    'set-cookie',
    SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
      Math.max(0, Math.floor(maxAge)) + secure
  );
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function clearSessionCookie(response, request) {
  return withSessionCookie(response, '', request, 0);
}

function publicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    ...(account.role === 'super_admin' ? { founderNumber: '001' } : {}),
    status: account.status,
    qqEmail: account.qq_email || null,
    qqEmailVerified: Boolean(account.qq_email_verified_at),
    authorizedAt: account.authorized_at == null ? null : Number(account.authorized_at)
  };
}

export function createAccountAuth({ store, env = {}, now = () => Date.now() }) {
  async function createSession(account, request) {
    const token = randomToken(32);
    const timestamp = now();
    const inserted = store.createMaoAccountSession({
      id: randomToken(12),
      accountId: account.id,
      tokenHash: await sha256Hex(token),
      now: timestamp,
      expiresAt: timestamp + SESSION_TTL_MS
    });
    if (!inserted) {
      const latest = store.getMaoAccountById(account.id);
      if (latest && (latest.status === 'disabled' || latest.status === 'revoked')) {
        throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
      }
      throw new ApiError(409, 'ACCOUNT_STATE_CHANGED', '账号状态已变化，请重新登录后再试');
    }
    return withSessionCookie(ok({ account: publicAccount(account) }), token, request);
  }

  async function getAuthenticatedAccount(request) {
    const token = cookieValue(request);
    if (!token) return null;
    const session = store.getMaoAccountSession(await sha256Hex(token));
    const timestamp = now();
    if (!session) return null;
    // Keep the user-facing disabled notice even after all sessions are revoked.
    if (session.status === 'disabled' || session.status === 'revoked') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
    }
    if (session.session_revoked_at || Number(session.expires_at) <= timestamp) return null;
    store.touchMaoAccountSession(session.session_id, timestamp);
    return session;
  }

  async function requireActiveAdmin(request) {
    const account = await getAuthenticatedAccount(request);
    if (!account) {
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
    }
    if (account.status !== 'active' || account.role !== 'super_admin') {
      throw new ApiError(403, 'ADMIN_ONLY', '仅超级管理员可以使用此功能');
    }
    return account;
  }

  async function bootstrap(request) {
    if (store.hasMaoSuperAdminAccount()) {
      throw new ApiError(409, 'ADMIN_ALREADY_INITIALIZED', '超级管理员已经初始化');
    }
    const body = await readJsonBody(request);
    const configured = String(env.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET || '');
    const supplied = String(body.bootstrapSecret || '');
    const pepper = String(env.DEVICE_SECRET_PEPPER || '');
    if (configured.length < 32 || pepper.length < 32) {
      throw new ApiError(503, 'ADMIN_BOOTSTRAP_NOT_CONFIGURED', '管理员首次初始化尚未配置安全密钥');
    }
    const ip = String(request.headers.get('cf-connecting-ip') || 'unavailable');
    const ipHash = await sha256Hex('mao-bootstrap|' + pepper + '|' + ip);
    if (store.getMaoLoginRateLimit(ipHash, now()).blocked) {
      throw new ApiError(429, 'BOOTSTRAP_RATE_LIMITED', '初始化尝试过多，请 15 分钟后再试');
    }
    if (supplied.length < 32) {
      const failed = store.recordMaoLoginFailure(ipHash, now());
      if (failed.blocked) throw new ApiError(429, 'BOOTSTRAP_RATE_LIMITED', '初始化尝试过多，请 15 分钟后再试');
      throw new ApiError(403, 'INVALID_BOOTSTRAP_SECRET', '初始化授权无效');
    }
    const hashes = await Promise.all([
      sha256Hex('mao-admin-bootstrap|' + configured),
      sha256Hex('mao-admin-bootstrap|' + supplied)
    ]);
    if (!timingSafeEqualHex(hashes[0], hashes[1])) {
      const failed = store.recordMaoLoginFailure(ipHash, now());
      if (failed.blocked) throw new ApiError(429, 'BOOTSTRAP_RATE_LIMITED', '初始化尝试过多，请 15 分钟后再试');
      throw new ApiError(403, 'INVALID_BOOTSTRAP_SECRET', '初始化授权无效');
    }
    store.clearMaoLoginRateLimit(ipHash);

    const identity = normalizedUsername(body.username);
    const password = String(body.password || '');
    if (password.length < 10 || password.length > 128) {
      throw new ApiError(400, 'INVALID_PASSWORD', '密码长度需要为 10–128 位');
    }
    if (body.confirmPassword !== password) {
      throw new ApiError(400, 'PASSWORD_MISMATCH', '两次输入的密码不一致');
    }
    const salt = randomToken(16);
    const passwordHash = await passwordDigest(password, salt);
    const timestamp = now();
    const account = {
      id: 'MAO-' + randomToken(12).replace(/[-_]/g, 'X').toUpperCase(),
      username: identity.username,
      usernameKey: identity.usernameKey,
      passwordSalt: salt,
      passwordHash,
      qqEmail: normalizedEmail(body.qqEmail),
      now: timestamp
    };
    let created = false;
    try {
      created = store.createMaoSuperAdminAccountIfEmpty(account);
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || error))) {
        throw new ApiError(409, 'ADMIN_ALREADY_INITIALIZED', '超级管理员已经初始化');
      }
      throw error;
    }
    if (!created) throw new ApiError(409, 'ADMIN_ALREADY_INITIALIZED', '超级管理员已经初始化');
    return await createSession(store.getMaoAccountById(account.id), request);
  }

  async function register(request) {
    const body = await readJsonBody(request);
    const identity = normalizedUsername(body.username);
    const password = String(body.password || '');
    if (password.length < 10 || password.length > 128) {
      throw new ApiError(400, 'INVALID_PASSWORD', '密码长度需要为 10–128 位');
    }
    if (body.confirmPassword !== password) {
      throw new ApiError(400, 'PASSWORD_MISMATCH', '两次输入的密码不一致');
    }
    const timestamp = now();
    const pepper = String(env.DEVICE_SECRET_PEPPER || '');
    if (pepper.length < 32) {
      throw new ApiError(503, 'ACCOUNT_SECURITY_NOT_CONFIGURED', '账号安全服务尚未完成配置');
    }
    const ip = String(request.headers.get('cf-connecting-ip') || 'unavailable');
    const registrationIpHash = await sha256Hex('mao-register|' + pepper + '|' + ip);
    if (store.countMaoAccountsByRegistrationIp(registrationIpHash, timestamp - 60 * 60 * 1000) >= 8) {
      throw new ApiError(429, 'ACCOUNT_REGISTRATION_RATE_LIMITED', '当前网络注册次数过多，请稍后再试');
    }
    const salt = randomToken(16);
    const passwordHash = await passwordDigest(password, salt);
    const account = {
      id: 'MAO-' + randomToken(12).replace(/[-_]/g, 'X').toUpperCase(),
      username: identity.username,
      usernameKey: identity.usernameKey,
      passwordSalt: salt,
      passwordHash,
      qqEmail: normalizedEmail(body.qqEmail),
      registrationIpHash,
      now: timestamp
    };
    try {
      const created = store.createMaoAccount(account);
      if (!created) {
        throw new ApiError(429, 'ACCOUNT_REGISTRATION_RATE_LIMITED', '当前网络注册次数过多，请稍后再试');
      }
      return json({ ok: true, account: publicAccount(created), nextStep: 'invite_required' }, 201);
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || error))) {
        throw new ApiError(409, 'ACCOUNT_ALREADY_EXISTS', '用户名或邮箱已被使用');
      }
      throw error;
    }
  }

  async function login(request) {
    const body = await readJsonBody(request);
    const identifier = String(body.identifier || '').trim();
    const password = String(body.password || '');
    if (!identifier || password.length > 128) {
      throw new ApiError(400, 'INVALID_LOGIN', '请输入账号和密码');
    }
    const pepper = String(env.DEVICE_SECRET_PEPPER || '');
    if (pepper.length < 32) {
      throw new ApiError(503, 'ACCOUNT_SECURITY_NOT_CONFIGURED', '账号安全服务尚未完成配置');
    }
    const ip = String(request.headers.get('cf-connecting-ip') || 'unavailable');
    const ipRateLimitKey = await sha256Hex('mao-login|' + pepper + '|' + ip);
    const rateLimitTimestamp = now();
    // The IP bucket is an aggregate safety ceiling for shared networks. Its
    // count is never cleared by one user's successful login.
    store.cleanupMaoLoginRateLimits(rateLimitTimestamp, LOGIN_RATE_RETENTION_MS);
    if (store.getMaoLoginRateLimit(ipRateLimitKey, rateLimitTimestamp, LOGIN_RATE_WINDOW_MS).blocked) {
      throw new ApiError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后再试');
    }

    const account = store.getMaoAccountByIdentifier(identifier);
    // Resolve aliases (username, permanent MAO ID, verified email) to the same
    // account bucket. Unknown identifiers use their normalized input so they
    // receive the same failure cadence without storing plaintext identifiers.
    const accountBucketIdentity = account?.id || identifier.toLowerCase();
    const accountIpRateLimitKey = await sha256Hex(
      'mao-login-account-ip|' + pepper + '|' + accountBucketIdentity + '|' + ip
    );
    if (store.getMaoLoginRateLimit(accountIpRateLimitKey, rateLimitTimestamp, LOGIN_RATE_WINDOW_MS).blocked) {
      throw new ApiError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后再试');
    }

    const recordLoginFailure = () => {
      const failedAt = now();
      const ipFailure = store.recordMaoLoginFailure(ipRateLimitKey, failedAt, {
        windowMs: LOGIN_RATE_WINDOW_MS,
        maxAttempts: LOGIN_IP_MAX_ATTEMPTS
      });
      const accountIpFailure = store.recordMaoLoginFailure(accountIpRateLimitKey, failedAt, {
        windowMs: LOGIN_RATE_WINDOW_MS,
        maxAttempts: LOGIN_ACCOUNT_IP_MAX_ATTEMPTS
      });
      return ipFailure.blocked || accountIpFailure.blocked;
    };

    if (!account) {
      // Spend comparable password-hash work for unknown identifiers to reduce
      // account enumeration through response timing.
      await passwordDigest(password, 'AAAAAAAAAAAAAAAAAAAAAA');
      if (recordLoginFailure()) {
        throw new ApiError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后再试');
      }
      throw new ApiError(401, 'LOGIN_FAILED', '账号或密码不正确');
    }
    const actual = await passwordDigest(password, account.password_salt);
    if (!timingSafeEqualHex(actual, account.password_hash)) {
      if (recordLoginFailure()) {
        throw new ApiError(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后再试');
      }
      throw new ApiError(401, 'LOGIN_FAILED', '账号或密码不正确');
    }
    // A successful login clears only this account + this IP's failure bucket.
    // The shared IP aggregate deliberately survives until its window expires.
    store.clearMaoLoginRateLimit(accountIpRateLimitKey);
    if (account.status === 'disabled' || account.status === 'revoked') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
    }
    return await createSession(account, request);
  }

  async function currentAccount(request) {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    return ok({ account: publicAccount(account) });
  }

  async function accountSecurity(request) {
    const actor = await getAuthenticatedAccount(request);
    if (!actor) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    const timestamp = now();
    return ok({
      currentSessionId: actor.session_id,
      devices: store.listMaoAccountDevices(actor.account_id).map(device => ({
        id: device.id,
        label: device.label || '',
        platform: device.platform || '',
        createdAt: Number(device.created_at),
        lastSeenAt: Number(device.last_seen_at),
        revokedAt: device.revoked_at == null ? null : Number(device.revoked_at)
      })),
      sessions: store.listMaoAccountSessions(actor.account_id).map(session => ({
        id: session.id,
        createdAt: Number(session.created_at),
        expiresAt: Number(session.expires_at),
        lastUsedAt: Number(session.last_used_at),
        revokedAt: session.revoked_at == null ? null : Number(session.revoked_at),
        expired: session.revoked_at == null && Number(session.expires_at) <= timestamp,
        current: session.id === actor.session_id
      }))
    });
  }

  async function revokeOwnSession(request, sessionId) {
    const actor = await getAuthenticatedAccount(request);
    if (!actor || actor.status !== 'active') {
      throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    }
    if (!store.revokeMaoAccountSessionForAccount(actor.account_id, sessionId, now())) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', '登录会话不存在或已经退出');
    }
    const response = ok({ revoked: true, current: sessionId === actor.session_id });
    return sessionId === actor.session_id ? clearSessionCookie(response, request) : response;
  }

  async function revokeOwnDevice(request, deviceId) {
    const actor = await getAuthenticatedAccount(request);
    if (!actor || actor.status !== 'active') {
      throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    }
    if (!store.revokeMaoAccountDevice(actor.account_id, deviceId, now())) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', '设备不存在或已经撤销');
    }
    return ok({ revoked: true });
  }

  async function changePassword(request) {
    const actor = await getAuthenticatedAccount(request);
    if (!actor || actor.status !== 'active') {
      throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    }
    const pepper = String(env.DEVICE_SECRET_PEPPER || '');
    if (pepper.length < 32) {
      throw new ApiError(503, 'ACCOUNT_SECURITY_NOT_CONFIGURED', '账号安全服务尚未完成配置');
    }
    const ip = String(request.headers.get('cf-connecting-ip') || 'unavailable');
    const rateLimitKey = await sha256Hex('mao-password-change|' + pepper + '|' + ip + '|' + actor.account_id);
    if (store.getMaoLoginRateLimit(rateLimitKey, now()).blocked) {
      throw new ApiError(429, 'PASSWORD_CHANGE_RATE_LIMITED', '密码验证尝试过多，请 15 分钟后再试');
    }

    const body = await readJsonBody(request);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 10 || newPassword.length > 128) {
      throw new ApiError(400, 'INVALID_PASSWORD', '新密码长度需要为 10–128 位');
    }
    if (body.confirmPassword !== newPassword) {
      throw new ApiError(400, 'PASSWORD_MISMATCH', '两次输入的新密码不一致');
    }
    const account = store.getMaoAccountById(actor.account_id);
    if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    const currentDigest = await passwordDigest(currentPassword, account.password_salt);
    if (!timingSafeEqualHex(currentDigest, account.password_hash)) {
      const failed = store.recordMaoLoginFailure(rateLimitKey, now());
      if (failed.blocked) {
        throw new ApiError(429, 'PASSWORD_CHANGE_RATE_LIMITED', '密码验证尝试过多，请 15 分钟后再试');
      }
      throw new ApiError(401, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
    }
    if (timingSafeEqualHex(await passwordDigest(newPassword, account.password_salt), account.password_hash)) {
      throw new ApiError(400, 'PASSWORD_REUSE', '新密码不能与当前密码相同');
    }
    const salt = randomToken(16);
    const digest = await passwordDigest(newPassword, salt);
    if (!store.updateMaoAccountPasswordAndRevokeOtherSessions({
      accountId: actor.account_id,
      keepSessionId: actor.session_id,
      passwordSalt: salt,
      passwordHash: digest,
      now: now()
    })) {
      throw new ApiError(409, 'PASSWORD_UPDATE_FAILED', '密码修改没有成功');
    }
    store.clearMaoLoginRateLimit(rateLimitKey);
    return ok({ changed: true, sessionsRevoked: true });
  }


  async function logout(request) {
    const token = cookieValue(request);
    if (token) {
      const session = store.getMaoAccountSession(await sha256Hex(token));
      if (session) store.revokeMaoAccountSession(session.session_id, now());
    }
    return clearSessionCookie(ok({ loggedOut: true }), request);
  }

  async function redeemInvite(request) {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    if (account.status !== 'pending_invite') {
      throw new ApiError(409, 'ACCOUNT_NOT_PENDING', '当前账号不需要邀请码授权');
    }
    const body = await readJsonBody(request);
    const inviteCode = String(body.inviteCode || '').trim();
    if (!INVITE_RE.test(inviteCode)) {
      throw new ApiError(400, 'INVALID_INVITE_CODE', '邀请码格式不正确');
    }
    const accepted = store.redeemMaoInvite({
      tokenHash: await sha256Hex('mao-invite|' + inviteCode),
      accountId: account.id,
      sessionId: account.session_id,
      now: now()
    });
    if (accepted === 'session_invalid') {
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '登录会话已失效，请重新登录后再验证邀请码');
    }
    if (!accepted) {
      throw new ApiError(403, 'INVITE_NOT_VALID_FOR_ACCOUNT', '邀请码无效、已使用、已过期或不属于当前账号');
    }
    return ok({ account: publicAccount(store.getMaoAccountById(account.id)), authorized: true });
  }

  async function createInvite(request) {
    const actor = await requireActiveAdmin(request);
    const body = await readJsonBody(request);
    const targetAccountId = String(body.targetAccountId || '').trim();
    const targetEmail = normalizedEmail(body.targetEmail);
    if (Boolean(targetAccountId) === Boolean(targetEmail)) {
      throw new ApiError(400, 'INVITE_TARGET_REQUIRED', '必须指定一个 MAO 永久 ID 或已验证邮箱');
    }
    if (targetAccountId && !ACCOUNT_ID_RE.test(targetAccountId)) {
      throw new ApiError(400, 'INVALID_TARGET_ACCOUNT', 'MAO 永久 ID 格式不正确');
    }
    if (targetAccountId) {
      const target = store.getMaoAccountById(targetAccountId);
      if (!target || target.role === 'super_admin' || target.status !== 'pending_invite') {
        throw new ApiError(404, 'INVITE_TARGET_NOT_FOUND', '找不到符合条件的待授权账号');
      }
    }
    if (targetEmail) {
      const verifiedOwner = store.findVerifiedMaoEmail(targetEmail);
      const target = verifiedOwner ? store.getMaoAccountById(verifiedOwner.id) : null;
      if (!target || target.status !== 'pending_invite') {
        throw new ApiError(409, 'EMAIL_NOT_VERIFIED', '该邮箱尚未验证，或没有对应的待授权账号');
      }
    }
    const maxUses = body.maxUses == null ? 1 : Number(body.maxUses);
    if (maxUses !== 1) {
      throw new ApiError(400, 'INVALID_INVITE_USES', 'MAO 采用一人一码，每个邀请码只能成功授权一个账号');
    }
    const ttlHours = body.ttlHours == null ? 168 : Number(body.ttlHours);
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720) {
      throw new ApiError(400, 'INVALID_INVITE_EXPIRY', '邀请码有效期需要为 1–720 小时');
    }
    const timestamp = now();
    if (store.hasActiveMaoInvite({ targetAccountId, targetEmail, now: timestamp })) {
      throw new ApiError(409, 'INVITE_ALREADY_ACTIVE', '该账号已有尚未使用且未过期的邀请码，请先撤销原邀请码');
    }
    const code = randomToken(32);
    const inviteId = randomToken(16);
    const expiresAt = timestamp + ttlHours * 60 * 60 * 1000;
    const inserted = store.insertMaoInvite({
      id: inviteId,
      tokenHash: await sha256Hex('mao-invite|' + code),
      targetAccountId,
      targetEmail,
      maxUses,
      createdByAccountId: actor.account_id,
      actorSessionId: actor.session_id,
      now: timestamp,
      expiresAt
    });
    if (inserted === 'actor_session_invalid') {
      throw new ApiError(403, 'ADMIN_SESSION_REVOKED', '管理员会话已失效，请重新登录后再操作');
    }
    if (inserted === 'target_not_pending') {
      throw new ApiError(409, 'INVITE_TARGET_NOT_PENDING', '该账号状态已经变化，不能生成邀请码；请刷新账号状态后重试');
    }
    if (!inserted) {
      throw new ApiError(409, 'INVITE_ALREADY_ACTIVE', '该账号已有尚未使用且未过期的邀请码，请先撤销原邀请码');
    }
    return json({
      ok: true,
      invite: { id: inviteId, code, targetAccountId: targetAccountId || null, targetEmail, maxUses, expiresAt },
      warning: '邀请码仅展示这一次，请安全交付给指定对象'
    }, 201);
  }

  async function adminAccounts(request) {
    await requireActiveAdmin(request);
    const options = adminDirectoryOptions(request, ['all', 'pending_invite', 'active', 'restricted'], ACCOUNT_ID_RE);
    const rows = store.listMaoAccounts(options);
    const hasMore = rows.length > options.limit;
    const accounts = rows.slice(0, options.limit);
    const last = accounts[accounts.length - 1] || null;
    return ok({
      accounts: accounts.map(account => ({
        ...account,
        qq_email_verified_at: account.qq_email_verified_at == null ? null : Number(account.qq_email_verified_at)
      })),
      page: {
        limit: options.limit,
        totalCount: store.countMaoAccounts(options),
        hasMore,
        nextCursor: hasMore && last ? String(last.created_at) + ':' + last.id : null
      },
      summary: store.getMaoAccountDirectorySummary()
    });
  }

  async function adminInvites(request) {
    await requireActiveAdmin(request);
    const options = adminDirectoryOptions(
      request,
      ['all', 'pending', 'used', 'expired', 'revoked'],
      /^[A-Za-z0-9_-]{16,64}$/
    );
    const rows = store.listMaoInvites({ ...options, now: now() });
    const hasMore = rows.length > options.limit;
    const invites = rows.slice(0, options.limit);
    const last = invites[invites.length - 1] || null;
    return ok({
      invites,
      page: {
        limit: options.limit,
        totalCount: store.countMaoInvites({ search: options.search, status: options.status, now: now() }),
        hasMore,
        nextCursor: hasMore && last ? String(last.created_at) + ':' + last.id : null
      },
      summary: store.getMaoInviteDirectorySummary(now())
    });
  }

  async function adminAccountDetail(request, accountId) {
    await requireActiveAdmin(request);
    const account = store.getMaoAccountById(accountId);
    if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');

    // Return only fields needed by the creator UI. Never expose password
    // material, registration hashes, invitation hashes, or raw invite codes.
    const publicAccount = {
      id: String(account.id),
      username: String(account.username || ''),
      role: String(account.role || 'user'),
      status: String(account.status || ''),
      qq_email: account.qq_email == null ? null : String(account.qq_email),
      qq_email_verified_at: account.qq_email_verified_at == null ? null : Number(account.qq_email_verified_at),
      created_at: Number(account.created_at || 0),
      authorized_at: account.authorized_at == null ? null : Number(account.authorized_at),
      disabled_at: account.disabled_at == null ? null : Number(account.disabled_at),
      revoked_at: account.revoked_at == null ? null : Number(account.revoked_at)
    };

    // Read account state and its pending invitation together in one Worker
    // request so the UI never combines a stale list row with a newer invite.
    const row = account.status === 'pending_invite'
      ? store.getActiveMaoInviteForAccount(accountId, now())
      : null;
    return ok({
      account: publicAccount,
      invite: row ? {
        id: String(row.id),
        expiresAt: Number(row.expires_at),
        maxUses: Number(row.max_uses || 1),
        usedCount: Number(row.used_count || 0)
      } : null
    });
  }

  async function adminActiveInvite(request, accountId) {
    await requireActiveAdmin(request);
    const account = store.getMaoAccountById(accountId);
    if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    const row = store.getActiveMaoInviteForAccount(accountId, now());
    return ok({
      invite: row ? {
        id: String(row.id),
        expiresAt: Number(row.expires_at),
        maxUses: Number(row.max_uses || 1),
        usedCount: Number(row.used_count || 0)
      } : null
    });
  }

  function adminAuditOptions(request) {
    const url = new URL(request.url);
    const options = adminDirectoryOptions(request, ['all'], /^audit_[A-Za-z0-9_-]{8,80}$/);
    const type = String(url.searchParams.get('type') || 'all');
    if (!['all', 'account', 'invite'].includes(type)) {
      throw new ApiError(400, 'INVALID_AUDIT_FILTER', '操作记录筛选条件不正确');
    }
    const rawSince = url.searchParams.get('since');
    let since = null;
    if (rawSince != null && rawSince !== '') {
      since = Number(rawSince);
      if (!Number.isSafeInteger(since) || since < 0 || since > now()) {
        throw new ApiError(400, 'INVALID_AUDIT_RANGE', '操作记录时间范围不正确');
      }
    }
    return { ...options, type, since };
  }

  async function adminAudit(request) {
    await requireActiveAdmin(request);
    const options = adminAuditOptions(request);
    const rows = store.listMaoAccountAuditEvents(options);
    const hasMore = rows.length > options.limit;
    const pageRecords = rows.slice(0, options.limit);
    const last = pageRecords[pageRecords.length - 1] || null;
    const records = pageRecords.map(record => {
      let detail = {};
      try { detail = JSON.parse(String(record.detail_json || '{}')); } catch {}
      return {
        id: String(record.id),
        actorAccountId: record.actor_account_id == null ? null : String(record.actor_account_id),
        actorUsername: record.actor_username == null ? '' : String(record.actor_username),
        actorType: record.action === 'invite_redeem' || record.action === 'account_register'
          ? 'account'
          : (record.action === 'admin_bootstrap' ? 'system' : 'admin'),
        targetAccountId: record.target_account_id == null ? null : String(record.target_account_id),
        targetUsername: record.target_username == null ? '' : String(record.target_username),
        action: String(record.action),
        reason: String(detail.reason || ''),
        fromStatus: detail.fromStatus == null ? null : String(detail.fromStatus),
        toStatus: detail.toStatus == null ? null : String(detail.toStatus),
        inviteId: detail.inviteId == null ? null : String(detail.inviteId),
        sourceAction: detail.sourceAction == null ? null : String(detail.sourceAction),
        expiresAt: detail.expiresAt == null ? null : Number(detail.expiresAt),
        maxUses: detail.maxUses == null ? null : Number(detail.maxUses),
        usedCount: detail.usedCount == null ? null : Number(detail.usedCount),
        createdAt: Number(record.created_at)
      };
    });
    return ok({
      records,
      page: {
        limit: options.limit,
        totalCount: store.countMaoAccountAuditEvents(options),
        hasMore,
        nextCursor: hasMore && last ? String(last.created_at) + ':' + last.id : null
      },
      summary: store.getMaoAccountAuditSummary()
    });
  }

  async function adminAccountAudit(request, accountId) {
    await requireActiveAdmin(request);
    const account = store.getMaoAccountById(accountId);
    if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    const options = adminDirectoryOptions(request, ['all'], /^audit_[A-Za-z0-9_-]{8,80}$/);
    const rows = store.listMaoAccountAudit(accountId, options);
    const hasMore = rows.length > options.limit;
    const pageRecords = rows.slice(0, options.limit);
    const last = pageRecords[pageRecords.length - 1] || null;
    const records = pageRecords.map(record => {
      let detail = {};
      try { detail = JSON.parse(String(record.detail_json || '{}')); } catch {}
      return {
        id: record.id,
        actorAccountId: record.actor_account_id,
        targetAccountId: record.target_account_id,
        action: record.action,
        reason: String(detail.reason || ''),
        fromStatus: detail.fromStatus == null ? null : String(detail.fromStatus),
        toStatus: detail.toStatus == null ? null : String(detail.toStatus),
        inviteId: detail.inviteId == null ? null : String(detail.inviteId),
        sourceAction: detail.sourceAction == null ? null : String(detail.sourceAction),
        expiresAt: detail.expiresAt == null ? null : Number(detail.expiresAt),
        maxUses: detail.maxUses == null ? null : Number(detail.maxUses),
        usedCount: detail.usedCount == null ? null : Number(detail.usedCount),
        createdAt: Number(record.created_at)
      };
    });
    return ok({
      records,
      page: {
        limit: options.limit,
        totalCount: store.countMaoAccountAudit(accountId),
        hasMore,
        nextCursor: hasMore && last ? String(last.created_at) + ':' + last.id : null
      }
    });
  }

  async function accountAction(request, accountId) {
    const actor = await requireActiveAdmin(request);
    const body = await readJsonBody(request);
    const action = String(body.action || '');
    if (!['disable', 'restore', 'revoke'].includes(action)) {
      throw new ApiError(400, 'INVALID_ACCOUNT_ACTION', '不支持的账号操作');
    }
    const updated = store.setMaoAccountState({
      accountId,
      action,
      actorAccountId: actor.account_id,
      actorSessionId: actor.session_id,
      reason: String(body.reason || '').trim().slice(0, 500),
      now: now()
    });
    if (updated === 'actor_session_invalid') {
      throw new ApiError(403, 'ADMIN_SESSION_REVOKED', '管理员会话已失效，请重新登录后再操作');
    }
    if (!updated) {
      throw new ApiError(409, 'ACCOUNT_ACTION_REJECTED', '该账号不存在，或当前状态不允许此操作');
    }
    return ok({
      account: { id: updated.id, username: updated.username, status: updated.status },
      message: action === 'disable' || action === 'revoke' ? '账号已被禁用' : '账号授权已恢复'
    });
  }

  async function revokeInvite(request, inviteId) {
    const actor = await requireActiveAdmin(request);
    const revoked = store.revokeMaoInvite(
      inviteId,
      actor.account_id,
      now(),
      actor.session_id
    );
    if (revoked === 'actor_session_invalid') {
      throw new ApiError(403, 'ADMIN_SESSION_REVOKED', '管理员会话已失效，请重新登录后再操作');
    }
    if (!revoked) {
      throw new ApiError(404, 'INVITE_NOT_ACTIVE', '邀请码不存在或已失效');
    }
    return ok({ revoked: true });
  }

  return {
    getAuthenticatedAccount,
    handle: async (request, path, method) => {
      if (path === '/api/admin/bootstrap/status' && method === 'GET') {
        // Report readiness without exposing server secret values or key material.
        const initialized = store.hasMaoSuperAdminAccount();
        return ok({
          initialized,
          configured: String(env.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET || '').length >= 32 &&
            String(env.DEVICE_SECRET_PEPPER || '').length >= 32
        });
      }
      if (path === '/api/accounts/register' && method === 'POST') return await register(request);
      if (path === '/api/accounts/login' && method === 'POST') return await login(request);
      if (path === '/api/accounts/logout' && method === 'POST') return await logout(request);
      if (path === '/api/accounts/me' && method === 'GET') return await currentAccount(request);
      if (path === '/api/accounts/security' && method === 'GET') return await accountSecurity(request);
      if (path === '/api/accounts/password/change' && method === 'POST') return await changePassword(request);
      if (path === '/api/accounts/invites/redeem' && method === 'POST') return await redeemInvite(request);

      const sessionMatch = /^\/api\/accounts\/sessions\/([A-Za-z0-9_-]{16,64})\/revoke$/.exec(path);
      if (sessionMatch && method === 'POST') return await revokeOwnSession(request, sessionMatch[1]);
      const deviceMatch = /^\/api\/accounts\/devices\/([A-Za-z0-9_-]{16,64})\/revoke$/.exec(path);
      if (deviceMatch && method === 'POST') return await revokeOwnDevice(request, deviceMatch[1]);
      if (path === '/api/admin/bootstrap' && method === 'POST') return await bootstrap(request);
      if (path === '/api/admin/accounts' && method === 'GET') return await adminAccounts(request);
      if (path === '/api/admin/audit' && method === 'GET') return await adminAudit(request);
      if (path === '/api/admin/invites' && method === 'GET') return await adminInvites(request);
      if (path === '/api/admin/invites' && method === 'POST') return await createInvite(request);

      const detailMatch = /^\/api\/admin\/accounts\/(MAO-[A-Z0-9]{12,24})\/detail$/.exec(path);
      if (detailMatch && method === 'GET') return await adminAccountDetail(request, detailMatch[1]);
      const activeInviteMatch = /^\/api\/admin\/accounts\/(MAO-[A-Z0-9]{12,24})\/active-invite$/.exec(path);
      if (activeInviteMatch && method === 'GET') return await adminActiveInvite(request, activeInviteMatch[1]);
      const auditMatch = /^\/api\/admin\/accounts\/(MAO-[A-Z0-9]{12,24})\/audit$/.exec(path);
      if (auditMatch && method === 'GET') return await adminAccountAudit(request, auditMatch[1]);
      const actionMatch = /^\/api\/admin\/accounts\/(MAO-[A-Z0-9]{12,24})\/action$/.exec(path);
      if (actionMatch && method === 'POST') return await accountAction(request, actionMatch[1]);
      const inviteMatch = /^\/api\/admin\/invites\/([A-Za-z0-9_-]{16,64})\/revoke$/.exec(path);
      if (inviteMatch && method === 'POST') return await revokeInvite(request, inviteMatch[1]);
      return null;
    }
  };
}
