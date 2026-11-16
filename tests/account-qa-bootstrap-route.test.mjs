import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the deployed route guard from its actual source, rather than a
// copied condition that could drift from the auth handler.
const source = readFileSync(new URL('../worker/lib/account-auth.js', import.meta.url), 'utf8');
const guard = source.match(/      if \(delegated && \([\s\S]*?throw new ApiError\(403, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY'[\s\S]*?\n      \}/)?.[0];
assert.ok(guard, 'account router must preserve its delegated-admin guard');
assert.match(source.slice(source.indexOf(guard) + guard.length),
  /if \(path === '\/api\/admin\/bootstrap' && method === 'POST'\) return await bootstrap\(request\)/,
  'approved QA bootstrap must remain reachable after the delegated guard');

const runGuard = vm.runInNewContext(
  '(function (delegated, path, method, qaEnabled) {\n' +
  '  const env = {};\n' +
  '  const qaIsolatedSetupEnabled = () => qaEnabled;\n' +
  '  class ApiError extends Error { constructor(status, code) { super(code); this.status=status; this.code=code; } }\n' +
  guard + '\nreturn "allowed";\n})'
);

test('QA bootstrap POST reaches handler only if isolated QA is enabled', () => {
  assert.equal(runGuard(true, '/api/admin/bootstrap', 'POST', true), 'allowed');
  for (const enabled of [false, null, undefined, 0, '']) {
    assert.throws(() => runGuard(true, '/api/admin/bootstrap', 'POST', enabled),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  }
});

test('QA flag does not reopen other delegated admin and account management APIs', () => {
  const guarded = [
    ['POST', '/api/accounts/register'],
    ['POST', '/api/accounts/password/change'],
    ['POST', '/api/accounts/invites/redeem'],
    ['GET', '/api/admin/accounts'],
    ['POST', '/api/admin/accounts'],
    ['POST', '/api/admin/bootstrap/secret'],
    ['GET', '/api/admin/bootstrap'],
    ['POST', '/api/admin/invites']
  ];
  for (const [method, path] of guarded) {
    assert.throws(() => runGuard(true, path, method, true),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY',
      'must block ' + method + ' ' + path);
  }
});

test('social admin endpoints and ordinary non-delegated mode keep existing dispatch', () => {
  assert.equal(runGuard(true, '/api/admin/social/friends', 'GET', true), 'allowed');
  assert.equal(runGuard(true, '/api/admin/social/friends', 'POST', false), 'allowed');
  assert.equal(runGuard(false, '/api/admin/accounts', 'GET', false), 'allowed');
  assert.equal(runGuard(false, '/api/admin/bootstrap', 'POST', false), 'allowed');
});

 
// Run the actual account-auth bootstrap STATUS route, with only its service
// bindings and data store simulated. This covers readiness after QA setup closes.
const statusStart = source.indexOf("      if ((path === '/api/admin/bootstrap/status'");
const statusEnd = source.indexOf("\n      if (path === '/api/internal/identity/authenticate'", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart,
  'the real bootstrap status route must remain accessible');
const statusRoute = source.slice(statusStart, statusEnd);

function runStatusRoute(env, authority, delegated = true) {
  const run = vm.runInNewContext(`(async function (env, authority, delegated) {
    const path = '/api/admin/bootstrap/status', method = 'GET', request = {};
    const store = { hasMaoSuperAdminAccount() { return false; } };
    const probeExistingIdentityAuthority = async () => authority;
    const usesExistingAccountAuthority = () =>
      delegated && env.MAO_IDENTITY_AUTHORITY_MODE === 'existing_worker';
    const qaIsolatedSetupEnabled = () =>
      env.MAO_QA_IDENTITY_SETUP === 'isolated_authority';
    const isolatedQaAuthorityFounderId = () => null;
    const ok = result => result;
    ${statusRoute}
    return null;
  })`);
  return run(env, authority, delegated);
}

test('QA core remains configured for login after one-time setup is closed', async () => {
  const env = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_QA_IDENTITY_SETUP: 'disabled',
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const status = await runStatusRoute(env, {
    connected: true, initialized: true, configured: true
  });
  assert.equal(status.configured, true);
  assert.equal(status.signInReady, true);
  assert.equal(status.initialized, true);
  assert.equal(status.bootstrapAllowed, false);
  assert.equal(status.qaSetupAllowed, false);
  assert.equal(status.qaIdentityCore, true);
});

test('QA identity status fails closed if its authority is offline', async () => {
  const env = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_QA_IDENTITY_SETUP: 'disabled',
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const status = await runStatusRoute(env, {
    connected: false, initialized: false, configured: false
  });
  assert.equal(status.configured, false);
  assert.equal(status.signInReady, false);
});

test('legacy gateway and ordinary local account status behavior stays unchanged', async () => {
  const legacy = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'legacy-gateway',
    MAO_IDENTITY_BRIDGE_SECRET: 'b'.repeat(40),
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const oldResult = await runStatusRoute(legacy, {
    connected: true, initialized: true, configured: true
  });
  assert.equal(oldResult.configured, false);
  assert.equal(oldResult.bootstrapAllowed, false);
  assert.equal(oldResult.qaIdentityCore, false);
  const local = await runStatusRoute({
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'a'.repeat(40),
    DEVICE_SECRET_PEPPER: 'b'.repeat(40)
  }, null, false);
  assert.equal(local.configured, true);
  assert.equal(local.bootstrapAllowed, true);
});


test('QA login page uses QA-only password hint without changing legacy gateway UI', async () => {
  const loginSource = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
  const begin = loginSource.indexOf('  async function checkCreatorBootstrapEntry() {');
  const finish = loginSource.indexOf('\n\n  (async function restoreSession()', begin);
  assert.ok(begin >= 0 && finish > begin, 'actual login readiness handler must exist');
  const actualHandler = loginSource.slice(begin, finish);
  const mount = vm.runInNewContext(
    '(async function (status) {\n' +
    '  let delegatedIdentity = false;\n' +
    '  let delegatedSignInReady = true;\n' +
    '  const link = { hidden: false };\n' +
    '  const subtitle = { textContent: "", classList: { tokens: new Set(), ' +
    'toggle(name, value) { if (value) this.tokens.add(name); else this.tokens.delete(name); }, ' +
    'contains(name) { return this.tokens.has(name); } } };\n' +
    '  const fields = [{ disabled: false }, { disabled: false }];\n' +
    '  let authBusy = false;\n' +
    '  const syncLoginAvailability = () => { const disabled = authBusy || (delegatedIdentity && !delegatedSignInReady); fields.forEach(f => { f.disabled = disabled; }); };\n' +
    '  const register = [{ hidden: false }];\n' +
    '  const errors = [];\n' +
    '  const byId = id => ({ creatorBootstrapLink: link,\n' +
    '    loginPanel: { querySelector: () => subtitle },\n' +
    '    loginForm: { querySelectorAll: () => fields } })[id];\n' +
    '  const document = { querySelectorAll: () => register };\n' +
    '  const api = async () => status;\n' +
    '  const setError = (id, message) => errors.push({ id, message });\n' +
    actualHandler + '\n' +
    '  await checkCreatorBootstrapEntry();\n' +
    '  return { link, subtitle, fields, register, errors, delegatedSignInReady };\n' +
    '})'
  );
  const qa = await mount({
    identityMode: 'delegated', qaIdentityCore: true, initialized: true,
    bootstrapAllowed: false, signInReady: true
  });
  assert.match(qa.subtitle.textContent, /QA.*专用密码|QA.*单独设置的密码/);
  assert.match(qa.subtitle.textContent, /不要输入正式版密码/);
  assert.equal(qa.subtitle.classList.contains('qa-login-hint'), true,
    'the isolated QA warning must opt into visible styling');
  assert.ok(qa.fields.every(field => field.disabled === false));
  assert.equal(qa.link.hidden, true);
  const fresh = await mount({
    identityMode: 'delegated', qaIdentityCore: true, initialized: false,
    bootstrapAllowed: true, qaSetupAllowed: true,
    identityAuthorityConnected: true, configured: true, signInReady: false
  });
  assert.equal(fresh.link.hidden, false, 'empty and ready QA must expose setup entry');
  assert.equal(fresh.link.textContent, '设置 QA 独立账号密码');
  assert.ok(fresh.fields.every(field => field.disabled === true));
  assert.match(fresh.errors[0]?.message || '', /先点击「设置 QA 独立账号密码」/);
  const unavailable = await mount({
    identityMode: 'delegated', qaIdentityCore: true, initialized: false,
    bootstrapAllowed: true, signInReady: false
  });
  assert.ok(unavailable.fields.every(field => field.disabled === true));
  assert.match(unavailable.errors[0]?.message || '', /QA 独立身份服务尚未就绪/);
  assert.equal(unavailable.link.hidden, true, 'not-ready QA must not expose setup');
  for (const denied of [
    { qaIdentityCore: false }, { qaSetupAllowed: false },
    { identityAuthorityConnected: false }, { configured: false },
    { initialized: true }, { bootstrapAllowed: false }
  ]) {
    const blocked = await mount({
      identityMode: 'delegated', qaIdentityCore: true, initialized: false,
      bootstrapAllowed: true, qaSetupAllowed: true,
      identityAuthorityConnected: true, configured: true, signInReady: false,
      ...denied
    });
    assert.equal(blocked.link.hidden, true, 'unverified QA setup entry must stay hidden');
  }
  const legacy = await mount({
    identityMode: 'delegated', qaIdentityCore: false, initialized: true,
    bootstrapAllowed: false, signInReady: true
  });
  assert.match(legacy.subtitle.textContent, /原来的 MAO 账号登录/);
  assert.doesNotMatch(legacy.subtitle.textContent, /QA.*密码/);
  assert.equal(legacy.subtitle.classList.contains('qa-login-hint'), false,
    'normal delegated login should keep its compact layout');
  assert.ok(legacy.fields.every(field => field.disabled === false));
  const css = readFileSync(new URL('../account/ivory-entry.css', import.meta.url), 'utf8');
  assert.match(css, /\.ivory-entry #loginPanel>\.lead\.qa-login-hint\s*\{\s*display:block/,
    'actual mobile CSS must display the otherwise-hidden QA warning');
});


test('QA readiness survives unrelated busy-state transitions and never submits while offline', () => {
  const ui = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
  const start = ui.indexOf('  function syncLoginAvailability() {');
  const finish = ui.indexOf('\n\n  function showPanel(', start);
  assert.ok(start >= 0 && finish > start,
    'real login availability and busy handlers must exist');
  const body = ui.slice(start, finish);
  const simulate = vm.runInNewContext(
    '(function () {\n' +
    '  let delegatedIdentity = true, delegatedSignInReady = false, authBusy = false;\n' +
    '  const inputs = [{ disabled: false }, { disabled: false }];\n' +
    '  const buttons = [{ disabled: false }, { disabled: false }];\n' +
    '  const byId = name => name === "loginForm" ? { querySelectorAll: () => inputs } : null;\n' +
    '  const document = { querySelectorAll: () => buttons };\n' +
    body + '\n' +
    '  setAuthBusy(true);\n' +
    '  const whileBusy = inputs.every(x => x.disabled);\n' +
    '  setAuthBusy(false);\n' +
    '  const whileOffline = inputs.every(x => x.disabled);\n' +
    '  delegatedSignInReady = true;\n' +
    '  syncLoginAvailability();\n' +
    '  const afterReady = inputs.every(x => !x.disabled);\n' +
    '  delegatedIdentity = false;\n' +
    '  delegatedSignInReady = false;\n' +
    '  syncLoginAvailability();\n' +
    '  const localMode = inputs.every(x => !x.disabled);\n' +
    '  return { whileBusy, whileOffline, afterReady, localMode };\n' +
    '})'
  )();
  assert.equal(JSON.stringify(simulate), JSON.stringify({
    whileBusy: true, whileOffline: true, afterReady: true, localMode: true
  }));
  const handler = ui.slice(
    ui.indexOf("byId('loginForm').addEventListener('submit'"),
    ui.indexOf("byId('inviteForm').addEventListener('submit'")
  );
  assert.match(handler, /if \(delegatedIdentity && !delegatedSignInReady\) \{/);
  assert.ok(handler.indexOf('delegatedIdentity && !delegatedSignInReady') <
    handler.indexOf("api('/api/accounts/login'"),
    'blocked QA login must return before transmitting credentials');
});
