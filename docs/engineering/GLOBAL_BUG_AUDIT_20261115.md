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

## 新增统一应用网址与导航体验（2026-11-15 用户明确提出）

**NAV-003 · P1 · SOURCE-VERIFIED 当前实现 / PRODUCT REQUIREMENT：对外暴露 `.html` 深层文件路径，缺统一的应用级可见 URL。**

与 `NAV-001` 严格区分：
- `NAV-001`：链接**错误地重复/叠加目录**，是待动态复现的跳转缺陷；不能拿 `/chat/chat/chat.html` 这种合法源码路径直接证明出现重复 bug。
- `NAV-003`：即使路径完全正确，用户仍明确**不接受浏览器把内部多级文件夹和 `.html` 暴露为小手机对外导航体验**，希望整个小手机是一个统一站点和统一操作入口。这是现有 MPA 的已确认产品体验缺口，而非“修一下路径”就自动满足的要求。

**源码证据：** `index.html` 的桌面 `app-tile[data-href]` 直接指定 `chat/chat/chat.html` 等物理文件，并以 `new URL(href, document.baseURI)` + `window.location.assign(destination.href)` 执行整页跳转；`worker-app.js` 仅把 `/` 映射为 `/index.html`，其余请求原样交给 `env.ASSETS.fetch(request)`。用户截图中的物理路径显示与此设计一致。

**2026-11-15 参考仓库复核（用户已在自己 GitHub 收藏/复制，之前已要求学习，不得再遗忘）：**
- [`Bella0960/mingruis-miya`](https://github.com/Bella0960/mingruis-miya)：[`index.html`](https://github.com/Bella0960/mingruis-miya/blob/main/index.html) 本身承载桌面 `#miya-phone-layer` 与 `data-app` 应用入口，而不是每个图标导向独立物理页面；[`js1/app.js`](https://github.com/Bella0960/mingruis-miya/blob/main/js1/app.js) 的 `launchApp(id)` 调度 `APP_HANDLERS[id]`，通过 `window.miyaLazyEnsureApp(id)` 确保应用加载；[`js2/miya-lazy-boot.js`](https://github.com/Bella0960/mingruis-miya/blob/main/js2/miya-lazy-boot.js) 按应用/功能组动态加载脚本与 CSS。**可学习：一个桌面主壳、统一 App 注册/开启/关闭、按需加载，保持原生 JS。**
- [`Bella0960/ai-virtual-phone123`](https://github.com/Bella0960/ai-virtual-phone123)：[`app/page.tsx`](https://github.com/Bella0960/ai-virtual-phone123/blob/main/app/page.tsx) 统一渲染 `<MainApp/>`；[`components/main-app.tsx`](https://github.com/Bella0960/ai-virtual-phone123/blob/main/components/main-app.tsx) 连接 `DesktopShell`，[`components/desktop-shell.tsx`](https://github.com/Bella0960/ai-virtual-phone123/blob/main/components/desktop-shell.tsx) 中 `activeApp / setActiveApp` 与 `renderAppBody()` 通过同一壳切换内置应用，单独为定制应用保留运行器。**可学习架构边界；不代表要将 MAOMAO 改写成 React / Next.js。**
- [`Bella0960/jrsy`](https://github.com/Bella0960/jrsy) 是 [`htfc786/jrsy`](https://github.com/htfc786/jrsy) 的 fork；Git 树含 `baby-plugin.js`、`live-plugin.js`、`multi-offline-plugin.js`、`notebook-plugin.js` 等插件、`manifest.json`，**无主 `index.html`**，不能据此声称已核实完整桌面框架。其 `manifest.json` 用 `display: "standalone"`，属于 PWA 安装呈现，不等于 iOS 原生 IPA。
- [`Bella0960/qqjrsy-520`](https://github.com/Bella0960/qqjrsy-520) 是 [`yyasat/qqjrsy-520`](https://github.com/yyasat/qqjrsy-520) 的 fork；实际 Git 树含 **3,118,857 字节的 `index.html`**（**不是空文件**；GitHub `fetch_file` 因超大文件读取限制返回空内容，**无法据此推断其内部全部页面机制**），以及多份可直接读取的独立插件。例如 `baby-plugin.js` 的 `openBabyListScreen()` 调用宿主 `setActivePage('babyListScreen')`；`multi-offline-plugin.js` 把子页面 `#multiOfflineScreen` 动态注入宿主 DOM、在插件对象 `MultiOfflinePlugin` 中维持活动状态；`notebook-plugin.js` 通过 `.active` 切换固定页面；`cross-reality-plugin.js` 在宿主插入多张 `.page` 子页面。**能够验证的是“宿主页面 + 插件模块 + 宿主页面切换 API”这一模式，尚未验证 3.1 MB 主文件内部的完整路由实现。**
- **qqjrsy-520 值得借鉴，但须规避的缺点：** 超大单文件使整体回归/定位困难；部分插件通过 `window` 全局函数、直接 `innerHTML`/动态 `<style>`/DOM 注入与宿主耦合；直播/其他插件会自行隐藏系统状态栏，容易产生模块之间状态和 CSS 冲突。MAOMAO 应提供一套显式注册/卸载/样式作用域/统一状态栏事件的接口，**不能复制“一个 3 MB index + 各插件修改全局 DOM”的做法**。
- [`Bella0960/FlutterCppWangWangPhone`](https://github.com/Bella0960/FlutterCppWangWangPhone) 是 [`Liunian06/FlutterCppWangWangPhone`](https://github.com/Liunian06/FlutterCppWangWangPhone) 的 fork，**确实含 Flutter 工程 `wangwang_phone/ios/`、`Runner.xcodeproj`、`AppDelegate.swift`**，以及 [`build-ios-ipa.yml`](https://github.com/Bella0960/FlutterCppWangWangPhone/blob/main/.github/workflows/build-ios-ipa.yml) 的手动 `workflow_dispatch` / `macos-14` / `flutter build ios --release --no-codesign` / 未签名 IPA 打包，**仅证明构建链配置存在，不证明成功签名安装或 iPhone 已测试通过**。其 Flutter `main.dart` 统一引导 `WangWangApp`，`app.dart` 中 `MaterialApp` 统一启动/锁屏流，`home/home_page.dart` 用 `WangWangAppModule` 枚举管理应用，`ChatAppController` 封装聊天状态/生命周期。**可学 iOS 安全区、统一 app 管理、状态模型和跨平台边界，但无需把 MAOMAO 的 PWA 转成 Flutter/C++ 或照搬其 UI。**
- **参考工程对 MAOMAO 的落地约束：** 
1. **主外壳仍只有一套**：启动、桌面、状态栏、导航栈、返回、字体/主题与窗口焦点由公共模块统一控制，各 app 只提供 `id / open / close / mount / unmount / restore` 或等效生命周期接口；错误/未接入旧页面允许降级，避免“一次迁移 90 页”。
2. **不复制巨型单文件**：参考 JRSY 插件化，但不照搬 `index.html` 巨型结构、散落全局函数和直接修改系统状态栏的 CSS；共享数据访问统一走已审计的 PhoneStorage/Repository，继续做失败保护和备份校验。
3. **两端形态区分**：安装到主屏幕的 iOS Safari PWA（`display: standalone`、安全区、通知权限等）与 Flutter 原生 iOS IPA 是不同路线；现阶段 MAOMAO 交付主线仍为现有网页/PWA，不因参考仓库存在 iOS 工程就自行添加 IPA 编译或 Apple 签名管线。
4. **验收不是看 URL**：除了地址栏简洁，还必须验证跨 app 的聊天历史/角色身份隔离、通知深链接、前进后退、卸载/重复挂载、浏览器刷新恢复、PWA 缓存、Android Chrome 与 iPhone Safari。禁止向正式账号/数据库做实验。
5. **来源界限**：本轮确实读到 JRSY 各插件、Miya 公共启动和汪汪机 Flutter/iOS 文件；**尚未读到 qqjrsy-520 3.1 MB 主 `index.html` 的完整内容、也未运行参考工程**，不能写成“已经验证其全站零 Bug”或“全部源码已学习”。参考仅提取设计思想，不复制未经确认许可的源码或素材。

**差距确定：** MAOMAO `index.html` 点击 `data-href` → `window.location.assign` → 多页物理 `.html`；Miya 是统一壳注册应用，AI Virtual Phone 是统一 `MainApp` 状态驱动切换。用户已经要求多次统一底座，不能仅以“当前地址路径合法”结束任务。
- **面向现有工程的推荐实现顺序：** 在已有导航/整合任务内先确立 `AppRegistry`（注册/打开/关闭/来源/生命周期）与稳定的 URL/History 契约，再按高频功能逐个适配统一壳；未适配旧 MPA 页面保留安全 fallback 和深链接兼容，禁止一次性重写 90 页，先做回归与 QA 验收。只读参考技术思想，具体 UI/功能须原创并符合既有项目审美/数据隔离要求。

**产品目标和严格技术边界：**
1. **稳定的统一域名**：正式目标入口仍是 `https://app.mao520.com/`；不得出现把用户导航分散到其它测试 Worker / 各种子域名的情况。
2. **优先最小影响的简洁地址**：例如公开路由 `/chat`、`/forum`、`/wallet`、`/settings`，Worker / 客户端公共导航映射到现有 HTML 文件；保留旧 `.html` 深链接兼容。**这是短网址，不是“所有页面只显示根域”。**
3. **若验收目标是地址栏始终只显示 `app.mao520.com`**，必须先设计可行的单一应用外壳/统一客户端路由及前进后退、直接打开、刷新、PWA、分享、通知深链接和 Android/iPhone 兼容方案；**仅 Worker rewrite 不会在 MPA 整页导航后自动保持地址栏为 `/`**，也不能靠 `history.replaceState` 假装实现所有导航。不能为了隐藏路径而大规模嵌套 iframe 或破坏已做完的页面。
4. **保留现有内容**：不得删除/重命名 90 个 HTML 页面，不更改账号/聊天数据库/角色 ID/主题/存储键，不重做 UI；只评估和实现逐步兼容的最小路由层。验证路线先在**现有导航/整合 PR** 中认领，避免另造路线重复 PR。
5. **验收**：Chrome 浏览器中连续跳转多个功能、刷新、复制链接直达、浏览器返回、PWA 安装/离线、聊天图片、跨角色会话、Android/iPhone；用户看到的地址应符合明确选择的最终目标，内部物理路径不能被错误叠加；实际服务地址与 QA/正式 Worker 映射一并记录。

**状态：** 需求和源码事实已确认；短路径/始终根域的产品目标仍需明确区分；尚未改客户端导航或 Worker，未完成浏览器、QA 和真机验收。不能标记为“已实现”。

## 全项目 Bug / 高风险清单（按优先级）

| ID | 级别/证据 | 问题及当前核查事实 | 原任务/PR 与下一动作 |
| --- | --- | --- | --- |
| **PROD-001** | **P0 · 配置已核查，真实运行待复验** | `app.mao520.com` 目前绑 `curly-dream-324c`，原先只读核查 `MAO_APP_CUTOVER_ENABLED=false`；`mao520.com` 的账号库却是另一个 Worker。不能因正式账号可登录而宣称完整小手机 API 接通。| 候选 **#285**，子改动 #292/#295；先核验正式域名/自动 Build trigger、原管理员及普通成员数据连续性、加密备份与隔离恢复，不作生产切换。 |
| **DATA-001** | **P0 · SOURCE-VERIFIED 架构风险** | 聊天历史 `chat_history_<id>` 仍主要以每会话完整数组存 localStorage，富媒体/存储配额及跨角色隔离风险尚须统一回归；不能随便迁移/删除历史。| 复用 backlog **DATA-001/002/005/006/007/008**、[调用台账](../chat-history-callers.md)；优先测试失败保护、备份恢复，再做非破坏迁移。 |
| **CHAT-HISTORY-001** | **P0 · SOURCE-VERIFIED 数据覆盖风险** | `chat/chat/chat-detail.html` 的 `forwardMessage()` 用 `try { JSON.parse(localStorage.getItem(key) || '[]') } catch { arr=[] }`，非数组也强制置空，随后直接 `localStorage.setItem(key, JSON.stringify(arr))`。**当目标角色聊天主键已损坏时，转发会以单条新消息覆盖原始损坏内容。** 同样代码仍出现在当前开放的 #282 分支（约 7492–7548 行）。此结论来自确定性的源码执行路径，尚未跑浏览器破坏性测试。 | **原 PR #282**（chat primary history fail-closed）；先在隔离测试数据中补“转发至损坏/非数组/不可读/缺失且有 v2 备份的角色”测试，转发应失败且原始字节不动；任何媒体引用创建后必须回滚；修复统一采用已保护的 PhoneStorage 事务式写入，禁止错误 JSON 变成空数组再写。**不动正式数据。** |
| **QA-001** | **P0 发布门禁** | 真实跨页、Android/iPhone、独立 QA 后端验收不能以 Node 静态检查或旧 CI 成功替代；固定 QA URL 未核实，不能提供伪测试地址。| 统一 [RELEASE_PLAYBOOK](RELEASE_PLAYBOOK.md)，QA-001；先核实唯一 QA Worker 与可访问 URL，严禁用生产数据库测试。 |
| **NAV-001** | **P1 · USER-REPORTED / NOT VERIFIED** | 用户反馈跨文件夹路径叠加。90 页静态直链扫描未发现可解析目标丢失；运行时字符串拼接、部署子路径及缓存尚未完成验证。 | 参照上方验收，关联 #207/#159/#160，不宣布修复，不新开重复分支。 |
| **NAV-003** | **P1 · SOURCE-VERIFIED 架构/产品体验缺口** | 现有桌面把各模块作为物理 `.html` 文件跳转；Worker 只对 `/` 映射 `index.html`，其它 URL 原样服务，导致浏览器地址栏展示多级文件路径。用户要求统一的小手机入口和对外导航，**与 NAV-001 的错误路径叠加不是一件事**。 | 在原导航/整合任务中先评估渐进式短 URL `/chat` 等与单一根域应用壳两类目标的实际代价，不能只靠 Worker rewrite 承诺永远显示根域。优先最小兼容路由，保留现有页面和账号/数据；真实 Chrome/Android/iPhone 验收。 |
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
2. 先同步处理 **CHAT-HISTORY-001 防止转发覆盖损坏数据** 和 **NAV-001 路径复现与跨目录回归**，并行只读核查 NAV-002、其他数据保存/备份及正式路由；每个问题明确唯一负责文件集合和测试证据。
3. 任何修复均是 **任务登记 → 原 PR 开发 → Node/构建/浏览器 → 唯一隔离 QA → 整合审核 → 正式发布前安全核查 → 用户批准 → 线上复验**。
4. 未经明确批准，**不合并 main、不动正式 Cloudflare、账号或数据库、不删用户数据**。

### 当前结论

- **本次已完成：** main 目录/90 页直接静态链接源检查、已有相关测试和 PR 关联、关键代码级缺陷定位、当前 Bug 分类登记。
- **本次未完成：** 90 页运行时点击遍历、所有 JavaScript 动态路径求值、真实打包与 Playwright 运行、Cloudflare 独立 QA 访问、Android/iPhone 真机复验。因此绝不声称“全站 Bug 已找完”或“路径叠加已修复”。
