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


## Owner task — role worldbook binding reconciliation (2026-11-19)

- **Task:** CHAT-WORLDBOOK-001; branch `CHAT-WORLDBOOK-001/binding-sync-20261119` from `main`; draft PR only.
- **Observed root cause in main:** character editor binds `worldBookIds` on `ai_custom_characters`; chat settings independently stores `chat_worldbooks_<id>`; chat-detail private-chat path did not filter books by either; group path previously keyed by group ID only; PhoneContext consumed all books.
- **Fix on isolated branch:** added `shared/js/phone/role-worldbook-bindings.js` to read/merge both legacy references and explicitly save matching values with readback and failure rollback. Both existing pages load it without UI redesign. Chat/detail/PhoneContext filter the selected role; group turns use speaking member plus explicit group mounts. Old array and `{ worldbookIds, enabled }` forms are supported, including `enabled:false`.
- **Data safety:** no new persistent keys, no automatic destructive migration, no character or worldbook ID rewrites, no chat/message/secret/backup changes. Only an explicit save mirrors both existing keys. A corrupted old binding aborts write; chat prompt construction stops before the AI request rather than silently sending incorrect lore.
- **Verification actually executed:** GitHub connector fetched edited branch source; isolated V8 execution of the actual bridge + PhoneContext with synthetic localStorage and roles verified role-only/legacy-only/conflict/clear/disabled/group/storage failure/role isolation and prompt content. Earlier 18/18 and final 17/17 checks passed; changed chat pages' inline scripts, manager and PhoneContext parse. New Node tests are checked into `tests/role-worldbook-bindings.test.mjs` and included in `test:chat:contract`; **Node CLI was NOT RUN**, full `npm ci`, Vite build, actual Chromium/UI clicks, Android/iOS devices, real API calls and unified QA are **NOT VERIFIED**.
- **Integration:** maintain the single frozen QA #299, preserve newer AI pre-send/persona fixes there, review conflicts by file and hand off this branch for inclusion; no direct push to #299, no merge to main, no deployment of production or QA in this checkpoint.
- **Next proof:** run `npm run test:chat:contract` and `npm run build` in checkout with dependencies; test 375/390/430 UI role edit -> chat settings -> save -> refresh -> back, and the reverse; test group selected member and disabled/malformed data; capture final system prompt via synthetic local model (no billable API) and verify actual Android/iPhone; integrate into the single QA process only after passing checks.


### CHAT-WORLDBOOK-001 第二轮回归补强（2026-11-19）

- **发现并修复**：上轮按绑定筛选会使未显式设置挂载的老角色失去原先自动加载的全局世界书。现在只在没有 `chat_worldbooks_<id>` 明确设置时，把仍启用且 `scope !== 'local'` 的世界书作为可见的默认勾选；显式保存任何选择（包括空数组）后不再自动恢复全局书。对话设置明确清空优先于旧角色字段，避免“取消后又出现”。
- **保存安全**：两个界面的选择列表不再在渲染时过滤/销毁暂时找不到的绑定 ID；原有书丢失/重新导入时保留引用并给出提示。写入顺序先小的挂载键，再整份角色资料；大数据配额写入失败时自动恢复小键，减少角色资料回滚失败风险。恢复时跳过内容未变化的键。
- **跨应用一致**：`phone_context.js` 在未加载桥的旧页面中，同样遵守老角色全局默认与显式空挂载的规则；群聊使用实际本轮发言成员＋群显式挂载，不直接读全站局部世界书。
- **本轮在当前 GitHub 分支源码执行的检查**：隔离 V8 的模块/页面脚本解析＋角色上下文、全局/局部、显式清空/刷新、隔离共 **25/25 通过**；从真实对话设置脚本提取事件处理片段进行模拟 DOM 点击/保存/重进＋角色编辑器绑定渲染共 **14/14 通过**；额度不足、静默写入拒绝、损坏数据、失败回滚共 **5/5 通过**。这些是代码执行与模拟 DOM，不是原生 Node runner/真实 Chrome/手机。
- **可重跑的回归已提交**：`tests/role-worldbook-bindings.test.mjs` 扩展全局默认、显式清空和两种配额失败用例，新增从实际 `chat-settings.html` 提取事件处理逻辑的交互测试；纳入 `test:chat:contract`。该 Node CLI 测试、`npm run build`、375/390/430 真浏览器、Android/iPhone、真实 API/唯一 QA 仍 **NOT VERIFIED**。
- **PWA 整合注意**：新增桥脚本 `shared/js/phone/role-worldbook-bindings.js?v=20261119a` 需进入最终唯一 QA 的 PWA 缓存清单和版本更新。由于 QA #299 使用不同的账号安全 SW 基线，**不能用这个 main 基础上的旧 sw.js 覆盖 QA**；由唯一整合窗口按 QA 当前版本增量纳入，不单独造第二个测试域。
- **治理边界**：只修改原 #307 草稿分支，未改 main、正式 Worker 或账号数据库；#299 继续冻结直接写入，整合后统一更新 https://preview.mao520.com。


### CHAT-WORLDBOOK-001 第三轮：跨页覆盖与失败重试（2026-11-19）

- **实际复现的回归风险**：编辑角色档案时若另一个页面已经保存新世界书绑定，旧编辑器随后保存人设会把更新后的绑定覆盖回去。修复为：保存角色前重新读取绑定；本页未改世界书则保留外部最新绑定并回显；两边均改动且不相同时阻止保存、保留草稿并明确提示，不假报成功。旧 ID 匹配继续用字符串转换，其他人设字段不做重构。
- **AI 请求失败真实可见**：聊天世界书读取现在即使 `phone_worldbooks` 未创建也检查挂载键，异常时停止在 `PhoneStream.chat` 之前；已落库的本轮用户消息标记 `sendFailedReason='worldbook-read'` 并通过现有重渲染/一键重试机制反馈，避免出现正常外观却没有角色回复的消息。contextOnly 重试仍指向原消息，不重复添加用户消息；新增对应失败提示文案。
- **本轮确实执行的代码级模拟**：从当前 PR 分支提取实际 `handleSaveRole` 执行，合成两页面角色绑定变更、旧编辑器保存和冲突回滚，7/7 通过（首轮模拟曾因错误假设所有无 scope 的测试书是局部导致 1 项测试夹具误判，纠正为真实 `scope='local'` 后通过）；从聊天详情当前实际世界书上下文代码提取执行，正常私聊、损坏挂载、缺失书列表、坏 JSON、群角色＋群挂载、重试重标记 6/6 通过；变化页面 JS 解析成功。新增两项可执行的 `tests/role-worldbook-bindings.test.mjs` 回归源文件，文件可解析，但原生 Node runner 未执行。
- **上线门槛尚未通过**：Node 原生测试、完整 Vite 构建、Chromium 点击/真实 API、Android/iPhone PWA、#299 唯一 QA 合并/部署均 NOT VERIFIED。此前的 JS 模拟不冒充端到端验收。严禁触碰正式版、账号安全与冻结 QA #299。
