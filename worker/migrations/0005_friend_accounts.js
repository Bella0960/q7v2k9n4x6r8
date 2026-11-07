/**
 * 0005_friend_accounts — independent real-user identities and friend graph.
 *
 * Friend credentials are stored only as peppered hashes. QR codes carry public
 * user IDs only; they never contain authentication secrets or device tokens.
 */
export const VERSION = '0005_friend_accounts';

export const SQL = `
CREATE TABLE IF NOT EXISTS friend_accounts (
  user_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  registration_ip_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_friend_accounts_ip_created
  ON friend_accounts (registration_ip_hash, created_at);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (requester_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair
  ON friend_requests (requester_id, recipient_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friend_requests_inbox
  ON friend_requests (recipient_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_friend_requests_outbox
  ON friend_requests (requester_id, status, created_at);

CREATE TABLE IF NOT EXISTS friendships (
  user_low_id TEXT NOT NULL,
  user_high_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_high
  ON friendships (user_high_id, created_at);
`;
