import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = process.cwd();
const scopeSource = fs.readFileSync(root + '/shared/js/mao-account-scope.js', 'utf8');
const workerSource = fs.readFileSync(root + '/worker.js', 'utf8');
const appSource = fs.readFileSync(root + '/worker/lib/app.js', 'utf8');
const serviceWorkerSource = fs.readFileSync(root + '/sw.js', 'utf8');
const fontLoaderSource = fs.readFileSync(root + '/shared/js/font-loader.js', 'utf8');

function makeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    snapshot() { return new Map(values); }
  };
}

function createNativeCacheStorage() {
  const entries = new Map();
  const calls = [];
  const storage = {
    calls,
    async open(name) {
      const key = String(name);
      calls.push(['open', key]);
      if (!entries.has(key)) {
        entries.set(key, {
          name: key,
          async match(request, options) {
            calls.push(['cache.match', key, options || null]);
            return 'cache-response:' + key;
          },
          async matchAll(request, options) {
            calls.push(['cache.matchAll', key, options || null]);
            return ['cache-response:' + key];
          }
        });
      }
      return entries.get(key);
    },
    async delete(name) {
      calls.push(['delete', String(name)]);
      return entries.delete(String(name));
    },
    async has(name) { return entries.has(String(name)); },
    async keys() { return [...entries.keys()]; },
    async match(request, options) {
      calls.push(['storage.match', request, options || null]);
      for (const cache of entries.values()) {
        const response = await cache.match(request, options);
        if (response) return response;
      }
      return undefined;
    }
  };
  return storage;
}

function createScope({ accountId, role = 'user', fetchImpl = null, caches = null, localStorageBacking = null }) {
  const local = localStorageBacking || makeStorage({ ai_custom_characters: '[{"id":"legacy-owner"}]' });
  const session = makeStorage({ active_tab: 'home' });
  const openCalls = [];
  const nativeCaches = caches || createNativeCacheStorage();
  const nativeIndexedDB = {
    open(name, version) { openCalls.push(['open', name, version]); return { name, version }; },
    deleteDatabase(name) { openCalls.push(['delete', name]); return { name }; },
    databases() { return Promise.resolve([{ name: 'public-db', version: 1 }, { name: '__mao_account_v1__' + encodeURIComponent(accountId) + '__private-db', version: 2 }]); }
  };
  const document = {
    querySelector(selector) {
      if (selector.includes('mao-account-id')) return { content: accountId };
      if (selector.includes('mao-account-role')) return { content: role };
      return null;
    },
    open() { this.opened = true; },
    write(value) { this.written = value; },
    close() { this.closed = true; },
    documentElement: {}
  };
  const storageListeners = [];
  function MockXHR() {
    this.headers = {};
  }
  MockXHR.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  MockXHR.prototype.setRequestHeader = function (name, value) {
    this.headers[String(name).toLowerCase()] = String(value);
  };
  MockXHR.prototype.send = function (body) {
    this.body = body;
  };
  MockXHR.prototype.abort = function () {
    this.aborted = true;
  };

  const defaultFetch = async () => ({
    ok: true,
    json: async () => ({ account: { id: accountId, role, status: 'active' } })
  });
  const window = {
    location: {
      href: 'https://mao.test/index.html',
      origin: 'https://mao.test',
      replace(url) { window.redirectedTo = url; }
    },
    fetch: fetchImpl || defaultFetch,
    Headers,
    URL,
    XMLHttpRequest: MockXHR,
    localStorage: local,
    sessionStorage: session,
    indexedDB: nativeIndexedDB,
    caches: nativeCaches,
    addEventListener(type, listener, capture) {
      storageListeners.push({ type, listener, capture });
    },
    stop() { this.stopped = true; }
  };
  vm.runInNewContext(scopeSource, { window, document, console, Object, Array, Proxy, Reflect, Promise, encodeURIComponent, Symbol });
  return { window, document, local, session, openCalls, nativeIndexedDB, nativeCaches, storageListeners };
}

test('普通 MAO 账号的 localStorage 与 sessionStorage 只读写自己的命名空间', () => {
  const a = createScope({ accountId: 'MAO-AAAAAAAAAAAA', role: 'user' });
  assert.equal(a.window.__MAO_ACCOUNT_SCOPE__?.ready, true, 'readiness is published only after all storage guards install');
  a.window.localStorage.setItem('ai_custom_characters', '[{"id":"account-a"}]');
  a.window.localStorage.setItem('profile', 'A');
  assert.equal(a.window.localStorage.getItem('ai_custom_characters'), '[{"id":"account-a"}]');
  assert.equal(a.window.localStorage.length, 2);
  assert.deepEqual([a.window.localStorage.key(0), a.window.localStorage.key(1)].sort(), ['ai_custom_characters', 'profile']);
  assert.equal(a.local.getItem('ai_custom_characters'), '[{"id":"legacy-owner"}]', '普通账号不能读取或覆盖遗留未分区数据');
  assert.equal(a.local.getItem('__mao_account_v1__MAO-AAAAAAAAAAAA__ai_custom_characters'), '[{"id":"account-a"}]');
  a.window.sessionStorage.setItem('active_tab', 'chat');
  assert.equal(a.window.sessionStorage.getItem('active_tab'), 'chat');
  assert.equal(a.session.getItem('active_tab'), 'home', 'sessionStorage 也必须按账号隔离');
});

test('页面同源 API 请求会自动绑定注入的 MAO 永久 ID', async () => {
  const requests = [];
  const accountId = 'MAO-AAAAAAAAAAAA';
  const a = createScope({
    accountId,
    role: 'user',
    fetchImpl: async (input, init) => {
      requests.push({ input, headers: new Headers(init && init.headers) });
      return {
        ok: true,
        json: async () => ({ account: { id: accountId, role: 'user', status: 'active' } })
      };
    }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests[0].headers.get('x-mao-account-context'), accountId,
    '会话复核请求也必须携带页面账号上下文');

  await a.window.fetch('/api/accounts/security');
  assert.equal(requests[1].headers.get('x-mao-account-context'), accountId);

  await a.window.fetch('https://external.example/resource');
  assert.equal(requests[2].headers.has('x-mao-account-context'), false,
    '不得给跨域请求增加 MAO 专用头，避免触发不必要的 CORS 预检');
});

test('旧页面使用 XMLHttpRequest 请求同源 API 时也会绑定页面 MAO ID', () => {
  const accountId = 'MAO-AAAAAAAAAAAA';
  const a = createScope({ accountId, role: 'user' });

  const privateRequest = new a.window.XMLHttpRequest();
  privateRequest.open('POST', '/api/accounts/security');
  privateRequest.send('{}');
  assert.equal(privateRequest.headers['x-mao-account-context'], accountId,
    '旧式 XHR 也必须显式携带当前页面的 MAO 账号上下文');

  const externalRequest = new a.window.XMLHttpRequest();
  externalRequest.open('GET', 'https://external.example/resource');
  externalRequest.send();
  assert.equal(externalRequest.headers['x-mao-account-context'], undefined,
    '跨域 XHR 不得附加 MAO 专用请求头');
});

test('同一设备在其他标签页切换 MAO 账号后，旧账号页面必须退出', async () => {
  const a = createScope({
    accountId: 'MAO-AAAAAAAAAAAA',
    role: 'user',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        account: {
          id: 'MAO-BBBBBBBBBBBB',
          role: 'user',
          status: 'active'
        }
      })
    })
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(
    a.window.redirectedTo,
    '/account/index.html?switched=1',
    '服务端会话的永久 ID 与当前页面不一致时不得继续显示旧账号数据'
  );
});

test('账号会话仍属于当前 MAO ID 和角色时，页面不应误退出', async () => {
  const a = createScope({
    accountId: 'MAO-AAAAAAAAAAAA',
    role: 'user',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        account: {
          id: 'MAO-AAAAAAAAAAAA',
          role: 'user',
          status: 'active'
        }
      })
    })
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(a.window.redirectedTo, undefined);
});

test('QA session probe failure must not redirect a verified account page', async () => {
  const accountId = 'MAO-AAAAAAAAAAAA';
  for (const scenario of [
    { label: 'temporary unavailable', status: 503, code: 'IDENTITY_AUTHORITY_UNAVAILABLE' },
    { label: 'API forbidden without proof of logout', status: 403, code: 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY' },
    { label: 'invalid response', status: 200, code: '', ok: true }
  ]) {
    const a = createScope({
      accountId,
      role: 'super_admin',
      fetchImpl: async () => ({
        ok: scenario.ok === true,
        status: scenario.status,
        json: async () => scenario.code
          ? { ok: false, error: { code: scenario.code } }
          : { ok: true }
      })
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(a.window.redirectedTo, undefined, scenario.label);
    assert.equal(a.window.__MAO_ACCOUNT_SCOPE__?.ready, true, scenario.label);
  }
});

test('confirmed session expiry, disabled account and identity switch still redirect', async () => {
  const scenarios = [
    { status: 401, code: 'LOGIN_REQUIRED', expected: '/account/index.html' },
    { status: 403, code: 'ACCOUNT_DISABLED', expected: '/account/index.html?disabled=1' },
    { status: 403, code: 'IDENTITY_AUTHORITY_CHANGED', expected: '/account/index.html?switched=1' },
    { status: 409, code: 'ACCOUNT_CONTEXT_CHANGED', expected: '/account/index.html?switched=1' }
  ];
  for (const scenario of scenarios) {
    const a = createScope({
      accountId: 'MAO-AAAAAAAAAAAA', role: 'super_admin',
      fetchImpl: async () => ({
        ok: false, status: scenario.status,
        json: async () => ({ ok: false, error: { code: scenario.code } })
      })
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(a.window.redirectedTo, scenario.expected, scenario.code);
  }
});

test('不同 MAO 永久 ID 的 localStorage、IndexedDB 与 CacheStorage 相互隔离', async () => {
  const sharedCaches = createNativeCacheStorage();
  await sharedCaches.open('shared-app-shell');
  await sharedCaches.open('__mao_account_v1__MAO-BBBBBBBBBBBB__font-assets');
  const a = createScope({ accountId: 'MAO-AAAAAAAAAAAA', role: 'user', caches: sharedCaches });
  const b = createScope({ accountId: 'MAO-BBBBBBBBBBBB', role: 'user', caches: sharedCaches });

  a.window.localStorage.setItem('private', 'A');
  b.window.localStorage.setItem('private', 'B');
  assert.equal(a.window.localStorage.getItem('private'), 'A');
  assert.equal(b.window.localStorage.getItem('private'), 'B');

  a.window.indexedDB.open('media-library', 3);
  b.window.indexedDB.open('media-library', 3);
  assert.match(a.openCalls[0][1], /MAO-AAAAAAAAAAAA.*media-library/);
  assert.match(b.openCalls[0][1], /MAO-BBBBBBBBBBBB.*media-library/);
  assert.notEqual(a.openCalls[0][1], b.openCalls[0][1]);

  await a.window.caches.open('font-assets');
  await b.window.caches.open('font-assets');
  const keysA = await a.window.caches.keys();
  const keysB = await b.window.caches.keys();
  assert.deepEqual(keysA, ['font-assets']);
  assert.deepEqual(keysB, ['font-assets']);
  assert.ok(sharedCaches.calls.some(call => call[1] === 'shared-app-shell'));
  assert.ok(sharedCaches.calls.some(call => call[1] === '__mao_account_v1__MAO-BBBBBBBBBBBB__font-assets'));

  const matchA = await a.window.caches.match('/private-resource');
  assert.equal(
    matchA,
    'cache-response:__mao_account_v1__MAO-AAAAAAAAAAAA__font-assets',
    'CacheStorage.match 不得从共享 shell 或 B 账号缓存返回响应'
  );
  assert.equal(
    sharedCaches.calls.some(call => call[0] === 'storage.match'),
    false,
    '代理不能调用会跨整个 origin 搜索的原生 CacheStorage.match'
  );
  assert.equal(
    typeof a.window.caches.matchAll,
    'undefined',
    'CacheStorage 没有 matchAll 原生方法，账号代理不能虚构它并掩盖错误调用'
  );
  const accountCache = await a.window.caches.open('font-assets');
  const accountCacheMatches = await accountCache.matchAll('/private-resource');
  assert.deepEqual(accountCacheMatches, [
    'cache-response:__mao_account_v1__MAO-AAAAAAAAAAAA__font-assets'
  ], 'Cache.matchAll 只能作用于当前账号明确打开的缓存');

  assert.equal(await a.window.caches.has('font-assets'), true);
  assert.equal(await a.window.caches.delete('font-assets'), true,
    'A 账号只能删除自己的物理缓存');
  assert.equal(await a.window.caches.has('font-assets'), false);
  assert.equal(await b.window.caches.has('font-assets'), true,
    'A 删除自己的缓存不能影响 B 账号的同名缓存');
});
test('唯一超级管理员继续使用创作者现有本地数据，不迁移或清空旧数据', () => {
  const admin = createScope({ accountId: 'MAO-CCCCCCCCCCCC', role: 'super_admin' });
  assert.equal(admin.window.localStorage, admin.local);
  assert.equal(admin.window.sessionStorage, admin.session);
  assert.equal(admin.window.indexedDB, admin.nativeIndexedDB);
  assert.equal(admin.window.caches, admin.nativeCaches);
  assert.equal(admin.local.getItem('ai_custom_characters'), '[{"id":"legacy-owner"}]');
});

test('无法安装账号存储命名空间时阻止继续加载页面', () => {
  const local = makeStorage();
  const window = { localStorage: local, sessionStorage: makeStorage(), indexedDB: null, caches: null, stop() {} };
  const document = {
    querySelector(selector) {
      if (selector.includes('mao-account-id')) return { content: 'MAO-DDDDDDDDDDDD' };
      if (selector.includes('mao-account-role')) return { content: 'user' };
      return null;
    },
    open() {}, write() { this.blocked = true; }, close() {}
  };
  vm.runInNewContext(scopeSource, { window, document, console, Object, Array, Proxy, Reflect, Promise, encodeURIComponent, Symbol });
  assert.equal(document.blocked, true);
  assert.equal(window.__MAO_ACCOUNT_SCOPE__, undefined,
    'failure must never expose a falsely ready account namespace marker');
});

test('Worker 只对已授权账号页面注入数据命名空间，并禁止缓存个人 HTML', () => {
  assert.match(workerSource, /authPayload\?\.account\?\.status !== 'active'/);
  assert.match(workerSource, /url\.pathname\.startsWith\('\/admin\/'\) && authorizedAccount\.role !== 'super_admin'/);
  assert.match(workerSource, /meta name="mao-account-id"/);
  assert.match(workerSource, /mao-account-role/);
  assert.ok(workerSource.includes('shared/js/mao-account-scope.js'));
  assert.match(workerSource, /mao-account-scope\.js\?v=3/,
    'Worker 注入的账号隔离脚本必须使用本次更新版本，避免旧 PWA 缓存继续加载 v1');
  assert.match(serviceWorkerSource, /mao-account-scope\.js\?v=3/,
    'Service Worker 预缓存必须与 Worker 注入版本一致');
  assert.doesNotMatch(workerSource, /mao-account-scope\.js\?v=2/);
  assert.doesNotMatch(serviceWorkerSource, /mao-account-scope\.js\?v=2/);
  assert.match(scopeSource, /fetch\('\/api\/accounts\/me'/);
  assert.match(scopeSource, /setInterval\(verifyAccountSession, 30000\)/);
  assert.match(workerSource, /cache-control', 'private, no-store, max-age=0/);
  assert.match(workerSource, /storage\.transactionSync/);
  assert.match(appSource, /x-mao-account-context/);
  assert.match(appSource, /ACCOUNT_CONTEXT_CHANGED/);
  assert.match(scopeSource, /headers\.set\('x-mao-account-context', accountId\)/);
  assert.match(scopeSource, /function installAccountBoundXHR\(\)/);
  assert.match(scopeSource, /nativeSetRequestHeader\.call\(this, 'x-mao-account-context', accountId\)/);
  assert.match(scopeSource, /!installAccountBoundXHR\(\)/);
  assert.match(workerSource, /let injected = false/);
  assert.match(workerSource, /if \(!injected\) return blockedPage/);
  assert.match(workerSource, /!\['user', 'super_admin'\]\.includes\(role\)/);
});

test('Service Worker 按 MAO 会话读取对应账号的字体 CacheStorage，创作者旧缓存名保持兼容', () => {
  assert.match(serviceWorkerSource, /fetch\('\/api\/accounts\/me'/);
  assert.match(serviceWorkerSource, /account\.role === 'super_admin'[\s\S]*?FONT_ASSET_CACHE/);
  assert.match(serviceWorkerSource, /__mao_account_v1__/);
  assert.match(serviceWorkerSource, /encodeURIComponent\(account\.id\)/);
  assert.match(serviceWorkerSource, /credentials:\s*'same-origin'/);
  assert.match(serviceWorkerSource, /req\.headers\.get\('x-mao-account-context'\)/);
  assert.match(serviceWorkerSource, /authHeaders\.set\('x-mao-account-context', pageAccountContext\)/);
  assert.match(serviceWorkerSource, /status:\s*503/);
  assert.match(serviceWorkerSource, /requestedAccountId !== account\.id/);
  assert.match(serviceWorkerSource, /hasAccountPath/);
  assert.match(fontLoaderSource, /fontAssetPath \+= encodeURIComponent\(maoScope\.accountId\)/);
  assert.match(scopeSource, /global\.__MAO_ACCOUNT_SCOPE__ = Object\.freeze/);
});

test('localStorage 的键枚举只返回当前账号键，跨账号 storage 事件不会泄漏 payload', () => {
  const account = createScope({ accountId: 'MAO-EEEEEEEEEEEE', role: 'user' });
  account.window.localStorage.setItem('own-key', 'own-value');
  const iterated = Array.from(account.window.localStorage);
  assert.deepEqual(iterated, ['own-key']);

  const listener = account.storageListeners.find(item => item.type === 'storage' && item.capture);
  assert.ok(listener, '必须在 capture 阶段监听原生 storage 事件');
  const foreign = {
    storageArea: account.local,
    key: '__mao_account_v1__MAO-FFFFFFFFFFFF__private',
    newValue: 'foreign-secret',
    stopped: false,
    stopImmediatePropagation() { this.stopped = true; }
  };
  listener.listener(foreign);
  assert.equal(foreign.stopped, true, '其他账号变更事件必须在普通页面监听器之前被拦截');

  const own = {
    storageArea: account.local,
    key: '__mao_account_v1__MAO-EEEEEEEEEEEE__own-key',
    newValue: 'own-value',
    stopped: false,
    stopImmediatePropagation() { this.stopped = true; }
  };
  listener.listener(own);
  assert.equal(own.stopped, false, '当前账号自己的存储事件可以正常传播');
});

test('管理中心桌面入口只为超级管理员加入个人布局', () => {
  const home = fs.readFileSync(root + '/index.html', 'utf8');
  assert.match(home, /data-href="admin\/admin-center\.html" data-drag="app_admin_center"/);
  assert.match(home, /roleMeta\.content === 'super_admin'/);
  assert.match(home, /currentLayout\.pages\[pageIndex\]\.splice/);
  assert.match(home, /currentLayout\.pages = \(currentLayout\.pages \|\| \[\]\)\.map/);
});
