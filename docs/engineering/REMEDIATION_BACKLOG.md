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
**Priority:** P1 · **Status:** IN PROGRESS (first cost-control pass prepared on branch; CI execution still NOT VERIFIED while Actions quota is exhausted)

Completed in the current branch:
- Removed the broad `tests/**` trigger from the chat regression workflow and listed only the test files it actually runs.
- Moved the chat-call contract command into the existing chat regression job and removed the standalone duplicate workflow.
- Changed automated regression checks to PRs targeting `main` plus manual dispatch; removed duplicate post-merge `push` test runs.
- Added per-PR concurrency cancellation so newer commits replace stale pending/running test attempts.
- Narrowed the performance gate from all `chat/**` files to the chat app subtree, shared phone modules and its performance inputs.
- Enabled npm dependency caching and skipped optional npm audit/fund network calls during CI installs.
- Excluded test, documentation, performance and Android-only changes from production/legacy preview deployment path filters; kept production deployment on main pushes.
- Added production deployment concurrency that never cancels an in-progress production deploy.

Still NOT VERIFIED:
- These workflow changes have not been executed because Actions usage quota is exhausted.
- After quota recovery, validate a main-targeted source PR, a docs-only PR, a test-file-only PR, a stacked PR targeting a task branch, rapid consecutive PR updates, and a main merge/deploy.
- Confirm path filter behavior and production deploy exclusions in actual Actions runs.

Acceptance:
- App-relevant PRs to main run the relevant tests.
- Unrelated test files, docs and perf-only maintenance do not trigger the chat browser suite or production deploy.
- Chat-call tests run once in the grouped chat regression job.
- New PR commits cancel superseded test runs.
- Merging a tested PR does not rerun the same PR test suite on main push.
- Production deploy is never cancelled after it starts.

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
