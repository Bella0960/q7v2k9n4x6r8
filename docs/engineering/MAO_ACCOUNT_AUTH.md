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
  "password": "<creator password, 10–128 characters>",
  "confirmPassword": "<same creator password>"
}
```

Bootstrap is one-time. A partial unique index prevents a second super-admin. No bootstrap secret is included in the repository or front-end bundle. This branch has not been deployed and the Worker secret has not been configured. The creator setup page checks the server's public initialized flag before revealing the setup form; if the status request fails, the form remains hidden and the page offers a retry. A final status check also runs immediately before submission. The setup form uses native browser validation for required fields, minimum lengths, and email format. The public status endpoint intentionally does not reveal whether either Worker secret is configured. If bootstrap returns `ADMIN_BOOTSTRAP_NOT_CONFIGURED`, the page explains that both `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET` and `DEVICE_SECRET_PEPPER` must be present and at least 32 characters; it never displays either secret value.

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

### Creator management center

The creator-only desktop shortcut opens `/admin/admin-center.html`. The page is served only to an active `super_admin` session, and every data-changing or data-reading admin API independently checks that role.

The first management screen includes:
- A count of ordinary MAO accounts (the creator account is deliberately excluded), pending invitations, active accounts, and restricted accounts.
- Search by username, permanent MAO ID, or QQ email; filter the directory by all, pending, active, or restricted states.
- Per-account details and private audit history, with a one-tap permanent-ID copy control and protection against stale audit responses when switching accounts.
- One-time invitation generation for pending accounts, with the raw code displayed once for copying.
- Invitation records with a matching permanent account ID link directly back to that account's detail and audit view.
- Search invitation records by record ID, target permanent MAO ID, target email, or username; filter and count pending, used, expired, and revoked invitations. Only currently pending invitations expose the revoke action.
- Temporary disable, restore, and permanent revoke actions with an admin-only reason.

The account list distinguishes `disabled` (temporary suspension) from `revoked` (permanent authorization removal). Ordinary users continue to receive the same public disabled notice for both states. The creator shortcut is restored beside Settings when an active super-admin opens the desktop, including when an older custom layout had the newly introduced shortcut stored in its removed-items list.

The page and its APIs are present on this implementation branch. They are not yet visible on the production site: this branch has not been deployed, and the one-time `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET` has not yet been configured in the Worker environment. The first creator account must be initialized exactly once after the preview/runtime environment and secret are ready. The account detail also shows whether a QQ email is verified, exposes temporary suspension for pending accounts, and surfaces an existing unused invitation's expiry/usage state. An administrator can revoke that invitation from the detail view before issuing a replacement; expired, consumed, or revoked invitations do not block a new invitation.


A user-initiated single-device revocation is also one transaction: disabling that device's push subscriptions, revoking its device credential, deleting its live presence and character leases, removing unused pairing tokens created by the device, and superseding its queued autonomous activities either all commit or all roll back. A failure during any cleanup step must not leave a partially revoked device.

Open pages recheck the session every 30 seconds and when returning to the foreground. Cloud APIs check every request. The account-management page displays the permanent ID, username, optional QQ email verification state, devices, and sessions. Users can revoke their own devices and other sessions, change their password (which revokes all other sessions), and log out. An already-open, fully offline page cannot receive a remote revocation until it reconnects; do not describe offline revocation as instantaneous. Device-authenticated API requests re-read the device row after asynchronous credential and MAO-session checks, so a device revoked while authentication is in flight is rejected using the latest persisted state rather than the stale initial lookup.

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
Invitation issuance re-checks the one-active-code rule under a write transaction, and redemption consumes the code plus activates the account atomically. Current-password verification for password changes has its own IP/account-scoped 15-minute rate limit. Password rotation and revocation of all other sessions commit in one transaction; if session revocation fails, the password change rolls back too.
In Cloudflare Durable Objects, account lifecycle, invitation, legacy-owner adoption, and schema migrations use the native `storage.transactionSync` boundary. The Node SQLite test adapter uses explicit SQL transactions behind the same store abstraction.

## Service Worker cache boundaries

- Same-origin `/api/*` GET requests bypass the shared PWA cache. Session, account, admin and cloud API responses must never be served from a cache shared by different MAO accounts.
- Imported-font CacheStorage remains account-scoped for ordinary accounts. Their font URLs include the MAO ID as a path segment, and the Service Worker compares that path to the current HttpOnly session before opening the cache. CSS resource requests are therefore isolated even though they cannot carry the page's custom fetch header.
- Every cloud chat/test push carries the recipient's MAO permanent ID. The Service Worker verifies the HttpOnly session before showing a notification and verifies it again when the notification is clicked; account mismatch, logged-out sessions and legacy `owner` payloads fail closed.
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
The page wraps same-origin `fetch` calls and legacy `XMLHttpRequest` calls to `/api/*` with `x-mao-account-context=<MAO ID>`. The server rejects an authenticated request to a private API when this context is missing, malformed, or does not match the HttpOnly session. Public account-entry routes (registration, login, logout, current-session lookup and bootstrap status/setup), plus the non-account health and push-configuration endpoints, remain usable before the app scope is installed. This prevents a stale tab for account A from using a newly changed account B cookie during the 30-second foreground recheck interval. Cross-origin requests are left untouched; if the browser cannot install the fetch/XHR wrappers, the page is blocked before app storage is opened.

This is a first browser-isolation layer. It still requires real-device testing across separate accounts and browsers, and a follow-up audit of any app feature that stores user data outside these browser APIs (for example, server-side tables that have not yet been attached to MAO account IDs).

## Endpoints

Public account-entry routes (no injected page context required):
- POST /api/accounts/register
- POST /api/accounts/login
- POST /api/accounts/logout
- GET /api/accounts/me
- GET /api/admin/bootstrap/status
- POST /api/admin/bootstrap (one-time secret-gated setup)

Authenticated account routes (require the page MAO context to match the HttpOnly session):
- GET /api/accounts/security
- POST /api/accounts/password/change
- POST /api/accounts/invites/redeem
- POST /api/accounts/sessions/:id/revoke
- POST /api/accounts/devices/:id/revoke

Super-admin only:
- GET /api/admin/bootstrap/status (public boolean only; never exposes whether the secret is configured)\n- GET /api/admin/accounts
- GET /api/admin/accounts/:id/audit
- GET /api/admin/invites
- POST /api/admin/invites
- POST /api/admin/invites/:id/revoke
- POST /api/admin/accounts/:id/action (disable / restore / revoke)

## Validation

- npm run test:accounts covers account tables, one-time bootstrap, pending registration, target-bound invitation redemption, and account/device revocation.
- The command also includes browser storage namespace tests for two account IDs.
- The focused `MAO Account Auth Contract` workflow must execute the tests and build before the branch can be considered validated. The latest observed jobs still terminate before runner assignment (`runner_id=0`, no steps/logs), so tests and build remain NOT VERIFIED.
- Android browser testing, account switching on a shared device, real login, and admin bootstrap still need to be performed.
- QQ mailbox ownership verification/email delivery, password reset/recovery, and production configuration remain follow-up work.

No production deployment, merge into main, or APK update is part of this branch.
