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
    : result({ ok: true, account: { role: 'super_admin', founderNumber: '001' } }));
  await page.settle();
  await page.submit();
  assert.ok(page.calls.every(call => call.options.credentials === 'same-origin'));
  assert.ok(page.calls.every(call => call.options.signal));
  assert.equal(page.calls.at(-1).options.method, 'POST');
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
