# Real-user Chat Server Contract v1

**Status:** contract and fail-closed Worker gate only. Server-backed messaging is not enabled.

This contract is for ordinary human-to-human communication between accepted MAOMAO accounts. It is deliberately separate from AI-role conversations, AI call simulations, and the standalone Wallet app.

## 1. Current runtime truth

The Cloudflare Worker serves the static application and now contains dormant account-auth handlers. `wrangler.jsonc` still has no D1 or Rate Limiting binding for real-user accounts, so those handlers remain disabled by default. The browser's `PhoneRealUserConversationRepository` is a local-only store and is not a transport.

The Worker exposes:

- `GET /api/real-user-chat/capabilities`: returns a no-store capability document; full messaging `enabled` remains `false`, while `accountAuth.enabled` separately reports whether the guarded account-auth prerequisites are present.
- `/api/real-user-chat/v1/auth/register`, `/login`, `/me`, and `/logout`: route to account-auth handlers, but return HTTP 503 until `REAL_USER_AUTH_ENABLED`, D1 `DB`, and `AUTH_LIMITER` are all configured.
- Other paths under `/api/real-user-chat`: return HTTP 503 with `real_user_chat_service_unavailable`.

The gate must not parse a message request, persist it, or return a success-shaped acknowledgement. This is intentional. A client must not infer that a message was sent merely because it exists in local storage.

## 2. Allowed and prohibited content

The v1 message-type allowlist is:

- `text`
- `image`
- `file`
- `voice` (voice message attachment, not a live call)
- `sticker`

Unknown message types are rejected by default. The service must not implement or accept red packets, transfers, payments, collections, wallet operations, transaction/trade records, top-ups, withdrawals, gifts, family-card balances, or intimate-pay features. No generic extension payload may bypass this rule.

The existing MAOMAO Wallet app remains independent. Existing AI-role simulations are unchanged and must not be reused as a real-user transport or call service.

## 3. Account authentication groundwork

The Worker now contains account-auth handlers at `/api/real-user-chat/v1/auth`:

- `POST /register`: create a handle/display-name account and issue a session.
- `POST /login`: verify the password and issue a new session.
- `GET /me`: resolve the current account from the server-side session.
- `PATCH /me`: update only the authenticated account's public display name; the account ID is derived from the session and cannot be supplied by the client.
- `POST /logout`: revoke the current session and clear the cookie.

### Profile avatar storage (separately gated)

The Worker also contains a distinct real-user avatar service at `/api/real-user-chat/v1/profile`:

- `POST /avatar`: upload one JPEG, PNG, or WebP profile image (raw binary body, maximum 5 MiB). The Worker verifies the file signature and image dimensions, generates the asset ID and private object key, stores the bytes in the private `REAL_USER_AVATARS` R2 bucket, and writes only ownership/format/size metadata plus `avatar_asset_id` to D1.
- `DELETE /avatar`: clear the current account's avatar reference and remove the previous private object when available.
- `GET /avatars/{assetId}`: serve the current avatar only to its owner or an authenticated, accepted, unblocked friend. Unknown, removed, blocked, and unrelated viewers receive the same not-found response.

This capability is independent of AI-role avatars and remains disabled unless `REAL_USER_AVATAR_ENABLED="true"`, the account-auth gate is ready, the `real_user_attachments` table and `real_user_accounts.avatar_asset_id` column exist, and the private `REAL_USER_AVATARS` R2 binding provides get/put/delete. The current `wrangler.jsonc` intentionally does not add that binding or enable flag. Avatar bytes are never put in localStorage or exposed through public object URLs; reads are authenticated and use private no-store headers. Replacing or removing an avatar invalidates the old D1 reference before best-effort object cleanup.

The handlers remain disabled unless all three conditions are met: `REAL_USER_AUTH_ENABLED="true"`, a D1 `DB` binding exists, and a Cloudflare Rate Limiting `AUTH_LIMITER` binding is configured. Profile changes require a verified session, exact same-origin HTTPS request, strict one-field JSON body, the same IP/handle rate limit, and update only `display_name` and `updated_at` for the session-owned account. Friend lists resolve the latest display name from the authoritative account row on each refresh. No such bindings or enable flag are added to `wrangler.jsonc` in this change. The capability endpoint can report account-auth readiness separately; `enabled` for real-user messaging remains false.

Registration uses PBKDF2-HMAC-SHA256 with a per-account 16-byte random salt and 600,000 iterations. Only the derived verifier and salt are stored. Password length is 12–256 UTF-8 bytes. Handles are normalized lowercase ASCII `a-z`, digits, and underscore, 3–24 characters. Login performs a dummy derivation for unknown handles and returns a generic invalid-credentials response.

Sessions use 256-bit random opaque tokens. The browser receives the token only as a `__Host-mao_session` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/`; D1 stores only its SHA-256 hash. Sessions expire after seven days and can be revoked at logout. Unsafe methods require an exact same-origin HTTPS `Origin` header. Requests are JSON-only, size-limited, reject unknown fields, and have no cross-origin CORS allowance. IP and normalized-handle rate limiting is mandatory; if the limiter is absent or errors, authentication remains unavailable. Before reporting `accountAuth.enabled: true`, the Worker also queries `sqlite_master` and verifies that the account, session, friend-request, and friendship tables from the migration exist; a bound but unmigrated D1 database remains disabled.

This is server implementation groundwork, not proof of deployed account service. There is no account recovery or email verification flow yet. Do not enable the feature until a D1 migration has been applied to staging and the required bindings/rate limits have been configured and tested.

## 4. Friend-code and friend-request service groundwork

The Worker contains server-owned friend handlers under `/api/real-user-chat/v1/friends`. The feature remains separately disabled unless `REAL_USER_FRIENDS_ENABLED="true"`, account auth is configured, all four D1 friend tables exist, both required partial unique indexes exist (one active QR code per account and one pending request per unordered account pair), all eight relationship-lifecycle triggers from the migration exist, and `AUTH_LIMITER` is available. The trigger gate is intentional: accepting a request creates the authoritative friendship row through a D1 trigger, and blocking must revoke a friendship and terminate pending requests atomically. A partially migrated database must never advertise the friend service as ready.

- `POST /codes/rotate`: revoke all previous unrevoked friend codes for the current account, create a new 256-bit random code, store only its SHA-256 hash, and return the plaintext code once with a 15-minute expiry and `mao://friend/add?code=...` QR payload.
- `DELETE /codes/me`: revoke the current account's active friend code immediately.
- `POST /requests`: accept `requestId`, `code`, and optional `note`; resolve the QR code to an active account, reject self-add, blocks, existing friendship, and reverse pending requests; persist one pending request.
- `GET /requests?direction=incoming|outgoing`: return at most 50 pending requests for the authenticated account only.
- `POST /requests/{requestId}/accept|decline|cancel`: only the recipient can accept/decline; only the requester can cancel. The existing D1 acceptance trigger materializes the friendship.
- `GET /friends?limit={1..100}&after={accountId}&snapshotAt={timestamp}`: return a page of the authenticated account's relationship snapshot in stable peer-account-ID order. The first page chooses `snapshotAt` as a paging-session marker; subsequent pages must reuse it and pass the previous page's `nextCursor`. D1 does not hold a transaction open across HTTP requests, so this marker is not a point-in-time database snapshot: each page returns the latest relationship row state visible when that page is read. If a relationship changes after its ID has already been paged, the next Contacts refresh reconciles that change. The query must not filter rows by `updated_at <= snapshotAt`, because that could omit a changed row and falsely make it look deleted. The response contains `ownerAccountId` (derived from the authenticated session, never accepted from the client), `friends` (accepted, active, unblocked profiles only), `relationships` (accepted or removed relationship state, including `acceptedRequestId` and server `updatedAt`), `snapshotAt`, `hasMore`, and `nextCursor`. Every page must report the same `ownerAccountId`; the client refreshes `/me` before paging and rejects a page-owner change or mismatch. Removed, blocked, suspended, or otherwise unreadable peers expose relationship metadata only; their private display name and avatar are omitted. Clients must fetch every page and must not reconcile the local roster from a partial result. The read-session marker keeps the paging cursor sequence coherent; it does not promise transactional snapshot isolation.
- `GET /blocks`: return only accounts that the current account has blocked, so the owner can review and unblock them without exposing another account's block list.
- `DELETE /{accountId}`: remove the accepted friendship.
- `POST /{accountId}/block` and `DELETE /{accountId}/block`: block/unblock the account. Unblocking does not recreate a friendship; a new request and acceptance are required. Existing D1 triggers remove the friendship and terminate pending requests when a block is added.

The client supplies a stable request ID; repeated sends with the same ID return the existing pending request, including after the QR code expires. A partial unique index prevents more than one pending request for an unordered account pair. The Contacts panel also exposes the authenticated account's own blocked-user list and a direct unblock action; it does not reveal users who have blocked the current account. The v2 migration adds a partial unique index that permits only one unrevoked friend code per account. Friend code values are never stored in plaintext. Unsafe methods require same-origin HTTPS and every authenticated friend request is rate-limited by both IP and account handle.

\n\nThe local regression suite now exercises the exported `handleRealUserFriends` Worker handler against the real migrations in Node's `node:sqlite` engine through a narrow D1 API adapter. It runs the Worker SQL, authentication/session lookup, rate-limit boundary, schema-readiness gate, acceptance trigger, account-profile join, stable cursor paging, removal tombstones, fresh-request re-acceptance, and block-driven pending-request termination without replacing the SQL with a fake query model. Run it with `npm run test:real-user:d1-integration` (Node.js 22.5+). This is a local SQLite integration check, not a live Cloudflare D1/staging or production verification.\n\nThe capability document reports `friends.enabled` separately from account authentication and message delivery, and reports `profileAvatar.enabled` only when the independent R2/D1 avatar gate is ready. Message delivery remains disabled. The Contacts page now has a same-origin client and a guarded account/friends panel. When the avatar capability is available, the private avatar loader is used for the signed-in account, incoming/outgoing friend requests, and accepted friends. The blocked-user list intentionally shows only the locally available display-name initial: an active block revokes avatar-read permission, so the client avoids requests that would only return not-found. Other image elements lazy-load and do not send a referrer; missing, removed, or no-longer-authorized avatars fall back to a text initial without breaking the list. It restores the account from the HttpOnly session cookie, reads server capabilities before exposing actions, and fetches every page of the server-owned friend relationship snapshot before syncing. The `real_user_contacts_v1` directory now mirrors only the active account's accepted server friends using an `ownerAccountId` scope and the server's stable `acceptedRequestId`; it does not store credentials or grant authorization. The Contacts main roster, group picker, and accepted-reference readers expose only server-synced rows matching the current in-memory authenticated account. Removed/blocked relationships become local tombstones and disappear from the accepted roster; re-adding requires a different server request ID. Server D1 remains authoritative, and a failed or incomplete fetch never writes a partial roster. The panel supports login/register, friend-code generation/revocation, incoming/outgoing request actions, and server friend removal/blocking. It now renders the QR locally with the vendored MIT-licensed qrcode-generator library using the exact `qrPayload` returned by the friend-code endpoint (validated against the returned 64-character code); creates same-origin HTTPS share links with the short-lived code in the URL fragment; accepts the legacy `mao://friend/add?code=` format; and takes an opened share link into the Contacts add-friend form. Link handoff only pre-fills the code; the user must explicitly submit the request. Invite codes are held in page memory/input only and are not persisted to browser storage. Camera scanning is now available through an explicit user-initiated scan button. The client first uses the native `BarcodeDetector` API when present and lazily loads the same-origin, locally vendored Apache-2.0 jsQR fallback on browsers without native QR detection or when native detection fails. Camera permission is requested only after the scan button is pressed; all media tracks are stopped and the video source cleared on close, page hide, hidden-tab transition, successful recognition, or startup failure. A browser without camera access still retains manual code/link entry. Real-device camera compatibility remains NOT VERIFIED. The Cloudflare D1 migration and service bindings remain unconfigured, so the account/friend panel must stay disabled in production until the backend readiness gates are satisfied. Message delivery remains disabled.

## 5. Proposed messaging API shape (not live)

All message endpoints below require an authenticated account. The account ID and sender identity are derived from a verified server-side session, never trusted from request JSON.

### Capability discovery

`GET /api/real-user-chat/capabilities`

Returns protocol version and server feature availability. A client may enable messaging only when the server explicitly reports the required authenticated messaging capability as enabled. A static policy allowlist is not evidence that transport is active.

### Send a message

`POST /api/real-user-chat/v1/conversations/{conversationId}/messages`

Illustrative request DTO:

```json
{
  "clientMessageId": "stable-client-generated-id",
  "type": "text",
  "text": "Hello"
}
```

For media messages, `text` is replaced by an attachment reference such as `assetId`, plus server-validated MIME type, byte size, and optional caption. Raw Base64 or arbitrary binary payloads do not belong in this JSON endpoint.

The client must not submit authoritative `senderId`, `recipientId`, `deliveryState`, payment fields, or arbitrary card/extension data. Unknown top-level fields are rejected rather than silently accepted.

### Read message history

`GET /api/real-user-chat/v1/conversations/{conversationId}/messages?before={opaqueCursor}&limit={1..50}`

The server derives the viewer from authentication, checks membership on every request, and returns chronological messages with an opaque next cursor. A local message ID is not an authorization token.

### Acknowledge delivery/read state

Delivery and read acknowledgements are server-owned events. A recipient client can acknowledge only messages in a conversation where it is an authenticated participant. The server must not accept a sender-provided status field as proof of delivery or reading.

## 6. Authorization and relationship checks

Before every read, send, attachment fetch, and acknowledgement, the server must:

1. Validate the access token/session, expiry, revocation, and account state.
2. Derive the acting account ID from the verified identity.
3. Resolve the conversation and its exact participants from server-owned records.
4. Confirm the sender and recipient are the expected real accounts and the relationship is currently accepted.
5. Enforce block/removal state in both directions; stale local contact-directory entries are never authoritative.
6. Confirm the requester is a participant before returning any history or media.
7. Apply per-account and per-conversation rate limits and bounded payload limits.

A client-provided `type: real_user`, contact ID, or accepted status is a hint only, not proof of identity or friendship.

## 7. Message validation and persistence

- Validate the allowlisted message type on the server, independently of the client.
- Enforce a text limit consistent with the current client contract (5,000 characters); cap captions at 240 characters.
- Validate attachment ownership, existence, MIME type, size, and conversation access before creating a message.
- Require a stable `clientMessageId`; enforce idempotency scoped to the authenticated sender and conversation.
- Reusing an idempotency key with identical content returns the existing server message; changed content returns a conflict.
- Persist the message durably before returning a successful `sent` acknowledgement.
- Store the message and its delivery/outbox event atomically, or use an equivalent durable outbox pattern.
- Do not log message bodies, attachment URLs, authentication tokens, or private account data.

## 8. Authoritative state model

- `local_only`: browser-only draft/history; never means transmitted.
- `queued`: optional client-side pending state; it is not server acceptance.
- `sent`: server has authenticated the sender and durably persisted the message.
- `delivered`: the recipient's authenticated client has acknowledged receipt.
- `read`: the recipient's authenticated client has explicitly acknowledged reading.

Only the relevant server event may advance `sent`, `delivered`, or `read`. A timeout, optimistic UI update, local storage write, or push attempt must not manufacture these states. Retries reuse the same `clientMessageId`.

## 9. Calls are separate

Voice messages are ordinary attachments and are allowed by the chat-only policy. Live voice calls are not part of this messaging API. They remain disabled until a separate real-time signaling/media service, authenticated call authorization, incoming-call delivery, peer connectivity, and explicit device permission handling are implemented and tested. The simulated AI call overlay must never be presented as a real-user call. Video calling remains disabled.

## 10. Release gates

Real-user messaging must not be enabled until all of the following are proven:

- Server authentication and account lifecycle are active.
- Server-owned friend requests and accepted/blocked/removed relationship states are authoritative.
- A durable database and attachment authorization are configured.
- Server-side message-type validation rejects every prohibited and unknown capability.
- Idempotency, recipient delivery, read acknowledgements, and reconnect behavior are tested across two independent accounts/devices.
- Abuse controls, rate limits, privacy-safe logging, and block/report handling are reviewed.
- Desktop and real-phone acceptance is completed.

Until then, the Worker gate stays disabled, the local repository remains `local_only`, and the UI must not claim that a human message was sent or received.
