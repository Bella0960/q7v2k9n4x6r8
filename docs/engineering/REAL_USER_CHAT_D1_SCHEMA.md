# Real-user Chat D1 Schema v1

**Status:** migration prepared; no D1 database is bound to the production Worker, and real-user messaging remains disabled.

Migration files: `migrations/0001_real_user_chat.sql` and `migrations/0002_real_user_friend_code_rotation.sql`

## Tables

- `real_user_accounts`: unique normalized handle, display name, password verifier/salt/iteration metadata, account state.
- `real_user_sessions`: stores a hash of an opaque session token, not the bearer token itself; supports expiry, revocation, and session-family invalidation.
- `real_user_friend_codes`: stores one-way hashes of random QR/add-friend codes, with expiry and revocation. The v2 partial unique index permits only one unrevoked code per account. QR payloads must never include passwords or session tokens.
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

## Friend-code v2 migration

Apply `0001_real_user_chat.sql` first, then `0002_real_user_friend_code_rotation.sql`. The second migration creates a partial unique index over `real_user_friend_codes(account_id)` where `revoked_at IS NULL`. The Worker refuses to report the friend service ready unless this index and all four friend tables are visible in `sqlite_master`. Rotating a code revokes the previous code and inserts the replacement in one D1 batch.

## Activation prerequisites

1. Create a D1 database in the Cloudflare account and configure a real `DB` binding; no placeholder database ID is committed.
2. Apply `0001_real_user_chat.sql`, then `0002_real_user_friend_code_rotation.sql` to a staging database; validate all tables, triggers, foreign keys, and the active-code unique index.
3. Configure a Cloudflare Rate Limiting binding named `AUTH_LIMITER`. Keep `REAL_USER_AUTH_ENABLED` and `REAL_USER_FRIENDS_ENABLED` unset/false until staging verification is complete.
4. The Worker verifies that `sqlite_master` contains `real_user_accounts`, `real_user_sessions`, `real_user_friend_requests`, and `real_user_friendships` before it reports account auth as ready; a D1 binding without the migration remains disabled. The friend service additionally checks `real_user_friend_codes`, `real_user_blocks`, the remaining friendship/request tables, and the v2 partial unique active-code index.
5. Run the account-auth regression suite against the staging binding, review password derivation cost and rate-limit behavior in the target Worker plan, then explicitly set `REAL_USER_AUTH_ENABLED=true` to expose account registration/login only.
6. Stage-test the Worker friend handlers for QR rotation/revocation, expired-code rejection, stable request-ID retries, inbox/outbox isolation, recipient-only accept/decline, requester-only cancellation, friend removal, and block/unblock; then explicitly set `REAL_USER_FRIENDS_ENABLED=true` to expose the friend service.
7. Implement authenticated conversation and message handlers; never trust account IDs, friendship states, sender IDs, message status, object keys, or attachment ownership supplied by the client.
8. Add private R2 (or equivalent) attachment storage and signed/authorized retrieval before enabling media messages.
9. Run two-account/two-device tests for registration, login/logout, QR add, accept/decline/block/remove, send/retry, reconnect, delivery/read receipts, and prohibited types.
10. Only then change the Worker capability endpoint to report messaging enabled.

Account-auth handlers are implemented in `worker/real-user-auth.js`: PBKDF2-HMAC-SHA256 password derivation (600,000 iterations), opaque random session tokens stored only as SHA-256 hashes, HttpOnly/Secure/SameSite=Strict cookies, same-origin checks, mandatory IP/handle rate limiting, and logout revocation. Account recovery, email verification, and native two-factor support remain unimplemented.

This is schema and handler groundwork, not a working deployed account or messaging service. No D1 database is bound or migrated in Cloudflare, the auth and friend-service gates remain off, and the local conversation repository remains `local_only`.
