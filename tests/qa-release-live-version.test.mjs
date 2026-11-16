import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Verify the actual production release helper without invoking Wrangler,
// accessing live credentials, or performing Cloudflare writes.
const source = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function liveWorkerVersion(name) {');
const end = source.indexOf('\n\nasync function cloudflarePreflight()', start);
assert.ok(start >= 0 && end > start, 'live Worker version gate must exist');
const helper = source.slice(start, end);

function mount(result) {
  const requests = [];
  const fn = vm.runInNewContext(helper + '\nliveWorkerVersion;', {
    assert,
    cloudflare: async path => {
      requests.push(path);
      return result;
    }
  });
  return { fn, requests };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

test('reads 100% active Worker deployment from the expected Worker endpoint', async () => {
  const fixture = mount({ deployments: [
    { source: 'wrangler', versions: [{ version_id: UUID_A, percentage: 100 }] }
  ] });
  const result = await fixture.fn('maomao-identity-core');
  assert.equal(result.versionId, UUID_A);
  assert.equal(result.source, 'wrangler');
  assert.deepEqual(fixture.requests, ['/workers/scripts/maomao-identity-core/deployments']);
});

test('also accepts Cloudflare deployments returned directly as an array', async () => {
  const fixture = mount([
    { source: 'wrangler', versions: [{ version_id: UUID_B, percentage: 100 }] }
  ]);
  const result = await fixture.fn('maomao-aw-qa-20261114');
  assert.equal(result.versionId, UUID_B);
});

test('rejects a missing, split, or malformed deployment instead of reporting success', async () => {
  const bad = [
    {},
    { deployments: [] },
    { deployments: [{ versions: [] }] },
    { deployments: [{ versions: [
      { version_id: UUID_A, percentage: 50 },
      { version_id: UUID_B, percentage: 50 }
    ] }] },
    { deployments: [{ versions: [{ version_id: UUID_A, percentage: 95 }] }] },
    { deployments: [{ versions: [{ version_id: 'not-a-version', percentage: 100 }] }] }
  ];
  for (const result of bad) {
    await assert.rejects(mount(result).fn('maomao-identity-core'));
  }
});

test('direct QA release must compare pre/post versions of BOTH existing Workers', () => {
  assert.match(source, /const corePrevious = await liveWorkerVersion\(CORE\)/);
  assert.match(source, /const qaPrevious = await liveWorkerVersion\(QA\)/);
  assert.match(source, /assert\.notEqual\(coreVersion\.versionId, corePrevious\.versionId/);
  assert.match(source, /assert\.notEqual\(qaVersion\.versionId, qaPrevious\.versionId/);
  assert.match(source, /assert\.equal\(coreVersion\.source, 'wrangler'/);
  assert.match(source, /assert\.equal\(qaVersion\.source, 'wrangler'/);
  assert.match(source, /run\('npx', \['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler\.qa-identity-core\.jsonc'\]\)/);
  assert.match(source, /run\('npx', \['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler\.qa\.jsonc'\]\)/);
});


const smokeStart = source.indexOf('async function qaHttpSmoke(coreInitialized) {');
const smokeEnd = source.indexOf('\n\nasync function cloudflarePreflight()', smokeStart);
assert.ok(smokeStart >= 0 && smokeEnd > smokeStart,
  'original QA URL HTTP smoke guard must exist');
const smokeSource = source.slice(smokeStart, smokeEnd);

function runHttpSmoke(coreInitialized, { overrides = {}, html = '<form id="loginForm"></form>' } = {}) {
  const calls = [];
  const status = {
    ok: true, identityMode: 'delegated', qaIdentityCore: true,
    identityAuthorityConnected: true,
    identityAuthorityInitialized: coreInitialized,
    initialized: coreInitialized, configured: true,
    signInReady: coreInitialized, qaSetupAllowed: !coreInitialized,
    ...overrides
  };
  const probe = vm.runInNewContext(smokeSource + '\nqaHttpSmoke;', {
    assert,
    AbortSignal: { timeout: () => ({}) },
    console: { log() {} },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/admin/bootstrap/status')) {
        return { status: 200, async json() { return status; } };
      }
      if (url.endsWith('/account/index.html')) {
        return { status: 200, async text() { return html; } };
      }
      throw new Error('unexpected URL');
    }
  });
  return { calls, promise: probe(coreInitialized) };
}

test('original QA URL smoke accepts first-run setup and a ready disabled setup', async () => {
  for (const ready of [false, true]) {
    const fixture = runHttpSmoke(ready);
    await fixture.promise;
    assert.deepEqual(fixture.calls.map(x => x.url), [
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/api/admin/bootstrap/status',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/index.html'
    ]);
    assert.ok(fixture.calls.every(x => x.options.method === 'GET'));
    assert.ok(fixture.calls.every(x => !x.options.body && !x.options.cookie &&
      !x.options.authorization), 'probe must not transmit passwords or cookies');
  }
});

test('QA URL smoke blocks a disconnected core, inconsistent setup, or missing login HTML', async () => {
  await assert.rejects(runHttpSmoke(false, {
    overrides: { identityAuthorityConnected: false }
  }).promise);
  await assert.rejects(runHttpSmoke(false, {
    overrides: { qaIdentityCore: false }
  }).promise);
  await assert.rejects(runHttpSmoke(true, {
    overrides: { signInReady: false }
  }).promise);
  await assert.rejects(runHttpSmoke(true, {
    overrides: { qaSetupAllowed: true }
  }).promise);
  await assert.rejects(runHttpSmoke(false, { html: '<html>No login form</html>' }).promise);
});


const uploadGateStart = source.indexOf('function assertReadyForUpload() {');
const uploadGateEnd = source.indexOf('\n\nfunction preflightCheckout()', uploadGateStart);
assert.ok(uploadGateStart >= 0 && uploadGateEnd > uploadGateStart,
  'release upload source and secret preservation helpers must exist');
const uploadGateSource = source.slice(uploadGateStart, uploadGateEnd);

function mountUploadGate({ dirty = false, missing = null } = {}) {
  const requested = [];
  let headChecks = 0;
  const gate = vm.runInNewContext(
    uploadGateSource + '\n({ assertReadyForUpload, secretNames });',
    {
      assert,
      assertLatestGitHead() { headChecks++; },
      run(command, args) {
        requested.push([command, ...args]);
        return dirty ? ' M worker/lib/account-auth.js' : '';
      },
      existsSync(path) { return path !== missing; }
    }
  );
  return {
    ...gate,
    requested,
    headCheckCount() { return headChecks; }
  };
}

test('release checks a clean checkout and built app files before either upload', () => {
  const gate = mountUploadGate();
  gate.assertReadyForUpload();
  assert.equal(gate.headCheckCount(), 1);
  assert.deepEqual(gate.requested, [['git', 'status', '--porcelain']]);
});

test('release stops if tests change tracked files or if Vite output is missing', () => {
  assert.throws(() => mountUploadGate({ dirty: true }).assertReadyForUpload(),
    /Tests altered the checkout/);
  for (const path of ['dist/index.html', 'dist/account/index.html',
    'dist/account/bootstrap.html', 'dist/account/account.js',
    'dist/chat/chat/chat-detail.html']) {
    assert.throws(() => mountUploadGate({ missing: path }).assertReadyForUpload(),
      /QA Vite asset missing after build/);
  }
});

test('release retains the full core and QA secret sets and critical bindings', () => {
  const gate = mountUploadGate();
  const bindings = [
    { name: 'VAPID_PRIVATE_KEY', type: 'secret_text' },
    { name: 'AI', type: 'ai' },
    { name: 'MAO_IDENTITY_BRIDGE_SECRET', type: 'secret_text' },
    { name: 'DEVICE_SECRET_PEPPER', type: 'secret_text' }
  ];
  assert.equal(JSON.stringify(gate.secretNames({ bindings })),
    JSON.stringify(['DEVICE_SECRET_PEPPER', 'MAO_IDENTITY_BRIDGE_SECRET', 'VAPID_PRIVATE_KEY']));
  assert.match(source, /assert\.deepEqual\(secretNames\(core\), originalCoreSecrets/);
  assert.match(source, /assert\.deepEqual\(secretNames\(qa\), originalQaSecrets/);
  assert.match(source, /qaBinding\('AI'\)\?\.type, 'ai'/);
  assert.match(source, /qaBinding\('ASSETS'\)\?\.type, 'assets'/);
  assert.equal((source.match(/assertReadyForUpload\(\);\n  run\('npx'/g) || []).length, 2,
    'each Worker upload must recheck source and build artifacts');
});
