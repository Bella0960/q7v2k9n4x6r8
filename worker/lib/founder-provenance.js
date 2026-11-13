/**
 * Canonical founder provenance guard for MAO account + social Workers.
 *
 * Enable only after selecting the user's original Durable Object namespace.
 * This checks the actual account row, not the "001" display badge or username.
 * The expected ID belongs in a per-environment Worker variable/secret, never
 * a shared frontend bundle; it does NOT copy accounts or modify any SQL row.
 */
import { ApiError } from './http.js';

const MAO_ID = /^MAO-[A-Z0-9]{12,24}$/;

export function assertCanonicalFounderStore(store, env = {}) {
  const configured = env.MAO_CANONICAL_FOUNDER_ID;
  const required = env.MAO_CANONICAL_FOUNDER_REQUIRED === 'true';
  if ((configured === undefined || configured === null || configured === '') && !required) {
    return; // Existing unrelated deployments have no migration behavior change.
  }

  const expected = typeof configured === 'string' ? configured : '';
  if (!MAO_ID.test(expected)) {
    throw new ApiError(503, 'CANONICAL_FOUNDER_NOT_CONFIGURED',
      '唯一管理员身份未完成安全绑定，已暂停账号和聊天接口');
  }
  // A delegated preview has its own empty/mirrored database, never the
  // owner's original authority; do not silently treat it as a canonical DB.
  if (env.MAO_IDENTITY_MODE === 'delegated_preview') {
    throw new ApiError(503, 'CANONICAL_FOUNDER_WRONG_MODE',
      '当前测试环境未连接原始管理员数据库，已阻止错误账号接入');
  }

  const account = store.getMaoAccountById(expected);
  if (!account || account.role !== 'super_admin' || account.status !== 'active') {
    throw new ApiError(503, 'CANONICAL_FOUNDER_MISMATCH',
      '当前数据库不属于已确认的唯一 001 管理员，已保护原账号数据');
  }
}
