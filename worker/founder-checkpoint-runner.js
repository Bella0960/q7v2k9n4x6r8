/**
 * Release-only, scheduled private checkpoint caller.
 *
 * This Worker is NOT deployed by main or the founder QA preview.
 * It has no public action route and no configured cron by default.
 * The external DO binding targets the existing live account Worker.
 */
import { ENCRYPTED_BACKUP_RECEIPT_KEY, ISOLATED_RESTORE_RECEIPT_KEY,
  verifyProductionRecoveryReceipts
} from '../scripts/release/founder-recovery-receipts.mjs';

const TARGET_SCRIPT = 'mao-auth-preview';
const TARGET_INSTANCE = 'maomao-global';
const TARGET_ORIGIN = 'https://mao520.com';
const PRIVATE_URL = 'https://maomao.internal/internal/release/checkpoint';
const MAX_WINDOW_MS = 120_000;
const SUCCESS = 'checkpoint_recorded';

function validMillis(value) {
  const n = Number(value);
  return typeof value === 'string' && /^[0-9]{13}$/.test(value) &&
    Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function runPrivateFounderCheckpoint({ env, now = Date.now }) {
  // All switches are absent until separately provisioned by a release operator.
  if (env?.FOUNDER_RUN_ENABLED !== 'acknowledge-single-use-live-checkpoint') {
    return { ok: false, code: 'disabled' };
  }
  if (env.FOUNDER_TARGET_SCRIPT !== TARGET_SCRIPT ||
      env.FOUNDER_TARGET_ORIGIN !== TARGET_ORIGIN) {
    return { ok: false, code: 'wrong_authority' };
  }
  const start = validMillis(env.FOUNDER_RUN_NOT_BEFORE_MS);
  const end = validMillis(env.FOUNDER_RUN_NOT_AFTER_MS);
  const time = now();
  if (!start || !end || !Number.isSafeInteger(time) ||
      end <= start || end - start > MAX_WINDOW_MS || time < start || time >= end) {
    return { ok: false, code: 'window_closed' };
  }
  const secret = env.FOUNDER_RELEASE_OPERATOR_SECRET;
  if (typeof secret !== 'string' || secret.length < 48 ||
      secret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(secret)) {
    return { ok: false, code: 'secret_unavailable' };
  }
  const ns = env.LIVE_CLOUD_DB;
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
    return { ok: false, code: 'binding_unavailable' };
  }

  try {
    const stub = ns.get(ns.idFromName(TARGET_INSTANCE));
    let response = await stub.fetch(new Request(PRIVATE_URL, {
      method: 'POST',
      headers: { 'x-maomao-release-secret': secret }
    }));
    // Never auto-rotate a historical PITR bookmark. Only the separately
    // expiring private KV authorization may approve preserving the old lease
    // before recording a new one; no ordinary Cron retry can opt in.
    if (response.status === 409 &&
        env.FOUNDER_ROTATE_ALLOWED === 'preserve-old-checkpoint-and-rotate') {
      const audit = env.RELEASE_AUDIT;
      const approvedDigest = env.FOUNDER_ROTATE_BACKUP_DIGEST;
      if (typeof audit?.get !== 'function' || typeof approvedDigest !== 'string') {
        return { ok: false, code: 'checkpoint_recovery_not_verified' };
      }
      const [backup, restore] = await Promise.all([
        audit.get(ENCRYPTED_BACKUP_RECEIPT_KEY, { type: 'json' }),
        audit.get(ISOLATED_RESTORE_RECEIPT_KEY, { type: 'json' })
      ]).catch(() => []);
      const verifiedAt = now();
      if (!verifyProductionRecoveryReceipts(backup, restore).restoreVerified ||
          backup.ciphertextSha256 !== approvedDigest || restore.verifiedAt > verifiedAt + 2000) {
        return { ok: false, code: 'checkpoint_recovery_not_verified' };
      }
      if (!Number.isSafeInteger(verifiedAt) || verifiedAt < start || verifiedAt >= end) {
        return { ok: false, code: 'window_closed' };
      }
      response = await stub.fetch(new Request(
        'https://maomao.internal/internal/release/checkpoint-rotate', {
          method: 'POST',
          headers: {
            'x-maomao-release-secret': secret,
            'x-maomao-release-operation': 'preserve-old-checkpoint-and-rotate'
          }
        }
      ));
    }
    if (!response.ok) {
      // HTTP status only; never expose the internal response, bookmark or secret.
      const code = {
        403: 'checkpoint_operator_secret_rejected',
        404: 'checkpoint_handler_not_active',
        409: 'checkpoint_rotation_requires_review',
        503: 'checkpoint_storage_unavailable'
      }[response.status] || 'checkpoint_failed';
      return { ok: false, code };
    }
    const result = await response.json();
    // The DO records its timestamp AFTER the request starts. Comparing the
    // acknowledgement with the pre-fetch clock rejects a valid first write.
    // Recheck the clock after the response; allow at most 2s of clock skew
    // across Worker isolates, and reject records older than the 15m lease.
    const receivedAt = now();
    if (result?.ok !== true || result?.recorded !== true ||
        !Number.isSafeInteger(result.recordedAt) ||
        !Number.isSafeInteger(receivedAt) ||
        result.recordedAt <= 0 ||
        result.recordedAt > receivedAt + 2000 ||
        receivedAt - result.recordedAt > 15 * 60 * 1000) {
      return { ok: false, code: 'invalid_acknowledgement' };
    }
    return { ok: true, code: SUCCESS, recordedAt: result.recordedAt };
  } catch {
    // Never expose DO errors, secrets, account data or bookmark values.
    return { ok: false, code: 'checkpoint_failed' };
  }
}

export default {
  async fetch() {
    return new Response('Not found', {
      status: 404, headers: { 'cache-control': 'no-store' }
    });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      // The operator is not allowed to touch the live DO if its independent,
      // private execution receipt cannot be persisted.
      const audit = env?.RELEASE_AUDIT;
      if (typeof audit?.put !== 'function') {
        throw new Error('private_checkpoint_receipt_binding_required');
      }
      // KV activation is private, expiring metadata only — NOT a password,
      // operator secret or PITR bookmark. This avoids redeploying the Worker
      // for a two-minute window (Cron propagation may take up to 15 minutes).
      let activation = null;
      if (typeof audit.get === 'function') {
        try {
          const candidate = await audit.get('founder-checkpoint:activation', { type: 'json' });
          if (candidate?.v === 1 &&
              candidate?.target === TARGET_SCRIPT &&
              candidate?.origin === TARGET_ORIGIN &&
              candidate?.mode === 'acknowledge-single-use-live-checkpoint') {
            activation = candidate;
          }
        } catch {
          activation = null;
        }
      }
      const runtimeEnv = activation ? {
        ...env,
        FOUNDER_RUN_ENABLED: activation.mode,
        FOUNDER_RUN_NOT_BEFORE_MS: activation.from,
        FOUNDER_RUN_NOT_AFTER_MS: activation.until,
        FOUNDER_ROTATE_ALLOWED: activation.rotateApproved === true
          ? 'preserve-old-checkpoint-and-rotate' : undefined,
        FOUNDER_ROTATE_BACKUP_DIGEST: activation.backupDigest
      } : env;
      const result = await runPrivateFounderCheckpoint({ env: runtimeEnv });
      const receipt = {
        code: result.code,
        ok: result.ok === true,
        recordedAt: result.ok ? result.recordedAt : null,
        executedAt: Date.now()
      };
      // KV receipts contain only opaque status and timestamps; never bookmarks,
      // credentials, user IDs, request headers or SQL. No public KV bindings.
      await audit.put('founder-checkpoint:last-attempt',
        JSON.stringify(receipt), { expirationTtl: 60 * 60 * 24 * 3 });
      if (!result.ok) throw new Error('private_checkpoint_' + result.code);
      await audit.put('founder-checkpoint:success',
        JSON.stringify(receipt), { expirationTtl: 60 * 60 * 24 * 3 });
      console.log('private_checkpoint_recorded');
    })());
  }
};
