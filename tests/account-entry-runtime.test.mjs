import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

// Execute the shipped entry script and event handlers. This small DOM adapter
// covers behavior, not browser layout, keyboard rendering or physical devices.
const source = fs.readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../account/index.html', import.meta.url), 'utf8');
const pending = { id: 'MAO-AAAAAAAAAAAA', status: 'pending_invite' };
const response = (payload, status = 200) => Response.json(payload, { status });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function mount(fetchImpl = async () => response({ ok: true, account: pending }), search = '') {
  function node(id) {
    return { id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, close() {}, showModal() {},
      querySelector(selector) {
        if (selector === 'button[type="submit"]') return this.submit;
        const name = /name="([^"]+)"/.exec(selector)?.[1];
        return this.fields?.[name] || null;
      },
      reset() { for (const field of Object.values(this.fields)) field.value = ''; }
    };
  }
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], node(m[1])]));
  // Reuse the same element for id lookup and click handling. Header back's
  // data-show is updated dynamically as the user moves between account steps.
  const nav = [...html.matchAll(/<button\b[^>]*\bdata-show="([^"]+)"[^>]*>/g)].map(m => {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const element = id ? nodes.get(id) : node('nav');
    element.dataset.show = m[1];
    return element;
  });
  for (const [id, fields] of Object.entries({ registerForm: ['username', 'password', 'confirmPassword', 'qqEmail'], loginForm: ['identifier', 'password'], inviteForm: ['inviteCode'] })) {
    const form = nodes.get(id);
    form.fields = Object.fromEntries(fields.map(name => [name, node(name)]));
    form.submit = node(id + '-submit');
  }
  const calls = [], timers = new Map();
  let nextTimer = 0;
  const window = { location: { search, assign(url) { window.destination = url; } }, scrollTo() {} };
  const context = {
    document: {
      getElementById: id => nodes.get(id),
      querySelectorAll: selector => selector === '[data-show]' ? nav : selector.startsWith('[data-show],')
        ? [...nav, ...['registerForm', 'loginForm', 'inviteForm'].map(id => nodes.get(id).submit)] : []
    },
    window, navigator: { clipboard: { writeText: async () => {} } },
    URLSearchParams, AbortController, TypeError,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    FormData: class { constructor(form) { this.values = Object.fromEntries(Object.entries(form.fields).map(([name, field]) => [name, field.value])); } get(name) { return this.values[name]; } },
    fetch: async (path, init) => {
      calls.push({ path, init });
      if (path === '/api/admin/bootstrap/status') return response({ ok: true, initialized: true });
      return fetchImpl(path, init);
    }
  };
  vm.runInNewContext(source, context);
  return {
    nodes, calls, timers, window,
    view: () => nodes.get('ivoryApp').dataset.view,
    fill(id, values) { for (const [name, value] of Object.entries(values)) nodes.get(id).fields[name].value = value; },
    submit(id) { const form = nodes.get(id); return form.listeners.submit({ currentTarget: form, preventDefault() {} }); },
    navigate(id) { return nav.find(n => n.dataset.show === id).listeners.click(); }
  };
}

test('late session restoration cannot replace the form the user opened', async () => {
  const slow = deferred();
  const page = mount(() => slow.promise);
  page.navigate('registerPanel');
  slow.resolve(response({ ok: true, account: pending }));
  await flush();
  assert.equal(page.view(), 'signup');
});

test('late unauthorized response cannot overwrite a completed login', async () => {
  const slow = deferred();
  const page = mount(path => path.endsWith('/me') ? slow.promise : response({ ok: true, account: pending }));
  page.navigate('loginPanel');
  page.fill('loginForm', { identifier: 'alice', password: 'test-password-123' });
  await page.submit('loginForm');
  slow.resolve(response({ ok: false, error: { code: 'UNAUTHORIZED' } }, 401));
  await flush();
  assert.equal(page.view(), 'invite');
  assert.equal(page.nodes.get('loginForm').fields.password.value, '');
});

test('empty or mismatched registration fields do not send requests', async () => {
  const page = mount();
  await flush();
  page.navigate('registerPanel');
  await page.submit('registerForm');
  page.fill('registerForm', { username: 'alice', password: 'test-password-123', confirmPassword: 'different-password' });
  await page.submit('registerForm');
  assert.equal(page.calls.filter(c => c.init.method === 'POST').length, 0);
  assert.match(page.nodes.get('registerError').textContent, /两次/);
});

test('double submit sends one request and a timeout unlocks retry', async () => {
  const page = mount((path, init) => path.endsWith('/me') ? response({ ok: true, account: pending }) : new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await flush();
  page.fill('inviteForm', { inviteCode: 'A'.repeat(32) });
  const first = page.submit('inviteForm');
  await page.submit('inviteForm');
  assert.equal(page.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(page.nodes.get('inviteForm').submit.disabled, true);
  for (const timer of page.timers.values()) timer();
  await first;
  assert.equal(page.nodes.get('inviteForm').submit.disabled, false);
  assert.match(page.nodes.get('inviteError').textContent, /超时/);
  assert.equal(page.nodes.get('inviteForm').fields.inviteCode.value, 'A'.repeat(32));
  assert.equal(page.timers.size, 0);
});

test('invalid JSON, null, missing success or missing account cannot show authorization success', async () => {
  for (const make of [() => new Response('<html>error</html>'), () => response(null), () => response({}), () => response({ ok: true })]) {
    const page = mount(path => path.endsWith('/me') ? response({ ok: true, account: pending }) : make());
    await flush();
    page.fill('inviteForm', { inviteCode: 'A'.repeat(32) });
    await page.submit('inviteForm');
    assert.equal(page.view(), 'invite');
    assert.ok(page.nodes.get('inviteError').textContent);
    assert.equal(page.nodes.get('inviteForm').submit.disabled, false);
  }
});

test('expired invitation session returns to login and preserves the invitation', async () => {
  const page = mount(path => path.endsWith('/me') ? response({ ok: true, account: pending }) : response({ ok: false, error: { code: 'UNAUTHORIZED' } }, 401));
  await flush();
  page.fill('inviteForm', { inviteCode: 'A'.repeat(32) });
  await page.submit('inviteForm');
  assert.equal(page.view(), 'login');
  assert.match(page.nodes.get('loginError').textContent, /过期/);
  assert.equal(page.nodes.get('inviteForm').fields.inviteCode.value, 'A'.repeat(32));
});

test('registered account survives automatic login failure without another registration', async () => {
  const page = mount(path => {
    if (path.endsWith('/login')) return response({ ok: false, error: { message: 'temporarily unavailable' } }, 503);
    return response({ ok: true, account: pending });
  });
  await flush();
  page.navigate('registerPanel');
  page.fill('registerForm', { username: 'alice', password: 'test-password-123', confirmPassword: 'test-password-123' });
  await page.submit('registerForm');
  assert.equal(page.view(), 'login');
  assert.match(page.nodes.get('loginError').textContent, /账号已创建/);
  assert.equal(page.nodes.get('loginForm').fields.identifier.value, 'alice');
  assert.equal(page.nodes.get('registerForm').fields.password.value, '');
  assert.equal(page.calls.filter(c => c.path.endsWith('/register')).length, 1);
});

test('shipped entry handlers register, login and redeem a real SQLite-backed bound invitation', async t => {
  const db = openTestDb();
  t.after(() => db.db.close());
  const secret = 'test-only-bootstrap-secret-at-least-32-characters';
  const api = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: secret });
  const admin = await api.fetchTo('/api/admin/bootstrap', { method: 'POST', body: {
    bootstrapSecret: secret, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123'
  } });
  assert.equal(admin.status, 200);
  const adminCookie = admin.headers.get('set-cookie').split(';')[0];
  let cookie = '';
  const page = mount(async (path, init) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const result = await api.fetchTo(path, { method: init.method, headers, accountContext: false, body: init.body ? JSON.parse(init.body) : undefined });
    const nextCookie = result.headers.get('set-cookie');
    if (nextCookie) cookie = nextCookie.split(';')[0];
    return result;
  });
  await flush();
  page.navigate('registerPanel');
  page.fill('registerForm', { username: 'runtime-user', password: 'runtime-password-123', confirmPassword: 'runtime-password-123' });
  await page.submit('registerForm');
  assert.equal(page.view(), 'invite');
  const accountId = page.nodes.get('pendingAccountId').textContent;
  const invite = await api.asJson('/api/admin/invites', { method: 'POST', headers: { cookie: adminCookie }, body: { targetAccountId: accountId } });
  assert.equal(invite.status, 201);
  page.fill('inviteForm', { inviteCode: 'X'.repeat(32) });
  await page.submit('inviteForm');
  assert.equal(page.view(), 'invite');
  assert.ok(page.nodes.get('inviteError').textContent);
  assert.equal(api.store.getMaoAccountById(accountId).status, 'pending_invite');
  page.fill('inviteForm', { inviteCode: invite.payload.invite.code });
  await page.submit('inviteForm');
  assert.equal(page.view(), 'authorized', page.nodes.get('inviteError').textContent);
  assert.equal(api.store.getMaoAccountById(accountId).status, 'active');
  assert.equal(page.calls.find(c => c.path.endsWith('/redeem')).init.headers['x-mao-account-context'], accountId);
  assert.equal(page.window.destination, undefined, 'first successful redemption shows confirmation before desktop');
  assert.match(html, /id="authorizedPanel"[\s\S]*?<svg[\s\S]*?id="enterMao"/, 'authorized screen uses a non-emoji SVG confirmation');
  page.nodes.get('enterMao').listeners.click();
  assert.equal(page.window.destination, '/index.html', 'confirmed active user enters desktop on explicit tap');
});

test('the unified account entry exposes no separate public administrator link', () => {
  assert.doesNotMatch(html, /管理员入口|href="\/admin\/admin-center\.html"/);
  assert.doesNotMatch(html, /admin\.mao520\.com/);
  assert.match(html, /data-show="registerPanel"/);
  assert.match(html, /data-show="loginPanel"/);
});

test('unique founder 001 and ordinary active members both enter the phone desktop after session restore', async () => {
  const founder = mount(async () => response({ ok: true, account: {
    id: 'MAO-AAAAAAAAAAAA', role: 'super_admin', founderNumber: '001', status: 'active'
  } }));
  await flush();
  assert.equal(founder.window.destination, '/index.html');

  const ordinary = mount(async () => response({ ok: true, account: {
    id: 'MAO-BBBBBBBBBBBB', role: 'user', status: 'active'
  } }));
  await flush();
  assert.equal(ordinary.window.destination, '/index.html');

  const pendingOwner = mount(async () => response({ ok: true, account: {
    id: 'MAO-CCCCCCCCCCCC', role: 'user', status: 'pending_invite'
  } }));
  await flush();
  assert.equal(pendingOwner.view(), 'invite');
  assert.equal(pendingOwner.window.destination, undefined);
});

test('a valid login enters the desktop immediately, without an extra administrator page', async () => {
  const page = mount(async path => path.endsWith('/me')
    ? response({ ok: false, error: { code: 'ACCOUNT_SESSION_REQUIRED' } }, 401)
    : response({ ok: true, account: {
      id: 'MAO-AAAAAAAAAAAA', status: 'active', role: 'super_admin', founderNumber: '001'
    } }));
  await flush();
  page.navigate('loginPanel');
  page.fill('loginForm', { identifier: 'creator', password: 'test-password-123' });
  await page.submit('loginForm');
  assert.equal(page.window.destination, '/index.html');
  assert.equal(page.nodes.get('loginForm').fields.password.value, '');
});

test('admin sign-in entry opens login after confirmed unauthenticated session', async () => {
  const page = mount(async () => response({ ok: false, error: { code: 'UNAUTHORIZED' } }, 401), '?admin=1');
  await flush();
  assert.equal(page.view(), 'login');
});

test('welcome has no redundant footer, and every account step has one header back button', async () => {
  const css = fs.readFileSync(new URL('../account/ivory-entry.css', import.meta.url), 'utf8');
  const welcomePanel = html.slice(html.indexOf('id="welcomePanel"'), html.indexOf('id="registerPanel"'));
  const titlebar = html.slice(html.indexOf('<header class="titlebar"'), html.indexOf('</header>') + '</header>'.length);
  assert.doesNotMatch(welcomePanel, /同一入口|独立账号/);
  assert.doesNotMatch(html, /<footer class="page-footer">/);
  assert.match(titlebar, /id="ivoryNavBack"/);
  assert.equal((html.match(/id="ivoryNavBack"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="back-button"/);
  assert.match(css, /\.ivory-entry \.titlebar \.ivory-nav-back\s*\{/);
  assert.match(css, /min-height:44px/);
  assert.doesNotMatch(css, /\.ivory-entry \.panel \.back-button/);
});

test('header back navigates signup/login to welcome, and invitation back to login', async () => {
  const page = mount();
  await flush();
  const back = page.nodes.get('ivoryNavBack');
  assert.equal(page.view(), 'invite');
  assert.equal(back.hidden, false);
  assert.equal(back.dataset.show, 'loginPanel');
  back.listeners.click();
  assert.equal(page.view(), 'login');
  assert.equal(back.dataset.show, 'welcomePanel');
  back.listeners.click();
  assert.equal(page.view(), 'welcome');
  assert.equal(back.hidden, true);
  page.navigate('registerPanel');
  assert.equal(page.view(), 'signup');
  assert.equal(back.hidden, false);
  assert.equal(back.dataset.show, 'welcomePanel');
  back.listeners.click();
  assert.equal(page.view(), 'welcome');
  assert.equal(back.hidden, true);
});
