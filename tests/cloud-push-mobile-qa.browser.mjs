// Public CI only. Synthetic Android Chromium and iPhone WebKit permission
// gesture smoke: NOT an APNs/FCM transport or physical lock-screen test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const source = readFileSync(new URL('../dist/shared/js/cloud-push-client.js', import.meta.url));
const account = 'MAO-ABCDEFGHIJKL';
const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
  '<meta name="mao-account-id" content="' + account + '">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body><button id="push" type="button">开启通知</button>' +
  '<script src="/shared/js/cloud-push-client.js"></script>' +
  '<script>document.querySelector("#push").addEventListener("click", function () {' +
  'window.__result = window.MaomaoCloud.enablePush().then(() => "unexpected-success",' +
  'e => String(e && e.message || e)); });</script></body></html>';

const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/shared/js/cloud-push-client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(source);
  } else {
    res.writeHead(404); res.end();
  }
});
await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
});
const base = 'http://127.0.0.1:' + server.address().port;
const scenarios = [
  { name: 'android-chromium', engine: chromium, ua:
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
    standalone: false, width: 375, permissionCalls: 1, expected: '通知' },
  { name: 'iphone-webkit-safari', engine: webkit, ua:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    standalone: false, width: 390, permissionCalls: 0, expected: 'Safari' },
  { name: 'iphone-webkit-home-screen-sim', engine: webkit, ua:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    standalone: true, width: 390, permissionCalls: 1, expected: '通知' }
];
try {
  for (const scenario of scenarios) {
    const browser = await scenario.engine.launch({
      headless: true,
      ...(scenario.engine === chromium ? { args: ['--no-sandbox'] } : {})
    });
    try {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: 844 }, isMobile: true,
        hasTouch: true, userAgent: scenario.ua
      });
      await context.addInitScript(({ standalone }) => {
        window.__permissions = [];
        window.__result = null;
        Object.defineProperty(navigator, 'standalone', {
          configurable: true, value: standalone
        });
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true, value: { ready: Promise.resolve({}) }
        });
        Object.defineProperty(window, 'PushManager', {
          configurable: true, value: function PushManager() {}
        });
        Object.defineProperty(window, 'Notification', {
          configurable: true, value: {
            permission: 'default',
            requestPermission() {
              window.__permissions.push('permission');
              return Promise.resolve('denied');
            }
          }
        });
      }, { standalone: scenario.standalone });
      const page = await context.newPage();
      const pageErrors = [];
      const privateApiRequests = [];
      page.on('pageerror', e => pageErrors.push(e.name));
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/')) {
          privateApiRequests.push('unwanted-api');
        }
      });
      await page.goto(base + '/', { waitUntil: 'load' });
      await page.locator('#push').click();
      await page.waitForFunction(() => window.__result !== null);
      const result = await page.evaluate(async () => ({
        value: await window.__result,
        count: window.__permissions.length
      }));
      assert.equal(result.count, scenario.permissionCalls);
      assert.ok(result.value.includes(scenario.expected), 'Unexpected permission gating result');
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(privateApiRequests, [], 'Denied permission must not enroll device');
      await context.close();
      console.log('MOBILE_QA_BROWSER:PASS:' + scenario.name);
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
