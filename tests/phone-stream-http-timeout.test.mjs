import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/phone_stream.js', import.meta.url), 'utf8');

test('an unfinished HTTP error body times out and a subsequent request can succeed', {
    timeout: 5000
}, async () => {
    const server = createServer((req, res) => {
        req.resume();
        if (req.url === '/stall/chat/completions') {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.write('{"error":');
            return;
        }
        if (req.url === '/denied/chat/completions') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'test key rejected' } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"回复成功"}}]}\n\ndata: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const window = {};
    runInNewContext(source, {
        window, fetch, AbortController, TextDecoder, setTimeout, clearTimeout,
        requestAnimationFrame: callback => setTimeout(callback, 0)
    });
    const { port } = server.address();
    const chat = path => window.PhoneStream.chat({
        apiKey: 'test', baseUrl: `http://127.0.0.1:${port}/${path}`,
        connectMs: 2000, watchdogMs: 100, totalMs: 2000
    });
    let deadline;
    try {
        const timedOut = await Promise.race([
            chat('stall'),
            new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('HTTP error body did not time out')), 1500);
            })
        ]);
        assert.equal(timedOut.ok, false);
        assert.equal(timedOut.error.kind, 'abort');
        assert.equal(timedOut.error.reason, 'watchdog');

        const denied = await chat('denied');
        assert.equal(denied.error.kind, 'http');
        assert.equal(denied.error.status, 401);
        assert.equal(denied.error.detail, 'test key rejected');

        const recovered = await chat('ok');
        assert.equal(recovered.ok, true);
        assert.equal(recovered.fullText, '回复成功');
    } finally {
        clearTimeout(deadline);
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
