# Real-user Chat Server Contract v1

**Status:** contract and fail-closed Worker gate only. Server-backed messaging is not enabled.

This contract is for ordinary human-to-human communication between accepted MAOMAO accounts. It is deliberately separate from AI-role conversations, AI call simulations, and the standalone Wallet app.

## 1. Current runtime truth

The current Cloudflare Worker serves the static application only. `wrangler.jsonc` has no authentication service, D1, KV, or Durable Object binding for real-user accounts or messages. The browser's `PhoneRealUserConversationRepository` is a local-only store and is not a transport.

The Worker exposes:

- `GET /api/real-user-chat/capabilities`: returns a no-store capability document with `enabled: false`.
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

## 3. Proposed API shape (not live)

All endpoints below require an authenticated account. The account ID and sender identity are derived from a verified server-side session/token, never trusted from request JSON.

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

## 4. Authorization and relationship checks

Before every read, send, attachment fetch, and acknowledgement, the server must:

1. Validate the access token/session, expiry, revocation, and account state.
2. Derive the acting account ID from the verified identity.
3. Resolve the conversation and its exact participants from server-owned records.
4. Confirm the sender and recipient are the expected real accounts and the relationship is currently accepted.
5. Enforce block/removal state in both directions; stale local contact-directory entries are never authoritative.
6. Confirm the requester is a participant before returning any history or media.
7. Apply per-account and per-conversation rate limits and bounded payload limits.

A client-provided `type: real_user`, contact ID, or accepted status is a hint only, not proof of identity or friendship.

## 5. Message validation and persistence

- Validate the allowlisted message type on the server, independently of the client.
- Enforce a text limit consistent with the current client contract (5,000 characters); cap captions at 240 characters.
- Validate attachment ownership, existence, MIME type, size, and conversation access before creating a message.
- Require a stable `clientMessageId`; enforce idempotency scoped to the authenticated sender and conversation.
- Reusing an idempotency key with identical content returns the existing server message; changed content returns a conflict.
- Persist the message durably before returning a successful `sent` acknowledgement.
- Store the message and its delivery/outbox event atomically, or use an equivalent durable outbox pattern.
- Do not log message bodies, attachment URLs, authentication tokens, or private account data.

## 6. Authoritative state model

- `local_only`: browser-only draft/history; never means transmitted.
- `queued`: optional client-side pending state; it is not server acceptance.
- `sent`: server has authenticated the sender and durably persisted the message.
- `delivered`: the recipient's authenticated client has acknowledged receipt.
- `read`: the recipient's authenticated client has explicitly acknowledged reading.

Only the relevant server event may advance `sent`, `delivered`, or `read`. A timeout, optimistic UI update, local storage write, or push attempt must not manufacture these states. Retries reuse the same `clientMessageId`.

## 7. Calls are separate

Voice messages are ordinary attachments and are allowed by the chat-only policy. Live voice calls are not part of this messaging API. They remain disabled until a separate real-time signaling/media service, authenticated call authorization, incoming-call delivery, peer connectivity, and explicit device permission handling are implemented and tested. The simulated AI call overlay must never be presented as a real-user call. Video calling remains disabled.

## 8. Release gates

Real-user messaging must not be enabled until all of the following are proven:

- Server authentication and account lifecycle are active.
- Server-owned friend requests and accepted/blocked/removed relationship states are authoritative.
- A durable database and attachment authorization are configured.
- Server-side message-type validation rejects every prohibited and unknown capability.
- Idempotency, recipient delivery, read acknowledgements, and reconnect behavior are tested across two independent accounts/devices.
- Abuse controls, rate limits, privacy-safe logging, and block/report handling are reviewed.
- Desktop and real-phone acceptance is completed.

Until then, the Worker gate stays disabled, the local repository remains `local_only`, and the UI must not claim that a human message was sent or received.
