import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'chat/contacts/real-friends.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const A = 'MAO-AAAAAAAAAAAA';
const B = 'MAO-BBBBBBBBBBBB';
assert.ok(script, 'real friends mobile page needs an inline controller');

function createPhone() {
  const elements = [];
  const byId = new Map();
  const requests = [];
  const state = { switched: false, failRead: false, posted: [], badAck: false, deferRead: false, readWaiters: [], chatReadReply: null, chatReads: 0, intervalFn: null, friendshipId: 'request_generation_0001' };
  function element(tag, id = '') {
    const node = { tag, id, hidden: false, disabled: false, events: {},
      children: [], scrollHeight: 100, scrollTop: 0, style: {},
      appendChild(child) { this.children.push(child); },
      addEventListener(type, callback) { this.events[type] = callback; }
    };
    if (['input', 'textarea', 'button'].includes(tag)) node.value = '';
    let text = '';
    Object.defineProperty(node, 'textContent', {
      get() { return text; },
      set(value) { text = String(value); node.children = []; }
    });
    Object.defineProperty(node, 'innerHTML', {
      get() { return text; },
      set(value) { text = String(value); node.children = []; }
    });
    elements.push(node);
    return node;
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\bid="([^"]+)"/gi)) {
    byId.set(match[2], element(match[1].toLowerCase(), match[2]));
  }
  const get = id => byId.get(id);
  async function fetchMock(url, options) {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method: options.method, headers: { ...options.headers },
      credentials: options.credentials, cache: options.cache, body });
    let payload, status = 200;
    if (url === '/api/accounts/me') {
      if (state.switched) {
        status = 409;
        payload = { ok: false, error: { code: 'ACCOUNT_CONTEXT_CHANGED', message: 'session switched' } };
      } else {
        payload = { ok: true, account: { id: A, role: 'user', status: 'active', username: 'Alice' } };
      }
    } else if (url.startsWith('/api/social/friend-requests?')) {
      payload = { ok: true, ownerAccountId: A, requests: [] };
    } else if (url === '/api/social/friends') {
      payload = { ok: true, ownerAccountId: A,
        friends: [{ id: B, displayName: 'Bob' }] };
    } else if (url.startsWith('/api/social/chats/')) {
      if (options.method === 'POST') {
        state.posted.push(body);
        const message = { id: 'server-message-' + state.posted.length,
          senderId: A, recipientId: B, text: body.text };
        if (state.badAck) delete message.id;
        payload = { ok: true, friendshipId: state.friendshipId, message };
      } else if (state.failRead) {
        status = 503;
        payload = { ok: false, error: { code: 'TEMPORARY_FAILURE', message: 'read failed' } };
      } else {
        payload = { ok: true, ownerAccountId: A, peerId: B, friendshipId: state.friendshipId,
          messages: [{ id: 'remote-1', seq: 1, text: 'Private text', senderId: B, recipientId: A }],
          nextCursor: 1 };
      }
      if (options.method === 'GET') {
        state.chatReads++;
        if (state.chatReadReply) payload = state.chatReadReply;
        if (state.deferRead) await new Promise(resolve => state.readWaiters.push(resolve));
      }
    } else throw Error('Unexpected mobile HTTP request: ' + url);
    return { ok: status === 200, status, json: async () => payload };
  }
  const document = {
    visibilityState: 'visible',
    getElementById: get,
    createElement: tag => element(tag),
    events: {},
    addEventListener(event, fn) { this.events[event] = fn; }
  };
  const window = { crypto: webcrypto, events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  const location = { href: 'https://example.test/chat/contacts/real-friends.html',
    origin: 'https://example.test', pathname: '/chat/contacts/real-friends.html', search: '',
    reload() { state.reloads = (state.reloads || 0) + 1; } };
  vm.runInNewContext(script, { window, document, fetch: fetchMock, location,
    navigator: { clipboard: { writeText: async () => {} } }, crypto: webcrypto,
    URL, history: { replaceState() {} }, setInterval: fn => { state.intervalFn = fn; return 1; }, clearInterval() { state.intervalFn = null; },
    confirm: () => true, console }, { timeout: 2000, filename: 'real-friends.html' });
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return { get, elements, requests, state, window, settle, async openChat() {
    await this.settle();
    const button = elements.find(e => e.textContent === '聊天' && e.events.click);
    assert.ok(button, 'the approved friend must have a chat button');
    await button.events.click();
    await this.settle();
  } };
}

test('MAO mobile requests carry account ID on all authenticated friend/chat calls', async () => {
  const phone = createPhone();
  await phone.settle();
  assert.equal(phone.requests[0].url, '/api/accounts/me');
  assert.equal(phone.requests[0].headers['X-MAO-Account-Context'], undefined);
  const rest = phone.requests.slice(1);
  assert.ok(rest.some(r => r.url === '/api/social/friends'));
  assert.ok(rest.every(r => r.headers['X-MAO-Account-Context'] === A));
  assert.ok(phone.requests.every(r => r.cache === 'no-store' && r.credentials === 'same-origin'));
  await phone.openChat();
  assert.equal(phone.requests.at(-1).headers['X-MAO-Account-Context'], A);
});

test('a cookie account switch wipes rendered friends and private chat content', async () => {
  const phone = createPhone();
  await phone.openChat();
  assert.ok(phone.get('messages').children.some(x => x.textContent === 'Private text'));
  phone.state.switched = true;
  phone.get('refresh').events.click();
  await phone.settle();
  assert.equal(phone.get('messages').children.length, 0);
  assert.equal(phone.get('friends').children.length, 0);
  assert.equal(phone.get('chatPanel').hidden, true);
  assert.equal(phone.get('friendsSection').hidden, true);
  assert.equal(phone.get('inviteSection').hidden, true);
  assert.match(phone.get('accountLabel').textContent, /登录状态已变化/);
});

test('server-confirmed send survives a failed follow-up history refresh', async () => {
  const phone = createPhone();
  await phone.openChat();
  const input = phone.get('chatText');
  input.value = 'Hello from test';
  phone.state.failRead = true;
  await phone.get('chatForm').events.submit({ preventDefault() {} });
  await phone.settle();
  assert.equal(phone.state.posted.length, 1);
  assert.equal(input.value, '');
  assert.match(phone.get('status').textContent, /消息已发送，但聊天记录尚未刷新/);
});

test('ambiguous chat response keeps draft and retries with the same clientMessageId', async () => {
  const phone = createPhone();
  await phone.openChat();
  const input = phone.get('chatText');
  input.value = 'Retry safely';
  phone.state.badAck = true;
  await phone.get('chatForm').events.submit({ preventDefault() {} });
  assert.equal(input.value, 'Retry safely');
  assert.match(phone.get('status').textContent, /消息尚未确认/);
  phone.state.badAck = false;
  await phone.get('chatForm').events.submit({ preventDefault() {} });
  assert.equal(input.value, '');
  assert.equal(phone.state.posted.length, 2);
  assert.equal(phone.state.posted[0].clientMessageId, phone.state.posted[1].clientMessageId);
});

test('overlapping polling is serialized and repeated server messages never double-render', async () => {
  const phone = createPhone();
  await phone.openChat();
  const messages = phone.get('messages');
  assert.equal(messages.children.length, 1);
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B, friendshipId: phone.state.friendshipId,
    messages: [{ id: 'remote-2', seq: 2, text: 'One update', senderId: B, recipientId: A }],
    nextCursor: 2 };
  phone.state.deferRead = true;
  const before = phone.state.chatReads;
  phone.state.intervalFn();
  phone.state.intervalFn();
  await phone.settle();
  assert.equal(phone.state.chatReads - before, 1, 'concurrent polls must use a single request');
  assert.equal(phone.state.readWaiters.length, 1);
  phone.state.deferRead = false;
  phone.state.readWaiters.shift()();
  await phone.settle();
  assert.deepEqual(messages.children.map(n => n.textContent), ['Private text', 'One update']);
  phone.state.intervalFn();
  await phone.settle();
  assert.deepEqual(messages.children.map(n => n.textContent), ['Private text', 'One update'],
    'out-of-order duplicate responses must not draw the same message twice');
});

test('a late response from a previously closed chat cannot mutate a reopened same-peer chat', async () => {
  const phone = createPhone();
  await phone.openChat();
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B, friendshipId: phone.state.friendshipId,
    messages: [{ id: 'old-stale', seq: 2, text: 'Stale old request', senderId: B, recipientId: A }],
    nextCursor: 2 };
  phone.state.deferRead = true;
  phone.state.intervalFn();
  await phone.settle();
  assert.equal(phone.state.readWaiters.length, 1);
  phone.get('closeChat').events.click();
  phone.state.deferRead = false;
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B, friendshipId: phone.state.friendshipId,
    messages: [{ id: 'fresh-1', seq: 1, text: 'Fresh timeline', senderId: B, recipientId: A }],
    nextCursor: 1 };
  await phone.openChat();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Fresh timeline']);
  phone.state.readWaiters.shift()();
  await phone.settle();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Fresh timeline'],
    'old response from same peer must be discarded by conversation generation');
});

test('BFCache pagehide wipes private DOM before a different MAO account can see it', async () => {
  const phone = createPhone();
  await phone.openChat();
  assert.ok(phone.get('messages').children.some(x => x.textContent === 'Private text'));
  assert.equal(typeof phone.window.events.pagehide, 'function');
  phone.window.events.pagehide({});
  assert.equal(phone.get('messages').children.length, 0);
  assert.equal(phone.get('chatText').value, '');
  assert.equal(phone.get('friends').children.length, 0);
  assert.equal(phone.get('friendsSection').hidden, true);
  assert.equal(phone.get('chatPanel').hidden, true);
  assert.equal(phone.get('accountLabel').textContent, '登录状态已变化，请重新进入。');
  assert.equal(typeof phone.window.events.pageshow, 'function');
  phone.window.events.pageshow({ persisted: true });
  assert.equal(phone.state.reloads, 1);
});

test('a cookie switch during delayed chat polling cannot restore stale private messages', async () => {
  const phone = createPhone();
  await phone.openChat();
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B, friendshipId: phone.state.friendshipId,
    messages: [{ id: 'late-private', seq: 2, text: 'Must never appear', senderId: B, recipientId: A }],
    nextCursor: 2 };
  phone.state.deferRead = true;
  phone.state.intervalFn();
  await phone.settle();
  assert.equal(phone.state.readWaiters.length, 1);
  phone.state.switched = true;
  phone.get('refresh').events.click();
  await phone.settle();
  assert.equal(phone.get('chatPanel').hidden, true);
  assert.equal(phone.get('friendsSection').hidden, true);
  assert.equal(phone.get('messages').children.length, 0);
  phone.state.deferRead = false;
  phone.state.readWaiters.shift()();
  await phone.settle();
  assert.equal(phone.get('messages').children.length, 0,
    'an in-flight success from the previous cookie account must not restore any private text');
});

test('closing during the first history load cannot resurrect a hidden polling timer', async () => {
  const phone = createPhone();
  await phone.settle();
  phone.state.deferRead = true;
  const button = phone.elements.find(e => e.textContent === '聊天' && e.events.click);
  assert.ok(button);
  const opening = button.events.click();
  await phone.settle();
  assert.equal(phone.state.readWaiters.length, 1, 'first history request is still pending');
  phone.get('closeChat').events.click();
  assert.equal(phone.get('chatPanel').hidden, true);
  phone.state.deferRead = false;
  phone.state.readWaiters.shift()();
  await opening;
  await phone.settle();
  assert.equal(phone.state.intervalFn, null, 'closing the view must cancel any future polling');
  assert.equal(phone.get('messages').children.length, 0);
});

test('001 reapproval of the same peer hides old bubbles, resets cursor and clears stale draft', async () => {
  const phone = createPhone();
  await phone.openChat();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Private text']);
  phone.get('chatText').value = 'Unsent text from old relationship';
  phone.state.friendshipId = 'request_generation_0002';
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B,
    friendshipId: phone.state.friendshipId,
    messages: [{ id: 'new-scope-1', seq: 2, text: 'Newly approved chat', senderId: B, recipientId: A }],
    nextCursor: 2 };
  phone.state.intervalFn();
  await phone.settle();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Newly approved chat']);
  assert.equal(phone.get('chatText').value, '');
  assert.match(phone.get('status').textContent, /好友关系已重新审批/);
  assert.ok(phone.requests.some(request => request.url.endsWith('/messages?after=0')),
    'new relation must restart pagination from zero');
});

test('every mobile outgoing message declares current server friendship generation', async () => {
  const phone = createPhone();
  await phone.openChat();
  phone.get('chatText').value = 'Generation-bound text';
  await phone.get('chatForm').events.submit({ preventDefault() {} });
  assert.equal(phone.state.posted.length, 1);
  assert.equal(phone.state.posted[0].friendshipId, 'request_generation_0001');
});
