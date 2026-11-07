import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8');

function loadApi(fetchImpl) {
  const context = {
    PhoneStorage: {
      getApiConfig() {
        return { apiKey: 'test-key', baseUrl: 'https://api.example/v1', model: 'test-model' };
      },
      pushApiLog() {}
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    JSON,
    String,
    Array,
    Object,
    Error,
    console: { warn() {} },
    fetch: fetchImpl
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return context;
}

test('PhoneAPI forwards caller AbortSignal and preserves cancellation instead of reporting timeout', async () => {
  let requestSignal = null;
  const context = loadApi(async (url, options) => {
    requestSignal = options.signal;
    return new Promise((resolve, reject) => {
      requestSignal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });
  const caller = new AbortController();
  const pending = context.PhoneAPI.complete({
    messages: [{ role: 'user', content: 'test' }],
    timeoutMs: 60000,
    signal: caller.signal
  });

  assert.ok(requestSignal, 'the network request should be started');
  caller.abort();
  await assert.rejects(pending, error => error && error.name === 'AbortError' && error.message === '请求已取消');
  assert.equal(context.PhoneAPI.supportsAbortSignal, true);
});

test('PhoneAPI does not start a network request when the caller signal is already aborted', async () => {
  let calls = 0;
  const context = loadApi(async () => {
    calls += 1;
    throw new Error('unexpected fetch');
  });
  const caller = new AbortController();
  caller.abort();

  await assert.rejects(
    context.PhoneAPI.complete({ signal: caller.signal }),
    error => error && error.name === 'AbortError' && error.message === '请求已取消'
  );
  assert.equal(calls, 0);
});

test('PhoneAPI timeout remains distinguishable from caller cancellation', async () => {
  const context = loadApi(async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));

  await assert.rejects(
    context.PhoneAPI.complete({ timeoutMs: 5 }),
    /请求超时（5ms）/
  );
});
