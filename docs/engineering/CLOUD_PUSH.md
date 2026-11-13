# Cloud Autonomous Activity & Web Push

本文记录 MAOMAO 云端设备、真实 Web Push、自主活动调度、首次主动开场与服务端模型主动联系的演进。早期里程碑描述保留为历史背景；当前实现状态与验收边界以对应最新章节和 PR 状态为准。

## 1. 架构与持久化选型

- **入口**：`worker.js`，与现有站点同域共存。`/api/*` 进入 Worker；站点根路径显式映射到 `index.html`；其余路径交给 `env.ASSETS`，即现有 `dist` 静态站点。
- **持久化**：SQLite-backed Durable Object（`CloudDatabase`，单实例 `maomao-global`），而不是 D1。
  - 理由：当前仓库的部署路径是"零账号级资源"的静态 Worker 部署。D1 需要在账号里先 `wrangler d1 create` 并把 `database_id` 写回 `wrangler.jsonc`，否则 `wrangler deploy` 会失败，直接阻断现有站点发布。Durable Object 随部署自动创建，同样是 Cloudflare 原生、事务性、SQLite 语义的持久化能力。
  - 迁移 SQL 是标准 SQLite 方言（`worker/migrations/0001_init.js`），若以后切到 D1，可原样迁移。
- **定时**：`triggers.crons`（每日 03:17 UTC）清理过期/长期停用的推送订阅，并调用一次调度 tick。调度频率与生产配置值尚未拍板，因此没有擅自增加更高频 Cron。
- **密钥**：VAPID 私钥、设备密钥 pepper 与首台设备初始认领码只通过 Cloudflare secrets 注入，前端只能拿到公开的 VAPID public key。

## 2. 表结构（0001_init）

| 表 | 用途 |
| --- | --- |
| `devices` | 设备注册与授权；只存 `sha256(pepper\|deviceId\|secret)`，不存明文 |
| `push_subscriptions` | 每台设备可多订阅；`endpoint` 唯一；含过期时间、停用原因、失败计数 |
| `outbound_messages` | Milestone 2 的云端出站消息；`server_message_id` 唯一保证幂等 |
| `activity_queue` | Milestone 2 活动队列骨架（waiting/running/cooling/completed/failed） |
| `execution_log` | 每次云端动作的状态、原因码与耗时 |
| `push_deliveries` | 按 `dedupe_key + subscription_id` 唯一，防止重复通知 |

迁移由 `worker/lib/migrations.js` 版本化，Durable Object 首次启动时幂等执行（`schema_migrations` 表记录版本）。

## 3. 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 服务状态、VAPID 是否配置、设备/订阅计数 |
| GET | `/api/push/config` | 无 | 返回 VAPID public key（未配置时 503） |
| POST | `/api/devices/register` | 新设备需配对码；已知设备可凭原凭据重连 | 设备注册；同 ID 不同密钥返回 409 |
| POST | `/api/devices/pairing-token` | 设备 | 生成短时、单次使用的设备配对码 |
| POST | `/api/devices/revoke` | 设备 | 撤销设备、停用订阅并清除其 presence / lease / 未使用配对码 |
| POST | `/api/push/subscriptions` | 设备 | 订阅（同 endpoint 幂等更新） |
| GET | `/api/push/subscriptions` | 设备 | 订阅状态（不含密钥） |
| POST | `/api/push/unsubscribe` | 设备 | 退订单条（传 endpoint）或全部（不传） |
| POST | `/api/push/test` | 设备 | 发送测试推送，支持 `dedupeKey` 去重 |

推送订阅 endpoint 校验要求 HTTPS、公网格式 DNS 主机名、标准 HTTPS 端口；拒绝 IP 字面量、localhost / 常见本地域名后缀、URL 用户凭据及非标准端口。出站 Web Push 请求禁止自动跟随 HTTP 重定向，避免把推送投递转发到其他目标。该检查只验证 URL / 主机名格式，不执行 DNS 解析或提供任意域名的网络出口白名单；若未来要支持自定义 Push Service，还需单独设计 DNS/出口限制。

设备鉴权：请求头 `X-Device-Auth: <deviceId>.<secret>`。`deviceId` 与 `secret` 由前端 `crypto.getRandomValues` 生成，只存本机 `localStorage`，且被备份导出逻辑永久排除。

新设备注册不再开放自助加入：已授权设备先调用 `POST /api/devices/pairing-token` 生成一次性配对码；新设备把配对码提交给 `POST /api/devices/register`。配对码只存 peppered hash、过期后不可用、成功使用后不可重放，签发设备撤销时其未用配对码一并清除。已消费/过期记录会保留最近一小时用于签发频率统计，再由 maintenance 清理。首次安装可通过 Worker secret `ENROLLMENT_TOKEN` 认领首台设备；数据库会记录初始认领已完成，后续设备只能走配对流程。

## 4. 部署步骤

1. 生成 VAPID 密钥对（P-256）：

   ```bash
   node -e "const {createECDH}=require('crypto');const e=createECDH('prime256v1');e.generateKeys();console.log('VAPID_PUBLIC_KEY='+Buffer.from(e.getPublicKey()).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+Buffer.from(e.getPrivateKey()).toString('base64url'))"
   ```

2. 写入 Cloudflare secrets（只写名字，值不要进仓库/日志）：

   ```bash
   npx wrangler secret put VAPID_PUBLIC_KEY     # 公开公钥（客户端订阅需要）
   npx wrangler secret put VAPID_PRIVATE_KEY    # 私钥，仅服务端使用
   npx wrangler secret put VAPID_SUBJECT        # mailto: 或 https: 联系地址
   npx wrangler secret put DEVICE_SECRET_PEPPER # 至少 32 字符的随机设备凭据哈希 pepper
   npx wrangler secret put ENROLLMENT_TOKEN      # 首台设备一次性初始认领码，至少 32 字符
   ```

   `DEVICE_SECRET_PEPPER` 必须至少 32 字符；缺失或过短时，设备注册与鉴权都会 fail-closed。

   一次性设备配对码有效期由 `DEVICE_PAIRING_TOKEN_TTL_MS`（毫秒）控制；当前开发分支 `wrangler.jsonc` 已显式设置 `300000`（5 分钟）。缺失或非法时服务端仍会拒绝签发，防止无期限配对码。不要把 `ENROLLMENT_TOKEN` 写入仓库、前端或公开日志。

3. 部署：现有 `deploy-cloudflare-worker.yml` 在 `main` 推送时先 `npm run build` 再 `wrangler deploy`。`worker.js` 已设为 `main`，Durable Object 随部署自动创建。

4. 验证：`curl https://<域名>/api/health` 应返回 `vapidConfigured: true`；设置页打开"推送通知"开关后点击"发送测试推送"。

## 5. 本地验证

```bash
npm run test:cloud:push      # 12 个契约测试（真实 SQLite 迁移 + 真实加密）
npm run test:schedule        # 22 个时间/时区/状态/租约测试
npm run test:autonomy        # 19 个调度纯逻辑 + 真实 SQLite 骨架测试
npm run test:pwa:navigation  # 静态资源与离线导航回归
npm run test:chat:contract   # 聊天回归
```

`test:cloud:push` 覆盖：迁移与幂等、设备注册/冲突/撤销、鉴权拒绝、订阅生命周期、非法订阅、test-push 授权与去重、410 订阅停用与清理、VAPID JWT 验签、aes128gcm 加解密往返、出站消息幂等、SW push/notificationclick 行为与缓存处理器保留。

## 6. 边界与后续

- 真机 Web Push 需要 HTTPS 域名 + 真实设备授权通知；本阶段代码已具备完整链路，但真机结果必须由实际设备确认。
- Milestone 2 将复用：`activity_queue`、`execution_log`、`outbound_messages`、Cron 入口、设备鉴权与 `push_deliveries` 去重。
- Milestone 3 再补：完整排班/静默时段设置 UI、日记生成、忙碌自动回复与诊断面板。

## 7. M2.2 调度骨架（当前状态）

数据流：

```text
Cron / 内部 tick
  → 读取 activity_queue 中到期的 waiting/retry 活动
  → scheduler-policy 纯逻辑判定：到期、autonomy、角色状态、context_version、重试预算
  → CAS 认领（attempt_count 乐观锁）或作废 / 延后
  → execution_log 记录原因码
```

- 纯逻辑：`worker/lib/scheduler-policy.js`，不依赖 DO、DOM、网络或存储。
- tick 编排：`worker/lib/scheduler.js`，只认领/作废/延后并写日志；**不生成消息、不读正文、不调用模型、不推送**。
- 存储：复用 `activity_queue` 与 `execution_log`，`id` 同时作为幂等键；本轮**没有新增数据库迁移**。
- 生产默认：`gate` 未接入，tick 会把所有到期活动延后并记录 `autonomy_denied`，不会认领任何活动。
- 显式环境配置（缺失即 fail-closed，代码内无默认值）：`AUTONOMY_LEASE_MS`、`AUTONOMY_TICK_LIMIT`、`AUTONOMY_RETRY_BACKOFF_MS`（逗号分隔的毫秒数组）。
- 尚未拍板：生产 tick 频率、重试预算、真实消息落库与推送接入点。角色上下文版本已采用内容无关的事件 ID 计数，但仍需完整测试和运行验收。


## 8. M2.2b：持久化元数据 + scheduler gate（前端接入部分待做）

本阶段用户已明确授权同步**非聊天调度元数据**：全局/角色自主活动开关、角色 IANA 时区与作息、设备前台心跳、角色级前台租约。

### 8.1 数据库迁移

新增向前兼容的 `0002_autonomy_metadata`，未修改 `0001_init`：

| 表 | 用途 | 主键 / 约束 |
| --- | --- | --- |
| `user_autonomy` | 全局自主活动开关；无记录即关闭 | `user_id` |
| `character_autonomy` | 单角色开关；NULL / 无记录表示继承全局 | `(user_id, character_id)` |
| `character_schedules` | 显式 IANA 时区与 active/busy/asleep/away 时间窗口 | `(user_id, character_id)` |
| `device_presence` | 前台状态布尔值与最近一次心跳时间 | `(user_id, device_id)` |
| `character_leases` | 同一用户 + 角色的唯一前台执行租约 | `(user_id, character_id)` |

`devices.user_id` 通过新增列迁移，既有设备归属当前单用户 `owner`；旧设备、推送订阅、队列与消息记录不删除。设备撤销时清除其 presence 与所持角色租约。

### 8.2 受设备鉴权保护的 API

所有以下端点均要求现有 `X-Device-Auth`：

- `GET/PUT /api/autonomy/global`：读取 / 更新全局开关。
- `GET/PUT /api/autonomy/characters/:characterId`：角色开关；`null` 表示继承全局。
- `GET/PUT /api/characters/:characterId/schedule`：角色时区与显式作息窗口。接口只接受已明确提供的状态窗口，不补默认时段。
- `GET /api/presence/config`：返回显式配置的心跳 TTL、租约时长、grace；未配置时 503，不提供猜测默认值。
- `POST /api/presence/heartbeat`：只接受 `foregroundActive: boolean`，记录时间戳，不收集位置/GPS/聊天正文。后台标签页不会批量释放设备的角色租约。
- `POST /api/characters/:characterId/lease`：`acquire / renew / release`。仅当前租约设备可续期或释放；另一设备不能释放持有者租约；新设备只有在旧 lease 到期且 grace 结束后才能 CAS 接管。
- Lease API 所需的心跳 TTL、租约时长、grace 全部来自显式环境配置：`AUTONOMY_HEARTBEAT_TTL_MS`、`AUTONOMY_DEVICE_LEASE_MS`、`AUTONOMY_DEVICE_GRACE_MS`。缺失或无效时拒绝发放 lease。

`shared/js/cloud-push-client.js` 已暴露全局/角色开关、作息、前台心跳、角色租约方法，并提供按服务端 TTL 自动续期的 `startCharacterPresence(characterId)` 客户端管理器。设置页现已提供“云端自主活动授权”全局开关：读取/写入云端 `user_autonomy`，设备未通过鉴权前保持禁用；它只记录授权，不表示角色已经会主动联系。角色单独授权与角色作息的完整设置界面仍未完成。`chat/chat/chat-detail.html` 现已在单角色聊天页接入前台管理器；群聊暂不申请角色租约。该客户端需要显式配置的服务端 TTL/lease 参数，且仍须经项目测试与真实设备验证，不能据此报告生产环境已经同步。

### 8.3 真实 scheduler gate

Worker 的 `/internal/tick` 与 scheduled cron 现在会创建 `createSchedulerGate()` 并传给 `runTick`。Gate 从 `CloudStore.getSchedulerGateSnapshot()` 读取持久化非聊天元数据，复用 M2.1 `CharacterSchedulePolicy.evaluate()`，不复制时区/状态算法。

判定要求：
- 全局 autonomy 没有显式记录或为 OFF → defer。
- 单角色 OFF → defer；单角色 NULL / 缺失只能继承全局开关。
- 角色没有显式作息、active 窗口为空、时区无效、policy 配置缺失 → fail-closed。
- 任一授权设备的角色 lease 有效，或仍处于 grace → defer；撤销设备的 lease 不再有效。
- 设备离线不推导为 away/asleep/user-paused。
- Gate 错误通过明确 reason code 记录：`gate_data_source_missing`、`gate_data_missing`、`gate_provider_error`、`gate_policy_unavailable`、`gate_policy_invalid`、`autonomy_denied`、`foreground_lease_held`、`foreground_lease_grace`、`character_not_active`、`context_version_unavailable`、`stale_context`。

### 8.4 仍然 BLOCKED 的边界

1. **前端 heartbeat/lease 调用：CODE WIRED / RUNTIME NOT VERIFIED。** 单角色 chat-detail 已加载云端客户端并按当前 role ID 启动前台心跳/租约；群聊未接入。必须配置服务端 TTL/lease 参数，并通过构建、浏览器与真机测试确认。
2. **角色上下文版本：CODE IMPLEMENTED / RUNTIME NOT VERIFIED。** 新增服务端每角色单调版本计数器和设备鉴权事件 API；聊天页仅在本地聊天记录写入并读回校验成功后提交随机 `eventId`，Worker 不接收正文、摘要、persona、图片或附件。Scheduler gate 对每个角色读取服务端版本，并要求任务携带完全匹配的 `payload.contextVersion`；缺少版本或版本不一致仍 fail-closed。完整 Node/SQLite 测试、构建、部署和多设备运行验收尚未完成。
3. **设备安全配对：CODE IMPLEMENTED / DEPLOY CONFIG NOT VERIFIED。** 新增 `0003_device_pairing`：首台设备通过 Worker secret `ENROLLMENT_TOKEN` 完成一次初始认领；现有授权设备可以签发短时单次配对码；新设备设置页可输入配对码；已知设备保留原凭据重连路径，不会因服务端未知而自动清除本机凭据。生产环境仍需设置 `ENROLLMENT_TOKEN` 与 `DEVICE_PAIRING_TOKEN_TTL_MS`，并在真实 Cloudflare Worker 上验证迁移、首次认领、配对和撤销行为。
4. **云端模型凭据：NOT AUTHORIZED。** 不读取或上传浏览器 API Key，不配置/使用模型凭据。
5. **AI 生成 / outbound / 真正角色主动推送：NOT STARTED。** 本阶段没有创建真实出站消息、没有调用模型、没有发真实推送。
6. **GitHub Actions / Cloudflare / 真机：NOT VERIFIED。** 本地代码、合成 SQLite 测试、GitHub CI、Cloudflare 部署、真实设备锁屏通知是不同验收维度，不得互相替代。

本阶段没有上传真实聊天正文、persona、关系资料、摘要、图片或附件；没有调用模型；没有触发用户可见推送；没有部署 Worker、合并 PR 或更新 APK。PR 保持 Draft。


### 8.5 首次认领与设备配对（代码已加入当前 Draft 分支）

- 新增迁移 `0003_device_pairing`，为配对码保存 peppered hash、签发设备、创建时间、过期时间和消费时间；不保存配对码明文。
- `device_bootstrap` 记录首台设备认领状态。迁移会把升级前已存在的有效设备标记为已认领，避免升级后要求用户重新连接；首台初始认领完成后不再接受第二次 bootstrap。
- `POST /api/devices/pairing-token` 要求已授权设备，按 `DEVICE_PAIRING_TOKEN_TTL_MS` 设置有效期，并限制单设备每小时签发数量。
- `POST /api/devices/register` 对未知设备要求有效的配对码，或在首台认领尚未完成时使用 `ENROLLMENT_TOKEN`；成功消费配对码后不能重放。撤销签发设备会删除其尚未消费的配对码。
- 设置页增加“生成设备配对码”、复制配对码和输入配对码连接流程。首次安装输入初始认领码，后续设备输入已有设备签发的临时配对码。普通重连遇到凭据冲突或服务端记录丢失时不会静默清除原凭据；只有用户主动输入有效的一次性配对码时，才允许从已撤销/冲突的旧 ID 创建新设备身份。
- 配对设备与启用 Web Push 解耦：不支持 Web Push 的浏览器仍可完成设备配对并访问已授权的非聊天元数据；推送订阅失败时会明确显示“设备已配对，但推送订阅未完成”，不会误报为注册失败。
- 这部分代码仍未由当前会话执行 Node / SQLite 测试、Vite build、Cloudflare 部署或真机验收。PR 仍 Draft；不要将代码已写入误认为生产安全配置已完成。


### 8.6 设置页授权入口

- 设置页新增全局“云端自主活动授权”开关，使用已鉴权的 `getGlobalAutonomy / setGlobalAutonomy` 读写云端状态。
- 未连接或鉴权失败时开关禁用；刷新页面时重新读取云端值。
- 文案明确说明这只是用户授权记录；可信上下文与自主生成链路未完成前，不会触发主动联系。
- 角色单独开关与作息编辑 UI 已在 8.8 节加入；聊天页面前台 heartbeat/lease 已在 8.7 节接入，仍待部署后运行验证。


### 8.7 单角色聊天页前台接入

- `chat/chat/chat-detail.html` 加载 `shared/js/cloud-push-client.js`，在解析出当前单角色 ID 后调用 `startCharacterPresence(characterId)`。
- 只在本机已存在云设备凭据时启动；不读聊天正文、不写聊天历史、不上传角色设定或 API Key。
- 前台管理器根据服务端配置续期 device heartbeat 与角色 lease。隐藏标签页不会写入 `foregroundActive=false`，`pagehide` 和停止单页续期也不会释放设备级 presence 或角色 lease，避免一个标签页覆盖同一设备其他可见页面的状态。
- 所有可见页面停止续期后，设备在线状态由服务端 heartbeat TTL 判 stale；角色 lease 则按 lease 到期与 grace 规则自然释放。两者是不同层级，不能用单页隐藏事件推断整台设备离线。
- 客户端续期间隔取心跳 TTL 与角色 lease 时长的较短者的三分之一，至少 1ms；对浏览器有符号 32 位定时器上限进行截断，防止异常大配置被浏览器解释成近乎 1ms 的高频定时器。非安全整数或非正配置 fail-closed。
- 前台管理器先建立续期计时器，再执行首次心跳 / 角色租约同步；首次请求遇到临时网络或服务端错误只记录诊断，不会销毁管理器，后续定时续期或页面重新变为可见时会重试。云端心跳 TTL 和角色 lease 到期规则仍负责判定状态，客户端重试不绕过服务端授权。
- 每次设备心跳返回后、以及租约续期失败准备尝试 acquire 前，都会再次检查页面是否隐藏或管理器是否已停止；页面在请求飞行期间切走时，不会由这次迟到响应继续触发角色租约写入。
- 在途请求使用 AbortController；标签页隐藏或管理器停止时取消本页面正在等待的 fetch，避免请求长时间挂起使本地 running 锁无法释放。页面重新可见后会立即重新同步；AbortError 不作为普通续期故障反复告警。
- 初始化不会等待首次心跳网络请求完成才把管理器句柄交还聊天页，避免慢请求拖住页面生命周期管理。若浏览器没有 AbortController，隐藏事件仍会递增同步代次并释放本地 running 锁；旧请求迟到返回后会因代次不匹配而停止，不得续租/抢租约，也不得清除新一轮同步的 running 锁。
- 隐藏/停止操作会递增本地同步代次；每一轮网络响应只可继续处理与自己启动时相同的代次。即使底层浏览器不支持取消请求、旧 fetch 最终才返回，也不能继续执行角色租约动作或重置新一轮同步状态。
- 群聊 ID 暂时不映射单角色租约，防止错误阻止角色调度。
- 此接线只代表代码路径存在。由于当前 Cloudflare 环境参数、真实页面运行与真机行为尚未验证，不能把它当成已上线或已验证。


### 8.8 角色级授权与作息设置 UI

设置页云端区域现在有角色编辑区：

- 角色选项从本机 `PhoneStorage.getCharacters()` / `ai_custom_characters` 读取，角色名称仅用于本机下拉显示，不发送到 Worker。
- 角色授权支持“跟随全局 / 仅此角色开启 / 仅此角色关闭”。
- 作息要求明确填写 IANA 时区、允许主动联系的开始与结束时间；busy / asleep 可选，away 可显式标记。
- 角色授权与作息分开保存，未配置有效 active 窗口的角色仍会被 scheduler gate 拒绝。
- 目前 UI 提供每天每种状态一个时间窗口；跨午夜窗口由统一 policy 解析。更复杂的多窗口/按星期计划编辑器留待后续，不擅自补默认。
- 这组界面只同步角色 ID、授权布尔/继承状态、时区和时间窗口；不上传角色名称、persona、聊天内容、关系资料或附件。


### 8.9 云端准备情况诊断

- 新增设备鉴权端点 `GET /api/autonomy/readiness`，返回配置状态、当前设备的活动推送订阅数量、全局授权、上下文版本状态、执行器状态，以及当前用户队列的匿名状态汇总。
- 队列只暴露 `total / waiting / retry / running / completed / failed / superseded / other` 数量（未知或历史状态归入 `other`）；按已鉴权设备所属用户过滤。不会返回任务 ID、角色 ID、设备 ID、任务载荷或聊天内容。
- 新增最近 24 小时调度阻塞 / 作废原因计数：仅统计 `deferred / failed / superseded / skipped`，不把成功认领的 `claimed` 误报为阻塞；Scheduler 日志写入任务所属的 `device_id`，readiness 仅按已鉴权设备所属用户分组返回原因码与次数，不返回执行日志详情、任务 ID 或时间戳；旧的未关联设备日志不会跨账号展示。
- readiness 在心跳/租约参数齐全时，额外返回匿名 `presenceSummary`：授权设备总数、TTL 内有效前台心跳设备数、有效角色租约数、grace 缓冲期租约数。查询按用户隔离，并排除已撤销设备、过期或未来时间戳的心跳和非本账号租约；不返回设备 ID、角色 ID 或原始心跳时间。缺少前台参数时该汇总为 `null`，不会把未知状态伪装成离线。
- 前台心跳是设备级、角色租约是角色级：单个聊天标签页隐藏、pagehide 或停止本地续期时不再主动写入 `foregroundActive=false`，避免一个后台标签页覆盖同一手机另一个可见标签页的心跳。所有可见页面都停止续期后，readiness 与 scheduler policy 会依显式 TTL 自然将旧心跳视为过期；角色租约仍按 lease + grace 到期。
- 设备撤销在同一个同步 Store 操作内先停用其全部推送订阅，再标记设备撤销并清除 presence、租约和未使用配对码，避免撤销与停订阅分成两次调用造成的短暂推送窗口。
- 推送订阅写入会在 Store 写入边界重新检查设备是否仍有效；即使请求在鉴权后被并发撤销，也不能重新激活订阅。endpoint 已属于另一台仍有效设备时拒绝转移；只有原设备已撤销后，配对完成的新设备才可接管该 endpoint。
- 当前 `activityExecutorAvailable=false`，因此 `autonomousMessageGenerationReady=false` 始终保持 false。readiness 的 `contextVersionReady` / `contextVersionTrackedRoles` 是账号级汇总；具体任务仍由 scheduler gate 按对应角色版本逐一核对。没有任何角色版本时仍报告 `context_version_unavailable`。
- 不返回 VAPID 私钥、设备 pepper、初始认领码、配对码或任何 Secret。
- 设置页“检查云端准备情况”显示设备鉴权、首次认领、配对、VAPID 配置、推送订阅、presence 参数、全局授权、队列计数、最近 24 小时调度原因、执行器、上下文版本和 AI 生成链路状态。
- 诊断接口不会发通知、不会创建任务，也不会触发模型调用；只读取配置与匿名队列汇总。
- `testPushReady` 仅表示 VAPID 配置存在且当前设备至少有一个活动订阅；真实 APNs/浏览器推送可达性仍需用“发送测试推送”和真机锁屏验收确认。


### 8.11 角色上下文版本计数（只同步版本元数据）

本阶段按用户明确授权，只同步每个角色的上下文版本计数，不同步聊天内容。

- 新增迁移 `0004_character_context_version`：`character_context_versions` 保存 `user_id + character_id + version + updated_at`；`character_context_events` 保存设备鉴权的随机事件 ID，用于请求重试去重。版本表不含聊天正文、摘要、角色设定、关系记忆或媒体字段。
- 新增设备鉴权 API：`GET /api/characters/:characterId/context-version` 读取版本；`POST /api/characters/:characterId/context-version` 只允许一个字段 `eventId`。服务端拒绝额外字段，因此不能借该端点提交消息正文或其他内容。
- 每个新的事件 ID 由服务端为对应账号与角色原子递增版本；相同事件 ID 重试会返回当前版本，不会重复递增。不同账号、不同角色的版本互相隔离。
- 单角色聊天页只在现有本地聊天记录保存成功、且写后读回校验成功后，通知版本变化。客户端在本机计算历史指纹，仅用于判断历史是否变化；指纹不会上传。网络请求正文只有随机 `eventId`，不含消息、摘要、persona、图片、附件或指纹。
- 本地指纹会递归覆盖消息的嵌套对象与数组（例如投票、转账、表情反应、回复和附件元数据），并对对象键排序，避免字段顺序变化造成误更新。大体积内嵌 data URL 只在本机读取长度与分布式小片段作为变更提示，避免每次保存都完整扫描数 MB 的媒体字符串；这些采样值同样不会上传。
- 离线时客户端在本机保留待同步事件 ID，并将连续离线改动合并成一个待同步版本事件；下一次保存、重新进入前台或心跳周期会重试。事件请求失败不会影响本地聊天保存。
- 已打开的其他聊天标签页监听对应角色的 `storage` 事件；当另一个标签页写入新的待同步事件 ID 时，可立即协助提交。浏览器触发 `online` 网络恢复事件时也会尝试刷新待同步事件；页面停止前台管理器时会移除这两个监听。跨标签页重复提交仍由服务端 `eventId` 幂等去重。
- 群聊暂不映射到单角色上下文版本，避免将群会话 ID 误作角色 ID。
- 服务器端版本可供 scheduler gate 使用，但上下文任务必须在入队时携带当时读取到的角色版本，并在执行前与当前版本完全匹配；缺失或过期仍会 defer / supersede。
- 每台设备每小时最多提交 600 个新的上下文版本事件；已记录 eventId 的重试不消耗额度。事件 ID 去重记录保留 90 天，维护任务会清理更早的记录；版本计数本身长期保留。极旧的离线重试若发生在去重记录清理之后，可能多递增一次版本，只会让旧任务更保守地失效，不会恢复旧上下文。
- 这只建立了可核对的版本信号，不代表云端已获得聊天上下文或已经可以生成消息。AI 执行器仍未接入，模型凭据未读取，真实主动消息与推送仍未启动。

### 8.10 Activity queue lease recovery 与 worker fencing

- `listDueActivities` 通过队列表与设备表的 LEFT JOIN 给每个任务附上设备所属 `user_id`；scheduler gate 只读取该用户的授权、角色作息和设备租约。
- 缺少设备用户归属、持久化快照缺失或快照用户 ID 不匹配时，gate 会 fail-closed，不再把其他账户的任务默认按 `owner` 规则评估。
- 到期任务若来源设备已撤销，会以 `source_device_revoked` 原因码作废，不进入后续执行。

本轮修复了任务在 worker 中断后无法恢复，以及旧 worker 可能覆盖新 worker 结果的风险：

- `listDueActivities` 除 waiting/retry 外，也会返回 `locked_until <= now` 的过期 running 任务。
- `evaluateTask` 只允许 lock 已明确存在且已经过期的 running 任务进入重新评估；没有 lock 时间或 lock 尚有效的 running 任务不会被回收。
- `claimActivity` 通过 `attempt_count + expectedStatus + locked_until` 做 CAS 重新认领；重新认领会递增 attempt_count 并替换 owner/lease。
- `completeActivity` 和 `failActivity` 必须同时匹配 `locked_by + attempt_count`，并且提交时 lease 仍未过期。旧 worker 即使迟到返回，也不能完成或重试新 worker 当前持有的任务，也不能在 lease 到期后继续提交结果。
- stale-context 作废同样要求匹配读取时的 status 与 attempt_count，不能覆盖并发 worker 已经认领的任务。
- 已耗尽重试次数的任务会用 status/attempt/原 lease 信息 CAS 终止为 failed，不会无限留在候选队列。
- 没有 generation executor 时，过期 running lease 会按原 owner/attempt/lease 时间 CAS 释放回 retry，不增加 attempt_count；普通 waiting 任务仍保持 waiting。

**当前 production gate：** Worker 的 scheduled 与 `/internal/tick` 路径没有消息生成 executor，因此 `runTick` 默认 `executorAvailable=false`。即使资格 gate 通过，也会记录 `executor_unavailable` 并保持任务 waiting/retry，不会提前占用成 running。只有未来真实执行器接入并显式声明可执行后，才允许认领任务。

新增 scheduler 契约覆盖：过期 running 回收、并发 CAS、旧 worker completion/failure fencing、lease 过期后的迟到写入拒绝、stale supersede 竞争、重试耗尽终止，以及无 executor 时保持 waiting / 释放过期 lease 且不消耗 attempt。源码语法解析和独立 SQLite SQL 场景检查通过；完整 Node 测试/build 与 Cloudflare runtime 仍需实际执行。


### 8.12 Web Push 投递租约、幂等与失败恢复

新增迁移 `0005_push_delivery_retries`，把原本“只要有投递记录就永久跳过”的逻辑改成按 `dedupe_key + subscription_id` 管理的投递状态：

- 投递前先通过 SQLite 原子 UPSERT 取得该订阅的 `sending` 租约；相同事件并发到达时，只有一个请求能取得租约，其他请求返回 `in_progress`，不重复发送。
- 每次租约包含 owner 与截止时间（60 秒）。Web Push 网络请求使用 25 秒超时取消信号，正常网络发送应在租约内结束。Worker 中断后，租约过期的记录可以被另一个请求接管；旧 owner 迟到提交结果时会被 CAS 拒绝。
- 推送服务成功后记录 `sent`，同一事件之后只做幂等跳过；永久失效的订阅记录为 `gone` 并停用订阅。
- 网络异常、408、425、429、5xx 被视为临时故障，进入 `error` 并按 30 秒起步的指数退避重试，最多 5 次；410 / 404 不重试，其他永久 4xx 不自动重试。到达退避时间前会返回 `retry_deferred`，不会频繁敲推送服务。
- 达到最大次数的失败和过期的最终发送租约会进入终态 `failed`。每设备的测试推送速率限制通过单条 SQLite `INSERT ... SELECT ... RETURNING` 原子检查并预留名额；并发请求不能同时基于同一个旧计数通过。只统计 `started` 预留记录，发送完成后的 success/failed 结果日志不会被重复计数；连续失败同样消耗名额。
- 迁移会将旧版明确属于网络错误或 408 / 425 / 429 / 5xx 的失败记录恢复为可重试；已成功、gone 和其他永久失败记录继续保留去重语义。
- 外部推送服务可能已接收请求、但 Worker 在收到响应前断线；这种不确定结果只能按 at-least-once 恢复，极端情况下仍可能重复显示一条通知。不能把第三方 Web Push 宣称成严格 exactly-once。

这只是 Web Push 投递底座加固，不会生成消息、不读取聊天正文、不调用模型，也不表示角色已经开始主动发消息。测试、Worker 部署和锁屏真机投递仍需独立验收。

### 8.13 队列与出站消息存储完整性

- Activity queue 与 outbound message 的幂等写入改为单条 SQLite `INSERT ... ON CONFLICT ... DO NOTHING RETURNING`，不再依赖“先 SELECT、再 INSERT”的分离步骤；重复请求返回首次保存的记录，不覆盖首次数据。
- 出站消息以 `server_message_id` 为冲突目标。若不同 server ID 使用了已占用的 `dedupe_key`，唯一约束会明确拒绝写入，不会误把另一条消息当成成功去重。
- 队列 payload（4 KB）、出站消息 payload（8 KB）和执行日志 detail（4 KB）按 UTF-8 实际字节数检查。超限或无法 JSON 序列化时直接拒绝，不再用字符串截断制造损坏的 JSON。
- 这项改动只加固既有存储层，不会启用消息生成器，不会新增聊天正文上传 API，也不会触发主动消息或推送。

回归用例覆盖首次数据不被重复请求覆盖、活动任务重复 ID 幂等、dedupe key 冲突、以及 payload 超限拒绝。GitHub Actions 是否实际执行这些用例，仍以对应提交的 runner 步骤和日志为准。

## 9. M2.3a：设备定向出站收件箱与确认（基础链路）

新增 `0006_outbound_inbox_index`，为待同步出站消息建立 `(device_id, character_id, delivery_status, created_at, id)` 复合索引。

### 9.1 云端存储约束

- `CloudStore.enqueueOutboundMessage()` 是供未来云端执行器调用的内部存储入口，不开放给浏览器任意写入。
- 每条消息必须指定目标账号、目标设备、角色 ID、稳定 `serverMessageId` 和载荷；载荷序列化后最多 12 KB。
- 服务端消息 ID 与已有 `dedupe_key` 都参与幂等保护；同一标识重试且载荷完全一致时返回既有记录，任何字段或正文不同都返回冲突，不覆盖首次保存。
- 目标设备必须属于指定用户且未撤销；设备被撤销后不能继续拉取或确认。
- 当前表中 `device_id` 明确作为收件设备；拉取时同时匹配当前鉴权设备、账号和角色，不会把另一设备或另一角色的消息返回给客户端。

### 9.2 客户端拉取与确认 API

- `GET /api/characters/:characterId/outbound?limit=50`：只返回当前设备该角色尚未确认的消息，limit 为 1–50，按创建时间稳定排序。
- `POST /api/characters/:characterId/outbound/:serverMessageId/ack`：当前目标设备确认消息。首次确认写入 `delivered_at`；重复确认返回 `alreadyAcknowledged`，不会重复改变状态。
- 未授权请求返回 401；消息不属于当前设备或角色时返回 404，避免暴露其他设备的消息是否存在。
- `MaomaoCloud.receiveCharacterOutboundMessages()` 提供串行处理辅助方法。调用方必须用 `serverMessageId` 做本地幂等键，并在本地聊天记录成功持久化、读回验证后返回 `true`，客户端才会确认；保存失败或回调返回其他值时消息仍留在云端待重试。若本地保存成功但确认请求断网，下一次拉取会再次交付同一 ID，回调必须识别并复用已有消息，不能重复插入气泡。

### 9.3 当前完成边界

- **已实现：** 内部幂等入箱、目标设备隔离、待确认消息拉取、重复确认幂等、客户端持久化回调与确认辅助方法。
- **尚未实现：** AI 自主生成执行器、向收件箱写入真实角色消息、聊天页将拉取结果合并进现有历史，以及真实多设备/断网恢复验收。
- 本轮没有调用模型、没有读取或上传本地聊天正文 / 角色设定 / API Key，也没有发送真实主动消息或推送。
- 这些 API 代码存在不代表生产 Worker 已部署；Node/SQLite 契约测试与 Vite 构建仍需实际执行后才能标记通过。
## 10. M2.3b：接入现有单角色聊天页（前台收件）

当前单角色 `chat/chat/chat-detail.html` 已调用 `MaomaoCloud.receiveCharacterOutboundMessages()`，不创建新的聊天页或独立消息列表。

### 10.1 本地消息写入规则

- 第一阶段只接受 `{ type: 'text', text: '...' }` 纯文字载荷；未知消息类型、空正文、超长正文和无效服务端 ID 会保留在云端待确认，不会伪装成已接收。
- 新消息写入原角色 `chat_history_<roleId>`，沿用现有 `saveMessages()`、PhoneStorage / localStorage 和写后读回校验。
- 本地消息同时保存稳定 `serverMessageId` 与由其派生的 `mid`。写后读回身份校验也比较 `serverMessageId`；若存储层没有保留该字段，整个写入视为未验证，不会 ACK。
- 若本地历史已存在相同 `serverMessageId`，接收回调返回成功但不再插入第二条气泡，专门处理“本地已保存、ACK 响应丢失”的重试窗口。
- 保存成功后才渲染现有消息气泡，且仅在用户原本接近列表底部时自动跟随滚动。

### 10.2 前台与多标签页协调

- 仅单角色会话启用；群聊不申请该收件箱。
- 设备完成配对后，聊天页可见时立即拉取，随后每 15 秒拉取一次；切到后台或页面离开时暂停，重新回到前台时刷新本地历史并恢复拉取。
- 同一角色优先使用浏览器 Web Locks 保证同源标签页之间串行接收；不支持 Web Locks 时使用短期 localStorage 租约并复核 owner token。由于 localStorage 没有原子 compare-and-swap，降级租约只能尽量减少碰撞，不等价于 Web Locks 的强互斥；租约存储不可用时会 fail-closed，不启动降级接收。
- 接收成功只通过 localStorage storage 事件广播服务端消息 ID，不广播正文；其他标签页再读取同一份本地聊天历史刷新界面，并尽量保留用户当前滚动位置。
- 轮询仅在聊天页面前台运行。**这不是应用关闭或手机锁屏后的后台拉取**；后台真实 Web Push 仍需单独完成通知点击后唤起页面、收件箱同步和真机验收。

### 10.3 验收边界

- 新增源码契约测试覆盖：serverMessageId 写后读回、重复投递去重、先保存再渲染、隐藏页面不处理迟到响应、设备连接后启动、Web Locks / 租约降级、15 秒前台轮询、跨标签页刷新和 PWA cache v174。
- GitHub Actions 仍未提供可执行步骤的成功结果；官方 Node/SQLite 契约测试、Vite build、真实浏览器与 Android 多设备验收均为 **NOT VERIFIED**。
- 当前只有接收端准备好消费消息；云端 AI 执行器仍未实现，所以没有真实角色主动消息被生成或投递。本轮不上传本地聊天正文、角色设定或 API Key，也不调用模型。
## 11. M2.4a：本机模型执行器交接（不上传聊天上下文）

本阶段把现有前台 `ChatNotifier` 主动联系决策接到云端活动队列。云端不调用模型，也不接收本地聊天正文 / persona / API Key；已配对设备使用自己的 `PhoneStorage`、`PhoneAPI` 和本机 API 配置生成。

### 11.1 活动入队与跨设备去重

- 新增迁移 `0007_activity_dedupe`：为 `activity_queue` 增加唯一 `dedupe_key`，旧任务以 `legacy:<id>` 回填，向前兼容。
- 活动幂等键由 Worker 依据账号、角色、`contact` 类型和服务端上下文版本生成。同账号另一台设备在同一版本重复入队时只得到既有任务，不会创建第二条。
- 入队请求只接受 `{ contextVersion }`；Worker 校验账号/角色自主活动授权及服务端最新版本。多余正文、角色设定或其他字段直接拒绝。
- 每个角色最多保留 5 条 waiting/retry/running 活动，避免异常设备无限堆积。

### 11.2 前台设备认领

- `POST /api/autonomy/characters/:characterId/activities`：以当前已鉴权设备为起点，按账号/角色/上下文版本幂等入队。
- `POST /api/autonomy/characters/:characterId/activities/claim`：查询该账号该角色到期任务，复用现有 scheduler policy 与真实 scheduler gate；全局/角色授权、作息、静默/状态、前台 lease/grace、上下文版本任一不满足，都不发放任务。
- 任务认领使用 CAS；但带聊天上下文的 `contact` 任务只允许最近一次上下文版本的来源设备执行。其他配对设备不能借用该设备的本地聊天记录，也不能通过更换 `device_id` 绕过来源校验。成功认领时收件设备与 lease owner 绑定到当前执行设备；旧 attempt 无法提交结果。
- 活动租约、批量上限、重试退避必须由 Worker 显式配置 `AUTONOMY_LEASE_MS`、`AUTONOMY_TICK_LIMIT`、`AUTONOMY_RETRY_BACKOFF_MS`；缺失配置时 fail-closed。

### 11.3 本机模型调用与结果交付

- 当前前台 `ChatNotifier` 仍沿用本地 `ChatPresencePolicy` 选择主动联系候选，并只在用户开启该角色主动联系功能时运行。
- 当云端全局/角色授权开启且本机已配对，客户端先读取服务端上下文版本、入队并认领任务；随后在本机调用已有 `PhoneAPI.completeJSON()`，本地 prompt 可使用角色 persona 和最近聊天历史，但这些内容不会进入 Worker 请求。
- 模型明确返回不发送时使用 skip API 结束任务；生成失败走受限原因码和服务端重试退避；上下文在生成期间变化则跳过旧任务，不发送过时内容。
- `POST /api/autonomy/activities/:id/complete` 同步完成任务并把生成出的纯文字写入现有 `outbound_messages` 收件箱；server message ID 由 task ID + attempt 固定生成，重复提交幂等。
- 客户端把完成结果镜像写回本机现有 `chat_history_<roleId>`，保存失败时云端 outbox 仍 pending；聊天页原有 receiver 后续写后读回成功才 ACK。
- 完成正文限制 2–220 字普通文字；完成/失败/跳过只接受 allowlist 字段和原因码，不允许客户端指定设备归属、租约 owner、下次重试时间或模型凭据。

### 11.4 新增 API 与存储方法

| API | 作用 |
| --- | --- |
| `POST /api/autonomy/characters/:id/activities` | 以当前上下文版本幂等入队 |
| `POST /api/autonomy/characters/:id/activities/claim` | 在 gate 通过后认领任务 |
| `POST /api/autonomy/activities/:id/complete` | 写出站文字并完成任务 |
| `POST /api/autonomy/activities/:id/fail` | 按服务端退避配置释放为 retry / failed |
| `POST /api/autonomy/activities/:id/skip` | 对无值得发送的内容或已过期上下文终止任务 |

### 11.5 目前边界

- 这是一条**前台设备执行**路径，不是 Worker 在应用关闭或手机锁屏时自行调用模型。Web Push 只用于设备通知/收件，不会让浏览器在关闭后持续运行 AI 模型。
- 当前只接入已有的 `contact` 主动联系流程；群聊、复杂卡片、图片/语音生成、角色日记等任务类型暂不开放。
- `autonomousMessageGenerationReady` 仍保持 false，直到本地模型配置、真实浏览器执行、双设备抢占、断网重试、Worker 部署和 Android 真机推送都完成验收。
- 新增 Node/SQLite 契约测试覆盖迁移 0007–0009、跨设备去重、设备上下文来源、前台租约门禁、租约 fencing、生成结果暂存、收件箱失败后按设备修复、重复完成幂等、授权拒绝与旧上下文拒绝。完整项目测试与 build 尚需真实执行。
- 本阶段不上传本地聊天历史、角色设定、persona 或 API Key；仅把设备执行后实际生成的单条待送达文字写入云端收件箱。
## 12. M2.4b：本机归属门禁与生成结果恢复

这一轮针对真实执行链修复了三个关键边界：前台租约身份、聊天上下文来源设备，以及任务完成与 outbox 写入之间的中断恢复。

### 12.1 本机执行器必须拥有前台角色租约

- `createSchedulerGate()` 区分云端执行器和本机执行器。云端仍只能在没有有效前台角色租约且 grace 已结束时运行；本机执行器必须同时满足当前设备有有效前台心跳、当前角色租约确实由该设备持有、角色作息为 active、账号与角色授权有效。
- `ChatNotifier` 在云端总授权与角色授权通过后，先刷新并读取本机的最新上下文版本，确认来源设备就是当前设备，再发送本机前台心跳、申请角色租约并启动 `startCharacterPresence()` 续租循环；申请租约后再次刷新和读取版本，只有版本仍归当前设备且有效才允许入队。这样另一台拿着旧本地历史的设备不会先占住角色租约。
- 用户切到后台后不会启动新的模型调用；已在途的生成在最终提交前还会再次核对本地可见状态，Worker 完成接口也会再次检查服务端门禁。
- 若设备已保存 `cloud_device_v1` 配对凭据但云端客户端脚本加载失败，主动联系流程 fail-closed，不会悄悄绕回本地模式绕过云端总授权。未配对设备仍沿用原本的纯本地主动联系路径。

### 12.2 上下文版本绑定来源设备

- 新增迁移 `0008_context_source_device`，为 `character_context_versions` 增加 `updated_by_device_id`。服务端版本事件只接收随机 `eventId`，同时记录提交事件的已鉴权设备 ID，不接收任何聊天正文或内容指纹。
- `/api/characters/:id/context-version` 增加 `ownedByCurrentDevice`。主动生成只有在最新版本由当前执行设备报告时才继续；入队请求还要满足 `updated_by_device_id === 当前设备 ID`。活动 payload 同时固定记录 `sourceDeviceId`；认领时若服务端最新版本或来源设备已变化，旧活动会被 supersede，其他设备不能拿旧上下文接管。
- 活动 payload 只保存 `contextVersion` 与 `sourceDeviceId`。调度门禁发现版本已变化或来源设备已变更时会把旧任务标记 superseded；若任务仍有效但当前调用设备不是来源设备，则拒绝它认领。
- 这是一个有意的隐私边界：项目尚未在设备间同步聊天历史，所以不能让另一台设备拿着旧的本地聊天记录替当前角色生成主动消息。跨设备共享上下文需要先单独完成安全同步设计。

### 12.3 生成结果先暂存，再幂等修复收件箱

- 新增迁移 `0009_activity_result_staging`：活动队列增加 `result_json`、`result_server_message_id` 和 `result_dedupe_key`。
- 完成任务时，Worker 先用一条带 lease fencing 条件的 SQLite UPDATE，把任务标为 completed，并不可变地暂存确切结果与稳定服务端消息 ID；随后再写入现有出站收件箱。
- 如果 Worker 在暂存后、outbox 插入前中断，客户端可用同一活动 ID、attempt 和完全相同正文重试，Worker 会从暂存结果补建 outbox；不同正文会冲突，不能覆盖首次生成结果。
- `GET /api/characters/:id/outbound` 和本机活动认领接口都会先调用 `repairStagedActivityOutbox()`。即使原页面已经关闭，下一次打开聊天或重新检查任务时，也能仅凭队列中的不可变结果补建缺失收件箱记录；修复按账号、设备、角色隔离。 修复失败采用 best-effort：不会因此挡住其他已入箱消息的读取或其他符合条件的任务认领。
- 这种顺序让任务完成后的恢复有持久化依据，不需要重新调用模型，也不会因为 HTTP 响应丢失而生成第二条不同内容。

### 12.4 本轮新增验证覆盖

- 迁移检查覆盖 0001–0009、上下文来源设备列和活动结果暂存列。
- 门禁回归覆盖：来源设备正确 + 自己持有前台心跳/角色租约时允许；其他设备不能借用；没有角色租约时拒绝；来源版本变化时 supersede；云端执行器仍被有效前台租约阻止。
- 活动队列回归覆盖：outbox 首次写入失败后任务仍保留不可变结果；用同一结果重试可补建收件箱；不同正文不能替换。
- API 回归覆盖：未配对设备不能入队、当前来源设备可入队、设备心跳和角色租约是认领前提、上下文在生成期间变化会跳过旧消息。
- 聊天回归覆盖：本机执行器先申请角色租约、只用来源设备拥有的上下文、云端客户端缺失时已配对设备 fail-closed、PWA cache v175。

### 12.5 当前状态

- 这是代码层面的本机前台生成与云端交接链路；没有部署 Worker，没有在真实 Android 设备上调用 API 生成消息，也没有验证锁屏后台运行。
- GitHub Actions 当前仍无法给出实际执行步骤；Node/SQLite 契约测试、Vite build 和真机测试仍必须标为 **NOT VERIFIED**。
- `autonomousMessageGenerationReady` 继续保持 false，直到真实部署、配对设备、模型配置、授权/作息、角色租约、消息接收 ACK 和断网恢复全部通过验收。
## 13. M2.4d：已配对设备的授权降级封口

本轮代码检查发现并修复了一个关键降级漏洞：此前已配对设备读取到云端全局自主活动开关为 `false` 时，客户端会返回“未处理”，从而继续执行旧的纯本地主动联系分支。这会绕开用户在云端设置的总开关。

- 已配对设备只要云端客户端存在，就必须先通过云端全局授权；全局开关关闭或响应异常时，直接终止本轮，不得回退本地模型执行。
- 单角色授权只有 `enabled === true` 或明确继承全局的 `enabled === null` 才可继续；接口返回缺失、格式异常或读取失败均 fail-closed。
- 若云端客户端脚本加载失败，或设备凭据对象无法读取，只要 `cloud_device_v1` 仍有残留记录（包括无法解析的旧记录），就阻止本地主动联系降级。用户主动断开云端连接并清除该键后，未配对安装才恢复旧的本地模式。
- 新增 Chat Regression Contract 源码断言，覆盖：已配对设备全局开关关闭时必须返回终止信号、单角色授权未知时必须终止、残留设备记录不允许进入本地 fallback。
- ChatNotifier 资源版本更新至 `v20261107v3`，Service Worker cache 更新至 `phone-app-pwa-v177`。

### 本轮验证状态

- 新增断言已经提交，但 Node/SQLite 回归、`npm run build` 和真机行为尚未执行，均为 **NOT VERIFIED**。
- 这项修复只封住已配对设备绕过云端授权的本地降级路径；不会改变未配对安装原有的本地模式，也未改变任何角色聊天数据。
- 没有合并 PR、部署 Worker 或更新 APK。
## 14. M2.5：主动聊天消息的真实 Web Push 投递与维护恢复

本轮补齐了“主动消息写入云端收件箱后，如何真正通知目标设备”的缺口。此前接收端只有聊天页前台 15 秒轮询；`POST /api/push/test` 只是独立测试通知，并不会为主动聊天消息创建 Push 投递记录。

### 14.1 主动消息 → Push 投递

- 新增 `CloudStore.listOutboundPushCandidates({ now, limit })`：只查询 `delivery_status='pending'` 的出站消息、仍授权的目标设备及有效订阅，并排除已发送 / 已终止通知；只挑选首次投递、到期重试或过期发送租约。
- 新增 `buildOutboundPushPayload()`：通知标题为“新消息”，正文只提示“有一位角色刚刚联系你，打开聊天查看”，点击路径为 `chat/chat/chat-detail.html?id=<characterId>`。通知 payload 不带聊天正文、人设、记忆或 API Key。
- 新增 `dispatchPendingOutboundPushes()`：复用既有 `push_deliveries`，以 `outbound:<serverMessageId> + subscriptionId` 为去重范围，先 CAS 认领 60 秒租约，再走现有 VAPID/Web Push 发送、成功/失效状态记录与失败退避。
- 主动消息完成并持久化到 outbox 后立即尝试 Push。Push 服务不可用或发送失败不会回滚消息；收件箱仍保留，聊天页前台轮询可继续接收。
- 每个订阅独立维护投递状态，最多 5 次发送尝试；临时网络错误、408/425/429、5xx 走指数退避，订阅返回 gone 时停用该订阅。

### 14.2 定时重试与暂存结果恢复

- Cloudflare scheduled maintenance 会先运行 `repairAllStagedActivityOutboxes()`，再运行 Push dispatcher。即使 Worker 在“生成结果暂存后、outbox 插入前”中断，用户没有重新打开聊天页时，下一轮维护也会从不可变暂存结果恢复 outbox。
- 恢复只读取活动队列中已完成任务的暂存结果，并通过 join 限定仍授权的设备；已撤销设备的待恢复结果不会重新写入出站收件箱。
- 恢复与 Push 派发都有 best-effort 边界：单条损坏记录或单次发送异常不会删除原始暂存数据，也不会把已经入箱的消息标记为已读 / 已确认。
- Push accepted 不等于聊天记录已保存。出站消息仍必须由原聊天页写入本地历史、读回验证并 ACK；Push 只负责唤起 / 提醒，不替代消息收件箱。

### 14.3 新增回归测试（已写入，未执行）

- 主动任务完成后即时触发 Push，校验投递记录按订阅建立且状态为 sent。
- 锁屏通知只包含通用提醒与目标聊天 URL，不包含模型生成的私聊正文。
- 同一主动消息重复完成不重复发送 Push。
- 5xx 失败进入 30 秒首轮退避，到期后可使用同一个 dedupe key 重试并成功。
- Worker scheduled maintenance 的源码契约确认先做全局暂存 outbox 恢复，再运行 Push dispatcher。
- 全局暂存结果恢复测试确认仍授权设备可以恢复，已撤销设备的暂存内容不会重新进入 outbox。

### 14.4 验收边界

- 这是 Worker 代码层面的真实 Web Push 发送路径，不代表真实 Android 手机已经收到通知。仍需 Cloudflare Worker 部署、VAPID secrets、设备订阅、通知权限和锁屏真机验收。
- Push service 接受请求只代表服务端投递被接受，不保证操作系统最终展示通知；用户关闭通知权限、浏览器 / PWA 被系统限制或设备离线时，仍以 outbox + 前台聊天轮询及后续 Push 重试恢复。
- Node/SQLite 契约测试、`npm run build`、Wrangler dry-run、Cloudflare 部署和 Android 锁屏通知测试均为 **NOT VERIFIED**。本轮未合并 PR、未部署 Worker、未更新 APK。
## 15. M2.5a：Push 与暂存结果的维护顺序及重试细节

- 定时维护顺序固定为：`repairAllStagedActivityOutboxes()` → `dispatchPendingOutboundPushes()`。第一步只从仍授权设备的已完成活动恢复缺失的 outbox；第二步才为有效订阅创建/恢复 Push 投递。
- Push 投递沿用既有 `push_deliveries` 表，没有新建第二套队列或迁移。每条 `serverMessageId` 对每个订阅独立去重；不同设备、订阅之间互不覆盖。
- 每个发送尝试按实际开始时间创建租约，并以真实完成时间计算退避，避免批量中前一条通知耗时导致后一条通知拿到过期租约。
- 单条主动消息完成时立即尝试一次通知；如果没有订阅、VAPID 未配置或发送失败，outbox 不会被删除，定时维护继续扫描。前台聊天页面仍可通过既有收件箱轮询收到消息。
- 新增测试覆盖即时发送、重复完成不重复通知、锁屏正文隐私、5xx 退避后同一订阅重试，以及全局维护先恢复 outbox 再派发 Push。

当前这些测试只是写入仓库，尚未在可用 CI runner 上执行；GitHub Actions 仍不能作为通过证据。
## 16. M2.6：主动消息完整生命周期回执（Push / Received / Saved / Read）

此前 `outbound_messages.delivery_status='delivered'` 是在客户端本地聊天记录保存并读回验证后，由 `/ack` 写入；它不代表 Push 被接受，也不代表用户已经阅读。本轮保留旧字段与 ACK 语义，新增独立生命周期字段，避免把四件不同的事混成一个“已送达”。

### 16.1 数据模型与兼容迁移

- 新增迁移 `0010_outbound_lifecycle_receipts`，给 `outbound_messages` 增加 `push_accepted_at`、`device_received_at`、`local_saved_at`、`read_at` 和 `read_by_device_id`。
- `push_accepted_at`：至少一个有效 Push 订阅的 Web Push 服务返回成功后记录；它只代表 Push 服务接受了该通知，不代表手机系统已显示。
- `device_received_at`：已鉴权目标设备拉取到消息 envelope 后记录；这与 Push 通道分开，前台聊天轮询也能产生收到回执。
- `local_saved_at`：沿用原 `/ack` 的写后读回确认；只有原聊天历史持久化回调返回 true 后才设置。`delivered_at` 保留兼容并继续写入同一时间。
- `read_at` / `read_by_device_id`：用户实际看到消息气泡后记录，由目标设备的聊天页面发起。服务端拒绝未完成本地保存的已读请求。
- 历史 `delivery_status='delivered'` 的旧记录会把既有 `delivered_at` 回填到 `device_received_at` 和 `local_saved_at`；不会猜测旧消息是否被用户看过，因此 `read_at` 保持 null。历史成功 Push 投递可按 `push_deliveries.status='sent'` 回填 `push_accepted_at`。

### 16.2 新 API

| API | 作用 |
| --- | --- |
| `POST /api/characters/:id/outbound/:messageId/received` | 目标设备确认已拉取消息 envelope；幂等，不代表已经保存 |
| `GET /api/characters/:id/outbound/:messageId/status` | 目标设备读取该消息四个生命周期时间点；其他设备与角色不可查询 |
| `POST /api/characters/:id/outbound/:messageId/ack` | 原有接口不变；写后读回成功后确认本地保存，同时兼容补记 received |
| `POST /api/characters/:id/outbound/:messageId/read` | 本地保存后才可确认用户已读；只允许原目标设备、原角色回执 |

出站 GET 仍返回原 payload，并附带 `lifecycle`：`pushAcceptedAt`、`deviceReceivedAt`、`localSavedAt`、`readAt`。所有时间均是服务端时间戳；没有相应事件时为 null。 消息保存后不再出现在 pending 列表，但目标设备仍可通过 status GET 查询完整生命周期及 `readByDeviceId`；客户端 `MaomaoCloud.getCharacterOutboundLifecycle()` 暴露该只读查询。 该查询包括 `deliveryStatus` 和四个服务端时间戳，且只接受原目标设备的鉴权凭据。

### 16.3 用户已读的判定方式

- 原聊天页在真实消息行上挂载 `data-server-message-id`，用 `IntersectionObserver` 观察 `#chat-messages` 滚动视口。
- 只有当目标气泡实际进入可视区域（至少约 18% 可见）并持续约 700ms，且页面仍在前台时，才调用 `markCharacterOutboundRead()`。
- 页面隐藏、气泡离开视口、观察器不可用或服务端回执失败时，不伪造已读状态；失败会在消息行再次进入视口时重试。
- 全量聊天历史与虚拟列表仍复用原消息行，不建立第二个阅读列表；只有带稳定 `serverMessageId` 的云端主动消息会请求云端已读回执。

### 16.4 回归覆盖（已写入，未执行）

- 迁移检查覆盖 `0010_outbound_lifecycle_receipts` 的五个字段及索引。
- 生命周期 API 检查 Push 接受时间、设备收到、本地保存和用户已读分别为空/填充的正确顺序。
- 未保存消息不能被标记已读；错误设备或错误角色不能伪造收到、保存或已读回执。
- 重复 received/read 回执必须幂等；时间戳恰好相同的快速重复请求不会误判首次/重复状态。
- 客户端接收顺序固定为 received → persist → check true → local-saved ACK；聊天页面只有实际可视消息气泡才能上报 read。
- Service Worker shell cache 更新至 `phone-app-pwa-v179`，聊天页云端回执客户端资源版本为 `20261107v1`。

### 16.5 语义边界

- **Push accepted ≠ 设备收到**：Push 服务接受请求，不保证操作系统最终展示。
- **设备收到 ≠ 本地保存**：只有原聊天历史写后读回成功才算 saved。
- **本地保存 ≠ 用户已读**：用户未实际看到气泡时 `read_at` 仍为空。
- 目前每条主动消息明确投递到创建该出站消息时指定的目标设备；不会把某台设备的本地聊天历史或已读行为冒充为另一台设备的状态。
- Node/SQLite 契约测试、`npm run build`、浏览器真实滚动可视性、Android 多设备和锁屏 Push 仍需实际运行验收；当前均为 **NOT VERIFIED**。本轮没有合并、部署或更新 APK。

## 17. M2.7：主动联系支持动态多气泡

- 主动联系 Prompt 改为返回 `bubbles` 数组：默认可以只有一条；只有存在自然分开的表达节点、且符合该角色聊天习惯时，才返回多条。数量不固定，最多 4 条是防止异常响应的技术上限，不是每轮配额。
- 新增纯逻辑 `normalizeProactiveBubbles()`：统一校验数组与旧版 `text` 响应，拒绝空元素、超长内容、隐藏指令标记、URL 和异常控制字符；最终总长仍限制在 220 字。
- 云端配对执行和旧版本地执行共用同一清洗器。通过校验的气泡按空行顺序写入原有 `text` 字段；聊天页既有 `parseReplyContent()` 会把它们显示为多个独立气泡。
- 不新增数据库字段或第二种消息类型。整组气泡仍共用一个 `serverMessageId`，所以现有暂存结果幂等、设备接收、本地保存 ACK 和用户已读回执语义保持不变。
- 旧版 `{ send, text }` 响应继续兼容；旧单条消息不会被迁移或重写。
- PWA shell cache 更新至 `phone-app-pwa-v180`，ChatNotifier 更新至 `20261107v4`，角色聊天行为策略更新至 `20261102v18`。

### 验证边界

- 新增契约覆盖：单条与多条可变气泡、旧版 text 兼容、空元素拒绝、数量上限、URL / 机器指令拒绝，以及 Prompt 输出形状。
- 本轮没有可用的项目 Node runner；Node / SQLite 测试、Vite build、浏览器实际渲染与手机验收仍为 **NOT RUN / NOT VERIFIED**。GitHub Actions 不能作为通过证据。
- 未更改 Worker API、数据库迁移、聊天历史结构或模型凭据；未上传角色人设与聊天历史到 Worker；未合并、部署或更新 APK。

## 18. M2.8：主动联系更贴近角色语言与关系状态

- 主动联系开始前，使用当前角色自己的本地聊天历史重新计算语言习惯画像（最多回看 80 条角色文字回复）；画像包含常见句长、问句/表情使用、拆气泡倾向和语气词频率。源签名未变化时复用缓存，历史变化时自动刷新。
- 画像仍写入现有按角色 ID 隔离的 `chat_voice_habits_v1_<roleId>_direct` 本地键；不读取其他角色聊天，也不把画像、聊天正文或 persona 上传给 Worker。
- 主动联系 Prompt 增加明确的关系阶段提示，关系只影响熟悉程度，不允许模型擅自升级关系、制造占有或情绪依赖。
- 同时接入现有短期情绪连续性判定器：只识别聊天中明确表达的情绪线索，并提醒模型先检查后续对话是否已解决；没有可靠线索时不推断。现有生活连续性提取继续只从当前角色的本地历史提供近期安排/兴趣。
- 增加契约覆盖：角色画像样本数量、关系阶段提示、短期情绪连续性提示、角色自身生活线索以及 notifier 在每轮主动联系前刷新画像。
- 角色聊天行为策略更新至 `20261102v19`，ChatNotifier 更新至 `20261107v6`，PWA shell cache 更新至 `phone-app-pwa-v182`。

### 验证边界

- 本轮修改尚未在项目 Node runner、Vite build、浏览器或 Android 真机运行；均为 **NOT RUN / NOT VERIFIED**。
- 不新增数据库迁移、不改变消息投递 API，不改变任何角色既有聊天记录；不合并、不部署、不更新 APK。

## 19. M2.9：主动消息多气泡串行呈现与滚动保护

- 云端出站消息仍先写入原角色聊天历史并完成写后读回校验，再进入界面呈现；视觉停顿不会取代或提前本地持久化。
- 云端主动消息接收复用现有 `appendAiMessageWithPacing()`，多气泡按角色输出顺序逐条显示；接收函数等待当前呈现任务结束后再处理下一条 outbox 消息，避免连续拉取时不同消息的气泡动画互相取消或交错。
- 普通 AI 回复与云端主动消息共用一个串行呈现队列。全量重绘通过 generation 版本取消当前与排队中的旧节点，避免刷新后旧动画重新插入。
- 主动消息到达前用户若正在查看历史位置，呈现过程不会强制滚动到底部；只有接收前本来就在底部附近，才随新气泡保持跟随。
- 同一条多气泡主动消息只在最后一条气泡进入聊天视口并稳定停留后才写入已读回执，避免第一条刚显示就把整组消息标为已读。
- 动态逐泡呈现时，消息节点从临时 DocumentFragment 插入真实 DOM 后会重新注册 IntersectionObserver；否则初次组装时节点尚未连接，观察器无法生效。
- 支持系统减少动态效果偏好；单气泡消息不等待，只有同一组里确有第二条独立气泡时才加入停顿。
- PWA shell cache 更新至 `phone-app-pwa-v207`。
- Web Push 通知跳转现在同时校验 origin 与 Service Worker scope 路径；同源但处于其他应用目录的地址、带凭据的 URL 均回退到当前 MAOMAO scope 首页。

### 验证边界

- 新增源码契约覆盖：先保存后呈现、串行队列、全量重绘取消和不抢滚动位置。
- 本轮未运行 Node / SQLite、Vite build、浏览器滚动与动画实测或 Android 真机；仍为 **NOT RUN / NOT VERIFIED**。没有部署 Worker、没有合并 PR、没有更新 APK。

## 20. M2.10：断网恢复与单条消息失败隔离

- 出站收件箱客户端对每条 envelope 独立执行 received → 本地持久化 → ACK；一条消息的本地写入异常或 ACK 网络异常，不再中断同一批后续消息。
- 新增 `persisted`、`ackDeferred`、`persistErrors` 结果计数，区分“本地已经保存”和“云端 ACK 尚未确认”，避免把两种状态混为一谈。
- ACK 暂时失败时不删除、不重写本地消息，也不把消息错误标记为未保存；云端 outbox 继续保留原消息。下一轮拉取通过原 `serverMessageId` 命中本地历史，跳过重复插入，只补发 ACK。
- 单条本地写入抛错或返回 false 时不 ACK，对应云端消息保留 pending；同批其他消息继续处理，避免队首坏消息阻塞整个收件箱。
- 浏览器明确报告 `navigator.onLine === false` 时暂停定时拉取；浏览器 `online` 事件触发立即补拉，切回前台与 BFCache 恢复仍走既有立即同步入口。成功拉取后重置一次性网络警告状态。
- 云端状态语义不变：设备收到不等于本地保存，本地保存不等于 ACK；只有持久化回调成功后才会发送 ACK。
- Chat push client 资源更新至 `20261107v2`，PWA shell cache 更新至 `phone-app-pwa-v183`。

### 验证边界

- 新增契约覆盖单条持久化错误隔离、ACK 网络错误隔离、结果计数、浏览器离线暂停与 online 即时补拉。
- Node/SQLite 回归、Vite 构建、浏览器离线/在线切换与 Android 真机均未在本轮运行，仍为 **NOT RUN / NOT VERIFIED**。没有合并 PR、没有部署 Worker、没有更新 APK。

## 21. M2.11：同账号多设备接管与独立回执

### 归属与接管模型

- `outbound_messages.device_id` 继续保留原始创建设备归属，用于来源追踪；不再把它当成唯一收件设备。
- 新增 `outbound_device_receipts`，以 `(server_message_id, device_id)` 为主键，分别记录每台设备的 `device_received_at`、`local_saved_at` 与 `read_at`。
- 收件箱按消息来源设备所属的 `user_id` 与当前请求设备的有效账号身份匹配。同账号内其他已配对、未撤销设备可以领取；不同账号、错误角色和已撤销请求设备仍被拒绝。
- 每台设备只在自己的本地保存回执成功后，才会从自己的待收列表移除该消息。同账号另一台设备保存成功，不会阻止本设备补领自己的副本。
- 当前仅同步云端 outbox 中已经生成的角色主动消息副本，不代表完整聊天记录同步；用户自己发送的消息、历史对话、角色设定与记忆仍留在本地，本轮没有增加整段聊天历史上传。
- 账号级旧生命周期字段保留为聚合视图：首次任一设备保存 / 已读时使用 `COALESCE` 固定时间与设备，不被迟到的旧设备回执覆盖；`deviceLifecycle` 返回当前设备自己的状态。
- 迁移 0011 会把现有消息的生命周期证据回填到原始来源设备收据。其他配对设备从独立未保存状态开始接管，不会伪造其历史接收记录。

### 回归覆盖

- 同账号设备 B 可以读取设备 A 创建的待确认消息，B 保存后 A 仍能读取并保存自己的副本。
- B 首先保存 / 已读后，A 迟到的 received / ACK 不得覆盖账号级首次保存与首次已读时间。
- 设备级 status 只显示当前设备自己的回执，同时返回账号级聚合生命周期。
- 同账号可接管不等于跨账号开放；不同账号、错误角色仍无法读取、确认或查询消息。
- 迁移测试覆盖历史来源设备回执的准确回填。
- Migration 0011 adds an index on (character_id, device_id, created_at, id) to keep account-scoped inbox scans efficient while retaining source-device attribution.
- Web Push dispatcher 按来源设备所属账号枚举所有有效设备的订阅；每个订阅继续使用独立 dedupe / delivery lease。来源设备被撤销后，其订阅会停用，但同账号其他有效设备仍会成为待投递消息的推送目标。
- 推送目标回归覆盖同账号多设备、跨账号排除、单设备撤销排除，以及来源设备撤销后由剩余设备继续接收。
- Push eligibility is calculated per target-device receipt, not from the legacy account-level `delivery_status`: after device B saves the account message, device A can still receive its own notification until A saves locally. This prevents the first device ACK from suppressing reminders to other devices.
- Additional recovery coverage verifies that an active same-account device can retrieve and ACK a message even after the source device has been revoked; the revoked source credential is rejected.

### 验证边界

- 本轮提交了迁移、Store/API 行为和 Node/SQLite 契约用例；**本轮尚未执行 Node/SQLite 测试、Vite 构建或真机双设备验收**。
- PR 保持 Draft；未合并、未部署 Worker、未更新 APK。真实多设备切换效果仍需在云端部署和两台设备上验收。


## Outbound inbox cursor recovery

- The authenticated inbox endpoint supports keyset pagination using the stable `(created_at, outbound_messages.id)` ordering key.
- The client stores a cursor separately for each character and paired device, scanning up to 30 envelopes per polling round.
- A local persistence failure or deferred ACK does not remove the envelope and does not stop the client from scanning later pages.
- After the scan reaches the end, the cursor resets. Unacknowledged envelopes are revisited on the next cycle and are still deduplicated by `serverMessageId` before local insertion.
- This is bounded recovery, not a promise that an unavailable local store can be repaired automatically; the server continues retaining unacknowledged messages.

- If cursor writes fail because browser storage is unavailable or full, the live page continues with a dirty in-memory cursor. That in-memory position takes precedence over an older persisted cursor. It is intentionally page-lifetime recovery; a full reload cannot preserve a cursor that the browser refused to store, so unacknowledged rows remain server-pending and are safely retried.

- Before a cloud outbox envelope is allowed to return persistence success (and therefore before the receiver sends its cloud ACK), the chat page performs a second history read after visual pacing. If a sibling tab overwrote the message during that interval, the receiver merges the envelope back into the latest history and verifies it again. This narrows the stale-tab overwrite window; it is not a cross-tab transactional lock and does not claim to eliminate all concurrent-write races.

- The normal AI send path now reloads the latest role history after the awaited model request returns, before persisting the generated reply or an error bubble. It merges back only the current turn's user message if that message was displaced, preserving newer cloud proactive messages and sibling-tab writes without resurrecting unrelated stale history rows.

- After normal AI bubble pacing (an awaited UI operation), the send path refreshes the role history again and restores the current AI reply by stable `mid` if a concurrent cloud/tab write displaced it. Follow-up call, red-packet/transfer, role-family-card and virtual-image insertion paths receive this refreshed history, preventing their later saves from reintroducing the pre-animation snapshot. If the recovery write cannot be verified, the follow-up card pipeline stops rather than claiming the history is current.


## 22. 聊天卡片写入失败保护（M2.12 follow-up）

- AI 来电卡、虚拟图片卡、红包 / 转账卡现在都先完成聊天历史写入与现有写后读回校验，成功后才更新聊天 UI。失败时移除本轮刚加入的卡片并提示用户；来电卡保存失败时不会继续自动跳转到来电页。
- 多张虚拟图片卡合并为一次批量保存，避免逐张写入出现“前几张显示成功、后几张失败”的半批状态。
- 红包 / 转账保存失败时，除移除新卡外，还恢复原用户转账记录被临时改动的状态字段，避免留下未落库的“退还中”状态。
- 亲属卡继续使用独立的 RoleFamilyCards 存储。若独立亲属卡已创建、但聊天历史中的邀请卡写入失败，撤回聊天数组中的未确认邀请卡并明确提示；独立卡可能已经存在于亲属卡模块，因此这不是跨两个存储库的原子事务。
- PWA shell cache 更新至 phone-app-pwa-v186。

### 验证边界

- 已新增失败回滚契约测试：来电卡、图片批量卡、红包 / 转账状态恢复、亲属卡独立存储与聊天记录分离。
- 新增测试尚未执行；Node / SQLite、Vite build、真实浏览器存储空间不足场景与 Android 真机行为仍为 NOT RUN / NOT VERIFIED。
- 当前没有合并 PR、没有部署 Worker、没有更新 APK。


## 23. 收款流水恢复与亲属卡状态写后读回（M2.12 follow-up）

- 红包 / 转账领取现在把钱包流水中的稳定 paymentId 作为幂等依据。钱包余额与流水先写入后会重新读取确认；聊天卡片状态及原转账的「已退回」状态只有在聊天历史写入并读回成功后才确认。
- 若钱包已记账但聊天历史保存失败，页面不会显示正常收款成功状态。再次点击时会识别同一个 paymentId，只补齐红包 / 转账卡片状态，不会再次增加余额；退回场景也会补齐原转账状态。
- 账本 finance_records 以 paymentId 去重，并在上述恢复路径中补写，避免聊天历史写入中断导致钱包余额已有流水、财务明细却缺失。
- RoleFamilyCards.writeAll() 现在要求 localStorage 写入后精确读回同一序列化内容，才返回成功。领取、婉拒、暂停、恢复、调整额度、消费和创建邀请均复用该确认边界；静默丢写不会再被报告为成功。
- 所有使用 role_family_cards.js 的聊天、钱包、商店、外卖和亲属卡页面统一更新脚本资源版本 20261107v1；PWA shell cache 更新到 phone-app-pwa-v187。

### 回归覆盖与验证边界

- 新增支付恢复用例：钱包流水先成功、聊天状态保存失败、第二次点击恢复状态，余额和流水仍只增加一次；同时恢复原转账退回状态和 finance_records 明细。
- 新增亲属卡用例：模拟 localStorage 静默丢弃写入，确认状态更新返回 storage 失败且读取到的旧状态保持不变。
- 以上测试已写入仓库但尚未执行；Node 测试、Vite build、浏览器本地存储故障注入和 Android 真机仍为 NOT RUN / NOT VERIFIED。
- 未合并 PR、未部署 Worker、未更新 APK。


## 24. 多标签页收款互斥与刷新后状态复核（M2.12 follow-up）

- 聊天页红包 / 转账领取现在先取得同源 Web Locks 全局钱包互斥锁 `maomao-wallet-ledger-v1`，再重新读取角色聊天历史与钱包账本。不同 paymentId 的并发入账也会串行化，避免两个页面基于同一个旧余额互相覆盖。
- 同一页面使用 paymentId 防连点集合，并通过 `aria-busy` 标记正在处理的卡片；锁内再次确认卡片状态。另一标签页若已完成领取，等待中的操作重新读取后只显示已完成状态，不再重复加余额。
- 若浏览器提供 Web Locks，跨标签页操作由浏览器锁协调；若不提供，则保留本页防连点，并提示用户不要在多个聊天页同时领取。**旧浏览器 fallback 不保证跨标签页互斥**，不会把它宣称为完整并发保护。
- 已完成的聊天卡若对应钱包流水缺失，会 fail-closed：不会仅凭卡片状态再增加一次余额。钱包已记账而聊天记录尚未同步时，仍按 paymentId 幂等补齐卡片和账本明细。
- PWA shell cache 更新到 phone-app-pwa-v189。

### 回归覆盖与验证边界

- 新增多标签页并发契约：两个页面同时领取不同卡片时两笔都计入；第三个页面重复领取第一张卡时不重复入账；钱包和财务记录均按 paymentId 唯一。
- 新增旧浏览器 fallback 契约：本页仍可执行，但明确告知跨页面限制；同一页面的重复点击会在读取钱包前被拦截。
- 测试源码已写入，但尚未在 Node runner / 浏览器执行；Web Locks 真机 / 多页面验证、Vite build 和 Android 行为仍为 NOT RUN / NOT VERIFIED。
- 本锁覆盖聊天页红包 / 转账收款入口，不代表项目内其他独立钱包写入入口已统一迁移到同一锁。
- 未合并 PR、未部署 Worker、未更新 APK。


## 25. 全应用钱包写入协调与主动红包 / 转账恢复（M2.12 follow-up）

- 新增 `shared/js/phone/wallet-ledger.js`，统一使用同源 Web Locks 名称 `maomao-wallet-ledger-v1`。在支持 Web Locks 的浏览器里，钱包相关操作使用同一把 exclusive lock；锁不可用时只提供同一页面内的 Promise 队列，并明确提示跨页面并发不受保护，不将降级行为冒充为跨标签安全。
- 以下入口已接入同一协调器：聊天页接收红包 / 转账、聊天输入栏主动发送红包 / 转账、商店结算、外卖结算、钱包充值 / 提现，以及亲密付对象 / 开关 / 月额度设置。
- 商店和外卖在锁内重新读取亲密付配置及钱包余额，重新校验月额度、余额和扣款写后读回；额度记录写入失败时会尝试按快照回滚本次钱包扣款。余额不足、额度过期或扣款无法确认时，不会继续生成成功订单。
- 钱包充值 / 提现同样在锁内重新读取余额，完成写入并精确读回后才刷新成功状态；避免与聊天收款、亲密付结算同时写入时用旧余额覆盖。
- 亲密付设置页的对象、开关和额度更新也进入同一锁，并在锁内读取最新配置后修改，写入后精确读回确认。
- 用户主动发送红包 / 转账：先写入带稳定 `paymentId` 的钱包支出流水，流水中保存待写入聊天卡片；钱包写后读回确认后才写聊天历史。若聊天卡片保存失败，再次提交会恢复同一张卡、不重复扣款；聊天卡写入并读回确认后才关闭抽屉、刷新消息并触发角色互动提示。写回 `chatMessageSavedAt` 后，后续用户主动删除卡片不会被误认成未完成操作重新插回。
- Service Worker shell cache 更新至 `phone-app-pwa-v192`，并纳入钱包协调器与更新后的 chat-extras 脚本。

### 回归覆盖与验证边界

- 新增共享锁串行测试：聊天、商店和钱包的并发任务使用同一锁名且互不重叠；另覆盖不支持 Web Locks 时的页面内队列和一次性降级提示。
- 新增商店 / 外卖 / 钱包 / 亲密付页面契约：确认所有入口载入共享脚本、使用同一锁、锁内重新校验余额 / 额度并做写后读回。
- 新增主动发红包 / 转账部分失败恢复测试：首次扣款成功但聊天历史保存失败，第二次提交只恢复原卡，不重复扣款，并记录聊天卡片已保存标记。
- 测试已写入但尚未执行；Node 回归、Vite build、浏览器多标签页、Android 真机和真实本地存储故障注入均为 **NOT RUN / NOT VERIFIED**。
- 覆盖范围是目前列出的 MAOMAO 钱包 / 亲密付入口；不声称每一个可能新增的业务页面都自动纳入锁。没有合并 PR、没有部署 Worker、没有更新 APK。

## 26. M2.13：云端模型自主生成与多气泡组交付（独立测试分支）

> 状态：代码已接入 `feat/cloud-autonomous-server-model`，尚未部署、未完成模型供应商连通性和手机真机验收。此节覆盖的是测试分支实现，不代表生产 Worker `mao` 已启用。

### 26.1 执行链路

- 聊天记录在本机完成写入与读回校验后，客户端才尝试同步上下文。客户端先向 Worker 读取账号级共享授权；授权状态读取失败或未开启时，只提交不含聊天正文的上下文版本事件。
- 上下文共享是独立开关，默认关闭。开启后，每个账号、每个角色只保留最新版本快照；字段仅包含角色称呼、允许的角色设定文字、最近最多 12 条纯文字消息及最后一条用户消息时间。
- 服务端限制角色设定最多 5,000 字符、单条近期消息最多 600 字符、最近消息最多 12 条、快照总上下文最多 11,000 字符。HTML、控制字符、URL、邮箱及疑似电话号码会在 API 入库前清理。图片、贴纸、语音、音频、视频、文件、红包/转账和系统消息不会作为模型上下文发送。
- 聊天记录本机保存并读回后，客户端在上下文共享已开启时上传限量快照；服务端据最后一条用户消息与 `AUTONOMY_MIN_IDLE_MS` 提前创建云端任务。Worker 每 5 分钟检查到期任务，故生成不依赖用户在空闲期重新打开 MAOMAO。角色作息、全局/角色授权、前台设备租约（有设备正在处理时云端让出）、上下文版本、来源设备有效性及账号共享开关都必须通过门禁。
- 模型生成期间若上下文版本变化、关闭共享或撤销来源设备，旧生成结果会被丢弃。模型返回后会重新读取真实系统时间并复核执行租约；租约已过期时，即使模型结果有效也不会提交。最终写入还在数据库更新条件中再次校验当前版本、共享开关和来源设备，避免旧结果竞态落库。
- 模型可返回不发送，或 1–4 条独立文字气泡。每条消息拥有独立 `serverMessageId`，并记录相同 `group_id`、顺序和组内总数。出站组结果先不可变暂存，再逐条建立 outbox；中断后由收件箱恢复逻辑补齐。
- 一组多气泡只发送一条 Web Push 通知。通知使用角色名称和消息条数，不包含私聊正文。另一设备必须先把整组气泡一次性写入本机聊天历史并读回验证，再逐条提交本地保存 ACK；任何一条 ACK 失败都会保留整组可恢复状态。
- 历史单条消息继续使用旧的通知去重键；新增组消息使用组级去重，不改变旧数据语义。
- 云端执行器在数据库查询阶段就筛选 `executionMode=cloud` 的到期任务，再应用批次上限，避免较早的前台任务长期占满查询批次、饿死云端任务。每轮 tick 会写入不含聊天内容的运行摘要；调度原因统计同时包含前台与云端 tick，并按账号隔离。
- 准备检查把“云端主动生成”和“当前设备 Push 投递”拆成两组 blocker：前者核对活动执行参数、服务端模型凭据、总授权、上下文共享/版本、最近 Cron 和真实模型出站入库；后者单独核对 VAPID、当前设备有效订阅和当前设备最近 30 天 Web Push 服务端成功接受回执。两组都满足才显示主动联系与推送闭环就绪。
- Push 回执按账号和设备隔离，并且必须关联到当前仍启用、未过期的具体订阅；HTTP 成功仅表示 Push 服务接受请求，不代表系统已经展示通知。Android 锁屏横幅仍需真机验收。
- 推送发送租约在每次网络请求前认领、在网络返回后按实时系统时间结算；过期租约不能确认 Push 成功。固定 60 秒投递租约必须比 `PUSH_SEND_TIMEOUT_MS` 至少多 1,000 毫秒，否则派发器 fail closed。若租约已被接管，旧发送者只写入不含正文的 `delivery_lease_lost` 诊断，不会更新投递成功状态。
- 准备检查额外返回当前设备最近 24 小时 Push 重试/失败原因，并按账号与设备隔离；诊断仅返回原因码和次数，不返回消息 ID、聊天正文或订阅密钥。

### 26.2 隐私与凭据配置

- **后端为可选二选一，默认不会自动调用 Workers AI**：`AUTONOMY_MODEL_BACKEND` 未设置或设为 `openai_compatible` 时保持原有 HTTP 模型接口逻辑；只有维护者显式设为 `workers_ai`、部署环境存在 `AI` binding，且账号/角色云端授权、上下文共享和调度门禁均通过时，才允许使用 Cloudflare Workers AI。绑定写入分支 `wrangler.jsonc` 只表示预留入口，不会触发推理。模型锁定为 `@cf/zai-org/glm-4.7-flash`，不接受客户端自定义模型或密钥；此路径不需要额外模型 API Key，但**仍需另外配置 Web Push 的 VAPID、设备凭据与 Durable Object、Cron**。
- **费用边界**：Workers AI 使用 Cloudflare 账号配额；截至 2026-11-12，官方价格说明含每天 10,000 Neurons 免费用量，Workers Paid 超出后按量计费。部署人员必须先明确选择并核查费用与配额，不能默认启用、不能把“无需 API Key”等同“无限免费”。资料：<https://developers.cloudflare.com/workers-ai/platform/pricing/>、<https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/>。
- **选择旧的 HTTP 后端时**，`AUTONOMY_MODEL_API_KEY` 必须配置为 Cloudflare Worker Secret；不得写入仓库、`wrangler.jsonc` 普通变量、前端代码、设备 localStorage 或聊天消息，也不得让用户在聊天中发送密钥。
- `AUTONOMY_MODEL_API_URL`、`AUTONOMY_MODEL_NAME` 由部署维护者在 Worker 环境变量中配置。模型接口采用 OpenAI-compatible Chat Completions 格式；URL 必须为 HTTPS，且主机必须精确命中 `AUTONOMY_MODEL_ALLOWED_HOSTS` 白名单。默认白名单为 `api.openai.com`。
- 可选变量 `AUTONOMY_MODEL_ALLOWED_HOSTS` 用逗号分隔精确主机名；`AUTONOMY_MODEL_TIMEOUT_MS` 默认为 20,000，允许范围 3,000–60,000 毫秒。执行租约 `AUTONOMY_LEASE_MS` 必须比模型超时至少多 1,000 毫秒；不满足时 Worker 会跳过执行并记录原因，不会让过期模型结果落库。
- 非密钥调度默认值位于测试分支 `wrangler.jsonc`：租约 60 秒、每次 tick 最多 10 个任务、失败退避 60 秒/5 分钟/15 分钟/30 分钟、心跳 TTL 90 秒、设备租约 120 秒、设备 grace 0、用户消息空闲门槛 30 分钟。它们是待验收的配置，不是容量承诺。
- 关闭上下文共享会删除云端角色上下文快照，并取消尚未开始的主动联系任务；不会删除本机聊天记录。已提交的 outbox 消息仍按原投递生命周期处理，不会因关闭共享而改写已发送内容。
- 服务端模型提示词与结果不会写入 Worker 执行日志。模型输出会被结构化验证，并过滤 URL、邮箱、恋爱/性内容、自伤内容及索取密码、验证码或私人联系方式等明显越界内容；这类过滤不能代替真实运行中的安全验收。

### 26.3 验证与发布边界

- 新增 `tests/cloud-autonomous-model.test.mjs`，覆盖服务端凭据、HTTPS/主机白名单、限量上下文、1–4 条输出、无发送结果、无凭据 fail-closed，以及模型响应超过租约后禁止提交。
- 扩展 `tests/cloud-push-contract.test.mjs`，覆盖迁移 0017、共享默认关闭、上下文脱敏/删除、多气泡分组恢复、部分 ACK 后整组重拉、单组单通知及组级 Push 回执，并增加云端任务先过滤再限批、模型与 Push 投递租约过期保护、运行/生成状态 fail-closed、Push 服务端接受回执按当前账号与设备隔离且忽略已停用/过期订阅的断言。
- 上述测试已写入仓库，但当前工作环境没有运行 MAOMAO 的 Node/SQLite 测试与 Vite 构建；结果仍为 **NOT RUN**。真实模型供应商调用、Cloudflare 定时任务、系统通知横幅、Android 退出应用后的端到端表现仍为 **NOT VERIFIED**。
- 可靠性修复原由 PR #252 提交，已于 2026-11-13 合并到其上游 PR #239 开发分支；PR #148/#239 仍为 Draft，尚未进入 `main`。没有因此更新生产 Worker `mao`、部署模型或生成 APK。
- 当前正式 Worker 的云端数据绑定、Cron 与推送凭据仍未配置到位。旧 HTTP 模型后端需要服务端 Secret 与模型参数；可选 Workers AI 后端不需要额外模型密钥，但必须经维护者明确开启并完成费用审查。两条路线均须部署、完成用户授权及真机验收后才能宣称可用。

## 27. 空聊天云端首次主动开场（2026-11-11 follow-up）

- 已在独立分支加入显式的 `initialContact` 上下文标记。首次开场快照必须使用数值 `lastUserMessageAt: 0` 且 `recentMessages: []`；服务端拒绝字符串零、非空聊天记录和已有用户消息的快照，绝不把当前时间伪造成用户消息时间。
- 聊天详情页只会在单聊确实为空、或仅有本机默认欢迎占位语时尝试创建首次上下文；默认欢迎语不会上传。账号级上下文共享未开启时，客户端不会发送角色设定或消息正文。
- 云端首次任务必须同时通过账号总开关、角色开关、可执行调度配置、活动设备来源和上下文共享授权；任务使用稳定的账号/角色级幂等键，只排队一次，延迟两分钟交由 Worker cron 执行。
- Worker 会再次验证快照时间为 0、近期消息为空，再调用模型。模型提示要求只做简短、友善、非恋爱开场，不得编造以往聊天、见面、计划或共同经历。模型输出仍遵守原有 1–4 条气泡结构和服务端内容校验。
- 首次任务执行前若收到真实用户消息，新的上下文版本会使旧任务失效；Worker 在生成前、生成后和最终 outbox 写入时均复核版本/来源/共享授权，防止过期首条消息落库。
- 首次任务复用已有上下文版本，不因重复打开同一聊天重复创建快照或任务；来源设备撤销、共享关闭、角色/全局授权关闭或任务门禁失败时按 fail-closed 处理。

### 回归覆盖与验证边界

- 已加入模型提示测试、API 一次性任务/重复打开/非法快照测试、真实用户消息取消旧首条任务测试，以及 Worker 模型生成后写入两条同组 outbox 消息的集成契约。
- 测试源码已提交；当前环境没有成功执行 MAOMAO Node/SQLite 测试套件。GitHub Actions 对应运行返回失败，但 job step、日志附件均不可读取，不能将其归因于本次改动，也不能声称测试通过。
- 分支 `wrangler.jsonc` **计划**每 5 分钟 Cron 触发一次；截至 2026-11-13 的 Cloudflare 正式 `mao` Worker 配置仍没有 Cron，不能写成“正在运行”。两分钟是任务最早执行时间，不代表两分钟准时送达。DO 迁移、模型后端实际启用、Web Push 订阅、锁屏/退出应用和另一设备收件仍须部署后验收。
- 这项功能目前只在 `feat/cloud-autonomous-server-model`（PR #239，基于 PR #148）中；尚未合并 `main`、未部署生产 Worker、未配置生产 Secret、未验证真机推送。


## 2026-11-13 预览部署完整性哨兵

- 当前 `mao-auth-preview` 的 Web Push 底座已有账号绑定设备、VAPID 密钥与 Durable Object。能发系统通知的必要条件是用户设备自己授予浏览器通知权限并建立 `push_subscriptions` 记录；2026-11-13 23:12（北京时间）核查时订阅数仍为 **0**。无法通过创建虚假的 endpoint 或服务端模拟代替真机订阅。
- 发生过分裂部署：Worker 新上传版本包含 `AI`，却丢掉 `ASSETS` 和 `CLOUD_DB`；另一上传版本有 `ASSETS`、`CLOUD_DB` 和模型源码，却没有 `AI`。二者不可拆分为两个流量版本；缺 `CLOUD_DB` 会破坏账号/消息，缺 `ASSETS` 会影响网页资源，缺 `AI` 则模型启动会 fail-closed。
- 已将预览流量回退到最后同时保有 `ASSETS`、`CLOUD_DB`、VAPID 和完整设备配对配置的可用版本。这个回退**只针对预览 Worker**；正式 `mao` 未更改。该回退版本是 Web Push 测试底座，不能宣称云端模型生成已上线。
- 后续部署必须通过 `wrangler.jsonc` **一次性**提供静态资源、数据库、AI、Cron、服务端秘钥名称与现有账号范围；保留旧数据和设备凭据。上传后逐版本读取 Cloudflare `resources.bindings`，仅当 `ASSETS` + `CLOUD_DB` + `AI` + `VAPID_PRIVATE_KEY` 同时存在且现有账号/推送 API 冒烟测试成功，才能切换流量。禁止仅根据 `GET /settings` 的全局绑定列表推断某个版本实际拥有的资源。
- 云端模型实际启用必须由维护者确认费用/配额并显式选择 `AUTONOMY_MODEL_BACKEND=workers_ai`；没有启用时不产生模型推理调用。用户账号与角色授权、上下文共享、作息和设备隔离仍然是必要门禁。


## 2026-11-13 登录预览环境与统一账号阻断

- **已复现真实阻断**：\`mao-auth-preview\` 的 \`CLOUD_DB\` 保存了另一组测试身份。创作者当前使用的永久 MAO ID 不在这组数据库中，因此页面反馈的泛化错误「账号或密码不正确」不能被当作用户忘记密码。不要指示重置、重新注册、重建超级管理员或复制账号密码哈希。
- **唯一有效身份来源（本次核验）**：Cloudflare 已存在 \`qa/phone-founder-001-keyreset-20261111\` Preview，其 \`CLOUD_DB\` 持有当前唯一原管理员身份，账号状态 \`active\`，角色 \`super_admin\`。保留原永久 ID、账号库、会话权限、安全 Pepper 和所有既有审计日志；不要把另一个预览库的超级管理员覆盖过来。
- **已经证实的域名/数据源边界**：Cloud Push Worker 与上述创作者 QA Preview 使用不同 Durable Object namespace 和不同 cookie origin。登录成功的 HttpOnly cookie 不能跨两个 Worker 域名直接复用；不能把「在 A 站点登录了」当作 B 站点订阅推送已授权。
- **安全整合方向**：需在云端推送目标站点接通同一份权威账号库或经过验证的服务端身份委派。仓库已有 \`worker/lib/identity-bridge.js\`（位于 QA 账号分支），支持可选受约束的 Worker Service Binding 委派；集成时必须保留账号状态、权限、回收、登录限流与会话隔离的整套逻辑。不得通过额外注册、复制密码哈希或浏览器明文转发 session 捷径。
- **真实推送验收顺序**：同一域名登录到权威账户 → 浏览器在用户点击时授权系统通知 → 同一 Service Worker scope 创建/上传 push subscription → 服务端按当前账号、设备和角色授权投递测试通知 → Android/iOS 前后台及锁屏真实确认 → 最后验收 AI 自动生成。0 条订阅时绝不能声称“已推送成功”。
- **部署保护**：只操作隔离 Preview，任何 Cloudflare 候选版本需同时保留 \`ASSETS\`、权威 \`CLOUD_DB\`、\`VAPID_PRIVATE_KEY\`，启用模型时还需 \`AI\`。在这些条件和 Node/浏览器测试满足前，不修改生产站点或把 Draft PR 合入 main。
