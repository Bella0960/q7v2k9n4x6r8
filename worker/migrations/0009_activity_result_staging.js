/**
 * 0009_activity_result_staging — persist the immutable generated result before
 * outbox insertion so a lost response/crash can repair delivery idempotently.
 */
export const VERSION = '0009_activity_result_staging';

export const SQL = `
ALTER TABLE activity_queue ADD COLUMN result_json TEXT;
ALTER TABLE activity_queue ADD COLUMN result_server_message_id TEXT;
ALTER TABLE activity_queue ADD COLUMN result_dedupe_key TEXT;
`;
