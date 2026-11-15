import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://maomao.invalid';

function page(text, { privateResponse = false, redirected = false } = {}) {
  const response = new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/html', ...(privateResponse ?
      { 'cache-control': 'private, no-store' } : {}) }
  });
  if (redirected) Object.defineProperty(response, 'redirected', { value: true });
  return response;
}

function harness({ server, cached } = {}) {
  const handlers = {}, fetched = [], puts = [], adds = [];
  let cacheLookups = 0;
  const sharedCache = {
    async put(request, response) { puts.push({ request, response }); },
    async add(path) { adds.push(path); },
    async match() { cacheLookups++; return cached || null; }
  };
  const caches = {
    async open() { return sharedCache; },
    async match(request) { cacheLookups++; return cached || null; },
    async keys() { return []; },
    async delete() { return true; }
  };
  const self = {
    location: new URL(origin + '/'),
    registration: { scope: origin + '/' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(name, handler) { handlers[name] = handler; }
  };
  const fetch = async (request, init) => {
    const url = typeof request === 'string' ? request : request.url;
    fetched.push({ url, init });
    if (url === './pwa-pages.json') return {
      ok: true, json: async () => ['chat/chat/chat-detail.html', 'account/index.html']
    };
    return server(url, init);
  };
  vm.runInNewContext(code, {
    self, caches, fetch, URL, Request, Response, Headers,
    setTimeout, clearTimeout, console
  });
  function navigate(path, mode = 'navigate') {
    const req = {
      method: 'GET', mode, url: origin + path,
      headers: new Headers()
    };
    const event = {
      request: req,
      tasks: [],
      respondWith(promise) { this.result = Promise.resolve(promise); },
      waitUntil(promise) { this.tasks.push(Promise.resolve(promise)); }
    };
    handlers.fetch(event);
    return event;
  }
  async function install() {
    let wait;
    handlers.install({ waitUntil(p) { wait = Promise.resolve(p); } });
    await wait;
  }
  return { navigate, install, fetched, puts, adds, get cacheLookups() { return cacheLookups; } };
}

test('private chat navigations always use authenticated network, never cached account HTML', async () => {
  const app = harness({
    cached: page('old account'),
    server: async () => page('current verified account', { privateResponse: true })
  });
  const event = app.navigate('/chat/chat/chat-detail.html');
  assert.equal(await (await event.result).text(), 'current verified account');
  assert.equal(app.cacheLookups, 0, 'private HTML cannot be served from shared caches');
  assert.equal(app.puts.length, 0, 'private HTML must never enter shared cache');
});

test('offline protected page cannot reveal old chat cache; only public login may appear', async () => {
  const app = harness({
    cached: page('public sign in'),
    server: async () => { throw Error('offline'); }
  });
  const event = app.navigate('/chat/chat/chat-detail.html');
  const result = await event.result;
  assert.equal(await result.text(), 'public sign in');
  assert.ok(app.cacheLookups >= 1);
});

test('redirected private content is never stored as a public login page', async () => {
  const app = harness({
    cached: null,
    server: async () => page('private logged-in app', { privateResponse: true, redirected: true })
  });
  const event = app.navigate('/account/index.html');
  const result = await event.result;
  await Promise.all(event.tasks);
  assert.equal(await result.text(), 'private logged-in app');
  assert.equal(app.puts.length, 0);
});

test('PWA installation excludes private and redirected login, but keeps public static JS', async () => {
  const app = harness({
    server: async path => path.endsWith('.html')
      ? page('redirected private', { redirected: true, privateResponse: true })
      : page('public')
  });
  await app.install();
  assert.equal(app.puts.length, 0, 'installer must not place protected HTML into app-shell');
  assert.ok(app.adds.some(x => x.endsWith('.js')), 'public static shell assets are still precached');
});
