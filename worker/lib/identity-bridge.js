/**
 * MAO preview identity bridge: one authoritative account, isolated preview data.
 *
 * No browser token or password is kept in a preview database. A secret-gated
 * Worker Service Binding authenticates against the trusted identity authority.
 * This module intentionally stays disabled until BOTH Workers are configured.
 */
import { ApiError } from './http.js';
import { sha256Hex, timingSafeEqualHex } from './crypto.js';

export const DELEGATED_IDENTITY_MODE = 'delegated_preview';
export const BRIDGE_AUTH_HEADER = 'x-mao-identity-bridge';
const ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;
const USERNAME = /^[\p{L}\p{N}_-]{2,24}$/u;
// This URL is ONLY passed to a Worker Service Binding (never fetch()). Cloudflare
// routes directly to mao-auth-preview, bypassing public DNS and the browser.
// Match the already verified read-only probe's origin for POST Origin checks.
const INTERNAL_ORIGIN = 'https://mao520.com';
const ALLOWED_OPERATIONS = new Set(['authenticate', 'status']);

export function usesDelegatedIdentity(env = {}) {
  return env.MAO_IDENTITY_MODE === DELEGATED_IDENTITY_MODE;
}

export function assertTrustedIdentityIssuerRequest(request, env = {}) {
  if (env.MAO_IDENTITY_ISSUER_ENABLED !== 'true') {
    throw new ApiError(404, 'IDENTITY_BRIDGE_DISABLED', '统一身份接口未启用');
  }
  const configured = String(env.MAO_IDENTITY_BRIDGE_SECRET || '');
  const supplied = String(request.headers.get(BRIDGE_AUTH_HEADER) || '');
  if (configured.length < 32 || supplied.length < 32) {
    throw new ApiError(503, 'IDENTITY_BRIDGE_UNAVAILABLE', '统一身份认证尚未完成配置');
  }
  // Fixed-time comparison: don't let a public client guess the shared secret.
  // This internal endpoint accepts no browser cookies and issues none.
  return Promise.all([
    sha256Hex('mao-identity-bridge|' + configured),
    sha256Hex('mao-identity-bridge|' + supplied)
  ]).then(([a, b]) => {
    if (!timingSafeEqualHex(a, b)) {
      throw new ApiError(403, 'IDENTITY_BRIDGE_FORBIDDEN', '统一身份服务拒绝请求');
    }
  });
}

export function validateAuthorityAccount(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      typeof raw.id !== 'string' || !ACCOUNT_ID.test(raw.id) ||
      typeof raw.username !== 'string' || !USERNAME.test(raw.username) ||
      !['user', 'super_admin'].includes(raw.role) ||
      raw.status !== 'active' ||
      (raw.role === 'super_admin' && raw.founderNumber !== '001') ||
      (raw.role !== 'super_admin' && raw.founderNumber != null)) {
    throw new ApiError(503, 'IDENTITY_AUTHORITY_INVALID', '统一账号服务返回的身份状态无效');
  }
  return { id: raw.id, username: raw.username, role: raw.role, status: 'active' };
}

/**
 * Existing MAO account Worker adapter. Unlike a new issuer protocol this
 * reuses the already deployed /api/accounts/login and /api/accounts/me.
 * The caller is a Worker Service Binding, never the user's browser.
 *
 * A founder password is forwarded only on explicit login. The authority
 * creates a session; that same opaque session token is mirrored as an
 * HttpOnly host-only Preview cookie. Only the SHA-256 token hash is kept in
 * the preview SQLite. Every protected request is checked with the authority,
 * so revoking/expiring the central session immediately denies the preview.
 */
export const EXISTING_AUTHORITY_MODE = 'existing_worker';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function usesExistingAccountAuthority(env = {}) {
  return usesDelegatedIdentity(env) &&
    env.MAO_IDENTITY_AUTHORITY_MODE === EXISTING_AUTHORITY_MODE;
}

function parseAuthoritySessionCookie(response) {
  const cookie = String(response.headers.get('set-cookie') || '');
  const match = /^MAO_SESSION=([A-Za-z0-9_-]{32,128})(?:;|$)/.exec(cookie);
  if (!match ||
      !/(?:^|;)\s*HttpOnly(?:;|$)/i.test(cookie) ||
      !/(?:^|;)\s*Secure(?:;|$)/i.test(cookie) ||
      !/(?:^|;)\s*SameSite=Lax(?:;|$)/i.test(cookie)) {
    throw new ApiError(503, 'IDENTITY_AUTHORITY_SESSION_INVALID', '原账号服务未签发可信安全会话');
  }
  return match[1];
}

async function callExistingAccountWorker(env, operation, body) {
  const binding = env.MAO_IDENTITY_AUTHORITY;
  if (typeof binding?.fetch !== 'function') {
    throw new ApiError(503, 'IDENTITY_BRIDGE_NOT_READY', '尚未接通唯一 MAO 账号服务');
  }
  if (!['authenticate', 'status', 'logout'].includes(operation)) {
    throw new ApiError(503, 'IDENTITY_BRIDGE_NOT_READY', '不支持的统一身份操作');
  }
  const pathname = operation === 'authenticate' ? '/api/accounts/login' :
    operation === 'status' ? '/api/accounts/me' : '/api/accounts/logout';
  const token = String(body?.sessionToken || '');
  if (operation !== 'authenticate' && !SESSION_TOKEN_RE.test(token)) {
    throw new ApiError(401, 'LOGIN_REQUIRED', '原管理员登录会话无效，请重新登录');
  }
  const headers = operation === 'authenticate'
    ? { 'content-type': 'application/json', origin: INTERNAL_ORIGIN }
    : operation === 'logout'
      ? { authorization: 'Bearer ' + token, origin: INTERNAL_ORIGIN }
      : { authorization: 'Bearer ' + token };
  const request = new Request(INTERNAL_ORIGIN + pathname, {
    method: operation === 'status' ? 'GET' : 'POST',
    headers,
    ...(operation === 'authenticate' ? {
      body: JSON.stringify({
        identifier: String(body?.identifier || '').trim(),
        password: String(body?.password || '')
      })
    } : {})
  });
  let response;
  try {
    response = await binding.fetch(request);
  } catch {
    throw new ApiError(503, 'IDENTITY_AUTHORITY_OFFLINE', '原账号认证服务暂时无法连接');
  }
  let payload;
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.ok !== true) {
    if (response.status === 401) {
      throw new ApiError(401, operation === 'authenticate' ? 'LOGIN_FAILED' : 'LOGIN_REQUIRED',
        operation === 'authenticate' ? '账号或密码不正确' : '原账号登录会话已失效');
    }
    if (response.status === 403 &&
        ['ACCOUNT_DISABLED', 'INVITE_REQUIRED'].includes(payload?.error?.code)) {
      throw new ApiError(403, payload.error.code,
        payload.error.code === 'ACCOUNT_DISABLED' ? '该账号已被停用' : '原账号尚未获得使用授权');
    }
    throw new ApiError(503, 'IDENTITY_AUTHORITY_UNAVAILABLE', '原账号服务未能确认登录状态');
  }
  if (operation === 'logout') return { loggedOut: true };
  const account = validateAuthorityAccount(payload.account);
  if (operation === 'status') {
    if (account.id !== body?.accountId) {
      throw new ApiError(403, 'IDENTITY_AUTHORITY_CHANGED', '唯一账号身份已改变');
    }
    return account;
  }
  const authoritySessionToken = parseAuthoritySessionCookie(response);
  return { ...account, authoritySessionToken };
}

export async function callIdentityAuthority(env, operation, body) {
  if (!usesDelegatedIdentity(env)) {
    throw new ApiError(503, 'IDENTITY_BRIDGE_NOT_READY', '统一身份认证未就绪');
  }
  if (usesExistingAccountAuthority(env)) {
    return callExistingAccountWorker(env, operation, body);
  }
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new ApiError(503, 'IDENTITY_BRIDGE_NOT_READY', '统一身份认证未就绪');
  }
  const secret = String(env.MAO_IDENTITY_BRIDGE_SECRET || '');
  if (secret.length < 32 || typeof env.MAO_IDENTITY_AUTHORITY?.fetch !== 'function') {
    throw new ApiError(503, 'IDENTITY_BRIDGE_NOT_READY', '测试版正在接入统一账号，请勿重新注册或索取邀请码');
  }
  const request = new Request(INTERNAL_ORIGIN + '/api/internal/identity/' + operation, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: INTERNAL_ORIGIN,
      [BRIDGE_AUTH_HEADER]: secret
    },
    body: JSON.stringify(body)
  });
  let response;
  try {
    response = await env.MAO_IDENTITY_AUTHORITY.fetch(request);
  } catch {
    throw new ApiError(503, 'IDENTITY_AUTHORITY_OFFLINE', '统一账号暂时不可用，请稍后重试');
  }
  let payload;
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.ok !== true) {
    if (response.status === 401 && operation === 'authenticate') {
      throw new ApiError(401, 'LOGIN_FAILED', '账号或密码不正确');
    }
    if (response.status === 403 && payload?.error?.code === 'ACCOUNT_DISABLED') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '您的账号已被禁用');
    }
    throw new ApiError(503, 'IDENTITY_AUTHORITY_UNAVAILABLE', '统一账号验证失败，请勿重新注册');
  }
  return validateAuthorityAccount(payload.account);
}

/**
 * Read-only probe of the EXISTING account Worker, without creating a session,
 * supplying credentials, changing a founder, or sharing any account data.
 * A Worker Preview's Service Binding targets the authority's deployed Worker.
 */
export async function probeExistingIdentityAuthority(env) {
  const unavailable = { connected: false, initialized: false, configured: false };
  // The isolated QA core has its own account system and provides a read-only
  // bootstrap status. It does NOT require the retired gateway's bridge secret.
  // Keep this selector after the one-time QA setup flag is disabled.
  const expectedQaFounder = String(env?.MAO_EXPECTED_FOUNDER_ID || '');
  const isolatedQaCore = usesExistingAccountAuthority(env) &&
    env.MAO_QA_AUTHORITY_WORKER === 'maomao-identity-core' &&
    ACCOUNT_ID.test(expectedQaFounder);
  const secret = String(env?.MAO_IDENTITY_BRIDGE_SECRET || '');
  if (!usesDelegatedIdentity(env) ||
      typeof env.MAO_IDENTITY_AUTHORITY?.fetch !== 'function' ||
      (!isolatedQaCore && secret.length < 32)) {
    return unavailable;
  }
  try {
    // The legacy gateway still needs its private header; do not weaken it.
    // The isolated QA core can be probed without copying an old gateway key.
    const headers = isolatedQaCore
      ? { accept: 'application/json' }
      : { accept: 'application/json', [BRIDGE_AUTH_HEADER]: secret };
    const response = await env.MAO_IDENTITY_AUTHORITY.fetch(
      new Request(INTERNAL_ORIGIN + '/api/admin/bootstrap/status', {
        method: 'GET', headers
      })
    );
    if (!response.ok) return unavailable;
    const data = await response.json();
    if (data?.ok !== true ||
        typeof data.initialized !== 'boolean' ||
        typeof data.configured !== 'boolean') {
      return unavailable;
    }
    // Wrong service bindings must never be reported as a ready QA authority.
    if (isolatedQaCore && (
      data.identityMode !== 'local' ||
      data.bootstrapAllowed !== true ||
      data.qaIsolatedAuthority !== true ||
      data.qaExpectedFounderId !== expectedQaFounder
    )) return unavailable;
    return { connected: true, initialized: data.initialized, configured: data.configured };
  } catch {
    return unavailable;
  }
}
