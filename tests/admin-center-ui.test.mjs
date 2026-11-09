import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');

test('temporary session or API failures do not masquerade as a missing super-admin session', () => {
  const start = adminScript.indexOf('  async function init() {');
  const end = adminScript.indexOf('\n\n  init();', start);
  assert.ok(start >= 0 && end > start, 'admin initialization function must exist');
  const init = adminScript.slice(start, end);

  assert.match(init, /if \(initializing\) return/);
  assert.match(init, /if \(!me\.account \|\| me\.account\.role !== 'super_admin' \|\| me\.account\.status !== 'active'\)/,
    'a confirmed non-admin account must still leave the creator-only page');
  assert.match(init, /error\.status === 401 \|\| error\.status === 403 \|\| error\.code === 'ADMIN_ONLY'/,
    'only confirmed authentication/authorization errors should redirect');
  assert.match(init, /showError\([\s\S]*\(\) => init\(\)/,
    'transient failures must keep the page open and offer a retry');
  assert.match(adminScript, /function showError\(message, retry\)/);
  assert.match(adminScript, /'重新检查'/);
});

test('admin actions lock existing and newly rendered buttons without erasing their original disabled state', () => {
  assert.match(adminScript, /const busyButtonState = new WeakMap\(\)/);
  assert.match(adminScript, /function setButtonsDisabled\(disabled\)/);
  assert.match(adminScript, /if \(!busyButtonState\.has\(button\)\) busyButtonState\.set\(button, button\.disabled\)/);
  assert.match(adminScript, /button\.disabled = busyButtonState\.get\(button\)/);
  assert.match(adminScript, /finally \{\s*busy = false;\s*setButtonsDisabled\(false\);/);
  assert.ok((adminScript.match(/if \(busy\) setButtonsDisabled\(true\);/g) || []).length >= 3,
    'buttons created by list/detail re-rendering must remain locked until the operation completes');
});

test('audit request failures offer a retry but authentication failures leave the protected page', () => {
  const start = adminScript.indexOf('  async function loadAudit(accountId) {');
  const end = adminScript.indexOf('\n\n  function closeDetail()', start);
  assert.ok(start >= 0 && end > start, 'audit loader must exist');
  const audit = adminScript.slice(start, end);
  assert.match(audit, /error\.code === 'ACCOUNT_DISABLED'/);
  assert.match(audit, /error\.status === 401 \|\| error\.status === 403 \|\| error\.code === 'ADMIN_ONLY'/);
  assert.match(audit, /'重试读取'/);
  assert.match(audit, /retryButton\.addEventListener\('click', \(\) => loadAudit\(accountId\)\)/);
});

test('new one-time invitation codes are scrolled into view before a follow-up refresh can fail', () => {
  assert.match(adminHtml, /id="inviteCodeSheet" hidden/);
  const reveal = adminScript.indexOf("$('inviteCodeSheet').hidden = false;");
  const scroll = adminScript.indexOf("$('inviteCodeSheet').scrollIntoView", reveal);
  const refresh = adminScript.indexOf('await refreshAll();', reveal);
  assert.ok(reveal >= 0 && scroll > reveal && refresh > scroll,
    'the code must be visible on a phone even if the subsequent directory refresh fails');
  assert.match(adminCss, /\.generated-code[\s\S]*user-select:all/);
});

test('retry controls remain touchable and readable at narrow phone widths', () => {
  assert.match(adminCss, /\.page-error\{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap/);
  assert.match(adminCss, /\.error-retry,.audit-retry\{min-height:32px/);
  assert.match(adminCss, /@media\(max-width:380px\)/);
});

test('account and invitation directories use server-side cursor pagination', () => {
  assert.match(adminHtml, /id="accountLimitNotice" hidden/);
  assert.match(adminHtml, /id="inviteLimitNotice" hidden/);
  assert.match(adminHtml, /id="loadMoreAccounts"[^>]*hidden/);
  assert.match(adminHtml, /id="loadMoreInvites"[^>]*hidden/);
  assert.match(adminScript, /function loadAccountPage\(reset = false\)/);
  assert.match(adminScript, /function loadInvitePage\(reset = false\)/);
  assert.match(adminScript, /page\?\.nextCursor/);
  assert.match(adminScript, /page\?\.totalCount/);
  assert.match(adminScript, /URLSearchParams/);
  assert.match(adminScript, /loadMoreAccounts'\)\.addEventListener/);
  assert.match(adminScript, /loadMoreInvites'\)\.addEventListener/);
  assert.match(adminScript, /accountSummary/);
  assert.doesNotMatch(adminScript, /accounts\.length < 500|invites\.length < 500/);
  assert.match(adminCss, /\.directory-more\[hidden\]\{display:none\}/);
});
