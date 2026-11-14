# ACC-001 · 真实账号数据连续性与正式入口发布门禁（2026-11-15）

## 权威证据（2026-11-15，Cloudflare Durable Objects Query v2，只读）

从已部署 Worker 当前绑定获取实际 namespace，针对每个数据库的 `maomao-global` 使用固定 `SELECT` 聚合；所有返回 `meta.rows_written=0`。不查密码、盐、账号详情、邮箱、会话内容或私钥。

| 账号存储所属 Worker | 账号 | 超级管理员 | 目标 001（active） | 普通用户 | 账号审计 | 会话 | 迁移 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `mao-auth-preview`（`mao520.com` 正在使用） | 2 | 1 | 0 | 1 | 4 | 3 | 17 |
| `maomao-aw-qa-20261114`（隔离测试） | 1 | 1 | 1 | 0 | 1 | 未在首次核查中统计 | 20 |
| `mao`（完整后台、独立空库） | 0 | 0 | 0 | 0 | 0 | 未在首次核查中统计 | 16 |
| `maomao-identity-core`（永久身份空库） | 0 | 0 | 0 | 0 | 0 | 未在首次核查中统计 | 16 |

目标唯一管理员 ID 为 `MAO-OXHBDBWCOIHPBBYN`，这里的计数是数据库事实，而不是向用户重新确认身份。旧账号源中有另一个超级管理员，不能用 001 网页标签或者简单重绑定域名解决。QA 中目标 ID 已存在并为 active/super_admin，**但不等于**正式库已持有该 ID、密码或用户数据。

此外，`mao-auth-preview` 当前有 `mao_invite_codes`、`mao_account_sessions`、`mao_account_audit`、`devices`、推送等业务表。原普通用户、会话、邀请、钱包/浏览器端内容不能凭两条账号记录“搬完”就声称连续性。浏览器本地 `localStorage` / IndexedDB 受 Origin 约束，需要单独迁移验证。

## 本次直接处理

- 修正已有正式发布门禁以认识两种可验证部署形式：`app.mao520.com → mao`（直接完整 Worker），或 `app.mao520.com → curly-dream-324c → MAO_APP_BACKEND(service:mao)`（保留已购域名上的原 Worker）。后者必须**实际部署** `worker-app-cutover.js`，开关严格 `true`，唯一 service 指向正式 `mao`，不能指向 QA 或借用 QA 数据库。
- 新增 `scripts/release/audit-live-account-inventory.mjs`：自动只读查询四个数据库的聚合、使用当前 100% 部署的版本 ID 核对 DO 绑定，阻止误用已上传但未部署的设置。手动运行需明确配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`MAO_EXPECTED_FOUNDER_ID`（不要把令牌写入仓库或聊天）。
- 将该真实账号核查作为 `verify-production-account-readiness.mjs` 的**强制前置门禁**，防止某个旧的、非目标 ID 的管理员让 `initialized=true` 就蒙混过关。
- 单元测试仅验证真实部署元数据、聚合查询格式、匿名和错误配置被阻止；**不自动迁移账号**，不执行任何生产 SQL 写入。

## 明确剩余的实际生产工作（不可省略）

1. 以现有正在使用的账号数据库为数据保护基准，确认该成员的账号及关联会话/邀请码/审计/设备数据完整且可独立恢复。DO PITR 书签不等于已经完成了可恢复演练，不能当“备份完成”。
2. 设计一个经隔离库演练的无损身份转移：在同一个可信账号源中保留**现有普通用户**原 ID/密码/会话策略，使唯一超级管理员成为经原密码证明的 `MAO-OXHBDBWCOIHPBBYN`。旧超管不得继续拥有正式管理权限；不能只用客户端角色名覆盖。
3. 对完整 Worker 选择真正可维护的长期存储承接方式（尽量沿用原数据权威库和经验证的外部 DO 服务绑定，而不是多开一套互相不认识的账户表）；保证 schema 迁移全是追加/兼容并验证回滚。
4. 后台确定后按已实现 `worker-app-cutover.js` 将整站请求同源转发，不允许仅代理 `/api` 而让私有 HTML 静态暴露。同步更新 **Cloudflare 正式自动发布 trigger**，否则下一次发布会恢复旧静态入口。
5. 验证 Android 原密码、原用户登录、钱包/推送、浏览器数据、iPhone 主屏幕 PWA 与推送，核对独立可恢复备份和回滚，最后才开启正式入口。

**目前严格结论：正式发布阻止是正确的；生产数据与域名未修改；这一轮是发布门禁代码改进和真实数据库只读核查，不是生产切换。**
