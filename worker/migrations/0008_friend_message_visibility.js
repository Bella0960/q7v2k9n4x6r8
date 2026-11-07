/**
 * 0008_friend_message_visibility — per-user hiding and conversation clearing.
 *
 * Neither operation deletes the shared message row: it only changes the current
 * user's view. The other participant keeps their original conversation.
 */
export const VERSION = '0008_friend_message_visibility';
export const SQL = `
CREATE TABLE IF NOT EXISTS friend_message_hides (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_message_hides_conversation
  ON friend_message_hides (user_id, friend_id, message_id);

CREATE TABLE IF NOT EXISTS friend_conversation_clears (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  clear_before_created_at INTEGER NOT NULL,
  clear_before_message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_conversation_clears_friend
  ON friend_conversation_clears (friend_id, user_id);
`;
