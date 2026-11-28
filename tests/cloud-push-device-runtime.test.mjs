import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { randomFillSync } from 'node:crypto';

const source = fs.readFileSync(new URL('../shared/js/cloud-push-client.js', import.meta.url), 'utf8');
const A = 'MAO-ABCDEFGHIJKL';
const B = 'MAO-MNOPQRSTUVWX';

function fixture() {
  const data = new Map();
  const calls = [];
  const errors = new Map();
  let accountId = A;
  let subscription = null;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  let serverSubscriptions = [];
  let collisionOnce = false;
  const localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); }
  };
  const pageElements = new Map([
    ['cloudPushToggle', { checked: false }],
    ['cloudStatusText', { textContent: '' }]
  ]);
  const document = {
    currentScript: { src: 'https://preview.mao520.com/shared/js/cloud-push-client.js' },
    querySelector: selector => selector === 'meta[name="mao-account-id"]'
      ? { getAttribute: () => accountId } : null,
    getElementById: id => pageElements.get(id) || null
  };
  const pushManager = {
    async getSubscription() { return subscription; },
    async subscribe() {
      subscribeCount++;
      subscription = {
        endpoint: 'https://push.example/sub-' + subscribeCount,
        expirationTime: null,
        getKey: () => Uint8Array.from([1, 2, 3, 4]).buffer,
        async unsubscribe() { unsubscribeCount++; subscription = null; return true; }
      };
      return subscription;
    }
  };
  const registration = { pushManager };
  const navigator = {
    userAgent: 'Android Chrome',
    serviceWorker: {
      async register() { return registration; },
      ready: Promise.resolve(registration),
      async getRegistration() { return registration; }
    }
  };
  const Notification = { permission: 'granted', async requestPermission() { return 'granted'; } };
  const window = {
    crypto: { getRandomValues: array => randomFillSync(array) },
    isSecureContext: true, Notification, PushManager: function PushManager() {},
    matchMedia: () => ({ matches: false })
  };
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, options });
    const explicitError = errors.get(method + ':' + url);
    if (explicitError) return {
      ok: false, status: explicitError.status || 503,
      json: async () => ({ ok: false, error: { code: explicitError.code || 'DOWN', message: 'unavailable' } })
    };
    if (url === '/api/push/subscriptions' && method === 'GET') {
      const key = options.headers?.['X-Device-Auth'] || '';
      if (key.includes('legacy-invalid')) return {
        ok: false, status: 403,
        json: async () => ({ ok: false, error: { code: 'DEVICE_ACCOUNT_MISMATCH' } })
      };
      return { ok: true, status: 200,
        json: async () => ({ ok: true, subscriptions: serverSubscriptions }) };
    }
    if (url === '/api/push/subscriptions' && method === 'POST' && collisionOnce) {
      collisionOnce = false;
      return { ok: false, status: 409,
        json: async () => ({ ok: false, error: { code: 'SUBSCRIPTION_IN_USE', message: 'already registered' } }) };
    }
    const payload = url === '/api/health' ? { vapidConfigured: true } :
      url === '/api/push/config' ? { publicKey: 'AQAB' } : {};
    return { ok: true, status: 200, json: async () => ({ ok: true, ...payload }) };
  };

  vm.runInNewContext(source, {
    window, document, navigator, Notification, localStorage, fetch, console,
    URL, Uint8Array, btoa, atob, setTimeout, clearTimeout, Date, JSON, Promise
  }, { filename: 'shared/js/cloud-push-client.js' });

  return {
    api: window.MaomaoCloud, data, calls, errors, pageElements,
    account(value) { accountId = value; },
    get subscription() { return subscription; },
    set subscription(value) { subscription = value; },
    set serverSubscriptions(value) { serverSubscriptions = value; },
    conflictOnce() { collisionOnce = true; },
    get subscribeCount() { return subscribeCount; },
    get unsubscribeCount() { return unsubscribeCount; }
  };
}

test('two signed-in accounts never share an unverified device credential', () => {
  const f = fixture();
  const a = f.api._internal.ensureDevice();
  assert.equal(f.data.has('cloud_device_v2:' + A), true);
  f.account(B);
  assert.equal(f.api._internal.readDevice(), null);
  const b = f.api._internal.ensureDevice();
  assert.notEqual(a.deviceId, b.deviceId);
  assert.equal(f.data.has('cloud_device_v2:' + B), true);
  f.account(A);
  assert.equal(f.api._internal.readDevice().deviceId, a.deviceId);
});

test('server-verified legacy device migrates only to its authenticated account', async () => {
  const f = fixture();
  const device = f.api._internal.ensureDevice();
  f.data.delete('cloud_device_v2:' + A);
  f.data.set('cloud_device_v1', JSON.stringify(device));
  const status = await f.api.getStatus();
  assert.equal(status.deviceRegistered, true);
  assert.equal(f.data.has('cloud_device_v1'), false);
  assert.equal(f.api._internal.readDevice().deviceId, device.deviceId);
  assert.equal(f.calls.some(c => c.url === '/api/push/subscriptions' &&
    c.options.headers['X-MAO-Account-Context'] === A), true);
});

test('failed server revoke keeps account device identity for a retry', async () => {
  const f = fixture();
  f.api._internal.ensureDevice();
  f.errors.set('POST:/api/devices/revoke', { status: 503, code: 'DOWN' });
  await assert.rejects(() => f.api.disconnect());
  assert.equal(f.data.has('cloud_device_v2:' + A), true);
});

test('failed server unsubscribe keeps local subscription instead of pretending OFF', async () => {
  const f = fixture();
  f.api._internal.ensureDevice();
  f.subscription = { endpoint: 'https://push.example/a', async unsubscribe() { throw new Error('should not call'); } };
  f.errors.set('POST:/api/push/unsubscribe', { status: 503, code: 'DOWN' });
  await assert.rejects(() => f.api.disablePush());
  assert.equal(f.unsubscribeCount, 0);
  assert.notEqual(f.subscription, null);
});

test('toggle is OFF when browser subscription is not this account device server endpoint', async () => {
  const f = fixture();
  f.api._internal.ensureDevice();
  f.subscription = { endpoint: 'https://push.example/A-device' };
  f.serverSubscriptions = [{ endpoint: 'https://push.example/B-device', disabledAt: null }];
  await f.api.refreshSettings();
  assert.equal(f.pageElements.get('cloudPushToggle').checked, false);
  f.serverSubscriptions = [{ endpoint: 'https://push.example/A-device', disabledAt: null }];
  await f.api.refreshSettings();
  assert.equal(f.pageElements.get('cloudPushToggle').checked, true);
});

test('subscription endpoint claimed by a previous account is replaced exactly once', async () => {
  const f = fixture();
  f.api._internal.ensureDevice();
  f.subscription = {
    endpoint: 'https://push.example/stale',
    getKey: () => Uint8Array.from([1, 2, 3]).buffer,
    async unsubscribe() { f.subscription = null; return true; }
  };
  f.conflictOnce();
  const result = await f.api.enablePush();
  assert.ok(result.endpoint.includes('/sub-1'));
  assert.equal(f.subscribeCount, 1);
  assert.equal(f.calls.filter(c => c.url === '/api/push/subscriptions' && c.method === 'POST').length, 2);
  assert.equal(f.calls.filter(c => c.options.headers?.['X-MAO-Account-Context'] !== A).length, 0);
});
