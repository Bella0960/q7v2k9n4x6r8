/*
 * Real Chromium two-tab Web Locks regression for chat-history-atomic.js.
 * This test uses only synthetic messages on a private localhost server.
 * It does not load MAOMAO accounts, API keys, workers or production data.
 *
 * Usage: node tests/chat-history-atomic-browser.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'shared/js/phone/chat-history-atomic.js');
const server = createServer((_request, response) => {
    response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end('<!doctype html><meta charset="utf-8"><title>Chat history locking smoke</title>');
});

let browser;
let pageA;
let pageB;
try {
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    const base = 'http://127.0.0.1:' + address.port + '/';

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    pageA = await context.newPage();
    pageB = await context.newPage();
    await Promise.all([pageA.goto(base), pageB.goto(base)]);
    await Promise.all([pageA.addScriptTag({ path: sourcePath }), pageB.addScriptTag({ path: sourcePath })]);

    const webLocksAvailable = await pageA.evaluate(() => !!(navigator.locks && navigator.locks.request));
    assert.equal(webLocksAvailable, true, 'Chromium localhost must expose Web Locks');

    const original = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'original-' + i, type: i % 2 ? 'image' : 'text',
        assetId: i % 2 ? 'asset-' + i : undefined,
        mode: i % 3 ? 'online' : 'date',
        metadata: { index: i }
    }));
    await pageA.evaluate(items => {
        localStorage.setItem('chat_history_test-role', JSON.stringify(items));
    }, original);

    // Both operations run against the same origin and lock name, on separate
    // JS realms. Neither may silently replace the other's appended bubbles.
    const results = await Promise.all([
        pageA.evaluate(() => ChatHistoryAtomic.appendManyIf('test-role', [
            { mid: 'a-1', role: 'user', text: 'hello' },
            { mid: 'a-2', role: 'assistant', text: 'reply' }
        ])),
        pageB.evaluate(() => ChatHistoryAtomic.appendIf('test-role', {
            mid: 'b-1', role: 'assistant', text: 'automatic follow-up'
        }))
    ]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);
    let history = await pageA.evaluate(() => JSON.parse(localStorage.getItem('chat_history_test-role')));
    assert.equal(history.length, 2003);
    assert.deepEqual(history.slice(0, 2000), JSON.parse(JSON.stringify(original)));
    assert.deepEqual(new Set(history.slice(-3).map(m => m.mid)), new Set(['a-1', 'a-2', 'b-1']));

    // A delayed editor from tab A must fail after tab B changed the history.
    const staleSnapshot = history;
    const append = await pageB.evaluate(() => ChatHistoryAtomic.appendIf('test-role', {
        mid: 'b-2', text: 'arrived before old edit'
    }));
    assert.equal(append.ok, true);
    const staleEdit = await pageA.evaluate(old => ChatHistoryAtomic.replaceIfUnchanged(
        'test-role', old, old.slice(0, -1)), staleSnapshot);
    assert.equal(staleEdit.ok, false);
    assert.equal(staleEdit.error.code, 'CONFLICT');
    history = await pageB.evaluate(() => JSON.parse(localStorage.getItem('chat_history_test-role')));
    assert.equal(history.length, 2004);
    assert.equal(history.at(-1).mid, 'b-2');

    // Replaying the same mid is a no-op, not a duplicate.
    const duplicate = await pageA.evaluate(() => ChatHistoryAtomic.appendIf('test-role', {
        mid: 'b-2', text: 'arrived before old edit'
    }));
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.meta.alreadyPersisted, true);
    assert.equal(await pageB.evaluate(() => JSON.parse(localStorage.getItem('chat_history_test-role')).length), 2004);

    // Corrupt primary remains byte-for-byte preserved after the failed write.
    await pageA.evaluate(() => localStorage.setItem('chat_history_corrupt-role', '{invalid-json'));
    const corrupt = await pageB.evaluate(() => ChatHistoryAtomic.appendIf('corrupt-role', { mid: 'x' }));
    assert.equal(corrupt.error.code, 'CORRUPT_DATA');
    assert.equal(await pageA.evaluate(() => localStorage.getItem('chat_history_corrupt-role')), '{invalid-json');

    const result = {
        browser: 'Chromium',
        tabs: 2,
        syntheticHistory: original.length,
        persistedMessages: history.length,
        scenarios: ['concurrent batch+single append', 'stale edit rejection', 'same-mid retry', 'corrupt data protection'],
        externalApiCalls: 0
    };
    console.log('PASS', JSON.stringify(result));
} finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
}
