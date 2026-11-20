# MAOMAO Execution Log

## 2026-11-18｜CHAT-UI-001｜聊天留白进入唯一 QA 整合分支

- **从原 PR #264 对接原 #299，不新建 PR/Worker/数据库。** QA 起点 `81ec1e81b06f3e63f3cc46da27310f9f7c5f3eec`，从原 PR #264 定向复制 `shared/css/chat-light-surfaces.css`，仅在当前 QA 的 56 万字符聊天详情页精确加入 body class / CSS link / 默认与 iMessage 的原生发送按钮同步（增加约 1010 字符），聊天列表仅增加 109 字符；`shared/js/chat-beauty.js` 仅添加默认主题独立参数（890 字符），不覆盖 QA 新账号/人设/群聊/番外。
- **修复主题设置兼容：** 在原 PR 与 QA 双分支将 `getDefaults()` 的 light 值仅限 `default` 预设，微信/iMessage/QQ/银蝶继续自己的默认值，角色自定义颜色/背景优先级不变。两侧新增跨主题回归；本轮未迁移存储、不改历史键值或账号后端。
- **真实验证边界：** 从已整合的 QA 真实 GitHub 源码读取相关 HTML、JS、CSS，使用隔离 V8 与 Node API 兼容桩执行原专项测试，**13/13 PASS**；这是源码逻辑执行，不是完整 `node --test`。Chromium 浏览器脚本原来依赖外部 localhost:3000，已改成在本地启动已有 Vite preview、读取真实 `dist`、仅允许回环网络，禁止请求线上账户/AI/推送。脚本解析通过，**仍未实际跑 Playwright**。
- **发布门禁：** QA 现有 `scripts/qa-direct-release.mjs` TESTS 增加真实 `node --test tests/chat-light-surfaces.test.mjs` 和 `node tests/chat-light-surfaces-browser.mjs`（在 build 后执行）；不新建 Actions，未触发任何现有部署或发布。后续需完整私有 checkout 执行 `npm ci` / Node / Vite / Playwright，确认 375/390/430 手机视口及真机输入法/保存/主题兼容，QA 通过才允许仅现有 Worker-only 部署。
- **QA 状态：** 代码已集成且保留旧 QA 测试数据；线上 `preview.mao520.com` **尚未通过本次部署验收**，不宣称用户已看到新样式，更不能当正式发布。失败仅回原 #264 修复再定向同步。没有触碰 `main`、正式域名、身份核心、数据库或密钥。


## 2026-11-17｜QA-ACCOUNT-CONTEXT-304｜管理员 001 页面缓存上下文恢复（已提交，未部署）

- **用户现象：** `https://preview.mao520.com/admin/admin-center.html` 显示 `ACCOUNT_CONTEXT_REQUIRED`，账号统计和列表无法读取；不是零账号的成功回执。
- **Cloudflare 只读核查：** `preview.mao520.com` 的 Worker 自定义域名绑定为现有 `maomao-aw-qa-20261114`，该 Worker 的 `MAO_IDENTITY_AUTHORITY` 指向现有 `maomao-identity-core`；线上已部署版本 `10d77af9-e4fb-4678-90f8-ab1010202954`（2026-11-17T14:51:27Z），其脚本资源设置 `raw_run_worker_first=true`。未读取或修改用户资料/账号记录。
- **代码级缺口与修复：** 原 `worker.js` 把带条件缓存头的私有 HTML 原样转交静态资源，若静态服务返回 `304`，`injectAccountScope` 因响应非 `ok` 而直接返回，浏览器会重用没有账号注入的旧 HTML。仅在已确认会话的私有 HTML 导航中移除 `if-none-match`、`if-modified-since`、`if-range`、`range`，强制得到可注入的 HTML；旧会话/权限门禁未放宽。`admin/admin-center.html`、`sw.js` 的管理脚本 URL 升为 `20261117-ui3`，避免复用旧管理脚本。
- **回归：** `tests/worker-page-auth-runtime.test.mjs` 新增条件 `304` 模拟断言，验证必须收到账号 meta、200、no-store；原 `tests/admin-center-mobile-release.test.mjs` 同步版本校验。GitHub 上五个文件的当前文本/版本已再次读取，静态断言 5/5 成立，**未执行 Node/Vite/Chromium 或真机**。
- **提交：** `7e33e7c`、`3798163`、`02df2fd`、`81fb54d`、`f3373d6`，均提交在已有 PR #299 的 `integration/account-fanwai-stack-20261115` 分支。
- **剩余阻塞：** 先在完整现有 Codespaces checkout 中执行 `node --test tests/worker-page-auth-runtime.test.mjs tests/admin-center-mobile-release.test.mjs`、`npm run qa:release:check`；全部通过后仅按原安全发布脚本执行已有 QA Worker-only 发布，再核对新 Cloudflare 版本和 `preview.mao520.com` 实际管理员登录页。未授权正式版、main 或 identity core 变更；现在线上截图所见问题不能声称已修复。


## 2026-11-17｜MUSIC-UI-001｜同步现有 QA 整合分支（代码已到，云端未发布）

- **用户确认需求：** 复核音乐首页与播放页整体效果，并尽快在手机上通过现有唯一 QA 测试。坚守只合到 QA、不合并 main、不触动正式服务及管理员账号。
- **发现与修复：** QA 分支已经包含 #303 的备份、音频导入、歌词、封面及歌单代码；只有 Now Playing 整体居中与短屏滚动布局没有同步。经过逐字归一化比对，确认改动独立后将 `music/music.html`、`tests/music-lightweight-default.test.mjs`、`tests/music-mobile-browser.mjs` 同步至 QA 分支，未覆盖现有账号、聊天和其他模块。
- **真正的功能阻塞：** 音乐页几十处调用 `toast()`，却没有定义、没有 DOM 容器，保存成功/失败提示会抛 JS 错误。已在 PR #303 与 QA 分支同步修复为按需出现的灰黑轻量提示；修复收藏/最近播放读取异常被覆盖、写入配额失败静默吞掉、收藏失败仍变心形、播放进度保存失败无提示、播放计数失败中断成功播放等问题。新测试含配额/损坏记录防覆盖。
- **发布路径安全：** 原 `--deploy` 重发 QA 身份核心，本次音乐前端不应做此动作；扩充原有 `scripts/qa-direct-release.mjs` 的 `--qa-only` 模式，真实测试之后只上传当前 Worker，保证核心版本前后不变；新增 `npm run qa:release:worker-only` 入口和 QA-only 契约检查，并把音乐 Chromium 手机视口脚本加入 release TESTS。
- **只读云端核对：** 现有 QA `maomao-aw-qa-20261114` 仍存在；最新一次 Cloudflare 已部署时间为 2026-11-16T19:51:47Z，版本 `5954a708-ba4d-48df-b17f-02b0116b75ef`。19 项运行变量与仓库 QA 配置完全一致，MAO_IDENTITY_AUTHORITY 仍连隔离 core；QA/Core SQL 只读计数各 1 个账号、1 个启用的超级管理员，记录行写入 0。
- **执行证据与诚实状态：** 最新 QA 文件与原音乐 PR 的 7 个音乐/备份文件 SHA 已核对一致。缺失 toast 的源码实锤已修；隔离 V8 实际调用 toast、收藏失败、防覆盖和播放进度配额逻辑 5/5 通过；QA-only 合同隔离执行 1/1 通过，JS 语法检查通过。**这些不等于完整 Node/Vite/Chromium 验收**，本窗口无该仓库的可执行完整 checkout。**没有把新代码部署到 Cloudflare QA**，不能提供已更新的可测链接。
- **唯一剩余动作：** 在现有 Codespaces 该 QA 整合分支拉最新 HEAD，凭本地安全配置的 Cloudflare 凭证直接运行 `MAOMAO_QA_DEPLOY_CONFIRM=maomao-aw-qa-20261114 npm run qa:release:worker-only`（命令自身先跑完整 Node、Vite、Chromium 门禁，全部通过才只发布 QA Worker，不重发身份核心；避免先 check 再重复测一次），核对 Cloudflare version 已更新后才通知用户手机测试。若任何检查失败，停在 QA，不修改 main 或正式版。


This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

## 2026-11-16｜PR #299｜真实 QA 工程构建环境接入（Codespaces，未启动）
- **目标**：不建第二套项目或 QA，接续已有私有仓库分支 `integration/account-fanwai-stack-20261115`；仅原 PR #299，**不合并 main，不自动部署正式版/QA**。
- **已提交**：`.devcontainer/devcontainer.json`，GitHub 提交 `731649420084aa82e8e8c1e3d87a3d36d60452c5`。使用 Node 22 Dev Container；Codespaces 创建时 `npm ci --no-audit --no-fund`，随后 `npx playwright install --with-deps chromium && npm run qa:release:check`。这使自动测试在 Codespaces 真实源仓和容器里执行，而不是使用零散 GitHub 文件的模拟测试；若任一阶段失败，保留原错误供排查。没有新增 GitHub Actions 工作流、Cloudflare Worker、数据库、PR 或自动部署。
- **配置静态验收**：从 PR #299 最新 HEAD 读取上述 Dev Container 文件、`package.json` 及原 `scripts/qa-direct-release.mjs`，检查 Node 22、npm ci、Chromium 系统依赖、QA 全套 Node/Vite/浏览器脚本、无 `--deploy`/自动上线，**8/8 项通过**。配置可解析，但**Codespace 尚未启动，Node/Vite/Chromium 实际通过状态 NOT VERIFIED**。
- **已确认可运行工具的边界**：本聊天有 Node 22/npm/Git，但没有私有 MAOMAO checkout 或直接创建/操作 GitHub Codespaces 的连接器动作；现有 GitHub 连接器能写仓库，无法在 Codespaces 终端运行命令。只有用户在 GitHub 的 Code → Codespaces 打开上述分支创建 Codespace，才能执行真正的自动预检。Codespaces 使用独立用量/配额，不能保证本账户有足够额度。
- **先前真实 Cloudflare 只读预检**：唯一 QA `maomao-aw-qa-20261114` 仍绑定旧网关；原 QA 影子管理员 ID 匹配且独立身份 core 库为空，两个 Worker 原有密钥和独立 DO namespace 保留，真实 `cloudflarePreflight` 函数对实测回执 PASS。不需要删数据库、重设密钥。该预检不是编译/部署成功。
- **最短剩余步骤**：Codespace 真实 `npm run qa:release:check` 全部通过→使用已有 QA-only 身份凭据和安全权限，仅更新原 `maomao-identity-core`、再更新原 `maomao-aw-qa-20261114`→从原 workers.dev URL 实测初始化 001、关闭一次性入口，验收登录/退出/刷新及聊天/番外。**云端 Worker 版本仍旧，本轮没有部署。**

## 2026-11-16｜PR #299｜关键阻塞集中清理：两项真实回归测试漂移已修

- **当前 HEAD：`909c75a14a736c4181cc82f0670e884ca9472204`**；原 PR #299 继续 Draft（基于 #290 最新 head），无新 PR/环境/数据库，Cloudflare、正式版、main 皆未改。
- **已修正一个确定的真实测试门禁阻塞**：先从原 #299 取回 `tests/account-qa-bootstrap-route.test.mjs` 和 `account/account.js`，按整份测试文件执行 10 个案例：**8/10**，两项测试失败。原因是后续已实现“QA 初始立即隐藏注册入口”，使旧测试的 `syncLoginAvailability(); function showPanel()` 邻接断言及从 `syncLoginAvailability` 截取到 `showPanel` 的测试桩不再正确。
- **修复提交 `909c75a14a736c4181cc82f0670e884ca9472204`**：只改 `tests/account-qa-bootstrap-route.test.mjs` 两处，改为断言真正的 QA 初始注册防护，忙碌态测试只提取两个目标函数而不混入初始 DOM 副作用。再次运行同一整份测试文件：**10/10**。这是使用模拟 Node 接口的 V8 原源码测试运行，并非完整仓库的 `node --test`。
- **额外定点复测**：使用同一提交的 GitHub 原源码、测试和合成依赖，执行 `tests/qa-identity-bootstrap.test.mjs`：**12/12**；执行 `tests/qa-release-live-version.test.mjs`：**16/16**。三份合计 **38/38** 模拟执行通过；不能冒充 `npm ci`、Node 测试 CLI、Vite、Chromium 或真正的 Cloudflare 登录。
- **会话问题已排除**：最初怀疑 core `/api/accounts/logout` 不处理 Bearer；追踪 `worker/lib/account-auth.js` 实际 `cookieValue(request)` 函数发现它同时读取 Cookie 和严格格式 Bearer，因此原 QA 的 Bearer 注销并不缺失，**未做无依据的修改**。
- **剩余真实阻塞（按优先级）**：① 在同一完整私有 checkout 下实际跑 `npm ci`、全量 Node、Vite、Chromium；② 按现有验证门禁将 #299 核心代码部署至**现有** `maomao-identity-core`，再仅切换现有 `maomao-aw-qa-20261114` 的 Service Binding；③ 由用户在原 QA URL 使用已保存的 QA-only Secret 进行 001 首次初始化，独立新 QA 登录密码、同步关闭 setup，验收登录/刷新/退出、历史聊天/番外和 PWA 手机。不可绕过真实构建后直接部署或触碰正式管理员数据。
- **Cloudflare 前次已验证现场**：现有 QA 仍绑定 `maomao-001-identity-gateway-20261114`，原 QA 库唯一 active founder 001；独立 core 库仍为空且已配双 Secret。代码在 PR，不得宣称已部署。

## 2026-11-16｜PR #299｜QA 注册误入口 + 原运行开关一致性 + Worker 路由安全

- **原则**：仅继续原 #299 与 #290 堆叠，不新建 PR/QA Worker/数据库；未合并 main、未部署新版 QA/核心、未修改正式 Worker/账号/密钥或任何 DO 数据。
- **前端误入口已修**：在唯一 QA workers.dev 页面初次执行脚本时立即隐藏注册按钮；即使旧标签页或手工事件提交 `registerForm`，也会在读取 FormData/密码、发送请求前阻断。正式/本地注册保持原样。原 `tests/account-qa-bootstrap-route.test.mjs` 增加前端初始按钮与直接提交保护。隔离 JS 执行真实 GitHub 源码：5/5 场景符合预期，阻断情况下没有账号 API 请求。
- **真实 QA 配置核对与防回归**：Cloudflare QA Worker 的 17 项现有非密钥 plain-text 变量与 `wrangler.qa.jsonc` 对应项一致，发布候选仅新增两项 QA 身份变量。原发布脚本新增 `verifyQaRuntimeVars`，禁止意外更改自主活动、聊天、推送等运行变量、缺失已有变量或偷偷重新开启已关闭的 QA 初始化；只允许身份库确有原 founder 后执行 `isolated_authority → disabled` 单向关闭。原 `tests/qa-release-live-version.test.mjs` 更新；以 Cloudflare 当前真实 17 项变量为基准，模拟 7/7 状态符合预期。
- **关键隐患：Wrangler 默认可能重新开启身份核心 workers.dev**。从 Cloudflare 官方文档证实：若 Worker 仅在 Dashboard 关闭 `workers.dev`，没有在 Wrangler 文件声明 `workers_dev=false`，下一次 Wrangler 部署会重新公开路由。现网 core 明确是 `enabled=false`，QA 唯一测试入口 `enabled=true`，两者 `previews_enabled=false`。在两份原 Wrangler JSONC 配置写明 `core: workers_dev=false, preview_urls=false`、`QA: workers_dev=true, preview_urls=false`；发布脚本在 Cloudflare 上传前、core 上传后、QA 上传后共三次读取真实 `/subdomain` 并 fail closed。原测试文件增加 2 项。真实 Cloudflare 路由数据通过，新代码对“core 意外公开 / preview 意外开启 / QA 入口关闭”四种伪造错误回执全部拒绝。
- **具体注意**：文中的 `workers.dev/preview_urls` 公开开关与 Cloudflare 的其它版本 URL/部署 URL 不应混为一谈。核心真正的部署、绑定、权限、登录、设备与手机验收仍是 NOT VERIFIED；不可据此声称完整安全验收已通过。
- **剩余阻塞**：原 #299 私有仓库缺完整本地 checkout，不能真实运行 npm ci、完整 Node、Vite、Chromium 或 Wrangler。等有完整执行环境，先执行真实测试，部署原 core→唯一 QA；由用户使用原 001 + 已设置 QA Secret 创建独立 QA 密码，立即关闭 setup 并同步配置，然后验收真机登录/退出/刷新、旧角色/聊天/番外。不得要求重复创建密钥或改正式密码。

## 2026-11-16｜PR #299｜精修 QA 登录可见性、忙碌态和 PWA 资源一致性

- **本轮范围**：沿用用户指定的原 #299 集成分支，保留所有数据/现有 Worker/原 PR，不合并、不部署 QA 或正式，也不执行 Cloudflare 数据库写入。检查并遵循原 `AGENTS.md` 和 QA 身份交接约束。#299 base 对应现有 #290 HEAD。
- **问题一（可见性）**：在 `account/account.js` 中的“QA 使用独立密码、不要使用正式版密码”提醒被 `account/ivory-entry.css` 的全局 `.panel>.lead{display:none}` 隐藏。只对独立 QA 添加 `qa-login-hint` 显示样式；常规登录仍简约。原 `tests/account-qa-bootstrap-route.test.mjs` 增加真实源码和 CSS 合同测试。修正首次加入时测试桩字符串的换行语法问题，后续对 6 个相关 JS 文件做 V8 语法解析均通过。
- **问题二（登录忙碌态 + 默认关闭）**：原 `setAuthBusy(false)` 可能在身份 core 断联时恢复启用登录按钮。新增 `syncLoginAvailability` 并在请求完成后恢复准确状态；如果 `delegatedIdentity` 且 `!delegatedSignInReady`，在读取/提交表单密码之前直接阻断。进一步使唯一已知 QA workers.dev 域名从初始页面载入即保持未验证状态（不展示可用登录），当状态接口失败或意外报告 `local` 模式时隐藏注册入口并保持密码提交禁用。正常本地/正式入口不变。用原源码 DOM 桩测试忙碌态 4/4、QA 就绪/首次/错误模式/离线/普通 local/旧 gateway **6/6**；新增原 Node 回归测试。
- **问题三（旧 PWA）**：服务工作者对静态资源缓存优先，原 `account/index.html`、`account/bootstrap.html` 引用的 JS/CSS 版本号未更新。只更新登录 JS、登录 CSS 和初始化 JS 的引用为 `v=20261116-qa1`，不重置原缓存或存储。
- **发布门禁**：`scripts/qa-direct-release.mjs` 对原 QA workers.dev 地址匿名 GET 六项基础资源：身份状态、登录 HTML、登录 JS、源 CSS、初始化 HTML、初始化 JS；**额外解析并同源 GET 登录 HTML 实际引用的样式表**，校验 `qa-login-hint` 真正在渲染 CSS 中，兼容 Vite CSS 合并/指纹路径；不信任跨源 CSS、旧缓存或缺少资源的版本。新增 `dist/account/bootstrap.js` 与 `dist/account/ivory-entry.css` 构建检查。`tests/qa-release-live-version.test.mjs` 已增补旧资源、404、权威断联情况。
- **局部验证证据**：从 GitHub 最新 #299 HEAD 读取同一提交的实际 JS/CSS/HTML，执行原 `qaHttpSmoke` 源码（HTTP 响应为模拟），覆盖首次 QA/已初始化/旧登录 JS/旧 CSS/旧初始化 JS/旧初始化 HTML/旧登录 HTML/断联/资源 404，**9/9 PASS**。相关 JavaScript 的 V8 语法解析全部通过。以上均不等于实际 Node `node --test`、Vite 构建、Chromium 或 QA 线上 HTTP。
- **剩余阻塞**：当前工具没有完整私有仓库 checkout 和完整工程测试环境，尚不能安全执行 `npm ci` / Node/Vite/Chromium / Wrangler 上线。独立 QA core 尚未初始化，唯一 QA 仍需从旧网关切换，真实原 001 登录/退出/刷新及旧聊天/番外/PWA 真机验收仍需完成。不得声明生产或 QA 已更新。

## 2026-11-16｜PR #299｜QA 初始化允许原管理员永久 ID，避免误导重新配置密钥

- **本轮真实数据核验（只读）**：Cloudflare 唯一 QA Durable Object 查询原 founder `MAO-OXHBDBWCOIHPBBYN`，账号恰好 1、ID 精确匹配、role 为启用 super_admin、原用户名满足账号规则（不输出用户名本身），SQL `rows_written=0`。因此旧用户名不合法并非真实阻塞。
- **解决实际操作阻塞**：`worker/lib/qa-identity-bootstrap.js` 在显式 QA-only 单次初始化时，允许用户在管理员用户名输入框填**现有影子账号用户名**或**既有 founder 永久 ID**。服务端只把 ID 当查找别名，转发给独立 core 的用户名仍是 shadow.username，返回固定 founder ID；不允许传入外部 ID、改名、创建第二个管理员，不修改普通/正式初始化逻辑。
- **小范围 UI**：`account/bootstrap.html` + `account/bootstrap.js` 只有确认 QA 模式才显示「原管理员用户名或永久 ID」，允许最长 28 个字符输入 ID，普通本地初始化仍是 24 字符的用户名。QA 连不上身份服务时不要把它误报为 Secret 丢失，也不要叫用户重新生成已配置的 Secret。
- **新增测试**：原 `tests/qa-identity-bootstrap.test.mjs` 新增 QA ID 别名成功、陌生身份拒绝、QA 表单/提示约束。隔离 JS 运行现有 GitHub 后端初始化源代码 **4/4** 场景通过，模拟 DOM 执行原 QA 页面 `checkStatus` 源码 **4/4** 场景通过；使用本地模拟绑定/网络，不是 Cloudflare 实际初始化、完整 Node、Vite、Chromium 或真机验收。
- **范围和接续**：本轮只修改原 #299 Draft 分支，未部署 QA 或正式、未合并 main、未写账号数据。两项 QA-only Cloudflare Secrets 已在用户控制台设置，无需重复填。继续需要完整私有仓库真实构建与 QA Worker 发布门禁，通过后才允许真实 QA 初始化、关闭 setup 并手机验收。

## 2026-11-16｜PR #299｜保留 QA 密钥/构建产物 + 严格 SQL 验证（本轮）

- **只在原 PR #299 分支开发**。未经用户确认不合并 main、不部署正式或 QA Worker、不写入/迁移任何账号、角色、聊天、推送数据。执行环境有 Node 22、npm 和 Git，但没有私有仓库完整 checkout、GitHub 身份凭据或自动挂载工程文件，不能将 JS 模拟视为全量测试。
- **发布前阻断代码污染**：`scripts/qa-direct-release.mjs` 新增 `assertReadyForUpload()`，两次 Wrangler 上传之前各自核对远程最新提交、git 工作区无改动和必须存在的 `dist/index.html`、账号 HTML/JS、聊天 HTML 等 Vite 产物。防止构建/测试修改追踪文件或丢失构建产物仍被部署。
- **部署后避免丢失原有能力**：对 `maomao-identity-core` 与唯一 QA Worker 的全部 `secret_text` 名称做部署前后比对（只比名称/类型，永不读取密钥值）；额外核对 QA 的 `AI`、`ASSETS` 绑定都保留。避免发布成功却破坏账号/推送/静态资源。
- **数据库 SQL 回执不允许宽松转换**：`verifiedAccountCounts()` 必须看到 `rows_written === 0`、完整的 3 个 SQL 列、非负整数计数和一致的匹配范围；只允许真正 `COUNT=0` 且 SUM 为 null 的独立空库。缺字段、null COUNT、错误类型、伪造计数或任何写入都阻止发布。
- **测试**：`tests/qa-release-live-version.test.mjs` 新增工作区/构建/密钥检查、SQL 校验的真实源码回归。在隔离 JS 运行实际源码，上传前保护 4/4、SQL 回执处理 9/9；**本轮另直接通过 Cloudflare Connector 只读查询真实两个 DO，调用最新发布脚本 `verifiedAccountCounts` 函数检查均成功**：原 QA `accounts=1, matches=1, admins=1`；独立 core `accounts=0, matches=0, admins=0`，双查询 `rows_written=0`。无线上数据写入。
- **剩余**：必须在具备完整私有仓库的可信环境运行 `npm ci`、Node/Vite/Chromium 和浏览器测试，才能用 Wrangler 在原 QA Worker 上受控部署 core→QA；随后按原流程完成 001 的 QA-only 初始化、关闭一次性入口、真实登录和真机验收。不得绕过完整测试声称上线。

## 2026-11-16｜PR #299｜首次 QA 初始化入口与 QA 独立密码提示（本轮）
- **事实复核**：原 QA 代码的核心身份登录通过 `/api/accounts/login` 获取安全 HttpOnly 会话，后续 `/api/accounts/me` 使用 Bearer 验证、退出调用核心 `/api/accounts/logout`；本轮源码静态核对未发现必须推倒重写的会话适配问题。仍需要真实 QA 登录/刷新/退出验收。
- **问题 1 已修复**：`account/account.js` 曾在委托模式无条件隐藏 `creatorBootstrapLink`，即使独立 core 空库且 `qaSetupAllowed=true`，用户在原 QA 入口也找不到首次初始化。现在仅当状态接口明确返回 isolated QA + `qaSetupAllowed` + `bootstrapAllowed` + authority connected + configured + initialized=false 时，显示「设置 QA 独立账号密码」。已创建管理员、身份断联、旧 gateway、正式/本地错误状态均隐藏。普通 local 首次初始化保留。
- **问题 2 已修复**：`worker/lib/account-auth.js` 对状态接口新增非授权性质的 `qaIdentityCore` 显示标记，`account/account.js` 对 QA 提示“原管理员用户名/永久 ID + QA 单独设置的密码，不输入正式版密码”，普通委托页面保留原提示。生产身份校验从未依赖此显示标记。
- **问题 3 发布门禁**：`scripts/qa-direct-release.mjs` 从原 QA workers.dev 地址读取状态时，额外要求 `qaIdentityCore===true`，防止仍指向旧身份模式的页面误报成功；`tests/qa-release-live-version.test.mjs` 增加缺失标记拒绝案例。
- **回归**：从 GitHub 当前原源码执行隔离 V8 UI handler **7/7 场景通过**（首次空库显示、初始化完成隐藏、离线隐藏、关闭设置隐藏、外部 authority 隐藏、普通本地入口、旧 delegated），真实源码 QA HTTP helper **4/4 场景通过**（首次/已初始化、错误核心标记、登录页缺失）。**这些是桩模拟，不是完整 Node CLI、Vite、Chromium 或部署后的手机验收。** 新的 Node 回归断言已附原测试文件，待完整私有 checkout 执行。
- **现网边界**：未对 Cloudflare 做部署/绑定/身份数据库写入；两项 QA core Secret 已配，无需重复创建。原 #299 继续 Draft，不合并 main、不触碰正式版。

## 2026-11-16｜PR #299｜可验证发布版本 + 账号就绪 + 原 QA HTTP 验收门禁

- **任务目标**：在 Work 暂不可用、未配置完整私有仓库执行环境时，优先解除 QA 真实部署之前的确定性代码缺陷。只进原 #299，不合并 main、不部署正式或 QA、无数据库写入。
- **修复 1：真实版本回执**。修改 `scripts/qa-direct-release.mjs`：以 Cloudflare deployments API 核对 core 和 QA 部署前后 100% active 版本 ID，要求版本发生变化、部署来源为 Wrangler，缺失/分流/不合法信息 fail closed。新增 `tests/qa-release-live-version.test.mjs`。
- **修复 2：初始化关闭后正确回报账号就绪**。修改 `worker/lib/account-auth.js` 的 `/api/admin/bootstrap/status`：独立 QA core 在关闭一次性初始化后也会按真实权威探测状态回报 `configured`；断联仍 false，旧 gateway 和普通本地初始化行为保持不变。在 `tests/account-qa-bootstrap-route.test.mjs` 增加覆盖。
- **修复 3：原 QA URL 实际响应门禁**。发布脚本新增匿名只读 GET：从唯一 `maomao-aw-qa-20261114.miamor520000.workers.dev` 检查 `/api/admin/bootstrap/status`、`/account/index.html`；核对初始/已初始化两种生命周期和页面登录表单，失败时不承认验收成功。新增相关测试，不发送任何账号密码或 Cookie。
- **本会话局部验证**：直接从最新原 GitHub 读取并运行 helper 的隔离模拟，Cloudflare 版本检查 4/4 场景、QA 状态路由 4/4 场景、原 QA HTTP helper 3/3 场景符合预期。**不是**完整 Node CLI 测试，更不是 npm ci/Vite/Chromium、真实 Worker 发布或手机验收，不得混淆。
- **PR 关系**：#299 目前 base SHA 与上游 #290 当前 HEAD 一致（本轮真实只读核对），无需盲目重复同步。
- **仍缺真实证据**：完整 Node、Vite、Chromium 测试；两个 QA Worker 实际更新及版本/HTTP 回执；QA 管理员独立初始化、关入口、登录/退出/刷新和旧角色聊天/番外/PWA 手机验收。下一次直接接原 #299 最新 HEAD；**正式版/正式库禁止触碰**。

## 2026-11-16｜PR #299｜QA 身份就绪与初始化关闭门禁（当前轮）

- **范围**：只修改原 PR #299 分支；不合并 main，不触碰正式账号/数据库/Worker，不新建 QA 服务。
- **实际修复 1**：`worker/lib/identity-bridge.js` 的就绪探测针对已核对的现有独立 `maomao-identity-core` 不再依赖退役网关的桥接密钥；必须由内网 Service Binding 返回 `identityMode=local`、`qaIsolatedAuthority=true`、正确的 `qaExpectedFounderId` 和 `bootstrapAllowed=true` 才判断身份核心已连接。旧网关仍要求原共享密钥。新增 `tests/account-identity-bridge-probe.test.mjs` 测试隔离模式、错绑和关闭初始化旗标后的探测兼容。
- **实际修复 2**：`scripts/qa-direct-release.mjs` 根据独立核心真实账号数检查 QA 初始化变量生命周期：核心空库只允许 `MAO_QA_IDENTITY_SETUP=isolated_authority`，核心已有唯一 001 管理员则只允许 `disabled`，防止后续部署重新开启一次性入口。更新 QA 身份文档，明确运行配置与 `wrangler.qa.jsonc` 必须同步关闭，不关闭独立核心身份识别旗标。
- **测试依据**：从 GitHub 当前源码直接运行身份探测模块及其六项用例，隔离 V8 请求桩 **6/6 PASS**；发布脚本在独立 V8 模拟 git/Wrangler/Cloudflare 中验证空库+开启、空库+关闭、已初始化+开启、已初始化+关闭的组合，**4/4 PASS**。**没有**执行整仓 Node CLI、npm ci、Vite、Chromium 或真实 Worker 新版部署；这些结果不可替代实际验收。
- **现场限制**：当前对话仅可读取/修改 GitHub 和读取 Cloudflare，缺少整个私有仓库的可执行检出及完成部署的构建门禁。现网 core 为密钥配置后的旧代码版本，QA 仍旧 gateway；不得绕过测试或删除任一命名空间。
- **接续**：最新原 #299 HEAD 请以 GitHub 实时返回为准；在完整 checkout 运行真实测试并部署现有 core→QA；用户在唯一 QA 入口初始化后，将 QA setup 设为 `disabled` 并同步到原配置；再验证登录、数据保留、番外、PWA 和真机，最后讨论合并。

## 2026-11-16｜PR #290 账号安全专项 · 恢复教程门禁

- **范围**：在原 #290 分支修复实际代码/合并候选，不更新生产 Worker 或账号数据；未向 main 合并。
- **身份安全**：真实 Node 22 专项 `node --test tests/account-cutover-guard.test.mjs` 为 **6/6 PASS**，拒绝把 `nonPreview='false'` 或非 `super_admin` 身份源误认为合格管理员权威。正式库只读确认 3 个账号、1 个启用 super_admin，永久 ID 为 `MAO-OXHBDBWCOIHPBBYN`；不能由账号行存在推断密码、旧会话或恢复已验收。
- **确认的代码层阻塞**：`.github/workflows/tutorial-regression.yml` 会在 PR 修改用户界面而未更新 `tutorial/tutorial.js` 时明确报错。PR #290 曾修改 `index.html`、`settings/settings.html` 而没有同步教程。现已增补 **真实账号登录/账号管理 QA 指引**及 `tests/tutorial-page-contract.test.mjs` 契约断言，修复该工作流的文件变更要求；完整教程测试尚未运行。
- **GitHub Actions 基础设施阻塞**：早先失败 run 创建后约 2 秒结束，jobs 没有 steps，日志 BlobNotFound；代码测试实际上未被运行。暂不能证明到底是额度、计费、runner 还是其他组织策略阻断，禁止重复触发并冒充代码失败。
- **后续**：在有完整私有仓库的执行环境跑 `npm ci`、`npm run test:account:ui-candidate`、`npm run test:tutorial`、`npm run build`，修真实失败；确认 QA 与正式账号认证隔离后才能更新唯一现有 QA。正式发布仍须单独批准。

## 2026-11-16｜PR #299 番外堆叠 · 教程门禁整改

- **范围**：仅原 #299 分支，以上游 #290 账号安全候选为基础，不部署正式版、不创建新 QA、不改变角色聊天存档。
- **确认的代码层阻塞**：Tutorial Guide Regression 在 PR 修改 `chat/**` 等用户页面而未同时更新 `tutorial/tutorial.js` 时按工作流逻辑直接失败。#299 此前修改番外与聊天页面但遗漏教程更新。现已补 `番外剧场与隐藏故事设置（QA 待验收）` 指引，并在 `tests/tutorial-page-contract.test.mjs` 添加契约断言；同时保留 #290 新增的账号管理 QA 指引。
- **交互事实**：角色单聊「＋」→「番外」；故事页面「···」展开记忆方式、对话篇幅；可选不带记忆 / 参考角色记忆、40/80/100 条，番外不写主线聊天和长期记忆。尚未完成真实 QA 验收，不能称可正式发布。
- **CI 执行故障**：四项 GitHub Actions 运行在 job 无 steps 状态下失败；获取一个旧 job 日志返回 BlobNotFound。此信号说明尚未执行代码测试，不能作为 npm ci / Vite / Chromium 的证据，禁止无意义重试。
- **狭义核验**：对 PR 文件清单进行与 Tutorial Guide Regression 同样的界面目录规则匹配，现已包含 `tutorial/tutorial.js`。账号门禁单文件 Node 22 子集 **6/6 PASS**。整仓 `npm ci`、`npm run test:tutorial`、`npm run test:integration:account-fanwai`、`npm run test:fanwai:build-and-browser` 和 QA 实机尚未运行。
- **待办**：同步最新上游 #290 提交，确认 GitHub stacked branch `behind=0`，使用有完整仓库/依赖的真实工程环境测试，只有测试与身份隔离通过后才部署既有 QA。

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

## 2026-11-16｜现有唯一 QA 的直接发布入口（不使用 Cloudflare Builds）

- **目标**：让已含 #290 的 #299 完整候选有一条可执行的真实测试→原 QA 发布路径，不新建 PR、QA Worker 或正式版部署。
- **已提交**：`wrangler.qa.jsonc`（唯一 QA `maomao-aw-qa-20261114`，保留原 `CLOUD_DB` 类，`AI`、`ASSETS` 与 QA 运行变量，隔离身份服务绑定 `maomao-identity-core`）；`wrangler.qa-identity-core.jsonc`（仅现有隔离身份 Worker，设定 QA-only founder ID，无前端 assets）；`scripts/qa-direct-release.mjs`；`npm run qa:release:check` 和 `npm run qa:release:deploy`；`docs/engineering/QA_ISOLATED_IDENTITY_20261116.md` 追加执行说明。
- **脚本安全门禁**：必须是原 #299 分支且工作树干净；真实执行 `npm ci`、账号、账号番外整合、教程、聊天、PWA、Vite 及 Chromium 浏览器烟测。测试有失败即停止。发布还要求专门确认变量、Cloudflare QA-only 密钥已配置、QA/core 的 Durable Object namespace 与原管理员 001 唯一 active 身份只读校验通过。脚本绝不使用 `wrangler.jsonc` / `wrangler.app.jsonc` 正式目标。
- **静态验证**：实际 GitHub 原分支读回两份独立 Wrangler 配置、发布脚本及 package.json，10/10 项目标、绑定、配置、安全检查匹配，且发布脚本已经过 V8 语法解析（去除 ESM import 用于语法验证）。**这不是完整 Node/Vite/Chromium 运行结果**。
- **尚未实际发布**：本对话执行环境没有完整私有仓库/Node 依赖，无法执行新发布脚本；现有独立 `maomao-identity-core` 缺两项全新 QA-only secrets，脚本会 fail-closed。最新 QA Worker 仍是 11 月 14 日部署，**尚不能交付新版真实测试入口**。不要求等待 Cloudflare Workers Builds 额度刷新；应在可运行完整仓库的 Work/Codespaces/可信本地环境执行脚本，按结果修复，再直接 Wrangler 只部署两套 QA Worker。
- **没有执行**：任何 Worker 正式部署、现有 QA 部署、Cloudflare secrets 写入、用户/钱包/聊天/DO 记录改写、main 合并或其他 PR 创建。

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


## 2026-11-16 — 番外 PR #299：真实构建门禁的脚本版本契约修复

- **现有任务与归属**：续做番外联合草稿 PR #299，head `integration/account-fanwai-stack-20261115`，base 账号 PR #290；治理 Draft PR #300 仍未合入 main。没有创建新分支、PR、Worker 或测试数据库。
- **已确认的代码错误**：`tests/release-account-assets-gate.test.mjs` 将聊天扩展和番外 JS/CSS 资源查询版本固定为 `20261115`，但当前聊天加载器已更新为 `20261116`，导致真实 `node --test` 的发布资产检查在进入 Vite/Chromium 之前就可能错误失败。
- **本次实际修复**：提交 `4b32f73bed6e11aeeacec5bf0faa9be75b20a4ee`，将三个版本断言改为 `20\\d{6}` 日期结构而不固定特定日期，并校验聊天 HTML 只加载一份 extras、extras 只加载一份番外脚本。没有修改用户数据、聊天功能、生产 Worker 或发布流程。
- **代码级验证**：从 GitHub 读取本次 PR 当前源文件及相关 Worker、账号入口、Vite、发布 workflow，在隔离的 JS 执行器运行 `release-account-assets-gate.test.mjs` 的 **6/6** 同步契约断言，无失败。此项仅为 V8 合同模拟，不是实际 Node CLI 通过。
- **真实执行环境**：本地 Node `v22.16.0`、npm 可用，但当前容器没有挂载 MAOMAO 仓库，`vite`、`playwright` 依赖也未安装。故 `npm ci`、`npm run test:integration:account-fanwai`、`npm run test:fanwai:build-and-browser`：**NOT RUN — NO CHECKED-OUT REPOSITORY**。GitHub Actions runner 已知不可用，未重跑、未新建 CI 流程。
- **后续单一动作**：在可检出目标 SHA 的隔离执行环境按顺序运行现有 Node 联合回归、Vite 构建与 Playwright Chromium 双手机视口烟测；只按实际失败回 PR #299 修复，不把视口模拟当成 Android/iPhone 真机。当前仍为草稿；未合并、未部署、未碰正式账号/管理员/钱包数据。


## 2026-11-16｜番外 PR #299：浏览器安全门禁与删除提交顺序

- **唯一任务**：继续 PR #299 原分支，账号 PR #290 为 base；与其他共享 API、账号、状态栏负责人保持独立。沿用原版 HTML/CSS/JS、索引存档结构及手机「＋」菜单。
- **代码修复**：`de315157` 将 `erase()` 纳入 `episodeWriteQueue`，解决用户暂停/生成收尾后立即删除，晚到的 IndexedDB `put` 覆盖 `delete`、使故事重新出现的竞态。保留原始事务成功/失败语义、内存缓存及账号/角色校验；不迁移任何已有数据。
- **回归**：`e2c1334` 新增第 9 次延迟保存与立即删除的测试，确认晚到保存不会复活已删除番外，也不追加 AI 请求；四套番外/PhoneAPI 源码在 V8 代码测试执行环境 **46/46 PASS**。
- **浏览器验收改进**：`da594b3` 在原本的 Playwright Chromium 本地烟测中加入畸形认证 meta、错账号作用域拒绝挂载两种真实页面路径；`306e18e` 加入 40 条消息生成后的阅读区宽度、横向溢出与底部操作栏位置检查。只用本地合成角色，禁止真实模型/支付/用户数据。烟测新源码语法 **PASS**，真正运行仍 **NOT RUN**。
- **手机缓存版本**：`76bccbe` 和 `c63ac8d` 将聊天页加载链更新到 `20261116fanwai13` → `20261116v13`。现有发布资产合同检查 **6/6 PASS（JS 执行器）**。
- **未执行的验收**：容器可用 Node 22 与 Chromium，但没有此私有仓库可检出的完整本地副本及其 Vite/Playwright 安装，因此本轮 `npm ci`、`npm run build`、`node --test` CLI、`npm run test:fanwai:build-and-browser` 均 **NOT RUN**。未重试已知不可用的 GitHub Actions，未声称浏览器或真机验收通过。
- **边界**：原 PR 继续 Draft，未合并 main、未向唯一 QA 环境部署、未动正式管理员、数据库、Worker 或钱包。下次在可检出分支 SHA 的隔离环境运行已有命令，并只根据真实错误修原 PR；禁止另外开重复测试分支。


## 2026-11-16｜番外：删除确认防重复提交

- **任务/文件归属**：续做原番外联合草稿 PR #299，账号 PR #290 为上游，不新建 PR。只改 `chat/chat/js/chat-fanwai.js`、`tests/chat-fanwai-ui.test.mjs`、聊天缓存版本引用及本日志。
- **实际 Bug 修复**：首次确认删除即设置 `state.deleting`，直到 IndexedDB 事务完成才解除锁；双击确认/等待期间切换其他故事操作不再引发重复删除事务或重复 `episode:deleted`；用户在等待期间收起番外，删除成功后不自动重新打开。仍沿用原 `episodeWriteQueue`，保留原存档格式、账号角色校验、主线聊天与数据库。
- **回归**：新增双确认去重（1 次 delete / 1 次生命周期事件）与事务提交期间收起后不重开两项测试。初次执行时测试错误使用了确认页不存在的关闭按钮；已改为调用真实存在的遮罩关闭入口。此后从 PR 当前源文件在 V8 模拟环境执行番外/PhoneAPI 回归 **48/48 PASS**，资源加载合同 **6/6 PASS**。
- **资源版本**：`chat-extras.js?t=20261116fanwai14` 加载 `chat-fanwai.js?v=20261116v14`，避免手机继续加载旧交互逻辑。
- **实际执行限制**：仍未取得可检出 MAOMAO 全仓库并安装 Vite/Playwright 的执行工作区；真实 `npm ci`、`node --test` CLI、Vite 构建与 Chromium/Android/iPhone 实测 **NOT RUN**。不重试已知不可用 Actions，不把模拟回归冒充真机验收。
- **回滚**：撤销本次小补丁及两处脚本版本变更即可；没有数据库迁移、没有触碰正式账号/钱包、没有合并或部署。下一步仍是在可执行的隔离环境运行已接入的 `test:integration:account-fanwai` 和 `test:fanwai:build-and-browser`，依据真实结果修原 PR。



## 2026-11-16｜番外 G 字头角色 ID 与真实群聊识别修复

- **任务 / 唯一 PR**：PR #299 原 `integration/account-fanwai-stack-20261115`（base #290）；未另建 PR/Worker/数据库。以已存在的 `phone_groups` 与旧群 ID 格式为准，保留当前主线聊天数据和「＋」面板原样。
- **发现的真实代码 Bug**：此前番外用 `/^g/i` 判断群聊，一切以 G/g 开头的普通角色（包括 JSON 导入角色）都会被错误隐藏。现从隔离后的 `phone_groups` 中按完整 ID 比对群聊，继续识别真实 `g + 13 位时间戳` 与旧 `group-*/group_*`；存在格式冲突时优先识别真实角色库，`phone_groups` 中的确切群组仍具有优先权。
- **隔离边界**：只在账号 meta 校验和隔离运行时 ready 之后读取 `phone_groups`，畸形账号标记依然提前拒绝；不修改或覆盖角色、群聊和用户聊天存储。
- **源代码提交**：`767d4909` 实际修复 `chat/chat/js/chat-fanwai.js`；`fa4e4903` 增加 g 开头导入角色真实生成路径、标准/旧/自定义群 ID 与同名碰撞三类测试；`746fbf6a`、`0e4dacae` 更新手机加载版本 `20261116fanwai15` → `20261116v15`。
- **已执行的检查**：从 PR 当前 GitHub 源码经 V8 JS 测试执行器运行番外/PhoneAPI **51/51 PASS**；发布资产加载合同 **6/6 PASS**。二者不等于完整 Node CLI 或真实 Chromium，通过范围仅限对应源代码合同及模拟浏览器行为。
- **未执行**：`npm ci`、完整 `node --test`、Vite 构建、Chromium/Android/iPhone 真机和唯一隔离 QA 均 **NOT RUN**，当前会话没有可供检出的整个仓库和运行时依赖。已知 Actions 限额不重试。
- **回滚**：恢复该函数群聊判定逻辑及测试、对应静态版本即可；无数据迁移、无生产账号/钱包/Worker 变更。继续原 PR 开发，进入后续测试条件时沿用原脚本验收。



## 2026-11-16｜番外：插件接口实际隔离与异步存档切换

- **认领范围**：原番外联合 Draft PR #299，base #290，不另建 PR / Worker / 数据库。复用原手机「＋」菜单、真实 `phone_groups` 和已有番外扩展 API。
- **实修 1（接口隔离）**：此前番外在群聊 ID 检查之前已执行 `global.MAOMAOFanwaiCore` / `global.MAOMAOFanwai` 对外注册，群聊只是隐藏按钮却仍有插件/上下文接口。提交 `4002cacb` 把暴露动作移到账号和会话类型检验之后；无 DOM 的 Node 纯逻辑合同仍保留访问。提交 `dda8b160` 扩展群聊、自定义群聊、旧群 ID、撞 ID 的接口缺席断言，同时确认合法单聊仍可注册插件。
- **实修 2（慢存档覆盖新故事）**：旧目录 `read` 可以在首次创建故事的异步存储期间返回，错把旧故事重新打开。提交 `3c4666b5` 使新建剧情立即令旧 `viewSerial` 失效，同时对 `read` 异步前后增设 `creating / deleting / busy` 与序号一致性门禁；提交 `0fe2adc0` 验证慢范围查询与慢首次 `put` 并发时仍打开用户选中的新剧情、不会改写旧存档。
- **手机资源版本**：`a9604123`、`6a0aa59c` 更新为 `chat-extras.js?t=20261116fanwai16` → `chat-fanwai.js?v=20261116v16`；`b5992a7e` 更新扩展接口契约说明。
- **执行证据**：从原 PR 当前 GitHub 代码输入 V8 JS 测试执行器，番外核心/UI/扩展/PhoneAPI 52/52 PASS；发布资产检查 6/6 PASS，番外 JS 语法校验 PASS。此项不是仓库实际 `node --test`。当前执行环境仍没有可用的 MAOMAO 完整检出/Vite/Playwright 依赖；`npm ci`、Vite、Chromium、Android/iPhone、独立 QA **NOT RUN**。
- **数据与回滚**：没有触碰账号/钱包/生产 Worker/正式 DB，也无数据 schema 迁移。原 PR #299 保持 Draft，未合并未部署。需要回滚时撤销局部番外 JS、测试及版本提交即可；保留角色、群组、番外与主线存档。



## 2026-11-16｜番外：关闭前等待存档回执与恢复 UI

- 原任务与文件归属：继续 `integration/account-fanwai-stack-20261115` / Draft PR #299，账号 #290 为 base。仅调整番外 JS/模拟 UI 回归、手机版本引用与本次日志。
- 定位真实数据风险：原 `pause()` 发起 `persist()` 却不等待结果，`close()` 直接隐藏页面；IndexedDB 失败时，唯一留在当前页面的生成对话可能无法恢复。首次修复后，已有回归揭示初次创建慢保存/旧关闭回调以及删除期间关闭的时序冲突，已逐项修正。
- 代码提交：`38de35f3` 暂停保存回执；`0a04bdb9` 即时版本失效；`d81d34af` 仅拦截真正未存储的当前对话；`dc4c0e60` 拦截旧关闭回调影响新视图；`54b107ba` 允许删除事务期间直接收起不自动重开。新增三类失败/快速重开回归（`f1821bc9`、`57bf8d63`、`bddcca64`）。
- 验证：基于 GitHub 当前 PR 源码，用隔离 V8 测试外壳执行已有四组番外/PhoneAPI 测试 **56/56 PASS**；发布资产加载合同 **6/6 PASS**；改动 JS 语法 PASS。手机加载链版本更新为 `20261116fanwai18` → `20261116v18`。
- 严格边界：本轮**未执行**完整 `npm ci`、真实 `node --test` CLI、`npm run build`、Playwright Chromium、Android/iOS、真实模型或独立 QA；无完整仓库执行副本和相关依赖。未触发 Actions，不修改账号/群聊/主线聊天存储结构、正式数据库/Worker/管理员；无 Schema 迁移。页面被浏览器直接销毁时，异步 IDB 提交仍可能受浏览器限制，需真机 E2E 验证。
- 状态：仍为原 Draft PR #299、未合并 main、未部署；可局部回滚此次改动和缓存版本。后续优先在能检出完整源码的隔离环境运行原 Node/Vite/Chromium 验收命令，再按实际问题回原分支修复。


## 2026-11-16｜番外：未保存对话逃逸路径与安全复制备份

- **唯一任务**：继续 `integration/account-fanwai-stack-20261115` / Draft PR #299，base 现有账号 #290。未新建分支/PR/Worker/数据库，未触碰管理员、钱包、主线消息和正式站。
- **修复的数据风险**：暂停/收起保存失败时已有防护，但 `openPicker()` 直接调用（包括重新点番外入口）与已结束暂停后的 `back` 仍能覆盖唯一未保存的阅读草稿。提交 `947b5998` 将未存储草稿保护下沉至统一目录入口，并阻止从同一份未保存稿开启故事分支；提交 `a0ec6122` 把旧“返回目录重新打开 12 条已保存消息”的回归改为正确的双端状态验收：当前页面保留 24 条内存稿，刷新后的全新页面只允许读到上次实际提交的 12 条。
- **手动恢复**：提交 `1adec92e` 在确实保存失败且有对话时，将“复制当前对话备份”放入隐藏的「···」菜单；仅经用户点击才访问系统剪贴板，不包含 API Key 与角色背景记忆，不自动将未保存内容声称已落盘。提交 `4a1c2a34` 添加主动复制和剪贴板不可用的回归测试。提交 `5af33926` 强化 WebKit 文字长按选取；提交 `f7e7d1dd` 增强现有 CSS 合同。
- **版本链**：`chat-extras.js?t=20261116fanwai19` → `chat-fanwai.js?v=20261116v19` → `chat-fanwai.css?v=20261116softcore6`。原「＋」菜单仅增量加载，未重写聊天。
- **验证事实**：对 GitHub 当前分支源码执行四组 V8 合同/模拟 DOM/API 回归 **58/58 PASS**，当前 release asset 资源合同 **6/6 PASS**。这不等于真实 Node CLI/Vite build/Playwright 或移动真机完成；本执行工作区未检出完整工程/依赖，相关步骤 **NOT RUN**。未重试 GitHub Actions 额度限制。
- **回滚边界**：局部撤回该功能 JS/CSS/回归、缓存版本即可，不需要更改旧存档格式/数据。原 PR 仍 Draft，未部署至固定完整 QA 或正式版。下一步在真实可执行的完整仓库运行既有 `test:integration:account-fanwai` 与 `test:fanwai:build-and-browser`，验证剪贴板权限、手动选取、刷新保存一致性，再由用户在唯一隔离 QA 中实际试玩。

## 2026-11-16｜番外：暂停事件等待持久化成功

- **用户指令：暂停整合与部署，仅继续原任务开发。** 继续 `integration/account-fanwai-stack-20261115` / Draft PR #299，保持 base #290；不合并 main、不触碰现有 QA Worker 或正式版。
- **实修问题**：`pause()` 以前在 `persist()` 提交前先触发 `episode:paused`，可能让扩展把未落盘故事当成已暂停并持久化。提交 `9d3884a8` 改为在保存返回成功、同一故事未切换且版本序号未过期时通知；保存失败不触发成功事件。
- **测试提交**：`1eff17cd` 覆盖成功延迟提交与失败不通知；`23d78af6` 覆盖保存待提交期间续写时旧暂停事件被取消。原四组模拟 UI / 合同 / 扩展 / PhoneAPI **61/61 PASS**。测试通过仅指 V8 隔离执行，不等于 `node --test`、Vite、Chromium 或手机真机，以上仍未跑。
- **缓存**：`0e65b143`、`734a02ca` 更新番外 JS 加载版本至 `20261116v20`，聊天扩展加载版本至 `20261116fanwai20`；未修改旧数据、存储 schema、主线消息、状态栏或钱包。
- **开发阶段**：用户明确不合并；本轮无 QA、生产或数据库操作。下次继续原 PR 开发并执行可用范围内的真实验证。

## 2026-11-16｜番外：记忆偏好读取失败不再污染旧数据

- **原任务**：仅开发 `integration/account-fanwai-stack-20261115` / Draft PR #299，上游 #290，用户明确“不合并、不部署”。按治理 Draft #300 统一规则核对归属，没有创建新分支、PR、Worker 或数据存储。
- **实修 Bug**：原 `loadSettings()` 把 IndexDB 偏好 `get` 失败当作记录缺失，仍设置 `settingsLoaded=true`。用户下一次修改时可能把默认 `memory=none, count=null` 写回旧设置，或者未察觉按错误记忆模式创建番外。提交 `538a7f53` 增加读取成功标志、失败不落盘且可重试；提交 `dd41c363` 阻止偏好未安全读取时产生新故事及模型请求。
- **回归**：`2c757c4f` 增加失败设置读取与成功重试的合成 IndexedDB 场景；`89b3ee1f` 增加未读偏好时不可创建草稿或产生模型调用的断言。当前源文件 V8 隔离执行的番外 UI/核心/扩展/PhoneAPI **62/62 PASS**，发布资源合同 **6/6 PASS**。不把 V8 模拟冒充实际 `node --test`/Vite/Chromium/真机。
- **兼容/版本**：`5d6221fb`、`fe295261` 将手机资源链更新为 `chat-extras.js?t=20261116fanwai21` → `chat-fanwai.js?v=20261116v21`；没有迁移/清理原角色、聊天、世界书、账号、钱包、番外数据。
- **尚未执行**：完整仓库 CLI 测试、`npm ci`、`npm run build`、Playwright Chromium 及 Android/iPhone 真实验收仍 NOT RUN，不能声称 QA 成功。本轮不触碰唯一 QA Worker 或正式版。

## 2026-11-16｜番外 PR #299：保存最新记忆偏好后才开始生成
- **原任务/分支**：唯一联合草稿 PR #299；integration/account-fanwai-stack-20261115（以账号 #290 为 base），治理 Draft #300 尚未合入 main。仅修改已有番外 JS、UI 回归、手机加载缓存版本、番外文档和本日志。
- **实修**：新增 settingsCommittedVersion 和对 settingsWriteQueue 的等待；新故事只有在最新记忆/篇幅偏好写盘成功时才能创建并请求模型。失败后提示用户重新选择以重试。等待期间已切换页面的旧操作不会继续生成；原角色、旧番外、主线消息、账号和钱包不变。
- **代码提交**：e3027586（功能）、4d59a08f（新增 2 项测试）、af6166c7 / de67348e（移动缓存 v22）。
- **实际验证**：从该分支 GitHub 源码在 V8 模拟 DOM/IndexedDB 跑 UI 47/47 PASS；不等于 node --test CLI。npm ci、npm run build、Playwright Chromium、Android/iPhone **NOT RUN — NO FULL REPOSITORY EXECUTION ENVIRONMENT**。不重试已知不可用 Actions。
- **回滚/状态**：仅回滚本轮局部提交和缓存版本；无数据库迁移/生产操作。PR 仍 Draft、未合 main、未部署 QA/正式版。下一步在能完整检出仓库的环境运行 npm run test:integration:account-fanwai 与 npm run test:fanwai:build-and-browser，按真实失败继续在原 PR 修复。

## 2026-11-16｜番外 #299：创建中修改记忆造成实际 AI 上下文错位
- **唯一主 PR/职责**：继续 `integration/account-fanwai-stack-20261115` / Draft PR #299（堆叠 #290），未与其他窗口重复认领，共享账号、钱包、状态栏、生产代码未改。
- **真实代码风险及复现**：在模拟慢速 IndexedDB 初始故事保存时，点击「开始写这篇」后还能改成「不带记忆」，但故事已经缓存原来带记忆的 `contextIds`，可能把角色记忆送进模型。修复前针对性动态回归 FAIL（界面无记忆/请求含角色记忆）。
- **修复**：`5be09648` 创建期间锁定记忆按钮、篇幅和插件上下文控件，并阻止模拟的失效事件修改正在创建的故事；`9ed742ad` 增加延迟存储+三类控件回归；`eaba3e77`、`4cc9f7fa` 更新手机 JS 加载 v23。保存完成或失败均在 finally 解除操作锁，不新增存储键或更改公开插件 API。
- **实际执行证据**：从当前原 PR 源文件在 V8 隔离执行器运行 UI 48/48 PASS、核心/插件/PhoneAPI 17/17 PASS，合计 65/65；这是合成 DOM/IndexedDB 和 V8 的模拟执行，**不是** `node --test` CLI 或 Vite/Chromium/Android/iPhone。完整 `npm ci` / `npm run build` / `test:fanwai:build-and-browser` 仍 NOT RUN — NO FULL REPOSITORY EXECUTION ENVIRONMENT。
- **兼容/回滚/下一步**：无 DB migration，不清理或迁移角色、聊天、番外、记忆、用户账户数据。可回滚本轮局部功能/测试/缓存版本。下一步骤为在完整隔离仓库执行现有 Node + Vite + Chromium 门禁，依据实测结果继续修原 PR；当前未合并 main、未部署 QA 或正式版。

## 2026-11-17｜FEATURE-ENCOUNTER-001：进入现有唯一统一 QA 分支（尚未上线）
- **目标/归属**：继续原邂逅功能 PR #297（Draft），只把既有成果安全接入唯一联合 QA `integration/account-fanwai-stack-20261115` / PR #299（Draft）；不新建测试 Worker、独立项目或 PR，不合并 main。
- **实际提交**：`a51f772d3d13b8484e7b95eab1313ad59c97d8c7`（13 个源码/测试/原角色库与备份接入文件）、`f0990026f0d71fcd9c7af2299a0688d4f4f989a2`（仅首页邂逅入口/默认布局/尊重已移除标记）、`6b02bdea49213400ed6061506ec92e616b441299`（Node/Vite/Playwright 及同 Git HEAD 回执门禁接入原 QA-only 脚本；新增桌面回归断言）。沿用原 PR #297 版本的邂逅引擎、创建角色锁、损坏草稿保护和原角色不覆盖方案。
- **并行改动保护**：保留联合分支原账号及管理员入口、Service Worker 云推送、音乐浏览器验收以及 `scripts/qa-direct-release.mjs --qa-only`；不将旧 `integration/encounter-account-acceptance-20261115` 覆盖新版 QA。
- **本轮已核实**：从 GitHub 提交后联合分支读取的源码，静态确认抽卡路由/桌面放置/角色锁/原角色存储保护/备份前缀/账号隔离和 QA 测试门禁在位。V8 编译 `encounter-engine.js`、`characters-manager.js`、邂逅页面 1 个及首页 6 个内联脚本，全部无语法错误。PR #297 原有 39/39 是交接中提供的**隔离测试**数据，未在本会话作为原生 Node 重新执行。QA 发布脚本是 ESM，不能用 `new Function` 模拟 node 编译。
- **未完成/发布阻塞**：无完整仓库本地检出环境，本轮 **未运行** `npm ci`、原生 `node --test`、`npm run build`、Playwright 三手机宽度及 Android/iPhone 实机验证；**未上传** Cloudflare QA Worker，正式域名、main、管理员和任何数据库均未写动；不能称线上邂逅可测。
- **统一验收下一步**：在真实工程 Codespace 完整检出该分支的最新 HEAD，运行 `npm run qa:release:check`（需既有环境所需的运行依赖），修复实测失败项；满足全部真实 Node/Vite/Playwright/账号门禁后，通过现有 `MAOMAO_QA_DEPLOY_CONFIRM=maomao-aw-qa-20261114 node scripts/qa-direct-release.mjs --qa-only` 只更新唯一 QA Worker，再由用户手机真实体验。先测试版，绝不部署 app.mao520.com 正式版。


## 2026-11-17｜UI-SETTINGS-001 + CLOUD-PUSH-HEADER：顶部紧凑化进入唯一 QA（代码已整合，未发布）
- **用户最新硬性要求**：MAOMAO 手机页面不再绘制第二套时间/网络/电量模拟状态栏；参考用户截图，设置页与云端推送页标题栏轻薄紧凑，不能为了假状态条留下顶部大空白；保留系统原生状态信息。禁止生图。
- **来源与归属**：Settings 原 PR #267、云端推送原 PR #148。代码已按小范围变更移植到现有唯一 QA PR #299 / `integration/account-fanwai-stack-20261115`；不创建新测试站或重复 PR，不直接合并 main。
- **实际源码提交**（按先后顺序）：`2be91f627d76e7ea6a743a0b111ad6168245ba94`（仅将设置首页 compact CSS 追加至原样式）、`192d4707e251c965e4517e4d994447d35e9b0666`（设置页 body 专属作用域 class）、`79b0a8bbbdbafed9bd2a0c002b99e2df2724557b`（云端推送页面收窄顶部与折叠说明，保持 QA 真实诊断文案与所有控件）、`a1ab657f2ef93ebdf870a8455ac11ae2c856347f` 与 `fc7e6c6c0e91f5b2c971f13cfc3cd077a2ea9713`（两个原生 Node 回归测试文件）。
- **保护边界**：这 5 次提交自原 QA head `6521e43e` 的比较只触及 `settings/css/settings.css`、`settings/settings.html`、`settings/cloud-push.html` 和两份新测试。Settings scoped to `body.settings-home`，不会对其他共用 CSS 的设置子页全局施加紧凑布局；保留原账号跳转、备份、API 面板；Cloud 保留 QA 的 `cloudReadinessCheck`、`cloudLocalTestRow`、`cloudTestRow`、`cloudContextSharingToggle` 等控件，保留云端 AI 生成未就绪的真实警示。未改 Worker、SW、推送凭据、管理员/真实聊天/数据库 schema。
- **核对证据**：通过连接的 GitHub 读取最终 QA 文件与比较五个提交，针对页面/作用域/开关/说明/平衡标签/测试文件/业务不回退共 **18/18 静态断言 PASS**；不是 Node CLI、Vite 或真实 Chromium。仓库内待执行的重点命令：`node --test tests/settings-header-compact.test.mjs tests/cloud-push-header-compact.test.mjs tests/qa-cloud-settings-integration.test.mjs`；之后 `npm run build`、QA release gate 与 375/390/430 浏览器/安卓/iOS 实机检查。
- **部署状态与下一步**：连接的 Cloudflare 只读核查确认 `preview.mao520.com` 绑定 `maomao-aw-qa-20261114`，核对时最近已知部署为 `2026-11-16T21:19:39Z`，**早于上述 UI 提交**；截至本记录，没有新 UI 代码的 QA 部署成功回执，故标 `QA_CODE_INTEGRATED / NODE_NOT_RUN / BROWSER_NOT_RUN / QA_NOT_DEPLOYED / USER_NOT_ACCEPTED`。必须在完整工程环境执行真实 Node/Vite/浏览器测试，通过后原地部署同一 QA 并保留旧 QA 数据，由用户验收。正式版保持原样，等待单独许可。
- **回退**：仅回退上述局部页面样式、`body` class 与测试文件即可；没有任何数据迁移或用户数据删除。


### 同日最终 UI 加固补充：不止隐藏，而是移除假状态栏 DOM
- QA 原来还保留 3 个实际模拟条：`settings/settings.html` 主页面、同文件的 `#api-panel` 弹层、`settings/cloud-push.html`。已直接移除 3 处完整的 `09:41`、网络/电量模拟 DOM，未触碰操作系统真实栏。为 API 弹层新增独立紧凑 `#api-panel > .header` 样式，避免删除假条后仍保留 56px 顶部空白；更新两个回归测试，明确要求 HTML 不得再次引入 `<div class="status-bar">`。原功能 PR #267、#148 均同步修复，避免后续合入时回流。
- 本轮 QA 尾部提交：`917c2f05`、`7f841282`、`bdd12982`、`3dc9af29`、`f2e70fe1`，按文件移除/样式/测试提交，未修改 worker/sw/账号/DB。最新 QA 源码 GitHub 回读新增 **15/15 静态断言 PASS**，包括三个条全部消失、API 弹层收窄、所有 QA 推送控件与原入口保留、差异文件仅在授权范围；并不代表 `node --test`、构建、Chromium 或手机验收已经执行。
- **状态保持**：`QA_CODE_INTEGRATED`；完整 Node/Vite/浏览器测试与 QA 更新部署仍是 `NOT RUN / NOT DEPLOYED`。所有提交都在唯一 QA 分支中，不触碰正式域名/正式库。


## 2026-11-17｜设置/云推送精修：真实手机视口浏览器核验（局部 HTML/CSS，不等于全应用 E2E）
- **原分支**：QA #299 `integration/account-fanwai-stack-20261115`。继此前 3 处假状态栏 DOM 全部移除，继续精简云推送首屏：将原 QA 长状态提示移入「关于云端推送 · 后台 AI 未就绪」原生 `<details>`，将不可用的功能事实保留在用户可以展开的提示里。对应 QA 文件提交 `19d28ac016018834147a7a7269628fd114d21bc0`，契约测试修改 `66b16e128174215bf99e463f29cbdac7da8093d6`。
- **真实浏览器执行方式**：Cloudflare Browser Rendering API `POST /browser-rendering/content`，读取当前 GitHub QA 分支 HTML/CSS、`shared/css/mobile-fit.css`，在无用户数据的 HTML 页面中内联原 CSS，去除应用对云端/账户的脚本，以 375/390/430px 手机视口渲染并运行 DOM 几何/原生 `details` 点击检查。这是**真实 Chromium 引擎对当前样式/DOM 的独立渲染**，不是全量 PWA、认证、真实 API、Service Worker、构建产物或 Android/iPhone 实机集成测试；这些仍需单独验收。
- **有效结果**：Settings 375px：header 62px，首卡 top 94px，无模拟状态条，无横向溢出，内部可滚动；Settings 390px：header 62px，首卡 top 94px，原设置入口存在；Settings 430px：主页 header 62px，内嵌 API 面板 header 59px，点击 API 设置可展开、按返回按钮可关闭，无模拟条及横向溢出。云端推送 390px（优化说明前）：header 62px，首卡 top 200px，`details` 关闭，原 QA 控件存在；据此进一步压缩说明。**优化后的云端推送 430px**：header 62px，首卡 top 143px，纵向可滚动，无横向溢出/模拟条，说明入口可展开及再次关闭，含完整「后台 AI 未就绪」提示，测试推送/本机通知自检/角色授权/就绪检查控件均存在。
- **无效检查不计 PASS**：Cloudflare 浏览器 6 条批量请求中部分遇到 HTTP 429 频率限制，未执行的尺寸不计通过；云推送优化后 375/390px 等待独立验证。现有局部浏览器证据不能替代完整工程 `npm ci`、`node --test`、`npm run build`、Playwright 集成和真机触摸验收，相关项仍 **NOT RUN / NOT VERIFIED**。
- **生产与测试边界**：只读核查 QA Worker `maomao-aw-qa-20261114` 最新部署仍为 `2026-11-16T21:19:39.507439Z` / version `597166f2-4e59-48d3-9046-10f517cd7dd0`，早于 UI 源码更改。**新版尚未部署 `preview.mao520.com`**，用户实机不可验这份最新样式；不能宣布已交付。正式版、管理员永久 ID、数据库、已有 QA 数据与 secret 均未修改。
- **剩余最短路径**：在完整工程检出最新 QA HEAD 后执行 `node --test tests/settings-header-compact.test.mjs tests/cloud-push-header-compact.test.mjs tests/qa-cloud-settings-integration.test.mjs`，再通过原 `scripts/qa-direct-release.mjs` 的完整 Node/Vite/Chromium/身份/资产发布门禁，按已核实配置仅将成功构建的新静态资源更新到唯一 QA，回读部署 version/SHAs，并由用户手机验收顶部；不能通过浏览器局部证据跳过这些步骤。不要触发 GitHub Actions 无额度构建。


### 真实浏览器补测完成（同日）
- Cloudflare Browser Rendering 继续单条执行以避开浏览器并发限流：**云推送最终紧凑版** 375、390、430px 三个视口，header 均 62px，首设置卡片 top 均 143px，0 假状态栏、0 横向溢出，纵向滚动正常；三档入口都保留「后台 AI 未就绪」醒目摘要。430px 已实际点击原生 disclosure 展开及收回，均 PASS。
- Settings 375、390px header 62px、首卡 top 94px，430px 首页 header 62px/内嵌 API header 59px，点击 API 行成功打开且返回按钮成功关闭；三个视口均无假状态栏、横向溢出，主设置区仍可滚动。这是 GitHub QA 分支当前 HTML/CSS 加上项目 mobile-fit 的 **浏览器渲染/局部交互核验完成**，不涉及业务脚本执行。
- 当前视觉页面 **SOURCE_BROWSER_LAYOUT_PASS**；整体工程依旧 `NODE_BUILD_NOT_RUN / QA_NOT_DEPLOYED / USER_QA_PENDING`。不允许据此宣布完整部署交付。


## CHAT-WORLDBOOK-001 · Integrate worldbook dual-binding into latest sole QA source (2026-11-19)

**Source of truth:** latest `integration/account-fanwai-stack-20261115` QA HEAD at integration start `0f8235e04a6ecd9ee5e2b710ea3de1b5dcf79c9d`. Dev source PR #307 was reviewed but not copied as an entire old QA page. Integration staged on `CHAT-WORLDBOOK-001/qa-latest-integration-20261119` as a direct descendant of the existing QA HEAD, with no new QA site.

**New user-visible behavior:**
- Character editor and chat settings read and save a common effective worldbook ID set; save either side updates the other. Old `worldBookIds`, `chat_worldbooks_<id>` arrays and legacy objects remain compatible. Explicit empty selection stays empty; missing book IDs are retained rather than deleted by an unrelated edit.
- Both open pages handle cross-tab `storage` events: reflect the latest mounts when not editing, preserve an in-progress selection, reject conflicting saves instead of overwriting another tab.
- Latest QA chat persona/group/hidden-game policy remains intact. Actual main chat request filters the current speaker's private books, group's explicit mounts and applicable historic global defaults. Damaged bindings stop before AI request, and already-saved messages use the existing failed-bubble/retry path.
- `PhoneContext` uses a bridge when available with backward-compatible read-only role/worldbook fallback. No role IDs, history, API settings, account model, group secrets, candidate story data or production bindings changed.
- `sw.js` cache version increments v252 -> v253 and pre-caches `role-worldbook-bindings.js?v=20261119-qa1`.

**Actual verification:** 16/16 static integration and JS syntax assertions on current integration source; 20/20 cases from the committed Node test file run by a V8 `node:test`-compatible shim, including the actual latest QA prompt block; separate prompt content/error simulation found 9/10 passing on its first pass, with the single miss caused by a mistaken expectation that global defaults stay visible after an explicit saved mount. Corrected expected legacy union matches the bridge, and the comprehensive 20-case suite passes. **No real Node CLI runner or Vite build, Chromium, Android/iOS, paid AI request, or QA domain deployment has run here.**

**Actual Cloudflare read-only check:** existing `maomao-aw-qa-20261114` latest live version identified as `2dff7092-4c8d-4267-bb83-80efb85511cf` from 2026-11-18 12:58:57 UTC (as of this check). Cloudflare Workers Builds build-minute limit is reached until its reported Nov 30 refresh; configured QA Build trigger is `MAOMAO sole QA — manual validation build, deploy paused`, with deploy command intentionally set to an echo. **It must not be used to claim a QA deployment.** The existing true QA deploy is `scripts/qa-direct-release.mjs --qa-only` run from a full authorized Node 22 checkout after its complete test and account preflight gates; this session's runtime does not contain the repository checkout/dependencies. Do not deploy without the full suite and expected Cloudflare build receipt, do not change production or identity core.

**Status:** QA integration source candidate only, until the latest QA ref fast-forward and complete release verification. The real owner test URL is still `https://preview.mao520.com`. Do not report browser availability of this worldbook change until its `qa-build-receipt.json` matches the deployed QA Git SHA.


## 2026-11-19｜DATA-008｜自动联系／自动追问原子落库 · 唯一 QA 增量候选

- 起点：原 #299 HEAD `bba964b22b46f5f66cb8f1fa27f05f547faef5a3`；原需求/实现来源 #305。只在 `shared/js/chat-notifier.js` 迁移后台自动写入。保留已在 QA 的 `ChatHistoryAtomic`、人设/世界书绑定、群聊私密数据、聊天主发送接口，不使用 #305 中尚未融合的旧世界书 prompt 实现覆盖 QA。
- 主动联系、私聊和群聊的自动追问使用现有共享 Web Lock 内的 `ChatHistoryAtomic.appendIf`，在锁内重新核对最新对话锚点、启用开关和页面可见性。原始聊天主键不可读、缺少锁或账号 scope 未准备好时在发起计费请求前停止。禁止回退为整份旧历史覆盖。群内私密消息不参与自动追问上下文。
- 增加 `tests/chat-history-atomic.test.mjs` 26 项回归并接入 `test:chat:contract`；更新 SW v256→v257 和已有通知器在 SW、聊天详情与导航内的静态引用，原账号 SW 安全策略未改。
- 此记录写入时状态：**独立 staging 分支候选，原生 Node/Vite/Chromium/唯一 QA-only Cloudflare 发布 NOT VERIFIED**。下一步：回读源码、快进原 #299 QA、封闭完整验收，通过后只更新原 QA Worker，验证 `preview.mao520.com/qa-build-receipt.json`、Cloudflare 100% 版本和身份核心不变。正式版、main 和正式数据库不触碰。


## 2026-11-19｜QA-001 / 群聊人物身份漂移：截图反馈修复候选

- 用户真机测试群聊截屏：名为「洛景辞」的群成员面对「有没有人想玩游戏」自称人工智能，提供编号的文字游戏服务菜单、粗体 Markdown，违背角色扮演的自然聊天体验。截图仅作问题复现描述，不保存其真实对话内容至仓库。
- 原 QA 来源：PR #299，起点 `e7ef707c6a82c22b9713992e50d3f7c2808a81f2`。旧代码已在人设、世界书、全局协议、群发言成员上做请求前校验，但生成后未核对是否回到通用聊天 AI 身份。不得把这判成角色数据未加载的既定事实。
- 变更范围：`shared/js/phone/chat-role-context.js` 仅增纯策略 `validateGroupOnlineReply`，对普通人物明确自称聊天机器人/AI、未经要求的长篇编号服务菜单拒绝写入；明确数字生命保留原设定，允许正常讨论 AI 或应用户要求列清单；不删除旧消息或改写用户人设。现有群聊发送页的完整角色/协议/世界书请求链路保留，增加最后一层自然群聊提示，并在处理群功能标记与写入消息**之前**拦截违规回复。正常群聊仍使用原有流式气泡，检测到明确跳出人设的部分流式文本时即时清除临时显示和未完成快照；最终完整回复须再次通过校验才能落库，不额外偷偷进行一次计费 API 重试。线下群聊、单聊、正式账号/数据库、旧消息格式不动。
- `tests/group-persona-memory-audit.test.mjs` 新增 3 项回归；聊天页引用新策略版本，SW v257→v258 且新增静态缓存资源，账号登录页安全缓存逻辑保留。
- 状态：本条为**待验收**修复。原生 Node、Vite、Chromium、唯一 QA-only 发布和 Android/iPhone 真机尚未在本条记录时确认。发布前必须按原 `docs/engineering/QA_TEST_RELEASE_RUNBOOK.md` 完整验证，成功后回查固定 SHA、100% Cloudflare 流量、身份核心连续性。

- **回归诊断补充**：统一 QA 第 17 道全量 Node 测试初次失败，保密隔离分类定位旧版静态断言在 `tests/chat-continue-button.test.mjs`、`tests/chat-persona-source-contract.test.mjs`；已增量同步新脚本版本及手动继续合同。另发现 `tests/group-chat-invite-e2e.test.mjs` 的浏览器真实显示回归：此前完全隐藏群流式正文，会跳过既有临时气泡创建，导致成功模型回复未按原页面链路显示。现已撤回这个广泛抑制，仅对确定跑偏的片段清空显示，保留完整正常流式 DOM 生命周期。此修复需再跑真实 Chromium 与完整 QA-only 发布门禁，不提前宣称通过。


## 2026-11-19｜DATA-008 / CHAT-HISTORY-001｜P0 主聊天发送会话锁保护 · QA 候选

- 基于唯一 QA #299 `d6664ea8212fc4a44277939b47f1e3599597bec0`，定向移植原 #282 的 `appendChatSafely` / `replaceChatSafely` 适配层；仅迁移普通用户消息、屏蔽状态消息、缺少 API Key 时的用户消息及提示为 `ChatHistoryAtomic.appendManyIf` 会话独占锁提交。不把 #282 旧版完整聊天页覆盖到 QA。
- 常规发送持久化成功后重新读取最新对话快照再组装 AI 上下文；保存失败仍保留输入、引用与旧记录。拒绝无锁浏览器、损坏的原始 JSON、账号 scope 不匹配等风险，不退回旧全量覆盖。
- 聊天页面提前加载 QA 已存在的 `chat-history-atomic.js?v=20261118v3`；新增 `tests/chat-primary-send-lock.test.mjs`（含并发 2000 条富消息、修改冲突、坏数据与锁缺失及源码入口覆盖）并接入 `test:chat:contract`；SW 版本仅增量 v258→v259，不动认证网络优先策略及任何账号/世界书/角色数据键。
- **此记录时状态：仅 QA 派生工作分支，不代表完整验收或发布成功**。下一步原隔离执行器完整 Node/Vite/Chromium 验证并按既有 QA-only 发布手册核实源提交、Worker 流量、身份核心及 `preview.mao520.com` 同源回执。
- 未迁移的 AI 最终回复、群互动、图片/转发/编辑/清空仍有独立保护范围，应逐项测试合入；本次不能宣称 #282 全部完成。


### 2026-11-19｜P0 发送保护全量测试定位与修复（续）

- 受限唯一 QA 验证 #44483703226 在原安全门禁第 17/19 项（完整 `node --test --test-concurrency=1`）未通过，前 16 项（专项/构建/Chromium）通过，不准直接发布。
- 在私有隔离环境按保密策略只输出失败文件编号，诊断 #44486630038 确认 **7 条失败全部来自现有 `tests/forum-chat-blockers.test.mjs`**。该测试仍将真实 `sendMsg` 片段按同步 `saveMessages` 提取执行，新增受保护发送改为 `await appendChatSafely` 后导致七条旧夹具无法执行异步分支；不是七项独立用户数据损坏。
- 定向维护该测试文件：真实 `sendMsg` 源片段仍逐项执行，六项缺 API 与一项被拉黑消息断言保留，夹具改成 async 并模拟按最新已落库快照追加，覆盖失败不清空输入、不显示未存错误、稳定 mid 不重复、无新消息不积累错误、引用保持。未修改原版正式功能，没有移除或跳过测试。
- 此记录时新提交**尚未完成完整 Node/Vite/Chromium 重新验证**，因此不能称本次 QA 已发布。须经过原封闭完整验证成功后才能启用 QA-only 发布。


## 2026-11-19｜CHAT-HISTORY-001 / DATA-008｜多选删除消息并发保护 · 唯一 QA 候选

- 基线：原唯一 QA #299 `23821dea67a92e4c970bf7389751eb1b05a5d448`；来源：#282（`fix/chat-primary-history-precedence-20261114`）经过原文件比对。
- **只**将聊天详情页 `selectDeleteBtn` 多选删除操作改为使用现有 `replaceChatSafely(originalSnapshot, keep)`，在会话独占锁内检验历史完整快照。其他标签页新消息插入、损坏主存储、锁缺失、账号范围不匹配、容量不足，均拒绝删除而不清理图片引用；成功后重新读取已持久化的历史再渲染，避免错误显示旧快照。
- 不替换整个聊天页面、`phone_storage.js` 或删除其他会话内容；保留账号/persona/世界书/记忆、消息 mid、图片仓库引用。新增 `tests/chat-selection-delete-atomic.test.mjs` 7 个针对真实源 handler 与原原子模块的回归，纳入 `test:chat:contract`；PWA v259→v260 只增静态缓存版本，不调整安全缓存策略。
- **当前记录状态：仅 staging 分支。Node/Vite/Chromium 完整验证、实际 QA-only 发布、Android/iPhone 真机均 NOT VERIFIED。** 遵循 `docs/engineering/QA_TEST_RELEASE_RUNBOOK.md`，整合唯一 QA 后通过原隔离执行器测试，不允许漏掉第 17 项完整回归；通过后发布原 Worker 并核对 `preview.mao520.com/qa-build-receipt.json`、Cloudflare 100% 和身份核心未重部署。
- 后续 #282/#305 主消息图片、转发、线下聊天编辑及其他全量写入者仍按原 PR 分项治理，不能将本项视为全系统绝对原子写入。


### 2026-11-19｜多选删除完整聊天合约回归定位与修正

- 原唯一 QA 候选 `7fa607d14faf16c5c1abdf7e711d081a4b44fba6` 的隔离验证 `44495269090` 在原门禁 6/19 `npm run test:chat:contract` 失败，不允许发布。新增 `tests/chat-selection-delete-atomic.test.mjs` 7/7 单项在隔离 Runner 运行 `44495623055` 中真实 PASS。
- 追查发现既有 `tests/chat-image-vision.test.mjs` 的「删除图片仅在保存成功后释放引用」用例将**单条删除和多选删除都固定要求旧同步 `saveMessages`**。多选删除已改为更安全的会话锁 `replaceChatSafely(originalSnapshot, keep)`，旧源代码字符串断言与真实行为不兼容。
- 本轮只细化该原有合约：单条删除仍必须验证原保存门禁，多选删除必须验证新的异步锁保存门禁；两路均保留「保存失败不释放图片资源」及「成功保存后清理引用」的原测试目标。没有删测试、跳过门禁、放宽存储安全，也没有更改聊天运行时代码。
- **待重新完整 Node/Vite/Chromium 验证、再 QA-only 部署。** 不将失败候选冒充已发布。

## 2026-11-19｜CHAT-RP-001｜单聊角色冒充 AI 客服 · 手机 QA 待验候选

- 用户真机截图：普通单聊角色自称“人工智能 / 专属聊天搭子”，且反复输出客服式问候。现有唯一 QA 已在出站模型上下文校验保存人设、世界书与全局协议，历史错误回复也会在单聊模型上下文中过滤；问题出在 **群聊有流式及落库前身份拦截，单聊缺少相同闭环**。
- 从 #299 当前基线 `7060d2bd32e346513518c0e8ef9398afe817b6d9` 局部修改 `shared/js/phone/chat-role-context.js` 和 `chat/chat/chat-detail.html`：新增纯函数 `validateDirectOnlineReply`，只拒绝普通角色明显冒认 AI/模型/客服身份；真实数字生命或自定义机器人角色保留本人设定。单聊流式实时显示与最终落库前均执行角色审核，失败清理临时消息并提示手动重试；不额外收费重试，不回写、删除或纠正任何已存历史。
- 仅调整 SW 缓存号 v260→v261 与 `chat-role-context` 资源查询版本；保留群聊守卫、世界书/全局协议请求校验、线下剧情、账号安全及图片/转账/记忆后置副作用。新增 `tests/chat-direct-online-identity-guard.test.mjs` 6 项并接入原 `test:chat:contract`，同步修正群聊历史资源版本断言。
- **当前仅为待验证候选：未完成完整 Node/Vite/Chromium，也未部署。** 必须按原 `docs/engineering/QA_TEST_RELEASE_RUNBOOK.md` 验证并 QA-only 发布，独立复核同源 sourceCommit 与身份核心不变。正式版、main、正式数据库、管理员 001 均不涉及。


## 2026-11-19｜CHAT-WORLDBOOK-001｜线下两种聊天模式和线上世界书绑定统一（待 QA 门禁）

- 唯一 QA #299 基线：`82befda4afb717c29914f8f487ea4b4678c246cf`。当时另一条 `CHAT-RP-001` 私聊人设纠偏 QA-only 验证/发布正在运行，故先在独立任务分支小步修复，暂不抢写 #299 或触碰 Cloudflare。
- **定位的具体数据入口不一致**：线上聊天经 `RoleWorldbookBindings.filterBooks` 按用户明确选中/取消、旧格式和禁用状态读取；但 `MAOMAOChatRoleContext.buildSavedSourceEnvelope`（用于 `chat/date/date.html` 与 `chat/date/journey.html`）仍直接拼旧角色 `worldBookIds` 与 `chat_worldbooks_<id>`，会把显式取消或 `enabled:false` 的旧局部书重新注入线下 AI，造成页面间对同一绑定的不同理解。
- 改为在线下角色上下文里调用**同一个共享绑定桥**读取允许的书，再按原来的触发词/概率/禁用语义构建内容；读取失败/模块缺失时在模型请求前拒绝，不以空白通用 AI 回复冒充设定已加载。线上、角色编辑器、群聊现有路径完全不改；所有角色、世界书、协议及聊天历史原始数据不改写。
- 两个原线下 HTML 在原共享角色上下文前按顺序加载已有桥，更新角色脚本版本；SW 仅递增原 shell v262→v263 并增加已有模块的新离线缓存 URL，保留登录/身份核心安全策略。
- 新增 `tests/offline-worldbook-binding-parity.test.mjs` 8 组真实模块 Node VM 行为与页面接线断言，纳入现有 `test:chat:contract`；覆盖明确解绑、禁用对象、旧全局默认、跨角色隔离、触发词、损坏数据拒发、缺桥拒发与两个线下页的脚本引用。
- 当前状态：**独立 QA 派生 staging 分支，尚未运行原生 Node/Vite/Chromium 全套门禁，尚未合入唯一 QA，未发布**。必须等待并行发布结束、比对当时最新 #299 HEAD 后再做安全快进；随后完整测试并 QA-only 发布且核对同源回执与账号身份核心不变。**不要虚报用户现有手机链接已经包含这次补丁。**

## 2026-11-20｜CHAT-PARSER-001｜全局 AI 回复格式识别共享层

- 原唯一 QA #299 起点：303d3e025ede6b5bd068459a00047b55424457f7；独立任务 PR #308，代码快照 7039afb10d4abddb663ff51d78cc371aa045b956。只更新模型输出解释层和共享脚本加载，不改人设/世界书/聊天数据、主题、账号后端或正式环境。
- 新公共模块 shared/js/phone/ai-response-parser.js 将三个模式独立：严格 JSON（非法数据不得冒充成功）、正常聊天正文（仅解包确实结构化的完整文本）、面对面回复候选（唯一允许原文 Markdown 兜底）。普通聊天、群聊、多气泡、重新生成共用新回复处理；旧历史渲染和流中断保文未改。
- chat/date/date.html 将已测试的 150 行健壮函数移入共享模块，保留小型兼容包装；chat/date/journey.html 复用 JSON 提取但仍严格校验 4 条；PhoneAPI.completeJSON 与各已有 API 入口使用严格解析器，主动联系可按需先加载依赖。
- 浏览器页面只新增共享脚本标签（多数仅 1 处引用），不改 UI/CSS、钱包数据格式、SW、安全配置或 Worker。
- 独立专项 Node 真实隔离测试：44703025637、44703616046 均 PASS。原 QA TESTS 定义的完整 Node/Vite/Chromium 逐项门禁在固定代码快照上执行：44703782100 PASS。相关记录在 Bella0960/web-runtime-lab Actions。
- 本条记录时 QA #299 尚未整合新解析器、Cloudflare 未更新、Android/iOS 真机未验收；最终整合后需要对原 QA 新提交完整复测，且仅通过既有 QA-only 发布路径，核对同源构建回执和身份核心不变。

## 2026-11-20｜MUSIC-IMPORT-003｜Android 文件选择器音频空文件误判

- 本任务从唯一 QA #299 `818753615da5ea88b719587d3bc65ce21ff39a8e` 创建独立分支 `task/MUSIC-IMPORT-003-android-picker-read-20261120`，仅修改 `music/music.html` 的格式探测及导入处理，以及已有 `tests/music-extensionless-import.test.mjs`。不修改主题、聊天、音频 UI、音乐数据键、IndexedDB schema 或正式环境。
- Android 文件名可能是纯数字且 `size:0` 或缺失；旧版直接返回 `reason: empty`。新增实际字节探测与受限重试（`arrayBuffer` / `FileReader`），并区分空数据与读取错误。正常正数大小保持仅抽取 256 字节文件头。异常选择器以实际读取内容重建 Blob，用真实大小存入既有 IndexedDB；持久化前拒绝空 Blob，原目录与旧曲目不被改写。
- 测试：原 `tests/music-extensionless-import.test.mjs` 扩展实际零字节误报、FileReader 恢复、重试、空文件、权限错误、数字文件名、存储回滚；连同 `tests/music-data-integrity.test.mjs` 在封闭公共隔离执行器通过：[运行 #44708572456](https://github.com/Bella0960/web-runtime-lab/actions/runs/44708572456) PASS（固定功能代码 `867ce2e3946542f5adcca3a83f6a131b5d259411`）。
- 当前仅为**独立任务代码和专项 Node 回归通过**；完整 Node/Vite/Chromium、真实 Android/iPhone 文件选择器与 QA-only 版本发布均**未验收**。禁止将此状态称作手机已修复；下一步审核 PR 并按原完整门禁后方可合入 QA 和部署。

## 2026-11-20｜MUSIC-IMPORT-004｜安卓受保护文件容错提示

- 手机真实问题：`SettingsClipRings` 一类可能受系统保护的文件来源出现 `音频读取失败：1000133976`。仅以用户描述推测 Scoped Storage，不能仅凭文件名绝对证明权限拒绝。
- 基于唯一 QA #299 `b9558fb349776ba338d222b868877410d1289e6f` 创建独立分支 `task/MUSIC-IMPORT-004-protected-file-notice-20261120`。仅修改 `music/music.html` 的文件探测读取超时、读取异常后提醒与批量跳过；已有 `tests/music-extensionless-import.test.mjs` 新增异常抛出、连续文件、受保护文件重复提示去重、悬而未决的读取超时的测试；不改音乐库数据存储、聊天、UI 主题、账号、Worker 或正式版。
- 受保护文件读取拒绝会显示不带技术错误码的友好提示，建议复制/移动到普通手机本地存储「下载」目录，允许重新选文件；再次尝试不修改旧歌曲。受限公共测试运行 [#44711875620](https://github.com/Bella0960/web-runtime-lab/actions/runs/44711875620) **专项 PASS**；完整 Node/Vite/Chromium、QA-only 正式发布与真机「下载」MP3 测试仍以稍后真实记录为准。

## 2026-11-20｜MUSIC-UI-004｜音乐列表真实时长与副标题

- 用户手机已验证 Android 下载 MP3 可以正常导入播放，要求移除最近播放中“本地导入”副标题，把右侧“本地”替换为真实音频时长并收敛字号、灰阶，暂未读取成功的歌曲显示 `--:--`。
- 基于唯一 QA #299 `2f5268fde0bc8b3a619ee70864b1515e4b30e07d` 创建独立 `task/MUSIC-UI-004-duration-artist-list-20261120`，仅修改 `music/music.html`、对应测试。已有导入/Blob/播放/账号协议不改。旧 `artist:本地导入` 仅 UI 兼容展示为未知歌手，不修改旧资料；新导入默认未知歌手、duration:--:--。
- 用独立 Audio + Blob URL 异步读取 metadata.duration，限时后释放资源；真实时长只在能成功保存到当前 catalog 时更新 UI，逐条恢复旧歌曲的缺失时长，保持 `music_local_tracks` 与 IndexedDB 原 schema。
- 原公共隔离 Runner 真实三组音乐专项测试：[44716624928](https://github.com/Bella0960/web-runtime-lab/actions/runs/44716624928) PASS，固定代码快照 `1f6ebfecaa7e3b07bfab88a92c928c75e382689f`。QA-only 完整 Node/Vite/Chromium / Cloudflare 发版和 Android 真机 UI 验收待以本轮实际回执为准。

## 2026-11-20｜CHAT-HISTORY-001｜群聊私聊回执防旧记录覆盖

- 清道夫检查了已有 PR #305（后台消息已在 QA 使用 ChatHistoryAtomic）、#282（主记录优先已进入 QA）、#307（世界书另有整合），发现现有唯一 QA `1710f69f970312543ea66848cd7c7204fc7dc1f1` 的 `chat/chat/chat-detail.html` 群私聊回执仍然先取 PhoneStorage 旧副本、再整份写回目标角色聊天历史，可能覆盖新的或异常的原始记录。
- 只修一个 DATA/CHAT-HISTORY-001 问题：从当前 QA 创建 `task-CHAT-HISTORY-001/group-private-safe-append-20261120`，只修改群私聊回执的目标角色写入路径：优先现有 `PhoneStorage.result.appendChatHistory`，对读回的原始 `chat_history_<id>` 做 MID/身份/群来源验证；失败不生成公开群私聊卡，也不误提示保存成功。不重新写普通私聊、世界书、外观或推送。
- 追加 `tests/group-turn-integration.test.mjs` 的五类损坏主键/旧 v2 副本/保留图片与引用字段/伪成功/空数组主键回归，原合同测试保持。已有公共隔离 Runner 定向五组测试 [#44719212719](https://github.com/Bella0960/web-runtime-lab/actions/runs/44719212719) **PASS**，固定功能提交 `282be457deb747b3838c26b2d9290bf79a9fc251`。
- 完整 Node/Vite/Chromium 和唯一 Cloudflare QA-only 发版尚待最终回执；真实 Android/iOS 群聊私聊验收仍需用户确认。正式 main、身份核心和生产账号未变。

## 2026-11-20｜CHAT-RP-001｜人设与协议缺失时用户消息无重试入口

- 从唯一 QA #299 `5b16f7890b302810039d59970ce75451d2fadc47` 排查世界书/人设/发送链：旧世界书绑定分支内容已经进入 QA，未重新合并或覆盖。实际 P0 缺口出在 `chat/chat/chat-detail.html` 保存用户消息后但发起 PhoneStream 前的 required-source 检查：缺少/读取失败的全局协议、最终人设源校验失败、世界书或群人物设定过长会直接 return，导致已经存下的用户气泡不带失败感叹号且无法快速重试。
- 在 `task-CHAT-RP-001/required-source-retry-20261120` 最小修复：仅在当前用户消息经过安全写入和 MID 校验后抓取同一个 MID；复用 `_markUserSendFailed` 写入失败原因，显示已有 UI 感叹号，不重复提交、不绕过必需的人设/协议/世界书 API 前置保护。若标记落库失败，真实告警、不报成功；重生成/继续聊天和既有 retryTarget 不追加消息。
- 影响文件：`chat/chat/chat-detail.html`, `tests/chat-required-source-retry.test.mjs`, `package.json`, 工程记录。角色用户数据结构、worldbook、原全局人设协议、群身份和正式 Worker 均未更改。专项、完整 QA、Cloudflare 发布结果以实际独立运行回执为准。

## 2026-11-20｜CHAT-PROMPT-001｜提示词源优先与手机本机诊断

- 从唯一 QA #299 `8d2267b1e69ff8f643fad533bf1250f6023efcc1` 出发。此前手机实际回复仍可能出戏，但静态代码确实组装了角色人设、触发世界书和全局保存协议，发送前只记录长度而无法验明手机实际请求全文。此轮不声称已获取手机本地的真实人设文本。
- 在 `task-CHAT-PROMPT-001/qa-payload-debug-source-first-20261120` 按最小范围处理：`chat/chat/chat-detail.html` 缩短重复的内置人格说教，保持保存的协议原文处在角色模板之前；`shared/js/phone/chat-regex-policy.js` 向 System 头部提供启用、合法且可作用于自然语言的正则规则说明，同时 **不更改** 回复确定性清理行为；新 `shared/js/phone/prompt-diagnostic.js` 仅在 QA 经五连点标题主动开启后查看和复制完整原始请求；新增 `tests/chat-prompt-payload-diagnostic.test.mjs` 并合入聊天契约测试。
- 不改 worldbook 绑定、角色 ID、聊天历史数据、协议存储键、API Key、支付/账号、正式 Worker。每轮诊断只留在用户设备的页面和本人控制台，不上传至公共回归日志。发布后用户需在测试手机上以本机测试角色自行查看真实请求，以区分上下文拼装缺失与模型没有遵循设定。


## 2026-11-20｜CHAT-PROTOCOL-001｜空白人设错误覆盖全局伴侣协议（PR #319 真机验收）

- **手机复现：** 只有角色名的「测试一号」回复自称“人工智能”，与用户在全局伴侣协议页显示的身份/语气约束相冲突。截图本身不能证明当前协议编辑内容已经点击保存，故不假设设备的真实 localStorage 值。
- **证据与根因：** #299 QA 基线 `3ce5e2357c7b9c71be12cbcac25bb4f5461a2694` 的 `chat/chat/chat-detail.html` 在线首轮读取、发送前复核以及 `shared/js/phone/chat-role-context.js` 共用来源封装中，均错误地用 `personaIncomplete ? MINIMAL_PERSONA_PROMPT : DEFAULT_PROTOCOL` 选择协议；当角色空白而全局协议键尚未显式保存时，会吞掉编辑器展示的应用级默认协议。群聊还将成员说明置于已展开协议前。
- **最小修复：** 空白人设只用 `MINIMAL_PERSONA_PROMPT` 代替缺失的角色档案片段；无论档案是否完整，协议来源始终为 `chat_rp_protocol_` 非空已保存值，否则为应用级默认协议；两个来源都缺失则停止生成，不用角色兜底冒充协议。群聊参与者说明追加在协议之后。保持所有角色、记忆、世界书、原始本地存储和 UI 不变。
- **源码验证：** 独立分支 `task-CHAT-PROTOCOL-001/weak-persona-preserve-global-rp-20261120`；隔离 JS/V8 执行真实来源模块、系统源码断言和主脚本语法校验 **15/15 通过**，覆盖默认协议、已保存自定义协议、弱人设变量替换、缺失协议阻断与群聊段落顺序。更新 `tests/chat-strict-role-isolation.test.mjs` 的旧错误期望及新回归；**完整 Node CLI / Vite / Chromium / Android / iOS 尚未运行，不能视为验收完成**。
- **发布保护：** 本分支只供 PR 审查，尚未合并 #299 或部署 QA；`main`、正式 Worker、身份核心、数据库、用户协议原文与聊天记录不变。下一步需要受限公共 Runner 完整回归成功后才能合入同一 QA 并 QA-only 发布，再用手机复测“你叫什么 / 什么工作 / 你认识阿晴吗”。


## 2026-11-20｜CHAT-RP-IDENTITY-002｜手机弱人设别名幻觉、虚拟朋友自述（P0）

- **用户真机复现：** #320 的协议覆盖修复发布后，「测试一号」不再自称 AI，但凭空叫自己「阿屿」，随后自称「虚拟朋友」。这是已部署 QA `904cdfa24c1e961c552cc8670f87d3a5d0bdfc7f` 上的新失败行为，不等于协议加载缺失。
- **两处 Prompt 收紧：** 默认全局伴侣协议最前新增唯一 `MAOMAO_RP_IDENTITY_GUARD`，禁止自称虚拟人物、虚拟朋友、程序或模型，遇到不理解的问题按照当前角色口吻反问。对旧自定义已保存协议，在线/线下/自主聊天在本轮最终 System 前动态注入该规则，**不写回覆盖存储**；移除默认协议中与新规则矛盾的“角色确实是数字生命时可如此自称”描述。空白/仅姓名角色额外按角色记录中的准确 `name` 生成 `buildWeakPersonaNameGuard`，禁止自取姓名/沿用旧模型生成别名、职业和关系。最终 System 校验必须包含准确角色姓名锁定及应用级身份约束，缺失停止发送且保留用户消息重试。
- **边界：** 只改协议默认值、共用角色上下文、线上 System 组装、原设置及线下两页的脚本版本、相关 Node 回归。群聊使用当前发言角色姓名；旧角色档案、消息记录、世界书、记忆、角色ID及存储键均保持不变。不新建测试站/Worker，不动生产、身份核心和 DB。
- **待验证：** 固定 QA 基线起的独立分支 `task-CHAT-RP-IDENTITY-002/weak-name-and-global-identity-seal-20261120`，需公共隔离通道先通过目标 Node、聊天契约、Vite/Chromium，再整合 #299，随后在固定整合 SHA 上执行原完整 QA-only 门禁、核对新 Cloudflare 版本、QA 同源回执。手机表现需项目负责人再次真实验收；Prompt 不能替代实际模型表现测试。

## 2026-11-20｜CHAT-PROMPT-001｜角色身份与聊天请求等待

- PR #326 在最终聊天 System 首部固定角色身份和档案姓名，按原样展开变量，空档案不得虚构职业、年龄或经历。线上聊天的响应头与流式空闲等待均为 60 秒。
- 本地从 QA 源码及候选改动运行提示词专项，7/7 通过。完整 QA 回归和发布须以公共隔离通道回执为准。

## 2026-11-20 · CHAT-PROMPT-001 capacity fallback

- From QA `3cf0aac74bcc667639bd7dcf51c1cec66a9a248b`: PhoneStream previously sent one request per invocation and forwarded raw capacity errors. Manual retry re-enters the same source assembly and preflight, so the reported screenshot alone does not establish a missing System message.
- Same-endpoint fallback snapshots the validated messages, only swaps the model, and refuses fallback without a character System message or after primary output. Exhausted capacity shows a short toast. No schema migration. Revert this task's commits to roll back.
- Local targeted Node capacity suite: 5/5. Full isolated QA gates and mobile deployment pending.

## 2026-11-20｜CHAT-UI-001｜聊天底部功能面板

- 底部面板采用五个常用功能和五个胶囊入口，群组工具与更多按需展开。使用现有交互处理器、角色表情收藏和语音消息编辑器。面板在输入栏下方占据布局空间。
- 更新现有 Chromium 几何、交互和番外路径测试，并同步 PWA 资源版本。通过公共隔离通道运行完整 QA 门禁。

## 2026-11-21｜CHAT-UI-001｜常用功能条

- 第一排使用一个浅灰圆角背景与等宽透明按钮。第二排沿用胶囊样式。
- 排查群聊请求。浏览器的 `Failed to fetch` 在流式请求中归入 network 分支，容量回退只匹配 HTTP 503 和服务端容量错误。截屏无法区分网络、跨域或 API 地址，未改请求策略。

## 2026-11-21｜群聊作息与显式点名

- 群聊已有「群聊对话设置 → 作息感知」。默认关闭；启用时，未配置成员使用 08:00—23:00。用户发出的明确 @ 可临时纳入候选，仍检查禁言和存活人设。

## 2026-11-21 · DATA-004 Token 与 API 监控

- 设置底部增加默认关闭的开发者监控，线上聊天和赴约共用悬浮球。PhoneStream 按实际尝试记录 HTTP、超时和连接结果，保留现有请求参数与重试行为。
- 仅记录计数、时间、分类及脱敏端点，保留最近 50 条。明文请求、回复、查询参数和 API 凭证不写入诊断日志。旧数据无需迁移，回退代码即可撤销功能。
- 新增原生 Node 和 Chromium 合同检查，完整回归通过后才发布手机 QA。

## 2026-11-21 · DATA-004 global diagnostics

- The common HTML build hook injects the monitor on each application page. The setting changes visibility only. A shared PhoneStream attempt persists a pending entry before dispatch and updates usage or the error when it settles. The existing diagnostic ledger and its latest-50 limit are preserved.
- Legacy API logs are incomplete summaries without usage and endpoint data and can overlap the monitor ledger. They are left intact, without silently importing duplicate or fabricated accounting. No historical Token reconstruction is possible for requests that were never captured.

## 2026-11-21｜群聊一轮一条与头像心声

- 新建群显式关闭作息。群聊正文统一为一条，完成解析后呈现；成员名使用浅灰小字。心声随群成员回复保存，头像弹窗读取，兼容旧正文标记。
