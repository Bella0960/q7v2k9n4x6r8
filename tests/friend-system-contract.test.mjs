import test from 'node:test';
import assert from 'node:assert/strict';
import { randomToken } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

function makeAccount(label) {
  return {
    userId: 'u_' + randomToken(16),
    secret: randomToken(32),
    displayName: label
  };
}

async function register(ctx, account, ip) {
  return ctx.asJson('/api/accounts/register', {
    method: 'POST',
    ip,
    body: {
      userId: account.userId,
      secret: account.secret,
      displayName: account.displayName
    }
  });
}

function auth(account) {
  return { 'x-maomao-account': account.userId + '.' + account.secret };
}

function asAccount(ctx, account, path, options = {}) {
  return ctx.asJson(path, {
    ...options,
    headers: { ...auth(account), ...(options.headers || {}) }
  });
}

test('真人账号创建、重复连接与公开资料不会泄露账号密钥', async () => {
  const ctx = setupTestStore(openTestDb());
  const alice = makeAccount('Alice');

  const created = await register(ctx, alice, '198.51.100.10');
  assert.equal(created.status, 200);
  assert.equal(created.payload.account.userId, alice.userId);
  assert.equal(created.payload.account.displayName, 'Alice');
  assert.equal(created.payload.created, true);

  const stored = ctx.query(
    'SELECT secret_hash, display_name FROM friend_accounts WHERE user_id = ?',
    alice.userId
  )[0];
  assert.ok(stored);
  assert.notEqual(stored.secret_hash, alice.secret, '数据库只存哈希，不存明文凭据');

  const repeated = await register(ctx, { ...alice, displayName: 'Alice Updated' }, '198.51.100.10');
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.created, false);
  assert.equal(repeated.payload.account.displayName, 'Alice Updated');

  const me = await asAccount(ctx, alice, '/api/accounts/me');
  assert.equal(me.status, 200);
  assert.equal(me.payload.account.userId, alice.userId);
  assert.equal(JSON.stringify(me.payload).includes(alice.secret), false);

  const publicProfile = await ctx.asJson('/api/friend-profiles/' + alice.userId);
  assert.equal(publicProfile.status, 200);
  assert.deepEqual(publicProfile.payload.profile, {
    userId: alice.userId,
    displayName: 'Alice Updated'
  });

  const wrongSecret = await ctx.asJson('/api/accounts/me', {
    headers: { 'x-maomao-account': alice.userId + '.' + randomToken(32) }
  });
  assert.equal(wrongSecret.status, 401);

  const anonymous = await ctx.asJson('/api/friends');
  assert.equal(anonymous.status, 401);
});

test('好友申请必须由接收方同意，支持重复提交、拒绝、删除和账号隔离', async () => {
  const ctx = setupTestStore(openTestDb());
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  const carol = makeAccount('Carol');

  assert.equal((await register(ctx, alice, '198.51.100.11')).status, 200);
  assert.equal((await register(ctx, bob, '198.51.100.12')).status, 200);
  assert.equal((await register(ctx, carol, '198.51.100.13')).status, 200);

  const selfRequest = await asAccount(ctx, alice, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: alice.userId }
  });
  assert.equal(selfRequest.status, 400);
  assert.equal(selfRequest.payload.error.code, 'CANNOT_ADD_SELF');

  const sent = await asAccount(ctx, alice, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: bob.userId, message: '一起在 MAOMAO 聊天吧' }
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.payload.request.status, 'pending');
  assert.equal(sent.payload.duplicate, false);
  const requestId = sent.payload.request.id;

  const duplicate = await asAccount(ctx, alice, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: bob.userId }
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(duplicate.payload.request.id, requestId);

  const reverseDuplicate = await asAccount(ctx, bob, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: alice.userId }
  });
  assert.equal(reverseDuplicate.status, 409);
  assert.equal(reverseDuplicate.payload.error.code, 'INCOMING_REQUEST_EXISTS');

  const bobInbox = await asAccount(ctx, bob, '/api/friend-requests');
  assert.equal(bobInbox.status, 200);
  assert.equal(bobInbox.payload.requests.length, 1);
  assert.equal(bobInbox.payload.requests[0].direction, 'incoming');
  assert.equal(bobInbox.payload.requests[0].requesterName, 'Alice');

  const aliceOutbox = await asAccount(ctx, alice, '/api/friend-requests');
  assert.equal(aliceOutbox.payload.requests[0].direction, 'outgoing');

  const unauthorizedAccept = await asAccount(ctx, carol, '/api/friend-requests/' + requestId + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(unauthorizedAccept.status, 404);

  const beforeAccept = await asAccount(ctx, alice, '/api/friends');
  assert.equal(beforeAccept.payload.friends.length, 0);

  const accepted = await asAccount(ctx, bob, '/api/friend-requests/' + requestId + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.request.status, 'accepted');
  assert.equal(accepted.payload.friendshipCreated, true);
  assert.equal(accepted.payload.duplicate, false);

  const acceptedRetry = await asAccount(ctx, bob, '/api/friend-requests/' + requestId + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(acceptedRetry.status, 200);
  assert.equal(acceptedRetry.payload.request.status, 'accepted');
  assert.equal(acceptedRetry.payload.duplicate, true);
  assert.equal(acceptedRetry.payload.friendshipCreated, false);

  const rejectAfterAccept = await asAccount(ctx, bob, '/api/friend-requests/' + requestId + '/reject', {
    method: 'POST',
    body: {}
  });
  assert.equal(rejectAfterAccept.status, 404);

  const aliceFriends = await asAccount(ctx, alice, '/api/friends');
  const bobFriends = await asAccount(ctx, bob, '/api/friends');
  assert.deepEqual(aliceFriends.payload.friends.map(item => item.userId), [bob.userId]);
  assert.deepEqual(bobFriends.payload.friends.map(item => item.userId), [alice.userId]);

  const alreadyFriends = await asAccount(ctx, alice, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: bob.userId }
  });
  assert.equal(alreadyFriends.status, 409);
  assert.equal(alreadyFriends.payload.error.code, 'ALREADY_FRIENDS');

  const removed = await asAccount(ctx, alice, '/api/friends/' + bob.userId, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.payload.removed, true);
  assert.equal((await asAccount(ctx, bob, '/api/friends')).payload.friends.length, 0);

  // A delayed retry of the old acceptance must not recreate a later-deleted friendship.
  const staleAcceptedRetry = await asAccount(ctx, bob, '/api/friend-requests/' + requestId + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(staleAcceptedRetry.status, 200);
  assert.equal(staleAcceptedRetry.payload.duplicate, true);
  assert.equal((await asAccount(ctx, bob, '/api/friends')).payload.friends.length, 0);

  const carolRequest = await asAccount(ctx, carol, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: bob.userId }
  });
  assert.equal(carolRequest.status, 200);
  const bobRequests = await asAccount(ctx, bob, '/api/friend-requests');
  const incomingCarol = bobRequests.payload.requests.find(item => item.requesterId === carol.userId);
  assert.ok(incomingCarol);

  const rejected = await asAccount(ctx, bob, '/api/friend-requests/' + incomingCarol.id + '/reject', {
    method: 'POST',
    body: {}
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.request.status, 'rejected');
  assert.equal(rejected.payload.duplicate, false);
  const rejectedRetry = await asAccount(ctx, bob, '/api/friend-requests/' + incomingCarol.id + '/reject', {
    method: 'POST',
    body: {}
  });
  assert.equal(rejectedRetry.status, 200);
  assert.equal(rejectedRetry.payload.duplicate, true);
  const acceptAfterReject = await asAccount(ctx, bob, '/api/friend-requests/' + incomingCarol.id + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(acceptAfterReject.status, 404);
  assert.equal((await asAccount(ctx, bob, '/api/friends')).payload.friends.length, 0);
  assert.equal((await asAccount(ctx, carol, '/api/friends')).payload.friends.length, 0);
});


test('双方同时发起好友申请时只保留一条待处理关系', async () => {
  const ctx = setupTestStore(openTestDb());
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  assert.equal((await register(ctx, alice, '198.51.100.81')).status, 200);
  assert.equal((await register(ctx, bob, '198.51.100.82')).status, 200);

  const results = await Promise.all([
    asAccount(ctx, alice, '/api/friend-requests', {
      method: 'POST',
      body: { targetUserId: bob.userId }
    }),
    asAccount(ctx, bob, '/api/friend-requests', {
      method: 'POST',
      body: { targetUserId: alice.userId }
    })
  ]);

  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const conflict = results.find(result => result.status === 409);
  assert.equal(conflict.payload.error.code, 'INCOMING_REQUEST_EXISTS');

  const pending = ctx.query(
    `SELECT requester_id, recipient_id
     FROM friend_requests
     WHERE status = 'pending'
       AND (
         (requester_id = ? AND recipient_id = ?)
         OR (requester_id = ? AND recipient_id = ?)
       )`,
    alice.userId,
    bob.userId,
    bob.userId,
    alice.userId
  );
  assert.equal(pending.length, 1);
});
