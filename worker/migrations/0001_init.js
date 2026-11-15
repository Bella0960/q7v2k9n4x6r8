/**
 * 0001_init — Milestone 1 云基础表结构。
 *
 * 迁移只增不改：任何对已发布表的修改都必须新建 000N_xxx.js，并在
 * worker/lib/migrations.js 的 MIGRATIONS 列表末尾追加。
 *
 * 表结构有意为 Milestone 2/3 预留位置：
 *   - activity_queue：角色自主活动的持久化队列骨架（等待/运行/冷却/完成/失败重试）
 *   - execution_log：每次云端执行的日志与决策原因
 *   - outbound_messages：云端生成、尚未同步到前端的消息（带稳定 server id 与幂等键）
 *   - push_deliveries：按订阅维度记录推送结果，防止重复通知
 */

export const VERSION = '0001_init';

export const SQL = `
-- 迁移记录
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- 设备：以设备自生成的随机凭据完成"注册/授权"，服务端只保存加盐哈希
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_devices_ip_created ON devices (ip_hash, created_at);

-- 推送订阅：一台设备可有多条（多端/多次订阅），按 endpoint 唯一
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  disabled_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_device ON push_subscriptions (device_id, disabled_at);

-- 云端生成、等待同步到聊天历史的出站消息
CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  server_message_id TEXT NOT NULL,
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_server_id ON outbound_messages (server_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_dedupe ON outbound_messages (dedupe_key);

-- Milestone 2：角色自主活动队列骨架（Milestone 1 只建表，不执行）
CREATE TABLE IF NOT EXISTS activity_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contact',
  status TEXT NOT NULL DEFAULT 'waiting',
  scheduled_at INTEGER NOT NULL,
  next_attempt_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_due ON activity_queue (status, scheduled_at);

-- 执行日志：每次云端动作（含 test-push / 后续的 AI 决策）的成功、失败与原因
CREATE TABLE IF NOT EXISTS execution_log (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exec_created ON execution_log (created_at);
CREATE INDEX IF NOT EXISTS idx_exec_device_kind ON execution_log (device_id, kind, created_at);

-- 推送投递记录：dedupe_key + subscription_id 唯一，保证同一条消息不会重复推送
CREATE TABLE IF NOT EXISTS push_deliveries (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  outbound_message_id TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_delivery_dedupe ON push_deliveries (dedupe_key, subscription_id);
`;
