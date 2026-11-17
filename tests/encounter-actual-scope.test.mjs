// 检查「邂逅」与 PR #290 原版账号隔离脚本的真实兼容性。
// 执行：node --test tests/encounter-actual-scope.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = process.cwd();
const scopeSource = fs.readFileSync(root + '/shared/js/mao-account-scope.js', 'utf8');
const engineSource = fs.readFileSync(root + '/encounter/encounter-engine.js', 'utf8');
const workerSource = fs.readFileSync(root + '/worker.js', 'utf8');
const appSource = fs.readFileSync(root + '/worker/lib/app.js', 'utf8');
const serviceWorkerSource = fs.readFileSync(root + '/sw.js', 'utf8');
const fontLoaderSource = fs.readFileSync(root + '/shared/js/font-loader.js', 'utf8');

// 使用账号 PR #290 完整测试里的同一组 Storage / IndexedDB / CacheStorage / XHR 模拟工具。
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


function withEncounter(account) {
  account.window.location.hostname = 'app.mao520.com';
  account.window.document = account.document;
  vm.runInNewContext(engineSource,{window:account.window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
  return account.window.MAOMAOEncounter;
}

test('复用真实 MAO 账号作用域：同站点两个账号的候选绝不相互读取',async () => {
  const backing = makeStorage({ ai_custom_characters:'[{"id":"original-admin-role"}]' });
  const a=createScope({accountId:'MAO-AAAAAAAAAAAA',role:'user',localStorageBacking:backing});
  const b=createScope({accountId:'MAO-BBBBBBBBBBBB',role:'user',localStorageBacking:backing});
  const aApi=withEncounter(a),bApi=withEncounter(b);
  assert.equal(aApi.checkAccountScope().ok,true);
  assert.equal(bApi.checkAccountScope().ok,true);
  assert.equal((await aApi.verifyLiveAccountContext()).ok,true);
  const first=aApi.generate();
  assert.equal(first.ok,true,first.error);
  assert.equal(aApi.saveCandidate(first.value).ok,true);
  assert.equal(aApi.getCandidates().value.length,1);
  assert.equal(bApi.getCandidates().value.length,0);
  const second=bApi.generate();
  assert.equal(second.ok,true,second.error);
  assert.equal(bApi.saveCandidate(second.value).ok,true);
  assert.equal(aApi.getCandidates().value[0].id,first.value.id);
  assert.equal(bApi.getCandidates().value[0].id,second.value.id);
  assert.equal(backing.getItem('ai_custom_characters'),'[{"id":"original-admin-role"}]');
  assert.equal(backing.getItem('maomao_encounter_card_v2:'+first.value.id),null);
  const keys=[...backing.snapshot().keys()].filter(k=>k.includes('maomao_encounter_card_v2:'));
  assert.ok(keys.some(k=>k.startsWith('__mao_account_v1__MAO-AAAAAAAAAAAA__')));
  assert.ok(keys.some(k=>k.startsWith('__mao_account_v1__MAO-BBBBBBBBBBBB__')));
});

test('唯一超级管理员继续读取原始存储而不是被挪入另一个命名空间', () => {
  const backing=makeStorage({ai_custom_characters:'[{"id":"owner-old"}]'});
  const admin=createScope({accountId:'MAO-CCCCCCCCCCCC',role:'super_admin',localStorageBacking:backing});
  const api=withEncounter(admin);
  assert.equal(admin.window.localStorage,backing);
  assert.equal(api.checkAccountScope().ok,true);
  const card=api.generate();
  assert.equal(card.ok,true,card.error);
  assert.equal(api.saveCandidate(card.value).ok,true);
  assert.equal(backing.getItem('maomao_encounter_card_v2:'+card.value.id)!==null,true);
  assert.equal(backing.getItem('ai_custom_characters'),'[{"id":"owner-old"}]');
});

test('已绑定的页面 meta / 作用域不一致时拒绝抽卡、收藏与付费核验',async () => {
  const account=createScope({accountId:'MAO-AAAAAAAAAAAA',role:'user'});
  const api=withEncounter(account);
  account.window.__MAO_ACCOUNT_SCOPE__={accountId:'MAO-BBBBBBBBBBBB',role:'user',ready:true};
  assert.equal(api.generate().ok,false);
  assert.equal(api.saveCandidate({id:'enc_unsafe',name:'越界访问'}).ok,false);
  assert.equal((await api.verifyLiveAccountContext()).ok,false);
});

test('Worker 与客户端作用域接口保持相同的注入版本和请求账号绑定',()=>{
  // #290 账号作用域脚本可安全升级版本，但 Worker / SW 必须指向同一版本。
  // 固定 v=2 会让已升级到 v=3 的真实账号底座在整合时产生假失败。
  const workerVersion=workerSource.match(/mao-account-scope\.js\?v=([1-9]\d*)/)?.[1];
  const swVersion=serviceWorkerSource.match(/mao-account-scope\.js\?v=([1-9]\d*)/)?.[1];
  assert.ok(workerVersion,'Worker 必须注入带有效版本号的账号隔离脚本');
  assert.ok(swVersion,'Service Worker 必须识别带有效版本号的账号隔离脚本');
  assert.equal(swVersion,workerVersion,'Worker 与 Service Worker 账号脚本版本必须一致，不能混用旧缓存');
  assert.match(appSource,/ACCOUNT_CONTEXT_CHANGED/);
  assert.match(scopeSource,/headers\.set\('x-mao-account-context', accountId\)/);
  assert.match(fontLoaderSource,/fontAssetPath \+= encodeURIComponent\(maoScope\.accountId\)/);
});

test('账号作用域半初始化失败时邂逅必须拒绝抽卡，不能信任 ready=true', () => {
  const accountId = 'MAO-DDDDDDDDDDDD';
  const metas = {
    'meta[name="mao-account-id"]': {content:accountId},
    'meta[name="mao-account-role"]': {content:'user'}
  };
  const document = {
    querySelector(selector) { return metas[selector] || null; },
    open() {}, write() { this.blocked = true; }, close() {}
  };
  const window = {
    location:{hostname:'app.mao520.com'},
    localStorage:makeStorage(),
    sessionStorage:makeStorage(),
    indexedDB:null,
    caches:null,
    stop() {}
  };
  vm.runInNewContext(scopeSource,
    {window,document,console,Object,Array,Proxy,Reflect,Promise,encodeURIComponent,Symbol});
  assert.equal(document.blocked,true,'缺失必需环境时应阻断页面');
  assert.equal(window.__MAO_ACCOUNT_SCOPE__,undefined,'不能在保护安装前宣告 ready');
  window.document = document;
  vm.runInNewContext(engineSource,
    {window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
  assert.equal(window.MAOMAOEncounter.generate().ok,false,'隔离不完整不得生成候选');
});
