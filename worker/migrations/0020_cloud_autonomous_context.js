/**
 * 0020_cloud_autonomous_context — explicit per-account consent and bounded
 * character context snapshots for server-side autonomous generation.
 *
 * The consent row defaults to absent/OFF. Chat content is never copied by
 * migration; snapshots are created only by an authenticated opt-in request.
 * Outbound group columns prepare independent bubbles for one push notification.
 */
export const VERSION = '0020_cloud_autonomous_context';

export const SQL = `
ALTER TABLE character_context_events ADD COLUMN context_version INTEGER;

CREATE TABLE IF NOT EXISTS user_context_sharing (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by_device_id TEXT
);

CREATE TABLE IF NOT EXISTS character_context_snapshots (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  context_version INTEGER NOT NULL CHECK (context_version >= 1),
  source_device_id TEXT NOT NULL,
  character_name TEXT NOT NULL DEFAULT '',
  persona_text TEXT NOT NULL DEFAULT '',
  recent_messages_json TEXT NOT NULL DEFAULT '[]',
  last_user_message_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id, context_version)
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_latest
  ON character_context_snapshots (user_id, character_id, context_version DESC);

ALTER TABLE outbound_messages ADD COLUMN group_id TEXT;
ALTER TABLE outbound_messages ADD COLUMN group_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE outbound_messages ADD COLUMN group_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_outbound_group
  ON outbound_messages (group_id, group_index, group_count);

ALTER TABLE activity_queue ADD COLUMN result_group_id TEXT;
ALTER TABLE activity_queue ADD COLUMN result_message_count INTEGER NOT NULL DEFAULT 1;
`;
