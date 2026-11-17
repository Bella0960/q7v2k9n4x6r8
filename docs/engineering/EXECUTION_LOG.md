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


## 2026-11-16｜群聊秘密游戏/接龙记忆专项接续（原 PR #298）

- **当前任务**：按用户授权继续「接龙/游戏可扩展接口、秘密私聊规则、群聊长期记忆」，沿用原任务 `feat/group-governance-extensibility-20261115`，状态 **开发中**。关联 `ARCH-001`（抽离群互动）、`SEC-001`（隐私与访问边界）、`QA-002`（保存失败回滚/幂等测试）；不占用其他专项文件所有权。
- **代码进度**：修复流式气泡和 pagehide 未完成快照可能暴露 `[游戏私聊]` / `[群私聊]` 内容的问题，支持跨行/未闭合标记清洗；损坏的游戏公开状态使角色生成/私聊 fail closed；`MemoryRecall` 群公开召回再过滤 `role_only/private` 可见性；主持人的单角色游戏私聊与只读自身对话列表；禁止私聊对局期间阻止单角色私聊绕过；私聊动向存储失败可通过同一事件 ID 补记且不重复投递。
- **本轮实际代码**：`shared/js/phone/group-game-session.js`、`shared/js/phone/group-game-panel.js`、`shared/js/phone/memory_recall.js`、`chat/chat/chat-detail.html`、`chat/chat/group-play.html`；测试 `tests/group-game-boundary.test.mjs` / `tests/group-social-settings-contract.test.mjs`；PWA `sw.js` v220；设计文档 `GROUP_SOCIAL_WORLD_MASTERPLAN_20261115.md`。
- **实际验证**：当前准确分支代码在连接器 V8 隔离环境 **38/38 检查通过**（仅 JS 执行与静态集成边界），不属于 Node/浏览器全功能测试。**NOT RUN**：`npm ci`、`npm run test:group:governance`、`node --test tests/group-game-boundary.test.mjs`、`npm run test:group:ui`、`npm run test:chat:contract`、`npm run build`、Playwright、Android/iPhone 真机、唯一 QA 环境。不要误报完成。
- **兼容与回滚**：未改 `phone_groups` / `chat_history_<id>` 格式及现有角色/群 ID，未触碰生产账号和钱包；新局使用版本化独立临时键；正式发布前须验证备份排除敏感局数据与原有聊天回归。回滚只回退 PR #298 代码，不能擅自清理用户浏览器记录。
- **接续动作**：在具备本项目可执行检出与 Node/Vite/浏览器的既有隔离环境运行上面的准确命令；修复失败后给群主/角色各走一次实际游戏、禁私聊、私聊动向、结算、接龙完成回忆及刷新重进；再推进其他游戏模板和统一钱包接口。保持 Draft，无用户授权不合并/deploy。



## 2026-11-16｜PR #298 接续：游戏投票与安全取消

- **任务与文件所有权**：仍由当前群聊开发窗口接续主 PR #298 / `feat/group-governance-extensibility-20261115`，专项落在 `ARCH-001`、`SEC-001`、`QA-002` 的群聊扩展范围，不借机接管状态栏/钱包/发布工作。
- **实际改动**：`shared/js/phone/group-game-session.js`（每角色每局一票、私密选票/匿名进度、揭晓统计、取消与临时数据删除核验/重试）；`chat/chat/chat-detail.html`（AI 投票标记在公开回复保存后才提交、流式遮蔽）；`shared/js/phone/group-game-panel.js`（投票进度、揭晓统计、群主取消/重试）；`shared/js/phone/group-memory-events.js`（只在正式揭晓后记录可验证的投票结果）；`tests/group-game-boundary.test.mjs`（新增投票/存储失败/跨局/取消/清理合约）；`chat/chat/group-play.html`、`sw.js`（v222 缓存和脚本引用）。
- **兼容/隐私**：不删除原有 `chat_history_<groupId>`、不改 `phone_groups` schema、不改 `group_poll/group_chain` 数据形态；选票键沿用已有临时 `phone_group_game_private_v1_` 前缀并已在备份敏感键排除范围中。未揭晓的选票不会出现在公开对局或群长期记忆；删除失败不能伪报完成，取消后无效身份不会进入 AI 回复。
- **实际检查**：连接器隔离 V8 执行当前 PR 准确源码，**51/51** 行为与语法/引用检查通过；这不是完整 Node/Vite/浏览器环境。**NOT RUN**：`npm run test:group:governance`、`npm run test:group:ui`、`npm run test:chat:contract`、`npm run build`、真实浏览器及 Android/iPhone。没有依赖仓库 GitHub Actions。
- **继续顺序**：先在既有可执行隔离环境核对准确提交 SHA 与新增 Node 用例、修复任何实际失败；然后验收完整的开始→讨论→每角色投票→揭晓/取消→记忆→新局循环；继续开发群聊内结果呈现和主持人扩展。不合并 `main`，不改生产账号/数据/钱包。




## 2026-11-16｜PR #298 接续：结果卡进入原群聊天记录

- **原任务**：群聊社交世界扩展，沿用 Draft PR #298 / \`feat/group-governance-extensibility-20261115\`，不建立重复分支。对应 \`ARCH-001\`、\`SEC-001\`、\`QA-002\` 的群聊专项。
- **代码提交**：\`shared/js/phone/group-game-chat-receipts.js\`（真实系统消息投影、固定 mid 防重、旧数据兼容、失败保全、公开结果验证）；\`shared/js/phone/group-game-panel.js\`（揭晓/取消后写群聊、失败补发、重开局前补齐）；\`chat/chat/group-play.html\`（脚本接入、修正初始化先后）；\`chat/chat/chat-detail.html\`（结果卡渲染及 groupGame 元数据写后校验）；\`sw.js\`（v223 新脚本缓存）；\`tests/group-game-chat-receipts.test.mjs\` 与 \`package.json\`（加入原测试命令）。
- **兼容性**：仍写原 \`chat_history_<groupId>\`，没有另建消息库/账号/钱包。系统消息为 \`type:group_game_result\`、\`role:system\`、稳定 \`mid:m_game_result_<sessionId>\`。正式揭晓显示汇总票数、取消不泄露身份，长期记忆继续经原 \`GroupMemoryEvents\`。角色后续改群昵称不改变旧局的可信结果。
- **真实检查**：准确分支代码与已有测试用例在隔离 V8 运行：新结果卡 9/9、秘密游戏边界 25/25、群设置记忆 5/5，合计 39/39。**NOT RUN**：项目检出后的原生 Node 测试、Vite build、Playwright、实际 Android/iPhone、唯一 QA 环境。测试不依赖 GitHub Actions。不能将受控 V8 测试当作完整 QA。
- **待继续**：真实浏览器验证首次进入「游戏与活动」、群主进行一局并在群里看见结果卡、关闭/刷新后不重复、取消不显示身份、损坏存储显示补发、长聊天虚拟列表/聊天首页预览及 PWA 缓存更新。然后再推进角色主持人、更多小游戏及更完整的记忆事件。保持 Draft，未授权不合并 \`main\`、不触碰正式数据。



## 2026-11-16｜PR #298 接续：角色主持人可参与真实游戏流程

- **原职责**：继续群聊玩法 PR #298，依据 `ARCH-001 / SEC-001 / QA-002`。没有新建分支或重复 PR。
- **真实代码**：`shared/js/phone/group-game-session.js`（群主授权角色主持、玩家身份和主持上下文隔离、仅所有玩家投票后角色主持人可揭晓、群主优先权限）；`shared/js/phone/group-game-panel.js`（简洁主持人下拉、自动排除主持人抽坏人）；`chat/chat/chat-detail.html`（开局及全票后优先选主持人、隐藏揭晓标记、经过消息保存成功后才触发结果及记忆）；`shared/js/phone/group-game-chat-receipts.js`（公开结果保存主持人标识/历史名字）、`shared/js/phone/group-memory-events.js`（保存核验后的公开主持人经历）；`tests/group-game-boundary.test.mjs`、`tests/group-game-chat-receipts.test.mjs`（主持权限与隐私回归）；`sw.js`（v225）。
- **执行证据**：隔离 V8 通过以分支准确源码执行的 Node 风格测试主体，覆盖主持人无身份牌、无投票权限、非授权揭晓受阻、全票后结算、群主接管、保存后副作用、结果卡昵称变更和公开记忆。测试结果依最终本轮日志的回归数为准。**原生 Node runner、Vite、Playwright、手机/唯一 QA 未运行（NOT RUN）**，不依赖 GitHub Actions。
- **安全/兼容**：身份牌与主持人上下文仍按 session/role 隔离；原群消息、原角色数据、钱包和管理员 001 未修改。自动结算写入原历史后的逻辑仍需真实浏览器动态验证；若群聊写入失败，原游戏结果可由群主设置入口重试补发。保留 Draft，不合并或部署。

## 2026-11-17｜群聊第一批 QA 前的秘密私聊保护

- **原分支**：继续 PR #298，不新建 PR，不更新 #299、main 或正式版。模块修复提交 `e3cf3c55`，回归用例提交 `d3cd4f38`。
- **真实发现**：游戏私聊 `read()` 无法区分缺少键与 JSON 损坏；此前 `sendWhisper` 可能把损坏的收件箱当作空数组写回，造成已有私聊数据覆盖；AI/主持人读取也可能把损坏私聊误认为没有消息。
- **改动**：原 `GroupGameSessions` 新增只读、失败关闭的 `readInbox`，用于角色游戏上下文、私聊发送、群主收件箱及群主与单角色会话。缺少键仍返回空数组；存在但损坏/不可读的键返回 `CORRUPT_INBOX` 或 `STORAGE_UNAVAILABLE`，不写入、不给模型伪造无私聊的上下文。 `tests/group-game-boundary.test.mjs` 增加损坏 JSON、读取抛错、原始内容保留、角色/群主信息隔离用例。
- **核对方式**：已从 GitHub 读回最新源码与 PR HEAD，确认代码/测试已写入同一个 Draft 分支；未获得本会话完整仓库工作树，**NOT RUN**：真实 Node 新用例、`npm run test:group:governance`、群 UI/E2E、`npm run test:chat:contract`、`npm run build`、Chromium、Android/iPhone。
- **QA 整合阻塞**：目前原唯一 QA 整合分支 `integration/account-fanwai-stack-20261115` 不含 `shared/js/phone/group-game-session.js` 及 `tests/group-game-boundary.test.mjs`；#298 与 QA 分支历史明显分叉，不可整页覆盖其账号/PWA 安全代码。应只由唯一 QA 整合负责人按文件/逻辑移植，并先运行完整原生 Node、Vite、浏览器门禁，再通过既有 `scripts/qa-direct-release.mjs --qa-only` 发布到唯一 QA Worker。绝不直接发布 main/正式版。

## 2026-11-17｜群聊游戏验票修复与 33 项源测试回归

- **实际复现**：原 `voteFor` 只校验候选属于本局成员；异常的已保存票据 `voterId===targetId`（自投自己）会被计作有效票，群主提前结算甚至可能生成错误票数。这不符合原 `castVote` 严禁自投票的规则。
- **准确提交**：`639d4d4c` 在 `shared/js/phone/group-game-session.js` 的旧票读取层拒绝自投票与空/非正的时间戳；`a76f5f82` 在 `tests/group-game-boundary.test.mjs` 添加异常自投票、阻断继续投票/揭晓、原数据保留、群主安全取消、异常时间戳等回归。不改变合法选票格式或历史。
- **本会话真实执行**：直接用 GitHub PR #298 最新源码在隔离 V8 中先执行 **6/6** 私聊保护行为检查，再执行 **12/12** 验票与正常揭晓针对性检查；额外读取完整 `tests/group-game-boundary.test.mjs` 及其 9 份源码依赖，用 V8 兼容 `node:test`/`assert`/`vm` 夹具实际跑该文件 **33/33** 用例（包括新增两例），全部通过。**这些数字不是原生 Node runner，不是完整工程、浏览器/真机验收。**
- **QA 继续门禁**：从本 PR 最新 SHA 继续在现有 #299 分支安全移植并复跑原生 `npm run test:group:governance`、群 UI/邀请 E2E、`test:chat:contract`、`npm run build`、浏览器 375/390/430；通过后再经现有 `scripts/qa-direct-release.mjs --qa-only` 更新唯一 `preview.mao520.com`。现阶段**没有**声称群聊已在 QA 或正式版上线，#298 保持 Draft。

## 2026-11-17｜群聊交付收口 · 七套原测试 82/82

- **本轮目标**：用户明确要求尽快达到可宣布完整交付的程度。先冻结新增游戏种类，仅优先消除群聊现有功能的安全、正确性、整合与验收阻塞。
- **准确测试材料**：从 PR #298 当前 GitHub 分支读取七份原 `tests/*.test.mjs` 测试主体及其运行所需的准确源码，在独立 V8 中以兼容 `node:test` / `assert` / `vm` / `fs` 的受控加载夹具逐一执行：`group-game-boundary` 33/33、`group-governance` 8/8、`group-social-settings-contract` 5/5、`group-game-chat-receipts` 10/10、`group-turn-effects` 8/8、`group-turn-integration` 9/9、`group-private-receipt-recovery` 9/9；**合计 82/82**，涵盖本轮私聊收件箱损坏防覆盖与无效自投票修复。此前额外 6+12 条直接源码诊断检查属于重叠专项，不并入 82 计数。
- **证据严格区分**：这是原测试主体经隔离 V8 shim 执行，不是整仓 Node.js `npm run test:group:governance`、不是 `npm ci`、Vite、Playwright 或 Android/iPhone 真机。前期单项 V8 shim 的 `console` / `load` 桥缺失曾造成模拟测试错误，修正执行夹具后原七套均通过；不能将夹具错误当作生产功能失败。
- **仍未关门**：QA 唯一整合 PR #299 目前尚未装入 #298 群游戏源码，且与其代码历史分叉；同名 `chat-detail.html` / `sw.js` 有账号安全与其他并行成果，禁止无脑整页替换。没有完整 Codespaces checkout 和 QA 发布令牌的本会话，不能自行宣称完成原生 Node / Vite / Chromium / 真机/现网。真人云端群、云端离线主动群聊、钱包群红包的服务端跨设备事务、其他未实现游戏均不属于本批可宣布交付的已实现功能。
- **严格放行路径**：唯一 QA 集成负责人从 #298 取最新源码，仅对 #299 实际增量合并，先执行 `npm run test:group:governance`、`npm run test:group:ui`、`npm run test:group:invite-e2e`、`npm run test:chat:contract`、`npm run build`，然后完整 `npm run qa:release:check` 与 375/390/430 Chromium。群管理权限越权、群主/角色主持、私聊秘密隔离、保存失败、旧群历史、游戏结果重复刷新、PWA 缓存及账号隔离通过后，才经现有 QA-only 发布门禁在原 Worker 更新唯一 https://preview.mao520.com，手机验收后再宣布「本批群聊交付完成」。不自动发布正式版。

## 2026-11-17｜群聊交付级 bug：开局读回异常导致空壳对局

- **复现**：准确 #298 `GroupGameSessions.start` 旧源码，在公开游戏 key 的 `setItem` 已成功、但第一次 `getItem` 读回抛错的情况下，原实现返回 `SAVE_FAILED` 并**删除全部游戏身份牌**，留下 `status=active` 的公开游戏而没有角色卡，群游戏无法继续。
- **已修代码**：`ee6b1bae`，公开开局写入未被首次验证时重新核对存储：如果实际字节一致并可读，保留身份牌并确认开始成功；读回持续不可用则返回 `SAVE_UNVERIFIED`，保留身份牌供刷新后恢复，拒绝谎称成功；明确不存在新公开对局才清理本次身份牌。开局最终再次核实当前 session；结束游戏增加 `secret.groupId` 核验防跨群卡片进入揭晓。
- **已提交测试**：`22945d27`，`tests/group-game-boundary.test.mjs` 新增三项：瞬时读回异常恢复成功，持续读回异常保存原始身份牌可后续恢复，以及跨群身份牌不能揭晓。使用当前 Github 精确源码及受控 V8 `node:test` 兼容夹具实际执行 **36/36** 原测试主体；相关群结果卡套件 **10/10**。其余原 5 套 39 项在上一提交已通过隔离 V8，本次未改其模块。**完整原生 Node、Vite、Playwright、手机 QA 未验证。**
- **真实整合阻塞增加一项**：只读核对唯一 QA #299：`shared/js/group-governance.js`、`shared/js/phone/group-game-session.js`、`group-turn-effects.js` 等至少 9 个群聊运行模块仍缺失；`tests/group-game-boundary.test.mjs` 及 `tests/group-governance.test.mjs` 同样缺失，`package.json` 没有 `test:group:governance`，`scripts/qa-direct-release.mjs` 当前缺少显式群游戏门禁。QA 合入不得仅复制页面，需完整移植组装、引用版本、PWA 缓存及 Node/Chromium 验收门禁，避免测试脚本表面绿灯、群功能却不在版本里。大文件 `chat-detail.html`、`sw.js` 已与 #299 其他模块分叉，不能整体覆盖。
- **用户的完整交付标准未变**：只有合入唯一 QA #299、原生测试与浏览器验收通过、原 Worker 部署 https://preview.mao520.com 且用户手机验证后才可宣布这一批群聊交付。绝不未经验证触碰正式版。

## 2026-11-17｜群秘密标记泄密修复、PWA 更新与交付核验

- **实际复现**：原 `GroupGameSessions.redactPublicStreamText` 用最短匹配 `[...]` 删除秘密指令。若 AI 的 `[游戏私聊:...]` 或 `[群私聊:...]` 内容包含意外的内层 `]`，流式气泡和页面快照可能公开剩余机密文字，`processGroupInteractionMarkers` 的最终文本同样有风险。例：`公开推理[游戏私聊:r2:不能公开[注释]后半段秘密]` 原返回 `公开推理后半段秘密]`。
- **真实代码修复**：`1eed665e` 的群游戏公共流式遮蔽改为从首次秘密指令起删除整段后缀；`15d5a62d` + `53b994ac` 的原 `chat/chat/chat-detail.html` 在解析任何私聊/投票私有动作前核对隐藏指令必须是完整、无嵌套方括号、没有尾随普通文本的末尾 token。含嵌套/跨行/不明确后缀时不执行私聊副作用，直接清除整段；流式备用遮蔽与最终落盘也统一删除秘密后缀，避免仅修显示不修聊天历史。正常末尾的单条或多条合法私聊指令保持可用。
- **新增实际回归**：`c8192e4d` 在 `tests/group-game-boundary.test.mjs` 覆盖流式和隐私标记闭合情况；`03655662` 在 `tests/group-turn-integration.test.mjs` 验证公开文本、禁排队和禁落地私聊。同步 `sw.js` PWA 缓存 `v225→v226`，群游戏脚本查询版本 `game9→game10` 及相应页面、测试；旧回执契约测试的 PWA 版本断言也同步。
- **测试级别**：从 GitHub 直接读取原有七套 Node 风格测试和运行模块，在隔离 V8 兼容 `node:test`/`assert`/`vm`/`fs` 的夹具里逐份真实执行，**87/87**：边界 37/37、群治理 8/8、群设置/记忆 5/5、游戏结果卡 10/10、回合保存屏障 8/8、回合整合 10/10、普通私聊回执恢复 9/9。另检查准确群分支五个 HTML 页面（群消息、群设置、群管理、聊天列表、记忆空间）的 17 个内联普通脚本均通过 V8 语法解析；外部脚本/模块脚本没有据此宣称已执行。**均不是原生 Node/Vite/Playwright/Android/iPhone 的验收。**
- **仍未交付事实**：唯一 QA #299 尚未实际移植本群功能（9 个运行模块仍缺）；Cloudflare 现有 QA Worker `maomao-aw-qa-20261114` 最后部署仍为 2026-11-16 21:19:39Z 版本 `597166f2-4e59-48d3-9046-10f517cd7dd0`。整合时要在 QA 自有 `sw.js` 缓存 `v241` 基础上递增，不能直接回退到本功能分支 `v226`；必须在 QA 发布门禁明确加入原生群治理+UI/邀请浏览器测试，不覆盖管理员 001、Push 或正式数据。唯一手机入口 https://preview.mao520.com，未通过真实发布与用户手机验收前仍不得宣布「群聊第一批完整交付」。

## 2026-11-17｜群权限与邀请关闭路径：保存抛错回滚、过期邀请可拒绝

- **复现**：从原 #298 的准确 `shared/js/group-governance.js` 执行 `GroupGovernance.apply({save(){throw Error('QuotaExceededError')}})` 和 `leave({save(){throw ...}})`，旧实现均抛异常且**保留错误的内存变更**（角色已被标记管理员 / 用户已退群），实际落库失败。修复提交 `1c1858b2`：统一捕获保存回调异常，返回 `SAVE_FAILED`，回滚群资料，并且不提前触发治理/退群事件；保留旧数据格式。
- **复现**：角色主动创建的新群邀请仍 pending，但某候选角色已删除时，旧 `resolveInvitation({accept:false})` 因 `MISSING_ROLE` 拒绝处理；群已从 `phone_groups` 删除时亦然。修复提交 `6bb16814`：拒绝邀请只关闭该 pending 邀请条目，毋须验证已过时的角色或目标群；接受邀请仍完整校验候选存在且不重复入群。
- **新增额外边界**：`4b25791f` 允许在 `phone_groups` 读取格式异常时**仅拒绝邀请**，不触碰已损坏群数据；接收入群仍 fail-closed，禁止覆盖。回归 `bff37930`、`3b032ff8`、`e3ac8ea3`。
- **验证事实**：连接器从 GitHub 获取的最终原测试主体 `tests/group-governance.test.mjs`，隔离 V8 shim 实际运行 **11/11**（包括三项新回归）；此数字不是原生 Node。首次修复前另有直接真实源码复现，能观察到上述三种失败路径。此次仅修改原 #298 功能分支与原测试、日志，没有新建 PR 或向 QA #299 推提交。
- **阻塞现状**：同日只读核对 #299 HEAD `6521e43e` 尚未引入群模块；GitHub REST `mergeable_state=dirty`，但 `compare(base,qa-head)` 又显示 QA HEAD 基于当前目标分支额外领先 338 个提交，合并状态与祖先关系不一致，暂不推断为已确证代码冲突，要求 QA 负责人复核。QA 尚未完整 Node/Vite/Chromium + Android/iPhone 验收，原 Worker 未更新群模块，不能宣布交付或动正式版。

## 2026-11-17｜群游戏玩家名册损坏拒绝（交付数据安全回归）

- **原代码实际复现**：旧的 `GroupGameSessions.game()` 对从本地存储读取的 `session.players` 只验证 ID 格式，不检查重复玩家、最低/最高人数或非法用户 `__user`。将正常游戏持久化状态改为 `['r1','r1','r2']` 后，旧 `getPublic('g1')` 仍返回 `active`，可能使实际投票人数、主持人自动揭晓条件和结果统计失准。
- **修复提交 `6058d0ae`**：读取已有游戏时校验玩家 2–24 人、全部是有效角色字符串 ID、不含 `__user`、不重复，且角色主持人与玩家身份不得重叠。损坏记录 fail-closed：不返回有效对局、不允许新建覆盖，也不删除原身份牌；新开局从遗留群成员列表中排除 `__user`，保留原用户参与渠道。
- **回归提交 `41955e0e`**：测试重复成员、非法 `__user`、数字玩家 ID、单人、超过 24 人、失败后完整保留公共旧数据和私有角色身份牌，以及新游戏过滤遗留用户条目。
- **本轮精确验证**：从 #298 当前 GitHub 源码执行七份原 `tests/*group*.test.mjs` 的测试主体，隔离 V8 `node:test` / `assert` / `fs` / `vm` 兼容夹具结果 **92/92**：秘密边界 39/39、治理 11/11、五分类记忆 5/5、游戏聊天回执 10/10、回合保存屏障 8/8、回合整合 10/10、私聊回执恢复 9/9。**这不是原生 `node --test`、`npm run build`、Chromium 或手机验收；不得当作完整交付。**
- **当前关键依赖**：唯一 #299 HEAD `6521e43e` 仍无这批群游戏模块；QA Worker 仍是 2026-11-16 21:19:39Z 部署版本 `597166f2-4e59-48d3-9046-10f517cd7dd0`。当前容器仅有 Node 22 和空工作目录，**没有 MAOMAO 完整 checkout**；GitHub/Cloudflare connector 可读写 repo/API，但不可替代本机完整 Node/Vite/浏览器/移动端交付门禁。遵守多窗口代码所有权，不越过 #299 QA 集成窗口直接改 QA 分支。正式生产无改动。
