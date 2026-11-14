/**
 * 0006_outbound_inbox_index — index pending messages by exact recipient and role.
 */
export const VERSION = '0006_outbound_inbox_index';

export const SQL = `
CREATE INDEX IF NOT EXISTS idx_outbound_pending_device_character
  ON outbound_messages (device_id, character_id, delivery_status, created_at, id);
`;
