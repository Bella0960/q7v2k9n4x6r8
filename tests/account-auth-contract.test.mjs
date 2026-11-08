import test from 'node:test';
import assert from 'node:assert/strict';
import { randomToken, sha256Hex } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';
import { applyMigrations, MIGRATIONS, splitSql } from '../worker/lib/migrations.js';

const BOOTSTRAP_SECRET = 'test-mao-super-admin-bootstrap-secret-32-characters';

function cookieFrom(response) {
  const value = response.headers.get('set-cookie') || '';
  const match = /MAO_SESSION=([^;]+)/.exec(value);
  assert.ok(match, '登录响应必须设置 HttpOnly MAO_SESSION cookie');
  return 'MAO_SESSION=' + match[1];
}

async function json(response) {
  return { status: response.status, payload: await response.json() };
}

async function post(ctx, path, body, cookie = '') {
  const headers = cookie ? { cookie } : {};
  return ctx.asJson(path, { method: 'POST', body, headers });
}

test('旧数据库已经应用 0012 时，新增 0013 可安全补上恢复状态字段', () => {
  const db = openTestDb();
  // Simulate an installation whose schema_migrations already records 0012.
  for (const migration of MIGRATIONS.filter(item => item.version !== '0013_mao_account_restore_state')) {
    for (const statement of splitSql(migration.sql)) db.exec(statement);
    db.exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      migration.version,
      1
    );
  }
  const before = db.query('PRAGMA table_info(mao_accounts)').map(column => column.name);
  assert.ok(!before.includes('disabled_from_status'),
    '0012 must remain unchanged so previously applied databases do not skip this schema change');

  const ctx = setupTestStore(db);
  const after = ctx.query('PRAGMA table_info(mao_accounts)').map(column => column.name);
  assert.ok(after.includes('disabled_from_status'),
    '0013 must add the restore-state field to an existing MAO account table');
  assert.ok(
    ctx.query('SELECT version FROM schema_migrations WHERE version = ?', '0013_mao_account_restore_state').length === 1
  );
});

test('迁移版本号写入失败时，DDL 一并回滚并可安全重试', () => {
  const db = openTestDb();
  for (const migration of MIGRATIONS.filter(item => item.version !== '0013_mao_account_restore_state')) {
    for (const statement of splitSql(migration.sql)) db.exec(statement);
    db.exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      migration.version,
      1
    );
  }

  const failingExec = (sql, ...params) => {
    if (/^\s*INSERT INTO schema_migrations/i.test(sql) &&
        params[0] === '0013_mao_account_restore_state') {
      throw new Error('simulated migration marker write failure');
    }
    return db.exec(sql, ...params);
  };
  assert.throws(() => applyMigrations(failingExec), /simulated migration marker write failure/);
  const afterFailure = db.query('PRAGMA table_info(mao_accounts)').map(column => column.name);
  assert.ok(!afterFailure.includes('disabled_from_status'),
    '0013 的 ALTER TABLE 必须与迁移记录一起回滚');
  assert.equal(
    db.query('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = ?', '0013_mao_account_restore_state')[0].total,
    0
  );

  applyMigrations(db.exec);
  const afterRetry = db.query('PRAGMA table_info(mao_accounts)').map(column => column.name);
  assert.ok(afterRetry.includes('disabled_from_status'), '迁移回滚后应能完整重试');
});

test('0012 创建独立 MAO 账号、会话、邀请码与审计表', () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const tables = ctx.query("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name);
  for (const name of ['mao_accounts', 'mao_account_sessions', 'mao_invite_codes', 'mao_account_audit']) {
    assert.ok(tables.includes(name), '缺少 ' + name);
  }
  const indexes = ctx.query("SELECT name FROM sqlite_master WHERE type='index'").map(row => row.name);
  for (const name of ['idx_mao_single_super_admin', 'idx_mao_sessions_account_active', 'idx_mao_invites_target_account']) {
    assert.ok(indexes.includes(name), '缺少索引 ' + name);
  }
});

test('管理员初始化唯一、账号注册先生成永久 ID 并保持待授权', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const statusBefore = await ctx.asJson('/api/admin/bootstrap/status');
  assert.equal(statusBefore.status, 200);
  assert.equal(statusBefore.payload.initialized, false);
  const first = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  const firstResult = await json(first);
  assert.equal(firstResult.status, 200);
  assert.match(firstResult.payload.account.id, /^MAO-[A-Z0-9]{12,24}$/);
  assert.equal(firstResult.payload.account.role, 'super_admin');
  const statusAfter = await ctx.asJson('/api/admin/bootstrap/status');
  assert.equal(statusAfter.payload.initialized, true);
  const second = await ctx.asJson('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'another', password: 'another-password-123' }
  });
  assert.equal(second.status, 409, '只能初始化一个超级管理员');

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'alice', password: 'alice-password-123', confirmPassword: 'alice-password-123' }
  });
  assert.equal(registered.status, 201);
  assert.match(registered.payload.account.id, /^MAO-[A-Z0-9]{12,24}$/);
  assert.equal(registered.payload.account.status, 'pending_invite');
  assert.notEqual(registered.payload.account.id, firstResult.payload.account.id);
});

test('登录会话与旧标签页 MAO 上下文不一致时，所有账号 API 都必须拒绝', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);

  const alice = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'tab-alice', password: 'tab-alice-password-123', confirmPassword: 'tab-alice-password-123' }
  });
  const bob = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'tab-bob', password: 'tab-bob-password-123', confirmPassword: 'tab-bob-password-123' }
  });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);

  const aliceLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'tab-alice', password: 'tab-alice-password-123' }
  });
  const bobLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'tab-bob', password: 'tab-bob-password-123' }
  });
  const aliceCookie = cookieFrom(aliceLogin);
  const bobCookie = cookieFrom(bobLogin);

  const staleTab = await ctx.fetchTo('/api/accounts/me', {
    headers: {
      cookie: bobCookie,
      'x-mao-account-context': alice.payload.account.id
    }
  });
  const staleResult = await json(staleTab);
  assert.equal(staleResult.status, 409);
  assert.equal(staleResult.payload.error.code, 'ACCOUNT_CONTEXT_CHANGED');

  const staleSecurity = await ctx.fetchTo('/api/accounts/security', {
    headers: {
      cookie: bobCookie,
      'x-mao-account-context': alice.payload.account.id
    }
  });
  assert.equal(staleSecurity.status, 409,
    '旧标签页不得读取新账号的设备和会话列表');

  const currentTab = await ctx.fetchTo('/api/accounts/me', {
    headers: {
      cookie: bobCookie,
      'x-mao-account-context': bob.payload.account.id
    }
  });
  const currentResult = await json(currentTab);
  assert.equal(currentResult.status, 200);
  assert.equal(currentResult.payload.account.id, bob.payload.account.id);

  const legacyRequest = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: aliceCookie },
    accountContext: false
  });
  assert.equal(legacyRequest.status, 200,
    '未注入账号上下文的既有客户端仍可完成登录兼容流程');
});

test('已登录会话访问私有账号 API 必须提供页面 MAO 上下文', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'context-user',
      password: 'context-user-password-123',
      confirmPassword: 'context-user-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'context-user', password: 'context-user-password-123' }
  });
  const cookie = cookieFrom(login);

  const unboundSecurity = await ctx.fetchTo('/api/accounts/security', {
    headers: { cookie },
    accountContext: false
  });
  const unboundResult = await json(unboundSecurity);
  assert.equal(unboundResult.status, 409);
  assert.equal(unboundResult.payload.error.code, 'ACCOUNT_CONTEXT_REQUIRED');

  const boundSecurity = await ctx.fetchTo('/api/accounts/security', { headers: { cookie } });
  assert.equal(boundSecurity.status, 200,
    '模拟 Worker 注入的页面上下文后，账号管理页面可以读取自己的设备与会话');

  const unboundInviteRedeem = await ctx.fetchTo('/api/accounts/invites/redeem', {
    method: 'POST',
    body: { inviteCode: 'A'.repeat(32) },
    headers: { cookie },
    accountContext: false
  });
  const unboundInviteResult = await json(unboundInviteRedeem);
  assert.equal(unboundInviteResult.status, 409);
  assert.equal(unboundInviteResult.payload.error.code, 'ACCOUNT_CONTEXT_REQUIRED');

  const publicMe = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie },
    accountContext: false
  });
  assert.equal(publicMe.status, 200,
    '公开账号入口仍能恢复当前会话，不要求尚未注入的页面上下文');
});

test('邀请码绑定指定永久 ID：其他账号不能使用，正确账号核销一次后生效', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  const adminCookie = cookieFrom(adminResponse);

  const alice = await ctx.asJson('/api/accounts/register', {
    method: 'POST', body: { username: 'alice', password: 'alice-password-123', confirmPassword: 'alice-password-123' }
  });
  const bob = await ctx.asJson('/api/accounts/register', {
    method: 'POST', body: { username: 'bob', password: 'bob-password-123', confirmPassword: 'bob-password-123' }
  });
  const aliceLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  const bobLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'bob', password: 'bob-password-123' }
  });
  const aliceCookie = cookieFrom(aliceLogin);
  const bobCookie = cookieFrom(bobLogin);

  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: alice.payload.account.id }, adminCookie);
  assert.equal(invite.status, 201);
  assert.equal(invite.payload.invite.maxUses, 1);
  assert.match(invite.payload.invite.code, /^[A-Za-z0-9_-]{32,128}$/);
  const duplicateInvite = await post(ctx, '/api/admin/invites', { targetAccountId: alice.payload.account.id }, adminCookie);
  assert.equal(duplicateInvite.status, 409, '同一账号不能同时持有多个有效邀请码');

  const wrongAccount = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, bobCookie);
  assert.equal(wrongAccount.status, 403);

  const redeemed = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, aliceCookie);
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.payload.account.status, 'active');
  assert.equal(redeemed.payload.authorized, true);

  const replay = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, aliceCookie);
  assert.equal(replay.status, 409, '已授权账号不得重复核销邀请码');

  const inviteList = await ctx.fetchTo('/api/admin/invites', { headers: { cookie: adminCookie } });
  const listResult = await json(inviteList);
  assert.equal(listResult.status, 200);
  assert.equal(JSON.stringify(listResult.payload).includes('token_hash'), false, '管理列表不得泄露邀请码哈希');
});

test('创作者管理中心默认列表可返回完整 500 名普通账号，不让管理员占用名额', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(admin);
  const adminCreatedAt = ctx.query(
    "SELECT created_at FROM mao_accounts WHERE role = 'super_admin'"
  )[0].created_at;

  // Make the creator account newer than these ordinary users so a LIMIT applied
  // before role filtering would incorrectly return only 499 ordinary accounts.
  for (let index = 0; index < 505; index += 1) {
    const suffix = String(index).padStart(12, '0');
    const username = 'capacity_' + index;
    const createdAt = Number(adminCreatedAt) - 10000 + index;
    ctx.store.exec(
      "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'test-salt', 'test-hash', 'user', 'pending_invite', ?, ?)",
      'MAO-' + suffix, username, username, createdAt, createdAt
    );
  }

  const response = await ctx.fetchTo('/api/admin/accounts', {
    headers: { cookie: adminCookie }
  });
  const result = await json(response);
  assert.equal(result.status, 200);
  assert.equal(result.payload.accounts.length, 500,
    '管理列表默认应返回完整 500 名普通账号，超级管理员不能占用名额');
  assert.ok(result.payload.accounts.every(account => account.role === 'user'));
  assert.ok(result.payload.accounts.some(account => account.username === 'capacity_504'));
  assert.ok(!result.payload.accounts.some(account => account.username === 'capacity_0'));
});

test('并发创建同一目标账号的邀请码时只允许一张有效邀请码', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(admin);
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-race',
      password: 'invite-race-password-123',
      confirmPassword: 'invite-race-password-123'
    }
  });
  assert.equal(registered.status, 201);

  const results = await Promise.all([
    post(ctx, '/api/admin/invites', { targetAccountId: registered.payload.account.id }, adminCookie),
    post(ctx, '/api/admin/invites', { targetAccountId: registered.payload.account.id }, adminCookie)
  ]);
  const statuses = results.map(response => response.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409],
    '并发请求也只能创建一张绑定同一账号的有效邀请码');
  assert.equal(
    Number(ctx.query(
      "SELECT COUNT(*) AS total FROM mao_invite_codes WHERE target_account_id = ? AND revoked_at IS NULL AND used_count < max_uses AND expires_at > ?",
      registered.payload.account.id, ctx.now()
    )[0].total),
    1
  );
});

test('账号停用会撤销全部会话与设备凭据，恢复不能恢复旧设备，永久撤销不可恢复', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  const adminCookie = cookieFrom(adminResponse);
  const alice = await ctx.asJson('/api/accounts/register', {
    method: 'POST', body: { username: 'alice', password: 'alice-password-123', confirmPassword: 'alice-password-123' }
  });
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  const aliceCookie = cookieFrom(login);

  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: alice.payload.account.id }, adminCookie);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, aliceCookie);
  assert.equal(redeemed.status, 200);

  const device = { deviceId: 'device_alice_0001', secret: randomToken(32) };
  const deviceResult = await post(ctx, '/api/devices/register', {
    ...device, label: 'Alice phone', platform: 'test'
  }, aliceCookie);
  assert.equal(deviceResult.status, 200);
  const reenrollWithoutAccount = await post(ctx, '/api/devices/register', {
    ...device, label: 'unauthenticated attempt', platform: 'test'
  });
  assert.equal(reenrollWithoutAccount.status, 401, '现有设备重新注册也必须提供 MAO 会话');
  const reenrollWithAccount = await post(ctx, '/api/devices/register', {
    ...device, label: 'Alice phone', platform: 'test'
  }, aliceCookie);
  assert.equal(reenrollWithAccount.status, 200);
  const activeApi = await ctx.fetchTo('/api/autonomy/global', { headers: { cookie: aliceCookie, 'x-device-auth': device.deviceId + '.' + device.secret } });
  assert.notEqual(activeApi.status, 403);

  const disabled = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'disable', reason: '测试管理原因' }, adminCookie);
  assert.equal(disabled.status, 200);
  const disabledApi = await ctx.fetchTo('/api/autonomy/global', { headers: { cookie: aliceCookie, 'x-device-auth': device.deviceId + '.' + device.secret } });
  const disabledJson = await json(disabledApi);
  assert.equal(disabledJson.status, 403);
  assert.equal(disabledJson.payload.error.message, '您的账号已被禁用');
  const auditResponse = await ctx.fetchTo('/api/admin/accounts/' + alice.payload.account.id + '/audit', {
    headers: { cookie: adminCookie }
  });
  const auditResult = await json(auditResponse);
  assert.equal(auditResult.status, 200);
  assert.equal(auditResult.payload.records[0].reason, '测试管理原因');
  const userCannotReadAudit = await ctx.fetchTo('/api/admin/accounts/' + alice.payload.account.id + '/audit', {
    headers: { cookie: aliceCookie }
  });
  assert.equal(userCannotReadAudit.status, 403, '管理原因和审计记录只允许超级管理员查看');
  const disabledWrongPassword = await ctx.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'wrong-password-123' }
  });
  assert.equal(disabledWrongPassword.status, 401, '错误密码不能探测账号是否已停用');
  const disabledLogin = await ctx.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  assert.equal(disabledLogin.status, 403);
  assert.equal(disabledLogin.payload.error.message, '您的账号已被禁用');

  const restored = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'restore' }, adminCookie);
  assert.equal(restored.status, 200);
  const relogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  const restoredCookie = cookieFrom(relogin);
  const oldDeviceStillDenied = await ctx.fetchTo('/api/autonomy/global', {
    headers: { cookie: restoredCookie, 'x-device-auth': device.deviceId + '.' + device.secret }
  });
  assert.equal(oldDeviceStillDenied.status, 401, '恢复账号不能复活已撤销的设备凭据');

  const revoked = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'revoke' }, adminCookie);
  assert.equal(revoked.status, 200);
  const restoreRevoked = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'restore' }, adminCookie);
  assert.equal(restoreRevoked.status, 409, '永久撤销不可恢复');
});

test('云端设备密钥必须与同一个 MAO 会话配对，不能跨账号组合使用', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(admin);

  const alice = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'device-alice', password: 'device-alice-password-123', confirmPassword: 'device-alice-password-123' }
  });
  const bob = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'device-bob', password: 'device-bob-password-123', confirmPassword: 'device-bob-password-123' }
  });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);

  for (const account of [alice, bob]) {
    const invite = await post(
      ctx,
      '/api/admin/invites',
      { targetAccountId: account.payload.account.id },
      adminCookie
    );
    assert.equal(invite.status, 201);
    const login = await ctx.fetchTo('/api/accounts/login', {
      method: 'POST',
      body: {
        identifier: account.payload.account.username,
        password: account.payload.account.username + '-password-123'
      }
    });
    const cookie = cookieFrom(login);
    const redeemed = await post(
      ctx,
      '/api/accounts/invites/redeem',
      { inviteCode: invite.payload.invite.code },
      cookie
    );
    assert.equal(redeemed.status, 200);
    account.cookie = cookie;
  }

  const aliceDevice = {
    deviceId: 'device_alice_isolated_01',
    secret: randomToken(32)
  };
  const bobDevice = {
    deviceId: 'device_bob_isolated_01',
    secret: randomToken(32)
  };
  const aliceEnrollment = await post(ctx, '/api/devices/register', {
    ...aliceDevice, label: 'Alice phone', platform: 'test'
  }, alice.cookie);
  const bobEnrollment = await post(ctx, '/api/devices/register', {
    ...bobDevice, label: 'Bob phone', platform: 'test'
  }, bob.cookie);
  assert.equal(aliceEnrollment.status, 200);
  assert.equal(bobEnrollment.status, 200);

  const aliceApi = await ctx.fetchTo('/api/autonomy/global', {
    headers: {
      cookie: alice.cookie,
      'x-device-auth': aliceDevice.deviceId + '.' + aliceDevice.secret
    }
  });
  assert.equal(aliceApi.status, 200);

  const bobApiWithAliceDevice = await ctx.fetchTo('/api/autonomy/global', {
    headers: {
      cookie: bob.cookie,
      'x-device-auth': aliceDevice.deviceId + '.' + aliceDevice.secret
    }
  });
  const bobApiResult = await json(bobApiWithAliceDevice);
  assert.equal(bobApiResult.status, 401);
  assert.equal(bobApiResult.payload.error.code, 'ACCOUNT_SESSION_REQUIRED',
    'B 的会话不能与 A 的设备凭据组合访问云端数据');

  const bobCannotReEnrollAliceDevice = await post(ctx, '/api/devices/register', {
    ...aliceDevice, label: 'attempted takeover', platform: 'test'
  }, bob.cookie);
  assert.equal(bobCannotReEnrollAliceDevice.status, 401);
  assert.equal(bobCannotReEnrollAliceDevice.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');

  const aliceOwner = ctx.query(
    'SELECT user_id FROM devices WHERE id = ?',
    aliceDevice.deviceId
  )[0];
  const bobOwner = ctx.query(
    'SELECT user_id FROM devices WHERE id = ?',
    bobDevice.deviceId
  )[0];
  assert.equal(aliceOwner.user_id, alice.payload.account.id);
  assert.equal(bobOwner.user_id, bob.payload.account.id);
  assert.notEqual(aliceOwner.user_id, bobOwner.user_id);
});

test('超级管理员初始化后遗留 owner 设备不能绕过 MAO 会话校验', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(adminResponse.status, 200);

  // Simulate an orphaned legacy owner row left by an interrupted/partial migration.
  // Once the permanent creator account exists, such a row must fail closed.
  const deviceId = 'legacy_owner_device_001';
  const secret = randomToken(32);
  const pepper = 'test-device-secret-pepper-for-contract-tests-32chars';
  const secretHash = await sha256Hex(pepper + '|' + deviceId + '|' + secret);
  ctx.store.exec(
    "INSERT INTO devices (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at) VALUES (?, 'owner', ?, 'legacy device', 'test', '', '', ?, ?)",
    deviceId, secretHash, ctx.now(), ctx.now()
  );

  const api = await ctx.fetchTo('/api/autonomy/global', {
    headers: { 'x-device-auth': deviceId + '.' + secret }
  });
  const apiResult = await json(api);
  assert.equal(apiResult.status, 401);
  assert.equal(apiResult.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');

  const reRegister = await post(ctx, '/api/devices/register', {
    deviceId,
    secret,
    label: 'legacy device',
    platform: 'test'
  });
  assert.equal(reRegister.status, 401);
  assert.equal(reRegister.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');
});

test('停用并恢复尚未核销邀请码的账号仍保持待授权，不能绕过一人一码', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(adminResponse);

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'pending-user',
      password: 'pending-user-password-123',
      confirmPassword: 'pending-user-password-123'
    }
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.payload.account.status, 'pending_invite');

  const disabled = await post(
    ctx,
    '/api/admin/accounts/' + registered.payload.account.id + '/action',
    { action: 'disable', reason: '注册流程暂停' },
    adminCookie
  );
  assert.equal(disabled.status, 200);

  const restored = await post(
    ctx,
    '/api/admin/accounts/' + registered.payload.account.id + '/action',
    { action: 'restore' },
    adminCookie
  );
  assert.equal(restored.status, 200);

  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'pending-user', password: 'pending-user-password-123' }
  });
  assert.equal(login.status, 200);
  const userCookie = cookieFrom(login);
  const me = await ctx.fetchTo('/api/accounts/me', { headers: { cookie: userCookie } });
  const meResult = await json(me);
  assert.equal(meResult.status, 200);
  assert.equal(meResult.payload.account.status, 'pending_invite',
    '恢复必须还原到停用前状态，不能把未核销邀请码的账号改为 active');

  const device = await post(ctx, '/api/devices/register', {
    deviceId: 'device_pending_0001',
    secret: randomToken(32),
    label: 'pending device',
    platform: 'test'
  }, userCookie);
  assert.equal(device.status, 403);
  assert.equal(device.payload.error.code, 'INVITE_REQUIRED');

  const invite = await post(
    ctx,
    '/api/admin/invites',
    { targetAccountId: registered.payload.account.id },
    adminCookie
  );
  assert.equal(invite.status, 201);
  const redeemed = await post(
    ctx,
    '/api/accounts/invites/redeem',
    { inviteCode: invite.payload.invite.code },
    userCookie
  );
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.payload.account.status, 'active');
});

test('恢复没有历史授权状态的旧 disabled 账号时按待授权处理', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(admin);

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'legacy-disabled',
      password: 'legacy-disabled-password-123',
      confirmPassword: 'legacy-disabled-password-123'
    }
  });
  assert.equal(registered.status, 201);
  ctx.store.exec(
    "UPDATE mao_accounts SET status = 'disabled', disabled_from_status = NULL WHERE id = ?",
    registered.payload.account.id
  );

  const restored = await post(
    ctx,
    '/api/admin/accounts/' + registered.payload.account.id + '/action',
    { action: 'restore' },
    adminCookie
  );
  assert.equal(restored.status, 200);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'legacy-disabled', password: 'legacy-disabled-password-123' }
  });
  const userCookie = cookieFrom(login);
  const me = await ctx.fetchTo('/api/accounts/me', { headers: { cookie: userCookie } });
  const result = await json(me);
  assert.equal(result.status, 200);
  assert.equal(result.payload.account.status, 'pending_invite',
    '缺少可证明授权历史的旧账号不能因恢复操作获得 active 权限');
});

test('并发注册不能突破同一来源每小时八个 MAO 账号的上限', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const username = 'quota_' + suffix;
    const password = 'quota-password-' + suffix;
    return ctx.asJson('/api/accounts/register', {
      method: 'POST',
      body: { username, password, confirmPassword: password },
      ip: '198.51.100.44'
    });
  }));
  assert.equal(attempts.filter(item => item.status === 201).length, 8);
  assert.equal(attempts.filter(item => item.status === 429).length, 2);
  assert.equal(
    Number(ctx.query("SELECT COUNT(*) AS total FROM mao_accounts WHERE registration_ip_hash != ''")[0].total),
    8,
    '数据库中也不能留下超过配额的账号记录'
  );
});

test('重复错误登录触发持久化限流，窗口过期后恢复并清除失败计数', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'rate-user', password: 'rate-user-password-123', confirmPassword: 'rate-user-password-123' }
  });
  assert.equal(registered.status, 201);

  for (let index = 0; index < 7; index += 1) {
    const failed = await ctx.asJson('/api/accounts/login', {
      method: 'POST',
      body: { identifier: 'rate-user', password: 'incorrect-password-123' }
    });
    assert.equal(failed.status, 401);
  }
  const eighth = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'rate-user', password: 'incorrect-password-123' }
  });
  assert.equal(eighth.status, 429);
  const stillBlocked = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'rate-user', password: 'rate-user-password-123' }
  });
  assert.equal(stillBlocked.status, 429, '封锁期间正确密码也不能绕过限流');

  const later = ctx.now() + 15 * 60 * 1000 + 1;
  ctx.timestamps.push(later);
  const recovered = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'rate-user', password: 'rate-user-password-123' }
  });
  assert.equal(recovered.status, 200);
  const limits = ctx.query('SELECT COUNT(*) AS total FROM mao_login_rate_limits');
  assert.equal(Number(limits[0].total), 0, '成功登录后清除该来源的失败计数');
});

test('账号安全只返回本人设备与会话，并支持撤销设备、会话及修改密码', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  const adminCookie = cookieFrom(adminResponse);

  const registerAccount = async username => {
    const result = await ctx.asJson('/api/accounts/register', {
      method: 'POST',
      body: { username, password: username + '-password-123', confirmPassword: username + '-password-123' }
    });
    assert.equal(result.status, 201);
    const invite = await post(ctx, '/api/admin/invites', { targetAccountId: result.payload.account.id }, adminCookie);
    assert.equal(invite.status, 201);
    const login = await ctx.fetchTo('/api/accounts/login', {
      method: 'POST',
      body: { identifier: username, password: username + '-password-123' }
    });
    const cookie = cookieFrom(login);
    const redeemed = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, cookie);
    assert.equal(redeemed.status, 200);
    return { account: result.payload.account, cookie };
  };

  const alice = await registerAccount('alice');
  const bob = await registerAccount('bob');
  const aliceSecondLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'alice', password: 'alice-password-123' }
  });
  const aliceSecondCookie = cookieFrom(aliceSecondLogin);

  const createDevice = async (cookie, id, secret) => {
    const response = await post(ctx, '/api/devices/register', {
      deviceId: id, secret, label: id, platform: 'test'
    }, cookie);
    assert.equal(response.status, 200);
    return { id, secret };
  };
  const aliceDevice = await createDevice(alice.cookie, 'device_alice_0001', randomToken(32));
  const bobDevice = await createDevice(bob.cookie, 'device_bob_000001', randomToken(32));

  const security = await ctx.fetchTo('/api/accounts/security', { headers: { cookie: alice.cookie } });
  const securityResult = await json(security);
  assert.equal(securityResult.status, 200);
  assert.equal(securityResult.payload.devices.length, 1);
  assert.equal(securityResult.payload.devices[0].id, aliceDevice.id);
  assert.equal(securityResult.payload.sessions.length, 2);
  assert.ok(securityResult.payload.sessions.some(session => session.current));
  assert.ok(!JSON.stringify(securityResult.payload).includes(bobDevice.id), '不得返回其他账号的设备信息');

  const crossRevoke = await post(ctx, '/api/accounts/devices/' + bobDevice.id + '/revoke', {}, alice.cookie);
  assert.equal(crossRevoke.status, 404, '不能撤销其他账号的设备');

  const revokeAliceDevice = await post(ctx, '/api/accounts/devices/' + aliceDevice.id + '/revoke', {}, alice.cookie);
  assert.equal(revokeAliceDevice.status, 200);
  const oldDeviceRequest = await ctx.fetchTo('/api/autonomy/global', {
    headers: { cookie: alice.cookie, 'x-device-auth': aliceDevice.id + '.' + aliceDevice.secret }
  });
  assert.equal(oldDeviceRequest.status, 401);

  const aliceSessions = ctx.query(
    'SELECT id FROM mao_account_sessions WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at',
    alice.account.id
  );
  assert.equal(aliceSessions.length, 2);
  const otherSessionId = securityResult.payload.sessions.find(session => !session.current).id;
  const revokeOther = await post(ctx, '/api/accounts/sessions/' + otherSessionId + '/revoke', {}, alice.cookie);
  assert.equal(revokeOther.status, 200);
  const otherSessionCheck = await ctx.fetchTo('/api/accounts/me', { headers: { cookie: aliceSecondCookie } });
  assert.equal(otherSessionCheck.status, 401);

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const failed = await post(ctx, '/api/accounts/password/change', {
      currentPassword: 'wrong-current-password',
      newPassword: 'alice-new-password-456',
      confirmPassword: 'alice-new-password-456'
    }, alice.cookie);
    assert.equal(failed.status, 401);
  }
  const blockedPasswordAttempt = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'wrong-current-password',
    newPassword: 'alice-new-password-456',
    confirmPassword: 'alice-new-password-456'
  }, alice.cookie);
  assert.equal(blockedPasswordAttempt.status, 429);
  const correctButBlocked = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'alice-password-123',
    newPassword: 'alice-new-password-456',
    confirmPassword: 'alice-new-password-456'
  }, alice.cookie);
  assert.equal(correctButBlocked.status, 429,
    '密码验证触发限流后，即使输入正确当前密码也要等待窗口结束');
  ctx.timestamps.push(ctx.now() + 16 * 60 * 1000);

  const passwordChange = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'alice-password-123',
    newPassword: 'alice-new-password-456',
    confirmPassword: 'alice-new-password-456'
  }, alice.cookie);
  assert.equal(passwordChange.status, 200);
  assert.equal(passwordChange.payload.changed, true);

  const oldPasswordLogin = await ctx.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-new-password-456' }
  });
  assert.equal(newPasswordLogin.status, 200);

  const bobStillActive = await ctx.fetchTo('/api/accounts/me', { headers: { cookie: bob.cookie } });
  assert.equal(bobStillActive.status, 200, '修改 Alice 的密码不得影响 Bob');
});

test('首次管理员初始化密钥错误会被持久化限流，初始化完成后入口状态关闭', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  for (let index = 0; index < 7; index += 1) {
    const failed = await ctx.asJson('/api/admin/bootstrap', {
      method: 'POST',
      body: { bootstrapSecret: 'wrong-bootstrap-secret-32-characters-long', username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
    });
    assert.equal(failed.status, 403);
  }
  const eighth = await ctx.asJson('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: 'wrong-bootstrap-secret-32-characters-long', username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  assert.equal(eighth.status, 429);
  const correctButBlocked = await ctx.asJson('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  assert.equal(correctButBlocked.status, 429);

  ctx.timestamps.push(ctx.now() + 15 * 60 * 1000 + 1);
  const initialized = await ctx.asJson('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
  });
  assert.equal(initialized.status, 200);
  const status = await ctx.asJson('/api/admin/bootstrap/status');
  assert.equal(status.payload.initialized, true);
});

test('QQ 邮箱只有完成所有权验证后才能作为登录标识与邀请码绑定目标', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'email-user',
      password: 'email-user-password-123',
      confirmPassword: 'email-user-password-123',
      qqEmail: 'owner-test@qq.com'
    }
  });
  assert.equal(registered.status, 201);

  const unverifiedLogin = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'owner-test@qq.com', password: 'email-user-password-123' }
  });
  assert.equal(unverifiedLogin.status, 401, '未验证邮箱不能作为登录标识');

  ctx.store.exec(
    "UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?",
    ctx.now(),
    registered.payload.account.id
  );
  const verifiedLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'OWNER-TEST@qq.com', password: 'email-user-password-123' }
  });
  assert.equal(verifiedLogin.status, 200, '验证后 QQ 邮箱可以作为登录标识');

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  const adminCookie = cookieFrom(adminResponse);
  const emailInvite = await post(ctx, '/api/admin/invites', { targetEmail: 'owner-test@qq.com' }, adminCookie);
  assert.equal(emailInvite.status, 201);
  const idInvite = await post(ctx, '/api/admin/invites', { targetAccountId: registered.payload.account.id }, adminCookie);
  assert.equal(idInvite.status, 409, '通过邮箱或永久 ID 绑定的同一个账号不能同时拥有两个有效邀请码');
});

test('创作者初始化迁移失败会完整回滚账号与全部 owner 数据归属', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const deviceId = 'legacy_owner_device_rollback';
  ctx.store.exec(
    "INSERT INTO devices (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at) VALUES (?, 'owner', 'legacy-hash', 'creator phone', 'test', '', '', ?, ?)",
    deviceId, ctx.now(), ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO user_autonomy (user_id, enabled, updated_at) VALUES ('owner', 1, ?)",
    ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_schedules (user_id, character_id, time_zone, schedule_json, updated_at) VALUES ('owner', 'role-old', 'UTC', '{}', ?)",
    ctx.now()
  );
  ctx.store.exec(
    "CREATE TRIGGER fail_owner_schedule_adoption BEFORE UPDATE OF user_id ON character_schedules WHEN OLD.user_id = 'owner' BEGIN SELECT RAISE(ABORT, 'forced migration failure'); END"
  );

  const failed = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(failed.status, 500);
  assert.equal(Number(ctx.query("SELECT COUNT(*) AS total FROM mao_accounts WHERE role = 'super_admin'")[0].total), 0,
    '管理员记录必须随失败的迁移一起回滚');
  assert.equal(ctx.query('SELECT user_id FROM devices WHERE id = ?', deviceId)[0].user_id, 'owner',
    '前面已经执行过的设备归属更新也必须回滚');
  assert.equal(Number(ctx.query("SELECT COUNT(*) AS total FROM user_autonomy WHERE user_id = 'owner'")[0].total), 1);

  ctx.store.exec('DROP TRIGGER fail_owner_schedule_adoption');
  const retry = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(retry.status, 200, '修复迁移阻塞条件后应允许安全重试');
});

test('唯一超级管理员初始化时完整接管旧 owner 云端元数据，不复制也不丢失记录', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const legacyDeviceId = 'legacy_owner_device_001';
  ctx.store.exec(
    "INSERT INTO devices (id, user_id, secret_hash, label, platform, user_agent, ip_hash, created_at, last_seen_at) VALUES (?, 'owner', 'legacy-hash', 'creator phone', 'test', '', '', ?, ?)",
    legacyDeviceId, ctx.now(), ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO user_autonomy (user_id, enabled, updated_at) VALUES ('owner', 1, ?)",
    ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_context_versions (user_id, character_id, version, updated_at) VALUES ('owner', 'role-old', 9, ?)",
    ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_context_events (user_id, character_id, event_id, device_id, created_at) VALUES ('owner', 'role-old', 'event-old', ?, ?)",
    legacyDeviceId, ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_autonomy (user_id, character_id, enabled, updated_at) VALUES ('owner', 'role-old', 1, ?)",
    ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_schedules (user_id, character_id, time_zone, schedule_json, updated_at) VALUES ('owner', 'role-old', 'UTC', '{\"active\":[]}', ?)",
    ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO device_presence (user_id, device_id, foreground_active, last_heartbeat_at, updated_at) VALUES ('owner', ?, 1, ?, ?)",
    legacyDeviceId, ctx.now(), ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO character_leases (user_id, character_id, owner_device_id, lease_until, updated_at) VALUES ('owner', 'role-old', ?, ?, ?)",
    legacyDeviceId, ctx.now() + 60000, ctx.now()
  );
  ctx.store.exec(
    "INSERT INTO device_pairing_tokens (token_hash, user_id, created_by_device_id, created_at, expires_at, consumed_at) VALUES ('legacy-pairing-hash', 'owner', ?, ?, ?, NULL)",
    legacyDeviceId, ctx.now(), ctx.now() + 300000
  );
  ctx.store.exec(
    "INSERT INTO outbound_device_receipts (server_message_id, user_id, device_id, character_id, device_received_at, local_saved_at, read_at, created_at, updated_at) VALUES ('server-message-old', 'owner', ?, 'role-old', ?, ?, NULL, ?, ?)",
    legacyDeviceId, ctx.now(), ctx.now(), ctx.now(), ctx.now()
  );

  const initialized = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(initialized.status, 200);
  const adminId = (await initialized.json()).account.id;

  const device = ctx.query('SELECT user_id FROM devices WHERE id = ?', legacyDeviceId)[0];
  assert.equal(device.user_id, adminId);
  const autonomy = ctx.query("SELECT user_id, enabled FROM user_autonomy WHERE user_id = ?", adminId)[0];
  assert.equal(Number(autonomy.enabled), 1);
  const version = ctx.query("SELECT version FROM character_context_versions WHERE user_id = ? AND character_id = 'role-old'", adminId)[0];
  assert.equal(Number(version.version), 9);
  const event = ctx.query("SELECT event_id FROM character_context_events WHERE user_id = ? AND event_id = 'event-old'", adminId)[0];
  assert.equal(event.event_id, 'event-old');

  const adoptedTables = [
    'devices',
    'user_autonomy',
    'character_autonomy',
    'character_schedules',
    'device_presence',
    'character_leases',
    'device_pairing_tokens',
    'character_context_versions',
    'character_context_events',
    'outbound_device_receipts'
  ];
  for (const table of adoptedTables) {
    assert.equal(
      Number(ctx.query('SELECT COUNT(*) AS total FROM ' + table + ' WHERE user_id = ?', adminId)[0].total),
      1,
      '旧 owner 行必须完整迁移到创作者 MAO ID：' + table
    );
    assert.equal(
      Number(ctx.query("SELECT COUNT(*) AS total FROM " + table + " WHERE user_id = 'owner'")[0].total),
      0,
      '旧 owner 命名空间不能遗留半迁移记录：' + table
    );
  }
});
