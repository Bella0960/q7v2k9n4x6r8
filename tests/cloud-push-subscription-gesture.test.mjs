/** PUSH-DEVICE-001 — browser gesture, device persistence and existing QA test push. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const clientSource = readFileSync(new URL('../shared/js/cloud-push-client.js', import.meta.url), 'utf8');
const base64url = bytes => Buffer.from(bytes).toString('base64url');
const key = base64url(Uint8Array.from([4, ...Array(64).fill(7)]));

function harness({ storageFails = false, permission = 'default' } = {}) {
  const events = [];
  const saved = new Map();
  const notification = {
    permission,
    async requestPermission() {
      events.push('permission');
      this.permission = 'granted';
      return 'granted';
    }
  };
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-push-device',
    expirationTime: null,
    getKey(kind) {
      return Uint8Array.from(kind === 'p256dh'
        ? [4, ...Array(64).fill(9)] : Array(16).fill(11)).buffer;
    }
  };
  let currentSub = null;
  const registration = {
    pushManager: {
      async getSubscription() {
        events.push('browser-get-subscription');
        return currentSub;
      },
      async subscribe(options) {
        events.push('browser-subscribe');
        assert.equal(options.userVisibleOnly, true);
        assert.equal(Buffer.from(options.applicationServerKey).toString('base64url'), key);
        currentSub = subscription;
        return subscription;
      }
    }
  };
  const navigator = {
    userAgent: 'MAOMAO Android Chrome test',
    serviceWorker: {
      async register(path, options) {
        events.push('register-sw');
        assert.equal(path, '/sw.js');
        assert.equal(options.updateViaCache, 'none');
        return registration;
      },
      ready: Promise.resolve(registration),
      async getRegistration() { return registration; }
    }
  };
  const toggle = {
    checked: false,
    disabled: false,
    addEventListener(event, callback) {
      if (event === 'change') this.changed = callback;
    }
  };
  const document = {
    currentScript: { src: 'https://preview.mao520.com/shared/js/cloud-push-client.js' },
    getElementById(id) { return id === 'cloudPushToggle' ? toggle : null; },
    addEventListener() {}
  };
  const localStorage = {
    getItem(k) { return saved.has(k) ? saved.get(k) : null; },
    setItem(k, v) {
      if (storageFails) throw Error('QuotaExceededError');
      saved.set(k, String(v));
    },
    removeItem(k) { saved.delete(k); }
  };
  const fetch = async (path, init = {}) => {
    events.push(path);
    const body = init.body ? JSON.parse(init.body) : null;
    let result;
    switch (path) {
      case '/api/health': result = { ok: true, vapidConfigured: true }; break;
      case '/api/push/config': result = { ok: true, publicKey: key }; break;
      case '/api/devices/register':
        assert.ok(body.deviceId && body.secret);
        assert.ok(saved.has('cloud_device_v1'), 'client must persist device before registration');
        result = { ok: true, device: { id: body.deviceId } };
        break;
      case '/api/push/subscriptions':
        assert.equal(body.subscription.endpoint, subscription.endpoint);
        assert.ok(init.headers['X-Device-Auth']);
        result = { ok: true, subscription: { id: 'stored' } };
        break;
      case '/api/push/test':
        assert.ok(init.headers['X-Device-Auth']);
        assert.equal(body.deliveryMode, 'encrypted');
        result = { ok: true, summary: { sent: 1 } };
        break;
      default: throw Error('Unexpected cloud endpoint ' + path);
    }
    return { ok: true, status: 200, json: async () => result };
  };
  const window = {
    location: { hostname: 'preview.mao520.com' },
    crypto: webcrypto,
    isSecureContext: true,
    PushManager: class PushManager {},
    Notification: notification
  };
  const context = {
    window, document, navigator, Notification: notification,
    localStorage, URL, fetch, Uint8Array,
    atob: str => Buffer.from(str, 'base64').toString('binary'),
    btoa: str => Buffer.from(str, 'binary').toString('base64'),
    console: { warn() {} }
  };
  runInNewContext(clientSource, context, { filename: 'cloud-push-client.js' });
  return { api: window.MaomaoCloud, events, toggle, saved };
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('Settings prewarms public VAPID key and SW without requesting permission or enrolling a device', async () => {
  const h = harness();
  await h.api.mountSettings();
  await settle();
  assert.ok(h.events.includes('register-sw'));
  assert.ok(h.events.includes('/api/push/config'));
  assert.ok(h.events.includes('/api/health'));
  assert.ok(!h.events.includes('permission'));
  assert.ok(!h.events.includes('browser-subscribe'));
  assert.ok(!h.events.includes('/api/devices/register'));
});

test('user gesture precedes browser subscribe; device enroll and durable subscription precede remote test push', async () => {
  const h = harness();
  await h.api.mountSettings();
  await settle();
  const enabled = await h.api.enablePush();
  assert.equal(enabled.endpoint, 'https://fcm.googleapis.com/fcm/send/test-push-device');
  const i = name => h.events.indexOf(name);
  assert.ok(i('permission') < i('browser-subscribe'));
  assert.ok(i('browser-subscribe') < i('/api/devices/register'));
  assert.ok(i('/api/devices/register') < i('/api/push/subscriptions'));
  assert.ok(h.saved.has('cloud_device_v1'));
  const response = await h.api.sendTestPush();
  assert.equal(response.summary.sent, 1);
  assert.ok(i('/api/push/subscriptions') < i('/api/push/test'));
  assert.ok(!h.events.some(event => String(event).includes('/api/autonomy/')));
});

test('full localStorage keeps device disconnected; no device or subscription is falsely saved on the server', async () => {
  const h = harness({ storageFails: true, permission: 'granted' });
  await assert.rejects(h.api.enablePush(), /设备凭据未能保存到本机/);
  assert.ok(!h.events.includes('/api/devices/register'));
  assert.ok(!h.events.includes('/api/push/subscriptions'));
  assert.ok(!h.events.includes('/api/push/test'));
});

test('existing browser subscription is reused rather than requesting another system permission', async () => {
  const h = harness({ permission: 'granted' });
  await h.api.enablePush();
  await h.api.enablePush();
  assert.equal(h.events.filter(e => e === 'permission').length, 0);
  assert.equal(h.events.filter(e => e === 'browser-subscribe').length, 1);
  assert.equal(h.events.filter(e => e === '/api/push/subscriptions').length, 2);
});
