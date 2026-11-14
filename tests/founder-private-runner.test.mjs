import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import operator, { runPrivateFounderCheckpoint } from '../worker/founder-checkpoint-runner.js';
import { recordFounderCheckpoint } from '../scripts/release/founder-checkpoint.mjs';

const NOW = 1_800_000_000_000;
const SECRET = 'R'.repeat(64);

function setup() {
  const calls = [];
  const response = Response.json({ ok: true, recorded: true, recordedAt: NOW - 5000 });
  let result = response;
  const ns = {
    idFromName(name) { calls.push(['id', name]); return name; },
    get(id) {
      calls.push(['get', id]);
      return {
        async fetch(request) {
          calls.push(['fetch', request.url, request.method,
            request.headers.get('x-maomao-release-secret')]);
          return result;
        }
      };
    }
  };
  const env = {
    FOUNDER_RUN_ENABLED: 'acknowledge-single-use-live-checkpoint',
    FOUNDER_TARGET_SCRIPT: 'mao-auth-preview',
    FOUNDER_TARGET_ORIGIN: 'https://mao520.com',
    FOUNDER_RUN_NOT_BEFORE_MS: String(NOW - 30000),
    FOUNDER_RUN_NOT_AFTER_MS: String(NOW + 30000),
    FOUNDER_RELEASE_OPERATOR_SECRET: SECRET,
    LIVE_CLOUD_DB: ns
  };
  return { env, calls, setResponse: value => { result = value; } };
}

test('operator config has no route, public workers.dev, preview URL or scheduled cron', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.release-checkpoint.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'maomao-founder-checkpoint-operator');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.triggers.crons, []);
  assert.deepEqual(config.kv_namespaces, [{
    binding: 'RELEASE_AUDIT', id: '54544f9f1ce54220957d8fc9c49ccc7c'
  }]);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.durable_objects.bindings, [{
    name: 'LIVE_CLOUD_DB',
    class_name: 'CloudDatabase',
    script_name: 'mao-auth-preview'
  }]);
  assert.equal(config.vars.FOUNDER_TARGET_ORIGIN, 'https://mao520.com');
  assert.equal(config.vars.FOUNDER_RUN_ENABLED, undefined);
  assert.equal(config.vars.FOUNDER_RELEASE_OPERATOR_SECRET, undefined);
});

test('operator is fail-closed without explicit activation or correct target', async () => {
  const { env, calls } = setup();
  assert.deepEqual(await runPrivateFounderCheckpoint({ env: { ...env, FOUNDER_RUN_ENABLED: undefined }, now: () => NOW }), { ok: false, code: 'disabled' });
  assert.deepEqual(await runPrivateFounderCheckpoint({ env: { ...env, FOUNDER_TARGET_SCRIPT: 'mao' }, now: () => NOW }), { ok: false, code: 'wrong_authority' });
  assert.deepEqual(await runPrivateFounderCheckpoint({ env: { ...env, FOUNDER_TARGET_ORIGIN: 'https://app.mao520.com' }, now: () => NOW }), { ok: false, code: 'wrong_authority' });
  assert.equal(calls.length, 0);
});

test('missing, expired, invalid, and overly broad windows never touch the live binding', async () => {
  const { env, calls } = setup();
  for (const changes of [
    { FOUNDER_RUN_NOT_BEFORE_MS: undefined },
    { FOUNDER_RUN_NOT_BEFORE_MS: '0' },
    { FOUNDER_RUN_NOT_BEFORE_MS: String(NOW + 30000) },
    { FOUNDER_RUN_NOT_AFTER_MS: String(NOW - 1) },
    { FOUNDER_RUN_NOT_AFTER_MS: String(NOW + 300000) },
    { FOUNDER_RUN_NOT_AFTER_MS: String(NOW - 30000) },
    { FOUNDER_RUN_NOT_BEFORE_MS: 'not-a-time' }
  ]) {
    const result = await runPrivateFounderCheckpoint({ env: { ...env, ...changes }, now: () => NOW });
    assert.deepEqual(result, { ok: false, code: 'window_closed' });
  }
  assert.equal(calls.length, 0);
});

test('operator requires independent valid secret and the exact cross-Worker binding', async () => {
  const { env, calls } = setup();
  for (const changes of [
    { FOUNDER_RELEASE_OPERATOR_SECRET: '' },
    { FOUNDER_RELEASE_OPERATOR_SECRET: 'short' },
    { FOUNDER_RELEASE_OPERATOR_SECRET: 'x'.repeat(300) },
    { FOUNDER_RELEASE_OPERATOR_SECRET: 'x'.repeat(47) }
  ]) {
    assert.equal((await runPrivateFounderCheckpoint({ env: { ...env, ...changes }, now: () => NOW })).code, 'secret_unavailable');
  }
  assert.equal((await runPrivateFounderCheckpoint({ env: { ...env, LIVE_CLOUD_DB: undefined }, now: () => NOW })).code, 'binding_unavailable');
  assert.equal(calls.length, 0);
});

test('authorized scheduler calls only the private checkpoint operation and returns no bookmark', async () => {
  const { env, calls } = setup();
  const actual = await runPrivateFounderCheckpoint({ env, now: () => NOW });
  assert.deepEqual(actual, { ok: true, code: 'checkpoint_recorded', recordedAt: NOW - 5000 });
  assert.deepEqual(calls, [
    ['id', 'maomao-global'],
    ['get', 'maomao-global'],
    ['fetch', 'https://maomao.internal/internal/release/checkpoint', 'POST', SECRET]
  ]);
  assert.ok(!JSON.stringify(actual).includes(SECRET));
});

test('upstream failure and malformed acknowledgements never expose sensitive response text', async () => {
  const { env, setResponse } = setup();
  for (const response of [
    new Response('live bookmark secret', { status: 500 }),
    Response.json({ ok: true, recorded: false, bookmark: 'private' }),
    Response.json({ ok: true, recorded: true, recordedAt: NOW + 60000 })
  ]) {
    setResponse(response);
    const x = await runPrivateFounderCheckpoint({ env, now: () => NOW });
    assert.equal(x.ok, false);
    assert.doesNotMatch(JSON.stringify(x), /bookmark|private|secret/);
  }
});

test('private checkpoint HTTP errors are distinguished safely without raw response leakage', async () => {
  const { env, setResponse } = setup();
  for (const [status,code] of [
    [403,'checkpoint_operator_secret_rejected'],
    [404,'checkpoint_handler_not_active'],
    [409,'checkpoint_rotation_requires_review'],
    [503,'checkpoint_storage_unavailable']
  ]) {
    setResponse(new Response('PRIVATE_1234567890_BOOKMARK_CREDENTIAL', { status }));
    const result = await runPrivateFounderCheckpoint({ env, now: () => NOW });
    assert.deepEqual(result, { ok: false, code });
    assert.doesNotMatch(JSON.stringify(result), /BOOKMARK|CREDENTIAL|PRIVATE/);
  }
});

test('private DO acknowledgement after request start is accepted within response clock skew', async () => {
  const { env, setResponse } = setup();
  setResponse(Response.json({ ok: true, recorded: true, recordedAt: NOW + 15 }));
  const actual = await runPrivateFounderCheckpoint({ env, now: () => NOW });
  assert.equal(actual.ok, true);
  assert.equal(actual.recordedAt, NOW + 15);
});

test('public fetch is unavailable even if the scheduled Worker has been deployed', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await operator.fetch(new Request('https://example.test/internal/release/checkpoint', { method }));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('retry cannot overwrite the first recoverable bookmark or silently rotate a stale one', async () => {
  const values = new Map();
  let bookmarkCalls = 0, writes = 0;
  const storage = {
    async get(key) { return values.get(key); },
    async getCurrentBookmark() { bookmarkCalls++; return 'a'.repeat(64); },
    async put(key, value) { writes++; values.set(key, value); },
    async sync() {}
  };
  assert.deepEqual(await recordFounderCheckpoint({ storage, now: () => NOW }), { recorded: true, recordedAt: NOW });
  assert.deepEqual(await recordFounderCheckpoint({ storage, now: () => NOW + 1000 }), { recorded: true, recordedAt: NOW });
  assert.equal(bookmarkCalls, 1);
  assert.equal(writes, 1);
  await assert.rejects(recordFounderCheckpoint({ storage, now: () => NOW + 900001 }), /review before rotating/);
  assert.equal(bookmarkCalls, 1);
  assert.equal(writes, 1);
});

test('private execution receipts are persisted without bookmark, secret or account data', async () => {
  const { env, calls, setResponse } = setup();
  // Unlike direct unit tests using the injectable clock, scheduled() uses
  // real wall time. Keep this synthetic window aligned with Date.now().
  const now = Date.now();
  env.FOUNDER_RUN_NOT_BEFORE_MS = String(now - 30000);
  env.FOUNDER_RUN_NOT_AFTER_MS = String(now + 30000);
  setResponse(Response.json({ ok: true, recorded: true, recordedAt: now - 5000 }));
  const receipts = new Map();
  env.RELEASE_AUDIT = {
    async put(key, value, options) {
      assert.ok(options.expirationTtl <= 60 * 60 * 24 * 3);
      receipts.set(key, JSON.parse(value));
    }
  };
  let scheduled;
  await operator.scheduled({}, env, { waitUntil(promise) { scheduled = promise; } });
  await scheduled;
  assert.equal(calls.some(call => call[0] === 'fetch'), true);
  for (const [key, receipt] of receipts) {
    assert.equal(receipt.code, 'checkpoint_recorded');
    assert.equal(receipt.ok, true);
    assert.equal(receipt.recordedAt, now - 5000);
    assert.equal(Number.isSafeInteger(receipt.executedAt), true);
    assert.ok(!JSON.stringify(receipt).includes(SECRET));
    assert.doesNotMatch(JSON.stringify(receipt), /bookmark|password|hash|MAO-/);
    assert.match(key, /^founder-checkpoint:/);
  }
  assert.equal(receipts.has('founder-checkpoint:success'), true);
});

test('missing private receipt binding blocks scheduled access to the live DO', async () => {
  const { env, calls } = setup();
  let scheduled;
  await operator.scheduled({}, env, { waitUntil(promise) { scheduled = promise; } });
  await assert.rejects(scheduled, /private_checkpoint_receipt_binding_required/);
  assert.equal(calls.length, 0);
});

test('failed scheduled check persists only sanitized failure receipt', async () => {
  const { env, calls } = setup();
  const receipts = new Map();
  env.FOUNDER_RUN_ENABLED = undefined;
  env.RELEASE_AUDIT = {
    async put(key, value) { receipts.set(key, JSON.parse(value)); }
  };
  let scheduled;
  await operator.scheduled({}, env, { waitUntil(promise) { scheduled = promise; } });
  await assert.rejects(scheduled, /private_checkpoint_disabled/);
  assert.equal(calls.length, 0);
  assert.deepEqual(receipts.get('founder-checkpoint:last-attempt')?.code, 'disabled');
  assert.equal(receipts.has('founder-checkpoint:success'), false);
});

test('prewarmed Cron reads short private KV window without deploying new secrets', async () => {
  const { env, calls, setResponse } = setup();
  const now=Date.now();
  env.FOUNDER_RUN_ENABLED=undefined;
  env.FOUNDER_RUN_NOT_BEFORE_MS=undefined;
  env.FOUNDER_RUN_NOT_AFTER_MS=undefined;
  setResponse(Response.json({ok:true,recorded:true,recordedAt:now-100}));
  const receipts=new Map();
  env.RELEASE_AUDIT={
    async get(key, options) {
      assert.equal(key,'founder-checkpoint:activation');
      assert.equal(options.type,'json');
      return {v:1,target:'mao-auth-preview',origin:'https://mao520.com',
        mode:'acknowledge-single-use-live-checkpoint',
        from:String(now-1000),until:String(now+60000)};
    },
    async put(key, value) { receipts.set(key,JSON.parse(value)); }
  };
  let pending;
  await operator.scheduled({},env,{waitUntil(p){pending=p;}});
  await pending;
  assert.equal(calls.some(c=>c[0]==='fetch'),true);
  assert.equal(receipts.get('founder-checkpoint:success')?.ok,true);
});

test('KV activation for another domain or an expired window cannot contact live DO', async () => {
  for(const mutate of [
    x=>{x.origin='https://app.mao520.com';},
    x=>{x.target='mao';},
    x=>{x.mode='elevate-admin';},
    x=>{x.until=String(Date.now()-1000);},
    x=>{x.until=String(Date.now()+300000);}
  ]) {
    const {env,calls}=setup();
    env.FOUNDER_RUN_ENABLED=undefined;
    env.FOUNDER_RUN_NOT_BEFORE_MS=undefined;
    env.FOUNDER_RUN_NOT_AFTER_MS=undefined;
    const now=Date.now();
    const metadata={v:1,target:'mao-auth-preview',origin:'https://mao520.com',
      mode:'acknowledge-single-use-live-checkpoint',from:String(now-1000),until:String(now+60000)};
    mutate(metadata);
    env.RELEASE_AUDIT={
      async get(){return metadata;},
      async put(){}
    };
    let pending;
    await operator.scheduled({},env,{waitUntil(p){pending=p;}});
    await assert.rejects(pending,/private_checkpoint_(disabled|window_closed)/);
    assert.equal(calls.length,0);
  }
});
