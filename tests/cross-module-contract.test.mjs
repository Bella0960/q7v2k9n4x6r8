import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 跨模块契约：足迹页、伴侣协议设置页、Cloudflare Worker。
// 这些断言原本混在 tests/chat-regression-contract.test.mjs 里，
// 但它们校验的不是聊天核心，而是页面与平台层。单独成文件，
// 让核心 PR 只对聊天链路负责，跨模块改动在这里独立验收。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const detail = read('chat/chat/chat-detail.html');
const footprint = read('chat/footprint/footprint.html');
const chatSettings = read('chat/chat/chat-settings.html');
const globalSettings = read('settings/settings.html');
const rpProtocolPage = read('worldbook/settings/rp-protocol.html');
const serviceWorker = read('sw.js');

test('footprint follows the local current date and keeps week, calendar and generated data role-scoped', () => {
  assert.match(footprint, /const todayKey = \(\) =>/);
  assert.ok(footprint.indexOf('const pad =') < footprint.indexOf('let currentDate = todayKey()'));
  assert.match(footprint, /function renderWeekDays\(\)/);
  assert.match(footprint, /data-date/);
  assert.match(footprint, /currentDate = todayKey\(\)/);
  // Footprint now uses a strict validated JSON store with an async snapshot
  // guard, rather than silently writing fake default schedules.
  assert.match(footprint, /model\.context\(role, requestDate\)/);
  assert.match(footprint, /model\.prompts\(role,requestDate\)/);
  assert.match(footprint, /model\.writeDay\(localStorage,requestRoleId,requestDate,entries,originalFootprintRaw\)/);
  assert.match(footprint, /String\(currentRoleId\)===requestRoleId && currentDate===requestDate/);
  assert.doesNotMatch(footprint, /generateDefaultFootprint|const DATA =/);
  assert.match(footprint, /function findItem\(id\)/);
  assert.doesNotMatch(footprint, /currentDate = '2025-04-16'/);
  assert.doesNotMatch(footprint, /currentDate = '2025-04-' \+/);
});


test('partner protocol settings edit only the global key', () => {
  assert.match(globalSettings, /window\.location\.href='\.\.\/worldbook\/settings\/rp-protocol\.html'/);
  assert.match(globalSettings, /伴侣协议/);
  assert.doesNotMatch(chatSettings, /rp-protocol\.html|伴侣协议/);
  assert.match(rpProtocolPage, /var STORAGE_KEY = 'chat_rp_protocol_';/);
  assert.doesNotMatch(rpProtocolPage, /function migrateLegacyProtocol\(\)/);
  assert.doesNotMatch(rpProtocolPage, /getRoleIdFromUrl/);
  assert.match(detail, /localStorage\.getItem\(globalRpKey\)/);
  assert.doesNotMatch(detail, /localStorage\.setItem\(globalRpKey, legacyValue\)/);

});


test('partner protocol preserves scoped legacy text without migrating it', () => {
  const start = detail.indexOf("            let rpProtocol = '';");
  const end = detail.indexOf('            // 世界书：', start);
  assert.ok(start >= 0 && end > start);
  const readProtocol = ({ values, roleId = 'role-a', actualId = 'role-a', group = false }) =>
    runInNewContext(detail.slice(start, end) + '\nrpProtocol;', {
      currentRoleId: roleId,
      currentCharacter: { id: actualId },
      isGroupChat: group,
      localStorage: { getItem: key => values[key] ?? null },
    });
  const values = { chat_rp_protocol_: 'global', 'chat_rp_protocol_role-a': 'old A', 'chat_rp_protocol_role-b': 'old B' };
  assert.equal(readProtocol({ values }), 'old A');
  assert.equal(readProtocol({ values, roleId: 'role-b', actualId: 'role-b' }), 'old B');
  assert.equal(readProtocol({ values, roleId: 'role-c', actualId: 'role-c' }), 'global');
  assert.equal(readProtocol({ values, roleId: 'role-b' }), 'global');
  assert.equal(readProtocol({ values, roleId: null }), 'global');
  assert.equal(readProtocol({ values, group: true }), 'global');
  assert.equal(readProtocol({ values: { ...values, chat_rp_protocol_: undefined } }), 'old A');
  assert.equal(readProtocol({ values: { ...values, 'chat_rp_protocol_role-a': ' ' } }), 'global');
});

test('Cloudflare Worker preserves explicit HTML routes and maps only the root to the desktop index', () => {
  const wranglerRaw = read('wrangler.jsonc');
  // Strip BOM and normalize Windows line endings before removing the JSONC comment.
  const wranglerConfig = JSON.parse(wranglerRaw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/^\/\/.*\n/, ''));
  const worker = read('worker.js');

  assert.equal(wranglerConfig.main, 'worker.js');
  assert.equal(wranglerConfig.assets.binding, 'ASSETS');
  assert.equal(wranglerConfig.assets.html_handling, 'none');
  assert.equal(wranglerConfig.assets.run_worker_first, true);
  assert.match(worker, /url\.pathname === "\/"[\s\S]*?new URL\("\/index\.html", url\)/);
  assert.match(worker, /let assetRequest = request;/,
    'non-root routes must start with the original request and URL');
  assert.match(worker, /assetRequest = new Request\(request, \{ headers \}\)/,
    'private HTML may strip conditional cache headers without changing the requested route');
  assert.match(worker, /const response = await env\.ASSETS\.fetch\(assetRequest\)/,
    'non-root app routes must be served from their original URL, not rewritten to index.html');
  assert.match(worker, /isHtmlDocument && authorizedAccount/,
    'private HTML must preserve server-verified account isolation');
  assert.match(serviceWorker, /!isPublicAccountPage && \(url\.pathname === '\/' \|\|/,
    'private HTML must bypass shared CacheStorage even without navigation');
});


test('Worker routes real requests and ignores conditional ranges only for protected HTML', async () => {
  const { default: worker } = await import('../worker.js');
  const account = { id: 'MAO-ABCDEFGHIJKL', status: 'active', role: 'user' };
  const seen = [];
  const env = {
    CLOUD_DB: {
      idFromName: name => name,
      get: () => ({ fetch: async request => {
        seen.push(['api', new URL(request.url).pathname]);
        return Response.json({ account });
      } }),
    },
    ASSETS: {
      fetch: async request => {
        seen.push(['asset', new URL(request.url).pathname, request.headers.has('if-none-match'), request.headers.has('range')]);
        return new Response('<html><head></head><body>fixture</body></html>', {
          headers: { 'content-type': 'text/html', etag: 'old' },
        });
      },
    },
  };
  const request = path => new Request('https://example.test' + path, {
    headers: { 'if-none-match': '"old"', range: 'bytes=0-9' },
  });
  for (const path of ['/', '/chat/chat/chat-detail.html?role=fixture']) {
    const result = await worker.fetch(request(path), env);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
    assert.equal(result.headers.get('etag'), null);
    assert.match(await result.text(), /name="mao-account-id" content="MAO-ABCDEFGHIJKL"/);
  }
  await worker.fetch(request('/account/index.html'), env);
  await worker.fetch(request('/api/accounts/me'), env);
  assert.deepEqual(seen, [
    ['api', '/api/accounts/me'], ['asset', '/index.html', false, false],
    ['api', '/api/accounts/me'], ['asset', '/chat/chat/chat-detail.html', false, false],
    ['asset', '/account/index.html', true, true], ['api', '/api/accounts/me'],
  ]);
  const unauthenticated = await worker.fetch(request('/chat/chat/chat.html'), { ASSETS: env.ASSETS });
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.get('location'), 'https://example.test/account/index.html');
  assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
  const beforeAdmin = seen.length;
  const adminResult = await worker.fetch(request('/admin/cloud.html'), env);
  assert.equal(adminResult.status, 302);
  assert.equal(adminResult.headers.get('location'), 'https://example.test/index.html');
  assert.deepEqual(seen.slice(beforeAdmin), [['api', '/api/accounts/me']]);
});

test('protected documents keep HEAD bodyless and failures out of caches', async () => {
  const { default: worker } = await import('../worker.js');
  const account = { id: 'MAO-ABCDEFGHIJKL', status: 'active', role: 'user' };
  const assets = [];
  let status = 200;
  const env = {
    CLOUD_DB: {
      idFromName: name => name,
      get: () => ({ fetch: async () => Response.json({ account }) }),
    },
    ASSETS: {
      fetch: async request => {
        assets.push([request.method, new URL(request.url).pathname]);
        return new Response('<html><head></head></html>', {
          status, headers: { 'content-type': 'text/html', 'cache-control': 'public' },
        });
      },
    },
  };
  const root = 'https://example.test/';
  const head = await worker.fetch(new Request(root, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('cache-control'), /no-store/);
  assert.deepEqual(assets, [['GET', '/index.html']]);

  const method = await worker.fetch(new Request(root, { method: 'POST' }), env);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, HEAD');

  status = 503;
  const failure = await worker.fetch(new Request(root), env);
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
  assert.equal(await failure.text(), '');
});
