import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

/**
 * sw.js 导航分支的生命周期回归测试。
 *
 * 这里不是字符串结构断言：真实执行 sw.js，注入模拟 Cache API / fetch / FetchEvent，
 * 通过可手动释放的 Promise 观察“页面响应”“后台缓存写入”“event.waitUntil 生命周期”
 * 三者的真实时序。
 *
 * 旧实现的缺陷：caches.open(...).then(cache => cache.put(...)) 的 Promise 没有被返回，
 * updatePromise 在 cache.put 完成前就 settle，waitUntil 只覆盖了 fetch，缓存写入失败
 * 还会产生未处理的 rejection。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SW_SOURCE = readFileSync(resolve(root, 'sw.js'), 'utf8');
const ORIGIN = 'https://maomao.test';
const NAV_URL = `${ORIGIN}/chat/chat/chat.html`;
const CACHE_NAME = SW_SOURCE.match(/const CACHE_NAME = '([^']+)'/)[1];

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/** 让当前所有微任务与一次宏任务队列跑完，用于观察 Promise 是否已 settle。 */
async function flushAsync() {
  for (let i = 0; i < 6; i += 1) {
    await new Promise(resolveTick => setImmediate(resolveTick));
  }
}

function trackState(promise) {
  const state = { value: 'pending' };
  promise.then(
    () => { state.value = 'fulfilled'; },
    () => { state.value = 'rejected'; }
  );
  return state;
}

function createHarness({ cachedResponse = null, fetchImpl, putImpl } = {}) {
  const listeners = {};
  const fetchCalls = [];
  const putCalls = [];
  const openCalls = [];

  const cache = {
    match: async request => (cachedResponse || null),
    put(request, response) {
      putCalls.push({ request, response });
      if (putImpl) return putImpl(request, response);
      return Promise.resolve();
    },
    add: async () => undefined
  };

  const cachesMock = {
    match: async request => (cachedResponse || null),
    open: async name => {
      openCalls.push(name);
      return cache;
    },
    keys: async () => [],
    delete: async () => true
  };

  const fetchMock = request => {
    fetchCalls.push(request);
    return fetchImpl(request);
  };

  const selfMock = {
    location: new URL(`${ORIGIN}/`),
    registration: { scope: `${ORIGIN}/` },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, handler) {
      listeners[type] = handler;
    }
  };

  const context = createContext({
    self: selfMock,
    caches: cachesMock,
    fetch: fetchMock,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    Promise
  });
  runInContext(SW_SOURCE, context, { filename: 'sw.js' });

  assert.equal(typeof listeners.fetch, 'function', 'sw.js 必须注册 fetch 监听');

  function dispatchNavigation() {
    const request = { method: 'GET', mode: 'navigate', url: NAV_URL };
    const event = {
      request,
      responsePromise: null,
      lifecycle: [],
      respondWith(promise) {
        this.responsePromise = Promise.resolve(promise);
      },
      waitUntil(promise) {
        this.lifecycle.push(Promise.resolve(promise));
      }
    };
    listeners.fetch(event);
    return event;
  }

  return { dispatchNavigation, fetchCalls, putCalls, openCalls, cache };
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' }
  });
}

test('场景1：命中缓存立即返回，网络照常后台更新，缓存写入完成前 waitUntil 仍 pending', async () => {
  const cached = htmlResponse('cached-page');
  const networkGate = deferred();
  const putGate = deferred();
  const harness = createHarness({
    cachedResponse: cached,
    fetchImpl: () => networkGate.promise,
    putImpl: () => putGate.promise
  });

  const event = harness.dispatchNavigation();
  assert.equal(event.lifecycle.length, 1, 'waitUntil 必须在事件分发期间同步登记');
  const lifecycleState = trackState(event.lifecycle[0]);

  const response = await event.responsePromise;
  assert.equal(response, cached, '命中缓存时必须原样返回缓存响应');
  assert.equal(await response.text(), 'cached-page');
  assert.equal(harness.fetchCalls.length, 1, '即使命中缓存也必须继续发起网络请求');
  assert.equal(lifecycleState.value, 'pending', '网络尚未返回时 waitUntil 不应结束');

  networkGate.resolve(htmlResponse('fresh-page'));
  await flushAsync();

  assert.equal(harness.putCalls.length, 1, '网络成功后必须调用 cache.put');
  assert.equal(harness.openCalls[0], CACHE_NAME, '必须写入当前 CACHE_NAME');
  assert.equal(lifecycleState.value, 'pending', 'cache.put 未完成时 waitUntil 必须仍 pending');

  putGate.resolve();
  await flushAsync();
  assert.equal(lifecycleState.value, 'fulfilled', 'cache.put 完成后 waitUntil 才完成');
});

test('场景2：缓存未命中先返回网络响应，但 waitUntil 持续等待缓存写入落盘', async () => {
  const networkGate = deferred();
  const putGate = deferred();
  const harness = createHarness({
    cachedResponse: null,
    fetchImpl: () => networkGate.promise,
    putImpl: () => putGate.promise
  });

  const event = harness.dispatchNavigation();
  const lifecycleState = trackState(event.lifecycle[0]);

  await flushAsync();
  assert.equal(lifecycleState.value, 'pending', '网络未返回时页面与生命周期都应 pending');

  networkGate.resolve(htmlResponse('fresh-page'));
  const response = await event.responsePromise;
  assert.equal(response.status, 200, '缓存未命中时应返回网络响应');
  assert.equal(await response.text(), 'fresh-page');
  assert.equal(harness.putCalls.length, 1, '网络成功后应开始写缓存');
  assert.equal(lifecycleState.value, 'pending', '页面已返回但缓存写入未完成，waitUntil 必须继续等待');

  putGate.resolve();
  await flushAsync();
  assert.equal(lifecycleState.value, 'fulfilled', '缓存写入完成后 waitUntil 才完成');
});

test('场景3：cache.put 失败不影响网络响应，生命周期正常结束且无未处理 rejection', async () => {
  const networkGate = deferred();
  const putGate = deferred();
  const harness = createHarness({
    cachedResponse: null,
    fetchImpl: () => networkGate.promise,
    putImpl: () => putGate.promise
  });

  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const event = harness.dispatchNavigation();
    const lifecycleState = trackState(event.lifecycle[0]);

    networkGate.resolve(htmlResponse('fresh-page'));
    const response = await event.responsePromise;
    assert.equal(response.status, 200, '缓存写入失败不能影响已成功的网络响应');
    assert.equal(await response.text(), 'fresh-page');
    assert.equal(harness.putCalls.length, 1);
    assert.equal(lifecycleState.value, 'pending', '写入尚未失败前 waitUntil 必须仍等待写入');

    putGate.reject(new Error('quota exceeded'));
    await flushAsync();

    assert.equal(lifecycleState.value, 'fulfilled', '缓存写入失败不能让后台生命周期变成 rejected');
    assert.deepEqual(unhandled, [], '缓存写入失败不得产生未处理的 Promise rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('场景4：网络失败时回退缓存，无缓存时仍是 503，且不触发缓存写入', async () => {
  const networkError = new Error('offline');

  const cachedResponse = htmlResponse('offline-cached-page');
  const cachedHarness = createHarness({
    cachedResponse,
    fetchImpl: () => Promise.reject(networkError),
    putImpl: () => Promise.resolve()
  });
  const cachedEvent = cachedHarness.dispatchNavigation();
  const cachedState = trackState(cachedEvent.lifecycle[0]);
  const fallback = await cachedEvent.responsePromise;
  assert.equal(fallback, cachedResponse, '网络失败时必须回退已有缓存');
  assert.equal(await fallback.text(), 'offline-cached-page');
  assert.equal(cachedHarness.putCalls.length, 0, '网络失败时不应写入缓存');
  await flushAsync();
  assert.equal(cachedState.value, 'fulfilled', '网络失败路径的生命周期应正常结束');

  const missHarness = createHarness({
    cachedResponse: null,
    fetchImpl: () => Promise.reject(networkError),
    putImpl: () => Promise.resolve()
  });
  const missEvent = missHarness.dispatchNavigation();
  const missState = trackState(missEvent.lifecycle[0]);
  const missResponse = await missEvent.responsePromise;
  assert.equal(missResponse.status, 503, '缓存与网络都不可用时必须返回 503 兜底');
  assert.equal(missResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal(await missResponse.text(), '此页面暂时无法连接，请检查网络后重试。');
  assert.equal(missHarness.putCalls.length, 0, '网络失败时不应尝试写缓存');
  await flushAsync();
  assert.equal(missState.value, 'fulfilled', '503 兜底路径的生命周期应正常结束');
});
