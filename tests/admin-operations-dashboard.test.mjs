import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../admin/admin-operations.css', import.meta.url), 'utf8');
test('five admin areas coexist with original account, invitation, audit and policy UI', () => {
  for (const tab of ['overview','users','invites','audit','settings'])
    assert.ok(html.includes('data-tab="' + tab + '"'));
  for (const id of ['overviewView','usersView','invitesView','auditView','settingsView',
    'statTotal','statPending','statActive','statDisabled','accountDetail',
    'adminConfirmDialog','overviewHeadline','overviewCloudStatus',
    'overviewCloudRetry','refreshOverview'])
    assert.ok(html.includes('id="' + id + '"'), 'missing ' + id);
  assert.match(html,/id="overviewView"[^>]*>/);
  assert.match(html,/id="usersView" hidden/);
});
test('dashboard shortcuts are wired without bypassing existing account actions', () => {
  assert.match(js,/querySelectorAll\('\[data-quick-tab\]'\)/);
  assert.match(js,/activateTab\(tab\)/);
  assert.match(js,/loadAccountPage\(true\)/);
  assert.match(js,/loadGlobalAudit\(true\)/);
  assert.match(js,/openAdminConfirmation\(/);
  assert.match(js,/verifiedDirectoryPayload\(/);
  assert.match(js,/if \(selectedAccountId !== targetAccountId\)/);
});
test('cloud status never uses a write method or trusted storage shortcuts', () => {
  const start = js.indexOf('  async function refreshCloudOverview() {');
  const end = js.indexOf('  function updateStats() {', start);
  assert.ok(start > 0 && end > start);
  const code = js.slice(start, end);
  assert.match(code, /await api\('\/api\/admin\/cloud\/overview'\)/);
  assert.doesNotMatch(code, /method:\s*'POST'|method:\s*'PATCH'|localStorage\.|sessionStorage\./);
  assert.match(code, /pageAccountContext\(\)/);
  assert.match(code, /诊断接口没有返回可验证的状态/);
  assert.match(code, /cloudReadSequence/);
});
test('operations UI remains neutral, reduced-motion and mobile friendly', () => {
  assert.ok(html.includes('admin-operations.css?v=20261123-v1'));
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!/linear-gradient|radial-gradient|#[A-Fa-f0-9]{6}.*purple/.test(css));
});
