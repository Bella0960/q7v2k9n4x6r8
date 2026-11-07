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

Scope: add user-managed contact groups to the existing Contacts page and connect them to WeChat-style Moments audience selection. Keep the current native MPA pages, existing role/contact IDs, legacy Moments records, and the separate @mention feature.

Acceptance:
- Contacts can create, rename, delete groups, assign multiple contacts to groups, and filter the contact list by all / ungrouped / group.
- Moments composer supports public, all contacts, private, selected groups + selected contacts, and excluded groups + excluded contacts.
- The audience selected at publish time is snapshotted into the post; later group membership edits do not retroactively change old posts.
- @mentions remain independent from visibility selection.
- AI roles excluded from a user's post never receive its body through mention replies or automatic comments.
- Existing Moments records and visibility values remain readable; no chat history, role ID, or existing storage key is migrated or deleted.
- Group and audience policy have unit tests; build and affected page acceptance are recorded accurately.

Storage: small group metadata in `contact_groups_v1`; post audience snapshots are additive fields on new Moments records. No server sync or new database is introduced.

Verification note (2026-11-07): source and inline-script syntax parsing passed; the audience policy module was executed against synthetic storage data. The PR-triggered GitHub Actions jobs report failure with `runner_id=0` and no steps, and their downloadable log objects are unavailable, so CI has not actually verified the build or tests. Desktop/phone manual acceptance remains open.


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
