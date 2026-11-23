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
