import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const identitySource = readFileSync(new URL('../shared/js/phone/contact-identity.js', import.meta.url), 'utf8');
const directorySource = readFileSync(new URL('../shared/js/phone/contact-directory.js', import.meta.url), 'utf8');
const capabilitiesSource = readFileSync(new URL('../shared/js/phone/contact-capabilities.js', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../shared/js/phone/real-user-conversation-repository.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function createRuntime(options = {}) {
  const data = new Map();
  let failReads = false;
  let failWrites = false;
  const localStorage = {
    getItem(key) {
      if (failReads) throw new Error('storage read failed');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) {
        const error = new Error('storage write failed');
        error.name = options.quota ? 'QuotaExceededError' : 'SecurityError';
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      if (failWrites) throw new Error('storage remove failed');
      data.delete(key);
    }
  };
  const window = { localStorage };
  const context = {
    window, localStorage, JSON, Array, Object, String, Date, Math, Number,
    encodeURIComponent, decodeURIComponent
  };
  vm.runInNewContext(identitySource, context);
  vm.runInNewContext(capabilitiesSource, context);
  vm.runInNewContext(directorySource, context);
  vm.runInNewContext(repositorySource, context);
  return {
    window,
    data,
    directory: window.PhoneContactDirectory,
    repository: window.PhoneRealUserConversationRepository,
    setFailures(reads, writes) { failReads = !!reads; failWrites = !!writes; }
  };
}

function acceptFriend(directory, id = 'friend-1', requestId = 'request-1') {
  const received = directory.applyIncomingRequest({
    id, displayName: '真人好友', requestId, source: 'server'
  });
  assert.equal(received.ok, true);
  const accepted = directory.acceptIncoming(id, { requestId });
  assert.equal(accepted.ok, true);
  return accepted.contact;
}

function refFor(runtime, id = 'friend-1') {
  return runtime.window.PhoneContactIdentity.create('real_user', id);
}

test('real-user history uses a typed storage namespace separate from AI chat_history keys', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory, 'same-id');
  const ref = refFor(runtime, 'same-id');

  const saved = runtime.repository.appendMessage(ref, {
    mid: 'm-1', type: 'text', text: '发给真人好友的内容', createdAt: 100
  });
  assert.equal(saved.ok, true);
  assert.match(saved.meta.syncState, /not_connected/);

  const key = runtime.repository.storageKeyPrefix + encodeURIComponent('same-id');
  assert.ok(runtime.data.has(key));
  assert.equal(runtime.data.has('chat_history_same-id'), false);
  const record = JSON.parse(runtime.data.get(key));
  assert.equal(record.conversationRef.type, 'real_user');
  assert.equal(record.conversationRef.key, 'real_user:same-id');
  assert.equal(record.messages[0].sender, 'self');
  assert.equal(record.messages[0].deliveryState, 'local_only');
});

test('only an accepted typed real-user identity can open or write a local conversation', () => {
  const runtime = createRuntime();
  runtime.directory.applyIncomingRequest({
    id: 'pending-friend', displayName: '待确认好友', requestId: 'pending-1'
  });
  assert.equal(runtime.repository.readHistory(refFor(runtime, 'pending-friend')).error, 'not_accepted_friend');
  assert.equal(runtime.repository.appendMessage(refFor(runtime, 'pending-friend'), {
    mid: 'pending-message', type: 'text', text: '不应写入'
  }).error, 'not_accepted_friend');
  assert.equal(runtime.repository.readHistory('pending-friend').error, 'invalid_real_user_ref');
  assert.equal(runtime.data.has('real_user_chat_history_v1_pending-friend'), false);
});

test('directory corruption or unavailable storage fails closed', () => {
  const corrupt = createRuntime();
  acceptFriend(corrupt.directory);
  corrupt.data.set('real_user_contacts_v1', '{');
  assert.equal(corrupt.repository.readHistory(refFor(corrupt)).error, 'contact_directory_unavailable');

  const unavailable = createRuntime();
  acceptFriend(unavailable.directory);
  unavailable.setFailures(true, false);
  assert.equal(unavailable.repository.readHistory(refFor(unavailable)).error, 'contact_directory_unavailable');
});

test('message types are allowlist-only and financial or unknown messages are rejected', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);

  for (const type of ['redpacket', 'transfer', 'payment', 'wallet', 'transaction_record', 'role_family_card', 'gift', 'unknown_future_type']) {
    const result = runtime.repository.appendMessage(ref, { mid: 'blocked-' + type, type, text: 'not allowed' });
    assert.equal(result.ok, false, type);
    assert.equal(result.error, 'message_type_not_allowed', type);
  }
  assert.equal(runtime.repository.readHistory(ref).messages.length, 0);
});

test('ordinary text is normalized and arbitrary transaction fields are not persisted', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);
  const saved = runtime.repository.appendMessage(ref, {
    mid: 'text-1',
    type: 'text',
    text: '  你好，真人好友  ',
    amount: 999,
    transactionId: 'should-not-be-stored',
    walletAction: 'transfer',
    createdAt: 123
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.message.text, '  你好，真人好友  ');
  const stored = runtime.repository.readHistory(ref).messages[0];
  assert.equal(stored.amount, undefined);
  assert.equal(stored.transactionId, undefined);
  assert.equal(stored.walletAction, undefined);
  assert.equal(stored.sender, 'self');
  assert.equal(stored.deliveryState, 'local_only');
});

test('image, file, voice-message and sticker records require asset references', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);

  for (const type of ['image', 'file', 'voice', 'sticker']) {
    const invalid = runtime.repository.appendMessage(ref, {
      mid: 'missing-asset-' + type, type, text: 'metadata only'
    });
    assert.equal(invalid.ok, false, type);
    assert.equal(invalid.error, 'invalid_message', type);
    const valid = runtime.repository.appendMessage(ref, {
      mid: 'asset-' + type,
      type,
      attachment: {
        assetId: 'asset-' + type,
        mimeType: 'application/octet-stream',
        fileName: 'sample.bin',
        durationMs: 1200
      },
      caption: '附件说明',
      createdAt: 200
    });
    assert.equal(valid.ok, true, type);
    assert.equal(valid.message.attachment.assetId, 'asset-' + type);
  }
});

test('repeated message IDs are idempotent and conflicting reuse is rejected', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);
  const message = { mid: 'stable-mid', type: 'text', text: '同一条消息', createdAt: 300 };

  assert.equal(runtime.repository.appendMessage(ref, message).ok, true);
  const duplicate = runtime.repository.appendMessage(ref, {
    mid: 'stable-mid', type: 'text', text: '同一条消息'
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.action, 'duplicate_delivery');

  const conflict = runtime.repository.appendMessage(ref, {
    mid: 'stable-mid', type: 'text', text: '另一条内容', createdAt: 300
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'message_id_conflict');
  assert.equal(runtime.repository.readHistory(ref).messages.length, 1);
});

test('pagination returns stable chronological slices without changing stored history', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);
  for (let i = 1; i <= 5; i++) {
    assert.equal(runtime.repository.appendMessage(ref, {
      mid: 'page-' + i, type: 'text', text: '消息 ' + i, createdAt: i
    }).ok, true);
  }

  const latest = runtime.repository.getPage(ref, 2);
  assert.deepEqual(Array.from(latest.messages, (item) => item.mid), ['page-4', 'page-5']);
  const previous = runtime.repository.getPage(ref, 2, 'page-4');
  assert.deepEqual(Array.from(previous.messages, (item) => item.mid), ['page-2', 'page-3']);
  assert.equal(runtime.repository.getPage(ref, 2, 'missing').error, 'message_cursor_not_found');
  assert.equal(runtime.repository.readHistory(ref).messages.length, 5);
});

test('same raw ID across an AI role and a real user never shares conversation records', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory, 'collision-id', 'friend-request');
  const realUserRef = refFor(runtime, 'collision-id');
  const aiRoleRef = runtime.window.PhoneContactIdentity.create('ai_role', 'collision-id');

  assert.equal(runtime.repository.appendMessage(realUserRef, {
    mid: 'real-only', type: 'text', text: '真人会话', createdAt: 500
  }).ok, true);

  assert.equal(realUserRef.key, 'real_user:collision-id');
  assert.equal(aiRoleRef.key, 'ai_role:collision-id');
  assert.equal(realUserRef.conversationId, 'real_user:collision-id');
  assert.equal(aiRoleRef.conversationId, 'collision-id');
  assert.equal(runtime.data.has('chat_history_collision-id'), false);
});

test('corrupt history, invalid message IDs or timestamps, and storage failures never claim success', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);

  const key = runtime.repository.storageKeyPrefix + encodeURIComponent(ref.id);
  runtime.data.set(key, '{');
  assert.equal(runtime.repository.readHistory(ref).error, 'corrupt_history');
  assert.equal(runtime.repository.appendMessage(ref, {
    mid: 'after-corruption', type: 'text', text: '不能覆盖损坏记录'
  }).error, 'corrupt_history');

  runtime.data.delete(key);
  assert.equal(runtime.repository.appendMessage(ref, {
    mid: '', type: 'text', text: '缺少消息 ID'
  }).error, 'invalid_message');
  assert.equal(runtime.repository.appendMessage(ref, {
    mid: 'invalid-time', type: 'text', text: '非法时间', createdAt: Infinity
  }).error, 'invalid_message');
  runtime.setFailures(false, true);
  const failure = runtime.repository.appendMessage(ref, {
    mid: 'storage-failure', type: 'text', text: '无法落盘', createdAt: 600
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'storage_unavailable');
});

test('clear affects only the selected accepted real-user conversation', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory, 'friend-a', 'request-a');
  acceptFriend(runtime.directory, 'friend-b', 'request-b');
  const a = refFor(runtime, 'friend-a');
  const b = refFor(runtime, 'friend-b');
  runtime.repository.appendMessage(a, { mid: 'a-1', type: 'text', text: 'A', createdAt: 700 });
  runtime.repository.appendMessage(b, { mid: 'b-1', type: 'text', text: 'B', createdAt: 701 });

  assert.equal(runtime.repository.clear(a).ok, true);
  assert.equal(runtime.repository.readHistory(a).messages.length, 0);
  assert.equal(runtime.repository.readHistory(b).messages.length, 1);
});


test('clear remains available after the friend is blocked or removed', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory, 'blocked-friend', 'block-request');
  acceptFriend(runtime.directory, 'removed-friend', 'remove-request');
  const blockedRef = refFor(runtime, 'blocked-friend');
  const removedRef = refFor(runtime, 'removed-friend');
  runtime.repository.appendMessage(blockedRef, {
    mid: 'before-block', type: 'text', text: '本地记录 A', createdAt: 800
  });
  runtime.repository.appendMessage(removedRef, {
    mid: 'before-remove', type: 'text', text: '本地记录 B', createdAt: 801
  });
  assert.equal(runtime.directory.block(blockedRef.id).ok, true);
  assert.equal(runtime.directory.removeFriend(removedRef.id).ok, true);
  assert.equal(runtime.repository.readHistory(blockedRef).error, 'not_accepted_friend');
  assert.equal(runtime.repository.readHistory(removedRef).error, 'not_accepted_friend');
  assert.equal(runtime.repository.clear(blockedRef).ok, true);
  assert.equal(runtime.repository.clear(removedRef).ok, true);
  assert.equal(runtime.data.has(runtime.repository.storageKeyPrefix + encodeURIComponent(blockedRef.id)), false);
  assert.equal(runtime.data.has(runtime.repository.storageKeyPrefix + encodeURIComponent(removedRef.id)), false);
});


test('duplicate stored message IDs are rejected as corrupt history', () => {
  const runtime = createRuntime();
  acceptFriend(runtime.directory);
  const ref = refFor(runtime);
  const key = runtime.repository.storageKeyPrefix + encodeURIComponent(ref.id);
  const message = {
    mid: 'duplicate-mid', type: 'text', sender: 'self',
    deliveryState: 'local_only', createdAt: 900, text: '重复记录'
  };
  runtime.data.set(key, JSON.stringify({
    schemaVersion: runtime.repository.version,
    conversationRef: ref,
    createdAt: 900,
    updatedAt: 901,
    messages: [message, message]
  }));
  assert.equal(runtime.repository.readHistory(ref).error, 'corrupt_history');
});


test('PWA shell caches the isolated local repository and current capability contract', () => {
  assert.match(serviceWorker, /phone-app-pwa-v181/);
  assert.match(serviceWorker, /real-user-conversation-repository\.js/);
  assert.match(serviceWorker, /contact-capabilities\.js\?v=20261107v1/);
});
