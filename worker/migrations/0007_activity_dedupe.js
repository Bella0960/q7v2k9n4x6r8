/**
 * 0007_activity_dedupe — account/role/context-level activity idempotency.
 * Existing activities receive unique legacy keys before the unique index is added.
 */
export const VERSION = '0007_activity_dedupe';

export const SQL = `
ALTER TABLE activity_queue ADD COLUMN dedupe_key TEXT;
UPDATE activity_queue SET dedupe_key = 'legacy:' || id WHERE dedupe_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_dedupe ON activity_queue (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_activity_recipient_due
  ON activity_queue (character_id, status, scheduled_at, next_attempt_at, locked_until);
`;
