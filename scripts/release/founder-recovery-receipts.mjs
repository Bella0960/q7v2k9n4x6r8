export const ROOT_NAMESPACE_ID = 'de73581323904befa8640be3f63db9b0';
export const ROOT_OBJECT_ID = 'd0d619b13394b64fd111b412a9deefb6a8b5c37e57e175ff586681e961655ab0';
export const ENCRYPTED_BACKUP_RECEIPT_KEY = 'founder-recovery:encrypted-backup-success';
export const ISOLATED_RESTORE_RECEIPT_KEY = 'founder-recovery:isolated-restore-success';

const validTime = n => Number.isSafeInteger(n) && n > 0;
const validObjectId = id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);

export function verifyProductionRecoveryReceipts(backup, restore) {
  const backupVerified = backup?.ok === true &&
    backup.code === 'encrypted_sql_kv_backup_verified' &&
    backup.sourceNamespaceId === ROOT_NAMESPACE_ID &&
    backup.sourceObjectId === ROOT_OBJECT_ID &&
    validObjectId(backup.ciphertextSha256) &&
    validTime(backup.createdAt);
  const restoreVerified = backupVerified && restore?.ok === true &&
    restore.code === 'isolated_restore_verified' &&
    restore.ciphertextSha256 === backup.ciphertextSha256 &&
    /^[0-9a-f]{32}$/.test(restore.targetNamespaceId || '') &&
    restore.targetNamespaceId !== ROOT_NAMESPACE_ID &&
    validObjectId(restore.targetObjectId) &&
    restore.targetObjectId !== ROOT_OBJECT_ID &&
    validTime(restore.verifiedAt) &&
    restore.verifiedAt >= backup.createdAt;
  return { backupVerified, restoreVerified };
}
