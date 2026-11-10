import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomToken, sha256Hex } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore, createTestRequestHeaders } from './helpers/cloud-helpers.mjs';
import { applyMigrations, MIGRATIONS, splitSql } from '../worker/lib/migrations.js';

test('账号契约测试 Mock 对请求来源头的默认值、保留、覆盖与移除行为彼此独立', () => {
  const defaults = createTestRequestHeaders();
  assert.equal(defaults.get('origin'), 'https://mao.test');
  assert.equal(defaults.get('sec-fetch-site'), 'same-origin');
  assert.equal(defaults.get('cf-connecting-ip'), '203.0.113.1');

  const preserved = createTestRequestHeaders({
    headers: {
      origin: 'https://attacker.test',
      'sec-fetch-site': 'cross-site'
    }
  });
  assert.equal(preserved.get('origin'), 'https://attacker.test',
    '调用方显式传入的 Origin 不得被 Mock 的默认值覆盖');
  assert.equal(preserved.get('sec-fetch-site'), 'cross-site',
    '调用方显式传入的 Fetch Metadata 不得被 Mock 的默认值覆盖');

  const overridden = createTestRequestHeaders({
    headers: {
      origin: 'https://attacker.test',
      'sec-fetch-site': 'cross-site'
    },
    origin: 'https://mao.test',
    fetchSite: 'same-origin'
  });
  assert.equal(overridden.get('origin'), 'https://mao.test');
  assert.equal(overridden.get('sec-fetch-site'), 'same-origin');

  const originRemoved = createTestRequestHeaders({
    headers: {
      origin: 'https://mao.test',
      'sec-fetch-site': 'same-origin'
    },
    origin: false
  });
  assert.equal(originRemoved.has('origin'), false,
    'origin:false 必须只移除 Origin');
  assert.equal(originRemoved.get('sec-fetch-site'), 'same-origin',
    '移除 Origin 不得顺带移除 Fetch Metadata');

  const fetchSiteRemoved = createTestRequestHeaders({
    headers: {
      origin: 'https://mao.test',
      'sec-fetch-site': 'same-origin'
    },
    fetchSite: false
  });
  assert.equal(fetchSiteRemoved.get('origin'), 'https://mao.test',
    '移除 Fetch Metadata 不得顺带移除 Origin');
  assert.equal(fetchSiteRemoved.has('sec-fetch-site'), false,
    'fetchSite:false 必须只移除 Sec-Fetch-Site');
});

test('MAO 欢迎页遵循已确认的静态白底灰兔与单次渐变标题设计', () => {
  const html = readFileSync(new URL('../account/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../account/account.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /class="brand-mark"|class="brand-name"/,
    '欢迎页不再显示左上角方框 M 和 MAO 字标');
  assert.match(html, /class="brand-caption">ACCOUNT ACCESS/);
  assert.match(html, /class="hero-avatar-frame"/, '兔子头像必须有独立白底');
  assert.match(html, /class="hero-bunny" src="\.\.\/assets\/mao-bunny-192\.png"/,
    '欢迎页应使用项目内已存在的小兔子素材');
  assert.match(html, /class="hero-avatar-caption">A QUIET LITTLE DETAIL/);
  assert.match(html, /class="welcome-title">欢迎使用 MAO<\/h1>/,
    '欢迎标题只出现一次');
  assert.match(html, /class="[^"]*\bwelcome-lead\b[^"]*">给日常留一处只属于自己的空间。/);
  assert.doesNotMatch(html, /welcome-index|card-index|hero-orbit|hero-red-point|button-arrow|01\s*\/\s*04|↗|←|→/,
    '欢迎页不应出现编号、轨道装饰或方向箭头');
  assert.doesNotMatch(html, /唯一超级管理员/, '公开邀请码说明只称管理员');
  assert.match(html, /邀请码由管理员发放，并绑定指定账号/);
  assert.match(html, /id="creatorContactButton"/);
  assert.match(html, /class="creator-contact-link"/);
  assert.match(css, /\.hero-avatar-frame\s*\{[^}]*background:\s*#fff/i);
  assert.doesNotMatch(css, /\.hero-avatar\s*\{[^}]*animation:/,
    'the bunny avatar itself must remain static');
  assert.match(css, /\.welcome-title\s*\{[^}]*linear-gradient/i);
  assert.match(css, /@keyframes welcomeReveal/);
  assert.doesNotMatch(css, /bunnyFloat|orbitDrift|pointPulse/,
    '兔子与装饰轨道保持静态');
  assert.equal((html.match(/data-password-toggle/g) || []).length, 3,
    '注册密码、确认密码和登录密码都应有框内眼睛开关');
  assert.match(css, /\.password-field\s*\{[^}]*border:\s*1px/);
  assert.match(css, /\.password-field input\s*\{[^}]*border:\s*0/);
  assert.match(script, /data-password-toggle/);
  assert.match(script, /input\.type = visible \? 'text' : 'password'/);
  assert.match(script, /creatorContactDialog\.showModal\(\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('注册创建成功但自动登录失败时，引导用户登录而不是重复注册', () => {
  const script = readFileSync(new URL('../account/account.js', import.meta.url), 'utf8');
  const start = script.indexOf("byId('registerForm').addEventListener('submit'");
  const end = script.indexOf("byId('loginForm').addEventListener('submit'", start);
  assert.ok(start >= 0 && end > start, '注册提交流程必须存在');
  const registrationFlow = script.slice(start, end);
  const loginAttempt = registrationFlow.indexOf("api('/api/accounts/login', 'POST'");
  const recovery = registrationFlow.indexOf("账号已创建，MAO 永久 ID：");
  const switchToLogin = registrationFlow.indexOf("showPanel('loginPanel')");
  const enterAuthorizedFlow = registrationFlow.indexOf('presentAccount(');
  assert.ok(loginAttempt >= 0, '注册成功后应尝试自动登录');
  assert.ok(recovery > loginAttempt, '自动登录失败分支必须发生在账号创建之后');
  assert.ok(switchToLogin > recovery, '自动登录失败时应转到登录页');
  assert.ok(enterAuthorizedFlow > switchToLogin, '只有自动登录成功才继续进入账号状态分流');
  assert.match(registrationFlow, /const accountId = created\.account\.id/);
  assert.match(registrationFlow, /querySelector\('\[name="identifier"\]'\)/,
    '登录页应预填刚创建账号的用户名');
  assert.match(registrationFlow, /请使用刚设置的用户名和密码重新登录/);
  assert.match(registrationFlow, /loginError/);
});

test('创作者管理中心的危险操作必须先居中确认，取消不得提交', () => {
  const html = readFileSync(new URL('../admin/admin-center.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../admin/admin-center.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../admin/admin-center.js', import.meta.url), 'utf8');

  assert.match(html, /<dialog id="adminConfirmDialog"/,
    '管理中心必须使用原生 dialog 模态框');
  assert.match(css, /\.admin-confirm-dialog\{position:fixed;inset:0/,
    '确认框必须覆盖页面并居中显示');
  assert.match(css, /\.admin-confirm-dialog::backdrop\{background:/,
    '确认时必须弱化背景，避免误点底层页面');
  assert.match(css, /\.admin-confirm-actions button\.danger\{[^}]*background:#e5e6e9/i,
    '危险确认按钮使用浅灰色而不是黑底');
  assert.match(script, /function openAdminConfirmation\(options\)/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /adminConfirmDialog'\)\.addEventListener\('cancel'/,
    'Esc 取消必须清除待执行操作');
  assert.match(script, /if \(!confirmation \|\| busy\) return/,
    '未打开确认项或已有操作执行中时不得提交');
  assert.match(script, /adminConfirmSubmit'\)\.addEventListener\('click'/);
  assert.doesNotMatch(script, /window\.confirm\(/,
    '不能退回浏览器默认确认框');

  const inviteStart = script.indexOf('function renderInvites');
  const inviteEnd = script.indexOf('function directoryPath', inviteStart);
  const inviteSection = script.slice(inviteStart, inviteEnd);
  assert.ok(inviteStart >= 0 && inviteEnd > inviteStart);
  assert.ok(
    inviteSection.indexOf('openAdminConfirmation') >= 0 &&
    inviteSection.indexOf("await api('/api/admin/invites/") >
      inviteSection.indexOf('openAdminConfirmation'),
    '邀请码撤销 API 只能位于二次确认回调中'
  );

  const accountStart = script.indexOf('function createActionButton');
  const accountEnd = script.indexOf('async function renderAccountDetail', accountStart);
  const accountSection = script.slice(accountStart, accountEnd);
  assert.ok(accountStart >= 0 && accountEnd > accountStart);
  assert.ok(
    accountSection.indexOf('openAdminConfirmation') >= 0 &&
    accountSection.indexOf("await api('/api/admin/accounts/") >
      accountSection.indexOf('openAdminConfirmation'),
    '停用、恢复和永久撤销 API 只能位于二次确认回调中'
  );

  assert.match(script, /pendingConfirmation = null;/,
    '取消后必须清空待确认动作，不能在下一次点击中意外执行');
});

test('账号自助管理中的设备和会话撤销必须使用中央模态确认', () => {
  const html = readFileSync(new URL('../account/manage.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../account/manage.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../account/manage.js', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="accountActionDialog"/);
  assert.match(html, /id="accountActionCancel"/);
  assert.match(html, /id="accountActionConfirm"/);
  assert.match(css, /\.account-action-dialog\{position:fixed;inset:0/);
  assert.match(script, /function openAccountActionConfirmation\(options\)/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /accountActionConfirm'\)\.addEventListener\('click'/);
  assert.match(script, /确认移除此设备？/);
  assert.match(script, /确认退出此登录会话？/);
  assert.match(script, /session\.revokedAt \|\| session\.expired/,
    '已撤销或过期的会话不得继续显示退出操作');
  assert.match(script, /已过期的登录会话/);
  assert.doesNotMatch(script, /window\.confirm\(/,
    '设备与会话撤销不能使用浏览器默认确认框');
});

test('账号安全操作共享忙碌锁，并恢复按钮原始禁用状态', () => {
  const script = readFileSync(new URL('../account/manage.js', import.meta.url), 'utf8');
  assert.match(script, /const busyButtonState = new WeakMap\(\)/);
  assert.match(script, /function setButtonsDisabled\(disabled\)/);
  assert.match(script, /if \(!busyButtonState\.has\(button\)\) busyButtonState\.set\(button, button\.disabled\)/);
  assert.match(script, /button\.disabled = busyButtonState\.get\(button\)/);
  assert.match(script, /async function runAction\(action, onError = null\)/);
  assert.match(script, /setButtonsDisabled\(true\)/);
  assert.match(script, /setButtonsDisabled\(false\)/);

  const start = script.indexOf("$('passwordForm').addEventListener('submit'");
  const end = script.indexOf("$('accountActionCancel').addEventListener", start);
  assert.ok(start >= 0 && end > start, '密码修改处理器必须存在');
  const passwordHandler = script.slice(start, end);
  assert.match(passwordHandler, /runAction\(async \(\) =>/,
    '密码修改必须与设备、会话撤销共用同一个操作锁');
  assert.match(passwordHandler, /passwordMessage/);
  assert.doesNotMatch(script, /querySelectorAll\('button'\)\.forEach\(button => \{ button\.disabled = false;/,
    '操作结束不能无条件重新启用所有按钮');
});

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

test('所有 API 写请求都必须来自精确同源页面，跨来源和缺少来源信息均拒绝', async () => {
  const ctx = setupTestStore(openTestDb());

  const crossOriginRegistration = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    origin: 'https://attacker.test',
    fetchSite: 'cross-site',
    body: {
      username: 'origin-cross-user',
      password: 'origin-cross-user-password-123',
      confirmPassword: 'origin-cross-user-password-123'
    }
  });
  assert.equal(crossOriginRegistration.status, 403);
  assert.equal(crossOriginRegistration.payload.error.code, 'CROSS_ORIGIN_REQUEST_BLOCKED');
  assert.equal(ctx.store.getMaoAccountByIdentifier('origin-cross-user'), null,
    '跨来源注册请求不得创建账号');

  const missingOrigin = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    origin: false,
    fetchSite: false,
    body: {
      username: 'origin-missing-user',
      password: 'origin-missing-user-password-123',
      confirmPassword: 'origin-missing-user-password-123'
    }
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.payload.error.code, 'ORIGIN_REQUIRED');

  const explicitCrossOriginHeaders = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.test',
      'sec-fetch-site': 'cross-site'
    },
    body: {
      username: 'origin-explicit-header-user',
      password: 'origin-explicit-header-user-password-123',
      confirmPassword: 'origin-explicit-header-user-password-123'
    }
  });
  assert.equal(explicitCrossOriginHeaders.status, 403,
    '测试 Mock 必须保留调用方显式传入的 Origin，不能覆盖成默认同源值');
  assert.equal(explicitCrossOriginHeaders.payload.error.code, 'CROSS_ORIGIN_REQUEST_BLOCKED');
  assert.equal(ctx.store.getMaoAccountByIdentifier('origin-explicit-header-user'), null);

  const mismatchedFetchMetadata = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    origin: 'https://mao.test',
    fetchSite: 'cross-site',
    body: {
      username: 'origin-fetch-site-user',
      password: 'origin-fetch-site-user-password-123',
      confirmPassword: 'origin-fetch-site-user-password-123'
    }
  });
  assert.equal(mismatchedFetchMetadata.status, 403);
  assert.equal(mismatchedFetchMetadata.payload.error.code, 'CROSS_ORIGIN_REQUEST_BLOCKED');

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'origin-valid-user',
      password: 'origin-valid-user-password-123',
      confirmPassword: 'origin-valid-user-password-123'
    }
  });
  assert.equal(registered.status, 201, '正常 MAO 同源注册必须保持可用');

  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'origin-valid-user', password: 'origin-valid-user-password-123' }
  });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);

  const crossOriginLogout = await ctx.asJson('/api/accounts/logout', {
    method: 'POST',
    headers: { cookie },
    origin: 'https://attacker.test',
    fetchSite: 'cross-site'
  });
  assert.equal(crossOriginLogout.status, 403,
    '跨来源请求不得撤销登录会话');

  const stillAuthenticated = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie },
    origin: false,
    fetchSite: false
  });
  assert.equal(stillAuthenticated.status, 200,
    '被拒绝的跨来源登出不能影响原有 Session，安全 GET 仍兼容无 Origin 客户端');

  const sameOriginLogout = await ctx.asJson('/api/accounts/logout', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(sameOriginLogout.status, 200, '正常同源登出必须保持可用');

  const afterLogout = await ctx.fetchTo('/api/accounts/me', { headers: { cookie } });
  assert.equal(afterLogout.status, 401);
});

test('过期登录会话由服务端明确标记，账号管理页不再提供退出操作', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'expired-session-admin',
      password: 'expired-session-admin-password',
      confirmPassword: 'expired-session-admin-password'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const accountId = (await admin.clone().json()).account.id;
  const timestamp = ctx.now();
  const expiredSessionId = 'session_expired_0001';
  ctx.store.exec(
    'INSERT INTO mao_account_sessions (id, account_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
    expiredSessionId,
    accountId,
    await sha256Hex('expired-session-fixture-token'),
    timestamp - 60000,
    timestamp - 1,
    timestamp - 30000
  );

  const response = await ctx.fetchTo('/api/accounts/security', {
    headers: { cookie: adminCookie, 'x-mao-account-context': accountId }
  });
  const result = await json(response);
  assert.equal(result.status, 200);
  const expired = result.payload.sessions.find(session => session.id === expiredSessionId);
  const current = result.payload.sessions.find(session => session.current);
  assert.ok(expired);
  assert.equal(expired.expired, true);
  assert.equal(expired.revokedAt, null,
    '仅过期的会话应与主动撤销的会话保持不同状态');
  assert.equal(current.expired, false);
});

test('密码验证期间账号被管理员停用时，不得再创建登录会话', async () => {
  const testDb = openTestDb();
  const ctx = setupTestStore(testDb);
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'login-disable-race',
      password: 'login-disable-race-password-123',
      confirmPassword: 'login-disable-race-password-123'
    }
  });
  assert.equal(registered.status, 201);

  const originalCreateSession = ctx.store.createMaoAccountSession.bind(ctx.store);
  ctx.store.createMaoAccountSession = session => {
    // Perform the real administrator state transition after password lookup
    // but immediately before the atomic session insert.
    const disabled = ctx.store.setMaoAccountState({
      accountId: session.accountId,
      action: 'disable',
      actorAccountId: null,
      reason: 'simulated concurrent admin action',
      now: ctx.now()
    });
    assert.equal(disabled.status, 'disabled');
    return originalCreateSession(session);
  };

  const login = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'login-disable-race',
      password: 'login-disable-race-password-123'
    }
  });
  assert.equal(login.status, 403);
  assert.equal(login.payload.error.code, 'ACCOUNT_DISABLED');
  const sessions = ctx.query(
    'SELECT COUNT(*) AS total FROM mao_account_sessions WHERE account_id = ?',
    registered.payload.account.id
  );
  assert.equal(sessions[0].total, 0,
    '停用状态提交后，不得为该账号创建新的登录会话');
});

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
  for (const name of ['idx_mao_single_super_admin', 'idx_mao_sessions_account_active', 'idx_mao_invites_target_account', 'idx_mao_audit_global_cursor', 'idx_mao_audit_action_cursor']) {
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
  const bootstrapAudit = ctx.query(
    "SELECT action, actor_account_id, target_account_id FROM mao_account_audit WHERE target_account_id = ?",
    firstResult.payload.account.id
  );
  assert.equal(bootstrapAudit.length, 1);
  assert.equal(bootstrapAudit[0].action, 'admin_bootstrap');
  assert.equal(bootstrapAudit[0].actor_account_id, null,
    '首次初始化记录应明确标记为系统初始化来源');
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
  const registrationAudit = ctx.query(
    "SELECT action, actor_account_id, target_account_id FROM mao_account_audit WHERE target_account_id = ?",
    registered.payload.account.id
  );
  assert.equal(registrationAudit.length, 1);
  assert.equal(registrationAudit[0].action, 'account_register');
  assert.equal(registrationAudit[0].actor_account_id, registered.payload.account.id);
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

  const auditAfterRedemption = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(alice.payload.account.id) + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(auditAfterRedemption.status, 200);
  const redemptionRecord = auditAfterRedemption.payload.records.find(record =>
    record.action === 'invite_redeem' && record.inviteId === invite.payload.invite.id
  );
  assert.ok(redemptionRecord, '成功核销必须写入目标账号的授权审计时间线');
  assert.equal(redemptionRecord.actorAccountId, alice.payload.account.id,
    '核销事件的执行者应为实际登录并核销的 MAO 账号');
  assert.equal(redemptionRecord.targetAccountId, alice.payload.account.id);
  assert.equal(redemptionRecord.usedCount, 1);
  assert.equal(/token_hash|tokenHash|inviteCode|code/.test(JSON.stringify(redemptionRecord)), false,
    '核销审计不能包含邀请码明文或哈希');

  const replay = await post(ctx, '/api/accounts/invites/redeem', { inviteCode: invite.payload.invite.code }, aliceCookie);
  assert.equal(replay.status, 409, '已授权账号不得重复核销邀请码');

  const inviteList = await ctx.fetchTo('/api/admin/invites', { headers: { cookie: adminCookie } });
  const listResult = await json(inviteList);
  assert.equal(listResult.status, 200);
  assert.equal(JSON.stringify(listResult.payload).includes('token_hash'), false, '管理列表不得泄露邀请码哈希');
});

test('邀请码核销审计写入失败时，账号授权与邀请码使用次数共同回滚', async () => {
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

  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'redeem-rollback',
      password: 'redeem-rollback-password-123',
      confirmPassword: 'redeem-rollback-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', {
    targetAccountId: targetId
  }, adminCookie);
  assert.equal(invite.status, 201);

  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'redeem-rollback', password: 'redeem-rollback-password-123' }
  });
  const targetCookie = cookieFrom(login);

  ctx.store.exec(`CREATE TRIGGER fail_invite_redeem_audit
    BEFORE INSERT ON mao_account_audit
    WHEN NEW.action = 'invite_redeem'
    BEGIN
      SELECT RAISE(ABORT, 'simulated invite redemption audit failure');
    END`);

  const failed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, targetCookie);
  assert.notEqual(failed.status, 200,
    '审计写入失败时核销 API 不能报告授权成功');

  const accountAfterFailure = ctx.query(
    'SELECT status FROM mao_accounts WHERE id = ?', targetId
  )[0];
  const inviteAfterFailure = ctx.query(
    'SELECT used_count FROM mao_invite_codes WHERE id = ?', invite.payload.invite.id
  )[0];
  assert.equal(accountAfterFailure.status, 'pending_invite',
    '事务回滚后账号必须仍为待授权');
  assert.equal(Number(inviteAfterFailure.used_count), 0,
    '事务回滚后邀请码不能被消耗');
  assert.equal(Number(ctx.query(
    "SELECT COUNT(*) AS total FROM mao_account_audit WHERE target_account_id = ? AND action = 'invite_redeem'",
    targetId
  )[0].total), 0);

  ctx.store.exec('DROP TRIGGER fail_invite_redeem_audit');
  const retried = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, targetCookie);
  assert.equal(retried.status, 200, '撤掉模拟故障后，原邀请码应仍可正常核销');
  const auditAfterRetry = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(targetId) + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.ok(auditAfterRetry.payload.records.some(record =>
    record.action === 'invite_redeem' && record.inviteId === invite.payload.invite.id
  ));
});

test('管理员可按永久账号 ID 查询有效邀请码，兼容已验证邮箱绑定且不依赖目录分页', async () => {
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
  const adminId = ctx.query("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id;

  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-lookup-id',
      password: 'invite-lookup-id-password-123',
      confirmPassword: 'invite-lookup-id-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;
  const created = await post(ctx, '/api/admin/invites', { targetAccountId: targetId }, adminCookie);
  assert.equal(created.status, 201);

  // Put newer unrelated invitations ahead of the target in the directory's first page.
  const timestamp = ctx.now();
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(3, '0');
    ctx.store.exec(
      "INSERT INTO mao_invite_codes (id, token_hash, target_account_id, target_email, max_uses, used_count, created_by_account_id, created_at, expires_at) VALUES (?, ?, NULL, ?, 1, 0, ?, ?, ?)",
      'lookup_noise_' + suffix,
      'lookup-noise-hash-' + suffix,
      'lookup-noise-' + suffix + '@qq.com',
      adminId,
      timestamp + index + 1,
      timestamp + 1000000
    );
  }
  const firstPage = await json(await ctx.fetchTo(
    '/api/admin/invites?limit=50&status=pending',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.payload.invites.some(invite => invite.id === created.payload.invite.id), false,
    '目标邀请码必须确实不在当前目录第一页');

  const direct = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(targetId) + '/active-invite',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(direct.status, 200);
  assert.equal(direct.payload.invite.id, created.payload.invite.id,
    '账号详情应能直接查到分页之外的有效邀请码');
  assert.equal(direct.payload.invite.usedCount, 0);
  assert.equal(direct.payload.invite.maxUses, 1);
  assert.equal(Object.hasOwn(direct.payload.invite, 'code'), false);
  assert.equal(/token_hash|tokenHash/i.test(JSON.stringify(direct.payload)), false,
    '查询接口不得返回邀请码明文或哈希');

  const emptyTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-lookup-empty',
      password: 'invite-lookup-empty-password-123',
      confirmPassword: 'invite-lookup-empty-password-123'
    }
  });
  const empty = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(emptyTarget.payload.account.id) + '/active-invite',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.invite, null, '没有有效邀请码时应明确返回 null');

  const emailTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-lookup-email',
      password: 'invite-lookup-email-password-123',
      confirmPassword: 'invite-lookup-email-password-123',
      qqEmail: 'invite-lookup-email@qq.com'
    }
  });
  const emailTargetId = emailTarget.payload.account.id;
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?',
    ctx.now(), emailTargetId
  );
  const emailInvite = await post(ctx, '/api/admin/invites', {
    targetEmail: 'invite-lookup-email@qq.com'
  }, adminCookie);
  assert.equal(emailInvite.status, 201);
  const emailLookup = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(emailTargetId) + '/active-invite',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(emailLookup.status, 200);
  assert.equal(emailLookup.payload.invite.id, emailInvite.payload.invite.id,
    '已验证邮箱绑定的邀请码也必须出现在对应账号详情');

  const ordinaryLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'invite-lookup-id',
      password: 'invite-lookup-id-password-123'
    }
  });
  const denied = await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(targetId) + '/active-invite',
    { headers: { cookie: cookieFrom(ordinaryLogin) } }
  );
  assert.equal(denied.status, 403, '普通账号不能调用管理员专用查询');

  await post(ctx, '/api/admin/invites/' + encodeURIComponent(created.payload.invite.id) + '/revoke', {}, adminCookie);
  const afterRevoke = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(targetId) + '/active-invite',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(afterRevoke.status, 200);
  assert.equal(afterRevoke.payload.invite, null, '撤销后不能继续报告为有效邀请码');
});

test('管理员账号详情返回权威状态与有效邀请码快照，撤销后可安全重新发码', async () => {
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

  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'detail-snapshot',
      password: 'detail-snapshot-password-123',
      confirmPassword: 'detail-snapshot-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;
  const detailPath = '/api/admin/accounts/' + encodeURIComponent(targetId) + '/detail';

  const created = await post(ctx, '/api/admin/invites', { targetAccountId: targetId }, adminCookie);
  assert.equal(created.status, 201);
  const pendingDetail = await json(await ctx.fetchTo(detailPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(pendingDetail.status, 200);
  assert.equal(pendingDetail.payload.account.id, targetId);
  assert.equal(pendingDetail.payload.account.status, 'pending_invite');
  assert.equal(pendingDetail.payload.invite.id, created.payload.invite.id);
  assert.equal(Object.hasOwn(pendingDetail.payload.account, 'password_hash'), false);
  assert.equal(Object.hasOwn(pendingDetail.payload.account, 'password_salt'), false);
  assert.equal(Object.hasOwn(pendingDetail.payload.invite, 'code'), false);
  assert.equal(/token_hash|tokenHash/i.test(JSON.stringify(pendingDetail.payload)), false,
    '账号详情快照不能泄露密码材料、邀请码明文或哈希');

  const targetLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'detail-snapshot', password: 'detail-snapshot-password-123' }
  });
  const targetCookie = cookieFrom(targetLogin);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: created.payload.invite.code
  }, targetCookie);
  assert.equal(redeemed.status, 200);

  const activeDetail = await json(await ctx.fetchTo(detailPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(activeDetail.status, 200);
  assert.equal(activeDetail.payload.account.status, 'active',
    '详情必须读取服务器当前状态，而不是沿用打开详情前的列表状态');
  assert.equal(activeDetail.payload.invite, null,
    '已核销邀请码不能继续作为有效邀请码显示');

  await post(ctx, '/api/admin/accounts/' + encodeURIComponent(targetId) + '/action', {
    action: 'disable', reason: 'detail snapshot test'
  }, adminCookie);
  const disabledDetail = await json(await ctx.fetchTo(detailPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(disabledDetail.status, 200);
  assert.equal(disabledDetail.payload.account.status, 'disabled');
  assert.equal(disabledDetail.payload.invite, null);

  await post(ctx, '/api/admin/accounts/' + encodeURIComponent(targetId) + '/action', {
    action: 'restore', reason: ''
  }, adminCookie);
  const restoredDetail = await json(await ctx.fetchTo(detailPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(restoredDetail.payload.account.status, 'active');

  const pending = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'detail-revoke',
      password: 'detail-revoke-password-123',
      confirmPassword: 'detail-revoke-password-123'
    }
  });
  const pendingId = pending.payload.account.id;
  const pendingPath = '/api/admin/accounts/' + encodeURIComponent(pendingId) + '/detail';
  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: pendingId }, adminCookie);
  assert.equal(invite.status, 201);
  await post(ctx, '/api/admin/invites/' + encodeURIComponent(invite.payload.invite.id) + '/revoke', {}, adminCookie);

  const afterRevoke = await json(await ctx.fetchTo(pendingPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(afterRevoke.status, 200);
  assert.equal(afterRevoke.payload.account.status, 'pending_invite');
  assert.equal(afterRevoke.payload.invite, null,
    '撤销后的详情刷新必须立即返回无有效邀请码，不能保留旧记录');

  const replacement = await post(ctx, '/api/admin/invites', {
    targetAccountId: pendingId
  }, adminCookie);
  assert.equal(replacement.status, 201,
    '服务端确认旧码撤销后必须允许为同一待授权账号生成替代邀请码');

  const ordinaryLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'detail-snapshot',
      password: 'detail-snapshot-password-123'
    }
  });
  const ordinaryCookie = cookieFrom(ordinaryLogin);
  const ordinary = await ctx.fetchTo(detailPath, { headers: { cookie: ordinaryCookie } });
  assert.equal(ordinary.status, 403, '有效的普通账号会话不能读取管理员详情快照');
  const missing = await ctx.fetchTo('/api/admin/accounts/MAO-AAAAAAAAAAAA/detail', {
    headers: { cookie: adminCookie }
  });
  assert.equal(missing.status, 404, '不存在的账号必须返回明确的 404');
});

test('邀请码生成与撤销写入账号审计时间线，且审计不包含邀请码密钥', async () => {
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

  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'audit-invite-target',
      password: 'audit-invite-target-password-123',
      confirmPassword: 'audit-invite-target-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;

  const created = await post(ctx, '/api/admin/invites', {
    targetAccountId: targetId
  }, adminCookie);
  assert.equal(created.status, 201);

  const auditPath = '/api/admin/accounts/' + encodeURIComponent(targetId) + '/audit';
  const afterCreate = await json(await ctx.fetchTo(auditPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(afterCreate.status, 200);
  const createRecord = afterCreate.payload.records.find(record => record.action === 'invite_create');
  assert.ok(createRecord, '生成邀请码必须立即写入目标账号的审计时间线');
  assert.equal(createRecord.targetAccountId, targetId);
  assert.equal(createRecord.actorAccountId, ctx.query(
    "SELECT id FROM mao_accounts WHERE role = 'super_admin'"
  )[0].id);
  assert.equal(createRecord.inviteId, created.payload.invite.id);
  assert.equal(createRecord.expiresAt, created.payload.invite.expiresAt);
  assert.equal(createRecord.maxUses, 1);
  assert.equal(createRecord.usedCount, 0);
  assert.equal(Object.hasOwn(createRecord, 'code'), false);
  assert.equal(/token_hash|tokenHash|inviteCode/i.test(JSON.stringify(afterCreate.payload)), false,
    '审计接口不得返回邀请码明文、核销码或 token 哈希');

  const revoked = await post(ctx, '/api/admin/invites/' +
    encodeURIComponent(created.payload.invite.id) + '/revoke', {}, adminCookie);
  assert.equal(revoked.status, 200);

  const afterRevoke = await json(await ctx.fetchTo(auditPath, {
    headers: { cookie: adminCookie }
  }));
  assert.equal(afterRevoke.status, 200);
  const revokeRecord = afterRevoke.payload.records.find(record =>
    record.action === 'invite_revoke' && record.inviteId === created.payload.invite.id
  );
  assert.ok(revokeRecord, '撤销邀请码必须进入同一账号的审计时间线');
  assert.equal(revokeRecord.targetAccountId, targetId);
  assert.equal(revokeRecord.actorAccountId, createRecord.actorAccountId);

  const emailTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'audit-email-target',
      password: 'audit-email-target-password-123',
      confirmPassword: 'audit-email-target-password-123',
      qqEmail: 'audit-email-target@qq.com'
    }
  });
  assert.equal(emailTarget.status, 201);
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?',
    ctx.now(), emailTarget.payload.account.id
  );
  const emailInvite = await post(ctx, '/api/admin/invites', {
    targetEmail: 'audit-email-target@qq.com'
  }, adminCookie);
  assert.equal(emailInvite.status, 201);

  const emailAudit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(emailTarget.payload.account.id) + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(emailAudit.status, 200);
  assert.ok(emailAudit.payload.records.some(record =>
    record.action === 'invite_create' && record.targetAccountId === emailTarget.payload.account.id &&
    record.inviteId === emailInvite.payload.invite.id
  ), '已验证邮箱绑定的邀请也必须归入邮箱所属 MAO 账号的审计时间线');

  // If a mailbox is later changed/unverified, revocation must still be linked
  // to the original target account rather than whichever account may own it now.
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email = ?, qq_email_verified_at = NULL WHERE id = ?',
    'new-address@qq.com', emailTarget.payload.account.id
  );
  const emailRevoked = await post(ctx, '/api/admin/invites/' +
    encodeURIComponent(emailInvite.payload.invite.id) + '/revoke', {}, adminCookie);
  assert.equal(emailRevoked.status, 200);
  const emailAuditAfterRevoke = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + encodeURIComponent(emailTarget.payload.account.id) + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.ok(emailAuditAfterRevoke.payload.records.some(record =>
    record.action === 'invite_revoke' && record.targetAccountId === emailTarget.payload.account.id &&
    record.inviteId === emailInvite.payload.invite.id
  ), '邮箱变更后撤销邀请码仍必须关联到最初的 MAO 账号');

  const ordinaryLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'audit-invite-target',
      password: 'audit-invite-target-password-123'
    }
  });
  const denied = await ctx.fetchTo(auditPath, {
    headers: { cookie: cookieFrom(ordinaryLogin) }
  });
  assert.equal(denied.status, 403, '普通账号不能读取包含邀请码管理动作的审计时间线');
});

test('创作者账号目录使用稳定游标分页，能够完整读取 500 条以上并跨全量搜索', async () => {
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

  // Deliberately share timestamps to exercise the permanent-ID tie breaker.
  for (let index = 0; index < 505; index += 1) {
    const suffix = String(index).padStart(12, '0');
    const username = 'capacity_' + index;
    const createdAt = Number(adminCreatedAt) - 10000 + Math.floor(index / 2);
    ctx.store.exec(
      "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'test-salt', 'test-hash', 'user', 'pending_invite', ?, ?)",
      'MAO-' + suffix, username, username, createdAt, createdAt
    );
  }

  let cursor = '';
  const ids = [];
  let firstPage = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const path = '/api/admin/accounts?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const result = await json(await ctx.fetchTo(path, { headers: { cookie: adminCookie } }));
    assert.equal(result.status, 200);
    if (!firstPage) firstPage = result.payload;
    assert.equal(result.payload.page.totalCount, 505);
    assert.equal(result.payload.summary.total, 505);
    assert.equal(result.payload.accounts.length, Math.min(50, 505 - ids.length));
    ids.push(...result.payload.accounts.map(account => account.id));
    if (!result.payload.page.hasMore) break;
    assert.ok(result.payload.page.nextCursor, '还有下一页时必须返回游标');
    cursor = result.payload.page.nextCursor;
  }
  assert.equal(ids.length, 505, '所有账号都应能翻页取回');
  assert.equal(new Set(ids).size, 505, '相邻页不能重复返回同一账号');
  assert.ok(firstPage.accounts.some(account => account.username === 'capacity_504'));
  assert.ok(!firstPage.accounts.some(account => account.username === 'capacity_0'));

  const oldAccount = await json(await ctx.fetchTo(
    '/api/admin/accounts?search=' + encodeURIComponent('MAO-000000000000'),
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(oldAccount.status, 200);
  assert.equal(oldAccount.payload.page.totalCount, 1,
    '搜索必须覆盖目录中较早的记录，而不是只搜索已加载的第一页');
  assert.equal(oldAccount.payload.accounts[0].username, 'capacity_0');

  const invalidFilter = await json(await ctx.fetchTo(
    '/api/admin/accounts?status=not-a-filter',
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(invalidFilter.status, 400, '无效筛选参数必须被拒绝');
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

test('账号停用会清理此前已撤销设备遗留的未完成活动任务', async () => {
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
      username: 'legacy-revoked-queue',
      password: 'legacy-revoked-queue-password-123',
      confirmPassword: 'legacy-revoked-queue-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: accountId }, adminCookie);
  assert.equal(invite.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'legacy-revoked-queue',
      password: 'legacy-revoked-queue-password-123'
    }
  });
  const userCookie = cookieFrom(login);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200);

  const deviceId = 'device_legacy_revoked_queue01';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'legacy device',
    platform: 'test'
  }, userCookie);
  assert.equal(enrolled.status, 200);
  const timestamp = ctx.now();
  ctx.store.exec(
    "INSERT INTO activity_queue (id, device_id, character_id, kind, status, scheduled_at, locked_by, locked_until, payload_json, created_at, updated_at, dedupe_key) VALUES (?, ?, ?, 'contact', 'retry', ?, 'stale-worker', ?, '{}', ?, ?, ?)",
    'activity_legacy_revoked_queue_0001',
    deviceId,
    'role_legacy_revoked_queue',
    timestamp,
    timestamp + 60000,
    timestamp,
    timestamp,
    'legacy-revoked-queue-dedupe'
  );

  ctx.store.exec(
    `INSERT INTO push_subscriptions
      (id, device_id, endpoint, p256dh, auth_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'sub_legacy_revoked_device_0001',
    deviceId,
    'https://push.example.test/legacy-revoked-device',
    'legacy-p256dh',
    'legacy-auth-key',
    timestamp,
    timestamp
  );

  // Model a historical revocation path that left its subscription enabled
  // and its activity queued. Account suspension must sweep both records even
  // though no active device row is changed by the later transition.
  ctx.store.exec('UPDATE devices SET revoked_at = ? WHERE id = ?', timestamp, deviceId);
  assert.equal(ctx.query('SELECT status FROM activity_queue WHERE id = ?', 'activity_legacy_revoked_queue_0001')[0].status, 'retry');
  assert.equal(ctx.query('SELECT disabled_at FROM push_subscriptions WHERE id = ?', 'sub_legacy_revoked_device_0001')[0].disabled_at, null);

  const disabled = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'disable',
    reason: '清理所有历史设备活动'
  }, adminCookie);
  assert.equal(disabled.status, 200);
  const task = ctx.query(
    'SELECT status, locked_by, locked_until FROM activity_queue WHERE id = ?',
    'activity_legacy_revoked_queue_0001'
  )[0];
  assert.equal(task.status, 'superseded');
  assert.equal(task.locked_by, null);
  assert.equal(task.locked_until, null);
  const subscription = ctx.query(
    'SELECT disabled_at, disabled_reason FROM push_subscriptions WHERE id = ?',
    'sub_legacy_revoked_device_0001'
  )[0];
  assert.notEqual(subscription.disabled_at, null);
  assert.equal(subscription.disabled_reason, 'account_disabled');
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
  const oldSessionAfterRestore = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: aliceCookie }
  });
  assert.equal(oldSessionAfterRestore.status, 401,
    '账号恢复只能恢复账号状态，不能重新激活停用前撤销的 Session');
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
  const pepper = 'test-device-secret-pepper-for-contract-tests-32chars';
  const ip = '203.0.113.1';
  const ipRateLimitKey = await sha256Hex('mao-login|' + pepper + '|' + ip);
  const accountIpRateLimitKey = await sha256Hex(
    'mao-login-account-ip|' + pepper + '|' + registered.payload.account.id + '|' + ip
  );
  assert.equal(
    Number(ctx.query('SELECT COUNT(*) AS total FROM mao_login_rate_limits WHERE ip_hash = ?', accountIpRateLimitKey)[0].total),
    0,
    '成功登录只清除当前账号与当前 IP 的失败桶'
  );
  const sharedIpRow = ctx.query(
    'SELECT attempt_count, blocked_until FROM mao_login_rate_limits WHERE ip_hash = ?',
    ipRateLimitKey
  )[0];
  assert.ok(sharedIpRow, '成功登录不能删除同一 IP 的汇总失败桶');
  assert.equal(Number(sharedIpRow.attempt_count), 8,
    '成功登录不能清除同一 IP 的汇总失败计数');
  assert.equal(sharedIpRow.blocked_until, null,
    '8 次失败不应过早封锁共享网络中的其他账号');
});

test('同一 IP 下一个账号成功登录不能清除另一个账号的失败计数', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const register = async username => {
    const result = await ctx.asJson('/api/accounts/register', {
      method: 'POST',
      body: {
        username,
        password: username + '-password-123',
        confirmPassword: username + '-password-123'
      }
    });
    assert.equal(result.status, 201);
    return result.payload.account;
  };
  const alice = await register('shared-ip-alice');
  const bob = await register('shared-ip-bob');
  const ip = '203.0.113.1';
  const pepper = 'test-device-secret-pepper-for-contract-tests-32chars';
  const ipRateLimitKey = await sha256Hex('mao-login|' + pepper + '|' + ip);
  const aliceRateLimitKey = await sha256Hex(
    'mao-login-account-ip|' + pepper + '|' + alice.id + '|' + ip
  );
  const bobRateLimitKey = await sha256Hex(
    'mao-login-account-ip|' + pepper + '|' + bob.id + '|' + ip
  );

  for (let index = 0; index < 7; index += 1) {
    const failed = await ctx.asJson('/api/accounts/login', {
      method: 'POST',
      body: { identifier: alice.username, password: 'wrong-password-for-alice' }
    });
    assert.equal(failed.status, 401);
  }
  for (let index = 0; index < 2; index += 1) {
    const failed = await ctx.asJson('/api/accounts/login', {
      method: 'POST',
      body: { identifier: bob.username, password: 'wrong-password-for-bob' }
    });
    assert.equal(failed.status, 401);
  }

  const bobSuccess = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: bob.username, password: 'shared-ip-bob-password-123' }
  });
  assert.equal(bobSuccess.status, 200);
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM mao_login_rate_limits WHERE ip_hash = ?',
    bobRateLimitKey
  )[0].total), 0, 'Bob 的成功登录只清除 Bob 自己的失败桶');
  assert.equal(ctx.store.getMaoLoginRateLimit(aliceRateLimitKey, ctx.now()).attemptCount, 7,
    'Bob 成功登录不能触碰 Alice 的失败桶');

  // Use Alice's permanent MAO ID to confirm username/ID aliases share one
  // canonical account bucket rather than creating a fresh allowance.
  const aliceEighthFailure = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: alice.id, password: 'wrong-password-for-alice' }
  });
  assert.equal(aliceEighthFailure.status, 429,
    'Bob 登录成功不能重置 Alice 的 7 次失败记录');
  const aliceRate = ctx.store.getMaoLoginRateLimit(aliceRateLimitKey, ctx.now());
  assert.equal(aliceRate.attemptCount, 8);
  assert.equal(aliceRate.blocked, true);
  const ipRate = ctx.store.getMaoLoginRateLimit(ipRateLimitKey, ctx.now());
  assert.equal(ipRate.attemptCount, 10,
    '共享 IP 汇总计数应包含两个账号的失败请求且不能被成功登录清空');
  assert.equal(ipRate.blocked, false);
});

test('共享 IP 汇总限流允许合理的多账号失败量，并在高频失败时触发保护', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const ip = '198.51.100.77';
  const pepper = 'test-device-secret-pepper-for-contract-tests-32chars';
  const ipRateLimitKey = await sha256Hex('mao-login|' + pepper + '|' + ip);
  for (let index = 0; index < 119; index += 1) {
    const failure = ctx.store.recordMaoLoginFailure(ipRateLimitKey, ctx.now(), {
      windowMs: 15 * 60 * 1000,
      maxAttempts: 120
    });
    assert.equal(failure.blocked, false);
  }
  const blocked = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'unknown-shared-ip-user', password: 'unknown-password-123' },
    ip
  });
  assert.equal(blocked.status, 429,
    '跨账号失败累计达到 120 次 IP 汇总阈值后仍必须保护该来源');
  const state = ctx.store.getMaoLoginRateLimit(ipRateLimitKey, ctx.now());
  assert.equal(state.attemptCount, 120);
  assert.equal(state.blocked, true);
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

test('密码哈希计算期间当前 Session 被撤销时，不能提交密码修改', async () => {
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
      username: 'password-session-race',
      password: 'password-session-race-password-123',
      confirmPassword: 'password-session-race-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: accountId }, adminCookie);
  assert.equal(invite.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'password-session-race',
      password: 'password-session-race-password-123'
    }
  });
  const userCookie = cookieFrom(login);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200);

  const originalUpdate = ctx.store.updateMaoAccountPasswordAndRevokeOtherSessions.bind(ctx.store);
  let revokedBeforePasswordWrite = false;
  ctx.store.updateMaoAccountPasswordAndRevokeOtherSessions = options => {
    revokedBeforePasswordWrite = true;
    ctx.store.revokeMaoAccountSession(options.keepSessionId, ctx.now());
    return originalUpdate(options);
  };

  const changed = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'password-session-race-password-123',
    newPassword: 'password-session-race-new-456',
    confirmPassword: 'password-session-race-new-456'
  }, userCookie);
  assert.equal(revokedBeforePasswordWrite, true);
  assert.equal(changed.status, 409);
  assert.equal(changed.payload.error.code, 'PASSWORD_UPDATE_FAILED');

  const oldPasswordStillWorks = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'password-session-race',
      password: 'password-session-race-password-123'
    }
  });
  assert.equal(oldPasswordStillWorks.status, 200,
    '当前 Session 已撤销时，原密码不得被并发密码修改覆盖');
  const newPasswordMustFail = await ctx.asJson('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'password-session-race',
      password: 'password-session-race-new-456'
    }
  });
  assert.equal(newPasswordMustFail.status, 401);
  const oldSessionMustFail = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: userCookie }
  });
  assert.equal(oldSessionMustFail.status, 401);
});

test('初始化缺少 Worker Secret 时明确拒绝，公开状态不泄露密钥配置情况', async () => {
  for (const env of [
    {},
    { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET, DEVICE_SECRET_PEPPER: '' }
  ]) {
    const ctx = setupTestStore(openTestDb(), env);
    const status = await ctx.asJson('/api/admin/bootstrap/status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.initialized, false);
    assert.equal(Object.hasOwn(status.payload, 'ready'), false,
      '公开状态不得暴露 Worker Secret 是否已配置');
    assert.equal(Object.hasOwn(status.payload, 'secretConfigured'), false,
      '公开状态不得暴露 Worker Secret 是否已配置');

    const result = await ctx.asJson('/api/admin/bootstrap', {
      method: 'POST',
      body: { bootstrapSecret: BOOTSTRAP_SECRET, username: 'creator', password: 'creator-password-123', confirmPassword: 'creator-password-123' }
    });
    assert.equal(result.status, 503);
    assert.equal(result.payload.error.code, 'ADMIN_BOOTSTRAP_NOT_CONFIGURED');
  }
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


test('修改密码与撤销其他会话必须原子提交，撤销失败时密码也回滚', async () => {
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
      username: 'atomic-password',
      password: 'atomic-password-123',
      confirmPassword: 'atomic-password-123'
    }
  });
  assert.equal(registered.status, 201);

  const invite = await post(
    ctx,
    '/api/admin/invites',
    { targetAccountId: registered.payload.account.id },
    adminCookie
  );
  assert.equal(invite.status, 201);

  const firstLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'atomic-password', password: 'atomic-password-123' }
  });
  const currentCookie = cookieFrom(firstLogin);
  const redeemed = await post(
    ctx,
    '/api/accounts/invites/redeem',
    { inviteCode: invite.payload.invite.code },
    currentCookie
  );
  assert.equal(redeemed.status, 200);

  const secondLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'atomic-password', password: 'atomic-password-123' }
  });
  const otherCookie = cookieFrom(secondLogin);
  const security = await ctx.fetchTo('/api/accounts/security', {
    headers: { cookie: currentCookie }
  });
  const securityResult = await json(security);
  assert.equal(securityResult.status, 200);
  const currentSessionId = securityResult.payload.currentSessionId;

  const before = ctx.query(
    'SELECT password_salt, password_hash FROM mao_accounts WHERE id = ?',
    registered.payload.account.id
  )[0];
  ctx.store.exec(`
    CREATE TRIGGER fail_other_mao_session_revocation
    BEFORE UPDATE OF revoked_at ON mao_account_sessions
    WHEN NEW.id != '${currentSessionId}'
      AND OLD.revoked_at IS NULL
      AND NEW.revoked_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'simulated session revocation failure');
    END
  `);

  const failedChange = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'atomic-password-123',
    newPassword: 'atomic-password-456',
    confirmPassword: 'atomic-password-456'
  }, currentCookie);
  assert.equal(failedChange.status, 500);

  const afterFailure = ctx.query(
    'SELECT password_salt, password_hash FROM mao_accounts WHERE id = ?',
    registered.payload.account.id
  )[0];
  assert.equal(afterFailure.password_salt, before.password_salt,
    '撤销其他会话失败时，新密码盐也必须回滚');
  assert.equal(afterFailure.password_hash, before.password_hash,
    '撤销其他会话失败时，新密码摘要也必须回滚');

  const otherSessionAfterFailure = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: otherCookie }
  });
  assert.equal(otherSessionAfterFailure.status, 200,
    '密码修改事务失败时，其他会话不能被部分撤销');

  ctx.store.exec('DROP TRIGGER fail_other_mao_session_revocation');
  const successfulChange = await post(ctx, '/api/accounts/password/change', {
    currentPassword: 'atomic-password-123',
    newPassword: 'atomic-password-456',
    confirmPassword: 'atomic-password-456'
  }, currentCookie);
  assert.equal(successfulChange.status, 200);
  assert.equal(successfulChange.payload.changed, true);

  const otherSessionAfterCommit = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: otherCookie }
  });
  assert.equal(otherSessionAfterCommit.status, 401,
    '密码修改成功提交后，其他会话必须全部失效');

  const currentSessionAfterCommit = await ctx.fetchTo('/api/accounts/me', {
    headers: { cookie: currentCookie }
  });
  assert.equal(currentSessionAfterCommit.status, 200,
    '修改密码的当前会话应继续有效');
});

test('撤销单台设备及其关联状态必须原子提交，清理失败时完整回滚', async () => {
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
      username: 'atomic-device',
      password: 'atomic-device-password-123',
      confirmPassword: 'atomic-device-password-123'
    }
  });
  assert.equal(registered.status, 201);

  const invite = await post(
    ctx,
    '/api/admin/invites',
    { targetAccountId: registered.payload.account.id },
    adminCookie
  );
  assert.equal(invite.status, 201);

  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'atomic-device', password: 'atomic-device-password-123' }
  });
  const userCookie = cookieFrom(login);
  const redeemed = await post(
    ctx,
    '/api/accounts/invites/redeem',
    { inviteCode: invite.payload.invite.code },
    userCookie
  );
  assert.equal(redeemed.status, 200);

  const deviceId = 'device_atomic_0001';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'atomic device',
    platform: 'test'
  }, userCookie);
  assert.equal(enrolled.status, 200);

  const accountId = registered.payload.account.id;
  const timestamp = ctx.now();
  ctx.store.exec(
    'INSERT INTO push_subscriptions (id, device_id, endpoint, p256dh, auth_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'sub_atomic_device_0001',
    deviceId,
    'https://push.example.com/atomic-device',
    'test-p256dh',
    'test-auth',
    timestamp,
    timestamp
  );
  ctx.store.exec(
    'INSERT INTO device_presence (user_id, device_id, foreground_active, last_heartbeat_at, updated_at) VALUES (?, ?, 1, ?, ?)',
    accountId, deviceId, timestamp, timestamp
  );
  ctx.store.exec(
    'INSERT INTO character_leases (user_id, character_id, owner_device_id, lease_until, updated_at) VALUES (?, ?, ?, ?, ?)',
    accountId, 'role_atomic_device', deviceId, timestamp + 60000, timestamp
  );
  ctx.store.exec(
    'INSERT INTO device_pairing_tokens (token_hash, user_id, created_by_device_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)',
    'atomic-device-pairing-hash',
    accountId,
    deviceId,
    timestamp,
    timestamp + 300000
  );
  ctx.store.exec(
    "INSERT INTO activity_queue (id, device_id, character_id, kind, status, scheduled_at, payload_json, created_at, updated_at, dedupe_key) VALUES (?, ?, ?, 'contact', 'waiting', ?, '{}', ?, ?, ?)",
    'activity_atomic_device_0001',
    deviceId,
    'role_atomic_device',
    timestamp,
    timestamp,
    timestamp,
    'atomic-device-dedupe'
  );

  ctx.store.exec(`
    CREATE TRIGGER fail_atomic_device_activity_cleanup
    BEFORE UPDATE OF status ON activity_queue
    WHEN OLD.device_id = '${deviceId}' AND NEW.status = 'superseded'
    BEGIN
      SELECT RAISE(ABORT, 'simulated activity cleanup failure');
    END
  `);

  const failedRevoke = await post(
    ctx,
    '/api/accounts/devices/' + deviceId + '/revoke',
    {},
    userCookie
  );
  assert.equal(failedRevoke.status, 500,
    '模拟关联任务清理失败时，设备撤销请求应失败');

  const deviceAfterFailure = ctx.query(
    'SELECT revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0];
  assert.equal(deviceAfterFailure.revoked_at, null,
    '事务失败时设备本身不能先行变成已撤销');
  const subscriptionAfterFailure = ctx.query(
    'SELECT disabled_at FROM push_subscriptions WHERE id = ?',
    'sub_atomic_device_0001'
  )[0];
  assert.equal(subscriptionAfterFailure.disabled_at, null,
    '事务失败时推送订阅不能被部分停用');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM device_presence WHERE user_id = ? AND device_id = ?',
    accountId, deviceId
  )[0].total), 1, '事务失败时在线状态必须保留');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM character_leases WHERE user_id = ? AND owner_device_id = ?',
    accountId, deviceId
  )[0].total), 1, '事务失败时角色 lease 必须保留');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM device_pairing_tokens WHERE created_by_device_id = ? AND consumed_at IS NULL',
    deviceId
  )[0].total), 1, '事务失败时未使用的配对令牌必须保留');
  assert.equal(ctx.query(
    'SELECT status FROM activity_queue WHERE id = ?',
    'activity_atomic_device_0001'
  )[0].status, 'waiting', '事务失败时自主活动任务不能被部分终止');

  ctx.store.exec('DROP TRIGGER fail_atomic_device_activity_cleanup');
  const successfulRevoke = await post(
    ctx,
    '/api/accounts/devices/' + deviceId + '/revoke',
    {},
    userCookie
  );
  assert.equal(successfulRevoke.status, 200);

  assert.notEqual(ctx.query(
    'SELECT revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0].revoked_at, null);
  const subscriptionAfterCommit = ctx.query(
    'SELECT disabled_at, disabled_reason FROM push_subscriptions WHERE id = ?',
    'sub_atomic_device_0001'
  )[0];
  assert.notEqual(subscriptionAfterCommit.disabled_at, null);
  assert.equal(subscriptionAfterCommit.disabled_reason, 'revoked');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM device_presence WHERE user_id = ? AND device_id = ?',
    accountId, deviceId
  )[0].total), 0);
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM character_leases WHERE user_id = ? AND owner_device_id = ?',
    accountId, deviceId
  )[0].total), 0);
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM device_pairing_tokens WHERE created_by_device_id = ? AND consumed_at IS NULL',
    deviceId
  )[0].total), 0);
  assert.equal(ctx.query(
    'SELECT status FROM activity_queue WHERE id = ?',
    'activity_atomic_device_0001'
  )[0].status, 'superseded');
});

test('设备在异步鉴权期间被撤销时，旧设备请求必须在最终校验处失败', async () => {
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
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const adminAccountId = (await admin.clone().json()).account.id;

  const deviceId = 'device_revocation_race01';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'race test device',
    platform: 'test'
  }, adminCookie);
  assert.equal(enrolled.status, 200);

  // The first device row is read before credential hashing. Simulate an
  // independent revocation immediately after the later account lookup, while
  // authenticate() is still using the originally loaded device snapshot.
  const getAccount = ctx.store.getMaoAccountById.bind(ctx.store);
  let revokedDuringAuthentication = false;
  ctx.store.getMaoAccountById = accountId => {
    const account = getAccount(accountId);
    if (accountId === adminAccountId && !revokedDuringAuthentication) {
      revokedDuringAuthentication = true;
      assert.equal(
        ctx.store.revokeMaoAccountDevice(adminAccountId, deviceId, ctx.now()),
        true,
        '模拟的并发请求应成功撤销设备'
      );
    }
    return account;
  };

  const staleDeviceRequest = await ctx.fetchTo('/api/autonomy/global', {
    headers: {
      cookie: adminCookie,
      'x-device-auth': deviceId + '.' + deviceSecret
    }
  });
  const result = await json(staleDeviceRequest);
  assert.equal(revokedDuringAuthentication, true);
  assert.equal(result.status, 401,
    '设备在异步校验期间撤销后，请求不得继续使用最初读取的未撤销记录');
  assert.equal(result.payload.error.code, 'DEVICE_REVOKED');

  const persisted = ctx.query(
    'SELECT revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0];
  assert.notEqual(persisted.revoked_at, null);
});


test('设备在重新登记的异步账号校验期间被撤销时，不能返回重新登记成功', async () => {
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
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const adminAccountId = (await admin.clone().json()).account.id;
  const deviceId = 'device_reenroll_race01';
  const deviceSecret = randomToken(32);

  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'original device label',
    platform: 'original platform'
  }, adminCookie);
  assert.equal(enrolled.status, 200);

  // The existing device snapshot is already loaded when registerDevice awaits
  // this account lookup. Revoke it before the handler reaches profile refresh.
  const getAccount = ctx.store.getMaoAccountById.bind(ctx.store);
  let revokedDuringReenrollment = false;
  ctx.store.getMaoAccountById = accountId => {
    const account = getAccount(accountId);
    if (accountId === adminAccountId && !revokedDuringReenrollment) {
      revokedDuringReenrollment = true;
      assert.equal(
        ctx.store.revokeMaoAccountDevice(adminAccountId, deviceId, ctx.now()),
        true,
        '模拟的并发请求应成功撤销设备'
      );
    }
    return account;
  };

  const reenrollment = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId,
      secret: deviceSecret,
      label: 'stale reenrollment label',
      platform: 'stale reenrollment platform'
    },
    headers: {
      cookie: adminCookie,
      'x-mao-account-context': adminAccountId
    }
  });
  const result = await json(reenrollment);
  assert.equal(revokedDuringReenrollment, true);
  assert.equal(result.status, 403);
  assert.equal(result.payload.error.code, 'DEVICE_REVOKED');

  const persisted = ctx.query(
    'SELECT label, platform, revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0];
  assert.notEqual(persisted.revoked_at, null);
  assert.equal(persisted.label, 'original device label',
    '重新登记不得覆盖已经撤销设备的资料');
  assert.equal(persisted.platform, 'original platform');
});

test('设备在写入期间被撤销后，不能重新写入 presence、lease 或账号授权设置', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, {
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '120000',
    AUTONOMY_DEVICE_GRACE_MS: '30000'
  });
  const deviceMutationTrace = [];
  const originalStoreExec = ctx.store.exec.bind(ctx.store);
  ctx.store.exec = (sql, ...params) => {
    const result = originalStoreExec(sql, ...params);
    if (String(sql).toLowerCase().includes('update devices') && String(sql).toLowerCase().includes('revoked_at')) {
      deviceMutationTrace.push({ sql: String(sql), params });
    }
    return result;
  };
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const accountId = (await admin.clone().json()).account.id;

  const registerDevice = async deviceId => {
    const secret = randomToken(32);
    const response = await post(ctx, '/api/devices/register', {
      deviceId,
      secret,
      label: deviceId,
      platform: 'test'
    }, adminCookie);
    assert.equal(response.status, 200);
    return { deviceId, secret };
  };
  const revokeAtWrite = device => {
    const stored = ctx.query(
      'SELECT id, user_id, revoked_at FROM devices WHERE id = ?',
      device.deviceId
    )[0];
    assert.ok(stored, '并发撤销前，刚登记的设备必须存在');
    assert.equal(stored.user_id, accountId,
      '刚登记的设备必须归属于当前 MAO 永久 ID：' + JSON.stringify(stored));
    assert.equal(stored.revoked_at, null,
      '刚登记的设备在模拟撤销前必须仍然有效：' + JSON.stringify(stored));
    assert.equal(
      ctx.store.revokeMaoAccountDevice(accountId, device.deviceId, ctx.now()),
      true,
      '模拟的并发管理员撤销必须成功：' + JSON.stringify(stored)
    );
  };

  const heartbeatDevice = await registerDevice('device_presence_race01');
  assert.equal(deviceMutationTrace.length, 0,
    '新设备登记时不应自动写入 revoked_at：' + JSON.stringify(deviceMutationTrace));
  const originalPresence = ctx.store.upsertDevicePresence.bind(ctx.store);
  ctx.store.upsertDevicePresence = options => {
    revokeAtWrite(heartbeatDevice);
    return originalPresence({ ...options, requireActiveDevice: true });
  };
  const heartbeat = await ctx.fetchTo('/api/presence/heartbeat', {
    method: 'POST',
    body: { foregroundActive: true },
    headers: {
      cookie: adminCookie,
      'x-device-auth': heartbeatDevice.deviceId + '.' + heartbeatDevice.secret
    }
  });
  const heartbeatResult = await json(heartbeat);
  assert.equal(heartbeatResult.status, 403);
  assert.equal(heartbeatResult.payload.error.code, 'DEVICE_REVOKED');
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM device_presence WHERE user_id = ? AND device_id = ?',
    accountId,
    heartbeatDevice.deviceId
  )[0].total, 0, '已撤销设备不能重新留下在线心跳');

  const leaseDevice = await registerDevice('device_lease_race_0001');
  const characterId = 'role_lease_race';
  ctx.store.upsertDevicePresence({
    userId: accountId,
    deviceId: leaseDevice.deviceId,
    foregroundActive: true,
    now: ctx.now()
  });
  const originalAcquire = ctx.store.acquireCharacterLease.bind(ctx.store);
  ctx.store.acquireCharacterLease = options => {
    revokeAtWrite(leaseDevice);
    return originalAcquire({ ...options, requireActiveDevice: true });
  };
  const lease = await ctx.fetchTo('/api/characters/' + characterId + '/lease', {
    method: 'POST',
    body: { action: 'acquire' },
    headers: {
      cookie: adminCookie,
      'x-device-auth': leaseDevice.deviceId + '.' + leaseDevice.secret
    }
  });
  const leaseResult = await json(lease);
  assert.equal(leaseResult.status, 403);
  assert.equal(leaseResult.payload.error.code, 'DEVICE_REVOKED');
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM character_leases WHERE user_id = ? AND character_id = ?',
    accountId,
    characterId
  )[0].total, 0, '已撤销设备不能重新取得角色租约');

  const settingsDevice = await registerDevice('device_settings_race01');
  const originalSetAutonomy = ctx.store.setUserAutonomy.bind(ctx.store);
  ctx.store.setUserAutonomy = (userId, enabled, timestamp, deviceId) => {
    revokeAtWrite(settingsDevice);
    return originalSetAutonomy(userId, enabled, timestamp, deviceId);
  };
  const settings = await ctx.fetchTo('/api/autonomy/global', {
    method: 'PUT',
    body: { enabled: true },
    headers: {
      cookie: adminCookie,
      'x-device-auth': settingsDevice.deviceId + '.' + settingsDevice.secret
    }
  });
  const settingsResult = await json(settings);
  assert.equal(settingsResult.status, 403);
  assert.equal(settingsResult.payload.error.code, 'DEVICE_REVOKED');
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM user_autonomy WHERE user_id = ?',
    accountId
  )[0].total, 0, '已撤销设备不能在撤销后继续修改账号自主活动权限');
});

test('设备撤销并发时，不能新增上下文版本事件或排队自主活动', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, {
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
    AUTONOMY_LEASE_MS: '60000',
    AUTONOMY_TICK_LIMIT: '5',
    AUTONOMY_RETRY_BACKOFF_MS: '1000,5000'
  });
  const deviceMutationTrace = [];
  const originalStoreExec = ctx.store.exec.bind(ctx.store);
  ctx.store.exec = (sql, ...params) => {
    const result = originalStoreExec(sql, ...params);
    if (/UPDATE\\s+devices/i.test(String(sql)) && /revoked_at/i.test(String(sql))) {
      deviceMutationTrace.push({ sql: String(sql), params });
    }
    return result;
  };
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const accountId = (await admin.clone().json()).account.id;
  const registerDevice = async deviceId => {
    const secret = randomToken(32);
    const response = await post(ctx, '/api/devices/register', {
      deviceId,
      secret,
      label: deviceId,
      platform: 'test'
    }, adminCookie);
    assert.equal(response.status, 200);
    return { deviceId, secret };
  };

  const contextDevice = await registerDevice('device_context_race_01');
  assert.equal(deviceMutationTrace.length, 0,
    '新设备登记时不应自动写入 revoked_at：' + JSON.stringify(deviceMutationTrace));
  const characterId = 'role_context_revoke_race';
  const originalRecord = ctx.store.recordCharacterContextEvent.bind(ctx.store);
  ctx.store.recordCharacterContextEvent = options => {
    const stored = ctx.query(
      'SELECT id, user_id, revoked_at FROM devices WHERE id = ?',
      contextDevice.deviceId
    )[0];
    assert.ok(stored, '上下文事件撤销前，刚登记的设备必须存在');
    assert.equal(stored.user_id, accountId,
      '上下文事件设备必须归属于当前 MAO 永久 ID：' + JSON.stringify(stored));
    assert.equal(
      ctx.store.revokeMaoAccountDevice(accountId, contextDevice.deviceId, ctx.now()),
      true,
      '上下文事件设备撤销必须成功：' + JSON.stringify(stored)
    );
    return originalRecord({ ...options, requireActiveDevice: true });
  };
  const contextResponse = await ctx.fetchTo('/api/characters/' + characterId + '/context-version', {
    method: 'POST',
    body: { eventId: 'context_race_event_0001' },
    headers: {
      cookie: adminCookie,
      'x-device-auth': contextDevice.deviceId + '.' + contextDevice.secret
    }
  });
  const contextResult = await json(contextResponse);
  assert.equal(contextResult.status, 403);
  assert.equal(contextResult.payload.error.code, 'DEVICE_REVOKED');
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM character_context_events WHERE user_id = ? AND character_id = ?',
    accountId,
    characterId
  )[0].total, 0);
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM character_context_versions WHERE user_id = ? AND character_id = ?',
    accountId,
    characterId
  )[0].total, 0);

  const activityDevice = await registerDevice('device_activity_race01');
  const activityCharacterId = 'role_activity_revoke_race';
  const timestamp = ctx.now();
  ctx.store.setUserAutonomy(accountId, true, timestamp);
  ctx.store.setCharacterAutonomy(accountId, activityCharacterId, null, timestamp);
  const version = ctx.store.recordCharacterContextEvent({
    userId: accountId,
    characterId: activityCharacterId,
    eventId: 'activity_context_seed_0001',
    deviceId: activityDevice.deviceId,
    now: timestamp
  });
  assert.equal(version.changed, true);

  const originalEnqueue = ctx.store.enqueueActivity.bind(ctx.store);
  ctx.store.enqueueActivity = activity => {
    assert.equal(
      ctx.store.revokeMaoAccountDevice(accountId, activityDevice.deviceId, ctx.now()),
      true
    );
    return originalEnqueue({ ...activity, requireActiveDevice: true, userId: accountId });
  };
  const queued = await ctx.fetchTo('/api/autonomy/characters/' + activityCharacterId + '/activities', {
    method: 'POST',
    body: { contextVersion: version.version },
    headers: {
      cookie: adminCookie,
      'x-device-auth': activityDevice.deviceId + '.' + activityDevice.secret
    }
  });
  const queuedResult = await json(queued);
  assert.equal(queuedResult.status, 403);
  assert.equal(queuedResult.payload.error.code, 'DEVICE_REVOKED');
  assert.equal(ctx.query(
    'SELECT COUNT(*) AS total FROM activity_queue WHERE device_id = ?',
    activityDevice.deviceId
  )[0].total, 0, '已撤销设备不能在撤销完成后新增自主活动任务');
});

test('设备撤销后，迟到的 last-seen 更新不得再改写设备记录', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const deviceId = 'device_late_touch_0001';
  const createdAt = ctx.now();
  ctx.store.insertDevice({
    id: deviceId,
    userId: 'owner',
    secretHash: 'late-touch-test-secret-hash',
    label: 'revoked device',
    platform: 'test',
    now: createdAt
  });
  ctx.store.exec(
    'UPDATE devices SET last_seen_at = ? WHERE id = ?',
    createdAt - 1000,
    deviceId
  );
  ctx.store.revokeDevice(deviceId, createdAt);

  ctx.store.touchDevice(deviceId, createdAt + 5000);
  const device = ctx.query(
    'SELECT last_seen_at, revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0];
  assert.equal(Number(device.last_seen_at), createdAt - 1000);
  assert.equal(Number(device.revoked_at), createdAt);
});

test('遗留运行中任务在设备被撤销后不能再被完成、跳过或重试', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, {
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
    AUTONOMY_LEASE_MS: '60000',
    AUTONOMY_TICK_LIMIT: '5',
    AUTONOMY_RETRY_BACKOFF_MS: '1000,5000'
  });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'creator',
      password: 'creator-password-123',
      confirmPassword: 'creator-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const accountId = (await admin.clone().json()).account.id;

  const registerDevice = async deviceId => {
    const secret = randomToken(32);
    const enrolled = await post(ctx, '/api/devices/register', {
      deviceId,
      secret,
      label: deviceId,
      platform: 'test'
    }, adminCookie);
    assert.equal(enrolled.status, 200);
    return { deviceId, secret };
  };
  const insertRunningActivity = (device, activityId) => {
    const timestamp = ctx.now();
    ctx.store.exec(
      `INSERT INTO activity_queue
        (id, device_id, character_id, kind, status, scheduled_at, attempt_count,
         max_attempts, locked_by, locked_until, payload_json, created_at, updated_at, dedupe_key)
       VALUES (?, ?, ?, 'contact', 'running', ?, 1, 3, ?, ?, '{}', ?, ?, ?)`,
      activityId,
      device.deviceId,
      'role_legacy_running',
      timestamp,
      device.deviceId,
      timestamp + 60000,
      timestamp,
      timestamp,
      'legacy-dedupe-' + activityId
    );
  };
  const revokeWithoutQueueSweep = device => {
    ctx.store.exec(
      'UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      ctx.now(),
      device.deviceId
    );
  };

  const skipDevice = await registerDevice('device_task_skip_0001');
  const skipActivityId = 'activity_legacy_skip_0001';
  insertRunningActivity(skipDevice, skipActivityId);
  const originalComplete = ctx.store.completeActivity.bind(ctx.store);
  ctx.store.completeActivity = options => {
    revokeWithoutQueueSweep(skipDevice);
    return originalComplete({
      ...options,
      userId: accountId,
      requireActiveDevice: true
    });
  };
  const skipped = await ctx.fetchTo('/api/autonomy/activities/' + skipActivityId + '/skip', {
    method: 'POST',
    body: { attemptCount: 1, reasonCode: 'no_worthy_message' },
    headers: {
      cookie: adminCookie,
      'x-device-auth': skipDevice.deviceId + '.' + skipDevice.secret
    }
  });
  const skipResult = await json(skipped);
  assert.equal(skipResult.status, 409);
  assert.equal(skipResult.payload.error.code, 'ACTIVITY_LEASE_LOST');
  assert.equal(ctx.query(
    'SELECT status FROM activity_queue WHERE id = ?',
    skipActivityId
  )[0].status, 'running',
  '设备撤销后旧请求不能把遗留运行中任务标记为已完成');

  const failDevice = await registerDevice('device_task_fail_0001');
  const failActivityId = 'activity_legacy_fail_0001';
  insertRunningActivity(failDevice, failActivityId);
  const originalFail = ctx.store.failActivity.bind(ctx.store);
  ctx.store.failActivity = options => {
    revokeWithoutQueueSweep(failDevice);
    return originalFail({
      ...options,
      userId: accountId,
      requireActiveDevice: true
    });
  };
  const failed = await ctx.fetchTo('/api/autonomy/activities/' + failActivityId + '/fail', {
    method: 'POST',
    body: { attemptCount: 1, reasonCode: 'generation_failed' },
    headers: {
      cookie: adminCookie,
      'x-device-auth': failDevice.deviceId + '.' + failDevice.secret
    }
  });
  const failResult = await json(failed);
  assert.equal(failResult.status, 409);
  assert.equal(failResult.payload.error.code, 'ACTIVITY_LEASE_LOST');
  assert.equal(ctx.query(
    'SELECT status, next_attempt_at FROM activity_queue WHERE id = ?',
    failActivityId
  )[0].status, 'running',
  '设备撤销后旧请求不能再把遗留任务重新排入 retry 队列');
});

test('现有设备重新登记时，Session 在数据库写入前被撤销必须拒绝刷新', async () => {
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
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'session-revoke-reenroll',
      password: 'session-revoke-reenroll-password-123',
      confirmPassword: 'session-revoke-reenroll-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', { targetAccountId: accountId }, adminCookie);
  assert.equal(invite.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'session-revoke-reenroll',
      password: 'session-revoke-reenroll-password-123'
    }
  });
  assert.equal(login.status, 200);
  const userCookie = cookieFrom(login);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200);

  const deviceId = 'device_session_revoke_01';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'original session device',
    platform: 'test'
  }, userCookie);
  assert.equal(enrolled.status, 200);

  // This request explicitly supplies account context, so the Worker first
  // validates the Session once and registerDevice then reads it again.
  // Revoke after the second lookup returns its valid snapshot to exercise the
  // SQL write-boundary guard rather than an earlier request-level rejection.
  const originalGetSession = ctx.store.getMaoAccountSession.bind(ctx.store);
  let sessionReads = 0;
  ctx.store.getMaoAccountSession = tokenHash => {
    const session = originalGetSession(tokenHash);
    if (session && session.account_id === accountId) {
      sessionReads += 1;
      // The explicit page context is validated once by the Worker, then
      // registerDevice performs its own Session lookup. Revoke after that
      // second valid snapshot so the SQL write-boundary guard is exercised.
      if (sessionReads === 2) {
        ctx.store.revokeMaoAccountSession(session.session_id, ctx.now());
      }
    }
    return session;
  };

  const reenrollment = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId,
      secret: deviceSecret,
      label: 'stale session refresh',
      platform: 'stale'
    },
    headers: {
      cookie: userCookie,
      'x-mao-account-context': accountId
    }
  });
  const result = await json(reenrollment);
  assert.equal(sessionReads >= 2, true);
  assert.equal(result.status, 401);
  assert.equal(result.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');

  const persisted = ctx.query(
    'SELECT label, platform, revoked_at FROM devices WHERE id = ?',
    deviceId
  )[0];
  assert.equal(persisted.revoked_at, null,
    '仅撤销 Session 不应错误地撤销该设备授权本身');
  assert.equal(persisted.label, 'original session device',
    '已撤销 Session 不得更新设备资料');
  assert.equal(persisted.platform, 'test');
  const session = ctx.query(
    'SELECT revoked_at FROM mao_account_sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1',
    accountId
  )[0];
  assert.notEqual(session.revoked_at, null);
});

test('通用设备撤销入口与活动队列清理必须原子提交', async () => {
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
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const deviceId = 'device_self_revoke_queue01';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'self revoke queue device',
    platform: 'test'
  }, adminCookie);
  assert.equal(enrolled.status, 200);
  const timestamp = ctx.now();
  ctx.store.exec(
    "INSERT INTO activity_queue (id, device_id, character_id, kind, status, scheduled_at, locked_by, locked_until, payload_json, created_at, updated_at, dedupe_key) VALUES (?, ?, ?, 'contact', 'waiting', ?, NULL, NULL, '{}', ?, ?, ?)",
    'activity_self_revoke_queue_0001',
    deviceId,
    'role_self_revoke_queue',
    timestamp,
    timestamp,
    timestamp,
    'self-revoke-queue-dedupe'
  );
  ctx.store.exec(
    `CREATE TRIGGER fail_self_revoke_queue_cleanup
     BEFORE UPDATE OF status ON activity_queue
     WHEN OLD.device_id = '${deviceId}' AND NEW.status = 'superseded'
     BEGIN SELECT RAISE(ABORT, 'simulated queue cleanup failure'); END`
  );

  const failed = await ctx.fetchTo('/api/devices/revoke', {
    method: 'POST',
    headers: {
      cookie: adminCookie,
      'x-device-auth': deviceId + '.' + deviceSecret
    }
  });
  assert.equal(failed.status, 500);
  assert.equal(ctx.query('SELECT revoked_at FROM devices WHERE id = ?', deviceId)[0].revoked_at, null,
    '活动清理失败时设备授权必须保持未撤销');
  assert.equal(ctx.query('SELECT status FROM activity_queue WHERE id = ?', 'activity_self_revoke_queue_0001')[0].status, 'waiting');

  ctx.store.exec('DROP TRIGGER fail_self_revoke_queue_cleanup');
  const successful = await ctx.fetchTo('/api/devices/revoke', {
    method: 'POST',
    headers: {
      cookie: adminCookie,
      'x-device-auth': deviceId + '.' + deviceSecret
    }
  });
  assert.equal(successful.status, 200);
  assert.notEqual(ctx.query('SELECT revoked_at FROM devices WHERE id = ?', deviceId)[0].revoked_at, null);
  assert.equal(ctx.query('SELECT status FROM activity_queue WHERE id = ?', 'activity_self_revoke_queue_0001')[0].status, 'superseded');
});

test('新设备登记与账号停用并发时，停用后的账号不能留下新设备凭据', async () => {
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
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const adminAccountId = (await admin.clone().json()).account.id;
  const adminSession = ctx.store.getMaoAccountSession(
    await sha256Hex(adminCookie.slice('MAO_SESSION='.length))
  );

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'device-enroll-race-user',
      password: 'device-enroll-race-user-password-123',
      confirmPassword: 'device-enroll-race-user-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', {
    targetAccountId: accountId
  }, adminCookie);
  assert.equal(invite.status, 201);

  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'device-enroll-race-user',
      password: 'device-enroll-race-user-password-123'
    }
  });
  assert.equal(login.status, 200);
  const userCookie = cookieFrom(login);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200);

  const originalInsert = ctx.store.insertMaoAccountDevice.bind(ctx.store);
  let disabledDuringEnrollment = false;
  ctx.store.insertMaoAccountDevice = device => {
    disabledDuringEnrollment = true;
    const changed = ctx.store.setMaoAccountState({
      accountId,
      action: 'disable',
      actorAccountId: adminAccountId,
      actorSessionId: adminSession.session_id,
      reason: '模拟新设备登记过程中的并发停用',
      now: ctx.now()
    });
    assert.equal(changed.status, 'disabled');
    return originalInsert(device);
  };

  const deviceId = 'device_new_enroll_race01';
  const deviceSecret = randomToken(32);
  const enrollment = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId,
      secret: deviceSecret,
      label: 'race-created device',
      platform: 'test'
    },
    headers: {
      cookie: userCookie,
      'x-mao-account-context': accountId
    }
  });
  const result = await json(enrollment);
  assert.equal(disabledDuringEnrollment, true);
  assert.equal(result.status, 403);
  assert.equal(result.payload.error.code, 'ACCOUNT_DISABLED');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM devices WHERE id = ? AND user_id = ?',
    deviceId, accountId
  )[0].total), 0,
  '账号停用提交后，不能再插入新的有效设备凭据');
});

test('停用或永久撤销账号会在同一事务内撤销其未核销邀请码，恢复后必须重新发码', async () => {
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
      username: 'pending-invite-lifecycle',
      password: 'pending-invite-lifecycle-password-123',
      confirmPassword: 'pending-invite-lifecycle-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;

  const firstInvite = await post(ctx, '/api/admin/invites', { targetAccountId: accountId }, adminCookie);
  assert.equal(firstInvite.status, 201);
  const firstInviteId = firstInvite.payload.invite.id;

  const disabled = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'disable',
    reason: '停用时撤销旧授权入口'
  }, adminCookie);
  assert.equal(disabled.status, 200);
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', accountId)[0].status, 'disabled');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', firstInviteId)[0].revoked_at,
    null,
    '停用账号时必须撤销该账号未使用的邀请码'
  );
  const disabledAudit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + accountId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  const autoRevokeRecord = disabledAudit.payload.records.find(record =>
    record.action === 'invite_revoke' &&
    record.inviteId === firstInviteId &&
    record.sourceAction === 'disable'
  );
  assert.ok(autoRevokeRecord,
    '账号停用自动撤销的邀请码必须单独进入账号审计时间线');
  assert.equal(autoRevokeRecord.targetAccountId, accountId);
  assert.equal(autoRevokeRecord.actorAccountId, (await admin.clone().json()).account.id);
  const disableRecord = disabledAudit.payload.records.find(record => record.action === 'disable');
  assert.equal(disableRecord.fromStatus, 'pending_invite');
  assert.equal(disableRecord.toStatus, 'disabled',
    '停用审计必须保留操作前后的真实状态');

  const restored = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'restore',
    reason: '恢复后重新授权'
  }, adminCookie);
  assert.equal(restored.status, 200);
  assert.equal(restored.payload.account.status, 'pending_invite');
  const restoreAudit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + accountId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  const restoreRecord = restoreAudit.payload.records.find(record => record.action === 'restore');
  assert.equal(restoreRecord.fromStatus, 'disabled');
  assert.equal(restoreRecord.toStatus, 'pending_invite');

  const userLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'pending-invite-lifecycle', password: 'pending-invite-lifecycle-password-123' }
  });
  const userCookie = cookieFrom(userLogin);
  const staleCode = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: firstInvite.payload.invite.code
  }, userCookie);
  assert.equal(staleCode.status, 403, '恢复后的账号不得继续使用停用前的邀请码');
  assert.equal(staleCode.payload.error.code, 'INVITE_NOT_VALID_FOR_ACCOUNT');
  assert.equal(
    Number(ctx.query('SELECT used_count FROM mao_invite_codes WHERE id = ?', firstInviteId)[0].used_count),
    0,
    '被撤销的邀请码不能被计为核销'
  );

  const secondInvite = await post(ctx, '/api/admin/invites', { targetAccountId: accountId }, adminCookie);
  assert.equal(secondInvite.status, 201, '恢复后的待授权账号应能获得一张新邀请码');
  assert.notEqual(secondInvite.payload.invite.id, firstInviteId);
  const accepted = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: secondInvite.payload.invite.code
  }, userCookie);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.account.status, 'active');

  const finalInviteState = ctx.query(
    'SELECT id, revoked_at, used_count FROM mao_invite_codes WHERE target_account_id = ? ORDER BY created_at ASC, id ASC',
    accountId
  );
  assert.equal(finalInviteState.length, 2);
  assert.notEqual(finalInviteState[0].revoked_at, null);
  assert.equal(Number(finalInviteState[0].used_count), 0);
  assert.equal(Number(finalInviteState[1].used_count), 1);

  const permanentTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'permanent-invite',
      password: 'permanent-invite-password-123',
      confirmPassword: 'permanent-invite-password-123'
    }
  });
  const permanentId = permanentTarget.payload.account.id;
  const permanentInvite = await post(ctx, '/api/admin/invites', {
    targetAccountId: permanentId
  }, adminCookie);
  assert.equal(permanentInvite.status, 201);
  const permanentRevoked = await post(ctx,
    '/api/admin/accounts/' + permanentId + '/action',
    { action: 'revoke', reason: '永久撤销测试' },
    adminCookie
  );
  assert.equal(permanentRevoked.status, 200);
  const permanentAudit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + permanentId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.ok(permanentAudit.payload.records.some(record =>
    record.action === 'invite_revoke' &&
    record.inviteId === permanentInvite.payload.invite.id &&
    record.sourceAction === 'revoke'
  ), '永久撤销账号自动失效的邀请码也必须单独写入账号审计');
  const permanentStateRecord = permanentAudit.payload.records.find(record => record.action === 'revoke');
  assert.equal(permanentStateRecord.fromStatus, 'pending_invite');
  assert.equal(permanentStateRecord.toStatus, 'revoked');
});

test('发码预检查后账号被停用时，事务内二次校验阻止插入新邀请码', async () => {
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
  const adminAccountId = (await admin.clone().json()).account.id;
  const adminSession = ctx.store.getMaoAccountSession(
    await sha256Hex(adminCookie.slice('MAO_SESSION='.length))
  );
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-disable-race',
      password: 'invite-disable-race-password-123',
      confirmPassword: 'invite-disable-race-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const targetAccountId = registered.payload.account.id;

  const insertInvite = ctx.store.insertMaoInvite.bind(ctx.store);
  let disabledBetweenCheckAndInsert = false;
  ctx.store.insertMaoInvite = invite => {
    const changed = ctx.store.setMaoAccountState({
      accountId: targetAccountId,
      action: 'disable',
      actorAccountId: adminAccountId,
      actorSessionId: adminSession.session_id,
      reason: '模拟发码并发停用',
      now: ctx.now()
    });
    assert.ok(changed, '模拟并发停用必须成功');
    disabledBetweenCheckAndInsert = true;
    return insertInvite(invite);
  };

  const response = await post(ctx, '/api/admin/invites', {
    targetAccountId
  }, adminCookie);
  assert.equal(disabledBetweenCheckAndInsert, true);
  assert.equal(response.status, 409);
  assert.equal(response.payload.error.code, 'INVITE_TARGET_NOT_PENDING');
  assert.equal(
    Number(ctx.query('SELECT COUNT(*) AS total FROM mao_invite_codes WHERE target_account_id = ?', targetAccountId)[0].total),
    0,
    '账号状态改变后，事务内二次校验必须阻止留下可用邀请码'
  );
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', targetAccountId)[0].status, 'disabled');
});

test('账号停用时邀请码撤销与状态变更共同回滚，不留下半完成授权状态', async () => {
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
      username: 'invite-disable-rollback',
      password: 'invite-disable-rollback-password-123',
      confirmPassword: 'invite-disable-rollback-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const targetAccountId = registered.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', { targetAccountId }, adminCookie);
  assert.equal(invite.status, 201);

  ctx.store.exec(
    'CREATE TRIGGER fail_invite_lifecycle_audit BEFORE INSERT ON mao_account_audit ' +
    "WHEN NEW.target_account_id = '" + targetAccountId + "' " +
    "BEGIN SELECT RAISE(ABORT, 'simulated lifecycle audit failure'); END"
  );

  const failed = await post(ctx, '/api/admin/accounts/' + targetAccountId + '/action', {
    action: 'disable',
    reason: '触发事务回滚'
  }, adminCookie);
  assert.equal(failed.status, 500);
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', targetAccountId)[0].status, 'pending_invite');
  assert.equal(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', invite.payload.invite.id)[0].revoked_at,
    null,
    '审计写入失败时邀请码撤销必须随事务一起回滚'
  );

  ctx.store.exec('DROP TRIGGER fail_invite_lifecycle_audit');
  const stillUsable = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'invite-disable-rollback',
      password: 'invite-disable-rollback-password-123'
    }
  });
  const userCookie = cookieFrom(stillUsable);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200, '回滚后仍有效的邀请码应保持可核销');
});


test('永久撤销账号会撤销邮箱变更前签发的 QQ 邮箱邀请码，且不能恢复账号', async () => {
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
      username: 'verified-email-owner',
      password: 'verified-email-owner-password-123',
      confirmPassword: 'verified-email-owner-password-123',
      qqEmail: 'verified-owner@qq.com'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?',
    ctx.now(), accountId
  );

  const invite = await post(ctx, '/api/admin/invites', {
    targetEmail: 'verified-owner@qq.com'
  }, adminCookie);
  assert.equal(invite.status, 201);
  assert.equal(invite.payload.invite.targetAccountId, null);
  assert.equal(invite.payload.invite.targetEmail, 'verified-owner@qq.com');

  const changedEmail = ctx.store.updateMaoAccountEmail(
    accountId,
    'changed-owner@qq.com',
    ctx.now()
  );
  assert.equal(changedEmail.qq_email, 'changed-owner@qq.com');
  assert.equal(changedEmail.qq_email_verified_at, null,
    '更换 QQ 邮箱后旧邮箱必须失去已验证状态');

  const revoked = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'revoke',
    reason: '永久撤销后邮箱邀请码也必须失效'
  }, adminCookie);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.payload.account.status, 'revoked');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', invite.payload.invite.id)[0].revoked_at,
    null,
    '即使账号已经更换并取消验证旧邮箱，也必须撤销历史绑定邀请码'
  );
  const emailAudit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + accountId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  assert.ok(emailAudit.payload.records.some(record =>
    record.action === 'invite_revoke' &&
    record.inviteId === invite.payload.invite.id &&
    record.targetAccountId === accountId &&
    record.sourceAction === 'revoke'
  ), '通过已验证邮箱绑定的邀请码自动失效后，必须记录在其所属账号时间线');

  const restore = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'restore'
  }, adminCookie);
  assert.equal(restore.status, 409, '永久撤销状态不可恢复');
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', accountId)[0].status, 'revoked');
});


test('邮箱变更并取消验证后，临时停用仍会撤销历史邮箱邀请码', async () => {
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
      username: 'changed-email-pending',
      password: 'changed-email-pending-password-123',
      confirmPassword: 'changed-email-pending-password-123',
      qqEmail: 'before-change@qq.com'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?',
    ctx.now(), accountId
  );

  const invite = await post(ctx, '/api/admin/invites', {
    targetEmail: 'before-change@qq.com'
  }, adminCookie);
  assert.equal(invite.status, 201);
  const inviteId = invite.payload.invite.id;

  const changed = ctx.store.updateMaoAccountEmail(accountId, 'after-change@qq.com', ctx.now());
  assert.equal(changed.qq_email, 'after-change@qq.com');
  assert.equal(changed.qq_email_verified_at, null);

  const disabled = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'disable',
    reason: '邮箱更新后暂停待授权账号'
  }, adminCookie);
  assert.equal(disabled.status, 200);
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', inviteId)[0].revoked_at,
    null,
    '系统应通过 invite_create 历史归属定位旧邮箱邀请码，而不是只查当前邮箱'
  );

  const audit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + accountId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  const oldInviteEvents = audit.payload.records.filter(record =>
    record.action === 'invite_revoke' && record.inviteId === inviteId
  );
  assert.equal(oldInviteEvents.length, 1,
    '同一张旧邮箱邀请码只应产生一条自动撤销审计，不能重复记账');
  assert.equal(oldInviteEvents[0].targetAccountId, accountId);
  assert.equal(oldInviteEvents[0].sourceAction, 'disable',
    '旧邮箱邀请码自动撤销事件必须仍记录在原账号时间线');
});

test('邮箱变更后的历史邀请码撤销审计失败时，停用与撤销一起回滚，重试不重复记账', async () => {
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
      username: 'email-rollback',
      password: 'email-rollback-password-123',
      confirmPassword: 'email-rollback-password-123',
      qqEmail: 'rollback-before@qq.com'
    }
  });
  assert.equal(registered.status, 201);
  const accountId = registered.payload.account.id;
  ctx.store.exec(
    'UPDATE mao_accounts SET qq_email_verified_at = ? WHERE id = ?',
    ctx.now(), accountId
  );

  const invite = await post(ctx, '/api/admin/invites', {
    targetEmail: 'rollback-before@qq.com'
  }, adminCookie);
  assert.equal(invite.status, 201);
  const inviteId = invite.payload.invite.id;

  const changed = ctx.store.updateMaoAccountEmail(accountId, 'rollback-after@qq.com', ctx.now());
  assert.equal(changed.qq_email_verified_at, null);

  ctx.store.exec(
    'CREATE TRIGGER fail_historical_invite_audit BEFORE INSERT ON mao_account_audit ' +
    "WHEN NEW.target_account_id = '" + accountId + "' AND NEW.action = 'invite_revoke' " +
    "BEGIN SELECT RAISE(ABORT, 'simulated historical invite audit failure'); END"
  );

  const failed = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'disable',
    reason: '验证历史邮箱撤销的审计事务回滚'
  }, adminCookie);
  assert.equal(failed.status, 500);
  assert.equal(
    ctx.query('SELECT status FROM mao_accounts WHERE id = ?', accountId)[0].status,
    'pending_invite',
    '历史邀请码审计失败时账号状态不能单独变为 disabled'
  );
  assert.equal(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', inviteId)[0].revoked_at,
    null,
    '历史邀请码审计失败时 revoked_at 必须一并回滚'
  );
  assert.equal(
    Number(ctx.query(
      "SELECT COUNT(*) AS total FROM mao_account_audit WHERE target_account_id = ? AND action = 'invite_revoke'",
      accountId
    )[0].total),
    0,
    '失败事务不应留下半条历史邀请码撤销审计'
  );

  ctx.store.exec('DROP TRIGGER fail_historical_invite_audit');
  const retried = await post(ctx, '/api/admin/accounts/' + accountId + '/action', {
    action: 'disable',
    reason: '故障解除后重试'
  }, adminCookie);
  assert.equal(retried.status, 200);
  assert.equal(retried.payload.account.status, 'disabled');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_invite_codes WHERE id = ?', inviteId)[0].revoked_at,
    null,
    '重试必须成功撤销同一张历史邀请码'
  );
  const audit = await json(await ctx.fetchTo(
    '/api/admin/accounts/' + accountId + '/audit',
    { headers: { cookie: adminCookie } }
  ));
  const events = audit.payload.records.filter(record =>
    record.action === 'invite_revoke' && record.inviteId === inviteId
  );
  assert.equal(events.length, 1,
    '失败后成功重试最终只能留下单条自动撤销审计');
  assert.equal(events[0].sourceAction, 'disable');
});

test('0014 adds ordered cursor indexes for the admin account and invitation directories', () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const names = ctx.query("SELECT name FROM sqlite_master WHERE type = 'index'").map(row => row.name);
  assert.ok(names.includes('idx_mao_accounts_directory_cursor'));
  assert.ok(names.includes('idx_mao_invites_directory_cursor'));
});

test('创作者邀请码目录超过 500 条时可按游标完整翻页，统计与全目录搜索一致', async () => {
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
  const adminAccountId = ctx.query("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id;
  const timestamp = ctx.now();

  for (let index = 0; index < 503; index += 1) {
    const suffix = String(index).padStart(12, '0');
    const recordId = 'invite_record_' + suffix;
    const createdAt = 1000 + Math.floor(index / 2);
    const usedCount = index % 3 === 0 ? 1 : 0;
    const expiresAt = index % 3 === 1 ? timestamp - 1 : timestamp + 100000;
    const revokedAt = index % 7 === 0 ? timestamp : null;
    ctx.store.exec(
      "INSERT INTO mao_invite_codes (id, token_hash, target_account_id, target_email, max_uses, used_count, created_by_account_id, created_at, expires_at, revoked_at) VALUES (?, ?, NULL, ?, 1, ?, ?, ?, ?, ?)",
      recordId, 'token-hash-' + suffix, 'invite' + index + '@qq.com',
      usedCount, adminAccountId, createdAt, expiresAt, revokedAt
    );
  }

  let cursor = '';
  const ids = [];
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const path = '/api/admin/invites?limit=40' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const result = await json(await ctx.fetchTo(path, { headers: { cookie: adminCookie } }));
    assert.equal(result.status, 200);
    assert.equal(result.payload.page.totalCount, 503);
    assert.equal(result.payload.summary.total, 503);
    assert.equal(
      result.payload.summary.pending + result.payload.summary.used +
        result.payload.summary.expired + result.payload.summary.revoked,
      503,
      '全局状态统计必须覆盖所有邀请码且互斥'
    );
    ids.push(...result.payload.invites.map(invite => invite.id));
    if (!result.payload.page.hasMore) break;
    assert.ok(result.payload.page.nextCursor);
    cursor = result.payload.page.nextCursor;
  }
  assert.equal(ids.length, 503);
  assert.equal(new Set(ids).size, 503,
    '创建时间相同的历史邀请码也不能在翻页时重复或遗漏');

  const oldInvite = await json(await ctx.fetchTo(
    '/api/admin/invites?search=' + encodeURIComponent('invite_record_000000000000'),
    { headers: { cookie: adminCookie } }
  ));
  assert.equal(oldInvite.status, 200);
  assert.equal(oldInvite.payload.page.totalCount, 1,
    '历史邀请码必须能通过全目录搜索找到');
  assert.equal(oldInvite.payload.invites[0].id, 'invite_record_000000000000');
});


test('管理审计记录按稳定游标完整分页，且普通用户不能读取', async () => {
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
  const adminId = ctx.query("SELECT id FROM mao_accounts WHERE role = 'super_admin'")[0].id;
  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'audit-pagination-user',
      password: 'audit-pagination-user-password-123',
      confirmPassword: 'audit-pagination-user-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const targetId = registered.payload.account.id;

  for (let index = 0; index < 225; index += 1) {
    const suffix = String(index).padStart(6, '0');
    ctx.store.exec(
      'INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      'audit_test_' + suffix, adminId, targetId, 'disable',
      JSON.stringify({ reason: '历史审计 ' + index }),
      5000 + Math.floor(index / 2)
    );
  }

  let cursor = '';
  const ids = [];
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const path = '/api/admin/accounts/' + targetId + '/audit?limit=50' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const result = await json(await ctx.fetchTo(path, { headers: { cookie: adminCookie } }));
    assert.equal(result.status, 200);
    assert.equal(result.payload.page.totalCount, 226);
    assert.equal(result.payload.records.length, Math.min(50, 226 - ids.length));
    ids.push(...result.payload.records.map(record => record.id));
    if (!result.payload.page.hasMore) break;
    assert.ok(result.payload.page.nextCursor);
    cursor = result.payload.page.nextCursor;
  }
  assert.equal(ids.length, 226);
  assert.equal(new Set(ids).size, 226,
    'created_at 相同的审计记录不能在翻页时重复或遗漏');

  const ordinaryLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'audit-pagination-user',
      password: 'audit-pagination-user-password-123'
    }
  });
  const ordinaryCookie = cookieFrom(ordinaryLogin);
  const denied = await ctx.fetchTo('/api/admin/accounts/' + targetId + '/audit', {
    headers: { cookie: ordinaryCookie }
  });
  assert.equal(denied.status, 403, '非超级管理员不得读取审计原因和历史');
});

test('0015 adds the per-account audit cursor index', () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const names = ctx.query("SELECT name FROM sqlite_master WHERE type = 'index'").map(row => row.name);
  assert.ok(names.includes('idx_mao_account_audit_cursor'));
});


test('创作者首次初始化与迁移审计原子提交，审计失败后可安全重试', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  ctx.store.exec(
    "CREATE TRIGGER fail_admin_bootstrap_audit BEFORE INSERT ON mao_account_audit " +
    "WHEN NEW.action = 'admin_bootstrap' " +
    "BEGIN SELECT RAISE(ABORT, 'simulated creator bootstrap audit failure'); END"
  );
  const payload = {
    bootstrapSecret: BOOTSTRAP_SECRET,
    username: 'bootstrap-audit-rollback',
    password: 'bootstrap-audit-rollback-password',
    confirmPassword: 'bootstrap-audit-rollback-password'
  };
  const failed = await ctx.fetchTo('/api/admin/bootstrap', { method: 'POST', body: payload });
  assert.equal(failed.status, 500);
  assert.equal(Number(ctx.query("SELECT COUNT(*) AS total FROM mao_accounts WHERE role = 'super_admin'")[0].total), 0,
    '初始化审计失败时不能留下超级管理员账号');
  assert.equal(Number(ctx.query("SELECT COUNT(*) AS total FROM mao_account_audit WHERE action = 'admin_bootstrap'")[0].total), 0);

  ctx.store.exec('DROP TRIGGER fail_admin_bootstrap_audit');
  const retriedResponse = await ctx.fetchTo('/api/admin/bootstrap', { method: 'POST', body: payload });
  const retried = await json(retriedResponse);
  assert.equal(retried.status, 200);
  const events = ctx.query(
    "SELECT action, actor_account_id, target_account_id FROM mao_account_audit WHERE action = 'admin_bootstrap'"
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_account_id, null);
  assert.equal(events[0].target_account_id, retried.payload.account.id);
});

test('账号注册与注册审计原子提交，审计失败时账号创建回滚且可重试', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  ctx.store.exec(
    "CREATE TRIGGER fail_account_register_audit BEFORE INSERT ON mao_account_audit " +
    "WHEN NEW.action = 'account_register' " +
    "BEGIN SELECT RAISE(ABORT, 'simulated account registration audit failure'); END"
  );

  const failed = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'audit-register-rollback',
      password: 'audit-register-rollback-password',
      confirmPassword: 'audit-register-rollback-password'
    }
  });
  assert.equal(failed.status, 500);
  assert.equal(Number(ctx.query(
    "SELECT COUNT(*) AS total FROM mao_accounts WHERE username_key = ?",
    'audit-register-rollback'
  )[0].total), 0, '注册审计失败时不能留下没有审计事件的账号');
  assert.equal(Number(ctx.query(
    "SELECT COUNT(*) AS total FROM mao_account_audit WHERE action = 'account_register'"
  )[0].total), 0);

  ctx.store.exec('DROP TRIGGER fail_account_register_audit');
  const retried = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'audit-register-rollback',
      password: 'audit-register-rollback-password',
      confirmPassword: 'audit-register-rollback-password'
    }
  });
  assert.equal(retried.status, 201);
  const events = ctx.query(
    "SELECT action, target_account_id FROM mao_account_audit WHERE target_account_id = ? AND action = 'account_register'",
    retried.payload.account.id
  );
  assert.equal(events.length, 1, '修复故障后注册和审计应当只成功一次');
  assert.equal(events[0].target_account_id, retried.payload.account.id);
});

test('全局管理审计支持服务端筛选、搜索、游标分页并只返回安全字段', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const bootstrap = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'global-audit-admin',
      password: 'global-audit-admin-password',
      confirmPassword: 'global-audit-admin-password'
    }
  });
  assert.equal(bootstrap.status, 200);
  const adminCookie = cookieFrom(bootstrap);

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: { username: 'global-audit-target', password: 'global-audit-target-password', confirmPassword: 'global-audit-target-password' }
  });
  assert.equal(registered.status, 201);
  const targetId = registered.payload.account.id;
  const created = await post(ctx, '/api/admin/invites', { targetAccountId: targetId }, adminCookie);
  assert.equal(created.status, 201);
  const inviteId = created.payload.invite.id;
  const disabled = await post(ctx, '/api/admin/accounts/' + encodeURIComponent(targetId) + '/action', {
    action: 'disable',
    reason: 'global audit contract'
  }, adminCookie);
  assert.equal(disabled.status, 200);

  const firstResponse = await ctx.fetchTo('/api/admin/audit?limit=2&type=all&search=' + encodeURIComponent(targetId), {
    headers: { cookie: adminCookie }
  });
  const first = await json(firstResponse);
  assert.equal(first.status, 200);
  assert.equal(first.payload.records.length, 2);
  assert.equal(first.payload.page.totalCount, 4);
  assert.equal(first.payload.page.hasMore, true);
  assert.ok(first.payload.page.nextCursor);
  for (const record of first.payload.records) {
    assert.ok(record.id.startsWith('audit_'));
    assert.equal(record.targetAccountId, targetId);
    assert.ok(['admin', 'account'].includes(record.actorType));
    assert.equal(Object.hasOwn(record, 'code'), false);
    assert.equal(Object.hasOwn(record, 'tokenHash'), false);
    assert.equal(Object.hasOwn(record, 'detail_json'), false);
    assert.equal(JSON.stringify(record).includes(created.payload.invite.code), false);
  }

  const nextResponse = await ctx.fetchTo(
    '/api/admin/audit?limit=2&type=all&search=' + encodeURIComponent(targetId) +
      '&cursor=' + encodeURIComponent(first.payload.page.nextCursor),
    { headers: { cookie: adminCookie } }
  );
  const next = await json(nextResponse);
  assert.equal(next.status, 200);
  assert.equal(next.payload.records.length, 2);
  assert.equal(next.payload.page.hasMore, false);

  const timeRangeResponse = await ctx.fetchTo('/api/admin/audit?since=0&type=all', {
    headers: { cookie: adminCookie }
  });
  const timeRangeResult = await json(timeRangeResponse);
  assert.equal(timeRangeResult.status, 200);
  assert.equal(timeRangeResult.payload.page.totalCount, 5,
    'server-side timestamp filtering must preserve all records newer than the Unix epoch');

  const invalidTimeRange = await ctx.fetchTo('/api/admin/audit?since=9007199254740992', {
    headers: { cookie: adminCookie }
  });
  assert.equal(invalidTimeRange.status, 400);
  assert.equal((await json(invalidTimeRange)).payload.error.code, 'INVALID_AUDIT_RANGE');

  const inviteResponse = await ctx.fetchTo('/api/admin/audit?type=invite&search=' + encodeURIComponent(inviteId), {
    headers: { cookie: adminCookie }
  });
  const inviteResult = await json(inviteResponse);
  assert.equal(inviteResult.status, 200);
  assert.equal(inviteResult.payload.page.totalCount, 2);
  assert.ok(inviteResult.payload.records.every(record => record.action.startsWith('invite_')));

  const accountResponse = await ctx.fetchTo('/api/admin/audit?type=account&search=' + encodeURIComponent(targetId), {
    headers: { cookie: adminCookie }
  });
  const accountResult = await json(accountResponse);
  assert.equal(accountResult.status, 200);
  assert.equal(accountResult.payload.page.totalCount, 2);
  assert.ok(accountResult.payload.records.some(record => record.action === 'account_register'));
  assert.ok(accountResult.payload.records.some(record => record.action === 'disable'));

  const denied = await ctx.fetchTo('/api/admin/audit', { method: 'GET' });
  assert.equal(denied.status, 401, 'global audit must remain creator/admin-only');
});



test('并发注册推送订阅不能突破单设备订阅数量上限', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'push-cap-admin',
      password: 'push-cap-admin-password-123',
      confirmPassword: 'push-cap-admin-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const deviceId = 'device_push_cap_race01';
  const deviceSecret = randomToken(32);
  const enrolled = await post(ctx, '/api/devices/register', {
    deviceId,
    secret: deviceSecret,
    label: 'push cap test device',
    platform: 'test'
  }, adminCookie);
  assert.equal(enrolled.status, 200);

  const timestamp = ctx.now();
  for (let index = 0; index < 9; index += 1) {
    ctx.store.exec(
      'INSERT INTO push_subscriptions (id, device_id, endpoint, p256dh, auth_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'sub_push_cap_seed_' + String(index).padStart(2, '0'),
      deviceId,
      'https://push.example.com/seed-' + index,
      'seed-p256dh',
      'seed-auth-key',
      timestamp,
      timestamp
    );
  }

  const p256dhBytes = Buffer.alloc(65);
  p256dhBytes[0] = 4;
  for (let index = 1; index < p256dhBytes.length; index += 1) {
    p256dhBytes[index] = index;
  }
  const authBytes = Buffer.alloc(16, 7);
  const buildSubscription = endpoint => ({
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: p256dhBytes.toString('base64url'),
      auth: authBytes.toString('base64url')
    }
  });

  // Force both requests to pass the initial route-level count with the same
  // nine-row snapshot, reproducing the interleaving that used to exceed 10.
  const originalListSubscriptions = ctx.store.listSubscriptions.bind(ctx.store);
  let snapshotsTaken = 0;
  let releaseSnapshots;
  const bothSnapshotsReady = new Promise(resolve => { releaseSnapshots = resolve; });
  ctx.store.listSubscriptions = async (targetDeviceId, options = {}) => {
    const rows = originalListSubscriptions(targetDeviceId, options);
    if (targetDeviceId === deviceId && options.includeDisabled === true) {
      snapshotsTaken += 1;
      if (snapshotsTaken === 2) releaseSnapshots();
      await bothSnapshotsReady;
    }
    return rows;
  };

  const headers = {
    cookie: adminCookie,
    'x-device-auth': deviceId + '.' + deviceSecret
  };
  const submit = endpoint => ctx.fetchTo('/api/push/subscriptions', {
    method: 'POST',
    headers,
    body: { subscription: buildSubscription(endpoint) }
  });
  const responses = await Promise.all([
    submit('https://push.example.com/concurrent-a'),
    submit('https://push.example.com/concurrent-b')
  ]);
  ctx.store.listSubscriptions = originalListSubscriptions;

  const results = await Promise.all(responses.map(json));
  assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [200, 409]);
  const rejected = results.find(result => result.status === 409);
  assert.equal(rejected.payload.error.code, 'SUBSCRIPTION_LIMIT');
  assert.equal(
    Number(ctx.query(
      'SELECT COUNT(*) AS total FROM push_subscriptions WHERE device_id = ?',
      deviceId
    )[0].total),
    10,
    '两个并发请求只能占用最后一个空位，不能把设备订阅数写到 11'
  );
});


test('配对码只能消费一次，签发设备撤销后剩余配对码立即失效', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db);
  const enrollmentToken = 'test-enrollment-token-for-contract-tests';
  const issuer = {
    deviceId: 'device_pair_issuer01',
    secret: randomToken(32)
  };

  const bootstrap = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId: issuer.deviceId,
      secret: issuer.secret,
      label: 'pairing issuer',
      platform: 'test',
      pairingToken: enrollmentToken
    }
  });
  const bootstrapResult = await json(bootstrap);
  assert.equal(bootstrapResult.status, 200);
  assert.equal(bootstrapResult.payload.device.enrollmentMode, 'bootstrap');

  const makePairingToken = async () => {
    const response = await ctx.fetchTo('/api/devices/pairing-token', {
      method: 'POST',
      headers: { 'x-device-auth': issuer.deviceId + '.' + issuer.secret }
    });
    return json(response);
  };

  const issued = await makePairingToken();
  assert.equal(issued.status, 200);
  assert.equal(typeof issued.payload.pairingToken, 'string');
  assert.ok(issued.payload.pairingToken.length >= 32);

  const target = {
    deviceId: 'device_pair_target01',
    secret: randomToken(32)
  };
  const paired = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId: target.deviceId,
      secret: target.secret,
      label: 'paired device',
      platform: 'test',
      pairingToken: issued.payload.pairingToken
    }
  });
  const pairedResult = await json(paired);
  assert.equal(pairedResult.status, 200);
  assert.equal(pairedResult.payload.device.enrollmentMode, 'paired');
  assert.equal(
    ctx.query('SELECT user_id FROM devices WHERE id = ?', target.deviceId)[0].user_id,
    'owner',
    '配对设备必须继承签发设备的数据归属'
  );

  const replay = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId: 'device_pair_replay01',
      secret: randomToken(32),
      label: 'replayed device',
      platform: 'test',
      pairingToken: issued.payload.pairingToken
    }
  });
  const replayResult = await json(replay);
  assert.equal(replayResult.status, 403);
  assert.equal(replayResult.payload.error.code, 'PAIRING_TOKEN_INVALID');
  assert.equal(
    Number(ctx.query(
      "SELECT COUNT(*) AS total FROM devices WHERE id = ?",
      'device_pair_replay01'
    )[0].total),
    0,
    '已消费配对码不能再次创建设备凭据'
  );

  const pending = await makePairingToken();
  assert.equal(pending.status, 200);
  const revoked = await ctx.fetchTo('/api/devices/revoke', {
    method: 'POST',
    headers: { 'x-device-auth': issuer.deviceId + '.' + issuer.secret }
  });
  assert.equal(revoked.status, 200);

  const stalePairing = await ctx.fetchTo('/api/devices/register', {
    method: 'POST',
    body: {
      deviceId: 'device_pair_revoked01',
      secret: randomToken(32),
      label: 'stale pairing device',
      platform: 'test',
      pairingToken: pending.payload.pairingToken
    }
  });
  const staleResult = await json(stalePairing);
  assert.equal(staleResult.status, 403);
  assert.equal(staleResult.payload.error.code, 'PAIRING_TOKEN_INVALID');
  assert.equal(
    Number(ctx.query(
      'SELECT COUNT(*) AS total FROM device_pairing_tokens WHERE created_by_device_id = ? AND consumed_at IS NULL',
      issuer.deviceId
    )[0].total),
    0,
    '签发设备撤销时必须清除其所有未消费配对码'
  );
  assert.equal(
    Number(ctx.query(
      'SELECT COUNT(*) AS total FROM devices WHERE id = ?',
      'device_pair_revoked01'
    )[0].total),
    0,
    '签发设备撤销后，旧配对码不得创建新设备'
  );
});


test('设备鉴权末端必须复核同一个 MAO Session，不能只确认账号仍有其他有效会话', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });

  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'session-race-admin',
      password: 'session-race-admin-password-123',
      confirmPassword: 'session-race-admin-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);

  const registered = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'session-race-user',
      password: 'session-race-user-password-123',
      confirmPassword: 'session-race-user-password-123'
    }
  });
  assert.equal(registered.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'session-race-user',
      password: 'session-race-user-password-123'
    }
  });
  assert.equal(login.status, 200);
  const userCookie = cookieFrom(login);
  const accountId = registered.payload.account.id;
  const secondLogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'session-race-user',
      password: 'session-race-user-password-123'
    }
  });
  assert.equal(secondLogin.status, 200);
  const otherSessionCookie = cookieFrom(secondLogin);
  const otherSession = ctx.store.getMaoAccountSession(
    await sha256Hex(otherSessionCookie.slice('MAO_SESSION='.length))
  );
  assert.ok(otherSession?.session_id);

  const invite = await post(ctx, '/api/admin/invites', {
    targetAccountId: accountId
  }, adminCookie);
  assert.equal(invite.status, 201);
  const redeemed = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(redeemed.status, 200);

  const device = {
    deviceId: 'device_session_race_01',
    secret: randomToken(32)
  };
  const enrolled = await post(ctx, '/api/devices/register', {
    ...device,
    label: 'session race phone',
    platform: 'test'
  }, userCookie);
  assert.equal(enrolled.status, 200);

  const sessionToken = userCookie.slice('MAO_SESSION='.length);
  const session = ctx.store.getMaoAccountSession(await sha256Hex(sessionToken));
  assert.ok(session?.session_id);
  const originalLastSeen = ctx.query(
    'SELECT last_seen_at FROM devices WHERE id = ?',
    device.deviceId
  )[0].last_seen_at;
  ctx.store.exec(
    'UPDATE devices SET last_seen_at = ? WHERE id = ?',
    ctx.now() - 600000,
    device.deviceId
  );
  const staleLastSeen = ctx.query(
    'SELECT last_seen_at FROM devices WHERE id = ?',
    device.deviceId
  )[0].last_seen_at;
  assert.notEqual(staleLastSeen, originalLastSeen);

  // Simulate a concurrent "log out this session" action immediately before
  // the final synchronous authorization gate in device authentication.
  const originalGuard = ctx.store.isActiveAccountDeviceSession.bind(ctx.store);
  let finalGuardCalled = false;
  ctx.store.isActiveAccountDeviceSession = (userId, deviceId, sessionId, now) => {
    finalGuardCalled = true;
    assert.equal(sessionId, session.session_id);
    ctx.store.revokeMaoAccountSession(sessionId, now);
    return originalGuard(userId, deviceId, sessionId, now);
  };

  const denied = await ctx.fetchTo('/api/autonomy/global', {
    headers: {
      cookie: userCookie,
      'x-device-auth': device.deviceId + '.' + device.secret,
      'x-mao-account-context': accountId
    }
  });
  const result = await json(denied);
  assert.equal(finalGuardCalled, true);
  assert.equal(result.status, 401);
  assert.equal(result.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_account_sessions WHERE id = ?', session.session_id)[0].revoked_at,
    null,
    '测试必须确实在最终检查前撤销了原会话'
  );
  assert.equal(
    ctx.query('SELECT revoked_at FROM mao_account_sessions WHERE id = ?', otherSession.session_id)[0].revoked_at,
    null,
    '同账号的另一条会话仍然有效，不能替代本请求使用的已撤销会话'
  );
  assert.equal(
    ctx.query('SELECT revoked_at FROM devices WHERE id = ?', device.deviceId)[0].revoked_at,
    null,
    '撤销登录会话不能顺带撤销设备凭据'
  );
  assert.equal(
    ctx.query('SELECT last_seen_at FROM devices WHERE id = ?', device.deviceId)[0].last_seen_at,
    staleLastSeen,
    '请求已被 Session 末端校验拒绝时，不能继续触碰设备 last-seen'
  );
});


test('管理员会话在停用请求提交前被撤销时，账号状态不得改变', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'admin-session-race',
      password: 'admin-session-race-password-123',
      confirmPassword: 'admin-session-race-password-123'
    }
  });
  assert.equal(admin.status, 200);
  const adminCookie = cookieFrom(admin);
  const adminSession = ctx.store.getMaoAccountSession(
    await sha256Hex(adminCookie.slice('MAO_SESSION='.length))
  );

  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'admin-race-target',
      password: 'admin-race-target-password-123',
      confirmPassword: 'admin-race-target-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;

  const originalSetState = ctx.store.setMaoAccountState.bind(ctx.store);
  let revokedAtCommitBoundary = false;
  ctx.store.setMaoAccountState = options => {
    revokedAtCommitBoundary = true;
    ctx.store.revokeMaoAccountSession(options.actorSessionId, options.now);
    return originalSetState(options);
  };

  const response = await post(ctx, '/api/admin/accounts/' + targetId + '/action', {
    action: 'disable',
    reason: 'should not be committed after admin session revocation'
  }, adminCookie);
  assert.equal(revokedAtCommitBoundary, true);
  assert.equal(response.status, 403);
  assert.equal(response.payload.error.code, 'ADMIN_SESSION_REVOKED');
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', targetId)[0].status, 'pending_invite');
  assert.equal(Number(ctx.query(
    "SELECT COUNT(*) AS total FROM mao_account_audit WHERE target_account_id = ? AND action = 'disable'",
    targetId
  )[0].total), 0, '会话撤销后不能留下账号停用或审计写入');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_account_sessions WHERE id = ?', adminSession.session_id)[0].revoked_at,
    null
  );
});

test('普通账号在核销邀请码途中退出时，邀请码不能被消耗且授权不能生效', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'redeem-session-admin',
      password: 'redeem-session-admin-password-123',
      confirmPassword: 'redeem-session-admin-password-123'
    }
  });
  const adminCookie = cookieFrom(admin);
  const target = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'redeem-session-target',
      password: 'redeem-session-target-password-123',
      confirmPassword: 'redeem-session-target-password-123'
    }
  });
  assert.equal(target.status, 201);
  const targetId = target.payload.account.id;
  const invite = await post(ctx, '/api/admin/invites', {
    targetAccountId: targetId
  }, adminCookie);
  assert.equal(invite.status, 201);
  const login = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'redeem-session-target',
      password: 'redeem-session-target-password-123'
    }
  });
  const userCookie = cookieFrom(login);
  const userSession = ctx.store.getMaoAccountSession(
    await sha256Hex(userCookie.slice('MAO_SESSION='.length))
  );

  const originalRedeem = ctx.store.redeemMaoInvite.bind(ctx.store);
  let revokedAtRedeemBoundary = false;
  ctx.store.redeemMaoInvite = options => {
    revokedAtRedeemBoundary = true;
    ctx.store.revokeMaoAccountSession(options.sessionId, options.now);
    return originalRedeem(options);
  };

  const response = await post(ctx, '/api/accounts/invites/redeem', {
    inviteCode: invite.payload.invite.code
  }, userCookie);
  assert.equal(revokedAtRedeemBoundary, true);
  assert.equal(response.status, 401);
  assert.equal(response.payload.error.code, 'ACCOUNT_SESSION_REQUIRED');
  assert.equal(ctx.query('SELECT status FROM mao_accounts WHERE id = ?', targetId)[0].status, 'pending_invite');
  assert.equal(Number(ctx.query(
    'SELECT used_count FROM mao_invite_codes WHERE id = ?',
    invite.payload.invite.id
  )[0].used_count), 0, '已退出会话不能消耗一次性邀请码');
  assert.notEqual(
    ctx.query('SELECT revoked_at FROM mao_account_sessions WHERE id = ?', userSession.session_id)[0].revoked_at,
    null
  );
});


test('管理员会话在生成或撤销邀请码提交前失效时不得写入邀请码记录', async () => {
  const db = openTestDb();
  const ctx = setupTestStore(db, { MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET });
  const admin = await ctx.fetchTo('/api/admin/bootstrap', {
    method: 'POST',
    body: {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: 'invite-admin-race',
      password: 'invite-admin-race-password-123',
      confirmPassword: 'invite-admin-race-password-123'
    }
  });
  assert.equal(admin.status, 200);
  let adminCookie = cookieFrom(admin);
  let adminSession = ctx.store.getMaoAccountSession(
    await sha256Hex(adminCookie.slice('MAO_SESSION='.length))
  );

  const createTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-create-target',
      password: 'invite-create-target-password-123',
      confirmPassword: 'invite-create-target-password-123'
    }
  });
  const revokeTarget = await ctx.asJson('/api/accounts/register', {
    method: 'POST',
    body: {
      username: 'invite-revoke-target',
      password: 'invite-revoke-target-password-123',
      confirmPassword: 'invite-revoke-target-password-123'
    }
  });
  assert.equal(createTarget.status, 201);
  assert.equal(revokeTarget.status, 201);

  const existingInvite = await post(ctx, '/api/admin/invites', {
    targetAccountId: revokeTarget.payload.account.id
  }, adminCookie);
  assert.equal(existingInvite.status, 201);

  const originalInsertInvite = ctx.store.insertMaoInvite.bind(ctx.store);
  let revokedDuringCreate = false;
  ctx.store.insertMaoInvite = invite => {
    revokedDuringCreate = true;
    ctx.store.revokeMaoAccountSession(invite.actorSessionId, invite.now);
    return originalInsertInvite(invite);
  };
  const createAttempt = await post(ctx, '/api/admin/invites', {
    targetAccountId: createTarget.payload.account.id
  }, adminCookie);
  assert.equal(revokedDuringCreate, true);
  assert.equal(createAttempt.status, 403);
  assert.equal(createAttempt.payload.error.code, 'ADMIN_SESSION_REVOKED');
  assert.equal(Number(ctx.query(
    'SELECT COUNT(*) AS total FROM mao_invite_codes WHERE target_account_id = ?',
    createTarget.payload.account.id
  )[0].total), 0, '管理员 Session 失效后不能创建邀请码');

  const relogin = await ctx.fetchTo('/api/accounts/login', {
    method: 'POST',
    body: {
      identifier: 'invite-admin-race',
      password: 'invite-admin-race-password-123'
    }
  });
  assert.equal(relogin.status, 200);
  adminCookie = cookieFrom(relogin);
  adminSession = ctx.store.getMaoAccountSession(
    await sha256Hex(adminCookie.slice('MAO_SESSION='.length))
  );

  const originalRevokeInvite = ctx.store.revokeMaoInvite.bind(ctx.store);
  let revokedDuringRevoke = false;
  ctx.store.revokeMaoInvite = (inviteId, actorAccountId, now, actorSessionId) => {
    revokedDuringRevoke = true;
    ctx.store.revokeMaoAccountSession(actorSessionId, now);
    return originalRevokeInvite(inviteId, actorAccountId, now, actorSessionId);
  };
  const revokeAttempt = await post(
    ctx,
    '/api/admin/invites/' + encodeURIComponent(existingInvite.payload.invite.id) + '/revoke',
    {},
    adminCookie
  );
  assert.equal(revokedDuringRevoke, true);
  assert.equal(revokeAttempt.status, 403);
  assert.equal(revokeAttempt.payload.error.code, 'ADMIN_SESSION_REVOKED');
  assert.equal(ctx.query(
    'SELECT revoked_at FROM mao_invite_codes WHERE id = ?',
    existingInvite.payload.invite.id
  )[0].revoked_at, null, '管理员 Session 失效后不能撤销邀请码记录');
  assert.equal(
    ctx.query('SELECT revoked_at FROM mao_account_sessions WHERE id = ?', adminSession.session_id)[0].revoked_at != null,
    true
  );
});
