// Optional real Chromium layout gate. No live API calls or production data.
// npm run test:accounts:browser (requires Playwright Chromium installed).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
let session = 'welcome';
const account = { id: 'MAO-AAAAAAAAAAAA', status: 'pending_invite' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/api/admin/bootstrap/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, initialized: true }));
    return;
  }
  if (pathname === '/api/accounts/me') {
    res.writeHead(session === 'invite' ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session === 'invite' ? { ok: true, account }
      : { ok: false, error: { code: 'UNAUTHORIZED', message: 'not signed in' } }));
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'MOCK_ONLY' } }));
    return;
  }
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const body = await readFile(absolute);
    res.writeHead(200, { 'Content-Type': types[path.extname(absolute)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  const port = server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const sizes = [320, 360, 375, 390, 430, 480, 561, 768];
  for (const width of sizes) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width <= 480,
      deviceScaleFactor: 1, hasTouch: width <= 480 });
    const page = await context.newPage();
    const jsErrors = [];
    page.on('pageerror', error => jsErrors.push(error.message));
    session = 'welcome';
    await page.goto('http://127.0.0.1:' + port + '/account/index.html', { waitUntil: 'load' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
    await page.waitForFunction(() => document.getElementById('ivoryApp').dataset.view === 'welcome');

    const checkViewport = async label => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, width + 'px ' + label + ': horizontal overflow');
    };
    const checkBack = async (label, inputSelector) => {
      const back = page.locator('#ivoryNavBack');
      assert.equal(await back.isVisible(), true, width + 'px ' + label + ': missing back control');
      const head = await page.locator('header.titlebar').boundingBox();
      const b = await back.boundingBox();
      const input = await page.locator(inputSelector).boundingBox();
      assert(head && b && input, width + 'px ' + label + ': missing layout box');
      assert(b.width >= 44 && b.height >= 44, width + 'px ' + label + ': back tap target below 44px');
      assert(b.y >= head.y - 1 && b.y + b.height <= head.y + head.height + 1,
        width + 'px ' + label + ': back outside top navigation');
      assert(b.y + b.height + 8 < input.y, width + 'px ' + label + ': back overlaps an input');
      await checkViewport(label);
    };

    assert.equal(await page.getByText('同一入口 · 独立账号').count(), 0, 'unwanted footer');
    await checkViewport('welcome');
    await page.getByRole('button', { name: /创建新账号/ }).click();
    await checkBack('register', '#registerForm input[name="username"]');
    await page.locator('#ivoryNavBack').click();
    assert.equal(await page.locator('#ivoryApp').getAttribute('data-view'), 'welcome');
    await page.getByRole('button', { name: /已有账号.*登录/ }).click();
    await checkBack('login', '#loginForm input[name="identifier"]');
    await page.locator('#ivoryNavBack').click();
    assert.equal(await page.locator('#ivoryApp').getAttribute('data-view'), 'welcome');

    session = 'invite';
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('ivoryApp').dataset.view === 'invite');
    await checkBack('invite', '#inviteForm input[name="inviteCode"]');
    await page.locator('#ivoryNavBack').click();
    assert.equal(await page.locator('#ivoryApp').getAttribute('data-view'), 'login');
    assert.deepEqual(jsErrors, [], width + 'px script errors');
    console.log('PASS ' + width + 'px: welcome → register/login/invite navigation and no input overlap');
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
