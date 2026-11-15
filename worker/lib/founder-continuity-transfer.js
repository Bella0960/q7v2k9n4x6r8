import { base64UrlToBytes, bytesToBase64Url, utf8 } from './crypto.js';
import { cutoverFounder } from '../../scripts/release/founder-cutover.mjs';
import { verifyFounderCheckpoint } from '../../scripts/release/founder-checkpoint.mjs';
import { ROOT_OBJECT_ID } from '../../scripts/release/founder-recovery-receipts.mjs';

export const FOUNDER_ORIGINAL_OBJECT_ID = '1e3f2eff3b9efe6764d75e5068e12c08abc71e1cc141fcd2be9e4ccaefac9e79';
export const FOUNDER_CONTINUITY_ID = 'MAO-OXHBDBWCOIHPBBYN';
const LEGACY_FOUNDER_ID = 'MAO-URXLPJHSXHSGCZC3';
export const FOUNDER_SEAL_PATH = '/internal/release/founder-continuity-seal';
export const FOUNDER_APPLY_PATH = '/internal/release/founder-continuity-apply';
const response = (data, status) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export const founderContinuityEnvelopeKey = (digest, handoffId) =>
  'founder-continuity/v2/' + digest + '/' + handoffId;
const envelopeLifetimeMs = 30 * 60 * 1000;

function authorizedContext(request, env, state, source, now) {
  const url = new URL(request.url);
  const objectId = source ? FOUNDER_ORIGINAL_OBJECT_ID : ROOT_OBJECT_ID;
  const path = source ? FOUNDER_SEAL_PATH : FOUNDER_APPLY_PATH;
  if (url.protocol !== 'https:' || url.hostname !== 'maomao.internal' || url.pathname !== path ||
      request.method !== 'POST' || env?.FOUNDER_CONTINUITY_MODE !== (source ? 'seal-only' : 'apply-only') ||
      state?.id?.toString() !== objectId) return null;
  const expected = env.FOUNDER_CONTINUITY_SECRET;
  const provided = request.headers.get('x-maomao-continuity-secret') || '';
  if (typeof expected !== 'string' || !/^[A-Za-z0-9_-]{48,256}$/.test(expected) ||
      provided.length > 256) return null;
  let difference = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= (provided.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (difference) return null;
  const key = base64UrlToBytes(env.FOUNDER_CONTINUITY_KEY);
  const from = source ? env.FOUNDER_CONTINUITY_FROM : request.headers.get('x-maomao-continuity-from');
  const until = source ? env.FOUNDER_CONTINUITY_UNTIL : request.headers.get('x-maomao-continuity-until');
  const digest = env.FOUNDER_CONTINUITY_BACKUP_DIGEST;
  const handoffId = env.FOUNDER_CONTINUITY_HANDOFF_ID;
  const maxWindow = source ? 20 * 60 * 1000 : 120000;
  if (key?.length !== 32 || !/^\d{13}$/.test(from || '') || !/^\d{13}$/.test(until || '') ||
      !/^[A-Za-z0-9_-]{22}$/.test(handoffId || '') ||
      Number(until) <= Number(from) || Number(until) - Number(from) > maxWindow ||
      now < Number(from) || now >= Number(until) || !/^[a-f0-9]{64}$/.test(digest || '')) return null;
  const context = utf8(JSON.stringify(['maomao-founder-transfer-v2', FOUNDER_ORIGINAL_OBJECT_ID,
    ROOT_OBJECT_ID, FOUNDER_CONTINUITY_ID, digest, handoffId]));
  return { key, context, until: Number(until) };
}

export async function sealOriginalFounder({ request, env, state, now = Date.now }) {
  const sealedAt = now();
  const auth = authorizedContext(request, env, state, true, sealedAt);
  if (!auth) return response({ ok: false, code: 'continuity_not_authorized' }, 403);
  try {
    const account = state.storage.sql.exec(
      "SELECT id, username, username_key AS usernameKey, password_salt AS passwordSalt, " +
      "password_hash AS passwordHash FROM mao_accounts WHERE id = ? AND role = 'super_admin' AND status = 'active'",
      FOUNDER_CONTINUITY_ID
    ).toArray();
    if (account.length !== 1) return response({ ok: false, code: 'source_identity_unverified' }, 409);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', auth.key, 'AES-GCM', false, ['encrypt']);
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: auth.context },
      key, utf8(JSON.stringify({ ...account[0], sealedAt })));
    return response({ ok: true, iv: bytesToBase64Url(iv), sealed: bytesToBase64Url(sealed) }, 200);
  } catch {
    return response({ ok: false, code: 'source_identity_unavailable' }, 503);
  }
}

// Previews' Durable Objects can only be reached by their owner. A successful
// sign-in on the existing authority lets that same owner seal the verifier
// to private storage without adding a public transfer endpoint.
export async function preserveFounderAfterLogin({ loginResponse, env, state, now = Date.now }) {
  if (env?.FOUNDER_CONTINUITY_MODE !== 'seal-only' || !loginResponse?.ok ||
      state?.id?.toString() !== FOUNDER_ORIGINAL_OBJECT_ID ||
      typeof env.FOUNDER_BACKUP_VAULT?.put !== 'function') return false;
  try {
    const result = await loginResponse.clone().json();
    const account = result?.account;
    if (result.ok !== true || account?.id !== FOUNDER_CONTINUITY_ID ||
        account.role !== 'super_admin' || account.status !== 'active') return false;
    const request = new Request('https://maomao.internal' + FOUNDER_SEAL_PATH, {
      method: 'POST', headers: { 'x-maomao-continuity-secret': env.FOUNDER_CONTINUITY_SECRET }
    });
    const encrypted = await sealOriginalFounder({ request, env, state, now });
    if (!encrypted.ok) return false;
    const key = founderContinuityEnvelopeKey(env.FOUNDER_CONTINUITY_BACKUP_DIGEST, env.FOUNDER_CONTINUITY_HANDOFF_ID);
    await env.FOUNDER_BACKUP_VAULT.put(key, await encrypted.text(), { expirationTtl: envelopeLifetimeMs / 1000 });
    return true;
  } catch {
    return false;
  }
}

export async function applyOriginalFounder({ request, env, state, now = Date.now }) {
  const auth = authorizedContext(request, env, state, false, now());
  if (!auth) return response({ ok: false, code: 'continuity_not_authorized' }, 403);
  try {
    const body = await request.text();
    if (body.length > 2048) return response({ ok: false, code: 'continuity_envelope_invalid' }, 400);
    const { iv: ivText, sealed: sealedText } = JSON.parse(body);
    const iv = base64UrlToBytes(ivText);
    const encrypted = base64UrlToBytes(sealedText);
    if (iv?.length !== 12 || !encrypted?.length) return response({ ok: false, code: 'continuity_envelope_invalid' }, 400);
    const key = await crypto.subtle.importKey('raw', auth.key, 'AES-GCM', false, ['decrypt']);
    const payload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: auth.context }, key, encrypted);
    const chosen = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    if (chosen?.id !== FOUNDER_CONTINUITY_ID) return response({ ok: false, code: 'source_identity_unverified' }, 409);
    const { storage } = state;
    const checkpointProof = await verifyFounderCheckpoint({ storage, now });
    const timestamp = now();
    if (!Number.isSafeInteger(chosen.sealedAt) || chosen.sealedAt > timestamp ||
        timestamp - chosen.sealedAt >= envelopeLifetimeMs) {
      return response({ ok: false, code: 'continuity_envelope_expired' }, 409);
    }
    if (timestamp >= auth.until) return response({ ok: false, code: 'continuity_not_authorized' }, 403);
    const result = cutoverFounder({
      exec: (sql, ...values) => storage.sql.exec(sql, ...values).toArray(),
      transaction: operation => storage.transactionSync(operation),
      expectedCurrentId: LEGACY_FOUNDER_ID, chosen, now: timestamp, storage, checkpointProof
    });
    await storage.sync();
    return response({ ok: true, founderId: FOUNDER_CONTINUITY_ID, changed: result.changed }, 200);
  } catch {
    return response({ ok: false, code: 'continuity_verification_failed' }, 409);
  }
}
