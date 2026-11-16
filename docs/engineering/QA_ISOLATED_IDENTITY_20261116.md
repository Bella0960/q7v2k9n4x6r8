# MAOMAO｜唯一 QA 独立身份初始化与联通（候选方案，尚未部署）

## 现状和安全边界

- 唯一 QA Worker：`maomao-aw-qa-20261114`，它的 CloudDatabase Durable Object 命名空间与正式账号 Worker `mao-auth-preview` 不同。
- QA 现有唯一超级管理员是委托导入的影子身份（只读账号审计 `identity_authority_import=1`），本地密码是不可登录占位。不能简单关闭委托认证，也不能删除或重建此记录。
- 实际部署的 QA Service Binding 仍指向旧身份网关；网关又转发至当前 Cloudflare 账号不存在的旧 QA Worker。另有现成 `maomao-identity-core` Worker，独立空库、无账号/会话、无初始化所需的两项 Secret，workers.dev 入口已禁用。
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
- 成功后关闭 `MAO_QA_IDENTITY_SETUP`。执行 QA 登录/退出/刷新/跨角色隔离/现有聊天历史恢复回归，验证原 ID、角色、钱包/记忆等测试数据未丢失，记录 Worker 版本、QA 入口、真实测试与验收结果。
- 若初始化 POST 超时或返回未知状态，**先只读检查身份核心的账号和审计**，不要重复创建、重置或覆盖用户数据。不得因为构建/GitHub Actions 额度不足而绕过测试。
