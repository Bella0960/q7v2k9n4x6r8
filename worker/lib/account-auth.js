import { ApiError, ok, readJsonBody } from './http.js';
import { randomToken, sha256Hex, base64UrlToBytes, timingSafeEqualHex } from './crypto.js';

const SESSION_COOKIE = 'MAO_SESSION';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'INVALID_EMAIL', 'QQ 邮箱格式不正确');
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
    store.createMaoAccountSession({
      id: randomToken(12),
      accountId: account.id,
      tokenHash: await sha256Hex(token),
      now: timestamp,
      expiresAt: timestamp + SESSION_TTL_MS
    });
    return withSessionCookie(ok({ account: publicAccount(account) }), token, request);
  }

  async function getAuthenticatedAccount(request) {
    const token = cookieValue(request);
    if (!token) return null;
    const session = store.getMaoAccountSession(await sha256Hex(token));
    const timestamp = now();
    if (!session || session.session_revoked_at || Number(session.expires_at) <= timestamp) return null;
    if (session.status === 'disabled' || session.status === 'revoked') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
    }
    store.touchMaoAccountSession(session.session_id, timestamp);
    return session;
  }

  async function requireActiveAdmin(request) {
    const account = await getAuthenticatedAccount(request);
    if (!account || account.status !== 'active' || account.role !== 'super_admin') {
      throw new ApiError(403, 'ADMIN_ONLY', '仅超级管理员可以使用此功能');
    }
    return account;
  }

  async function bootstrap(request) {
    const body = await readJsonBody(request);
    const configured = String(env.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET || '');
    const supplied = String(body.bootstrapSecret || '');
    if (configured.length < 32 || supplied.length < 32) {
      throw new ApiError(503, 'ADMIN_BOOTSTRAP_NOT_CONFIGURED', '管理员首次初始化尚未配置安全密钥');
    }
    const hashes = await Promise.all([
      sha256Hex('mao-admin-bootstrap|' + configured),
      sha256Hex('mao-admin-bootstrap|' + supplied)
    ]);
    if (!timingSafeEqualHex(hashes[0], hashes[1])) {
      throw new ApiError(403, 'INVALID_BOOTSTRAP_SECRET', '初始化授权无效');
    }

    const identity = normalizedUsername(body.username);
    const password = String(body.password || '');
    if (password.length < 10 || password.length > 128) {
      throw new ApiError(400, 'INVALID_PASSWORD', '密码长度需要为 10–128 位');
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
    const salt = randomToken(16);
    const passwordHash = await passwordDigest(password, salt);
    const account = {
      id: 'MAO-' + randomToken(12).replace(/[-_]/g, 'X').toUpperCase(),
      username: identity.username,
      usernameKey: identity.usernameKey,
      passwordSalt: salt,
      passwordHash,
      qqEmail: normalizedEmail(body.qqEmail),
      now: now()
    };
    try {
      const created = store.createMaoAccount(account);
      return ok({ account: publicAccount(created), nextStep: 'invite_required' }, 201);
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
    const account = store.getMaoAccountByIdentifier(identifier);
    if (!account) throw new ApiError(401, 'LOGIN_FAILED', '账号或密码不正确');
    if (account.status === 'disabled' || account.status === 'revoked') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
    }
    const actual = await passwordDigest(password, account.password_salt);
    if (!timingSafeEqualHex(actual, account.password_hash)) {
      throw new ApiError(401, 'LOGIN_FAILED', '账号或密码不正确');
    }
    return await createSession(account, request);
  }

  async function currentAccount(request) {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录 MAO 账号');
    return ok({ account: publicAccount(account) });
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
      now: now()
    });
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
    if (targetEmail && !store.findVerifiedMaoEmail(targetEmail)) {
      throw new ApiError(409, 'EMAIL_NOT_VERIFIED', '该邮箱尚未完成所有权验证，暂时不能用于邀请码绑定');
    }
    const maxUses = body.maxUses == null ? 1 : Number(body.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20 || (targetAccountId && maxUses !== 1)) {
      throw new ApiError(400, 'INVALID_INVITE_USES', '指定永久 ID 的邀请码只能使用一次；邮箱邀请码最多 20 次');
    }
    const ttlHours = body.ttlHours == null ? 168 : Number(body.ttlHours);
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720) {
      throw new ApiError(400, 'INVALID_INVITE_EXPIRY', '邀请码有效期需要为 1–720 小时');
    }
    const code = randomToken(32);
    const timestamp = now();
    const inviteId = randomToken(16);
    const expiresAt = timestamp + ttlHours * 60 * 60 * 1000;
    store.insertMaoInvite({
      id: inviteId,
      tokenHash: await sha256Hex('mao-invite|' + code),
      targetAccountId,
      targetEmail,
      maxUses,
      createdByAccountId: actor.account_id,
      now: timestamp,
      expiresAt
    });
    return ok({
      invite: { id: inviteId, code, targetAccountId: targetAccountId || null, targetEmail, maxUses, expiresAt },
      warning: '邀请码仅展示这一次，请安全交付给指定对象'
    }, 201);
  }

  async function adminAccounts(request) {
    await requireActiveAdmin(request);
    return ok({
      accounts: store.listMaoAccounts().map(account => ({
        ...account,
        qq_email_verified_at: account.qq_email_verified_at == null ? null : Number(account.qq_email_verified_at)
      }))
    });
  }

  async function adminInvites(request) {
    await requireActiveAdmin(request);
    return ok({ invites: store.listMaoInvites() });
  }

  async function accountAction(request, accountId) {
    const actor = await requireActiveAdmin(request);
    const body = await readJsonBody(request);
    const action = String(body.action || '');
    if (!['disable', 'restore', 'revoke'].includes(action)) {
      throw new ApiError(400, 'INVALID_ACCOUNT_ACTION', '不支持的账号操作');
    }
    const updated = store.setMaoAccountState({
      accountId, action, actorAccountId: actor.account_id, now: now()
    });
    if (!updated) {
      throw new ApiError(409, 'ACCOUNT_ACTION_REJECTED', '该账号不存在，或当前状态不允许此操作');
    }
    return ok({
      account: { id: updated.id, username: updated.username, status: updated.status },
      message: action === 'disable' || action === 'revoke' ? '账号已被禁用' : '账号授权已恢复'
    });
  }

  async function revokeInvite(request, inviteId) {
    await requireActiveAdmin(request);
    if (!store.revokeMaoInvite(inviteId, now())) {
      throw new ApiError(404, 'INVITE_NOT_ACTIVE', '邀请码不存在或已失效');
    }
    return ok({ revoked: true });
  }

  return {
    getAuthenticatedAccount,
    handle: async (request, path, method) => {
      if (path === '/api/accounts/register' && method === 'POST') return await register(request);
      if (path === '/api/accounts/login' && method === 'POST') return await login(request);
      if (path === '/api/accounts/logout' && method === 'POST') return await logout(request);
      if (path === '/api/accounts/me' && method === 'GET') return await currentAccount(request);
      if (path === '/api/accounts/invites/redeem' && method === 'POST') return await redeemInvite(request);
      if (path === '/api/admin/bootstrap' && method === 'POST') return await bootstrap(request);
      if (path === '/api/admin/accounts' && method === 'GET') return await adminAccounts(request);
      if (path === '/api/admin/invites' && method === 'GET') return await adminInvites(request);
      if (path === '/api/admin/invites' && method === 'POST') return await createInvite(request);

      const actionMatch = /^\\/api\\/admin\\/accounts\\/(MAO-[A-Z0-9]{12,24})\\/action$/.exec(path);
      if (actionMatch && method === 'POST') return await accountAction(request, actionMatch[1]);
      const inviteMatch = /^\\/api\\/admin\\/invites\\/([A-Za-z0-9_-]{16,64})\\/revoke$/.exec(path);
      if (inviteMatch && method === 'POST') return await revokeInvite(request, inviteMatch[1]);
      return null;
    }
  };
}
