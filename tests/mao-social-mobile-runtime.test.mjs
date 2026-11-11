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
  const state = { switched: false, failRead: false, posted: [], badAck: false, deferRead: false, readWaiters: [], chatReadReply: null, chatReads: 0, intervalFn: null };
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
        payload = { ok: true, message };
      } else if (state.failRead) {
        status = 503;
        payload = { ok: false, error: { code: 'TEMPORARY_FAILURE', message: 'read failed' } };
      } else {
        payload = { ok: true, ownerAccountId: A, peerId: B,
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
  const window = { crypto: webcrypto, addEventListener() {} };
  const location = { href: 'https://example.test/chat/contacts/real-friends.html',
    origin: 'https://example.test', pathname: '/chat/contacts/real-friends.html', search: '' };
  vm.runInNewContext(script, { window, document, fetch: fetchMock, location,
    navigator: { clipboard: { writeText: async () => {} } }, crypto: webcrypto,
    URL, history: { replaceState() {} }, setInterval: fn => { state.intervalFn = fn; return 1; }, clearInterval() {},
    confirm: () => true, console }, { timeout: 2000, filename: 'real-friends.html' });
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return { get, elements, requests, state, settle, async openChat() {
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
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B,
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
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B,
    messages: [{ id: 'old-stale', seq: 2, text: 'Stale old request', senderId: B, recipientId: A }],
    nextCursor: 2 };
  phone.state.deferRead = true;
  phone.state.intervalFn();
  await phone.settle();
  assert.equal(phone.state.readWaiters.length, 1);
  phone.get('closeChat').events.click();
  phone.state.deferRead = false;
  phone.state.chatReadReply = { ok: true, ownerAccountId: A, peerId: B,
    messages: [{ id: 'fresh-1', seq: 1, text: 'Fresh timeline', senderId: B, recipientId: A }],
    nextCursor: 1 };
  await phone.openChat();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Fresh timeline']);
  phone.state.readWaiters.shift()();
  await phone.settle();
  assert.deepEqual(phone.get('messages').children.map(n => n.textContent), ['Fresh timeline'],
    'old response from same peer must be discarded by conversation generation');
});
