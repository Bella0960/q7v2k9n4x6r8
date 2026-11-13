# MAOMAO Agent Rules

This file is the repository-wide entry point for every AI coding agent and human contributor.

## Read before changing code

Read these files first:

1. docs/engineering/README.md — authoritative project baseline and document map.
2. docs/engineering/PROJECT_ARCHITECTURE.md — current architecture and app inventory.
3. docs/engineering/STORAGE_AND_MIGRATION.md — storage facts, target design, and migration safety rules.
4. docs/engineering/DEVELOPMENT_GOVERNANCE.md — branches, workflows, testing, security, and collaboration rules.
5. docs/engineering/REMEDIATION_BACKLOG.md — approved task IDs and acceptance criteria.
6. docs/chat-architecture-contract.md and docs/chat-regression-baseline.md before touching chat.
7. docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md before touching UI or visual design.
8. CLAUDE.md for additional repository-specific context. If it conflicts with the engineering documents, report the conflict and follow the newer, explicitly verified engineering baseline.

## Non-negotiable project constraints

- Preserve the existing native HTML/CSS/JavaScript multi-page architecture. Do not migrate the project to React, Vue, a SPA router, TypeScript, or another framework without explicit approval.
- Preserve existing app functions, routes, local data formats, character IDs, group IDs, message fields, theme selections, and user settings.
- Do not perform a full rewrite to solve a local problem.
- **Extensibility contract (owner requirement, 2026-11-13):** Every new module or feature must preserve documented, stable extension points (module registry, event hooks, public API contracts, and/or configuration-driven adapters as appropriate for the existing architecture). New functions must be additive and loosely coupled, with explicit versioned data migration/backward compatibility, no destructive schema replacements and automated contract tests. Plan future plug-in points before implementation; do not force a rewrite to extend an existing feature. Keep stable access and isolated account/role boundaries.
- Do not delete, truncate, summarize destructively, or silently overwrite user data.
- Do not change storage keys or message schemas without a migration plan, verified backup, compatibility layer, tests, and rollback path.
- Do not store large binary assets or Base64 images in localStorage in new code. Use the approved media repository/IndexedDB path after verifying its backup coverage.
- Never report a write as successful when persistence failed. Propagate and display storage errors.
- Never log API keys, secrets, or real private conversations.
- Keep the user's visual system: neutral black/white/gray, editorial spacing and typography, restrained lines and compact cards. Do not impose generic card grids, gradients, saturated blue/purple/pink, decorative emoji, or unnecessary labels. Chat screens retain their chat-native interaction style.
- The website is the current delivery channel. APK building is manual only. Do not restore automatic APK builds.
- Do not add cloud database/sync infrastructure (D1, R2, account sync, authentication) without a separate decision and explicit approval.

## Task execution protocol

- Claim one or more explicit Task IDs from docs/engineering/REMEDIATION_BACKLOG.md.
- Before editing, inspect current main and the exact callers/consumers of every touched API, storage key, CSS selector, and route.
- Use a dedicated branch named task-ID/short-description. Do not push unreviewed changes directly to main.
- Do not let two agents edit the same files concurrently. Agree on file ownership first.
- Keep the patch narrow. Avoid formatting unrelated files or adding dependencies without approval.
- Add/update tests for the behavior changed. Run npm run build and the relevant test scripts. Remember: the current npm run lint command is a placeholder and is not a real linter.
- For UI work, verify at the phone viewport (375–430px) and desktop shell. For chat/storage work, follow the manual acceptance lists in the chat contract and storage plan.
- Report: task IDs, files changed, behavior preserved, tests run and exact results, migration/rollback behavior, known gaps, and commit/PR link.
- If you cannot inspect or verify something, label it NOT VERIFIED. Do not infer success from a green unrelated workflow.

## Continuous execution mode

When the owner gives a direct implementation request (“fix”, “finish”, “complete”, “continue the project”, or equivalent):

- Treat that one request as an end-to-end work package. Break it into ordered, testable subtasks and execute them on dedicated branch(es) without asking the owner to say “continue” after each small step.
- Default to IMPLEMENT-ON-BRANCH. Use READ-ONLY mode only when the owner explicitly asks for an audit/review or says not to change code.
- After each subtask, run the narrowest relevant checks, repair failures, update `docs/engineering/EXECUTION_LOG.md`, then advance to the next independent subtask.
- If one item is blocked, record the exact blocker and continue other independent, authorized items. Ask the owner only when a genuine product decision, missing requirement, credential/secret, destructive operation, data-schema migration approval, or production release authorization is required.
- Give concise progress updates during long work, but do not turn each progress update into a request for approval.
- Never push directly to `main`; do not merge, deploy production, build/update APKs, configure secrets, or perform irreversible user-data actions without explicit owner approval.
- A chat/session ending cannot be treated as background execution. Before stopping, write enough verified state, links, and next actions to `EXECUTION_LOG.md` so another session can resume without asking the owner to repeat the task.

“Complete all” means complete all authorized subtasks within the requested scope. It does not authorize enabling deferred roadmap items or crossing the release/data-safety boundaries above.

## Definition of done

A task is done only when its acceptance criteria pass, required tests/build pass, existing behavior is preserved, no user data can be lost, documentation is updated, and the patch is independently reviewable.
