import assert from "node:assert/strict";
import test from "node:test";
import { handleRealUserAvatar, isRealUserAvatarConfigured, inspectAvatarImage } from "../worker/real-user-avatar.js";
import { sha256Hex } from "../worker/real-user-auth.js";

function png(width = 64, height = 48) {
  const bytes = new Uint8Array(33);
  bytes.set([137,80,78,71,13,10,26,10], 0);
  bytes.set([0,0,0,13], 8);
  bytes.set([73,72,68,82], 12);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}

function envForGate(options = {}) {
  const db = {
    prepare(sql) {
      return {
        async first() {
          if (sql.includes("ready_attachments")) {
            return {
              ready_attachments: options.attachments === false ? 0 : 1,
              ready_avatar_column: options.avatarColumn === false ? 0 : 1
            };
          }
          return { ready: options.authSchema === false ? 0 : 4 };
        }
      };
    },
    async batch() {}
  };
  const bucket = { put() {}, get() {}, delete() {} };
  return {
    REAL_USER_AUTH_ENABLED: options.authEnabled === false ? "false" : "true",
    REAL_USER_AVATAR_ENABLED: options.avatarEnabled === false ? "false" : "true",
    DB: options.noDb ? null : db,
    AUTH_LIMITER: options.noLimiter ? null : { async limit() { return { success: true }; } },
    REAL_USER_AVATARS: options.noBucket ? null : bucket
  };
}

class FakeBucket {
  constructor() { this.objects = new Map(); }
  async put(key, bytes) { this.objects.set(key, new Uint8Array(bytes)); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { body: new Response(bytes).body } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

class FakeD1 {
  constructor() {
    this.accounts = new Map([
      ["account_avatar_a", { id: "account_avatar_a", handle: "avatar_a", display_name: "Alice", status: "active", avatar_asset_id: null }],
      ["account_avatar_b", { id: "account_avatar_b", handle: "avatar_b", display_name: "Bob", status: "active", avatar_asset_id: null }]
    ]);
    this.sessions = new Map();
    this.attachments = new Map();
    this.friendships = new Set();
    this.blocks = new Set();
  }
  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return db.first(sql, this.values); },
      async run() { return db.run(sql, this.values); }
    };
  }
  async batch(statements) {
    const accounts = new Map(Array.from(this.accounts, ([k, v]) => [k, { ...v }]));
    const attachments = new Map(Array.from(this.attachments, ([k, v]) => [k, { ...v }]));
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.accounts = accounts;
      this.attachments = attachments;
      throw error;
    }
  }
  async first(sql, values) {
    if (sql.includes("ready_attachments")) return { ready_attachments: 1, ready_avatar_column: 1 };
    if (sql.includes("FROM sqlite_master")) return { ready: 4 };
    if (sql.includes("FROM real_user_sessions s JOIN real_user_accounts")) {
      const [hash, now] = values;
      const session = this.sessions.get(hash);
      if (!session || session.revoked_at || session.expires_at <= now) return null;
      const account = this.accounts.get(session.account_id);
      if (!account || account.status !== "active") return null;
      return { ...account, expires_at: session.expires_at };
    }
    if (sql.includes("FROM real_user_accounts") && sql.includes("WHERE id = ?")) {
      const account = this.accounts.get(values[0]);
      return account && account.status === "active" ? { ...account } : null;
    }
    if (sql.includes("FROM real_user_attachments x")) {
      const asset = this.attachments.get(values[0]);
      if (!asset || asset.state !== "staged" || asset.kind !== "image") return null;
      const owner = this.accounts.get(asset.owner_account_id);
      if (!owner || owner.status !== "active" || owner.avatar_asset_id !== asset.asset_id) return null;
      return {
        asset_id: asset.asset_id, owner_account_id: asset.owner_account_id,
        object_key: asset.object_key, mime_type: asset.mime_type, byte_size: asset.byte_size
      };
    }
    if (sql.includes("FROM real_user_friendships f")) {
      const [low, high, viewer, owner, owner2, viewer2] = values;
      const pair = low + "|" + high;
      return this.friendships.has(pair) &&
        !this.blocks.has(viewer + "|" + owner) &&
        !this.blocks.has(owner2 + "|" + viewer2) ? { allowed: 1 } : null;
    }
    throw new Error("Unsupported FakeD1 first query: " + sql);
  }
  async run(sql, values) {
    if (sql.includes("INSERT INTO real_user_attachments")) {
      const [assetId, ownerId, objectKey, mimeType, byteSize, createdAt] = values;
      this.attachments.set(assetId, {
        asset_id: assetId, owner_account_id: ownerId, object_key: objectKey,
        mime_type: mimeType, byte_size: byteSize, state: "staged", kind: "image",
        created_at: createdAt
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE real_user_accounts SET avatar_asset_id = NULL")) {
      const [updatedAt, accountId] = values;
      const account = this.accounts.get(accountId);
      if (account) {
        const next = { ...account, avatar_asset_id: null, updated_at: updatedAt };
        if (db.nextDisplayNameOnAvatarWrite) {
          next.display_name = db.nextDisplayNameOnAvatarWrite;
          db.nextDisplayNameOnAvatarWrite = null;
        }
        this.accounts.set(accountId, next);
      }
      return { success: true, meta: { changes: account ? 1 : 0 } };
    }
    if (sql.includes("UPDATE real_user_accounts SET avatar_asset_id = ?")) {
      const [assetId, updatedAt, accountId] = values;
      const account = this.accounts.get(accountId);
      if (account) {
        const next = { ...account, avatar_asset_id: assetId, updated_at: updatedAt };
        if (db.nextDisplayNameOnAvatarWrite) {
          next.display_name = db.nextDisplayNameOnAvatarWrite;
          db.nextDisplayNameOnAvatarWrite = null;
        }
        this.accounts.set(accountId, next);
      }
      return { success: true, meta: { changes: account ? 1 : 0 } };
    }
    if (sql.includes("UPDATE real_user_attachments SET state = 'deleted'")) {
      const [assetId, ownerId] = values;
      const asset = this.attachments.get(assetId);
      if (asset && asset.owner_account_id === ownerId) asset.state = "deleted";
      return { success: true, meta: { changes: asset ? 1 : 0 } };
    }
    throw new Error("Unsupported FakeD1 run query: " + sql);
  }
}

async function runtime() {
  const db = new FakeD1();
  const bucket = new FakeBucket();
  const tokens = { alice: "a".repeat(64), bob: "b".repeat(64) };
  for (const [label, accountId] of [["alice", "account_avatar_a"], ["bob", "account_avatar_b"]]) {
    db.sessions.set(await sha256Hex(tokens[label]), {
      account_id: accountId, expires_at: Date.now() + 60000, revoked_at: null
    });
  }
  const env = {
    REAL_USER_AUTH_ENABLED: "true",
    REAL_USER_AVATAR_ENABLED: "true",
    DB: db,
    AUTH_LIMITER: { async limit() { return { success: true }; } },
    REAL_USER_AVATARS: bucket
  };
  return { db, bucket, env, tokens };
}

function request(path, method, token, body, extraHeaders = {}) {
  const headers = new Headers({
    Cookie: "__Host-mao_session=" + token,
    "CF-Connecting-IP": "203.0.113.10",
    ...extraHeaders
  });
  return new Request("https://mao.example" + path, {
    method, headers, body: body === undefined ? undefined : body
  });
}

test("avatar capability fails closed unless the explicit flag, D1 schema, limiter and R2 bucket exist", async () => {
  assert.equal(await isRealUserAvatarConfigured(envForGate()), true);
  for (const options of [
    { avatarEnabled: false }, { authEnabled: false }, { noDb: true },
    { noLimiter: true }, { noBucket: true }, { attachments: false }, { avatarColumn: false }
  ]) {
    assert.equal(await isRealUserAvatarConfigured(envForGate(options)), false);
  }
});

test("avatar image inspection accepts bounded JPEG, PNG and static WebP headers only", () => {
  const validPng = png(640, 480);
  assert.deepEqual(inspectAvatarImage(validPng, "image/png"), {
    mimeType: "image/png", width: 640, height: 480
  });
  assert.equal(inspectAvatarImage(png(5000, 20), "image/png"), null);
  assert.equal(inspectAvatarImage(validPng, "image/svg+xml"), null);
  assert.equal(inspectAvatarImage(new Uint8Array(9000), "image/png"), null);

  const jpeg = new Uint8Array(24);
  jpeg.set([255,216,255,192,0,17,8,0,16,0,16], 0);
  assert.deepEqual(inspectAvatarImage(jpeg, "image/jpeg"), {
    mimeType: "image/jpeg", width: 16, height: 16
  });

  const webp = new Uint8Array(30);
  webp.set([82,73,70,70], 0); webp.set([87,69,66,80], 8); webp.set([86,80,56,88], 12);
  webp[24] = 63; webp[27] = 31;
  assert.deepEqual(inspectAvatarImage(webp, "image/webp"), {
    mimeType: "image/webp", width: 64, height: 32
  });
  webp[20] = 2;
  assert.equal(inspectAvatarImage(webp, "image/webp"), null, "animated WebP must not be used as a profile avatar");
});

test("avatar upload, authenticated friend-only read, replacement and removal use private object storage", async () => {
  const { db, bucket, env, tokens } = await runtime();
  const path = "/api/real-user-chat/v1/profile/avatar";
  // Simulate a nickname change on another active session after this request's
  // initial authentication snapshot but before the avatar response is built.
  db.nextDisplayNameOnAvatarWrite = "Alice Renamed During Upload";
  const firstUpload = await handleRealUserAvatar(request(path, "POST", tokens.alice, png(), {
    Origin: "https://mao.example", "Content-Type": "image/png"
  }), env);
  assert.equal(firstUpload.status, 201);
  const first = await firstUpload.json();
  assert.equal(first.account.displayName, "Alice Renamed During Upload",
    "avatar response must return the latest profile, not the stale auth snapshot");
  const firstId = first.account.avatarAssetId;
  assert.match(firstId, /^av_[a-f0-9]{32}$/);
  assert.equal(db.accounts.get("account_avatar_a").avatar_asset_id, firstId);
  assert.equal(bucket.objects.size, 1);

  const privateRead = await handleRealUserAvatar(request(
    "/api/real-user-chat/v1/profile/avatars/" + firstId, "GET", tokens.bob
  ), env);
  assert.equal(privateRead.status, 404, "unrelated accounts cannot read a private avatar");

  db.friendships.add("account_avatar_a|account_avatar_b");
  const friendRead = await handleRealUserAvatar(request(
    "/api/real-user-chat/v1/profile/avatars/" + firstId, "GET", tokens.bob
  ), env);
  assert.equal(friendRead.status, 200);
  assert.equal(friendRead.headers.get("Content-Type"), "image/png");
  assert.match(friendRead.headers.get("Cache-Control"), /private, no-store/);
  assert.equal((await friendRead.arrayBuffer()).byteLength, 33);

  db.blocks.add("account_avatar_b|account_avatar_a");
  const blockedRead = await handleRealUserAvatar(request(
    "/api/real-user-chat/v1/profile/avatars/" + firstId, "GET", tokens.bob
  ), env);
  assert.equal(blockedRead.status, 404);

  db.blocks.clear();
  const secondUpload = await handleRealUserAvatar(request(path, "POST", tokens.alice, png(80, 80), {
    Origin: "https://mao.example", "Content-Type": "image/png"
  }), env);
  assert.equal(secondUpload.status, 201);
  const secondId = (await secondUpload.json()).account.avatarAssetId;
  assert.notEqual(secondId, firstId);
  assert.equal(db.accounts.get("account_avatar_a").avatar_asset_id, secondId);
  assert.equal(bucket.objects.size, 1, "replacing an avatar removes the previous private object");

  db.nextDisplayNameOnAvatarWrite = "Alice Renamed During Removal";
  const removed = await handleRealUserAvatar(request(path, "DELETE", tokens.alice, undefined, {
    Origin: "https://mao.example"
  }), env);
  assert.equal(removed.status, 200);
  const removedPayload = await removed.json();
  assert.equal(removedPayload.account.avatarAssetId, null);
  assert.equal(removedPayload.account.displayName, "Alice Renamed During Removal",
    "avatar removal must return the latest profile snapshot too");
  assert.equal(db.accounts.get("account_avatar_a").avatar_asset_id, null);
  assert.equal(bucket.objects.size, 0);
});

test("avatar upload rejects cross-origin writes and image MIME spoofing before storing anything", async () => {
  const { bucket, env, tokens } = await runtime();
  const path = "/api/real-user-chat/v1/profile/avatar";
  const crossOrigin = await handleRealUserAvatar(request(path, "POST", tokens.alice, png(), {
    Origin: "https://attacker.example", "Content-Type": "image/png"
  }), env);
  assert.equal(crossOrigin.status, 403);
  const spoofed = await handleRealUserAvatar(request(path, "POST", tokens.alice, png(), {
    Origin: "https://mao.example", "Content-Type": "image/jpeg"
  }), env);
  assert.equal(spoofed.status, 400);
  assert.equal(bucket.objects.size, 0);
});
