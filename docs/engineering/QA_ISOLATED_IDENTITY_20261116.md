# MAOMAO｜唯一 QA 独立身份初始化与联通（候选方案，尚未部署）

> **最新已核实状态（2026-11-16）：** Cloudflare 的 `maomao-identity-core` 已经存在 `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET` 和 `DEVICE_SECRET_PEPPER` 两项 `secret_text` 绑定；值不可读，也未复制到仓库。该 Worker 当前版本 `ee8b8249-93a5-48ba-86fe-95e45a972d99` 仅为密钥配置后的版本，**不是 #299 新版代码**。原 QA 仍指向旧网关，暂未部署 #299，也未完成真实登录。两套数据库命名空间必须保持不同，不得删除或合并。

## 现状和安全边界

- 唯一 QA Worker：`maomao-aw-qa-20261114`，它的 CloudDatabase Durable Object 命名空间与正式账号 Worker `mao-auth-preview` 不同。
- QA 现有唯一超级管理员是委托导入的影子身份（只读账号审计 `identity_authority_import=1`），本地密码是不可登录占位。不能简单关闭委托认证，也不能删除或重建此记录。
- 实际部署的 QA Service Binding 仍指向旧身份网关；网关又转发至当前 Cloudflare 账号不存在的旧 QA Worker。另有现成 `maomao-identity-core` Worker，独立空库、无账号/会话；初始化所需的两项 Secret 已于 2026-11-16 配置，workers.dev 入口已禁用。
- **绝不直接把 QA 绑定到正式 `mao-auth-preview`**。不得克隆正式账号密码、session、角色记录或支付数据；不得修改正式管理员、正式路由、正式数据库或正式 Secret。

## 代码实现（#290 → #299 堆叠）

1. `worker/lib/qa-identity-bootstrap.js` 提供默认关闭的 QA-only 初始化适配层。在原 QA 的指定 workers.dev origin 才接受请求，先验证现有影子管理员的 ID、角色、状态及用户名。
2. 服务端只通过 `MAO_IDENTITY_AUTHORITY` Worker Service Binding 查询目标身份 Worker 的 `/api/admin/bootstrap/status`。必须收到 `identityMode=local`、`initialized=false`、`configured=true`、`bootstrapAllowed=true`、`qaIsolatedAuthority=true`，且 `qaExpectedFounderId` 与原 QA 管理员 ID 一致，才允许传递一次性 QA 初始化密码；任何不匹配都 fail closed。
3. **原身份核心**在显式 `MAO_QA_ISOLATED_IDENTITY_CORE=true` 且 `MAO_QA_FOUNDER_ID` 格式正确时，使用该 ID 作为空库一次性管理员 ID。其他环境保持随机 ID 的现有初始化行为。
4. 新身份由 `maomao-identity-core` 自己使用原有 PBKDF2、事务、审计和单次 bootstrap 创建，**QA 自己的独立新密码**仅由用户在 QA HTTPS 页面填写；不是正式管理员密码。
5. QA Worker 不转发身份核心的 `Set-Cookie`，初始化后跳转 QA 账号登录页，再通过既有 `existing_worker` 认证适配器与原 QA 管理员影子记录匹配，保留该 ID 对应的测试数据和角色。
6. 旧的生产/正常委托初始化保持拒绝；新增 QA 模式默认为关闭。所有新密钥由安全渠道配置，永不写入仓库或聊天。

## 只有在完整源码验证通过后才能实施的 Cloudflare 操作

**此列表是待执行条件，不代表已经配置。**

- 先于实际写入核对原 QA 管理员唯一 ID、用户名一致性、原 QA 聊天/角色备份和 `maomao-identity-core` 空库只读状态。真实 Worker 名、绑定、现有数据以及回滚点必须逐个验证。
- 仅在独立 `maomao-identity-core` 配置 `MAO_QA_ISOLATED_IDENTITY_CORE=true`、`MAO_QA_FOUNDER_ID=<既有 QA 永久 ID>` 以及两组不同的 QA-only Secret `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET`、`DEVICE_SECRET_PEPPER`。不得复用正式密码、哈希、Secret。
- 保留**同一个** QA Worker/Cloud DB，验证它的 `MAO_IDENTITY_AUTHORITY` Service Binding 真正指向 `maomao-identity-core`（不是旧 gateway 或正式账号 Worker）。在 QA Worker 临时设置 `MAO_QA_IDENTITY_SETUP=isolated_authority` 和 `MAO_QA_AUTHORITY_WORKER=maomao-identity-core`，保留委托模式及既有安全密钥。
- 先完成真实 `npm ci`、`npm run test:account:ui-candidate`、`npm run test:tutorial`、`npm run build`、Chromium，以及对账号回归/QA Cookie/登录的整体验证；相关测试未跑不得修改线上运行 Worker。
- 用户仅在**唯一、已核实 origin 的完整 QA**的 `/account/bootstrap.html` 选择**不同于正式版**的 QA 专属密码，提交一次；用户名与旧 QA 管理员一致。检查返回的是 `qa_login` 而非自动登录，重新到 QA 登录页完成验证。
- 成功后将**唯一 QA** 的 `MAO_QA_IDENTITY_SETUP` 改为字面值 `disabled`，并同步更新 `wrangler.qa.jsonc` 的同名变量，防止后续 Wrangler 部署重新开启初始化入口；**不能**关闭独立核心的 `MAO_QA_ISOLATED_IDENTITY_CORE`（就绪探测仍需识别固定 founder）。执行 QA 登录/退出/刷新/跨角色隔离/现有聊天历史恢复回归，验证原 ID、角色、钱包/记忆等测试数据未丢失，记录 Worker 版本、QA 入口、真实测试与验收结果。
- 若初始化 POST 超时或返回未知状态，**先只读检查身份核心的账号和审计**，不要重复创建、重置或覆盖用户数据。不得因为构建/GitHub Actions 额度不足而绕过测试。

## 2026-11-16｜直接发布到唯一 QA（绕过已耗尽的构建额度）

已在 #299 原分支加入：
- `wrangler.qa.jsonc`：**只允许目标 `maomao-aw-qa-20261114`**，使用旧的 `CloudDatabase` 类名和 v1 迁移标签、`ASSETS`、`AI` 及原有 QA 运行变量；`MAO_IDENTITY_AUTHORITY` 绑定明确转到**既有独立** `maomao-identity-core`，不能指向正式账号 Worker。
- `wrangler.qa-identity-core.jsonc`：只允许目标现有 `maomao-identity-core`，不接前端静态资源，也不修改 `mao`、`mao-auth-preview` 或 `curly-dream-324c`。明确指定既有 QA 永久管理员 ID，但不附带正式密码或任何 Secret。
- `scripts/qa-direct-release.mjs`：完整原分支 checkout 的一键构建和受控发布入口。直接 Wrangler 上传，不使用 Workers Builds 分钟，也不依赖 GitHub Actions。

**在可执行完整私有仓库的工作环境**，检出 `integration/account-fanwai-stack-20261115`（#299），确认工作树无本地未提交改动。先运行 `npm run qa:release:check`；此命令会顺序执行 npm ci、账号专项、账号+番外整合、教程、聊天合同、PWA、Vite 构建、Chromium 安装及番外浏览器烟测，任一失败即停止，**不部署**。

发布前，还必须通过 Cloudflare 管理控制台或受保护的工作环境**只在** `maomao-identity-core` 配置两项全新的、不同于正式环境的 QA-only Secret：`MAO_SUPER_ADMIN_BOOTSTRAP_SECRET` 和 `DEVICE_SECRET_PEPPER`。严禁向聊天、GitHub、日志或截图传递密钥。**更新：2026-11-16 Cloudflare 只读 API 已核实这两项已配置为 Secret；禁止再次要求用户重复创建或在聊天中提供其值。** 原先“尚未配置”的结论已过期。

只有上述完整测试通过，且 QA 账号/身份库只读检查通过后，才在受保护环境设置 Cloudflare 发布 Token、Account ID，并用确切 Worker 名的确认变量调用 `npm run qa:release:deploy`。脚本会再次执行所有测试、只读核对两套已有 DO namespace、唯一 active 管理员 001 和现有秘密绑定，之后**先升级现有独立身份核心、再升级现有唯一 QA**。任何不匹配直接拒绝发布。正式版/正式库不是目标。

QA 首次上线后由用户进入原 QA 域名的账号初始化页，可使用**原 QA 管理员用户名或永久 ID `MAO-OXHBDBWCOIHPBBYN`**确认既有身份；服务器将永久 ID 仅作为已有用户名的别名，真实创建仍严格沿用旧 QA 影子账号的用户名及原永久 ID，不新建其他管理员或改名。初始化密钥填写已保存在密码管理器中的同一份 QA 专用密钥，**不要重新生成**；新设置的 QA 登录密码须与正式版完全不同。完成一次性初始化后，返回 QA 登录页单独登录。初始化成功后必须关闭 QA 一次性设置：使运行中的 QA `MAO_QA_IDENTITY_SETUP=disabled`，且在原 #299 的 `wrangler.qa.jsonc` 同步设为 `disabled`；未同步不得进行后续新版 QA 发布。发布脚本已经增加生命周期核对：独立核心 0 账号只允许 `isolated_authority`，已有唯一管理员则只允许 `disabled`。禁用初始化入口后，再验收旧角色/聊天、账号 ID、番外剧场和手机浏览器。

**2026-11-16 补充门禁：** 本轮发布脚本不再只检查 Wrangler 返回码，而是要求两个现有 Worker 的 Cloudflare 实际 100% active 版本在各自部署后前进且来源为 Wrangler；QA 更新后还必须从**原 workers.dev 地址**匿名 GET `/api/admin/bootstrap/status` 和 `/account/index.html`，确认身份核心连接、一次性初始化开关与独立核心真实账号状态一致，且登录表单实际存在。空库初始化前允许 `signInReady=false` / `qaSetupAllowed=true`；管理员已创建并关闭入口后要求 `signInReady=true` / `qaSetupAllowed=false`。这些都是未来真实发布时执行的检查，当前仅在模拟 HTTP/Cloudflare 回执下验证，**尚未进行实际新版部署或真机验收**。

**当前发布状态仍是未完成**：直发入口及安全门禁修补已提交，核心两项 QA-only Secret 已配置，但本对话运行环境仍缺少完整私有 checkout、Vite/Playwright 依赖，因此上述脚本的完整工程运行和 Cloudflare 部署**均未执行**。不能把这份脚本或隔离局部测试当作真实部署回执。


## 2026-11-16｜QA 手机端实际可见性与旧缓存发布保护（本轮）
- 修复 `account/account.js` 的 QA 专用密码说明被 `account/ivory-entry.css` 隐藏的问题：只在确认独立 QA 时启用低干扰 `qa-login-hint`，原有普通登录布局不变。
- 修复 QA 身份尚未就绪时，`setAuthBusy(false)` 或其他表单操作可能重新启用登录提交按钮的问题；登录提交逻辑也会先检查 `delegatedSignInReady`，拒绝向未就绪的委托核心发送密码。
- 因 `sw.js` 对静态资源使用缓存优先策略，`account/index.html` 的登录 JS/CSS 及 `account/bootstrap.html` 的初始化 JS 已切换 `v=20261116-qa1`，避免原手机 PWA 继续读取相同 URL 的旧文件。本轮没有修改 Service Worker 的存储或账号缓存隔离规则。
- 现有 `scripts/qa-direct-release.mjs` 的 QA HTTP smoke 进一步要求原 QA workers.dev 入口实际返回**六项基础资源**：状态接口、登录 HTML、登录 JS、登录源 CSS、初始化 HTML、初始化 JS；另外解析登录 HTML 实际引用的**全部样式表**并逐个同源 GET，检查内容确实包含 `qa-login-hint`。这样兼容 Vite 合并/指纹化后的 CSS 路径，也避免仅有源 CSS 而页面实际加载旧 CSS。任何缺失、跨源链接、旧缓存或身份状态异常均不允许报告 QA 通过。
- `assertReadyForUpload()` 也追加 `dist/account/bootstrap.js` 和 `dist/account/ivory-entry.css` 构建产物检查。原 `tests/account-qa-bootstrap-route.test.mjs` 及 `tests/qa-release-live-version.test.mjs` 已增加相应回归。
- **本轮可验证结果**：针对原 GitHub 源文件运行独立 JS DOM 桩检查；从同一提交读取实际登录 HTML、JS、CSS 与初始化 HTML、JS 以及普通基础样式表，注入 HTTP smoke 的模拟响应，验证首次/已初始化、旧登录 JS、旧登录 CSS、旧初始化 JS、缺少已引用基础 CSS、模拟 Vite 指纹样式正常、跨源 CSS 被拒绝、核心断联等 **9/9** 场景符合预期；相关测试 JS 在 V8 中完成语法解析。**没有**实际运行 `npm ci`、Node CLI 全量、Vite 构建或 Chromium 手机视口，也没有从线上 QA 取得真实 HTTP 回执。不能把此记录当作已部署或已登录。
- 当前 `MAO_SUPER_ADMIN_BOOTSTRAP_SECRET`、`DEVICE_SECRET_PEPPER` 已在 Cloudflare 的独立身份 Worker 配置，不要重新让用户生成或发送。独立核心仍需完整工程测试后更新，唯一 QA 仍旧网关，正式版未改。

