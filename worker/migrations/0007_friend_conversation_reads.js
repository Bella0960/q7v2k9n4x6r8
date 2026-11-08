/**
 * 0007_friend_conversation_reads — per-user read watermarks for direct chats.
 *
 * A single monotonic message cursor per viewer / friend pair is enough to
 * calculate unread inbound messages and keep the count consistent across devices.
 */
export const VERSION = '0007_friend_conversation_reads';
export const SQL = `
CREATE TABLE IF NOT EXISTS friend_conversation_reads (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  last_read_created_at INTEGER NOT NULL,
  last_read_message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_conversation_reads_friend
  ON friend_conversation_reads (friend_id, user_id);
`;
