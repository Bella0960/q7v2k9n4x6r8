# MAOMAO Development Governance and Multi-AI Workflow

## 1. GitHub repository model

Keep Bella0960/MAOMAO as the canonical monorepo and main as the stable integration branch.

Do not split chat/forum/diary/cafe/wallet into separate repositories: they share role IDs, chat data, AI context, theme systems, navigation, and the storage layer.

Recommended branches:
- main: deployable stable version; protected by review/checks where GitHub settings allow.
- task branches: one scoped fix or refactor, e.g. storage-registry/db-backup-audit or chat/media-indexeddb-phase1.
- integration branch only when multiple independent task branches must be tested together.

Use pull requests for meaningful architecture, storage, or cross-page changes. Small documentation-only changes may be committed directly only when there is no conflict and the owner agrees; code changes should be reviewable.

Do not force-push main. Never overwrite a newer main commit. Rebase/merge against current main and resolve conflicts explicitly.

## 2. Current automation inventory

> 当前发布流程以 [2026-11-24 发布规范](RELEASE_POLICY.md) 为准；旧日期的版本、部署方式和测试范围不得当成现行指令。

The existing production deployment is manual-only; QA uses the reusable request path. Old per-version workflows and npm publishing are not routine release paths. Existing test implementations remain available until their replacement coverage has been verified. APK and APK cleanup remain manual-only.

## 3. Current quality commands and limitations

package.json currently exposes:
- npm run build — Vite production build.
- npm run test:chat:contract — Node built-in test runner for chat contracts.
- npm run test:detective:unlock — Node test runner for detective unlock behavior.
- npm run perf:gate and other perf scripts — Playwright/performance scripts.
- npm run lint — currently prints a fixed “Lint passed” message; this is not a real linter.
- No generic npm test script exists at this baseline.

tests/ contains two primary test entry scripts plus additional manual/reproduction scripts and fixtures. A green contract test does not mean every page or user journey was exercised.

Required checks are risk-scoped according to RELEASE_POLICY.md. Preserve full safety gates for high-risk changes and actual affected-device verification; do not repeat identical build/test work.

Do not cite npm run lint as evidence until a real linter is configured.

## 4. Branch/PR protocol

Before coding:
- Record task ID, exact expected behavior, files likely affected, current owner, dependencies, and non-goals.
- Fetch latest main and inspect current code; do not rely only on an old task description.
- Search all callers of modified functions, storage keys, routes, CSS selectors, and global symbols.
- Create a branch for the task. Do not allow concurrent agents to edit the same file set.

In the PR:
- Keep one concern per PR.
- Include summary, reason, exact files, tests and results, manual checks, storage impact, compatibility handling, rollback, and known gaps.
- Include before/after screenshots only for UI changes; do not include real personal data/API keys.
- Use a small, reviewable diff. Avoid unrelated formatting or file movement.
- Do not merge if required checks are red or unverified.

After merge:
- Verify deployment workflow separately from tests.
- Check the actual deployed website path and cache behavior.
- Do not claim success just because a commit was created.
- Record a short implementation note in docs/engineering or the task log.

## 5. Multi-AI collaboration model

Parallel work is useful when tasks have clear file ownership and no shared schema changes.

Recommended lanes:
- A. Repository/docs/CI governance: AGENTS.md, docs/engineering, .github/workflows, package scripts.
- B. Storage/backup audit: storage registry, backup.js, MediaRepository and database tests. Must not start chat cutover until backup gaps are closed.
- C. Chat callers and compatibility inventory: read-only at first; produce a call-site matrix. Do not edit conversation storage until Lane B and the user approve migration design.
- D. Asset optimization: assets/games/assets/music only, with before/after image QA and original preservation.
- E. Feature fixes: different Apps or disjoint file sets may run in parallel under separate Task IDs/branches/PRs. Overlapping files and shared contracts remain single-owner; storage architecture changes require explicit coordination.

File ownership:
- Each agent claims exact paths before modifying.
- Two agents must not edit the same HTML or shared module concurrently.
- A shared contract/schema/API change has one owner; other agents may review or prepare tests but must not independently implement a competing version.
- Each agent commits to its own branch and supplies a PR/patch. The integrator reviews and merges.

Agent delivery report must include:
1. Task ID and branch/commit/PR.
2. Files changed.
3. Observed current behavior versus intended behavior.
4. Tests run with exact output/status.
5. User data migration or storage impact.
6. Backward compatibility and rollback.
7. Manual test steps not completed.
8. Remaining risks.

## 6. Security and privacy rules

- Never commit .env files, API keys, provider tokens, credentials, private chat exports, or personal images.
- Keep .gitignore secret patterns; verify they work and do not over-ignore legitimate assets.
- Backups must exclude secrets by default and clearly identify optional secret-bearing exports.
- Never include real chat messages in test fixtures, issue comments, PR screenshots, or AI handoff documents.
- Escape user/AI-generated HTML, validate URL schemes and CSS URLs, and avoid unsafe innerHTML with untrusted content.
- Do not write full prompts, secret headers, or personal content to API logs.
- Treat third-party AI-generated patches as untrusted until reviewed and tested.

## 7. Asset governance

Current largest repository areas:
- assets/ approximately 39.18 MiB.
- games/ approximately 39.44 MiB; games/assets alone approximately 38.88 MiB.
- music/ approximately 4.51 MiB.

Rules:
- Do not delete source art to meet an arbitrary size target.
- Record file dimensions, format, color mode/alpha, references, and byte size before optimization.
- Convert or recompress one representative sample first; visually compare on target phone dimensions.
- Preserve transparency, crisp line art, faces, text, and gradients where relevant.
- Keep originals or a reproducible source copy until user approves replacement.
- Update the asset manifest or references, build, open affected pages, and compare visual quality before merging.
- Do not commit generated dist/node_modules/APK files into the main source tree.

## 8. Documentation governance

- Update docs when code architecture, storage schema, DB stores, workflows, routes, message fields, or migration states change.
- Mark each finding VERIFIED, FIXED, OPEN, DEFERRED, or NOT VERIFIED.
- Historical reports must retain their date and not be rewritten to pretend old observations were current.
- Keep the canonical architecture and storage inventory current.
- Remove duplicate/contradictory rules only after moving useful information into the authoritative docs.
- Do not label a plan as implemented.

## 9. Release policy

Website deploy is the normal release channel.
APK build is manual and exceptional.
Do not publish npm packages. Follow RELEASE_POLICY.md for QA and production releases.
Before a significant migration release: full backup test, migration canary, regression checks, production deploy check, and rollback instructions.


## 10. Fast delivery, multi-window coordination and batched QA (GOV-006)

**Owner requirement (2026-11-26):** Optimize elapsed delivery time without weakening correctness, data safety, or the current `RELEASE_POLICY.md`. This section adds execution discipline; it does not replace release authorization or QA safety gates.

### 10.1 One defect, one work package

- A small bug is one bounded Task ID, one dedicated task branch, and one reviewable PR. Fix the root cause; do not add unrelated redesign, cleanup, architecture work, or extra features.
- Before editing, record the task ID, exact expected behavior, base SHA, risk lane, owned paths, non-goals, and targeted checks in the PR description or task handoff.
- Keep each task branch based on the current approved baseline. Never use a stale candidate as a new task's base merely because it is convenient.
- A task is not complete because code was committed. It must have the required focused checks and an explicit state: READY FOR INTEGRATION, BLOCKED, or NOT VERIFIED.

### 10.2 Multiple windows: parallel work with exclusive file ownership

- Independent modules or disjoint file sets may be developed and tested in parallel. Each window owns its Task ID, branch, and declared paths.
- Two windows must never edit the same HTML, JS, CSS, test, shared module, or configuration file concurrently. If a task touches a shared API, storage contract, route registry, Worker, Service Worker, package/build config, workflow, or account boundary, appoint one implementation owner and let other windows review or prepare isolated tests.
- Treat `AGENTS.md`, `RELEASE_POLICY.md`, `DEVELOPMENT_GOVERNANCE.md`, `REMEDIATION_BACKLOG.md`, `EXECUTION_LOG.md`, package manifests, global test runners, and QA workflows as single-owner files. The integration coordinator alone updates the shared execution log; individual windows keep their task evidence in their own PRs.
- Do not wait idly for an unrelated QA run. Continue independent implementation, focused tests, code review, and defect diagnosis while the release queue is occupied.
- Individual windows do not independently request QA deployments. They deliver a reviewed task branch/PR and its exact evidence to the integration coordinator.

### 10.3 Risk lanes determine the minimum sufficient checks

Choose by actual behavior and affected consumers, not by file extension alone.

| Lane | Change type | Required local checks |
|---|---|---|
| D0 | Documentation-only; no runtime, workflow, or release behavior | Link/format and changed-document consistency checks. No product QA deployment. |
| F1 | Pure visible copy, local spacing, typography, color, or presentation-only CSS | Diff proves no script, event handler, attribute, DOM structure, route, storage, resource URL, or shared behavior change; run the affected module contract and browser viewports (375/390/430px plus desktop shell). Build only when the changed path affects build output or the release gate requires it. |
| F2 | Isolated functional bug in one module | New regression test plus affected existing contract tests and the module's relevant browser flow; run a build when runtime/build output changes. |
| F3 | New feature, cross-module behavior, shared UI/API, or multiple dependent modules | Standard regression selection, integration checks, relevant browser flows, and build. |
| F4 | Identity, account/session, permissions, chat/storage schemas, backup/restore, payment, cloud data, Worker/Cron/push, shared core, security, or release infrastructure | Full relevant safety, compatibility, backup/restore, integration, and release-infrastructure gates. No fast-lane downgrade. |

- F1 is deliberately narrow. A structural HTML change, changed event/attribute, selector that changes behavior, new resource, shared stylesheet, or ambiguous diff is not F1.
- The adaptive selector is not a universal project-wide fast lane. Its currently verified module/diff coverage must be checked in the current `RELEASE_POLICY.md` and QA candidate code. Unsupported modules or ambiguous diffs use the standard test plan. GOV-006 task batching does not itself expand adaptive coverage or bypass release gates.
- QA infrastructure migration (including PR #507) is a separate workstream. Do not treat GOV-006 delivery as approval to lower or bypass the adaptive selector's fallback or security gates.

### 10.4 PR-backed task registry and immutable candidate handoff (GOV-006)

GitHub open PRs are the shared task registry across development windows. The registry is the machine-readable `MAOMAO_TASK_V1` block in each task PR; there is no separate task database and no coordinator-local JSON directory.

**Task registration**

- Each implementation task has one Task ID, one dedicated branch, one PR, an explicit risk lane (`F1`–`F4`), exact owned paths, non-goals, named required checks, and optional Task ID dependencies.
- Read the latest successful QA-only release receipt at `preview.mao520.com/qa-build-receipt.json` and use its exact 40-character source SHA as the task baseline. Never assume `main` is the deployed QA baseline; the two histories may diverge.
- The task PR base must be `main`, `integration/*`, or `qa/*`. For QA-based work, use an approved `integration/` or `qa/` branch that points to the same deployed QA baseline recorded in the manifest. The PR's changed-file list must match the manifest-baseline-to-head Git diff; a stale or mismatched base is blocked.
- After opening the PR, register it with:

```sh
npm run eng:register -- <PR-number> <TASK-ID> <QA-baseline-SHA> <F1|F2|F3|F4> "<exact GitHub check name>" ["<another exact check name>"] [--depends-on=TASK-ID,TASK-ID]
```

- Registration adds exactly one `MAOMAO_TASK_V1` block to the PR description and records the exact PR head SHA, QA baseline, risk, named checks, and dependencies. It does not approve, merge, or deploy the PR.
- Re-run `eng:register` after every new commit. The registered head SHA is immutable evidence; an older manifest must never be treated as current.
- Registration starts with `status: "submitted"`. The coordinator computes readiness from the live evidence; do not mark a task ready manually to bypass review or checks.
- A PR is eligible only when it is open, non-draft, in this repository, based on an allowed branch, approved on its exact current head by a reviewer other than its author, has every named required check successful, has no other failing/pending check or status, has complete file pagination, and its changed-file list exactly matches the pinned Git diff. Duplicate Task IDs, missing dependencies, dependency cycles, stale heads, and incomplete scans fail closed.
- Documentation-only `D0` changes do not enter the QA release batch and do not use the `F1`–`F4` manifest. They still require a narrow PR, ownership review, and documentation checks.

**Conflict scan**

- After a task has changes and before opening/updating its PR or assembling a batch, run `npm run eng:conflicts` from a complete source checkout with `origin/main` available. Run it again before candidate assembly when the working tree or PR set has changed.
- The scanner compares committed, staged, unstaged, and untracked paths against all paginated open PRs using their pinned base/head commits. An exact file overlap is **BLOCK**; a shared runtime/Worker/workflow/build/release/governance hotspot is **SHARED** and needs one named owner; same-module overlap is **REVIEW**.
- A zero-change checkout makes no ownership conclusion. An incomplete API/Git scan exits non-zero and must never be treated as conflict-free. `GH_TOKEN` or `GITHUB_TOKEN` may be supplied for a reliable authenticated scan; never put credentials in files or logs.
- The scanner is read-only. It does not edit branches, rebase, merge, close PRs, or dispatch QA.

**One immutable candidate**

- Only the integration coordinator runs the owner-only workflow `.github/workflows/engineering-ready-batch.yml` via `workflow_dispatch`. Supply `qa_baseline_sha` from the latest successful QA-only release receipt. Supply `resume_run_id` only to restore the exact saved candidate artifact from a previous failed batch run.
- The workflow scans all open PRs, collects only evidence-complete registered tasks, verifies exact head/review/check/path/dependency evidence, orders dependencies, performs a second ownership scan, and assembles one candidate from the exact deployed QA baseline plus only ready tasks.
- One baseline maps to one create-only branch: `integration/qa-batch-<first-12-baseline-sha>`. The candidate ref cannot overwrite an existing different SHA. The workflow archives the exact Git bundle and receipt for 90 days before pushing; a failed runner can resume the same candidate using its saved artifact.
- The local equivalent is `npm run eng:batch:auto -- <current-deployed-QA-source-SHA> [--push]`. It requires a complete checkout, the correct source `origin`, and GitHub API access. Prefer the owner-only workflow for the shared coordinator run.
- The old public `npm run eng:batch -- <task-directory> ...` entry point is retired. `scripts/engineering-qa-batch.mjs` remains an internal assembly helper called by the PR-backed queue; do not invoke it as a separate manual task-directory workflow.
- Candidate assembly/push is **not** a QA deployment. The batch workflow does not release, merge task PRs, deploy production, or update APKs.

**Single QA release coordinator**

- After the exact candidate is pushed, only the coordinator uses the fixed QA request path in `Bella0960/web-runtime-lab` and the current `RELEASE_POLICY.md`. A release request must name the exact candidate SHA and confirm `qa-only`.
- Do not run `verify` and then `release` on the same unchanged candidate when QA publication is already authorized: the release runner executes the candidate gates itself. Use `verify` for a genuine no-deploy check or diagnosis.
- The release queue remains serialized and non-cancelling. No individual development window may dispatch its own QA release. A P0 issue may be batched alone by the coordinator when waiting would materially harm the user.
- After release, separately verify the successful fixed-workflow run, deployed QA Worker version, and live source receipt. A candidate push, green unit tests, or request-file commit is not a deployment receipt.

**Existing work migration**

- Existing open PRs, branches, code, and historical logs are not automatically deleted or included. Do not force-push, mass-close, or rebase old work blindly.
- A legacy PR becomes batch-eligible only after its owner safely aligns it with the current deployed QA baseline, declares exact paths, registers the current head, and obtains the required current-head review/check evidence. Stale version labels or old QA SHAs are not current release authority.

### 10.5 Failure handling: diagnose once, repair the cause

- Read the actual failed job and sanitized stage summary before retrying. Identify whether the failure is candidate/baseline preflight, a specific Node test, browser test, build, post-test safety guard, upload, or post-deployment readiness.
- A product regression requires a narrow code/test repair, a new candidate SHA, and the affected local checks. Do not rerun unrelated local suites just to reproduce it.
- An environment or transient failure must be distinguished from a product failure. Before retrying any release, verify whether deployment already occurred by checking the Worker version and exact QA source receipt. Never blindly repeat a job that may have uploaded.
- The current reusable workflow runs the candidate gates inside one request job; rerunning that failed job can repeat the candidate suite. Do not describe a whole-job rerun as a single-test retry. Use bounded read-only retries only where the runner already permits them; never retry deployment mutations blindly.
- Never delete tests, weaken assertions, skip a required gate, fabricate a pass, or label an unobserved browser/device check as verified.

### 10.7 Read-only file-ownership conflict scan

- After a task branch has changes and before opening/updating its PR or assembling an integration candidate, run `npm run eng:conflicts` from the source checkout. It compares committed, staged, unstaged, and untracked paths with all open PRs in the public source repository. Use a checkout with complete Git history and an up-to-date `origin/main`. GitHub supplies the paginated open-PR list, and the command computes each PR’s paths from its pinned base and head commits. Missing commits are fetched in one Git operation without moving branch refs. A zero-change checkout makes no ownership conclusion.
- An exact path overlap is a **BLOCK** until owners coordinate. Changes in the same shared runtime, Worker, workflow, build-config, release-core, or engineering-governance hotspot are **SHARED** warnings requiring one named owner. Different files in the same feature submodule are **REVIEW** warnings, not automatic blockers.
- The scanner reads PR metadata and filenames only. It does not read PR bodies/source contents, write GitHub state, rebase, merge, close PRs, or dispatch QA.
- An incomplete API scan exits non-zero and must never be interpreted as “no conflicts”. A zero-change branch reports that no ownership conclusion was made.
- The report is advisory, not a guarantee against semantic conflicts. Task owners still declare exact paths and the integration coordinator resolves ownership before merging.

### 10.6 Owner-facing delivery

- Do not ask the owner to repeat "continue" for work already authorized. Complete the bounded work package and keep independent work moving.
- Progress messages are reserved for durable milestones or real blockers. The final report is concise: Task ID, root cause, files changed, focused checks and exact results, branch/PR, exact candidate SHA, and the actual QA receipt/version/link if deployed.
- If QA is queued or blocked, state the exact queue/blocker and continue other independent tasks. Never present a historical QA version as the result of the current change.
