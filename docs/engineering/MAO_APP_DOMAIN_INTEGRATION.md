# MAO 唯一手机域名安全接入说明（2026-11-11）

## 用户确认的实际可用入口

- **唯一目标入口：** `https://app.mao520.com/`
- 用户确认该域名的旧版小手机可以用手机浏览器打开；不是从 Cloudflare 配置推断出的“已验证可用”。
- 用户反馈 `mao520.com/?utm_source=chatgpt.com` 发生过非 MAO 页面跳转；该根域名目前不是可交付的正式入口，不得引导输入密码。
- 管理员与普通用户必须同域登录；管理员 `001` 是唯一 `super_admin` 的显示编号，不是公开注册账号、权限凭据或原始 `MAO-...` 永久身份 ID。

## Cloudflare 现状（读取得到的配置）

| 主机 | 当前 Worker | 运行状态/安全限制 |
|---|---|---|
| `app.mao520.com` | `curly-dream-324c` | `ASSETS` only，持续接收 `main` 静态版本更新，无真实账户后台 |
| `mao520.com`、`auth.mao520.com` | `mao-auth-preview` | `ASSETS`、`CLOUD_DB` Durable Object、管理员初始化与设备安全 secrets，单独账户存储 |

**不要直接把 `app` 域名改绑旧的 `mao-auth-preview` 版本。** 两者分别部署了不同时期的小手机代码，且 Cookie 不跨子域自动共享。

## 当前整合方案

1. 从用户正在使用的 `main` HEAD `0e3f29ed8fd1ace328fc149ce3055163cc6220f5` 新开本分支，保留最新教程、聊天、多气泡、头像/图库、现有桌面布局和用户照片。
2. 仅移植已审计的账户前后端、同源账号数据隔离、管理员中心、数据库迁移与设计素材，不拿旧分支整体覆盖 `main`。
3. `worker.js` 对所有应用 HTML 做服务器端账号和角色检查；管理员专用操作只接受 `super_admin`。
4. `sw.js` 将旧版本缓存更新到 `v204`，登录页/初始化页可缓存，受保护 HTML（含根路径）不得缓存优先或被预缓存。其他普通静态资源尽量保留既有缓存逻辑。
5. `index.html` 仅在服务器注入 `mao-account-role=super_admin` 后恢复和显示管理中心；普通用户不显示，CSS 保证即便桌面样式 `display:flex!important` 也不会泄露图标。
6. 超级管理员沿用当前浏览器原有 `localStorage` / IndexedDB / 自定义字体数据；普通用户使用与 `MAO-...` 账号绑定的独立命名空间。
7. `account/account.js` 使用统一入口，完成授权后直接进入同源桌面；设置中的账户行打开账户管理。

## 最终切换前的必要条件

- [ ] 云端编译、账户权限/隔离、PWA 门禁、教程、聊天、媒体、桌面回归全绿，并留存版本 SHA。
- [ ] 生成包含当前 `main` 功能的新一版**隔离 Worker 测试部署**。确认与目标应用资产完全一致，绝对不能仅凭旧的头像/首页预览宣布完成。
- [ ] 验证用于 `app` 域名的实际 Worker 有 `CLOUD_DB` / 所需 secrets，配置不得泄露明文；保留账号数据库。管理员首次初始化须验证真实操作人，不可简单让注册的第一个用户成为管理员。
- [ ] 核对 `app.mao520.com` 主机下的全站授权与本机数据保留（浏览器会话和 IndexedDB 以 origin 为界）；跨域 Cookie 不可复用。
- [ ] 制定可执行回滚：记录 `app` 原绑定 `curly-dream-324c`、部署版本、Cloudflare routes，以及新的 Worker 名称和部署版本。若手机真实浏览器验证失败，应能够恢复原绑定。
- [ ] 用户明确同意生产入口切换后再操作 Cloudflare Custom Domain；**不因完成分支或 PR 就默认合并/切换。**
- [ ] 最终真机用旧 `app` 链接检查：统一登录、`001` 管理中心、普通账号邀请码、跨账号隔离、聊天/教程/壁纸及照片；确认无跨域跳转。
- [ ] 确定日后 `main` 到账号 Worker 的自动构建与资源绑定路径，避免 `app` 指向旧版本或自动被不相关分支覆盖。

## 本分支不可误报事项

- 尚未把唯一真实管理员身份绑定到用户本人；数据库唯一索引仅保证最多一个。
- 尚未迁移正式 `app` 入口，未变更 `main`，也没有在真机上验证。
- `mao520.com` 跳到外站的问题仍未复现定位，不能视为已修复。

## 2026-11-13 二阶段上线补充（以 Cloudflare 实际读数为准）

本次复核发现以下**可验证的发布前状态**（不是正式上线完成）：

| 检查项 | 2026-11-13 实际状态 |
|---|---|
| `app.mao520.com` | `curly-dream-324c`，仅 `ASSETS`，绑定已启用 |
| `preview.mao520.com` | `mao`，Custom Domain 绑定已停用 |
| `mao520.com`、`admin.mao520.com` | `mao-auth-preview`，绑定已启用，具独立 `CLOUD_DB` 和 secrets |
| `mao` Worker（拟作为正式账号 Worker） | `ASSETS` only；缺 `CLOUD_DB`、`nodejs_compat`、两项账号 secrets；workers.dev 入口已启用 |
| SQLite Durable Object 命名空间 | 当前共有 36 个 `CloudDatabase`，包含历史分支/QA；尚未出现唯一目标 `mao_CloudDatabase` |

**不要把 `mao_integration-...` 等分支命名空间误认作正式账号数据库，也不要清理它们。** 验证命名空间时不仅比对 ID，还检查 `script`、`class` 和完整 `name`。

### 第一阶段：隔离准备和测试，不切换正式域名

1. 使用 PR #262 当前账号整合代码及最新 `main` 功能，在 `mao` Worker 的独立测试入口构建/部署，明确由 `mao` 自己拥有 `CloudDatabase`，采用独立 `mao_CloudDatabase` SQLite 命名空间，不跨 Worker 绑定 `mao-auth-preview`，也不复用任何历史 QA 命名空间。
2. 确认在 `mao` 上存在 `nodejs_compat`、`DEVICE_SECRET_PEPPER`、`MAO_SUPER_ADMIN_BOOTSTRAP_SECRET` 的正确**绑定名称**；密钥值绝不进入 GitHub、日志或对话。密钥值本身的正确性不能仅凭“名称存在”通过。
3. 在 #262 的安全配置环境中执行 `npm run verify:accounts:staging`。该命令仅通过 Cloudflare GET 请求验证 Worker、域名未切换、绑定、密钥名称和 SQLite 命名空间的归属。**它不会部署、注册、初始化管理员或切换域名。**
4. 通过独立测试入口完成安全初始化和验证创始管理员 `001`（必须由本人授权的服务器端步骤执行），随后用虚构普通账号验证注册、邀请码、管理员审批、跨账号隔离、会话撤销和聊天保存。PR #265 的好友功能需在同一账号架构下按范围验证。
5. 用 Android / iOS 浏览器实际验证整个入口、缓存与私人本机数据迁移；在此之前不认定上线完成。切换前必须备份浏览器本机记录（含 IndexedDB）、记录 Cloudflare 现有 Worker 版本与域名配置，并预先验证可执行的代码/域名回滚。

### 第二阶段：受控切换与发布后复核

1. 只有第一阶段通过、管理员身份归属和生产数据策略确认、用户明确同意后，才将 `app.mao520.com` 从 `curly-dream-324c` 切到已验证的 `mao` Worker。
2. 此后运行已有严格的 `scripts/verify-production-account-readiness.mjs`，检查**真正的** `app.mao520.com` 当前绑定、数据库隔离、生产密钥绑定与公开的创始管理员初始化状态。首次部署之前的 `app` 仍是静态站点，所以此严格检查**预期不通过**；这正是要分成两个阶段的原因，不能添加跳过检查的环境变量放行生产。
3. 再做 `app` 域名下的真实注册 POST、普通账号和 `001` 权限、安卓及苹果浏览器操作、照片和聊天保留等最终验收，再讨论 PR 合并和后续 `main` 自动发布。
4. 如果发布后失败，可以回滚 Worker 代码与域名路由，但**不能把代码回滚等同于数据库回滚**。切换后产生的新账号/消息写入需先妥善保全，避免切回静态站点造成数据分裂。不得误删旧命名空间或覆盖正式数据。

### 代码保护

- `scripts/verify-account-staging-readiness.mjs`：第一阶段只读审计。新的 `tests/account-staging-readiness.test.mjs` 已进入 `test:release:accounts`（进而由 `prebuild` 调用）。
- `scripts/verify-production-account-readiness.mjs`：第二阶段严格发布门禁，新增明确校验域名绑定必须 `enabled === true`。
- 本补充仅属于 PR #262 的代码与文档，不修改 `main`、正式域名/Worker、Cloudflare 数据库及任何 secrets。

### 离线/本机完整账号测试入口（无需 GitHub Actions）

独立检出当前账号整合分支，使用 Node 22.16+（22.x），安装 Git、Node 和 npm 后执行：

```bash
node scripts/run-account-auth-gate.mjs
```

该命令依次执行 `npm ci`、全部已追踪 JS 文件语法检查、`npm run build`（带 prebuild/postbuild 回归）和真正的本地 Wrangler + SQLite 账号接口 E2E。测试的密钥和账号为临时生成，SQL 数据存储在独立临时目录；如果项目根目录已有 `.dev.vars`，测试会明确拒绝，防止覆盖私人密钥。Wrapper 要求 Node 22.16+ 的 22.x 版本。Wrangler 首次运行可能需要 npm 联网下载，不依赖 GitHub Actions/Cloudflare 自动构建额度。

此本机入口**不代表**真实域名部署、管理员本人身份绑定、安卓/苹果实机或注册线上 POST 已通过；上述项目继续单独保留发布门禁。
