import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256Hex } from "../worker/real-user-auth.js";
import { handleRealUserFriends, isRealUserFriendsConfigured } from "../worker/real-user-friends.js";
import worker from "../worker.js";

const sqlite = await import("node:sqlite").catch(() => null);
const DatabaseSync = sqlite && sqlite.DatabaseSync;
const migrationV1 = readFileSync(new URL("../migrations/0001_real_user_chat.sql", import.meta.url), "utf8");
const migrationV2 = readFileSync(new URL("../migrations/0002_real_user_friend_code_rotation.sql", import.meta.url), "utf8");

function createDatabase() {
  if (!DatabaseSync) {
    throw new Error("This integration suite requires Node.js 22.5+ with node:sqlite enabled.");
  }
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migrationV1);
  database.exec(migrationV2);
  return database;
}

// Cloudflare D1's small API surface used by the Worker. The SQL itself is not
// mocked: every statement and trigger executes in the in-memory SQLite engine.
function createD1Adapter(database, options = {}) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async first() {
          if (options.beforeSessionLookup &&
              sql.includes("FROM real_user_sessions s JOIN real_user_accounts")) {
            await options.beforeSessionLookup();
          }
          const row = database.prepare(sql).get(...values) || null;
          if (options.afterPendingPairRead &&
              sql.includes("FROM real_user_friend_requests WHERE pair_low = ?") &&
              sql.includes("status = 'pending'")) {
            await options.afterPendingPairRead(row);
          }
          return row;
        },
        all() {
          return { results: database.prepare(sql).all(...values) };
        },
        async run() {
          if (options.beforeRun) await options.beforeRun(sql, values);
          const result = database.prepare(sql).run(...values);
          if (options.afterRun) await options.afterRun(sql, values, result);
          return { success: true, meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  };
}



function cookieFrom(response) {
  const match = String(response.headers.get("set-cookie") || "")
    .match(/__Host-mao_session=([a-f0-9]{64})/);
  return match ? "__Host-mao_session=" + match[1] : "";
}

async function callWorker(env, path, method, options = {}) {
  const headers = new Headers({
    Origin: "https://mao.example",
    "CF-Connecting-IP": options.ip || "198.51.100.24"
  });
  if (options.cookie) {
    const suppliedCookie = String(options.cookie);
    headers.set(
      "Cookie",
      suppliedCookie.startsWith("__Host-mao_session=")
        ? suppliedCookie
        : "__Host-mao_session=" + suppliedCookie
    );
  }
  let body;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set("Content-Type", "application/json");
  }
  const request = new Request("https://mao.example" + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body })
  });
  const response = await worker.fetch(request, env);
  return { response, body: await response.json() };
}

function addAccount(database, id, handle, displayName, now) {
  database.prepare(
    "INSERT INTO real_user_accounts (" +
    "id, handle, display_name, password_hash, password_salt, password_iterations, created_at, updated_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, handle, displayName, "a".repeat(64), "b".repeat(32), 600000, now, now);
}

async function addSession(database, accountId, token, now) {
  database.prepare(
    "INSERT INTO real_user_sessions (" +
    "token_hash, session_family_id, account_id, created_at, expires_at, last_seen_at" +
    ") VALUES (?, ?, ?, ?, ?, ?)"
  ).run(await sha256Hex(token), "family_" + accountId, accountId, now, now + 86400000, now);
}

function addPendingRequest(database, id, requesterId, recipientId, now) {
  const [pairLow, pairHigh] = requesterId < recipientId
    ? [requesterId, recipientId]
    : [recipientId, requesterId];
  database.prepare(
    "INSERT INTO real_user_friend_requests (" +
    "id, requester_id, recipient_id, pair_low, pair_high, note, status, created_at, updated_at, responded_at" +
    ") VALUES (?, ?, ?, ?, ?, '', 'pending', ?, ?, NULL)"
  ).run(id, requesterId, recipientId, pairLow, pairHigh, now, now);
}

function createEnvironment(database, adapterOptions = {}) {
  return {
    REAL_USER_AUTH_ENABLED: "true",
    REAL_USER_FRIENDS_ENABLED: "true",
    DB: createD1Adapter(database, adapterOptions),
    AUTH_LIMITER: { async limit() { return { success: true }; } }
  };
}

function createMutationGate(actions) {
  const expected = new Set(actions);
  const arrived = new Set();
  const releases = new Map();
  const completionResolvers = new Map();
  const completionPromises = new Map();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  for (const action of expected) {
    let release;
    releases.set(action, new Promise(resolve => { release = resolve; }));
    releases.set(action + ":release", release);
    let complete;
    completionPromises.set(action, new Promise(resolve => { complete = resolve; }));
    completionResolvers.set(action, complete);
  }

  function actionFor(sql) {
    if (sql.startsWith("UPDATE real_user_friend_requests SET status = ?")) return "accept";
    if (sql.startsWith("INSERT OR IGNORE INTO real_user_blocks")) return "block";
    if (sql.startsWith("DELETE FROM real_user_blocks WHERE blocker_id = ?")) return "unblock";
    if (sql.startsWith("UPDATE real_user_friendships SET status = 'removed'")) return "remove";
    return "";
  }

  return {
    async beforeRun(sql) {
      const action = actionFor(sql);
      if (!expected.has(action)) return;
      arrived.add(action);
      if (arrived.size === expected.size) readyResolve();
      await releases.get(action);
    },
    afterRun(sql) {
      const action = actionFor(sql);
      if (expected.has(action)) completionResolvers.get(action)();
    },
    waitUntilReady() { return ready; },
    release(action) { releases.get(action + ":release")(); },
    waitUntilComplete(action) { return completionPromises.get(action); }
  };
}

async function seedRacePair(suffix) {
  const database = createDatabase();
  const env = createEnvironment(database);
  const now = Date.now() - 10000;
  const aliceId = "account-race-a-" + suffix;
  const bobId = "account-race-b-" + suffix;
  const aliceToken = "a".repeat(64);
  const bobToken = "b".repeat(64);
  addAccount(database, aliceId, "racea_" + suffix, "Race Alice", now);
  addAccount(database, bobId, "raceb_" + suffix, "Race Bob", now);
  await addSession(database, aliceId, aliceToken, now);
  await addSession(database, bobId, bobToken, now);
  return {
    database,
    env,
    aliceId,
    bobId,
    aliceToken,
    bobToken,
    pair: aliceId < bobId ? [aliceId, bobId] : [bobId, aliceId]
  };
}

function createReadBarrier(parties) {
  let arrived = 0;
  let release;
  const opened = new Promise(resolve => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await opened;
  };
}

async function callFriends(env, path, method, token) {
  const request = new Request("https://mao.example/api/real-user-chat/v1/friends" + path, {
    method,
    headers: {
      Cookie: "__Host-mao_session=" + token,
      Origin: "https://mao.example",
      "CF-Connecting-IP": "192.0.2.10"
    }
  });
  const response = await handleRealUserFriends(request, env);
  return { response, body: await response.json() };
}

if (!DatabaseSync) {
  test("Node runtime must provide node:sqlite for real-user D1 Worker integration", () => {
    assert.fail("Run this suite with Node.js 22.5 or newer; silently skipping database integration is not allowed.");
  });
} else {
  test("actual friend Worker routes execute against migrated SQLite/D1 and preserve account, paging and lifecycle boundaries", async () => {
    const database = createDatabase();
    try {
      const seedTime = Date.now() - 10000;
      const ids = {
        alice: "account-alice-01",
        bob: "account-bob-0001",
        carol: "account-carol-01",
        dave: "account-dave-001",
        erin: "account-erin-01"
      };
      const tokens = {
        alice: "a".repeat(64),
        bob: "b".repeat(64),
        carol: "c".repeat(64),
        dave: "d".repeat(64),
        erin: "e".repeat(64)
      };
      [
        [ids.alice, "alice_01", "Alice"],
        [ids.bob, "bob_0001", "Bob"],
        [ids.carol, "carol_01", "Carol"],
        [ids.dave, "dave_001", "Dave"],
        [ids.erin, "erin_001", "Erin"]
      ].forEach(([id, handle, name]) => addAccount(database, id, handle, name, seedTime));
      for (const name of Object.keys(ids)) {
        await addSession(database, ids[name], tokens[name], seedTime);
      }

      const env = createEnvironment(database);
      assert.equal(await isRealUserFriendsConfigured(env), true,
        "the real migrations must satisfy the exact schema gate used by the Worker");

      // Accept three friendships through the actual authenticated Worker route.
      const acceptedPairs = [
        ["request_alice_bob_001", "alice", "bob"],
        ["request_alice_carol_01", "alice", "carol"],
        ["request_alice_dave_01", "alice", "dave"]
      ];
      for (const [requestId, requester, recipient] of acceptedPairs) {
        addPendingRequest(database, requestId, ids[requester], ids[recipient], seedTime + 1);
        const accepted = await callFriends(
          env, "/requests/" + requestId + "/accept", "POST", tokens[recipient]
        );
        assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
        assert.equal(accepted.body.request.status, "accepted");
      }

      // The real listFriends SQL, owner binding, ID cursor and snapshot marker
      // must produce complete, non-overlapping pages.
      const snapshotAt = Date.now();
      const first = await callFriends(env, "/?limit=1&snapshotAt=" + snapshotAt, "GET", tokens.alice);
      assert.equal(first.response.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.ownerAccountId, ids.alice);
      assert.equal(first.body.friends.length, 1);
      assert.equal(first.body.friends[0].id, ids.bob);
      assert.equal(first.body.hasMore, true);
      assert.equal(first.body.nextCursor, ids.bob);

      const second = await callFriends(
        env,
        "/?limit=1&after=" + encodeURIComponent(first.body.nextCursor) + "&snapshotAt=" + snapshotAt,
        "GET",
        tokens.alice
      );
      assert.equal(second.response.status, 200, JSON.stringify(second.body));
      assert.equal(second.body.friends.length, 1);
      assert.equal(second.body.friends[0].id, ids.carol);
      assert.notEqual(second.body.friends[0].id, first.body.friends[0].id);

      const third = await callFriends(
        env,
        "/?limit=1&after=" + encodeURIComponent(second.body.nextCursor) + "&snapshotAt=" + snapshotAt,
        "GET",
        tokens.alice
      );
      assert.equal(third.response.status, 200, JSON.stringify(third.body));
      assert.equal(third.body.friends[0].id, ids.dave);
      assert.equal(third.body.hasMore, false);

      // Profile fields are joined from the current account row, not copied into
      // a friendship snapshot.
      database.prepare("UPDATE real_user_accounts SET display_name = ? WHERE id = ?")
        .run("Bob Renamed", ids.bob);
      const renamed = await callFriends(env, "/?limit=1&snapshotAt=" + Date.now(), "GET", tokens.alice);
      assert.equal(renamed.body.friends[0].displayName, "Bob Renamed");

      // Removal remains a relationship tombstone and strips private profile fields.
      const removed = await callFriends(env, "/" + ids.bob, "DELETE", tokens.alice);
      assert.equal(removed.response.status, 200);
      assert.equal(removed.body.removed, true);
      const tombstone = await callFriends(env, "/?limit=1&snapshotAt=" + Date.now(), "GET", tokens.alice);
      assert.equal(tombstone.body.friends.length, 0);
      assert.equal(tombstone.body.relationships[0].status, "removed");
      assert.equal(tombstone.body.relationships[0].id, ids.bob);
      assert.equal("displayName" in tombstone.body.relationships[0], false);
      assert.equal("avatarAssetId" in tombstone.body.relationships[0], false);

      // A new request ID can restore a removed friendship; the old request cannot.
      addPendingRequest(database, "request_alice_bob_002", ids.alice, ids.bob, Date.now());
      const reaccepted = await callFriends(
        env, "/requests/request_alice_bob_002/accept", "POST", tokens.bob
      );
      assert.equal(reaccepted.response.status, 200, JSON.stringify(reaccepted.body));
      const restored = await callFriends(env, "/?limit=1&snapshotAt=" + Date.now(), "GET", tokens.alice);
      assert.equal(restored.body.friends[0].id, ids.bob);
      assert.equal(restored.body.friends[0].acceptedRequestId, "request_alice_bob_002");

      // Blocking revokes an accepted friendship at the database trigger layer.
      const blocked = await callFriends(env, "/" + ids.bob + "/block", "POST", tokens.alice);
      assert.equal(blocked.response.status, 200);
      const blockedRoster = await callFriends(env, "/?limit=1&snapshotAt=" + Date.now(), "GET", tokens.alice);
      assert.equal(blockedRoster.body.friends.length, 0);
      assert.equal(blockedRoster.body.relationships[0].status, "removed");
      assert.equal("displayName" in blockedRoster.body.relationships[0], false);

      // Blocking a pending pair terminates the request, so a later accept cannot revive it.
      addPendingRequest(database, "request_alice_erin_01", ids.alice, ids.erin, Date.now());
      const pendingBlock = await callFriends(env, "/" + ids.erin + "/block", "POST", tokens.alice);
      assert.equal(pendingBlock.response.status, 200);
      const pendingRow = database.prepare(
        "SELECT status, responded_at FROM real_user_friend_requests WHERE id = ?"
      ).get("request_alice_erin_01");
      assert.equal(pendingRow.status, "cancelled");
      assert.ok(pendingRow.responded_at > 0);
      const staleAccept = await callFriends(
        env, "/requests/request_alice_erin_01/accept", "POST", tokens.erin
      );
      assert.equal(staleAccept.response.status, 409);
      assert.equal(staleAccept.body.status, "cancelled");

      // A different authenticated account must see only its own relationship set.
      const carolRoster = await callFriends(env, "/?limit=10&snapshotAt=" + Date.now(), "GET", tokens.carol);
      assert.equal(carolRoster.response.status, 200);
      assert.equal(carolRoster.body.ownerAccountId, ids.carol);
      assert.equal(carolRoster.body.friends.length, 1);
      assert.equal(carolRoster.body.friends[0].id, ids.alice);
    } finally {
      database.close();
    }
  });

  test("friend capability gate fails closed when any required lifecycle trigger is missing", async () => {
    const database = createDatabase();
    try {
      const env = createEnvironment(database);
      assert.equal(await isRealUserFriendsConfigured(env), true);
      database.exec("DROP TRIGGER trg_real_user_friend_request_accept_guard");
      assert.equal(await isRealUserFriendsConfigured(env), false);
    } finally {
      database.close();
    }
  });

  test("two independently registered accounts complete the real auth and friend lifecycle through the Worker router", async () => {
    const database = createDatabase();
    try {
      const env = createEnvironment(database);
      const authPrefix = "/api/real-user-chat/v1/auth";
      const friendsPrefix = "/api/real-user-chat/v1/friends";

      const aliceRegistration = await callWorker(env, authPrefix + "/register", "POST", {
        body: {
          handle: "alice_e2e",
          displayName: "Alice E2E",
          password: "alice secure passphrase 2026"
        }
      });
      assert.equal(aliceRegistration.response.status, 201, JSON.stringify(aliceRegistration.body));
      const aliceCookie = cookieFrom(aliceRegistration.response);
      assert.match(aliceCookie, /^__Host-mao_session=[a-f0-9]{64}$/);
      assert.match(aliceRegistration.response.headers.get("set-cookie") || "", /HttpOnly; Secure; SameSite=Strict$/);
      assert.equal(aliceRegistration.response.headers.get("cache-control"), "no-store, max-age=0");

      const bobRegistration = await callWorker(env, authPrefix + "/register", "POST", {
        body: {
          handle: "bob_e2e",
          displayName: "Bob E2E",
          password: "bob secure passphrase 2026"
        }
      });
      assert.equal(bobRegistration.response.status, 201, JSON.stringify(bobRegistration.body));
      const bobCookie = cookieFrom(bobRegistration.response);
      assert.match(bobCookie, /^__Host-mao_session=[a-f0-9]{64}$/);
      const aliceId = aliceRegistration.body.account.id;
      const bobId = bobRegistration.body.account.id;
      assert.notEqual(aliceId, bobId);

      const aliceSessionHash = await sha256Hex(aliceCookie.slice("__Host-mao_session=".length));
      const bobSessionHash = await sha256Hex(bobCookie.slice("__Host-mao_session=".length));
      assert.ok(database.prepare("SELECT token_hash FROM real_user_sessions WHERE token_hash = ?")
        .get(aliceSessionHash));
      assert.ok(database.prepare("SELECT token_hash FROM real_user_sessions WHERE token_hash = ?")
        .get(bobSessionHash));
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM real_user_sessions WHERE token_hash IN (?, ?)")
        .get(aliceCookie.slice("__Host-mao_session=".length), bobCookie.slice("__Host-mao_session=".length)).count, 0,
        "the raw session cookies must never be stored in D1");

      const aliceMe = await callWorker(env, authPrefix + "/me", "GET", { cookie: aliceCookie });
      const bobMe = await callWorker(env, authPrefix + "/me", "GET", { cookie: bobCookie });
      assert.equal(aliceMe.response.status, 200);
      assert.equal(bobMe.response.status, 200);
      assert.equal(aliceMe.body.account.id, aliceId);
      assert.equal(bobMe.body.account.id, bobId);

      // Bob creates a QR code; only its hash is persisted.
      const qr = await callWorker(env, friendsPrefix + "/codes/rotate", "POST", { cookie: bobCookie });
      assert.equal(qr.response.status, 201, JSON.stringify(qr.body));
      assert.match(qr.body.code, /^[a-f0-9]{64}$/);
      const qrHash = await sha256Hex(qr.body.code);
      assert.ok(database.prepare("SELECT code_hash FROM real_user_friend_codes WHERE code_hash = ?")
        .get(qrHash));
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM real_user_friend_codes WHERE code_hash = ?")
        .get(qr.body.code).count, 0, "the plaintext QR code must never be stored");

      const requestId = "request_alice_bob_e2e_01";
      const sent = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId, code: qr.body.code, note: "Let's connect" }
      });
      assert.equal(sent.response.status, 201, JSON.stringify(sent.body));
      assert.equal(sent.body.request.id, requestId);
      assert.equal(sent.body.target.id, bobId);

      // Repeated submission with the same ID remains idempotent after QR rotation.
      // The request ID is checked before QR validity, so a network retry does not
      // create a second request or fail just because the original code was revoked.
      const rotatedBeforeRetry = await callWorker(
        env, friendsPrefix + "/codes/rotate", "POST", { cookie: bobCookie }
      );
      assert.equal(rotatedBeforeRetry.response.status, 201);
      const oldCode = database.prepare(
        "SELECT revoked_at FROM real_user_friend_codes WHERE code_hash = ?"
      ).get(qrHash);
      assert.ok(oldCode.revoked_at > 0);
      const sameRequestRetry = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId, code: qr.body.code, note: "retry" }
      });
      assert.equal(sameRequestRetry.response.status, 200);
      assert.equal(sameRequestRetry.body.duplicate, true);
      assert.equal(sameRequestRetry.body.request.id, requestId);
      assert.equal(database.prepare(
        "SELECT COUNT(*) AS count FROM real_user_friend_requests WHERE pair_low = ? AND pair_high = ? AND status = 'pending'"
      ).get(aliceId < bobId ? aliceId : bobId, aliceId < bobId ? bobId : aliceId).count, 1);

      // A revoked or expired QR code cannot create a new request ID.
      const revokedCodeRetry = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId: "request_revoked_qr_e2e_01", code: qr.body.code }
      });
      assert.equal(revokedCodeRetry.response.status, 404);
      const rotatedCodeHash = await sha256Hex(rotatedBeforeRetry.body.code);
      database.prepare("UPDATE real_user_friend_codes SET expires_at = ? WHERE code_hash = ?")
        .run(Date.now() - 1, rotatedCodeHash);
      const expiredCodeRetry = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId: "request_expired_qr_e2e_01", code: rotatedBeforeRetry.body.code }
      });
      assert.equal(expiredCodeRetry.response.status, 404);
      assert.equal(database.prepare(
        "SELECT COUNT(*) AS count FROM real_user_friend_requests WHERE id IN (?, ?)"
      ).get("request_revoked_qr_e2e_01", "request_expired_qr_e2e_01").count, 0);

      // The owner cannot add themself, and another account cannot reuse the
      // first account's stable request ID.
      const aliceQr = await callWorker(env, friendsPrefix + "/codes/rotate", "POST", { cookie: aliceCookie });
      const selfAdd = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId: "request_self_add_e2e_01", code: aliceQr.body.code }
      });
      assert.equal(selfAdd.response.status, 400);
      assert.equal(selfAdd.body.error, "cannot_add_self");
      const requestIdCollision = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: bobCookie,
        body: { requestId, code: aliceQr.body.code }
      });
      assert.equal(requestIdCollision.response.status, 409);
      assert.equal(requestIdCollision.body.error, "request_id_conflict");

      const bobInbox = await callWorker(
        env, friendsPrefix + "/requests?direction=incoming", "GET", { cookie: bobCookie }
      );
      assert.equal(bobInbox.response.status, 200);
      assert.equal(bobInbox.body.requests.length, 1);
      assert.equal(bobInbox.body.requests[0].id, requestId);
      assert.equal(bobInbox.body.requests[0].peer.id, aliceId);

      const accepted = await callWorker(
        env, friendsPrefix + "/requests/" + requestId + "/accept", "POST", { cookie: bobCookie }
      );
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.request.status, "accepted");
      const reusedAcceptedRequest = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId, code: qr.body.code }
      });
      assert.equal(reusedAcceptedRequest.response.status, 409);
      assert.equal(reusedAcceptedRequest.body.error, "request_id_already_used");

      const [aliceRoster, bobRoster] = await Promise.all([
        callWorker(env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: aliceCookie }),
        callWorker(env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: bobCookie })
      ]);
      assert.equal(aliceRoster.body.ownerAccountId, aliceId);
      assert.equal(bobRoster.body.ownerAccountId, bobId);
      assert.deepEqual(aliceRoster.body.friends.map(friend => friend.id), [bobId]);
      assert.deepEqual(bobRoster.body.friends.map(friend => friend.id), [aliceId]);

      // Public profile updates are immediately reflected in the other account's roster.
      const profileUpdate = await callWorker(env, authPrefix + "/me", "PATCH", {
        cookie: aliceCookie,
        body: { displayName: "Alice Updated" }
      });
      assert.equal(profileUpdate.response.status, 200, JSON.stringify(profileUpdate.body));
      const refreshedBobRoster = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: bobCookie }
      );
      assert.equal(refreshedBobRoster.body.friends[0].displayName, "Alice Updated");

      // Removing a friend removes it from both accepted rosters, while leaving
      // a non-profile tombstone. A new request ID is required to add again.
      const removed = await callWorker(env, friendsPrefix + "/" + bobId, "DELETE", { cookie: aliceCookie });
      assert.equal(removed.response.status, 200);
      assert.equal(removed.body.removed, true);
      const afterRemoval = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: bobCookie }
      );
      assert.equal(afterRemoval.body.friends.length, 0);
      assert.equal(afterRemoval.body.relationships[0].status, "removed");
      assert.equal("displayName" in afterRemoval.body.relationships[0], false);

      const secondQr = await callWorker(env, friendsPrefix + "/codes/rotate", "POST", { cookie: bobCookie });
      const firstCodeRow = database.prepare("SELECT revoked_at FROM real_user_friend_codes WHERE code_hash = ?")
        .get(qrHash);
      assert.ok(firstCodeRow.revoked_at > 0, "rotating the QR code revokes the previous code");
      const readd = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId: "request_alice_bob_e2e_02", code: secondQr.body.code }
      });
      assert.equal(readd.response.status, 201);
      const reaccepted = await callWorker(
        env, friendsPrefix + "/requests/request_alice_bob_e2e_02/accept", "POST", { cookie: bobCookie }
      );
      assert.equal(reaccepted.response.status, 200);
      const restored = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: aliceCookie }
      );
      assert.equal(restored.body.friends[0].id, bobId);
      assert.equal(restored.body.friends[0].acceptedRequestId, "request_alice_bob_e2e_02");

      // A block revokes the accepted relationship. Unblocking must not
      // silently recreate friendship; only a new request + acceptance may.
      database.prepare("UPDATE real_user_accounts SET avatar_asset_id = ? WHERE id = ?")
        .run("av_" + "d".repeat(32), aliceId);
      const blocked = await callWorker(env, friendsPrefix + "/" + aliceId + "/block", "POST", {
        cookie: bobCookie
      });
      assert.equal(blocked.response.status, 200);
      assert.equal(blocked.body.blocked, true);
      const blockedList = await callWorker(
        env, friendsPrefix + "/blocks", "GET", { cookie: bobCookie }
      );
      assert.equal(blockedList.response.status, 200);
      assert.equal(blockedList.body.blocked.length, 1);
      assert.equal(blockedList.body.blocked[0].id, aliceId);
      assert.equal("avatarAssetId" in blockedList.body.blocked[0], false,
        "the blocked-user directory must not disclose an avatar asset reference");
      const aliceBlockedRoster = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: aliceCookie }
      );
      assert.equal(aliceBlockedRoster.body.friends.length, 0);
      assert.equal(aliceBlockedRoster.body.relationships[0].status, "removed");

      const unblocked = await callWorker(env, friendsPrefix + "/" + aliceId + "/block", "DELETE", {
        cookie: bobCookie
      });
      assert.equal(unblocked.response.status, 200);
      const afterUnblock = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: bobCookie }
      );
      assert.equal(afterUnblock.body.friends.length, 0,
        "unblocking is not an implicit friend restoration");
      assert.equal(afterUnblock.body.relationships[0].status, "removed");

      const thirdQr = await callWorker(env, friendsPrefix + "/codes/rotate", "POST", { cookie: bobCookie });
      const afterUnblockRequest = await callWorker(env, friendsPrefix + "/requests", "POST", {
        cookie: aliceCookie,
        body: { requestId: "request_alice_bob_e2e_03", code: thirdQr.body.code }
      });
      assert.equal(afterUnblockRequest.response.status, 201);
      const afterUnblockAccept = await callWorker(
        env, friendsPrefix + "/requests/request_alice_bob_e2e_03/accept", "POST", { cookie: bobCookie }
      );
      assert.equal(afterUnblockAccept.response.status, 200);
      const finalAliceRoster = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: aliceCookie }
      );
      assert.deepEqual(finalAliceRoster.body.friends.map(friend => friend.id), [bobId]);

      const bobLogout = await callWorker(env, authPrefix + "/logout", "POST", { cookie: bobCookie });
      assert.equal(bobLogout.response.status, 200);
      const revokedSession = await callWorker(env, authPrefix + "/me", "GET", { cookie: bobCookie });
      assert.equal(revokedSession.response.status, 401);
      const aliceStillLoggedIn = await callWorker(env, authPrefix + "/me", "GET", { cookie: aliceCookie });
      assert.equal(aliceStillLoggedIn.response.status, 200,
        "revoking one account session must not affect the other account");
      const bobLogin = await callWorker(env, authPrefix + "/login", "POST", {
        body: { handle: "bob_e2e", password: "bob secure passphrase 2026" }
      });
      assert.equal(bobLogin.response.status, 200, JSON.stringify(bobLogin.body));
      const freshBobCookie = cookieFrom(bobLogin.response);
      assert.match(freshBobCookie, /^__Host-mao_session=[a-f0-9]{64}$/);
      assert.notEqual(freshBobCookie, bobCookie, "login must issue a fresh opaque session token");
      const restoredSession = await callWorker(env, authPrefix + "/me", "GET", { cookie: freshBobCookie });
      assert.equal(restoredSession.response.status, 200);
      assert.equal(restoredSession.body.account.id, bobId);
      const bobRosterAfterLogin = await callWorker(
        env, friendsPrefix + "/?limit=10&snapshotAt=" + Date.now(), "GET", { cookie: freshBobCookie }
      );
      assert.deepEqual(bobRosterAfterLogin.body.friends.map(friend => friend.id), [aliceId]);
    } finally {
      database.close();
    }
  });



  test("acceptance and blocking are serialized so a blocked pair can never remain accepted", async () => {
    for (const blockFirst of [true, false]) {
      const fixture = await seedRacePair(blockFirst ? "block_first" : "accept_first");
      const { database, aliceId, bobId, aliceToken, bobToken, pair } = fixture;
      try {
        const requestId = blockFirst ? "request_block_order_01" : "request_accept_order_01";
        addPendingRequest(database, requestId, aliceId, bobId, Date.now() - 1000);
        const gate = createMutationGate(["accept", "block"]);
        const raceEnv = createEnvironment(database, {
          beforeRun: gate.beforeRun,
          afterRun: gate.afterRun
        });
        const acceptPromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/requests/" + requestId + "/accept",
          "POST",
          { cookie: bobToken }
        );
        const blockPromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/" + aliceId + "/block",
          "POST",
          { cookie: bobToken }
        );

        await gate.waitUntilReady();
        const firstAction = blockFirst ? "block" : "accept";
        const secondAction = blockFirst ? "accept" : "block";
        gate.release(firstAction);
        await gate.waitUntilComplete(firstAction);
        gate.release(secondAction);
        const [accepted, blocked] = await Promise.all([acceptPromise, blockPromise]);

        assert.equal(blocked.response.status, 200);
        assert.equal(blocked.body.blocked, true);
        const requestRow = database.prepare(
          "SELECT status FROM real_user_friend_requests WHERE id = ?"
        ).get(requestId);
        assert.equal(database.prepare(
          "SELECT COUNT(*) AS count FROM real_user_blocks WHERE blocker_id = ? AND blocked_id = ?"
        ).get(bobId, aliceId).count, 1);

        const friendship = database.prepare(
          "SELECT status FROM real_user_friendships WHERE pair_low = ? AND pair_high = ?"
        ).get(...pair);
        if (blockFirst) {
          assert.equal(accepted.response.status, 409);
          assert.equal(accepted.body.status, "cancelled");
          assert.equal(requestRow.status, "cancelled");
          assert.equal(friendship, undefined,
            "blocking before acceptance must not create a friendship row");
        } else {
          assert.equal(accepted.response.status, 200);
          assert.equal(requestRow.status, "accepted");
          assert.equal(friendship.status, "removed",
            "blocking after acceptance must atomically revoke the friendship");
        }
        assert.notEqual(friendship && friendship.status, "accepted");
      } finally {
        database.close();
      }
    }
  });

  test("friend removal and re-acceptance obey the serialized operation order", async () => {
    for (const removeFirst of [true, false]) {
      const fixture = await seedRacePair(removeFirst ? "remove_first" : "accept_first");
      const { database, aliceId, bobId, aliceToken, bobToken, pair } = fixture;
      try {
        const oldRequestId = "request_remove_old_" + (removeFirst ? "01" : "02");
        const requestId = "request_remove_new_" + (removeFirst ? "01" : "02");
        addPendingRequest(database, oldRequestId, aliceId, bobId, Date.now() - 3000);
        const acceptedOld = database.prepare(
          "UPDATE real_user_friend_requests SET status = 'accepted', updated_at = ?, responded_at = ? WHERE id = ?"
        ).run(Date.now() - 2000, Date.now() - 2000, oldRequestId);
        assert.equal(Number(acceptedOld.changes), 1);
        database.prepare(
          "UPDATE real_user_friendships SET status = 'removed', updated_at = ? " +
          "WHERE pair_low = ? AND pair_high = ? AND status = 'accepted'"
        ).run(Date.now() - 1500, ...pair);
        addPendingRequest(database, requestId, aliceId, bobId, Date.now() - 1000);

        const gate = createMutationGate(["accept", "remove"]);
        const raceEnv = createEnvironment(database, {
          beforeRun: gate.beforeRun,
          afterRun: gate.afterRun
        });
        const acceptPromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/requests/" + requestId + "/accept",
          "POST",
          { cookie: bobToken }
        );
        const removePromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/" + bobId,
          "DELETE",
          { cookie: aliceToken }
        );

        await gate.waitUntilReady();
        const firstAction = removeFirst ? "remove" : "accept";
        const secondAction = removeFirst ? "accept" : "remove";
        gate.release(firstAction);
        await gate.waitUntilComplete(firstAction);
        gate.release(secondAction);
        const [accepted, removed] = await Promise.all([acceptPromise, removePromise]);

        assert.equal(accepted.response.status, 200);
        assert.equal(removed.response.status, 200);
        const friendship = database.prepare(
          "SELECT status, accepted_request_id FROM real_user_friendships " +
          "WHERE pair_low = ? AND pair_high = ?"
        ).get(...pair);
        assert.equal(friendship.accepted_request_id, requestId);
        if (removeFirst) {
          assert.equal(removed.body.removed, false,
            "a remove that linearizes before re-acceptance cannot remove a friendship that does not exist yet");
          assert.equal(friendship.status, "accepted");
        } else {
          assert.equal(removed.body.removed, true);
          assert.equal(friendship.status, "removed",
            "a remove that linearizes after acceptance must leave a tombstone");
        }
      } finally {
        database.close();
      }
    }
  });

  test("block and unblock races keep the tombstone regardless of final block-list state", async () => {
    for (const blockFirst of [true, false]) {
      const fixture = await seedRacePair(blockFirst ? "block_unblock_first" : "unblock_block_first");
      const { database, aliceId, bobId, bobToken, pair } = fixture;
      try {
        const requestId = blockFirst ? "request_block_unblock_01" : "request_unblock_block_01";
        addPendingRequest(database, requestId, aliceId, bobId, Date.now() - 3000);
        const accepted = database.prepare(
          "UPDATE real_user_friend_requests SET status = 'accepted', updated_at = ?, responded_at = ? WHERE id = ?"
        ).run(Date.now() - 2000, Date.now() - 2000, requestId);
        assert.equal(Number(accepted.changes), 1);

        const gate = createMutationGate(["block", "unblock"]);
        const raceEnv = createEnvironment(database, {
          beforeRun: gate.beforeRun,
          afterRun: gate.afterRun
        });
        const blockPromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/" + aliceId + "/block",
          "POST",
          { cookie: bobToken }
        );
        const unblockPromise = callWorker(
          raceEnv,
          "/api/real-user-chat/v1/friends/" + aliceId + "/block",
          "DELETE",
          { cookie: bobToken }
        );

        await gate.waitUntilReady();
        const firstAction = blockFirst ? "block" : "unblock";
        const secondAction = blockFirst ? "unblock" : "block";
        gate.release(firstAction);
        await gate.waitUntilComplete(firstAction);
        gate.release(secondAction);
        const [blocked, unblocked] = await Promise.all([blockPromise, unblockPromise]);

        assert.equal(blocked.response.status, 200);
        assert.equal(unblocked.response.status, 200);
        const friendship = database.prepare(
          "SELECT status FROM real_user_friendships WHERE pair_low = ? AND pair_high = ?"
        ).get(...pair);
        assert.equal(friendship.status, "removed",
          "once a block operation revokes an accepted friendship, an unblock must not resurrect it");
        const blockCount = database.prepare(
          "SELECT COUNT(*) AS count FROM real_user_blocks WHERE blocker_id = ? AND blocked_id = ?"
        ).get(bobId, aliceId).count;
        assert.equal(blockCount, blockFirst ? 0 : 1,
          "the last serialized block-list operation decides the final block state");
      } finally {
        database.close();
      }
    }
  });

  test("logout completed before session validation prevents a pending friend mutation", async () => {
    const fixture = await seedRacePair("logout_race");
    const { database, aliceToken, bobId } = fixture;
    try {
      let reachedResolve;
      let releaseLookup;
      const reached = new Promise(resolve => { reachedResolve = resolve; });
      const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
      let intercepted = false;
      const gatedEnv = createEnvironment(database, {
        beforeSessionLookup: async () => {
          if (intercepted) return;
          intercepted = true;
          reachedResolve();
          await lookupGate;
        }
      });
      const friendsPrefix = "/api/real-user-chat/v1/friends";
      const authPrefix = "/api/real-user-chat/v1/auth";
      const pendingBlock = callWorker(
        gatedEnv, friendsPrefix + "/" + bobId + "/block", "POST", { cookie: "__Host-mao_session=" + aliceToken }
      );
      await reached;

      const logout = await callWorker(
        fixture.env, authPrefix + "/logout", "POST", { cookie: "__Host-mao_session=" + aliceToken }
      );
      assert.equal(logout.response.status, 200);
      releaseLookup();

      const blocked = await pendingBlock;
      assert.equal(blocked.response.status, 401);
      assert.equal(blocked.body.error, "authentication_required");
      assert.equal(database.prepare(
        "SELECT COUNT(*) AS count FROM real_user_blocks WHERE blocker_id = ? AND blocked_id = ?"
      ).get(fixture.aliceId, bobId).count, 0,
      "a session revoked before authentication completes must not authorize a later relationship mutation");
    } finally {
      database.close();
    }
  });

  test("simultaneous QR requests are serialized by the real pending-pair unique index", async () => {
    const database = createDatabase();
    try {
      const baseEnv = createEnvironment(database);
      const authPrefix = "/api/real-user-chat/v1/auth";
      const friendsPrefix = "/api/real-user-chat/v1/friends";
      const register = async (handle, displayName, password) => {
        const result = await callWorker(baseEnv, authPrefix + "/register", "POST", {
          body: { handle, displayName, password }
        });
        assert.equal(result.response.status, 201, JSON.stringify(result.body));
        return { id: result.body.account.id, cookie: cookieFrom(result.response) };
      };
      const alice = await register("race_alice", "Race Alice", "race alice secure passphrase");
      const bob = await register("race_bob", "Race Bob", "race bob secure passphrase");
      const bobCode = await callWorker(baseEnv, friendsPrefix + "/codes/rotate", "POST", {
        cookie: bob.cookie
      });
      assert.equal(bobCode.response.status, 201);

      // Force both requests to observe an empty pending-pair query before
      // either INSERT executes. The real SQLite partial unique index decides
      // the winner; the losing Worker request must reconcile the winner.
      let pendingPairReads = 0;
      const barrier = createReadBarrier(2);
      const raceEnv = createEnvironment(database, {
        afterPendingPairRead: async () => {
          pendingPairReads += 1;
          if (pendingPairReads <= 2) await barrier();
        }
      });
      const [sameDirectionA, sameDirectionB] = await Promise.all([
        callWorker(raceEnv, friendsPrefix + "/requests", "POST", {
          cookie: alice.cookie,
          body: { requestId: "request_race_alice_01", code: bobCode.body.code }
        }),
        callWorker(raceEnv, friendsPrefix + "/requests", "POST", {
          cookie: alice.cookie,
          body: { requestId: "request_race_alice_02", code: bobCode.body.code }
        })
      ]);
      const sameResults = [sameDirectionA, sameDirectionB];
      assert.equal(sameResults.filter(item => item.response.status === 201).length, 1);
      assert.equal(sameResults.filter(item => item.response.status === 200 && item.body.duplicate).length, 1);
      const raceDuplicate = sameResults.find(item => item.response.status === 200);
      assert.equal(raceDuplicate.body.target.id, bob.id,
        "the unique-index race response must retain the same target profile shape as an ordinary duplicate");
      const sameRequestIds = sameResults.map(item => item.body.request.id);
      assert.equal(new Set(sameRequestIds).size, 1,
        "both concurrent submissions must resolve to the same server request");
      const winningId = sameRequestIds[0];
      assert.equal(database.prepare(
        "SELECT COUNT(*) AS count FROM real_user_friend_requests WHERE status = 'pending'"
      ).get().count, 1);

      // Cancel the first winner, then race requests in opposite directions.
      const cancelled = await callWorker(
        baseEnv, friendsPrefix + "/requests/" + winningId + "/cancel", "POST", { cookie: alice.cookie }
      );
      assert.equal(cancelled.response.status, 200);
      const aliceCode = await callWorker(baseEnv, friendsPrefix + "/codes/rotate", "POST", {
        cookie: alice.cookie
      });
      assert.equal(aliceCode.response.status, 201);

      pendingPairReads = 0;
      const reverseBarrier = createReadBarrier(2);
      const reverseRaceEnv = createEnvironment(database, {
        afterPendingPairRead: async () => {
          pendingPairReads += 1;
          if (pendingPairReads <= 2) await reverseBarrier();
        }
      });
      const [aliceToBob, bobToAlice] = await Promise.all([
        callWorker(reverseRaceEnv, friendsPrefix + "/requests", "POST", {
          cookie: alice.cookie,
          body: { requestId: "request_race_reverse_alice", code: bobCode.body.code }
        }),
        callWorker(reverseRaceEnv, friendsPrefix + "/requests", "POST", {
          cookie: bob.cookie,
          body: { requestId: "request_race_reverse_bob", code: aliceCode.body.code }
        })
      ]);
      const reverseResults = [aliceToBob, bobToAlice];
      assert.equal(reverseResults.filter(item => item.response.status === 201).length, 1);
      assert.equal(reverseResults.filter(item =>
        item.response.status === 409 && item.body.error === "incoming_request_exists"
      ).length, 1);
      const reverseWinner = reverseResults.find(item => item.response.status === 201);
      const reverseLoser = reverseResults.find(item => item.response.status === 409);
      assert.equal(reverseLoser.body.requestId, reverseWinner.body.request.id);
      const pair = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
      const pendingForPair = database.prepare(
        "SELECT id, requester_id, recipient_id FROM real_user_friend_requests " +
        "WHERE pair_low = ? AND pair_high = ? AND status = 'pending'"
      ).get(...pair);
      assert.ok(pendingForPair);
      assert.equal(pendingForPair.id, reverseWinner.body.request.id);
    } finally {
      database.close();
    }
  });


  test("suspended and deleted accounts lose session access and expose no peer profile fields", async () => {
    const fixture = await seedRacePair("account_state");
    const { database, env, aliceId, bobId, aliceToken, bobToken } = fixture;
    try {
      const requestId = "request_account_state_01";
      addPendingRequest(database, requestId, aliceId, bobId, Date.now() - 1000);
      const accepted = await callFriends(
        env, "/requests/" + requestId + "/accept", "POST", bobToken
      );
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));

      for (const status of ["suspended", "deleted"]) {
        database.prepare(
          "UPDATE real_user_accounts SET status = ?, updated_at = ? WHERE id = ?"
        ).run(status, Date.now(), bobId);

        const bobMe = await callWorker(
          env,
          "/api/real-user-chat/v1/auth/me",
          "GET",
          { cookie: "__Host-mao_session=" + bobToken }
        );
        assert.equal(bobMe.response.status, 401);
        assert.equal(bobMe.body.error, "authentication_required");

        const bobRoster = await callFriends(
          env, "/?limit=10&snapshotAt=" + Date.now(), "GET", bobToken
        );
        assert.equal(bobRoster.response.status, 401);

        const bobQr = await callFriends(env, "/codes/rotate", "POST", bobToken);
        assert.equal(bobQr.response.status, 401);

        const aliceRoster = await callFriends(
          env, "/?limit=10&snapshotAt=" + Date.now(), "GET", aliceToken
        );
        assert.equal(aliceRoster.response.status, 200, JSON.stringify(aliceRoster.body));
        assert.equal(aliceRoster.body.friends.length, 0);
        assert.equal(aliceRoster.body.relationships.length, 1);
        const hiddenPeer = aliceRoster.body.relationships[0];
        assert.equal(hiddenPeer.id, bobId);
        assert.equal(hiddenPeer.status, "removed");
        assert.equal("handle" in hiddenPeer, false);
        assert.equal("displayName" in hiddenPeer, false);
        assert.equal("avatarAssetId" in hiddenPeer, false);
      }
    } finally {
      database.close();
    }
  });

  test("a session expires at the exact expires_at boundary and cannot mutate relationships", async () => {
    const fixture = await seedRacePair("session_expiry");
    const { database, env, aliceId, aliceToken, bobId } = fixture;
    try {
      const tokenHash = await sha256Hex(aliceToken);
      const expiryBoundary = Date.now();
      const updated = database.prepare(
        "UPDATE real_user_sessions SET expires_at = ? WHERE token_hash = ?"
      ).run(expiryBoundary, tokenHash);
      assert.equal(Number(updated.changes), 1);

      const me = await callWorker(
        env,
        "/api/real-user-chat/v1/auth/me",
        "GET",
        { cookie: "__Host-mao_session=" + aliceToken }
      );
      assert.equal(me.response.status, 401);
      assert.equal(me.body.error, "authentication_required");

      const roster = await callFriends(
        env, "/?limit=10&snapshotAt=" + Date.now(), "GET", aliceToken
      );
      assert.equal(roster.response.status, 401);

      const blocked = await callFriends(
        env, "/" + bobId + "/block", "POST", aliceToken
      );
      assert.equal(blocked.response.status, 401);
      assert.equal(database.prepare(
        "SELECT COUNT(*) AS count FROM real_user_blocks WHERE blocker_id = ? AND blocked_id = ?"
      ).get(aliceId, bobId).count, 0,
      "a session whose expiry equals the lookup time must not authorize a relationship write");
    } finally {
      database.close();
    }
  });


  test("inactive peers are redacted from pending request lists and stable duplicate retries", async () => {
    const fixture = await seedRacePair("inactive_peer");
    const { database, env, aliceId, bobId, aliceToken, bobToken } = fixture;
    const charlieId = "account-inactive-charlie-01";
    const charlieToken = "c".repeat(64);
    const now = Date.now() - 10000;
    try {
      addAccount(database, charlieId, "charlie_state_1", "Charlie State", now);
      await addSession(database, charlieId, charlieToken, now);
      const charlieQr = await callWorker(
        env,
        "/api/real-user-chat/v1/friends/codes/rotate",
        "POST",
        { cookie: charlieToken }
      );
      assert.equal(charlieQr.response.status, 201, JSON.stringify(charlieQr.body));

      const outgoingId = "request_alice_charlie_01";
      const outgoing = await callWorker(
        env,
        "/api/real-user-chat/v1/friends/requests",
        "POST",
        {
          cookie: aliceToken,
          body: { requestId: outgoingId, code: charlieQr.body.code, note: "hello" }
        }
      );
      assert.equal(outgoing.response.status, 201, JSON.stringify(outgoing.body));

      const incomingId = "request_charlie_bob_01";
      addPendingRequest(database, incomingId, charlieId, bobId, Date.now() - 1000);
      database.prepare(
        "UPDATE real_user_accounts SET avatar_asset_id = ?, status = 'suspended', updated_at = ? WHERE id = ?"
      ).run("av_" + "e".repeat(32), Date.now(), charlieId);

      const aliceOutbox = await callWorker(
        env,
        "/api/real-user-chat/v1/friends/requests?direction=outgoing",
        "GET",
        { cookie: aliceToken }
      );
      assert.equal(aliceOutbox.response.status, 200);
      assert.equal(aliceOutbox.body.requests.length, 1);
      const outgoingPeer = aliceOutbox.body.requests[0].peer;
      assert.equal(outgoingPeer.id, charlieId);
      assert.equal(outgoingPeer.unavailable, true);
      assert.equal("handle" in outgoingPeer, false);
      assert.equal("displayName" in outgoingPeer, false);
      assert.equal("avatarAssetId" in outgoingPeer, false);

      const bobInbox = await callWorker(
        env,
        "/api/real-user-chat/v1/friends/requests?direction=incoming",
        "GET",
        { cookie: bobToken }
      );
      assert.equal(bobInbox.response.status, 200);
      assert.equal(bobInbox.body.requests.length, 1);
      const incomingPeer = bobInbox.body.requests[0].peer;
      assert.equal(incomingPeer.id, charlieId);
      assert.equal(incomingPeer.unavailable, true);
      assert.equal("handle" in incomingPeer, false);
      assert.equal("displayName" in incomingPeer, false);
      assert.equal("avatarAssetId" in incomingPeer, false);

      // Stable request retries remain idempotent, but must not re-disclose a
      // peer profile after that peer becomes suspended or deleted.
      const duplicate = await callWorker(
        env,
        "/api/real-user-chat/v1/friends/requests",
        "POST",
        {
          cookie: aliceToken,
          body: { requestId: outgoingId, code: charlieQr.body.code, note: "retry" }
        }
      );
      assert.equal(duplicate.response.status, 200);
      assert.equal(duplicate.body.duplicate, true);
      assert.equal(duplicate.body.request.id, outgoingId);
      assert.equal(duplicate.body.target, null);
    } finally {
      database.close();
    }
  });

  test("acceptance rejects a pending request when its requester is suspended or deleted", async () => {
    const fixture = await seedRacePair("inactive_requester");
    const { database, env, aliceId, aliceToken, bobToken } = fixture;
    try {
      const requestId = "request_inactive_alice_01";
      addPendingRequest(database, requestId, aliceId, fixture.bobId, Date.now() - 1000);
      for (const status of ["suspended", "deleted"]) {
        database.prepare(
          "UPDATE real_user_accounts SET status = ?, updated_at = ? WHERE id = ?"
        ).run(status, Date.now(), aliceId);
        const accepted = await callFriends(
          env, "/requests/" + requestId + "/accept", "POST", bobToken
        );
        assert.equal(accepted.response.status, 409);
        assert.equal(accepted.body.error, "friend_request_account_unavailable");
        assert.equal(database.prepare(
          "SELECT status FROM real_user_friend_requests WHERE id = ?"
        ).get(requestId).status, "pending",
        "an inactive requester must not be materialized into an accepted friendship");
      }
    } finally {
      database.close();
    }
  });

  test("recipient suspension after session validation still prevents request acceptance", async () => {
    const fixture = await seedRacePair("inactive_recipient_race");
    const { database, aliceId, bobId, bobToken } = fixture;
    try {
      const requestId = "request_recipient_race_01";
      addPendingRequest(database, requestId, aliceId, bobId, Date.now() - 1000);
      let reachedResolve;
      let releaseUpdate;
      const reached = new Promise(resolve => { reachedResolve = resolve; });
      const gate = new Promise(resolve => { releaseUpdate = resolve; });
      let intercepted = false;
      const gatedEnv = createEnvironment(database, {
        beforeRun: async sql => {
          if (!intercepted && sql.startsWith("UPDATE real_user_friend_requests SET status = ?")) {
            intercepted = true;
            reachedResolve();
            await gate;
          }
        }
      });
      const acceptance = callFriends(
        gatedEnv, "/requests/" + requestId + "/accept", "POST", bobToken
      );
      await reached;
      database.prepare(
        "UPDATE real_user_accounts SET status = 'suspended', updated_at = ? WHERE id = ?"
      ).run(Date.now(), bobId);
      releaseUpdate();
      const result = await acceptance;
      assert.equal(result.response.status, 409);
      assert.equal(result.body.error, "friend_request_account_unavailable");
      assert.equal(database.prepare(
        "SELECT status FROM real_user_friend_requests WHERE id = ?"
      ).get(requestId).status, "pending");
    } finally {
      database.close();
    }
  });

}
