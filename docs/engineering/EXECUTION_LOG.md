# MAOMAO Execution Log

## MUSIC-UI-001 · 2026-11-17｜继续原 PR #303：可恢复本地音乐管理

- **范围与纪律：** 仅修改 `task-MUSIC-UI-001/lightweight-player` / 原 Draft PR #303。没有创建 PR、触动 QA #299 / 其整合分支、main、正式环境、数据库或身份服务。
- **实际功能：** 原音乐页隐藏“歌曲操作”下新增「管理已导入歌曲」，提供已导入歌曲重命名、移出曲库、恢复。移出是 `music_local_tracks` 现有记录上的**可选 `hidden:true`**，是软移出；**不调用 `deleteAudioBlob()`、不删除 IndexedDB 音频**，也不改变歌曲永久 ID、播放历史、收藏、歌单、歌词或封面资产的原引用。旧记录无 hidden 字段依然默认可见，恢复时删除该可选字段。原音频真实缺失时仍需按照既有缺失处理，不能宣传已恢复音频。
- **数据约束：** 读到损坏或重复的旧元数据时拒绝改写。更改记录先调用原 `saveLocalTracksMeta()` 并进行 readback 校验，成功后才更新内存曲库、页面与发出带 `binaryDeleted:false`、`savedLocal:true` 的版本化 `maomao:music:local-library-changed` 事件。配额/写入失败不更新 UI、不发假成功事件。输入名称必须是 1–100 字，无控制字符。
- **播放安全：** 软移出当前歌曲时会暂停并关闭音频 URL，播放器安全回到未播放默认曲目；软移出任何歌曲都会使正在等待中的异步 `playTrack` 请求失效，防止过期回调选中已移出的曲目。重命名/恢复只刷新源引用与内容列表，不复制二进制。管理 UI 保持极浅灰、无额外底栏。
- **实际提交：** `2573d937718a9246ece944c378eee8fe5eb1df19` 新功能，`18635e55c9fe37f0b4f45d619993cf7c772bb2b5` 并发竞态修复；`c5ae6d8407dbe2a99c6f755edb16c58d3ee5d951` 两个 Node 回归用例；`470080845dbe4826568e8e9bf5f89d528bb82b49` Chromium 步骤；`0f98fa913a525833d89fdaada328bb8e8da35dec` 存储兼容说明。
- **验证级别：** GitHub 原始生产函数隔离 V8 运行 **12/12** 本地管理场景通过（软移出当前曲、恢复相同 ID、失效回调令牌、保留二进制引用、配额失败、损坏目录等）；新增两个 Node 回归片段经隔离 V8 执行 **2/2** 通过，音乐内联 JS 与 Chromium 脚本语法解析 PASS。**NOT RUN / NOT VERIFIED：** 全量 Node `node --test`、Vite 构建、Chromium 375/390/430、浏览器 IndexedDB 真实读写、Android/iPhone 真机、QA 部署。无需夸大为已验收。
- **后续：** 由 PR #303 原开发窗口继续音乐质量与导入功能修复；QA 现有整合流程结束后，由唯一 QA 窗口按 HEAD 和测试门禁整合 `music/music.html`、`tests/music-data-integrity.test.mjs`、`tests/music-mobile-browser.mjs`；不要重复建 QA 分支/PR，也不要合并 main 或部署正式版。


## MUSIC-UI-001 · 2026-11-17 用户截图反馈：播放详情整体过于靠上

- **实际截图问题：** 840px 左右高度，默认封面/标题/播放条全部靠近顶部，控制键约在上半屏，下半屏留下大块无意义空白。
- **已修改原 PR #303，未生成预览图：** `music/music.html` 仅在现有 `#npOverlay` 中增加一个包裹封面、歌词、曲名、进度和播放按钮的 `.np-main`；主区域采用垂直居中、弹性占高与独立滚动，不调整原有 ID/事件。封面从固定 126px 增至随高度调整的 156–184px；页面信息间距与进度控制重排；宽度保持轻量响应式。高度 <=690px 时缩小封面并允许纵向滚动，避免控制区被截断。
- **专项脚本增加检查：** `tests/music-lightweight-default.test.mjs` 保护结构、居中与矮屏回退；`tests/music-mobile-browser.mjs` 修正原先误将首页作为“播放器截图”的问题，需在真实打开 `#npOverlay` 后检查 375/390/430px x 844px 的布局重心，并新增 667px 机型按钮可达性与单屏截图检查。
- **执行证据：** 11/11 项基于最新分支源码的 JavaScript 语法/HTML 包裹配对与规则静态核对通过。**尚未在完整工程中执行 Node/Vite/Chromium，也尚未用真机验收。** 此次视觉反馈仍需用户在唯一 QA 手机测试后确认，不改正式 main、数据库、身份或生产部署。

## MUSIC-UI-001 / DATA-003 — 2026-11-16 · PR #303 (Draft, code checkpoint)

- **Owner / scope:** `Bella0960/MAOMAO`, existing branch `task-MUSIC-UI-001/lightweight-player`. Existing PR only. No new branch, no main merge, no QA or production deployment, no server data/administrator access.
- **Read before editing:** `AGENTS.md`, release & storage governance docs, `music/music.html`, `settings/js/backup.js`, `settings/js/backup-modules.js`, `shared/js/phone/storage/media-repository.js`, role/chat ID lookup code, PR #301 music statusbar patch and PR #273 music favorites patch.
- **Changes pushed to original PR:** shallow light media UI carried forward; real IndexedDB per-song audio remains in `maomao-media-store.audio`. Local audio metadata writes now fail visibly, rollback only a newly imported blob on failure, and keep existing song IDs/favorites even if audio is temporarily absent. Current music cover/background upload uses existing `maomao-assets` Blob repository with scoped owner references. LRC/TXT lyrics, simple playlist IDs, light default and hidden settings added without overwriting old local music keys. Music player reports real HTMLAudioElement playback state, not fake listening.
- **DATA-003:** full audio Blob backup is now requested with 30 MiB/entry and 90 MiB/store limits, atomic exclusion on partial errors, archive completeness per referenced local ID, import guard against old metadata-only archives. Backups missing referenced cover/background blobs also explicitly flag incomplete and block automatic restore. Music-only scoped archives containing cover/background references cannot yet include only those referenced `maomao-assets` bytes: they correctly report **incomplete**; targeted selective media export is unresolved.
- **Role bridge (partial):** role picker resolves real `ai_custom_characters[].id`; invite is only `queued_local` (`delivered:false, accepted:false`), and native audio state has `roleJoined:false`. **No AI/role acknowledgement, cross-device synchronized playback, cloud autonomous invitation, chat dialogue insertion, or shared memory acceptance.** These must not be represented as shipped.
- **Added tests (not executed):** `tests/music-data-integrity.test.mjs` (12 Node test cases); `tests/music-mobile-browser.mjs` (real isolated Chromium + Vite preview, 375/390/430px, local WAV/Blob restore, cover, LRC, playlists). Existing `tests/music-lightweight-default.test.mjs` still present.
- **Actual execution evidence:** GitHub connector successful file reads and content-API commits only; source-level anchor checks during modifications passed. The current runtime has **no complete MAOMAO checkout** or installed project dependencies; therefore full `node --test` / `npm run build` / real Chromium 375/390/430 / Android and iPhone / real export-restore **NOT RUN / NOT VERIFIED**. Do not conflate committed tests with test results.
- **Required local work before single QA:** on a complete working tree run `node --test tests/music-lightweight-default.test.mjs tests/music-data-integrity.test.mjs tests/media-backup.test.mjs tests/backup-modules.test.mjs`, `npm run build`, `node tests/music-mobile-browser.mjs`; repair any real failures; verify music-specific full and scoped restore without destroying existing user data; reconcile PR #301/#273; integrate with existing character/AI/chat/long-memory/autonomous delivery; then deploy **only** to the existing isolated QA with explicit release gates. Keep PR Draft until verified.


This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.


### Continuation checkpoint — 2026-11-16 · same PR #303

- **DATA-003 hardening pushed:** `settings/js/backup.js` now excludes audio-store records missing their original Blob, and explicitly preflights imported audio (including legacy archives missing a catalog) and referenced music image Base64 before the restore path can clear IndexedDB. This is a fail-closed protection, not a claim that arbitrary backups are byte-for-byte verified.
- **Existing regression alignment:** `tests/backup-modules.test.mjs` was updated for full audio Blob coverage; `tests/media-backup.test.mjs` now provides actual mock audio bytes + MIME and asserts exported Base64 instead of a metadata-only fixture; `tests/music-data-integrity.test.mjs` now contains 14 focused contracts with the shared-validator extraction fixed.
- **Native music fixes pushed:** on reload, the Play control reacquires the local audio Blob from IndexedDB (or sets an actual demo source) and restores the saved time where possible. Music statusbar now visibly follows the existing global setting and updates local time. Per-song user covers render without filters in recent/search/favorites via lazy, bounded objectURL cache; original shallow player remains. Cover reset immediately updates lists; BFCache return refreshes revoked thumbnail URLs.
- **Browser smoke script updated (NOT EXECUTED):** `tests/music-mobile-browser.mjs` now checks global statusbar hide/show, actual import/play on a temporary WAV, audio resumed from IndexedDB after reload, and uploaded-cover image in Recent at 375/390/430px.
- **Actual tests performed here:** production `backup.js` and the real inline music player script compiled as JavaScript without syntax errors (isolated V8); **10/10** synthetic storage/backup guard checks, **7/7** isolated lyric/metadata checks, and **5/5** later local-resume/archive checks passed on fetched production function text. These are meaningful isolated execution checks, **NOT** the committed Node test suite, Vite build, complete browser app, full binary export/restore, or phone acceptance.
- **Remaining blockers:** complete MAOMAO Node/Vite/Chromium test environment (no checkout in this connector runtime), real binary/MIME restoration and oversize scenarios, local custom-cover music-scoped backup dependency (currently correctly marks incomplete), verified remote AI/chat/memory/cloud ACKs and role autonomous invitations, original isolated QA deploy and dual-device acceptance. Keep PR **Draft** and production untouched.


## Current work package

- **Owner request:** Identify remaining MAOMAO work, start with low-risk items, and adopt end-to-end execution so the owner does not need to repeatedly say “continue”.
- **Task IDs:** GOV-001, GOV-004
- **Status:** IN PROGRESS
- **Working branch:** `GOV-001-autonomous-execution-and-doc-sync`
- **Base:** `main` at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`
- **Production safety:** No merge to main, no production deployment, no APK build/update, no secrets configured, no user data modified.

## Verified baseline — 2026-11-11

- Current main is `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- GitHub's recursive tree response is complete (`truncated=false`): 445 tree entries, 89 HTML pages, 112 JS/MJS files, 14 CSS files; tracked blob bytes: 95,744,389.
- Current `chat/chat/chat-detail.html` is 9,463 lines (remeasure before editing).
- `package.json` has multiple specific test scripts, but `npm run lint` is a placeholder that only prints a success string.
- GitHub Actions PR runs for PR #242 and PR #243 are failing. The job-log download returned BlobNotFound and no usable step summaries were available; exact root cause is **NOT VERIFIED**.
- Do not claim browser/device acceptance based only on static source checks.

## Open PRs requiring reconciliation (not automatically mergeable)

- #243 interactive desktop tutorial — PR description/source checks now report 50 step-by-step guides, 29 desktop-app guides and 10 FAQs; real-phone acceptance is not verified. Its latest Tutorial Guide Regression job still failed before any step executed.
- #242 chat beauty preview / chat layout — the unrelated top-right menu experiment has been removed from its branch; do not reintroduce it.
- #148 cloud push infrastructure; #239 server-side model and grouped outbound delivery depends on #148.
- #237 wallet corruption/data-integrity protection currently targets the cloud-autonomous branch as its base.
- Older task PRs include cross-platform CI (#215/#216), date-mode card transparency (#214), forum scroll fixture (#210), Home Indicator (#209), desktop widget-image persistence (#208), PWA cache refresh (#207), Actions trigger cleanup (#206), NPC social (#205), MCP center (#202), font loading (#200), contact groups/Moments (#199), friend chat/QR onboarding (#196/#198), avatar/sticker chain (#188–#192), chat theme package import/export (#187), earlier tutorial (#186), Fate Cabin (#181/#185), forum refresh atomicity (#180), role image preview (#171), and live Worker probes (#159/#160).
- Older PRs may be superseded by later merges or newer branches. Compare each against current main before rebase, cherry-pick, closure, or merge.

## Work completed in this checkpoint

| Item | Status | Evidence |
|---|---|---|
| Refresh CLAUDE facts against current main tree | REVIEW PR #244 | Page count, chat-detail line count, storage/Service Worker wording, `apps/settings` caution, tests/lint note |
| Refresh handbook tree metrics | REVIEW PR #244 | Computed from complete recursive GitHub tree |
| Add continuous execution protocol | REVIEW PR #244 | AGENTS.md, REMEDIATION_BACKLOG.md, AI_HANDOFF_PROMPT.md |
| Create durable cross-session checkpoint | REVIEW PR #244 | This file |

## Next actions

1. PR #244 is open as Draft; review is requested and no merge/deploy is allowed without approval.
2. Continue with GOV-002 read-only app/file/route ownership index, starting from the current 89-page main tree.
3. Inspect small, independent code PRs against current main before deciding whether to port them; do not rebase or merge stale branches blindly.
4. Audit CI-003/CI-004 and the recent failing-runner behavior; only then modify workflow/package scripts.
5. Proceed to data backup and chat work in dependency order after the read-only inventories.

## Resume instruction

On the next turn/session, read this file and the current `AGENTS.md` first. Continue from the earliest unfinished item above. Do not ask the owner to repeat the task or say “continue”; ask only for a genuine approval-boundary decision or missing requirement.


## Daily execution — 2026-11-11 (07:00 Asia/Shanghai)

### Verified repository state
- `main` remains at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`.
- 38 open PRs; 0 open ordinary Issues.
- Main now contains the multi-bubble/role-media integration commit `b8ac6cc077a5d40ac245469399e90a5565c4aede`, followed by role-scoped gallery image delivery at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`. PR #184 remains open and its branch is diverged (20 ahead / 16 behind); audit its residual diff before any merge/closure so the already-landed behavior is not duplicated.
- No PR met the required merge conditions in this run. No merge was attempted. PR #238 had already merged before this run at `aafe655342286fa7e68163a25a123228e726cd07`; its associated CI was also unable to execute steps, so the merge does not have verified CI evidence in this snapshot.

### CI and deployment evidence
- All eight latest main workflow runs for `f0cf6c7` (deploy, phone gesture, PWA navigation, chat regression, chat call, font runtime, takeout browser and performance gate) concluded failure. The inspected deploy/chat/PWA/performance jobs all have `logs_url: null` and `steps: null`; no build/test/deploy step was executed or reported. Deploy run #42918127727 is attempt 2.
- PR #243 has since advanced to head `d66d9b7a59b148cddfa13b1361497a07bf573b51` (`fix(test): repair newline in private-gallery tutorial assertion`). Its latest Tutorial Guide Regression run #42923116703 was retried once; the retry again completed as failure with `steps: null` and `logs_url: null`. No tutorial test step executed, so this is still an Actions execution blocker rather than a test result.
- PR #243's eight workflow runs and PR #242's latest workflow runs are failures without executed steps. Treat all related checks as NOT VERIFIED, not as code-test failures or passes.
- Cloudflare account read-only inspection shows Worker `mao` deployment `9ba47808-90b3-4d30-b133-6f0af373a1cc`, version `1a090b6e-1ba9-4661-a9d4-c3c7e2e64fa8` (version number 315), receiving 100% traffic; created 2026-11-10T22:50:38Z. Its metadata has no `workers/commit_sha` annotation. The timestamp is shortly after the main commit, but does not prove the deployed bundle is exactly `f0cf6c7`.
- The configured Worker URL is https://mao.miamor520000.workers.dev. A direct HTTP check from this execution environment could not resolve DNS, so live route availability was not verified here.

### Important branch and dependency findings
- PR #184 multi-bubble replies: 20 commits ahead and 16 behind current main; GitHub reports it is not mergeable. It remains open/Draft.
- PR #148 cloud push: 1,339 commits ahead and 5 behind main; GitHub reports it is not mergeable. It is a very large development stack and must not be merged as one unreviewed unit.
- PR #239 server-side model/grouped delivery is stacked on #148 and compares as 1,395 commits ahead / 5 behind main. Its own PR description says model-provider connectivity, Cloudflare scheduled execution and phone delivery remain unverified; the required server-side model secret is not configured.
- PR #237 wallet integrity work is also stacked on the cloud-autonomous branch; it is not an independent main-based fix.
- PR #244 remains Draft. PRs #245 and #246 are stacked on its branch; do not merge them ahead of the base dependency.
- PR #243 is not Draft, but its CI has not actually run and the phone tutorial/navigation flow has not been verified on a real device.

### Work performed this run
- Re-ran only the tutorial-specific failed workflow for PR #243 to check whether Actions runner allocation had recovered. The retry failed before steps began.
- Updated this execution log on the existing GOV-001 branch so the tutorial inventory and current CI/deployment evidence are no longer stale.
- No application code, secrets, user data, production Worker, or APK was changed.

### Next actions
1. Restore GitHub Actions runner/job execution and obtain real step logs; do not merge on empty/failed checks.
2. Reconcile #184 against current main after CI is available, then run chat reply/bubble regression and browser acceptance.
3. Break the #148/#239 cloud-push stack into reviewable milestones; configure the Worker model secret only through the protected Cloudflare secret mechanism after the user has selected/authorized the provider.
4. Verify the active Worker version against a recorded main SHA and perform a real external route/device check before calling production current.


## Owner task — complete remaining MAOMAO work (2026-11-11, 07:36 Asia/Shanghai)

### Current inventory and verified corrections
- Current main remains `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273`; GitHub search currently reports 38 open PRs and 0 open ordinary issues. Open PR count is not equivalent to outstanding feature count; several older branches are superseded or stacked.
- PR #242 (`fix/chat-theme-preview-and-layout`) is based directly on main. Its current diff contains the chat beauty preview, role-target normalization, CSS scope and chat list/detail layout adjustments. It does **not** contain the accidental top-right floating-menu experiment. The existing `#btn-more-menu` behavior was not changed by the current diff. The user's requested bottom composer "+" menu is a separate control and must not be conflated with it.
- PR #243 tutorial catalog covers 29 desktop apps and 50 guide records. Its contract test explicitly checks 11 FAQ entries and the 19 actual composer menu labels: 表情包、奔赴、重玩、位置、纪念日、旁白动作、直播间、音乐、语音通话、视频通话、发红包、转账、图片、语音、名片、送礼物、群投票、群接龙、群通话. Older notes saying 10 FAQs are stale. Tutorial browser/device acceptance remains NOT VERIFIED.
- PR #245 contains the forum-detail Home Indicator hit-target correction and an expanded Playwright test for chat/forum interaction, comment input, navigation, and overflow. The test has not executed in this environment; do not mark the fix accepted until its browser run/device check succeeds.
- PR #246 contains a source-verified inventory of 89 HTML pages and 28 unique launcher destinations plus two static links. It explicitly labels the route/storage cross-module mapping as partial and NOT COMPLETE.
- PR #247 audited only `apps/settings/`: its two legacy CSS files have no in-repo page consumers but are still copied into `dist`. No deletion is safe to claim; external static URL/production artifact behavior is not verified.
- PR #248 replaces the placeholder `npm run lint` with a no-dependency Node syntax checker and adds `test:lint`. It checks JS/MJS/CJS files and executable inline scripts in HTML. The commands have not been executed and CI integration is intentionally pending runner recovery.
- Recent workflow runs for PR #242, #243, #245, and #248 conclude failure with missing job logs/steps. These are NOT VERIFIED test results; available job data has no usable logs. Do not infer test failures in application code or green status.
- PR #148 cloud-push infrastructure remains a large non-mergeable stack; PR #239 server-side model and grouped bubble delivery depends on it. The Worker model secret is not configured, and live scheduler/push delivery remains NOT VERIFIED. Do not configure secrets or deploy without explicit owner approval.
- Multi-bubble and role-media behavior already has implementation on current main; stale PR #184 must be audited against main before any port/merge, not duplicated.

### Execution boundaries and next sequence
1. Keep the user-facing bottom composer "+" menu as the target for any future menu changes. Do not edit top-right conversation settings/menu unless separately requested.
2. Continue low-risk independent items first: review and reconcile GOV-001/004, GOV-002, GOV-003, CI-004, Tutorial, and HOME-INDICATOR-002. Keep stacked PR base dependencies intact.
3. Before changing storage, complete DATA-001/002/005 inventories and backup safety checks. Do not migrate or delete existing user data during this task without an explicit migration/backup approval.
4. Reconcile the already-landed multi-bubble/role-media path against older branches; then address contextual sticker/avatar behavior only where a concrete gap remains.
5. Break cloud-push work into small, reviewable milestones. A code-only PR is not proof of scheduled execution, server model response, OS push delivery, or two-device message persistence.
6. No merge to main, production deployment, APK update, Worker secret configuration, or destructive user-data operation without explicit owner approval.
7. This conversation cannot run after the chat/session is closed. Leave this checkpoint so the next session can resume without asking the owner to repeat the task.

### 2026-11-19 · MUSIC-IMPORT/RESUME-003 — real-experience path: import → play → reload → seek

**Original branch/PR:** `task-MUSIC-UI-001/lightweight-player` / #303. No new PR/site, no QA #299 direct push or production changes.

- **Observed source defect:** #303's file-picker gate only trusted `File.type`/`.mp3/.wav` extension, so Android SAF/drive numeric names and generic/empty MIME files were rejected or MP3 fallback incorrectly applied; #299's existing integration already contains a header-sniff implementation, so ported that narrowly to #303 to prevent a later older-branch merge regressing QA. Reused its first-256-byte WAV/MP3/M4A/OGG/FLAC/WebM resolver, explicit picker extensions and normalized `audioBlob.type`. Binary stays in existing IndexedDB `maomao-media-store.audio`; no new storage key, no unsupported file auto-transcoding, no duplicate audio store.
- **Visible import feedback:** count only songs that completed both audio Blob and metadata writes, display saved-song count, and explicitly distinguish successfully saved songs from blocked auto-play. Failed catalog write still rolls back only the just-created track and does not clear existing music/favorites.
- **Queue + filename safety:** imported songs may contain apostrophes, double quotes and HTML-like text. `renderQueue()` previously wrote raw names/IDs to `innerHTML` and built a single-quoted `onclick`, breaking playback and enabling markup injection. Escaped each display string with existing `musicSafeText` and serialized IDs via `musicSafeText(JSON.stringify(id))`, without modifying user metadata or queue behavior.
- **Resume:** old `togglePlay` restored local progress only when `audio.duration` happened to be finite immediately after `playTrack`, which could replace the last checkpoint with zero on slow mobile metadata loads. Added an in-memory role-independent per-track checkpoint, a guarded `loadedmetadata` seek with `playbackRevision`, cleanup on switches/failures, and `saveState` protection against overwriting the checkpoint with zero. No automatic playback upon page load.
- **Regression:** added `tests/music-import-resume.test.mjs` (12 Node test cases, real production source extraction for resolver/import/metadata seek/save/load/queue), extended `tests/music-mobile-browser.mjs` to import a numeric-name `application/octet-stream` real WAV and verify normalized IndexedDB Blob MIME at 375/390/430px; its earlier playback test now saves and checks an actual 3 s checkpoint after reload with a genuine 8 s WAV. Extended the Chromium smoke test to click a queue entry with a quoted/HTML-like filename and require exact song title without uncaught errors. Updated `tests/music-lightweight-default.test.mjs` for existing two-argument queue-aware `playTrack`. Added `npm run test:music:experience` command.
- **Actually executed:** current GitHub source in V8 isolated behavior fixtures: new tests **12/12 PASS** (two of these explicitly check persisted media records and metadata-delayed seek); default UI/source contract **4/4 PASS**; current music inline JS parses. Real headless Chromium with `page.set_content` executed a real 4 s WAV Blob on native HTMLAudioElement and confirmed `duration=4`, seek to `2.25s` and `playing=true`. A second native Chromium DOM test clicked a queued title with an apostrophe/HTML-like text, confirmed the exact imported track ID was passed and no injected `<img>` node appeared. These validate browser media/DOM primitives, **not** the full MAOMAO page. Container browser navigation to app/file/data URLs is blocked by runtime `ERR_BLOCKED_BY_ADMINISTRATOR`, so complete Vite preview, existing browser suite and Android/iPhone QA **NOT RUN / NOT VERIFIED**. Node `node --test` and full Vite build are also NOT RUN; do not claim test screenshots or actual `preview.mao520.com` delivery.
- **Critical QA integration:** #299 `integration/account-fanwai-stack-20261115` already contains a stronger file header resolver, music settings import entry, per-track cover picker and SW assets missing in older #303. Only port #303's new metadata-checkpoint, visible import feedback, escaped queue title/ID rendering and regression delta after diff; **do not copy the full older music/music.html from #303 over #299**. The only test URL remains `https://preview.mao520.com` (QA Worker `maomao-aw-qa-20261114`). Preserve current IDB audio, favorite, playlists, cover, hidden tracks and all existing user data.

### 2026-11-19 · MUSIC-PLAYBACK-ROLLBACK-004 — failed next-song must preserve the previously playing track

**Scope:** Existing original music branch/PR #303, incremental changes only. No QA #299 direct commits, main merge, new test site, production changes, or user-data migrations.

- **Found real defect in current source:** `playTrack(trackId, options)` immediately revoked `currentBlobUrl` and assigned new `window.audio.src` **before** `await window.audio.play()`. If the imported WAV/MP3 was damaged, source missing, or mobile autoplay denied, it returned `false` without restoring old `src`, audio time or old Blob URL. UI/queue still showed the old track but the media element pointed at the failed new source. Rapid overlapping switches could leave a speculative object URL behind.
- **Runtime fix:** `music/music.html` now retains the last confirmed `musicConfirmedSource` and old Blob URL until the next `audio.play()` resolves. Failed play/source assignment rolls back prior source and playback time, attempts to resume the old track when it had been playing, leaves queue/current track/history intact, frees the failed candidate URL and shows an actionable failure message. Revision-token checks prevent an older async attempt from resetting a later successful switch; delayed Android `loadedmetadata` can finish restoring old time. Explicit removal clears both confirmed and staged Blob URLs to prevent leaks. The existing media storage key, UI, cover, playlists, import and user records remain unchanged.
- **User-visible path:** import normal and corrupted audio → play a working local song → tap next song that fails to decode → previous track/title/queue/audio retained (no false play success) → a subsequent successful switch works and frees the old Blob → quickly select two songs without obsolete requests changing the result. All on original phone music UI; do not move controls.
- **Tests actually executed:** fetched current GitHub HEAD source, compiled and ran four groups in isolated V8 behavior fixtures: `tests/music-lightweight-default.test.mjs` **4/4**, original `tests/music-data-integrity.test.mjs` **24/24**, `tests/music-import-resume.test.mjs` **12/12**, new `tests/music-playback-transaction.test.mjs` **12/12**; **52/52 PASS total** and one current inline music JS parses. The 24 legacy test cases were genuinely rerun, not merely inferred; their outdated fixtures were corrected to reflect queue-aware `playTrack`, role-independent resume checkpoint and actual active playlist. This is **not** native Node CLI execution, Vite build, full Chromium MAOMAO page, Android/iPhone or QA publishing.
- **Future real-browser QA gate:** `tests/music-mobile-browser.mjs` has a new isolated Vite/Chromium step at 375/390/430: play a real WAV, try switching to a deliberately broken IndexedDB audio Blob, verify `playTrack` rejects, previous song ID/src/title unchanged, and previous Blob URL is still fetchable; remove the fixture afterwards. The script is committed and JS syntax-checked but full project Playwright/Vite browser suite is **NOT RUN/NOT VERIFIED**.
- **QA merge contract:** #299's current `music/music.html` contains newer import picker controls, correct header/MIME detection, track cover picker, statusbar/other integrations. Port only this `playTrack` rollback and confirmed/staged Blob management, `timeupdate` snapshot and dedicated tests **by function** to QA, and re-run Node/Vite/Chromium + user's phone; **do not overwrite the whole #299 HTML with #303**, do not trigger unrelated paid API/Actions or release production. QA URL remains `https://preview.mao520.com`.

### 2026-11-19 · MUSIC-PROGRESS-TRANSITION-005 — guard saved playback while an unconfirmed song is loading

- **Full user journey:** Continue a local WAV from an earlier checkpoint → start switching to a large, corrupt, or unavailable song → native audio emits `timeupdate`, `seeked`, or `ended` before `play()` confirms success → fail/roll back to last working track → background the app or close the page. Previously the tentative media element time (often 0 seconds) could be written under the *old track ID*, destroying a legitimate resume checkpoint, and an `ended` event during the transition could trigger an unintended queue jump. Mobile page suspension could also occur between five-second saves.
- **Implemented only in original #303 / `music/music.html`:** `musicPlaybackPending` starts only when swapping in the candidate source; `saveState()` and media-event handlers refuse to record/navigate during this transition, and clear that state after confirmed success, safe rollback, or explicit removal. When a subsequent failed request overtakes a pending remote or local source, rollback is invoked without depending on `musicStagedBlobUrl` (remote URLs have no staged Blob). The saved state is never cleared just because a staged source fired an event. On `document.visibilitychange` to hidden or `window.pagehide`, `saveState()` captures the last **confirmed** position without forcing playback to pause.
- **Tests:** New `tests/music-playback-lifecycle.test.mjs` exercises the actual production snippets with 8 cases: unconfirmed-state write suppression, real confirmed checkpoint, tentative timeupdate/seeked/ended isolation, unchanged confirmed media events, and mobile hidden/pagehide callbacks. Integrated in `npm run test:music:experience` beside original 4 music UI, 24 integrity, 12 import/resume, and 12 transactional playback tests. Re-fetched GitHub HEAD source and executed all five suites in isolated V8 source behavior harness: **60/60 PASS**, music inline JS parses (1/1). This is not actual native `node --test`, Vite build, full app Chromium, real Android/iPhone playback, or live QA deployment: all **NOT VERIFIED**.
- **Browser gate queued but not falsely claimed run:** `tests/music-mobile-browser.mjs` (375/390/430px) now checks real WAV after corrupt candidate rollback and dispatches a hidden-state lifecycle event to verify saved track ID/progress and unchanged paused status. Real full-app browser navigation remains unavailable in current container. No screenshot or real QA deployment created.
- **Integration:** Original #303 PR is still Draft; #299 owns the one and only `preview.mao520.com` testing deployment. QA contains newer music import/cover UI; **do not replace QA music.html wholesale**. Port only the playback pending-state guards, related background save listeners, previous verified rollback/progress behavior, and new test files by function. Keep existing IDB audio, favorites, covers, playlist selection, and local user records.
