# PR #285 原账号、001 与双端推送验收

任务 GOV-004；检查时间 2026-11-14 UTC。检查对象为独立 QA：
https://maomao-aw-qa-20261114.miamor520000.workers.dev/

源代码：PR https://github.com/Bella0960/MAOMAO/pull/285 ，head
`071caffe9a35fca812404e1356eb8bb0ff490dab`。此次没有发布、修改远程分支、复制凭据或创建账号。
线上 SW 为 v240；本次未用 Cloudflare 部署 API 独立核对部署 ID，不把 SW 版本等同于 commit 证明。

## 已验证

| 项目 | 证据 | 结论 |
|---|---|---|
| 原账号入口 | bootstrap/status HTTP 200：identityMode=delegated，identityAuthorityConnected=true，identityAuthorityInitialized=true，signInReady=true | 身份源连接就绪 |
| 禁止二次初始化 | 同接口 bootstrapAllowed=false | QA 不开放新建 001 |
| 用户实际登录 | 用户回复“直接登进去了”，后确认使用 Android | Android 用户报告登录成功；是否重新输入原密码未确认 |
| 未登录账号查询 | accounts/me HTTP 401 LOGIN_REQUIRED | 无匿名账号数据返回 |
| 私有页面 | admin/admin-center.html、settings/cloud-push.html 均 HTTP 302 到 account/index.html | 未登录访问被阻止 |
| 社交审批门禁 | admin/social/friend-approvals HTTP 401 SOCIAL_LOGIN_REQUIRED | 未登录审批查询被阻止 |
| 推送订阅门禁 | push/subscriptions HTTP 401 UNAUTHORIZED | 缺少设备凭据不能查询订阅 |
| 推送配置 | push/config HTTP 200，ok=true，公开公钥存在、subjectConfigured=true | 配置就绪；不证明签名有效或通知送达 |
| 资源隔离与缓存 | worker.js HTTP 404，sw.js HTTP 200/v240 | 后端入口未作为静态文件公开 |
| 登录页浏览器 | 独立无登录 Chromium，在 390px、430px 视口打开真实 QA，登录表单可见，页面脚本错误为 0，无横向溢出 | 移动视口验证通过；不是 Android/iPhone 真机 |

## 001 权限仍需验收

用户未在账号栏看到 001。源码 `account/settings-link.js` 显示 `MAO ID · <永久 ID>`，不在该栏显示创始编号；`admin/admin-center.html` 顶部包含 FOUNDER · 001 和编号标记。
`/api/accounts/me` 的 publicAccount 对 super_admin 返回 founderNumber=001。实际会话中 role、status、founderNumber 及永久 ID 一致性，本次未获得认证访问，不能标记服务端身份验收通过。

**已确认验收失败**：用户补充 Android 进入管理员中心后会跳转到登录页面。线上 `/api/admin/accounts`、`/api/admin/invites`、`/api/admin/audit` 均返回 HTTP 403 / DELEGATED_ACCOUNT_MANAGED_CENTRALLY。源码在 delegated 模式下统一拦截这些路径，包括 GET；管理页 init/refreshAll 仍请求这些接口，catch 将任意 403 当作登录/权限失败，跳回 `/account/index.html?admin=1`。这与用户现象一致。因此不能把“能点进管理员中心”标为 001 管理权限通过。根因是托管接口边界和前端错误处理不匹配，不能据此推断原账号或 001 身份丢失。
本次没有改动这一身份管理边界，也没有尝试发放邀请码、修改账户或绕过权限。

## 本地回归

Node v24.22.1 执行 11 个文件，runner 报告 pass=11、fail=0：
account-auth-contract、account-entry-runtime、account-bootstrap-runtime、account-storage-isolation、admin-center-ui、delegated-identity-bridge、identity-authority-gateway、permanent-founder-preservation、cloud-push-founder-integration、cloud-push-service-worker-display、cloud-webpush-transport。
这些包含静态契约和隔离行为测试，不替代已认证线上账号操作、普通用户 403 或真机推送。本次仅验收与文档记录，没有修改应用代码，也没有重新运行完整构建。

## 真机记录（尚未完成）

| 验收项 | Android | iPhone |
|---|---|---|
| 原账号登录、刷新后保持 | NOT VERIFIED | NOT VERIFIED |
| 永久 ID 不变、active/super_admin、founderNumber=001 | NOT VERIFIED | NOT VERIFIED |
| 管理页停留且数据正常加载 | FAIL：用户确认跳回登录 | NOT VERIFIED |
| 开启推送且权限获准 | NOT VERIFIED | NOT VERIFIED |
| 发送测试通知后的页面提示 | 待用户反馈 | 待用户反馈 |
| 切后台后系统通知实际收到 | NOT VERIFIED | NOT VERIFIED |
| 点击通知回到正确 QA 页面/账号 | NOT VERIFIED | NOT VERIFIED |

iPhone 使用支持 Web Push 的系统版本，通过 Safari 添加到主屏幕后，从主屏幕打开并由点击动作授权。两端在“设置 → 云端推送”分别开启推送，点击“发送测试通知”，记录页面提示与系统通知是否出现。
“推送服务已接受”只说明服务端请求被接收；“本机通知自检”不经过远程服务；两者都不能单独作为远程送达通过证据。测试不需要角色、AI 或共享真实聊天上下文。

用户当前只有 Android，明确要求推送晚点再测；用户报告昨晚推送测试通过。该结果仅作历史用户报告，设备与当时部署未独立核对，本轮不重试推送、不标记双端通过。

## 同次后续修复：托管管理限制不再误判为登录失效

用户明确要求继续修复。`admin/admin-center.js` 统一处理初始化、操作、详情与审计请求的身份错误：仅在 `/api/accounts/me` 确认 active/super_admin 后，将 `DELEGATED_ACCOUNT_MANAGED_CENTRALLY` 显示为管理功能尚未接通，保留页面和会话；隐藏不可用目录、统计和操作，清除未完成的详情/邀请码展示，提供重新检查入口。401、真正的 403/ADMIN_ONLY、禁用账号及非管理员仍按原有保护跳转。重新检查成功后恢复管理界面。

HTML 的 JS/CSS 引用已更新版本参数，避免旧缓存继续执行原跳转逻辑。身份 gateway 的四条认证允许路由、后端托管限制、账号与密钥均未修改。

验证：`node --test tests/admin-center-ui.test.mjs` 20/20；新增 `npm run test:admin:browser` 9/9（375/430/900px 托管限制、重复检查、恢复、后续操作受限、未登录/禁用/普通账号/真实禁止/会话过期和临时故障）；完整 `npm run build` 通过，包含 release gate 和产物隔离检查。浏览器测试使用合成同源响应，没有真实账号、凭据或管理写入。

本修复只解除误跳登录循环；统一账号系统的管理功能仍未接通，不能宣称账号列表、邀请码和审计已经可用。Android/iPhone 推送按用户要求延后。

## 已授权推送及独立 QA 发布

用户在完成复核后明确授权推送并更新。修复源提交 `91b204d6f36267781b3655cf8a85b832a8845c57` 已推送至 `GOV-004/qa-account-push-acceptance-20261114`，PR https://github.com/Bella0960/MAOMAO/pull/291 以 #285 的候选分支为 base；未合并 main 或 #285。

- 发布前复核：9 个 Chromium 场景再次通过，20 项管理员 UI 测试与 1 项 QA 配置测试通过，工作树与差异检查正常。
- Cloudflare Build `302c1fa6-655f-48f7-8977-27fbe9033227` 最终 success，精确构建上述修复 SHA，沿用原完整构建流程；部署命令增加 SHA 一致性保护，并指定 `wrangler.qa.jsonc --keep-vars`。
- QA deployment `407c2aaa-6d91-48f8-8573-ddb9078694a1`，version `b81baac7-6bab-498c-b17d-f98bee83b51e`，100% QA 流量，2026-11-14 20:58 UTC。
- HTTPS 只读验收：线上 JS/CSS 与已测源码逐字节一致；bootstrap/status 仍为 signInReady=true、identityAuthorityConnected=true、bootstrapAllowed=false；push/config HTTP 200、公开公钥存在；未登录管理页仍 302 到登录页。
- QA 数据库 namespace 与原身份 gateway service binding 未变，既有账号及 VAPID secret 绑定仍在。自动部署命令已恢复 `echo MODULAR_BACKUP_QA_VERIFIED_DEPLOY_PAUSED`。
- 正式 `mao` 发布前后均为 deployment `f6598f9b-c371-4405-9184-624dcf79d979` / version `d6c0e2c7-c8f2-4533-89fd-d503633413db`，本次未变更。

仍待用户 Android 已登录页面复验；本轮没有读取用户真实会话，也没有宣称真机 001 管理功能或双端推送验收完成。

## 用户真机反馈：Android 远程测试通知通过

用户随后反馈“我刚刚试了测试，没问题”，并提供 Android 系统通知中心截图。截图显示 Chrome 来自独立 QA 域名 `maomao-aw-qa-20261114.miamor520000.workers.dev` 的“MAOMAO · 云端测试通知”，正文“这条通知由云端推送到当前浏览器”。这是设备系统实际显示远程测试通知的证据，Android 远程测试推送显示验收记为 PASS，不再仅标为配置就绪或推送服务接受。

截图没有证明点击通知回流、长期后台投递、iPhone 送达或账号列表/邀请码/审计可用；这些仍不标为通过。用户未单独展示管理员中心页面，本次通知截图不作为 001 全部管理功能的证明。截图含其他私人通知，不复制进公开仓库。
