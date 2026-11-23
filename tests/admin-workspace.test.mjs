import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../admin/admin-workspace.css', import.meta.url), 'utf8');
const original = readFileSync(new URL('../admin/admin-center-editorial.css', import.meta.url), 'utf8');

test('operational overview remains a real fifth management screen', () => {
  for (const id of [
    'overviewView','overviewRefresh','overviewSync','overviewPendingCount',
    'overviewInviteCount','overviewActiveCount','overviewRestrictedCount',
    'overviewPendingList','overviewActivityList','overviewAccountsStatus',
    'overviewInvitesStatus','overviewAuditStatus','overviewOpenPending'
  ]) assert.match(html, new RegExp('\\bid="' + id + '"'), 'Missing dashboard control ' + id);
  for (const tab of ['overview', 'users', 'invites', 'audit', 'settings']) {
    assert.ok(html.includes('data-tab="' + tab + '"'), 'Missing work area: ' + tab);
  }
  assert.match(html, /data-tab="overview"[^>]+aria-current="page"/);
  assert.match(html, /id="usersView" hidden/);
  assert.match(js, /\$\('overviewView'\)\.hidden = selected !== 'overview';/);
  assert.match(js, /if \(tab === 'overview' && !busy\) run\(loadOverviewDetails\)/);
});

test('overview actions are attached to existing server-gated screens, not fictional buttons', () => {
  assert.match(html, /href="\.\/cloud\.html"/);
  for (const tab of ['users','invites','audit']) {
    assert.match(html, new RegExp('data-overview-target="' + tab + '"'));
  }
  assert.match(js, /document\.querySelector\('\[data-tab="users"\]'\)\.click\(\)/);
  assert.match(js, /document\.querySelector\('\[data-account-filter="pending_invite"\]'\)\.click\(\)/);
  assert.match(js, /openAccountFromInvite\(account\.id\)/);
  assert.match(js, /overviewPeriod === 'today'/);
});

test('preview reads enforce the existing administrator account context and reject malformed directories', () => {
  const start = js.indexOf('  // WORKSPACE-002:');
  const end = js.indexOf('  function updateStats() {', start);
  assert.ok(start > 0 && end > start, 'isolated read-only dashboard implementation');
  const overview = js.slice(start, end);
  assert.match(overview, /verifiedDirectoryPayload\(payload, 'accounts'\)/);
  assert.match(overview, /verifiedDirectoryPayload\(payload, 'records'\)/);
  assert.match(overview, /Promise\.allSettled\(/);
  assert.match(overview, /isConfirmedSessionExpired\(result\.reason\)/);
  assert.match(overview, /ACCOUNT_CONTEXT_REQUIRED/);
  assert.match(overview, /ACCOUNT_CONTEXT_CHANGED/);
  assert.match(overview, /setOverviewConnection\('overviewAuditStatus', 'error'\)/);
  assert.match(overview, /暂时无法读取/);
  assert.doesNotMatch(overview, /localStorage|sessionStorage|document\.cookie|innerHTML/);
  assert.doesNotMatch(overview, /\bPOST\b|\bPUT\b|\bDELETE\b/);
  assert.match(js, /headers\.set\('x-mao-account-context', accountId\)/);
  assert.match(js, /me\.account\.role !== 'super_admin'/);
});

test('dashboard metrics use only validated summaries, not list length as a false global total', () => {
  const start = js.indexOf('  function validOverviewSummary(');
  const end = js.indexOf('  function setOverviewConnection(', start);
  const check = new Function(js.slice(start, end) + '\nreturn validOverviewSummary;')();
  assert.equal(check({ pending: 0, total: 4 }, ['pending','total']), true);
  assert.equal(check({ pending: 0 }, ['pending','total']), false);
  assert.equal(check({ pending: -1 }, ['pending']), false);
  assert.equal(check({ pending: '0' }, ['pending']), false);
  assert.equal(check({ pending: NaN }, ['pending']), false);
  assert.equal(check(null, ['pending']), null);
  assert.match(js, /accountPageError \? 'error'/);
  assert.match(js, /invitePageError \? 'error'/);
  assert.match(js, /账号目录尚未完成核验/);
});

test('design stays neutral, responsive and free of fake service health indicators', () => {
  assert.ok(css.includes('.overview-grid'));
  assert.ok(css.includes('.overview-connection'));
  assert.ok(css.includes('@media(max-width:620px)'));
  assert.ok(css.includes('@media(max-width:380px)'));
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(original.includes('--editorial-serif'));
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|#[a-fA-F0-9]{6}\b[^\n]*purple/i);
  assert.doesNotMatch(html, /MAO/);
  assert.match(html, /不代表所有云端服务的健康状态/);
  assert.ok(html.includes('admin-workspace.css?v=20261123-v1'));
  assert.ok(html.includes('admin-center.js?v=20261123-workspace1'));
});

// MAOMAO interface preference: only functional back-navigation arrows may appear.
// Decorative upward, diagonal, link and dropdown arrows are explicitly forbidden.
test('management dashboard uses no decorative arrow glyphs or arrow icon slots', () => {
  for (const [filename, source] of [
    ['admin-center.html', html],
    ['admin-center.js', js],
    ['admin-workspace.css', css]
  ]) {
    assert.doesNotMatch(source, /[↗↑↖↘↓⇧➚→➔➜➝➞➤]/, filename + ' contains a forbidden arrow');
    assert.doesNotMatch(source, /overview-(?:shortcut-arrow|entry-chevron)/,
      filename + ' contains a decorative arrow slot');
  }
  // Textual actions and original permissions stay intact.
  assert.match(html, /id="overviewOpenPending"/);
  assert.match(html, /data-overview-target="audit"/);
  assert.match(html, /href="\.\/cloud\.html"/);
  assert.match(js, /openAccountFromInvite\(account\.id\)/);
});
