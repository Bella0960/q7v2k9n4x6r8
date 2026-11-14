/**
 * 0010_outbound_lifecycle_receipts — separate push acceptance, device receipt,
 * local durable save, and user-visible read timestamps for outbound messages.
 */
export const VERSION = '0010_outbound_lifecycle_receipts';

export const SQL = `
ALTER TABLE outbound_messages ADD COLUMN push_accepted_at INTEGER;
ALTER TABLE outbound_messages ADD COLUMN device_received_at INTEGER;
ALTER TABLE outbound_messages ADD COLUMN local_saved_at INTEGER;
ALTER TABLE outbound_messages ADD COLUMN read_at INTEGER;
ALTER TABLE outbound_messages ADD COLUMN read_by_device_id TEXT;

-- Legacy delivered_at was written only after the chat page persisted the
-- message locally and read it back. Preserve that meaning for old rows.
UPDATE outbound_messages
SET device_received_at = COALESCE(device_received_at, delivered_at),
    local_saved_at = COALESCE(local_saved_at, delivered_at)
WHERE delivery_status = 'delivered' AND delivered_at IS NOT NULL;

-- Backfill push acceptance from successful subscription deliveries where possible.
UPDATE outbound_messages
SET push_accepted_at = (
  SELECT MAX(p.updated_at)
  FROM push_deliveries p
  WHERE p.outbound_message_id = outbound_messages.id
    AND p.status = 'sent'
)
WHERE push_accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_lifecycle_read
  ON outbound_messages (device_id, character_id, read_at, local_saved_at, created_at);
`;
