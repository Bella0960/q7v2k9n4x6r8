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

  const removed = directory.removeFriend('user-4', { now: 402 });
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
  directory.removeFriend('removed-user', { now: 916 });
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
