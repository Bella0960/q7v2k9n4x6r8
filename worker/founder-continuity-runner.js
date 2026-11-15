import { FOUNDER_APPLY_PATH, FOUNDER_CONTINUITY_ID,
  founderContinuityEnvelopeKey
} from './lib/founder-continuity-transfer.js';
import {
  ENCRYPTED_BACKUP_RECEIPT_KEY, ISOLATED_RESTORE_RECEIPT_KEY, ROOT_OBJECT_ID,
  verifyProductionRecoveryReceipts
} from '../scripts/release/founder-recovery-receipts.mjs';

export async function runPrivateFounderContinuity({ env, activation, now = Date.now }) {
  const { from, until, backupDigest } = activation || {};
  const token = env?.FOUNDER_CONTINUITY_SECRET;
  const audit = env?.RELEASE_AUDIT;
  const time = now();
  if (activation?.mode !== 'transfer-existing-founder-001' ||
      activation.founderId !== FOUNDER_CONTINUITY_ID || typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{48,256}$/.test(token) || !/^\d{13}$/.test(from || '') ||
      !/^\d{13}$/.test(until || '') || Number(until) <= Number(from) ||
      Number(until) - Number(from) > 120000 || time < Number(from) || time >= Number(until) ||
      typeof audit?.get !== 'function' || typeof audit?.put !== 'function' ||
      typeof env.FOUNDER_BACKUP_VAULT?.get !== 'function') {
    return { ok: false, code: 'continuity_activation_invalid' };
  }
  try {
    const [backup, restore, checkpoint] = await Promise.all([
      audit.get(ENCRYPTED_BACKUP_RECEIPT_KEY, { type: 'json' }),
      audit.get(ISOLATED_RESTORE_RECEIPT_KEY, { type: 'json' }),
      audit.get('founder-checkpoint:success', { type: 'json' })
    ]);
    if (!verifyProductionRecoveryReceipts(backup, restore).restoreVerified ||
        backup.ciphertextSha256 !== backupDigest || checkpoint?.ok !== true ||
        checkpoint.code !== 'checkpoint_recorded' || checkpoint.rotated !== true ||
        checkpoint.backupDigest !== backupDigest || !Number.isSafeInteger(checkpoint.recordedAt) ||
        checkpoint.recordedAt < restore.verifiedAt || now() < checkpoint.recordedAt ||
        now() - checkpoint.recordedAt > 900000) {
      return { ok: false, code: 'continuity_recovery_unverified' };
    }
    const target = env.LIVE_CLOUD_DB.get(env.LIVE_CLOUD_DB.idFromString(ROOT_OBJECT_ID));
    const headers = { 'x-maomao-continuity-secret': token, 'content-type': 'application/json' };
    const encrypted = await env.FOUNDER_BACKUP_VAULT.get(founderContinuityEnvelopeKey(backupDigest, from));
    if (typeof encrypted !== 'string' || encrypted.length > 2048 || now() >= Number(until)) {
      return { ok: false, code: 'continuity_envelope_unavailable' };
    }
    const applied = await target.fetch('https://maomao.internal' + FOUNDER_APPLY_PATH, {
      method: 'POST', headers, body: encrypted
    });
    if (!applied.ok) return { ok: false, code: 'continuity_target_http_' + applied.status };
    const result = await applied.json();
    if (result?.ok !== true || result.founderId !== FOUNDER_CONTINUITY_ID || typeof result.changed !== 'boolean') {
      return { ok: false, code: 'continuity_acknowledgement_invalid' };
    }
    const receipt = { ok: true, code: 'founder_continuity_verified', founderId: FOUNDER_CONTINUITY_ID,
      changed: result.changed, executedAt: now(), backupDigest };
    await audit.put('founder-continuity:success', JSON.stringify(receipt));
    return receipt;
  } catch {
    return { ok: false, code: 'continuity_execution_unverified' };
  }
}
