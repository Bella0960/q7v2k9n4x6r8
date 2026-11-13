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
const INTERNAL_ORIGIN = 'https://mao-identity-bridge.internal';
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

export async function callIdentityAuthority(env, operation, body) {
  if (!usesDelegatedIdentity(env) || !ALLOWED_OPERATIONS.has(operation)) {
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
  if (!usesDelegatedIdentity(env) || typeof env.MAO_IDENTITY_AUTHORITY?.fetch !== 'function') {
    return { connected: false, initialized: false, configured: false };
  }
  try {
    const response = await env.MAO_IDENTITY_AUTHORITY.fetch(
      new Request('https://mao520.com/api/admin/bootstrap/status', {
        method: 'GET', headers: { accept: 'application/json' }
      })
    );
    if (!response.ok) return { connected: false, initialized: false, configured: false };
    const data = await response.json();
    if (data?.ok !== true ||
        typeof data.initialized !== 'boolean' ||
        typeof data.configured !== 'boolean') {
      return { connected: false, initialized: false, configured: false };
    }
    return { connected: true, initialized: data.initialized, configured: data.configured };
  } catch {
    return { connected: false, initialized: false, configured: false };
  }
}
