-- MAOMAO real-user messaging schema v1.
-- This migration creates data structures only. The Worker remains disabled until
-- authentication, D1 binding, attachment storage, and server handlers are deployed.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS real_user_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  avatar_asset_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(handle) BETWEEN 3 AND 24),
  CHECK (handle = lower(handle)),
  CHECK (handle NOT GLOB '*[^a-z0-9_]*'),
  CHECK (length(display_name) BETWEEN 1 AND 48),
  CHECK (length(password_hash) = 64 AND password_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(password_salt) BETWEEN 32 AND 128 AND password_salt NOT GLOB '*[^0-9a-f]*'),
  CHECK (password_iterations BETWEEN 100000 AND 1000000),
  CHECK (created_at > 0 AND updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS real_user_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_family_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(session_family_id) BETWEEN 16 AND 128),
  CHECK (created_at > 0 AND expires_at > created_at),
  CHECK (last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_real_user_sessions_account_expiry
  ON real_user_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_real_user_sessions_family
  ON real_user_sessions(session_family_id);

-- Only a one-way hash of a random, high-entropy friend code is stored.
-- The QR payload itself must never contain a password or session token.
CREATE TABLE IF NOT EXISTS real_user_friend_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  CHECK (length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (created_at > 0),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_real_user_friend_codes_account
  ON real_user_friend_codes(account_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS real_user_friend_requests (
  id TEXT PRIMARY KEY NOT NULL,
  requester_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  pair_low TEXT NOT NULL,
  pair_high TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (requester_id <> recipient_id),
  CHECK (pair_low < pair_high),
  CHECK (pair_low = CASE WHEN requester_id < recipient_id THEN requester_id ELSE recipient_id END),
  CHECK (pair_high = CASE WHEN requester_id < recipient_id THEN recipient_id ELSE requester_id END),
  CHECK (length(note) <= 160),
  CHECK (created_at > 0 AND updated_at >= created_at),
  CHECK (responded_at IS NULL OR responded_at >= created_at)
);

-- At most one pending request can exist in either direction for a pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_real_user_friend_requests_pending_pair
  ON real_user_friend_requests(pair_low, pair_high)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_real_user_friend_requests_inbox
  ON real_user_friend_requests(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_user_friend_requests_outbox
  ON real_user_friend_requests(requester_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS real_user_friendships (
  pair_low TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  pair_high TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'removed')),
  accepted_request_id TEXT REFERENCES real_user_friend_requests(id),
  accepted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pair_low, pair_high),
  CHECK (pair_low < pair_high),
  CHECK (accepted_at > 0 AND updated_at >= accepted_at)
);

CREATE INDEX IF NOT EXISTS idx_real_user_friendships_high
  ON real_user_friendships(pair_high, status);

CREATE TABLE IF NOT EXISTS real_user_blocks (
  blocker_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id),
  CHECK (created_at > 0)
);

CREATE INDEX IF NOT EXISTS idx_real_user_blocks_reverse
  ON real_user_blocks(blocked_id, blocker_id);

CREATE TABLE IF NOT EXISTS real_user_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  pair_low TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  pair_high TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  UNIQUE (pair_low, pair_high),
  CHECK (pair_low < pair_high),
  CHECK (created_at > 0 AND updated_at >= created_at),
  CHECK (last_sequence >= 0)
);

CREATE INDEX IF NOT EXISTS idx_real_user_conversations_low
  ON real_user_conversations(pair_low, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_user_conversations_high
  ON real_user_conversations(pair_high, updated_at DESC);

-- Binary data is stored in a private object store (planned R2 integration), not D1.
-- object_key is generated by the server; clients submit only asset_id references.
CREATE TABLE IF NOT EXISTS real_user_attachments (
  asset_id TEXT PRIMARY KEY NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES real_user_conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'voice', 'sticker')),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'staged'
    CHECK (state IN ('staged', 'shared', 'deleted')),
  created_at INTEGER NOT NULL,
  shared_at INTEGER,
  CHECK (length(asset_id) BETWEEN 8 AND 180),
  CHECK (length(object_key) BETWEEN 1 AND 512),
  CHECK (length(mime_type) BETWEEN 1 AND 120),
  CHECK (byte_size BETWEEN 1 AND 26214400),
  CHECK (created_at > 0),
  CHECK (shared_at IS NULL OR shared_at >= created_at),
  CHECK (
    (state = 'staged' AND conversation_id IS NULL AND shared_at IS NULL) OR
    (state = 'shared' AND conversation_id IS NOT NULL AND shared_at IS NOT NULL) OR
    (state = 'deleted')
  )
);

CREATE INDEX IF NOT EXISTS idx_real_user_attachments_owner
  ON real_user_attachments(owner_account_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_user_attachments_conversation
  ON real_user_attachments(conversation_id, state);

CREATE TABLE IF NOT EXISTS real_user_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES real_user_conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  sender_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'file', 'voice', 'sticker')),
  text_body TEXT,
  attachment_asset_id TEXT REFERENCES real_user_attachments(asset_id),
  caption TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, sequence),
  UNIQUE (conversation_id, sender_id, client_message_id),
  CHECK (sequence > 0),
  CHECK (length(client_message_id) BETWEEN 1 AND 160),
  CHECK (created_at > 0),
  CHECK (caption IS NULL OR length(caption) <= 240),
  CHECK (
    (type = 'text' AND text_body IS NOT NULL AND length(trim(text_body)) BETWEEN 1 AND 5000
      AND attachment_asset_id IS NULL AND caption IS NULL) OR
    (type IN ('image', 'file', 'voice', 'sticker') AND text_body IS NULL
      AND attachment_asset_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_real_user_messages_page
  ON real_user_messages(conversation_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_real_user_messages_sender
  ON real_user_messages(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS real_user_message_receipts (
  message_id TEXT NOT NULL REFERENCES real_user_messages(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES real_user_accounts(id) ON DELETE CASCADE,
  delivered_at INTEGER,
  read_at INTEGER,
  PRIMARY KEY (message_id, recipient_id),
  CHECK (delivered_at IS NULL OR delivered_at > 0),
  CHECK (read_at IS NULL OR (read_at > 0 AND delivered_at IS NOT NULL AND read_at >= delivered_at))
);

CREATE INDEX IF NOT EXISTS idx_real_user_message_receipts_recipient
  ON real_user_message_receipts(recipient_id, delivered_at, read_at);

-- Database-level guard: a conversation can only be created for an accepted,
-- unblocked friendship. The API must still authenticate and authorize every request.
CREATE TRIGGER IF NOT EXISTS trg_real_user_conversation_friend_guard
BEFORE INSERT ON real_user_conversations
WHEN
  NOT EXISTS (
    SELECT 1 FROM real_user_friendships f
    WHERE f.pair_low = NEW.pair_low AND f.pair_high = NEW.pair_high AND f.status = 'accepted'
  )
  OR EXISTS (
    SELECT 1 FROM real_user_blocks b
    WHERE (b.blocker_id = NEW.pair_low AND b.blocked_id = NEW.pair_high)
       OR (b.blocker_id = NEW.pair_high AND b.blocked_id = NEW.pair_low)
  )
BEGIN
  SELECT RAISE(ABORT, 'real_user_friendship_not_active');
END;

-- Database-level guard: even a compromised client cannot write a message into
-- a conversation after friendship removal or either-side blocking.
CREATE TRIGGER IF NOT EXISTS trg_real_user_message_friend_guard
BEFORE INSERT ON real_user_messages
WHEN NOT EXISTS (
  SELECT 1
  FROM real_user_conversations c
  JOIN real_user_friendships f
    ON f.pair_low = c.pair_low AND f.pair_high = c.pair_high AND f.status = 'accepted'
  WHERE c.id = NEW.conversation_id
    AND (NEW.sender_id = c.pair_low OR NEW.sender_id = c.pair_high)
    AND NOT EXISTS (
      SELECT 1 FROM real_user_blocks b
      WHERE (b.blocker_id = c.pair_low AND b.blocked_id = c.pair_high)
         OR (b.blocker_id = c.pair_high AND b.blocked_id = c.pair_low)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'real_user_conversation_not_authorized');
END;

-- Only an uploaded attachment owned by the sender, shared into this exact
-- conversation, and matching the message type may be referenced.
CREATE TRIGGER IF NOT EXISTS trg_real_user_message_attachment_guard
BEFORE INSERT ON real_user_messages
WHEN NEW.type <> 'text' AND NOT EXISTS (
  SELECT 1 FROM real_user_attachments a
  WHERE a.asset_id = NEW.attachment_asset_id
    AND a.owner_account_id = NEW.sender_id
    AND a.conversation_id = NEW.conversation_id
    AND a.state = 'shared'
    AND a.kind = NEW.type
)
BEGIN
  SELECT RAISE(ABORT, 'real_user_attachment_not_authorized');
END;

-- Each receipt belongs to the other participant, never the sender.
CREATE TRIGGER IF NOT EXISTS trg_real_user_receipt_recipient_guard
BEFORE INSERT ON real_user_message_receipts
WHEN NOT EXISTS (
  SELECT 1
  FROM real_user_messages m
  JOIN real_user_conversations c ON c.id = m.conversation_id
  WHERE m.id = NEW.message_id
    AND (
      (m.sender_id = c.pair_low AND NEW.recipient_id = c.pair_high) OR
      (m.sender_id = c.pair_high AND NEW.recipient_id = c.pair_low)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'real_user_receipt_recipient_invalid');
END;
