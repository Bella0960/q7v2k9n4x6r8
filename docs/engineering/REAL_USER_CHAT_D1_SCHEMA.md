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

Triggers enforce that friendships originate from accepted friend requests, friend requests are created pending and can transition only once to a terminal state, and accepting a request materializes the friendship row. Blocking either direction removes the accepted relationship. Triggers also prevent a conversation from being created unless the pair has an accepted, unblocked friendship; prevent message insertion unless the sender is a participant and the relationship remains accepted/unblocked; make sent message content immutable; ensure attachment references are owned by the sender, shared into the exact conversation, and match the message type; ensure a receipt belongs to the other participant, not the sender; and prevent delivery/read timestamps from moving backwards.

CHECK constraints and unique indexes enforce normalized handles, password-verifier metadata shape, opaque token/code hash shape, canonical account pairs, pending-request uniqueness, message-type allowlisting, text/caption lengths, attachment size/state metadata, stable per-sender message IDs, message sequence uniqueness, and read-after-delivery ordering.

## Deliberately not included

There are no payment, red-packet, transfer, wallet, top-up, withdrawal, transaction, gift-commerce, or family-card tables. The separate MAOMAO Wallet app is not part of this schema.

Voice messages are file attachments. Live voice/video calls are not included and remain disabled.

## Activation prerequisites

1. Create a D1 database in the Cloudflare account and configure a real `DB` binding; no placeholder database ID is committed.
2. Apply the migration to a staging database first and validate all tables, triggers, and foreign keys.
3. Configure a Cloudflare Rate Limiting binding named `AUTH_LIMITER`. Keep `REAL_USER_AUTH_ENABLED` unset/false until staging verification is complete.
4. The Worker verifies that `sqlite_master` contains `real_user_accounts`, `real_user_sessions`, `real_user_friend_requests`, and `real_user_friendships` before it reports account auth as ready; a D1 binding without the migration remains disabled.
5. Run the account-auth regression suite against the staging binding, review password derivation cost and rate-limit behavior in the target Worker plan, then explicitly set `REAL_USER_AUTH_ENABLED=true` to expose account registration/login only.
6. Implement server-owned friend-code rotation and friend-request transitions with idempotency.
7. Implement authenticated conversation and message handlers; never trust account IDs, friendship states, sender IDs, message status, object keys, or attachment ownership supplied by the client.
8. Add private R2 (or equivalent) attachment storage and signed/authorized retrieval before enabling media messages.
9. Run two-account/two-device tests for registration, login/logout, QR add, accept/decline/block/remove, send/retry, reconnect, delivery/read receipts, and prohibited types.
10. Only then change the Worker capability endpoint to report messaging enabled.

Account-auth handlers are implemented in `worker/real-user-auth.js`: PBKDF2-HMAC-SHA256 password derivation (600,000 iterations), opaque random session tokens stored only as SHA-256 hashes, HttpOnly/Secure/SameSite=Strict cookies, same-origin checks, mandatory IP/handle rate limiting, and logout revocation. Account recovery, email verification, and native two-factor support remain unimplemented.

This is schema and handler groundwork, not a working deployed account or messaging service. No D1 database is bound or migrated in Cloudflare, the auth gate remains off, and the local conversation repository remains `local_only`.
