/**
 * 0004_character_context_version — server-observed, content-free role context revisions.
 *
 * Stores only per-user/per-character monotonically increasing versions and
 * device-authenticated event IDs. No message bodies, summaries, persona data,
 * media metadata, or attachments are stored here.
 */
export const VERSION = '0004_character_context_version';

export const SQL = `
CREATE TABLE IF NOT EXISTS character_context_versions (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS character_context_events (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_context_events_device_created
  ON character_context_events (device_id, created_at);

CREATE INDEX IF NOT EXISTS idx_context_events_created
  ON character_context_events (created_at);
`;
