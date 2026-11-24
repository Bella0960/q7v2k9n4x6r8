// Fake-only Playwright Android Chromium + iPhone WebKit permission-gate smoke.
// This DOES NOT simulate APNs/FCM transport, real OS lock-screen UI or physical taps.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const asset = readFileSync(new URL('../dist/shared/js/cloud-push-client.js', import.meta.url));
const account = 'MAO-ABCDEFGHIJKL';
const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
  '<meta name="mao-account-id" content="' + account + '">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '</head><body><button id="pushEnable" type="button">开启通知</button>' +
  '<script src="/shared/js/cloud-push-client.js"></script>' +
  '<script>document.getElementById("pushEnable").addEventListener("click", function () {' +
  'window.__mobileResult = window.MaomaoCloud.enablePush().then(() => "unexpected-success",' +
  'err => String(err.message || err));' +
  '});</script></body></html>';

const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.url === '/shared/js/cloud-push-client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(asset);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve, reject) =>
  server.listen(0, '127.0.0.1', err => err ? reject(err) : resolve()));
const base = 'http://127.0.0.1:' + server.address().port;

const cases = [
  {
    platform: 'android-chromium', browser: chromium, standalone: false,
    ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    expectedPermissionCalls: 1, expectedStatus: '通知权限未开启'
  },
  {
    platform: 'iphone-webkit-safari-tab', browser: webkit, standalone: false,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    expectedPermissionCalls: 0, expectedStatus: 'Safari'
  },
  {
    platform: 'iphone-webkit-installed-pwa', browser: webkit, standalone: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    expectedPermissionCalls: 1, expectedStatus: '通知权限未开启'
  }
];

try {
  for (const entry of cases) {
    const browser = await entry.browser.launch({
      headless: true,
      ...(entry.platform === 'android-chromium' ? { args: ['--no-sandbox'] } : {})
    });
    try {
      const context = await browser.newContext({
        viewport: { width: entry.platform === 'android-chromium' ? 375 : 390, height: 844 },
        isMobile: true, hasTouch: true, userAgent: entry.ua
      });
      // Synthetic browser capabilities: no real notification prompt and
      // absolutely no API/device enrollment, Apple Push or paid model call.
      await context.addInitScript(({ standalone }) => {
        window.__permissionEvents = [];
        window.__mobileResult = null;
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true, value: { ready: Promise.resolve({}) }
        });
        Object.defineProperty(window, 'PushManager', {
          configurable: true, value: function PushManager() {}
        });
        Object.defineProperty(window, 'Notification', {
          configurable: true,
          value: {
            permission: 'default',
            requestPermission() {
              window.__permissionEvents.push('requestPermission');
              return Promise.resolve('denied');
            }
          }
        });
      }, { standalone: entry.standalone });

      const page = await context.newPage();
      const pageErrors = [];
      const apiCalls = [];
      page.on('pageerror', error => pageErrors.push(error.name));
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push('unexpected-api');
      });
      await page.goto(base + '/', { waitUntil: 'load' });
      assert.equal(await page.evaluate(() => typeof window.MaomaoCloud), 'object');
      await page.locator('#pushEnable').click();
      await page.waitForFunction(() => window.__mobileResult !== null);
      const actual = await page.evaluate(async () => ({
        result: await window.__mobileResult,
        permissions: window.__permissionEvents.length
      }));
      assert.equal(actual.permissions, entry.expectedPermissionCalls);
      assert.ok(actual.result.includes(entry.expectedStatus), 'unexpected support/permission status');
      assert.deepEqual(apiCalls, [], 'must not register a device or incur a network request');
      assert.deepEqual(pageErrors, []);
      await context.close();
      console.log('MOBILE_BROWSER_QA:PASS:' + entry.platform);
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
