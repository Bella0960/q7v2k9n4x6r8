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
