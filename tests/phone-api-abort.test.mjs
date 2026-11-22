import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8');

function mount(fetchImpl) {
  const logs = [];
  const window = {
    PhoneStorage: {
      getApiConfig: () => ({ apiKey: 'fixture-only-key', baseUrl: 'https://example.invalid/v1', model: 'mock-model' }),
      pushApiLog: event => logs.push(event)
    }
  };
  vm.runInNewContext(source, {
    window, fetch: fetchImpl, AbortController, setTimeout, clearTimeout,
    console, Date, Math
  });
  return { api: window.PhoneAPI, logs };
}

function abortException() {
  const error = new Error('browser aborted fetch');
  error.name = 'AbortError';
  return error;
}

test('optional AbortSignal cancels an outstanding request with a distinct cancellation reason', async () => {
  let entered = false;
  const app = mount((_url, options) => new Promise((_resolve, reject) => {
    entered = true;
    if (options.signal.aborted) return reject(abortException());
    options.signal.addEventListener('abort', () => reject(abortException()), { once: true });
  }));
  const controller = new AbortController();
  const task = app.api.completeJSON({
    system: 'side story', user: 'continue', timeoutMs: 60000, signal: controller.signal
  });
  assert.equal(entered, true);
  controller.abort();
  await assert.rejects(task, error => error.name === 'AbortError' && /请求已取消/.test(error.message));
  assert.ok(app.logs.some(log => log.status === 'error' && /请求已取消/.test(log.errorMsg)));
});

test('legacy callers without a signal still receive their normal parsed JSON response', async () => {
  const app = mount(async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.signal.aborted, false);
    return { ok: true, json: async () => ({
      choices: [{ message: { content: '{"messages":[{"role":"char","text":"hello"}]}' } }]
    }) };
  });
  const result = await app.api.completeJSON({ system: 'original', user: 'message', timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.data.messages[0].text, 'hello');
  assert.ok(app.logs.some(log => log.status === 'success'));
});

test('internal timeout is still reported as timeout rather than user cancellation', async () => {
  const app = mount((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(abortException()), { once: true });
  }));
  await assert.rejects(
    app.api.complete({ system: 'timeout-test', user: 'ping', timeoutMs: 7 }),
    /请求超时/
  );
});
