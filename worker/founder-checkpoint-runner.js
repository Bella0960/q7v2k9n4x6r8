/**
 * Release-only, scheduled private checkpoint caller.
 *
 * This Worker is NOT deployed by main or the founder QA preview.
 * It has no public action route and no configured cron by default.
 * The external DO binding targets the existing live account Worker.
 */
const TARGET_SCRIPT = 'mao-auth-preview';
const TARGET_INSTANCE = 'maomao-global';
const TARGET_ORIGIN = 'https://mao520.com';
const PRIVATE_URL = 'https://maomao.internal/internal/release/checkpoint';
const MAX_WINDOW_MS = 120_000;
const SUCCESS = 'checkpoint_recorded';

function validMillis(value) {
  const n = Number(value);
  return typeof value === 'string' && /^[0-9]{13}$/.test(value) &&
    Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function runPrivateFounderCheckpoint({ env, now = Date.now }) {
  // All switches are absent until separately provisioned by a release operator.
  if (env?.FOUNDER_RUN_ENABLED !== 'acknowledge-single-use-live-checkpoint') {
    return { ok: false, code: 'disabled' };
  }
  if (env.FOUNDER_TARGET_SCRIPT !== TARGET_SCRIPT ||
      env.FOUNDER_TARGET_ORIGIN !== TARGET_ORIGIN) {
    return { ok: false, code: 'wrong_authority' };
  }
  const start = validMillis(env.FOUNDER_RUN_NOT_BEFORE_MS);
  const end = validMillis(env.FOUNDER_RUN_NOT_AFTER_MS);
  const time = now();
  if (!start || !end || !Number.isSafeInteger(time) ||
      end <= start || end - start > MAX_WINDOW_MS || time < start || time >= end) {
    return { ok: false, code: 'window_closed' };
  }
  const secret = env.FOUNDER_RELEASE_OPERATOR_SECRET;
  if (typeof secret !== 'string' || secret.length < 48 ||
      secret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(secret)) {
    return { ok: false, code: 'secret_unavailable' };
  }
  const ns = env.LIVE_CLOUD_DB;
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
    return { ok: false, code: 'binding_unavailable' };
  }

  try {
    const stub = ns.get(ns.idFromName(TARGET_INSTANCE));
    const response = await stub.fetch(new Request(PRIVATE_URL, {
      method: 'POST',
      headers: { 'x-maomao-release-secret': secret }
    }));
    if (!response.ok) return { ok: false, code: 'checkpoint_failed' };
    const result = await response.json();
    if (result?.ok !== true || result?.recorded !== true ||
        !Number.isSafeInteger(result.recordedAt) ||
        result.recordedAt <= 0 || result.recordedAt > time) {
      return { ok: false, code: 'invalid_acknowledgement' };
    }
    return { ok: true, code: SUCCESS, recordedAt: result.recordedAt };
  } catch {
    // Never expose DO errors, secrets, account data or bookmark values.
    return { ok: false, code: 'checkpoint_failed' };
  }
}

export default {
  async fetch() {
    return new Response('Not found', {
      status: 404, headers: { 'cache-control': 'no-store' }
    });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runPrivateFounderCheckpoint({ env });
      if (!result.ok) throw new Error('private_checkpoint_' + result.code);
      // Only a non-sensitive acknowledgement; no bookmark or credentials.
      console.log('private_checkpoint_recorded');
    })());
  }
};
