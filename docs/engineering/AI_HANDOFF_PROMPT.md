# MAOMAO AI Collaboration Handoff

Use this document when inviting another AI agent to inspect or repair the project.

## Context prompt (copy all of this section)

You are helping maintain MAOMAO (“小手机”), a mature AI-character phone simulator in Bella0960/MAOMAO.

Before proposing or editing code, read:
- AGENTS.md
- docs/engineering/README.md
- docs/engineering/PROJECT_ARCHITECTURE.md
- docs/engineering/STORAGE_AND_MIGRATION.md
- docs/engineering/DEVELOPMENT_GOVERNANCE.md
- docs/engineering/REMEDIATION_BACKLOG.md
- docs/chat-architecture-contract.md and docs/chat-regression-baseline.md for chat tasks
- docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md for UI tasks

Project constraints:
- Native HTML/CSS/JS multi-page app with Vite. Do not rewrite it as React/Vue/SPA.
- Preserve existing features, routes, role IDs, group IDs, message fields, themes, and user data.
- Do not delete or cap old chat messages to “solve storage.”
- Large media belongs in IndexedDB/Blob storage, but the migration is not complete and backup coverage must be fixed first.
- Existing PhoneStorage, PhoneAPI, PhoneStream, PhoneContext, repository classes, and MediaRepository should be extended/reused where suitable rather than replaced.
- Cloudflare currently deploys static website assets; no user-data cloud backend or account sync is configured.
- Website is the active delivery method. APK build is manual only and should remain that way.
- Respect the black/white/gray editorial design constitution. Avoid generic oversized card layouts, unnecessary text, gradients, or colors that conflict with explicit user requirements.

Do not treat historical audits as current truth. Re-check every finding in main before changing it. Where the code and docs conflict, report the conflict first and cite the exact file/path and current behavior.

Work only within the owner's assigned task scope. A direct request to fix/finish/complete authorizes implementation on a dedicated branch; do not default to read-only or stop after each small subtask to ask for “continue”. Use read-only mode only when explicitly requested. Decompose the work, implement, test, repair failures, update docs/engineering/EXECUTION_LOG.md, and continue through all independent in-scope subtasks. Do not modify main directly. Do not merge, deploy, update APKs, configure secrets, or perform irreversible user-data operations without explicit owner approval. Never edit the same files as another agent at the same time. If blocked, record the exact blocker and continue independent work.

Every proposal or patch must include:
1. Task ID and problem statement.
2. Verified current behavior and evidence (file paths/functions).
3. Exact files to change.
4. Minimal solution and non-goals.
5. Data compatibility/migration plan if applicable.
6. Tests and real-device/manual checks.
7. Rollback plan.
8. Risks and NOT VERIFIED items.

Do not claim deployment, CI, or tests passed unless you inspected the exact run for the relevant commit.

## Continuous execution contract

One owner request is one work package, not one isolated patch. The agent must:
1. Read the current task checkpoint and relevant source-of-truth docs.
2. Decompose the request into ordered subtasks with acceptance criteria.
3. Implement on a dedicated branch by default, preserving the exact scope and existing data.
4. Run relevant tests/build checks, repair failures, and repeat until pass or a concrete external blocker.
5. Continue with the next independent task without asking the owner to prompt “continue”.
6. Update `docs/engineering/EXECUTION_LOG.md` after meaningful milestones and before ending a session.

Pause only for an unresolved product choice, missing requirement, credential/secret, destructive action, data migration requiring approval, or explicit release boundary. Keep `main`, production deployment, APK release, secrets, and irreversible user data protected until explicitly approved. Work does not continue in the background after the active chat/session ends; use the checkpoint for a clean next-session handoff.

## Task assignment template

Task ID:
Owner/agent:
Mode: READ-ONLY AUDIT / PROPOSAL ONLY / IMPLEMENT ON BRANCH
Exact scope:
Files allowed to edit:
Files forbidden to edit:
Dependencies:
Expected output:
Acceptance criteria:
Tests required:
Do not touch:
- main branch directly
- unrelated UI or app features
- storage keys/schema without an approved migration
- private user data or API credentials

## Recommended starter tasks

### Agent A — App and route inventory
Task: GOV-002
Mode: READ-ONLY AUDIT
Deliver: map 88 HTML pages into production apps, maintenance pages, previews, and docs; map launcher links, query params, page navigation, and cross-app calls. Do not edit files.

### Agent B — Storage/database registry
Task: DATA-001
Mode: READ-ONLY AUDIT
Deliver: every localStorage key family and every IndexedDB database/store, owner module, version, blob fields, backup status, migration status, and quota/error handling. Explicitly verify maomao-assets backup omission and audio Blob exclusion. Do not migrate data.

### Agent C — Chat-history call-site inventory
Task: DATA-005
Mode: READ-ONLY AUDIT
Deliver: all readers/writers of chat_history_<id>, role/group isolation, date-mode interactions, wallet/forum/call/notification integrations, direct localStorage vs PhoneStorage usage, and tests needed. Do not edit chat files.

### Agent D — CI and release workflow audit
Task: CI-002 and CI-003
Mode: READ-ONLY AUDIT / PROPOSAL ONLY
Deliver: workflow trigger matrix, permissions, artifact/cache producers, redundant runs, package release workflow risk, and a minimal patch proposal. Do not publish packages or re-enable APK build.

### Agent E — Static asset audit
Task: PERF-001
Mode: READ-ONLY AUDIT
Deliver: largest assets, dimensions, formats, references, duplicate/near-duplicate candidates, suggested size targets, and visual QA plan. Do not replace, delete, or recompress images.

## Integration rule

Multiple agents may inspect in parallel, but code changes require explicit file ownership and one integrator. Merge only after independent review, relevant tests, and data-safety verification.
