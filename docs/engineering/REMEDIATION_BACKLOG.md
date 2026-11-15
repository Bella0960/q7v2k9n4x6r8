# MAOMAO Engineering Remediation Backlog

This backlog divides the full cleanup into independent, reviewable tasks. Agents must claim a Task ID and must not expand scope silently.

Status vocabulary: OPEN, IN PROGRESS, FIXED, DEFERRED, NOT VERIFIED.

## 任务导航与归属（禁止误把公共治理分流为状态栏专项）

本台账列有很多**平行任务**。统一开发流程只规定每项任务如何开发、测试、验收和发布，**不代表全部任务必须等待状态栏 PR #301 验收，也不代表新窗口默认要进入测试/正式发布**。收到「MAOMAO 开工、按统一工程规则继续」时：接续当前窗口已经认领的实际功能；未认领时先核查实时 main、现有 PR 和文件所有权，选择明确授权、无冲突且可实质推进的工程任务。禁止把治理制度读成“全员只修状态栏”。

- **系统架构/功能扩展**：现有 NAV-001/NAV-003、GOV-002、Phase 3 ARCH 和相关原 PR 负责导航、主壳、App 注册/生命周期、共享设置与存储接口，按需求与文件所有权渐进做真实代码；不得只输出流程方案或等待 #301。
- **状态栏**：UI-STATUS-001 / PR #301 是**一个专项**，只有认领该 PR 的开发/QA 人员处理；不能占用其他工程窗口的默认计划。
- **独立业务模块**：聊天、钱包账号、论坛好友、主题商城、游戏等按照各自主 PR 并行开发，前提是不同时编辑同一共享文件、不得破坏数据与既有 UI。P0 数据损坏风险应由原负责窗口优先处理或由协调者明确分配。
- **质量与发布**：受影响代码的自动测试跟随各 PR；独立 QA 在该 PR 具备验收条件后进行，生产数据保护及正式发布只在真正进入发布阶段时触发。某一 PR 的 CI/QA 被阻塞，只阻塞其**相应门禁**，不自动冻结其他独立代码开发。
- **报告重点**：开发阶段报告真实文件/commit/修了什么/测试证据/下一动作；未进入 QA、main、正式发布可各用一句标记，禁止对普通开发任务长篇反复解释测试版与正式版。


## 新增全局 Bug 轨道（2026-11-15；不重复建立修复 PR）

首轮 [全局 Bug 审计与证据清单](GLOBAL_BUG_AUDIT_20261115.md) 已覆盖 main 90 个 HTML 页面直接静态链接、现有测试、Cloudflare 发布历史及关键存储路径。**仅静态核查，不等于全站动态/真机测试**。必须按 [统一流程](RELEASE_PLAYBOOK.md) 在原 PR 开发、QA 和发布。

### CHAT-HISTORY-001 — 转发到损坏的目标聊天记录时不得重置原始数据
**Priority:** P0 · **Status:** SOURCE-VERIFIED / OPEN IN EXISTING PR #282

已核对 current main 和 [原 PR #282](https://github.com/Bella0960/MAOMAO/pull/282)：`chat/chat/chat-detail.html` 的 `forwardMessage()` 在目标 `chat_history_<targetId>` JSON 损坏或非数组时，把目标历史重置为 `[]`，再直接 `localStorage.setItem`，可能覆盖原始损坏字节并使用户无法恢复。不能仅修主聊天读写却漏掉这个转发旁路。

安全验收：在**仅合成数据**中模拟损坏 JSON、非数组、已存在但为空、完全不存在、旧版 v2 回退、存储拒绝/写后读回失败、图片引用创建后保存失败；损坏/不可读时必须停转发、保留原始字节和其他角色、回滚失败媒体引用，并明确提示。复用 #282 的 PhoneStorage fail-closed 契约与现有测试，不开新聊天存储分支。自动检查、独立 QA 与用户批准正式发布全部依 [统一流程](RELEASE_PLAYBOOK.md)。

### NAV-001 — 全局跨文件夹跳转路径重复／错误目录（用户反馈）
**Priority:** P1 · **Status:** OPEN / NOT VERIFIED（用户报告可见症状，尚未定位实时根因）

范围：跨目录 `href/src/data-href`、JS 运行时 URL 拼接、前进后退、子路径部署、Service Worker 更新及浏览器深链接。避免相对路径把目录一层层叠上去，或 404 后回首页冒充成功。

当前证据：main 90 个 HTML 文件的可解析静态直接链接，本轮未发现指向不存在的目标。桌面/生产导航浏览器测试目前只实际点击第一个图标；其余动态跨目录链路尚未验收。

复用：先核对 [PR #207](https://github.com/Bella0960/MAOMAO/pull/207) 的 PWA 导航、[PR #159](https://github.com/Bella0960/MAOMAO/pull/159) / [#160](https://github.com/Bella0960/MAOMAO/pull/160) 的真实路由测试；旧 PR 与最新 main 分叉时**不得整文件回滚**，在原 PR 中补齐测试/最小修复，不重复新建导航系统。

验收：**至少**桌面→聊天→联系人→详情→返回、论坛→帖子→返回、钱包→店铺→返回、设置→子页→返回、世界书→角色库→返回，反复 10 轮，在根域和子路径部署下均不得叠路径；覆盖刷新、PWA 缓存升级、带参数/中文路径、Android Chrome/iPhone Safari。每步核对最终 URL、HTTP/Worker 状态与页面内容；必须真实浏览器测试，不能只跑正则。

### NAV-003 — 统一对外网址与应用级导航体验（用户明确要求）
**Priority:** P1 · **Status:** SOURCE-VERIFIED PRODUCT GAP / DESIGN NOT IMPLEMENTED

用户反馈：别的小手机打开后像一个完整网站；MAOMAO 在浏览器显示 `/chat/chat/chat.html` 等层层文件路径，**即使路径合法也不接受这种对外体验**。这与 NAV-001 “实际链接重复目录导致跳错”不是同一个问题。当前 `index.html` 通过 `window.location.assign` 导航到物理 `.html`，`worker-app.js` 仅处理根路径 `/`，可从源码确认原因。

目标：继续用一个正式入口 `https://app.mao520.com/`，在现有 MPA 代码之上渐进式统一对外导航。短路径（`/chat`、`/forum`）和**全部页面都只显示根域 `/`**必须作为两种不同实现与验收目标；若要求始终根域，仅改 Worker 重写不够，须验证统一应用壳/客户端路由可行性，不能临时嵌套 iframe 或用 `replaceState` 掩盖实际导航问题。先核查已有导航与整合 PR，必要的跨模块契约由协调者认领，避免开重复分支。

验收：不删除或重命名现有 HTML、不损坏账号和聊天存储、不改变主题 UI；旧书签/深链接仍有效，刷新/浏览器返回/通知分享/PWA 离线与安卓 Chrome、iPhone Safari 均走正确站内路由。验证与 NAV-001 一起记录 **实际 URL 和页面内容**；未实测前标 NOT VERIFIED。

**参考源码已复核（2026-11-15，来源详见 [全局审计](GLOBAL_BUG_AUDIT_20261115.md)）：**
- Miya：`index.html` 单桌面宿主，`js1/app.js` 的 `launchApp(id) / APP_HANDLERS`，`js2/miya-lazy-boot.js` 按需加载。参考 app 注册与加载，不照搬页面。
- AI Virtual Phone：`MainApp` → `DesktopShell`，`activeApp / setActiveApp / renderAppBody` 控制内置应用；架构思想可用，**不得迁 React/Next**。
- **qqjrsy-520**：3,118,857 字节的 `index.html` + 独立插件；`baby-plugin.js` 调用宿主 `setActivePage()`，`multi-offline-plugin.js` 维护 `MultiOfflinePlugin` 对象并注入子屏幕。只证实插件调用契约，超大主文件未能完整读取。**禁止复制超大单 HTML、全局变量污染、各插件私自修改状态栏的做法**。
- **jrsy**：仅多种 JS 插件和 `manifest.json`，当前 Git 树无主 `index.html`；不能说其独立站壳已验收。
- **FlutterCppWangWangPhone**：确有 `wangwang_phone/ios/` 和手动构建未签名 IPA 工作流，Flutter 以 `WangWangApp` / `HomePage` / `ChatAppController` 分层；**原生 iOS 路线与 MAOMAO PWA 网页路线不同**，参考安全区和模块边界，不新建 IPA 工作流。

**苹果桌面安装与参考技术边界（2026-11-15 用户确认，仅沿用现有 PWA）：**
- 已核对 **main**：`manifest.json` 配置了 `start_url: "./index.html"`、`scope: "./"`、`display: "standalone"`；`index.html` 已有 `apple-mobile-web-app-capable=yes`、`apple-mobile-web-app-title`、`apple-touch-icon` 与 manifest 引用；`sw.js` 已是 PWA 缓存入口。**iPhone Safari 的“分享→添加到主屏幕”不需 IPA/Apple 开发者代码签名**。这些是源码配置事实，**尚不能证明用户已在 iPhone 安装/启动验收通过**。
- 别的开源工程若提供 `ios/`、未签名 IPA、Flutter/C++、Android APK，**不纳入本次 MAOMAO 实施范围**：禁止新建 Apple 签名、证书/描述文件、IPA 发布、Flutter 工程或第二套登录/数据库。PWA 添加桌面与原生签名是两条不同路线。
- **参考吸收门禁**：只选择兼容现有原生 HTML/CSS/JS、Cloudflare/PWA、已有主题与 PhoneStorage 访问层的结构（AppRegistry、统一 Shell/导航栈、可撤销生命周期、按需加载、隔离样式和统一设置）；一旦方案需要重写大量页面、改变账号 ID、改动媒体/聊天存储键、复制第三方素材/版权不明源码、引入更多 Worker/测试域名，一律拒绝或另案经用户明确授权。
- **分阶段质量门禁**：实施前后都核查 `manifest/start_url/scope/display`、Safari 添加到主屏幕后图标/打开/深链接、手机安全区、刷新与离线返回、跨应用聊天/钱包数据不丢失；仅从源代码看配置不算真实 iOS 验收。任何新 Shell 必须保留现有 Android/iOS PWA 能力，失败时回原 PR 修复，未通过唯一 QA 不合 main/正式站。

**实施验收拆分（按顺序）：** (A) 定义唯一 app registry/导航栈/生命周期契约与兼容旧 HTML 的 fallback；(B) 隔离共享 CSS、状态栏、主题、账号/角色上下文及持久化接口；(C) 先完成聊天/联系人/论坛/设置/钱包试点，实测返回、刷新、深链接和 PWA；(D) 扩到其余模块并补 Android/iPhone 验收。**不可仅改地址栏外观冒充统一架构已落地，也不允许新建另一套数据源。**


### NAV-002 — 论坛详情页 Home Indicator 点击区域缺失
**Priority:** P1 · **Status:** SOURCE-VERIFIED / FIX CANDIDATE IN ORIGINAL PR #245

当前 main `shared/js/home-indicator.js` 在存在 `.comment-bar` 时不生成 84×4 点击层，而底部线本身 `pointer-events:none`；`forum/forum-detail.html` 确实有 `.comment-bar`。在 [原 PR #245](https://github.com/Bella0960/MAOMAO/pull/245) 先检查相对最新 main 的改动，补实机“返回桌面”和“评论可输入”双向命中测试，避免独立重修。

### UI-STATUS-001 — 全项目状态栏同源设置与页面适配（已开工）
**Priority:** P1 · **Status:** IN PROGRESS / SOURCE CHECKED / TEST NOT RUN

2026-11-15 实际扫描 main 90 个 HTML 页面：用静态 `class="...status-bar..."` 标记筛查，共 **28 页**使用既有 `.status-bar` 结构，其中 **27 页**原本直接加载 `shared/js/statusbar-control.js`，`beauty/beauty.html` **遗漏引入**；另外 **62 页没有该类静态标记**，其中可能有刻意沉浸式 UI 和自定义/运行时生成状态栏，**不能一概标错或强制注入同一横条**。

**唯一实现 PR：[PR #301](https://github.com/Bella0960/MAOMAO/pull/301)（Draft），复用既有 `task-ARCH-003/global-statusbar` 分支。**注意旧分支名含 `ARCH-003`，而此台账中 `ARCH-003` 原指「脚本依赖/加载顺序审计」；本工作唯一任务标识仍为 `UI-STATUS-001`，不把两个职责混成一套功能。此轮 PR 原先仅 3 个功能与测试文件，后增加现有 CI 工作流，共 **4 文件**：
- `beauty/beauty.html` 补公共控制器；
- `shared/js/statusbar-control.js` 改为读取**既有唯一 `settings_statusbar`** 后设置 HTML 根属性 + 统一 CSS（覆盖延迟挂载、避免逐节点覆盖原布局 `display`），保留已有设置页 `__statusbarControlApply()` 与 Home Indicator 旧逻辑；
- `tests/global-statusbar-wiring.test.mjs` 加入 HTML 挂载契约及 VM/存储事件的回归测试；
- `.github/workflows/chat-regression-contract.yml` 在原回归工作流增加该测试，没有创建第二套 CI。

**后续严格顺序（只在原 PR 修）：**已核实与最新 main 的 5 个旧提交文件不重叠并完成非强推合并，当前 PR ahead 5 / behind 0，差异仅上述四文件；CI 最新两次 run 约 2 秒失败且 job 无任何 steps（未执行 Node/npm/build，**不能算测试失败或通过**）。下一步确保 `node --test tests/global-statusbar-wiring.test.mjs`、`npm ci && npm run build` 在真实环境执行；随后分类 62 页（沉浸式有意省略 / 独立自绘状态栏 / 运行时生成），按公共壳规范逐模块接入而非一次性覆盖 CSS；设置开/关、跨功能跳转、iOS Safari 添加桌面安全区、Android PWA、返回条不被遮挡都在唯一隔离 QA 验收。**本次仅完成源码提交与静态核查，尚未运行 Node/浏览器/真机测试；未合并 main 或部署正式版。**

### QA-GLOBAL-001 — 90 页真实交互与 Bug 定期回归
**Priority:** P0 for release / P1 ongoing · **Status:** IN PROGRESS (static URL review only)

每次发布前按模块整理“已确认／待复现／已修复且实测”证据，自动生成页面路径清单，进行 Node、构建、Playwright 浏览器与唯一隔离 QA 的 Android/iPhone 关键跨页路径验收。历史报告必须以当前 main/PR 实际源代码和运行结果复核，不得复制旧 Bug 状态；保留失败 URL/步骤、所属原 PR、数据影响、回滚办法。

## Phase 0 — Establish an accurate baseline

### GOV-001 — Reconcile project documentation
**Priority:** P0 · **Status:** IN PROGRESS (2026-11-11: refreshed main-tree inventory and corrected CLAUDE.md page count, storage wording, Service Worker wording, and test/lint description; remaining handoff details still need review)

Current evidence:
- The complete recursive main tree at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273` contains 89 HTML pages, 112 JS/MJS files, 14 CSS files, and 445 tree entries.
- `index.html` registers `./sw.js`; Service Worker behavior still requires browser/device verification after changes.
- The project uses both localStorage and multiple IndexedDB databases; migration and backup coverage remain incomplete.
- Historical audit/refactor docs describe dated states and must retain their historical labels.

Scope: align CLAUDE.md with current verified architecture, link to docs/engineering, mark historical reports as dated, and remove contradictions without deleting useful design/behavior rules.

Acceptance:
- No stale page count, SW status, or “localStorage only” statement.
- All agents are directed to AGENTS.md and engineering docs.
- Every claim is tagged as current fact, historical finding, or open question.

### GOV-002 — Build full function and file ownership index
**Priority:** P1 · **Status:** OPEN

Scope: inventory launcher apps, all 88 HTML pages, shared scripts/styles, page routes, key global symbols, and cross-module callers. Verify which pages are production, hidden, test, preview, or maintenance-only.

Acceptance:
- Each production app has entry page(s), owner directory, shared dependencies, storage domains, key routes, and tests listed.
- Every query-string route parameter and important cross-page write is mapped.
- No app is deleted as an “orphan” based only on naming.

### GOV-003 — Validate root cleanup candidates
**Priority:** P2 · **Status:** OPEN

Scope: inspect apps/settings, previews, design, old reproduction scripts, android wrapper, and npm publish workflow usage. Search references and deployment inclusion before proposing removal.

Acceptance:
- Candidate has no runtime/build reference, no user data, no active workflow dependency.
- A PR shows exact deletion and impact; no bulk cleanup.

### GOV-004 — Continuous task execution and durable handoff
**Priority:** P0 · **Status:** IN PROGRESS (execution protocol and cross-session log introduced on branch GOV-001-autonomous-execution-and-doc-sync)

Purpose: one owner request is one complete work package. The agent owns decomposition, sequencing, implementation, tests, repair loops, and the final report; the owner should not need to repeatedly say “continue”.

Acceptance:
- Default direct requests such as “fix”, “finish”, or “complete” enter IMPLEMENT-ON-BRANCH mode. Read-only mode is used only when explicitly requested.
- The agent executes every in-scope, authorized, independently actionable subtask until acceptance criteria pass or a concrete blocker/approval boundary is reached.
- After each subtask, update `docs/engineering/EXECUTION_LOG.md` with status, evidence, branch/commit/PR, tests, and next action; independent tasks continue even if one item is blocked.
- Ask the owner only for product decisions, missing requirements, credentials/secrets, destructive data actions, schema migrations requiring approval, and production merge/deployment/release actions.
- Never merge to `main`, deploy production, update APKs, configure secrets, or perform irreversible user-data operations without explicit owner approval.
- Do not claim background execution after the conversation/session ends. Leave a durable checkpoint so the next session can resume without asking the owner to repeat the task.

Execution semantics: “complete all” means all authorized work in the assigned scope, not silently activating deferred roadmap items or crossing approval boundaries. Blocked items must be recorded with the exact dependency and not disguised as completed.

## Phase 1 — GitHub and build governance

### CI-001 — Verify APK automation stop and clear prior artifacts
**Priority:** P0 · **Status:** PARTIALLY DONE

Completed:
- build-android-apk.yml now has only workflow_dispatch.
- APK retention changed to 3 days.
- cleanup-apk-artifacts.yml was added and filters exact artifact name MAOMAO-Android-APK.

Remaining:
- Repository maintainer manually runs the cleanup workflow once.
- Verify its run log lists deleted APK artifacts or reports none found.
- Wait for GitHub usage recalculation, then check whether Actions artifact quota is clear.
- If still full, check other repositories under the same account/organization; the repo cleanup workflow cannot reach them.

Acceptance:
- A normal code push does not trigger APK build.
- Web deployment, chat test, and performance workflows remain independent.
- Old named APK artifacts in this repo are removed and documented.

### CI-002 — Audit all workflow triggers and output retention
**Priority:** P1 · **Status:** OPEN

Scope: inspect path filters, duplicate runs, concurrency, permissions, artifacts, caches, logs, and scheduled workflows.

Acceptance:
- Web deploy runs for website-relevant files only and still deploys assets.
- Test workflows run only for relevant paths and on PRs where appropriate.
- No routine workflow uploads APK or other large unneeded artifacts.
- Workflow permissions are least-privilege.
- Concurrency does not cancel production deployment unexpectedly.

### CI-003 — Resolve npm package publish template
**Priority:** P1 · **Status:** OPEN

Evidence: npm-publish-github-packages.yml runs npm test and npm publish on release; package.json at baseline defines no generic test script and package is not evidently intended as a published library.

Acceptance:
- Confirm whether publishing is a real product requirement.
- If not, disable/remove the workflow only after owner approval.
- If yes, configure package metadata, actual tests, package contents, permissions, and a dry-run release.
- No accidental publication from creating a GitHub release.

### CI-004 — Replace fake lint command
**Priority:** P1 · **Status:** OPEN

Evidence: npm run lint only prints a fixed success message.

Acceptance:
- Choose a lightweight linter compatible with native scripts and inline HTML scripts.
- Exclude generated/vendor files deliberately.
- Add real lint checks to CI only after baseline issues are triaged.
- Until then, documentation must not treat lint as a real check.

## Phase 2 — Data integrity and storage

### DATA-001 — Create one authoritative browser database registry
**Priority:** P0 · **Status:** OPEN

Scope: inventory maomao-media-store, maomao_diary_photo_store_v1, maomao-reading-library, maomao-font-presets, maomao-assets, maomao-restore-point, and every remaining localStorage domain.

Acceptance:
- One registry lists database name, version, stores, key paths, owner module, data type, backup status, migration status, and cleanup policy.
- Runtime DB/store inventory and source registry agree.
- No untracked IndexedDB database remains.

### DATA-002 — Complete backup coverage for MediaRepository
**Priority:** P0 · **Status:** IN PROGRESS (2026-11-11: implementation is already present on main; automated execution/restore acceptance remains NOT VERIFIED)

Evidence: current main `settings/js/backup.js` includes `maomao-assets` v2 stores `assets`, `blobs`, `refs`, and `image_records`; Blob payloads use Base64 with size limits; `atomicExport: true` excludes the entire database if any blob is skipped; `clearOnRestore: true` clears stores even when the backup store is empty. `tests/media-backup.test.mjs` contains 10 focused cases for MIME preservation, empty-store clearing, invalid Base64 handling, size-limit atomic exclusion, full four-store round trip, and reference integrity. The test file exists but its execution has not been verified in this environment.

Acceptance:
- Export includes metadata, Blob payloads, references, and integrity hashes.
- Restore preserves asset IDs and owner references.
- Restore tests verify each asset resolves.
- Failed/partial restore is reported; source data remains recoverable.

Dependency: DATA-001.

### DATA-003 — Fix audio Blob backup semantics
**Priority:** P1 · **Status:** OPEN

Evidence: backup.js currently sets excludeFields: ['blob'] for audio store records, so the local music file itself is omitted from that backup target.

Acceptance:
- Decide and document whether full backups include local audio or offer a separate “large media” export.
- No silent omission; export UI lists skipped audio files and size.
- Restore result clearly reports what was restored.

### DATA-004 — Add storage usage and error diagnostics
**Priority:** P1 · **Status:** OPEN

Scope: navigator.storage.estimate where supported, localStorage key size estimates, IndexedDB per-store record counts/known byte sizes, quota errors, last backup/migration status.

Acceptance:
- Settings page displays category-level figures and last backup.
- Does not expose values, conversation text, keys, or private media in diagnostics.
- Handles unsupported browsers and estimate failures.
- No auto-delete feature.

### DATA-005 — Inventory all chat-history read/write callers
**Priority:** P0 · **Status:** FIXED (static source inventory completed 2026-11-11)

Evidence: `docs/chat-history-callers.md` records the main-branch readers, writers, deletions, role/group/date-mode scopes, legacy fallbacks, test-only callers, and known persistence-result handling gaps.

Completed:
- Identified production call sites across chat detail/list/search/settings, chat extras, date/journey, calls, notifier, wallet, forum, couple, role matching, memory, library, image generation, PhoneStorage, ConversationRepository, and backup/restore.
- Recorded the current localStorage-backed `chat_history_<id>` behavior, PhoneStorage compatibility rules, shared online/date history, and distinct role/group ID domains.
- Assigned a safe migration order and called out write paths that ignore save failures or bypass PhoneStorage.

Acceptance:
- [x] Call-site matrix identifies file, operation, role/group ID, legacy fallback, and whether write is direct or through PhoneStorage.
- [x] Every caller assigned a migration step.
- [x] Cross-role/group isolation and date-mode shared history rules are recorded.
- [x] This was a read-only inventory; no storage backend was switched.

Remaining implementation is tracked by DATA-006/007/008 and QA-002. DATA-005 being fixed does not mean those runtime defects are fixed.

### DATA-006 — Design and implement IndexedDB conversation storage
**Priority:** P0 · **Status:** BLOCKED BY DATA-001/002/005

Scope: conversation metadata + message records in IndexedDB, cursor/index-based pagination, compatibility adapter, rich message preservation, resumable migration.

Acceptance:
- Migration dry-run against synthetic legacy data with thousands of text and rich messages.
- Per-conversation checksums/counts/order and message fields all match.
- Private, group, and date-mode conversations remain isolated.
- All known readers/writers use the adapter.
- Old localStorage data remains untouched until verified and explicit cleanup approval.
- If IDB fails or quota is insufficient, app remains in old mode and shows an actionable error.
- No arbitrary deletion or history cap.

### DATA-007 — Route chat image/sticker attachments into MediaRepository
**Priority:** P0 · **Status:** BLOCKED BY DATA-002/005/006

Scope: convert new image/sticker uploads to Blob assets and store asset IDs in messages; keep legacy data URL rendering compatible.

Acceptance:
- Duplicate assets are reused when hashes match.
- Object URLs are revoked.
- Deleted messages release references only when no other message/feature uses the asset.
- Backup/restore round trip succeeds.
- Existing legacy image messages render unchanged.

### DATA-008 — Make remaining legacy storage callers explicit
**Priority:** P2 · **Status:** IN PROGRESS (PR #255, 2026-11-11)

Scope: migrate direct localStorage readers/writers page-by-page to approved PhoneStorage/repository APIs after storage contracts are stable.

Progress in PR #255:
- Added verified history writes and explicit failure handling for offline/date chat, travel-journey stage messages, group-call result cards, forum post sharing, couple-space invitations, wallet shop/takeout/family-card notices, and shake-match contact initialization.
- Added behavior tests for write refusal, readback mismatch, quota errors, role isolation, and retry/deduplication.
- No history key or message schema was renamed; no history was truncated or migrated.
- A failed purchase/order is not inferred from a failed chat notice: transaction state and message-notice state remain separate.

Remaining:
- Finish the legacy read/write audit against DATA-005 and migrate search/settings and any remaining direct writers after the parallel multi-bubble branch is reconciled.
- Audit remaining read-only legacy fallbacks in memory/context/library paths.
- Confirm backup/export behavior before changing the storage backend (DATA-001/002/006/007).
- Run the complete local/CI regression suite and validate on a real phone/PWA.

Acceptance:
- Each migration is limited to one domain or feature.
- No hidden change to key names or role scoping.
- Failures propagate and are tested.
- Direct access remains only where documented as an intentional compatibility boundary.
- DATA-008 remains OPEN until the remaining callers are migrated and the full regression/device acceptance is complete.

### DATA-009 — Decide cloud sync, if ever required
**Priority:** P3 · **Status:** DEFERRED

Current state: static Worker deployment only; no D1/R2/auth/sync configured.

Acceptance before implementation:
- User explicitly chooses whether cloud sync is wanted.
- Define accounts, encryption, privacy, conflict resolution, quotas, billing, retention, export/delete, and offline behavior.
- Compare browser-local IndexedDB-first versus server-sync architecture.
- No infrastructure added before decision.

## Feature implementation

### AI-IMG-001 — Complete role-based image generation and gallery
**Priority:** P1 · **Status:** IN PROGRESS

Scope: add stable per-role appearance/style data, an image-generation orchestration service using the existing PhoneAPI Images API, IndexedDB image records backed by MediaRepository, a Settings entry and role gallery, an explicit `/photo` chat trigger, and native image-message rendering by assetId.

Acceptance:
- Existing role records and chat messages remain readable; new role fields are additive.
- Image binaries stay in MediaRepository/IndexedDB; image records and chat messages store assetId references, never new Base64 payloads.
- `maomao-assets` backup includes image_records and the referenced Blob; failed/oversized exports are reported atomically.
- Each generated image is scoped to one character, stores prompt/scene/privacy/time metadata, and defaults to private.
- Chat generation is user-triggered only; no unsolicited automatic or probability-based generation.
- Legacy `type:image` messages using `img` continue rendering unchanged.
- Settings gallery supports per-character and public/private filtering, and generation/persistence failures are visible.
- Tests cover prompt construction, record persistence, privacy filtering, backup inclusion, and chat command/render contracts.

## Phase 3 — Shared architecture and feature safety

### ARCH-001 — Reduce chat-detail coupling
**Priority:** P1 · **Status:** OPEN

Historical audit measured chat-detail at roughly 7,181 lines and identified many responsibilities in one file. Re-measure current file before editing.

Suggested extraction boundaries: rendering/cards, group behavior, memory orchestration, input/media, search/selection. Extract one behavior at a time.

Acceptance:
- Existing DOM contracts, global bridge functions, rich messages, keyboard/touch behavior, and selectors remain compatible.
- Each extraction includes contract tests and manual acceptance.
- No simultaneous large rewrite or visual redesign.

### ARCH-002 — Unify AI request paths
**Priority:** P1 · **Status:** OPEN

Historical report found direct fetch calls in several pages alongside PhoneAPI/PhoneStream. Re-run a current inventory.

Acceptance:
- New calls use PhoneAPI for non-streaming tasks and PhoneStream for streaming chat.
- Existing timeout, partial output, JSON behavior, usage logging, error messages, and provider compatibility are preserved.
- Direct fetch exceptions are documented.

### ARCH-003 — Verify script dependency/load order
**Priority:** P2 · **Status:** OPEN

Scope: document script order for IIFE global modules and add development-time assertions where safe.

Acceptance:
- No accidental use before dependency load.
- No runtime framework introduced.
- Each module declares required global APIs in comments/tests.

## Phase 4 — Reliability, security, performance

### QA-001 — Expand real browser/mobile acceptance
**Priority:** P0 for storage/chat releases · **Status:** OPEN

Acceptance:
- Key journeys run on desktop browser and real phone browser.
- Console errors, network failures, persistence after refresh, back navigation, touch/scroll, and image rendering checked.
- Test result records device/browser and date.
- Automated static contracts are not described as full E2E coverage.

### QA-002 — Add storage-failure tests
**Priority:** P1 · **Status:** IN PROGRESS (chat-history cases added in PR #255)

Progress:
- Added behavior tests for chat history save rejection, readback mismatch, localStorage quota failure, role isolation, date-mode rollback, journey retry/deduplication, call/forum/wallet notices, and shake-match initialization.
- The tests are wired into the existing `npm run test:chat:isolation` script.

Remaining:
- Add IndexedDB unavailable/blocked/quota tests when the DATA-001 registry and DATA-006 storage implementation are ready.
- Run the suite locally and obtain actionable CI output; current Actions runs returned failed conclusions without job steps or logs.
- Verify refresh/reopen and storage behavior on desktop and real mobile browsers.

Acceptance:
- Simulate localStorage quota errors and IndexedDB unavailable/blocked/quota errors.
- Confirm no false-success toast and no original-data deletion.
- Verify retry/reopen paths.

### SEC-001 — Review unsafe DOM, URL, and API secret paths
**Priority:** P1 · **Status:** OPEN (periodic)

Previous execution report documented XSS output escaping and backup secret exclusions. Re-check current source and every newly touched path rather than treating the historical fix as permanent proof.

Acceptance:
- Untrusted HTML is escaped or created via safe DOM APIs.
- URL and CSS URL schemes are allow-listed.
- API secrets are never logged or exported by default.
- Real user content is excluded from fixtures and logs.

### PERF-001 — Image asset size optimization
**Priority:** P2 · **Status:** OPEN

Acceptance:
- Prioritized list of assets by bytes, dimensions, and actual use.
- One-at-a-time WebP/AVIF or compression proposal with visual comparison.
- Preserve original art and transparency until approved.
- Build and visual smoke tests confirm no broken assets.

### PERF-002 — Verify build output and static resource copying
**Priority:** P2 · **Status:** OPEN

Acceptance:
- Record dist total size and largest assets.
- Confirm no test, preview, backup, or private file is accidentally published.
- Confirm every referenced image/font/audio asset is present.
- Keep relative paths compatible with Worker deployment.

## Phase 5 — Documentation and cleanup

### DOC-001 — Keep handbook synchronized
**Priority:** P1 · **Status:** IN PROGRESS (initial handbook created)

Acceptance:
- Architecture, storage registry, workflows, app inventory, and migration status updated with each relevant change.
- Dates and evidence are included.
- Historical docs remain historical and are not mistaken for active rules.

### DOC-002 — Review orphan/legacy files safely
**Priority:** P2 · **Status:** OPEN

Candidates include apps/settings, old performance reproduction scripts, preview pages, and templates. Search Vite inclusion and runtime references first.

Acceptance:
- Deletion only by separate reviewed PR.
- No user data, routes, assets, backup code, or build dependencies removed.
- No blanket cleanup.

## Phase 6 — iOS application packaging (deferred)

### IOS-001 — Add an iOS app build and IPA distribution path
**Priority:** P2 · **Status:** DEFERRED (owner decision: do this in a later phase; not part of current work)

Goal: after the existing MAOMAO experience is stable, provide an iPhone-installable iOS app build while continuing to support the current web/PWA version.

Scope when activated:
- Reassess the current Vite/PWA architecture and evaluate a thin iOS shell such as Capacitor before choosing an implementation.
- Reuse the existing app code, APIs, and cloud/data contracts wherever practical; do not rewrite MAOMAO as a separate native app without a demonstrated need.
- Preserve the web/PWA deployment and Android path. iOS work must not silently replace or disrupt either.
- Audit iOS-specific behavior rather than assuming browser features transfer unchanged: sign-in/session persistence, local data and uploaded media persistence, camera/photo library and file handling, keyboard/viewport behavior, safe-area insets, sharing, background behavior, and push notifications.
- Document Apple signing and distribution requirements for development-device testing, ad hoc distribution/TestFlight, and any future App Store release. A generated IPA is not automatically installable by every iPhone.
- Keep signing credentials and certificates out of the repository and CI logs; document the secure owner-controlled signing process.

Start condition:
- Do not start implementation during the current stabilization/backlog cleanup phase.
- Activate only after the owner explicitly schedules the task and the core mobile experience, authentication, chat, and data persistence have been stabilized.
- Before implementation, inspect the then-current main branch and existing Android/PWA configuration; avoid creating duplicate wrappers or parallel app projects.

Acceptance:
- Existing web/PWA remains functional and independently deployable.
- A signed iOS test build or TestFlight distribution path is documented and verifiably usable on a real iPhone.
- Real-device tests cover sign-in, chat send/receive, refresh/reopen persistence, image/file handling, keyboard and safe-area layout, and any claimed background/push behavior.
- Unsupported or platform-limited capabilities are listed honestly; static build success alone is not treated as device verification.
- No production deployment, Android release, or existing user data is changed without separate approval.

## Parallel work plan

Safe to parallelize:
- GOV-002 with CI-003 (different files).
- DATA-001 read-only registry work with DATA-005 read-only call-site inventory.
- PERF-001 asset inventory with ARCH-003 dependency inventory.

Do not parallelize:
- DATA-002 and DATA-007 without one backup owner and shared schema plan.
- DATA-006 with any other agent editing chat history callers.
- ARCH-001 with feature work touching chat-detail.html.
- Multiple agents editing CLAUDE.md, AGENTS.md, or the handbook.
- Multiple agents modifying .github/workflows or package scripts concurrently.

## Recommended first assignments to other AIs

1. Agent A: GOV-002 — app/page/route/cross-module ownership map, read-only.
2. Agent B: DATA-001 — IndexedDB/localStorage database registry and backup gaps, read-only.
3. Agent C: DATA-005 — all chat-history reader/writer call-site matrix, read-only.
4. Agent D: CI-002 + CI-003 — GitHub workflow and release-template review, propose patch only.
5. Agent E: PERF-001 — image asset inventory and safe optimization recommendations, no replacements yet.

Only after these reports are reviewed should implementation tasks be assigned.
