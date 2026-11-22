/**
 * Opt-in, one-time QA identity authority setup. Existing production and normal
 * delegated account routes are unchanged. No production identity or password
 * hash is copied into an isolated QA account store.
 *
 * The caller must separately audit the actual Cloudflare service binding:
 * environment variables cannot prove the binding's real target.
 */
import { ApiError, ok, readJsonBody } from './http.js';

const ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;
const AUTHORITY_WORKER = 'maomao-identity-core';
const INTERNAL_ORIGIN = 'https://mao520.com';
const QA_SETUP_MODE = 'isolated_authority';

export function qaIsolatedSetupEnabled(env = {}) {
  return env.MAO_IDENTITY_MODE === 'delegated_preview' &&
    env.MAO_IDENTITY_AUTHORITY_MODE === 'existing_worker' &&
    env.MAO_QA_IDENTITY_SETUP === QA_SETUP_MODE &&
    env.MAO_QA_AUTHORITY_WORKER === AUTHORITY_WORKER &&
    ACCOUNT_ID.test(String(env.MAO_EXPECTED_FOUNDER_ID || '')) &&
    typeof env.MAO_IDENTITY_AUTHORITY?.fetch === 'function';
}

export function isolatedQaAuthorityFounderId(env = {}) {
  if (env.MAO_QA_ISOLATED_IDENTITY_CORE !== 'true' ||
      env.MAO_IDENTITY_MODE === 'delegated_preview' ||
      !ACCOUNT_ID.test(String(env.MAO_QA_FOUNDER_ID || ''))) return null;
  return String(env.MAO_QA_FOUNDER_ID);
}

export function resolveQaAuthorityFounderId(env = {}, makeRandomId) {
  const fixed = env.MAO_QA_FOUNDER_ID;
  const flag = env.MAO_QA_ISOLATED_IDENTITY_CORE;
  if (fixed == null && flag == null) return makeRandomId();
  if (flag !== 'true' || !ACCOUNT_ID.test(String(fixed || '')) ||
      env.MAO_IDENTITY_MODE === 'delegated_preview') {
    throw new ApiError(403, 'QA_FOUNDER_ID_CONFIG_DENIED',
      '独立 QA 管理员身份未通过安全配置核对');
  }
  return String(fixed);
}

export async function initializeIsolatedQaAuthority({ env = {}, store, request }) {
  if (!qaIsolatedSetupEnabled(env)) {
    throw new ApiError(403, 'QA_SETUP_DISABLED', 'QA 独立身份初始化尚未启用');
  }
  // Never accept a QA credential setup request on either production hostname.
  // The unique existing QA workers.dev origin is the only allowed browser entry.
  if (new URL(request.url).hostname !==
      'maomao-aw-qa-20261114.miamor520000.workers.dev') {
    throw new ApiError(403, 'QA_SETUP_WRONG_ORIGIN',
      'QA 初始化必须通过唯一隔离测试入口执行');
  }
  const expectedId = String(env.MAO_EXPECTED_FOUNDER_ID);
  const shadow = store.getMaoAccountById(expectedId);
  if (!shadow || shadow.id !== expectedId || shadow.role !== 'super_admin' ||
      shadow.status !== 'active' || typeof shadow.username !== 'string' || !shadow.username) {
    throw new ApiError(409, 'QA_SHADOW_IDENTITY_MISMATCH',
      'QA 现有管理员身份不匹配，已停止初始化，原有数据保持不变');
  }
  const body = await readJsonBody(request);
  const submittedIdentity = String(body.username || '').trim();
  const secret = String(body.bootstrapSecret || '');
  const password = String(body.password || '');
  // The owner may know only the permanent founder ID. Accept it as the
  // lookup alias, but ALWAYS create the isolated core's founder using the
  // existing QA shadow username: no rename, new founder, or account migration.
  if (submittedIdentity !== shadow.username && submittedIdentity !== expectedId) {
    throw new ApiError(409, 'QA_SHADOW_USERNAME_MISMATCH',
      '请输入 QA 原管理员用户名或永久 ID，不会创建第二个管理员');
  }
  const username = shadow.username;
  if (secret.length < 32 || password.length < 10 || password.length > 128 ||
      body.confirmPassword !== password) {
    throw new ApiError(400, 'QA_SETUP_CREDENTIALS_INVALID', 'QA 初始化资料不完整');
  }
  const authority = env.MAO_IDENTITY_AUTHORITY;
  let preflight;
  try {
    preflight = await authority.fetch(new Request(INTERNAL_ORIGIN + '/api/admin/bootstrap/status', {
      method: 'GET', headers: { accept: 'application/json' }
    }));
  } catch {
    throw new ApiError(503, 'QA_AUTHORITY_OFFLINE', '独立 QA 身份服务无法连接');
  }
  let status;
  try { status = await preflight.json(); } catch {}
  if (!preflight.ok || status?.ok !== true || status.identityMode !== 'local' ||
      status.bootstrapAllowed !== true || status.configured !== true ||
      status.initialized !== false || status.qaIsolatedAuthority !== true ||
      status.qaExpectedFounderId !== expectedId) {
    throw new ApiError(409, 'QA_AUTHORITY_NOT_EMPTY_OR_NOT_READY',
      '独立 QA 身份库未通过空库和安全配置校验，已阻止初始化');
  }
  // Isolated QA bootstrap returns only the founder identity: it creates no
  // extra authority session and never exposes a cookie to the QA browser.
  // The owner explicitly logs in with QA-only credentials afterward.
  let response;
  try {
    response = await authority.fetch(new Request(INTERNAL_ORIGIN + '/api/admin/bootstrap', {
      method: 'POST',
      headers: { origin: INTERNAL_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ bootstrapSecret: secret, username, password,
        confirmPassword: password, qqEmail: '' })
    }));
  } catch {
    throw new ApiError(503, 'QA_AUTHORITY_SETUP_UNCONFIRMED',
      'QA 初始化请求结果未确认，请只读核对身份库后再操作');
  }
  let result;
  try { result = await response.json(); } catch {}
  if (!response.ok || result?.ok !== true) {
    throw new ApiError(503, 'QA_AUTHORITY_SETUP_UNCONFIRMED',
      'QA 身份初始化未得到有效成功回执，请检查服务状态，不要反复提交');
  }
  const created = result.account;
  if (created?.id !== expectedId || created?.role !== 'super_admin' ||
      created?.status !== 'active' || created?.username !== username ||
      created?.founderNumber !== '001') {
    throw new ApiError(409, 'QA_AUTHORITY_IDENTITY_MISMATCH',
      '新 QA 身份与原管理员标识不匹配，已阻止承认完成');
  }
  // A successful bootstrap must never expose the authority's session token or
  // Set-Cookie to the QA browser. The next step is an explicit QA-only login.
  return ok({ account: { id: expectedId, username,
    role: 'super_admin', status: 'active', founderNumber: '001' },
    qaSetupComplete: true, nextStep: 'qa_login' });
}
