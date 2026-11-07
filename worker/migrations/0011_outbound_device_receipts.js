/**
 * 0011_outbound_device_receipts — account-scoped inbox with independent
 * per-device receive/save/read receipts. Source-device ownership is preserved
 * on outbound_messages; this table records each authorized device's own copy.
 */
export const VERSION = '0011_outbound_device_receipts';

export const SQL = `
CREATE TABLE IF NOT EXISTS outbound_device_receipts (
  server_message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  device_received_at INTEGER,
  local_saved_at INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (server_message_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_outbound_receipts_device_pending
  ON outbound_device_receipts (user_id, device_id, character_id, local_saved_at, server_message_id);

CREATE INDEX IF NOT EXISTS idx_outbound_receipts_account_message
  ON outbound_device_receipts (user_id, character_id, server_message_id, local_saved_at);

-- Account inbox queries start from a character and the source device; keep
-- chronological scans indexed without rewriting the immutable source ownership.
CREATE INDEX IF NOT EXISTS idx_outbound_character_source_created
  ON outbound_messages (character_id, device_id, created_at, id);

-- Preserve existing source-device lifecycle evidence for historical rows.
-- Other devices start with no receipt and can independently recover those rows.
INSERT OR IGNORE INTO outbound_device_receipts
  (server_message_id, user_id, device_id, character_id,
   device_received_at, local_saved_at, read_at, created_at, updated_at)
SELECT o.server_message_id, d.user_id, o.device_id, o.character_id,
       o.device_received_at, o.local_saved_at, o.read_at,
       o.created_at,
       COALESCE(o.read_at, o.local_saved_at, o.device_received_at, o.created_at)
FROM outbound_messages o
INNER JOIN devices d ON d.id = o.device_id;
`;
