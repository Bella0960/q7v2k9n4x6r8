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

test('revoking a second device immediately invalidates its server authorization and preserves isolation', async () => {
  const { createHash } = await import('node:crypto');
  const now = 1_800_000_000_000;
  const accountA = 'MAO-AAAAAAAAAAAA';
  const accountB = 'MAO-BBBBBBBBBBBB';
  const tokens = ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)];
  const ids = ['session_A_12345678', 'session_B_12345678', 'session_C_12345678'];
  const sessions = tokens.map((token, index) => ({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    session_id: ids[index],
    account_id: index === 2 ? accountB : accountA,
    username: index === 2 ? 'other' : 'owner',
    role: 'user',
    status: 'active',
    expires_at: now + 60000,
    session_revoked_at: null
  }));
  const store = {
    getMaoAccountSession(hash) {
      const row = sessions.find(item => item.tokenHash === hash);
      return row ? { ...row } : null;
    },
    touchMaoAccountSession() {},
    revokeMaoAccountSessionForAccount(accountId, sessionId, timestamp) {
      const row = sessions.find(item => item.account_id === accountId &&
        item.session_id === sessionId && item.session_revoked_at == null);
      if (!row) return false;
      row.session_revoked_at = timestamp;
      return true;
    }
  };
  const auth = createAccountAuth({ store, now: () => now });
  const request = (index, path, method = 'GET') => new Request('https://mao.test' + path, {
    method,
    headers: { cookie: 'MAO_SESSION=' + tokens[index] }
  });
  const me = index => auth.handle(request(index, '/api/accounts/me'), '/api/accounts/me', 'GET');
  assert.equal((await me(0)).status, 200);
  assert.equal((await me(1)).status, 200);
  assert.equal((await me(2)).status, 200);

  const foreignPath = '/api/accounts/sessions/' + ids[2] + '/revoke';
  await assert.rejects(
    auth.handle(request(0, foreignPath, 'POST'), foreignPath, 'POST'),
    error => error.status === 404 || error.statusCode === 404,
    'an account must not revoke another account session'
  );
  assert.equal((await me(2)).status, 200, 'foreign account remains authorized');

  const revokePath = '/api/accounts/sessions/' + ids[1] + '/revoke';
  const revoked = await auth.handle(request(0, revokePath, 'POST'), revokePath, 'POST');
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).revoked, true);
  await assert.rejects(
    me(1),
    error => (error.status === 401 || error.statusCode === 401),
    'old cookie must be rejected after remote revocation'
  );
  assert.equal((await me(0)).status, 200, 'initiating device remains authorized');
  assert.equal((await me(2)).status, 200, 'unrelated account remains authorized');
});

test('revoked session cannot pass final authorization after a stale session lookup', async () => {
  const now = 1_800_000_000_000;
  const session = {
    session_id: 'session-race',
    account_id: 'MAO-AAAAAAAAAAAA',
    username: 'synthetic',
    role: 'user',
    status: 'active',
    expires_at: now + 60000,
    session_revoked_at: null
  };
  let touchAttempts = 0;
  const store = {
    // Simulates a lookup that finished before another device revoked this session.
    getMaoAccountSession() { return { ...session }; },
    // The atomic SQL UPDATE sees revoked_at and rejects the stale session.
    touchMaoAccountSession() { touchAttempts++; return false; }
  };
  const auth = createAccountAuth({ store, now: () => now });
  const request = new Request('https://mao.test/api/accounts/me', {
    headers: { cookie: 'MAO_SESSION=' + 'a'.repeat(43) }
  });
  assert.equal(await auth.getAuthenticatedAccount(request), null);
  assert.equal(touchAttempts, 1, 'a final storage check must run before authorizing');
  await assert.rejects(auth.handle(request, '/api/accounts/me', 'GET'),
    error => error.status === 401 && error.code === 'LOGIN_REQUIRED');
  assert.equal(touchAttempts, 2);
});
