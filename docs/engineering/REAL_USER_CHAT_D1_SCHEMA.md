# Real-user Chat D1 Schema v1

**Status:** migration prepared; no D1 database is bound to the production Worker, and real-user messaging remains disabled.

Migration file: `migrations/0001_real_user_chat.sql`

## Tables

- `real_user_accounts`: unique normalized handle, display name, password verifier/salt/iteration metadata, account state.
- `real_user_sessions`: stores a hash of an opaque session token, not the bearer token itself; supports expiry, revocation, and session-family invalidation.
- `real_user_friend_codes`: stores one-way hashes of random QR/add-friend codes, with expiry and revocation. QR payloads must never include passwords or session tokens.
- `real_user_friend_requests`: pending/accepted/declined/cancelled requests with canonical unordered pair keys. A partial unique index prevents two pending requests in opposite directions for the same pair.
- `real_user_friendships`: server-authoritative accepted/removed friendship state.
- `real_user_blocks`: directional blocks; either direction prevents conversation creation and message writes.
- `real_user_conversations`: one-to-one conversation keyed by canonical account pair.
- `real_user_attachments`: attachment metadata and server-generated private object key. Binary bytes are planned for private object storage, not D1.
- `real_user_messages`: allowlisted text/image/file/voice/sticker messages, ordered sequence, stable client idempotency key, and a foreign key to the attachment reference where applicable.
- `real_user_message_receipts`: recipient-only delivery/read timestamps.

## Database-level enforcement

Triggers prevent a conversation from being created unless the pair has an accepted, unblocked friendship; prevent message insertion unless the sender is a participant and the relationship remains accepted/unblocked; ensure attachment references are owned by the sender, shared into the exact conversation, and match the message type; and ensure a receipt belongs to the other participant, not the sender.

CHECK constraints and unique indexes enforce normalized handles, password-verifier metadata shape, opaque token/code hash shape, canonical account pairs, pending-request uniqueness, message-type allowlisting, text/caption lengths, attachment size/state metadata, stable per-sender message IDs, message sequence uniqueness, and read-after-delivery ordering.

## Deliberately not included

There are no payment, red-packet, transfer, wallet, top-up, withdrawal, transaction, gift-commerce, or family-card tables. The separate MAOMAO Wallet app is not part of this schema.

Voice messages are file attachments. Live voice/video calls are not included and remain disabled.

## Activation prerequisites

1. Create a D1 database in the user's Cloudflare account and configure a real `DB` binding; this change does not add a placeholder database ID to `wrangler.jsonc`.
2. Apply the migration to a staging database first and validate all triggers and foreign keys.
3. Implement password hashing and constant-time verification, opaque random session tokens stored only as hashes, CSRF/origin protections for cookie sessions, rate limiting, account recovery, and session revocation.
4. Implement server-owned friend-code rotation and friend-request transitions with idempotency.
5. Implement authenticated conversation and message handlers; never trust account IDs, friendship states, sender IDs, message status, object keys, or attachment ownership supplied by the client.
6. Add private R2 (or equivalent) attachment storage and signed/authorized retrieval before enabling media messages.
7. Run two-account/two-device tests for registration, login/logout, QR add, accept/decline/block/remove, send/retry, reconnect, delivery/read receipts, and prohibited types.
8. Only then change the Worker capability endpoint to report messaging enabled.

This is schema groundwork, not a working account or messaging service. Until the above work is completed and verified, the Worker remains disabled and the local repository remains `local_only`.
