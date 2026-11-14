// Synthetic same-origin responses; no live identities or account mutations.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
let passed = 0;
async function scenario(width, initialMode, check) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await context.addCookies([{ name: 'QA_TEST_SESSION', value: 'synthetic-session',
    domain: 'qa.test', path: '/', secure: true, httpOnly: true }]);
  const state = { mode: initialMode, requests: [], errors: [] };
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('https://qa.test/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    state.requests.push({ method: req.method(), path });
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/accounts/me') {
      if (state.mode === 'unauthenticated') return json(401, { error: { code: 'LOGIN_REQUIRED' } });
      if (state.mode === 'disabled') return json(403, { error: { code: 'ACCOUNT_DISABLED' } });
      return json(200, { ok: true, account: { id: 'MAO-AAAAAAAAAAAA',
        role: state.mode === 'user' ? 'user' : 'super_admin', status: 'active', founderNumber: '001' } });
    }
    if (path.startsWith('/api/admin/')) {
      if (state.mode === 'delegated') return json(403, { error: { code: 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY' } });
      if (state.mode === 'forbidden') return json(403, { error: { code: 'ADMIN_ONLY' } });
      if (state.mode === 'expired') return json(401, { error: { code: 'LOGIN_REQUIRED' } });
      if (state.mode === 'offline') return json(503, { error: { code: 'TEMPORARY_UNAVAILABLE', message: '稍后重试' } });
      return json(200, { ok: true, accounts: [], invites: [], records: [], page: { totalCount: 0, hasMore: false } });
    }
    if (path.startsWith('/admin/')) {
      const ext = path.split('.').pop();
      return route.fulfill({ contentType: {html:'text/html',js:'text/javascript',css:'text/css'}[ext],
        body: await readFile(new URL('..' + path, import.meta.url)) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Login fixture</title>' });
  });
  try {
    await page.goto('https://qa.test/admin/admin-center.html');
    await check(page, state, context);
    assert.deepEqual(state.errors, []);
    assert(state.requests.every(req => req.method === 'GET'), 'UI must not mutate any accounts');
    console.log(`PASS ${++passed}: ${initialMode}, ${width}px`);
  } finally { await context.close(); }
}
try {
  for (const width of [375, 430, 900]) await scenario(width, 'delegated', async (page, state, context) => {
    await page.locator('#adminError').waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin/admin-center.html');
    assert.match(await page.locator('#adminError').innerText(), /仍以管理员 001 身份登录/);
    assert.equal(await page.locator('.admin-mark').innerText(), '001');
    assert.equal(await page.locator('.stats-grid').isVisible(), false);
    assert.equal(await page.locator('.admin-tabs').isVisible(), false);
    assert.equal(await page.locator('.admin-view:visible').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert((await context.cookies()).some(cookie => cookie.name === 'QA_TEST_SESSION'));
    // Recheck must preserve the session, then recover controls once central access is available.
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.getByRole('button', { name: '重新检查' }).waitFor({ state: 'visible' });
    state.mode = 'ready';
    await page.waitForFunction(() => !document.querySelector('.error-retry').disabled);
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.locator('#adminError').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#usersView').isVisible(), true);
    // A later directory restriction also uses the same safe handling in run().
    state.mode = 'delegated';
    await page.locator('#refreshUsers').click();
    await page.locator('#adminError').waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin/admin-center.html');
    assert.equal(await page.locator('#usersView').isVisible(), false);
    if (process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/admin-delegated-${width}.png` });
  });
  for (const mode of ['unauthenticated','disabled','user','forbidden','expired']) {
    await scenario(390, mode, async page => {
      await page.waitForURL('**/account/index.html?**');
      assert.equal(new URL(page.url()).searchParams.get(mode === 'disabled' ? 'disabled' : 'admin'), '1');
    });
  }
  await scenario(390, 'offline', async (page, state) => {
    await page.locator('#adminError').waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin/admin-center.html');
    state.mode = 'ready';
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.locator('#adminError').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#usersView').isVisible(), true);
  });
  console.log(`${passed} browser scenarios passed`);
} finally { await browser.close(); }
