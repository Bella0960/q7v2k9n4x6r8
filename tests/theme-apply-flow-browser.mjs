// QA-001 P1-2: real storefront apply-path isolation.
// Drives the actual storefront "detail -> apply -> confirm" UI, then inspects the
// chat detail page's computed styles (not only data attributes) for residual
// WeChat variables/controls across a wechat -> qq -> default -> wechat cycle.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function startServer() {
  return new Promise((done) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = resolve(root, '.' + urlPath);
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

const SHOP = '/theme-store/theme-store.html';
const DETAIL = '/chat/chat/chat-detail.html?id=apply-flow';

async function openShop(page, origin) {
  await page.goto(origin + SHOP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sf-product', { timeout: 15000 });
}

async function applyFromShop(page, id) {
  await page.locator('[data-category="themes"]').click();
  await page.locator('.sf-theme-cover[data-sf="detail"][data-id="' + id + '"]').click();
  await page.locator('.sf-dialog [data-sf="apply-theme"]').click();
  await page.locator('.sf-dialog [data-sf="confirm-apply-theme"]').click();
  await page.waitForFunction((t) => globalThis.ChatBeauty?.getThemePreset?.() === t, id, { timeout: 5000 });
}

async function inspectDetail(page, origin) {
  await page.goto(origin + DETAIL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.phone-mockup', { timeout: 15000 });
  await page.waitForFunction(() => {
    const r = document.documentElement;
    return !r.classList.contains('nf-enter') && !r.classList.contains('nf-hide');
  }, null, { timeout: 2000 }).catch(() => {});
  return page.evaluate(() => {
    const shell = document.querySelector('.phone-mockup');
    const send = document.getElementById('myFloatSend');
    const cs = getComputedStyle(shell);
    const snd = send ? getComputedStyle(send) : null;
    const head = document.querySelector('.wechat-home-header');
    return {
      preset: shell.getAttribute('data-chat-theme-preset'),
      green: cs.getPropertyValue('--wechat-green').trim(),
      sendBg: snd ? snd.backgroundColor : '',
      sendRadius: snd ? snd.borderRadius : '',
      headDisplay: head ? getComputedStyle(head).display : 'absent',
      docWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth
    };
  });
}

try {
  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openShop(page, origin);

  // Read-only preview must not persist a theme before confirmation.
  const beforePreview = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  await page.locator('[data-sf="detail"][data-id="atmosphere"]').last().click();
  await page.locator('[data-sf="close"]').click();
  const afterPreview = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(afterPreview, beforePreview, 'storefront preview must not write theme storage');
  process.stdout.write('PASS read-only preview leaves storage untouched\n');

  // wechat -> qq -> default -> wechat through the real confirm-apply path.
  await applyFromShop(page, 'wechat');
  let m = await inspectDetail(page, origin);
  assert.equal(m.preset, 'wechat', 'wechat detail preset');
  assert.equal(m.green, '#07C160', 'wechat green variable applied');
  assert.equal(m.sendBg, 'rgb(7, 193, 96)', 'wechat send button is green');
  assert.equal(m.sendRadius, '6px', 'wechat send button square corner');
  assert.notEqual(m.headDisplay, 'none', 'wechat home header visible');
  assert.ok(m.docWidth <= m.viewport + 1, 'wechat no horizontal overflow');
  process.stdout.write('PASS wechat applied from storefront, detail styles clean\n');

  await openShop(page, origin);
  await applyFromShop(page, 'qq');
  m = await inspectDetail(page, origin);
  assert.equal(m.preset, 'qq', 'qq detail preset');
  assert.equal(m.green, '', 'qq clears the WeChat green variable');
  assert.notEqual(m.sendBg, 'rgb(7, 193, 96)', 'qq send button has no WeChat green residual');
  assert.equal(m.headDisplay, 'absent', 'qq has no WeChat header');
  assert.ok(m.docWidth <= m.viewport + 1, 'qq no horizontal overflow');
  process.stdout.write('PASS qq replaces wechat without green/header residual\n');

  await openShop(page, origin);
  await applyFromShop(page, 'default');
  m = await inspectDetail(page, origin);
  assert.equal(m.preset, 'default', 'default detail preset');
  assert.equal(m.green, '', 'default clears the WeChat green variable');
  assert.equal(m.sendBg, 'rgb(255, 255, 255)', 'default send button is white');
  assert.equal(m.sendRadius, '50%', 'default send button round');
  assert.ok(m.docWidth <= m.viewport + 1, 'default no horizontal overflow');
  process.stdout.write('PASS default restores native white round control\n');

  await openShop(page, origin);
  await applyFromShop(page, 'wechat');
  m = await inspectDetail(page, origin);
  assert.equal(m.preset, 'wechat', 'wechat re-entry preset');
  assert.equal(m.green, '#07C160', 'wechat green variable restored on re-entry');
  assert.equal(m.sendBg, 'rgb(7, 193, 96)', 'wechat green restored on re-entry');
  process.stdout.write('PASS re-entering wechat restores full theme\n');

  assert.deepEqual(errors, [], 'apply flow must not throw runtime errors');
  await context.close();
  await browser.close();
  server.close();
  console.log('ALL PASS: storefront apply-path isolation flow');
} catch (err) {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
}
