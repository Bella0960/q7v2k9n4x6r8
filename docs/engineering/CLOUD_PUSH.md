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

设备鉴权：请求头 `X-Device-Auth: <deviceId>.<secret>`。`deviceId` 与 `secret` 由前端 `crypto.getRandomValues` 生成，只存本机 `localStorage`，且被备份导出逻辑永久排除。

新设备注册不再开放自助加入：已授权设备先调用 `POST /api/devices/pairing-token` 生成一次性配对码；新设备把配对码提交给 `POST /api/devices/register`。配对码只存 peppered hash、过期后不可用、成功使用后不可重放，签发设备撤销时其未用配对码一并清除。首次安装可通过 Worker secret `ENROLLMENT_TOKEN` 认领首台设备；数据库会记录初始认领已完成，后续设备只能走配对流程。

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
- 尚未拍板：生产 tick 频率、重试预算、上下文版本来源、真实消息落库与推送接入点。


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

`shared/js/cloud-push-client.js` 已暴露全局/角色开关、作息、前台心跳、角色租约方法，并提供按服务端 TTL 自动续期的 `startCharacterPresence(characterId)` 客户端管理器。设置页现已提供“云端自主活动授权”全局开关：读取/写入云端 `user_autonomy`，设备未通过鉴权前保持禁用；它只记录授权，不表示角色已经会主动联系。角色单独授权与角色作息的完整设置界面仍未完成。当前 `chat-detail.html` 尚未调用前台管理器，因此不能报告 PWA 已自动同步角色前台状态。

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

1. **前端 heartbeat/lease 调用：PARTIAL。** API 已有，chat-detail 尚未接入；在接通之前，PWA 不会自动申请角色前台租约。
2. **真实上下文版本：BLOCKED。** 当前没有可信 server-side chat event/version source。Store 明确返回 `contextVersion: null`；所有 `contact / follow_up / busy_reply / diary` 上下文任务均返回 `context_version_unavailable` 并 defer。没有伪造版本、没有把时间戳当版本、没有上传聊天正文。
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
- 设置页增加“生成设备配对码”、复制配对码和输入配对码连接流程。设备注册遇到凭据冲突或服务端记录丢失时，不再自动生成新 ID 并清除原凭据。
- 这部分代码仍未由当前会话执行 Node / SQLite 测试、Vite build、Cloudflare 部署或真机验收。PR 仍 Draft；不要将代码已写入误认为生产安全配置已完成。


### 8.6 设置页授权入口

- 设置页新增全局“云端自主活动授权”开关，使用已鉴权的 `getGlobalAutonomy / setGlobalAutonomy` 读写云端状态。
- 未连接或鉴权失败时开关禁用；刷新页面时重新读取云端值。
- 文案明确说明这只是用户授权记录，在角色作息、聊天前台接入和自主生成链路完成前，不会触发主动联系。
- 角色单独开关与作息编辑 UI、聊天页面自动 heartbeat/lease 仍待完成。
