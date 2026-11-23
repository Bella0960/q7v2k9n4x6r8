# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## 2026-11-22 · ARCH-002 · Chat HTTP error body timeout

- Base: main `a5415d7e`. An HTTP error with an unfinished body left the chat request pending because the response branch disabled all timeouts before awaiting the body.
- The existing response timers now cover the error body. Normal HTTP error details and SSE output retain their existing contracts. No migration or storage change. Rollback is a code revert.
- The new Node regression reproduces the stall on main and passes with the fix. Focused and related Node checks: 175 passed, 14 failed, with the same 14 failures on main. Vite build and production asset checks passed (3/3).
- Browser and phone acceptance pending. The local Chromium process failed to start because the environment denied its socket operation. No merge or deployment.
- Follow-up under investigation: single-chat send admission before model preparation completes. Existing PRs #282, #318 and #364 already address separate storage and required-source protections.

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

## 2026-11-22 · ARCH-001 · Single-chat send admission

- Base: main `a5415d7e`. The reply lock was set after asynchronous gallery and vision preparation. A second send or retry could start in the same tab and hold a competing history snapshot.
- Hold the single-chat admission lock across the existing send turn, from entry through reply handling. A competing retry returns before changing its stored failure marker. Group follow-up scheduling stays on its existing path. No migration or schema change.
- Three new Node cases pass. Related Node suite: 58 passed and the same 10 failures present on main. Vite build and production asset checks pass (3/3).
- Local Chromium startup is blocked by the executor socket restriction. Main and this standalone branch do not contain the sealed QA release gates. Phone verification remains pending in the isolated QA integration.
- Related earlier patch: PR #373 for unfinished HTTP error responses. Subsequent single-chat checks: empty/marker-only provider replies and precise retry targeting. Group validation follows single-chat acceptance.

## 2026-11-22 · ARCH-001 / ARCH-002 · Single-chat P0 integration

- Based on main `a5415d7e`. Integrated the runtime and both log entries from #373 and #374.
- First HTTP/network and empty or reasoning-only replies mark the original saved user message as retryable. Invalid SSE payloads no longer render as text. Regeneration keeps the previous reply when the replacement is unusable, including when the page is hidden.
- Single-chat reads prefer the primary role history, with the legacy copy used only for an absent primary. A pending turn compares the primary bytes before saving and refuses stale writes. This optimistic check has no cross-tab lock and is not a transaction.
- Node: 210 passed, with the same 24 unrelated or pre-existing failures as main (204 passed on main). Vite build and production asset checks passed (3/3). Browser and phone acceptance are separate release gates.
- No data migration. Rollback is a code revert. The existing sealed QA mechanism targets its dedicated configured candidate and is independent of this main-based integration branch.
## 2026-11-22 · DATA-004 / QA-002 · Claude legacy quota patch adapted

- **Branch / PR:** `DATA-004/storage-failure-guard-20261122` · [Draft PR #395](https://github.com/Bella0960/q7v2k9n4x6r8/pull/395). Not merged, not deployed.
- **Source:** Reviewed the 2026-11-01 Claude offline Phase 0 patch archive; replaying all patches was rejected because the current repository had different test, service worker and memory code. The MemoryRecall boolean result was already fixed on main.
- **Modified:** `shared/js/phone/phone_storage.js` (minimal storage-write failure event + memory readback guard for silent drops), `chat/chat/chat-detail.html` (warning and save-before-summary-cursor guard), `worldbook/memory/memory.html` (checked save and captured role ID across async AI request), `package.json` and `tests/storage-quota-reliability.test.mjs` (focused Node tests).
- **Executed:** 11/11 V8-isolated test cases on fetched production modules using Node-like VM shims (not a Node runner); source checks for HTML guards. Syntax parsing: 9 chat and 3 memory inline scripts plus two shared JS modules. Reviewed current main mergeability (ahead-only) and overlapping open PRs #282/#318/#375; shared-file overlap requires follow-up reconciliation.
- **Not verified:** actual Node test runner, full Node regression, Vite production build, Chromium, Android or iOS. GitHub PR head has no CI status reported in current connector view. The test script is committed, but it has **not** been run through Node against a local checkout.
- **Preserved:** existing storage keys, chat histories, memories, worldbooks, role IDs, local/remote separation and current UI. No migration or production writes.
- **Next:** run `npm run test:storage:reliability`, relevant existing chat/storage regressions and `npm run build` in a trusted checkout or authorized public QA; fix failures; check against overlapping open PRs before merging. Do not use exhausted legacy private Actions.

- **Gate linkage (2026-11-22):** The new quota suite is now included in the **existing** `npm run test:chat:contract` command; no workflow added or triggered. Node, Vite and browser gates still NOT VERIFIED in this session (no current full checkout, sealed public QA candidates do not include PR #395).


- **2026-11-22 storage hardening:** Prevent damaged/non-array primary `chat_memories_<id>` content from being overwritten; reject invalid memory targets; stop memory-library delete, dedupe, and AI merge success displays when write fails; capture AI-merge role ID before network await. Added the corresponding regression tests. **16/16 V8-isolated production-module/DOM-contract checks passed** (not full Node). Parsed all changed JS/inline scripts successfully.
- **Verification handoff:** PR source remains unmerged; next QA must use the exact pinned branch SHA and the existing public-only verification channel. Do not run exhausted legacy private Actions or bypass existing safety guards.

## 2026-11-23 · APP-LIBRARY-001 · 阅读应用首轮核查与写入可信性

- **分支 / PR：** `APP-LIBRARY-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `library/library.html`（1944 行单文件）。依赖 `native-feel.js`、`phone_storage.js`、`phone_api.js`。设置键 `maomao_reader_settings_v1`、背景图 `maomao_reader_bg_v1`、本地书 `maomao_reader_local_books_v1`、段评 `maomao_reader_comments_v1`（IndexedDB 优先，localStorage 回落）。
- **核查结论（源码级）：**
  - 角色接入：**已用正式角色 ID**。`getReaderRoles()` 走 `PhoneStorage.getCharacters()`，段评按 `bookId|chapterIndex|paragraphIndex|roleId` 建键，不会串角色。
  - AI 请求：读角色卡 8 个字段 + `getChatHistory(roleId)` 最近 8 条 + `getMemories(roleId)` 最近 5 条，字段级按角色隔离，可接受。
  - 本地书导入：`persistLocalBook()` 失败会 reject，`confirmImportedBook` 有 try/catch 与失败提示，且失败时不 `books.unshift`——链路正确。
  - 段评写入：IDB 优先、localStorage 回落，结构与键正确。
- **P1 已修（本 PR）：**
  1. `saveReaderSettings()` 的 `setItem(READER_SETTINGS_KEY)` 是空 catch：拖滑杆、换底色时界面照变，写入失败无任何提示，刷新后静默回到旧值。改为返回布尔，失败时本会话只提示一次（避免拖滑杆刷屏）。
  2. `saveReaderComment()` 在 IDB 不可用且 localStorage 也满时，会把原始 `QuotaExceededError` 抛给调用方，用户看到的是英文异常名。改为抛出可读文案「本机存储空间不足，这条段评没能保存」，且失败时不写入 `commentCache`（不会看起来已保存）。
- **测试：** 新增 `tests/library-storage-trust.test.mjs`（9 项，VM 跑真实 `saveReaderSettings` / `saveReaderComment`），9/9 通过；内联脚本 `node --check` 通过。
- **登记未做（需产品决策，不在本 PR）：**
  - **没有阅读进度记忆**：全页无 progress / lastRead 之类字段，退出阅读器再进来只能从章节开头开始。属功能缺口，需产品确认要做「记忆阅读位置」还是「每次从头」。
  - 不产出也不读取世界事件，`ECO-LINK-002` 前不自建。
  - 世界书未接入（共享 `PhoneContext` 仍不安全，#428 已证），保持只读角色卡 + 记忆 + 近期聊天。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额与 IDB 被禁用场景。

## 2026-11-23 · APP-DIARY-001 · 日记应用首轮核查与写入可信性

- **分支 / PR：** `APP-DIARY-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `diary/diary.html`（1311 行单文件）。依赖 `native-feel.js`、`phone_storage.js`、`phone_api.js`。文字键 `maomao_diary_entries_v1`（照片单独存 IndexedDB，`persist()` 写盘前会剔除 `photo/photos`），另有 `char_peek_enabled` 与 `char_last_wrote_<roleId>`。
- **核查结论（源码级，正向确认）：**
  - `saveEntry` 已经做了完整事务：文字写失败回滚新条目或还原 `oldSnapshot`；照片写失败再回滚一次并 `persist()`，提示「已回滚到上一版本」。
  - `deleteCurrent` 写失败会 `entries=entriesBackup` 并提示，失败时不清照片。
  - 角色接入：`diaryCharacters()` 走 `PhoneStorage.getCharacters()`，`peekCurrentRole()` 优先用 `getCurrentContactId()`，角色 ID 是正式的。
  - 角色批注按 `characterId` 记录，角色自动写日记按 `author` 标记，不会把 A 的内容算到 B 头上。
- **P1 已修（本 PR）：**
  1. `maybeAutoWriteCharEntry()`：`entries.push(entry)` 后 `if(persist())` 失败不回滚 → 下次任一成功保存会把「没存上的角色日记」补写，还可能刷新出重复内容。改为失败即 `entries.pop()` 并 return。
  2. `maybeAutoPeek()`：`live.charComments.push(...)` 后失败不回滚 → 批注留在内存并可能被后续保存补写。改为失败即 `pop()`。
  3. `togglePinned` / `toggleFavorite`：原地改标记后失败不回滚，界面上「已置顶」与失败提示自相矛盾。抽出 `toggleEntryFlag(id, field)`，失败时把标记与 `updatedAt` 一起翻回去并明确提示。
  4. `char_peek_enabled` 开关：`catch(err){}` 空吞 → 开关视觉上切过去了，刷新又恢复。改为检查写入结果，失败时不切换并说明原因。
- **测试：** 新增 `tests/diary-storage-trust.test.mjs`（9 项，VM 跑真实 `persist` / `toggleEntryFlag` / `maybeAutoWriteCharEntry` / `maybeAutoPeek`），9/9 通过；内联脚本 `node --check` 通过。
- **登记未做（需产品决策）：**
  - 角色的自动日记（`author` 标记）与自动批注在首页是**混排展示**，不按当前角色过滤。看起来是有意设计（「Char 往本子上写」），但若产品要求「只看当前角色」，需要加过滤，涉及旧数据语义。
  - 角色自动批注会挑任意一篇未批注日记（不限 `author`），A 角色可能给 B 角色写的日记批注。
  - 不产出也不读取世界事件，`ECO-LINK-002` 前不自建。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额与 IndexedDB 被禁用场景。
