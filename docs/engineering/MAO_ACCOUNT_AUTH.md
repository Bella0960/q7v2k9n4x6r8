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

- disable: block login, revoke all sessions and all device credentials, disable push subscriptions, clear live presence/leases, supersede pending autonomous tasks, and revoke every unused invitation bound to the account (including an email invitation bound to its verified QQ mailbox).
- restore: restore a temporarily disabled account. Previously revoked device credentials and invitations remain revoked; a pending account must receive a newly generated one-time invitation, and the user must enroll a new device.
- revoke: permanently revoke authorization and every unused invitation bound to the account. This state cannot be restored.

The account row and its associated data are retained. Admin audit records retain the actor, action, target and optional reason. Audit and reason endpoints are admin-only.

### Creator management center

The creator-only desktop shortcut opens `/admin/admin-center.html`. The page is served only to an active `super_admin` session, and every data-changing or data-reading admin API independently checks that role.

The first management screen includes:
- A count of ordinary MAO accounts (the creator account is deliberately excluded), pending invitations, active accounts, and restricted accounts.
- Search by username, permanent MAO ID, or QQ email; filter the directory by all, pending, active, or restricted states.
- Per-account details and private audit history, with a one-tap permanent-ID copy control, stale-response protection when switching accounts, and cursor pagination for audit histories beyond the first 50 entries.
- One-time invitation generation for pending accounts, with the raw code displayed once for copying.
- Invitation records with a matching permanent account ID link directly back to that account's detail and audit view.
- Search invitation records by record ID, target permanent MAO ID, target email, or username; filter and count pending, used, expired, and revoked invitations. Only currently pending invitations expose the revoke action. When a record is both redeemed and past its expiry timestamp, the redeemed state takes precedence; revoked records take precedence over both. Missing or invalid expiry timestamps are treated as expired in the management UI.
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
The admin UI queues directory-search refreshes typed while another action is busy, then reloads the latest search text once the action finishes instead of silently dropping the request. Audit requests use a monotonically increasing request sequence; closing or reopening a detail view invalidates older responses so only the newest request may update the visible history.

The creator management directories use keyset cursor pagination ordered by `created_at DESC, id DESC`. Additive migration `0014_mao_admin_directory_indexes` installs matching account and invitation sort indexes. Migration `0015_mao_account_audit_cursor` adds the target-account-scoped audit sort index for history pagination. Each request returns up to 50 records (the API accepts a bounded 1–100 page size), a stable next cursor, the full filtered-result count, and global status summaries. Search and status filters are applied in SQL before pagination, so older records remain searchable and filter counts do not shrink to the currently loaded pages. The UI appends pages on demand; refreshing or changing a filter starts again from the newest record. The cursor uses the last row's creation timestamp and permanent record ID as a deterministic tie-breaker, avoiding skips when multiple records share the same timestamp.
Invitation issuance re-checks both target eligibility (pending_invite) and the one-active-code rule under a write transaction. Disabling or permanently revoking an account atomically revokes its unused account-ID and verified-email invitations alongside sessions, devices and related state. A concurrent invitation request that passed its early route check but loses a race to account suspension is rejected by the storage-layer eligibility check. Redemption consumes the code plus activates the account atomically. Current-password verification for password changes has its own IP/account-scoped 15-minute rate limit. Password rotation and revocation of all other sessions commit in one transaction; if session revocation fails, the password change rolls back too.
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
- GET /api/admin/accounts?limit=50&cursor=...&search=...&status=... (keyset-paginated; status: all, pending_invite, active, restricted)
- GET /api/admin/accounts/:id/detail (authoritative account state plus active-invitation metadata in one admin-only response; excludes password and token material)
- GET /api/admin/accounts/:id/audit?limit=50&cursor=... (private per-account history, keyset-paginated)
- GET /api/admin/invites?limit=50&cursor=...&search=...&status=... (keyset-paginated; status: all, pending, used, expired, revoked)
- POST /api/admin/invites
- POST /api/admin/invites/:id/revoke
- POST /api/admin/accounts/:id/action (disable / restore / revoke)

## Isolated account-auth preview

The account-auth branch has a dedicated preview deployment configuration. It is deliberately separate from the production Worker:

- Production remains `wrangler.jsonc` with Worker name `mao`; this preview uses `wrangler.preview.jsonc` with Worker name `mao-auth-preview`.
- Both scripts run the same `worker.js` and bind a `CloudDatabase` SQLite Durable Object. A Durable Object namespace belongs to its Worker script, so the different script names create a separate namespace and do not attach to production's `mao` database. The shared internal object name in `worker.js` is only an ID name inside each Worker's own namespace.
- Preview has no route to the production Worker and no cron trigger. The account/admin UI and authenticated APIs run against the preview Worker and its own empty database. Autonomous scheduled activity and maintenance are not started by this preview.
- The preview workflow listens only to pushes on `feat/mao-account-auth-foundation`; the existing production workflow remains main-only and unchanged.

Before the preview workflow can deploy, add these GitHub Actions repository secrets. Secret values must never be committed or placed in issue/PR comments:

| GitHub Actions secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account containing both separate Worker scripts |
| `CLOUDFLARE_PREVIEW_API_TOKEN` | Dedicated Cloudflare API token with permission to deploy the preview Worker; do not reuse the production deployment token |
| `MAO_PREVIEW_DEVICE_SECRET_PEPPER` | Preview-only device/account security pepper, at least 32 characters |
| `MAO_PREVIEW_SUPER_ADMIN_BOOTSTRAP_SECRET` | Preview-only one-time creator bootstrap secret, at least 32 characters |

The workflow checks that all four secrets are present and that both preview secrets meet the minimum length before it invokes Wrangler. It then builds the branch, runs the preview-isolation contract, account contract and admin-center contract, and only then deploys `wrangler.preview.jsonc`. Wrangler installs the two preview-only values as Worker secrets named `DEVICE_SECRET_PEPPER` and `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET`.

After a successful deploy, the workflow uses the Wrangler Action's `deployment-url` output, publishes a phone-friendly link in the GitHub Actions run summary, and smoke-tests the public account-entry pages, the bootstrap-status API, and the unauthenticated admin-page redirect. These checks confirm that the preview Worker is serving its own app and protecting the admin route; they do not create the creator account. No preview has been deployed or verified yet. If the dedicated preview credentials are absent, or Actions cannot obtain a runner, no deployment occurs. The preview deployment does not merge this branch, change the production URL, reuse production data, or generate an APK.

Run `npm run test:preview:config` to verify the checked-in preview configuration is distinct from production. A passing static contract does not prove Cloudflare isolation; the first real preview deployment must still be checked for the returned Worker URL, preview account registration/bootstrap, and successful admin API operations.

## Account detail and active invitation snapshot

The admin account detail reads the admin-only `GET /api/admin/accounts/:id/detail` endpoint before rendering account actions. The response contains a safe account projection (permanent ID, username, role, current status, QQ email verification state, and lifecycle timestamps) plus the current active invitation metadata when the account is still `pending_invite`. Account state and invitation state are read together in the same Worker request, so the page does not combine a stale directory row with a newer invitation result.

The detail response never returns password hashes/salts, raw invitation codes, or invitation token hashes. It returns `invite: null` for active, disabled, revoked, and pending accounts without a currently valid code. After an invitation is revoked, the page refreshes this snapshot; a replacement-code action is shown only when the server confirms the account is still pending and no active invitation remains. Temporary lookup failures show a retry action and suppress both invitation generation and account lifecycle actions until the state can be verified. The older `GET /api/admin/accounts/:id/active-invite` endpoint remains available for compatibility and direct contract coverage.

The detail renderer also applies a monotonically increasing request sequence and checks the selected account ID before rendering a response. Closing or switching accounts invalidates older requests, preventing late responses from overwriting the currently visible detail. If another admin view changes an account or invitation first, recognized state-conflict responses trigger a fresh account/invitation snapshot and audit refresh; if that retry also fails, the page exposes a manual recheck rather than retaining stale actions. Invitation creation and revocation are also written to this target account's audit timeline inside the same database transaction as the invitation mutation. Verified-email-targeted invitations resolve to the owning MAO account for auditing. The timeline displays only invitation record ID, expiry, and usage metadata; it never stores or returns the one-time code or token hash. If an invitation mutation or another admin action fails transiently, the detail view exposes a recheck that reloads account state, invitation directories, and the selected account's audit history.

## Validation

- npm run test:accounts covers account tables, one-time bootstrap, pending registration, target-bound invitation redemption, authoritative admin detail snapshots across pending/active/disabled states, revoked-invitation refresh and replacement, account/device revocation, atomic invite create/revoke audit events (including verified-email targets), full directory cursor traversal beyond 500 accounts with duplicate-timestamp boundaries and search, and private audit history pagination beyond 200 entries.
- npm run test:admin:center covers admin-page recovery after transient session/API failures, duplicate-action button locking, audit retry and pagination behavior, the one-time invitation reveal flow on mobile, server-side directory cursor pagination controls, rendering from the authoritative account/invitation snapshot, and re-synchronizing after concurrent state conflicts, generic action-error recovery, and invitation-event audit rendering.
- The account command also includes browser storage namespace tests for two account IDs.
- The focused `MAO Account Auth Contract` workflow must execute the tests and build before the branch can be considered validated. The latest observed jobs still terminate before runner assignment (`runner_id=0`, no steps/logs), so tests and build remain NOT VERIFIED.
- Android browser testing, account switching on a shared device, real login, and admin bootstrap still need to be performed.
- QQ mailbox ownership verification/email delivery, password reset/recovery, and production configuration remain follow-up work.

No production deployment, merge into main, or APK update is part of this branch.
