import { parseVapidKeys, sendWebPush } from '../worker/lib/webpush.js';

const SAFE_MESSAGE = Object.freeze({
  type: 'test_chat',
  roleId: 'role-fox',
  title: '小狐狸',
  body: '我到家啦，你今天怎么样？',
  tag: 'maomao-android-qa-lockscreen',
  url: '/chat.html?role=role-fox'
});
const TRUSTED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com'
]);
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: JSON_HEADERS
});

export class PushSmokeLimiter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const now = Date.now();
    const windowMs = 30 * 60 * 1000;
    const prior = await this.state.storage.get('rate');
    const current = prior && Number.isFinite(prior.since) && now - prior.since < windowMs
      ? prior : { since: now, count: 0 };
    if (current.count >= 4) return reply({ allowed: false }, 429);
    current.count += 1;
    await this.state.storage.put('rate', current);
    return reply({ allowed: true, remaining: 4 - current.count });
  }
}

async function limiterFor(env, subscription, ip) {
  if (!env.PUSH_RATE_GATE) return false;
  const data = new TextEncoder().encode('android-qa|' + ip + '|' + subscription.endpoint);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const key = Array.from(new Uint8Array(digest)).slice(0, 16)
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const stub = env.PUSH_RATE_GATE.get(env.PUSH_RATE_GATE.idFromName('smoke-' + key));
  const res = await stub.fetch('https://private.internal/check', { method: 'POST' });
  return res.ok;
}

function validSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.endpoint !== 'string' ||
      value.endpoint.length < 25 || value.endpoint.length > 1100) return null;
  let url;
  try { url = new URL(value.endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.port || url.hash || !TRUSTED_PUSH_HOSTS.has(url.hostname)) return null;
  const keys = value.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
      keys.p256dh.length < 80 || keys.p256dh.length > 110 ||
      keys.auth.length < 18 || keys.auth.length > 32) return null;
  return { endpoint: url.href, p256dh: keys.p256dh, auth: keys.auth };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return reply({ ok: true, smokeOnly: true,
        configured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
        isolatedRateGate: Boolean(env.PUSH_RATE_GATE) });
    }
    if (url.pathname === '/api/config' && request.method === 'GET') {
      try {
        const keys = parseVapidKeys(env);
        return reply({ ok: true, publicKey: keys.publicKeyB64 });
      } catch { return reply({ ok: false, error: 'push_not_configured' }, 503); }
    }
    if (url.pathname === '/api/send' && request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin ||
          (request.headers.get('content-type') || '').split(';')[0] !== 'application/json') {
        return reply({ ok: false, error: 'origin_denied' }, 403);
      }
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 2400) return reply({ ok: false, error: 'payload_too_large' }, 413);
      const raw = await request.text();
      if (raw.length > 2400) return reply({ ok: false, error: 'payload_too_large' }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return reply({ ok: false, error: 'invalid_json' }, 400); }
      if (!body || Object.keys(body).join(',') !== 'subscription') {
        return reply({ ok: false, error: 'invalid_fields' }, 400);
      }
      const subscription = validSubscription(body.subscription);
      if (!subscription) return reply({ ok: false, error: 'invalid_subscription' }, 400);
      const ip = String(request.headers.get('cf-connecting-ip') || 'unknown');
      if (!await limiterFor(env, subscription, ip)) {
        return reply({ ok: false, error: 'rate_limited' }, 429);
      }
      let keys;
      try { keys = parseVapidKeys(env); }
      catch { return reply({ ok: false, error: 'push_not_configured' }, 503); }
      try {
        const result = await sendWebPush(
          subscription, JSON.stringify(SAFE_MESSAGE), keys,
          { nowMs: Date.now() }
        );
        if (!result.ok) return reply({
          ok: false, error: result.gone ? 'subscription_expired' : 'provider_rejected'
        }, result.gone ? 410 : 502);
        // Provider acceptance != proof that Android displayed a lockscreen notice.
        return reply({ ok: true, providerAccepted: true,
          note: 'Android notification display must be checked on the physical phone' });
      } catch {
        return reply({ ok: false, error: 'transport_failure' }, 502);
      }
    }
    if (url.pathname.startsWith('/api/')) return reply({ ok: false }, 404);
    if (!env.ASSETS) return new Response('Assets unavailable', { status: 503 });
    return env.ASSETS.fetch(request);
  }
};
