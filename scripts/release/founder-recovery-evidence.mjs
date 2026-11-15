import { sha256Hex } from '../../worker/lib/crypto.js';
import { FOUNDER_BACKUP_FORMAT } from './founder-logical-backup.mjs';

const backupKey = 'founder-recovery:encrypted-backup-success';
const restoreKey = 'founder-recovery:isolated-restore-success';
const objectId = /^[0-9a-f]{64}$/;
const namespaceId = /^[0-9a-f]{32}$/;

function matchesEnvelope({ artifact, sourceNamespaceId, sourceObjectId, createdAt }) {
  try {
    const header = JSON.parse(artifact);
    return Object.keys(header).length === 6 && header.format === FOUNDER_BACKUP_FORMAT &&
      header.sourceNamespaceId === sourceNamespaceId && header.sourceObjectId === sourceObjectId &&
      header.createdAt === createdAt && typeof header.iv === 'string' &&
      /^[A-Za-z0-9_-]{16}$/.test(header.iv) && typeof header.ciphertext === 'string' &&
      /^[A-Za-z0-9_-]{23,}$/.test(header.ciphertext);
  } catch {
    return false;
  }
}

// Run only in the private release workflow. The vault must be independent of
// the production Durable Object and the audit KV. The restore capability
// must be bound to the separately pinned, empty target.
export async function recordFounderRecoveryEvidence({
  sealed, expectedSource, expectedTarget, vault, restore, audit
}) {
  if (!namespaceId.test(expectedSource?.namespaceId || '') ||
      !namespaceId.test(expectedTarget?.namespaceId || '') ||
      !objectId.test(expectedSource?.objectId || '') ||
      !objectId.test(expectedTarget?.objectId || '') ||
      expectedSource.namespaceId === expectedTarget.namespaceId ||
      expectedSource.objectId === expectedTarget.objectId) {
    throw new Error('recovery_storage_not_isolated');
  }

  const { artifact, createdAt, ciphertextSha256, sourceNamespaceId, sourceObjectId } = sealed ?? {};
  if (sourceNamespaceId !== expectedSource.namespaceId || sourceObjectId !== expectedSource.objectId ||
      !Number.isSafeInteger(createdAt) || createdAt <= 0 ||
      !objectId.test(ciphertextSha256 || '') || typeof artifact !== 'string' ||
      !matchesEnvelope(sealed) ||
      await sha256Hex(artifact) !== ciphertextSha256) {
    throw new Error('recovery_archive_unverified');
  }

  // Content-addressed storage lets a retry reuse the same independently
  // stored bytes without replacing a previous archive.
  const archiveKey = 'founder-recovery/v1/' + ciphertextSha256 + '.json';
  await vault.putIfAbsent(archiveKey, artifact);
  const storedArtifact = await vault.read(archiveKey);
  if (typeof storedArtifact !== 'string' || await sha256Hex(storedArtifact) !== ciphertextSha256) {
    throw new Error('recovery_vault_readback_failed');
  }

  const result = await restore({ artifact: storedArtifact, ciphertextSha256 });
  if (result?.ok !== true || result.code !== 'isolated_restore_verified' ||
      result.ciphertextSha256 !== ciphertextSha256 ||
      result.targetObjectId !== expectedTarget.objectId ||
      result.targetNamespaceId !== expectedTarget.namespaceId ||
      !Number.isSafeInteger(result.verifiedAt) || result.verifiedAt < createdAt) {
    throw new Error('recovery_restore_unverified');
  }

  const backup = {
    ok: true, code: 'encrypted_sql_kv_backup_verified', sourceNamespaceId, sourceObjectId,
    ciphertextSha256, createdAt
  };
  const restored = {
    ok: true, code: 'isolated_restore_verified', ciphertextSha256,
    targetNamespaceId: result.targetNamespaceId, targetObjectId: result.targetObjectId,
    verifiedAt: result.verifiedAt
  };
  // If one write fails or overlaps a different run, the release check still
  // requires matching digests. Neither record contains keys or archive bytes.
  await audit.put(backupKey, JSON.stringify(backup));
  await audit.put(restoreKey, JSON.stringify(restored));
  return { backup, restored };
}
