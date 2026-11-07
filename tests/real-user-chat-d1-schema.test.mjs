import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/0001_real_user_chat.sql", import.meta.url),
  "utf8"
);

function tableBlock(name) {
  const start = migration.indexOf("CREATE TABLE IF NOT EXISTS " + name);
  assert.ok(start >= 0, "missing table: " + name);
  const end = migration.indexOf("\n);", start);
  assert.ok(end > start, "unterminated table: " + name);
  return migration.slice(start, end + 3);
}

test("schema creates separate account, session, friend, conversation, attachment and message tables", () => {
  for (const table of [
    "real_user_accounts",
    "real_user_sessions",
    "real_user_friend_codes",
    "real_user_friend_requests",
    "real_user_friendships",
    "real_user_blocks",
    "real_user_conversations",
    "real_user_attachments",
    "real_user_messages",
    "real_user_message_receipts"
  ]) {
    assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS " + table), table);
  }
});

test("account handles and password verifiers are constrained and sessions store only token hashes", () => {
  const accounts = tableBlock("real_user_accounts");
  const sessions = tableBlock("real_user_sessions");
  assert.match(accounts, /handle TEXT NOT NULL COLLATE NOCASE UNIQUE/);
  assert.match(accounts, /password_hash TEXT NOT NULL/);
  assert.match(accounts, /password_salt TEXT NOT NULL/);
  assert.match(accounts, /password_iterations BETWEEN 100000 AND 1000000/);
  assert.match(sessions, /token_hash TEXT PRIMARY KEY NOT NULL/);
  assert.doesNotMatch(sessions, /token TEXT\s/i);
});

test("QR friend codes persist only one-way hashes and have expiry/revocation fields", () => {
  const codes = tableBlock("real_user_friend_codes");
  assert.match(codes, /code_hash TEXT PRIMARY KEY NOT NULL/);
  assert.match(codes, /expires_at INTEGER/);
  assert.match(codes, /revoked_at INTEGER/);
  assert.doesNotMatch(codes, /raw_code|qr_payload|session_token/i);
});

test("pending friend requests are unique for an unordered account pair", () => {
  const requests = tableBlock("real_user_friend_requests");
  assert.match(requests, /pair_low < pair_high/);
  assert.match(requests, /requester_id <> recipient_id/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_real_user_friend_requests_pending_pair[\s\S]*?WHERE status = 'pending'/);
});

test("messages allow ordinary communication types only and enforce idempotency", () => {
  const messages = tableBlock("real_user_messages");
  assert.match(messages, /type IN \('text', 'image', 'file', 'voice', 'sticker'\)/);
  assert.match(messages, /UNIQUE \(conversation_id, sender_id, client_message_id\)/);
  assert.match(messages, /length\(trim\(text_body\)\) BETWEEN 1 AND 5000/);
  assert.match(messages, /caption IS NULL OR length\(caption\) <= 240/);
  for (const forbidden of ["redpacket", "transfer", "payment", "wallet", "transaction"]) {
    assert.doesNotMatch(messages, new RegExp(forbidden, "i"));
  }
});

test("friendship, block and attachment guards are enforced in the database", () => {
  assert.match(migration, /trg_real_user_conversation_friend_guard/);
  assert.match(migration, /trg_real_user_message_friend_guard/);
  assert.match(migration, /trg_real_user_message_attachment_guard/);
  assert.match(migration, /trg_real_user_receipt_recipient_guard/);
  assert.match(migration, /real_user_friendship_not_active/);
  assert.match(migration, /real_user_conversation_not_authorized/);
  assert.match(migration, /real_user_attachment_not_authorized/);
});

test("read receipts cannot be claimed before delivery or by the sender", () => {
  const receipts = tableBlock("real_user_message_receipts");
  assert.match(receipts, /read_at IS NULL OR \(read_at > 0 AND delivered_at IS NOT NULL AND read_at >= delivered_at\)/);
  assert.match(migration, /real_user_receipt_recipient_invalid/);
  assert.match(migration, /NEW.recipient_id = c.pair_high/);
  assert.match(migration, /NEW.recipient_id = c.pair_low/);
});

test("binary attachments have server ownership, conversation scope and bounded metadata", () => {
  const attachments = tableBlock("real_user_attachments");
  assert.match(attachments, /owner_account_id TEXT NOT NULL/);
  assert.match(attachments, /object_key TEXT NOT NULL UNIQUE/);
  assert.match(attachments, /byte_size BETWEEN 1 AND 26214400/);
  assert.match(attachments, /state IN \('staged', 'shared', 'deleted'\)/);
});

test("migration does not create payment, transfer, wallet or transaction storage", () => {
  for (const forbidden of [
    "real_user_payments",
    "real_user_transfers",
    "real_user_wallets",
    "real_user_transactions",
    "real_user_red_packets"
  ]) {
    assert.doesNotMatch(migration, new RegExp("CREATE TABLE IF NOT EXISTS " + forbidden, "i"));
  }
});


test("friendship rows must originate from accepted requests and blocked pairs are removed", () => {
  const friendships = tableBlock("real_user_friendships");
  assert.match(friendships, /accepted_request_id TEXT NOT NULL REFERENCES real_user_friend_requests\(id\) ON DELETE CASCADE/);
  assert.match(migration, /trg_real_user_friendship_source_guard/);
  assert.match(migration, /real_user_friendship_requires_accepted_request/);
  assert.match(migration, /trg_real_user_friend_request_accepted/);
  assert.match(migration, /trg_real_user_block_removes_friendship/);
  assert.match(migration, /trg_real_user_friend_request_accept_guard/);
});

test("friend requests can only be created pending and cannot be replayed from terminal states", () => {
  assert.match(migration, /trg_real_user_friend_request_insert_guard/);
  assert.match(migration, /real_user_friend_request_must_start_pending/);
  assert.match(migration, /trg_real_user_friend_request_transition_guard/);
  assert.match(migration, /OLD\.status <> 'pending'/);
  assert.match(migration, /NEW\.status NOT IN \('accepted', 'declined', 'cancelled'\)/);
  assert.match(migration, /real_user_friend_request_transition_invalid/);
});

test("message content is immutable and receipt timestamps cannot move backwards", () => {
  assert.match(migration, /trg_real_user_message_immutable/);
  assert.match(migration, /real_user_message_immutable/);
  assert.match(migration, /trg_real_user_receipt_monotonic/);
  assert.match(migration, /real_user_receipt_not_monotonic/);
});


test("new requests are blocked for accepted or blocked pairs", () => {
  const insertGuard = migration.slice(
    migration.indexOf("CREATE TRIGGER IF NOT EXISTS trg_real_user_friend_request_insert_guard"),
    migration.indexOf("CREATE TRIGGER IF NOT EXISTS trg_real_user_friend_request_transition_guard")
  );
  assert.match(insertGuard, /real_user_friendships/);
  assert.match(insertGuard, /status = 'accepted'/);
  assert.match(insertGuard, /real_user_blocks/);
  assert.match(insertGuard, /real_user_friend_request_must_start_pending/);
});

test("blocking terminates pending requests and removed friendships require a fresh request to reactivate", () => {
  assert.match(migration, /trg_real_user_block_terminates_pending_requests/);
  assert.match(migration, /trg_real_user_block_removes_friendship/);
  assert.match(migration, /OLD\.status = 'removed' AND NEW\.status = 'accepted'/);
  assert.match(migration, /NEW\.accepted_request_id = OLD\.accepted_request_id/);
});


test("schema v2 enforces only one unrevoked QR friend code per account", () => {
  const migrationV2 = readFileSync(
    new URL("../migrations/0002_real_user_friend_code_rotation.sql", import.meta.url),
    "utf8"
  );
  assert.match(migrationV2, /CREATE UNIQUE INDEX IF NOT EXISTS idx_real_user_friend_codes_one_unrevoked_per_account/);
  assert.match(migrationV2, /ON real_user_friend_codes\(account_id\)/);
  assert.match(migrationV2, /WHERE revoked_at IS NULL/);
});
