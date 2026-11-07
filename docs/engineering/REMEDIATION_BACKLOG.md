# MAOMAO Engineering Remediation Backlog

This backlog divides the full cleanup into independent, reviewable tasks. Agents must claim a Task ID and must not expand scope silently.

Status vocabulary: OPEN, IN PROGRESS, FIXED, DEFERRED, NOT VERIFIED.

## Phase 0 — Establish an accurate baseline

### GOV-001 — Reconcile project documentation
**Priority:** P0 · **Status:** IN PROGRESS (handbook added; source docs still need alignment)

Current evidence:
- Recursive main tree has 88 HTML pages; CLAUDE.md says 48.
- index.html currently registers ./sw.js; CLAUDE.md says registration disabled.
- CLAUDE.md claims localStorage is the only persistence layer; IndexedDB is already used by multiple modules.
- Historical audit/refactor docs describe dated states.

Scope: align CLAUDE.md with current verified architecture, link to docs/engineering, mark historical reports as dated, and remove contradictions without deleting useful design/behavior rules.

Acceptance:
- No stale page count, SW status, or “localStorage only” statement.
- All agents are directed to AGENTS.md and engineering docs.
- Every claim is tagged as current fact, historical finding, or open question.

### GOV-002 — Build full function and file ownership index
**Priority:** P1 · **Status:** OPEN

Scope: inventory launcher apps, all 88 HTML pages, shared scripts/styles, page routes, key global symbols, and cross-module callers. Verify which pages are production, hidden, test, preview, or maintenance-only.

Acceptance:
- Each production app has entry page(s), owner directory, shared dependencies, storage domains, key routes, and tests listed.
- Every query-string route parameter and important cross-page write is mapped.
- No app is deleted as an “orphan” based only on naming.

### GOV-003 — Validate root cleanup candidates
**Priority:** P2 · **Status:** OPEN

Scope: inspect apps/settings, previews, design, old reproduction scripts, android wrapper, and npm publish workflow usage. Search references and deployment inclusion before proposing removal.

Acceptance:
- Candidate has no runtime/build reference, no user data, no active workflow dependency.
- A PR shows exact deletion and impact; no bulk cleanup.

## Phase 1 — GitHub and build governance

### CI-001 — Verify APK automation stop and clear prior artifacts
**Priority:** P0 · **Status:** PARTIALLY DONE

Completed:
- build-android-apk.yml now has only workflow_dispatch.
- APK retention changed to 3 days.
- cleanup-apk-artifacts.yml was added and filters exact artifact name MAOMAO-Android-APK.

Remaining:
- Repository maintainer manually runs the cleanup workflow once.
- Verify its run log lists deleted APK artifacts or reports none found.
- Wait for GitHub usage recalculation, then check whether Actions artifact quota is clear.
- If still full, check other repositories under the same account/organization; the repo cleanup workflow cannot reach them.

Acceptance:
- A normal code push does not trigger APK build.
- Web deployment, chat test, and performance workflows remain independent.
- Old named APK artifacts in this repo are removed and documented.

### CI-002 — Audit all workflow triggers and output retention
**Priority:** P1 · **Status:** OPEN

Scope: inspect path filters, duplicate runs, concurrency, permissions, artifacts, caches, logs, and scheduled workflows.

Acceptance:
- Web deploy runs for website-relevant files only and still deploys assets.
- Test workflows run only for relevant paths and on PRs where appropriate.
- No routine workflow uploads APK or other large unneeded artifacts.
- Workflow permissions are least-privilege.
- Concurrency does not cancel production deployment unexpectedly.

### CI-003 — Resolve npm package publish template
**Priority:** P1 · **Status:** OPEN

Evidence: npm-publish-github-packages.yml runs npm test and npm publish on release; package.json at baseline defines no generic test script and package is not evidently intended as a published library.

Acceptance:
- Confirm whether publishing is a real product requirement.
- If not, disable/remove the workflow only after owner approval.
- If yes, configure package metadata, actual tests, package contents, permissions, and a dry-run release.
- No accidental publication from creating a GitHub release.

### CI-004 — Replace fake lint command
**Priority:** P1 · **Status:** OPEN

Evidence: npm run lint only prints a fixed success message.

Acceptance:
- Choose a lightweight linter compatible with native scripts and inline HTML scripts.
- Exclude generated/vendor files deliberately.
- Add real lint checks to CI only after baseline issues are triaged.
- Until then, documentation must not treat lint as a real check.

## Phase 2 — Data integrity and storage

### DATA-001 — Create one authoritative browser database registry
**Priority:** P0 · **Status:** OPEN

Scope: inventory maomao-media-store, maomao_diary_photo_store_v1, maomao-reading-library, maomao-font-presets, maomao-assets, maomao-restore-point, and every remaining localStorage domain.

Acceptance:
- One registry lists database name, version, stores, key paths, owner module, data type, backup status, migration status, and cleanup policy.
- Runtime DB/store inventory and source registry agree.
- No untracked IndexedDB database remains.

### DATA-002 — Complete backup coverage for MediaRepository
**Priority:** P0 · **Status:** OPEN

Evidence: maomao-assets (assets/blobs/refs) is not in backup.js IDB_TARGETS at baseline.

Acceptance:
- Export includes metadata, Blob payloads, references, and integrity hashes.
- Restore preserves asset IDs and owner references.
- Restore tests verify each asset resolves.
- Failed/partial restore is reported; source data remains recoverable.

Dependency: DATA-001.

### DATA-003 — Fix audio Blob backup semantics
**Priority:** P1 · **Status:** OPEN

Evidence: backup.js currently sets excludeFields: ['blob'] for audio store records, so the local music file itself is omitted from that backup target.

Acceptance:
- Decide and document whether full backups include local audio or offer a separate “large media” export.
- No silent omission; export UI lists skipped audio files and size.
- Restore result clearly reports what was restored.

### DATA-004 — Add storage usage and error diagnostics
**Priority:** P1 · **Status:** OPEN

Scope: navigator.storage.estimate where supported, localStorage key size estimates, IndexedDB per-store record counts/known byte sizes, quota errors, last backup/migration status.

Acceptance:
- Settings page displays category-level figures and last backup.
- Does not expose values, conversation text, keys, or private media in diagnostics.
- Handles unsupported browsers and estimate failures.
- No auto-delete feature.

### DATA-005 — Inventory all chat-history read/write callers
**Priority:** P0 · **Status:** OPEN

Scope: chat detail/list/search, calls, date/journey, memory, moments, notifications, forum, wallet cards, chat extras, PhoneStorage, tests, backup/export.

Acceptance:
- Call-site matrix identifies file, operation, role/group ID, legacy fallback, and whether write is direct or through PhoneStorage.
- Every caller assigned a migration step.
- Cross-role/group isolation and date-mode shared history rules are recorded.
- This is initially read-only inventory; do not switch storage backend in this task.

### DATA-006 — Design and implement IndexedDB conversation storage
**Priority:** P0 · **Status:** BLOCKED BY DATA-001/002/005

Scope: conversation metadata + message records in IndexedDB, cursor/index-based pagination, compatibility adapter, rich message preservation, resumable migration.

Acceptance:
- Migration dry-run against synthetic legacy data with thousands of text and rich messages.
- Per-conversation checksums/counts/order and message fields all match.
- Private, group, and date-mode conversations remain isolated.
- All known readers/writers use the adapter.
- Old localStorage data remains untouched until verified and explicit cleanup approval.
- If IDB fails or quota is insufficient, app remains in old mode and shows an actionable error.
- No arbitrary deletion or history cap.

### DATA-007 — Route chat image/sticker attachments into MediaRepository
**Priority:** P0 · **Status:** BLOCKED BY DATA-002/005/006

Scope: convert new image/sticker uploads to Blob assets and store asset IDs in messages; keep legacy data URL rendering compatible.

Acceptance:
- Duplicate assets are reused when hashes match.
- Object URLs are revoked.
- Deleted messages release references only when no other message/feature uses the asset.
- Backup/restore round trip succeeds.
- Existing legacy image messages render unchanged.

### DATA-008 — Make remaining legacy storage callers explicit
**Priority:** P2 · **Status:** OPEN

Scope: migrate direct localStorage readers/writers page-by-page to approved PhoneStorage/repository APIs after storage contracts are stable.

Acceptance:
- Each migration is limited to one domain or feature.
- No hidden change to key names or role scoping.
- Failures propagate and are tested.
- Direct access remains only where documented as an intentional compatibility boundary.

### DATA-009 — Decide cloud sync, if ever required
**Priority:** P3 · **Status:** DEFERRED

Current state: static Worker deployment only; no D1/R2/auth/sync configured.

Acceptance before implementation:
- User explicitly chooses whether cloud sync is wanted.
- Define accounts, encryption, privacy, conflict resolution, quotas, billing, retention, export/delete, and offline behavior.
- Compare browser-local IndexedDB-first versus server-sync architecture.
- No infrastructure added before decision.

## Feature implementation

### SOC-001 — Contact groups and Moments audience privacy
**Priority:** P1 · **Status:** IN PROGRESS (implementation committed to task branch; automated runner unavailable; build/browser verification pending)

Scope: add user-managed contact groups to the existing Contacts page, connect them to WeChat-style Moments audience selection, and establish a typed contact identity adapter for AI roles, real-user accounts, and chat groups. Keep the current native MPA pages, existing role/contact IDs, legacy Moments records, and the separate @mention feature.

Acceptance:
- Contacts can create, rename, delete groups, assign multiple contacts to groups, and filter the contact list by all / ungrouped / group.
- The local real-user directory stores stable account IDs, display names, optional avatar references, relationship state, and timestamps. It distinguishes pending outgoing, pending incoming, accepted, blocked, declined, cancelled, removed, and unblocked records; only accepted friends may join groups or Moments audiences.
- Relationship transitions require the current request ID for accept / decline / cancel operations. Incoming server events require a stable request ID; outgoing request accepted / declined responses also require a matching request ID. Duplicate delivery is idempotent, stale request replay is rejected, and terminal request states remain as tombstones in the existing directory record. A later relationship requires a fresh request ID.
- The Contacts group editor can retain existing typed real-user members and assign accepted real-user directory entries without converting them into AI-role IDs.
- Unresolved, pending, blocked, or temporarily unreadable real-user group references remain visibly marked and checked in the editor. A reference is removed only after the user explicitly unchecks it; they are not silently deleted during a rename or membership edit.
- Moments composer supports public, all contacts, private, selected groups + selected AI roles / real friends, and excluded groups + selected AI roles / real friends.
- The audience selected at publish time is snapshotted into the post; later group membership edits do not retroactively change old posts.
- @mentions remain independent from visibility selection and remain AI-role-only.
- Contact references use separate typed identities for AI roles, real-user accounts, and chat groups; existing conversation IDs and chat-history keys remain compatible.
- Groups preserve typed `memberRefs` alongside legacy AI-only `memberIds`; new Moments records include typed `visibleContactRefs` / `hiddenContactRefs` so equal raw IDs cannot cross identity types.
- Directly selected real-user contacts must still be accepted at publish time. If the real-user directory cannot be read, any selected real-user audience or selected group containing real-user members fails closed rather than silently shrinking.
- AI roles excluded from a user's post never receive its body through mention replies or automatic comments.
- Existing Moments records and visibility values remain readable; no chat history, role ID, or existing storage key is migrated or deleted.
- Group and audience policy have unit tests; build and affected page acceptance are recorded accurately.

Storage: group metadata remains in `contact_groups_v1`; the local real-user contact directory uses `real_user_contacts_v1` (schema version 2, additive lifecycle timestamps/status values); new post audience snapshots are additive fields on Moments records. No server sync or new database is introduced.

Verification note (2026-11-07): this round adds the typed local real-user directory, relationship-state filtering, accepted-friend group assignment, real-user direct selection in the Moments composer, typed recipient previews, notifier identity resolution, explicit preservation/removal of unresolved group references, and PWA shell v178. Four directory contract tests cover accepted-only roster behavior, stale snapshot rejection, corrupt-directory preservation, and stale typed group members; one additional static contract covers fail-closed UI and explicit removal. The policy/UI/identity suite defines 29 cases, and `tests/contact-directory-lifecycle.test.mjs` defines 10 additional cases covering mandatory request IDs, duplicate incoming/outgoing delivery, incoming and outgoing accept/decline/cancel responses, terminal replay protection, block/unblock, friend removal, pending queue separation, legacy records, monotonic timestamps, and storage failure. `npm run test:contact:groups` includes both Node test files before the Playwright flow. Only the earlier 24-case state had a successful isolated V8 harness run; the five later policy/UI cases, all 10 lifecycle cases, and current integration changes have not been executed. The combined suite therefore defines 39 cases, not 39 passing tests. The Playwright 390px phone-viewport flow has also been expanded, but has not executed. The latest observed seven GitHub Actions jobs (Takeout Add Button Browser Regression, PWA Mobile Navigation Regression, Custom Font Runtime Regression, Chat Regression Contract, Inspect Phone Gesture & Layout, Chat Call Regression, Performance Budget Gate) concluded with empty steps arrays, so no job step or repository test ran. This is a runner-start failure, not evidence of a code-test failure or pass. Production build and desktop/phone manual acceptance remain open. This local directory remains an adapter/cache contract only: there is no real-account signup, QR friend discovery, cloud account sync, or server-backed human-to-human message delivery.


### AI-IMG-001 — Complete role-based image generation and gallery
**Priority:** P1 · **Status:** IN PROGRESS

Scope: add stable per-role appearance/style data, an image-generation orchestration service using the existing PhoneAPI Images API, IndexedDB image records backed by MediaRepository, a Settings entry and role gallery, an explicit `/photo` chat trigger, and native image-message rendering by assetId.

Acceptance:
- Existing role records and chat messages remain readable; new role fields are additive.
- Image binaries stay in MediaRepository/IndexedDB; image records and chat messages store assetId references, never new Base64 payloads.
- `maomao-assets` backup includes image_records and the referenced Blob; failed/oversized exports are reported atomically.
- Each generated image is scoped to one character, stores prompt/scene/privacy/time metadata, and defaults to private.
- Chat generation is user-triggered only; no unsolicited automatic or probability-based generation.
- Legacy `type:image` messages using `img` continue rendering unchanged.
- Settings gallery supports per-character and public/private filtering, and generation/persistence failures are visible.
- Tests cover prompt construction, record persistence, privacy filtering, backup inclusion, and chat command/render contracts.

## Phase 3 — Shared architecture and feature safety

### ARCH-001 — Reduce chat-detail coupling
**Priority:** P1 · **Status:** OPEN

Historical audit measured chat-detail at roughly 7,181 lines and identified many responsibilities in one file. Re-measure current file before editing.

Suggested extraction boundaries: rendering/cards, group behavior, memory orchestration, input/media, search/selection. Extract one behavior at a time.

Acceptance:
- Existing DOM contracts, global bridge functions, rich messages, keyboard/touch behavior, and selectors remain compatible.
- Each extraction includes contract tests and manual acceptance.
- No simultaneous large rewrite or visual redesign.

### ARCH-002 — Unify AI request paths
**Priority:** P1 · **Status:** OPEN

Historical report found direct fetch calls in several pages alongside PhoneAPI/PhoneStream. Re-run a current inventory.

Acceptance:
- New calls use PhoneAPI for non-streaming tasks and PhoneStream for streaming chat.
- Existing timeout, partial output, JSON behavior, usage logging, error messages, and provider compatibility are preserved.
- Direct fetch exceptions are documented.

### ARCH-003 — Verify script dependency/load order
**Priority:** P2 · **Status:** OPEN

Scope: document script order for IIFE global modules and add development-time assertions where safe.

Acceptance:
- No accidental use before dependency load.
- No runtime framework introduced.
- Each module declares required global APIs in comments/tests.

## Phase 4 — Reliability, security, performance

### QA-001 — Expand real browser/mobile acceptance
**Priority:** P0 for storage/chat releases · **Status:** OPEN

Acceptance:
- Key journeys run on desktop browser and real phone browser.
- Console errors, network failures, persistence after refresh, back navigation, touch/scroll, and image rendering checked.
- Test result records device/browser and date.
- Automated static contracts are not described as full E2E coverage.

### QA-002 — Add storage-failure tests
**Priority:** P1 · **Status:** OPEN

Acceptance:
- Simulate localStorage quota errors and IndexedDB unavailable/blocked/quota errors.
- Confirm no false-success toast and no original-data deletion.
- Verify retry/reopen paths.

### SEC-001 — Review unsafe DOM, URL, and API secret paths
**Priority:** P1 · **Status:** OPEN (periodic)

Previous execution report documented XSS output escaping and backup secret exclusions. Re-check current source and every newly touched path rather than treating the historical fix as permanent proof.

Acceptance:
- Untrusted HTML is escaped or created via safe DOM APIs.
- URL and CSS URL schemes are allow-listed.
- API secrets are never logged or exported by default.
- Real user content is excluded from fixtures and logs.

### PERF-001 — Image asset size optimization
**Priority:** P2 · **Status:** OPEN

Acceptance:
- Prioritized list of assets by bytes, dimensions, and actual use.
- One-at-a-time WebP/AVIF or compression proposal with visual comparison.
- Preserve original art and transparency until approved.
- Build and visual smoke tests confirm no broken assets.

### PERF-002 — Verify build output and static resource copying
**Priority:** P2 · **Status:** OPEN

Acceptance:
- Record dist total size and largest assets.
- Confirm no test, preview, backup, or private file is accidentally published.
- Confirm every referenced image/font/audio asset is present.
- Keep relative paths compatible with Worker deployment.

## Phase 5 — Documentation and cleanup

### DOC-001 — Keep handbook synchronized
**Priority:** P1 · **Status:** IN PROGRESS (initial handbook created)

Acceptance:
- Architecture, storage registry, workflows, app inventory, and migration status updated with each relevant change.
- Dates and evidence are included.
- Historical docs remain historical and are not mistaken for active rules.

### DOC-002 — Review orphan/legacy files safely
**Priority:** P2 · **Status:** OPEN

Candidates include apps/settings, old performance reproduction scripts, preview pages, and templates. Search Vite inclusion and runtime references first.

Acceptance:
- Deletion only by separate reviewed PR.
- No user data, routes, assets, backup code, or build dependencies removed.
- No blanket cleanup.

### SOC-002 — Keep real-user conversations strictly communication-only
**Priority:** P0 · **Status:** IN PROGRESS (client policy, local repository, Worker fail-closed gate, and v1 server contract; real-user delivery is not enabled)

Product boundary:
- Real-user conversations are for ordinary communication only: text, image/file sharing, voice messages, and stickers.
- Do not expose or process red packets, transfers, payment/collection, wallet actions, transaction history/records, virtual family-card or intimate-pay balances, or gift-commerce actions between real users.
- The separate MAOMAO Wallet app remains an independent app and is not removed or rewritten by this restriction.
- Existing AI-role simulated interactions remain unchanged; the real-user policy must never inherit those capabilities by default.
- One-to-one real-user voice calling may be evaluated later, but remains disabled until genuine real-time signaling, peer connectivity, authorization, and device-consent handling exist. The current text-simulated AI call overlay is not a real telephone call and must not be reused for human calls.

Implemented groundwork:
- `PhoneContactCapabilities` defines an allowlist for `real_user`; unknown future capabilities fail closed.
- `PhoneRealUserConversationRepository` stores per-contact local messages under `real_user_chat_history_v1_<encoded account ID>`, never under AI `chat_history_<id>` keys. Only accepted typed real-user contacts can read/write; ordinary text and asset-referenced image/file/voice/sticker messages are allowlisted; message IDs are idempotent; corrupt data and storage failures fail closed. Stored entries are explicitly `local_only` / `not_connected`; no incoming delivery or sync is simulated.
- Chat plus-menu actions, direct payment drawer submission, payment-card clicks/rendering, payment marker parsing, virtual-card parsing, and call overlay entry have real-user guards.
- Voice call is represented as planned and disabled; video call is disabled.
- The chat capability policy does not apply to the standalone Wallet app or existing AI-role chats.

Acceptance:
- No real-user chat route or message adapter may enable red packets, transfers, payment/collection, wallet, or transaction records.
- Any future server/API must enforce the same policy server-side; a client-side check alone is not authorization.
- Real-user calls must use a separate genuine call service and explicit permission flow; no simulated call cards may be presented as completed live calls.
- Automated and device tests must prove blocked message types and UI actions stay blocked, while normal chat and existing AI-role features remain intact.

## Parallel work plan

Safe to parallelize:
- GOV-002 with CI-003 (different files).
- DATA-001 read-only registry work with DATA-005 read-only call-site inventory.
- PERF-001 asset inventory with ARCH-003 dependency inventory.

Do not parallelize:
- DATA-002 and DATA-007 without one backup owner and shared schema plan.
- DATA-006 with any other agent editing chat history callers.
- ARCH-001 with feature work touching chat-detail.html.
- Multiple agents editing CLAUDE.md, AGENTS.md, or the handbook.
- Multiple agents modifying .github/workflows or package scripts concurrently.

## Recommended first assignments to other AIs

1. Agent A: GOV-002 — app/page/route/cross-module ownership map, read-only.
2. Agent B: DATA-001 — IndexedDB/localStorage database registry and backup gaps, read-only.
3. Agent C: DATA-005 — all chat-history reader/writer call-site matrix, read-only.
4. Agent D: CI-002 + CI-003 — GitHub workflow and release-template review, propose patch only.
5. Agent E: PERF-001 — image asset inventory and safe optimization recommendations, no replacements yet.

Only after these reports are reviewed should implementation tasks be assigned.


Server-boundary work (2026-11-07):
- The current `worker.js` is a static-asset Worker and `wrangler.jsonc` has no real-user account authentication or message database bindings. Do not treat the current deployment as a messaging backend.
- Added `GET /api/real-user-chat/capabilities`, which explicitly reports `enabled: false`, no networking, no server acknowledgements, and disabled live voice/video calling.
- Reserved `/api/real-user-chat/*` routes fail closed with HTTP 503; the Worker does not parse message bodies, forward them to static assets, or return a fake send acknowledgement.
- Added `docs/engineering/REAL_USER_CHAT_SERVER_CONTRACT.md` with the proposed authenticated API DTOs, server-authoritative friend checks, attachment authorization, idempotency, delivery/read receipts, and release gates.
- Added `tests/real-user-chat-worker-gate.test.mjs` (5 contract cases) and `npm run test:worker:real-user-gate`; the combined contact regression command also includes this suite. The PWA v182 fetch handler bypasses static caches for the entire real-user API namespace, with an additional regression assertion. Together the PR defines 87 Node test cases plus one PWA cache assertion (88 tracked checks). The Node test cases have not been executed in a native runner; GitHub Actions currently fails before starting steps.

Additional acceptance:
- The deployed capabilities endpoint must remain disabled until authentication, authoritative relationships, durable persistence, delivery acknowledgements, and two-device tests are all proven.
- The reserved API namespace must never fall through to static assets or return a success-shaped response before those gates are met.


D1 data foundation (2026-11-07):
- Added `migrations/0001_real_user_chat.sql` with separate account/session, hashed QR friend-code, friend-request, friendship, block, one-to-one conversation, attachment metadata, message, and recipient receipt tables. Acceptance atomically materializes a friendship; one-way request transitions and block revocation are enforced by triggers.
- Added database constraints and triggers for canonical account pairs, one pending friend request per unordered pair, accepted/unblocked friendship checks, sender participation, attachment owner/conversation/type checks, recipient-only receipts, and read-after-delivery ordering.
- The message type CHECK permits only text/image/file/voice/sticker. No financial or wallet tables are created.
- Added `tests/real-user-chat-d1-schema.test.mjs` (14 schema safety contracts), `npm run test:real-user:d1-schema`, and included it in `test:contact:groups`.
- A local SQLite 3.46.1 validation executed a DDL-equivalent copy of the current migration statements and passed eight integration scenarios: request acceptance creates a friendship; accepted friends can create a conversation and send; receipts are recipient-only and monotonic; blocking revokes friendship and prevents messages; blocked pairs cannot create requests; a fresh request is required after unblocking; reverse duplicate pending requests are rejected; and payment-like message types fail the table CHECK. This is local schema validation only, not a Cloudflare D1 staging apply.
- No D1 database is bound or migrated in Cloudflare, and no authentication or messaging endpoint is enabled. Native Node contract execution and a staging D1 apply remain required.


Account authentication groundwork (2026-11-07):
- Added `worker/real-user-auth.js` and Worker routes: `POST /api/real-user-chat/v1/auth/register`, `POST /login`, `GET /me`, and `POST /logout`.
- Registration/login use PBKDF2-HMAC-SHA256 (600,000 iterations) with a per-account random salt. Sessions use random 256-bit opaque tokens, set only as `__Host-mao_session` Secure/HttpOnly/SameSite=Strict cookies; D1 stores only SHA-256 token hashes. Logout revokes the stored session.
- Unsafe methods require a same-origin HTTPS Origin; JSON bodies are streamed with an 8 KiB limit, reject unknown fields, and no cross-origin CORS is enabled.
- Authentication is fail-closed unless `REAL_USER_AUTH_ENABLED=true`, `DB` is a D1 binding, and `AUTH_LIMITER.limit()` is configured. IP and normalized-handle rate limits are both required; limiter errors keep authentication unavailable.
- Account auth readiness is reported separately by the capability endpoint. Real-user message delivery remains disabled regardless of account-auth readiness.
- Added `tests/real-user-auth.test.mjs` (12 test cases, including a contract that keeps server-only code out of Vite static assets), updated Worker gate tests (6 cases), added `npm run test:real-user:auth`, and included auth tests in `test:contact:groups`. The PR now defines 100 Node test cases plus one PWA cache assertion (101 tracked checks), none of the Node suites has run in a native project runner.
- The D1 migration is not deployed, no `DB` or `AUTH_LIMITER` binding is configured, and no UI registration/login flow is wired. Account auth is code-only groundwork and remains disabled. The Vite static-asset copy and HTML entry scans explicitly exclude the server-only `worker/` directory while the Cloudflare Worker imports it from source. Password recovery and email verification are not implemented.


Server-side QR friend service (2026-11-07):
- Added `worker/real-user-friends.js` and Worker routes for one-time display of short-lived QR code payloads, immediate code revocation, QR-based friend requests, inbox/outbox, recipient accept/decline, requester cancellation, accepted-friends list, friend removal, blocking, and unblocking.
- Friend codes are 256-bit random values with a 15-minute expiry; only SHA-256 hashes are stored. Rotation revokes previous unrevoked codes and creates a replacement in one D1 batch. The v2 migration adds a partial unique index to guarantee one unrevoked code per account; this index was executed against local SQLite 3.46.1 and verified to reject a second active code while allowing rotation after revocation.
- Friend service requires a distinct `REAL_USER_FRIENDS_ENABLED=true` flag, account auth readiness, four friend tables, the v2 unique index, and the shared D1/rate-limiter bindings. An incomplete or unmigrated schema remains disabled.
- All friend operations require an authenticated server session and IP/account rate limiting. Unsafe methods also require exact same-origin HTTPS. Request IDs are stable idempotency keys; retries survive QR expiry, and the D1 partial unique index prevents opposite-direction duplicate pending requests.
- Friend acceptance relies on the existing D1 trigger to materialize the authoritative friendship. Blocking revokes accepted friendship and terminates pending requests; a fresh request is required after unblocking.
- Added `tests/real-user-friends.test.mjs` (13 scenarios), migration v2 schema assertion (15 D1 schema cases total), and `npm run test:real-user:friends`; included the friend suite in `test:contact:groups`.
- The PR now defines 114 Node cases plus one PWA cache assertion (115 tracked checks). None of the Node suites or the new friend-handler scenarios have executed in a native project runner. No real D1 database/bindings are configured, no QR/UI integration is wired, and message delivery remains disabled.


Contacts account/friend client wiring (2026-11-07):
- Added shared/js/phone/real-user-account-client.js as a same-origin API client. It uses credentials: same-origin, cache: no-store, mode: same-origin, and redirect: error; it performs live capability discovery before session restoration, keeps account state in memory, recovers the account through /auth/me, and never persists passwords or session tokens in browser storage.
- Added the account/friend panel to chat/contacts/contacts.html through chat/contacts/real-user-account-panel.js. The panel is explicitly capability-gated: registration/login stay hidden when account auth is unavailable; friend operations stay hidden until the friend service is advertised as enabled.
- The panel provides login/register, logout, server-owned friend-code rotation/revocation, copyable 64-hex friend codes and mao://friend/add payloads, friend-request submission, incoming/outgoing request actions, and server friend listing/removal/blocking.
- Remote account/friend data is rendered separately from real_user_contacts_v1; it does not overwrite or auto-import local-only rows. Real-user rows remain outside AI chat navigation. The UI states that real-user message delivery is not active.
- QR graphic rendering, camera scanning, and custom-scheme deep-link routing are still outstanding. The panel does not claim that copying a payload is the same as displaying/scanning a QR code.
- Added tests/real-user-account-client.test.mjs (8 Node test cases) and wired it into test:contact:groups and test:real-user:client. Extended the Contacts Playwright browser flow to stub a disabled capability document and assert that login/register controls remain hidden when the service is not configured.
- The combined defined Node suite count is now 122 (previously 114, plus 8 client cases). No native Node runner or Playwright browser suite has been executed in this environment; these are defined test cases, not passing results. No Cloudflare D1 migration/bindings were applied, and no merge or deployment was performed.