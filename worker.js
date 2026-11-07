/**
 * Cloudflare Worker 入口（与静态资源同域共存）。
 *
 *  - /api/*          → Durable Object（SQLite 存储）中的 Milestone 1 云接口
 *  - 其他路径        → 交给 env.ASSETS（即现有 dist 静态站点，行为不变）
 *  - scheduled       → 清理过期订阅（Cron Trigger）
 *
 * 这里不使用 D1：见 docs/engineering/CLOUD_PUSH.md 的选型说明
 * （静态站部署目前不需要任何账号级资源，引入 D1 需要先创建数据库并回填
 *   database_id，否则会阻断现有 deploy workflow；SQLite-backed Durable Object
 *  随部署自动创建，属于同一套持久化能力）。
 */

import { createApp } from './worker/lib/app.js';
import { createStore } from './worker/lib/store.js';
import { applyMigrations } from './worker/lib/migrations.js';
import { runTick } from './worker/lib/scheduler.js';
import { createSchedulerGate } from './worker/lib/scheduler-gate.js';

const INSTANCE_NAME = 'maomao-global';

/**
 * 调度参数全部来自显式环境配置，不设产品默认值。
 * 缺失时 runTick 会 fail-closed 并写入 missing_config 日志。
 */
function readSchedulerConfig(env) {
  const config = {};
  if (env?.AUTONOMY_LEASE_MS != null) config.leaseMs = Number(env.AUTONOMY_LEASE_MS);
  if (env?.AUTONOMY_TICK_LIMIT != null) config.tickLimit = Number(env.AUTONOMY_TICK_LIMIT);
  if (env?.AUTONOMY_RETRY_BACKOFF_MS != null) {
    config.retryBackoffMs = String(env.AUTONOMY_RETRY_BACKOFF_MS)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(Number);
  }
  return config;
}

/**
 * M2.1 time/presence parameters remain explicit operator configuration.
 * Missing values are not replaced with guessed product defaults.
 */
function readSchedulePolicyConfig(env) {
  const config = {};
  const readPositive = name => {
    const raw = env?.[name];
    if (raw == null || String(raw).trim() === '') return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : NaN;
  };
  const readNonNegative = name => {
    const raw = env?.[name];
    if (raw == null || String(raw).trim() === '') return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };

  const heartbeatTtlMs = readPositive('AUTONOMY_HEARTBEAT_TTL_MS');
  const leaseDurationMs = readPositive('AUTONOMY_DEVICE_LEASE_MS');
  const graceMs = readNonNegative('AUTONOMY_DEVICE_GRACE_MS');
  if (heartbeatTtlMs !== undefined) config.heartbeatTtlMs = heartbeatTtlMs;
  if (leaseDurationMs !== undefined) config.leaseDurationMs = leaseDurationMs;
  if (graceMs !== undefined) config.graceMs = graceMs;
  return config;
}

export class CloudDatabase {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.exec = (sql, ...params) => ctx.storage.sql.exec(sql, ...params).toArray();
    const store = createStore(this.exec);
    this.store = store;
    this.handleApi = createApp({ store, env });
    ctx.blockConcurrencyWhile(async () => {
      applyMigrations(this.exec);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return this.handleApi(request);
    if (url.pathname === '/internal/maintenance' && request.method === 'POST') {
      const removed = this.store.cleanupSubscriptions(Date.now());
      return Response.json({ ok: true, removed });
    }
    if (url.pathname === '/internal/tick' && request.method === 'POST') {
      // 真实 gate 已接入；缺少显式授权/作息/lease 配置或可信上下文版本时仍 fail-closed。
      const timestamp = Date.now();
      const result = runTick({
        store: this.store,
        now: timestamp,
        config: readSchedulerConfig(this.env),
        gate: createSchedulerGate({
          store: this.store,
          now: () => timestamp,
          config: readSchedulePolicyConfig(this.env)
        })
      });
      return Response.json({ ok: true, result });
    }
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!env.CLOUD_DB) {
        return Response.json(
          { ok: false, error: { code: 'STORAGE_NOT_CONFIGURED', message: '云端存储尚未绑定' } },
          { status: 503 }
        );
      }
      const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
      return stub.fetch(request);
    }
    // html_handling="none" 时显式把站点根路径映射到构建后的首页（沿用 main 的路由修复）。
    if (url.pathname === "/" && request.method === "GET") {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    if (!env.CLOUD_DB) return;
    ctx.waitUntil((async () => {
      const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
      await stub.fetch(new Request('https://maomao.internal/internal/maintenance', { method: 'POST' }));
      await stub.fetch(new Request('https://maomao.internal/internal/tick', { method: 'POST' }));
    })());
  }
};
