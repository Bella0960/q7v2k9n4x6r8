import { recordFounderRecoveryEvidence } from '../scripts/release/founder-recovery-evidence.mjs';
import { ROOT_NAMESPACE_ID, ROOT_OBJECT_ID } from '../scripts/release/founder-recovery-receipts.mjs';

const BACKUP_URL = 'https://maomao.internal/internal/release/founder-backup';
const RESTORE_NAMESPACE_ID = '23e6ea47970441d28887d5951997710e';

export async function runPrivateFounderBackup({ env, activation, now = Date.now }) {
  const from = Number(activation?.from);
  const until = Number(activation?.until);
  const time = now();
  if (activation?.mode !== 'seal-and-verify-original-production-db' ||
      activation.sourceObjectId !== ROOT_OBJECT_ID ||
      !Number.isSafeInteger(from) || !Number.isSafeInteger(until) ||
      until <= from || until - from > 120000 || time < from || time >= until) {
    return { ok: false, code: 'backup_activation_invalid' };
  }
  const targetId = env.FOUNDER_RESTORE_OBJECT_ID;
  const token = env.FOUNDER_RELEASE_OPERATOR_SECRET;
  const vault = env.FOUNDER_BACKUP_VAULT;
  const audit = env.RELEASE_AUDIT;
  const source = env.LIVE_CLOUD_DB;
  const targets = env.FOUNDER_RESTORE_TARGET;
  if (!/^[a-f0-9]{64}$/.test(targetId || '') || activation.targetObjectId !== targetId ||
      env.FOUNDER_RESTORE_NAMESPACE_ID !== RESTORE_NAMESPACE_ID ||
      typeof token !== 'string' || !/^[A-Za-z0-9_-]{48,256}$/.test(token) ||
      typeof vault?.get !== 'function' || typeof audit?.put !== 'function' ||
      typeof source?.idFromString !== 'function' || typeof targets?.idFromString !== 'function') {
    return { ok: false, code: 'backup_bindings_unavailable' };
  }

  try {
    // Resolve and validate the target using its isolated binding first.
    const target = targets.get(targets.idFromString(targetId));
    const stub = source.get(source.idFromString(ROOT_OBJECT_ID));
    const response = await stub.fetch(new Request(BACKUP_URL, {
      method: 'POST',
      headers: {
        'x-maomao-release-secret': token, 'x-maomao-backup-from': String(from),
        'x-maomao-backup-until': String(until)
      }
    }));
    if (!response.ok) return { ok: false, code: 'production_capture_http_' + response.status };
    const metadata = await response.json();
    if (metadata?.ok !== true || metadata.sourceObjectId !== ROOT_OBJECT_ID ||
        metadata.sourceNamespaceId !== ROOT_NAMESPACE_ID ||
        !/^[a-f0-9]{64}$/.test(metadata.ciphertextSha256 || '')) {
      return { ok: false, code: 'capture_acknowledgement_invalid' };
    }
    const archiveKey = 'founder-recovery/v1/' + metadata.ciphertextSha256 + '.json';
    const artifact = await vault.get(archiveKey);
    await recordFounderRecoveryEvidence({
      sealed: { ...metadata, artifact },
      expectedSource: { namespaceId: ROOT_NAMESPACE_ID, objectId: ROOT_OBJECT_ID },
      expectedTarget: { namespaceId: RESTORE_NAMESPACE_ID, objectId: targetId },
      // The source wrote the independently stored encrypted artifact before
      // acknowledging it. This executor can only read that same address.
      vault: {
        async putIfAbsent(key) {
          if (key !== archiveKey) throw new Error('backup_archive_key_mismatch');
        },
        read: key => vault.get(key)
      },
      restore: input => target.restore(input),
      audit
    });
    return { ok: true, code: 'production_backup_restored' };
  } catch {
    return { ok: false, code: 'production_backup_verification_failed' };
  }
}
