import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ACCOUNT = 'MAO-ABCDEFGHIJKL';
const OTHER = 'MAO-MNOPQRSTUVWX';

function harness({ account = ACCOUNT, status = 'active', online = true } = {}) {
  const handlers = new Map();
  const notifications = [];
  const opened = [];
  const requests = [];
  const registration = {
    scope: 'https://preview.mao520.com/',
    showNotification: async (title, options) => { notifications.push({ title, options }); }
  };
  const self = {
    registration,
    location: { origin: 'https://preview.mao520.com' },
    addEventListener: (name, callback) => handlers.set(name, callback),
    clients: {
      matchAll: async () => [],
      openWindow: async url => { opened.push(url); return { url }; }
    },
    skipWaiting: async () => {},
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (!online) throw new Error('offline');
    return {
      ok: true,
      json: async () => ({ account: { id: account, status } })
    };
  };
  vm.runInNewContext(source, { self, URL, fetch, caches: {}, Response, console });
  return { handlers, notifications, opened, requests };
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

test('authorized account receives a content-free system notification with a safe chat target', async () => {
  const h = harness();
  await sendPush(h, {
    accountId: ACCOUNT,
    type: 'chat_message',
    title: '新消息',
    body: '有一位角色刚刚联系你，打开聊天查看。',
    url: './chat/chat/chat-detail.html?id=role-01',
    tag: 'chat-1',
    dedupeKey: 'outbound:msg-1'
  });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].title, '新消息');
  assert.match(h.notifications[0].options.data.url, /^https:\/\/preview\.mao520\.com\/chat\/chat\/chat-detail\.html\?id=role-01$/);
  assert.equal(h.notifications[0].options.tag, 'chat-1');
  assert.equal(h.requests[0].url, '/api/accounts/me');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
});

test('account mismatch, disabled account, malformed recipient and offline all suppress display', async () => {
  for (const opts of [{ account: OTHER }, { status: 'disabled' }, { online: false }]) {
    const h = harness(opts);
    await sendPush(h, { accountId: ACCOUNT, url: './index.html' });
    assert.equal(h.notifications.length, 0);
  }
  const h = harness();
  await sendPush(h, { accountId: 'owner', url: './index.html' });
  assert.equal(h.notifications.length, 0);
  assert.equal(h.requests.length, 0, 'invalid targets should not perform a network request');
});

test('notification clicks recheck account session and reject external navigation', async () => {
  const h = harness();
  await clickNotice(h, { accountId: ACCOUNT, url: 'https://external.example/phishing' });
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0], 'https://preview.mao520.com/index.html');

  const switched = harness({ account: OTHER });
  await clickNotice(switched, { accountId: ACCOUNT, url: './chat/chat/chat-detail.html?id=role-01' });
  assert.equal(switched.opened.length, 0);
});

test('cache version and existing navigation remain unchanged in this isolated patch', () => {
  assert.match(source, /const CACHE_NAME = 'phone-app-pwa-v206'/);
  assert.match(source, /APP_SHELL\.concat\(pageEntries\)/);
  assert.match(source, /fetch\\(req, \\{ cache: 'no-store' \\}\\)/);
  assert.match(source, /self\.addEventListener\('push'/);
  assert.match(source, /self\.addEventListener\('notificationclick'/);
});
