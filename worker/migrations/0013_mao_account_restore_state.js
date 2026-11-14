/**
 * 0013_mao_account_restore_state — preserve authorization state across temporary suspension.
 *
 * This is intentionally a new additive migration. Never edit 0012 after it may have
 * been applied to a preview or persistent Durable Object database.
 */
export const VERSION = '0013_mao_account_restore_state';

export const SQL = `
ALTER TABLE mao_accounts
  ADD COLUMN disabled_from_status TEXT
  CHECK (disabled_from_status IS NULL OR disabled_from_status IN ('pending_invite', 'active'));
`;
