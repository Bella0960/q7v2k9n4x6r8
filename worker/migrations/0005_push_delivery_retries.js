/**
 * 0005_push_delivery_retries — leased, retryable per-subscription push delivery.
 *
 * Successful / gone delivery rows remain the idempotency record. Temporary
 * failures can be retried with bounded backoff; abandoned in-flight claims can
 * be recovered after their lease expires.
 */
export const VERSION = '0005_push_delivery_retries';

export const SQL = `
ALTER TABLE push_deliveries ADD COLUMN lease_owner TEXT;
ALTER TABLE push_deliveries ADD COLUMN lease_until INTEGER;
ALTER TABLE push_deliveries ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE push_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_deliveries ADD COLUMN updated_at INTEGER;

UPDATE push_deliveries
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_delivery_retry
  ON push_deliveries (status, next_attempt_at, lease_until);
`;
