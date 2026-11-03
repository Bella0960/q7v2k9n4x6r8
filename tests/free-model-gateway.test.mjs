import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../.cloudflare/worker.js';

function request(path, options = {}) {
  return new Request('https://maomao.example' + path, options);
}

function env(overrides = {}) {
  return {
    GATEWAY_API_KEY: 'gateway-secret',
    FREE_GROQ_API_KEY: 'groq-secret',
    ASSETS: {
      fetch: async () => new Response('static asset', { status: 200 })
    },
    ...overrides
  };
}

test('GET /v1/models returns only providers with configured keys', async () => {
  const response = await gateway.fetch(request('/v1/models', {
    headers: { Authorization: 'Bearer gateway-secret' }
  }), env());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, 'list');
  assert.equal(body.data.length, 6);
  assert.ok(body.data.every(item => item.id.startsWith('maomao-free:groq:')));
  assert.equal(body.data[0].owned_by, 'groq');
});

test('the gateway rejects requests without the single gateway key', async () => {
  const response = await gateway.fetch(request('/v1/models'), env());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.type, 'authentication_error');
});

test('the gateway reports missing master-key configuration instead of becoming an open proxy', async () => {
  const response = await gateway.fetch(request('/v1/models'), env({ GATEWAY_API_KEY: '' }));
  assert.equal(response.status, 503);
});

test('unknown or unapproved model IDs are rejected before any upstream request', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };

  try {
    const response = await gateway.fetch(request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer gateway-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }]
      })
    }), env());

    assert.equal(response.status, 404);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat completions are routed to the selected provider with its own secret', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = {
      url: String(url),
      authorization: new Headers(init.headers).get('Authorization'),
      body: JSON.parse(init.body)
    };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const response = await gateway.fetch(request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer gateway-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'maomao-free:groq:openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'hello' }]
      })
    }), env());

    assert.equal(response.status, 200);
    assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer groq-secret');
    assert.equal(captured.body.model, 'openai/gpt-oss-120b');
    assert.equal((await response.json()).choices[0].message.content, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare Workers AI requires both its API token and account ID', async () => {
  const response = await gateway.fetch(request('/v1/models', {
    headers: { Authorization: 'Bearer gateway-secret' }
  }), env({
    FREE_GROQ_API_KEY: '',
    FREE_CLOUDFLARE_API_TOKEN: 'cf-secret',
    FREE_CLOUDFLARE_ACCOUNT_ID: ''
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.length, 0);
});

test('non-API routes continue to use the static asset binding', async () => {
  const response = await gateway.fetch(request('/settings/settings.html'), env());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'static asset');
});

test('CORS preflight is answered without exposing wildcard origins', async () => {
  const response = await gateway.fetch(request('/v1/models', {
    method: 'OPTIONS',
    headers: { Origin: 'https://maomao.example' }
  }), env());

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://maomao.example');
  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
});
