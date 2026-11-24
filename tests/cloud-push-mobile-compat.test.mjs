import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clientSource = fs.readFileSync(new URL('../shared/js/cloud-push-client.js', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../worker/lib/app.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const accountId = 'MAO-ABCDEFGHIJKL';

function mobileFixture({ ua, standalone = false, platform = '', touchPoints = 0,
  permission = 'default' } = {}) {
  let permissionsRequested = 0;
  let networkRequests = 0;
  let eventOrder = [];
  const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const Notification = {
    permission,
    requestPermission() {
      permissionsRequested += 1;
      eventOrder.push('permission');
      return Promise.resolve('denied');
    }
  };
  const document = {
    currentScript: { src: 'https://preview.mao520.com/shared/js/cloud-push-client.js' },
    querySelector: selector => selector === 'meta[name="mao-account-id"]'
      ? { getAttribute: () => accountId } : null,
    getElementById: () => null
  };
  const navigator = {
    userAgent: ua || 'Mozilla/5.0 (Linux; Android 15) Chrome/131',
    platform, maxTouchPoints: touchPoints,
    standalone, serviceWorker: { register() {}, ready: Promise.resolve({}) }
  };
  const window = {
    PushManager: function PushManager() {},
    Notification,
    matchMedia: () => ({ matches: standalone }),
    isSecureContext: true
  };
  const fetch = async () => {
    networkRequests++;
    eventOrder.push('network');
    throw Error('Network must not run before permission');
  };
  vm.runInNewContext(clientSource, {
    window, document, navigator, Notification, localStorage, fetch,
    URL, Uint8Array, btoa, atob, setTimeout, clearTimeout, Date, JSON, Promise, console
  });
  return {
    api: window.MaomaoCloud,
    get requested() { return permissionsRequested; },
    get network() { return networkRequests; },
    get eventOrder() { return eventOrder; }
  };
}

test('iOS Safari browser tab refuses push subscription and gives Home Screen instructions', async () => {
  const f = mobileFixture({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit' });
  const status = await f.api.getStatus();
  assert.equal(status.supported, false);
  assert.match(status.message, /Safari.*主屏幕/);
  await assert.rejects(() => f.api.enablePush(), /Safari.*主屏幕/);
  assert.equal(f.requested, 0);
  assert.equal(f.network, 0);
});

test('installed iPhone asks permission immediately inside click before any network', async () => {
  const f = mobileFixture({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit',
    standalone: true
  });
  const promise = f.api.enablePush();
  assert.deepEqual(f.eventOrder, ['permission'], 'permission must be requested synchronously with the gesture');
  await assert.rejects(() => promise, /通知权限未开启/);
  assert.equal(f.network, 0);
});

test('iPadOS desktop-identification mode still requires Home Screen context', async () => {
  const f = mobileFixture({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit',
    platform: 'MacIntel', touchPoints: 5
  });
  const status = await f.api.getStatus();
  assert.equal(status.supported, false);
  assert.match(status.message, /主屏幕/);
});

test('Android Chrome requires no installed PWA to request permission', async () => {
  const f = mobileFixture({ ua: 'Mozilla/5.0 (Linux; Android 15) Chrome/131' });
  const promise = f.api.enablePush();
  assert.deepEqual(f.eventOrder, ['permission']);
  await assert.rejects(() => promise, /通知权限未开启/);
  assert.equal(f.network, 0);
});

test('PWA manifest provides one scoped installed Home Screen app for iOS/Android', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1);
});

