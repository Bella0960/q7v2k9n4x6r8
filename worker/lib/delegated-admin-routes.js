/**
 * Narrow allow-list for delegated, original-authority admin management.
 * These are existing MAO routes, not a second account system.
 * Never proxy bootstrap, social permissions, browser pages or arbitrary URLs.
 */
const ACCOUNT_ID = 'MAO-[A-Z0-9]{12,24}';
const INVITE_ID = '[A-Za-z0-9_-]{16,64}';
const EXTRA_READ = new RegExp('^/api/admin/accounts/' + ACCOUNT_ID + '/(?:detail|active-invite|audit)$');
const ACTION = new RegExp('^/api/admin/accounts/' + ACCOUNT_ID + '/action$');
const REVOKE = new RegExp('^/api/admin/invites/' + INVITE_ID + '/revoke$');

export function isDelegatedAdminManagementRoute(method, path) {
  if (method === 'GET') {
    return path === '/api/admin/accounts' ||
      path === '/api/admin/invites' ||
      path === '/api/admin/audit' ||
      EXTRA_READ.test(path);
  }
  if (method === 'POST') {
    return path === '/api/admin/invites' ||
      ACTION.test(path) ||
      REVOKE.test(path);
  }
  return false;
}
