import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://maomao.test';

function response(body, policy) {
  return new Response(body, {
    status: 200, headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(policy ? { 'cache-control': policy } : {})
    }
  });
}

function harness({ cached = null, network, installNetwork } = {}) {
  const handlers = {};
  const stored = [];
  const removed = [];
  const preCached = [];
  const cache = {
    put: async (request, value) => stored.push({
      request: typeof request === 'string' ? request : request.url,
      policy: value.headers.get('cache-control')
    }),
    delete: async (request) => {
      removed.push(typeof request === 'string' ? request : request.url);
      return true;
    },
    add: async (url) => { preCached.push(url); },
    match: async () => cached
  };
  const caches = {
    match: async () => cached,
    open: async () => cache,
    keys: async () => [],
    delete: async () => true
  };
  const self = {
    location: new URL(origin + '/'),
    registration: { scope: origin + '/' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(name, handler) { handlers[name] = handler; }
  };
  const requests = [];
  const fetch = async (request, init) => {
    requests.push({ request, init });
    const url = typeof request === 'string' ? request : request.url;
    if (url === './pwa-pages.json') return {
      ok: true, json: async () => ['chat/chat/chat-detail.html', 'settings/settings.html']
    };
    if (installNetwork) return installNetwork(url, init);
    if (network) return network(url, init);
    throw new Error('offline');
  };
  vm.runInNewContext(source, {
    self, caches, fetch, Response, Request, Headers, URL, URLSearchParams,
    console, setTimeout, clearTimeout, Promise
  });
  function dispatchNavigate() {
    const request = { method: 'GET', mode: 'navigate', url: origin + '/chat/chat/chat-detail.html' };
    const event = {
      request, waits: [],
      respondWith(p) { this.response = Promise.resolve(p); },
      waitUntil(p) { this.waits.push(Promise.resolve(p)); }
    };
    handlers.fetch(event);
    return event;
  }
  function dispatchGet(path) {
    const request = { method: 'GET', mode: 'cors', url: origin + path };
    const event = {
      request,
      respondWith(p) { this.response = Promise.resolve(p); },
      waitUntil() {}
    };
    handlers.fetch(event);
    return event;
  }
  async function dispatchInstall() {
    const event = { waitUntil(p) { this.wait = Promise.resolve(p); } };
    handlers.install(event);
    await event.wait;
  }
  return { dispatchNavigate, dispatchGet, dispatchInstall, stored, removed, preCached, requests };
}

test('private cached account page is never shown offline to a different account', async () => {
  const app = harness({ cached: response('MAO-OTHER-ACCOUNT', 'private, no-store') });
  const event = app.dispatchNavigate();
  const reply = await event.response;
  await Promise.all(event.waits);
  assert.equal(reply.status, 503);
  assert.doesNotMatch(await reply.text(), /MAO-OTHER-ACCOUNT/);
  assert.equal(app.stored.length, 0);
});

test('network private account HTML is returned to the client but never cached', async () => {
  const app = harness({
    network: async () => response('account-scoped HTML', 'private, no-store, max-age=0')
  });
  const event = app.dispatchNavigate();
  const reply = await event.response;
  await Promise.all(event.waits);
  assert.equal(await reply.text(), 'account-scoped HTML');
  assert.equal(app.stored.length, 0);
  assert.equal(app.removed.length, 1, 'old cached authenticated HTML must be purged');
});

test('public app pages still preserve background cache updates', async () => {
  const app = harness({
    cached: response('offline public version'),
    network: async () => response('fresh public version')
  });
  const event = app.dispatchNavigate();
  assert.equal(await (await event.response).text(), 'offline public version');
  await Promise.all(event.waits);
  assert.equal(app.stored.length, 1);
});

test('PWA install skips private HTML while preserving public files in the app shell', async () => {
  const app = harness({
    installNetwork: async url => {
      if (/\.html$/.test(url) || url === './') return response('scoped', 'private, no-store');
      return response('public');
    }
  });
  await app.dispatchInstall();
  assert.ok(!app.stored.some(row => row.request.endsWith('.html')));
  assert.ok(app.preCached.some(path => path.endsWith('.js')));
});

test('account API GET bypasses the PWA cache even when an old response exists', async () => {
  const app = harness({
    cached: response('wrong-account-data', 'private, no-store'),
    network: async () => response('correct-account-data', 'private, no-store')
  });
  const event = app.dispatchGet('/api/mao/account/me');
  const result = await event.response;
  assert.equal(await result.text(), 'correct-account-data');
  assert.equal(app.stored.length, 0);
  assert.equal(app.requests.length, 1, 'must fetch the current server response');
});

test('private responses in static resource fallback are not served from CacheStorage', async () => {
  const app = harness({
    cached: response('old-private-response', 'private, no-store'),
    network: async () => response('new-private-response', 'private, no-store')
  });
  const event = app.dispatchGet('/shared/data/private-state.json');
  const result = await event.response;
  assert.equal(await result.text(), 'new-private-response');
  assert.equal(app.stored.length, 0);
});


test('redirected account sign-in HTML is never cached as the protected chat page', async () => {
  const login = response('登录入口');
  Object.defineProperty(login, 'redirected', { value: true });
  const app = harness({ network: async () => login });
  const event = app.dispatchNavigate();
  const result = await event.response;
  await Promise.all(event.waits);
  assert.equal(await result.text(), '登录入口', 'browser may follow the server redirect');
  assert.equal(app.stored.length, 0, 'login HTML must not be stored under /chat/chat/chat-detail.html');
});

test('install precache cannot save redirected login responses for protected HTML entries', async () => {
  const app = harness({
    installNetwork: async url => {
      const res = response(url.endsWith('.html') ? '登录入口' : '公共资源');
      if (url.endsWith('.html')) Object.defineProperty(res, 'redirected', { value: true });
      return res;
    }
  });
  await app.dispatchInstall();
  assert.ok(!app.stored.some(item => /\.html(?:[?#]|$)/.test(item.request)));
  assert.ok(app.preCached.some(item => item.endsWith('.js')));
});
