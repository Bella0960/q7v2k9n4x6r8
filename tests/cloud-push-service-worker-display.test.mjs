import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('sw.js', 'utf8');
const ID = 'MAO-ABCDEFGHIJKLMNO';

function workerFixture(authenticated = true) {
  const handlers = {};
  const shown = [];
  const requests = [];
  const opened = [];
  const self = {
    location: { origin: 'https://founder.example' },
    registration: {
      scope: 'https://founder.example/',
      async showNotification(title, options) { shown.push({ title, options }); }
    },
    clients: {
      async matchAll() { return []; },
      async openWindow(url) { opened.push(url); return { url }; },
      claim() {}
    },
    addEventListener(type, fn) { handlers[type] = fn; },
    skipWaiting() {}
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return { account: {
          id: authenticated ? ID : 'MAO-PQRSTUVWXYZ123',
          status: 'active'
        }};
      }
    };
  };
  vm.runInNewContext(source, {
    self, caches: {}, fetch, URL, Response, Headers, Date, Promise, console
  }, { filename: 'sw.js' });
  const runPush = async payload => {
    let until;
    handlers.push({
      data: { json: () => payload },
      waitUntil(promise) { until = promise; }
    });
    assert.ok(until);
    await until;
  };
  return { handlers, shown, requests, opened, runPush };
}

test('cloud diagnostic is visible even when background cookies cannot be fetched', async () => {
  const fixture = workerFixture();
  await fixture.runPush({
    type: 'test', accountId: ID,
    title: 'SENSITIVE CONTENT MUST NOT APPEAR',
    body: 'PRIVATE DATA MUST NOT APPEAR',
    dedupeKey: 'demo-123'
  });
  assert.equal(fixture.requests.length, 0, 'test-only push must not depend on a cookie fetch');
  assert.equal(fixture.shown.length, 1);
  assert.equal(fixture.shown[0].title, 'MAOMAO · 云端测试通知');
  assert.ok(!JSON.stringify(fixture.shown[0]).includes('SENSITIVE'));
  assert.ok(!JSON.stringify(fixture.shown[0]).includes('PRIVATE'));
});

test('normal personal messages still require the active matching account', async () => {
  const fixture = workerFixture(true);
  await fixture.runPush({ type: 'message', accountId: ID, title: 'role message', body: 'private' });
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, '/api/accounts/me');
  assert.equal(fixture.requests[0].options.credentials, 'same-origin');
  assert.equal(fixture.shown.length, 1);
  assert.equal(fixture.shown[0].title, 'role message');
});

test('different account or malformed push must never expose role message', async () => {
  const mismatch = workerFixture(false);
  await mismatch.runPush({ type: 'message', accountId: ID, title: 'PRIVATE' });
  assert.equal(mismatch.shown.length, 0);
  const malformed = workerFixture(true);
  await malformed.runPush({ type: 'message', accountId: 'not-an-account', title: 'PRIVATE' });
  assert.equal(malformed.shown.length, 0);
});

test('clicking non-private diagnostic notification opens the sign-in guarded site', async () => {
  const fixture = workerFixture();
  let until;
  fixture.handlers.notificationclick({
    notification: {
      data: { type: 'test', url: 'https://founder.example/settings/cloud-push.html' },
      close() {}
    },
    waitUntil(p) { until = p; }
  });
  await until;
  assert.equal(fixture.opened.length, 1);
  assert.equal(fixture.opened[0], 'https://founder.example/settings/cloud-push.html');
  assert.equal(fixture.requests.length, 0);
});
