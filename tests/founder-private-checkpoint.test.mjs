import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {
  FOUNDER_CHECKPOINT_PATH,
  handleFounderCheckpointInternal
} from '../worker/lib/founder-recovery-operator.js';

const SECRET = 'P'.repeat(64);
const CHECKPOINT_KEY = 'release:founder-cutover:checkpoint';
const internalUrl = 'https://maomao.internal' + FOUNDER_CHECKPOINT_PATH;
const request = (token = SECRET, url = internalUrl, method = 'POST') =>
  new Request(url, { method, headers: { 'x-maomao-release-secret': token } });

function createStorage({ fail = false } = {}) {
  const values = new Map();
  const calls = { bookmark: 0, put: 0, sync: 0 };
  const storage = {
    async getCurrentBookmark() {
      calls.bookmark++;
      if (fail) throw new Error('sensitive live DO diagnostic');
      return '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
    },
    async get(key) { return values.get(key); },
    async put(key, value) { calls.put++; values.set(key, structuredClone(value)); },
    async sync() { calls.sync++; }
  };
  return { storage, calls, values };
}

const invoke = (requestValue, storage, env = { FOUNDER_RELEASE_OPERATOR_SECRET: SECRET }) =>
  handleFounderCheckpointInternal({ request: requestValue, env, storage, now: () => 1000 });

test('checkpoint capability is disabled without a separately configured operator secret', async () => {
  for (const env of [{}, { FOUNDER_RELEASE_OPERATOR_SECRET: 'short' }, { FOUNDER_RELEASE_OPERATOR_SECRET: 'S'.repeat(300) }]) {
    const { storage, calls } = createStorage();
    const result = await invoke(request(), storage, env);
    assert.equal(result.status, 404);
    assert.equal(calls.bookmark, 0);
    assert.equal(calls.put, 0);
  }
});

test('internal host, route, POST and dedicated secret are all mandatory', async () => {
  for (const r of [
    request('not-the-secret'),
    request(SECRET, 'https://mao520.com' + FOUNDER_CHECKPOINT_PATH),
    request(SECRET, 'http://maomao.internal' + FOUNDER_CHECKPOINT_PATH),
    request(SECRET, 'https://maomao.internal/internal/tick'),
    request(SECRET, internalUrl, 'GET')
  ]) {
    const { storage, calls } = createStorage();
    const result = await invoke(r, storage);
    assert.ok([403, 404].includes(result.status));
    assert.equal(calls.bookmark, 0);
    assert.equal(calls.put, 0);
  }
});

test('authorized private binding records a bookmark but never returns it to the caller', async () => {
  const { storage, calls, values } = createStorage();
  const result = await invoke(request(), storage);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { ok: true, recorded: true, recordedAt: 1000 });
  assert.equal(calls.bookmark, 1);
  assert.equal(calls.put, 1);
  assert.equal(calls.sync, 1);
  assert.ok(values.get(CHECKPOINT_KEY)?.bookmark);
  const responseBody = await invoke(request(), createStorage().storage).then(r => r.text());
  assert.ok(!responseBody.includes(values.get(CHECKPOINT_KEY).bookmark));
  assert.ok(!responseBody.includes(SECRET));
});

test('failed bookmark acquisition returns only a fixed error without leaking storage exceptions', async () => {
  const { storage, calls } = createStorage({ fail: true });
  const result = await invoke(request(), storage);
  assert.equal(result.status, 503);
  const body = await result.text();
  assert.match(body, /checkpoint_unavailable/);
  assert.doesNotMatch(body, /sensitive|diagnostic|bookmark.*00000/);
  assert.equal(calls.bookmark, 1);
  assert.equal(calls.put, 0);
});

test('public Worker never forwards /internal/release/checkpoint to the Durable Object', async () => {
  let forwarded = 0;
  const env = {
    CLOUD_DB: { idFromName: value => value, get: () => ({ async fetch() { forwarded++; return Response.json({ ok: true }); } }) },
    ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
    FOUNDER_RELEASE_OPERATOR_SECRET: SECRET
  };
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(
      new Request('https://app.mao520.com' + FOUNDER_CHECKPOINT_PATH, { method, headers: { 'x-maomao-release-secret': SECRET } }),
      env
    );
    assert.equal(response.status, 404);
    assert.equal(forwarded, 0);
  }
});
