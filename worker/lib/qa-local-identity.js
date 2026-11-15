/**
 * Isolated, opt-in QA-only account policy.
 *
 * The existing QA Durable Object retains all its legacy data; this module
 * never reuses delegated production sessions for an isolated test account.
 * Never enable this mode on a production domain or another Worker.
 */
import { ApiError } from './http.js';

export const ISOLATED_QA_IDENTITY_MODE = 'isolated_qa';
export const QA_LOCAL_ID_PREFIX = 'MAO-QA';
const QA_ID_PATTERN = /^MAO-QA[A-Z0-9]{16}$/;
const QA_ORIGIN_PATTERN =
  /^https:\/\/maomao-aw-qa-20261114\.[a-z0-9-]+\.workers\.dev$/;

export function usesIsolatedQaIdentity(env = {}) {
  return env.MAO_IDENTITY_MODE === ISOLATED_QA_IDENTITY_MODE;
}

export function assertIsolatedQaOrigin(request, env = {}) {
  if (!usesIsolatedQaIdentity(env)) return;
  const configuredOrigin = String(env.MAO_QA_ALLOWED_ORIGIN || '');
  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {}
  if (!QA_ORIGIN_PATTERN.test(configuredOrigin) ||
      requestOrigin !== configuredOrigin) {
    throw new ApiError(
      503,
      'QA_ORIGIN_NOT_ISOLATED',
      '独立测试身份只允许从指定的测试小手机访问'
    );
  }
}

export function makeQaLocalId(randomToken) {
  const suffix = randomToken(12).replace(/[-_]/g, 'X').toUpperCase();
  const result = QA_LOCAL_ID_PREFIX + suffix;
  if (!QA_ID_PATTERN.test(result)) {
    throw new Error('QA local ID generation failed');
  }
  return result;
}

export function isQaLocalAccount(account) {
  return Boolean(account &&
    account.role === 'user' &&
    QA_ID_PATTERN.test(String(account.account_id || account.id || '')));
}
