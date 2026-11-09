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
  const start = adminScript.indexOf('  async function loadAudit(accountId, reset = true) {');
  const end = adminScript.indexOf('\n\n  function closeDetail()', start);
  assert.ok(start >= 0 && end > start, 'audit loader must exist');
  const audit = adminScript.slice(start, end);
  assert.match(audit, /error\.code === 'ACCOUNT_DISABLED'/);
  assert.match(audit, /error\.status === 401 \|\| error\.status === 403 \|\| error\.code === 'ADMIN_ONLY'/);
  assert.match(audit, /'重试读取'/);
  assert.match(audit, /retryButton\.addEventListener\('click', \(\) => loadAudit\(accountId, reset\)\)/);
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
  assert.match(adminScript, /accountDirectoryKey/);
  assert.match(adminScript, /inviteDirectoryKey/);
  assert.match(adminScript, /loadMoreAccounts'\)\.addEventListener/);
  assert.match(adminScript, /loadMoreInvites'\)\.addEventListener/);
  assert.match(adminScript, /accountSummary/);
  assert.doesNotMatch(adminScript, /accounts\.length < 500|invites\.length < 500/);
  assert.match(adminCss, /\.directory-more\[hidden\]\{display:none\}/);
});


test('account detail audit history supports paginated loading and preserves retry behavior', () => {
  assert.match(adminHtml, /id="auditResultCount"/);
  assert.match(adminHtml, /id="loadMoreAudit"[^>]*hidden/);
  assert.ok(adminScript.includes('async function loadAudit(accountId, reset = true)'));
  assert.ok(adminScript.includes('auditLoadedCount'));
  assert.ok(adminScript.includes('result.page?.nextCursor'));
  assert.ok(adminScript.includes('result.page?.totalCount'));
  assert.ok(adminScript.includes("$('loadMoreAudit').addEventListener"));
  assert.ok(adminScript.includes("retryButton.addEventListener('click', () => loadAudit(accountId, reset))"));
  assert.match(adminCss, /\.audit-result-count/);
});


test('账号审计时间线展示邀请码生成与撤销事件，但不显示一次性密钥', () => {
  assert.match(adminScript, /invite_create: '生成专属邀请码'/);
  assert.match(adminScript, /invite_redeem: '用户核销邀请码'/);
  assert.match(adminScript, /invite_revoke: '撤销专属邀请码'/);
  assert.match(adminScript, /record\.action === 'invite_redeem' \? '账号 ' : '管理员 '/);
  assert.match(adminScript, /if \(record\.inviteId\) subline\.push\('邀请码记录 '/);
  assert.match(adminScript, /if \(record\.sourceAction === 'disable'\) subline\.push\('随账号停用自动撤销'/);
  assert.match(adminScript, /if \(record\.sourceAction === 'revoke'\) subline\.push\('随账号永久撤销自动失效'/);
  assert.match(adminScript, /if \(record\.expiresAt\) subline\.push\('到期 '/);
  assert.match(adminScript, /if \(record\.maxUses != null\)/);
  assert.match(adminScript, /仅记录邀请码管理事件，不保存邀请码明文/);
  const start = adminScript.indexOf('      records.forEach(record => {');
  const end = adminScript.indexOf('      auditLoadedCount =', start);
  assert.ok(start >= 0 && end > start, 'audit entries must render from server records');
  const renderer = adminScript.slice(start, end);
  assert.match(renderer, /invite_create/);
  assert.match(renderer, /invite_revoke/);
  assert.doesNotMatch(renderer, /record\.code|record\.tokenHash|record\.token_hash/,
    'one-time invitation secrets must never be rendered from audit data');
});

test('search edits during another admin request are queued instead of silently dropped', () => {
  assert.match(adminScript, /accountSearchRefreshPending/);
  assert.match(adminScript, /inviteSearchRefreshPending/);
  assert.match(adminScript, /const reloadAccounts = accountSearchRefreshPending/);
  assert.match(adminScript, /const reloadInvites = inviteSearchRefreshPending/);
  assert.match(adminScript, /window\.setTimeout\(\(\) => run\(async \(\) =>/);
  assert.match(adminScript, /if \(busy\) \{\s*accountSearchRefreshPending = true/);
  assert.match(adminScript, /if \(busy\) \{\s*inviteSearchRefreshPending = true/);
});

test('账号详情使用服务端权威状态与邀请码快照，查询失败时禁止误操作', () => {
  assert.match(adminScript, /let accountDetailRequestSequence = 0/);
  assert.match(adminScript, /const detailRequestSequence = \+\+accountDetailRequestSequence/);
  assert.match(adminScript, /\/detail/);
  assert.match(adminScript, /const currentAccount = snapshot\?\.account/);
  assert.match(adminScript, /const activeInvite = snapshot\.invite \|\| null/);
  assert.match(adminScript, /暂时无法核对账号状态/);
  assert.match(adminScript, /为避免依据旧状态误发邀请码/);
  assert.match(adminScript, /retryButton\.addEventListener\('click', \(\) => renderAccountDetail\(account\)\)/);
  assert.match(adminScript, /accountDetailRequestSequence \+= 1/);
  assert.doesNotMatch(adminScript, /\/active-invite/,
    '页面不应再把列表缓存状态与第二个邀请码请求拼成详情');

  const start = adminScript.indexOf('  async function renderAccountDetail(account) {');
  const end = adminScript.indexOf('  async function loadAudit(accountId, reset = true) {', start);
  assert.ok(start >= 0 && end > start, 'account detail renderer must exist');
  const detail = adminScript.slice(start, end);
  assert.match(detail, /selectedAccountId !== accountId/);
  assert.match(detail, /detailRequestSequence !== accountDetailRequestSequence/);
  assert.ok(detail.indexOf('/detail') < detail.indexOf('const currentAccount = snapshot?.account'),
    'the server detail snapshot must be read before account state is rendered');
  assert.match(detail, /if \(currentAccount\.status === 'pending_invite'\)[\s\S]*snapshot\.invite/);
  assert.match(detail, /if \(activeInvite\)[\s\S]*撤销当前邀请码[\s\S]*else[\s\S]*生成专属邀请码/);
  assert.match(detail, /if \(currentAccount\.status === 'active'\)/);
  assert.match(detail, /if \(currentAccount\.status === 'disabled'\)/);
  assert.match(detail, /if \(currentAccount\.status === 'revoked'\)/);
  assert.match(detail, /if \(busy\) setButtonsDisabled\(true\);\s*await loadAudit\(currentAccount\.id\)/);
});

test('账号停用、恢复和永久撤销的审计时间线展示状态迁移', () => {
  assert.match(adminScript, /if \(record\.fromStatus && record\.toStatus\)/);
  assert.match(adminScript, /'状态 ' \+ statusText\(record\.fromStatus\) \+ ' → ' \+ statusText\(record\.toStatus\)/);
  assert.match(adminScript, /statusText\(status\)/);
  assert.match(adminScript, /随账号停用自动撤销/);
  assert.match(adminScript, /随账号永久撤销自动失效/);
});

test('普通操作异常也提供重新拉取账号、邀请码和审计状态的恢复入口', () => {
  assert.match(adminScript, /showError\(error\.message \|\| '操作失败，请稍后重试。', \(\) => refreshAll\(\)\)/);
  assert.match(adminScript, /async function refreshAll\(\)/);
  assert.match(adminScript, /await Promise\.all\(\[loadAccountPage\(true\), loadInvitePage\(true\)\]\)/);
  assert.match(adminScript, /if \(selectedAccountId && !\$\('accountDetail'\)\.hidden\)/);
  assert.match(adminScript, /await renderAccountDetail\(account\)/);
});

test('并发状态冲突后自动重新核对账号和邀请码，避免页面保留旧操作入口', () => {
  assert.match(adminScript, /const stateConflictCodes = \[[\s\S]*'ACCOUNT_ACTION_REJECTED'[\s\S]*'INVITE_ALREADY_ACTIVE'[\s\S]*'INVITE_TARGET_NOT_PENDING'[\s\S]*'INVITE_NOT_ACTIVE'/);
  assert.match(adminScript, /if \(stateConflictCodes\.includes\(error\.code\)\) \{[\s\S]*await refreshAll\(\);[\s\S]*showError\(/);
  assert.match(adminScript, /服务器状态已变化，账号和邀请码详情已重新核对/);
  assert.match(adminScript, /自动核对未完成。请重新检查/);
  assert.match(adminScript, /\(\) => refreshAll\(\)/);
});

test('only the latest audit request may update the currently open account detail', () => {
  assert.match(adminScript, /let auditRequestSequence = 0/);
  assert.match(adminScript, /const requestSequence = \+\+auditRequestSequence/);
  assert.match(adminScript, /requestSequence !== auditRequestSequence/);
  assert.match(adminScript, /auditRequestSequence \+= 1/);
});
