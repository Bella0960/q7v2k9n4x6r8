import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve('shared/js/phone/phone_api.js'), 'utf8');

function loadApi(config, fetchImpl) {
  const logs = [];
  const storage = {
    getApiConfig: () => config,
    pushApiLog: (entry) => logs.push(entry)
  };
  const window = { PhoneStorage: storage, atob, URL, Blob };
  runInNewContext(source, {
    window,
    fetch: fetchImpl,
    URL,
    Blob,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
    console,
    atob
  });
  return { api: window.PhoneAPI, logs };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

test('image generation posts to the configured OpenAI-compatible endpoint and decodes Base64 into an image Blob', async () => {
  const calls = [];
  const { api, logs } = loadApi({
    apiKey: 'test-key',
    baseUrl: 'https://images.example/v1/',
    imageModel: 'image-model-v1'
  }, async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ data: [{ b64_json: Buffer.from('mock-png-bytes').toString('base64'), mime_type: 'image/png' }] });
  });

  const result = await api.generateImage({ prompt: 'A quiet sunlit reading desk', size: '1024x1024' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://images.example/v1/images/generations');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'image-model-v1',
    prompt: 'A quiet sunlit reading desk',
    n: 1,
    size: '1024x1024'
  });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.blob.type, 'image/png');
  assert.equal(result.blob.size, Buffer.byteLength('mock-png-bytes'));
  assert.equal(logs.at(-1).status, 'success');
});

test('image generation downloads URL responses into a Blob without forwarding the API key to the image host', async () => {
  const calls = [];
  const imageBlob = new Blob([Buffer.from('mock-webp-bytes')], { type: 'image/webp' });
  const { api } = loadApi({
    apiKey: 'secret-key',
    baseUrl: 'https://provider.example/v1',
    imageModel: 'image-model-v2'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/images/generations')) {
      return jsonResponse({ data: [{ url: 'https://cdn.example/generated.webp' }] });
    }
    return {
      ok: true,
      blob: async () => imageBlob
    };
  });

  const result = await api.generateImage({ prompt: 'A mountain lake in morning light' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://cdn.example/generated.webp');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.blob.size, imageBlob.size);
});

test('image generation refuses to call the network when no image model is configured', async () => {
  let calls = 0;
  const { api, logs } = loadApi({ apiKey: 'test-key' }, async () => {
    calls += 1;
    return jsonResponse({});
  });

  await assert.rejects(api.generateImage({ prompt: 'A paper boat on water' }), /图片生成模型/);
  assert.equal(calls, 0);
  assert.equal(logs.at(-1).status, 'error');
});

test('image generation reports provider HTTP errors and records them in API logs', async () => {
  const { api, logs } = loadApi({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    imageModel: 'missing-model'
  }, async () => jsonResponse({ error: { message: 'model not available' } }, 404));

  await assert.rejects(api.generateImage({ prompt: 'A quiet garden' }), /HTTP 404/);
  assert.equal(logs.at(-1).status, 'error');
  assert.match(logs.at(-1).errorMsg, /HTTP 404/);
});
