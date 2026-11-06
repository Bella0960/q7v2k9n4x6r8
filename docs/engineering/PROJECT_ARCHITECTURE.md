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
| fortune/ | Fate Cabin: crystal tarot, configurable decision wheel, daily oracle | Local-only reflection and random-choice tools |
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

## 4. App/page inventory (88 HTML files at baseline; 89 after FATE-001)

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

### Personal reflection and random choice
- fortune/fortune.html — 命运小屋：水晶塔罗、大转盘、今日灵签；localStorage key `maomao_fate_cabin_v1`

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
