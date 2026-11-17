import test from 'node:test';
import assert from 'node:assert/strict';
import { probeExistingIdentityAuthority } from '../worker/lib/identity-bridge.js';

const SECRET = 'qa-internal-bridge-key-'.padEnd(40, 'x');
const OFFLINE = { connected: false, initialized: false, configured: false };

function delegated(binding, secret = SECRET) {
  return {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_BRIDGE_SECRET: secret,
    MAO_IDENTITY_AUTHORITY: binding
  };
}

test('QA gateway bootstrap probe authenticates the server-only service request', async () => {
  let calls = 0;
  const env = delegated({ fetch: async (request) => {
    calls++;
    assert.equal(request.url, 'https://mao520.com/api/admin/bootstrap/status');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('x-mao-identity-bridge'), SECRET);
    assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('authorization'), null);
    assert.ok(!request.url.includes(SECRET), 'service secret must not appear in a URL');
    return Response.json({ ok: true, initialized: true, configured: true, qaIsolatedAuthority: true, qaExpectedFounderId: 'MAO-SYNTHFOUNDER001' });
  } });
  assert.deepEqual(await probeExistingIdentityAuthority(env),
    { connected: true, initialized: true, configured: true, qaIsolatedAuthority: true, qaExpectedFounderId: 'MAO-SYNTHFOUNDER001' });
  assert.equal(calls, 1);
});

test('gateway probe fails closed before any network call without a valid bridge secret', async () => {
  for (const secret of [undefined, null, '', 'too-short']) {
    let calls = 0;
    const env = delegated({ fetch: async () => {
      calls++;
      return Response.json({ ok: true, initialized: true, configured: true });
    } });
    if (secret === undefined) delete env.MAO_IDENTITY_BRIDGE_SECRET;
    else env.MAO_IDENTITY_BRIDGE_SECRET = secret;
    assert.deepEqual(await probeExistingIdentityAuthority(env), OFFLINE);
    assert.equal(calls, 0, 'must not send an unauthenticated probe');
  }
});

test('gateway probe never trusts a forbidden, malformed or missing authority response', async () => {
  for (const response of [
    Response.json({ ok: false }, { status: 403 }),
    Response.json({ ok: true, initialized: 'true', configured: true }),
    Response.json({ ok: true, initialized: true }),
    Response.json({ initialized: true, configured: true })
  ]) {
    assert.deepEqual(await probeExistingIdentityAuthority(delegated({
      fetch: async () => response.clone()
    })), OFFLINE);
  }
  assert.deepEqual(await probeExistingIdentityAuthority(delegated({
    fetch: async () => { throw new Error('unavailable'); }
  })), OFFLINE);
});

test('gateway probe stays disabled for non-delegated mode or absent binding', async () => {
  let calls = 0;
  const env = delegated({ fetch: async () => {
    calls++;
    return Response.json({ ok: true, initialized: true, configured: true });
  } });
  env.MAO_IDENTITY_MODE = 'local';
  assert.deepEqual(await probeExistingIdentityAuthority(env), OFFLINE);
  assert.equal(calls, 0);
  assert.deepEqual(await probeExistingIdentityAuthority(delegated(null)), OFFLINE);
});

test('an apparently ready identity authority without the QA proof remains untrusted for privileged operations', async () => {
  const candidates = [
    { ok: true, initialized: true, configured: true },
    { ok: true, initialized: true, configured: true, qaIsolatedAuthority: false, qaExpectedFounderId: 'MAO-SYNTHFOUNDER001' },
    { ok: true, initialized: true, configured: true, qaIsolatedAuthority: true, qaExpectedFounderId: 'MAO-DIFFERENTFOUNDER01' }
  ];
  for (const candidate of candidates) {
    const r = await probeExistingIdentityAuthority(delegated({
      fetch: async () => Response.json(candidate)
    }));
    assert.equal(r.connected, true, 'availability remains separately observable');
    assert.equal(r.qaIsolatedAuthority, candidate.qaIsolatedAuthority === true);
    assert.equal(r.qaExpectedFounderId, candidate.qaExpectedFounderId || null);
    assert.ok(!(r.qaIsolatedAuthority === true &&
      r.qaExpectedFounderId === 'MAO-SYNTHFOUNDER001') ||
      candidate.qaIsolatedAuthority === true && candidate.qaExpectedFounderId === 'MAO-SYNTHFOUNDER001');
  }
});
