import { DurableObject } from 'cloudflare:workers';
import { restoreFounderBackup } from '../scripts/release/founder-logical-backup.mjs';
import { ROOT_NAMESPACE_ID, ROOT_OBJECT_ID } from '../scripts/release/founder-recovery-receipts.mjs';

// Only this private operator owns and binds the restore-only namespace.
// Provisioning it does not activate a restore or copy production records.
export class FounderRecoveryTarget extends DurableObject {
  async restore({ artifact, ciphertextSha256 }) {
    const targetNamespaceId = this.env.FOUNDER_RESTORE_NAMESPACE_ID;
    const disposableObjectId = this.env.FOUNDER_RESTORE_OBJECT_ID;
    const key = this.env.FOUNDER_BACKUP_ENCRYPTION_KEY;
    if (!targetNamespaceId || !disposableObjectId || !key) {
      throw new Error('isolated_restore_not_authorized');
    }
    try {
      return await restoreFounderBackup({
        state: this.ctx, targetNamespaceId, disposableObjectId,
        expectedSourceNamespaceId: ROOT_NAMESPACE_ID, expectedSourceObjectId: ROOT_OBJECT_ID,
        artifact, ciphertextSha256, key
      });
    } catch {
      // The caller sees no SQLite bindings, credential values or backup bytes.
      throw new Error('isolated_restore_failed');
    }
  }
}
