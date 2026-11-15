/**
 * Re-establish the SAME existing founder identity in a non-Preview authority.
 *
 * Called only after the old authority verified the user's credentials on an
 * explicit login. We never export/copy the old salted password verifier,
 * ask for a new administrator, or manufacture a replacement permanent ID.
 */
import { ApiError } from './http.js';
import { passwordDigest } from './account-auth.js';
import { randomToken, timingSafeEqualHex } from './crypto.js';

const ID = /^MAO-[A-Z0-9]{12,24}$/;
const USERNAME = /^[\p{L}\p{N}_-]{2,24}$/u;

export async function preserveVerifiedFounder({ store, env, identity, password, now = Date.now() }) {
  // This call is only reachable through a private, authenticated service
  // binding. No Preview/prod app may enable it by accident.
  if (env.MAO_PERMANENT_IDENTITY_CORE !== 'true' ||
      env.MAO_FOUNDER_TRANSFER_ENABLED !== 'true') {
    throw new ApiError(503, 'FOUNDER_TRANSFER_DISABLED', '长期身份迁移尚未授权');
  }
  const expected = String(env.MAO_EXPECTED_FOUNDER_ID || '');
  if (!ID.test(expected) || identity?.id !== expected ||
      identity?.role !== 'super_admin' || identity?.status !== 'active' ||
      identity?.founderNumber !== '001' || !USERNAME.test(String(identity?.username || ''))) {
    throw new ApiError(403, 'FOUNDER_IDENTITY_MISMATCH', '唯一管理员身份与原账号不一致');
  }
  const secret = String(password || '');
  if (secret.length < 10 || secret.length > 128) {
    throw new ApiError(400, 'INVALID_PASSWORD', '需要使用原账号密码确认');
  }
  const existing = store.getMaoAccountById(expected);
  if (existing) {
    if (existing.role !== 'super_admin' || existing.status !== 'active' ||
        existing.username !== identity.username) {
      throw new ApiError(409, 'FOUNDER_TRANSFER_CONFLICT', '目标数据库存在冲突管理员');
    }
    const digest = await passwordDigest(secret, existing.password_salt);
    if (!timingSafeEqualHex(digest, existing.password_hash)) {
      throw new ApiError(409, 'FOUNDER_PASSWORD_NOT_CONFIRMED', '长期账号密码尚未与原账号保持一致');
    }
    return { ok: true, sameId: expected, alreadyPresent: true };
  }
  if (store.hasMaoSuperAdminAccount()) {
    throw new ApiError(409, 'FOUNDER_TRANSFER_CONFLICT', '禁止覆盖其他管理员');
  }
  const timestamp = Number(now);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new ApiError(503, 'FOUNDER_TRANSFER_INVALID_TIME', '迁移时间无效');
  }
  const passwordSalt = randomToken(16);
  const passwordHash = await passwordDigest(secret, passwordSalt);
  const created = store.createMaoSuperAdminAccountIfEmpty({
    id: expected,
    username: identity.username,
    usernameKey: identity.username.toLocaleLowerCase('en-US'),
    passwordSalt, passwordHash,
    qqEmail: null,
    now: timestamp
  });
  if (!created) {
    throw new ApiError(409, 'FOUNDER_TRANSFER_CONFLICT', '账号状态在迁移过程中变化');
  }
  const confirmed = store.getMaoAccountById(expected);
  if (!confirmed || confirmed.id !== expected || confirmed.role !== 'super_admin' ||
      !timingSafeEqualHex(await passwordDigest(secret, confirmed.password_salt),
        confirmed.password_hash)) {
    throw new ApiError(503, 'FOUNDER_TRANSFER_UNVERIFIED', '新账号存储尚未验证成功');
  }
  return { ok: true, sameId: expected, alreadyPresent: false };
}
