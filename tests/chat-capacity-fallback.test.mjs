import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/phone_stream.js', import.meta.url), 'utf8');
const capacity = () => Response.json({ error: { message: 'No capacity available for model gemini-3-flash on the server' } }, { status: 503 });
const reply = () => new Response('data: {"choices":[{"delta":{"content":"在看书。"}}]}\n\ndata: [DONE]\n\n');

function scenario(responses) {
    const requests = [];
    const window = {};
    runInNewContext(source, {
        window, AbortController, TextDecoder, setTimeout, clearTimeout,
        requestAnimationFrame: queueMicrotask,
        fetch: async (url, request) => {
            requests.push({ url, body: JSON.parse(request.body) });
            return responses[requests.length - 1]();
        }
    });
    const messages = [
        { role: 'system', content: '角色「测试一号」\n世界书：带 $& 和 {{char}}' },
        { role: 'user', content: [{ type: 'text', text: '在做什么？' }] }
    ];
    const send = overrides => window.PhoneStream.chat({
        baseUrl: 'https://example.test/v1', apiKey: 'fixture',
        model: 'gemini-3-flash', fallbackModels: ['backup', 'last'],
        messages, ...overrides
    });
    return { requests, messages, send };
}

test('503 switches models without changing any other request field', async () => {
    const flow = scenario([capacity, reply]);
    const expected = structuredClone(flow.messages);
    const pending = flow.send({ maxTokens: 512 });
    flow.messages[0].content = '另一角色';
    flow.messages[1].content[0].text = 'changed';
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.fullText, '在看书。');
    const [primary, fallback] = flow.requests;
    assert.equal(primary.url, fallback.url);
    assert.deepEqual(primary.body.messages, expected);
    assert.deepEqual(fallback.body, { ...primary.body, model: 'backup' });
});

test('capacity before any SSE delta can fall back', async () => {
    const flow = scenario([() => new Response('data: {"error":{"message":"No capacity available"}}\n\n'), reply]);
    assert.equal((await flow.send()).ok, true);
    assert.equal(flow.requests.length, 2);
});

test('all attempts exhausted hide raw provider errors and leave no answer', async () => {
    const flow = scenario([capacity, capacity, capacity]);
    const result = await flow.send();
    assert.equal(result.ok, false);
    assert.equal(result.fullText, '');
    assert.equal(result.error.kind, 'capacity');
    assert.equal(result.error.detail, undefined);
    assert.equal(flow.requests.length, 3);
});

test('missing role system or primary authentication failure never triggers backup', async () => {
    const missing = scenario([capacity]);
    assert.equal((await missing.send({ messages: [{ role: 'user', content: 'hello' }] })).error.kind, 'capacity');
    assert.equal(missing.requests.length, 1);
    const denied = scenario([() => new Response('Unauthorized', { status: 401 })]);
    assert.equal((await denied.send()).error.status, 401);
    assert.equal(denied.requests.length, 1);
});

test('backup interrupted mid-reply does not paint or publish partial text', async () => {
    const flow = scenario([capacity, () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')]);
    const paints = [];
    const result = await flow.send({ onPaint: text => paints.push(text) });
    assert.equal(result.error.kind, 'capacity');
    assert.equal(result.fullText, '');
    assert.deepEqual(paints, []);
});
