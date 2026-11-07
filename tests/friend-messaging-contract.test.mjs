import test from 'node:test';
import assert from 'node:assert/strict';
import { randomToken } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

const FIXED_NOW = 1_800_000_000_000;

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

function asAccount(ctx, account, path, options = {}) {
  return ctx.asJson(path, {
    ...options,
    headers: {
      'x-maomao-account': account.userId + '.' + account.secret,
      ...(options.headers || {})
    }
  });
}

async function makeFriends(ctx, requester, recipient) {
  const sent = await asAccount(ctx, requester, '/api/friend-requests', {
    method: 'POST',
    body: { targetUserId: recipient.userId }
  });
  assert.equal(sent.status, 200);
  const requestId = sent.payload.request.id;
  const accepted = await asAccount(ctx, recipient, '/api/friend-requests/' + requestId + '/accept', {
    method: 'POST',
    body: {}
  });
  assert.equal(accepted.status, 200);
}

function messageId() {
  return randomToken(18);
}

test('双方同意后可双向发送文字、读取新消息并用游标同步同毫秒消息', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  assert.equal((await register(ctx, alice, '198.51.100.41')).status, 200);
  assert.equal((await register(ctx, bob, '198.51.100.42')).status, 200);
  await makeFriends(ctx, alice, bob);

  const aliceClientId = messageId();
  const first = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: aliceClientId, body: '你好，终于能直接聊天了。' }
  });
  assert.equal(first.status, 200);
  assert.equal(first.payload.duplicate, false);
  assert.equal(first.payload.message.senderId, alice.userId);
  assert.equal(first.payload.message.recipientId, bob.userId);
  assert.equal(first.payload.message.body, '你好，终于能直接聊天了。');

  const retry = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: aliceClientId, body: '你好，终于能直接聊天了。' }
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.duplicate, true);
  assert.equal(retry.payload.message.id, first.payload.message.id);

  const reusedId = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: aliceClientId, body: '不同正文不可以复用同一个发送 ID' }
  });
  assert.equal(reusedId.status, 409);
  assert.equal(reusedId.payload.error.code, 'MESSAGE_IDEMPOTENCY_CONFLICT');

  const bobClientId = messageId();
  const second = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: bobClientId, body: '我收到啦。' }
  });
  assert.equal(second.status, 200);
  assert.ok(
    second.payload.message.createdAt > first.payload.message.createdAt,
    '即使测试时钟相同，服务端会为同一会话分配严格递增的消息游标'
  );

  const afterFirst = await asAccount(
    ctx,
    alice,
    '/api/friends/' + bob.userId + '/messages?after=' +
      encodeURIComponent(String(first.payload.message.createdAt) + '.' + first.payload.message.id)
  );
  assert.equal(afterFirst.status, 200);
  assert.deepEqual(afterFirst.payload.messages.map(item => item.body), ['我收到啦。']);
  assert.equal(afterFirst.payload.messages[0].id, second.payload.message.id);

  const aliceHistory = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages');
  const bobHistory = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages');
  assert.deepEqual(aliceHistory.payload.messages.map(item => item.body), ['你好，终于能直接聊天了。', '我收到啦。']);
  assert.deepEqual(bobHistory.payload.messages.map(item => item.body), ['你好，终于能直接聊天了。', '我收到啦。']);
});

test('好友消息只允许已互相同意的双方读取和发送；删除好友立即撤销访问', async () => {
  const ctx = setupTestStore(openTestDb());
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  const carol = makeAccount('Carol');
  assert.equal((await register(ctx, alice, '198.51.100.43')).status, 200);
  assert.equal((await register(ctx, bob, '198.51.100.44')).status, 200);
  assert.equal((await register(ctx, carol, '198.51.100.45')).status, 200);
  await makeFriends(ctx, alice, bob);

  const originalClientMessageId = messageId();
  const sent = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: originalClientMessageId, body: '只有好友能看见' }
  });
  assert.equal(sent.status, 200);

  const strangerRead = await asAccount(ctx, carol, '/api/friends/' + alice.userId + '/messages');
  assert.equal(strangerRead.status, 403);
  assert.equal(strangerRead.payload.error.code, 'NOT_FRIENDS');

  const strangerSend = await asAccount(ctx, carol, '/api/friends/' + alice.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '不允许发送' }
  });
  assert.equal(strangerSend.status, 403);

  const removed = await asAccount(ctx, bob, '/api/friends/' + alice.userId, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.payload.removed, true);

  const afterRemoveRead = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages');
  assert.equal(afterRemoveRead.status, 403);
  const retryAfterRemove = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: {
      clientMessageId: originalClientMessageId,
      body: '好友关系已删除'
    }
  });
  assert.equal(retryAfterRemove.status, 403);
  assert.equal(retryAfterRemove.payload.error.code, 'NOT_FRIENDS');
});

test('新消息与更早历史都能分批读取，游标分页不会漏行', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  await register(ctx, alice, '198.51.100.48');
  await register(ctx, bob, '198.51.100.49');
  await makeFriends(ctx, alice, bob);
  const path = '/api/friends/' + bob.userId + '/messages';

  const seed = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '分页起点' }
  });
  assert.equal(seed.status, 200);
  const seedCursor = String(seed.payload.message.createdAt) + '.' + seed.payload.message.id;

  for (let index = 0; index < 52; index += 1) {
    const sent = await asAccount(ctx, alice, path, {
      method: 'POST',
      body: { clientMessageId: messageId(), body: '分页消息 ' + index }
    });
    assert.equal(sent.status, 200);
  }

  const firstNewPage = await asAccount(
    ctx,
    bob,
    path + '?after=' + encodeURIComponent(seedCursor)
  );
  assert.equal(firstNewPage.status, 200);
  assert.equal(firstNewPage.payload.messages.length, 50);
  assert.equal(firstNewPage.payload.hasMore, true);
  assert.equal(firstNewPage.payload.messages[0].body, '分页消息 0');

  const secondNewPage = await asAccount(
    ctx,
    bob,
    path + '?after=' + encodeURIComponent(firstNewPage.payload.nextCursor)
  );
  assert.equal(secondNewPage.status, 200);
  assert.deepEqual(secondNewPage.payload.messages.map(item => item.body), ['分页消息 50', '分页消息 51']);
  assert.equal(secondNewPage.payload.hasMore, false);

  const latestPage = await asAccount(ctx, bob, path);
  assert.equal(latestPage.status, 200);
  assert.equal(latestPage.payload.messages.length, 50);
  assert.equal(latestPage.payload.messages[49].body, '分页消息 51');
  assert.equal(latestPage.payload.hasMore, true);

  const olderPage = await asAccount(
    ctx,
    bob,
    path + '?before=' + encodeURIComponent(latestPage.payload.olderCursor)
  );
  assert.equal(olderPage.status, 200);
  assert.deepEqual(olderPage.payload.messages.map(item => item.body), ['分页起点', '分页消息 0', '分页消息 1']);
  assert.equal(olderPage.payload.hasMore, false);
});

test('真人好友消息严格限制为非空纯文字，最多 2000 个 Unicode 字符', async () => {
  const ctx = setupTestStore(openTestDb());
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  await register(ctx, alice, '198.51.100.46');
  await register(ctx, bob, '198.51.100.47');
  await makeFriends(ctx, alice, bob);
  const path = '/api/friends/' + bob.userId + '/messages';

  const empty = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '   ' }
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.payload.error.code, 'EMPTY_FRIEND_MESSAGE');

  const objectBody = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: { text: '不是纯文字' } }
  });
  assert.equal(objectBody.status, 400);

  const attachment = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '文字', image: 'https://example.invalid/a.png' }
  });
  assert.equal(attachment.status, 400);

  const tooLong = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '🙂'.repeat(2001) }
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.payload.error.code, 'FRIEND_MESSAGE_TOO_LONG');

  const accepted = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '🙂'.repeat(2000) }
  });
  assert.equal(accepted.status, 200);
});
