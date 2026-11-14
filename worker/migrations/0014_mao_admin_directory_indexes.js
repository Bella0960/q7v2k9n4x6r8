/**
 * 0014_mao_admin_directory_indexes — keep admin keyset paging efficient as directories grow.
 *
 * These additive indexes cover the stable created_at/id sort used by the account
 * and invitation management screens. The account index excludes the creator row.
 */
export const VERSION = '0014_mao_admin_directory_indexes';

export const SQL = `
CREATE INDEX IF NOT EXISTS idx_mao_accounts_directory_cursor
  ON mao_accounts(created_at DESC, id DESC)
  WHERE role != 'super_admin';

CREATE INDEX IF NOT EXISTS idx_mao_invites_directory_cursor
  ON mao_invite_codes(created_at DESC, id DESC);
`;
