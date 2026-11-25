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

import { createApp, dispatchPendingOutboundPushes } from './worker/lib/app.js';
import { createStore } from './worker/lib/store.js';
import { applyMigrations, runtimeMigrations } from './worker/lib/migrations.js';
import { runTick } from './worker/lib/scheduler.js';
import { runCloudModelTick } from './worker/lib/cloud-model-scheduler.js';
import { createSchedulerGate } from './worker/lib/scheduler-gate.js';

const INSTANCE_NAME = 'maomao-global';

// Each immutable Worker deployment has its own assets binding. Never accept a
// versioned executable request unless the deployed manifest matches its token.
const releaseManifestByBinding = new WeakMap();
async function getAssetRelease(env, origin) {
  const assets = env?.ASSETS;
  if (!assets) return null;
  if (!releaseManifestByBinding.has(assets)) {
    const read = Promise.resolve().then(async () => {
      const response = await assets.fetch(new Request(new URL('/pwa-release.json', origin), {cache:'no-store'}));
      if (!response.ok) return null;
      const payload = await response.json();
      return /^[a-f0-9]{24}$/.test(payload?.release || '') ? payload.release : null;
    }).catch(() => null);
    releaseManifestByBinding.set(assets, read);
    read.then(value => { if (!value && releaseManifestByBinding.get(assets) === read) releaseManifestByBinding.delete(assets); });
  }
  return releaseManifestByBinding.get(assets);
}

async function serveVersionedAsset(request, env, url) {
  const requested = url.searchParams.get('mao_rev');
  const deployed = await getAssetRelease(env, url.origin);
  const headers = {'cache-control':'no-store', 'content-type':'text/plain; charset=UTF-8'};
  if (!deployed) return new Response('Build release unavailable', {status:503,headers});
  if (requested !== deployed) return new Response('Build release changed', {status:409,headers});
  const requestHeaders = new Headers(request.headers);
  for (const name of ['if-none-match','if-modified-since','if-range','range']) requestHeaders.delete(name);
  const response = await env.ASSETS.fetch(new Request(request,{headers:requestHeaders}));
  const type = response.headers.get('content-type') || '';
  const correctType = /\.css$/i.test(url.pathname) ? /^text\/css(?:;|\s|$)/i.test(type)
    : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|\s|$)/i.test(type);
  if (!response.ok || response.redirected || !correctType) {
    return new Response('Build asset unavailable', {status: response.status === 404 ? 404 : 503,headers});
  }
  const out = new Headers(response.headers);
  out.set('x-mao-release', deployed);
  if (!/(?:^|[,\s])(?:private|no-store)(?:[,\s]|$)/i.test(out.get('cache-control') || '')) {
    out.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(response.body,{status:response.status,headers:out});
}

// Redirect only when the account store or central authority explicitly confirms
// a missing/revoked session. Never cache this redirect as an app route response.
function redirectToVerifiedLogin(url, reason = '') {
  const target = new URL('/account/index.html', url);
  if (reason === 'disabled') target.searchParams.set('disabled', '1');
  if (reason === 'switched') target.searchParams.set('switched', '1');
  return new Response(null, { status: 302, headers: {
    location: target.href,
    'cache-control': 'private, no-store, max-age=0',
    vary: 'Cookie'
  } });
}

function accountAuthenticationUnavailable() {
  // A temporary identity-service failure is not proof that the user logged out.
  // Never serve account-owned HTML when authority cannot verify the session.
  return new Response(
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>MAO · 服务暂不可用</title></head><body style="margin:0;padding:12vh 8vw;color:#222;background:#f7f7f8;font:15px/1.8 -apple-system,BlinkMacSystemFont,sans-serif"><h1 style="font-size:20px;font-weight:500">暂时无法确认登录状态</h1><p>账号验证服务暂不可用，原有登录与数据没有被修改。请稍后重新打开此页面。</p></body></html>',
    {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'no-store',
        'retry-after': '10'
      }
    }
  );
}

function isVerifiedFounderSession(account, env) {
  if (!account || account.role !== 'super_admin' || account.status !== 'active') return false;
  // Isolated QA honors the exact configured founder UID. Do not trust a
  // browser role flag, a request header, or the editable page metadata.
  if (env?.MAO_IDENTITY_MODE === 'delegated_preview') {
    const expected = String(env.MAO_EXPECTED_FOUNDER_ID || '');
    return /^MAO-[A-Z0-9]{12,24}$/.test(expected) && account.id === expected;
  }
  // Non-delegated identity authorities already enforce the unique founder
  // role at account creation; keep their existing behavior unchanged.
  return true;
}

async function injectAccountScope(response, account, env) {
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
    '<meta name="mao-account-role" content="' + (isVerifiedFounderSession(account, env) ? 'super_admin' : 'user') + '">' +
    '<script src="/shared/js/mao-account-scope.js?v=4" data-mao-account-scope></script>';
  // The account runtime is injected after Vite's HTML stamp, so bind it
  // explicitly to the document's exact release while retaining the legacy
  // scope generation for unbuilt fixtures.
  const pageRelease = source.match(/<meta name="mao-build-release" content="([a-f0-9]{24})">/)?.[1];
  const scopedTags = pageRelease
    ? tags.replace(/(mao-account-scope\.js\?v=\d+)"/, '$1&mao_rev=' + pageRelease + '"')
    : tags;
  let injected = false;
  const html = source.replace(/<head\b[^>]*>/i, match => {
    injected = true;
    return match + scopedTags;
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
      applyMigrations(this.exec, Date.now(), this.transaction, runtimeMigrations(env));
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return this.handleApi(request);
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
          now: timestamp,
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
      if (this.env.AUTONOMY_CLOUD_ENABLED === 'true') {
        if (!this.store.hasCloudContextSchema()) {
          return Response.json({ ok: false, reason: 'cloud_context_schema_unavailable' }, { status: 503 });
        }
        const result = await runCloudModelTick({ store: this.store, env: this.env });
        return Response.json({ ok: result.ok, result });
      }
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
    if (request.method === 'GET' && url.pathname === '/pwa-release.json' && env.ASSETS) {
      const release = await getAssetRelease(env, url.origin);
      return Response.json({release}, {status:release?200:503,headers:{'cache-control':'no-store'}});
    }
    if (request.method === 'GET' && url.searchParams.has('mao_rev') && /\.(?:js|mjs|css)$/i.test(url.pathname)) {
      return serveVersionedAsset(request, env, url);
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
        return accountAuthenticationUnavailable();
      }
      try {
        const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
        const authRequest = new Request(new URL('/api/accounts/me', url), {
          method: 'GET',
          headers: { cookie: request.headers.get('cookie') || '' }
        });
        const authResponse = await stub.fetch(authRequest);
        const authPayload = await authResponse.json().catch(() => ({}));
        if (!authResponse.ok) {
          const errorCode = authPayload?.error?.code;
          const confirmedMissingSession = authResponse.status === 401 &&
            ['ACCOUNT_SESSION_REQUIRED', 'LOGIN_REQUIRED'].includes(errorCode);
          const confirmedBlockedOrSwitched = authResponse.status === 403 &&
            ['ACCOUNT_DISABLED', 'IDENTITY_AUTHORITY_CHANGED'].includes(errorCode);
          if (confirmedMissingSession || confirmedBlockedOrSwitched) {
            return redirectToVerifiedLogin(url,
              errorCode === 'ACCOUNT_DISABLED' ? 'disabled' :
              errorCode === 'IDENTITY_AUTHORITY_CHANGED' ? 'switched' : '');
          }
          // An unexpected 401, transient 403 or identity-service 5xx does NOT
          // establish logout. Fail closed with a no-store 503, not an entry redirect.
          return accountAuthenticationUnavailable();
        }
        const accountStatus = authPayload?.account?.status;
        if (accountStatus === 'pending_invite' ||
            accountStatus === 'disabled' || accountStatus === 'revoked') {
          // The central authority confirmed a real account that is not
          // permitted to enter private pages. This is not a service outage.
          return redirectToVerifiedLogin(url,
            accountStatus === 'disabled' || accountStatus === 'revoked' ? 'disabled' : '');
        }
        if (accountStatus !== 'active') {
          // Missing or unfamiliar identity data is not proof of logout.
          return accountAuthenticationUnavailable();
        }
        authorizedAccount = authPayload.account;
        if (url.pathname.startsWith('/admin/') && !isVerifiedFounderSession(authorizedAccount, env)) {
          return Response.redirect(new URL('/index.html', url), 302);
        }
      } catch {
        return accountAuthenticationUnavailable();
      }
    }

    // html_handling="none" 时显式把站点根路径映射到构建后的首页（沿用 main 的路由修复）。
    if (url.pathname === "/" && request.method === "GET") {
      const indexUrl = new URL("/index.html", url);
      const response = await env.ASSETS.fetch(new Request(indexUrl, request));
      return authorizedAccount ? await injectAccountScope(response, authorizedAccount, env) : response;
    }
    if (env.ASSETS) {
      let assetRequest = request;
      if (isHtmlDocument && authorizedAccount) {
        // A conditional 304 from static assets has no HTML body to inject.
        // Never let the browser reuse a stale, unscoped private document.
        const headers = new Headers(request.headers);
        for (const name of ['if-none-match', 'if-modified-since', 'if-range', 'range']) {
          headers.delete(name);
        }
        assetRequest = new Request(request, { headers });
      }
      const response = await env.ASSETS.fetch(assetRequest);
      if (isHtmlDocument && authorizedAccount) return await injectAccountScope(response, authorizedAccount, env);
      if (/\.(?:js|mjs|css)$/i.test(url.pathname) || isPublicAccountDocument || url.pathname === '/sw.js') {
        const headers = new Headers(response.headers);
        // Public sign-in remains eligible for its existing offline fallback.
        // All protected HTML remains private/no-store in injectAccountScope.
        if (isPublicAccountDocument && !/(?:private|no-store)/i.test(headers.get('cache-control') || '')) {
          headers.set('cache-control', 'no-cache, must-revalidate');
        } else {
          headers.set('cache-control', 'no-store');
        }
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
      return response;
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    if (!env.CLOUD_DB) return;
    ctx.waitUntil((async () => {
      const stub = env.CLOUD_DB.get(env.CLOUD_DB.idFromName(INSTANCE_NAME));
      const tick = () => stub.fetch(new Request('https://maomao.internal/internal/tick', { method: 'POST' }));
      const maintenance = () => stub.fetch(new Request('https://maomao.internal/internal/maintenance', { method: 'POST' }));
      if (env.AUTONOMY_CLOUD_ENABLED === 'true') {
        try { await tick(); }
        finally { await maintenance(); }
      } else {
        await maintenance();
        await tick();
      }
    })());
  }
};
