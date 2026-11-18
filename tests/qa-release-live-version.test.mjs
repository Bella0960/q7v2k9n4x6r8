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
  assert.match(source, /const \[corePrevious, qaPrevious\] = await Promise\.all\(\[/);
  assert.match(source, /liveWorkerVersion\(CORE\), liveWorkerVersion\(QA\)/);
  assert.match(source, /assert\.equal\(qaPrevious\.versionId, qaBaseline\.versionId/);
  assert.match(source, /assert\.equal\(corePrevious\.versionId, coreBaseline\.versionId/);
  assert.match(source, /assert\.equal\(qaCurrent\.versionId, qaPrevious\.versionId/);
  assert.match(source, /assert\.equal\(coreCurrent\.versionId, coreVersion\.versionId/);
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

function runHttpSmoke(coreInitialized, {
  overrides = {},
  html = readFileSync(new URL('../account/index.html', import.meta.url), 'utf8'),
  loginJs = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8'),
  loginCss = readFileSync(new URL('../account/ivory-entry.css', import.meta.url), 'utf8'),
  bootstrapHtml = readFileSync(new URL('../account/bootstrap.html', import.meta.url), 'utf8'),
  bootstrapJs = readFileSync(new URL('../account/bootstrap.js', import.meta.url), 'utf8'),
  linkedCss = {}
} = {}) {
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
    URL,
    console: { log() {} },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/admin/bootstrap/status')) {
        return { status: 200, async json() { return status; } };
      }
      const assets = {
        '/account/index.html': html,
        '/account/account.js?v=20261116-qa1': loginJs,
        '/account/ivory-entry.css?v=20261116-qa1': loginCss,
        '/account/account.css?v=20261111-nav1':
          readFileSync(new URL('../account/account.css', import.meta.url), 'utf8'),
        '/account/bootstrap.html': bootstrapHtml,
        '/account/bootstrap.js?v=20261116-qa1': bootstrapJs,
        ...linkedCss
      };
      const path = url.slice('https://maomao-aw-qa-20261114.miamor520000.workers.dev'.length);
      if (Object.prototype.hasOwnProperty.call(assets, path)) {
        return { status: 200, async text() { return assets[path]; } };
      }
      throw new Error('unexpected URL: ' + url);
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
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/index.html',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/account.js?v=20261116-qa1',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/ivory-entry.css?v=20261116-qa1',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/bootstrap.html',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/bootstrap.js?v=20261116-qa1',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/account.css?v=20261111-nav1',
      'https://maomao-aw-qa-20261114.miamor520000.workers.dev/account/ivory-entry.css?v=20261116-qa1'
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
  await assert.rejects(runHttpSmoke(false, { loginJs: 'stale login script' }).promise);
  await assert.rejects(runHttpSmoke(false, { loginCss: 'stale login CSS' }).promise);
  await assert.rejects(runHttpSmoke(false, { bootstrapHtml: 'stale setup HTML' }).promise);
  await assert.rejects(runHttpSmoke(false, { bootstrapJs: 'stale setup script' }).promise);
  await assert.rejects(runHttpSmoke(false, {
    html: '<form id="loginForm"></form><script src="/account/account.js?v=20261116-qa1"></script><link rel="stylesheet" href="https://external.example.test/css.css">'
  }).promise);
});

test('accepts Vite fingerprinted stylesheet when the actual linked CSS contains QA warning', async () => {
  const html = '<form id="loginForm"></form><script src="/account/account.js?v=20261116-qa1"></script><link rel="stylesheet" crossorigin href="./assets/qa-abcdef.css">';
  const href = '/account/assets/qa-abcdef.css';
  const probe = runHttpSmoke(false, {
    html,
    linkedCss: { [href]: '.ivory-entry #loginPanel>.lead.qa-login-hint{display:block}' }
  });
  await probe.promise;
  assert.ok(probe.calls.some(call => call.url.endsWith(href)),
    'QA smoke must fetch the CSS actually loaded by the built page');
});


const uploadGateStart = source.indexOf('function assertReadyForUpload({ allowPinned = false } = {}) {');
const uploadGateEnd = source.indexOf('\n\nfunction preflightCheckout()', uploadGateStart);
assert.ok(uploadGateStart >= 0 && uploadGateEnd > uploadGateStart,
  'release upload source and secret preservation helpers must exist');
const uploadGateSource = source.slice(uploadGateStart, uploadGateEnd);

function mountUploadGate({ dirty = false, missing = null } = {}) {
  const requested = [];
  let headChecks = 0;
  const pinnedModes = [];
  const gate = vm.runInNewContext(
    uploadGateSource + '\n({ assertReadyForUpload, secretNames });',
    {
      assert,
      assertQaCandidate({ allowPinned = false } = {}) {
        headChecks++;
        pinnedModes.push(allowPinned);
        return { mode: allowPinned ? 'tested-snapshot' : 'current' };
      },
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
    pinnedModes,
    headCheckCount() { return headChecks; }
  };
}

test('release checks a clean checkout and built app files before either upload', () => {
  const gate = mountUploadGate();
  gate.assertReadyForUpload();
  assert.equal(gate.headCheckCount(), 1);
  assert.deepEqual(gate.pinnedModes, [false]);
  assert.deepEqual(gate.requested, [['git', 'status', '--porcelain']]);
  gate.assertReadyForUpload({ allowPinned: true });
  assert.deepEqual(gate.pinnedModes, [false, true],
    'only QA-only releases may allow tested, fast-forwarded snapshots');
});

test('release stops if tests change tracked files or if Vite output is missing', () => {
  assert.throws(() => mountUploadGate({ dirty: true }).assertReadyForUpload(),
    /Tests altered the checkout/);
  for (const path of ['dist/index.html', 'dist/account/index.html',
    'dist/account/bootstrap.html', 'dist/account/account.js',
    'dist/account/bootstrap.js', 'dist/account/ivory-entry.css',
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
  assert.match(source, /assertReadyForUpload\(\);\s*run\('npx', \['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler\.qa-identity-core\.jsonc'\]\)/,
    'identity-core upload must require the strict latest HEAD');
  assert.match(source, /assertReadyForUpload\(\{ allowPinned: qaOnly \}\);[\s\S]*?const testedCommit = stampQaBuildReceipt\(\);\s*run\('npx', \['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler\.qa\.jsonc'\]\)/,
    'web QA upload must recheck source, history, Worker versions and build receipt');
});


const auditStart = source.indexOf('function verifiedAccountCounts(item, name) {');
const auditEnd = source.indexOf('\n\nasync function cloudflarePreflight()', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart,
  'SQL founder evidence validation helper must exist');
const auditCounts = vm.runInNewContext(
  source.slice(auditStart, auditEnd) + '\nverifiedAccountCounts;',
  { assert }
);

test('accepts valid QA founder counts and a truly empty isolated core', () => {
  const qa = auditCounts({
    meta: { rows_written: 0 }, rows: [[1, 1, 1]]
  }, 'QA');
  assert.equal(JSON.stringify(qa), JSON.stringify({
    total: 1, matches: 1, admins: 1
  }));
  const core = auditCounts({
    meta: { rows_written: 0 }, rows: [[0, null, null]]
  }, 'CORE');
  assert.equal(JSON.stringify(core), JSON.stringify({
    total: 0, matches: 0, admins: 0
  }));
});

test('refuses to infer an empty core from missing or malformed Cloudflare SQL evidence', () => {
  const bad = [
    null,
    {},
    { rows: [[0, null, null]] },
    { meta: { rows_written: 1 }, rows: [[0, null, null]] },
    { meta: { rows_written: 0 }, rows: [] },
    { meta: { rows_written: 0 }, rows: [[null, null, null]] },
    { meta: { rows_written: 0 }, rows: [[0, null]] },
    { meta: { rows_written: 0 }, rows: [['0', null, null]] },
    { meta: { rows_written: 0 }, rows: [[1, null, 1]] },
    { meta: { rows_written: 0 }, rows: [[1, 2, 1]] },
    { meta: { rows_written: 0 }, rows: [[-1, 0, 0]] }
  ];
  for (const item of bad) {
    assert.throws(() => auditCounts(item, 'CORE'));
  }
});


const qaVarCheckStart = source.indexOf('function verifyQaRuntimeVars(bindings, plannedVars,');
const qaVarCheckEnd = source.indexOf('\n\nfunction preflightCheckout()', qaVarCheckStart);
assert.ok(qaVarCheckStart >= 0 && qaVarCheckEnd > qaVarCheckStart,
  'QA runtime preservation helper must exist');
const verifyQaRuntimeVars = vm.runInNewContext(
  source.slice(qaVarCheckStart, qaVarCheckEnd) + '\nverifyQaRuntimeVars;',
  { assert, QA_SETUP_OPEN: 'isolated_authority', QA_SETUP_CLOSED: 'disabled' }
);

test('planned QA feature flags preserve every existing non-secret setting', () => {
  const planned = {
    AUTONOMY_TICK_LIMIT: '10',
    MAO_SOCIAL_CHAT_ENABLED: 'false',
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_QA_IDENTITY_SETUP: 'isolated_authority',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core'
  };
  const existing = [
    { name: 'AUTONOMY_TICK_LIMIT', text: '10', type: 'plain_text' },
    { name: 'MAO_SOCIAL_CHAT_ENABLED', text: 'false', type: 'plain_text' },
    { name: 'MAO_IDENTITY_MODE', text: 'delegated_preview', type: 'plain_text' },
    { name: 'MAO_EXPECTED_FOUNDER_ID', type: 'secret_text' }
  ];
  assert.doesNotThrow(() => verifyQaRuntimeVars(existing, planned));
  assert.throws(() => verifyQaRuntimeVars(existing,
    { ...planned, AUTONOMY_TICK_LIMIT: '1' }), /unexpectedly change/);
  assert.throws(() => verifyQaRuntimeVars(existing,
    { ...planned, MAO_SOCIAL_CHAT_ENABLED: 'true' }), /unexpectedly change/);
  assert.throws(() => verifyQaRuntimeVars(existing,
    { ...planned, AUTONOMY_TICK_LIMIT: undefined }), /unexpectedly change/);
  assert.throws(() => verifyQaRuntimeVars(existing.slice(0, 1), {}),
    /missing from the release config/);
  assert.throws(() => verifyQaRuntimeVars([existing[0], existing[0]], planned),
    /Duplicated QA runtime variable/);
});

test('QA founder setup may only change open to disabled after founder exists', () => {
  const setup = [{ type: 'plain_text', name: 'MAO_QA_IDENTITY_SETUP',
    text: 'isolated_authority' }];
  const disabled = { MAO_QA_IDENTITY_SETUP: 'disabled' };
  assert.throws(() => verifyQaRuntimeVars(setup, disabled), /unexpectedly change/);
  assert.doesNotThrow(() => verifyQaRuntimeVars(setup, disabled,
    { allowClosingSetup: true }));
  assert.throws(() => verifyQaRuntimeVars([
    { type: 'plain_text', name: 'MAO_QA_IDENTITY_SETUP', text: 'disabled' }
  ], { MAO_QA_IDENTITY_SETUP: 'isolated_authority' }, {
    allowClosingSetup: true
  }), /unexpectedly change/, 'a later release cannot re-open closed setup');
});


const routeGuardStart = source.indexOf('async function verifyWorkerPublicRoutes() {');
const routeGuardEnd = source.indexOf('\n\nasync function cloudflarePreflight()', routeGuardStart);
assert.ok(routeGuardStart >= 0 && routeGuardEnd > routeGuardStart,
  'Worker public-route safety check must exist');

function makePublicRouteCheck(qa, core) {
  const calls = [];
  const verify = vm.runInNewContext(
    source.slice(routeGuardStart, routeGuardEnd) + '\nverifyWorkerPublicRoutes;',
    { assert, QA: 'maomao-aw-qa-20261114', CORE: 'maomao-identity-core',
      cloudflare: async path => {
        calls.push(path);
        return path.includes('maomao-identity-core') ? core : qa;
      }
    }
  );
  return { run: verify, calls };
}

test('QA URL remains public but the identity core and preview URLs stay private', async () => {
  const good = makePublicRouteCheck(
    { enabled: true, previews_enabled: false },
    { enabled: false, previews_enabled: false }
  );
  await good.run();
  assert.equal(good.calls.length, 2);
  assert.ok(good.calls.some(path => path.endsWith('/maomao-identity-core/subdomain')));
  assert.ok(good.calls.some(path => path.endsWith('/maomao-aw-qa-20261114/subdomain')));
  for (const [qa, core] of [
    [{ enabled: false, previews_enabled: false }, { enabled: false, previews_enabled: false }],
    [{ enabled: true, previews_enabled: true }, { enabled: false, previews_enabled: false }],
    [{ enabled: true, previews_enabled: false }, { enabled: true, previews_enabled: false }],
    [{ enabled: true, previews_enabled: false }, { enabled: false, previews_enabled: true }],
    [{ enabled: true, previews_enabled: false }, {}]
  ]) {
    await assert.rejects(makePublicRouteCheck(qa, core).run());
  }
});

test('Wrangler configs preserve original QA route and hide isolated core routes', () => {
  const qa = JSON.parse(readFileSync(new URL('../wrangler.qa.jsonc', import.meta.url), 'utf8'));
  const core = JSON.parse(readFileSync(new URL('../wrangler.qa-identity-core.jsonc', import.meta.url), 'utf8'));
  assert.equal(qa.name, 'maomao-aw-qa-20261114');
  assert.equal(qa.workers_dev, true);
  assert.equal(qa.preview_urls, false);
  assert.equal(core.name, 'maomao-identity-core');
  assert.equal(core.workers_dev, false);
  assert.equal(core.preview_urls, false);
  assert.equal((source.match(/await verifyWorkerPublicRoutes\(\);/g) || []).length, 3,
    'public route gate must run before release and after each Worker upload');
});


test('QA release builds the Vite dist before navigation and full Node tests', () => {
  const taskListStart = source.indexOf('const TESTS = [');
  const taskListEnd = source.indexOf('\n];', taskListStart);
  assert.ok(taskListStart >= 0 && taskListEnd > taskListStart,
    'the real QA release task list must exist');
  const tasks = source.slice(taskListStart, taskListEnd);
  const build = tasks.indexOf("['npm', ['run', 'build']]");
  const navigation = tasks.indexOf("['npm', ['run', 'test:pwa:navigation']]");
  const browserInstall = tasks.indexOf("['npx', ['playwright', 'install', '--with-deps', 'chromium']]");
  const fullNode = tasks.indexOf("['node', ['--test']]");
  assert.ok(build >= 0 && navigation >= 0 && browserInstall >= 0 && fullNode >= 0,
    'Vite build, PWA navigation, Chromium install and full Node regression are required');
  assert.ok(build < navigation,
    'navigation reads dist/index.html and dist/pwa-pages.json; build must run first');
  assert.ok(build < fullNode,
    'full Node tests may also consume Vite output, so build must run first');
  assert.ok(browserInstall < fullNode,
    'full Node suite runs Playwright browser tests; Chromium and Linux dependencies must be installed first');
  assert.match(tasks, /playwright', 'install', '--with-deps', 'chromium'/,
    'browser install must include OS libraries such as libnspr4.so');
  const pwaTest = readFileSync(new URL('./pwa-navigation-cache.test.mjs', import.meta.url), 'utf8');
  assert.match(pwaTest, /read\('dist\/index\.html'\)/);
  assert.match(pwaTest, /read\('dist\/pwa-pages\.json'\)/);
});
