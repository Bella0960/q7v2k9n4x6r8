# MAO account identity and authorization

Status: implementation branch only; production deployment is not authorized.

## Identity model

MAO accounts are separate from the existing real-friend identity and from device credentials.

- **mao_accounts.id** is the permanent MAO identity (MAO-...).
- A browser login uses a random session token stored as a hash in mao_account_sessions.
- A cloud device has its own device ID and secret. The device row is assigned to the MAO permanent account ID after a valid MAO login.
- Existing creator-owned cloud records with user_id='owner' are adopted by the one super-admin account during the one-time bootstrap. Existing rows are not copied into ordinary users.

## Account states

| State | Meaning | App entry |
| --- | --- | --- |
| pending_invite | Account exists and has a permanent ID, but no invitation has been redeemed | Denied |
| active | Invitation accepted and account authorized | Allowed |
| disabled | Temporarily blocked by the super-admin | Denied; can be restored by the super-admin |
| revoked | Authorization permanently revoked | Denied; cannot be restored |

Disabled and revoked users receive the same public message: “您的账号已被禁用”. The action and reason are only available through super-admin APIs.

## First super-admin bootstrap

The deployment owner must configure MAO_SUPER_ADMIN_BOOTSTRAP_SECRET as a Cloudflare Worker secret with at least 32 characters, in addition to the existing DEVICE_SECRET_PEPPER secret. Then exactly one account can be created through:

POST /api/admin/bootstrap:

```json
{
  "bootstrapSecret": "<worker secret>",
  "username": "<creator username>",
  "password": "<creator password, 10–128 characters>"
}
```

Bootstrap is one-time. A partial unique index prevents a second super-admin. No bootstrap secret is included in the repository or front-end bundle. This branch has not been deployed and the Worker secret has not been configured.

## User registration and invitations

1. POST /api/accounts/register creates an account with a permanent ID and pending_invite status.
2. POST /api/accounts/login establishes an HttpOnly, SameSite=Lax session cookie. A pending account can sign in only to redeem its invitation.
3. The super-admin creates a random invitation through POST /api/admin/invites and binds it to a pending permanent ID or a verified QQ email.
4. Only the matching account can redeem through POST /api/accounts/invites/redeem. Each invitation has exactly one successful redemption. The raw invitation code is returned once; only its hash is stored.
5. The Worker serves MAO app HTML only after checking an active MAO account session. Cloud API device requests also require the matching active account session.

Registration is limited to eight accounts per source IP hash per hour. The source IP itself is not stored in the account row. Failed logins are rate-limited by a persisted source-IP hash: eight failures in a 15-minute window trigger a 15-minute block; successful login clears the current source's failure record.

### QQ email limitation

QQ email may be recorded on registration. Once an account's QQ mailbox is marked verified by a future server-side verification flow, the verified email can also be used to log in and to bind an invitation. Mailbox ownership verification and outbound email delivery are not implemented in this increment, so email-targeted invitations fail closed. Permanent-ID-targeted invitations are the currently usable path.

## Disable / restore / revoke

Only a session whose account role is super_admin may call the admin actions.

- disable: block login, revoke all sessions and all device credentials, disable push subscriptions, clear live presence/leases and supersede pending autonomous tasks.
- restore: restore a temporarily disabled account. Previously revoked device credentials remain revoked; the user must log in and enroll a new device.
- revoke: permanently revoke authorization. This state cannot be restored.

The account row and its associated data are retained. Admin audit records retain the actor, action, target and optional reason. Audit and reason endpoints are admin-only.

Open pages recheck the session every 30 seconds and when returning to the foreground. Cloud APIs check every request. The account-management page displays the permanent ID, username, optional QQ email verification state, devices, and sessions. Users can revoke their own devices and other sessions, change their password (which revokes all other sessions), and log out. An already-open, fully offline page cannot receive a remote revocation until it reconnects; do not describe offline revocation as instantaneous.

## Data-adoption and lifecycle safety

The first super-admin bootstrap and the legacy `owner` adoption run inside one SQLite transaction. If any owner-scoped table fails to update, the admin row and all earlier ownership updates roll back together. The adopted tables are:

- `devices`
- `user_autonomy`
- `character_autonomy`
- `character_schedules`
- `device_presence`
- `character_leases`
- `device_pairing_tokens`
- `character_context_versions`
- `character_context_events`
- `outbound_device_receipts`

Message payloads, subscriptions, outbound rows, delivery receipts and execution logs remain attached to their existing device IDs; their owner is resolved through the device's migrated `user_id`. A remaining `user_id='owner'` device is denied after the super-admin exists rather than treated as an anonymous bypass.

Temporary account disable remembers whether the account was `pending_invite` or `active`. Restore returns it to that exact state. For older disabled rows without a recorded prior state, restore fails closed to `pending_invite`; it never grants authorization based on an unknown history. The field is added by the separate additive migration `0013_mao_account_restore_state`; migration `0012_mao_accounts` remains unchanged.

The eight-per-hour registration cap is also checked in the account INSERT statement, not only in an earlier read, so concurrent requests cannot all pass the pre-check and exceed the quota.
The creator management API loads up to 500 ordinary accounts by default so a few hundred registered users remain searchable in the first release. Cursor pagination is a follow-up before exceeding that limit.
Invitation issuance re-checks the one-active-code rule under a write transaction, and redemption consumes the code plus activates the account atomically. Current-password verification for password changes has its own IP/account-scoped 15-minute rate limit.

## Service Worker cache boundaries

- Same-origin `/api/*` GET requests bypass the shared PWA cache. Session, account, admin and cloud API responses must never be served from a cache shared by different MAO accounts.
- Imported-font CacheStorage remains account-scoped for ordinary accounts. The Service Worker resolves the current HttpOnly MAO session before opening that account's font cache.
- The creator's original `maomao-font-assets-v1` cache name remains supported so existing creator fonts are not hidden by the new account namespace.
- Protected app HTML continues to require a Worker authorization check on every navigation; offline fallback may show only the public account entry.

## Browser-side account separation

The authenticated Worker injects shared/js/mao-account-scope.js before the app's scripts and adds the authenticated account ID and role as meta values.

For normal MAO accounts, the script namespaces:

- localStorage
- sessionStorage
- IndexedDB database names
- page-created CacheStorage names and lookups

The sole super-admin intentionally keeps the creator's existing browser storage and IndexedDB names to preserve the current MAO installation. Ordinary accounts never read the unscoped legacy keys or the super-admin's namespaced cache/database records. If the browser cannot install the required namespace wrappers, the account page is stopped rather than opening unisolated data.

This is a first browser-isolation layer. It still requires real-device testing across separate accounts and browsers, and a follow-up audit of any app feature that stores user data outside these browser APIs (for example, server-side tables that have not yet been attached to MAO account IDs).

## Endpoints

Public account:
- POST /api/accounts/register
- POST /api/accounts/login
- POST /api/accounts/logout
- GET /api/accounts/me
- POST /api/accounts/invites/redeem

Super-admin only:
- GET /api/admin/bootstrap/status (public boolean only; never exposes whether the secret is configured)\n- POST /api/admin/bootstrap (one-time secret-gated setup)
- GET /api/admin/accounts
- GET /api/admin/accounts/:id/audit
- GET /api/admin/invites
- POST /api/admin/invites
- POST /api/admin/invites/:id/revoke
- POST /api/admin/accounts/:id/action (disable / restore / revoke)

## Validation

- npm run test:accounts covers account tables, one-time bootstrap, pending registration, target-bound invitation redemption, and account/device revocation.
- The command also includes browser storage namespace tests for two account IDs.
- The GitHub Actions job must execute the tests and build before the branch can be considered validated.
- Android browser testing, account switching on a shared device, real login, and admin bootstrap still need to be performed.
- QQ mailbox ownership verification/email delivery, password reset/recovery, and production configuration remain follow-up work.

No production deployment, merge into main, or APK update is part of this branch.
