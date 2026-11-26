import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

// Browser acceptance uses synthetic accounts only. No real admin password, session,
// Cloudflare authority or user data can be touched by this test.
const root = path.resolve('.');
const founder = 'MAO-AAAAAAAAAAAA';
const sample = 'MAO-BBBBBBBBBBBB';
const pending = 'MAO-CCCCCCCCCCCC';
const sampleAccounts = [
  { id: sample, username: '示例用户', status: 'active', created_at: 1732200000000 },
  { id: pending, username: '待授权用户', status: 'pending_invite', created_at: 1732300000000 }
];
const accountSummary = { total: 2, pending: 1, active: 1, restricted: 0 };
function pageData(query) {
  const search = query.get('search') || '';
  const status = query.get('status') || 'all';
  const accounts = sampleAccounts.filter(account =>
    (status === 'all' || account.status === status) &&
    (!search || account.id.includes(search) || account.username.includes(search)));
  return {
    ok: true, accounts, summary: accountSummary,
    page: { totalCount: accounts.length, hasMore: false, nextCursor: '' }
  };
}
const emptyInvites = {
  ok: true, invites: [],
  summary: { total: 0, pending: 0, used: 0, expired: 0, revoked: 0 },
  page: { totalCount: 0, hasMore: false, nextCursor: '' }
};
const sampleAudit = {
  id: 'AUDIT-SYNTH-001', action: 'invite_create', targetUsername: '待授权用户',
  targetAccountId: pending, createdAt: Date.now(), actorType: 'super_admin'
};
function auditData(query) {
  const since = Number(query.get('since') || 0);
  const records = since <= sampleAudit.createdAt ? [sampleAudit] : [];
  return {
    ok: true, records,
    summary: { total: records.length, accountActions: 0, inviteActions: records.length },
    page: { totalCount: records.length, hasMore: false, nextCursor: '' }
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      const isScoped = request.headers['x-mao-account-context'] === founder;
      let json;
      if (pathname === '/api/accounts/me') {
        json = { ok: true, account: { id: founder, role: 'super_admin', status: 'active' } };
      } else if (!isScoped) {
        response.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ ok: false, error: { code: 'ACCOUNT_CONTEXT_REQUIRED', message: '缺少账号上下文' } }));
        return;
      } else if (pathname === '/api/admin/accounts') {
        json = pageData(url.searchParams);
      } else if (pathname === '/api/admin/invites') {
        json = emptyInvites;
      } else if (pathname === '/api/admin/audit') {
        json = auditData(url.searchParams);
      } else {
        json = { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } };
      }
      response.writeHead(json.ok ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(json));
      return;
    }
    if (!pathname.startsWith('/admin/')) { response.writeHead(404).end(); return; }
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const content = await readFile(filename);
    const ext = path.extname(filename);
    const type = ext === '.html' ? 'text/html; charset=utf-8' :
      ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
    response.setHeader('content-type', type);
    response.setHeader('cache-control', 'no-store');
    if (pathname.endsWith('/admin-center.html')) {
      // Equivalent to the Worker-injected account context, without credentials.
      response.end(content.toString().replace('<head>', '<head><meta name="mao-account-id" content="' + founder + '">'));
    } else response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

let browser;
try {
  const engine = process.env.ADMIN_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ headless: true });
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 780 : width === 390 ? 844 : 932 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = await page.goto('http://127.0.0.1:' + server.address().port +
      '/admin/admin-center.html', { waitUntil: 'load' });
    assert.equal(result?.status(), 200);
    await page.waitForFunction(() => document.getElementById('statTotal')?.textContent === '2');
    await page.waitForFunction(() => document.querySelectorAll('#overviewPendingList .overview-entry').length === 1 &&
      document.querySelectorAll('#overviewActivityList .overview-entry').length === 1);
    const details = await page.evaluate(() => {
      const title = document.querySelector('.admin-intro h2');
      const stat = document.querySelector('.stats-grid');
      const styles = getComputedStyle(title);
      const grid = getComputedStyle(stat);
      return {
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        heading: title?.textContent,
        titleSize: parseFloat(styles.fontSize),
        serif: styles.fontFamily.toLowerCase(),
        columns: grid.gridTemplateColumns.split(' ').filter(Boolean).length,
        links: [...document.querySelectorAll('link[rel="stylesheet"]')].map(el => el.href),
        accountCount: document.querySelectorAll('.account-row').length,
        navCount: document.querySelectorAll('[data-tab]').length
      };
    });
    assert.ok(details.width <= details.viewport + 2, 'horizontal page overflow at ' + width);
    assert.ok(details.titleSize >= 29, 'editorial heading is too small');
    assert.match(details.serif, /georgia|songti|iowan/);
    assert.equal(details.columns, 2, 'mobile account metrics must be two columns');
    assert.equal(details.accountCount, 2);
    assert.equal(details.navCount, 5);
    assert.equal(await page.locator('#overviewView').isVisible(), true);
    assert.equal(await page.locator('#overviewTotalCount').innerText(), '2');
    assert.equal(await page.locator('.overview-shortcuts a', { hasText: '真人好友审批' }).getAttribute('href'), '../chat/contacts/real-friends.html');
    assert.equal(await page.locator('.overview-shortcuts a', { hasText: '我的账号与安全' }).getAttribute('href'), '../account/manage.html');
    assert.equal(await page.locator('#overviewPendingCount').innerText(), '1');
    assert.equal(await page.locator('#overviewInviteCount').innerText(), '0');
    assert.equal(await page.locator('#overviewAccountsStatus').getAttribute('data-state'), 'ok');
    assert.equal(await page.locator('#overviewInvitesStatus').getAttribute('data-state'), 'ok');
    assert.equal(await page.locator('#overviewAuditStatus').getAttribute('data-state'), 'ok');
    assert.match(await page.locator('#overviewSync').innerText(), /最近同步/);
    assert.equal(await page.locator('a.overview-cloud-link').getAttribute('href'), './cloud.html');
    await page.locator('[data-overview-period="today"]').click();
    await page.waitForFunction(() => document.getElementById('overviewAuditStatus')?.dataset.state === 'ok');
    assert.equal(await page.locator('#overviewActivityList .overview-entry').count(), 1);
    await page.locator('#overviewOpenPending').click();
    await page.waitForFunction(() => document.getElementById('accountResultCount')?.textContent.includes('本页显示 1'));
    assert.equal(await page.locator('#usersView').isVisible(), true);
    assert.equal(await page.locator('#accountsList .account-row').count(), 1);
    await page.locator('[data-tab="overview"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#overviewPendingList .overview-entry').length === 1);
    await page.locator('#overviewPendingList .overview-entry').first().click();
    await page.waitForFunction(() => !document.getElementById('accountDetail').hidden);
    assert.equal(await page.locator('#usersView').isVisible(), true);
    await page.locator('#closeDetail').click();
    assert.ok(details.links.some(url => url.includes('admin-center-editorial.css')));
    await page.locator('[data-tab="invites"]').click();
    assert.equal(await page.locator('#invitesView').isVisible(), true);
    assert.equal(await page.locator('#usersView').isVisible(), false);
    await page.locator('[data-tab="audit"]').click();
    await page.waitForFunction(() => document.getElementById('globalAuditTotal')?.textContent === '1');
    assert.equal(await page.locator('#auditView').isVisible(), true);
    await page.locator('[data-tab="settings"]').click();
    assert.equal(await page.locator('#settingsView').isVisible(), true);
    await page.locator('[data-tab="users"]').click();
    assert.equal(await page.locator('#usersView').isVisible(), true);
    assert.deepEqual(errors, [], 'unexpected browser error on ' + width);

    // Reproduce the missing context without touching the live account service.
    await page.evaluate(() => document.querySelector('meta[name="mao-account-id"]')?.remove());
    await page.locator('#refreshUsers').click();
    await page.locator('.page-error').waitFor();
    const recovery = await page.locator('.page-error').innerText();
    assert.match(recovery, /登录已有账号/);
    assert.doesNotMatch(recovery, /MAO/);
    await Promise.all([
      page.waitForURL(/\/account\/index\.html\?admin=1$/),
      page.locator('.error-retry').click()
    ]);
    console.log('EDITORIAL_ADMIN_PASS ' + (process.env.ADMIN_BROWSER || 'chromium') + ' ' + width + 'px tabs, data, layout and safe context recovery');
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
