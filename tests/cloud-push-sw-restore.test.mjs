import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ACCOUNT = 'MAO-ABCDEFGHIJKL';
const OTHER = 'MAO-MNOPQRSTUVWX';

function harness({ account = ACCOUNT, status = 'active', online = true, existingWindow = null } = {}) {
  const handlers = new Map();
  const notifications = [];
  const opened = [];
  const requests = [];
  const focused = [];
  const registration = {
    scope: 'https://preview.mao520.com/',
    showNotification: async (title, options) => { notifications.push({ title, options }); }
  };
  const self = {
    registration,
    location: { origin: 'https://preview.mao520.com' },
    addEventListener: (name, callback) => handlers.set(name, callback),
    clients: {
      matchAll: async () => existingWindow ? [existingWindow] : [],
      openWindow: async url => { opened.push(url); return { url }; }
    },
    skipWaiting: async () => {},
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (!online) throw new Error('offline');
    return { ok: true, json: async () => ({ account: { id: account, status } }) };
  };
  vm.runInNewContext(source, { self, URL, fetch, caches: {}, Response, console });
  return { handlers, notifications, opened, requests, focused };
}

async function sendPush(h, payload) {
  let running;
  h.handlers.get('push')({
    data: { json: () => payload },
    waitUntil(p) { running = p; }
  });
  assert.ok(running, 'push work must be attached to event.waitUntil');
  await running;
}

async function clickNotice(h, data) {
  let running;
  h.handlers.get('notificationclick')({
    notification: { data, close() {} },
    waitUntil(p) { running = p; }
  });
  assert.ok(running, 'click work must be attached to event.waitUntil');
  await running;
}

test('private APIs bypass the shared app-shell cache', () => {
  const h = harness();
  let intercepted = false;
  h.handlers.get('fetch')({
    request: { method: 'GET', url: 'https://preview.mao520.com/api/accounts/me', mode: 'cors' },
    respondWith() { intercepted = true; }
  });
  assert.equal(intercepted, false);
});

test('authorized account shows generic lock-screen text and stores no URL', async () => {
  const h = harness();
  await sendPush(h, {
    accountId: ACCOUNT, type: 'chat_message',
    roleId: 'role-01',
    title: 'https://user-secret.example/private',
    body: 'Sensitive account name and complete chat log',
    url: 'https://user-secret.example/redirect',
    tag: 'chat-1',
    dedupeKey: 'outbound:msg-1'
  });
  assert.equal(h.notifications.length, 1);
  const notice = h.notifications[0];
  assert.equal(notice.title, '新消息');
  assert.equal(notice.options.body, '你有一条新消息，打开小手机查看。');
  assert.equal(notice.options.data.kind, 'chat_message');
  assert.equal(notice.options.data.roleId, 'role-01');
  assert.equal(notice.options.tag, 'chat-1');
  assert.equal(Object.prototype.hasOwnProperty.call(notice.options.data, 'url'), false);
  assert.doesNotMatch(JSON.stringify(notice), /user-secret|https?:\/\//i);
  assert.equal(h.requests[0].url, '/api/accounts/me');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
});

test('an authenticated notification click builds the only allowed chat route locally', async () => {
  const h = harness();
  await sendPush(h, { accountId: ACCOUNT, type: 'chat_message', roleId: 'role-01' });
  await clickNotice(h, h.notifications[0].options.data);
  assert.deepEqual(h.opened, ['https://preview.mao520.com/chat/chat/chat-detail.html?id=role-01']);
});

test('test notification is generic, contains no domain and opens only push settings', async () => {
  const h = harness();
  await sendPush(h, { accountId: ACCOUNT, type: 'test',
    title: 'confidential', body: 'https://secret.example', url: 'https://secret.example' });
  assert.equal(h.notifications[0].title, '推送测试');
  assert.equal(h.notifications[0].options.body, '测试通知已送达，打开小手机查看。');
  assert.doesNotMatch(JSON.stringify(h.notifications[0]), /https?:\/\//);
  await clickNotice(h, h.notifications[0].options.data);
  assert.deepEqual(h.opened, ['https://preview.mao520.com/settings/cloud-push.html']);
});

test('legacy URLs, external links and malformed role IDs are never click targets', async () => {
  const h = harness();
  await clickNotice(h, { accountId: ACCOUNT, url: 'https://external.example/phishing' });
  assert.deepEqual(h.opened, ['https://preview.mao520.com/index.html']);
  const safe = harness();
  await clickNotice(safe, { accountId: ACCOUNT, kind: 'chat_message', roleId: '../outside?token=x' });
  assert.deepEqual(safe.opened, ['https://preview.mao520.com/chat/chat/chat-detail.html?id=..%2Foutside%3Ftoken%3Dx']);
  const malformed = harness();
  await sendPush(malformed, { accountId: ACCOUNT, type: 'chat_message', roleId: 'bad\nrole' });
  assert.equal(malformed.notifications.length, 0);
});

test('account mismatch, disabled account, bad ID, invalid push type and offline suppress display', async () => {
  const payload = { accountId: ACCOUNT, type: 'chat_message', roleId: 'role-01' };
  for (const opts of [{ account: OTHER }, { status: 'disabled' }, { online: false }]) {
    const h = harness(opts);
    await sendPush(h, payload);
    assert.equal(h.notifications.length, 0);
  }
  const h = harness();
  await sendPush(h, { ...payload, accountId: 'owner' });
  await sendPush(h, { ...payload, type: 'unknown' });
  assert.equal(h.notifications.length, 0);
  assert.equal(h.requests.length, 0, 'invalid envelopes must not call account API');
});

test('notification click revalidates session before opening an installed or browser window', async () => {
  const switched = harness({ account: OTHER });
  await clickNotice(switched, { accountId: ACCOUNT, kind: 'chat_message', roleId: 'role-01' });
  assert.equal(switched.opened.length, 0);
  const offline = harness({ online: false });
  await clickNotice(offline, { accountId: ACCOUNT, kind: 'chat_message', roleId: 'role-01' });
  assert.equal(offline.opened.length, 0);
  let navigated = '';
  let didFocus = false;
  const pwa = harness({ existingWindow: {
    url: 'https://preview.mao520.com/index.html',
    async navigate(url) { navigated = url; return this; },
    async focus() { didFocus = true; }
  } });
  await clickNotice(pwa, { accountId: ACCOUNT, kind: 'chat_message', roleId: 'role-01' });
  assert.equal(navigated, 'https://preview.mao520.com/chat/chat/chat-detail.html?id=role-01');
  assert.equal(didFocus, true);
  assert.equal(pwa.opened.length, 0);
});

test('cache version advances and private HTML is network-only', () => {
  assert.match(source, /const CACHE_NAME = 'phone-app-pwa-v206'/);
  assert.match(source, /APP_SHELL\.concat\(pageEntries\)/);
  assert.ok(source.includes("fetch(req, { cache: 'no-store' })"));
  assert.match(source, /self\.addEventListener\('push'/);
  assert.match(source, /self\.addEventListener\('notificationclick'/);
});
