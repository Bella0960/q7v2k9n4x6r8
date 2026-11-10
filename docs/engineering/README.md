# MAOMAO Engineering Handbook

**Purpose:** A single, current handoff package for AI agents and human contributors helping maintain MAOMAO.

**Original baseline date:** 2026-11-03  
**Latest repository-tree inventory:** 2026-11-11 (main SHA `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`)  
**Repository:** Bella0960/MAOMAO  
**Default branch:** main  
**Architecture decision:** Keep the existing native HTML/CSS/JavaScript multi-page application. Improve its boundaries and reliability incrementally; do not rewrite it.

## Start here

- **AGENTS.md** — mandatory rules for every contributor.
- **PROJECT_ARCHITECTURE.md** — project map, current architecture, app inventory, deployment facts.
- **STORAGE_AND_MIGRATION.md** — browser storage inventory, known data risks, target design, safe migration procedure.
- **DEVELOPMENT_GOVERNANCE.md** — GitHub workflow, branch/PR policy, tests, security, asset rules, AI collaboration.
- **REMEDIATION_BACKLOG.md** — phased tasks, dependencies, parallel work lanes, acceptance criteria.
- **APP_PAGE_INVENTORY.md** — current HTML-page tree, desktop destinations, and partial source-verified route map; dynamic callers/storage ownership remain in progress.
- **AI_HANDOFF_PROMPT.md** — copyable prompt and task assignment template for other AIs.

Existing references which remain important:

- docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md — visual design authority.
- docs/chat-architecture-contract.md — chat behavior and data compatibility contract.
- docs/chat-regression-baseline.md — chat regression cases and manual acceptance checklist.
- docs/代码审查报告-20261030.md — historical audit findings; re-check before assuming every finding is still open.
- docs/重构执行报告-20261030.md — changes completed in the October 30 refactor.
- docs/记忆空间-框架重构说明.md — memory page structural decisions.
- CLAUDE.md — additional project context; some sections were stale at this baseline and are being aligned.

## Verified repository snapshot

The recursive Git tree for main was complete (not truncated) at this baseline:

| Metric | Verified value |
|---|---:|
| Entries in recursive tree (files + directories) | 445 |
| HTML pages | 89 |
| JS/MJS files | 112 |
| CSS files | 14 |
| Total sizes of tracked file blobs | 95,744,389 bytes (about 91.3 MiB) |
| Main application shape | Native multi-page web app |
| Runtime/framework | Native HTML/CSS/JS; Vite is the build tool |
| Current delivery | Static web assets deployed through Cloudflare Workers |
| User-data cloud backend | Not configured in wrangler.jsonc |

The tree snapshot is a point-in-time measurement for the main SHA listed above. The recursive GitHub tree response was complete (not truncated). Re-run the inventory when making a release or asset optimization decision.

## Critical current facts

1. MAOMAO is one integrated project, not a collection of separate sub-app repositories. Top-level feature folders are modules of the same phone simulator. The apps directory currently contains only apps/settings with two CSS files; old docs call it an orphan, but references must be checked before removing it.
2. The root project is a native multi-page application. Vite scans HTML pages as separate build entries and copies allowed static resources into dist. Do not convert it to an SPA as part of routine cleanup.
3. index.html currently registers ./sw.js on window load. The old CLAUDE.md statement that Service Worker registration is disabled is stale. Verify cache/update behavior before modifying SW logic.
4. Chat history is still primarily stored as one serialized array per role/group in localStorage using chat_history_<id>. It is not yet a true IndexedDB-backed paginated conversation store.
5. Several areas already use IndexedDB (wallpaper/media, local audio, diary photos, reading library, fonts), and a new maomao-assets media repository exists. The fact that a repository module exists does not mean every feature uses it.
6. settings/js/backup.js enumerates specific IndexedDB databases. At this baseline, maomao-assets is not in that list, and the audio store excludes its Blob field. These are backup-coverage gaps to resolve before migrating chat media.
7. Cloudflare deployment builds the website and deploys dist as static assets. wrangler.jsonc currently specifies the Worker name, compatibility date, and assets directory; it does not configure D1, R2, user authentication, or account sync.
8. APK workflow is manual-only now. Old APK cleanup has a separate manual workflow which deletes only artifacts named MAOMAO-Android-APK. The cleanup workflow must still be manually run by a repository maintainer. A repository-scoped cleanup cannot clear artifacts owned by other repositories in the same account/organization.
9. package.json lint currently prints “Lint passed”; it is not a real lint check. package.json does not define a generic npm test script, while npm-publish-github-packages.yml invokes npm test on release. Treat that release workflow as unverified and do not create a release until it is reviewed.
10. Existing chat tests are largely static-contract and pure-policy tests. They do not replace real browser/mobile acceptance.

## Repository size is not Actions Artifact storage

The approx. 90 MiB repository snapshot is source/assets in Git. The recent GitHub error explicitly said Artifact storage quota was reached while uploading the APK. These are separate storage pools and must be diagnosed separately.

The biggest tracked directories are:
- games: about 39.44 MiB, with games/assets about 38.88 MiB.
- assets: about 39.18 MiB.
- music: about 4.51 MiB.
- chat: about 2.86 MiB.
- shared: about 1.13 MiB.

Do not delete or recompress images in bulk. First identify usage, actual rendered dimensions, transparency requirements, visual quality, duplicate use, and whether a source original must be retained.

## Source-of-truth hierarchy

When documents disagree, use this order:

1. The user's latest explicit product requirement.
2. Current source code and verified runtime behavior.
3. This engineering handbook's verified baseline and approved decisions.
4. Current feature contracts and visual design constitution.
5. Historical audit/refactor reports.
6. Old assistant/agent notes and assumptions.

A historic report records what was observed at its date. Before implementing it, verify whether the issue still exists on main.

## Non-goals for the first cleanup cycle

- No framework rewrite.
- No destructive chat-history cap or automatic deletion.
- No automatic APK builds.
- No forced migration to cloud user-data storage.
- No renaming role IDs, group IDs, storage keys, or routes.
- No redesign of every screen.
- No broad deletion of legacy files until references and data compatibility are proven.

## First milestones

1. Reconcile project documentation and create an authoritative storage/database registry.
2. Finish repository/Actions workflow hygiene and clean old APK artifacts.
3. Close backup coverage gaps for every active IndexedDB database.
4. Inventory every chat-history read/write caller, then design the non-destructive IndexedDB conversation migration.
5. Add real storage diagnostics and quota/error reporting.
6. Gradually unify remaining direct storage/API callers and improve automated/manual regression coverage.
