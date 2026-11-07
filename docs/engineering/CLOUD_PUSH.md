# Cloud Autonomous Activity & Web Push

Milestone 1：云端基础与真实 Web Push。后续里程碑（排班状态机、活动队列执行、AI 决策、日记）只在本文件末尾预留，不在本阶段实现。

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

   另外必须显式配置正整数 Worker 变量 `DEVICE_PAIRING_TOKEN_TTL_MS`（一次性配对码有效期，毫秒）；缺失时服务端不会签发配对码。不要把 `ENROLLMENT_TOKEN` 写入仓库、前端或公开日志。

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