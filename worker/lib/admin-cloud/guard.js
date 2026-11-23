/**
 * ADMIN-CLOUD-001 — administrator authorization adapter.
 *
 * This module has NO authentication of its own. It reuses the existing MAO
 * account system: the session cookie is validated by
 * createAccountAuth().getAuthenticatedAccount (session expiry, disabled
 * accounts, delegated-identity revalidation, session touch), and access
 * requires an active super_admin — the same rule as account-auth.js
 * requireActiveAdmin.
 *
 * Preferred wiring: account-auth.js exposes requireActiveAdmin (see
 * patches/0002). Until then the fallback below applies the identical check on
 * top of the public getAuthenticatedAccount.
 */

import { ApiError } from '../http.js';

export function createAdminGuard(accountAuth) {
  if (accountAuth && typeof accountAuth.requireActiveAdmin === 'function') {
    return request => accountAuth.requireActiveAdmin(request);
  }
  if (!accountAuth || typeof accountAuth.getAuthenticatedAccount !== 'function') {
    throw new TypeError('createAdminGuard requires the existing account auth instance');
  }
  return async function requireActiveAdmin(request) {
    const account = await accountAuth.getAuthenticatedAccount(request);
    if (!account) {
      throw new ApiError(401, 'ACCOUNT_SESSION_REQUIRED', '请先登录 MAO 账号');
    }
    if (account.status !== 'active' || account.role !== 'super_admin') {
      throw new ApiError(403, 'ADMIN_ONLY', '仅超级管理员可以使用此功能');
    }
    return account;
  };
}
