/**
 * 0002_autonomy_metadata — explicitly authorized, non-chat scheduling metadata.
 *
 * No message body, persona, relationship memory, summary, or attachment columns.
 * Existing devices are assigned to the current single-user owner identity.
 */
export const VERSION = '0002_autonomy_metadata';

export const SQL = `
ALTER TABLE devices
  ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS user_autonomy (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_autonomy (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  enabled INTEGER CHECK (enabled IS NULL OR enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS character_schedules (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS device_presence (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  foreground_active INTEGER NOT NULL CHECK (foreground_active IN (0, 1)),
  last_heartbeat_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_presence_heartbeat
  ON device_presence (user_id, foreground_active, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS character_leases (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  owner_device_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_leases_owner
  ON character_leases (user_id, owner_device_id, lease_until);
`;
