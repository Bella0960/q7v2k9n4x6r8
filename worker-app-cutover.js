/**
 * Single app.mao520.com trial-domain adapter, not the official product.
 *
 * mao520.com remains the ONE official site with the original account data.
 * Trial traffic may use only the isolated QA Worker service binding.
 *
 * The server-side switch defaults to false: preserve existing trial UI
 * until QA accounts, private-page gates and mobile checks are verified.
 * When enabled, forward the complete origin (HTML, APIs and service worker)
 * without copying passwords or sessions into the official database.
 */
import staticApp from './worker-app.js';

const TRIAL_HOST = 'app.mao520.com';

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
    if (url.protocol !== 'https:' || url.hostname !== TRIAL_HOST) {
      return new Response('Not found', {
        status: 404, headers: { 'cache-control': 'no-store' }
      });
    }
    if (typeof env?.MAO_APP_BACKEND?.fetch !== 'function') {
      return unavailable('APP_BACKEND_NOT_READY', '试玩版后台尚未完成连接');
    }

    // Forward the ORIGINAL request, origin and cookies. The integrated
    // worker.js owns the account/session gate for every private HTML route,
    // API authorization, scheduler and push, and sends host-only cookies.
    // Do not intercept only /api/: that would expose private static HTML.
    try {
      return await env.MAO_APP_BACKEND.fetch(request);
    } catch {
      // Fail closed. Do not serve ungated private pages from static assets.
      return unavailable('APP_BACKEND_UNAVAILABLE', '试玩版后台暂时无法连接');
    }
  }
};
