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
  async function dispatchInstall() {
    const event = { waitUntil(p) { this.wait = Promise.resolve(p); } };
    handlers.install(event);
    await event.wait;
  }
  return { dispatchNavigate, dispatchInstall, stored, removed, preCached, requests };
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
