import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../admin/admin-center-editorial.css', import.meta.url), 'utf8');
const core = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('all five administration areas and transactional dialogs survive the visual redesign', () => {
  for (const id of [
    'statTotal', 'statPending', 'statActive', 'statDisabled',
    'overviewView', 'usersView', 'invitesView', 'auditView', 'settingsView',
    'accountSearch', 'inviteSearch', 'globalAuditSearch',
    'accountsList', 'invitesList', 'globalAuditList',
    'accountDetail', 'inviteCodeSheet', 'adminConfirmDialog',
    'adminConfirmSubmit', 'adminConfirmCancel', 'detailActions'
  ]) assert.match(html, new RegExp('\\bid="' + id + '"'), 'Missing UI hook ' + id);
  for (const tab of ['overview', 'users', 'invites', 'audit', 'settings']) {
    assert.ok(html.includes('data-tab="' + tab + '"'), 'Missing active area ' + tab);
  }
  assert.match(html, /<dialog id="adminConfirmDialog"/);
  assert.match(core, /dialog\.showModal\(\)/);
  assert.match(core, /if \(selectedAccountId !== targetAccountId\)/);
});

test('admin screen keeps account IDs real but never uses the project signature as visible decoration', () => {
  assert.doesNotMatch(html, /MAO|MAO\s*·/);
  assert.ok(html.includes('<h1>管理中心</h1>'));
  assert.ok(html.includes('CONTROL PANEL / 01'));
  assert.ok(html.includes('admin-center-editorial.css?v=20261123-v1'));
  assert.ok(html.includes('admin-workspace.css?v=20261123-v1'));
  assert.ok(!/background\s*:\s*[^;]*gradient\(/i.test(layout));
  for (const token of ['--ink:', '--muted:', '--paper:', '--wash:', '--editorial-serif:']) {
    assert.ok(layout.includes(token), 'Missing design token: ' + token);
  }
});

test('editorial screen has responsive composition and keyboard-safe inputs', () => {
  for (const selector of [
    '.admin-header', '.admin-intro', '.stats-grid', '.admin-tabs',
    '.view-heading', '.search-box', '.filter-button',
    '.records-card', '.policy-list', '.page-error', '.admin-confirm-dialog'
  ]) assert.ok(layout.includes(selector), 'Missing UI treatment: ' + selector);
  assert.match(layout, /@media \(max-width:620px\)/);
  assert.match(layout, /@media \(max-width:380px\)/);
  assert.match(layout, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(layout, /\.search-box input,\.admin-confirm-reason textarea\{font-size:16px\}/);
});

test('missing context shows a useful explanation without guessing or persisting another account ID', () => {
  const start = core.indexOf('  function showError(message, retry) {');
  const end = core.indexOf('\n\n  function hideError()', start);
  assert.ok(start >= 0 && end > start);
  const handler = core.slice(start, end);
  assert.ok(handler.includes('/账号上下文|服务器注入/'));
  assert.ok(handler.includes('返回桌面'));
  assert.ok(handler.includes("window.location.assign('/index.html')"));
  assert.ok(handler.includes('await retry()'));
  assert.doesNotMatch(handler.replace(/\/\/[^\n]*/g, ''), /localStorage|sessionStorage|document\.cookie/);
  assert.match(core, /headers\.set\('x-mao-account-context', accountId\)/);
  assert.match(core, /if \(scopedId && metaId && scopedId !== metaId\)/);
});

test('admin documents and scripts are not intercepted or precached by the common PWA service worker', () => {
  assert.ok(sw.includes("if (url.pathname.startsWith('/admin/')) return;"));
  assert.ok(!sw.includes("'./admin/admin-center.js?"));
  assert.ok(!sw.includes("'./admin/admin-center.css?"));
  assert.ok(!sw.includes("'./admin/admin-center-editorial.css?"));
  const cacheVersion = Number((sw.match(/const CACHE_NAME = 'phone-app-pwa-v(\d+)'/) || [])[1]);
  assert.ok(Number.isInteger(cacheVersion) && cacheVersion >= 307, 'latest desktop wallpaper PWA cache must not be rolled back');
  assert.ok(html.includes('./admin-center.js?v=20261123-workspace1'));
});
