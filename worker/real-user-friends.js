import {
  applyAuthRateLimit,
  authJson,
  getAuthenticatedAccount,
  hasOnlyKeys,
  hasSameOrigin,
  isRealUserAuthConfigured,
  randomHex,
  rateLimitResponse,
  readJsonBody,
  sha256Hex
} from "./real-user-auth.js";

const FRIENDS_PREFIX = "/api/real-user-chat/v1/friends";
const FRIEND_CODE_TTL_MS = 15 * 60 * 1000;
const FRIEND_CODE_BYTES = 32;
const MAX_LIST_LIMIT = 50;
const MAX_FRIEND_PAGE_SIZE = 100;

export async function isRealUserFriendsConfigured(env) {
  if (!await isRealUserAuthConfigured(env) ||
      !env || env.REAL_USER_FRIENDS_ENABLED !== "true") return false;
  try {
    const schema = await env.DB.prepare(
      "SELECT " +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (" +
      "'real_user_friend_codes', 'real_user_friend_requests', " +
      "'real_user_friendships', 'real_user_blocks')) AS ready_tables, " +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN (" +
      "'idx_real_user_friend_codes_one_unrevoked_per_account', " +
      "'idx_real_user_friend_requests_pending_pair')) AS ready_indexes, " +
      "(SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (" +
      "'trg_real_user_friend_request_insert_guard', " +
      "'trg_real_user_friend_request_transition_guard', " +
      "'trg_real_user_friend_request_accept_guard', " +
      "'trg_real_user_friend_request_accepted', " +
      "'trg_real_user_friendship_source_guard', " +
      "'trg_real_user_friendship_update_guard', " +
      "'trg_real_user_block_removes_friendship', " +
      "'trg_real_user_block_terminates_pending_requests')) AS ready_triggers"
    ).first();
    return !!schema &&
      Number(schema.ready_tables) === 4 &&
      Number(schema.ready_indexes) === 2 &&
      Number(schema.ready_triggers) === 8;
  } catch {
    return false;
  }
}

function changes(result) {
  return Number(result && result.meta && result.meta.changes || result && result.changes || 0);
}

function normalizeNote(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const note = value.normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
  return Array.from(note).length <= 160 ? note : null;
}

function validRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(value);
}

function validAccountId(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{8,96}$/.test(value);
}

function publicProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id || null
  };
}

function pairFor(left, right) {
  return left < right ? [left, right] : [right, left];
}

async function authenticatedContext(request, env) {
  const account = await getAuthenticatedAccount(request, env);
  if (!account) return { response: authJson({ ok: false, error: "authentication_required" }, 401) };
  const limited = await applyAuthRateLimit(env, request, account.handle);
  if (!limited.ok) return { response: rateLimitResponse(limited.error) };
  return { account };
}

async function rotateFriendCode(request, env, account) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  const now = Date.now();
  const expiresAt = now + FRIEND_CODE_TTL_MS;
  const code = randomHex(FRIEND_CODE_BYTES);
  const codeHash = await sha256Hex(code);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE real_user_friend_codes SET revoked_at = ? " +
        "WHERE account_id = ? AND revoked_at IS NULL"
      ).bind(now, account.id),
      env.DB.prepare(
        "INSERT INTO real_user_friend_codes (code_hash, account_id, created_at, expires_at) " +
        "VALUES (?, ?, ?, ?)"
      ).bind(codeHash, account.id, now, expiresAt)
    ]);
    return authJson({
      ok: true,
      code,
      qrPayload: "mao://friend/add?code=" + code,
      expiresAt,
      expiresInSeconds: FRIEND_CODE_TTL_MS / 1000
    }, 201);
  } catch {
    return authJson({ ok: false, error: "friend_code_temporarily_unavailable" }, 503);
  }
}

async function revokeFriendCode(request, env, account) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  try {
    const result = await env.DB.prepare(
      "UPDATE real_user_friend_codes SET revoked_at = ? " +
      "WHERE account_id = ? AND revoked_at IS NULL"
    ).bind(Date.now(), account.id).run();
    return authJson({ ok: true, revoked: changes(result) }, 200);
  } catch {
    return authJson({ ok: false, error: "friend_code_temporarily_unavailable" }, 503);
  }
}

async function sendFriendRequest(request, env, account) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if ((request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return authJson({ ok: false, error: "json_required" }, 415);
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return authJson({ ok: false, error: parsed.error }, parsed.error === "body_too_large" ? 413 : 400);
  if (!hasOnlyKeys(parsed.value, ["requestId", "code", "note"])) {
    return authJson({ ok: false, error: "unexpected_fields" }, 400);
  }
  const requestId = parsed.value.requestId;
  const code = parsed.value.code;
  const note = normalizeNote(parsed.value.note);
  if (!validRequestId(requestId) || typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code) || note === null) {
    return authJson({ ok: false, error: "invalid_friend_request" }, 400);
  }

  const now = Date.now();
  const codeHash = await sha256Hex(code);
  let targetId = "";
  try {
    // Check the stable request ID before looking up the short-lived QR code:
    // retries remain idempotent even when the QR code expires after creation.
    const existingById = await env.DB.prepare(
      "SELECT id, requester_id, recipient_id, status, created_at " +
      "FROM real_user_friend_requests WHERE id = ? LIMIT 1"
    ).bind(requestId).first();
    if (existingById) {
      if (existingById.requester_id !== account.id) {
        return authJson({ ok: false, error: "request_id_conflict" }, 409);
      }
      if (existingById.status !== "pending") {
        return authJson({ ok: false, error: "request_id_already_used", status: existingById.status }, 409);
      }
      const peer = await env.DB.prepare(
        "SELECT id, handle, display_name, avatar_asset_id FROM real_user_accounts WHERE id = ? LIMIT 1"
      ).bind(existingById.recipient_id).first();
      return authJson({
        ok: true,
        duplicate: true,
        request: { id: existingById.id, status: existingById.status, createdAt: existingById.created_at },
        target: publicProfile(peer)
      }, 200);
    }

    const target = await env.DB.prepare(
      "SELECT a.id, a.handle, a.display_name, a.avatar_asset_id " +
      "FROM real_user_friend_codes c JOIN real_user_accounts a ON a.id = c.account_id " +
      "WHERE c.code_hash = ? AND c.revoked_at IS NULL AND c.expires_at > ? AND a.status = 'active' " +
      "LIMIT 1"
    ).bind(codeHash, now).first();
    if (!target) return authJson({ ok: false, error: "friend_code_invalid_or_expired" }, 404);
    targetId = target.id;
    if (target.id === account.id) return authJson({ ok: false, error: "cannot_add_self" }, 400);

    const [pairLow, pairHigh] = pairFor(account.id, target.id);
    const blocked = await env.DB.prepare(
      "SELECT 1 AS blocked FROM real_user_blocks " +
      "WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1"
    ).bind(account.id, target.id, target.id, account.id).first();
    if (blocked) return authJson({ ok: false, error: "friend_request_not_allowed" }, 403);

    const friendship = await env.DB.prepare(
      "SELECT status FROM real_user_friendships WHERE pair_low = ? AND pair_high = ? LIMIT 1"
    ).bind(pairLow, pairHigh).first();
    if (friendship && friendship.status === "accepted") {
      return authJson({ ok: false, error: "already_friends" }, 409);
    }

    const pending = await env.DB.prepare(
      "SELECT id, requester_id, recipient_id, status, created_at " +
      "FROM real_user_friend_requests WHERE pair_low = ? AND pair_high = ? AND status = 'pending' LIMIT 1"
    ).bind(pairLow, pairHigh).first();
    if (pending) {
      if (pending.requester_id === account.id) {
        return authJson({ ok: true, duplicate: true, request: {
          id: pending.id, status: pending.status, createdAt: pending.created_at
        }, target: publicProfile(target) }, 200);
      }
      return authJson({ ok: false, error: "incoming_request_exists", requestId: pending.id }, 409);
    }

    await env.DB.prepare(
      "INSERT INTO real_user_friend_requests " +
      "(id, requester_id, recipient_id, pair_low, pair_high, note, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
    ).bind(requestId, account.id, target.id, pairLow, pairHigh, note, now, now).run();

    return authJson({
      ok: true,
      duplicate: false,
      request: { id: requestId, status: "pending", createdAt: now },
      target: publicProfile(target)
    }, 201);
  } catch (error) {
    // A concurrent request may win the unordered-pair unique index. Read the
    // authoritative current state; never invent a send acknowledgement.
    if (targetId) {
      try {
        const [pairLow, pairHigh] = pairFor(account.id, targetId);
        const blocked = await env.DB.prepare(
          "SELECT 1 AS blocked FROM real_user_blocks " +
          "WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1"
        ).bind(account.id, targetId, targetId, account.id).first();
        if (blocked) return authJson({ ok: false, error: "friend_request_not_allowed" }, 403);

        const friendship = await env.DB.prepare(
          "SELECT status FROM real_user_friendships WHERE pair_low = ? AND pair_high = ? LIMIT 1"
        ).bind(pairLow, pairHigh).first();
        if (friendship && friendship.status === "accepted") {
          return authJson({ ok: false, error: "already_friends" }, 409);
        }

        const pending = await env.DB.prepare(
          "SELECT id, requester_id, recipient_id, status, created_at " +
          "FROM real_user_friend_requests WHERE pair_low = ? AND pair_high = ? AND status = 'pending' LIMIT 1"
        ).bind(pairLow, pairHigh).first();
        if (pending && pending.requester_id === account.id) {
          return authJson({ ok: true, duplicate: true, request: {
            id: pending.id, status: pending.status, createdAt: pending.created_at
          } }, 200);
        }
        if (pending && pending.recipient_id === account.id) {
          return authJson({ ok: false, error: "incoming_request_exists", requestId: pending.id }, 409);
        }
      } catch {
        // The original failure remains unavailable.
      }
    }
    if (String(error && error.message || "").includes("UNIQUE constraint failed: real_user_friend_requests.id")) {
      return authJson({ ok: false, error: "request_id_conflict" }, 409);
    }
    return authJson({ ok: false, error: "friend_request_temporarily_unavailable" }, 503);
  }
}

async function listFriendRequests(request, env, account, url) {
  const direction = url.searchParams.get("direction") || "incoming";
  if (direction !== "incoming" && direction !== "outgoing") {
    return authJson({ ok: false, error: "invalid_direction" }, 400);
  }
  const ownerColumn = direction === "incoming" ? "recipient_id" : "requester_id";
  try {
    const result = await env.DB.prepare(
      "SELECT r.id, r.requester_id, r.recipient_id, r.note, r.created_at, " +
      "a.id AS peer_id, a.handle, a.display_name, a.avatar_asset_id " +
      "FROM real_user_friend_requests r " +
      "JOIN real_user_accounts a ON a.id = CASE WHEN r.requester_id = ? THEN r.recipient_id ELSE r.requester_id END " +
      "WHERE r." + ownerColumn + " = ? AND r.status = 'pending' " +
      "ORDER BY r.created_at DESC LIMIT ?"
    ).bind(account.id, account.id, MAX_LIST_LIMIT).all();
    return authJson({
      ok: true,
      direction,
      requests: (result.results || []).map(row => ({
        id: row.id,
        note: row.note,
        createdAt: row.created_at,
        peer: {
          id: row.peer_id,
          handle: row.handle,
          displayName: row.display_name,
          avatarAssetId: row.avatar_asset_id || null
        }
      }))
    }, 200);
  } catch {
    return authJson({ ok: false, error: "friend_requests_temporarily_unavailable" }, 503);
  }
}

async function transitionFriendRequest(request, env, account, requestId, action) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) return authJson({ ok: false, error: "request_not_found" }, 404);
  const now = Date.now();
  const ownerColumn = action === "cancel" ? "requester_id" : "recipient_id";
  const nextStatus = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  try {
    const result = await env.DB.prepare(
      "UPDATE real_user_friend_requests SET status = ?, updated_at = ?, responded_at = ? " +
      "WHERE id = ? AND " + ownerColumn + " = ? AND status = 'pending'"
    ).bind(nextStatus, now, now, requestId, account.id).run();
    if (!changes(result)) {
      const existing = await env.DB.prepare(
        "SELECT status FROM real_user_friend_requests WHERE id = ? AND " + ownerColumn + " = ? LIMIT 1"
      ).bind(requestId, account.id).first();
      if (!existing) return authJson({ ok: false, error: "request_not_found" }, 404);
      return authJson({ ok: false, error: "request_not_pending", status: existing.status }, 409);
    }
    return authJson({ ok: true, request: { id: requestId, status: nextStatus, updatedAt: now } }, 200);
  } catch (error) {
    if (String(error && error.message || "").includes("real_user_friendship_blocked")) {
      return authJson({ ok: false, error: "friendship_blocked" }, 403);
    }
    return authJson({ ok: false, error: "friend_request_transition_unavailable" }, 503);
  }
}

async function listFriends(env, account, url) {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit == null ? MAX_FRIEND_PAGE_SIZE : Number(rawLimit);
  const rawCursor = String(url.searchParams.get("after") || "").trim();
  const cursor = rawCursor || "";
  const rawSnapshotAt = url.searchParams.get("snapshotAt");
  const snapshotAt = rawSnapshotAt == null ? Date.now() : Number(rawSnapshotAt);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FRIEND_PAGE_SIZE) {
    return authJson({ ok: false, error: "invalid_friend_page_limit" }, 400);
  }
  if (cursor && !validAccountId(cursor)) {
    return authJson({ ok: false, error: "invalid_friend_cursor" }, 400);
  }
  if (!Number.isSafeInteger(snapshotAt) || snapshotAt <= 0 || snapshotAt > Date.now()) {
    return authJson({ ok: false, error: "invalid_friend_snapshot" }, 400);
  }

  try {
    // Pages are ordered by immutable account ID. D1 does not provide a shared
    // transaction snapshot across HTTP requests, so do not filter rows by the
    // first-page timestamp: a concurrent update must still appear as its latest
    // relationship state rather than disappearing and looking like a deletion.
    // Earlier pages may be stale until the next refresh; later pages never omit
    // a changed row because its updated_at moved past the paging marker.
    // Removed/blocked rows carry relationship metadata only, never private profile data.
    const result = await env.DB.prepare(
      "SELECT a.id, a.handle, a.display_name, a.avatar_asset_id, a.status AS account_status, " +
      "f.status AS friendship_status, f.accepted_request_id, f.accepted_at, f.updated_at, " +
      "CASE WHEN EXISTS (SELECT 1 FROM real_user_blocks b WHERE " +
      "(b.blocker_id = ? AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = ?)) " +
      "THEN 1 ELSE 0 END AS is_blocked " +
      "FROM real_user_friendships f " +
      "JOIN real_user_accounts a ON a.id = CASE WHEN f.pair_low = ? THEN f.pair_high ELSE f.pair_low END " +
      "WHERE (f.pair_low = ? OR f.pair_high = ?) AND a.id > ? " +
      "ORDER BY a.id COLLATE BINARY LIMIT ?"
    ).bind(
      account.id, account.id, account.id, account.id, account.id,
      cursor, limit + 1
    ).all();
    const rows = result.results || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const relationships = pageRows.map(row => {
      const accepted = row.friendship_status === "accepted" &&
        row.account_status === "active" && Number(row.is_blocked) !== 1;
      const relationship = {
        id: row.id,
        status: accepted ? "accepted" : "removed",
        acceptedRequestId: row.accepted_request_id,
        acceptedAt: row.accepted_at,
        updatedAt: row.updated_at
      };
      if (accepted) {
        relationship.handle = row.handle;
        relationship.displayName = row.display_name;
        relationship.avatarAssetId = row.avatar_asset_id || null;
      }
      return relationship;
    });
    const friends = relationships.filter(item => item.status === "accepted").map(item => ({
      id: item.id,
      handle: item.handle,
      displayName: item.displayName,
      avatarAssetId: item.avatarAssetId,
      acceptedRequestId: item.acceptedRequestId,
      acceptedAt: item.acceptedAt
    }));
    return authJson({
      ok: true,
      ownerAccountId: account.id,
      friends,
      relationships,
      snapshotAt,
      hasMore,
      nextCursor: hasMore && pageRows.length ? pageRows[pageRows.length - 1].id : null
    }, 200);
  } catch {
    return authJson({ ok: false, error: "friends_temporarily_unavailable" }, 503);
  }
}

async function listBlocked(env, account) {
  try {
    const result = await env.DB.prepare(
      "SELECT a.id, a.handle, a.display_name, a.avatar_asset_id, b.created_at " +
      "FROM real_user_blocks b " +
      "JOIN real_user_accounts a ON a.id = b.blocked_id " +
      "WHERE b.blocker_id = ? " +
      "ORDER BY a.display_name COLLATE NOCASE LIMIT ?"
    ).bind(account.id, MAX_LIST_LIMIT).all();
    return authJson({
      ok: true,
      blocked: (result.results || []).map(row => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        avatarAssetId: row.avatar_asset_id || null,
        blockedAt: row.created_at
      }))
    }, 200);
  } catch {
    return authJson({ ok: false, error: "blocked_accounts_temporarily_unavailable" }, 503);
  }
}

async function removeFriend(request, env, account, friendId) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if (!validAccountId(friendId) || friendId === account.id) return authJson({ ok: false, error: "friend_not_found" }, 404);
  const [low, high] = pairFor(account.id, friendId);
  try {
    const result = await env.DB.prepare(
      "UPDATE real_user_friendships SET status = 'removed', updated_at = ? " +
      "WHERE pair_low = ? AND pair_high = ? AND status = 'accepted'"
    ).bind(Date.now(), low, high).run();
    return authJson({ ok: true, removed: changes(result) === 1 }, 200);
  } catch {
    return authJson({ ok: false, error: "friend_remove_unavailable" }, 503);
  }
}

async function setBlock(request, env, account, friendId, blocked) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  if (!validAccountId(friendId) || friendId === account.id) return authJson({ ok: false, error: "account_not_found" }, 404);
  try {
    const target = await env.DB.prepare(
      "SELECT id FROM real_user_accounts WHERE id = ? " +
      (blocked ? "AND status = 'active' " : "") +
      "LIMIT 1"
    ).bind(friendId).first();
    if (!target) return authJson({ ok: false, error: "account_not_found" }, 404);
    if (blocked) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO real_user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
      ).bind(account.id, friendId, Date.now()).run();
    } else {
      await env.DB.prepare(
        "DELETE FROM real_user_blocks WHERE blocker_id = ? AND blocked_id = ?"
      ).bind(account.id, friendId).run();
    }
    return authJson({ ok: true, blocked }, 200);
  } catch {
    return authJson({ ok: false, error: "block_update_unavailable" }, 503);
  }
}

export async function handleRealUserFriends(request, env) {
  if (!await isRealUserFriendsConfigured(env)) {
    return authJson({
      ok: false,
      enabled: false,
      error: "real_user_friends_unavailable",
      reason: "database_or_friend_service_not_configured"
    }, 503);
  }

  const context = await authenticatedContext(request, env);
  if (context.response) return context.response;
  const account = context.account;
  const url = new URL(request.url);
  const path = url.pathname.slice(FRIENDS_PREFIX.length) || "/";

  if (path === "/codes/rotate") {
    if (request.method !== "POST") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
    return rotateFriendCode(request, env, account);
  }
  if (path === "/codes/me") {
    if (request.method !== "DELETE") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "DELETE" });
    return revokeFriendCode(request, env, account);
  }
  if (path === "/requests") {
    if (request.method === "POST") return sendFriendRequest(request, env, account);
    if (request.method === "GET") return listFriendRequests(request, env, account, url);
    return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET, POST" });
  }
  if (path.startsWith("/requests/")) {
    const parts = path.slice("/requests/".length).split("/");
    if (parts.length !== 2) return authJson({ ok: false, error: "not_found" }, 404);
    let requestId = "";
    try { requestId = decodeURIComponent(parts[0]); } catch { return authJson({ ok: false, error: "not_found" }, 404); }
    const action = parts[1];
    if (action !== "accept" && action !== "decline" && action !== "cancel") {
      return authJson({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });
    return transitionFriendRequest(request, env, account, requestId, action);
  }
  if (path === "/" || path === "") {
    if (request.method === "GET") return listFriends(env, account, url);
    return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  const segments = path.slice(1).split("/");
  if (path === "/blocks") {
    if (request.method !== "GET") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
    return listBlocked(env, account);
  }
  if (segments.length === 1) {
    let friendId = "";
    try { friendId = decodeURIComponent(segments[0]); } catch { return authJson({ ok: false, error: "not_found" }, 404); }
    if (request.method === "DELETE") return removeFriend(request, env, account, friendId);
  }
  if (segments.length === 2 && segments[1] === "block") {
    let friendId = "";
    try { friendId = decodeURIComponent(segments[0]); } catch { return authJson({ ok: false, error: "not_found" }, 404); }
    if (request.method === "POST") return setBlock(request, env, account, friendId, true);
    if (request.method === "DELETE") return setBlock(request, env, account, friendId, false);
    return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST, DELETE" });
  }
  return authJson({ ok: false, error: "not_found" }, 404);
}

export const realUserFriendsTestHelpers = {
  isRealUserFriendsConfigured,
  normalizeNote,
  validRequestId,
  pairFor,
  constants: { FRIEND_CODE_TTL_MS, FRIEND_CODE_BYTES, MAX_LIST_LIMIT, MAX_FRIEND_PAGE_SIZE }
};
