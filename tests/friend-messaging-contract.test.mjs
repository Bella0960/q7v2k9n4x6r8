import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomToken } from '../worker/lib/crypto.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

const FIXED_NOW = 1_800_000_000_000;

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FRIEND_CHAT_HTML = readFileSync(resolve(ROOT_DIR, 'chat/contacts/friend-chat.html'), 'utf8');
const FRIEND_CENTER_HTML = readFileSync(resolve(ROOT_DIR, 'chat/contacts/friend-center.html'), 'utf8');


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


test('未读数量按收件人隔离；确认已读只会向前推进且跨设备持久化', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  const carol = makeAccount('Carol');
  await register(ctx, alice, '198.51.100.61');
  await register(ctx, bob, '198.51.100.62');
  await register(ctx, carol, '198.51.100.63');
  await makeFriends(ctx, alice, bob);

  const path = '/api/friends/' + bob.userId + '/messages';
  const first = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '第一条未读消息' }
  });
  const second = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '第二条未读消息' }
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const bobFriends = await asAccount(ctx, bob, '/api/friends');
  const aliceFriends = await asAccount(ctx, alice, '/api/friends');
  assert.equal(bobFriends.payload.friends[0].unreadCount, 2);
  assert.equal(aliceFriends.payload.friends[0].unreadCount, 0);

  const markSecond = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/read', {
    method: 'POST',
    body: { messageId: second.payload.message.id }
  });
  assert.equal(markSecond.status, 200);
  assert.equal(markSecond.payload.read.lastReadMessageId, second.payload.message.id);
  assert.equal(markSecond.payload.alreadyRead, false);

  const afterRead = await asAccount(ctx, bob, '/api/friends');
  assert.equal(afterRead.payload.friends[0].unreadCount, 0);

  // A delayed request from another device must never move the watermark backwards.
  const markOlder = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/read', {
    method: 'POST',
    body: { messageId: first.payload.message.id }
  });
  assert.equal(markOlder.status, 200);
  assert.equal(markOlder.payload.alreadyRead, true);
  assert.equal(markOlder.payload.read.lastReadMessageId, second.payload.message.id);
  assert.equal((await asAccount(ctx, bob, '/api/friends')).payload.friends[0].unreadCount, 0);

  // The recipient cannot mark their own outgoing message as read on the sender's behalf.
  const bobReply = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '我的回复' }
  });
  const invalidRead = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/read', {
    method: 'POST',
    body: { messageId: bobReply.payload.message.id }
  });
  assert.equal(invalidRead.status, 404);
  assert.equal(invalidRead.payload.error.code, 'FRIEND_MESSAGE_NOT_FOUND');

  const strangerRead = await asAccount(ctx, carol, '/api/friends/' + alice.userId + '/read', {
    method: 'POST',
    body: { messageId: first.payload.message.id }
  });
  assert.equal(strangerRead.status, 403);
  assert.equal(strangerRead.payload.error.code, 'NOT_FRIENDS');

  // The persisted watermark is visible to the same account on another client/session.
  const secondSession = await asAccount(ctx, bob, '/api/friends');
  assert.equal(secondSession.payload.friends[0].unreadCount, 0);
});

test('账号每分钟最多发送 60 条消息；相同消息的网络重试不重复计数', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  await register(ctx, alice, '198.51.100.51');
  await register(ctx, bob, '198.51.100.52');
  await makeFriends(ctx, alice, bob);
  const path = '/api/friends/' + bob.userId + '/messages';
  const firstId = messageId();

  const first = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: firstId, body: '第一次发送' }
  });
  assert.equal(first.status, 200);

  const retry = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: firstId, body: '第一次发送' }
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.duplicate, true);

  for (let index = 1; index < 60; index += 1) {
    const sent = await asAccount(ctx, alice, path, {
      method: 'POST',
      body: { clientMessageId: messageId(), body: '频率测试 ' + index }
    });
    assert.equal(sent.status, 200, '第 ' + (index + 1) + ' 条消息应该还在限额内');
  }

  const overLimit = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '第 61 条消息' }
  });
  assert.equal(overLimit.status, 429);
  assert.equal(overLimit.payload.error.code, 'FRIEND_MESSAGE_RATE_LIMITED');

  // 60 秒窗口滚动后恢复发送；过期窗口之外的消息不再占用额度。
  ctx.timestamps.push(FIXED_NOW + 61000);
  const afterWindow = await asAccount(ctx, alice, path, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '窗口过后可以继续发送' }
  });
  assert.equal(afterWindow.status, 200);
});


test('单条消息只在当前账号隐藏；好友仍能看到原消息且未读数同步扣除', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  const carol = makeAccount('Carol');
  await register(ctx, alice, '198.51.100.71');
  await register(ctx, bob, '198.51.100.72');
  await register(ctx, carol, '198.51.100.73');
  await makeFriends(ctx, alice, bob);

  const sent = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages', {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '这条消息只由 Bob 在自己这边隐藏' }
  });
  assert.equal(sent.status, 200);
  const targetId = sent.payload.message.id;

  const beforeHide = await asAccount(ctx, bob, '/api/friends');
  assert.equal(beforeHide.payload.friends[0].unreadCount, 1);

  const hidden = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages/' + targetId, {
    method: 'DELETE'
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.payload.hidden, true);
  assert.equal(hidden.payload.scope, 'current_user_only');

  const repeated = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages/' + targetId, {
    method: 'DELETE'
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.alreadyHidden, true);

  const bobHistory = await asAccount(ctx, bob, '/api/friends/' + alice.userId + '/messages');
  assert.deepEqual(bobHistory.payload.messages, []);
  const bobFriends = await asAccount(ctx, bob, '/api/friends');
  assert.equal(bobFriends.payload.friends[0].unreadCount, 0);

  const aliceHistory = await asAccount(ctx, alice, '/api/friends/' + bob.userId + '/messages');
  assert.deepEqual(aliceHistory.payload.messages.map(item => item.id), [targetId]);

  const strangerHide = await asAccount(ctx, carol, '/api/friends/' + alice.userId + '/messages/' + targetId, {
    method: 'DELETE'
  });
  assert.equal(strangerHide.status, 403);
  assert.equal(strangerHide.payload.error.code, 'NOT_FRIENDS');
});

test('清空聊天记录只影响当前账号；清空之后的新消息仍会正常出现', async () => {
  const ctx = setupTestStore(openTestDb());
  ctx.timestamps.push(FIXED_NOW);
  const alice = makeAccount('Alice');
  const bob = makeAccount('Bob');
  await register(ctx, alice, '198.51.100.74');
  await register(ctx, bob, '198.51.100.75');
  await makeFriends(ctx, alice, bob);
  const alicePath = '/api/friends/' + bob.userId + '/messages';
  const bobPath = '/api/friends/' + alice.userId + '/messages';

  const first = await asAccount(ctx, alice, alicePath, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '清空前第一条' }
  });
  const second = await asAccount(ctx, bob, bobPath, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '清空前第二条' }
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const cleared = await asAccount(ctx, alice, alicePath, { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.payload.cleared, true);
  assert.equal(cleared.payload.scope, 'current_user_only');
  assert.equal(cleared.payload.clearedThrough.messageId, second.payload.message.id);

  const aliceAfterClear = await asAccount(ctx, alice, alicePath);
  assert.deepEqual(aliceAfterClear.payload.messages, []);
  assert.equal((await asAccount(ctx, alice, '/api/friends')).payload.friends[0].unreadCount, 0);

  const bobAfterAliceClear = await asAccount(ctx, bob, bobPath);
  assert.deepEqual(
    bobAfterAliceClear.payload.messages.map(item => item.body),
    ['清空前第一条', '清空前第二条']
  );

  const newMessage = await asAccount(ctx, bob, bobPath, {
    method: 'POST',
    body: { clientMessageId: messageId(), body: '清空之后的新消息' }
  });
  assert.equal(newMessage.status, 200);

  const stillCleared = await asAccount(ctx, alice, alicePath);
  assert.deepEqual(stillCleared.payload.messages.map(item => item.body), ['清空之后的新消息']);
  assert.equal((await asAccount(ctx, alice, '/api/friends')).payload.friends[0].unreadCount, 1);

  const emptyClear = await asAccount(ctx, alice, alicePath, { method: 'DELETE' });
  assert.equal(emptyClear.status, 200);
  assert.equal(emptyClear.payload.cleared, true);
  assert.deepEqual((await asAccount(ctx, alice, alicePath)).payload.messages, []);
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

test('真人聊天页面安全渲染正文、立即显示发送状态并在后台暂停轮询', () => {
  assert.match(FRIEND_CHAT_HTML, /bubble\.textContent = String\(message\.body \|\| ''\)/);
  assert.match(FRIEND_CHAT_HTML, /appendPendingMessage\(text, clientId\)/);
  assert.match(FRIEND_CHAT_HTML, /removePendingMessage\(pendingNode\)/);
  assert.match(FRIEND_CHAT_HTML, /api\.sendMessage\(friendId, text, clientId\)/);
  assert.match(FRIEND_CHAT_HTML, /window\.setInterval\(pollMessages, 4500\)/);
  assert.match(FRIEND_CHAT_HTML, /document\.hidden/);
  assert.match(FRIEND_CHAT_HTML, /再次点击发送会安全重试/);
  assert.match(FRIEND_CHAT_HTML, /FRIEND_MESSAGE_RATE_LIMITED/);
  assert.match(FRIEND_CHAT_HTML, /请稍后再发送，当前输入内容已保留/);
  assert.match(FRIEND_CHAT_HTML, /端到端加密/);
  assert.match(FRIEND_CHAT_HTML, /api\.markRead\(friendId, target\.id\)/);
  assert.match(FRIEND_CHAT_HTML, /function isMessageVisible\(messageId\)/);
  assert.match(FRIEND_CHAT_HTML, /!isMessageVisible\(latestIncomingMessage\.id\)/);
  assert.match(FRIEND_CHAT_HTML, /rememberIncoming\(page\.messages \|\| \[\]\)/);
  assert.match(FRIEND_CHAT_HTML, /rememberIncoming\(initialMessages\)/);
  assert.match(FRIEND_CENTER_HTML, /friend\.unreadCount/);
  assert.match(FRIEND_CENTER_HTML, /unread-count/);
  assert.match(FRIEND_CENTER_HTML, /friendsPollTimer/);
  assert.match(FRIEND_CHAT_HTML, /clearChatBtn/);
  assert.match(FRIEND_CHAT_HTML, /api\.clearMessages\(friendId\)/);
  assert.match(FRIEND_CHAT_HTML, /api\.hideMessage\(friendId, messageId\)/);
  assert.match(FRIEND_CHAT_HTML, /好友仍然可以看到原消息/);
  assert.match(FRIEND_CHAT_HTML, /清空你这边的全部聊天记录/);
});
