# GOV-004 · app.mao520.com 静态入口安全切换候选（2026-11-15）

## 已核对的线上事实

Cloudflare Workers Domains 当前显示：

- `app.mao520.com` → `curly-dream-324c`，线上 Worker 只有 `ASSETS` 绑定。
- `preview.mao520.com` → `mao`，其正式 SQLite Durable Object 绑定不同于 QA。
- `mao520.com` → `mao-auth-preview`，有独立账号身份存储，**不得覆盖**。
- `maomao-aw-qa-20261114` → 隔离 QA 数据库，服务绑定经过身份网关，不是正式库。

旧 `wrangler.app.jsonc` 使用 `worker-app.js`；其 `fetch` 只分发静态资源，因此 `/api/accounts/*` 与 `/api/push/*` 在正式 app 域名会出现 404。域名注册与使用本身没有问题。

## 本分支的实际改动

为防止误操作，**保留**已经部署的 `wrangler.app.jsonc` 和 `worker-app.js` 不动；新增：

- `worker-app-cutover.js`：可选全站 Worker Service Binding 转发入口。默认关闭时继续调用原静态入口；打开时无条件把 HTML、API、SW、静态资源原请求交给现有 `mao` 完整 Worker，不自己复制密码或发放会话。
- `wrangler.app.cutover.jsonc`：目标仍是正式手机 Worker `curly-dream-324c`，并通过 `MAO_APP_BACKEND` 内部服务绑定连接 `mao`。开关 `MAO_APP_CUTOVER_ENABLED` 提交值必须保持字符串 `false`；不接入 QA 数据库，不添加第二套登录。
- `tests/app-domain-cutover.test.mjs`：验证默认不切换、完整同源请求/cookie 与 POST 原样转发、无 backend 时拒绝访问私有内容、非正式 Host 不被认作正式入口。已加入 release gate。

**重要：此 PR 的代码落地≠线上已修复。** 本轮绝不自动把 Cloudflare 正式域名切换或向生产 `curly-dream-324c` 上传新模块。

## 正式启用前的绝对阻断条件

1. 在可信证据中确认最终唯一管理员永久 ID `MAO-OXHBDBWCOIHPBBYN`，role=super_admin、status=active；验证原密码确实对该账号可登录，不能重新注册或复制 QA 密码校验值作为绕过。
2. `mao` 的独立生产账户与既有 `mao520.com` 真实成员资料、账号 ID、审计、邀请和钱包数据迁移/连续性方案须经过只读清点；不能删除或把 QA 数据库整体覆盖上去。
3. 对每一份涉及的账户/钱包数据库做可恢复备份并隔离环境演练真实恢复，同时保留原域名和浏览器本地 origin 数据；通过明确回滚演练。
4. 完整构建与 release gate，通过云端同源 `/api/accounts`、`/api/push`、管理员管理权限（当前 delegated 的 /api/admin/* 会返回 403，不是 UI 可以解决的）、匿名门禁、跨账号隔离和钱包并发验证。
5. Android 原账号旧密码实际登录、消息保存与推送；iPhone Safari 添加到主屏幕后身份、推送与缓存实际验收，且真实验收记录齐备。
6. 只有在以上条件均通过后，才允许将正式入口切换至这套代理并在服务器端启用开关。先验证后放量；不需要将 `workers.dev` 当作正式网址。

## 验证记录与局限

2026-11-15：使用 Node 22 在隔离本地目录按候选源码镜像执行 `node --test tests/app-domain-cutover.test.mjs`，**5 个测试通过、0 失败**；运行入口 JS `node --check` 通过。未完整检出私有仓库，因此 **完整 npm run build、原有 release gate、真实 Cloudflare Service Binding、生产浏览器与真机 NOT VERIFIED**。

回滚路线：默认开关关停时仍走原静态入口。正式切换若出错应先禁用切换开关再用现有 `wrangler.app.jsonc` 恢复经过验证的静态部署；涉及账户数据库的回滚需要单独采用已验收的数据恢复方案，**不能**把代码回滚当成数据库回滚。
