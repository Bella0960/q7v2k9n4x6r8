import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/js/mao-account-scope.js', import.meta.url), 'utf8');
const A = 'MAO-ABCDEFGHIJKL';
const B = 'MAO-MNOPQRSTUVWX';

function nativeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get length() { return values.size; },
    key(i) { return Array.from(values.keys())[i] ?? null; },
    getItem(k) { return values.has(String(k)) ? values.get(String(k)) : null; },
    setItem(k,v) { values.set(String(k), String(v)); },
    removeItem(k) { values.delete(String(k)); },
    clear() { values.clear(); }
  };
}

function run({ account = A, role = 'user', storage = nativeStorage(), indexedDB = true, caches = true } = {}) {
  const messages = [];
  const requests = [];
  const loaded = [];
  let blocked = false;
  const fakeDocument = {
    querySelector(selector) {
      if (selector === 'meta[name="mao-account-id"]') return { content: account };
      if (selector === 'meta[name="mao-account-role"]') return { content: role };
      return null;
    },
    addEventListener() {},
    open() { blocked = true; },
    write(html) { messages.push(html); },
    close() {}
  };
  const local = storage;
  const w = {
    location: { href: 'https://preview.mao520.com/index.html',
      origin: 'https://preview.mao520.com', replace() {} },
    Headers, URL, fetch: async (target, init = {}) => {
      requests.push({ target, init });
      return { ok: true, json: async () => ({
        account: { id: account, role, status: 'active' }
      }) };
    },
    stop() {}, addEventListener() {}, setInterval() {},
    localStorage: local, sessionStorage: nativeStorage(),
    indexedDB: indexedDB ? {
      open(name) { loaded.push({ kind: 'idb', name }); return name; },
      deleteDatabase(name) { return name; },
      databases: async () => []
    } : null,
    caches: caches ? {
      open(name) { loaded.push({ kind: 'cache', name }); return Promise.resolve({}); },
      keys: async () => []
    } : null
  };
  vm.runInNewContext(source, { window: w, document: fakeDocument,
    console: { error() {} }, Headers, URL });
  return { window: w, storage: local, requests, loaded, blocked, messages };
}

test('different normal accounts cannot read or erase each other localStorage', () => {
  const physical = nativeStorage({ creator_key: 'creator data' });
  const a = run({ account: A, storage: physical });
  const b = run({ account: B, storage: physical });
  assert.equal(a.window.__MAO_ACCOUNT_SCOPE__.ready, true);
  assert.equal(b.window.__MAO_ACCOUNT_SCOPE__.ready, true);
  a.window.localStorage.setItem('chat_history_role1', 'A chat');
  b.window.localStorage.setItem('chat_history_role1', 'B chat');
  assert.equal(a.window.localStorage.getItem('chat_history_role1'), 'A chat');
  assert.equal(b.window.localStorage.getItem('chat_history_role1'), 'B chat');
  assert.equal(a.window.localStorage.getItem('creator_key'), null);
  a.window.localStorage.clear();
  assert.equal(b.window.localStorage.getItem('chat_history_role1'), 'B chat');
  assert.equal(physical.getItem('creator_key'), 'creator data');
});

test('creator stays on original unscoped data and no automatic data migration runs', () => {
  const physical = nativeStorage({ chat_history_old: 'original' });
  const creator = run({ account: A, role: 'super_admin', storage: physical });
  assert.equal(creator.window.__MAO_ACCOUNT_SCOPE__.ready, true);
  assert.equal(creator.window.localStorage.getItem('chat_history_old'), 'original');
  const secondary = run({ account: B, storage: physical });
  assert.equal(secondary.window.localStorage.getItem('chat_history_old'), null);
  assert.equal(physical.getItem('chat_history_old'), 'original');
});

test('account scope must remain not ready when storage isolation initialization fails', () => {
  const f = run({ indexedDB: false });
  assert.equal(f.window.__MAO_ACCOUNT_SCOPE__, undefined);
  assert.equal(f.blocked, true);
});

test('invalid account role is rejected before accessing storage', () => {
  const f = run({ role: 'guest' });
  assert.equal(f.window.__MAO_ACCOUNT_SCOPE__, undefined);
});

test('same-origin fetches are account-bound while external API calls are not modified', async () => {
  const f = run();
  await f.window.fetch('/api/health', { method: 'GET' });
  const request = f.requests.at(-1);
  assert.equal(request.init.headers.get('x-mao-account-context'), A);
  await f.window.fetch('https://api.example.com/models', { method: 'GET' });
  const external = f.requests.at(-1);
  assert.equal(external.init.headers, undefined);
});

test('normal accounts namespace IndexedDB and browser CacheStorage independently', async () => {
  const f = run();
  f.window.indexedDB.open('maomao-assets');
  await f.window.caches.open('imported-fonts');
  const prefix = '__mao_account_v1__' + encodeURIComponent(A) + '__';
  assert.deepEqual(f.loaded, [
    { kind: 'idb', name: prefix + 'maomao-assets' },
    { kind: 'cache', name: prefix + 'imported-fonts' }
  ]);
});
