import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');

test('mobile admin uses the native status bar and a compact, functional heading', () => {
  assert.doesNotMatch(html, /class="(?:status-bar|fake-status-bar|mock-status-bar)"/);
  assert.doesNotMatch(html, /09:41|ADMIN ACCESS|FOUNDER · 001|shield-mark/);
  assert.match(html, /<h1>管理中心<\/h1>/);
  assert.match(html, /class="admin-intro" aria-label="授权说明"/);
  assert.ok(css.includes('.admin-shell{width:min(100%,620px);min-height:100svh;margin:0 auto;padding:max(8px,env(safe-area-inset-top))'));
  assert.ok(css.includes('.admin-intro{display:block;padding:0;background:transparent;border:0'));
  assert.ok(css.includes('grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:12px 0 13px'));
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
    '@media(max-width:380px)'
  ]) assert.ok(css.includes(needle), 'missing mobile interaction layout: ' + needle);
  for (const label of ['搜索账号', '搜索邀请码', '搜索审计记录']) {
    assert.ok(html.includes('aria-label="' + label + '"'));
  }
  for (const id of ['accountsList', 'invitesList', 'globalAuditList', 'accountDetail', 'inviteCodeSheet', 'adminConfirmDialog']) {
    assert.ok(html.includes('id="' + id + '"'), 'existing admin functionality must remain: ' + id);
  }
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

test('partial directory failures preserve the other successful mobile list', async () => {
  const begin = source.indexOf('  async function loadAccountPage(reset = false) {');
  const finish = source.indexOf('\n\n  async function openAccount(', begin);
  assert.ok(begin >= 0 && finish > begin, 'directory loaders and refreshAll must be present');
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
        return { accounts: [{ id: 'MAO-AAAAAAAAAAAA' }], page: { totalCount: 1 }, summary: { total: 1 } };
      }
      if (path.startsWith('/api/admin/invites')) {
        return { invites: [{ id: 'TESTINVITE' }], page: { totalCount: 1 }, summary: { total: 1 } };
      }
      throw new Error('unexpected endpoint: ' + path);
    };
    let renderedAccounts = 0;
    let renderedInvites = 0;
    const constructor = new Function(
      '$', 'api', 'directoryPath', 'renderAccounts', 'renderInvites',
      'updateStats', 'updateAccountFilterCounts', 'updateInviteFilterCounts',
      'renderAccountDetail', 'closeDetail', 'setButtonsDisabled',
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
      () => {}, () => {}, () => {}, async () => {}, () => {}, () => {}
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
