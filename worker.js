/**
 * Cloudflare Worker 入口（与静态资源同域共存）。
 *
 *  - /api/*          → Durable Object（SQLite 存储）中的账号、设备、聊天出站与推送 API
 *  - 其他路径        → 交给 env.ASSETS（即现有 dist 静态站点）
 *  - scheduled       → 维护订阅/上下文、执行到期云端主动联系并派发 Web Push
 *
 * 这里不使用 D1：见 docs/engineering/CLOUD_PUSH.md 的选型说明
 * （静态站部署目前不需要任何账号级资源，引入 D1 需要先创建数据库并回填
 *   database_id，否则会阻断现有 deploy workflow；SQLite-backed Durable Object
 *  随部署自动创建，属于同一套持久化能力）。
 */

import { createApp, dispatchPendingOutboundPushes } from './worker/lib/app.js';
import { createStore } from './worker/lib/store.js';
import { applyMigrations } from './worker/lib/migrations.js';
import { runCloudModelTick } from './worker/lib/cloud-model-scheduler.js';
import { runTick } from './worker/lib/scheduler.js';
import { createSchedulerGate } from './worker/lib/scheduler-gate.js';
import { FOUNDER_CHECKPOINT_PATH, handleFounderCheckpointInternal } from './worker/lib/founder-recovery-operator.js';

const INSTANCE_NAME = 'maomao-global';

async function injectAccountScope(response, account) {
  if (!response || !response.ok || !String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
    return response;
  }
  const accountId = String(account?.id || '');
  const role = String(account?.role || '');
  const blockedHeaders = {
    'content-type': 'text/html; charset=UTF-8',
    'cache-control': 'no-store'
  };
  const blockedPage = new Response(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAO</title><body style="margin:0;padding:12vh 8vw;font:16px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#222;background:#f7f7f8"><h2>账号隔离暂不可用</h2><p>MAO 无法确认此页面已正确安装账号隔离保护，因此已阻止打开。请重新进入或联系创作者。</p></body></html>',
    { status: 503, headers: blockedHeaders }
  );
  if (!/^MAO-[A-Z0-9]{12,24}$/.test(accountId) ||
      !['user', 'super_admin'].includes(role)) return blockedPage;

  const source = await response.text();
  const tags =
    '<meta name="mao-account-id" content="' + accountId + '">' +
    '<meta name="mao-account-role" content="' + (role === 'super_admin' ? 'super_admin' : 'user') + '">' +
    '<script src="/shared/js/mao-account-scope.js?v=2" data-mao-account-scope></script>';
  let injected = false;
  const html = source.replace(/<head\b[^>]*>/i, match => {
    injected = true;
    return match + tags;
  });
  if (!injected) return blockedPage;
  const headers = new Headers(response.headers);
  ['content-length', 'content-encoding', 'content-md5', 'etag', 'last-modified'].forEach(name => headers.delete(name));
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('vary', 'Cookie');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}


// Legacy foreground-owner path and cloud-owned model path are separate executors.
// Preserve the original scheduling API when adding autonomous server generation.
function readSchedulerConfig(env) {
  const config = {};
  if (env?.AUTONOMY_LEASE_MS != null) config.leaseMs = Number(env.AUTONOMY_LEASE_MS);
  if (env?.AUTONOMY_TICK_LIMIT != null) config.tickLimit = Number(env.AUTONOMY_TICK_LIMIT);
  if (env?.AUTONOMY_RETRY_BACKOFF_MS != null) {
    config.retryBackoffMs = String(env.AUTONOMY_RETRY_BACKOFF_MS)
      .split(',').map(value => value.trim()).filter(Boolean).map(Number);
  }
  return config;
}

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
    // Durable Objects expose a native synchronous transaction boundary for
    // SQLite. Keep the store/migration logic storage-agnostic and use this
    // adapter in production; node:sqlite tests use the explicit SQL fallback.
    this.transaction = typeof ctx.storage.transactionSync === 'function'
      ? callback => ctx.storage.transactionSync(callback)
      : null;
    const store = createStore(this.exec, this.transaction);
    this.store = store;
    this.handleApi = createApp({ store, env });
    ctx.blockConcurrencyWhile(async () => {
      applyMigrations(this.exec, Date.now(), this.transaction);
    });
  }

  async ensurePreviewAlarm() {
    if (this.env.AUTONOMY_PREVIEW_ALARM_ENABLED !== 'true') return;
    await this.ctx.storage.transaction(async storage => {
      if ((await storage.getAlarm()) === null) {
        await storage.setAlarm(Date.now() + 60_000);
      }
    });
  }

  async alarm() {
    if (this.env.AUTONOMY_PREVIEW_ALARM_ENABLED !== 'true') return;
    // Re-arm before running the tick so a failed model or push does not stop
    // the next pass. Cloud task leases fence concurrent or retried alarms.
    await this.ensurePreviewAlarm();
    const response = await this.fetch(new Request(
      'https://maomao.internal/internal/tick', { method: 'POST' }
    ));
    if (!response.ok) throw new Error('cloud_preview_tick_http_' + response.status);
  }

  async fetch(request) {
    const url = new URL(request.url);
    // Internal binding only. The public Worker entrypoint does not forward
    // /internal/*, and a separate operator secret is mandatory.
    if (url.pathname === FOUNDER_CHECKPOINT_PATH) {
      return handleFounderCheckpointInternal({
        request, env: this.env, storage: this.ctx.storage
      });
    }
    if (url.pathname.startsWith('/api/')) {
      const response = await this.handleApi(request);
      if (response.ok && request.method === 'POST' &&
          /^\/api\/characters\/[^/]+\/context-snapshot$/.test(url.pathname)) {
        await this.ensurePreviewAlarm();
      }
      return response;
    }
    if (url.pathname === '/internal/maintenance' && request.method === 'POST') {
      const timestamp = Date.now();
      const removed = this.store.cleanupSubscriptions(timestamp);
      const pairingTokensRemoved = this.store.cleanupDevicePairingTokens(timestamp);
      const contextEventsRemoved = this.store.cleanupCharacterContextEvents(timestamp);
      const loginRateLimitsRemoved = this.store.cleanupMaoLoginRateLimits(timestamp);
      let stagedOutboxRecovery;
      try {
        stagedOutboxRecovery = this.store.repairAllStagedActivityOutboxes({
          now: timestamp,
          limit: 100
        });
      } catch (error) {
        stagedOutboxRecovery = { scanned: 0, repaired: 0, deferred: 1 };
      }
      let pushDispatch;
      try {
        pushDispatch = await dispatchPendingOutboundPushes({
          store: this.store,
          env: this.env,
          now: Date.now,
          fetchImpl: fetch,
          limit: 50
        });
      } catch (error) {
        pushDispatch = { configured: false, reason: 'dispatch_deferred' };
      }
      return Response.json({
        ok: true,
        removed,
        pairingTokensRemoved,
        contextEventsRemoved,
        loginRateLimitsRemoved,
        stagedOutboxRecovery,
        pushDispatch
      });
    }
    if (url.pathname === '/internal/tick' && request.method === 'POST') {
      // Do not replace the existing foreground/device-owned scheduler.
      // Cloud tasks are independently filtered by executionMode='cloud'.
      const foregroundNow = Date.now();
      let foregroundResult;
      try {
        foregroundResult = runTick({
          store: this.store,
          now: foregroundNow,
          config: readSchedulerConfig(this.env),
          gate: createSchedulerGate({
            store: this.store,
            now: () => foregroundNow,
            config: readSchedulePolicyConfig(this.env)
          })
        });
      } catch {
        // Fail independently: one executor must not starve the other.
        foregroundResult = { ok: false, reason: 'foreground_tick_failed' };
      }
      const cloudResult = await runCloudModelTick({
        store: this.store,
        env: this.env,
        // Pass the clock, not a Cron-start snapshot: the model call may
        // outlive its lease and the executor must recheck real wall time.
        now: Date.now,
        fetchImpl: fetch
      });
      let pushDispatch;
      try {
        pushDispatch = await dispatchPendingOutboundPushes({
          store: this.store,
          env: this.env,
          now: Date.now,
          fetchImpl: fetch,
          limit: 50
        });
      } catch (error) {
        pushDispatch = { configured: false, reason: 'dispatch_deferred' };
      }
      return Response.json({ ok: true, result: foregroundResult, cloudResult, pushDispatch });
    }
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Private DO controls must never fall through to static asset routing,
    // even if a future asset configuration adds an SPA fallback.
    if (url.pathname.startsWith('/internal/')) {
      return new Response('Not found', {
        status: 404, headers: { 'cache-control': 'no-store' }
      });
    }
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
    // Every MAO app document is server-gated. Only the account entry is public;
    // static assets remain readable, but account-owned APIs still enforce identity.
    const isHtmlDocument = request.method === 'GET' &&
      (url.pathname === '/' || url.pathname.toLowerCase().endsWith('.html'));
    const isPublicAccountDocument = url.pathname === '/account' ||
      url.pathname === '/account/' ||
      url.pathname === '/account/index.html' ||
      url.pathname === '/account/bootstrap.html';
    let authorizedAccount = null;
    if (isHtmlDocument && !isPublicAccountDocument) {
      if (!env.CLOUD_DB) {
        return Response.redirect(new URL('/account/index.html', url), 302);
      }
      try {
        const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
        const authRequest = new Request(new URL('/api/accounts/me', url), {
          method: 'GET',
          headers: { cookie: request.headers.get('cookie') || '' }
        });
        const authResponse = await stub.fetch(authRequest);
        const authPayload = await authResponse.json().catch(() => ({}));
        if (
          !authResponse.ok ||
          authPayload?.account?.status !== 'active'
        ) {
          const disabled = authPayload?.error?.code === 'ACCOUNT_DISABLED';
          const target = new URL('/account/index.html', url);
          if (disabled) target.searchParams.set('disabled', '1');
          return Response.redirect(target, 302);
        }
        authorizedAccount = authPayload.account;
        if (url.pathname.startsWith('/admin/') && authorizedAccount.role !== 'super_admin') {
          return Response.redirect(new URL('/index.html', url), 302);
        }
      } catch {
        return Response.redirect(new URL('/account/index.html', url), 302);
      }
    }

    // html_handling="none" 时显式把站点根路径映射到构建后的首页（沿用 main 的路由修复）。
    if (url.pathname === "/" && request.method === "GET") {
      const indexUrl = new URL("/index.html", url);
      const response = await env.ASSETS.fetch(new Request(indexUrl, request));
      return authorizedAccount ? await injectAccountScope(response, authorizedAccount) : response;
    }
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      return isHtmlDocument && authorizedAccount
        ? await injectAccountScope(response, authorizedAccount)
        : response;
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    if (!env.CLOUD_DB) return;
    ctx.waitUntil((async () => {
      const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
      let maintenanceError = null;
      try {
        const response = await stub.fetch(new Request(
          'https://maomao.internal/internal/maintenance', { method: 'POST' }
        ));
        if (!response.ok) maintenanceError = new Error('cloud_maintenance_http_' + response.status);
      } catch {
        maintenanceError = new Error('cloud_maintenance_transport_failed');
      }

      // A transient maintenance failure must not starve proactive contacts.
      // Always attempt the cloud model tick before reporting either error.
      const tickResponse = await stub.fetch(new Request(
        'https://maomao.internal/internal/tick', { method: 'POST' }
      ));
      if (!tickResponse.ok) throw new Error('cloud_tick_http_' + tickResponse.status);
      if (maintenanceError) throw maintenanceError;
    })());
  }
};
