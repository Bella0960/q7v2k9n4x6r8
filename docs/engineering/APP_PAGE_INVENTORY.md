# MAOMAO App / Page Inventory

**Snapshot:** `main` at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273` · **2026-11-11**
**Source:** complete GitHub recursive tree (`truncated=false`) plus static `data-href` and `href` references in `index.html`.

## Inventory summary

| Metric | Verified count |
|---|---:|
| HTML pages | 89 |
| HTML pages registered by launcher `data-href` | 28 unique destinations |
| Other `.html` links in `index.html` | 2 |
| Top-level page groups | 27 |

**Important:** a page not directly listed by `index.html` is not an orphan. It may be opened by an in-app link, query-string route, workflow, or another page. Do not delete it based on this list.

## Launcher destinations from `index.html`

These exact destinations are present in static `data-href` attributes:

| Destination | Owning area |
|---|---|
| `beauty/beauty.html` | 聊天美化 |
| `cafe/cafe.html` | 咖啡馆 |
| `chat/chat/chat.html` | 聊天套件 |
| `chat/date/date.html` | 聊天套件 |
| `chat/footprint/footprint.html` | 聊天套件 |
| `companion/companion.html` | 陪伴 |
| `companion/live.html` | 陪伴 |
| `couple/couple.html` | 情侣空间 |
| `diary/diary.html` | 日记 |
| `envelope/envelope.html` | 信件 |
| `forum/forum.html` | 论坛 |
| `games/games.html` | 游戏 |
| `growth/growth.html` | 成长 |
| `inspect-phone/select.html` | 手机诊断 |
| `library/library.html` | 阅读 |
| `music/music.html` | 音乐 |
| `novel/novel.html` | 小说工作室 |
| `poster/poster.html` | 海报 |
| `settings/settings.html` | 设置 |
| `theme-store/theme-store.html` | 主题商城 |
| `travel/dream-travel.html` | 旅行 |
| `wallet/finance.html` | 钱包与商店 |
| `wallet/shop.html` | 钱包与商店 |
| `wallet/takeout.html` | 钱包与商店 |
| `wallet/wallet.html` | 钱包与商店 |
| `worldbook/characters/characters.html` | 角色与世界书 |
| `worldbook/memory/memory.html` | 角色与世界书 |
| `worldbook/worldbook/worldbook.html` | 角色与世界书 |

Other static `.html` links found in `index.html` but not in its `data-href` set:

- `desktop/widgets.html`
- `settings/appearance.html`

## All HTML pages by directory

Legend: **Launcher** = exact static destination in `index.html`; **Other home link** = ordinary `href` found in `index.html`; all other pages are recorded as nested pages pending route/caller mapping. This is an inventory classification, not a usage or deletion decision.

### 手机主屏 (`(root)/`)

| Page | Entry classification |
|---|---|
| `index.html` | 主屏/主入口 |

### 聊天美化 (`beauty/`)

| Page | Entry classification |
|---|---|
| `beauty/beauty.html` | 主屏 data-href 入口 |

### 咖啡馆 (`cafe/`)

| Page | Entry classification |
|---|---|
| `cafe/cafe.html` | 主屏 data-href 入口 |

### 聊天套件 (`chat/`)

| Page | Entry classification |
|---|---|
| `chat/call/call-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/call/call-ui.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/call/call.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/chat/chat-detail.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/chat/chat-search.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/chat/chat-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/chat/chat.html` | 主屏 data-href 入口 |
| `chat/chat/group-play.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/contacts/contacts.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/date/date.html` | 主屏 data-href 入口 |
| `chat/date/journey.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/footprint/footprint.html` | 主屏 data-href 入口 |
| `chat/moments/moments.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/moments/my-moments.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/shake/shake.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `chat/sticker/sticker-manager.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 陪伴 (`companion/`)

| Page | Entry classification |
|---|---|
| `companion/companion.html` | 主屏 data-href 入口 |
| `companion/live.html` | 主屏 data-href 入口 |
| `companion/rituals.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 情侣空间 (`couple/`)

| Page | Entry classification |
|---|---|
| `couple/couple.html` | 主屏 data-href 入口 |

### 设计素材 (`design/`)

| Page | Entry classification |
|---|---|
| `design/note-ribbon-gallery.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 桌面挂件 (`desktop/`)

| Page | Entry classification |
|---|---|
| `desktop/widgets.html` | 主屏 href 入口 |

### 日记 (`diary/`)

| Page | Entry classification |
|---|---|
| `diary/diary.html` | 主屏 data-href 入口 |

### 审计文档 (`docs/`)

| Page | Entry classification |
|---|---|
| `docs/audit-report.html` | 历史审计页（按日期参考） |

### 信件 (`envelope/`)

| Page | Entry classification |
|---|---|
| `envelope/envelope.html` | 主屏 data-href 入口 |

### 论坛 (`forum/`)

| Page | Entry classification |
|---|---|
| `forum/forum-detail.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum-editorial.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum-my-content.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum-notifications.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum-profile.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `forum/forum.html` | 主屏 data-href 入口 |
| `forum/post-create.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 游戏 (`games/`)

| Page | Entry classification |
|---|---|
| `games/cooking.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `games/diagnose.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `games/force-unlock.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `games/games.html` | 主屏 data-href 入口 |
| `games/reset-cases.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `games/story-create.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `games/story.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 成长 (`growth/`)

| Page | Entry classification |
|---|---|
| `growth/growth.html` | 主屏 data-href 入口 |

### 手机诊断 (`inspect-phone/`)

| Page | Entry classification |
|---|---|
| `inspect-phone/phone.html` | 诊断流程页面 |
| `inspect-phone/select.html` | 主屏 data-href 入口 |

### 阅读 (`library/`)

| Page | Entry classification |
|---|---|
| `library/library.html` | 主屏 data-href 入口 |

### 音乐 (`music/`)

| Page | Entry classification |
|---|---|
| `music/music.html` | 主屏 data-href 入口 |

### 小说工作室 (`novel/`)

| Page | Entry classification |
|---|---|
| `novel/novel-achievements.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-bible.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-continuity.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-detail.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-editor.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-live-room.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-me.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-planning.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-read.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-readers.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-setup.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel-stats.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `novel/novel.html` | 主屏 data-href 入口 |

### 海报 (`poster/`)

| Page | Entry classification |
|---|---|
| `poster/poster.html` | 主屏 data-href 入口 |

### 设计预览 (`previews/`)

| Page | Entry classification |
|---|---|
| `previews/diary-redesign-v2.html` | 设计预览页（不得当作孤儿删除） |
| `previews/diary-redesign.html` | 设计预览页（不得当作孤儿删除） |

### 个人资料 (`profile/`)

| Page | Entry classification |
|---|---|
| `profile/edit-profile.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `profile/profile.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 设置 (`settings/`)

| Page | Entry classification |
|---|---|
| `settings/appearance.html` | 主屏 href 入口 |
| `settings/font-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `settings/icon-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `settings/image-generation.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `settings/minimax-tts.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `settings/settings.html` | 主屏 data-href 入口 |
| `settings/sound-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 主题商城 (`theme-store/`)

| Page | Entry classification |
|---|---|
| `theme-store/theme-store.html` | 主屏 data-href 入口 |

### 工具 (`tools/`)

| Page | Entry classification |
|---|---|
| `tools/api-logs.html` | 目录内子页；跨页入口待映射（不代表未使用） |

### 旅行 (`travel/`)

| Page | Entry classification |
|---|---|
| `travel/dream-travel.html` | 主屏 data-href 入口 |

### 钱包与商店 (`wallet/`)

| Page | Entry classification |
|---|---|
| `wallet/close-pay.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `wallet/family-cards.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `wallet/finance.html` | 主屏 data-href 入口 |
| `wallet/shop-admin.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `wallet/shop.html` | 主屏 data-href 入口 |
| `wallet/takeout.html` | 主屏 data-href 入口 |
| `wallet/wallet.html` | 主屏 data-href 入口 |

### 角色与世界书 (`worldbook/`)

| Page | Entry classification |
|---|---|
| `worldbook/characters/characters.html` | 主屏 data-href 入口 |
| `worldbook/mask/mask.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `worldbook/memory/memory.html` | 主屏 data-href 入口 |
| `worldbook/settings/regex-settings.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `worldbook/settings/rp-protocol.html` | 目录内子页；跨页入口待映射（不代表未使用） |
| `worldbook/worldbook/worldbook.html` | 主屏 data-href 入口 |

## Known test entry points

The scripts below are verified from `package.json`; this table groups them by the area they most directly exercise. It is not a claim that each listed page has complete end-to-end coverage.

| Area | Test command(s) |
|---|---|
| Chat core | `npm run test:chat:contract`, `npm run test:chat:reply`, `npm run test:chat:isolation`, `npm run test:chat:call`, `npm run test:chat:bubbles`, `npm run test:chat:image-vision` |
| Group / role media | `npm run test:group:ui`, `npm run test:group:invite-e2e`, `npm run test:role:avatars`, `npm run test:images` |
| Forum / media | `npm run test:bugfix:blockers`, `npm run test:forum:media`, `npm run test:forum:seed`, `npm run test:forum:mobile` |
| Desktop / PWA / icons | `npm run test:desktop:layout`, `npm run test:pwa:navigation`, `npm run test:icons:presets` |
| Fonts / settings | `npm run test:font:runtime`, `npm run test:clock:palette`, `npm run test:api:image` |

## Observed query parameters and route flows (source-verified, partial)

The following fields were read directly from the receiving page/source. The word `id` is deliberately not treated as one global entity type; its meaning depends on the destination page.

| Receiving page / module | Observed query fields | Meaning / handling |
|---|---|---|
| `chat/chat/chat-detail.html` | `id`, `hl`, `vl`, `cooking`; one secondary summary helper also accepts `roleId` | `id` is a role or group identifier (group IDs use the `g` prefix); `hl` locates a searched message; `vl=1/0` is a manual virtual-list test switch; `cooking=1` consumes a role-scoped kitchen draft. |
| `chat/chat/chat-settings.html` | `roleId` | Active role or group being configured. |
| `chat/chat/chat-search.html` | `roleId` | Role whose chat history is searched; result opens chat detail with `id` and `hl`. |
| `chat/chat/group-play.html` | `id` or `roleId` | Group conversation identifier; its back action returns to settings with `roleId`. |
| `chat/call/call.html` | `id`, `type`, `group` | Role ID; `type=video` selects video mode (otherwise voice); `group=1` enables group-call handling. |
| `chat/call/call-ui.html` | `roleId` or `id`, `type` | Role identifier; `type=incoming` selects incoming-call presentation. |
| `chat/date/journey.html` | `id`, `scene` | Role ID and selected offline scene. |
| `chat/date/date.html` | `id`, `scene`, `arrived`, `journey`, `preview` | Role ID, scene, arrival state, journey start marker, and preview mode. |
| `forum/forum-detail.html` | `id`, `focus` | `id` is a post ID; `focus=comment` requests focus on the comment area. |
| `forum/forum-my-content.html` | `tab` | Selects the current content category, defaulting to `posts`. |
| `chat/moments/moments.html` | `publishedPostId` | Identifies the post for the post-publication AI-reply flow. |
| `novel/novel-detail.html`, `novel/novel-read.html` | `id` | Work ID in the novel authoring/reader store. |
| `couple/couple.html`, `companion/companion.html`, `envelope/envelope.html`, `inspect-phone/phone.html` | `id` | Context-specific role/contact ID; each page applies its own fallback behavior. |
| `beauty/beauty.html` | `roleId` | Preselects a role-specific chat-beauty scope. |
| `worldbook/characters/js/characters-manager.js` | `from` | Return destination context; `from=contacts` returns to the contacts page, otherwise it returns to the home page. |
| `shared/js/custom-css.js`, `shared/js/chat-notifier.js` | `id` | Shared helpers read the current role ID from a chat-detail URL for custom styling or notification routing. |

### Source-verified sender → receiver flows

| Sender | Destination and parameters | Purpose |
|---|---|---|
| `chat/contacts/contacts.html`, chat list rows, `shared/js/chat-notifier.js`, `chat/shake/shake.html` | `chat/chat/chat-detail.html?id=<roleId>` | Open a role conversation. `chat-detail` also treats IDs beginning with `g` as group conversations. |
| `chat/chat/chat-settings.html` | `chat/chat/chat-search.html?roleId=<roleId>` | Search the selected conversation's history. |
| `chat/chat/chat-search.html` | `chat/chat/chat-detail.html?id=<roleId>&hl=<messageIndex>` | Return to chat and highlight the selected message index. |
| `chat/chat/js/chat-extras.js` | `chat/call/call.html?id=<roleId>&type=video` or `chat/call/call-ui.html?roleId=<roleId>` | Start video or voice call UI. |
| `chat/chat/chat-detail.html` | `chat/call/call-ui.html?roleId=<roleId>&type=incoming`; group call uses `call.html?id=<groupId>&group=1&type=voice` | Route role/group call presentation. |
| `chat/date/journey.html` | `chat/date/date.html?id=<roleId>&scene=<scene>&arrived=1&journey=<startedAt>` | Continue a completed journey in the offline story page. |
| `forum/forum.html`, `forum/forum-my-content.html` | `forum/forum-detail.html?id=<postId>`; optional `focus=comment` | Open a post or direct attention to its comment area. |
| `forum/post-create.html` | `chat/moments/moments.html?publishedPostId=<postId>` | Start the post-publication AI-reply flow in Moments. Source persists with `PhoneStorage.getMoments()/saveMoments()`; target reads with `PhoneStorage.getMoments()`, so the data domain is shared. |
| `games/js/cooking.js` | `chat/chat/chat-detail.html?id=<roleId>&cooking=1` | The game stores `maomao_cooking_pending_<roleId>` first; chat detail consumes it into a draft and waits for the user to send. |
| `novel/novel-detail.html` | `novel/novel-read.html?id=<workId>` | Open the selected work in the reader. |
| `worldbook/characters/js/characters-manager.js` | Entry with `from=contacts` → back to `chat/contacts/contacts.html` | Preserve the caller's return location. |

### Route-safety notes

- `id` is overloaded by design: role ID, group ID, forum post ID, and novel work ID are distinct domains. Never pass an ID from one domain into another without a verified caller/receiver contract.
- `chat-detail.html?vl=1` is an explicit manual test switch; do not turn it on globally based on this inventory.
- The post-create → Moments flow uses the same `PhoneStorage` Moments collection on both sides; preserve that contract when changing publishing or auto-reply behavior.
- This is based on direct static source matches, not a runtime crawl. It does not claim to enumerate every generated URL, dynamically assembled path, storage write, or navigation event.

## Not yet complete — GOV-002 follow-up

This document completes the first page-tree and launcher-entry inventory only. The following work remains OPEN:

1. Finish mapping parameters not covered by the initial static search, including custom parsers and dynamically assembled routes; verify callers/receivers by targeted source review and browser traces.
2. Complete the cross-page write map, including the flagged post-create → Moments storage-domain handoff and shared global APIs.
3. Verify each production app's shared dependencies and storage domains against current source.
4. Separate user-facing production pages from maintenance-only pages based on actual references and build/deployment behavior, not directory names alone.
5. Add tests/manual checks to the corresponding app rows once the call-site map is verified.

Do not mark GOV-002 complete until all five follow-ups are verified.