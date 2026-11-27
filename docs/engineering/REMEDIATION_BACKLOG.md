# MAOMAO Engineering Remediation Backlog

> Release instructions: always read the latest main [RELEASE_POLICY.md](RELEASE_POLICY.md). Historical workflow names, versions, and checkpoints are not active instructions.

This backlog divides the full cleanup into independent, reviewable tasks. Agents must claim a Task ID and must not expand scope silently.

Status vocabulary: OPEN, IN PROGRESS, FIXED, DEFERRED, NOT VERIFIED, PARTIALLY DONE.

## Phase 0 — Establish an accurate baseline

### GOV-001 — Reconcile project documentation
**Priority:** P0 · **Status:** IN PROGRESS (2026-11-11: refreshed main-tree inventory and corrected CLAUDE.md page count, storage wording, Service Worker wording, and test/lint description; remaining handoff details still need review)

Current evidence:
- The complete recursive main tree at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273` contains 89 HTML pages, 112 JS/MJS files, 14 CSS files, and 445 tree entries.
- `index.html` registers `./sw.js`; Service Worker behavior still requires browser/device verification after changes.
- The project uses both localStorage and multiple IndexedDB databases; migration and backup coverage remain incomplete.
- Historical audit/refactor docs describe dated states and must retain their historical labels.

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

### GOV-004 — Continuous task execution and durable handoff
**Priority:** P0 · **Status:** IN PROGRESS (execution protocol and cross-session log introduced on branch GOV-001-autonomous-execution-and-doc-sync)

Purpose: one owner request is one complete work package. The agent owns decomposition, sequencing, implementation, tests, repair loops, and the final report; the owner should not need to repeatedly say “continue”.

Acceptance:
- Default direct requests such as “fix”, “finish”, or “complete” enter IMPLEMENT-ON-BRANCH mode. Read-only mode is used only when explicitly requested.
- The agent executes every in-scope, authorized, independently actionable subtask until acceptance criteria pass or a concrete blocker/approval boundary is reached.
- After each subtask, update `docs/engineering/EXECUTION_LOG.md` with status, evidence, branch/commit/PR, tests, and next action; independent tasks continue even if one item is blocked.
- Ask the owner only for product decisions, missing requirements, credentials/secrets, destructive data actions, schema migrations requiring approval, and production merge/deployment/release actions.
- Never merge to `main`, deploy production, update APKs, configure secrets, or perform irreversible user-data operations without explicit owner approval.
- Do not claim background execution after the conversation/session ends. Leave a durable checkpoint so the next session can resume without asking the owner to repeat the task.

Execution semantics: “complete all” means all authorized work in the assigned scope, not silently activating deferred roadmap items or crossing approval boundaries. Blocked items must be recorded with the exact dependency and not disguised as completed.

### GOV-006 — Fast parallel delivery and batched QA release
**Priority:** P0 · **Status:** IN PROGRESS (2026-11-26)

Purpose: reduce owner wait time as MAOMAO and its parallel development windows grow, while preserving all existing correctness, privacy, account, storage, and deployment safeguards.

Verified baseline on 2026-11-26:
- The public QA reusable entry separates `verify` from `release`, but both operations invoke the candidate test runner; the release operation then deploys. Running both for the same unchanged SHA repeats the test plan.
- QA publication uses one non-cancelling serialized release group. Verification does not take the publish lock; concurrent publish requests still queue.
- The inspected adaptive presentation selector currently supports only `library`, `diary`, `music`, `travel`, `cafe`, and `games`, and only a narrow HTML/CSS-only presentation diff. Other changes fall back to the standard test plan.
- QA infrastructure PR #507 is still Draft/open; the current release policy says adaptive migration remains under acceptance.
- Latest inspected verify run #45792397059 failed at gate 27/51, mapped to `tests/travel-storage.browser.mjs`; the release step was skipped. The root cause is NOT VERIFIED and must not be called a product defect without further evidence.

Scope:
- Establish one-task/one-branch ownership and safe parallel work across windows.
- Define risk-based local checks and prohibit unnecessary full-suite repetition for low-risk changes.
- Batch only READY tasks into one immutable approved QA candidate, with one release coordinator.
- Avoid the duplicate verify-then-release test pass for the same SHA when a QA-only release is already authorized.
- Define stage-specific failure diagnosis and safe retry rules.
- Expand adaptive module coverage only as a separately tested, evidence-backed follow-up; do not lower the current fallback or security gates.

Acceptance:
- Every window records Task ID, base SHA, owned paths, risk lane, non-goals, checks, and PR/status.
- Conflicting file ownership is serialized; independent work continues while QA is running.
- A read-only GitHub PR conflict scanner compares branch/working-tree paths against all open PRs; exact path overlap blocks shared ownership, cross-cutting hotspots warn, and incomplete scans fail closed.
- One coordinator forms the candidate from the currently deployed QA source plus only reviewed, ready changes.
- The release queue remains serialized and non-cancelling; no parallel window deploys the same QA target.
- The same unchanged candidate is not needlessly run through both verify and release.
- Pure presentation fast-lane eligibility is explicit, module-mapped, browser-tested, and only used after the adaptive migration is accepted.
- Failures are tied to a precise stage and evidence; no blind reruns, skipped gates, or fabricated results.
- Release evidence records exact SHA, workflow run, deployed Worker version, and actual QA source receipt.

Current blockers / follow-up:
- Re-run the new engineering tooling suites on the PR head after the PR is integrated into the default branch; the new workflow file cannot run from a pull request before it exists on the base branch.
- Cloudflare's production Worker check for the latest tooling commit reports a skipped build (build outcome `skipped`, no build log), not a compiler diagnostic. The check remains NOT VERIFIED and is not treated as a test pass.
- Complete public validation and owner acceptance of QA infrastructure PR #507 before treating adaptive selection as generally active.
- Release receipt, current QA baseline, and actual QA-only deployment remain separate acceptance evidence; no source-tooling test can substitute for them.

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

Historical evidence: the obsolete npm publish workflow was removed by release hygiene PR #511. Package publication is not an active delivery channel. Follow RELEASE_POLICY.md.

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
**Priority:** P0 · **Status:** PARTIALLY DONE (verified 2026-11-23 on `40b671bb`, Windows, Node 22.22.2)

Verified on current main:
- `settings/js/backup.js` registers `maomao-assets` v2 with all four stores: `assets` (keyPath `assetId`), `blobs` (keyPath `assetId`, `blobFields: ['blob']` → Base64 round trip), `refs` (keyPath `assetId`), `image_records` (keyPath `id`).
- `atomicExport: true` discards the whole database when any blob is skipped, so an export can never contain assets/refs without their binary payload; the reason is written to `dbWarnings` and `__backup.warnings.databasesSkipped`.
- `clearOnRestore: true` clears every store even when the backup store is an empty array, so a restore cannot leave stale assets behind.
- `tests/media-backup.test.mjs` case 06 asserts an oversized blob produces `atomicExportFailed` with `data === null`; case 07 asserts a dump→restore round trip keeps 2 assets / 2 refs / 2 blobs / 1 image record byte-identical with intact reference relations. `npm run test:media:backup` → 10/10 pass (executed, not inferred).

Still open — do not mark this task FIXED:
- **Integrity hashes are absent.** `backup.js` contains no checksum/hash field; the export only carries `schema`, `complete`, `count` and `warnings`. Acceptance item 1 is therefore unmet.
- **IndexedDB is not covered by the in-app rollback.** The pre-import restore point (`maomao-restore-point`) snapshots localStorage only — the import dialog states "本机恢复点只保障 localStorage". A failure during the IndexedDB phase is reported (failure count plus retained restore point) but not automatically rolled back, so "source data remains recoverable" depends on the user having saved a full backup first.

Acceptance:
- Export includes metadata, Blob payloads, references, and integrity hashes.
- Restore preserves asset IDs and owner references.
- Restore tests verify each asset resolves.
- Failed/partial restore is reported; source data remains recoverable.

Dependency: DATA-001.

### DATA-003 — Fix audio Blob backup semantics
**Priority:** P1 · **Status:** PARTIALLY DONE (verified 2026-11-23 on `40b671bb`)

Verified on current main:
- `maomao-media-store/audio` keeps `excludeFields: ['blob']`, and the omission is explicit rather than silent: `__backup.warnings.audioMetadataOnly` is set, `complete` becomes false when audio metadata is present, and the export message appends "（本地音频元数据已包含，音频文件本身未打包）".
- Records skipped for size or read failure are collected in `allSkipped`, written into the manifest (`recordsSkipped` plus per-record db/store/id/reason/bytes) and listed in the export message with a total count.

Still open — do not mark this task FIXED:
- The audio notice carries no file count and no total size, so "export UI lists skipped audio files and size" is not met.
- No written decision between "include music in full backups" and "offer a separate large-media export"; `docs/engineering/STORAGE_AND_MIGRATION.md` still phrases it as an open question.
- Restore reporting covers font presets and skipped records only; there is no audio-specific statement of what was restored.

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
**Priority:** P0 · **Status:** FIXED (static source inventory completed 2026-11-11)

Evidence: `docs/chat-history-callers.md` records the main-branch readers, writers, deletions, role/group/date-mode scopes, legacy fallbacks, test-only callers, and known persistence-result handling gaps.

Completed:
- Identified production call sites across chat detail/list/search/settings, chat extras, date/journey, calls, notifier, wallet, forum, couple, role matching, memory, library, image generation, PhoneStorage, ConversationRepository, and backup/restore.
- Recorded the current localStorage-backed `chat_history_<id>` behavior, PhoneStorage compatibility rules, shared online/date history, and distinct role/group ID domains.
- Assigned a safe migration order and called out write paths that ignore save failures or bypass PhoneStorage.

Acceptance:
- [x] Call-site matrix identifies file, operation, role/group ID, legacy fallback, and whether write is direct or through PhoneStorage.
- [x] Every caller assigned a migration step.
- [x] Cross-role/group isolation and date-mode shared history rules are recorded.
- [x] This was a read-only inventory; no storage backend was switched.

Remaining implementation is tracked by DATA-006/007/008 and QA-002. DATA-005 being fixed does not mean those runtime defects are fixed.

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
**Priority:** P2 · **Status:** IN PROGRESS (PR #255, 2026-11-11)

Scope: migrate direct localStorage readers/writers page-by-page to approved PhoneStorage/repository APIs after storage contracts are stable.

Progress in PR #255:
- Added verified history writes and explicit failure handling for offline/date chat, travel-journey stage messages, group-call result cards, forum post sharing, couple-space invitations, wallet shop/takeout/family-card notices, and shake-match contact initialization.
- Added behavior tests for write refusal, readback mismatch, quota errors, role isolation, and retry/deduplication.
- No history key or message schema was renamed; no history was truncated or migrated.
- A failed purchase/order is not inferred from a failed chat notice: transaction state and message-notice state remain separate.

Remaining:
- Finish the legacy read/write audit against DATA-005 and migrate search/settings and any remaining direct writers after the parallel multi-bubble branch is reconciled.
- Audit remaining read-only legacy fallbacks in memory/context/library paths.
- Confirm backup/export behavior before changing the storage backend (DATA-001/002/006/007).
- Run the complete local/CI regression suite and validate on a real phone/PWA.

Acceptance:
- Each migration is limited to one domain or feature.
- No hidden change to key names or role scoping.
- Failures propagate and are tested.
- Direct access remains only where documented as an intentional compatibility boundary.
- DATA-008 remains OPEN until the remaining callers are migrated and the full regression/device acceptance is complete.

### DATA-009 — Decide cloud sync, if ever required
**Priority:** P3 · **Status:** DEFERRED

Current state: static Worker deployment only; no D1/R2/auth/sync configured.

Acceptance before implementation:
- User explicitly chooses whether cloud sync is wanted.
- Define accounts, encryption, privacy, conflict resolution, quotas, billing, retention, export/delete, and offline behavior.
- Compare browser-local IndexedDB-first versus server-sync architecture.
- No infrastructure added before decision.

## Feature implementation

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

### ROLE-MIND-001 — Complete role-scoped heart history and persona-aligned generation
**Priority:** P1 · **Status:** IN PROGRESS

Scope:
- Extract heart marker parsing, prompt rules, and history persistence into a shared chat policy.
- Store bounded heart history by conversation ID and actual speaker ID; group members must never share a history bucket.
- Read legacy direct-chat `latest_heart_<roleId>` values without deleting them. Do not attribute the old shared group key to any member.
- Commit heart history only after the visible AI reply has been successfully persisted; verify storage readback and surface failures.
- Clicking a group member's avatar reads only that member's history. Legacy group messages without a member ID may resolve by a unique member name only.
- Keep heart optional and consistent with the already-loaded persona, worldbook, memory, and relationship context.

Acceptance:
- Unit tests cover parsing, direct legacy compatibility, group isolation, bounded history, corrupt data, storage failure, and prompt constraints.
- Chat detail keeps the existing message schema and role/group IDs; no history or user data is deleted.
- PWA cache is advanced and the new policy is pre-cached.
- Node contract tests and Vite build pass. Browser/real-device behavior is reported separately and is not inferred from static tests.

Out of scope for this task: changing emotion scoring, proactive-contact scheduling, group governance permissions, or chat message schemas.

### ROLE-BEHAVIOR-001 — Unify the per-turn role behavior context
**Priority:** P1 · **Status:** PLANNED · **Depends on:** ROLE-MIND-001

Current source already contains voice-habit profiling, short-term emotion continuity, recent self-authored life-note extraction, autonomy prompting, and proactive-contact policy. These are separate capabilities, not a reason to create a second parallel personality engine.

Scope:
- Reuse `ChatPresencePolicy` and compose one bounded per-turn behavior context for the active role/speaker.
- Preserve role and group-speaker isolation; narration/offline modes keep their existing exclusions.
- Keep persona, worldbook, relationship protocol, and confirmed memory as higher-priority sources.
- Avoid forced message quotas, repeated questions, fabricated activities, permanent emotional labels, or additional model/API calls.
- Keep aggregate voice-profile semantics; do not store raw chat samples.

Acceptance:
- Tests cover direct/group speaker selection, voice-profile cache invalidation, emotion cue expiry, life-note recency, narration exclusions, and prompt ordering.
- Existing prompt source order, model request count, and message schema remain compatible.
- Node chat contract, Vite build, and browser viewport checks pass.

### ROLE-ACTION-001 — Unify role action parsing and execution
**Priority:** P1 · **Status:** PLANNED · **Depends on:** ROLE-BEHAVIOR-001

Current action markers and side effects are distributed through the large chat-detail controller. Group relationship, group interaction, and group management markers use different handlers and state paths.

Scope:
- Inventory every existing action marker before changing behavior; preserve current marker compatibility.
- Separate narrative/action description from state-changing operations.
- Add one dispatcher/registry with explicit actor, target, permission, feature-switch, and current-state validation.
- Execute state changes only after the visible reply has persisted; enforce idempotency, readback verification, and rollback.
- Reuse existing group permission and relationship policies; do not create a second authorization system.
- A model-generated marker is never an authorization credential by itself.

Acceptance:
- Tests cover unauthorized actors, stale or ambiguous targets, duplicate markers, regeneration, failed reply persistence, failed action persistence, rollback, and successful state readback.
- No state-changing action occurs from an uncommitted/failed reply.
- Existing group, wallet, call, poll, chain, and media marker behavior remains compatible.

### ROLE-LIFE-001 — Complete role life-event continuity
**Priority:** P2 · **Status:** PLANNED · **Depends on:** ROLE-BEHAVIOR-001

Scope:
- Reconcile existing life-line, life-event, footprint, and recent-note sources instead of creating duplicate storage.
- Model event lifecycle explicitly: planned, active, completed, cancelled, or rescheduled.
- Keep event ownership role-scoped and group-member-scoped where applicable.
- Never present a plan as completed or revive a cancelled/expired event without new evidence.

Acceptance:
- Tests cover state transitions, expiry, duplicate events, role isolation, group isolation, and cross-page read consistency.
- No new database or destructive migration without a separately approved migration plan.

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
**Priority:** P1 · **Status:** IN PROGRESS (chat-history cases added in PR #255)

Progress:
- Added behavior tests for chat history save rejection, readback mismatch, localStorage quota failure, role isolation, date-mode rollback, journey retry/deduplication, call/forum/wallet notices, and shake-match initialization.
- The tests are wired into the existing `npm run test:chat:isolation` script.

Remaining:
- Add IndexedDB unavailable/blocked/quota tests when the DATA-001 registry and DATA-006 storage implementation are ready.
- Run the suite locally and obtain actionable CI output; current Actions runs returned failed conclusions without job steps or logs.
- Verify refresh/reopen and storage behavior on desktop and real mobile browsers.

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

## Phase 6 — iOS application packaging (deferred)

### IOS-001 — Add an iOS app build and IPA distribution path
**Priority:** P2 · **Status:** DEFERRED (owner decision: do this in a later phase; not part of current work)

Goal: after the existing MAOMAO experience is stable, provide an iPhone-installable iOS app build while continuing to support the current web/PWA version.

Scope when activated:
- Reassess the current Vite/PWA architecture and evaluate a thin iOS shell such as Capacitor before choosing an implementation.
- Reuse the existing app code, APIs, and cloud/data contracts wherever practical; do not rewrite MAOMAO as a separate native app without a demonstrated need.
- Preserve the web/PWA deployment and Android path. iOS work must not silently replace or disrupt either.
- Audit iOS-specific behavior rather than assuming browser features transfer unchanged: sign-in/session persistence, local data and uploaded media persistence, camera/photo library and file handling, keyboard/viewport behavior, safe-area insets, sharing, background behavior, and push notifications.
- Document Apple signing and distribution requirements for development-device testing, ad hoc distribution/TestFlight, and any future App Store release. A generated IPA is not automatically installable by every iPhone.
- Keep signing credentials and certificates out of the repository and CI logs; document the secure owner-controlled signing process.

Start condition:
- Do not start implementation during the current stabilization/backlog cleanup phase.
- Activate only after the owner explicitly schedules the task and the core mobile experience, authentication, chat, and data persistence have been stabilized.
- Before implementation, inspect the then-current main branch and existing Android/PWA configuration; avoid creating duplicate wrappers or parallel app projects.

Acceptance:
- Existing web/PWA remains functional and independently deployable.
- A signed iOS test build or TestFlight distribution path is documented and verifiably usable on a real iPhone.
- Real-device tests cover sign-in, chat send/receive, refresh/reopen persistence, image/file handling, keyboard and safe-area layout, and any claimed background/push behavior.
- Unsupported or platform-limited capabilities are listed honestly; static build success alone is not treated as device verification.
- No production deployment, Android release, or existing user data is changed without separate approval.

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


Only after these reports are reviewed should implementation tasks be assigned.


### CHAT-UI-001 — Light default chat list and detail
**Priority:** P0 · **Status:** IN PROGRESS (owner-approved visual change, 2026-11-12)

Scope: remove the decorative bezel from the two chat surfaces; implement a white, compact default layout based on the owner's HTML reference; preserve all existing chat operations and selected themes. See `CHAT-UI-001.md` for exact changes, validation and rollback.

Acceptance: 375–430px and desktop visual verification, multiline/keyboard/quote clearance, existing message and feature actions, saved beauty and background isolation, full build and relevant regression checks. No production completion claim before browser and device checks.
