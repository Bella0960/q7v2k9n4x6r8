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
