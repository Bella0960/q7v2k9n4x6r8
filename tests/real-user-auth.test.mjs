import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { default as worker } from "../worker.js";
import {
  handleRealUserAuth,
  isRealUserAuthConfigured,
  realUserAuthTestHelpers
} from "../worker/real-user-auth.js";

class FakeD1 {
  constructor() {
    this.accounts = new Map();
    this.sessions = new Map();
    this.schemaReady = true;
  }

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        const values = this.values;
        if (sql.includes("FROM sqlite_master")) {
          return { ready: db.schemaReady ? 4 : 0 };
        }
        if (sql.includes("FROM real_user_accounts WHERE handle")) {
          const handle = String(values[0]).toLowerCase();
          return Array.from(db.accounts.values()).find(account => account.handle === handle) || null;
        }
        if (sql.includes("FROM real_user_accounts WHERE id = ?")) {
          const account = db.accounts.get(values[0]);
          return account && account.status === "active" ? {
            id: account.id, handle: account.handle,
            display_name: account.display_name, status: account.status
          } : null;
        }
        if (sql.includes("FROM real_user_sessions s JOIN real_user_accounts")) {
          const [tokenHash, now] = values;
          const session = db.sessions.get(tokenHash);
          if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
          const account = db.accounts.get(session.account_id);
          if (!account || account.status !== "active") return null;
          return {
            id: account.id,
            handle: account.handle,
            display_name: account.display_name,
            status: account.status,
            expires_at: session.expires_at
          };
        }
        throw new Error("FakeD1 unsupported first query");
      },
      async run() {
        return db.runStatement(sql, this.values);
      }
    };
  }

  async batch(statements) {
    const accounts = new Map(this.accounts);
    const sessions = new Map(this.sessions);
    try {
      const output = [];
      for (const statement of statements) {
        output.push(await statement.run());
      }
      return output;
    } catch (error) {
      this.accounts = accounts;
      this.sessions = sessions;
      throw error;
    }
  }

  async runStatement(sql, values) {
    if (sql.includes("INSERT INTO real_user_accounts")) {
      const [id, handle, display_name, password_hash, password_salt,
        password_iterations, created_at, updated_at] = values;
      if (Array.from(this.accounts.values()).some(item => item.handle === handle)) {
        throw new Error("UNIQUE constraint failed: real_user_accounts.handle");
      }
      this.accounts.set(id, {
        id, handle, display_name, password_hash, password_salt,
        password_iterations, status: "active", created_at, updated_at
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE real_user_accounts SET display_name")) {
      const [display_name, updated_at, id] = values;
      const account = this.accounts.get(id);
      if (!account || account.status !== "active") return { success: true, meta: { changes: 0 } };
      this.accounts.set(id, { ...account, display_name, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO real_user_sessions")) {
      const [token_hash, session_family_id, account_id, created_at, expires_at, last_seen_at] = values;
      this.sessions.set(token_hash, {
        token_hash, session_family_id, account_id, created_at, expires_at,
        last_seen_at, revoked_at: null
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE real_user_sessions SET revoked_at")) {
      const [revoked_at, token_hash] = values;
      const session = this.sessions.get(token_hash);
      if (session && session.revoked_at === null) session.revoked_at = revoked_at;
      return { success: true, meta: { changes: session ? 1 : 0 } };
    }
    throw new Error("FakeD1 unsupported run query");
  }
}

function createEnv(options = {}) {
  const limiterCalls = [];
  const db = options.db || new FakeD1();
  const limiter = options.limiter || {
    async limit(input) {
      limiterCalls.push(input.key);
      if (options.throwLimiter) throw new Error("rate limiter unavailable");
      return { success: options.rejectRateLimit !== true };
    }
  };
  return {
    env: {
      REAL_USER_AUTH_ENABLED: options.enabled === false ? "false" : "true",
      DB: options.noDb ? null : db,
      AUTH_LIMITER: options.noLimiter ? null : limiter
    },
    db,
    limiterCalls
  };
}

function request(path, method = "GET", body, options = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin || "https://mao.example");
  if (options.contentType !== null && body !== undefined) {
    headers.set("Content-Type", options.contentType || "application/json");
  }
  if (body !== undefined) headers.set("Content-Length", String(new TextEncoder().encode(
    typeof body === "string" ? body : JSON.stringify(body)
  ).length));
  headers.set("CF-Connecting-IP", options.ip || "203.0.113.10");
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new Request("https://mao.example" + path, {
    method,
    headers,
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body))
  });
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") || "";
  const match = value.match(/__Host-mao_session=([a-f0-9]{64})/);
  return match ? "__Host-mao_session=" + match[1] : "";
}

const AUTH = "/api/real-user-chat/v1/auth";

test("account auth fails closed without the explicit flag, D1 and rate limiter", async () => {
  for (const options of [
    { enabled: false },
    { noDb: true },
    { noLimiter: true },
    { noSchema: true }
  ]) {
    const { env, db } = createEnv(options);
    if (options.noSchema) db.schemaReady = false;
    assert.equal(await isRealUserAuthConfigured(env), false);
    const response = await handleRealUserAuth(request(AUTH + "/register", "POST", {
      handle: "alice_1", displayName: "Alice", password: "correct horse battery"
    }), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "real_user_auth_unavailable");
  }
});

test("registration derives password, stores only session hash and returns a secure HttpOnly cookie", async () => {
  const { env, db, limiterCalls } = createEnv();
  const response = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "Alice_1",
    displayName: " Alice ",
    password: "correct horse battery"
  }), env);
  const body = await response.json();
  const cookie = response.headers.get("set-cookie") || "";
  const account = Array.from(db.accounts.values())[0];
  const session = Array.from(db.sessions.values())[0];

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.account.handle, "alice_1");
  assert.equal(body.account.displayName, "Alice");
  assert.equal(body.account.status, "active");
  assert.equal(body.session.maxAgeSeconds, 604800);
  assert.doesNotMatch(JSON.stringify(body), /correct horse battery|password_hash|password_salt/);
  assert.match(cookie, /^__Host-mao_session=[a-f0-9]{64}; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(account.password_hash.length, 64);
  assert.equal(account.password_salt.length, 32);
  assert.notEqual(account.password_hash, "correct horse battery");
  assert.equal(session.token_hash.length, 64);
  assert.notEqual(session.token_hash, cookie.match(/=([a-f0-9]{64})/)[1]);
  assert.equal(limiterCalls.length, 2, "registration is limited by IP and handle");
});

test("duplicate handles return a conflict without leaking database details", async () => {
  const { env } = createEnv();
  const payload = { handle: "same_handle", displayName: "One", password: "correct horse battery" };
  assert.equal((await handleRealUserAuth(request(AUTH + "/register", "POST", payload), env)).status, 201);
  const duplicate = await handleRealUserAuth(request(AUTH + "/register", "POST", payload), env);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { ok: false, error: "handle_unavailable" });
});

test("login uses a generic invalid-credentials result and issues a separate hashed session", async () => {
  const { env, db } = createEnv();
  await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "member_1", displayName: "Member", password: "correct horse battery"
  }), env);
  const oldSessionCount = db.sessions.size;

  const wrong = await handleRealUserAuth(request(AUTH + "/login", "POST", {
    handle: "member_1", password: "incorrect horse battery"
  }), env);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { ok: false, error: "invalid_credentials" });
  assert.equal(db.sessions.size, oldSessionCount);

  const login = await handleRealUserAuth(request(AUTH + "/login", "POST", {
    handle: "MEMBER_1", password: "correct horse battery"
  }), env);
  assert.equal(login.status, 200);
  assert.ok(cookieFrom(login));
  assert.equal(db.sessions.size, oldSessionCount + 1);
});

test("current-account endpoint requires a valid active server session", async () => {
  const { env } = createEnv();
  const register = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "current_1", displayName: "Current", password: "correct horse battery"
  }), env);
  const cookie = cookieFrom(register);
  const me = await handleRealUserAuth(request(AUTH + "/me", "GET", undefined, { cookie }), env);
  const body = await me.json();

  assert.equal(me.status, 200);
  assert.deepEqual(body.account, {
    id: body.account.id,
    handle: "current_1",
    displayName: "Current",
    status: "active",
    avatarAssetId: null
  });
  assert.equal(body.account.password_hash, undefined);
  const anonymous = await handleRealUserAuth(request(AUTH + "/me"), env);
  assert.equal(anonymous.status, 401);
});

test("logout revokes the server session and clears the host-only cookie", async () => {
  const { env, db } = createEnv();
  const register = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "logout_1", displayName: "Logout", password: "correct horse battery"
  }), env);
  const cookie = cookieFrom(register);
  const logout = await handleRealUserAuth(request(AUTH + "/logout", "POST", undefined, { cookie }), env);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /__Host-mao_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Strict/);
  const me = await handleRealUserAuth(request(AUTH + "/me", "GET", undefined, { cookie }), env);
  assert.equal(me.status, 401);
  assert.equal(Array.from(db.sessions.values())[0].revoked_at > 0, true);
});

test("unsafe auth routes require exact same-origin HTTPS and do not create accounts on rejection", async () => {
  const { env, db } = createEnv();
  const crossOrigin = request(AUTH + "/register", "POST", {
    handle: "cross_1", displayName: "Cross", password: "correct horse battery"
  }, { origin: "https://attacker.example" });
  const missingOrigin = request(AUTH + "/register", "POST", {
    handle: "origin_1", displayName: "Origin", password: "correct horse battery"
  }, { origin: null });
  assert.equal((await handleRealUserAuth(crossOrigin, env)).status, 403);
  assert.equal((await handleRealUserAuth(missingOrigin, env)).status, 403);
  assert.equal(db.accounts.size, 0);
});

test("registration validates body size, content type, fields and password length", async () => {
  const { env, db } = createEnv();
  const wrongContentType = request(AUTH + "/register", "POST", "{}", { contentType: "text/plain" });
  assert.equal((await handleRealUserAuth(wrongContentType, env)).status, 415);

  const extraFields = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "extra_1", displayName: "Extra", password: "correct horse battery", accountId: "spoofed"
  }), env);
  assert.equal(extraFields.status, 400);
  assert.equal((await extraFields.json()).error, "unexpected_fields");

  const shortPassword = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "short_1", displayName: "Short", password: "tiny"
  }), env);
  assert.equal(shortPassword.status, 400);

  const oversized = await handleRealUserAuth(request(AUTH + "/register", "POST", "x".repeat(9000)), env);
  assert.equal(oversized.status, 413);
  assert.equal(db.accounts.size, 0);
});

test("rate limits fail closed and do not create accounts", async () => {
  const blocked = createEnv({ rejectRateLimit: true });
  const response = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "limited_1", displayName: "Limited", password: "correct horse battery"
  }), blocked.env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(blocked.db.accounts.size, 0);

  const outage = createEnv({ throwLimiter: true });
  const failed = await handleRealUserAuth(request(AUTH + "/login", "POST", {
    handle: "limited_1", password: "correct horse battery"
  }), outage.env);
  assert.equal(failed.status, 503);
});

test("duplicate or malformed session cookies are rejected", async () => {
  const { env } = createEnv();
  const duplicateCookie = "__Host-mao_session=" + "a".repeat(64) +
    "; __Host-mao_session=" + "b".repeat(64);
  const response = await handleRealUserAuth(request(AUTH + "/me", "GET", undefined, {
    cookie: duplicateCookie
  }), env);
  assert.equal(response.status, 401);
  assert.equal(realUserAuthTestHelpers.parseSessionCookie(
    new Request("https://mao.example/", { headers: { Cookie: duplicateCookie } })
  ), "");
});

test("account auth endpoints are routed while messaging remains disabled", async () => {
  const { env } = createEnv();
  const capabilityEnv = {
    ...env,
    ASSETS: { async fetch() { return new Response("asset", { status: 200 }); } }
  };

  const capability = await worker.fetch(new Request(
    "https://mao.example/api/real-user-chat/capabilities"
  ), capabilityEnv);
  const capabilityBody = await capability.json();
  assert.equal(capabilityBody.enabled, false);
  assert.equal(capabilityBody.accountAuth.enabled, true);
  assert.equal(capabilityBody.delivery.enabled, false);
  assert.equal(capabilityBody.profileAvatar.enabled, false);

  const avatarRoute = await worker.fetch(new Request(
    "https://mao.example/api/real-user-chat/v1/profile/avatar",
    { method: "POST", headers: { Origin: "https://mao.example", "Content-Type": "image/png" }, body: new Uint8Array([1, 2, 3]) }
  ), capabilityEnv);
  assert.equal(avatarRoute.status, 503);
  assert.deepEqual(await avatarRoute.json(), {
    ok: false, enabled: false, error: "real_user_avatar_unavailable"
  });

  const unavailableEnv = {
    ...capabilityEnv,
    REAL_USER_AUTH_ENABLED: "false"
  };
  const disabled = await worker.fetch(request(AUTH + "/register", "POST", {
    handle: "route_1", displayName: "Route", password: "correct horse battery"
  }), unavailableEnv);
  assert.equal(disabled.status, 503);

  const messages = await worker.fetch(new Request(
    "https://mao.example/api/real-user-chat/v1/conversations/c1/messages"
  ), capabilityEnv);
  assert.equal(messages.status, 503);
});


test("server-only auth modules are excluded from Vite static assets but remain imported by the Worker", () => {
  const viteConfig = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  const workerEntry = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  assert.match(viteConfig, /const excludedDirs = new Set\(\[[^\]]*'worker'[^\]]*\]\)/);
  assert.match(workerEntry, /from "\.\/worker\/real-user-auth\.js"/);
  assert.match(workerEntry, /from "\.\/worker\/real-user-avatar\.js"/);
});


test("profile updates change only the authenticated account display name and survive session refresh", async () => {
  const { env, db, limiterCalls } = createEnv();
  const register = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "profile_1", displayName: "Before", password: "correct horse battery"
  }), env);
  const cookie = cookieFrom(register);
  const accountId = (await register.json()).account.id;

  const update = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "  New Nick\n"
  }, { cookie }), env);
  const updatedBody = await update.json();

  assert.equal(update.status, 200);
  assert.equal(updatedBody.account.id, accountId);
  assert.equal(updatedBody.account.displayName, "New Nick");
  assert.equal(db.accounts.get(accountId).display_name, "New Nick");
  assert.equal(db.accounts.get(accountId).handle, "profile_1");
  assert.equal(limiterCalls.length, 4, "registration and profile update are each limited by IP and handle");

  const refreshed = await handleRealUserAuth(request(AUTH + "/me", "GET", undefined, { cookie }), env);
  assert.equal((await refreshed.json()).account.displayName, "New Nick");
});

test("profile update rejects missing sessions, cross-origin writes, invalid names and spoofed account IDs", async () => {
  const { env, db } = createEnv();
  const register = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "profile_2", displayName: "Profile", password: "correct horse battery"
  }), env);
  const cookie = cookieFrom(register);
  const accountId = (await register.json()).account.id;

  const anonymous = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "Changed"
  }), env);
  assert.equal(anonymous.status, 401);

  const crossOrigin = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "Changed"
  }, { cookie, origin: "https://attacker.example" }), env);
  assert.equal(crossOrigin.status, 403);

  const blank = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "   "
  }, { cookie }), env);
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).error, "invalid_display_name");

  const spoofed = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "Changed", accountId: "another-account"
  }, { cookie }), env);
  assert.equal(spoofed.status, 400);
  assert.equal((await spoofed.json()).error, "unexpected_fields");
  assert.equal(db.accounts.get(accountId).display_name, "Profile");
});


test("profile updates fail closed when the rate limiter rejects the change", async () => {
  const { env, db } = createEnv();
  const register = await handleRealUserAuth(request(AUTH + "/register", "POST", {
    handle: "profile_limit", displayName: "Before", password: "correct horse battery"
  }), env);
  const cookie = cookieFrom(register);
  const accountId = (await register.json()).account.id;
  env.AUTH_LIMITER = { async limit() { return { success: false }; } };

  const update = await handleRealUserAuth(request(AUTH + "/me", "PATCH", {
    displayName: "After"
  }, { cookie }), env);

  assert.equal(update.status, 429);
  assert.equal(db.accounts.get(accountId).display_name, "Before");
});
