import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PushSmokeLimiter, default as worker } from '../qa/android-lockscreen-worker.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const env = { ASSETS: { fetch: async () => new Response('synthetic asset') } };

test('android smoke is a separate synthetic-only Worker with isolated Preview storage', () => {
  const cfg = JSON.parse(read('wrangler.android-push-smoke.jsonc'));
  assert.equal(cfg.name, 'isolated-android-notification-smoke');
  assert.equal(cfg.main, './qa/android-lockscreen-worker.js');
  assert.equal(cfg.previews.vars.MAO_ANDROID_SMOKE, 'true');
  assert.equal(cfg.previews.durable_objects.bindings[0].name, 'PUSH_RATE_GATE');
  assert.equal(cfg.assets.directory, './qa/android-lockscreen-assets');
  assert.ok(!JSON.stringify(cfg).includes('maomao-identity-core'));
  assert.ok(!JSON.stringify(cfg).includes('preview.mao520.com'));
  assert.ok(!JSON.stringify(cfg).includes('AUTONOMY_MODEL_BACKEND'));
});

test('actual public QA page only uses synthetic role and has a direct gesture permission prompt', () => {
  const page = read('qa/android-lockscreen-assets/index.html');
  assert.match(page, /Notification\.requestPermission\(\)/);
  assert.match(page, /\/api\/send/);
  assert.match(page, /小狐狸/);
  assert.match(page, /我到家啦，你今天怎么样？/);
  assert.doesNotMatch(page, /API Key|sk-|PRIVATE_KEY/);
  const sw = read('qa/android-lockscreen-assets/sw.js');
  assert.doesNotThrow(() => new Function(sw));
  assert.match(sw, /notificationclick/);
  assert.match(sw, /cleanVisible\(payload\.title/);
  assert.match(sw, /cleanVisible\(payload\.body/);
  assert.match(sw, /\/chat\.html\?role=role-fox/);
});

test('synthetic QA endpoints fail closed for cross-origin and malicious subscriptions', async () => {
  const denied = await worker.fetch(new Request('https://example.workers.dev/api/send', {
    method:'POST', headers:{'origin':'https://attacker.invalid','content-type':'application/json'},
    body:JSON.stringify({subscription:{}})
  }), env);
  assert.equal(denied.status, 403);
  const invalid = await worker.fetch(new Request('https://example.workers.dev/api/send', {
    method:'POST', headers:{'origin':'https://example.workers.dev','content-type':'application/json'},
    body:JSON.stringify({subscription:{endpoint:'https://evil.invalid/send',
      keys:{p256dh:'x'.repeat(88),auth:'x'.repeat(22)}}})
  }), env);
  assert.equal(invalid.status, 400);
  const health = await worker.fetch(new Request('https://example.workers.dev/api/health'), env);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.smokeOnly, true);
  assert.equal(payload.configured, false);
});

test('isolated durable rate limiter blocks the fifth push in 30 minutes', async () => {
  const map = new Map();
  const storage = {
    get: async k => map.get(k),
    put: async (k,v) => { map.set(k,v); }
  };
  const bucket = new PushSmokeLimiter({storage});
  for (let i=0; i<4; i++) {
    const res = await bucket.fetch(new Request('https://private.internal/check',{method:'POST'}));
    assert.equal(res.status,200);
  }
  const fifth = await bucket.fetch(new Request('https://private.internal/check',{method:'POST'}));
  assert.equal(fifth.status,429);
});
