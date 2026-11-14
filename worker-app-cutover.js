/**
 * Official app-domain cutover adapter.
 *
 * This is an OPTIONAL release candidate, not the live static entrypoint.
 * Disabled by default: serve the existing app exactly as worker-app.js does.
 * After account continuity, rollback and real-device gates pass, a Cloudflare
 * *server-side* flag switches the entire origin (HTML + API + SW + assets)
 * to the existing fully integrated backend via a Worker Service Binding.
 *
 * No browser-visible backend hostname, QA database, copied password,
 * CORS proxy, cookie rewriting, or second account system.
 */
import staticApp from './worker-app.js';

const OFFICIAL_HOST = 'app.mao520.com';

function unavailable(code, message) {
  return Response.json(
    { ok: false, error: { code, message } },
    { status: 503, headers: { 'cache-control': 'no-store' } }
  );
}

export default {
  async fetch(request, env) {
    // Never switch users based on a query parameter or a browser header.
    // A deploy of wrangler.app.cutover.jsonc alone must remain unchanged.
    if (env?.MAO_APP_CUTOVER_ENABLED !== 'true') {
      return staticApp.fetch(request, env);
    }

    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_HOST) {
      return new Response('Not found', {
        status: 404, headers: { 'cache-control': 'no-store' }
      });
    }
    if (typeof env?.MAO_APP_BACKEND?.fetch !== 'function') {
      return unavailable('APP_BACKEND_NOT_READY', '正式手机后台尚未完成连接');
    }

    // Forward the ORIGINAL request, origin and cookies. The integrated
    // worker.js owns the account/session gate for every private HTML route,
    // API authorization, scheduler and push, and sends host-only cookies.
    // Do not intercept only /api/: that would expose private static HTML.
    try {
      return await env.MAO_APP_BACKEND.fetch(request);
    } catch {
      // Fail closed. Do not serve ungated private pages from static assets.
      return unavailable('APP_BACKEND_UNAVAILABLE', '正式手机后台暂时无法连接');
    }
  }
};
