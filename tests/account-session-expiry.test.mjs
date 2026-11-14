import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAuth } from '../worker/lib/account-auth.js';

// Isolated server-side session verification: no real credentials or production DB.
test('invalid, non-finite, unsafe and expired session timestamps fail closed', async () => {
  const now = 1_800_000_000_000;
  const session = {
    session_id: 'session-test',
    account_id: 'MAO-AAAAAAAAAAAA',
    username: 'synthetic',
    role: 'user',
    status: 'active',
    expires_at: now + 60_000,
    session_revoked_at: null
  };
  let touches = 0;
  const store = {
    getMaoAccountSession() { return { ...session }; },
    touchMaoAccountSession() { touches += 1; }
  };
  const auth = createAccountAuth({ store, now: () => now });
  const request = new Request('https://mao.test/api/accounts/me', {
    headers: { cookie: 'MAO_SESSION=' + 'a'.repeat(43) }
  });

  assert.equal((await auth.getAuthenticatedAccount(request))?.account_id, session.account_id);
  assert.equal(touches, 1, 'valid session must be recognized and touched');

  for (const invalid of ['not-a-date', 'NaN', 'Infinity', '-Infinity',
    Number.MAX_SAFE_INTEGER + 1, -1, 0, now - 1, now]) {
    session.expires_at = invalid;
    assert.equal(await auth.getAuthenticatedAccount(request), null,
      'malformed or expired session must not authenticate: ' + String(invalid));
  }
  assert.equal(touches, 1, 'rejected sessions must never refresh last-used timestamps');

  session.expires_at = now + 60_000;
  session.session_revoked_at = now - 1;
  assert.equal(await auth.getAuthenticatedAccount(request), null,
    'revoked session cannot be restored by a valid expiry');
  assert.equal(touches, 1);
});

test('security session list flags malformed expiry as expired without exposing active revoke action', async () => {
  const now = 1_800_000_000_000;
  const currentId = 'session-current';
  const rows = [
    { id: currentId, created_at: now - 1000, expires_at: now + 60000, last_used_at: now, revoked_at: null },
    { id: 'bad-nan', created_at: now - 1000, expires_at: 'not-a-date', last_used_at: now, revoked_at: null },
    { id: 'bad-infinite', created_at: now - 1000, expires_at: 'Infinity', last_used_at: now, revoked_at: null },
    { id: 'bad-unsafe', created_at: now - 1000, expires_at: Number.MAX_SAFE_INTEGER + 1, last_used_at: now, revoked_at: null },
    { id: 'expired', created_at: now - 1000, expires_at: now - 1, last_used_at: now, revoked_at: null },
    { id: 'revoked', created_at: now - 1000, expires_at: now + 60000, last_used_at: now, revoked_at: now - 1 }
  ];
  const store = {
    getMaoAccountSession() {
      return {
        session_id: currentId,
        account_id: 'MAO-AAAAAAAAAAAA',
        username: 'synthetic',
        role: 'user',
        status: 'active',
        expires_at: now + 60000,
        session_revoked_at: null
      };
    },
    touchMaoAccountSession() {},
    listMaoAccountDevices() { return []; },
    listMaoAccountSessions() { return rows; }
  };
  const auth = createAccountAuth({ store, now: () => now });
  const request = new Request('https://mao.test/api/accounts/security', {
    headers: { cookie: 'MAO_SESSION=' + 'a'.repeat(43) }
  });
  const response = await auth.handle(request, '/api/accounts/security', 'GET');
  assert.equal(response.status, 200);
  const data = await response.json();
  const sessions = new Map(data.sessions.map(row => [row.id, row]));
  assert.equal(data.currentSessionId, currentId);
  assert.equal(sessions.get(currentId).expired, false);
  for (const id of ['bad-nan', 'bad-infinite', 'bad-unsafe', 'expired']) {
    assert.equal(sessions.get(id).expired, true, id + ' must not appear active');
  }
  assert.equal(sessions.get('revoked').revokedAt, now - 1);
});
