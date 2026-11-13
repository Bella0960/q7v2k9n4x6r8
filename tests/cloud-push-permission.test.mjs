import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'shared/js/cloud-push-client.js'), 'utf8');

function createBrowser({ initialPermission = 'default', requestedPermission = 'granted' } = {}) {
  const calls = [];
  const values = new Map([['cloud_device_v1', JSON.stringify({
    deviceId: 'n'.repeat(22), secret: 's'.repeat(44), label: 'Test device'
  })]]);
  const localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k)
  };
  const Notification = {
    permission: initialPermission,
    requestPermission() {
      calls.push('permission');
      this.permission = requestedPermission;
      return Promise.resolve(requestedPermission);
    }
  };
  const window = { localStorage, Notification, PushManager: function PushManager() {}, isSecureContext: true };
  const document = { currentScript: { src: 'https://app.example/shared/js/cloud-push-client.js' } };
  const navigator = { serviceWorker: {}, userAgent: 'Android test browser' };
  const fetch = async () => {
    calls.push('network');
    throw new Error('MOCK_STOP_AFTER_NETWORK');
  };
  vm.runInNewContext(source, { window, self: window, document, navigator, Notification, URL, fetch, localStorage });
  return { cloud: window.MaomaoCloud, calls, Notification };
}

test('push enable requests notification permission before the device registration network call', async () => {
  const browser = createBrowser();
  await assert.rejects(browser.cloud.enablePush(), /MOCK_STOP_AFTER_NETWORK/);
  assert.deepEqual(browser.calls, ['permission', 'network']);
});

test('pair-and-subscribe requests permission within the original click gesture', async () => {
  const browser = createBrowser();
  await assert.rejects(browser.cloud.connectDeviceWithPairingCode('a'.repeat(48)), /MOCK_STOP_AFTER_NETWORK/);
  assert.deepEqual(browser.calls, ['permission', 'network']);
});

test('a blocked direct notification request never registers a new device', async () => {
  const browser = createBrowser({ requestedPermission: 'denied' });
  await assert.rejects(browser.cloud.enablePush(), /通知权限未开启/);
  assert.deepEqual(browser.calls, ['permission']);
});

test('existing granted permission does not prompt again', async () => {
  const browser = createBrowser({ initialPermission: 'granted' });
  await assert.rejects(browser.cloud.enablePush(), /MOCK_STOP_AFTER_NETWORK/);
  assert.deepEqual(browser.calls, ['network']);
});
