/**
 * 0003_device_pairing — one-time device enrollment and pairing.
 *
 * Pairing tokens are short-lived, single-use and stored only as peppered hashes.
 * The bootstrap claim allows one initial device only; existing devices are kept.
 */
export const VERSION = '0003_device_pairing';

export const SQL = `
CREATE TABLE IF NOT EXISTS device_pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_by_device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_creator
  ON device_pairing_tokens (created_by_device_id, created_at);

CREATE INDEX IF NOT EXISTS idx_device_pairing_expiry
  ON device_pairing_tokens (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS device_bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimed_at INTEGER,
  claimed_device_id TEXT
);

INSERT OR IGNORE INTO device_bootstrap (id, claimed_at, claimed_device_id)
SELECT
  1,
  MIN(created_at),
  (SELECT id FROM devices WHERE revoked_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 1)
FROM devices
WHERE revoked_at IS NULL
HAVING COUNT(*) > 0;

INSERT OR IGNORE INTO device_bootstrap (id, claimed_at, claimed_device_id)
VALUES (1, NULL, NULL);

CREATE TRIGGER IF NOT EXISTS claim_initial_device_after_insert
AFTER INSERT ON devices
WHEN EXISTS (
  SELECT 1 FROM device_bootstrap WHERE id = 1 AND claimed_at IS NULL
)
BEGIN
  UPDATE device_bootstrap
  SET claimed_at = NEW.created_at, claimed_device_id = NEW.id
  WHERE id = 1 AND claimed_at IS NULL;
END;
`;
