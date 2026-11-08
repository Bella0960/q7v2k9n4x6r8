/**
 * 0012_mao_accounts — official MAO identity, invitation authorization and sessions.
 *
 * Existing device IDs and friend-account IDs are deliberately kept separate.
 * Account status is authoritative; browser state is never an authorization source.
 */
export const VERSION = '0012_mao_accounts';

export const SQL = `
CREATE TABLE IF NOT EXISTS mao_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'super_admin')),
  status TEXT NOT NULL DEFAULT 'pending_invite'
    CHECK (status IN ('pending_invite', 'active', 'disabled', 'revoked')),
  qq_email TEXT,
  qq_email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  authorized_at INTEGER,
  disabled_at INTEGER,
  revoked_at INTEGER,
  registration_ip_hash TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mao_single_super_admin
  ON mao_accounts(role) WHERE role = 'super_admin';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mao_verified_qq_email
  ON mao_accounts(qq_email)
  WHERE qq_email IS NOT NULL AND qq_email_verified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mao_accounts_status_created
  ON mao_accounts(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_mao_accounts_registration_ip_created
  ON mao_accounts(registration_ip_hash, created_at);

CREATE TABLE IF NOT EXISTS mao_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mao_accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mao_sessions_account_active
  ON mao_account_sessions(account_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS mao_invite_codes (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  target_account_id TEXT REFERENCES mao_accounts(id),
  target_email TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 20),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_by_account_id TEXT NOT NULL REFERENCES mao_accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (
    (target_account_id IS NOT NULL AND target_email IS NULL) OR
    (target_account_id IS NULL AND target_email IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mao_invites_target_account
  ON mao_invite_codes(target_account_id, expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_mao_invites_target_email
  ON mao_invite_codes(target_email, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS mao_account_audit (
  id TEXT PRIMARY KEY,
  actor_account_id TEXT,
  target_account_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mao_account_audit_target
  ON mao_account_audit(target_account_id, created_at DESC);
`;
