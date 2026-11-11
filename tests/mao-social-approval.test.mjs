import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createMaoSocial } from '../worker/lib/mao-social.js';
import { SQL } from '../worker/migrations/0017_mao_social.js';

const alice = 'MAO-AAAAAAAAAAAA';
const bob = 'MAO-BBBBBBBBBBBB';
const carol = 'MAO-CCCCCCCCCCCC';
const founder = 'MAO-ZZZZZZZZZZZZ';
const now = 1794445200000;
const profile = [
  [alice, 'Alice', 'user', 'active', now],
  [bob, 'Bob', 'user', 'active', now],
  [carol, 'Carol', 'user', 'active', now],
  [founder, 'Founder', 'super_admin', 'active', now]
];

function setup({ enabled = true, nowFn = () => now } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("CREATE TABLE mao_accounts " +
    "(id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, " +
    "status TEXT NOT NULL, authorized_at INTEGER)");
  db.exec("CREATE TABLE mao_account_sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, " +
    "expires_at INTEGER NOT NULL, revoked_at INTEGER)");
  db.exec("CREATE TABLE mao_account_audit (id TEXT PRIMARY KEY,actor_account_id TEXT, " +
    "target_account_id TEXT,action TEXT,detail_json TEXT,created_at INTEGER)");
  for (const row of profile) {
    db.prepare("INSERT INTO mao_accounts VALUES(?,?,?,?,?)").run(...row);
  }
  const sessions = new Map([
    ['alice-session', { account_id: alice, session_id: 'alice-session', status: 'active', role: 'user', authorized_at: now }],
    ['bob-session', { account_id: bob, session_id: 'bob-session', status: 'active', role: 'user', authorized_at: now }],
    ['carol-session', { account_id: carol, session_id: 'carol-session', status: 'active', role: 'user', authorized_at: now }],
    ['founder-session', { account_id: founder, session_id: 'founder-session', status: 'active', role: 'super_admin', authorized_at: now }]
  ]);
  for (const session of sessions.values()) {
    db.prepare("INSERT INTO mao_account_sessions VALUES(?,?,?,NULL)")
      .run(session.session_id, session.account_id, now + 86400000);
  }
  db.exec(SQL);
  const exec = (sql, ...values) => {
    const statement = db.prepare(sql);
    if (/^\s*SELECT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return statement.all(...values);
    statement.run(...values);
    return [];
  };
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const store = {
    exec, transaction,
    isActiveMaoSuperAdminSession(id, sid, at) {
      return !!exec("SELECT s.id FROM mao_account_sessions s JOIN mao_accounts a ON a.id=s.account_id " +
        "WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? " +
        "AND a.role='super_admin' AND a.status='active'", sid, id, at)[0];
    }
  };
  const accountAuth = {
    async getAuthenticatedAccount(request) {
      const session = sessions.get(request.headers.get('x-test-session'));
      if (!session) return null;
      const account = exec("SELECT role,status,authorized_at FROM mao_accounts WHERE id=?",session.account_id)[0];
      return account ? {...session,...account} : null;
    }
  };
  const service = createMaoSocial({ store, accountAuth,
    env: { MAO_SOCIAL_ENABLED: enabled ? 'true' : 'false' }, now: nowFn });
  async function call(who, path, method = 'GET', body) {
    const request = new Request('https://mao.example' + path, {
      method,
      headers: { 'x-test-session': who, ...(body ? {'content-type':'application/json'} : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    try {
      const response = await service.handle(request, path.split('?')[0], method);
      return { status: response.status, body: await response.json() };
    } catch (error) {
      return { status: error.status || 500, code: error.code, message: error.message };
    }
  }
  return { db, exec, sessions, service, call, close: () => db.close() };
}

async function invite(ctx, from, to, requestId) {
  const code = await ctx.call(to, '/api/social/friend-codes', 'POST');
  assert.equal(code.status, 200, JSON.stringify(code));
  assert.match(code.body.code, /^[a-f0-9]{64}$/);
  const applied = await ctx.call(from, '/api/social/friend-requests', 'POST',
    { requestId, code: code.body.code, note: 'Hello' });
  return { code, applied };
}

test('MAO social migrations apply to real SQLite without a D1 or duplicate account table', () => {
  const ctx = setup();
  try {
    const tableNames = ctx.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mao_social_%'");
    assert.equal(tableNames.length, 5);
    assert.equal(ctx.exec("SELECT COUNT(*) AS n FROM mao_accounts")[0].n, 4);
    assert.equal(ctx.exec("SELECT COUNT(*) AS n FROM mao_social_friends")[0].n, 0);
  } finally { ctx.close(); }
});

test('friendship requires peer consent AND 001 approval before either chat direction works', async () => {
  const ctx = setup();
  try {
    const id = 'friend_application_0001';
    const { code, applied } = await invite(ctx, 'alice-session', 'bob-session', id);
    assert.equal(code.body.ownerAccountId, bob);
    assert.equal(applied.body.request.status, 'pending_peer');
    assert.equal((await ctx.call('alice-session', '/api/social/friends')).body.friends.length, 0);
    assert.equal((await ctx.call('alice-session',
      '/api/social/chats/' + bob + '/messages')).code, 'SOCIAL_NOT_APPROVED');
    assert.equal((await ctx.call('bob-session',
      '/api/social/chats/' + alice + '/messages', 'POST',
      { clientMessageId:'pre_approval_msg', text:'Not yet' })).code, 'SOCIAL_NOT_APPROVED');
    const adminEarly = await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    assert.equal(adminEarly.code, 'SOCIAL_NOT_AWAITING_ADMIN');
    const consent = await ctx.call('bob-session', '/api/social/friend-requests/' + id + '/accept', 'POST');
    assert.equal(consent.body.request.status, 'pending_admin');
    assert.equal((await ctx.call('alice-session', '/api/social/friends')).body.friends.length, 0);
    const denied = await ctx.call('alice-session',
      '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    assert.equal(denied.code, 'SOCIAL_ADMIN_ONLY');
    const queue = await ctx.call('founder-session', '/api/admin/social/friend-approvals');
    assert.equal(queue.body.approvals.length, 1);
    assert.equal(queue.body.approvals[0].requesterId, alice);
    const reviewed = await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    assert.equal(reviewed.body.request.status, 'approved');
    assert.equal((await ctx.call('alice-session', '/api/social/friends')).body.friends[0].id, bob);
    assert.equal((await ctx.call('bob-session', '/api/social/friends')).body.friends[0].id, alice);
    assert.equal(ctx.exec("SELECT COUNT(*) AS n FROM mao_account_audit WHERE action='social_friend_approved'")[0].n, 1);
  } finally { ctx.close(); }
});

test('two account message roundtrip, idempotency and private conversation scope', async () => {
  const ctx = setup();
  try {
    const id = 'request_msg_0001';
    assert.equal((await invite(ctx,'alice-session','bob-session',id)).applied.status, 200);
    await ctx.call('bob-session', '/api/social/friend-requests/' + id + '/accept', 'POST');
    await ctx.call('founder-session', '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    const pathAB = '/api/social/chats/' + bob + '/messages';
    const sent = await ctx.call('alice-session', pathAB, 'POST', {
      clientMessageId: 'message_device_a_001', text: 'Hello from A'
    });
    assert.equal(sent.body.message.senderId, alice);
    const replay = await ctx.call('alice-session', pathAB, 'POST', {
      clientMessageId: 'message_device_a_001', text: 'Hello from A'
    });
    assert.equal(replay.body.replay, true);
    assert.equal(replay.body.message.id, sent.body.message.id);
    const forgedRetry = await ctx.call('alice-session', pathAB, 'POST', {
      clientMessageId: 'message_device_a_001', text: 'Changed'
    });
    assert.equal(forgedRetry.code, 'SOCIAL_MESSAGE_ID_REUSED');
    const received = await ctx.call('bob-session','/api/social/chats/' + alice + '/messages');
    assert.equal(received.body.messages.length, 1);
    assert.equal(received.body.messages[0].text, 'Hello from A');
    assert.equal((await ctx.call('carol-session','/api/social/chats/' + alice + '/messages')).code,
      'SOCIAL_NOT_APPROVED');
    const reply = await ctx.call('bob-session','/api/social/chats/' + alice + '/messages','POST', {
      clientMessageId: 'message_device_b_001',text: 'Hello from B'
    });
    assert.equal(reply.body.message.senderId, bob);
    assert.equal((await ctx.call('alice-session',pathAB)).body.messages.length, 2);
  } finally { ctx.close(); }
});

test('admin reject, block, remove, account disable and session revocation all fail closed', async () => {
  const ctx = setup();
  try {
    const id = 'request_reject_0001';
    await invite(ctx,'alice-session','carol-session',id);
    await ctx.call('carol-session','/api/social/friend-requests/' + id + '/accept','POST');
    const reject = await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + id + '/reject','POST');
    assert.equal(reject.body.request.status, 'rejected');
    assert.equal((await ctx.call('alice-session','/api/social/chats/' + carol + '/messages')).code,
      'SOCIAL_NOT_APPROVED');
    const requestId = 'request_block_0001';
    await invite(ctx,'alice-session','bob-session',requestId);
    await ctx.call('bob-session','/api/social/friend-requests/' + requestId + '/accept','POST');
    await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + requestId + '/approve','POST');
    await ctx.call('alice-session','/api/social/friends/' + bob + '/block','POST');
    assert.equal((await ctx.call('bob-session','/api/social/chats/' + alice + '/messages')).code,'SOCIAL_BLOCKED');
    await ctx.call('alice-session','/api/social/friends/' + bob + '/block','DELETE');
    assert.equal((await ctx.call('alice-session','/api/social/chats/' + bob + '/messages')).code,
      'SOCIAL_NOT_APPROVED');
    ctx.exec("UPDATE mao_accounts SET status='disabled' WHERE id=?", bob);
    assert.equal((await ctx.call('alice-session','/api/social/chats/' + bob + '/messages')).code,
      'SOCIAL_ACCOUNT_NOT_ACTIVE');
    ctx.exec("UPDATE mao_account_sessions SET revoked_at=? WHERE id=?",now,'alice-session');
    assert.equal((await ctx.call('alice-session','/api/social/friend-codes','POST')).code,
      'SOCIAL_SESSION_EXPIRED');
    ctx.exec("UPDATE mao_account_sessions SET revoked_at=? WHERE id=?",now,'founder-session');
    assert.equal((await ctx.call('founder-session','/api/admin/social/friend-approvals')).code,
      'SOCIAL_ADMIN_ONLY');
  } finally { ctx.close(); }
});

test('no feature opt-in never exposes social endpoints', async () => {
  const ctx = setup({ enabled: false });
  try {
    const disabled = await ctx.call('alice-session','/api/social/friend-codes','POST');
    assert.equal(disabled.status, 503);
    assert.equal(disabled.code, 'SOCIAL_NOT_ENABLED');
  } finally { ctx.close(); }
});

test('integration keeps MAO account identity, origin checks and AI chat isolated', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const app = fs.readFileSync(path.join(root, 'worker/lib/app.js'), 'utf8');
  const social = fs.readFileSync(path.join(root, 'worker/lib/mao-social.js'), 'utf8');
  const contacts = fs.readFileSync(path.join(root, 'chat/contacts/contacts.html'), 'utf8');
  const mobile = fs.readFileSync(path.join(root, 'chat/contacts/real-friends.html'), 'utf8');
  const migrations = fs.readFileSync(path.join(root, 'worker/lib/migrations.js'), 'utf8');
  assert.match(app, /assertSameOriginMutation\(request\);[\s\S]*?await assertAccountPageContext\(request, path\);[\s\S]*?await accountAuth.handle\(request, path, method\);[\s\S]*?await maoSocial.handle\(request, path, method\)/);
  assert.match(social, /MAO_SOCIAL_ENABLED !== 'true'/);
  assert.doesNotMatch(social, /REAL_USER_AUTH_ENABLED|REAL_USER_FRIENDS_ENABLED|D1|real_user_sessions/);
  assert.match(migrations, /0017_mao_social/);
  assert.match(contacts, /href="\.\/real-friends\.html"/);
  assert.match(mobile, /\/api\/accounts\/me/);
  assert.match(mobile, /if\(authContext\)headers\['X-MAO-Account-Context'\]=authContext;/);
  assert.match(mobile, /var session=await api\('\/api\/accounts\/me'\)/);
  assert.match(mobile, /管理员审批结果不明确/);
  assert.match(mobile, /消息已发送，但聊天记录尚未刷新/);
  assert.match(mobile, /\/api\/admin\/social\/friend-approvals/);
  assert.match(mobile, /\/api\/social\/chats\//);
  assert.doesNotMatch(mobile, /\/api\/real-user-chat|\/wallet\/|red.packet|transferMoney/);
  assert.match(mobile, /make\('div',m\.text/);
  assert.doesNotMatch(mobile, /innerHTML\s*=\s*m\.text/);
});

test('one-time friend codes, stable retry id and message flood protection', async () => {
  const ctx = setup();
  try {
    const requestId = 'request_onetime_0001';
    const inviteCode = await ctx.call('bob-session','/api/social/friend-codes','POST');
    assert.equal(inviteCode.status,200);
    const body = {requestId,code:inviteCode.body.code,note:'Hello'};
    const first = await ctx.call('alice-session','/api/social/friend-requests','POST',body);
    assert.equal(first.body.request.status,'pending_peer');
    const retry = await ctx.call('alice-session','/api/social/friend-requests','POST',body);
    assert.equal(retry.body.replay,true);
    assert.equal(retry.body.request.id,requestId);
    const alteredNote = await ctx.call('alice-session','/api/social/friend-requests','POST',
      {...body,note:'Different text'});
    assert.equal(alteredNote.code,'SOCIAL_ID_REUSED');
    const alteredCode = await ctx.call('alice-session','/api/social/friend-requests','POST',
      {...body,code:'c'.repeat(64)});
    assert.equal(alteredCode.code,'SOCIAL_ID_REUSED');
    const stolen = await ctx.call('carol-session','/api/social/friend-requests','POST',
      {requestId:'request_stolen_0001',code:inviteCode.body.code});
    assert.equal(stolen.code,'SOCIAL_CODE_EXPIRED');
    await ctx.call('bob-session','/api/social/friend-requests/'+requestId+'/accept','POST');
    await ctx.call('founder-session','/api/admin/social/friend-approvals/'+requestId+'/approve','POST');
    for(let i=0;i<60;i++){
      const response = await ctx.call('alice-session','/api/social/chats/'+bob+'/messages','POST',
        {clientMessageId:'rate_limit_msg_'+String(i).padStart(4,'0'),text:'Hello '+i});
      assert.equal(response.status,200,'unexpected limit at '+i+': '+JSON.stringify(response));
    }
    const limited = await ctx.call('alice-session','/api/social/chats/'+bob+'/messages','POST',
      {clientMessageId:'rate_limit_msg_0060',text:'Extra'});
    assert.equal(limited.code,'SOCIAL_MESSAGE_RATE_LIMIT');
    const legitimateReplay = await ctx.call('alice-session','/api/social/chats/'+bob+'/messages','POST',
      {clientMessageId:'rate_limit_msg_0000',text:'Hello 0'});
    assert.equal(legitimateReplay.body.replay,true);
    assert.equal(ctx.exec("SELECT COUNT(*) AS n FROM mao_social_messages")[0].n,60);
  } finally {ctx.close();}
});


test('late session expiration cannot write a message after an async body read', async () => {
  let clock = now;
  const ctx = setup({ nowFn: () => clock });
  try {
    const id = 'late_expiry_0001';
    await invite(ctx, 'alice-session', 'bob-session', id);
    await ctx.call('bob-session', '/api/social/friend-requests/' + id + '/accept', 'POST');
    await ctx.call('founder-session', '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    const route = '/api/social/chats/' + bob + '/messages';
    const message = new Request('https://mao.example' + route, {
      method: 'POST',
      headers: { 'x-test-session': 'alice-session', 'content-type': 'application/json' },
      body: JSON.stringify({ clientMessageId: 'expiry_msg_0001', text: 'Must be rejected' })
    });
    const originalText = message.text.bind(message);
    Object.defineProperty(message, 'text', { value: async () => {
      const body = await originalText();
      clock = now + 86400001;
      return body;
    } });
    await assert.rejects(ctx.service.handle(message, route, 'POST'),
      error => error.code === 'SOCIAL_SESSION_EXPIRED');
    assert.equal(ctx.exec('SELECT COUNT(*) AS n FROM mao_social_messages')[0].n, 0);
  } finally { ctx.close(); }
});

test('revoked MAO session cannot read even friend lists or pending applications', async () => {
  const ctx = setup();
  try {
    await invite(ctx, 'alice-session', 'bob-session', 'revoked_read_0001');
    ctx.exec('UPDATE mao_account_sessions SET revoked_at = ? WHERE id = ?', now, 'alice-session');
    const inbox = await ctx.call('alice-session', '/api/social/friend-requests?direction=outgoing');
    const friends = await ctx.call('alice-session', '/api/social/friends');
    assert.equal(inbox.code, 'SOCIAL_SESSION_EXPIRED');
    assert.equal(friends.code, 'SOCIAL_SESSION_EXPIRED');
  } finally { ctx.close(); }
});

test('a new 001-approved friendship cannot reopen chat history from a removed relationship', async () => {
  const ctx = setup();
  try {
    const firstId = 'relation_first_0001';
    await invite(ctx, 'alice-session', 'bob-session', firstId);
    await ctx.call('bob-session', '/api/social/friend-requests/' + firstId + '/accept', 'POST');
    await ctx.call('founder-session', '/api/admin/social/friend-approvals/' + firstId + '/approve', 'POST');
    const pathAB = '/api/social/chats/' + bob + '/messages';
    const oldPayload = { clientMessageId: 'previous_relation_message_001', text: 'Previous relationship' };
    assert.equal((await ctx.call('alice-session', pathAB, 'POST', oldPayload)).status, 200);
    assert.equal((await ctx.call('bob-session', '/api/social/chats/' + alice + '/messages')).body.messages.length, 1);
    assert.equal((await ctx.call('alice-session', '/api/social/friends/' + bob, 'DELETE')).body.removed, true);
    assert.equal((await ctx.call('bob-session', '/api/social/chats/' + alice + '/messages')).code, 'SOCIAL_NOT_APPROVED');

    const secondId = 'relation_second_0001';
    await invite(ctx, 'alice-session', 'bob-session', secondId);
    await ctx.call('bob-session', '/api/social/friend-requests/' + secondId + '/accept', 'POST');
    await ctx.call('founder-session', '/api/admin/social/friend-approvals/' + secondId + '/approve', 'POST');
    const reopened = await ctx.call('bob-session', '/api/social/chats/' + alice + '/messages');
    assert.deepEqual(reopened.body.messages, [], 'old relation messages must stay hidden');
    assert.equal((await ctx.call('alice-session', pathAB, 'POST', oldPayload)).code, 'SOCIAL_MESSAGE_ID_REUSED');
    const newer = await ctx.call('alice-session', pathAB, 'POST', {
      clientMessageId: 'new_relation_message_001', text: 'A new beginning'
    });
    assert.equal(newer.status, 200);
    const current = await ctx.call('bob-session', '/api/social/chats/' + alice + '/messages');
    assert.deepEqual(current.body.messages.map(m => m.text), ['A new beginning']);
    assert.equal(ctx.exec('SELECT COUNT(*) AS n FROM mao_social_messages')[0].n, 2,
      'old messages are retained but never exposed through the newer friendship');
  } finally { ctx.close(); }
});

test('admin audit write failure rolls back friend approval atomically', async () => {
  const ctx = setup();
  try {
    const id = 'audit_rollback_0001';
    await invite(ctx, 'alice-session', 'bob-session', id);
    await ctx.call('bob-session', '/api/social/friend-requests/' + id + '/accept', 'POST');
    ctx.exec("CREATE TRIGGER fail_social_audit BEFORE INSERT ON mao_account_audit " +
      "WHEN NEW.action = 'social_friend_approved' BEGIN SELECT RAISE(ABORT, 'audit_failed'); END");
    const denied = await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    assert.equal(denied.status, 500);
    assert.equal(ctx.exec('SELECT COUNT(*) AS n FROM mao_social_friends')[0].n, 0);
    assert.equal(ctx.exec('SELECT status FROM mao_social_requests WHERE id = ?', id)[0].status,
      'pending_admin');
    ctx.exec('DROP TRIGGER fail_social_audit');
    const retried = await ctx.call('founder-session',
      '/api/admin/social/friend-approvals/' + id + '/approve', 'POST');
    assert.equal(retried.body.request.status, 'approved');
    assert.equal(ctx.exec('SELECT COUNT(*) AS n FROM mao_social_friends')[0].n, 1);
    assert.equal(ctx.exec("SELECT COUNT(*) AS n FROM mao_account_audit WHERE action = 'social_friend_approved'")[0].n, 1);
  } finally { ctx.close(); }
});

test('release build retains the original whole-app gate before social acceptance', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'npm run test:release:gate && npm run test:social:approval');
  for (const suite of ['accounts', 'features', 'regressions']) {
    assert.ok(pkg.scripts['test:release:gate'].includes('test:release:' + suite));
  }
  assert.match(pkg.scripts['test:social:approval'], /tests\/mao-social-approval\.test\.mjs/);
  assert.match(pkg.scripts['test:social:approval'], /tests\/mao-social-mobile-runtime\.test\.mjs/);
});
