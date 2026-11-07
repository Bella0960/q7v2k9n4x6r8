import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.js";
import { isRealUserFriendsConfigured, handleRealUserFriends } from "../worker/real-user-friends.js";
import { sha256Hex } from "../worker/real-user-auth.js";

class FakeD1 {
  constructor() {
    this.schemaReady = true;
    this.friendCodeIndexReady = true;
    this.friendRequestIndexReady = true;
    this.friendLifecycleTriggersReady = true;
    this.accounts = new Map();
    this.sessions = new Map();
    this.codes = new Map();
    this.requests = new Map();
    this.friendships = new Map();
    this.blocks = new Map();
  }

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return db.first(sql, this.values); },
      async all() { return db.all(sql, this.values); },
      async run() { return db.run(sql, this.values); }
    };
  }

  pair(low, high) {
    return low < high ? [low, high] : [high, low];
  }

  async first(sql, values) {
    if (sql.includes("FROM sqlite_master") && sql.includes("ready_tables")) {
      return {
        ready_tables: this.schemaReady ? 4 : 0,
        ready_indexes: Number(this.friendCodeIndexReady) + Number(this.friendRequestIndexReady),
        ready_triggers: this.friendLifecycleTriggersReady ? 8 : 0
      };
    }
    if (sql.includes("FROM sqlite_master")) {
      return { ready: this.schemaReady ? 4 : 0 };
    }
    if (sql.includes("FROM real_user_sessions s JOIN real_user_accounts")) {
      const [tokenHash, now] = values;
      const session = this.sessions.get(tokenHash);
      if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
      const account = this.accounts.get(session.account_id);
      if (!account || account.status !== "active") return null;
      return {
        id: account.id, handle: account.handle, display_name: account.display_name,
        status: account.status, expires_at: session.expires_at
      };
    }
    if (sql.includes("FROM real_user_friend_codes c JOIN real_user_accounts")) {
      const [hash, now] = values;
      const code = this.codes.get(hash);
      if (!code || code.revoked_at !== null || code.expires_at <= now) return null;
      const account = this.accounts.get(code.account_id);
      return account && account.status === "active" ? {
        id: account.id, handle: account.handle,
        display_name: account.display_name, avatar_asset_id: account.avatar_asset_id || null
      } : null;
    }
    if (sql.includes("FROM real_user_friend_requests WHERE id = ?")) {
      const request = this.requests.get(values[0]);
      if (!request) return null;
      if (sql.includes("requester_id = ?")) {
        const [id, owner] = values;
        return request.id === id && request.requester_id === owner ? { status: request.status } : null;
      }
      if (sql.includes("recipient_id = ?")) {
        const [id, owner] = values;
        return request.id === id && request.recipient_id === owner ? { status: request.status } : null;
      }
      return {
        id: request.id, requester_id: request.requester_id, recipient_id: request.recipient_id,
        status: request.status, created_at: request.created_at
      };
    }
    if (sql.includes("FROM real_user_accounts WHERE id = ?")) {
      const account = this.accounts.get(values[0]);
      if (!account) return null;
      if (sql.includes("status = 'active'") && account.status !== "active") return null;
      return {
        id: account.id, handle: account.handle, display_name: account.display_name,
        avatar_asset_id: account.avatar_asset_id || null
      };
    }
    if (sql.includes("FROM real_user_blocks")) {
      const [a, b, c, d] = values;
      return this.blocks.has(a + "|" + b) || this.blocks.has(c + "|" + d) ? { blocked: 1 } : null;
    }
    if (sql.includes("FROM real_user_friendships WHERE pair_low = ? AND pair_high = ?")) {
      const row = this.friendships.get(values[0] + "|" + values[1]);
      return row ? { status: row.status } : null;
    }
    if (sql.includes("FROM real_user_friend_requests WHERE pair_low = ?")) {
      const [low, high] = values;
      const row = Array.from(this.requests.values()).find(r =>
        r.pair_low === low && r.pair_high === high && r.status === "pending"
      );
      return row ? {
        id: row.id, requester_id: row.requester_id, recipient_id: row.recipient_id,
        status: row.status, created_at: row.created_at
      } : null;
    }
    throw new Error("FakeD1 unsupported first query: " + sql);
  }

  async all(sql, values) {
    if (sql.includes("FROM real_user_friend_requests r")) {
      const [currentId, ownerId, limit] = values;
      const ownerColumn = sql.includes("recipient_id = ?") ? "recipient_id" : "requester_id";
      const rows = Array.from(this.requests.values())
        .filter(r => r[ownerColumn] === ownerId && r.status === "pending")
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit)
        .map(r => {
          const peerId = r.requester_id === currentId ? r.recipient_id : r.requester_id;
          const peer = this.accounts.get(peerId);
          return peer ? {
            id: r.id, note: r.note, created_at: r.created_at,
            peer_id: peer.id, handle: peer.handle, display_name: peer.display_name,
            avatar_asset_id: peer.avatar_asset_id || null
          } : null;
        }).filter(Boolean);
      return { results: rows };
    }
    if (sql.includes("FROM real_user_blocks b JOIN real_user_accounts a")) {
      const [ownerId, limit] = values;
      const rows = Array.from(this.blocks.values())
        .filter(block => block.blocker_id === ownerId)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, limit)
        .map(block => {
          const peer = this.accounts.get(block.blocked_id);
          return peer ? {
            id: peer.id,
            handle: peer.handle,
            display_name: peer.display_name,
            avatar_asset_id: peer.avatar_asset_id || null,
            created_at: block.created_at
          } : null;
        }).filter(Boolean);
      return { results: rows };
    }
    if (sql.includes("FROM real_user_friendships f")) {
      const [blockerA, blockerB, caseAccount, lowAccount, highAccount, cursor, limit] = values;
      const rows = Array.from(this.friendships.values())
        .filter(f => f.pair_low === lowAccount || f.pair_high === highAccount)
        .map(f => {
          const peerId = f.pair_low === caseAccount ? f.pair_high : f.pair_low;
          const peer = this.accounts.get(peerId);
          if (!peer || peerId <= cursor) return null;
          const isBlocked = this.blocks.has(blockerA + "|" + peerId) ||
            this.blocks.has(peerId + "|" + blockerB);
          return {
            id: peer.id, handle: peer.handle, display_name: peer.display_name,
            avatar_asset_id: peer.avatar_asset_id || null, account_status: peer.status,
            friendship_status: f.status, accepted_request_id: f.accepted_request_id,
            accepted_at: f.accepted_at, updated_at: f.updated_at,
            is_blocked: isBlocked ? 1 : 0
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
      return { results: rows };
    }
    throw new Error("FakeD1 unsupported all query: " + sql);
  }

  async batch(statements) {
    const snapshot = {
      codes: new Map(this.codes),
      requests: new Map(this.requests),
      friendships: new Map(this.friendships),
      blocks: new Map(this.blocks)
    };
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.codes = snapshot.codes;
      this.requests = snapshot.requests;
      this.friendships = snapshot.friendships;
      this.blocks = snapshot.blocks;
      throw error;
    }
  }

  async run(sql, values) {
    if (sql.includes("UPDATE real_user_friend_codes SET revoked_at")) {
      const [revokedAt, ownerId] = values;
      let count = 0;
      for (const [hash, code] of this.codes) {
        if (code.account_id === ownerId && code.revoked_at === null) {
          this.codes.set(hash, { ...code, revoked_at: revokedAt });
          count += 1;
        }
      }
      return { success: true, meta: { changes: count } };
    }
    if (sql.includes("INSERT INTO real_user_friend_codes")) {
      const [code_hash, account_id, created_at, expires_at] = values;
      if (Array.from(this.codes.values()).some(c => c.account_id === account_id && c.revoked_at === null)) {
        throw new Error("UNIQUE constraint failed: one active code");
      }
      this.codes.set(code_hash, { code_hash, account_id, created_at, expires_at, revoked_at: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO real_user_friend_requests")) {
      const [id, requester_id, recipient_id, pair_low, pair_high, note, created_at, updated_at] = values;
      if (this.requests.has(id)) throw new Error("UNIQUE constraint failed: request id");
      if (Array.from(this.requests.values()).some(r =>
        r.pair_low === pair_low && r.pair_high === pair_high && r.status === "pending"
      )) throw new Error("UNIQUE constraint failed: pending pair");
      if (this.friendships.get(pair_low + "|" + pair_high)?.status === "accepted") {
        throw new Error("real_user_friend_request_must_start_pending");
      }
      if (this.blocks.has(requester_id + "|" + recipient_id) ||
          this.blocks.has(recipient_id + "|" + requester_id)) {
        throw new Error("real_user_friend_request_must_start_pending");
      }
      this.requests.set(id, {
        id, requester_id, recipient_id, pair_low, pair_high, note,
        status: "pending", created_at, updated_at, responded_at: null
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE real_user_friend_requests SET status = ?")) {
      const [status, updatedAt, respondedAt, id, ownerId] = values;
      const request = this.requests.get(id);
      const ownerColumn = sql.includes("requester_id = ?") ? "requester_id" : "recipient_id";
      if (!request || request[ownerColumn] !== ownerId || request.status !== "pending") {
        return { success: true, meta: { changes: 0 } };
      }
      if (status === "accepted" &&
          (this.blocks.has(request.requester_id + "|" + request.recipient_id) ||
           this.blocks.has(request.recipient_id + "|" + request.requester_id))) {
        throw new Error("real_user_friendship_blocked");
      }
      const updated = { ...request, status, updated_at: updatedAt, responded_at: respondedAt };
      this.requests.set(id, updated);
      if (status === "accepted") {
        this.friendships.set(request.pair_low + "|" + request.pair_high, {
          pair_low: request.pair_low, pair_high: request.pair_high, status: "accepted",
          accepted_request_id: request.id, accepted_at: respondedAt, updated_at: updatedAt
        });
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE real_user_friendships SET status = 'removed'")) {
      const [updatedAt, low, high] = values;
      const key = low + "|" + high;
      const friendship = this.friendships.get(key);
      if (!friendship || friendship.status !== "accepted") return { success: true, meta: { changes: 0 } };
      this.friendships.set(key, { ...friendship, status: "removed", updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT OR IGNORE INTO real_user_blocks")) {
      const [blocker, blocked, createdAt] = values;
      const key = blocker + "|" + blocked;
      if (this.blocks.has(key)) return { success: true, meta: { changes: 0 } };
      this.blocks.set(key, { blocker_id: blocker, blocked_id: blocked, created_at: createdAt });
      const [low, high] = this.pair(blocker, blocked);
      const friendship = this.friendships.get(low + "|" + high);
      if (friendship && friendship.status === "accepted") {
        this.friendships.set(low + "|" + high, { ...friendship, status: "removed", updated_at: createdAt });
      }
      for (const [id, row] of this.requests) {
        if (row.pair_low === low && row.pair_high === high && row.status === "pending") {
          this.requests.set(id, {
            ...row,
            status: row.requester_id === blocker ? "cancelled" : "declined",
            updated_at: Math.max(row.updated_at, createdAt),
            responded_at: Math.max(row.created_at, createdAt)
          });
        }
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("DELETE FROM real_user_blocks")) {
      const [blocker, blocked] = values;
      const removed = this.blocks.delete(blocker + "|" + blocked);
      return { success: true, meta: { changes: removed ? 1 : 0 } };
    }
    throw new Error("FakeD1 unsupported run query: " + sql);
  }
}

function makeAccount(db, id, handle, token) {
  db.accounts.set(id, {
    id, handle, display_name: handle.toUpperCase(), status: "active", avatar_asset_id: null
  });
  return token;
}

async function setup(options = {}) {
  const db = new FakeD1();
  db.friendRequestIndexReady = options.noFriendRequestIndex !== true;
  db.friendLifecycleTriggersReady = options.noFriendLifecycleTriggers !== true;
  const tokens = {
    alice: makeAccount(db, "account-alice-001", "alice_01", "a".repeat(64)),
    bob: makeAccount(db, "account-bob-001", "bob_0001", "b".repeat(64)),
    carol: makeAccount(db, "account-carol-01", "carol_01", "c".repeat(64))
  };
  for (const [id, token] of Object.entries(tokens)) {
    const accountId = id === "alice" ? "account-alice-001" :
      id === "bob" ? "account-bob-001" : "account-carol-01";
    db.sessions.set(await sha256Hex(token), {
      token_hash: await sha256Hex(token), session_family_id: "family-" + id + "-012345",
      account_id: accountId, created_at: Date.now() - 1000,
      expires_at: Date.now() + 86400000, last_seen_at: Date.now(), revoked_at: null
    });
  }
  const limiterCalls = [];
  const env = {
    REAL_USER_AUTH_ENABLED: options.authEnabled === false ? "false" : "true",
    REAL_USER_FRIENDS_ENABLED: options.friendsEnabled === false ? "false" : "true",
    DB: options.noDb ? null : db,
    AUTH_LIMITER: options.noLimiter ? null : {
      async limit(input) {
        limiterCalls.push(input.key);
        if (options.limitError) throw new Error("limiter unavailable");
        return { success: options.rateLimited !== true };
      }
    }
  };
  return { db, env, tokens, limiterCalls };
}

function httpRequest(path, method = "GET", body, token, options = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin || "https://mao.example");
  headers.set("CF-Connecting-IP", options.ip || "203.0.113.20");
  if (body !== undefined) headers.set("Content-Type", options.contentType || "application/json");
  if (token) headers.set("Cookie", "__Host-mao_session=" + token);
  return new Request("https://mao.example/api/real-user-chat/v1/friends" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(context, path, method = "GET", body, who = "alice", options = {}) {
  const response = await handleRealUserFriends(
    httpRequest(path, method, body, context.tokens[who], options),
    context.env
  );
  return { response, body: await response.json() };
}

test("friend service stays disabled without its explicit flag and complete schema", async () => {
  for (const options of [
    { friendsEnabled: false },
    { authEnabled: false },
    { noDb: true },
    { noLimiter: true },
    { noFriendRequestIndex: true },
    { noFriendLifecycleTriggers: true }
  ]) {
    const context = await setup(options);
    assert.equal(await isRealUserFriendsConfigured(context.env), false);
    const result = await call(context, "/requests", "GET");
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, "real_user_friends_unavailable");
  }
  const noSchema = await setup();
  noSchema.db.schemaReady = false;
  assert.equal(await isRealUserFriendsConfigured(noSchema.env), false);
  const noRotationIndex = await setup();
  noRotationIndex.db.friendCodeIndexReady = false;
  assert.equal(await isRealUserFriendsConfigured(noRotationIndex.env), false);

  const noPendingPairIndex = await setup({ noFriendRequestIndex: true });
  assert.equal(await isRealUserFriendsConfigured(noPendingPairIndex.env), false);

  const noLifecycleTriggers = await setup({ noFriendLifecycleTriggers: true });
  assert.equal(await isRealUserFriendsConfigured(noLifecycleTriggers.env), false);
});

test("QR rotation returns a short-lived one-time code and revokes the previous code", async () => {
  const context = await setup();
  const first = await call(context, "/codes/rotate", "POST");
  assert.equal(first.response.status, 201);
  assert.match(first.body.code, /^[a-f0-9]{64}$/);
  assert.equal(first.body.qrPayload, "mao://friend/add?code=" + first.body.code);
  assert.equal(first.body.expiresInSeconds, 900);
  const firstHash = await sha256Hex(first.body.code);
  assert.equal(context.db.codes.get(firstHash).revoked_at, null);

  const second = await call(context, "/codes/rotate", "POST");
  assert.equal(second.response.status, 201);
  assert.notEqual(second.body.code, first.body.code);
  assert.ok(context.db.codes.get(firstHash).revoked_at > 0);
  assert.equal(Array.from(context.db.codes.values()).filter(c =>
    c.account_id === "account-alice-001" && c.revoked_at === null
  ).length, 1);
});

test("friend QR codes can be revoked immediately", async () => {
  const context = await setup();
  const code = await call(context, "/codes/rotate", "POST");
  const response = await call(context, "/codes/me", "DELETE");
  assert.equal(response.response.status, 200);
  assert.equal(response.body.revoked, 1);
  const codeHash = await sha256Hex(code.body.code);
  assert.ok(context.db.codes.get(codeHash).revoked_at > 0);
});

test("QR scan creates a server-owned pending request and stores only the QR hash", async () => {
  const context = await setup();
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const result = await call(context, "/requests", "POST", {
    requestId: "request_alice_bob_001", code: qr.body.code, note: "Let's connect"
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.request.status, "pending");
  assert.equal(result.body.target.id, "account-bob-001");
  assert.equal(context.db.requests.size, 1);
  const storedCode = Array.from(context.db.codes.values())[0];
  assert.notEqual(storedCode.code_hash, qr.body.code);
  assert.equal(storedCode.code_hash.length, 64);
});

test("request retries stay idempotent even after the QR code is revoked", async () => {
  const context = await setup();
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const payload = { requestId: "request_retry_alice_01", code: qr.body.code };
  const first = await call(context, "/requests", "POST", payload);
  await call(context, "/codes/me", "DELETE", undefined, "bob");
  const retry = await call(context, "/requests", "POST", payload);
  assert.equal(first.response.status, 201);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.request.id, payload.requestId);
  assert.equal(context.db.requests.size, 1);
});

test("invalid, expired and self-owned QR codes are rejected", async () => {
  const context = await setup();
  const invalid = await call(context, "/requests", "POST", {
    requestId: "request_invalid_001", code: "d".repeat(64)
  });
  assert.equal(invalid.response.status, 404);

  const own = await call(context, "/codes/rotate", "POST");
  const self = await call(context, "/requests", "POST", {
    requestId: "request_selfadd_001", code: own.body.code
  });
  assert.equal(self.response.status, 400);
  assert.equal(self.body.error, "cannot_add_self");

  const expiredHash = await sha256Hex(own.body.code);
  context.db.codes.set(expiredHash, { ...context.db.codes.get(expiredHash), expires_at: Date.now() - 1 });
  const expired = await call(context, "/requests", "POST", {
    requestId: "request_expired_001", code: own.body.code
  }, "bob");
  assert.equal(expired.response.status, 404);
});

test("same-direction duplicate requests are idempotent; reverse duplicates point to incoming request", async () => {
  const context = await setup();
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const payload = { requestId: "request_alice_bob_002", code: qr.body.code };
  const first = await call(context, "/requests", "POST", payload);
  const duplicate = await call(context, "/requests", "POST", {
    requestId: "request_alice_bob_003", code: qr.body.code
  });
  assert.equal(first.response.status, 201);
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.request.id, payload.requestId);

  const reverseQr = await call(context, "/codes/rotate", "POST");
  const reverse = await call(context, "/requests", "POST", {
    requestId: "request_bob_alice_004", code: reverseQr.body.code
  }, "bob");
  assert.equal(reverse.response.status, 409);
  assert.equal(reverse.body.error, "incoming_request_exists");
  assert.equal(reverse.body.requestId, payload.requestId);
});

test("inbox and outbox are scoped to the authenticated account and include current avatar references", async () => {
  const context = await setup();
  const alice = context.db.accounts.get("account-alice-001");
  const bob = context.db.accounts.get("account-bob-001");
  context.db.accounts.set(alice.id, { ...alice, avatar_asset_id: "av_" + "a".repeat(32) });
  context.db.accounts.set(bob.id, { ...bob, avatar_asset_id: "av_" + "b".repeat(32) });
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  await call(context, "/requests", "POST", {
    requestId: "request_box_alice_01", code: qr.body.code, note: "Hello"
  });
  const inbox = await call(context, "/requests?direction=incoming", "GET", undefined, "bob");
  const outbox = await call(context, "/requests?direction=outgoing", "GET");
  assert.equal(inbox.body.requests.length, 1);
  assert.equal(inbox.body.requests[0].peer.handle, "alice_01");
  assert.equal(inbox.body.requests[0].peer.avatarAssetId, "av_" + "a".repeat(32));
  assert.equal(outbox.body.requests.length, 1);
  assert.equal(outbox.body.requests[0].peer.handle, "bob_0001");
  assert.equal(outbox.body.requests[0].peer.avatarAssetId, "av_" + "b".repeat(32));
});

test("only the recipient can accept or decline; accepting creates the friendship", async () => {
  const context = await setup();
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  await call(context, "/requests", "POST", {
    requestId: "request_accept_alice_01", code: qr.body.code
  });
  const wrongActor = await call(context, "/requests/request_accept_alice_01/accept", "POST", undefined, "alice");
  assert.equal(wrongActor.response.status, 404);
  const accepted = await call(context, "/requests/request_accept_alice_01/accept", "POST", undefined, "bob");
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.request.status, "accepted");
  const friendsA = await call(context, "/", "GET", undefined, "alice");
  const friendsB = await call(context, "/", "GET", undefined, "bob");
  assert.equal(friendsA.body.ownerAccountId, "account-alice-001");
  assert.equal(friendsB.body.ownerAccountId, "account-bob-001");
  assert.equal(friendsA.body.friends[0].id, "account-bob-001");
  assert.equal(friendsB.body.friends[0].id, "account-alice-001");
  assert.equal(friendsA.body.friends[0].acceptedRequestId, "request_accept_alice_01");
  assert.equal(friendsA.body.relationships[0].status, "accepted");
  assert.equal(friendsA.body.relationships[0].acceptedRequestId, "request_accept_alice_01");
  assert.ok(friendsA.body.relationships[0].updatedAt > 0);

  // Public profile fields are resolved from the authoritative account row on
  // every list read, not copied into a stale friendship snapshot.
  const bob = context.db.accounts.get("account-bob-001");
  context.db.accounts.set("account-bob-001", { ...bob, display_name: "Bob Renamed" });
  const refreshedFriendsA = await call(context, "/", "GET", undefined, "alice");
  const refreshedFriendsB = await call(context, "/", "GET", undefined, "bob");
  assert.equal(refreshedFriendsA.body.friends[0].displayName, "Bob Renamed");
  assert.equal(refreshedFriendsB.body.friends[0].displayName, "ALICE_01");

  const duplicateAccept = await call(context, "/requests/request_accept_alice_01/accept", "POST", undefined, "bob");
  assert.equal(duplicateAccept.response.status, 409);
});

test("recipient can decline and requester can cancel, but the other side cannot", async () => {
  const context = await setup();
  const qr1 = await call(context, "/codes/rotate", "POST", undefined, "bob");
  await call(context, "/requests", "POST", { requestId: "request_decline_001", code: qr1.body.code });
  const wrongCancel = await call(context, "/requests/request_decline_001/cancel", "POST", undefined, "bob");
  assert.equal(wrongCancel.response.status, 404);
  const declined = await call(context, "/requests/request_decline_001/decline", "POST", undefined, "bob");
  assert.equal(declined.body.request.status, "declined");

  const qr2 = await call(context, "/codes/rotate", "POST", undefined, "bob");
  await call(context, "/requests", "POST", { requestId: "request_cancel_0001", code: qr2.body.code });
  const cancelled = await call(context, "/requests/request_cancel_0001/cancel", "POST", undefined, "alice");
  assert.equal(cancelled.body.request.status, "cancelled");
});

test("friend removal, block and unblock update the authoritative relationship", async () => {
  const context = await setup();
  const qr = await call(context, "/codes/rotate", "POST", undefined, "bob");
  await call(context, "/requests", "POST", { requestId: "request_block_0001", code: qr.body.code });
  await call(context, "/requests/request_block_0001/accept", "POST", undefined, "bob");
  const removed = await call(context, "/account-bob-001", "DELETE");
  assert.equal(removed.body.removed, true);
  const removedRoster = await call(context, "/", "GET");
  assert.equal(removedRoster.body.friends.length, 0);
  assert.equal(removedRoster.body.relationships.length, 1);
  assert.equal(removedRoster.body.relationships[0].status, "removed");
  assert.equal(removedRoster.body.relationships[0].displayName, undefined,
    "removed relationships must not expose private profile fields");
  const readdCode = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const readd = await call(context, "/requests", "POST", { requestId: "request_readd_00001", code: readdCode.body.code });
  assert.equal(readd.response.status, 201);
  await call(context, "/requests/request_readd_00001/accept", "POST", undefined, "bob");
  const bob = context.db.accounts.get("account-bob-001");
  context.db.accounts.set(bob.id, { ...bob, avatar_asset_id: "av_" + "c".repeat(32) });
  const blocked = await call(context, "/account-bob-001/block", "POST");
  assert.equal(blocked.body.blocked, true);
  const blockedList = await call(context, "/", "GET");
  assert.equal(blockedList.body.friends.length, 0);
  const ownBlockList = await call(context, "/blocks", "GET", undefined, "alice");
  const otherBlockList = await call(context, "/blocks", "GET", undefined, "bob");
  assert.deepEqual(ownBlockList.body.blocked.map(item => item.id), ["account-bob-001"]);
  assert.equal(ownBlockList.body.blocked[0].avatarAssetId, "av_" + "c".repeat(32));
  assert.equal(otherBlockList.body.blocked.length, 0);
  const blockedCode = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const blockedRequest = await call(context, "/requests", "POST", {
    requestId: "request_blocked_0001", code: blockedCode.body.code
  });
  assert.equal(blockedRequest.response.status, 403);
  const unblocked = await call(context, "/account-bob-001/block", "DELETE");
  assert.equal(unblocked.body.blocked, false);
  const emptyBlockList = await call(context, "/blocks", "GET");
  assert.equal(emptyBlockList.body.blocked.length, 0);
  const freshCode = await call(context, "/codes/rotate", "POST", undefined, "bob");
  const freshRequest = await call(context, "/requests", "POST", {
    requestId: "request_fresh_001", code: freshCode.body.code
  });
  assert.equal(freshRequest.response.status, 201);
});

test("friend API enforces same-origin, method and rate-limit boundaries", async () => {
  const context = await setup();
  const crossOrigin = await call(context, "/codes/rotate", "POST", undefined, "alice", {
    origin: "https://attacker.example"
  });
  assert.equal(crossOrigin.response.status, 403);

  const rateLimited = await setup({ rateLimited: true });
  const limited = await call(rateLimited, "/codes/rotate", "POST");
  assert.equal(limited.response.status, 429);

  const method = await call(context, "/codes/rotate", "GET");
  assert.equal(method.response.status, 405);
});

test("Worker routes friend APIs separately and keeps messages disabled", async () => {
  const context = await setup();
  const env = {
    ...context.env,
    ASSETS: { async fetch() { return new Response("asset", { status: 200 }); } }
  };
  const capability = await worker.fetch(new Request(
    "https://mao.example/api/real-user-chat/capabilities"
  ), env);
  const capBody = await capability.json();
  assert.equal(capBody.enabled, false);
  assert.equal(capBody.friends.enabled, true);
  assert.equal(capBody.accountAuth.enabled, true);

  const friends = await worker.fetch(httpRequest("/requests", "GET", undefined, context.tokens.alice), env);
  assert.equal(friends.status, 200);
  const messages = await worker.fetch(new Request(
    "https://mao.example/api/real-user-chat/v1/conversations/c1/messages"
  ), env);
  assert.equal(messages.status, 503);
});

test("friend roster uses stable ID cursors and returns relationship tombstones without private fields", async () => {
  const context = await setup();
  const baseId = "account-alice-001";
  const extraIds = ["account-extra-01", "account-extra-02", "account-extra-03", "account-extra-04"];
  extraIds.forEach((id, index) => {
    context.db.accounts.set(id, {
      id, handle: "extra_" + (index + 1), display_name: "Extra " + (index + 1),
      status: "active", avatar_asset_id: null
    });
    const [low, high] = context.db.pair(baseId, id);
    context.db.friendships.set(low + "|" + high, {
      pair_low: low, pair_high: high, status: "accepted",
      accepted_request_id: "request_extra_" + (index + 1),
      accepted_at: 1000 + index, updated_at: 1000 + index
    });
  });
  const first = await call(context, "/?limit=1", "GET");
  assert.equal(first.body.ownerAccountId, "account-alice-001");
  assert.equal(first.body.relationships.length, 1);
  assert.equal(first.body.hasMore, true);
  assert.ok(first.body.nextCursor);

  const second = await call(context,
    "/?limit=1&snapshotAt=" + first.body.snapshotAt + "&after=" + encodeURIComponent(first.body.nextCursor),
    "GET");
  assert.equal(second.body.relationships.length, 1);
  assert.equal(second.body.snapshotAt, first.body.snapshotAt);
  assert.equal(second.body.hasMore, true);

  const third = await call(context,
    "/?limit=1&snapshotAt=" + first.body.snapshotAt + "&after=" + encodeURIComponent(second.body.nextCursor),
    "GET");
  assert.equal(third.body.relationships.length, 1);
  assert.equal(third.body.hasMore, true);

  const fourth = await call(context,
    "/?limit=1&snapshotAt=" + first.body.snapshotAt + "&after=" + encodeURIComponent(third.body.nextCursor),
    "GET");
  assert.equal(fourth.body.relationships.length, 1);
  assert.equal(fourth.body.hasMore, false);
  assert.equal(fourth.body.nextCursor, null);

  const ids = [first, second, third, fourth].flatMap(page => page.body.relationships.map(item => item.id));
  assert.equal(new Set(ids).size, 4);
});

test("friend roster rejects malformed page limits, cursors and snapshot timestamps", async () => {
  const context = await setup();
  assert.equal((await call(context, "/?limit=101", "GET")).body.error, "invalid_friend_page_limit");
  assert.equal((await call(context, "/?after=bad", "GET")).body.error, "invalid_friend_cursor");
  assert.equal((await call(context, "/?snapshotAt=99999999999999999", "GET")).body.error, "invalid_friend_snapshot");
});

test("friend rows changed during pagination remain visible instead of being mistaken for missing relationships", async () => {
  const context = await setup();
  const ownerId = "account-alice-001";
  const peerIds = ["account-peer-01", "account-peer-02", "account-peer-03"];
  peerIds.forEach((id, index) => {
    context.db.accounts.set(id, {
      id, handle: "peer_" + index, display_name: "Peer " + index,
      status: "active", avatar_asset_id: null
    });
    const [low, high] = context.db.pair(ownerId, id);
    context.db.friendships.set(low + "|" + high, {
      pair_low: low, pair_high: high, status: "accepted",
      accepted_request_id: "request_peer_" + index,
      accepted_at: Date.now() - 1000,
      updated_at: Date.now() - 900
    });
  });

  const first = await call(context, "/?limit=1", "GET");
  assert.equal(first.body.hasMore, true);
  const cursor = first.body.nextCursor;
  const changedId = peerIds.find(id => id > cursor);
  assert.ok(changedId, "fixture must include a relationship after the first-page cursor");
  const [low, high] = context.db.pair(ownerId, changedId);
  const key = low + "|" + high;
  const row = context.db.friendships.get(key);
  context.db.friendships.set(key, {
    ...row,
    status: "removed",
    updated_at: first.body.snapshotAt + 1000
  });

  const second = await call(
    context,
    "/?limit=1&snapshotAt=" + first.body.snapshotAt + "&after=" + encodeURIComponent(cursor),
    "GET"
  );
  assert.equal(second.body.snapshotAt, first.body.snapshotAt);
  const updated = second.body.relationships.find(item => item.id === changedId);
  assert.ok(updated, "the changed relationship must not vanish from a later page");
  assert.equal(updated.status, "removed");
});
