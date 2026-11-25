/**
 * V1 encrypted real-user messaging. This is additive to the founder's 0017
 * friendships and accounts; it does not alter old password hashes or sessions.
 * Private keys NEVER belong in SQLite or anywhere on the Worker.
 */
export const VERSION = '0018_mao_social_e2ee';
export const SQL = `
CREATE TABLE IF NOT EXISTS mao_social_e2ee_keys (
  account_id TEXT PRIMARY KEY REFERENCES mao_accounts(id),
  public_key TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mao_social_e2ee_key_id
  ON mao_social_e2ee_keys(key_id);
`;
