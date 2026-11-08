/**
 * 0010_friendship_generation_isolation — a re-created friendship starts a
 * fresh conversation generation. Old messages remain stored but are never
 * visible through a later friendship; old client-message retries cannot replay.
 */
export const VERSION = '0010_friendship_generation_isolation';
export const SQL = `
ALTER TABLE friendships ADD COLUMN generation_id TEXT NOT NULL DEFAULT '';

UPDATE friendships
SET generation_id = lower(hex(randomblob(16)))
WHERE generation_id = '';

ALTER TABLE friend_messages ADD COLUMN generation_id TEXT NOT NULL DEFAULT '';

UPDATE friend_messages
SET generation_id = COALESCE((
  SELECT f.generation_id
  FROM friendships f
  WHERE f.user_low_id = CASE WHEN friend_messages.sender_id < friend_messages.recipient_id
    THEN friend_messages.sender_id ELSE friend_messages.recipient_id END
    AND f.user_high_id = CASE WHEN friend_messages.sender_id < friend_messages.recipient_id
    THEN friend_messages.recipient_id ELSE friend_messages.sender_id END
), '')
WHERE generation_id = '';

CREATE INDEX IF NOT EXISTS idx_friend_messages_generation_created
  ON friend_messages (generation_id, created_at, id);
`;
