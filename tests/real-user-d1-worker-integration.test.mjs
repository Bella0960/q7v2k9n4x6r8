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
function createD1Adapter(database) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        first() {
          return database.prepare(sql).get(...values) || null;
        },
        all() {
          return { results: database.prepare(sql).all(...values) };
        },
        run() {
          const result = database.prepare(sql).run(...values);
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
  if (options.cookie) headers.set("Cookie", options.cookie);
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

function createEnvironment(database) {
  return {
    REAL_USER_AUTH_ENABLED: "true",
    REAL_USER_FRIENDS_ENABLED: "true",
    DB: createD1Adapter(database),
    AUTH_LIMITER: { async limit() { return { success: true }; } }
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
      const blocked = await callWorker(env, friendsPrefix + "/" + aliceId + "/block", "POST", {
        cookie: bobCookie
      });
      assert.equal(blocked.response.status, 200);
      assert.equal(blocked.body.blocked, true);
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
      const bobLogin = await callWorker(env, authPrefix + "/login", "POST", {
        body: { handle: "bob_e2e", password: "bob secure passphrase 2026" }
      });
      assert.equal(bobLogin.response.status, 200, JSON.stringify(bobLogin.body));
      const freshBobCookie = cookieFrom(bobLogin.response);
      assert.match(freshBobCookie, /^__Host-mao_session=[a-f0-9]{64}$/);
      const restoredSession = await callWorker(env, authPrefix + "/me", "GET", { cookie: freshBobCookie });
      assert.equal(restoredSession.response.status, 200);
      assert.equal(restoredSession.body.account.id, bobId);
    } finally {
      database.close();
    }
  });

}
