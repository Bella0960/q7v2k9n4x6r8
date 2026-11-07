# Cloud Autonomous Activity & Web Push

Milestone 1：云端基础与真实 Web Push。后续里程碑（排班状态机、活动队列执行、AI 决策、日记）只在本文件末尾预留，不在本阶段实现。

## 1. 架构与持久化选型

- **入口**：`worker.js`，与现有站点同域共存。`/api/*` 进入 Worker；站点根路径显式映射到 `index.html`；其余路径交给 `env.ASSETS`，即现有 `dist` 静态站点。
- **持久化**：SQLite-backed Durable Object（`CloudDatabase`，单实例 `maomao-global`），而不是 D1。
  - 理由：当前仓库的部署路径是"零账号级资源"的静态 Worker 部署。D1 需要在账号里先 `wrangler d1 create` 并把 `database_id` 写回 `wrangler.jsonc`，否则 `wrangler deploy` 会失败，直接阻断现有站点发布。Durable Object 随部署自动创建，同样是 Cloudflare 原生、事务性、SQLite 语义的持久化能力。
  - 迁移 SQL 是标准 SQLite 方言（`worker/migrations/0001_init.js`），若以后切到 D1，可原样迁移。
- **定时**：`triggers.crons`（每日 03:17 UTC）清理过期/长期停用的推送订阅，并调用一次调度 tick。调度频率与生产配置值尚未拍板，因此没有擅自增加更高频 Cron。
- **密钥**：VAPID 私钥、设备密钥 pepper 只通过 Cloudflare secrets 注入，前端只能拿到公开的 VAPID public key。

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
| POST | `/api/devices/register` | 无 | 设备自注册；同 ID 不同密钥返回 409 |
| POST | `/api/devices/revoke` | 设备 | 撤销设备并停用其全部订阅 |
| POST | `/api/push/subscriptions` | 设备 | 订阅（同 endpoint 幂等更新） |
| GET | `/api/push/subscriptions` | 设备 | 订阅状态（不含密钥） |
| POST | `/api/push/unsubscribe` | 设备 | 退订单条（传 endpoint）或全部（不传） |
| POST | `/api/push/test` | 设备 | 发送测试推送，支持 `dedupeKey` 去重 |

设备鉴权：请求头 `X-Device-Auth: <deviceId>.<secret>`。`deviceId` 与 `secret` 由前端 `crypto.getRandomValues` 生成，只存本机 `localStorage`，且被备份导出逻辑永久排除。

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
   npx wrangler secret put DEVICE_SECRET_PEPPER # 设备凭据哈希 pepper
   ```

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


## 8. M2.2b scheduler gate adapter（部分完成 / fail-closed）

已新增 `worker/lib/scheduler-gate.js`，并接入 Worker 的 `/internal/tick` 路径。每个到期任务在 CAS claim 前，都会通过该 adapter 调用现有 M2.1 `CharacterSchedulePolicy.evaluate()`，复核全局/角色授权、IANA 时区、角色作息、设备前台 lease 与 grace。

**当前生产状态仍为 fail-closed，不能宣称云端自主活动已启用：**

- M1 当前数据库尚无已批准的全局/角色 autonomy、角色 schedule、前台 heartbeat/lease 的持久化数据源。
- 当前 `CloudStore` 未实现 `getSchedulerGateSnapshot()`，所以真实 Worker 会记录 `gate_data_source_missing` 并 defer，不会认领活动。
- 上下文任务（contact / follow_up / busy_reply / diary）必须同时具有任务侧与权威快照侧的整数 `contextVersion`；缺失时记录 `context_version_unavailable`，不允许猜测版本或用时间戳代替。
- 角色作息、时区、设备 lease/grace 的策略参数只读取显式配置：`AUTONOMY_HEARTBEAT_TTL_MS`、`AUTONOMY_DEVICE_LEASE_MS`、`AUTONOMY_DEVICE_GRACE_MS`。缺失不会填入产品默认值。
- gate 支持的原因码包括：`gate_data_source_missing`、`gate_data_missing`、`gate_provider_error`、`gate_policy_unavailable`、`gate_policy_invalid`、`autonomy_denied`、`foreground_lease_held`、`foreground_lease_grace`、`character_not_active`、`context_version_unavailable`、`stale_context`。

本阶段新增的 gate 集成测试只使用合成授权、合成角色日程、合成 lease 和合成 context version；测试中的放行只证明调度器接线和策略判断，不代表生产已有这些数据源。没有上传聊天正文、persona、关系资料或附件；没有调用模型、创建真实出站消息或触发真实推送。

### M2.2b 元数据持久化与受鉴权 API（已实现；前端接入仍待做）

用户已明确允许同步以下**非聊天元数据**：全局/角色自主活动开关、角色 IANA 时区与作息、设备前台心跳、角色级前台租约。

新增向前兼容迁移 `0002_autonomy_metadata`，不修改 `0001_init`：

| 表 | 用途 | 主键 / 约束 |
| --- | --- | --- |
| `user_autonomy` | 全局自主活动开关；没有记录即关闭 | `user_id` |
| `character_autonomy` | 单角色开关；NULL / 缺失表示继承全局 | `(user_id, character_id)` |
| `character_schedules` | 显式 IANA 时区与 active/busy/asleep/away 时间窗口 | `(user_id, character_id)` |
| `device_presence` | 设备前台状态与最近一次心跳时间 | `(user_id, device_id)` |
| `character_leases` | 同一用户 + 角色的唯一前台执行租约 | `(user_id, character_id)` |

旧设备在迁移时归属现有单用户 `owner`，不删除设备、订阅或消息记录。设备撤销时会删除该设备的 presence 与角色租约，防止撤销设备继续占锁。

受现有 `X-Device-Auth` 保护的 API：

- `GET/PUT /api/autonomy/global`：全局开关。
- `GET/PUT /api/autonomy/characters/:characterId`：角色开关；`null` 表示继承全局。
- `GET/PUT /api/characters/:characterId/schedule`：IANA 时区与显式作息窗口。
- `POST /api/presence/heartbeat`：仅记录前台状态布尔值与时间；不采集 GPS、位置或聊天内容。
- `POST /api/characters/:characterId/lease`：按 `acquire / renew / release` 申请、续期或释放角色租约。只有租约 owner device 可续期/释放；新设备必须等待旧租约到期并经过 grace 才能接管。
- 心跳 TTL、lease 时长和 grace 通过 `AUTONOMY_HEARTBEAT_TTL_MS`、`AUTONOMY_DEVICE_LEASE_MS`、`AUTONOMY_DEVICE_GRACE_MS` 显式配置；缺失时 API 不会发放租约。

**当前仍未完成：**

1. 现有 MAOMAO 前端尚未调用这些设置 / heartbeat / lease API；本轮先完成了云端存储和接口，尚不能把“设备前台状态已在 PWA 自动同步”报告为 DONE。
2. Worker gate 已连接真实 store snapshot。全局开关没有显式记录时按关闭处理；角色作息缺失、时区无效或 policy 配置缺失时 fail-closed。
3. 当前没有可信 server-side chat event/context version 来源。Store 明确返回 `contextVersion: null`；所有 contact / follow_up / busy_reply / diary 上下文任务因此保持 `context_version_unavailable`，不会执行。没有伪造版本，也没有上传聊天正文。
4. 一次性 `ENROLLMENT_TOKEN` 的首次设备认领仍需单独审查；当前注册接口不能仅凭 M1 device-auth 测试视作已落实该要求。
5. GitHub Actions、Cloudflare Worker 部署、真实设备锁屏推送仍分别需要独立验证；本地/合成测试不能替代这些验收。

以上 API 只处理开关、作息、时区、设备心跳与租约元数据；不保存消息正文、角色 persona、关系资料、摘要、图片或附件。
