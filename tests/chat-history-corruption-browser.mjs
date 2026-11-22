/**
 * Browser-level chat history integrity contract.
 * Runs the EXACT load/save/readback functions from chat-detail.html in Chromium
 * using native localStorage. This is not full-app UI or iOS WebKit device QA.
 * Usage: node tests/chat-history-corruption-browser.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

const detail = fs.readFileSync('chat/chat/chat-detail.html', 'utf8');
const from = detail.indexOf('        var _chatHistoryUnreadable = false;');
const to = detail.indexOf('        // 失败提示冷却：', from);
const readFrom = detail.indexOf('        function _readBackHistory() {', to);
const saveFrom = detail.indexOf('        function saveMessages(list) {', readFrom);
const saveTo = detail.indexOf('        // /photo 为用户显式触发', saveFrom);
assert.ok(from >= 0 && to > from && readFrom > to && saveFrom > readFrom && saveTo > saveFrom);
const source = detail.slice(from, to) + '\n' + detail.slice(readFrom, saveTo);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end('<!doctype html><title>MAOMAO chat storage test</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const profile of [
    { name: 'Android-sized Chromium', viewport: { width: 393, height: 873 } },
    { name: 'iPhone-sized Chromium (NOT Safari/WebKit)', viewport: { width: 390, height: 844 } }
  ]) {
    const context = await browser.newContext({
      viewport: profile.viewport, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, serviceWorkers: 'block'
    });
    try {
      const page = await context.newPage();
      await page.goto(url);
      const results = await page.evaluate((realSource) => {
        const create = new Function('roleId', 'storage',
          "var currentCharacter = { id: roleId };" +
          "var storageKey = 'chat_history_' + roleId;" +
          "var _storage = storage || null;" +
          "var removeLegacyStickerCaptions = list => list;" +
          "var getInitialMessages = () => [{ role: 'received', text: 'Welcome' }];" +
          "var _shouldWarnAgain = () => true;" +
          "var _resetWarnCooldown = () => {};" +
          "var showToast = () => {};" +
          realSource +
          "return { read: loadMessages, write: saveMessages, " +
          "setRole: id => { currentCharacter.id = id; } };");
        const check = (ok, what) => { if (!ok) throw new Error(what); };
        const results = [];
        const aKey = 'chat_history_browser_A';
        const bKey = 'chat_history_browser_B';
        const bOriginal = JSON.stringify([{ role: 'received', text: 'B only', mid: 'b1' }]);
        localStorage.setItem(aKey, '{broken-primary');
        localStorage.setItem(bKey, bOriginal);
        const oldDuplicate = {
          getChatHistory: () => [{ role: 'received', text: 'stale v2 duplicate' }],
          saveChatHistory: () => { throw new Error('must not write'); }
        };
        const a = create('browser_A', oldDuplicate);
        check(a.read().length === 0, 'corrupt A must not display stale v2');
        check(a.write([{ role: 'user', text: 'bad' }]) === false, 'corrupt A must reject write');
        check(localStorage.getItem(aKey) === '{broken-primary', 'corrupt A raw bytes changed');
        check(localStorage.getItem(bKey) === bOriginal, 'B changed during A rejection');
        results.push('corrupt-primary / stale-duplicate / A-B isolation');

        const b = create('browser_B');
        check(b.read()[0].text === 'B only', 'B cannot read its own history');
        check(b.write([{ role: 'user', text: 'B updated', mid: 'b2' }]) === true,
          'B write did not round-trip');
        check(JSON.parse(localStorage.getItem(bKey))[0].mid === 'b2', 'B write was not persisted');
        check(localStorage.getItem(aKey) === '{broken-primary', 'B write changed A');
        results.push('valid B write / native readback / A untouched');

        localStorage.setItem(aKey, '[]');
        const emptyA = create('browser_A', oldDuplicate);
        check(emptyA.read().length === 0, 'empty primary must override stale duplicate');
        check(localStorage.getItem(aKey) === '[]', 'empty primary must stay unchanged');
        results.push('empty primary precedence');

        const late = create('browser_A');
        check(late.read().length === 0, 'initial empty read failed');
        localStorage.setItem(aKey, '{corrupt-after-open');
        check(late.write([{ role: 'user', text: 'blocked' }]) === false,
          'late corruption was overwritten');
        check(localStorage.getItem(aKey) === '{corrupt-after-open',
          'late corruption raw changed');
        results.push('late corruption fail-closed');

        localStorage.setItem(aKey, '[]');
        const drift = create('browser_A');
        drift.setRole('browser_B');
        check(drift.write([{ role: 'user', text: 'wrong role' }]) === false,
          'role drift allowed cross-role write');
        check(JSON.parse(localStorage.getItem(bKey))[0].mid === 'b2', 'role drift altered B');
        results.push('role ID drift blocked');

        const fakeStorage = {
          getChatHistory: () => [{ role: 'user', text: 'forged' }],
          saveChatHistory: () => true
        };
        const fake = create('browser_A', fakeStorage);
        check(fake.write([{ role: 'user', text: 'forged' }]) === false,
          'legacy storage duplicate faked save success');
        check(localStorage.getItem(aKey) === '[]', 'false success altered primary');
        results.push('false-save success rejected');
        return results;
      }, source);
      await page.reload();
      const persisted = await page.evaluate(() => ({
        a: localStorage.getItem('chat_history_browser_A'),
        b: JSON.parse(localStorage.getItem('chat_history_browser_B'))[0].mid
      }));
      assert.equal(persisted.a, '[]');
      assert.equal(persisted.b, 'b2');
      console.log(profile.name + ': ' + results.length + ' checks, reload persisted OK');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}