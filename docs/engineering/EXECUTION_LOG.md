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

## 2026-11-23 · APP-CAFE-003 · 咖啡馆接入统一角色上下文

- **分支 / PR：** `APP-CAFE-003-role-context` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **只读核查结论：** 咖啡馆页面只加载 `phone_storage.js` + `phone_api.js`；`askPartnerOpinion()` 与 `askPlan()` 的 system prompt 仅由 `roleTraits()` 拼出角色卡的 5 个字段（名称/简介/性格/说话习惯/原始提示）。世界书、长期记忆、人物关系、生活线、人设协议内容完全不进入请求。角色 ID 本身是正式的（`PhoneStorage.getCharacters()` + `getCurrentContactId()`，存档按 roleId 分桶）。
- **修改（仅 cafe 页面，不动共享基础设施）：**
  - 按依赖顺序引入 `shared/js/phone/phone_context.js`（在 `phone_storage.js`、`phone_api.js` 之后）。
  - 新增 `roleContextBlock()`：仅当角色确实存在于正式角色列表时，才用 `buildPhoneRoleContext(roleId, 'cafe')` 取上下文；占位错误文案（`无法构建上下文`）、空值、异常、缺少模块一律返回空串，并把长度限制在 8000 字符。
  - 新增 `partnerPersonaText()`：有上下文时以「自然遵守、不要逐条复述」的说明包裹上下文，否则回退原有 `roleTraits()`。
  - 两处请求（搭档意见、经营方案）改用它；JSON 输出契约、温度、超时、返回校验、角色切换竞态保护均未改动。
- **测试：** 新增 `tests/cafe-role-context.test.mjs`——从源码截取三个函数的真实实现，在 `node:vm` 中执行：正式 ID 与 `'cafe'` 应用标识、未知角色不调用、占位错误不注入、异常安全回退、8000 字符上限、脚本加载顺序与两处调用点；6/6 通过。内联脚本 `node --check` 通过。
- **未验证：** 真实模型回复是否更贴合人设（需配置 API 的浏览器/真机）、提示词体积对首字延迟的影响、Vite 全站构建（清空 `dist/` 被环境策略拒绝）。
- **依赖记录：** 人设协议（RP protocol）目前不在 `buildPhoneRoleContext` 的拼装范围内。本应用不另建协议层，若要纳入需在共享上下文模块统一扩展，属其他组范围。

## 2026-11-23 · APP-CAFE-003 · 返工：共享上下文按角色 fail-closed（PR #428）

- **审查结论：** P1-01 世界书未按角色绑定筛选，新调用可能串角色；P1-02 财务/动态快照未按角色过滤；P2 8000 字符从头裁剪。要求应用侧 fail-closed，不改共享模块、不复制世界书实现。
- **独立复核（真实共享模块 + 假存储）：** 直接运行未改动的 `shared/js/phone/phone_context.js`，`buildPhoneRoleContext('A','cafe')` 的实际输出同时包含 `A专属设定`、`B专属设定` 两个世界书条目与 `钱包/财务` 快照。审查意见成立，此前「调用统一接口即等于正确接入」的判断不成立。
- **修改（仅 cafe 页面 + 测试）：**
  - 新增段落白名单 `CAFE_CONTEXT_ALLOWED`（角色人设 / 说话与表达习惯 / 人物关系网络 / 个人生活线 / 长期记忆 / 近期聊天 / 当前设备时间）。
  - `cafeContextSections()` 按 `\n\n【` 切段；`cafeContextBuild()` 只保留白名单段落，其余记入 `dropped`。世界书段（含其嵌套 `【书 · 条目】` 子块）与「其他 App 已有数据」（动态/财务快照）整段丢弃。
  - 预算改为**按段落累计**：超预算段落整段跳过并记录，不再 `slice(0,8000)` 从中间截断；首段（人设）保底。
  - `roleContextBlock()` 返回过滤后的文本；无安全内容时返回空串，`partnerPersonaText()` 回退角色卡。
- **测试：** `tests/cafe-role-context.test.mjs` 重写为 8 项：段落过滤、真实模块下 A/B 跨角色隔离（记忆/聊天/世界书/财务/对方姓名）、整段丢弃、预算不丢人设、未知角色不调用、占位错误/缺模块/抛错回退、脚本顺序与调用点。8/8 通过；内联脚本 `node --check` 通过。
- **仍未完成 / 依赖：**
  - 世界书按角色绑定注入需共享上下文负责人提供安全输出（`chat_worldbooks_<contactId>` 绑定域已有 repository 定义）。本 PR 不放行，标记 BLOCKED。
  - 人设协议（RP protocol）同样不在共享上下文范围内，未接通，不宣称。
  - 真实模型回复、首字延迟、Vite 全站构建、浏览器/真机仍未验证。

## 2026-11-23 · APP-CAFE-003 · 二次返工：标题白名单可被伪造（PR #428）

- **审查结论：** 段落标题白名单可被世界书条目正文里自带的 `\n\n【长期记忆】` 伪造，B 角色秘密可被识别为合法段落。
- **复核（构造数据，真实模块）：** B 世界书条目正文写入 `B_ROLE_SECRET_ZONE\n\n【长期记忆】\nB_ROLE_SECRET_LEAK` 后，仅按标题白名单筛选的旧逻辑确实把 `B_ROLE_SECRET_LEAK` 保留下来，并出现两个 `【长期记忆】` 段。审查成立。
- **修改：** 安全边界改为**前缀截断** `cafeContextSafePrefix()`：在首次出现 `【世界书 · 生活背景】` 或 `【其他 App 已有数据】` 处停止，之后（含世界书条目正文、动态、财务）一律丢弃；截断后再做白名单与按段落预算。代价明确：存在世界书时，其后的长期记忆与近期聊天会一并丢弃（fail-closed）。标题不再承担安全职责。
- **测试：** 10 项，全部使用真实 `phone_context.js` + A/B 假存储：含伪造标题的世界书、伪造的动态/财务字段、合法无世界书、超长聊天、超长人设、未知角色、占位错误/缺模块/抛错、脚本顺序与调用点。10/10 通过；内联脚本 `node --check` 通过。
- **仍未完成：** 世界书按角色绑定、RP 协议、财务/动态按角色过滤都需要共享上下文的安全结构化来源，保持 BLOCKED；未验证真实模型输出、Vite 全站构建、浏览器/真机。
