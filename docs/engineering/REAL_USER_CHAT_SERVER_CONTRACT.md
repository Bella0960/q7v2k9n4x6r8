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
- `POST /logout`: revoke the current session and clear the cookie.

The handlers remain disabled unless all three conditions are met: `REAL_USER_AUTH_ENABLED="true"`, a D1 `DB` binding exists, and a Cloudflare Rate Limiting `AUTH_LIMITER` binding is configured. No such bindings or enable flag are added to `wrangler.jsonc` in this change. The capability endpoint can report account-auth readiness separately; `enabled` for real-user messaging remains false.

Registration uses PBKDF2-HMAC-SHA256 with a per-account 16-byte random salt and 600,000 iterations. Only the derived verifier and salt are stored. Password length is 12–256 UTF-8 bytes. Handles are normalized lowercase ASCII `a-z`, digits, and underscore, 3–24 characters. Login performs a dummy derivation for unknown handles and returns a generic invalid-credentials response.

Sessions use 256-bit random opaque tokens. The browser receives the token only as a `__Host-mao_session` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/`; D1 stores only its SHA-256 hash. Sessions expire after seven days and can be revoked at logout. Unsafe methods require an exact same-origin HTTPS `Origin` header. Requests are JSON-only, size-limited, reject unknown fields, and have no cross-origin CORS allowance. IP and normalized-handle rate limiting is mandatory; if the limiter is absent or errors, authentication remains unavailable. Before reporting `accountAuth.enabled: true`, the Worker also queries `sqlite_master` and verifies that the account, session, friend-request, and friendship tables from the migration exist; a bound but unmigrated D1 database remains disabled.

This is server implementation groundwork, not proof of deployed account service. There is no account recovery or email verification flow yet. Do not enable the feature until a D1 migration has been applied to staging and the required bindings/rate limits have been configured and tested.

## 4. Friend-code and friend-request service groundwork

The Worker contains server-owned friend handlers under `/api/real-user-chat/v1/friends`. The feature remains separately disabled unless `REAL_USER_FRIENDS_ENABLED="true"`, account auth is configured, the D1 friend tables exist, the D1 v2 active-code uniqueness index exists, and `AUTH_LIMITER` is available.

- `POST /codes/rotate`: revoke all previous unrevoked friend codes for the current account, create a new 256-bit random code, store only its SHA-256 hash, and return the plaintext code once with a 15-minute expiry and `mao://friend/add?code=...` QR payload.
- `DELETE /codes/me`: revoke the current account's active friend code immediately.
- `POST /requests`: accept `requestId`, `code`, and optional `note`; resolve the QR code to an active account, reject self-add, blocks, existing friendship, and reverse pending requests; persist one pending request.
- `GET /requests?direction=incoming|outgoing`: return at most 50 pending requests for the authenticated account only.
- `POST /requests/{requestId}/accept|decline|cancel`: only the recipient can accept/decline; only the requester can cancel. The existing D1 acceptance trigger materializes the friendship.
- `GET /friends`: return accepted, active, unblocked friends for the current account.
- `DELETE /{accountId}`: remove the accepted friendship.
- `POST /{accountId}/block` and `DELETE /{accountId}/block`: block/unblock the account. Existing D1 triggers remove the friendship and terminate pending requests when a block is added.

The client supplies a stable request ID; repeated sends with the same ID return the existing pending request, including after the QR code expires. A partial unique index prevents more than one pending request for an unordered account pair. The v2 migration adds a partial unique index that permits only one unrevoked friend code per account. Friend code values are never stored in plaintext. Unsafe methods require same-origin HTTPS and every authenticated friend request is rate-limited by both IP and account handle.

The capability document reports `friends.enabled` separately from account authentication and message delivery. Message delivery remains disabled. The Contacts page now has a same-origin client and a guarded account/friends panel. It restores the account from the HttpOnly session cookie, reads server capabilities before exposing actions, and displays only server-returned friend and request records in a separate panel; it does not merge remote rows into the local-only `real_user_contacts_v1` directory. The panel supports login/register, friend-code generation/revocation, incoming/outgoing request actions, and server friend removal/blocking. It now renders the HTTPS invitation QR locally with the vendored MIT-licensed qrcode-generator library, creates same-origin HTTPS share links with the short-lived code in the URL fragment, accepts the legacy `mao://friend/add?code=` format, and takes an opened share link into the Contacts add-friend form. Link handoff only pre-fills the code; the user must explicitly submit the request. Invite codes are held in page memory/input only and are not persisted to browser storage. Camera scanning is not yet implemented. The Cloudflare D1 migration and service bindings remain unconfigured, so the account/friend panel must stay disabled in production until the backend readiness gates are satisfied. Message delivery remains disabled.

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
