import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve('settings/js/api-image-connection-test.js'), 'utf8');

function harness(options = {}) {
  const nodes = {};
  for (const [id, value] of Object.entries({
    'api-key': 'mock-key', 'api-url': 'https://images.example/v1',
    'api-image-model': 'image-test-model', 'api-image-endpoint': ''
  })) nodes[id] = { value, style: {}, addEventListener() {} };
  for (const id of ['image-test-msg', 'btn-test-image-connection', 'image-test-preview']) {
    nodes[id] = {
      textContent: '', style: {}, hidden: true, disabled: false, naturalWidth: 2,
      addEventListener() {}, removeAttribute(attr) { delete this[attr]; },
      async decode() { if (options.decodeFails) throw Error('bad image bytes'); }
    };
  }
  for (const [key, value] of Object.entries(options.fields || {})) nodes[key].value = value;
  const calls = [], stored = new Map();
  class TestURL extends URL {}
  TestURL.createObjectURL = () => 'blob:mock-test-image';
  TestURL.revokeObjectURL = () => {};
  const win = {
    document: { readyState: 'complete', getElementById: id => nodes[id] || null },
    URL: TestURL, Blob, atob: v => Buffer.from(v, 'base64').toString('binary'),
    setTimeout, clearTimeout, addEventListener() {},
    confirm: () => options.confirm !== false,
    localStorage: {
      getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, value)
    },
    async fetch(url, options = {}) {
      calls.push({ url, options });
      if (typeof harness.fetch === 'function') return harness.fetch(url, options);
      return {
        ok: true, status: 200,
        json: async () => ({
          data: [{ b64_json: Buffer.from('stub-image').toString('base64'), mime_type: 'image/png' }]
        })
      };
    }
  };
  if (options.fetch) harness.fetch = options.fetch;
  else delete harness.fetch;
  runInNewContext(source, { window: win, AbortController, Uint8Array, Date, Promise,
    setTimeout, clearTimeout, console });
  return { nodes, calls, stored, api: win.PhoneImageConnectionTest };
}

test('preflight missing model or user cancellation produces zero provider calls', async () => {
  const a = harness({ fields: { 'api-image-model': '' } });
  await a.api.test();
  assert.equal(a.calls.length, 0);
  const b = harness({ confirm: false });
  await b.api.test();
  assert.equal(b.calls.length, 0);
});

test('a valid Base64 response is decoded before a success receipt is written', async () => {
  const h = harness();
  await h.api.test();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://images.example/v1/images/generations');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {
    model: 'image-test-model', n: 1, size: '1024x1024',
    prompt: 'A simple black line drawing of a single leaf on a plain white background.'
  });
  assert.match(h.nodes['image-test-msg'].textContent, /图片连接成功/);
  assert.equal(h.nodes['image-test-preview'].hidden, false);
  assert.ok(h.stored.has('api_image_connection_success_v1'));
  assert.ok(!JSON.stringify([...h.stored]).includes('mock-key'));
});

test('HTTP 200 without an image fails closed and does not save success', async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ data: [] }) }) });
  await h.api.test();
  assert.equal(h.calls.length, 1);
  assert.match(h.nodes['image-test-msg'].textContent, /未通过/);
  assert.equal(h.stored.size, 0);
});

test('provider HTTP 429 and invalid image bytes are not retried', async () => {
  const rate = harness({ fetch: async () => ({ ok: false, status: 429 }) });
  await rate.api.test();
  assert.equal(rate.calls.length, 1);
  assert.match(rate.nodes['image-test-msg'].textContent, /429/);
  const invalid = harness({ decodeFails: true });
  await invalid.api.test();
  assert.equal(invalid.calls.length, 1);
  assert.match(invalid.nodes['image-test-msg'].textContent, /未通过/);
  assert.equal(invalid.stored.size, 0);
});

test('external image URL fetch does not forward the provider API Key', async () => {
  const h = harness({ fetch: async (url) => (
    url.includes('images/generations')
      ? { ok: true, json: async () => ({ data: [{ url: 'https://cdn.example/generated.png' }] }) }
      : { ok: true, blob: async () => new Blob(['fake-data'], { type: 'image/png' }) }
  ) });
  await h.api.test();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, 'https://cdn.example/generated.png');
  assert.equal(h.calls[1].options.headers, undefined);
  assert.match(h.nodes['image-test-msg'].textContent, /图片连接成功/);
});

test('double-click during one in-flight request is ignored', async () => {
  let release;
  const h = harness({ fetch: () => new Promise(resolve => { release = resolve; }) });
  const first = h.api.test();
  const second = h.api.test();
  assert.equal(h.calls.length, 1);
  release({ ok: true, json: async () => ({
    data: [{ b64_json: Buffer.from('sample').toString('base64'), mime_type: 'image/png' }]
  }) });
  await Promise.all([first, second]);
  assert.equal(h.calls.length, 1);
});

test('custom endpoint and already-suffixed base URL do not append duplicate endpoints', async () => {
  const custom = harness({ fields: { 'api-image-endpoint': 'https://other.example/images/generations' } });
  await custom.api.test();
  assert.equal(custom.calls[0].url, 'https://other.example/images/generations');
  const suffixed = harness({ fields: { 'api-url': 'https://images.example/v1/images/generations' } });
  await suffixed.api.test();
  assert.equal(suffixed.calls[0].url, 'https://images.example/v1/images/generations');
});
