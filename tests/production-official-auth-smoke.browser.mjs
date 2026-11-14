/**
 * Read-only, unauthenticated production smoke test for mao520.com.
 * This cannot replace a real 001 login or Android/iPhone push acceptance.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = String(process.env.MAOMAO_PRODUCTION_URL || 'https://mao520.com').replace(/\/$/, '');
assert.equal(new URL(origin).hostname, 'mao520.com',
  'Do not run production smoke against a preview or a different domain');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const login = await page.goto(origin + '/account/index.html', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  assert.equal(login?.status(), 200, 'official login entry must load');
  assert.match(login?.headers()['content-type'] || '', /text\/html/);

  const status = await context.request.get(origin + '/api/admin/bootstrap/status', {
    maxRedirects: 0
  });
  assert.equal(status.status(), 200, 'actual same-origin account status API must load');
  const state = await status.json();
  assert.equal(state.ok, true);
  assert.equal(state.configured, true);
  assert.equal(state.initialized, true);

  for (const path of ['/api/accounts/me', '/api/admin/accounts']) {
    const response = await context.request.get(origin + path, { maxRedirects: 0 });
    assert.ok([401, 403].includes(response.status()),
      path + ' must reject unauthenticated requests: ' + response.status());
  }
  for (const path of ['/admin/admin-center.html', '/wallet/index.html']) {
    const response = await context.request.get(origin + path, { maxRedirects: 0 });
    assert.ok([302, 303, 307, 308, 401, 403].includes(response.status()),
      path + ' must not serve private HTML without a session: ' + response.status());
  }

  for (const path of ['/worker/lib/account-auth.js', '/worker/identity-authority-entry.js']) {
    const response = await context.request.get(origin + path, { maxRedirects: 0 });
    assert.notEqual(response.status(), 200, 'server-side source must not be public: ' + path);
  }
  console.log('PASS: mao520.com same-origin login status, private API/HTML gates and source isolation');
} finally {
  await browser.close();
}
