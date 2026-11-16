# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## 2026-11-16｜PR #290 账号安全专项 · 恢复教程门禁

- **范围**：在原 #290 分支修复实际代码/合并候选，不更新生产 Worker 或账号数据；未向 main 合并。
- **身份安全**：真实 Node 22 专项 `node --test tests/account-cutover-guard.test.mjs` 为 **6/6 PASS**，拒绝把 `nonPreview='false'` 或非 `super_admin` 身份源误认为合格管理员权威。正式库只读确认 3 个账号、1 个启用 super_admin，永久 ID 为 `MAO-OXHBDBWCOIHPBBYN`；不能由账号行存在推断密码、旧会话或恢复已验收。
- **确认的代码层阻塞**：`.github/workflows/tutorial-regression.yml` 会在 PR 修改用户界面而未更新 `tutorial/tutorial.js` 时明确报错。PR #290 曾修改 `index.html`、`settings/settings.html` 而没有同步教程。现已增补 **真实账号登录/账号管理 QA 指引**及 `tests/tutorial-page-contract.test.mjs` 契约断言，修复该工作流的文件变更要求；完整教程测试尚未运行。
- **GitHub Actions 基础设施阻塞**：早先失败 run 创建后约 2 秒结束，jobs 没有 steps，日志 BlobNotFound；代码测试实际上未被运行。暂不能证明到底是额度、计费、runner 还是其他组织策略阻断，禁止重复触发并冒充代码失败。
- **后续**：在有完整私有仓库的执行环境跑 `npm ci`、`npm run test:account:ui-candidate`、`npm run test:tutorial`、`npm run build`，修真实失败；确认 QA 与正式账号认证隔离后才能更新唯一现有 QA。正式发布仍须单独批准。

## 2026-11-16｜PR #290 QA 身份网关 readiness 探测漏洞修复

- **问题已实际复现**：实际部署的 `maomao-001-identity-gateway-20261114` 对 `GET /api/admin/bootstrap/status` 也要求服务端 `x-mao-identity-bridge` 密钥；原 `worker/lib/identity-bridge.js` 的 `probeExistingIdentityAuthority()` 发送匿名请求，健康网关必返回 403，导致 QA 的 `signInReady` 永远不能被正确核验。
- **原 PR 代码修复**：`worker/lib/identity-bridge.js` 改为仅在 `MAO_IDENTITY_MODE=delegated_preview`、`MAO_IDENTITY_BRIDGE_SECRET` 长度至少 32 且 service binding 可用时，走 Worker 内部 `MAO_IDENTITY_AUTHORITY.fetch`，在请求头加上网关必需的密钥；不放 URL、页面、Cookie，不直接调用生产公网 HTTP。缺失密钥、拒绝/错误响应、离线均 fail closed。对应 commit `c58987c1add392eb982ec556e5e3b209b1100bf6`。
- **测试**：新增 `tests/account-identity-bridge-probe.test.mjs`（合成绑定+合成密钥，4 组测试）；增加到 `npm run test:account:release-gate` 中。使用 Node 22.16.0 在独立目录对**逐行与仓库同一探测函数**的隔离副本执行新 4 组测试：**4/4 PASS，exit 0**；用最新原 GitHub 源码提取的函数在 V8 绑定模拟下额外检查 7 个情况 **7/7 PASS**。这不是整仓 `npm ci`、Vite 或浏览器验证，不得报成完整通过。
- **不能安全直接切换本地认证**：真实 QA 数据库含原管理员影子账号；被委托导入的密码哈希按代码故意设为不可登录占位，因此简单切换 `MAO_IDENTITY_MODE` 会使账号无法登录。独立 `maomao-identity-core` 当前仅 1 个 DO 实例，经只读 SQL 核查 `mao_accounts=0`、`mao_account_sessions=0`；它也不能充当现成的登录服务。
- **仍有真正的部署链路阻塞**：现运行 gateway 的 `FOUNDER_AUTHORITY_ORIGIN` 仍硬编码历史 `qa-phone-founder-001-keyreset-20261111-mao...`，当前账户对该 Worker 的 settings/deployments 均返回 404。不能把网关盲目改为正式 `mao-auth-preview`，这会产生生产会话/账号数据耦合。未改任何 Cloudflare 部署、密钥、数据库、正式/QA Worker。
- **下一步**：在不复制正式密码/用户数据的前提下准备并验收 QA 专有认证权威，独立真实执行 Node/Vite/Chromium 再更新现有唯一 QA。其他开发任务不受此阻塞冻结。

## 2026-11-16｜原 PR #290：隔离 QA 身份源初始化补丁（尚未部署）

- **根因证据**：现有 QA `mao_account_audit` 只有 `identity_authority_import=1`，为不可直接本地登录的委托影子身份；其独立 `maomao-identity-core` DO 为 `0` 账号/`0` 会话，并无 bootstrap Secret/pepper。旧 gateway 仍转发至当前账户找不到的历史 Worker。15 个现有 Worker 中没有另一个已准备好的隔离 QA 身份权威。
- **实际代码**：新增 `worker/lib/qa-identity-bootstrap.js`，在现有 `worker/lib/account-auth.js` 里提供默认关闭的 QA 专有一次性初始化通道：仅 QA workers.dev origin、需有效影子管理员与用户名、目标核心需证明是未初始化的 QA-only authority 且目标永久 ID 完全一致。不能复制正式密码/哈希、不允许生产域名初始化，不能接受目标核心的 Cookie，初始化后重新登录 QA。
- **前端**：`account/bootstrap.js` 仅在服务器明确 `qaSetupAllowed=true` 时允许委托模式初始化，否则原有拒绝规则保留；QA 初始化成功后回登录页而非假装已经有管理员登录会话。`account/bootstrap.html` 为 QA 显示与旧 `mao` Preview 不同的配置说明，提示不得修改正式密钥。
- **验证**：独立 Node v22.16.0 从提交的 `qa-identity-bootstrap.js` + 新回归 `tests/qa-identity-bootstrap.test.mjs` 实测 **8/8 PASS**；加既有账号安全与网关探测子集 **18/18 PASS**。GitHub Blob 与隔离环境文件严格一致：`1a30c1edc13cc9327aa83348b4cbba4160517e52`、`7f5cc0d1bdf9450c395cddd719783ce55cb34818`。`account/bootstrap.js` V8 只做语法解析成功。`npm ci`/整仓 Node/Vite/Chromium **NOT RUN**。
- **部署边界**：所有 QA 初始化配置和后端代码此刻均**未部署**，新标志默认关闭；Cloudflare 账号/库/Worker/Secrets 没有写入。配置与验收精确步骤见 `docs/engineering/QA_ISOLATED_IDENTITY_20261116.md`。不得为测试而改正式账号，不能因 GitHub Actions 无 runner 就绕过构建。
- **下一步**：在可信完整工程环境做编译、账号与 PWA 浏览器测试；先核验唯一 QA 的 Service Binding 指向独立 `maomao-identity-core`，只在 QA-only 环境配置凭据和空库 founder ID，单次初始化后关闭 setup 标志，保留影子账号 ID 对应的现有测试数据，并由用户真实验收。

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
