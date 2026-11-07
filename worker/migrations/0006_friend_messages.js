/**
 * 0006_friend_messages — server-persisted, text-only messages between accepted friends.
 *
 * The API enforces friendship on every read/write. Message IDs and client IDs
 * are idempotent; the table intentionally stores no media or external URLs.
 */
export const VERSION = '0006_friend_messages';
export const SQL = `
CREATE TABLE IF NOT EXISTS friend_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (sender_id <> recipient_id),
  CHECK (length(body) BETWEEN 1 AND 2000),
  UNIQUE (sender_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_messages_pair_created
  ON friend_messages (sender_id, recipient_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_friend_messages_recipient_created
  ON friend_messages (recipient_id, sender_id, created_at, id);
`;
