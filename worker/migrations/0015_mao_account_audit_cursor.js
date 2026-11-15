/**
 * 0015_mao_account_audit_cursor — index per-account audit keyset pagination.
 *
 * Audit entries are private to the creator and read in created_at/id order.
 * Keep this additive so databases that already applied 0012 and 0014 migrate safely.
 */
export const VERSION = '0015_mao_account_audit_cursor';

export const SQL = `
CREATE INDEX IF NOT EXISTS idx_mao_account_audit_cursor
  ON mao_account_audit(target_account_id, created_at DESC, id DESC);
`;
