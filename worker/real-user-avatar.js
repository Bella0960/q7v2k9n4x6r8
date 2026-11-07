import { applyAuthRateLimit, authJson, getAuthenticatedAccount, hasSameOrigin, isRealUserAuthConfigured, randomHex, rateLimitResponse } from "./real-user-auth.js";

const PREFIX = "/api/real-user-chat/v1/profile";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 4096;
const MAX_PIXELS = 16777216;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function u32be(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
function safeDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_EDGE && height <= MAX_EDGE && width * height <= MAX_PIXELS;
}
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return null;
  const sof = new Set([192,193,194,195,197,198,199,201,202,203,205,206,207]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 255) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return safeDimensions(width, height) ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
function pngDimensions(bytes) {
  const sig = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || !sig.every((v, i) => bytes[i] === v) ||
      u32be(bytes, 8) !== 13 || String.fromCharCode(...bytes.slice(12,16)) !== "IHDR") return null;
  const width = u32be(bytes, 16), height = u32be(bytes, 20);
  return safeDimensions(width, height) ? { width, height } : null;
}
function webpDimensions(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 25 || ascii(0,4) !== "RIFF" || ascii(8,12) !== "WEBP") return null;
  const chunk = ascii(12,16);
  let width = 0, height = 0;
  if (chunk === "VP8X") {
    if (bytes.length < 30 || (bytes[20] & 2) !== 0) return null;
    width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
  } else if (chunk === "VP8L") {
    if (bytes[20] !== 47) return null;
    width = 1 + (((bytes[22] & 63) << 8) | bytes[21]);
    height = 1 + (((bytes[24] & 15) << 10) | (bytes[23] << 2) | ((bytes[22] & 192) >> 6));
  } else if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 157 || bytes[24] !== 1 || bytes[25] !== 42) return null;
    width = ((bytes[27] & 63) << 8) | bytes[26];
    height = ((bytes[29] & 63) << 8) | bytes[28];
  } else return null;
  return safeDimensions(width, height) ? { width, height } : null;
}
export function inspectAvatarImage(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > MAX_BYTES || !MIME_TYPES.has(mimeType)) return null;
  const dimensions = mimeType === "image/jpeg" ? jpegDimensions(bytes) :
    mimeType === "image/png" ? pngDimensions(bytes) : webpDimensions(bytes);
  return dimensions ? { mimeType, ...dimensions } : null;
}

export async function isRealUserAvatarConfigured(env) {
  if (!await isRealUserAuthConfigured(env) || !env || env.REAL_USER_AVATAR_ENABLED !== "true" ||
      !env.REAL_USER_AVATARS || typeof env.REAL_USER_AVATARS.put !== "function" ||
      typeof env.REAL_USER_AVATARS.get !== "function" || typeof env.REAL_USER_AVATARS.delete !== "function") return false;
  try {
    const schema = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'real_user_attachments') AS ready_attachments, " +
      "(SELECT COUNT(*) FROM pragma_table_info('real_user_accounts') WHERE name = 'avatar_asset_id') AS ready_avatar_column"
    ).first();
    return !!schema && Number(schema.ready_attachments) === 1 && Number(schema.ready_avatar_column) === 1;
  } catch { return false; }
}

async function readBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BYTES) return { ok: false, error: "avatar_too_large" };
  if (!request.body) return { ok: false, error: "invalid_avatar" };
  const reader = request.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); return { ok: false, error: "avatar_too_large" }; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { ok: true, bytes };
  } catch { return { ok: false, error: "invalid_avatar" }; }
}
function accountDto(account, avatarAssetId) {
  return { id: account.id, handle: account.handle, displayName: account.display_name,
    status: "active", avatarAssetId: avatarAssetId || null };
}
async function limited(request, env, account) {
  const result = await applyAuthRateLimit(env, request, account.handle);
  return result.ok ? null : rateLimitResponse(result.error);
}
async function findAvatar(env, assetId) {
  return env.DB.prepare(
    "SELECT x.asset_id, x.owner_account_id, x.object_key, x.mime_type, x.byte_size " +
    "FROM real_user_attachments x JOIN real_user_accounts a ON a.id = x.owner_account_id " +
    "WHERE x.asset_id = ? AND x.kind = 'image' AND x.state = 'staged' " +
    "AND a.avatar_asset_id = x.asset_id AND a.status = 'active' LIMIT 1"
  ).bind(assetId).first();
}
async function markDeleted(env, ownerId, assetId, objectKey) {
  if (!assetId) return;
  try {
    await env.DB.prepare("UPDATE real_user_attachments SET state = 'deleted' " +
      "WHERE asset_id = ? AND owner_account_id = ? AND kind = 'image' AND state = 'staged'")
      .bind(assetId, ownerId).run();
  } catch {}
  if (objectKey) { try { await env.REAL_USER_AVATARS.delete(objectKey); } catch {} }
}
async function upload(request, env, account) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  const limit = await limited(request, env, account); if (limit) return limit;
  const mimeType = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mimeType)) return authJson({ ok: false, error: "unsupported_avatar_type" }, 415);
  const body = await readBody(request);
  if (!body.ok) return authJson({ ok: false, error: body.error }, body.error === "avatar_too_large" ? 413 : 400);
  const inspected = inspectAvatarImage(body.bytes, mimeType);
  if (!inspected) return authJson({ ok: false, error: "invalid_avatar_image" }, 400);

  const assetId = "av_" + randomHex(16);
  const objectKey = "profile-avatars/" + account.id + "/" + assetId;
  const now = Date.now();
  let previous = null;
  try {
    if (account.avatar_asset_id) previous = await findAvatar(env, account.avatar_asset_id);
    await env.REAL_USER_AVATARS.put(objectKey, body.bytes, {
      httpMetadata: { contentType: mimeType, cacheControl: "private, no-store" },
      customMetadata: { ownerAccountId: account.id, assetId }
    });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO real_user_attachments " +
        "(asset_id, owner_account_id, conversation_id, kind, object_key, mime_type, byte_size, state, created_at) " +
        "VALUES (?, ?, NULL, 'image', ?, ?, ?, 'staged', ?)")
        .bind(assetId, account.id, objectKey, mimeType, body.bytes.byteLength, now),
      env.DB.prepare("UPDATE real_user_accounts SET avatar_asset_id = ?, updated_at = ? " +
        "WHERE id = ? AND status = 'active'").bind(assetId, now, account.id)
    ]);
  } catch {
    try { await env.REAL_USER_AVATARS.delete(objectKey); } catch {}
    return authJson({ ok: false, error: "avatar_upload_unavailable" }, 503);
  }
  if (previous) await markDeleted(env, account.id, previous.asset_id, previous.object_key);
  return authJson({ ok: true, account: accountDto(account, assetId),
    avatar: { assetId, mimeType, byteSize: body.bytes.byteLength, width: inspected.width, height: inspected.height } }, 201);
}
async function remove(request, env, account) {
  if (!hasSameOrigin(request)) return authJson({ ok: false, error: "origin_not_allowed" }, 403);
  const limit = await limited(request, env, account); if (limit) return limit;
  const previousId = account.avatar_asset_id || null;
  let previous = null;
  try {
    if (previousId) previous = await findAvatar(env, previousId);
    const statements = [env.DB.prepare("UPDATE real_user_accounts SET avatar_asset_id = NULL, updated_at = ? " +
      "WHERE id = ? AND status = 'active'").bind(Date.now(), account.id)];
    if (previousId) statements.push(env.DB.prepare("UPDATE real_user_attachments SET state = 'deleted' " +
      "WHERE asset_id = ? AND owner_account_id = ? AND kind = 'image' AND state = 'staged'").bind(previousId, account.id));
    await env.DB.batch(statements);
  } catch { return authJson({ ok: false, error: "avatar_delete_unavailable" }, 503); }
  if (previous && previous.object_key) { try { await env.REAL_USER_AVATARS.delete(previous.object_key); } catch {} }
  return authJson({ ok: true, removed: !!previousId, account: accountDto(account, null) }, 200);
}
async function canReadOwnerAvatar(env, viewerId, ownerId) {
  if (viewerId === ownerId) return true;
  const [low, high] = viewerId < ownerId ? [viewerId, ownerId] : [ownerId, viewerId];
  const row = await env.DB.prepare(
    "SELECT 1 AS allowed FROM real_user_friendships f WHERE f.pair_low = ? AND f.pair_high = ? " +
    "AND f.status = 'accepted' AND NOT EXISTS (SELECT 1 FROM real_user_blocks b WHERE " +
    "(b.blocker_id = ? AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = ?)) LIMIT 1"
  ).bind(low, high, viewerId, ownerId, ownerId, viewerId).first();
  return !!row;
}
async function read(request, env, account, assetId) {
  if (!/^av_[a-f0-9]{32}$/.test(assetId)) return authJson({ ok: false, error: "avatar_not_found" }, 404);
  const limit = await limited(request, env, account); if (limit) return limit;
  try {
    const avatar = await findAvatar(env, assetId);
    if (!avatar || !await canReadOwnerAvatar(env, account.id, avatar.owner_account_id)) {
      return authJson({ ok: false, error: "avatar_not_found" }, 404);
    }
    const object = await env.REAL_USER_AVATARS.get(avatar.object_key);
    if (!object || !object.body) return authJson({ ok: false, error: "avatar_not_found" }, 404);
    return new Response(object.body, { status: 200, headers: {
      "Content-Type": avatar.mime_type, "Content-Length": String(avatar.byte_size),
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }});
  } catch { return authJson({ ok: false, error: "avatar_read_unavailable" }, 503); }
}
export async function handleRealUserAvatar(request, env) {
  if (!await isRealUserAvatarConfigured(env)) return authJson({ ok: false, enabled: false, error: "real_user_avatar_unavailable" }, 503);
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + "/")) return authJson({ ok: false, error: "not_found" }, 404);
  const account = await getAuthenticatedAccount(request, env).catch(() => null);
  if (!account) return authJson({ ok: false, error: "authentication_required" }, 401);
  const action = url.pathname.slice((PREFIX + "/").length);
  if (action === "avatar") {
    if (request.method === "POST") return upload(request, env, account);
    if (request.method === "DELETE") return remove(request, env, account);
    return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST, DELETE" });
  }
  if (action.startsWith("avatars/")) {
    if (request.method !== "GET") return authJson({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
    return read(request, env, account, action.slice("avatars/".length));
  }
  return authJson({ ok: false, error: "not_found" }, 404);
}
export const realUserAvatarTestHelpers = {
  inspectAvatarImage, isRealUserAvatarConfigured,
  constants: { MAX_BYTES, MAX_EDGE, MAX_PIXELS }
};
