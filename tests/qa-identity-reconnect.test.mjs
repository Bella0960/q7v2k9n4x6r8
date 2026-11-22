import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
const healthy = {
  ok: true, identityMode: 'delegated', qaIdentityCore: true,
  identityAuthorityConnected: true, configured: true, initialized: true,
  bootstrapAllowed: false, qaSetupAllowed: false, signInReady: true
};

function harness(probe) {
  const nodes = new Map();
  const timers = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const button = { disabled: false };
  let timerId = 0;
  let attempts = 0;

  function node(id) {
    if (!nodes.has(id)) {
      const item = {
        hidden: false, disabled: false, textContent: '', innerHTML: '',
        dataset: {}, value: '', title: '',
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener() {}, setAttribute() {},
        querySelectorAll(selector) {
          return id === 'loginForm' && selector === 'input, button[type="submit"]'
            ? [button] : [];
        },
        querySelector(selector) {
          if (id === 'loginForm' && selector === 'button[type="submit"]') return button;
          return node(id + '/child/' + selector);
        },
        reset() {}, showModal() {}, close() {}
      };
      nodes.set(id, item);
    }
    return nodes.get(id);
  }
  const document = {
    visibilityState: 'visible',
    getElementById: node,
    querySelector(selector) {
      // No artwork in the synthetic login fixture; the real page may retry its hero image.
      if (selector === '.hero-image') return null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { listeners.document.set(type, fn); }
  };
  const window = {
    location: { hostname: 'preview.mao520.com', search: '', assign() {} },
    scrollTo() {},
    addEventListener(type, fn) { listeners.window.set(type, fn); }
  };
  async function fetch(url) {
    if (url === '/api/admin/bootstrap/status') {
      attempts++;
      const result = await probe(attempts);
      if (result instanceof Error) throw result;
      return { ok: true, status: 200, json: async () => result };
    }
    if (url === '/api/accounts/me') {
      return { ok: false, status: 401,
        json: async () => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'not signed in' } }) };
    }
    throw new Error('Unexpected test request: ' + url);
  }
  function setTimeoutFake(fn, ms) {
    const id = ++timerId;
    timers.set(id, { fn, ms });
    return id;
  }
  function clearTimeoutFake(id) { timers.delete(id); }
  const ctx = {
    window, document, fetch, navigator: { clipboard: { writeText: async () => {} } },
    URLSearchParams, FormData, AbortController,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    console
  };
  runInNewContext(source, ctx, { filename: 'account/account.js' });
  return {
    window, document, listeners, button,
    get attempts() { return attempts; },
    get error() { return node('loginError').textContent; },
    pendingRetries() { return [...timers].filter(([, t]) => t.ms < 20000); },
    fireRetry() {
      const next = [...timers].find(([, t]) => t.ms < 20000);
      assert.ok(next, 'Expected an automatic status retry');
      timers.delete(next[0]);
      next[1].fn();
    }
  };
}

async function settle() {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
}

test('a transient status request failure keeps login closed, then automatically restores it', async () => {
  const h = harness(async attempt => attempt === 1
    ? new TypeError('temporary offline') : { ...healthy });
  await settle();
  assert.equal(h.attempts, 1);
  assert.equal(h.button.disabled, true);
  assert.match(h.error, /QA 身份服务连接失败.*自动重试/);
  h.fireRetry();
  await settle();
  assert.equal(h.attempts, 2);
  assert.equal(h.button.disabled, false);
  assert.equal(h.error, '');
  assert.equal(h.pendingRetries().length, 0);
});

test('repeated failures never bypass delegated QA login authorization', async () => {
  const h = harness(async () => new TypeError('offline'));
  await settle();
  assert.equal(h.button.disabled, true);
  for (let i = 0; i < 3; i++) {
    h.fireRetry();
    await settle();
    assert.equal(h.button.disabled, true);
    assert.match(h.error, /请勿提交密码/);
  }
  assert.equal(h.attempts, 4);
});

test('a responding but unready identity authority cannot enable login', async () => {
  const h = harness(async attempt => ({ ...healthy, signInReady: attempt >= 2 }));
  await settle();
  assert.equal(h.button.disabled, true);
  assert.match(h.error, /身份服务尚未就绪/);
  h.fireRetry();
  await settle();
  assert.equal(h.attempts, 2);
  assert.equal(h.button.disabled, false);
});

test('returning online accelerates revalidation without duplicating in-flight probes', async () => {
  const h = harness(async attempt => attempt === 1
    ? new TypeError('network') : { ...healthy });
  await settle();
  assert.equal(h.button.disabled, true);
  h.listeners.window.get('online')();
  await settle();
  assert.equal(h.attempts, 2);
  assert.equal(h.button.disabled, false);
  assert.equal(h.pendingRetries().length, 0);
});

test('a wrong identity mode fails closed even when signInReady is true', async () => {
  const h = harness(async () => ({ ...healthy, identityMode: 'local' }));
  await settle();
  assert.equal(h.button.disabled, true);
  assert.match(h.error, /身份状态异常/);
});

test('QA account entry changes script URL so existing mobile PWA caches cannot serve the old login code', () => {
  const html = readFileSync(new URL('../account/index.html', import.meta.url), 'utf8');
  const expectedAsset = '/account/account.js?v=20261121-login-recovery1';
  assert.ok(html.includes(expectedAsset), 'account entry must reference the latest mobile login script');
  assert.doesNotMatch(html, /\/account\/account\.js\?v=20261116-qa1/);
  const release = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
  assert.ok(release.includes(expectedAsset), 'QA smoke must verify the same login script version as the real page');
});
