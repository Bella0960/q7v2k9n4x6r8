/**
 * ADMIN-CLOUD-001 — real-browser acceptance test (phone viewports).
 *
 * Serves /admin/cloud.html through the repository's REAL worker.js entry
 * (server-side HTML gate + account-meta injection), backed by the real API
 * router, real migrations and in-memory SQLite. Static files come from the repo
 * root. Nothing in the admin path is mocked.
 *
 *   node tests/admin-cloud-mobile.browser.mjs
 *
 * Optional env: CHROMIUM_PATH (browser executable), SCREENSHOT_DIR (write PNGs).
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHarness, SENTINELS, T0, HOUR } from './fixtures/admin-cloud-harness.mjs';
import worker from '../worker.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=UTF-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (error) { results.push(['FAIL', name]); console.error('FAIL', name, '\n  ', error.message); process.exitCode = 1; }
};

/* ---- backend: real router + real worker.js entry ---- */
const h = createHarness();
const adminSession = await h.bootstrapAdmin();
const userSession = await h.createActiveUser();
h.seedDevice(SENTINELS.device);
h.seedDevice(SENTINELS.device2);
h.seedActivity({ id: 'a-due', status: 'waiting', scheduledAt: T0 - 3 * HOUR });
h.seedOutbound({ id: 'o1', createdAt: T0 - 3 * HOUR });
h.seedPushDelivery({ id: 'p1', status: 'error', nextAttemptAt: T0 - 1 });
h.seedLog({ kind: 'autonomy_tick', status: 'deferred', reasonCode: 'executor_unavailable', at: T0 - HOUR });
h.rawLog({ kind: 'outbound_push', status: 'failed', reasonCode: '<img src=x onerror="window.__xss=1">', detailJson: '{"httpStatus":500}', at: T0 - 1000 });
for (let i = 0; i < 30; i += 1) {
  h.seedLog({ kind: 'outbound_push', status: i % 5 === 0 ? 'retry' : 'failed', reasonCode: 'push_delivery_failed', at: T0 - 60000 - i * 1000,
    deviceId: i % 2 ? SENTINELS.device : SENTINELS.device2, detail: { httpStatus: 500 + (i % 3), attemptCount: i } });
}

const stub = { fetch: request => h.handleApi(request) };
const env = {
  CLOUD_DB: { idFromName: name => name, get: () => stub },
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/shared/js/mao-account-scope.js') {
        // Referenced by worker.js but not part of the supplied snapshot; serve an empty stand-in.
        return new Response('/* stand-in for mao-account-scope.js */', { headers: { 'content-type': 'text/javascript' } });
      }
      const file = resolve(root, '.' + decodeURIComponent(path));
      if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
      try {
        const body = await readFile(file);
        return new Response(body, { headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = 'http://' + req.headers.host + req.url;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const init = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
    requests.push({ method: req.method, path: req.url, headers: Object.fromEntries(headers) });
    const response = await worker.fetch(new Request(url, { ...init, redirect: 'manual' }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end('server error: ' + error.message); }
});
const requests = [];
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cookieValue = session => session.cookie.split('=')[1];

/* ---- A. server-side gate on the page itself (real worker.js) ---- */
await step('page gate: anonymous is redirected to the account entry; non-admin is redirected home; admin receives the page with account context injected', async () => {
  const anon = await fetch(base + '/admin/cloud.html', { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /\/account\/index\.html$/);
  const user = await fetch(base + '/admin/cloud.html', { redirect: 'manual', headers: { cookie: userSession.cookie } });
  assert.equal(user.status, 302);
  assert.match(user.headers.get('location'), /\/index\.html$/);
  const admin = await fetch(base + '/admin/cloud.html', { headers: { cookie: adminSession.cookie } });
  assert.equal(admin.status, 200);
  const html = await admin.text();
  assert.ok(html.includes('name="mao-account-id" content="' + adminSession.accountId + '"'));
  assert.ok(html.includes('云端诊断'));
  assert.equal(admin.headers.get('cache-control'), 'private, no-store, max-age=0');
});

/* ---- B. browser ---- */
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const shots = process.env.SCREENSHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });

async function open(session, { width = 390, height = 844, dark = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  if (session) await context.addCookies([{ name: 'MAO_SESSION', value: cookieValue(session), url: base, httpOnly: true, sameSite: 'Lax' }]);
  if (dark) await context.addInitScript(() => localStorage.setItem('settings_dark_mode', '1'));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  await page.goto(base + '/admin/cloud.html');
  return { context, page, problems };
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const snap = async (page, name) => { if (shots) await page.screenshot({ path: shots + '/' + name + '.png' }); };

await step('admin at 390x844: health panel renders real data, honest states, and the page never scrolls sideways', async () => {
  const { context, page, problems } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  const text = await page.locator('#ca-panel').innerText();
  assert.ok(text.includes('云端存储（SQLite）') && text.includes('数据库迁移') && text.includes('无法观测'));
  assert.ok((await page.locator('#ca-meta').innerText()).startsWith('更新于'));
  assert.equal(await page.locator('.ca-tab').count(), 3);
  assert.ok(await noOverflow(page), 'horizontal overflow on health');
  await snap(page, '01-health-390');
  assert.deepEqual(problems, []);
  await context.close();
});

await step('tabs: tasks and errors panels render and stay inside the viewport', async () => {
  const { context, page, problems } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.click('#ca-tab-tasks');
  await page.waitForSelector('.ca-task');
  const tasks = await page.locator('#ca-panel').innerText();
  assert.ok(tasks.includes('执行器未接入') && tasks.includes('已到期待执行') && tasks.includes('该任务不留存运行记录'));
  assert.ok(await noOverflow(page), 'overflow on tasks');
  await snap(page, '02-tasks-390');
  await page.click('#ca-tab-errors');
  await page.waitForSelector('.ca-entry');
  assert.ok(await noOverflow(page), 'overflow on errors');
  await snap(page, '03-errors-390');
  assert.equal(await page.locator('.ca-tab.is-active').getAttribute('aria-selected'), 'true');
  assert.deepEqual(problems, []);
  await context.close();
});

await step('read-only on the wire: only GET requests, always with the account-context header, never any secret in the page', async () => {
  const before = requests.length;
  const { context, page } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.click('#ca-tab-errors');
  await page.selectOption('[data-filter="window"]', '1h');
  await page.waitForFunction(() => /近 1 小时/.test(document.querySelector('#ca-panel').innerText));
  const api = requests.slice(before).filter(r => r.path.startsWith('/api/'));
  assert.ok(api.length >= 2);
  for (const r of api) {
    assert.equal(r.method, 'GET', r.path);
    assert.equal(r.headers['x-mao-account-context'], adminSession.accountId, r.path);
    assert.ok(r.path.startsWith('/api/admin/cloud'), r.path);
  }
  const content = await page.content();
  for (const secret of [SENTINELS.pepper, SENTINELS.vapidPrivate, SENTINELS.bootstrap, SENTINELS.chat, SENTINELS.device, SENTINELS.character]) {
    assert.ok(!content.includes(secret), 'page contains ' + secret);
  }
  assert.equal(await page.evaluate(() => document.cookie), '', 'session cookie is HttpOnly');
  await context.close();
});

await step('filters re-query the server; pagination appends without duplicates and the button disappears at the end', async () => {
  const { context, page } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.click('#ca-tab-errors');
  await page.waitForSelector('.ca-entry');
  assert.equal(await page.locator('.ca-entry').count(), 5, 'overview shows a short recent list');
  await page.selectOption('[data-filter="window"]', '24h');
  await page.waitForFunction(() => document.querySelectorAll('.ca-entry').length === 25);
  await page.click('[data-action="more"]');
  await page.waitForFunction(() => document.querySelectorAll('.ca-entry').length === 31);
  assert.equal(await page.locator('[data-action="more"]').count(), 0);
  const refs = await page.$$eval('.ca-entry-meta', els => els.map(e => (/记录 ([0-9a-f]{10})/.exec(e.textContent) || [])[1]));
  assert.equal(new Set(refs).size, refs.length, 'no duplicate rows after appending');
  await page.selectOption('[data-filter="severity"]', 'warning');
  await page.waitForFunction(() => document.querySelectorAll('.ca-entry').length === 6);
  const filtered = await page.locator('#ca-panel').innerText();
  assert.ok(filtered.includes('重试'));
  // Regression: a list filter must never change the headline. Failures exist, so the state stays "降级".
  assert.ok(filtered.includes('故障 25 条，重试 6 条'), filtered);
  assert.ok(await page.locator('#ca-panel .ca-block-head .ca-state--degraded').count() === 1, 'headline must stay degraded under a warnings-only filter');
  await snap(page, '04-errors-filtered-390');
  await context.close();
});

await step('hostile database text cannot become markup or run script in the real DOM', async () => {
  const { context, page } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.click('#ca-tab-errors');
  await page.selectOption('[data-filter="window"]', '24h');
  await page.waitForFunction(() => document.querySelectorAll('.ca-entry').length > 5);
  assert.equal(await page.locator('#ca-panel img, #ca-panel script').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.ok((await page.locator('#ca-panel').innerText()).includes('已隐去'));
  await context.close();
});

await step('failure states: the UI renders the REAL 401, 403 and 409 responses and a network failure with actionable messages', async () => {
  // Capture genuine server refusals (no mocking of content): anonymous, non-admin, and a missing account context.
  const real = async init => {
    const r = await fetch(base + '/api/admin/cloud/overview', init);
    return { status: r.status, contentType: r.headers.get('content-type'), body: await r.text() };
  };
  const cases = [
    ['401', await real({}), '登录已失效', true],
    ['403', await real({ headers: { cookie: userSession.cookie, 'x-mao-account-context': userSession.accountId } }), '仅超级管理员', false],
    ['409', await real({ headers: { cookie: adminSession.cookie } }), '账号上下文已变化', false]
  ];
  assert.deepEqual(cases.map(c => c[1].status), [401, 403, 409]);
  for (const [label, response, message, hasLogin] of cases) {
    const { context, page } = await open(adminSession);
    await page.waitForSelector('.ca-row');
    await page.route('**/api/admin/cloud/overview', route => route.fulfill(response));
    await page.click('#ca-refresh');
    await page.waitForSelector('.ca-error');
    const shown = await page.locator('#ca-panel').innerText();
    assert.ok(shown.includes(message), label + ': ' + shown);
    assert.equal(await page.locator('a.ca-link[href="/account/index.html"]').count(), hasLogin ? 1 : 0, label + ' login link');
    assert.ok((await page.locator('#ca-meta').innerText()).includes('读取失败'), label);
    assert.ok(await noOverflow(page));
    if (label === '401') await snap(page, '05-error-401-390');
    await context.close();
  }
  const { context, page } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.route('**/api/admin/cloud/overview', route => route.abort('failed'));
  await page.click('#ca-refresh');
  await page.waitForSelector('.ca-error');
  assert.ok((await page.locator('#ca-panel').innerText()).includes('无法连接云端'));
  assert.equal(await page.locator('#ca-refresh').isDisabled(), false, 'refresh is usable again after a failure');
  await page.unroute('**/api/admin/cloud/overview');
  await page.click('#ca-refresh');
  await page.waitForSelector('.ca-row');
  assert.equal(await page.locator('.ca-error').count(), 0, 'recovers after the network returns');
  await context.close();
});

await step('phone ergonomics: 44px touch targets, 16px form controls (no iOS zoom), 375 and 430 widths have no overflow', async () => {
  for (const width of [375, 430]) {
    const { context, page } = await open(adminSession, { width, height: 800 });
    await page.waitForSelector('.ca-row');
    for (const tab of ['health', 'tasks', 'errors']) {
      await page.click('#ca-tab-' + tab);
      await page.waitForTimeout(50);
      assert.ok(await noOverflow(page), tab + ' overflows at ' + width);
    }
    const small = await page.$$eval('.ca-tab, .ca-btn, .ca-more, .ca-field select', els =>
      els.map(e => { const b = e.getBoundingClientRect(); return b.height < 43.5 ? e.className + ':' + Math.round(b.height) : null; }).filter(Boolean));
    assert.deepEqual(small, [], 'touch targets below 44px at ' + width);
    const fonts = await page.$$eval('select', els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(fonts.every(f => f >= 16), 'select font below 16px');
    await context.close();
  }
});

await step('dark mode follows the existing settings flag and keeps a neutral palette', async () => {
  const { context, page } = await open(adminSession, { dark: true });
  await page.waitForSelector('.ca-row');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
  const colours = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
  assert.equal(colours[0], 'rgb(17, 17, 17)');
  const neutral = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) <= 12; };
  assert.ok(neutral(colours[0]) && neutral(colours[1]));
  await snap(page, '06-health-dark-390');
  await context.close();
});

await step('extensibility: a later feature can register a panel and it gets its own tab', async () => {
  const { context, page } = await open(adminSession);
  await page.waitForSelector('.ca-row');
  await page.evaluate(() => {
    window.MaoCloudAdmin.registerPanel({ id: 'demo', title: '示例', sectionId: 'health', render: s => '<section class="ca-block"><h2>示例分区</h2><p>' + (s.checks || []).length + ' 项</p></section>' });
    window.MaoCloudAdmin.refresh();
  });
  await page.waitForSelector('#ca-tab-demo');
  await page.click('#ca-tab-demo');
  assert.ok((await page.locator('#ca-panel').innerText()).includes('示例分区'));
  assert.deepEqual(await page.evaluate(() => window.MaoCloudAdmin.panels()), ['health', 'tasks', 'errors', 'demo']);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' browser checks passed');
if (failed) process.exitCode = 1;
