import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = process.cwd();
const scopeSource = fs.readFileSync(root + '/shared/js/mao-account-scope.js', 'utf8');
const workerSource = fs.readFileSync(root + '/worker.js', 'utf8');

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

function createScope({ accountId, role = 'user' }) {
  const local = makeStorage({ ai_custom_characters: '[{"id":"legacy-owner"}]' });
  const session = makeStorage({ active_tab: 'home' });
  const openCalls = [];
  const cacheCalls = [];
  const cacheNames = [];
  const nativeIndexedDB = {
    open(name, version) { openCalls.push(['open', name, version]); return { name, version }; },
    deleteDatabase(name) { openCalls.push(['delete', name]); return { name }; },
    databases() { return Promise.resolve([{ name: 'public-db', version: 1 }, { name: '__mao_account_v1__' + encodeURIComponent(accountId) + '__private-db', version: 2 }]); }
  };
  const nativeCaches = {
    open(name) {
      cacheNames.push(name);
      return Promise.resolve({ name, match: async key => name.includes(encodeURIComponent(accountId)) ? 'private-match' : null });
    },
    delete(name) { cacheCalls.push(['delete', name]); return Promise.resolve(true); },
    has(name) { cacheCalls.push(['has', name]); return Promise.resolve(true); },
    keys() { return Promise.resolve(cacheNames.slice()); },
    match() { return Promise.resolve('native-global-match'); }
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
  const window = {
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
  return { window, document, local, session, openCalls, cacheCalls, cacheNames, nativeIndexedDB, nativeCaches, storageListeners };
}

test('普通 MAO 账号的 localStorage 与 sessionStorage 只读写自己的命名空间', () => {
  const a = createScope({ accountId: 'MAO-AAAAAAAAAAAA', role: 'user' });
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

test('不同 MAO 永久 ID 的 localStorage、IndexedDB 与 CacheStorage 相互隔离', async () => {
  const a = createScope({ accountId: 'MAO-AAAAAAAAAAAA', role: 'user' });
  const b = createScope({ accountId: 'MAO-BBBBBBBBBBBB', role: 'user' });

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
  assert.match(a.cacheNames[0], /MAO-AAAAAAAAAAAA.*font-assets/);
  assert.match(b.cacheNames[0], /MAO-BBBBBBBBBBBB.*font-assets/);
  assert.notEqual(a.cacheNames[0], b.cacheNames[0]);
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
});

test('Worker 只对已授权账号页面注入数据命名空间，并禁止缓存个人 HTML', () => {
  assert.match(workerSource, /authPayload\?\.account\?\.status !== 'active'/);
  assert.match(workerSource, /meta name="mao-account-id"/);
  assert.match(workerSource, /mao-account-role/);
  assert.ok(workerSource.includes('shared/js/mao-account-scope.js'));
  assert.match(scopeSource, /fetch\('\/api\/accounts\/me'/);
  assert.match(scopeSource, /setInterval\(verifyAccountSession, 30000\)/);
  assert.match(workerSource, /cache-control', 'private, no-store, max-age=0/);
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
