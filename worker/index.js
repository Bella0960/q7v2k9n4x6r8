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

import { createApp } from './lib/app.js';
import { createStore } from './lib/store.js';
import { applyMigrations } from './lib/migrations.js';

const INSTANCE_NAME = 'maomao-global';

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
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    if (!env.CLOUD_DB) return;
    ctx.waitUntil((async () => {
      const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
      await stub.fetch(new Request('https://maomao.internal/internal/maintenance', { method: 'POST' }));
    })());
  }
};
