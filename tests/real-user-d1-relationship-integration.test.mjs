import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sqlite = await import("node:sqlite").catch(() => null);
const DatabaseSync = sqlite && sqlite.DatabaseSync;
const migrationV1 = readFileSync(new URL("../migrations/0001_real_user_chat.sql", import.meta.url), "utf8");
const migrationV2 = readFileSync(new URL("../migrations/0002_real_user_friend_code_rotation.sql", import.meta.url), "utf8");

function createDatabase() {
  if (!DatabaseSync) throw new Error("node:sqlite is unavailable; run this integration suite with Node 22.5 or newer.");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migrationV1);
  db.exec(migrationV2);
  return db;
}

function addAccount(db, id, handle, displayName) {
  db.prepare(
    "INSERT INTO real_user_accounts (" +
    "id, handle, display_name, password_hash, password_salt, password_iterations, created_at, updated_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, handle, displayName, "a".repeat(64), "b".repeat(32), 600000, 1000, 1000);
}

function addRequest(db, id, requesterId, recipientId, createdAt) {
  const [pairLow, pairHigh] = requesterId < recipientId
    ? [requesterId, recipientId]
    : [recipientId, requesterId];
  db.prepare(
    "INSERT INTO real_user_friend_requests (" +
    "id, requester_id, recipient_id, pair_low, pair_high, note, status, created_at, updated_at, responded_at" +
    ") VALUES (?, ?, ?, ?, ?, '', 'pending', ?, ?, NULL)"
  ).run(id, requesterId, recipientId, pairLow, pairHigh, createdAt, createdAt);
}

function acceptRequest(db, requestId, recipientId, now) {
  return db.prepare(
    "UPDATE real_user_friend_requests " +
    "SET status = 'accepted', updated_at = ?, responded_at = ? " +
    "WHERE id = ? AND recipient_id = ? AND status = 'pending'"
  ).run(now, now, requestId, recipientId);
}

function listFriend(db, ownerId, peerId) {
  return db.prepare(
    "SELECT a.id, a.handle, a.display_name, a.avatar_asset_id, " +
    "f.status AS friendship_status, f.accepted_request_id, f.accepted_at, f.updated_at " +
    "FROM real_user_friendships f " +
    "JOIN real_user_accounts a ON a.id = CASE WHEN f.pair_low = ? THEN f.pair_high ELSE f.pair_low END " +
    "WHERE (f.pair_low = ? OR f.pair_high = ?) AND a.id = ?"
  ).get(ownerId, ownerId, ownerId, peerId) || null;
}

function assertFriendAbsent(db, ownerId, peerId) {
  const row = listFriend(db, ownerId, peerId);
  assert.ok(!row || row.friendship_status !== "accepted");
}

test("real-user D1 migrations execute against SQLite and create the guarded friend schema", {
  skip: !DatabaseSync
}, () => {
  const db = createDatabase();
  try {
    const tables = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (" +
      "'real_user_accounts', 'real_user_friend_requests', 'real_user_friendships', 'real_user_blocks')"
    ).get();
    const triggers = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN (" +
      "'trg_real_user_friend_request_accepted', 'trg_real_user_block_removes_friendship', " +
      "'trg_real_user_block_terminates_pending_requests')"
    ).get();
    const indexes = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN (" +
      "'idx_real_user_friend_requests_pending_pair', " +
      "'idx_real_user_friend_codes_one_unrevoked_per_account')"
    ).get();
    assert.equal(tables.count, 4);
    assert.equal(triggers.count, 3);
    assert.equal(indexes.count, 2);
  } finally {
    db.close();
  }
});

test("two-account acceptance and profile rename are resolved from the live account row", {
  skip: !DatabaseSync
}, () => {
  const db = createDatabase();
  try {
    addAccount(db, "account-alice-01", "alice_01", "Alice");
    addAccount(db, "account-bob-001", "bob_0001", "Bob");
    addAccount(db, "account-carol-01", "carol_01", "Carol");

    addRequest(db, "request_alice_bob_01", "account-alice-01", "account-bob-001", 1100);
    const accepted = acceptRequest(db, "request_alice_bob_01", "account-bob-001", 1200);
    assert.equal(accepted.changes, 1);

    const aliceView = listFriend(db, "account-alice-01", "account-bob-001");
    const bobView = listFriend(db, "account-bob-001", "account-alice-01");
    assert.equal(aliceView.friendship_status, "accepted");
    assert.equal(bobView.friendship_status, "accepted");
    assert.equal(aliceView.accepted_request_id, "request_alice_bob_01");
    assertFriendAbsent(db, "account-carol-01", "account-bob-001");

    db.prepare("UPDATE real_user_accounts SET display_name = ?, avatar_asset_id = ? WHERE id = ?")
      .run("Bob Renamed", "av_" + "c".repeat(32), "account-bob-001");
    const refreshed = listFriend(db, "account-alice-01", "account-bob-001");
    assert.equal(refreshed.display_name, "Bob Renamed");
    assert.equal(refreshed.avatar_asset_id, "av_" + "c".repeat(32));
  } finally {
    db.close();
  }
});

test("removal creates a tombstone and only a fresh request ID can restore the friendship", {
  skip: !DatabaseSync
}, () => {
  const db = createDatabase();
  try {
    addAccount(db, "account-alice-02", "alice_02", "Alice");
    addAccount(db, "account-bob-002", "bob_0002", "Bob");
    addRequest(db, "request_first_002", "account-alice-02", "account-bob-002", 2100);
    assert.equal(acceptRequest(db, "request_first_002", "account-bob-002", 2200).changes, 1);

    db.prepare(
      "UPDATE real_user_friendships SET status = 'removed', updated_at = ? " +
      "WHERE pair_low = ? AND pair_high = ? AND status = 'accepted'"
    ).run(2300, "account-alice-02", "account-bob-002");
    assert.equal(listFriend(db, "account-alice-02", "account-bob-002").friendship_status, "removed");

    assert.equal(acceptRequest(db, "request_first_002", "account-bob-002", 2400).changes, 0);
    addRequest(db, "request_fresh_002", "account-bob-002", "account-alice-02", 2500);
    assert.equal(acceptRequest(db, "request_fresh_002", "account-alice-02", 2600).changes, 1);

    const restored = listFriend(db, "account-alice-02", "account-bob-002");
    assert.equal(restored.friendship_status, "accepted");
    assert.equal(restored.accepted_request_id, "request_fresh_002");
    assert.equal(restored.accepted_at, 2600);
  } finally {
    db.close();
  }
});

test("blocking removes accepted friends and terminates pending requests in the database", {
  skip: !DatabaseSync
}, () => {
  const db = createDatabase();
  try {
    addAccount(db, "account-alice-03", "alice_03", "Alice");
    addAccount(db, "account-bob-003", "bob_0003", "Bob");
    addAccount(db, "account-carol-03", "carol_03", "Carol");

    addRequest(db, "request_blocked_pair_03", "account-alice-03", "account-bob-003", 3100);
    assert.equal(acceptRequest(db, "request_blocked_pair_03", "account-bob-003", 3200).changes, 1);
    db.prepare("INSERT INTO real_user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
      .run("account-alice-03", "account-bob-003", 3300);
    assertFriendAbsent(db, "account-alice-03", "account-bob-003");
    assert.equal(listFriend(db, "account-alice-03", "account-bob-003").friendship_status, "removed");

    addRequest(db, "request_pending_block_03", "account-alice-03", "account-carol-03", 3400);
    db.prepare("INSERT INTO real_user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
      .run("account-alice-03", "account-carol-03", 3500);
    const pending = db.prepare("SELECT status, responded_at FROM real_user_friend_requests WHERE id = ?")
      .get("request_pending_block_03");
    assert.equal(pending.status, "cancelled");
    assert.ok(pending.responded_at >= 3500);
    assert.equal(acceptRequest(db, "request_pending_block_03", "account-carol-03", 3600).changes, 0);
  } finally {
    db.close();
  }
});

test("the D1 pending-pair uniqueness and friendship trigger reject duplicate or unauthorized lifecycle writes", {
  skip: !DatabaseSync
}, () => {
  const db = createDatabase();
  try {
    addAccount(db, "account-alice-04", "alice_04", "Alice");
    addAccount(db, "account-bob-004", "bob_0004", "Bob");
    addRequest(db, "request_pending_004", "account-alice-04", "account-bob-004", 4100);
    assert.throws(
      () => addRequest(db, "request_duplicate_004", "account-bob-004", "account-alice-04", 4200),
      /UNIQUE constraint failed/
    );
    assert.throws(() => db.prepare(
      "INSERT INTO real_user_friendships " +
      "(pair_low, pair_high, status, accepted_request_id, accepted_at, updated_at) " +
      "VALUES (?, ?, 'accepted', ?, ?, ?)"
    ).run("account-alice-04", "account-bob-004", "request_pending_004", 4300, 4300),
    /real_user_friendship_requires_accepted_request/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM real_user_friendships").get().count, 0);
  } finally {
    db.close();
  }
});
