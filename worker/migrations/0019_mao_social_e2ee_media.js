/**
 * Additive E2EE media storage, separate from lightweight text-message pages.
 * Only AES-GCM ciphertext is stored. No real photo/audio bytes in cleartext.
 */
export const VERSION = '0019_mao_social_e2ee_media';
export const SQL = `
CREATE TABLE IF NOT EXISTS mao_social_e2ee_media (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES mao_social_messages(id),
  pair_low TEXT NOT NULL,
  pair_high TEXT NOT NULL,
  source_request_id TEXT NOT NULL REFERENCES mao_social_requests(id),
  sender_id TEXT NOT NULL REFERENCES mao_accounts(id),
  recipient_id TEXT NOT NULL REFERENCES mao_accounts(id),
  client_message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('image','voice')),
  mime TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 22 AND 560000),
  sender_key_id TEXT NOT NULL,
  recipient_key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK(sender_id <> recipient_id),
  CHECK(pair_low < pair_high),
  UNIQUE(sender_id,client_message_id)
);
CREATE INDEX IF NOT EXISTS idx_mao_social_e2ee_media_scope
ON mao_social_e2ee_media(pair_low,pair_high,source_request_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mao_social_e2ee_media_rate
ON mao_social_e2ee_media(sender_id,created_at);
`;
