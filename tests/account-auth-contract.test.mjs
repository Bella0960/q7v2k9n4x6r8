import test from 'node:test';
import assert from 'node:assert/strict';
import { randomToken } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

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
  const first = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123' }
  });
  const firstResult = await json(first);
  assert.equal(firstResult.status, 200);
  assert.match(firstResult.payload.account.id, /^MAO-[A-Z0-9]{12,24}$/);
  assert.equal(firstResult.payload.account.role, 'super_admin');
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

test('邀请码绑定指定永久 ID：其他账号不能使用，正确账号核销一次后生效', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123' }
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

test('账号停用会撤销全部会话与设备凭据，恢复不能恢复旧设备，永久撤销不可恢复', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const adminResponse = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123' }
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
  const activeApi = await ctx.fetchTo('/api/autonomy/global', { headers: { 'x-device-auth': device.deviceId + '.' + device.secret } });
  assert.notEqual(activeApi.status, 403);

  const disabled = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'disable' }, adminCookie);
  assert.equal(disabled.status, 200);
  const disabledApi = await ctx.fetchTo('/api/autonomy/global', { headers: { 'x-device-auth': device.deviceId + '.' + device.secret } });
  const disabledJson = await json(disabledApi);
  assert.equal(disabledJson.status, 403);
  assert.equal(disabledJson.payload.error.message, '您的账号已被禁用');
  const disabledLogin = await ctx.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'alice', password: 'alice-password-123' }
  });
  assert.equal(disabledLogin.status, 403);
  assert.equal(disabledLogin.payload.error.message, '您的账号已被禁用');

  const restored = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'restore' }, adminCookie);
  assert.equal(restored.status, 200);
  const oldDeviceStillDenied = await ctx.fetchTo('/api/autonomy/global', { headers: { 'x-device-auth': device.deviceId + '.' + device.secret } });
  assert.equal(oldDeviceStillDenied.status, 401, '恢复账号不能复活已撤销的设备凭据');

  const revoked = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'revoke' }, adminCookie);
  assert.equal(revoked.status, 200);
  const restoreRevoked = await post(ctx, '/api/admin/accounts/' + alice.payload.account.id + '/action', { action: 'restore' }, adminCookie);
  assert.equal(restoreRevoked.status, 409, '永久撤销不可恢复');
});
