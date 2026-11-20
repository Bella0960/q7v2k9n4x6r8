import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const monitorSource = read('shared/js/phone/phone_api_monitor.js');
const streamSource = read('shared/js/phone/phone_stream.js');
const enabledKey = 'phone_api_monitor_enabled_v1';
const ledgerKey = 'phone_api_monitor_ledger_v1';

function runtime(fetch) {
    const entries = new Map();
    const window = {
        location: { href: 'https://example.test/' },
        localStorage: {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => entries.set(key, value)
        }
    };
    const context = { window, URL, AbortController, TextDecoder, fetch, setTimeout, clearTimeout, requestAnimationFrame: queueMicrotask };
    runInNewContext(monitorSource, context);
    runInNewContext(streamSource, context);
    return { window, entries };
}

test('monitor disabled by default, then counts every fallback attempt without logging contents', async () => {
    let attempts = 0;
    const success = () => new Response('data: {"choices":[{"delta":{"content":"secret reply"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":7}}\n\ndata: [DONE]\n');
    const { window, entries } = runtime(async () => ++attempts === 2
        ? new Response('No capacity available', { status: 503 })
        : success());
    const request = {
        baseUrl: 'https://user:password@example.test/private-token/v1',
        apiKey: 'api-secret',
        model: 'primary',
        fallbackModels: ['backup'],
        messages: [{ role: 'system', content: 'secret persona' }]
    };
    assert.equal((await window.PhoneStream.chat(request)).ok, true);
    assert.equal(entries.has(ledgerKey), false);
    entries.set(enabledKey, '1');
    assert.equal((await window.PhoneStream.chat(request)).ok, true);
    const raw = entries.get(ledgerKey);
    const data = JSON.parse(raw);
    assert.deepEqual([data.requests, data.input, data.output, data.estimated], [2, 12, 7, false]);
    assert.deepEqual(data.logs.map(log => log.code), ['503', 'OK']);
    assert.equal(data.logs[0].url, 'https://example.test/…/v1/chat/completions');
    assert.doesNotMatch(raw, /password|private-token|api-secret|secret persona|secret reply/);
});

test('latest 50 entries, sanitized connection and timeout errors, and cumulative totals', () => {
    const { window, entries } = runtime();
    entries.set(enabledKey, '1');
    const monitor = window.PhoneApiMonitor;
    for (let index = 0; index < 55; index++) {
        monitor.record('https://example.test/v1/chat/completions?token=hidden', [{ content: '你好' }], '好', null);
    }
    monitor.record('https://example.test/', [], '', { kind: 'network', detail: 'Failed to fetch private detail' });
    monitor.record('https://example.test/', [], '', { kind: 'abort', reason: 'watchdog' });
    const raw = entries.get(ledgerKey);
    const data = JSON.parse(raw);
    assert.equal(data.logs.length, 50);
    assert.deepEqual(data.logs.slice(-2).map(log => log.code), ['连接失败', '响应超时']);
    assert.deepEqual([data.requests, data.input, data.output, data.estimated], [57, 275, 55, true]);
    assert.doesNotMatch(raw, /hidden|private detail/);
});

test('storage failure does not change a successful chat result', async () => {
    const { window, entries } = runtime(async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n'));
    entries.set(enabledKey, '1');
    window.localStorage.setItem = () => { throw new Error('storage full'); };
    const result = await window.PhoneStream.chat({ baseUrl: 'https://example.test', apiKey: 'fixture' });
    assert.equal(result.ok, true);
    assert.equal(result.fullText, 'ok');
});

test('mobile monitor supports switch, drag, copy, clear, and close', async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
        await page.route('https://monitor.test/', route => route.fulfill({
            contentType: 'text/html',
            body: '<meta name="viewport" content="width=device-width, initial-scale=1"><label>显示系统监控悬浮球<input id="phone-api-monitor-toggle" role="switch" type="checkbox"></label>'
        }));
        await page.goto('https://monitor.test/');
        await page.addStyleTag({ content: read('shared/css/phone-api-monitor.css') });
        await page.addScriptTag({ content: monitorSource });
        const ball = page.getByRole('button', { name: '打开 Token 与 API 监控' });
        assert.equal(await ball.isVisible(), false);
        await page.getByRole('switch').check();
        const rect = await ball.boundingBox();
        await page.mouse.move(rect.x + 15, rect.y + 15);
        await page.mouse.down();
        await page.mouse.move(rect.x - 90, rect.y + 55, { steps: 4 });
        await page.mouse.up();
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.isVisible(), false);
        assert.ok((await ball.boundingBox()).x < rect.x - 50);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: value => { window.copied = value; } } });
            window.PhoneApiMonitor.record('https://example.test/v1/chat/completions', [], '', { kind: 'http', status: 503 });
        });
        await ball.tap();
        assert.equal(await dialog.isVisible(), true);
        assert.match(await dialog.locator('li.is-error').innerText(), /503 - https:\/\/example\.test/);
        await dialog.getByRole('button', { name: '复制全部报错日志' }).tap();
        assert.match(await page.evaluate(() => window.copied), /503 - https:\/\/example\.test/);
        await dialog.getByRole('button', { name: '清空日志' }).tap();
        assert.equal(await dialog.locator('[data-count="requests"]').innerText(), '0');
        await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
        assert.equal(await dialog.isVisible(), false);
    } finally {
        await browser.close();
    }
});
