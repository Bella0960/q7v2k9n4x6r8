import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const identitySource = readFileSync(new URL('../shared/js/phone/contact-identity.js', import.meta.url), 'utf8');
const directorySource = readFileSync(new URL('../shared/js/phone/contact-directory.js', import.meta.url), 'utf8');

function createDirectoryRuntime(options = {}) {
  const data = new Map();
  if (options.initialDirectory !== undefined) data.set('real_user_contacts_v1', options.initialDirectory);
  const localStorage = {
    getItem(key) {
      if (options.failReads) throw new Error('storage unavailable');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (options.failWrites) {
        const error = new Error('storage unavailable');
        error.name = options.failWrites === 'quota' ? 'QuotaExceededError' : 'SecurityError';
        throw error;
      }
      data.set(key, String(value));
    }
  };
  const window = { localStorage };
  const context = {
    window, localStorage, JSON, Array, Object, String, Date, Math, Number,
    encodeURIComponent, decodeURIComponent
  };
  vm.runInNewContext(identitySource, context);
  vm.runInNewContext(directorySource, context);
  return { directory: window.PhoneContactDirectory, data };
}

function incoming(directory, id = 'user-1', requestId = 'req-1', now = 100) {
  return directory.applyIncomingRequest({
    id, displayName: '真人好友', requestId, source: 'server'
  }, { now });
}

test('incoming requests require a stable request ID and duplicate delivery is idempotent', () => {
  const { directory } = createDirectoryRuntime();
  assert.equal(directory.applyIncomingRequest({ id: 'user-1', displayName: '好友' }, { now: 100 }).error, 'missing_request_id');

  const first = incoming(directory);
  assert.equal(first.ok, true);
  assert.equal(first.action, 'incoming_request_received');

  const duplicate = incoming(directory);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.action, 'duplicate_delivery');
  assert.equal(directory.read().contacts.length, 1);

  const conflicting = incoming(directory, 'user-1', 'req-2', 101);
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.error, 'incoming_request_exists');
  assert.equal(directory.get('user-1').requestId, 'req-1');
});

test('accepting an incoming request requires the exact current request ID', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory);

  assert.equal(directory.acceptIncoming('user-1', { now: 101 }).error, 'missing_request_id');
  assert.equal(directory.acceptIncoming('user-1', { requestId: 'old-request', now: 101 }).error, 'stale_request');

  const accepted = directory.acceptIncoming('user-1', { requestId: 'req-1', now: 90 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.action, 'request_accepted');
  assert.equal(accepted.contact.status, 'accepted');
  assert.ok(accepted.contact.updatedAt > 100);

  const replay = directory.acceptIncoming('user-1', { requestId: 'req-1', now: 102 });
  assert.equal(replay.ok, true);
  assert.equal(replay.action, 'already_accepted');
  assert.equal(directory.getAcceptedRefs().refs.length, 1);

  assert.equal(incoming(directory, 'user-1', 'req-1', 103).error, 'already_friends');
});

test('declining an incoming request retains a tombstone and rejects stale re-delivery', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'user-1', 'req-decline', 100);

  assert.equal(directory.declineIncoming('user-1', { requestId: 'wrong', now: 101 }).error, 'stale_request');
  const declined = directory.declineIncoming('user-1', { requestId: 'req-decline', now: 102 });
  assert.equal(declined.ok, true);
  assert.equal(declined.contact.status, 'declined');

  const replay = incoming(directory, 'user-1', 'req-decline', 103);
  assert.equal(replay.ok, true);
  assert.equal(replay.action, 'duplicate_terminal_delivery');
  assert.equal(directory.get('user-1').status, 'declined');

  const fresh = incoming(directory, 'user-1', 'req-fresh', 104);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.action, 'incoming_request_received');
  assert.equal(directory.get('user-1').status, 'pending_incoming');
});

test('outgoing requests are idempotent, cancellable, and restart only with a fresh ID', () => {
  const { directory } = createDirectoryRuntime();
  const first = directory.requestOutgoing({ id: 'user-2', displayName: '另一位好友' }, { requestId: 'out-1', now: 200 });
  assert.equal(first.ok, true);
  assert.equal(first.action, 'request_created');

  const duplicate = directory.requestOutgoing({ id: 'user-2', displayName: '另一位好友' }, { requestId: 'out-1', now: 201 });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.action, 'duplicate_delivery');

  assert.equal(directory.requestOutgoing({ id: 'user-2', displayName: '另一位好友' }, { requestId: 'out-2', now: 202 }).error, 'outgoing_request_exists');
  assert.equal(directory.cancelOutgoing('user-2', { requestId: 'wrong', now: 203 }).error, 'stale_request');

  const cancelled = directory.cancelOutgoing('user-2', { requestId: 'out-1', now: 204 });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.contact.status, 'cancelled');

  const replay = directory.requestOutgoing({ id: 'user-2', displayName: '另一位好友' }, { requestId: 'out-1', now: 205 });
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'stale_request');

  const restarted = directory.requestOutgoing({ id: 'user-2', displayName: '另一位好友' }, { requestId: 'out-2', now: 206 });
  assert.equal(restarted.ok, true);
  assert.equal(restarted.action, 'request_restarted');
  assert.equal(directory.get('user-2').requestId, 'out-2');
});

test('blocking and unblocking do not revive the blocked request', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'user-3', 'friendship-1', 300);
  directory.acceptIncoming('user-3', { requestId: 'friendship-1', now: 301 });

  const blocked = directory.block('user-3', { now: 302 });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.contact.status, 'blocked');
  assert.equal(incoming(directory, 'user-3', 'new-while-blocked', 303).error, 'blocked');

  const unblocked = directory.unblock('user-3', { now: 304 });
  assert.equal(unblocked.ok, true);
  assert.equal(unblocked.contact.status, 'unblocked');

  const stale = incoming(directory, 'user-3', 'friendship-1', 305);
  assert.equal(stale.ok, true);
  assert.equal(stale.action, 'duplicate_terminal_delivery');
  assert.equal(directory.get('user-3').status, 'unblocked');

  const fresh = incoming(directory, 'user-3', 'friendship-2', 306);
  assert.equal(fresh.ok, true);
  assert.equal(directory.get('user-3').status, 'pending_incoming');
});

test('removing an accepted friend retains a tombstone but permits a new relationship', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'user-4', 'friendship-old', 400);
  directory.acceptIncoming('user-4', { requestId: 'friendship-old', now: 401 });

  const removed = directory.removeFriend('user-4', { requestId: 'friendship-old', now: 402 });
  assert.equal(removed.ok, true);
  assert.equal(removed.contact.status, 'removed');
  assert.equal(directory.getAcceptedRefs().refs.length, 0);

  const stale = incoming(directory, 'user-4', 'friendship-old', 403);
  assert.equal(stale.action, 'duplicate_terminal_delivery');
  assert.equal(directory.get('user-4').status, 'removed');

  const fresh = incoming(directory, 'user-4', 'friendship-new', 404);
  assert.equal(fresh.ok, true);
  assert.equal(directory.get('user-4').status, 'pending_incoming');
});

test('terminal transitions are idempotent and storage failures never claim success', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'user-5', 'decline-once', 500);

  const first = directory.declineIncoming('user-5', { requestId: 'decline-once', now: 501 });
  const second = directory.declineIncoming('user-5', { requestId: 'decline-once', now: 502 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.action, 'already_declined');

  const unavailable = createDirectoryRuntime({ failWrites: true }).directory;
  const failed = unavailable.requestOutgoing({ id: 'user-6', displayName: '存储失败' }, { requestId: 'out-6', now: 600 });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'storage_unavailable');
  assert.equal(unavailable.read().contacts.length, 0);
});

test('pending request queues remain separated and exclude terminal relationship records', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'incoming-user', 'incoming-req', 100);
  directory.requestOutgoing({
    id: 'outgoing-user',
    displayName: '待确认联系人'
  }, { requestId: 'outgoing-req', now: 101 });
  incoming(directory, 'declined-user', 'declined-req', 102);
  directory.declineIncoming('declined-user', { requestId: 'declined-req', now: 103 });

  const pending = directory.getPendingRequests();
  assert.equal(pending.ok, true);
  assert.deepEqual(pending.incoming.map((item) => item.id), ['incoming-user']);
  assert.deepEqual(pending.outgoing.map((item) => item.id), ['outgoing-user']);
  assert.equal(directory.get('declined-user').status, 'declined');
});

test('legacy directory records remain readable and terminal states are normalized', () => {
  const legacy = JSON.stringify([{
    id: 'legacy-user', displayName: '旧好友', status: 'accepted',
    createdAt: 10, updatedAt: 11, acceptedAt: 11
  }]);
  const { directory } = createDirectoryRuntime({ initialDirectory: legacy });
  assert.equal(directory.get('legacy-user').status, 'accepted');
  assert.equal(directory.get('legacy-user').acceptedAt, 11);
  assert.equal(directory.get('legacy-user').declinedAt, null);
});

test('server responses accept or decline outgoing requests only for the matching request ID', () => {
  const { directory } = createDirectoryRuntime();
  const outgoing = directory.requestOutgoing(
    { id: 'user-7', displayName: '申请对象' },
    { requestId: 'outgoing-7', now: 700 }
  );
  assert.equal(outgoing.ok, true);

  assert.equal(directory.confirmOutgoingAccepted('user-7', { now: 701 }).error, 'missing_request_id');
  assert.equal(directory.confirmOutgoingAccepted('user-7', { requestId: 'old-id', now: 701 }).error, 'stale_request');

  const accepted = directory.confirmOutgoingAccepted('user-7', { requestId: 'outgoing-7', now: 702 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.action, 'outgoing_request_accepted');
  assert.equal(accepted.contact.status, 'accepted');

  const acceptedReplay = directory.confirmOutgoingAccepted('user-7', { requestId: 'outgoing-7', now: 703 });
  assert.equal(acceptedReplay.ok, true);
  assert.equal(acceptedReplay.action, 'already_accepted');

  const declinedRequest = directory.requestOutgoing(
    { id: 'user-8', displayName: '另一位申请对象' },
    { requestId: 'outgoing-8', now: 800 }
  );
  assert.equal(declinedRequest.ok, true);
  const declined = directory.applyOutgoingDeclined('user-8', { requestId: 'outgoing-8', now: 801 });
  assert.equal(declined.ok, true);
  assert.equal(declined.action, 'outgoing_request_declined');
  assert.equal(declined.contact.status, 'declined');

  const declinedReplay = directory.applyOutgoingDeclined('user-8', { requestId: 'outgoing-8', now: 802 });
  assert.equal(declinedReplay.ok, true);
  assert.equal(declinedReplay.action, 'already_declined');
  assert.equal(directory.getAcceptedRefs().refs.length, 1);
});

test('low-level save cannot change an existing relationship state or request ID', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'guarded-user', 'guarded-request', 900);
  directory.acceptIncoming('guarded-user', { requestId: 'guarded-request', now: 901 });

  const accepted = directory.get('guarded-user');
  const attemptedBlock = directory.save({
    ...accepted,
    status: 'blocked',
    blockedAt: 902,
    updatedAt: 902
  });
  assert.equal(attemptedBlock.ok, false);
  assert.equal(attemptedBlock.error, 'lifecycle_transition_required');
  assert.equal(directory.get('guarded-user').status, 'accepted');

  const attemptedRestart = directory.save({
    ...accepted,
    requestId: 'forged-new-request',
    updatedAt: 903
  });
  assert.equal(attemptedRestart.ok, false);
  assert.equal(attemptedRestart.error, 'lifecycle_transition_required');
  assert.equal(directory.get('guarded-user').requestId, 'guarded-request');
});

test('low-level save cannot revive blocked or removed relationship tombstones', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'blocked-user', 'blocked-request', 910);
  directory.acceptIncoming('blocked-user', { requestId: 'blocked-request', now: 911 });
  directory.block('blocked-user', { now: 912 });

  const blocked = directory.get('blocked-user');
  const blockedRevival = directory.save({
    ...blocked,
    status: 'accepted',
    acceptedAt: 913,
    updatedAt: 913
  });
  assert.equal(blockedRevival.ok, false);
  assert.equal(blockedRevival.error, 'lifecycle_transition_required');
  assert.equal(directory.get('blocked-user').status, 'blocked');

  incoming(directory, 'removed-user', 'removed-request', 914);
  directory.acceptIncoming('removed-user', { requestId: 'removed-request', now: 915 });
  directory.removeFriend('removed-user', { requestId: 'removed-request', now: 916 });
  const removed = directory.get('removed-user');
  const removedRevival = directory.save({
    ...removed,
    status: 'accepted',
    requestId: 'new-but-unverified-request',
    acceptedAt: 917,
    updatedAt: 917
  });
  assert.equal(removedRevival.ok, false);
  assert.equal(removedRevival.error, 'lifecycle_transition_required');
  assert.equal(directory.get('removed-user').status, 'removed');
});

test('saveMany is atomic when one snapshot attempts a lifecycle transition', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'batch-one', 'batch-one-request', 920);
  directory.acceptIncoming('batch-one', { requestId: 'batch-one-request', now: 921 });
  incoming(directory, 'batch-two', 'batch-two-request', 922);
  directory.acceptIncoming('batch-two', { requestId: 'batch-two-request', now: 923 });

  const first = directory.get('batch-one');
  const second = directory.get('batch-two');
  const result = directory.saveMany([
    { ...first, displayName: '不应部分写入的新名称', updatedAt: 924 },
    { ...second, status: 'blocked', blockedAt: 925, updatedAt: 925 }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'lifecycle_transition_required');
  assert.equal(result.invalidIndex, 1);
  assert.equal(directory.get('batch-one').displayName, '真人好友');
  assert.equal(directory.get('batch-two').status, 'accepted');
});

test('friend removal requires the exact current request ID and cannot remove a later friendship', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'readded-user', 'friendship-old', 940);
  directory.acceptIncoming('readded-user', { requestId: 'friendship-old', now: 941 });

  assert.equal(directory.removeFriend('readded-user', { now: 942 }).error, 'missing_request_id');
  assert.equal(directory.removeFriend('readded-user', {
    requestId: 'stale-request',
    now: 942
  }).error, 'stale_request');
  assert.equal(directory.get('readded-user').status, 'accepted');

  const firstRemoval = directory.removeFriend('readded-user', {
    requestId: 'friendship-old',
    now: 943
  });
  assert.equal(firstRemoval.ok, true);
  assert.equal(firstRemoval.contact.status, 'removed');

  // A fresh request establishes a new relationship generation for this contact.
  incoming(directory, 'readded-user', 'friendship-new', 944);
  directory.acceptIncoming('readded-user', { requestId: 'friendship-new', now: 945 });

  const staleRemoval = directory.removeFriend('readded-user', {
    requestId: 'friendship-old',
    now: 946
  });
  assert.equal(staleRemoval.ok, false);
  assert.equal(staleRemoval.error, 'stale_request');
  assert.equal(directory.get('readded-user').status, 'accepted');
  assert.equal(directory.get('readded-user').requestId, 'friendship-new');

  const currentRemoval = directory.removeFriend('readded-user', {
    requestId: 'friendship-new',
    now: 947
  });
  assert.equal(currentRemoval.ok, true);
  assert.equal(currentRemoval.contact.status, 'removed');
  const duplicateRemoval = directory.removeFriend('readded-user', {
    requestId: 'friendship-new',
    now: 948
  });
  assert.equal(duplicateRemoval.ok, true);
  assert.equal(duplicateRemoval.action, 'already_removed');
});

test('safe profile refresh keeps accepted relationship metadata intact', () => {
  const { directory } = createDirectoryRuntime();
  incoming(directory, 'profile-refresh-user', 'profile-refresh-request', 930);
  directory.acceptIncoming('profile-refresh-user', { requestId: 'profile-refresh-request', now: 931 });
  const before = directory.get('profile-refresh-user');

  const refreshed = directory.save({
    ...before,
    displayName: '更新后的好友昵称',
    avatarUrl: 'https://example.test/avatar.png',
    acceptedAt: 999999,
    source: 'untrusted-refresh',
    updatedAt: before.updatedAt + 1
  });

  assert.equal(refreshed.ok, true);
  const after = directory.get('profile-refresh-user');
  assert.equal(after.displayName, '更新后的好友昵称');
  assert.equal(after.avatarUrl, 'https://example.test/avatar.png');
  assert.equal(after.status, 'accepted');
  assert.equal(after.requestId, 'profile-refresh-request');
  assert.equal(after.acceptedAt, before.acceptedAt);
  assert.equal(after.source, before.source);
});

function serverRoster(ownerAccountId, relationships, snapshotAt) {
  return { ownerAccountId, complete: true, relationships, snapshotAt };
}

function acceptedServerFriend(id, requestId, updatedAt, overrides = {}) {
  return {
    id,
    status: 'accepted',
    acceptedRequestId: requestId,
    acceptedAt: updatedAt - 10,
    updatedAt,
    handle: id.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase() || 'friend_01',
    displayName: '服务器好友',
    avatarAssetId: 'av_' + 'a'.repeat(32),
    ...overrides
  };
}

test('complete server snapshots sync active-account friends into the directory with current profile fields', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account_owner_01');

  const synced = directory.syncServerSnapshot(serverRoster('account_owner_01', [
    acceptedServerFriend('account_friend_01', 'request_owner_001', 1000, {
      displayName: '最新好友昵称',
      avatarAssetId: 'av_' + 'b'.repeat(32)
    })
  ], 1100), 'account_owner_01', { now: 1200 });

  assert.equal(synced.ok, true);
  const visible = directory.read({ status: 'accepted' });
  assert.equal(visible.contacts.length, 1);
  assert.equal(visible.contacts[0].ownerAccountId, 'account_owner_01');
  assert.equal(visible.contacts[0].displayName, '最新好友昵称');
  assert.equal(visible.contacts[0].handle, 'accountfriend01');
  assert.equal(visible.contacts[0].avatarAssetId, 'av_' + 'b'.repeat(32));
  assert.match(visible.contacts[0].avatarUrl, /\/api\/real-user-chat\/v1\/profile\/avatars\/av_/);

  directory.setActiveAccountId('account_other_01');
  assert.equal(directory.read({ status: 'accepted' }).contacts.length, 0);
  assert.equal(directory.readResult().contacts.length, 1);
});

test('server snapshots update and remove friends, but only a new request ID can create a new relationship', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account_owner_02');
  const initial = acceptedServerFriend('account_friend_02', 'request_old_001', 2000);
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_02', [initial], 2100),
    'account_owner_02', { now: 2200 }).ok, true);

  const removed = {
    id: initial.id,
    status: 'removed',
    acceptedRequestId: initial.acceptedRequestId,
    acceptedAt: initial.acceptedAt,
    updatedAt: 2300
  };
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_02', [removed], 2400),
    'account_owner_02', { now: 2500 }).ok, true);
  assert.equal(directory.read({ status: 'accepted' }).contacts.length, 0);
  assert.equal(directory.get(initial.id).status, 'removed');

  const staleRevival = directory.syncServerSnapshot(serverRoster('account_owner_02', [
    acceptedServerFriend(initial.id, 'request_old_001', 2600)
  ], 2700), 'account_owner_02', { now: 2800 });
  assert.equal(staleRevival.ok, false);
  assert.equal(staleRevival.error, 'stale_server_relationship_revival');
  assert.equal(directory.get(initial.id).status, 'removed');

  const fresh = directory.syncServerSnapshot(serverRoster('account_owner_02', [
    acceptedServerFriend(initial.id, 'request_fresh_002', 2900, { displayName: '重新添加的好友' })
  ], 3000), 'account_owner_02', { now: 3100 });
  assert.equal(fresh.ok, true);
  assert.equal(directory.get(initial.id).status, 'accepted');
  assert.equal(directory.get(initial.id).requestId, 'request_fresh_002');
  assert.equal(directory.get(initial.id).displayName, '重新添加的好友');
});

test('complete snapshots tombstone omitted server friends without touching local-only or other-account records', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account_owner_03');
  const friendA = acceptedServerFriend('account_friend_03', 'request_friend_003', 3200);
  const friendB = acceptedServerFriend('account_friend_04', 'request_friend_004', 3300);
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_03', [friendA, friendB], 3400),
    'account_owner_03', { now: 3500 }).ok, true);

  const local = directory.requestOutgoing({ id: 'local_friend_01', displayName: '本地联系人' }, {
    requestId: 'local_request_001', now: 3510
  });
  assert.equal(local.ok, true);
  directory.setActiveAccountId('account_owner_04');
  const secondOwner = directory.syncServerSnapshot(serverRoster('account_owner_04', [
    acceptedServerFriend(friendA.id, 'request_other_003', 3520, { displayName: '另一个账号的好友' })
  ], 3530), 'account_owner_04', { now: 3540 });
  assert.equal(secondOwner.ok, true);

  directory.setActiveAccountId('account_owner_03');
  const onlyA = directory.syncServerSnapshot(serverRoster('account_owner_03', [friendA], 3600),
    'account_owner_03', { now: 3700 });
  assert.equal(onlyA.ok, true);
  const all = directory.readResult().contacts;
  assert.equal(all.find(item => item.id === friendB.id && item.ownerAccountId === 'account_owner_03').status, 'removed');
  assert.equal(all.find(item => item.id === friendA.id && item.ownerAccountId === 'account_owner_04').status, 'accepted');
  assert.ok(all.some(item => item.id === 'local_friend_01' && item.ownerAccountId === 'account_owner_03' && item.status === 'pending_outgoing'));
});

test('invalid, incomplete, duplicate, or stale server snapshots never partially overwrite the directory', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account_owner_05');
  const initial = acceptedServerFriend('account_friend_05', 'request_friend_005', 4000);
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_05', [initial], 4100),
    'account_owner_05', { now: 4200 }).ok, true);

  const incomplete = directory.syncServerSnapshot({
    complete: false,
    relationships: [],
    snapshotAt: 4300
  }, 'account_owner_05', { now: 4400 });
  assert.equal(incomplete.error, 'incomplete_server_snapshot');

  const duplicate = directory.syncServerSnapshot(serverRoster('account_owner_05', [
    acceptedServerFriend('account_friend_06', 'request_friend_006', 4500),
    acceptedServerFriend('account_friend_06', 'request_friend_007', 4501)
  ], 4600), 'account_owner_05', { now: 4700 });
  assert.equal(duplicate.error, 'duplicate_server_relationship');
  assert.equal(directory.read({ status: 'accepted' }).contacts.length, 1);
  assert.equal(directory.get('account_friend_05').displayName, '服务器好友');

  const stale = directory.syncServerSnapshot(serverRoster('account_owner_05', [
    acceptedServerFriend('account_friend_05', 'request_friend_005', 3900, { displayName: '旧资料' })
  ], 3900), 'account_owner_05', { now: 4800 });
  assert.equal(stale.error, 'stale_server_snapshot');
  assert.equal(directory.get('account_friend_05').displayName, '服务器好友');
});

test('legacy ownerless accepted rows migrate only after the active server account confirms the relationship', () => {
  const legacy = JSON.stringify([{
    id: 'account_friend_06',
    displayName: '旧本地昵称',
    status: 'accepted',
    source: 'server',
    requestId: 'legacy_request_006',
    createdAt: 4900,
    updatedAt: 4900,
    acceptedAt: 4900
  }]);
  const { directory } = createDirectoryRuntime({ initialDirectory: legacy });
  directory.setActiveAccountId('account_owner_06');

  const synced = directory.syncServerSnapshot(serverRoster('account_owner_06', [
    acceptedServerFriend('account_friend_06', 'server_request_006', 5000, {
      displayName: '服务器确认的新昵称'
    })
  ], 5100), 'account_owner_06', { now: 5200 });

  assert.equal(synced.ok, true);
  const all = directory.readResult().contacts;
  assert.equal(all.length, 1);
  assert.equal(all[0].ownerAccountId, 'account_owner_06');
  assert.equal(all[0].displayName, '服务器确认的新昵称');
  assert.equal(all[0].requestId, 'server_request_006');

  directory.setActiveAccountId('account_owner_07');
  assert.equal(directory.read({ status: 'accepted' }).contacts.length, 0);
});

test('lifecycle changes for one account never mutate the same friend ID stored for another account', () => {
  const { directory } = createDirectoryRuntime();
  const friendId = 'account_friend_08';
  directory.setActiveAccountId('account_owner_08');
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_08', [
    acceptedServerFriend(friendId, 'server_request_owner8', 5300)
  ], 5400), 'account_owner_08', { now: 5500 }).ok, true);

  directory.setActiveAccountId('account_owner_09');
  assert.equal(directory.syncServerSnapshot(serverRoster('account_owner_09', [
    acceptedServerFriend(friendId, 'server_request_owner9', 5600)
  ], 5700), 'account_owner_09', { now: 5800 }).ok, true);

  directory.setActiveAccountId('account_owner_08');
  const removed = directory.removeFriend(friendId, { requestId: 'server_request_owner8', now: 5900 });
  assert.equal(removed.ok, true);
  const records = directory.readResult().contacts.filter(item => item.id === friendId);
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.ownerAccountId === 'account_owner_08').status, 'removed');
  assert.equal(records.find(item => item.ownerAccountId === 'account_owner_09').status, 'accepted');
});

test('server snapshots are rejected when their account is no longer active', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account-current');
  const result = directory.syncServerSnapshot(serverRoster('account-previous', [
    acceptedServerFriend('account_friend_previous', 'request_previous_001', 7000)
  ], 7100), 'account-previous', { now: 7200 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'active_account_mismatch');
  assert.equal(directory.readResult().contacts.length, 0);
});

test('removed snapshots create tombstones for unseen users without claiming local-only contacts', () => {
  const legacy = JSON.stringify([{
    id: 'same-id-local-contact',
    displayName: '用户自己的本地联系人',
    status: 'accepted',
    source: 'manual',
    requestId: 'local-only-request',
    createdAt: 7300,
    updatedAt: 7301
  }]);
  const { directory } = createDirectoryRuntime({ initialDirectory: legacy });
  directory.setActiveAccountId('account_owner_11');

  const removal = {
    id: 'same-id-local-contact',
    status: 'removed',
    acceptedRequestId: 'server_request_old_11',
    acceptedAt: 7310,
    updatedAt: 7320
  };
  const removed = directory.syncServerSnapshot(serverRoster('account_owner_11', [removal], 7330),
    'account_owner_11', { now: 7340 });
  assert.equal(removed.ok, true);

  const records = directory.readResult().contacts;
  assert.equal(records.length, 2);
  assert.equal(records.find(item => !item.ownerAccountId).displayName, '用户自己的本地联系人');
  assert.equal(records.find(item => item.ownerAccountId === 'account_owner_11').status, 'removed');
  assert.equal(records.find(item => item.ownerAccountId === 'account_owner_11').requestId, 'server_request_old_11');

  const staleAccepted = directory.syncServerSnapshot(serverRoster('account_owner_11', [
    acceptedServerFriend('same-id-local-contact', 'server_request_old_11', 7350)
  ], 7360), 'account_owner_11', { now: 7370 });
  assert.equal(staleAccepted.ok, false);
  assert.equal(staleAccepted.error, 'stale_server_relationship_revival');
  assert.equal(directory.readResult().contacts.find(item => !item.ownerAccountId).displayName, '用户自己的本地联系人');

  const freshAccepted = directory.syncServerSnapshot(serverRoster('account_owner_11', [
    acceptedServerFriend('same-id-local-contact', 'server_request_new_11', 7380)
  ], 7390), 'account_owner_11', { now: 7400 });
  assert.equal(freshAccepted.ok, true);
  assert.equal(directory.get('same-id-local-contact').status, 'accepted');
  assert.equal(directory.get('same-id-local-contact').requestId, 'server_request_new_11');
});

test('directory refuses an otherwise complete snapshot when its account owner does not match', () => {
  const { directory } = createDirectoryRuntime();
  directory.setActiveAccountId('account_owner_10');
  const result = directory.syncServerSnapshot(
    serverRoster('account_other_10', [
      acceptedServerFriend('account_friend_10', 'request_friend_010', 6000)
    ], 6100),
    'account_owner_10',
    { now: 6200 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'server_snapshot_account_mismatch');
  assert.equal(directory.readResult().contacts.length, 0);
});
