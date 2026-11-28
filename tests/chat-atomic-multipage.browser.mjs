import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const source = fs.readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
// URL.pathname on Windows is "/C:/..."; resolving it as a filesystem path
// produces "C:\C:\..." and every product-file request falls through to the
// fallback HTML. Only scenario 18 navigates to a real chat page, so the
// broken fixture stayed invisible while the injected-module scenarios passed.
const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'checkpoint fixture text' } }] }) + '\n\n');
    const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 10000);
    res.on('close', () => clearTimeout(timer));
    return;
  }
  const file = path.resolve(repo, '.' + url.pathname);
  if (file.startsWith(repo + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(fs.readFileSync(file));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head></head><body>atomic acceptance</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true
});
const context = await browser.newContext();
const a = await context.newPage();
const b = await context.newPage();
const root = 'http://127.0.0.1:' + server.address().port;
let passed = 0;
async function scenario(name, run) {
  // Each fixture starts with new documents, including a fresh coordinator after
  // intentionally uncertain writes. Product code requires that refresh too.
  await Promise.all([a.goto(root), b.goto(root)]);
  await a.evaluate(() => localStorage.clear());
  await a.waitForTimeout(30);
  for (const page of [a, b]) await page.addScriptTag({ content: source });
  await run();
  passed++;
  console.log('PASS', name);
}
const init = (page, role = 'a') => page.evaluate(role => ChatHistoryAtomic.initializeIfAbsent(role, []), role);
const append = (page, mid, text = mid, role = 'a') =>
  page.evaluate(({ role, mid, text }) => ChatHistoryAtomic.appendIf(role, { mid, text }), { role, mid, text });
const history = async (role = 'a') => {
  // Storage events are delivered asynchronously to observing tabs. Inspect the
  // settled disk view, independently of the writer's operation result.
  await a.waitForTimeout(30);
  return a.evaluate(role => JSON.parse(localStorage.getItem('chat_history_' + role)), role);
};
const replace = (page, expected, next) => page.evaluate(({ expected, next }) =>
  ChatHistoryAtomic.replaceIfUnchanged('a', expected, next), { expected, next });
try {
  await scenario('simultaneous distinct appends', async () => {
    await init(a);
    const results = await Promise.all([append(a, 'one'), append(b, 'two')]);
    assert.ok(results.every(x => x.ok));
    assert.equal((await history()).length, 2);
  });
  for (const operation of ['edit', 'delete', 'clear', 'payment status']) {
    await scenario('append races with ' + operation, async () => {
      await init(a); await append(a, 'original');
      const expected = await history();
      const next = operation === 'edit' ? [{ mid: 'original', text: 'edited' }]
        : operation === 'payment status' ? [{ mid: 'original', text: 'original', status: 'received' }] : [];
      const [sent, changed] = await Promise.all([append(a, 'new'), replace(b, expected, next)]);
      assert.ok(sent.ok);
      const found = await history();
      assert.ok(found.some(x => x.mid === 'new'), JSON.stringify({operation,sent,changed,found}));
      assert.equal(found.some(x => x.mid === 'original'),
        changed.ok ? next.length > 0 : true);
      if (!changed.ok) assert.equal(changed.error.code, 'CONFLICT');
    });
  }
  await scenario('same mid identical content is idempotent', async () => {
    await init(a);
    assert.ok((await Promise.all([append(a, 'same'), append(b, 'same')])).every(x => x.ok));
    assert.equal((await history()).length, 1);
  });
  await scenario('same mid different content rejected', async () => {
    await init(a); await append(a, 'same', 'first');
    assert.equal((await append(b, 'same', 'second')).error.code, 'CONFLICT');
    assert.equal((await history())[0].text, 'first');
  });
  await scenario('batch image append preserves concurrent text', async () => {
    await init(a);
    const [batch, text] = await Promise.all([
      a.evaluate(() => ChatHistoryAtomic.appendManyIf('a', [
        { mid: 'image1', type: 'image', assetId: 'fixture1' },
        { mid: 'image2', type: 'image', assetId: 'fixture2' }
      ])), append(b, 'text')
    ]);
    assert.ok(batch.ok && text.ok); assert.equal((await history()).length, 3);
  });
  await scenario('journey and online message share lock and stable stage mid', async () => {
    await init(a);
    const entry = { mid: 'journey:123:0', journeyId: '123', journeyStage: 0, mode: 'journey', text: 'fixture' };
    const results = await Promise.all([
      a.evaluate(entry => ChatHistoryAtomic.appendIf('a', entry), entry), append(b, 'online'),
      b.evaluate(entry => ChatHistoryAtomic.appendIf('a', entry), entry)
    ]);
    assert.ok(results.every(x => x.ok)); assert.equal((await history()).length, 2);
  });
  await scenario('legacy v2 initialization is locked and nondestructive', async () => {
    await a.evaluate(() => localStorage.setItem('phone_data_v2', JSON.stringify({ a: { chat: { history: [{ mid: 'legacy' }] } } })));
    const results = await Promise.all([init(a), init(b)]);
    assert.ok(results.every(x => x.ok)); assert.deepEqual(await history(), [{ mid: 'legacy' }]);
    assert.ok(await a.evaluate(() => localStorage.getItem('phone_data_v2')));
  });
  await scenario('role isolation', async () => {
    await init(a); await init(b, 'b'); await Promise.all([append(a, 'one'), append(b, 'two', 'two', 'b')]);
    assert.deepEqual((await history()).map(x => x.mid), ['one']);
    assert.deepEqual((await history('b')).map(x => x.mid), ['two']);
  });
  await scenario('lock unavailable fails closed', async () => {
    await init(a);
    const result = await b.evaluate(async () => {
      const locks = navigator.locks;
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
      try { return await ChatHistoryAtomic.appendIf('a', { mid: 'lost' }); }
      finally { Object.defineProperty(navigator, 'locks', { value: locks, configurable: true }); }
    });
    assert.equal(result.error.code, 'LOCK_UNAVAILABLE'); assert.deepEqual(await history(), []);
  });
  for (const mode of ['write', 'readback']) {
    await scenario(mode + ' failure reports uncertainty and preserves prior record', async () => {
      await init(a); await append(a, 'old');
      const result = await b.evaluate(async mode => {
        const proto = Storage.prototype;
        const get = proto.getItem, set = proto.setItem;
        let wrote = false;
        proto.setItem = function (key, value) {
          if (key === 'chat_history_a') {
            if (mode === 'write') throw new DOMException('fixture', 'QuotaExceededError');
            wrote = true;
            return;
          }
          return set.call(this, key, value);
        };
        proto.getItem = function (key) {
          if (key === 'chat_history_a' && wrote) throw new Error('fixture readback');
          return get.call(this, key);
        };
        try { return await ChatHistoryAtomic.appendIf('a', { mid: 'new' }); }
        finally { proto.getItem = get; proto.setItem = set; }
      }, mode);
      assert.equal(result.ok, false);
      assert.deepEqual((await history()).map(x => x.mid), ['old']);
      if (mode === 'readback') assert.equal(result.meta.writeMayHavePersisted, true);
    });
  }

  await scenario('25 consecutive cross-page append/edit races retain every committed message', async () => {
    await init(a);
    await append(a, 'original');
    for (let index = 0; index < 25; index++) {
      const expected = await history();
      const next = expected.map(message => message.mid === 'original' ? { ...message, text: 'edit-' + index } : message);
      const [sent, edited] = await Promise.all([append(a, 'stress-' + index), replace(b, expected, next)]);
      assert.ok(sent.ok);
      if (!edited.ok) assert.equal(edited.error.code, 'CONFLICT');
      const rows = await history();
      assert.equal(rows.length, index + 2);
      for (let prior = 0; prior <= index; prior++) assert.ok(rows.some(message => message.mid === 'stress-' + prior));
    }
  });
  await scenario('account identity mismatch refuses any write', async () => {
    const result = await b.evaluate(async () => {
      const meta = document.createElement('meta');
      meta.name = 'mao-account-id'; meta.content = 'MAO-ABCDEFGHIJKL';
      document.head.appendChild(meta);
      try { return await ChatHistoryAtomic.initializeIfAbsent('a', []); }
      finally { meta.remove(); }
    });
    assert.equal(result.error.code, 'ACCOUNT_SCOPE_UNAVAILABLE');
    assert.equal(await history(), null);
  });
  await scenario('two account storage adapters and lock scopes stay isolated', async () => {
    for (const [page, id] of [[a, 'ACCOUNT-A'], [b, 'ACCOUNT-B']]) {
      await page.evaluate(id => {
        const native = window.localStorage;
        window.__testNativeStorage = native;
        Object.defineProperty(window, 'localStorage', { configurable: true, value: {
          getItem: key => native.getItem(id + ':' + key),
          setItem: (key, value) => native.setItem(id + ':' + key, value)
        } });
        window.__MAO_ACCOUNT_SCOPE__ = { accountId: id, ready: true };
      }, id);
    }
    try {
      await Promise.all([init(a), init(b)]);
      assert.ok((await Promise.all([append(a, 'account-a'), append(b, 'account-b')])).every(x => x.ok));
      assert.deepEqual((await history()).map(x => x.mid), ['account-a']);
      const other = await b.evaluate(() => JSON.parse(localStorage.getItem('chat_history_a')));
      assert.deepEqual(other.map(x => x.mid), ['account-b']);
    } finally {
      for (const page of [a, b]) await page.evaluate(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, value: window.__testNativeStorage });
        delete window.__MAO_ACCOUNT_SCOPE__;
      });
    }
  });
  await scenario('real chat recovers legacy initialization and interrupted stream checkpoint', async () => {
    await a.evaluate(root => {
      localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'role-a', name: 'fixture', persona: 'fixture' }]));
      localStorage.setItem('api_settings', JSON.stringify({ apiKey: 'fixture', model: 'fixture', baseUrl: root + '/v1' }));
      localStorage.setItem('phone_data_v2', JSON.stringify({ 'role-a': { chat: { history: [{ mid: 'legacy', role: 'assistant', text: 'old fixture', time: 1 }] } } }));
    }, root);
    await a.bringToFront();
    await a.goto(root + '/chat/chat/chat-detail.html?id=role-a');
    await a.waitForFunction(() => JSON.parse(localStorage.getItem('chat_history_role-a') || '[]').some(x => x.mid === 'legacy'), null, { polling: 50 });
    await a.locator('#chat-input').fill('stream fixture');
    await a.locator('#chat-input').press('Enter');
    await a.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('chat_stream_checkpoint_role-a:')), null, { polling: 50 });
    await a.goto(root + '/');
    await a.goto(root + '/chat/chat/chat-detail.html?id=role-a');
    await a.waitForFunction(() => JSON.parse(localStorage.getItem('chat_history_role-a') || '[]').some(x => x.text === 'checkpoint fixture text'), null, { polling: 50 });
    const rows = await a.evaluate(() => JSON.parse(localStorage.getItem('chat_history_role-a')));
    assert.equal(rows.filter(x => x.text === 'checkpoint fixture text').length, 1);
    assert.ok(rows.some(x => x.mid === 'legacy'));
    await a.reload();
    await a.waitForFunction(() => document.querySelector('#chat-input'), null, { polling: 50 });
    const again = await a.evaluate(() => JSON.parse(localStorage.getItem('chat_history_role-a')));
    assert.equal(again.filter(x => x.text === 'checkpoint fixture text').length, 1);
    await a.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('chat_history_role-a'));
      localStorage.setItem('chat_stream_checkpoint_role-a:abrupt', JSON.stringify({
        owner: 'terminated-document-fixture', recoverable: false, anchor: rows[rows.length - 1],
        message: { mid: 'abrupt', turnId: 'abrupt', role: 'assistant', text: 'abrupt fixture', time: 3 }
      }));
    });
    await a.reload();
    await a.waitForFunction(() => JSON.parse(localStorage.getItem('chat_history_role-a')).some(x => x.mid === 'abrupt'), null, { polling: 50 });
    const cleared = await a.evaluate(async () => {
      const previous = JSON.parse(localStorage.getItem('chat_history_role-a'));
      localStorage.setItem('chat_stream_checkpoint_role-a:discarded', JSON.stringify({
        recoverable: true, anchor: previous[previous.length - 1],
        message: { mid: 'discarded-stream', turnId: 'discarded-stream', role: 'assistant', text: 'must not resurrect', time: 2 }
      }));
      return ChatHistoryAtomic.replaceIfUnchanged('role-a', previous, []);
    });
    assert.ok(cleared.ok);
    await a.reload();
    await a.waitForFunction(() => localStorage.getItem('chat_stream_checkpoint_role-a:discarded') === null, null, { polling: 50 });
    assert.deepEqual(await a.evaluate(() => JSON.parse(localStorage.getItem('chat_history_role-a'))), []);

  });
  console.log('ALL PASS', passed);
} finally { await browser.close(); server.close(); }
