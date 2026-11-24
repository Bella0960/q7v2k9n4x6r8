import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const swSource = read('sw.js');
const atomicSource = read('shared/js/phone/chat-history-atomic.js');
const inboxSource = read('shared/js/cloud-push-atomic-inbox.js');
const appSource = read('worker/lib/app.js');
const clientSource = read('shared/js/cloud-push-client.js');
const ACCOUNT = 'MAO-ABCDEFGHIJKL';
const OTHER = 'MAO-MNOPQRSTUVWX';
const ROLE = 'role-synthetic';
const MESSAGE_ID = 'message_0000000000001';

function swHarness({ session = ACCOUNT, online = true } = {}) {
  const listeners = new Map(), notices = [], opened = [], requests = [];
  const self = {
    location: { origin: 'https://preview.mao520.com' },
    registration: {
      scope: 'https://preview.mao520.com/',
      async showNotification(title, data) { notices.push({ title, options: data }); }
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    skipWaiting: async () => {},
    clients: {
      matchAll: async () => [],
      openWindow: async url => { opened.push(url); }
    }
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (!online) throw Error('offline');
    return { ok: true, json: async () => ({
      account: { id: session, status: 'active' }
    }) };
  };
  runInNewContext(swSource, { self, URL, fetch, console, caches: {}, Response });
  return {
    notices, opened, requests,
    async push(payload, empty = false) {
      let task;
      listeners.get('push')({
        data: empty ? null : { json: () => payload },
        waitUntil(value) { task = value; }
      });
      assert.ok(task, 'push must use event.waitUntil');
      await task;
    },
    async click(data) {
      let task;
      listeners.get('notificationclick')({
        notification: { data, close() {} },
        waitUntil(value) { task = value; }
      });
      assert.ok(task, 'click must use event.waitUntil');
      await task;
    }
  };
}

test('v156 remote notification ignores injected URLs, title, body, profile; opens safe in-app chat', async () => {
  const h = swHarness();
  await h.push({ type: 'chat_message', accountId: ACCOUNT, roleId: ROLE,
    url: 'https://secret.example.com/credentials',
    title: 'secret', body: 'secret conversation',
    tag: 'safe_test_01' });
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].title, '新消息');
  assert.equal(h.notices[0].options.body, '你有一条新消息，打开小手机查看。');
  assert.deepEqual(Object.keys(h.notices[0].options.data).sort(),
    ['accountId', 'kind', 'roleId']);
  assert.doesNotMatch(JSON.stringify(h.notices[0]), /https?:\/\/|secret|credentials|conversation/);
  await h.click({ ...h.notices[0].options.data, url: 'https://external.invalid/hijack' });
  assert.deepEqual(h.opened, [
    'https://preview.mao520.com/chat/chat/chat-detail.html?id=role-synthetic'
  ]);
});

test('empty and explicit diagnostics are link-free even when sleeping PWA has no cookie', async () => {
  const h = swHarness({ session: OTHER, online: false });
  await h.push(null, true);
  await h.push({ type: 'test', body: 'PRIVATE', url: 'https://external.invalid' });
  assert.equal(h.notices.length, 2);
  for (const notice of h.notices) {
    assert.equal(notice.title, '推送测试');
    assert.deepEqual(JSON.parse(JSON.stringify(notice.options.data)), { kind: 'test' });
    assert.doesNotMatch(JSON.stringify(notice), /https?:\/\/|PRIVATE|external/);
  }
  await h.click(h.notices[0].options.data);
  assert.deepEqual(h.opened, ['https://preview.mao520.com/settings/cloud-push.html']);
  assert.equal(h.requests.length, 0);
});

test('session switch and invalid role suppress chat notices and click; legacy URL never opens external site', async () => {
  const h = swHarness({ session: OTHER });
  await h.push({ type: 'chat_message', accountId: ACCOUNT, roleId: ROLE });
  assert.equal(h.notices.length, 0);
  await h.click({ kind: 'chat_message', accountId: ACCOUNT, roleId: ROLE });
  assert.deepEqual(h.opened, []);
  const active = swHarness();
  await active.click({ accountId: ACCOUNT, url: 'https://external.invalid/private' });
  assert.deepEqual(active.opened, ['https://preview.mao520.com/index.html']);
  await active.push({ type: 'chat_message', accountId: ACCOUNT, roleId: 'role\nwrong' });
  assert.equal(active.notices.length, 0);
});

function localHarness({ initial = [{ role: 'user', text: 'original', mid: 'first' }],
  quota = false, account = ACCOUNT, scope = true } = {}) {
  const values = new Map();
  if (initial !== undefined) values.set('chat_history_' + ROLE, JSON.stringify(initial));
  const storage = {
    getItem(k) { return values.has(k) ? values.get(k) : null; },
    setItem(k,v) {
      if (quota) { const err = Error('quota exceeded'); err.name = 'QuotaExceededError'; throw err; }
      values.set(k, String(v));
    }
  };
  const document = {
    visibilityState: 'visible',
    querySelector: q => q === 'meta[name="mao-account-id"]' ? { content: account } : null,
    addEventListener() {}, removeEventListener() {}
  };
  const locks = { requests: [], async request(name, options, callback) {
    assert.equal(options.mode, 'exclusive');
    this.requests.push(name);
    return callback();
  } };
  const navigator = { locks, onLine: true };
  const win = {
    document, navigator, localStorage: storage,
    __MAO_ACCOUNT_SCOPE__: scope ? { accountId: account, ready: true } : undefined,
    setInterval: () => 1, clearInterval() {},
    addEventListener() {}, removeEventListener() {}
  };
  runInNewContext(atomicSource, { window: win });
  runInNewContext(inboxSource, { window: win, console });
  let pending = {
    serverMessageId: MESSAGE_ID, characterId: ROLE,
    payload: { type: 'text', text: 'synthetic reply' }, createdAt: 1732400000000
  };
  let acked = 0, rendered = 0;
  const cloud = {
    _internal: { readDevice: () => ({ deviceId: 'synthetic-device' }) },
    async receiveCharacterOutboundMessages(role, persist, limit) {
      assert.equal(role, ROLE);
      assert.equal(limit, 10);
      if (await persist(pending.payload, pending)) acked++;
      return { saved: acked };
    }
  };
  const inbox = win.MaomaoCloudAtomicInbox.create({
    accountId: ACCOUNT, roleId: ROLE, cloud,
    verifySession: async () => account === ACCOUNT,
    onSaved: () => rendered++
  });
  return {
    inbox, storage, locks, values,
    get acked() { return acked; },
    get rendered() { return rendered; },
    quota(value) { quota = value; },
    pending(value) { pending = value; }
  };
}

test('cloud inbox uses existing v156 atomic writer and ACKs only after exact readback', async () => {
  const f = localHarness();
  await f.inbox.sync();
  const rows = JSON.parse(f.storage.getItem('chat_history_' + ROLE));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mid, 'first');
  assert.equal(rows[1].mid, 'cloud_' + MESSAGE_ID);
  assert.equal(rows[1].serverMessageId, MESSAGE_ID);
  assert.equal(rows[1].text, 'synthetic reply');
  assert.equal(f.acked, 1);
  assert.equal(f.rendered, 1);
  assert.ok(f.locks.requests.every(name =>
    name === 'maomao:chat-history:' + encodeURIComponent(ACCOUNT) + ':' + ROLE));
  await f.inbox.sync();
  assert.equal(f.acked, 2);
  assert.equal(f.rendered, 1);
  assert.equal(JSON.parse(f.storage.getItem('chat_history_' + ROLE)).length, 2);
});

test('corrupt, missing, quota-limited history and wrong account fail closed with zero ACK', async () => {
  const corrupted = localHarness();
  corrupted.values.set('chat_history_' + ROLE, '{broken');
  await corrupted.inbox.sync();
  assert.equal(corrupted.acked, 0);
  assert.equal(corrupted.storage.getItem('chat_history_' + ROLE), '{broken');
  const missing = localHarness({ initial: undefined });
  missing.values.delete('chat_history_' + ROLE);
  await missing.inbox.sync();
  assert.equal(missing.acked, 0);
  const full = localHarness({ quota: true });
  await full.inbox.sync();
  assert.equal(full.acked, 0);
  assert.equal(JSON.parse(full.storage.getItem('chat_history_' + ROLE)).length, 1);
  const wrong = localHarness({ account: OTHER });
  await wrong.inbox.sync();
  assert.equal(wrong.acked, 0);
  const unavailable = localHarness({ scope: false });
  await unavailable.inbox.sync();
  assert.equal(unavailable.acked, 0);
});

test('role mismatch and serverMessageId conflict never append or ACK', async () => {
  const wrongRole = localHarness();
  wrongRole.pending({ serverMessageId: MESSAGE_ID, characterId: 'another-role',
    payload: { type: 'text', text: 'private' } });
  await wrongRole.inbox.sync();
  assert.equal(wrongRole.acked, 0);
  const dup = localHarness({ initial: [
    { mid: 'cloud_' + MESSAGE_ID, serverMessageId: MESSAGE_ID,
      role: 'assistant', text: 'different', source: 'cloud_autonomous' }
  ] });
  await dup.inbox.sync();
  assert.equal(dup.acked, 0);
  assert.equal(JSON.parse(dup.storage.getItem('chat_history_' + ROLE)).length, 1);
});

test('actual v156 server builder never exports website URL or lock-screen chat text', () => {
  const start = appSource.indexOf('export function buildOutboundPushPayload(');
  const end = appSource.indexOf('\n}\n\n/**\n * Send due notifications', start);
  assert.ok(start !== -1 && end > start);
  const isolated = appSource.slice(start, end + 2).replace(/^export /, '');
  const builder = new Function('OWNER_USER_ID', isolated +
    '\nreturn buildOutboundPushPayload;')(ACCOUNT);
  const payload = builder({
    characterId: ROLE, serverMessageId: MESSAGE_ID, timestamp: 1732400000000,
    accountId: ACCOUNT
  });
  assert.equal(payload.roleId, ROLE);
  for (const key of ['url', 'href', 'link', 'title', 'body', 'text']) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, key), false, key);
  }
  assert.doesNotMatch(JSON.stringify(payload), /https?:\/\/|\.html|[?&]id=/i);
});

test('iPhone/iPad installed-standalone requirement and existing gesture-first permission stay in v156 client', () => {
  assert.match(clientSource, /!isAppleMobile\(\) \|\| isStandaloneApp\(\)/);
  const gesture = clientSource.indexOf('async function requestPushPermissionFromGesture()');
  const enable = clientSource.indexOf('async function enablePush(userInitiated, enrollmentToken)');
  const prerequisite = clientSource.indexOf('var prerequisites = await preparePushPrerequisites()', enable);
  assert.ok(gesture > -1 && enable > gesture && prerequisite > enable);
  assert.match(clientSource.slice(enable, prerequisite), /requestPushPermissionFromGesture\(\)/);
});
