# MAOMAO Execution Log

> Release instructions: always read the latest main [RELEASE_POLICY.md](RELEASE_POLICY.md). Historical workflow names, versions, and checkpoints are not active instructions.

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

## 2026-11-23 · 应用功能组 · 4 项 P1 返工 + 陪伴/信封/情侣/成长 4 个模块

- **返工（均在原 Draft PR 上追加 commit，未合并、未部署）**
  - #450 `a41c2816`：`getPlayerName/loadNpc/loadDiff` 统一走 `storyRead()`；补「无 PhoneStorage 写→刷新→三项完整回读」回归。13/13。
  - #448 `91eabf02`：伴听 P1-01 无 API 不扣额不占名额、P1-02 会话单调预算 + 落盘失败 fail-closed、P1-03 等 `audio playing` 事件才请求、P2 资料单键原子写 + 读回校验。24/24。
  - #446 `ae74503f`：`aiAudienceDaily` 会话单调镜像 + `persistBroken` fail-closed，`setAiAudience` 不再重置 `sessionUsed/lastAt`。21/21。
  - #445 `c815be71`：恢复案件对象形状提示词与 `campaignBrief()`、`normalizeDetectiveCase()` 严格校验、旧存档兜底；限额由角色改为 `'device'` 且升级当天兼容旧分桶。21/21（另回归 games-storage-trust 9/9）。
- **新模块 Draft PR**
  - #456：陪伴日历绑正式角色 + `storeSet` 失败回滚 + 切 Tab 草稿。12/12。
  - #457：仪式页改共享 `PhoneAPI`/`getApiConfig`、正式角色人设、每日 20 次 + 10s 间隔 + 进行中锁 + 无 API 零费用本地回应。10/10。
  - #460：信封写盘 `mutateAndPersist` 回滚、离开写信页自动存草稿、动画 `paperAnimToken` 可取消 + `finally` 解锁、图片并发锁、排版 4s 兜底。12/12。
  - #461：情侣空间修复 `doCheckin` 未暴露到 window（P0 打卡按钮不可用）、绑正式角色、写入先算后写、头像 `safeSrc` 白名单；新增「内联 onclick 必须全局可用」通用回归。11/11。
  - #463：成长页改读 `maoer_couple_*_<roleId>` 真实键（此前读 `_v1` 永不匹配，点数/勋章恒 0），旧键只读兼容、写失败提示。11/11。
- **Executed:** 全部为 `node --test` 本地真实执行，共 133 个用例通过（13+24+21+21+12+10+12+11+9 分组统计见各 PR）；所有改动文件 `vm.Script` 语法解析通过。
- **Not verified:** Vite 生产构建、Chromium 375/390/430、真机 iOS/Android、真实配额写满、真实模型调用（全部 mock，0 额度消耗）。
- **Blocked / 依赖:** 世界书按角色绑定、RP 协议注入、`ECO-LINK-002` 世界事件接入、聊天发送 API 仍依赖共享底层，未自建并行实现。外卖需总控协调钱包边界；聊天美化与主题商店归豆包。


## 2026-11-23 晚 · 应用功能组 · 6 项复审返工 + 海报/小说工坊两个新模块

- **返工（原 PR 追加 commit，均 Draft）**
  - #445 `0acb3fd2`：预算写入+读回确认才发请求（读回被改也判失败）；失败 0 请求、释放 busy；恢复成功保存后 `startCase()` 刷新列表。24/24。
  - #446 `b6ca3ef0`：`persistAiAudienceVerified()` 写+读回；第一次预算写失败即 0 请求（按总控要求改写测试目标）；补模拟刷新与读回被改用例。22/22。
  - #448 `dd04b555`：`persistTogetherVerified()` 写+读回；拒写即 fail-closed 0 请求；QuotaExceededError 下测试目标改为 0 调用；补刷新重入与读回被改用例。26/26。
  - #456 `5157b31d`：companion.html 真实加载 phone_storage.js；`?id=` 必须经 getCharacters 验证；无合法角色只读、不再制造 default 共享桶。15/15。
  - #457 `f99e1c20`：rituals.html 加载共享两件套；预算写+读回后才允许付费；状态按正式角色分桶；旧全局键只对归属角色只读兼容；自由名字不进模型。15/15。
  - #460 `f56eb93f`：composeSignature 补图片指纹（长度+头尾采样）与信封颜色。16/16。
  - #463 `db5e8ef8`：growth.html 加载共享存储；`?id=` 验证；无角色只读；移除无条件旧全局键兜底（该键从未被任何应用写入）。14/14。
- **新模块 Draft PR**
  - #468 海报：保存竞态锁定目标（FileReader 异步期间切换作品不再写错目标）、校验前置、art 白名单；旧数据键不变。8/8。
  - #471 小说工坊：novel-ai.js 从自建 fetch 收敛到共享 PhoneAPI.complete + 共享配置，删除旧 api_settings 兜底；七个调用页补真实脚本链；错误文案兼容、global.novelAI 签名不变；作品数据键不动。7/7（另七页内联脚本语法解析通过）。
- **Executed:** 本轮新增/改写测试 105 个用例全部通过（24+22+26+15+15+16+14+8+7 分组统计见各 PR）；全部为 `node --test` 本地真实执行；改动文件语法解析通过。
- **Not verified:** Vite 生产构建、Chromium 375/390/430、真机、真实配额写满、真实模型调用（全 mock，0 额度）。
- **P2 登记：** 海报 alert 错误提示与 O(n²) 渲染；小说 read/readers/stats 移动端与长列表性能；付费生成次数预算待总控确认产品预期（长文写作与单次互动不同，硬性日上限可能打断连载）。
- **依赖边界不变：** 世界书按角色绑定、RP 协议、ECO-LINK-002、聊天发送 API 仍 BLOCKED；beauty/主题商店/主题工作台未触碰；外卖待钱包组确认。

### ADMIN-CLOUD-001 主线候选核验（北京时间 2026-11-24）

- 以主线 `00d6012d` 为基线应用 #435 的独立只读诊断补丁。QA v150 的管理中心恢复界面依赖主线仍缺少的 `account/index.html` 和管理中心页面，未直接移植。
- 保留管理员服务端会话校验和预缓存排除，补上主线 Service Worker 对管理员页面及诊断 API 的缓存绕过，防止已打开过的页面或响应由缓存直接返回。对齐两处主线已有的旧缓存版本断言。
- Node 管理员专项 65/65、委托权限 5/5、PWA/图标 11/11、Vite 全量构建及产物隔离 3/3。浏览器脚本的 Worker 页面权限预检通过，Chromium 因当前运行环境拒绝创建套接字，未执行完整浏览器测试。
- 公共隔离 QA 尚未运行，候选未合入 main。主线的私有 Actions 会在匹配的 PR 或 main push 上自动运行，本次未提交远端 PR、未部署。

## 2026-11-23 · APP-CAFE-001 · 咖啡馆搭档决策链路
- **分支 / PR：** `APP-CAFE-001-cafe-partner-decision` · Draft PR（见 PR 链接）。未合并、未部署。
- **基线：** main `40b671bb`（Merge PR #413）。
- **实际发现（源码核对，非功能名推断）：** `cafe/cafe.html` 中 `function chooseEvent(` 出现两次（约 L555 与 L842）。函数声明提升使后一份简化版覆盖前一份，于是 `st.partnerDecision`、`p.decisions++`、默契 `p.rapport`、`p.history`、`checkAchievements()` 全部变成不可达代码：搭档决策从未落盘，`listen-partner` 每日目标与「搭档信任」成就无法正常达成，结算时的搭档复盘拿不到当日决策。
- **修改：** 删除被覆盖的重复实现并留档说明；在保留的实现内增加 `businessStatus==='operating'` 拒绝分支，避免营业中经任何入口改写今日事件。无存储键、无数据结构、无 UI 结构变更。
- **测试：** 新增 `tests/cafe-app-contract.test.mjs`（4 项，全部通过）；内联脚本经 `node --check` 通过。Vite 构建与浏览器/真机验收 **NOT VERIFIED**（本轮无完整工作区与浏览器运行时）。
- **回滚：** 纯代码回退，无数据迁移。
- **未完成依赖：** 世界事件仓储仍只有 forum 局部实现，应用侧统一接口未合并；咖啡馆事件与角色生活线的联动记录为依赖，不另建系统。

## 2026-11-23 · APP-CAFE-002 · 经营档案入口
- **分支 / PR：** `APP-CAFE-002-archive-entry` · Draft PR。未合并、未部署。
- **实际发现：** `<main>` 内没有 `#view-extra`，`renderCafeDetails()` 第一行 `if(!root)return;` 直接返回。于是成长面板、每日目标、搭档建议（`askPlan`/`acceptPlan`）、结算复盘、成就列表全部没有渲染出口；页头 `功能 +` 只有 `data-open-cafe` 属性，处理器绑在首行即 `return` 的 `initCafeCompactUI()` 内，属于无逻辑按钮。
- **修改：** 挂载 `#view-extra`；`setTab`/`renderAll`/`renderTab` 增加 `extra` 路由；页头控件改为 `#openArchive`（`aria-controls`/`aria-expanded`），点击在档案与今日经营间切换；档案顶部提供「返回」；总览重渲染时仅在档案打开状态下刷新档案，避免移动端无谓重绘。样式复用既有 `#view-extra` 规则，未新增视觉语言。
- **测试：** 新增 `tests/cafe-archive-entry.test.mjs`（4/4 通过）；内联脚本 `node --check` 通过。本轮未重新执行 Vite 构建（`vite build` 会清空 `dist/`，被沙箱策略拒绝），也未做浏览器/真机验收 → **NOT VERIFIED**。
- **回滚：** 纯代码回退。无存储键、无存档结构变化。
- **待确认（产品）：** 页头文案由「功能 +」改为「档案」。原控件无任何行为，若希望恢复成功能菜单形态，需要单独设计，不在本 PR 范围。
## 2026-11-23 · APP-CAFE-002 · 总控审查返工（PR #427）
- **审查意见：** P1 成长奖励按钮无监听器；P2 档案入口 `aria-expanded` 不同步。产品决定：保留「档案」入口，不扩展为功能菜单。
- **复核确认：** `renderCafeDetails()` 在 `root.innerHTML=html` **之前**执行 `document.querySelectorAll('[data-growth-claim]')` 绑定，监听器挂在即将被替换的旧节点上，因此每次渲染后「领取奖励」都点不动。
- **修改：** 改为容器级一次性事件委托 `bindGrowthClaim(#view-extra)`（含 `growthClaimDelegated` 去重），点击经 `closest('[data-growth-claim]')` 命中后调用既有 `claimGrowthReward`，其内部 `st.growthClaims[id]` 判重继续防重复领取；新增 `syncArchiveState()`，由 `setTab`/`renderAll` 统一维护 `aria-expanded`。
- **测试：** 新增 `tests/cafe-growth-claim.test.mjs`——从源码截取 `claimGrowthReward` 与 `bindGrowthClaim` 真实实现，在 `node:vm` 隔离上下文里模拟点击：发放一次、重复点击不再发放、未达成/未知奖励不发放、非领奖区域不触发、重复绑定只注册一次，另加「不得在 innerHTML 前绑定」的源码守卫。连续运行 10/10 通过（含 `cafe-archive-entry` 4 项）；内联脚本 `node --check` 通过。
- **仍未验证：** 浏览器/真机实际点击、Vite 全站构建（`vite build` 清空 `dist/` 被沙箱策略拒绝）、屏幕阅读器下的 `aria-expanded` 播报。

## 2026-11-23 · APP-STORY-001 · 剧情应用存档读写一致性
- **分支 / PR：** `APP-STORY-001-storage-trust` · Draft。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `games/story.html`（676 行单文件）。剧情本数据在 `story-books.js`。键：`maomao_story_player`、`maomao_story_difficulty`、`maomao_story_npc_names`、`maomao_story_npc_<bookId>`、`maomao_story_save_<bookId>`。
- **P1 已修：**
  1. **读写后端不一致（真实功能 Bug）**：`writeSave()` 在 `PhoneStorage` 缺失时写 `localStorage`，但 `loadSave()` 与 `renderCover()` 只从 `PhoneStorage.rawGet` 读 → **存了但封面永远看不到进度**。统一为 `storyRead()/storyWrite()`（共享存储优先，回落 localStorage）。
  2. `PhoneStorage.rawSet` 的布尔返回被忽略（未包在 if 里），写失败当作成功。
  3. `writeSave()` 的 `catch(e){}` 全空 → 失败无任何提示；`$('btnSave')` 更是无条件 `toast('已保存')`。改为返回布尔并分支提示。
  4. `setPlayerName` / `saveNpc` / `saveDiff` 静默吞异常 → 改为失败时给具体原因（名字/角色名/难度分别提示），同会话只提示一次。
- **测试：** 新增 `tests/story-storage-trust.test.mjs`（9 项，VM 跑真实 `storyRead/storyWrite/writeSave/loadSave/setPlayerName`），9/9 通过；内联脚本解析通过。
- **登记未做：** 剧情应用不产出世界事件（依赖 `ECO-LINK-002`）；`PhoneContext` 未接入（#428）；封面进度条只显示有无存档，不显示百分比（既有设计，未改）。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机。

## 2026-11-23 · APP-KITCHEN-001 · 投喂厨房存档写入可信性

- **分支 / PR：** `APP-KITCHEN-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **首轮扫描结论（源码级）：** 投喂厨房 = `games/cooking.html` + `games/js/cooking.js`（392 行）+ `games/css/cooking.css`；角色取自 `PhoneStorage.getCharacters()`；口味档案按 `maomao_cooking_taste_v1_<roleId>` 分桶，历史/图鉴/成就/自定义配方为全局键。
- **P0/P1 已修：**
  1. `saveTasteFeedback` 先改内存再写盘，写失败后 `tasteFeedback` 已标记，再点提示「已经记过啦」而实际没保存 → 改为先写盘、成功才落内存与界面，失败可重试。
  2. `saveCustomRecipes` 失败仍提示「已添加到图鉴」→ 返回布尔，失败回滚 `customRecipes`。
  3. 历史「入栈 → 写盘」导致界面条数领先存档 → 新增 `pushHistory()`，失败撤销入栈。
  4. `continueChat` 空 catch 写 pending，失败仍以 `cooking=1` 跳转会读到上一次菜品 → 记录写入结果，失败清陈旧 pending 并以 `cooking=0` 跳转。
- **测试：** `tests/cooking-storage-trust.test.mjs` 8 项（VM 执行真实 `saveHistory/pushHistory/writeTasteMemory/saveCustomRecipes` + 源码顺序守卫），8/8 通过；`node --check games/js/cooking.js` 通过。
- **登记未修（P2 / 待产品决策）：** 历史与图鉴为全局键不按角色过滤（口味档案已隔离）；`progress.dishes` 出锅即计数；自定义配方可重复添加同名组合。
- **BLOCKED：** 世界事件等待 `ECO-LINK-002`；角色世界书/记忆/人设协议未接入（共享 `PhoneContext` 仍会拼入全量世界书与财务快照），本应用只用角色卡 + 本应用口味记忆，不复制世界书实现。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额场景。

**2026-11-24 总控续接：** PR #431 代码已在原分支补齐 #432 已入主线的试吃并发/旧响应防串写守卫；`games/js/cooking.js` 完整语法检查通过。专项 Node/浏览器 QA 待独立复核，不据此声明发布。

## 2026-11-23 · APP-MUSIC-001 · 音乐应用提示与写入可信性

- **分支 / PR：** `APP-MUSIC-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `music/music.html`（1653 行单文件），引入 `home-indicator.js` 与 `phone_storage.js`。键：`music_state`、`music_recent`、`music_fav_list`、`music_fav_count`、`music_played_count`、`music_profile_name/handle/bg`、本地曲目元信息键。
- **P0 已修（本轮最重要的发现）：**
  - 页面里有 4 处调用 `toast(...)`，但**整个文件既没有定义 `toast`，也没有 `#toast` 节点**，`home-indicator.js` 也不提供。这些调用会抛 `ReferenceError`：
    - `if(!t){toast('曲目不存在');return;}` → 变成抛错而不是安全返回
    - 本地音频缺失时的「已从历史/收藏中移除」提示 → 抛进外层 `catch` 再抛一次 → `playTrack` 变 unhandled rejection，播放器卡住
    - `catch(e){toast('音频加载失败')}` → 用户看不到任何原因
    - 导入失败分支 `catch(err){tracks.pop();toast('本地导入失败…')}` → 错误原因不可见
  - 修法：补一个统一 `toast()` 实现（自建 `#musicToast` 节点 + 自动收起 + 复用节点不堆叠），并补 `env(safe-area-inset-bottom)` 的样式，不依赖新增外部文件。
- **P1 已修：**
  1. `saveProfileEdit()` 三条 `setItem` 裸调后立刻 `renderProfile(); closeProfileEdit();` → 容量满时抛异常，昵称没存上、编辑面板留在原地且没有任何说明。改为按结果分支：任一失败就提示「没能保存，清出空间后再点一次保存」并保持面板打开。
  2. `music_played_count` / `music_fav_count` 裸调 → 抛未捕获异常打断 `saveState()` 与 `showNP()`。改走统一入口。
  3. `saveRecentIds` / `saveFavIds` / `saveLocalTracksMeta` 的空 catch → 收藏、历史、本地曲目元信息静默丢失。改为返回布尔 + 同会话只提示一次。
  4. `saveState()` 断点续播写入失败保持静默（低频、非关键），但不再吞掉异常对象。
- **测试：** 新增 `tests/music-storage-trust.test.mjs`（8 项，VM 跑真实 `toast` / `saveLocal` / `saveFavIds` / `saveProfileEdit`），8/8 通过。
- **登记未做：** 音乐应用不接角色人设/记忆（只有 `getMyProfile` 读取本机资料）；不产出世界事件（依赖 `ECO-LINK-002`）；本地音频走 IndexedDB，配额错误提示依赖浏览器实现。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实音频播放与配额场景。

**2026-11-24 总控续接：** 在原 PR 上与当前 main 进行源代码对齐；原先 `saveProfileEdit()` 三字段写入仍可能部分成功，现补写入前快照、逐字段写入回读、失败反向回滚、回滚不能完成时明确提示部分数据风险；旧存储键不迁移。新增第三字段失败专项测试。尚需公共 QA 门禁，未合并/未部署。

## 2026-11-23 · APP-GAMES-001 · 游戏大厅首轮核查与存档写入可信性

- **分支 / PR：** `APP-GAMES-001-storage-trust` · Draft PR。基线 main `40b671bb`。未合并、未部署。
- **应用构成：** `games/games.html`（3441 行，7 段内联脚本，305 KB）。依赖 `native-feel.js`、`nav.js`、`phone_storage.js`、`phone_api.js`、`js/immersive-v21.js`、`js/interrogation-v20.js`。存储键：`maomao_game_role`、`maomao_game_stats_v1`、`maomao_game_pending_<roleId>`、`maomao_detective_progress_v1`、`maomao_detective_team_v1`、`maomao_detective_theme_v1`、`maomao_detective_generated_cases_v1`、`immCasesDone`、`maomao_code_len`。
- **核查结论（源码级）：**
  - 角色接入：`loadRoles()` 走 `PhoneStorage.getCharacters()`，`activeRole` 由 `maomao_game_role` 记住，侦探进度按 `activeRoleKey()` 分桶，AI 请求按当前角色构造人设——**角色隔离正确**。
  - 侦探玩法链路完整：案件档案、调查队、审讯、线索、结案、生成新案、主题切换都有真实处理器。
  - **写入层是短板：10 处 `localStorage.setItem` 全部裸调，没有任何 try/catch 或结果判断。**
- **P1 已修：**
  1. `saveCaseProgress()`（侦探核心存档，被审讯/线索/结案等多处调用）裸调 → 容量满时抛未捕获异常，调用方后续渲染直接中断。改为返回布尔。
  2. `saveStat()` 裸调 → 抛异常导致 `renderRoles()` 不执行，战绩界面停在旧值但没有任何提示。
  3. `selectRole()` 裸调后无条件提示「已切换搭档」→ 实际没存上，刷新回到上一位。改为按结果分支提示。
  4. `generateDetectiveCase()` → AI 已成功、只是存不下时，`setItem` 抛错被 `.catch()` 捕获，提示变成「生成失败，请检查 API 配置」——**错误归因**，用户会去乱改 API。改为区分「AI 失败」与「存不下」，并说明刷新后会消失。
  5. `addChatAfterGame()` 的 `catch(e){}` → 战场小结没写进去仍跳转，聊天页会读到**上一次的旧草稿**冒充这一局。改为失败时清除陈旧 key、明确提示、延迟跳转。
  6. `toggleDetectiveRole()` 裸调 → 抛异常导致 `startCase()` 不执行，点队伍按钮像卡死。
- **做法：** 新增 `saveRaw(key,value,quiet)` / `saveJSON(key,value,quiet)` 与 `warnGameStorage()`（同会话只提示一次，避免连点刷屏），10 处写入全部路由到统一入口；`quiet` 用于迁移/默认值这类无感写入。
- **测试：** 新增 `tests/games-storage-trust.test.mjs`（9 项，VM 跑真实 `saveRaw/saveJSON/saveCaseProgress/selectRole/saveStat`），9/9 通过；7 段内联脚本全部 `vm.Script` 解析通过。
- **登记未做（需产品决策）：** 游戏大厅只读角色卡 + 记忆无关；不产出世界事件（依赖 `ECO-LINK-002`）；侦探案件生成为付费调用，无次数限制或失败重试预算控制。
- **未验证：** Vite 全站构建、Chromium 375/390/430、真机、真实配额场景。


## 2026-11-26 · GOV-006 · Fast parallel delivery and batched QA release

- **Status:** Governance and read-only conflict-scanner implementation prepared on branch `GOV-006/fast-parallel-qa-delivery-20261126`; open PR, not merged to main and not deployed.
- **Baseline:** source main `7f666f1d53c593d341b390442e0e4ff1d0a8f39d`. Read current `AGENTS.md`, `RELEASE_POLICY.md`, `DEVELOPMENT_GOVERNANCE.md`, `REMEDIATION_BACKLOG.md`, and the current QA reusable entry and runner.
- **Verified workflow facts:** the reusable QA request has separate verify/release operations; both invoke `run-candidate.mjs`, which runs the candidate test plan, while release additionally performs QA-only deployment and post-upload checks. QA publication is serialized with `cancel-in-progress: false`; verification uses a separate concurrency group. A same-SHA verify followed by release repeats the test plan.
- **Adaptive coverage boundary:** inspected candidate `6c61b0395705848dfa898073709a651869e87b90` includes an adaptive presentation classifier for only library, diary, music, travel, cafe, and games. Structural/script/attribute/resource changes and unmapped modules fall back to standard regression. PR #507 remains Draft/open; the active release policy still marks adaptive migration under acceptance.
- **Latest failure evidence:** QA verify run [#45792397059](https://github.com/Bella0960/web-runtime-lab/actions/runs/45792397059) stopped at gate 27/51, mapped from the candidate test plan to `tests/travel-storage.browser.mjs`. Release was skipped. The available sanitized output does not identify the underlying assertion or prove a product defect; root cause is NOT VERIFIED. No blind rerun or QA request mutation was made.
- **Changes in this task:** add the mandatory multi-window file-ownership protocol, risk lanes, narrow F1 criteria, one-coordinator batch release, verify/release deduplication, stage-specific failure handling, a read-only GitHub PR file-overlap scanner (`scripts/engineering-pr-conflicts.mjs`), `npm run eng:conflicts`, eight focused unit tests, GOV-006 backlog acceptance, and this durable execution record.
- **Safety boundary:** no product code, user data, QA request file, workflow, secrets, Worker, identity core, production target, or APK changed. The scanner is read-only and queries public PR metadata/filenames only. No QA deployment requested.
- **Checks:** eight focused Node unit tests cover exact overlaps, shared hotspots, same-module warnings, disjoint paths, branch exclusions, renamed files, unsafe paths, and empty-scan semantics. Full repository/remote API execution remains NOT VERIFIED until run from a complete checkout with `origin/main` and GitHub API access. No product build or deployment is applicable.
- **Next:** review PR, merge only with owner authorization; separately diagnose the travel browser gate and complete PR #507 adaptive-path acceptance before claiming the fast selector is globally active.


### GOV-006 scanner verification follow-up

- Fixed path matching for quoted or whitespace-containing Git paths, including both sides of local renames. PRs from forks with the same branch name are still scanned.
- The scanner stops with an incomplete result when the GitHub API quota is exhausted or the PR file list reaches GitHub's 3,000-file cap.
- Node 24.22.3 syntax check and 10/10 focused tests passed. The CLI regression used real Git commits, staging, and working-tree changes with simulated paginated GitHub responses.
- Ran `npm run eng:conflicts -- --json` from the GOV-006 checkout with a valid `origin/main` merge base. GitHub's anonymous rate limit prevented the full live scan. Its exit code was 1 and it returned no conflict report. Full authenticated scan remains NOT VERIFIED.

### GOV-006 live repository scan

- Eliminated per-PR API calls. The scanner reads paginated open PR metadata and derives changed paths from the pinned base and head commits in Git. It fetches missing commits without checking out another branch or changing local branch refs.
- Ran the CLI against the live public source from the GOV-006 checkout with no token. The scan completed across 174 open PRs in two API pages, found 136 PR/path overlaps across six branch paths, and exited 2 as expected. Cross-checked exact findings for PRs #300 and #547 against GitHub’s changed-file lists.
- Node syntax check, 10/10 focused tests, and `git diff --check` passed. The tests exercise paginated PR metadata, actual Git history, filenames and renames, and incomplete API responses.

### GOV-006 isolated QA batch assembly

- Added `npm run eng:batch` to collect ready task records and assemble their reviewed commits on the recorded QA baseline. The Git ref is created only after every ownership, ancestry, and merge check passes.
- The isolated Git test verified two independent tasks, preservation of existing baseline content and dirty working files, exclusion of an unfinished task, exact overlap rejection, and rejection of an existing integration ref. Together with the scanner, 11/11 focused tests passed.
- The current fixed QA workflow was inspected. A QA release, adaptive coverage expansion, and the live version/source receipt remain outside this local assembly verification. Source PR #507 is still open in draft and the active release policy keeps adaptive migration in acceptance.


### GOV-006 batch assembly hardening — 2026-11-26

- **Commit:** `e224abdd52955ce6257dc1ee37a028517df7656a` on the existing GOV-006 branch.
- **Changes:** batch receipts now include each task ID, base SHA, head SHA, and exact owned paths. Git failures include bounded diagnostic output; file-versus-directory merge conflicts expose the conflict type/path and abort before creating the candidate ref.
- **Tests:** the previous 11/11 focused checks are recorded above. One additional file/directory-conflict regression test was added in this commit. The updated 12-test combined suite has **NOT VERIFIED** status until it is rerun against this commit; do not carry forward the earlier pass as evidence for the new test.
- **GitHub status:** PR #546 remains open and unmerged. The current commit has two successful Netlify deploy-preview statuses, but no GitHub Actions workflow runs; these are not test results.
- **Automation boundary:** `eng:batch` still reads a coordinator-local task directory and creates only a local integration ref. Cross-window PR discovery, automated review/check evidence collection, remote candidate push, and one-shot QA request dispatch remain OPEN.
- **QA dependency:** the fixed reusable QA workflow requires the candidate source to contain the adaptive-release marker. The current #507 base branch's `scripts/qa-direct-release.mjs` lacks that marker; PR #507 head contains it. The live deployed QA source receipt was not read in this checkpoint, so whether the deployed baseline already includes #507 is **NOT VERIFIED**. Confirm this before attempting a batch release.
- **Safety:** no QA request, QA deployment, production deployment, Worker change, APK action, secret change, or user-data operation was performed.
- **Next:** implement a durable PR-backed task registry with explicit ready/review/test evidence; then add a safe remote-candidate handoff. Keep QA dispatch as a single coordinator-controlled action under the current release policy.
