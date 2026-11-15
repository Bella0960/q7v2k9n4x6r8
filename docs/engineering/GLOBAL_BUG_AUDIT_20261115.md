# MAOMAO｜全局 Bug 审计与修复登记（2026-11-15 首轮）

> **唯一任务登记规则：** [RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md)。**现有原任务与原 PR 为主，禁止为同一问题重复造 PR / Worker / 数据库。** 本文为可追溯的 Bug 证据清单，不是全部页面已通过真机验收的证明。每次变更应更新证据、状态及责任 PR。
>
> 核查基线：`Bella0960/MAOMAO` 的 `main` Git 树 `a5415d7e28280fd07cea4d02e19e87d9ec36083e`，树返回 `truncated=false`：505 条树项、90 个 HTML 页面。2026-11-15 查核；旧历史结论不自动视为当前 Bug。

## 审计分级说明

- **已确认（SOURCE-VERIFIED）**：当前 main 的源码、配置或文件间行为构成明确缺陷或限制；**不等于真机复现**。
- **用户反馈／待动态复现（USER-REPORTED / NOT VERIFIED）**：症状有用户反馈，当前静态检查尚不能确定哪条运行时跳转导致。
- **历史记录待复验（HISTORICAL / NOT VERIFIED）**：旧报告说过，但当前 main 已变，必须重新检查；不能当成当前确定故障。
- `P0` 数据损坏/身份/上线阻断；`P1` 高频核心使用/导航/关键质量缺陷；`P2` 低风险边缘问题、技术债。
- “已有 PR”仅表示有相关改动，不证明已合并、已通过 CI 或已部署。

## 首轮导航核查

**USER-REPORTED / NOT VERIFIED · NAV-001 · P1：跳转路径层层叠加、进入错误目录。**

用户描述：点进一个文件夹/功能链接后，地址逐次叠加其他文件夹，可能打开错误页面、404 或返回异常。既有相似历史故障是 `/assets/assets/icon-192.png` 重复路径；它过去曾得到修复，但**不能当作本次问题已修**。

已做：
- 从完整 Git 树获取 `main` 的 **90 个 HTML 页面**；逐个读取页面源码。
- 解析静态 `href`、`src`、`data-href`、`action` 及简单字符串赋值 `location.href='…'`，按**页面所在目录**解析，相对 Git 文件清单检查：**本轮这些可直接解析的链接未发现目标文件不存在**。这是一项有限的源代码静态检查，**不是** 90 页面动态点击验收。
- 核查 `index.html` 桌面应用入口用 `new URL(href, document.baseURI)`；`shared/js/nav.js` 用脚本绝对 URL 求项目基路径；`vite.config.js` 的 `base: './'`。三者单独看都不证明存在/不存在动态目录重复。
- `tests/desktop-app-navigation.browser.mjs` 当前校验桌面应用静态路由，并实际只点击**第一个**应用图标；`tests/production-worker-navigation.browser.mjs` 同样主要点击第一个入口。**缺跨文件夹来回跳转、二级页面刷新和子路径部署的完整 E2E 回归。**
- 相关旧 PR：[PWA 缓存/导航 #207](https://github.com/Bella0960/MAOMAO/pull/207)、[正式路由浏览器验证 #159](https://github.com/Bella0960/MAOMAO/pull/159)、[完整应用路由探测 #160](https://github.com/Bella0960/MAOMAO/pull/160)。**这些 PR 不是本次路径问题已修复的证据。** #207 分支的 `sw.js` 缓存版本仍相对较旧，必须先与最新 main 比较，避免旧覆盖新。

**验收标准（修复范围，不改变 UI）：**
1. 建立页面、静态资源、动态跳转和入口所需相对路径的全局导航映射；统一以既有项目根路径解析，兼容 `/` 与 `/MAOMAO/` 子路径；若必要，只做最小公共导航工具/调用处修复，**不重建路由框架**。
2. 在隔离构建里真实点击桌面 → 聊天 → 联系人 → 聊天详情 → 返回、论坛 → 帖子 → 返回、钱包 → 店铺 → 返回、设置 → 子页面 → 返回、世界书 → 角色库 → 返回，重复十轮；最终 URL 不得出现意外重复目录段或错误文件，不能仅凭 HTTP 200 视为正确页面。
3. 覆盖刷新、深链接（含参数/中文编码）、浏览器前进后退、PWA Service Worker 更新前后、离线重开；不存在的目标必须清晰报 404 而不是偷偷回首页。
4. 自动测试通过后，在**唯一已核实隔离 QA** 的 Android Chrome、iPhone Safari 实机检查；记录 URL、Worker/DB 绑定、版本、截图和复现步骤。测试未跑时继续标 `NOT VERIFIED`。
5. **禁止**为排查单项导航问题另造 QA Worker/域名或直接改正式 `app.mao520.com`。先在原导航/PWA PR 处理或明确最小迁移路线。

## 全项目 Bug / 高风险清单（按优先级）

| ID | 级别/证据 | 问题及当前核查事实 | 原任务/PR 与下一动作 |
| --- | --- | --- | --- |
| **PROD-001** | **P0 · 配置已核查，真实运行待复验** | `app.mao520.com` 目前绑 `curly-dream-324c`，原先只读核查 `MAO_APP_CUTOVER_ENABLED=false`；`mao520.com` 的账号库却是另一个 Worker。不能因正式账号可登录而宣称完整小手机 API 接通。| 候选 **#285**，子改动 #292/#295；先核验正式域名/自动 Build trigger、原管理员及普通成员数据连续性、加密备份与隔离恢复，不作生产切换。 |
| **DATA-001** | **P0 · SOURCE-VERIFIED 架构风险** | 聊天历史 `chat_history_<id>` 仍主要以每会话完整数组存 localStorage，富媒体/存储配额及跨角色隔离风险尚须统一回归；不能随便迁移/删除历史。| 复用 backlog **DATA-001/002/005/006/007/008**、[调用台账](../chat-history-callers.md)；优先测试失败保护、备份恢复，再做非破坏迁移。 |
| **QA-001** | **P0 发布门禁** | 真实跨页、Android/iPhone、独立 QA 后端验收不能以 Node 静态检查或旧 CI 成功替代；固定 QA URL 未核实，不能提供伪测试地址。| 统一 [RELEASE_PLAYBOOK](RELEASE_PLAYBOOK.md)，QA-001；先核实唯一 QA Worker 与可访问 URL，严禁用生产数据库测试。 |
| **NAV-001** | **P1 · USER-REPORTED / NOT VERIFIED** | 用户反馈跨文件夹路径叠加。90 页静态直链扫描未发现可解析目标丢失；运行时字符串拼接、部署子路径及缓存尚未完成验证。 | 参照上方验收，关联 #207/#159/#160，不宣布修复，不新开重复分支。 |
| **NAV-002** | **P1 · SOURCE-VERIFIED** | `shared/js/home-indicator.js` 的固定返回条使用 `pointer-events:none`，且遇 `.comment-bar` 时跳过创建 `.maomao-global-home-indicator-hit-target`。`forum/forum-detail.html` 实际含该评论栏，存在无法点击返回的代码路径。 | **已有 PR #245** 正在处理底部点击区；先核对该 PR 与最新 main 的差异、更新基线、运行浏览器点击/评论输入不冲突测试。 |
| **CI-004** | **P1 · SOURCE-VERIFIED** | `package.json` 的 `lint` 只是输出 `Lint passed`，没有真实扫描。不能引用它作为构建通过证据。 | **已有 PR #248**；先修真实源代码语法检查并接入 CI，不借机重构全站。 |
| **CI-003** | **P1 · SOURCE-VERIFIED** | `.github/workflows/npm-publish-github-packages.yml` 调用 `npm test` 与 `npm publish`，而当前 `package.json` 未定义通用 `test` 脚本；发布 npm 包流程与小手机网站发布目标不一致。 | 复用 backlog CI-003；不要自动创建 GitHub Release/npm 发布；由明确的构建治理任务修。 |
| **BACKUP-003** | **P1 · SOURCE-VERIFIED 范围限制** | `settings/js/backup.js` 中全量模式的 `maomao-media-store/audio` 仍设置 `excludeFields: ['blob']`，即音频本体不包含在该模式中。代码另有定向音频导出 `blobFields:['blob']`，且含“不完整备份”提示。**不是“完全没备份功能”或“无提示静默丢失”。** | backlog **DATA-003** 与 **#250**；需要核实用户所需“真正全量”语义、恢复后媒体完整性和文件大小提示。 |
| **CACHE-001** | **P1 · 待实测** | Service Worker 采用缓存优先，旧页面与新页面/脚本混用、更新时 404 等需真机回归；**不是已经证实所有页面缓存有 Bug**。 | **#207** 原 PR，结合 `tests/sw-navigation-cache-lifecycle.test.mjs`、PWA 实测；先比对 #207 与当前 main，避免旧版本覆盖。 |
| **DOC-001** | **P1 · SOURCE-VERIFIED 文档不一致** | `docs/engineering/PROJECT_ARCHITECTURE.md` 仍写“无服务器用户数据库”，与现有账号 Worker/CloudDatabase 的真实绑定事实冲突；容易误导新窗口再建一套账号。 | 在**治理 PR #300** 内纠正当前架构说明，并保留文档原版时间戳。 |
| **UI-STATUS-001** | **P1 · 历史反馈/待逐页验收** | 用户要求设置里的状态栏开关全项目生效；目前有公共 `shared/js/statusbar-control.js`，但未逐页核对 90 个 HTML 是否正确接入，不能直接说全部已统一。 | 复用现有状态栏需求与共享模块；不再造第二套开关，按页面/设备测试。 |
| **APP-001** | **P2 · 历史反馈待复验** | 查手机、论坛、阅读、主题商城、桌面 Dock 和游戏解锁等曾有用户反馈；本轮没有逐项完成真实交互，因此不能打包认定为“当前都坏了”或“都好了”。 | 分别回原功能 PR/既有测试；本轮优先全局共用的路径、存储、发布、设置，而非盲目重做 UI。 |

## 历史记录中不能重复误报的项目

- 旧版 `docs/chat-history-callers.md` 指出线下 `saveHistory` 忽略保存结果、论坛分享直接写本地存储、摇一摇建立角色后不检查成功。**当前 main 源码已发生变化：**
  - `chat/date/date.html` `saveHistory` 已明确检查 `PhoneStorage.saveChatHistory(...) === true`，并在调用点检查返回值；实际多设备/存储满时能否完全保数据仍待测试。
  - `forum/forum-detail.html` 分享消息已经优先调用统一的 `PhoneStorage.saveChatHistory` 并读回验证；不能仍按旧报告宣称“完全未检查”。
  - `chat/shake/shake.html` 新角色欢迎消息已校验 `saveChatHistory` 返回值并提示失败；仍需真实流程测试。
- 旧审计在代码变更后必须复查，**静态修补 ≠ 完成真实回归**；避免重复派人“修复已改过的地方”，也避免忽略别的存储写入路径。
- `vite.config.js` 使用 `base:'./'`，源码里有以脚本 URL 反算项目根的导航；这些属于**排查线索**，尚不能仅凭这一行证明目录叠加根因。

## 执行方式

1. 全局风险只在本登记册 + [REMEDIATION_BACKLOG.md](REMEDIATION_BACKLOG.md) 更新一次；功能/修复进度回到**原 PR**，不创建竞争性“总修复大杂烩”分支。
2. 先处理 **NAV-001 路径复现与跨目录回归**，并行只读核查 NAV-002、数据保存/备份及正式路由；每个问题明确唯一负责文件集合和测试证据。
3. 任何修复均是 **任务登记 → 原 PR 开发 → Node/构建/浏览器 → 唯一隔离 QA → 整合审核 → 正式发布前安全核查 → 用户批准 → 线上复验**。
4. 未经明确批准，**不合并 main、不动正式 Cloudflare、账号或数据库、不删用户数据**。

### 当前结论

- **本次已完成：** main 目录/90 页直接静态链接源检查、已有相关测试和 PR 关联、关键代码级缺陷定位、当前 Bug 分类登记。
- **本次未完成：** 90 页运行时点击遍历、所有 JavaScript 动态路径求值、真实打包与 Playwright 运行、Cloudflare 独立 QA 访问、Android/iPhone 真机复验。因此绝不声称“全站 Bug 已找完”或“路径叠加已修复”。
