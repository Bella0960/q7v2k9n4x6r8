# MAOMAO founder 001 — canonical identity recovery (2026-11-13)

## Root cause confirmed by read-only Cloudflare SQLite checks

Two different isolated Durable Object namespaces each contain an **active** account with a founder role, and both founders can have the same display username. A matching username or `initialized: true` **does not establish identity equivalence**.

- Actual founder registration: Worker Preview `qa/phone-founder-001-keyreset-20261111`, Durable Object namespace `mao_qa-phone-founder-001-keyreset-20261111_CloudDatabase`. Initial registration occurred on **November 11, 2026**. This is the user-confirmed original administrator account.
- Wrong authority: deployed Worker `mao-auth-preview`, namespace `mao-auth-preview_CloudDatabase`. Its different founder account was registered on **November 10, 2026**. The integration previously delegated login to this different database.
- Both records were confirmed by **read-only** SQL, without reading password hashes, passwords, session tokens, or modifying account records. Their creation timestamps differ. Previous inference that an initialized founder in `mao-auth-preview` must be the same founder was false.
- As of this patch, the social Preview intentionally has **no** `MAO_IDENTITY_AUTHORITY` binding and **no** `MAO_IDENTITY_AUTHORITY_MODE`, while retaining `MAO_IDENTITY_MODE=delegated_preview`. It must therefore **fail closed**, hide separate registration / founder bootstrap and disable password submission. Social plaintext chat remains disabled.
- The user's actual original account and active sessions must **never** be overwritten, re-bootstrapped, reset, or silently replaced by the other account.

## Production-grade resolution

Maintain one authority backed by the user's *actual November 11 founder identity*, not a matching username from a separate namespace.

1. Establish a versioned, private backup and rollback procedure for the original account namespace, including founder account ID, password verifier, sessions, invitations, and account audit, without dumping secret values to logs or Git.
2. Prefer bringing **new feature code into the existing founder's environment** after validating SQLite migrations against a disposable backup and confirming the original account ID and sessions survive. This provides a single test URL without cross-preview account creation.
3. Before moving to a stable canonical production Worker, design an authenticated migration or login handoff that preserves the original account ID and password verifier without asking the founder to re-register. Verify ownership via the already authenticated original session; do not assume equal username means equal identity.
4. Cloudflare Workers Preview **service bindings target deployed Workers, not other Workers Previews**. Do not reattach `mao-auth-preview` and claim it is the original authority. Do not point an existing production Worker at the QA namespace without migration validation.
5. Never switch `app.mao520.com`, force reset passwords, overwrite a founder record, or merge the stacked PRs until account provenance, backup, origin security, and owner-operated Android/iOS login are verified.

## Acceptance criteria

- Founder logs in using **their existing credentials** and **their existing account ID**, with no invitation, second founder registration or magic `001` input.
- A wrong password or wrong account database cannot be reported as a new account or imply the original disappeared.
- The preview can show origin provenance/readiness in nonsecret terms; mismatched authority stays disabled.
- QA data stays isolated unless the original account namespace is explicitly selected as the test environment.
- A failed migration can restore original account and sessions, and production domain remains unchanged until signed off.

## 2026-11-13 owner screenshot: canonical 001 selected, older authority rejected

The owner supplied a screenshot of the **logged-in** "小猫 / 001 管理员" screen. A separate **read-only Cloudflare Durable Object SQLite query** verified the account's *exact permanent ID*, not merely its display name or numeric badge:

| Identity | Permanent MAO account ID | Namespace | Created (milliseconds since Unix epoch) | Decision |
| --- | --- | --- | --- | --- |
| **Canonical original founder** | `MAO-OXHBDBWCOIHPBBYN` | `mao_qa-phone-founder-001-keyreset-20261111_CloudDatabase` | `1794416935305` (2026-11-11 UTC) | **Keep: original owner-confirmed 001** |
| Older, unrelated preview founder | `MAO-URXLPJHSXHSGCZC3` | `mao-auth-preview_CloudDatabase` | `1794338978643` (2026-11-10 UTC) | **Do not use as the founder authority** |

Read-only snapshot of the **canonical** database: 4 account records, 1 friend-relationship record, 6 social-message records, 4 E2EE-media records and 1 session associated with the canonical founder account ID. All read queries reported `rows_written=0`. Counts are a point-in-time diagnostic, not a migration acceptance test; no message bodies, hashes, secret values or session tokens were inspected.

### Mandatory integration rule

1. Preserve the original founder's **exact** permanent account ID, password verifier, authorized role, session continuity, invitation and social/chat data. Do not force re-registration or a second invitation.
2. Treat the older `mao-auth-preview` founder as **non-canonical** and do **not** point login or delegation to that authority. Its matching display name and `001` badge are insufficient to prove identity. If authority provenance cannot be established, fail closed instead of silently selecting a different founder.
3. The older database is **excluded from the integration**, **not deleted**. Never destroy or overwrite it until verified off-platform backups, rollback and explicit destructive-operation authorization exist.
4. Future Worker and domain cutovers must verify the account ID and original namespace *before and after* migration with authenticated session continuity and backed-up data. Cloudflare version/Worker rollback alone does not restore SQL state.
5. Do **not** hardcode a user's personal permanent ID into generic registration, role assignment or application UI logic. Use server-side provenance checks and read-only migration gates. All other new accounts retain their normal distinct IDs.
6. This confirmation is **not** a production-release approval: PR #262/#265 remain Draft; `main`, `app.mao520.com`, Cloudflare route bindings, and both Durable Object databases are untouched by this documentation change.

## Canonical-founder code gate (2026-11-13)

The following changes are made **only in the existing PR #265 development branch**, without changing main or any deployed Worker/DO namespace.

- `worker/lib/founder-provenance.js`: optional, fail-closed runtime guard for a **selected account database**. Once configured, every API call checks that `CLOUD_DB` contains an active `super_admin` row with the exact canonical ID. A wrong namespace, a missing ID, malformed ID or delegated-preview mode is rejected **before login, friend/chat access or writes**. Never infer identity from the display name `小猫` or badge `001`.
- `worker/lib/app.js`: calls the guard in the existing API pipeline; the real friend/voice UI is unchanged.
- Per-environment Worker setting `MAO_CANONICAL_FOUNDER_ID` is deliberately **not** embedded into generic frontend code. At the selected canonical Worker environment, configure its **exact** value as `MAO-OXHBDBWCOIHPBBYN`, preferably as a Worker secret. Set `MAO_CANONICAL_FOUNDER_REQUIRED=true` if the deployment must fail even when the pin is absent. Do not apply this pin across every unrelated QA Preview: it would intentionally block synthetic test accounts.
- `tests/founder-provenance.test.mjs` checks the correct synthetic ID, wrong ID, missing pin, delegated mode, and unchanged unpinned sandboxes, using isolated SQLite fixtures. Included in `test:release:accounts` (and therefore prebuild).
- Production release hard gate `scripts/verify-production-account-readiness.mjs` now requires a bound `MAO_CANONICAL_FOUNDER_ID` secret **and** independently queries existing production DO SQLite for exactly one founder row matching the selected ID, role, active status and original `created_at`. The operator sets `MAO_CANONICAL_FOUNDER_ID` and `MAO_CANONICAL_FOUNDER_CREATED_AT=1794416935305` in the release-check *process environment*. The query is a fixed **SELECT**, not a data migration. It never reads password verifiers or tokens.
- The original 001 namespace currently contains account/friend/message/media data. A *new empty* `mao_CloudDatabase` cannot qualify as the original identity, even if someone initializes another `001` on it.

### Required remaining sequence

1. Back up the **original** `mao_qa-phone-founder-001-keyreset-20261111_CloudDatabase` (and app-origin local/IndexedDB data); preserve an independently verified rollback copy, including private records not included in public audit logs.
2. Validate an add-only migration and friend/chat/media integrity against a disposable copy **with no changes to the original QA namespace**. Preserve the founder row's ID, `created_at`, password verifier, and sessions, and verify account/friend/message/media record continuity and E2EE compatibility.
3. Run full Node build/SQLite tests and Android + iOS login/chats on a properly isolated integration Worker. Avoid rerunning the already accepted media UI redesign.
4. Configure the final Worker secret pin and prove its production Durable Object contains the selected founder before any domain mapping. The existing `app.mao520.com` Worker remains unchanged until explicitly approved.
5. No deletion of the older `mao-auth-preview_CloudDatabase`; it is merely **excluded** from authority selection. Its historical content is not part of the owner-selected account.

### Read-only infrastructure check on 2026-11-13

The currently deployed `mao` and `curly-dream-324c` Workers both expose only `ASSETS` bindings. `app.mao520.com` still maps to `curly-dream-324c`. `mao-auth-preview` does have `CLOUD_DB`, but this is **the wrong November 10 founder** and cannot be used for the new login authority. This confirms that PR code changes alone do not constitute a safe production cutover.

**Release status: blocked pending protected migration, full tests and phone acceptance.**
