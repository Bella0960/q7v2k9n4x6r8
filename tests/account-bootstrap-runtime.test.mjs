import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../account/bootstrap.js', import.meta.url), 'utf8');
const result = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; }
});
const settle = () => new Promise(resolve => setImmediate(resolve));

function mount(onRequest) {
  const nodes = {};
  function node(id) {
    return nodes[id] ||= {
      id, hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; }
    };
  }
  for (const id of ['bootstrapForm', 'bootstrapError', 'bootstrapComplete',
    'bootstrapStatus', 'retryBootstrapCheck', 'bootstrapSetupHelp']) node(id);
  const submitButton = node('bootstrapSubmit');
  const form = node('bootstrapForm');
  form.values = { bootstrapSecret: 'a'.repeat(32), username: 'creator001',
    password: 'long-password-123', confirmPassword: 'long-password-123', qqEmail: '' };
  form.querySelector = selector => selector === 'button[type="submit"]' ? submitButton : null;
  form.reset = () => { form.values.password = ''; form.values.confirmPassword = ''; form.values.bootstrapSecret = ''; };
  const redirects = [], calls = [];
  const context = {
    document: { getElementById: node, querySelectorAll() { return []; } },
    window: { location: { replace(url) { redirects.push(url); } } },
    FormData: class { constructor(element) { this.values = element.values; } get(key) { return this.values[key]; } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (path, options) => {
      calls.push({ path, options });
      return onRequest(path, options);
    }
  };
  vm.runInNewContext(source, context);
  return {
    nodes, calls, redirects, settle,
    submit() { return form.listeners.submit({ preventDefault() {} }); },
    retry() { return nodes.retryBootstrapCheck.listeners.click(); }
  };
}

test('first-run status must be a valid boolean before showing setup form', async () => {
  const page = mount(async () => result({ ok: true }));
  await page.settle();
  assert.equal(page.nodes.bootstrapForm.hidden, true);
  assert.equal(page.nodes.retryBootstrapCheck.hidden, false);
  assert.match(page.nodes.bootstrapStatus.textContent, /初始化状态无效/);
});

test('HTTP 200 with missing founder identity cannot redirect on bootstrap', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false })
    : path.endsWith('/preflight') ? result({ ok: true, initialized: false, configured: true, cryptoReady: true })
    : result({ ok: true, account: { role: 'user', founderNumber: '001' } }));
  await page.settle();
  assert.equal(page.nodes.bootstrapForm.hidden, false);
  await page.submit();
  assert.deepEqual(page.redirects, []);
  assert.match(page.nodes.bootstrapError.textContent, /尚未确认管理员身份/);
  assert.equal(page.nodes.bootstrapSubmit.disabled, false);
});

test('only confirmed founder 001 bootstrap response opens the management center', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false })
    : path.endsWith('/preflight') ? result({ ok: true, initialized: false, configured: true, cryptoReady: true })
    : result({ ok: true, account: { role: 'super_admin', founderNumber: '001' } }));
  await page.settle();
  await page.submit();
  assert.deepEqual(page.redirects, ['/admin/admin-center.html']);
  assert.equal(page.nodes.bootstrapForm.values.bootstrapSecret, '');
});

test('failed initial status check keeps form hidden and retry restores it', async () => {
  let fail = true;
  const page = mount(async () => {
    if (fail) return result({ ok: false, error: { code: 'UNAVAILABLE', message: '服务暂不可用' } }, 503);
    return result({ ok: true, initialized: false });
  });
  await page.settle();
  assert.equal(page.nodes.bootstrapForm.hidden, true);
  assert.equal(page.nodes.retryBootstrapCheck.hidden, false);
  fail = false;
  await page.retry();
  assert.equal(page.nodes.bootstrapForm.hidden, false);
  assert.equal(page.nodes.retryBootstrapCheck.hidden, true);
});

test('administrator setup always uses same-origin credentials and an abort signal', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false })
    : path.endsWith('/preflight') ? result({ ok: true, initialized: false, configured: true, cryptoReady: true })
    : result({ ok: true, account: { role: 'super_admin', founderNumber: '001' } }));
  await page.settle();
  await page.submit();
  assert.ok(page.calls.every(call => call.options.credentials === 'same-origin'));
  assert.ok(page.calls.every(call => call.options.signal));
  assert.equal(page.calls.at(-1).options.method, 'POST');
  assert.equal(page.calls.at(-1).path, '/api/admin/bootstrap');
});

test('missing Preview secrets never exposes founder registration form until configured', async () => {
  let ready = false;
  const page = mount(async () => result({ ok: true, initialized: false, configured: ready }));
  await page.settle();
  assert.equal(page.nodes.bootstrapForm.hidden, true);
  assert.equal(page.nodes.bootstrapSetupHelp.hidden, false);
  assert.equal(page.nodes.retryBootstrapCheck.hidden, false);
  assert.match(page.nodes.bootstrapStatus.textContent, /尚未配置安全密钥/);
  ready = true;
  await page.retry();
  assert.equal(page.nodes.bootstrapForm.hidden, false);
  assert.equal(page.nodes.bootstrapSetupHelp.hidden, true);
  assert.equal(page.nodes.retryBootstrapCheck.hidden, true);
});

test('network failure after submit checks founder state without repeating POST', async () => {
  let statusReads = 0;
  const page = mount(async (path) => {
    if (path.endsWith('/status')) {
      statusReads += 1;
      return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    }
    if (path.endsWith('/preflight')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    throw new TypeError('Failed to fetch');
  });
  await page.settle();
  await page.submit();
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 1);
  assert.equal(statusReads, 3, 'initial readiness, pre-submit, post-error read-only status');
  assert.deepEqual(page.redirects, []);
  assert.match(page.nodes.bootstrapError.textContent, /管理员尚未创建/);
  assert.match(page.nodes.bootstrapError.textContent, /NETWORK_ERROR/);
  assert.equal(page.nodes.bootstrapSubmit.disabled, false);
});

test('ambiguous POST followed by confirmed founder creation shows login instead of retry', async () => {
  let initialized = false;
  const page = mount(async path => {
    if (path.endsWith('/status')) return result({ ok: true, initialized, configured: true, cryptoReady: true });
    if (path.endsWith('/preflight')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    initialized = true;
    throw new TypeError('connection reset after commit');
  });
  await page.settle();
  await page.submit();
  assert.equal(page.nodes.bootstrapComplete.hidden, false);
  assert.equal(page.nodes.bootstrapForm.hidden, true);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 1);
});

test('status lookup failure after ambiguous submit warns instead of automatically retrying', async () => {
  let postFailed = false;
  const page = mount(async path => {
    if (path.endsWith('/status')) {
      if (postFailed) throw new TypeError('offline');
      return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    }
    if (path.endsWith('/preflight')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    postFailed = true;
    throw new TypeError('Failed to fetch');
  });
  await page.settle();
  await page.submit();
  assert.match(page.nodes.bootstrapError.textContent, /暂时无法确认结果/);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 1);
});

test('bootstrap POST receives longer timeout than status checks and never auto-reposts', () => {
  assert.match(source, /method === 'POST' \? 60000 : 15000/);
  assert.match(source, /NEVER automatically repeat the POST/);
});

test('failed same-origin POST preflight never submits credentials or writes founder account', async () => {
  const page = mount(async path => {
    if (path.endsWith('/status')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    if (path.endsWith('/preflight')) throw new TypeError('Network unreachable');
    throw new Error('founder POST must not be called');
  });
  await page.settle();
  await page.submit();
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 0);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap/preflight').length, 1);
  assert.match(page.nodes.bootstrapError.textContent, /管理员资料尚未提交/);
});

test('manual connectivity check sends an empty POST without founder secrets or credentials', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false, configured: true, cryptoReady: true })
    : result({ ok: true, initialized: false, configured: true, cryptoReady: true }));
  await page.settle();
  await page.nodes.bootstrapTestConnection.listeners.click();
  const checks = page.calls.filter(call => call.path === '/api/admin/bootstrap/preflight');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].options.method, 'POST');
  assert.equal(checks[0].options.body, '{}');
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 0);
  assert.match(page.nodes.bootstrapConnectionStatus.textContent, /密码保护自检均已通过/);
});

test('failed manual preflight shows an error code and never sends founder credentials', async () => {
  const page = mount(async path => {
    if (path.endsWith('/status')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    throw new TypeError('Failed to fetch');
  });
  await page.settle();
  await page.nodes.bootstrapTestConnection.listeners.click();
  assert.match(page.nodes.bootstrapConnectionStatus.textContent, /NETWORK_ERROR/);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 0);
  assert.equal(page.nodes.bootstrapTestConnection.disabled, false);
});

test('server 503 uses sanitized origin error code and status after read-only reconciliation', async () => {
  const page = mount(async path => {
    if (path.endsWith('/status')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    if (path.endsWith('/preflight')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    return result({ ok: false, error: { code: 'BOOTSTRAP_PASSWORD_DERIVATION_FAILED', message: '管理员创建失败' } }, 503);
  });
  await page.settle();
  await page.submit();
  assert.match(page.nodes.bootstrapError.textContent, /BOOTSTRAP_PASSWORD_DERIVATION_FAILED/);
  assert.match(page.nodes.bootstrapError.textContent, /HTTP 503/);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 1);
});

test('non-JSON Cloudflare error response retains the HTTP status instead of a generic retry prompt', async () => {
  const page = mount(async path => {
    if (path.endsWith('/status')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    if (path.endsWith('/preflight')) return result({ ok: true, initialized: false, configured: true, cryptoReady: true });
    return { ok: false, status: 520, async json() { throw new SyntaxError('not JSON'); } };
  });
  await page.settle();
  await page.submit();
  assert.match(page.nodes.bootstrapError.textContent, /HTTP_520/);
  assert.match(page.nodes.bootstrapError.textContent, /HTTP 520/);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 1);
});

test('preflight without server-verified password KDF cannot submit founder credentials', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false, configured: true })
    : result({ ok: true, initialized: false, configured: true, cryptoReady: false }));
  await page.settle();
  await page.submit();
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 0);
  assert.match(page.nodes.bootstrapError.textContent, /未确认密码保护模块可用/);
});

test('manual connectivity check cannot falsely declare success without KDF proof', async () => {
  const page = mount(async path => path.endsWith('/status')
    ? result({ ok: true, initialized: false, configured: true })
    : result({ ok: true, initialized: false, configured: true }));
  await page.settle();
  await page.nodes.bootstrapTestConnection.listeners.click();
  assert.match(page.nodes.bootstrapConnectionStatus.textContent, /尚未确认密码保护模块可用/);
  assert.equal(page.calls.filter(call => call.path === '/api/admin/bootstrap').length, 0);
});
