const AUTH_PREFIX = "/api/real-user-chat/v1/auth";
const SESSION_COOKIE = "__Host-mao_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_MIN_BYTES = 12;
const PASSWORD_MAX_BYTES = 256;
const MAX_BODY_BYTES = 8192;
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

function authJson(payload, status, headers) {
  const resultHeaders = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  });
  Object.entries(headers || {}).forEach(([key, value]) => resultHeaders.set(key, value));
  return new Response(JSON.stringify(payload), { status, headers: resultHeaders });
}

function unavailable() {
  return authJson({
    ok: false,
    enabled: false,
    error: "real_user_auth_unavailable",
    reason: "database_or_auth_rate_limiter_not_configured"
  }, 503);
}

export function isRealUserAuthConfigured(env) {
  return !!(
    env &&
    env.REAL_USER_AUTH_ENABLED === "true" &&
    env.DB &&
    typeof env.DB.prepare === "function" &&
    typeof env.DB.batch === "function" &&
    env.AUTH_LIMITER &&
    typeof env.AUTH_LIMITER.limit === "function"
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

async function derivePasswordHash(password, saltHex, iterations) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: hexToBytes(saltHex),
    iterations
  }, passwordKey, 256);
  return bytesToHex(new Uint8Array(bits));
}

function equalHexConstantTime(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      left.length !== right.length || left.length % 2 !== 0) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 2) {
    difference |= parseInt(left.slice(i, i + 2), 16) ^ parseInt(right.slice(i, i + 2), 16);
  }
  return difference === 0;
}

function normalizeHandle(value) {
  if (typeof value !== "string") return "";
  const handle = value.trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(handle) ? handle : "";
}

function normalizeDisplayName(value) {
  if (typeof value !== "string") return "";
  const name = value.normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
  const characters = Array.from(name).length;
  const bytes = new TextEncoder().encode(name).length;
  return characters >= 1 && characters <= 48 && bytes <= 192 ? name : "";
}

function passwordIsValid(value) {
  if (typeof value !== "string") return false;
  const bytes = new TextEncoder().encode(value).length;
  return bytes >= PASSWORD_MIN_BYTES && bytes <= PASSWORD_MAX_BYTES;
}

function parseSessionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const matches = cookieHeader.split(";")
    .map(part => part.trim())
    .filter(part => part.startsWith(SESSION_COOKIE + "="));
  if (matches.length !== 1) return "";
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}

function sessionCookie(token, maxAgeSeconds) {
  return SESSION_COOKIE + "=" + (token || "") +
    "; Path=/; Max-Age=" + maxAgeSeconds +
    "; HttpOnly; Secure; SameSite=Strict";
}

function hasSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    return requestUrl.protocol === "https:" && new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return { ok: false, error: "body_too_large" };
  if (!request.body) return { ok: false, error: "invalid_json" };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, error: "body_too_large" };
      }
      chunks.push(part.value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(merged);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "invalid_json" };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.includes(key));
}

async function applyAuthRateLimit(env, request, handle) {
  const ip = String(request.headers.get("CF-Connecting-IP") || "").trim();
  if (!ip) return { ok: false, error: "client_network_identity_unavailable" };
  try {
    const ipKey = await sha256Hex("mao-auth-ip:" + ip);
    const ipResult = await env.AUTH_LIMITER.limit({ key: "ip:" + ipKey });
    if (!ipResult || ipResult.success !== true) return { ok: false, error: "rate_limited" };
    if (handle) {
      const handleKey = await sha256Hex("mao-auth-handle:" + handle);
      const handleResult = await env.AUTH_LIMITER.limit({ key: "handle:" + handleKey });
      if (!handleResult || handleResult.success !== true) return { ok: false, error: "rate_limited" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "rate_limiter_unavailable" };
  }
}

function rateLimitResponse(error) {
  if (error === "rate_limited") {
    return authJson({ ok: false, error }, 429, { "Retry-After": "60" });
  }
  return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
}

async function getAuthenticatedAccount(request, env) {
  const token = parseSessionCookie(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  return env.DB.prepare(
    "SELECT a.id, a.handle, a.display_name, a.status, s.expires_at " +
    "FROM real_user_sessions s JOIN real_user_accounts a ON a.id = s.account_id " +
    "WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? " +
    "AND a.status = 'active' LIMIT 1"
  ).bind(tokenHash, now).first();
}

function publicAccount(account) {
  return {
    id: account.id,
    handle: account.handle,
    displayName: account.display_name,
    status: account.status
  };
}

async function register(request, env) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return authJson({ ok: false, error: "json_required" }, 415);
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return authJson({ ok: false, error: parsed.error }, parsed.error === "body_too_large" ? 413 : 400);
  if (!hasOnlyKeys(parsed.value, ["handle", "displayName", "password"])) {
    return authJson({ ok: false, error: "unexpected_fields" }, 400);
  }

  const handle = normalizeHandle(parsed.value.handle);
  const displayName = normalizeDisplayName(parsed.value.displayName);
  const password = parsed.value.password;
  if (!handle || !displayName || !passwordIsValid(password)) {
    return authJson({
      ok: false,
      error: "invalid_registration",
      requirements: {
        handle: "3-24 lowercase letters, numbers or underscores",
        displayName: "1-48 characters",
        password: "12-256 UTF-8 bytes"
      }
    }, 400);
  }

  const limited = await applyAuthRateLimit(env, request, handle);
  if (!limited.ok) return rateLimitResponse(limited.error);

  const accountId = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  const sessionToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const sessionFamilyId = randomHex(16);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO real_user_accounts " +
        "(id, handle, display_name, password_hash, password_salt, password_iterations, status, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)"
      ).bind(accountId, handle, displayName, passwordHash, salt, PASSWORD_ITERATIONS, now, now),
      env.DB.prepare(
        "INSERT INTO real_user_sessions " +
        "(token_hash, session_family_id, account_id, created_at, expires_at, last_seen_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(tokenHash, sessionFamilyId, accountId, now, expiresAt, now)
    ]);
  } catch (error) {
    // The unique handle constraint is intentionally the only account-existence signal.
    if (/unique constraint failed: real_user_accounts\\.handle/i.test(String(error && error.message || ""))) {
      return authJson({ ok: false, error: "handle_unavailable" }, 409);
    }
    return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
  }

  return authJson({
    ok: true,
    account: { id: accountId, handle, displayName, status: "active" },
    session: { expiresAt, maxAgeSeconds: SESSION_TTL_MS / 1000 }
  }, 201, { "Set-Cookie": sessionCookie(sessionToken, SESSION_TTL_MS / 1000) });
}

async function login(request, env) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return authJson({ ok: false, error: "json_required" }, 415);
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return authJson({ ok: false, error: parsed.error }, parsed.error === "body_too_large" ? 413 : 400);
  if (!hasOnlyKeys(parsed.value, ["handle", "password"])) {
    return authJson({ ok: false, error: "unexpected_fields" }, 400);
  }
  const handle = normalizeHandle(parsed.value.handle);
  const password = parsed.value.password;
  if (!handle || typeof password !== "string" || new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return authJson({ ok: false, error: "invalid_credentials" }, 401);
  }

  const limited = await applyAuthRateLimit(env, request, handle);
  if (!limited.ok) return rateLimitResponse(limited.error);

  let account = null;
  try {
    account = await env.DB.prepare(
      "SELECT id, handle, display_name, password_hash, password_salt, password_iterations, status " +
      "FROM real_user_accounts WHERE handle = ? COLLATE NOCASE LIMIT 1"
    ).bind(handle).first();
  } catch {
    return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
  }

  // Always perform a password derivation, including for unknown handles, to reduce
  // account-enumeration timing differences.
  const iterations = account && Number.isInteger(account.password_iterations) &&
    account.password_iterations >= 100000 && account.password_iterations <= 1000000
    ? account.password_iterations : PASSWORD_ITERATIONS;
  const salt = account && /^[a-f0-9]{32,128}$/.test(account.password_salt)
    ? account.password_salt : DUMMY_SALT;
  const expectedHash = account && /^[a-f0-9]{64}$/.test(account.password_hash)
    ? account.password_hash : DUMMY_HASH;
  const suppliedHash = await derivePasswordHash(password, salt, iterations);
  const passwordMatches = equalHexConstantTime(suppliedHash, expectedHash);
  if (!account || account.status !== "active" || !passwordMatches) {
    return authJson({ ok: false, error: "invalid_credentials" }, 401);
  }

  const sessionToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const sessionFamilyId = randomHex(16);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  try {
    await env.DB.prepare(
      "INSERT INTO real_user_sessions " +
      "(token_hash, session_family_id, account_id, created_at, expires_at, last_seen_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(tokenHash, sessionFamilyId, account.id, now, expiresAt, now).run();
  } catch {
    return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
  }

  return authJson({
    ok: true,
    account: publicAccount(account),
    session: { expiresAt, maxAgeSeconds: SESSION_TTL_MS / 1000 }
  }, 200, { "Set-Cookie": sessionCookie(sessionToken, SESSION_TTL_MS / 1000) });
}

async function currentAccount(request, env) {
  try {
    const account = await getAuthenticatedAccount(request, env);
    if (!account) return authJson({ ok: false, error: "authentication_required" }, 401);
    return authJson({ ok: true, account: publicAccount(account), session: { expiresAt: account.expires_at } }, 200);
  } catch {
    return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
  }
}

async function logout(request, env) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  const token = parseSessionCookie(request);
  if (token) {
    try {
      const tokenHash = await sha256Hex(token);
      await env.DB.prepare(
        "UPDATE real_user_sessions SET revoked_at = ? " +
        "WHERE token_hash = ? AND revoked_at IS NULL"
      ).bind(Date.now(), tokenHash).run();
    } catch {
      return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503);
    }
  }
  return authJson({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export async function handleRealUserAuth(request, env) {
  if (!isRealUserAuthConfigured(env)) return unavailable();
  const url = new URL(request.url);
  if (!url.pathname.startsWith(AUTH_PREFIX + "/")) {
    return authJson({ ok: false, error: "not_found" }, 404);
  }

  const action = url.pathname.slice((AUTH_PREFIX + "/").length);
  if (action === "register") {
    if (request.method !== "POST") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
    try { return await register(request, env); }
    catch { return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503); }
  }
  if (action === "login") {
    if (request.method !== "POST") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
    try { return await login(request, env); }
    catch { return authJson({ ok: false, error: "authentication_temporarily_unavailable" }, 503); }
  }
  if (action === "me") {
    if (request.method !== "GET") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
    return currentAccount(request, env);
  }
  if (action === "logout") {
    if (request.method !== "POST") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
    return logout(request, env);
  }
  return authJson({ ok: false, error: "not_found" }, 404);
}

export const realUserAuthTestHelpers = {
  normalizeHandle,
  normalizeDisplayName,
  passwordIsValid,
  derivePasswordHash,
  sha256Hex,
  equalHexConstantTime,
  parseSessionCookie,
  isRealUserAuthConfigured,
  constants: {
    SESSION_COOKIE,
    SESSION_TTL_MS,
    PASSWORD_ITERATIONS,
    PASSWORD_MIN_BYTES,
    PASSWORD_MAX_BYTES,
    MAX_BODY_BYTES
  }
};
