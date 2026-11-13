import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// Exercise the actual Worker fetch entrypoint with a fake Durable Object
// and ASSETS binding. No real credentials, production data, or network calls.
const ACCOUNT_ID = 'MAO-AAAAAAAAAAAA';
const OTHER_ID = 'MAO-BBBBBBBBBBBB';
const html = '<!doctype html><html><head><title>Private page</title></head><body>private shell</body></html>';
const site = 'https://qa.example.test';

function makeEnv(account = null, overrides = {}) {
  const calls = { auth: [], assets: [], api: [] };
  const assets = {
    async fetch(request) {
      calls.assets.push({ method: request.method, path: new URL(request.url).pathname });
      if (overrides.noHead) return new Response('<html><body>no head</body></html>', {
        headers: { 'content-type': 'text/html' }
      });
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,max-age=3600', etag: '"old-etag"' }
      });
    }
  };
  const stub = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/accounts/me') {
        calls.auth.push({ cookie: request.headers.get('cookie'), path, method: request.method });
        if (overrides.authFails) throw new Error('DO unavailable');
        if (overrides.disabled) {
          return Response.json({ ok: false, error: { code: 'ACCOUNT_DISABLED' } }, { status: 403 });
        }
        if (!account) return Response.json({ ok: false, error: { code: 'LOGIN_REQUIRED' } }, { status: 401 });
        return Response.json({ ok: true, account });
      }
      calls.api.push(path);
      return Response.json({ ok: true });
    }
  };
  const env = {
    ASSETS: assets,
    CLOUD_DB: { idFromName: name => name, get: () => stub }
  };
  if (overrides.withoutDb) delete env.CLOUD_DB;
  return { calls, env };
}
const req = (path, init = {}) => new Request(site + path, init);
const active = (role = 'user', id = ACCOUNT_ID) => ({ id, role, status: 'active' });

test('anonymous private app and admin HTML both redirect before assets are served', async () => {
  const { env, calls } = makeEnv();
  for (const path of ['/index.html', '/', '/admin/admin-center.html', '/chat/chat/chat-detail.html']) {
    const r = await worker.fetch(req(path), env);
    assert.equal(r.status, 302, path);
    assert.equal(new URL(r.headers.get('location')).pathname, '/account/index.html', path);
  }
  assert.equal(calls.assets.length, 0);
  assert.equal(calls.auth.length, 4);
});

test('only public account entry is readable without an account session', async () => {
  const { env, calls } = makeEnv();
  for (const path of ['/account/index.html', '/account/bootstrap.html']) {
    const r = await worker.fetch(req(path), env);
    assert.equal(r.status, 200, path);
    assert.equal((await r.text()).includes('private shell'), true);
  }
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.assets.length, 2);
});

test('active ordinary account receives scoped private HTML, no public cache metadata', async () => {
  const { env, calls } = makeEnv(active());
  const r = await worker.fetch(req('/index.html', { headers: { cookie: 'mao_session=fake-test' } }), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(r.headers.get('vary'), 'Cookie');
  assert.equal(r.headers.has('etag'), false);
  const body = await r.text();
  assert.match(body, /meta name="mao-account-id" content="MAO-AAAAAAAAAAAA"/);
  assert.match(body, /meta name="mao-account-role" content="user"/);
  assert.match(body, /mao-account-scope\.js/);
  assert.equal(calls.auth[0].cookie, 'mao_session=fake-test');
});

test('ordinary account cannot load admin HTML even with an active session', async () => {
  const { env, calls } = makeEnv(active());
  const r = await worker.fetch(req('/admin/admin-center.html'), env);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).pathname, '/index.html');
  assert.equal(calls.assets.length, 0);
});

test('active founder alone can load admin HTML with founder scope', async () => {
  const { env } = makeEnv(active('super_admin'));
  const r = await worker.fetch(req('/admin/admin-center.html'), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /meta name="mao-account-role" content="super_admin"/);
});

test('pending and disabled accounts cannot open private HTML', async () => {
  for (const scenario of [
    { account: { id: ACCOUNT_ID, status: 'pending_invite', role: 'user' } },
    { account: null, options: { disabled: true } }
  ]) {
    const { env, calls } = makeEnv(scenario.account, scenario.options);
    const r = await worker.fetch(req('/chat/chat/chat-detail.html'), env);
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get('location')).pathname, '/account/index.html');
    assert.equal(calls.assets.length, 0);
    if (scenario.options?.disabled) assert.equal(new URL(r.headers.get('location')).searchParams.get('disabled'), '1');
  }
});

test('missing DO and errors fail closed, without serving private shell', async () => {
  for (const options of [{ withoutDb: true }, { authFails: true }]) {
    const { env, calls } = makeEnv(null, options);
    const r = await worker.fetch(req('/chat/chat/chat-detail.html'), env);
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get('location')).pathname, '/account/index.html');
    assert.equal(calls.assets.length, 0);
  }
});

test('malformed or invalid account identity blocks private HTML injection', async () => {
  for (const scenario of [
    { account: active('user', 'invalid-id') },
    { account: active('user', OTHER_ID), options: { noHead: true } }
  ]) {
    const { env } = makeEnv(scenario.account, scenario.options);
    const r = await worker.fetch(req('/index.html'), env);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /账号隔离暂不可用/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('API calls are delegated to DO and never served from static ASSETS', async () => {
  const { env, calls } = makeEnv();
  const r = await worker.fetch(req('/api/accounts/me'), env);
  assert.equal(r.status, 401);
  assert.equal(calls.api.length, 0);
  assert.equal(calls.assets.length, 0);
  assert.equal(calls.auth.length, 1);
});
