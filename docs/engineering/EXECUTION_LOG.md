# MAOMAO Execution Log

This is the durable checkpoint for owner-assigned, multi-step work. Update it after meaningful milestones and before ending a session.

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
