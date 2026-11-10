import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const widgetManager = readFileSync(new URL('../desktop/widgets.html', import.meta.url), 'utf8');
const desktopCss = readFileSync(new URL('../desktop/css/styles.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const desktopScript = readFileSync(new URL('../desktop/js/script.js', import.meta.url), 'utf8');

function extractDefaultPages(source) {
  const match = source.match(/function getDefaultLayout\(\)\s*\{[\s\S]*?pages:\s*\[([\s\S]*?)\],\s*dock:/);
  assert.ok(match, 'getDefaultLayout must declare its page distribution');
  return [...match[1].matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]/g)].map((page) =>
    [...page[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  );
}

test('default home has the clock, duo avatars, photo wall and app quadrants in the requested order', () => {
  const pages = extractDefaultPages(index);
  assert.deepEqual(pages[0], [
    'clock-lg',
    'app_inspect', 'app_worldbook', 'app_memory', 'app_forum',
    'duo', 'photowall',
    'app_wallet', 'app_music', 'app_beauty', 'app_theme_store'
  ]);
  assert.equal(pages.length, 3);
  assert.match(index, /v:\s*14,/);
  assert.match(index, /var LS_KEY = 'ds_layout_v14'/);
});

test('obsolete layout keys are cleared and the widget manager uses the current layout key', () => {
  assert.match(index, /key !== 'ds_layout_v14'/);
  assert.doesNotMatch(index, /ds_layout_v13|ds_layout_v12/);
  assert.match(widgetManager, /var LS_KEY = 'ds_layout_v14'/);
  assert.doesNotMatch(widgetManager, /ds_layout_v13|ds_layout_v12/);
});

test('every desktop app is assigned exactly once and dock apps stay in the dock', () => {
  const pages = extractDefaultPages(index);
  const assigned = pages.flat();
  // The creator-only management shortcut is conditional and is not part of
  // any ordinary user's default desktop layout.
  const appIds = [...new Set([...index.matchAll(/data-drag="(app_[^"]+)"/g)].map((m) => m[1]))]
    .filter((id) => id !== 'app_chat' && id !== 'app_shop' && id !== 'app_admin_center');
  assert.equal(new Set(assigned).size, assigned.length, 'default pages must not contain duplicate items');
  assert.deepEqual([...assigned].filter((id) => id.startsWith('app_')).sort(), [...appIds].sort());
  assert.match(index, /dock:\s*\['app_chat',\s*'app_shop'\]/);
  assert.match(index, /data-href="admin\/admin-center\.html" data-drag="app_admin_center"[^>]*hidden/);
  assert.match(index, /roleMeta\.content === 'super_admin'/, 'creator-only shortcut must require the server-injected admin role');

});

test('the mobile home grid keeps four columns and supports vertical page scrolling', () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileCss, /grid-auto-rows:\s*68px\s*!important/);
  assert.match(desktopCss, /#gridPage0 > \[data-drag\]:nth-child\(6\)[^{]*\{ grid-column: 3 \/ 5 !important; grid-row: 3 \/ 5 !important;/);
  assert.match(mobileCss, /#gridPage0 > \[data-drag\]:nth-child\(7\)[^{]*\{ grid-column: 1 \/ 3 !important; grid-row: 5 \/ 7 !important;/);
  assert.match(mobileCss, /\.maomao-home \.home-page[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v216'/);
});


test('all home photo upload slots persist and restore through IndexedDB', () => {
  assert.match(index, /home_widget_upload_v1_/,
    'every photo slot must have a stable widget-scoped storage key');
  assert.match(index, /imageStore\.getByKey\(storageKey\)/,
    'saved photos must be restored from the shared IndexedDB image store');
  assert.match(index, /imageStore\.saveByKey\(storageKey, dataUrl\)/,
    'newly uploaded photos must be persisted before being treated as saved');
  assert.match(index, /function preparePhoto\(file\)/,
    'uploaded photos must be resized before storage');
  assert.doesNotMatch(index, /var avatar = document\.getElementById\('pfAvatar'\)/,
    'the profile avatar must not install a second upload listener');
});

test('all desktop app tiles have valid relative destinations and delegated click navigation', () => {
  const hrefs = [...index.matchAll(/<button\b(?=[^>]*\bapp-tile\b)[^>]*\bdata-href="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
  assert.ok(hrefs.length >= 20, 'expected all desktop app tiles to expose destinations');
  assert.equal(new Set(hrefs).size, hrefs.length, 'app destinations should be unique');
  for (const href of hrefs) {
    assert.doesNotMatch(href, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'app routes must remain same-origin relative paths');
    assert.ok(existsSync(new URL('../' + href, import.meta.url)), 'missing app destination: ' + href);
  }
  assert.match(index, /target\.closest\('\.app-tile\[data-href\]'\)/);
  assert.match(index, /new URL\(href, document\.baseURI\)/);
  assert.match(index, /destination\.origin !== window\.location\.origin/,
    'app navigation must reject cross-origin destinations');
  assert.match(index, /window\.location\.assign\(destination\.href\);\s*\}, true\);/,
    'navigation must run in capture phase before legacy gesture handlers can stop propagation');
  assert.doesNotMatch(desktopScript, /target\.closest\('\[data-href\]'\)/,
    'the legacy bubble-phase handler must not duplicate the capture-phase navigation');
  assert.match(index, /home-editing/);
});

test('creator management shortcut is restored from removed layouts and placed on the visible desktop', () => {
  const blockStart = index.indexOf('(function configureCreatorAdminShortcut()');
  const blockEnd = index.indexOf('})();', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'creator shortcut migration block must exist');
  const block = index.slice(blockStart, blockEnd + 5);
  assert.match(block, /roleMeta\.content === 'super_admin'/,
    'only the server-injected super-admin role may see the shortcut');
  assert.match(block, /tile\.hidden = false/);
  assert.match(block, /currentLayout\.removed = \(currentLayout\.removed \|\| \[\]\)\.filter/,
    'a stale removed entry must not hide the creator shortcut');
  assert.match(block, /var existsOnDesktop = .*currentLayout\.pages[\s\S]*currentLayout\.dock/,
    'only a real page or dock placement counts as visible');
  assert.doesNotMatch(block, /existsOnDesktop[\s\S]{0,180}currentLayout\.removed/,
    'the hidden/removed bucket must not suppress restoration');
  assert.match(block, /splice\(settingsIndex >= 0 \? settingsIndex \+ 1/,
    'the shortcut should be inserted beside Settings when it has no visible placement');
});

test('creator dashboard labels account totals accurately and distinguishes temporary disable from permanent revoke', () => {
  const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');
  assert.match(adminHtml, /<span>普通账号<\/span>/,
    'the directory excludes the super-admin, so the total must not claim to count every account');
  assert.match(adminHtml, /<span>受限账号<\/span>/);
  assert.match(adminScript, /disabled: '临时停用'/);
  assert.match(adminScript, /revoked: '永久撤销'/);
  assert.doesNotMatch(adminCss, /linear-gradient|--green:/,
    'creator dashboard should follow the black/white/gray visual system');
});

test('pending accounts can be suspended and existing unused invitations can be revoked before reissue', () => {
  const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');

  assert.match(adminHtml, /id="accountInviteStatus" hidden/,
    'account detail needs a dedicated current-invitation status region');
  assert.match(adminScript, /const activeInvite = snapshot\\.invite \\|\\| null/,
    'account detail must use the server-authoritative invitation snapshot');
  assert.match(adminScript, /if \\(currentAccount\\.status === 'pending_invite'\\)[\\s\\S]*const activeInvite = snapshot\\.invite/,
    'only pending accounts may display their current active invitation');
  assert.match(adminScript, /if \\(activeInvite\\)[\\s\\S]*撤销当前邀请码[\\s\\S]*\\/api\\/admin\\/invites\\//,
    'the current server-confirmed invitation must be revocable before reissue');
  assert.match(adminScript, /已有有效的专属邀请码/);
  assert.match(adminScript, /原始邀请码只在生成时展示一次/);
  assert.match(adminScript, /accountInviteStatus[\s\S]*revokeButton[\s\S]*\/api\/admin\/invites\//,
    'the existing invitation must be revocable directly from account detail');
  assert.match(adminScript, /createActionButton\('停用账号', 'danger', 'disable', true\);[\s\S]*else if \(account\.status === 'active'\)/,
    'pending_invite and active accounts must both expose temporary disable');
  assert.match(adminCss, /\.invite-status\[hidden\]\{display:none\}/);
  assert.match(adminCss, /\.invite-revoke-button/);
});

test('creator account directory supports email search, status filters, and accurate result counts', () => {
  const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');

  assert.match(adminHtml, /placeholder="搜索永久 ID、用户名或邮箱"/);
  for (const filter of ['all', 'pending_invite', 'active', 'restricted']) {
    assert.match(adminHtml, new RegExp('data-account-filter="' + filter + '"'));
  }
  assert.match(adminHtml, /id="accountResultCount" aria-live="polite"/);
  assert.match(adminScript, /\[account\.id, account\.username, account\.qq_email\]/,
    'search must include the QQ email recorded on the account');
  assert.match(adminScript, /accountFilter === 'restricted'[\s\S]*account\.status === 'disabled'[\s\S]*account\.status === 'revoked'/);
  assert.match(adminScript, /updateAccountFilterCounts\(\)/);
  assert.match(adminScript, /setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  assert.match(adminCss, /\.account-filter-row\{display:flex;gap:6px;overflow-x:auto/);
  assert.match(adminCss, /\.filter-button\.active/);
});

test('creator account detail supports copying permanent IDs and prevents stale audit results from crossing accounts', () => {
  const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');

  assert.match(adminHtml, /id="copyDetailId"/);
  assert.match(adminScript, /navigator\.clipboard\?\.writeText\(value\)/);
  assert.match(adminScript, /range\.selectNodeContents\(\$\('detailId'\)\)/,
    'manual selection must remain possible when clipboard access is unavailable');
  assert.match(adminScript, /const result = await api\('\/api\/admin\/accounts\/'[\s\S]*if \(selectedAccountId !== accountId\) return;[\s\S]*list\.replaceChildren\(\)/,
    'a slower audit response must not replace the currently selected account history');
  assert.match(adminCss, /\.copy-detail-id\{/);
});

test('invitation records can navigate directly to their bound account details', () => {
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');

  assert.match(adminScript, /const targetAccount = invite\.target_account_id[\s\S]*accounts\.find\(account => account\.id === invite\.target_account_id\)/);
  assert.match(adminScript, /el\('button', 'open-detail', '查看账号'\)/);
  assert.match(adminScript, /detailButton\.addEventListener\('click', \(\) => openAccountFromInvite\(targetAccount\.id\)\)/);
  assert.match(adminScript, /function activateTab\(name\)[\s\S]*usersView[\s\S]*invitesView[\s\S]*closeDetail\(\)/);
  assert.match(adminScript, /function openAccountFromInvite\(accountId\)[\s\S]*activateTab\('users'\)[\s\S]*accountFilter = 'all'[\s\S]*\$\('accountSearch'\)\.value = ''[\s\S]*renderAccounts\(\)[\s\S]*openAccount\(accountId\)/);
  assert.match(adminScript, /button\.addEventListener\('click', \(\) => activateTab\(button\.dataset\.tab\)\)/);
});

test('creator invitation directory supports target search and lifecycle-state filters', () => {
  const adminHtml = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
  const adminCss = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');

  assert.match(adminHtml, /id="inviteSearch" type="search"/);
  assert.match(adminHtml, /id="inviteResultCount" aria-live="polite"/);
  for (const state of ['all', 'pending', 'used', 'expired', 'revoked']) {
    assert.match(adminHtml, new RegExp('data-invite-filter="' + state + '"'));
  }
  for (const countId of ['inviteCountAll', 'inviteCountPending', 'inviteCountUsed', 'inviteCountExpired', 'inviteCountRevoked']) {
    assert.match(adminHtml, new RegExp('id="' + countId + '"'));
  }
  assert.match(adminScript, /function inviteState\(invite, timestamp = Date\.now\(\)\)/);
  assert.match(adminScript, /if \(invite\.revoked_at\) return 'revoked'/);
  assert.match(adminScript, /usedCount >= maxUses\) return 'used'[\s\S]*!Number\.isFinite\(expiresAt\) \|\| expiresAt <= timestamp\) return 'expired'/,
    'a redeemed invite must stay in the used state even after its expiry timestamp');
  assert.match(adminScript, /!Number\.isFinite\(expiresAt\) \|\| expiresAt <= timestamp\) return 'expired'/,
    'missing or invalid expiry data must not be treated as a currently valid invitation');
  assert.match(adminScript, /\[invite\.id, invite\.target_account_id, invite\.target_email, invite\.target_username\]/);
  assert.match(adminScript, /inviteFilter === 'all' \|\| inviteState\(invite\) === inviteFilter/);
  assert.match(adminScript, /updateInviteFilterCounts\(\)/);
  assert.match(adminScript, /\$\('inviteSearch'\)\.addEventListener\('input', renderInvites\)/);
  assert.match(adminScript, /data-invite-filter[\s\S]*setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  assert.match(adminScript, /if \(state === 'pending'\)[\s\S]*'撤销'/,
    'only active unused invitations should expose the revoke action');
  assert.match(adminCss, /\.invite-filter-row\{display:flex;gap:6px;overflow-x:auto/);
});

test('creator bootstrap form stays hidden until server initialization status is confirmed', () => {
  const bootstrapHtml = readFileSync(new URL('../account/bootstrap.html', import.meta.url), 'utf8');
  const bootstrapScript = readFileSync(new URL('../account/bootstrap.js', import.meta.url), 'utf8');

  assert.match(bootstrapHtml, /id="bootstrapStatus" role="status" aria-live="polite"/);
  assert.match(bootstrapHtml, /id="retryBootstrapCheck" type="button" hidden/);
  assert.match(bootstrapHtml, /<form id="bootstrapForm" hidden>/);
  assert.match(bootstrapHtml, /\.bootstrap-warning\{[^}]*background:#F7F7F9[^}]*color:#555/);
  assert.doesNotMatch(bootstrapHtml, /<form id="bootstrapForm" novalidate hidden>/,
    'native required, length and email validation must run before submission');
  assert.match(bootstrapHtml, /MAO_SUPER_ADMIN_BOOTSTRAP_SECRET[\s\S]*DEVICE_SECRET_PEPPER/);
  assert.match(bootstrapScript, /error\.code === 'ADMIN_BOOTSTRAP_NOT_CONFIGURED'/);
  assert.match(bootstrapScript, /error\.code === 'INVALID_BOOTSTRAP_SECRET'/);
  assert.match(bootstrapScript, /const statusNode = document\.getElementById\('bootstrapStatus'\)/);
  assert.match(bootstrapScript, /const retryButton = document\.getElementById\('retryBootstrapCheck'\)/);
  assert.match(bootstrapScript, /form\.hidden = true;[\s\S]*statusNode\.hidden = false;[\s\S]*正在确认服务器初始化状态/);
  assert.match(bootstrapScript, /status\.initialized[\s\S]*showInitialized\(\)[\s\S]*statusNode\.hidden = true;[\s\S]*form\.hidden = false/);
  assert.match(bootstrapScript, /暂时无法确认初始化状态[\s\S]*retryButton\.hidden = false/);
  assert.match(bootstrapScript, /retryButton\.addEventListener\('click', checkStatus\)/);
  assert.match(bootstrapScript, /statusCheckInProgress/);
  assert.match(bootstrapScript, /function showInitialized\(\)[\s\S]*form\.hidden = true;[\s\S]*completeNode\.hidden = false/);
});
