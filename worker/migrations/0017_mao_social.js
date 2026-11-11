/**
 * MAO social data in the SAME Durable Object as the official MAO identity.
 * Does not create any separate registration, session, D1 binding, or friend ID.
 * A relationship becomes accepted only after recipient consent AND founder approval.
 */
export const VERSION = '0017_mao_social';
export const SQL = `
CREATE TABLE IF NOT EXISTS mao_social_codes (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES mao_accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mao_social_one_live_code
  ON mao_social_codes(owner_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mao_social_code_expiry ON mao_social_codes(expires_at);

CREATE TABLE IF NOT EXISTS mao_social_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES mao_accounts(id),
  recipient_id TEXT NOT NULL REFERENCES mao_accounts(id),
  pair_low TEXT NOT NULL,
  pair_high TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('pending_peer','pending_admin','approved','declined','cancelled','rejected')),
  note TEXT NOT NULL DEFAULT '',
  submitted_code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  responded_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES mao_accounts(id),
  CHECK (requester_id <> recipient_id),
  CHECK (pair_low < pair_high)
);
CREATE INDEX IF NOT EXISTS idx_mao_social_request_inbox
  ON mao_social_requests(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mao_social_request_outbox
  ON mao_social_requests(requester_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mao_social_admin_queue
  ON mao_social_requests(status, responded_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mao_social_pending_pair
  ON mao_social_requests(pair_low, pair_high)
  WHERE status IN ('pending_peer','pending_admin');

CREATE TABLE IF NOT EXISTS mao_social_friends (
  pair_low TEXT NOT NULL REFERENCES mao_accounts(id),
  pair_high TEXT NOT NULL REFERENCES mao_accounts(id),
  source_request_id TEXT NOT NULL REFERENCES mao_social_requests(id),
  status TEXT NOT NULL CHECK (status IN ('accepted','removed')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pair_low, pair_high),
  CHECK (pair_low < pair_high)
);
CREATE TABLE IF NOT EXISTS mao_social_blocks (
  blocker_id TEXT NOT NULL REFERENCES mao_accounts(id),
  blocked_id TEXT NOT NULL REFERENCES mao_accounts(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS mao_social_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  pair_low TEXT NOT NULL,
  pair_high TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES mao_accounts(id),
  recipient_id TEXT NOT NULL REFERENCES mao_accounts(id),
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  created_at INTEGER NOT NULL,
  UNIQUE (sender_id, client_message_id),
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_mao_social_messages_pair
  ON mao_social_messages(pair_low, pair_high, seq);
`;