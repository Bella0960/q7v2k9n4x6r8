import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8');

function harness(config = {}) {
  const logs = [], observations = [], diagnostics = [], requests = [];
  const timers = new Map();
  let nextTimer = 0, response;
  class Signal {
    constructor() { this.aborted = false; this.listeners = new Set(); }
    addEventListener(type, fn) { if (type === 'abort') this.listeners.add(fn); }
    removeEventListener(type, fn) { if (type === 'abort') this.listeners.delete(fn); }
  }
  class Controller {
    constructor() { this.signal = new Signal(); }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      for (const fn of [...this.signal.listeners]) fn();
    }
  }
  const window = {
    PhoneStorage: {
      getApiConfig: () => ({ apiKey: 'fake-key', model: 'mock', baseUrl: 'https://example.invalid/v1/chat/completions', ...config }),
      pushApiLog: entry => logs.push(entry)
    },
    PhoneApiMonitor: { begin: () => ({}), complete: (...args) => observations.push(args) }
  };
  new Function('window', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', source)(
    window,
    (url, opts) => { requests.push({ url, opts }); return Promise.resolve(response(opts.signal)); },
    fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    id => timers.delete(id), Controller
  );
  return {
    api: window.PhoneAPI, logs, observations, diagnostics, requests, timers, Controller,
    setResponse: fn => { response = fn; },
    options: { user: 'fixture only', onDiagnostic: event => diagnostics.push(event) }
  };
}

const good = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 3 } }) });
const stalled = signal => new Promise((resolve, reject) => {
  const error = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
  if (signal.aborted) error();
  else signal.addEventListener('abort', error);
});
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test('HTTP failure logs exactly once and does not persist provider body', async () => {
  const h = harness();
  h.setResponse(() => ({ ok: false, status: 429, text: async () => 'fixture private body' }));
  await assert.rejects(h.api.complete({ user: 'fixture' }), e => e.status === 429 && e.message.includes('fixture private body'));
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].status, 'error');
  assert.equal(h.logs[0].errorMsg, 'HTTP 429');
  assert.equal(h.observations.length, 1);
  assert.equal(h.timers.size, 0);
});

test('invalid JSON preserves the result contract and records one failed outcome', async () => {
  const h = harness();
  h.setResponse(() => good('not JSON'));
  const value = await h.api.completeJSON(h.options);
  assert.equal(value.ok, false);
  assert.equal(value.data, null);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].status, 'error');
  assert.equal(h.diagnostics.filter(d => d.stage === 'parse').length, 1);
  assert.equal(h.observations.length, 1);
  assert.equal(h.requests.length, 1);
});

test('valid JSON and completeBundle preserve their result and count one request each', async () => {
  const h = harness();
  h.setResponse(() => good('{"value":7}'));
  assert.equal((await h.api.completeJSON(h.options)).data.value, 7);
  assert.equal((await h.api.completeBundle(h.options)).data.value, 7);
  assert.equal(h.logs.length, 2);
  assert.equal(h.logs.every(l => l.status === 'success'), true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.observations.length, 2);
  assert.equal(h.timers.size, 0);
});

test('plain content arrays, usage monitoring and full endpoint compatibility remain intact', async () => {
  const h = harness();
  h.setResponse(() => good([{ text: 'a' }, { text: 'b' }]));
  assert.equal(await h.api.complete(h.options), 'ab');
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].status, 'success');
  assert.equal(h.requests[0].url, 'https://example.invalid/v1/chat/completions');
  assert.equal(h.observations[0][4].prompt_tokens, 3);
});

for (const ok of [true, false]) {
  test('body stall after ' + (ok ? 'success' : 'error') + ' headers retains timeout', async () => {
    const h = harness();
    h.setResponse(signal => ({ ok, status: ok ? 200 : 503, json: () => stalled(signal), text: () => stalled(signal) }));
    const pending = h.api.complete({ ...h.options, timeoutMs: 10 });
    await flush();
    assert.equal(h.timers.size, 1);
    const rejected = assert.rejects(pending, /请求超时/);
    for (const fire of h.timers.values()) fire();
    await rejected;
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].status, 'error');
    assert.equal(h.timers.size, 0);
  });
}

test('caller cancellation is preserved and removes listeners', async () => {
  const h = harness();
  const caller = new h.Controller();
  h.setResponse(signal => ({ ok: true, json: () => stalled(signal) }));
  const pending = h.api.completeJSON({ ...h.options, signal: caller.signal });
  await flush();
  const rejected = assert.rejects(pending, e => e.name === 'AbortError');
  caller.abort();
  await rejected;
  assert.equal(h.api.supportsAbortSignal, true);
  assert.equal(caller.signal.listeners.size, 0);
  assert.equal(h.logs.length, 1);
  assert.equal(h.timers.size, 0);
});

test('missing key records zero duration and never calls provider', async () => {
  const h = harness({ apiKey: '' });
  await assert.rejects(h.api.complete(h.options), /未配置 API Key/);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].duration, 0);
  assert.equal(h.requests.length, 0);
});
