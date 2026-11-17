import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('mobile admin uses the native status bar and a compact, functional heading', () => {
  assert.doesNotMatch(html, /class="(?:status-bar|fake-status-bar|mock-status-bar)"/);
  assert.doesNotMatch(html, /09:41|ADMIN ACCESS|FOUNDER · 001|shield-mark/);
  assert.match(html, /<h1>管理中心<\/h1>/);
  assert.match(html, /class="admin-intro" aria-label="授权说明"/);
  assert.ok(css.includes('.admin-shell{width:min(100%,620px);min-height:100svh;margin:0 auto;padding:max(8px,env(safe-area-inset-top))'));
  assert.ok(css.includes('.admin-intro{display:block;padding:0;background:transparent;border:0'));
  assert.ok(css.includes('grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:12px 0 13px'));
});

test('admin script and CSS versions match the current PWA cache, not the old mobile shell', () => {
  const version = '20261117-ui1';
  assert.ok(html.includes('./admin-center.css?v=' + version));
  assert.ok(html.includes('./admin-center.js?v=' + version));
  assert.ok(sw.includes("'./admin/admin-center.css?v=" + version + "'"));
  assert.ok(sw.includes("'./admin/admin-center.js?v=" + version + "'"));
  assert.match(sw, /const CACHE_NAME = 'phone-app-pwa-v240'/);
  assert.doesNotMatch(html, /20261112-nav2/);
});

test('375-430px mobile layout keeps accessible input and action targets', () => {
  for (const needle of [
    '.tab-button{position:relative;flex:0 0 auto;min-height:44px',
    '.refresh-button{min-height:42px',
    '.filter-button{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-height:40px',
    '.open-detail{min-height:40px',
    '.close-detail{width:42px;height:42px',
    '.error-retry,.audit-retry{min-height:40px',
    '.search-box{min-height:44px',
    '.invite-revoke-button{justify-self:start;min-height:42px',
    '.copy-detail-id{flex:0 0 auto;min-height:40px',
    '.audit-open-account{justify-self:start;min-height:40px',
    '@media(max-width:620px){.search-box input,.admin-confirm-reason textarea{font-size:16px}',
    '@media(max-width:380px)'
  ]) assert.ok(css.includes(needle), 'missing mobile interaction layout: ' + needle);
  for (const label of ['搜索账号', '搜索邀请码', '搜索审计记录']) {
    assert.ok(html.includes('aria-label="' + label + '"'));
  }
  for (const id of ['accountsList', 'invitesList', 'globalAuditList', 'accountDetail', 'inviteCodeSheet', 'adminConfirmDialog']) {
    assert.ok(html.includes('id="' + id + '"'), 'existing admin functionality must remain: ' + id);
  }
});

test('failed account or invitation request displays an error instead of a false empty directory', () => {
  assert.match(source, /if \(accountPageError\) \{[\s\S]*'账号暂时无法读取'/);
  assert.match(source, /if \(invitePageError\) \{[\s\S]*'邀请码暂时无法读取'/);
  assert.ok(source.includes("账号读取失败，请点击右上角的刷新重新检查"));
  assert.ok(source.includes("邀请码读取失败，请点击右上角的刷新重新检查"));
  assert.ok(source.includes("await Promise.allSettled([loadAccountPage(true), loadInvitePage(true)])"));
  assert.ok(source.includes("const failed = checks.find(result => result.status === 'rejected')"));
  assert.ok(source.includes("sessionVerified = true;"));
  assert.ok(source.includes("暂时无法确认管理员身份，请重试"));
});

test('filter taps during an active fetch queue a refresh instead of silently failing', () => {
  const controls = [
    ["document.querySelectorAll('[data-audit-filter]').forEach(button => {",
      "document.querySelectorAll('[data-audit-range]').forEach(button => {",
      'globalAuditSearchRefreshPending'],
    ["document.querySelectorAll('[data-audit-range]').forEach(button => {",
      "$('refreshGlobalAudit').addEventListener",
      'globalAuditSearchRefreshPending'],
    ["document.querySelectorAll('[data-account-filter]').forEach(button => {",
      "document.querySelectorAll('[data-invite-filter]').forEach(button => {",
      'accountSearchRefreshPending'],
    ["document.querySelectorAll('[data-invite-filter]').forEach(button => {",
      '  function activateTab(name)',
      'inviteSearchRefreshPending']
  ];
  for (const [begin, finish, pendingFlag] of controls) {
    const start = source.indexOf(begin);
    const end = source.indexOf(finish, start + begin.length);
    assert.ok(start >= 0 && end > start, 'filter handler must exist: ' + begin);
    const handler = source.slice(start, end);
    assert.ok(handler.includes('if (busy) {'));
    assert.ok(handler.includes(pendingFlag + ' = true;'));
    assert.ok(handler.includes('return;'));
  }
  assert.match(source, /const reloadAccounts = accountSearchRefreshPending/);
  assert.match(source, /const reloadInvites = inviteSearchRefreshPending/);
  assert.match(source, /const reloadAudit = globalAuditSearchRefreshPending/);
});

test('a destructive account confirmation always targets its originally selected account', async () => {
  const start = source.indexOf('  function createActionButton(');
  const end = source.indexOf('\n\n  async function renderAccountDetail(', start);
  assert.ok(start >= 0 && end > start, 'existing account action function found');
  const writes = [];
  const buttons = [];
  let confirmation = null;
  const node = (tag, className, text) => ({
    tag, className, text,
    addEventListener(type, cb) { if (type === 'click') this.click = cb; }
  });
  const factory = new Function('el', '$', 'openAdminConfirmation', 'api', 'refreshAll', 'initialId',
    "let selectedAccountId = initialId;\n" + source.slice(start, end) +
    "\nreturn { createActionButton, select: id => { selectedAccountId = id; } };");
  const ui = factory(
    node,
    id => id === 'detailActions' ? { appendChild(button) { buttons.push(button); } } : null,
    value => { confirmation = value; return true; },
    async (path, method, body) => { writes.push({ path, method, body }); return { ok: true }; },
    async () => {},
    'MAO-AAAAAAAAAAAA'
  );
  ui.createActionButton('停用账号', 'danger', 'disable', true);
  buttons[0].click();
  const pending = confirmation;
  assert.match(pending.description, /MAO-AAAAAAAAAAAA/);
  ui.select('MAO-BBBBBBBBBBBB');
  await assert.rejects(pending.onConfirm('reason'), /账号已变化，操作已取消/);
  assert.equal(writes.length, 0);
  confirmation = null;
  buttons[0].click();
  assert.equal(confirmation, null, 'stale account button must be ignored');
  ui.createActionButton('停用账号', 'danger', 'disable', true);
  buttons[1].click();
  assert.match(confirmation.description, /MAO-BBBBBBBBBBBB/);
  await confirmation.onConfirm('confirmed');
  assert.deepEqual(writes, [{
    path: '/api/admin/accounts/MAO-BBBBBBBBBBBB/action',
    method: 'POST',
    body: { action: 'disable', reason: 'confirmed' }
  }]);
});

test('HTTP success without complete directory data never looks like an empty account list', () => {
  const begin = source.indexOf('  function verifiedDirectoryPayload(payload, key) {');
  const finish = source.indexOf('\n\n  function formatTime(', begin);
  assert.ok(begin >= 0 && finish > begin);
  const verify = new Function(source.slice(begin, finish) + '\nreturn verifiedDirectoryPayload;')();
  const valid = { accounts: [{ id: 'MAO-AAAAAAAAAAAA' }],
    page: { totalCount: 1, hasMore: false, nextCursor: null } };
  assert.equal(verify(valid, 'accounts'), valid);
  for (const payload of [
    { page: valid.page },
    { accounts: [], page: null },
    { accounts: [null], page: valid.page },
    { accounts: [{ id: 'MAO-AAAAAAAAAAAA' }], page: { totalCount: 0 } },
    { accounts: [], page: { totalCount: 0, hasMore: true, nextCursor: null } }
  ]) {
    assert.throws(() => verify(payload, 'accounts'), /记录不完整/);
  }
  assert.throws(() => verify({ invites: [], page: { totalCount: -1, hasMore: false } }, 'invites'), /记录不完整/);
  assert.throws(() => verify({ records: [], page: { totalCount: 0, hasMore: 'false' } }, 'records'), /记录不完整/);
});

test('partial directory failures preserve the other successful mobile list', async () => {
  const begin = source.indexOf('  async function loadAccountPage(reset = false) {');
  const finish = source.indexOf('\n\n  async function openAccount(', begin);
  assert.ok(begin >= 0 && finish > begin, 'directory loaders and refreshAll must be present');
  const verifierBegin = source.indexOf('  function verifiedDirectoryPayload(payload, key) {');
  const verifierEnd = source.indexOf('\n\n  function formatTime(', verifierBegin);
  assert.ok(verifierBegin >= 0 && verifierEnd > verifierBegin);
  const verifiedDirectoryPayload = new Function(
    source.slice(verifierBegin, verifierEnd) + '\nreturn verifiedDirectoryPayload;'
  )();
  const states = [
    { failure: 'accounts', expectAccounts: 0, expectInvites: 1 },
    { failure: 'invites', expectAccounts: 1, expectInvites: 0 },
    { failure: '', expectAccounts: 1, expectInvites: 1 }
  ];
  for (const scenario of states) {
    const dom = new Map();
    const get = id => {
      if (!dom.has(id)) dom.set(id, { value: '', textContent: '', hidden: false });
      return dom.get(id);
    };
    const directoryApi = async path => {
      if (scenario.failure === 'accounts' && path.startsWith('/api/admin/accounts')) {
        throw new Error('accounts offline');
      }
      if (scenario.failure === 'invites' && path.startsWith('/api/admin/invites')) {
        throw new Error('invites offline');
      }
      if (path.startsWith('/api/admin/accounts')) {
        return { accounts: [{ id: 'MAO-AAAAAAAAAAAA' }], page: { totalCount: 1, hasMore: false }, summary: { total: 1 } };
      }
      if (path.startsWith('/api/admin/invites')) {
        return { invites: [{ id: 'TESTINVITE' }], page: { totalCount: 1, hasMore: false }, summary: { total: 1 } };
      }
      throw new Error('unexpected endpoint: ' + path);
    };
    let renderedAccounts = 0;
    let renderedInvites = 0;
    const constructor = new Function(
      '$', 'api', 'directoryPath', 'renderAccounts', 'renderInvites',
      'updateStats', 'updateAccountFilterCounts', 'updateInviteFilterCounts',
      'renderAccountDetail', 'closeDetail', 'setButtonsDisabled', 'verifiedDirectoryPayload',
      "let accountDirectoryKey='',accountNextCursor='',accountFilter='all',accountHasMore=false," +
      "accountTotalCount=0,accountSummary=null,accountPageError=false,accounts=[]," +
      "inviteDirectoryKey='',inviteNextCursor='',inviteFilter='all',inviteHasMore=false," +
      "inviteTotalCount=0,inviteSummary=null,invitePageError=false,invites=[]," +
      "selectedAccountId='',busy=false;\n" +
      source.slice(begin, finish) +
      "\nreturn {refreshAll, state:()=>({accountPageError,invitePageError,accounts,invites})};"
    );
    const app = constructor(
      get, directoryApi, path => path,
      () => { renderedAccounts++; }, () => { renderedInvites++; },
      () => {}, () => {}, () => {}, async () => {}, () => {}, () => {}, verifiedDirectoryPayload
    );
    if (scenario.failure) {
      await assert.rejects(() => app.refreshAll(), /offline/);
    } else {
      await app.refreshAll();
    }
    const state = app.state();
    assert.equal(state.accounts.length, scenario.expectAccounts, 'account result preserved independently');
    assert.equal(state.invites.length, scenario.expectInvites, 'invite result preserved independently');
    assert.equal(state.accountPageError, scenario.failure === 'accounts');
    assert.equal(state.invitePageError, scenario.failure === 'invites');
    assert.ok(renderedAccounts >= 1 && renderedInvites >= 1, 'both directories settle and render');
    if (scenario.failure === 'accounts') {
      assert.equal(get('statTotal').textContent, '—', 'an outage must not pretend no accounts exist');
    }
    if (scenario.failure === 'invites') {
      assert.equal(get('inviteCountAll').textContent, '—', 'an outage must not pretend no invitations exist');
    }
  }
});

test('failed retries show updated errors instead of an unhandled rejection', async () => {
  const begin = source.indexOf('  function showError(message, retry) {');
  const finish = source.indexOf('\n\n  function hideError()', begin);
  assert.ok(begin >= 0 && finish > begin, 'existing retry display is available');
  let errorPanel = null;
  const element = (tag, className, text) => ({
    tag, className, textContent: text, children: [], isConnected: true, disabled: false,
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, listener) { if (type === 'click') this.click = listener; }
  });
  const create = new Function('document', 'el', '$', 'setButtonsDisabled', 'busy',
    source.slice(begin, finish) + '\nreturn showError;');
  const showError = create(
    {
      querySelector: () => ({ after(node) { errorPanel = node; } })
    },
    element,
    id => id === 'adminError' ? errorPanel : null,
    () => {},
    false
  );
  showError('首次错误', async () => { throw new Error('连接尚未恢复'); });
  assert.equal(errorPanel.children[0].textContent, '首次错误');
  await errorPanel.children[1].click();
  assert.equal(errorPanel.children[0].textContent, '连接尚未恢复');
  assert.equal(errorPanel.children[1].textContent, '重新检查');
});
