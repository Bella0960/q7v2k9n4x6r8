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
const pageData = {
  ok: true,
  accounts: [{ id: sample, username: '示例用户', status: 'active', created_at: 1732200000000 }],
  summary: { total: 1, pending: 0, active: 1, restricted: 0 },
  page: { totalCount: 1, hasMore: false, nextCursor: '' }
};
const emptyInvites = {
  ok: true, invites: [],
  summary: { total: 0, pending: 0, used: 0, expired: 0, revoked: 0 },
  page: { totalCount: 0, hasMore: false, nextCursor: '' }
};
const emptyAudit = {
  ok: true, records: [],
  summary: { total: 0, accountActions: 0, inviteActions: 0 },
  page: { totalCount: 0, hasMore: false, nextCursor: '' }
};

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
        json = pageData;
      } else if (pathname === '/api/admin/invites') {
        json = emptyInvites;
      } else if (pathname === '/api/admin/audit') {
        json = emptyAudit;
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
    await page.waitForFunction(() => document.getElementById('statTotal')?.textContent === '1');
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
    assert.equal(details.accountCount, 1);
    assert.equal(details.navCount, 4);
    assert.ok(details.links.some(url => url.includes('admin-center-editorial.css')));
    await page.locator('[data-tab="invites"]').click();
    assert.equal(await page.locator('#invitesView').isVisible(), true);
    assert.equal(await page.locator('#usersView').isVisible(), false);
    await page.locator('[data-tab="audit"]').click();
    await page.waitForFunction(() => document.getElementById('globalAuditTotal')?.textContent === '0');
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
    assert.match(recovery, /返回桌面/);
    assert.doesNotMatch(recovery, /MAO/);
    console.log('EDITORIAL_ADMIN_PASS ' + (process.env.ADMIN_BROWSER || 'chromium') + ' ' + width + 'px tabs, data, layout and safe context recovery');
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
