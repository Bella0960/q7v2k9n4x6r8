# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

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

## GROUP-UI-002 · 群聊资料页视觉重构（2026-11-19，独立开发分支）

- **Owner requirement:** 私聊资料页与群聊资料页要做成两种不同结构；先群聊，吸收 QQ/微信和用户截图/旧视频的美感及交互；原功能全部保留。私聊、聊天加号菜单和首页布局本轮不修改。
- **Branch:** `task-GROUP-UI-002/editorial-group-profile-20261119`（base=current main）。
- **Changed paths:** `chat/chat/group-profile-ui.css`、`chat/chat/group-profile-ui.js`、`chat/chat/chat-settings.html`（仅挂载两项资源）、`tests/group-profile-ui.test.mjs`、`tests/group-ui-collapse-invite.test.mjs`、`tests/group-chat-invite-e2e.test.mjs`（现有测试适配外层折叠）。
- **UI behavior:** 群聊顶部独立可上传封面 / 恢复默认、标题/人数、紧凑成员横排和邀请快捷入口、少量快捷操作；既有群资料、公告、成员管理、玩法设置及其他对话设置均保留在分类折叠里。私聊模式不会安装群聊视觉布局。
- **Storage:** 用户封面按群 ID 使用已有 `maomao-media-store` v2 的 `wallpapers` object store，存储键 `chat_group_profile_cover_v1_<groupId>`。写入使用 IDB 事务完成回调，失败明确提示；不写入 `phone_groups` 或新增大图 localStorage key。聊天背景键保持不变。无需迁移现有群记录。
- **Validation:** GitHub 只读源码静态校验 7/7 PASS（挂载、群模式守卫、原控件 ID、只写 IDB、两组旧测试已适配、新测试存在）。`node --test tests/group-profile-ui.test.mjs`、`npm run test:group:ui`、`npm run test:group:invite-e2e`、`npm run build`、实际 Chromium 375/390/430 视口及 iOS/Android 真机 **NOT VERIFIED**（无仓库本地执行环境，不能声称通过）。
- **Integration conflict:** PR #298 也编辑了 `chat/chat/chat-settings.html`；已在 #298 评论提示文件交集。禁止以本分支覆盖群治理逻辑；先协调冲突并验证。遵守 QA #299 冻结，未推送 QA/main、未部署。
- **Known gaps:** 群解散时独立封面的自动清理尚未接入原解散操作，后续需要无损清理并覆盖回归测试；浏览器实际视觉与动效未验收。接下来只在这一路径完成验证/修正，私聊资料页开独立任务。

### GROUP-UI-002 本轮续修（2026-11-19）

- **完成在原开发分支上**：封面选择/恢复默认进行中的写入互斥；失败后读取原有封面以避免预览空白；新的图片检测明暗按版本避免旧异步结果覆盖；群聊独立去掉假状态栏并缩小头部空白；对上传照片使用局部轻薄标题衬底保证可读性。
- **测试代码补充**：`tests/group-profile-ui.test.mjs` 新增隐藏假状态栏、紧凑顶栏、上传互斥/错误恢复的源契约检查，并保留原有 375/390/430 视口及群聊邀请/封面隔离的浏览器测试用例。
- **本轮核对**：GitHub 源文件结构静态检查 9/9 PASS；这不是运行 `node --test`、Playwright、构建或真机验证。后者仍 **NOT VERIFIED**。
- **QA 发布门槛**：继续严格使用现有唯一 `https://preview.mao520.com`。需先完成真实浏览器验证、整合 #298 对 `chat-settings.html` 的并行修改、协调 #299 QA 解冻并通过定向回归；不可创建第二个测试地址或提前声称 QA 已更新。

### GROUP-UI-002 视觉与成员交互续修（2026-11-19）

- 群封面无图片时展示现有群头像；无群头像则展示已有成员照片拼贴或群名首字，避免空白灰块。群封面上传后隐藏该标识，避免遮挡用户照片；2/3/4 张成员照片拼贴布局分别处理。
- 顶部成员列表中的头像改为可键盘操作的按钮，点击展开原 `gpManageCard` 并定位同一个 `data-mid` 成员行；仅导航/高亮，不写成员、角色、消息或身份数据。快捷邀请仍使用原 `gpInviteToggle` 和 `defaultGroupMember`，未复制既有表单或保存逻辑。
- 首次无封面显示「上传封面」，保存后「更换封面」，恢复默认后「上传封面」。折叠内容加入 0.2 秒轻微入场；尊重 `prefers-reduced-motion`，不引入额外图片或颜色。
- 在原 `tests/group-profile-ui.test.mjs` 增加：顶部默认图标与文案、成员卡片点击进入原管理面板、点击前后 `phone_groups` 字符串一致、封面上传→跨群查看隔离→重开→恢复默认→IDB 对应键清理等断言。这些是**新增测试源码，尚未执行**。
- 由于 PR #298 正在更新群治理，原 `chat-settings.html` 的新 UI 挂载点仍等待与 #298 统一集成；没有更新 QA #299、正式版或其他测试域名。
- 本轮验证状态：GitHub 远程源代码已读取/写回；可用完整本地仓库/浏览器环境未提供。Node、Playwright、build、375/390/430 真浏览器与真机 **NOT VERIFIED**。不得将静态代码检查称为自动回归通过。
