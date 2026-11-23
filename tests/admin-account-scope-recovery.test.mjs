import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function makeInit({ scopedId = '', serverAccount = null, apiError = null } = {}) {
  const start = admin.indexOf('  async function init() {');
  const end = admin.indexOf('\n\n  init();', start);
  assert.ok(start >= 0 && end > start, 'admin init contract exists');
  const factory = new Function('scope', 'api', '$', 'refreshAll',
    'loadOverviewDetails', 'hideError', 'showError', 'window', 'el',
    'let initializing = false;\n' + admin.slice(start, end) + '\nreturn init;');
  const apiCalls = [];
  const errors = [];
  const redirects = [];
  let refreshes = 0, overviews = 0;
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '',
      replaceChildren() {}
    });
    return elements.get(id);
  };
  const init = factory(
    () => scopedId,
    async path => {
      apiCalls.push(path);
      if (apiError) throw apiError;
      return { account: serverAccount };
    },
    $, async () => { refreshes++; },
    async () => { overviews++; },
    () => {}, message => errors.push(String(message)),
    {
      location: {
        search: '',
        replace: path => redirects.push(path)
      }
    },
    () => ({ textContent: '' })
  );
  return { init, apiCalls, errors, redirects,
    stats: () => ({ refreshes, overviews }) };
}

test('no injected account context fails closed before any private API read', async () => {
  const app = makeInit({ scopedId: '' });
  await app.init();
  assert.deepEqual(app.apiCalls, []);
  assert.deepEqual(app.redirects, []);
  assert.match(app.errors.at(-1), /服务器注入的账号上下文/);
  assert.equal(app.stats().refreshes, 0);
});

test('verified founder with matching page scope loads management workspace', async () => {
  const id = 'MAO-SYNTHETICFOUNDER01';
  const app = makeInit({
    scopedId: id,
    serverAccount: { id, role: 'super_admin', status: 'active' }
  });
  await app.init();
  assert.deepEqual(app.apiCalls, ['/api/accounts/me']);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.redirects, []);
  assert.deepEqual(app.stats(), { refreshes: 1, overviews: 1 });
});

test('a different logged-in account cannot reuse old founder page scope', async () => {
  const app = makeInit({
    scopedId: 'MAO-SYNTHETICFOUNDER01',
    serverAccount: { id: 'MAO-SYNTHETICOTHER01', role: 'super_admin', status: 'active' }
  });
  await app.init();
  assert.equal(app.stats().refreshes, 0);
  assert.match(app.errors.at(-1), /账号上下文与当前登录账号不一致/);
});

test('non-admin account still cannot enter management center', async () => {
  const id = 'MAO-SYNTHETICREGULAR01';
  const app = makeInit({ scopedId: id,
    serverAccount: { id, role: 'user', status: 'active' } });
  await app.init();
  assert.deepEqual(app.redirects, ['/account/index.html?admin=1']);
  assert.equal(app.stats().refreshes, 0);
});

test('missing scope notice leads to existing same-origin login, never desktop loop or account guessing', () => {
  const start = admin.indexOf('  function showError(message, retry) {');
  const end = admin.indexOf('\n\n  function hideError()', start);
  const src = admin.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(src, /登录已有账号/);
  assert.match(src, /\/account\/index\.html\?admin=1/);
  assert.doesNotMatch(src, /location\.assign\('\/index\.html'\)/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie/);
  assert.match(worker, /return redirectToVerifiedLogin\(url/);
  assert.match(worker, /return isHtmlDocument && authorizedAccount\s*\? await injectAccountScope/);
});
