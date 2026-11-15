import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import app from '../worker-app-cutover.js';

const config = JSON.parse(readFileSync(new URL('../wrangler.app.cutover.jsonc', import.meta.url), 'utf8'));
const request = (path, init) => new Request('https://app.mao520.com' + path, init);

test('app.mao520.com is the sole trial origin and points ONLY at isolated QA, never production', () => {
  assert.equal(config.name, 'curly-dream-324c');
  assert.equal(config.main, 'worker-app-cutover.js');
  assert.equal(config.vars.MAO_APP_CUTOVER_ENABLED, 'false');
  assert.deepEqual(config.services, [{ binding: 'MAO_APP_BACKEND', service: 'maomao-aw-qa-20261114' }]);
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.durable_objects, undefined);
  assert.equal(config.migrations, undefined);
  assert.equal(config.vars.MAO_IDENTITY_MODE, undefined);
  assert.equal(config.vars.MAO_EXPECTED_FOUNDER_ID, undefined);
});

test('a config upload alone leaves the existing static app behavior unchanged', async () => {
  const seen = [];
  const env = {
    MAO_APP_CUTOVER_ENABLED: 'false',
    ASSETS: { fetch: async req => { seen.push(new URL(req.url).pathname); return new Response('old-site'); } },
    MAO_APP_BACKEND: { fetch: async () => { throw Error('backend must not be called while disabled'); } }
  };
  assert.equal((await app.fetch(request('/'), env)).status, 200);
  assert.equal((await app.fetch(request('/'), env)).text instanceof Function, true);
  assert.equal(await (await app.fetch(request('/account/index.html'), env)).text(), 'old-site');
  assert.deepEqual(seen, ['/index.html', '/index.html', '/account/index.html']);
});

test('enabled cutover delegates HTML and APIs unchanged, preserving session cookies and POST body', async () => {
  const seen = [];
  const env = {
    MAO_APP_CUTOVER_ENABLED: 'true',
    ASSETS: { fetch: async () => { throw Error('must never bypass server-side HTML gate'); } },
    MAO_APP_BACKEND: {
      fetch: async req => {
        seen.push({
          url: req.url,
          method: req.method,
          cookie: req.headers.get('cookie'),
          body: req.method === 'POST' ? await req.text() : null
        });
        return new Response('from-integrated-worker', {
          status: 200,
          headers: { 'set-cookie': 'MAO_SESSION=opaque; Path=/; HttpOnly; Secure; SameSite=Lax' }
        });
      }
    }
  };
  const login = request('/api/accounts/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'other=present' },
    body: JSON.stringify({ identifier: 'synthetic', password: 'test-only' })
  });
  const result = await app.fetch(login, env);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(await result.text(), 'from-integrated-worker');
  assert.equal((await app.fetch(request('/wallet/index.html', { headers: { cookie: 'MAO_SESSION=synthetic-session' } }), env)).status, 200);
  assert.deepEqual(seen.map(v => v.url), [
    'https://app.mao520.com/api/accounts/login',
    'https://app.mao520.com/wallet/index.html'
  ]);
  assert.equal(seen[0].cookie, 'other=present');
  assert.equal(seen[1].cookie, 'MAO_SESSION=synthetic-session');
  assert.deepEqual(JSON.parse(seen[0].body), { identifier: 'synthetic', password: 'test-only' });
});

test('enabled cutover fails closed when binding is absent or backend is unavailable', async () => {
  const absent = await app.fetch(request('/admin/admin-center.html'), {
    MAO_APP_CUTOVER_ENABLED: 'true',
    ASSETS: { fetch: async () => { throw Error('private static document leaked'); } }
  });
  assert.equal(absent.status, 503);
  assert.equal((await absent.json()).error.code, 'APP_BACKEND_NOT_READY');
  assert.equal(absent.headers.get('cache-control'), 'no-store');

  const offline = await app.fetch(request('/api/accounts/me'), {
    MAO_APP_CUTOVER_ENABLED: 'true',
    MAO_APP_BACKEND: { fetch: async () => { throw Error('network or authority unavailable'); } }
  });
  assert.equal(offline.status, 503);
  assert.equal((await offline.json()).error.code, 'APP_BACKEND_UNAVAILABLE');
});

test('trial adapter never serves production mao520.com or another hostname', async () => {
  const r = await app.fetch(new Request('https://preview.mao520.com/api/accounts/me'), {
    MAO_APP_CUTOVER_ENABLED: 'true',
    MAO_APP_BACKEND: { fetch: async () => { throw Error('must not call backend on mismatched host'); } }
  });
  assert.equal(r.status, 404);
  const official = await app.fetch(new Request('https://mao520.com/api/accounts/me'), {
    MAO_APP_CUTOVER_ENABLED: 'true',
    MAO_APP_BACKEND: { fetch: async () => { throw Error('trial worker must never serve official hostname'); } }
  });
  assert.equal(official.status, 404);
});
