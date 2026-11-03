# MAOMAO Complete Engineering Handoff

**For:** AI agents and human contributors helping audit, repair, and maintain MAOMAO.  
**Repository:** Bella0960/MAOMAO  
**Baseline:** 2026-11-03  
**Default branch:** main

This file is a self-contained handoff copy of the current engineering rules, project baseline, architecture, storage/migration design, GitHub workflow governance, remediation backlog, and AI collaboration instructions.

Read all sections before editing code. The canonical individual files remain in the repository under docs/engineering/, with the repository-wide rules in AGENTS.md. When this combined copy becomes older than the current main branch, re-read the canonical files and current source.

---

# Source: AGENTS.md

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

## Definition of done

A task is done only when its acceptance criteria pass, required tests/build pass, existing behavior is preserved, no user data can be lost, documentation is updated, and the patch is independently reviewable.


---

# Source: docs/engineering/README.md

# MAOMAO Engineering Handbook

**Purpose:** A single, current handoff package for AI agents and human contributors helping maintain MAOMAO.

**Baseline date:** 2026-11-03  
**Repository:** Bella0960/MAOMAO  
**Default branch:** main  
**Architecture decision:** Keep the existing native HTML/CSS/JavaScript multi-page application. Improve its boundaries and reliability incrementally; do not rewrite it.

## Start here

- **AGENTS.md** — mandatory rules for every contributor.
- **PROJECT_ARCHITECTURE.md** — project map, current architecture, app inventory, deployment facts.
- **STORAGE_AND_MIGRATION.md** — browser storage inventory, known data risks, target design, safe migration procedure.
- **DEVELOPMENT_GOVERNANCE.md** — GitHub workflow, branch/PR policy, tests, security, asset rules, AI collaboration.
- **REMEDIATION_BACKLOG.md** — phased tasks, dependencies, parallel work lanes, acceptance criteria.
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
| Tracked files in tree | 296 |
| HTML pages | 88 |
| JS/MJS files | 69 |
| CSS files | 11 |
| GitHub repository reported size | about 90,934 KB |
| Total file sizes in recursive tree | 94,486,753 bytes (about 90.1 MiB) |
| Main application shape | Native multi-page web app |
| Runtime/framework | Native HTML/CSS/JS; Vite is the build tool |
| Current delivery | Static web assets deployed through Cloudflare Workers |
| User-data cloud backend | Not configured in wrangler.jsonc |

The tree snapshot is a point-in-time measurement. Re-run the inventory when making a release or asset optimization decision.

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


---

# Source: docs/engineering/PROJECT_ARCHITECTURE.md

# MAOMAO Project Architecture and App Inventory

## 1. Product and technical shape

MAOMAO (“小手机”, repository package name phone-simulator) is a simulated phone whose desktop shell opens a collection of native web pages. The pages share AI characters, worldbooks, memory, user profiles, settings, theme systems, and data.

- UI/runtime: native HTML, CSS, JavaScript; no React/Vue runtime.
- Page architecture: MPA. Each HTML page is a separate entry; navigation is a full-page location change and uses query parameters.
- Shared modules: classic scripts/IIFEs exposing global namespaces such as PhoneStorage, PhoneAPI, PhoneStream, PhoneContext, PhoneEngine, and PhoneUI.
- Build: Vite scans HTML files recursively (excluding hidden folders, node_modules, dist, and .wrangler) and emits separate page entries.
- Static assets: Vite's copy-static-web-resources plugin copies allow-listed static extensions while excluding hidden directories, build folders, HTML files, and selected root configuration files.
- Deployment: Cloudflare Wrangler action builds dist and deploys the configured Worker static assets.
- Mobile layout: shared mobile-fit.css adapts narrow screens; the project is primarily designed around a phone viewport while desktop may show a phone shell.

Keep this shape. The goal is stronger module boundaries, not adopting a new framework.

## 2. High-level dependency flow

Phone desktop / launcher
→ feature page (chat, forum, diary, etc.)
→ shared UI/navigation/theme utilities
→ shared Phone infrastructure for API, AI context, memory, and storage
→ browser persistence (localStorage + multiple IndexedDB databases).

The app is not currently backed by a server-side user database. Cloudflare deployment serves static files. User data is local to the browser origin/device unless explicitly exported or separately synced by a future approved feature.

## 3. Top-level directory map

| Directory | Responsibility | Notes |
|---|---|---|
| root index.html | Home screen/launcher | Main entry; app tiles and widgets |
| desktop/ | Desktop shell, widgets, home layout | Preserve drag/drop, dock, layout persistence |
| chat/ | Chat, contacts, moments, calls, date/offline mode, group interactions | Most sensitive behavior and data migration area |
| forum/ | Forum feed, post detail/editor, profile, notifications, settings | Per-character simulated social behavior |
| worldbook/ | Characters, memory, masks, worldbooks, RP protocol/regex settings | Core AI context/identity data |
| wallet/ | Wallet, finance, shop, takeout, family cards | Some actions write into chat history |
| games/ | Game hall, cooking, story/interactive content, diagnostics | Contains largest character art assets |
| novel/ | Novel workshop pages and writing/reader/social features | Many pages; shared AI helpers should be reused |
| companion/ | Companion/live/rituals | Timed and generated interactions |
| settings/ | Main settings, appearance, icons, fonts, sound, TTS | Also contains backup code under settings/js |
| shared/ | Shared CSS and JS infrastructure | Do not duplicate common logic in pages |
| shared/js/phone/ | AI phone runtime and policies | API, streaming, context, app registry, memory, storage |
| shared/js/phone/storage/ | Repository abstractions | Domain repositories and MediaRepository |
| assets/ | Static images and app assets | Approx. 39.18 MiB |
| music/ | Music page and bundled covers; local audio uses IndexedDB | Approx. 4.51 MiB directory |
| diary/ | Diary app | Diary photos stored in separate IndexedDB database |
| library/ | Local reading library | Books/comments in IndexedDB |
| beauty/ | Chat beauty and theme tuning | UI and stored presets |
| theme-store/ | Built-in theme/font marketplace page | Reuses shared theme/font data |
| envelope/ | Letter/envelope app | Character-specific app experience |
| travel/ | Travel/dream travel | AI and role-specific data |
| profile/ | User profile/edit profile | Profile data is shared |
| poster/, growth/, couple/, inspect-phone/, tools/ | Smaller feature modules | Include them in app inventory and tests |
| tests/ | Node test suites, fixtures, and regression scripts | Contract tests are not full browser E2E tests |
| perf/ | Performance benchmarks and gates | Playwright-based scripts |
| docs/ | Project specifications, contracts, reports | Historical and current docs must be distinguished |
| previews/, design/ | Standalone design prototypes/previews | Confirm whether included in Vite output before changing |
| android/ | Android WebView wrapper sources | Not the current primary delivery channel |
| .github/workflows/ | CI, web deployment, manual APK/cleanup workflows | Workflow changes require exact trigger review |

## 4. App/page inventory (88 HTML files at baseline)

This is grouped by functional ownership, not a promise that every page is linked from the launcher.

### Launcher and system
- index.html
- desktop/widgets.html
- inspect-phone/phone.html, inspect-phone/select.html
- profile/profile.html, profile/edit-profile.html
- settings/settings.html, settings/appearance.html, settings/icon-settings.html, settings/font-settings.html, settings/sound-settings.html, settings/minimax-tts.html
- tools/api-logs.html

### Chat and social messaging
- chat/chat/chat.html, chat/chat/chat-detail.html, chat/chat/chat-search.html, chat/chat/chat-settings.html
- chat/chat/group-play.html
- chat/contacts/contacts.html
- chat/moments/moments.html, chat/moments/my-moments.html
- chat/call/call.html, chat/call/call-ui.html, chat/call/call-settings.html
- chat/date/date.html, chat/date/journey.html
- chat/footprint/footprint.html
- chat/shake/shake.html
- chat/sticker/sticker-manager.html

### Forum
- forum/forum.html, forum/forum-detail.html, forum/forum-editorial.html, forum/forum-my-content.html, forum/forum-notifications.html, forum/forum-profile.html, forum/forum-settings.html, forum/post-create.html

### Characters, memory, and roleplay knowledge
- worldbook/characters/characters.html
- worldbook/memory/memory.html
- worldbook/mask/mask.html
- worldbook/worldbook/worldbook.html
- worldbook/settings/regex-settings.html, worldbook/settings/rp-protocol.html

### Novel workshop
- novel/novel.html, novel/novel-achievements.html, novel/novel-bible.html, novel/novel-continuity.html, novel/novel-detail.html, novel/novel-editor.html, novel/novel-live-room.html, novel/novel-me.html, novel/novel-planning.html, novel/novel-read.html, novel/novel-readers.html, novel/novel-setup.html, novel/novel-stats.html

### Wallet and commerce simulation
- wallet/wallet.html, wallet/finance.html, wallet/shop.html, wallet/shop-admin.html, wallet/takeout.html, wallet/family-cards.html, wallet/close-pay.html

### Games and interactive features
- games/games.html, games/cooking.html, games/story.html, games/story-create.html
- games/diagnose.html, games/reset-cases.html, games/force-unlock.html (diagnostic/maintenance pages; do not assume normal launcher pages)

### Lifestyle, creation, and content
- cafe/cafe.html
- diary/diary.html
- library/library.html
- music/music.html
- travel/dream-travel.html
- companion/companion.html, companion/live.html, companion/rituals.html
- envelope/envelope.html
- beauty/beauty.html
- theme-store/theme-store.html
- poster/poster.html
- growth/growth.html
- couple/couple.html

### Design/demo and documentation
- design/note-ribbon-gallery.html
- previews/diary-redesign.html, previews/diary-redesign-v2.html
- docs/audit-report.html

The list is a verified snapshot. Rebuild it from the recursive Git tree if pages are added/removed.

## 5. Core shared infrastructure

### AI phone runtime
Located in shared/js/phone/:
- phone_storage.js — localStorage-compatible storage wrapper, JSON/error handling, role-scoped phone_data_v2 and legacy-key access.
- phone_api.js — non-streaming OpenAI-compatible API calls, JSON handling, timeout/log support.
- phone_stream.js — streaming/SSE engine, timeouts, partial-response preservation, rendering callbacks.
- phone_context.js — prompt/context assembly from character, worldbooks, memory, recent history, and app data.
- phone_apps.js — simulated app registry and app data/prompt declarations.
- phone_engine.js — role switching and generated app-data refresh.
- phone_ui.js — toast/loading/confirm/back helpers.
- chat-*-policy.js and group-chat-policy.js — extracted pure policy helpers for messages, send options, presence, follow-up, group chat, and context.
- memory_recall.js, memory_space_v2.js — memory search/space behavior.
- role-public-timeline.js, role_family_cards.js — role-facing timeline and family-card support.

### Repository/data layer
Located in shared/js/phone/storage/:
- repository.js — generic result-based repository abstraction.
- repositories.js — factory aggregation.
- character-repository.js, profile-repository.js, group-repository.js, settings-repository.js, conversation-repository.js, memory-repository.js, worldbook-repository.js — domain adapters.
- media-repository.js — IndexedDB Blob media store with hash-based deduplication and references.

Important limitation: having a ConversationRepository does not mean conversations are already stored in IndexedDB. At this baseline, ConversationRepository reads/writes chat_history_<id> using the configured storage adapter (localStorage-backed). Its getPage method slices the loaded whole array; it is not physical IndexedDB pagination.

## 6. Cross-module contracts

- Character identity and conversation identity must remain stable.
- Single chats, group chats, and offline date-mode messages must keep their existing IDs and message objects.
- Offline/date messages share the existing chat_history_<roleId> and carry mode/scene fields; online chat hides these where required, but the history is not deleted.
- Other modules (wallet, forum, calls, date mode, memory search, notifications) may read/write chat history. Every call site must be inventoried before changing its storage backend.
- Rich message fields must be retained. Do not normalize messages to plain text only.
- Theme and visual changes must preserve user-selected presets and per-character overrides.
- Routes and query parameters are public interfaces between MPA pages. Do not rename or remove them without searching all callers and keeping compatibility.

## 7. Important codebase caveats

- CLAUDE.md still contains historical statements about 48 HTML pages and disabled service-worker registration; both conflict with the current tree/source.
- CLAUDE.md's old “only localStorage” storage statement is not accurate now that multiple IndexedDB databases are in use.
- apps/settings was previously labeled orphaned; verify all references before deleting it.
- chat-detail.html is a very large file. Historical audit measured roughly 7,181 lines at its time; re-measure before relying on the count.
- The old audit's statement about test count is historical. Current tests directory contains seven entries including fixtures; package.json exposes two test scripts. A test script's coverage must be described accurately.


---

# Source: docs/engineering/STORAGE_AND_MIGRATION.md

# MAOMAO Storage Architecture, Backup, and Migration Plan

## 1. Scope: three different storage systems

Never combine these into one “storage-full” diagnosis.

| System | What it stores | Current finding |
|---|---|---|
| Git repository | Source code and static assets | Approx. 90.1 MiB in the recursive file tree |
| GitHub Actions artifacts/cache | CI output such as APK artifacts | APK upload failed because GitHub reported Artifact storage quota reached; this is not browser localStorage |
| Browser origin storage | User's roles, chats, memories, settings, books, media, and other app data | Mixed localStorage + IndexedDB; data is local to the browser origin/device |

Cloudflare deployment currently publishes static dist assets. It is not a user-data database or sync layer.

Browser storage is scoped to the origin, browser profile, and device. Changing domains or using another browser/profile can make local data appear absent. Do not promise cloud synchronization.

## 2. Current storage inventory (verified from source)

### localStorage — current primary use

| Key/domain | Current role | Known concern |
|---|---|---|
| chat_history_<id> | Full serialized message array per role or group | No overall history cap; image/sticker fields may contain data URLs; largest localStorage risk |
| ai_custom_characters | Character list; avatar data URLs may be embedded | Large avatars add to localStorage usage |
| phone_data_v2 | Role-scoped app data root: phoneData[contactId][appId] | Not a universal replacement for all old keys; some domains still use separate keys |
| chat_memories_<id> and chat summary keys | Long-term memory, summary settings/state | Memory item cap exists; chat history cap does not |
| phone_worldbooks, phone_groups, myProfile | Worldbooks, groups, user profile | Still use separate legacy/global keys |
| moments, forum_posts, settings and app-specific keys | Social feed, forum and application data | Some image-bearing structures may still add substantial strings |
| home_custom_wallpaper and other legacy keys | Legacy wallpaper/settings compatibility | Wallpaper store can fall back to legacy localStorage |
| music_local_tracks | Local music metadata | Audio Blob itself is in IndexedDB, metadata remains in localStorage |
| maomao_reader_bg_v1 | Reading background | Source comments cap the data URL at 600,000 characters |

PhoneStorage provides a common API and error-result namespace, but not every existing caller uses it. Some legacy pages still access localStorage directly. Do not assume all keys have already migrated.

### IndexedDB databases and backup status

| Database | Version / stores | Main consumer | Current backup observation |
|---|---|---|---|
| maomao-media-store | v2: wallpapers (out-of-line key), audio (keyPath id) | shared/js/wallpaper-store.js and music/music.html | Listed in backup.js. wallpapers included. audio record's blob field is explicitly excluded, so the actual audio file is not included by that target rule. |
| maomao_diary_photo_store_v1 | v1: photos (keyPath key) | diary/diary.html | Listed in backup.js |
| maomao-reading-library | v1: books (keyPath id), comments (keyPath id) | library/library.html | Listed in backup.js |
| maomao-font-presets | v1: presets (keyPath id, includes Blob) | shared/js/font-loader.js, settings/font-settings.html, theme-store/theme-store.html | Listed in backup.js; Blob serialized as Base64 with 30 MiB per-record and 90 MiB per-store source limits |
| maomao-assets | v1: assets, blobs, refs | shared/js/phone/storage/media-repository.js | Not present in backup.js IDB_TARGETS at this baseline; must be added and tested before the repository is used for irreplaceable chat media |
| maomao-restore-point | v1, restore-point helper store | settings/js/backup.js | Internal restore safety mechanism, not ordinary user content; inspect its lifecycle during backup refactor |

The database register is a code-derived inventory, not a complete audit of every browser profile's live IndexedDB data. Add a startup/runtime diagnostic to enumerate actual databases where supported and report database names, versions, stores, record counts, and approximate sizes without exposing message content.

### Critical facts

- ConversationRepository currently uses the configured result storage adapter around chat_history_<id>; it is not yet backed by IndexedDB.
- Its getPage method currently reads the complete history array and slices it in memory. This is not disk-level paging.
- MediaRepository already supports Blob storage, SHA-256-based IDs, de-duplication, and reference records. Verify its deletion/reference semantics and add it to backup/restore before connecting chat images.
- Diary photos use IndexedDB but store a data field (source currently uses strings/data URLs), not necessarily Blob.
- Local music files use IndexedDB audio records, but backup.js excludes the blob field. Decide whether music should be included in a full backup or separately exportable.
- Backup.js includes several fixed IndexedDB database/store definitions. Any new DB/store must be registered and covered by restore tests at the same time it is introduced.

## 3. Target architecture

Use a small, explicit set of storage responsibilities.

### A. localStorage: small preferences and pointers only

Keep:
- active role/group IDs;
- theme and UI preferences;
- small feature flags;
- small indexes or last-opened pointers where needed.

Do not use it for:
- entire chat histories;
- Base64 images/audio/video;
- imported book bodies;
- large custom fonts;
- large media collections.

### B. IndexedDB: structured user data

Target domains:
- characters and role metadata;
- groups and conversation metadata;
- messages, ordered by conversation and message timestamp/ID;
- long-term memories and summaries;
- worldbook definitions and role bindings;
- app-specific structured state;
- sync/export metadata and schema versions.

Do not prematurely merge every existing DB into one physical database. Prefer one authoritative core-data DB and the existing media DB, while retaining mature specialist DBs (books, fonts, diary photos) until their migration benefit is demonstrated. Maintain a central database registry for all of them.

### C. MediaRepository / Blob store: binary data

Use the existing maomao-assets repository rather than inventing a second media system, after backup support is complete.

Messages should reference media by assetId. The renderer should resolve assetId to a Blob/object URL. Every object URL must be revoked when no longer needed. Reuse identical assets by hash when safe. Store MIME type, byte size, owner type/id, creation time, hash, and reference metadata.

A media cleanup job must only delete assets proven to have zero valid references. It must never guess from file age or missing thumbnails.

## 4. Conversation schema direction

The target is a durable conversation store, not one ever-growing JSON array.

Proposed conceptual entities (exact schema needs a separate review before implementation):

- conversations: conversationId, roleId/groupId, type, title/meta, createdAt, updatedAt, schemaVersion.
- messages: messageId/mid, conversationId, sequence or timestamp index, role/sender, message type, full legacy-compatible payload, createdAt, schemaVersion.
- attachments/media: assetId references; legacy data URLs remain readable until migration completes.
- migration_state: source key, target database, schema version, copied count, verified count, completion marker.

Preserve unknown/extension fields in messages. Do not collapse role/text/content, img/desc, type, silent, mode, scene, memberId, group metadata, card payloads, or other rich message fields.

## 5. Safe, non-destructive migration sequence

Never begin with “move then delete.” Follow this order:

1. **Inventory:** find every reader/writer of chat_history_<id>, characters, memories, images, stickers, calls, date mode, group messages, wallet/forum integrations, search, backup, export, and import.
2. **Baseline:** capture current schema examples using synthetic fixtures; record counts, message order, stable IDs, role/group IDs, and all known fields. Never use real private chats as public fixtures.
3. **Backup coverage:** update backup.js for maomao-assets, media blobs/refs, and audio Blob inclusion or an explicitly documented separate-export route. Test backup and restore both ways.
4. **Preflight:** check IndexedDB availability and navigator.storage.estimate() where supported. Do not assume a fixed browser quota. Estimate required free space plus headroom; stop safely if insufficient.
5. **Shadow copy:** copy existing localStorage histories to IndexedDB without changing the source key. Process large histories in bounded batches; show progress and allow retry.
6. **Verification:** compare per-conversation message counts, stable IDs/mids, order, timestamps, role/group association, and a deterministic hash of normalized records. Verify media references and readable previews.
7. **Compatibility adapter:** route every known reader/writer through a single ConversationRepository adapter. Support old localStorage data and new IndexedDB data during the migration window. Avoid uncoordinated direct writes from pages.
8. **Controlled cutover:** set a per-conversation migration marker only after verification. New writes go to the authoritative IndexedDB path; old keys remain untouched as rollback snapshots. Do not continue unbounded duplicate writes to localStorage.
9. **Regression:** test private chat, group chat, offline date mode, search, message edits/deletes/regenerate, calls, wallet cards, forum share, moments, memories, context selection, backup restore, and phone browser flows.
10. **Soak and rollback:** keep rollback path and migration metadata for at least one stable release. If verification fails, keep the old store authoritative and report the exact failed conversation.
11. **Cleanup:** remove old localStorage chat keys only after multiple successful backups, verified restore, successful real-device acceptance, and explicit user approval. Default behavior is to retain old keys.

The migration must be resumable and idempotent. Running it twice must not duplicate messages or media.

## 6. Backup/restore requirements

Backup is a core safety feature, not a best-effort utility.

Required behavior:
- Versioned manifest listing every localStorage key group and IndexedDB database/store.
- Explicit count/size totals and skipped-record list.
- Every active database appears in one registry used by both export and import.
- Secrets excluded by default; user opt-in must be explicit, separately confirmed, and clearly labeled.
- User can export role-scoped data or a full-device backup, with dependency handling for referenced media.
- Restore validates the full archive before changing live data.
- Restore writes to staging or creates an automatic pre-restore snapshot; if any store fails, restore reports partial state and provides rollback.
- Restore validates roles, conversations, message totals, asset references, and book/font/diary record counts after writing.
- No silent partial success.
- Large backup operations are chunked/streamed where possible to avoid mobile memory spikes.
- Export must never silently omit Blob payloads. Exclusions must be visible in the export result.

## 7. Storage diagnostics and quota UX

Create a read-only storage diagnostics service and Settings UI.

Show:
- estimated origin usage and quota from navigator.storage.estimate() where supported;
- localStorage total and largest keys (key names and byte estimates only; never reveal content);
- IndexedDB database/store record counts and approximate sizes where measurable;
- largest role/conversation/media collections;
- last successful backup and most recent migration status;
- write failures and quota errors with timestamps.

Actions:
- export a backup;
- retry failed migration;
- inspect the largest storage categories;
- remove only selected disposable caches after confirmation.

Do not offer a “free space” button that clears everything. Do not auto-delete chats, memories, worldbooks, photos, or books. navigator.storage.persist() may be requested only with an honest explanation and must handle denial; it is not a guaranteed quota increase.

## 8. Browser/platform limitations

- localStorage and IndexedDB belong to the website origin and browser profile. Switching hostnames, protocols, browsers, or devices may expose a separate empty store.
- Browser quotas are implementation/device-dependent; estimate rather than hard-code a universal IndexedDB limit.
- Browser storage can be evicted under some conditions. Encourage regular exports and test restore.
- Private browsing, storage restrictions, and low disk space may affect availability.
- The app must keep clear error handling when IndexedDB is blocked/unavailable or quota is exceeded.

## 9. Storage migration acceptance checklist

- [ ] All current DBs and stores registered; no untracked active DB.
- [ ] Export includes every declared store and all required blobs.
- [ ] Restore into a clean browser profile reconstructs the same role, conversation, media, book, font, and diary counts.
- [ ] Legacy chat data is still readable.
- [ ] Private, group, online, and date-mode histories remain isolated and correctly ordered.
- [ ] Rich message payloads and unknown fields survive.
- [ ] Failed writes never display a false success state.
- [ ] Migration can resume after refresh/crash without duplicates.
- [ ] No original key is deleted automatically.
- [ ] Mobile storage diagnostics and backup/restore tested on a real phone browser.


---

# Source: docs/engineering/DEVELOPMENT_GOVERNANCE.md

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

| Workflow | Current trigger | Purpose | Policy |
|---|---|---|---|
| deploy-cloudflare-worker.yml | Push to main with matching app/source paths; manual | Vite build and Cloudflare Worker static-asset deployment | Keep automatic website deployment |
| chat-regression-contract.yml | Push/PR for chat-related paths; manual | npm run test:chat:contract | Keep and expand |
| perf-gate.yml | Push/PR for chat/shared phone/perf paths; manual | Playwright performance budget gate | Keep; inspect runtime/cost and maintain |
| build-android-apk.yml | Manual workflow_dispatch only | Build debug APK | Do not restore push trigger; output retained 3 days |
| cleanup-apk-artifacts.yml | Manual workflow_dispatch only | Delete artifacts whose exact name is MAOMAO-Android-APK in this repo | Run manually to clean existing APK outputs; scope does not include other repos |
| npm-publish-github-packages.yml | GitHub release created | Runs npm ci, npm test, npm publish | Unverified; package.json has no generic test script and the project is not currently operated as an npm package. Do not publish/release until the workflow is reviewed and explicitly approved |

The previous APK artifact-upload failure reported GitHub Artifact storage quota reached. That failure happened after the Build debug APK step succeeded. The failed run itself had no uploaded artifact. The cleanup workflow is repository-scoped. If account-wide usage is still full after cleanup and GitHub's usage refresh window, inspect artifacts in other repositories/account scope.

No routine workflow should upload an APK. Build APK only after an explicit need.

## 3. Current quality commands and limitations

package.json currently exposes:
- npm run build — Vite production build.
- npm run test:chat:contract — Node built-in test runner for chat contracts.
- npm run test:detective:unlock — Node test runner for detective unlock behavior.
- npm run perf:gate and other perf scripts — Playwright/performance scripts.
- npm run lint — currently prints a fixed “Lint passed” message; this is not a real linter.
- No generic npm test script exists at this baseline.

tests/ contains two primary test entry scripts plus additional manual/reproduction scripts and fixtures. A green contract test does not mean every page or user journey was exercised.

Required check for every code PR:
1. npm ci
2. npm run build
3. the relevant test script(s)
4. related performance gate if chat/shared phone behavior changes
5. manual acceptance on affected views; for major storage/chat work, phone viewport and real-device browser testing.

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
- E. Feature fixes: one App at a time, scoped to its own files; no storage architecture changes without coordination.

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
Do not create GitHub releases or publish packages until npm-publish-github-packages.yml and package.json scripts have been reviewed and approved.
Before a significant migration release: full backup test, migration canary, regression checks, production deploy check, and rollback instructions.


---

# Source: docs/engineering/REMEDIATION_BACKLOG.md

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


---

# Source: docs/engineering/AI_HANDOFF_PROMPT.md

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

Work only on the assigned Task ID. Keep the first pass read-only unless specifically asked to implement. Do not modify main directly. Use a dedicated branch/PR when code changes are authorized. Never edit the same files as another agent at the same time.

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

