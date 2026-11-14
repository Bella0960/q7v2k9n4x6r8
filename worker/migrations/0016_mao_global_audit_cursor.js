/**
 * 0016_mao_global_audit_cursor — support creator-wide audit history pagination.
 *
 * Keep this additive so existing MAO installations can upgrade without
 * rebuilding or rewriting previously recorded audit events.
 */
export const VERSION = '0016_mao_global_audit_cursor';

export const SQL = `
CREATE INDEX IF NOT EXISTS idx_mao_audit_global_cursor
  ON mao_account_audit(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_mao_audit_action_cursor
  ON mao_account_audit(action, created_at DESC, id DESC);
`;
