/**
 * Browser storage contract for the actual shared/js/phone/phone_storage.js module.
 * Chromium only: Android/iPhone-sized viewports are NOT physical Android/iOS devices.
 * Run: node tests/chat-phone-storage-browser.mjs (requires Playwright Chromium).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

const productionSource = fs.readFileSync('shared/js/phone/phone_storage.js', 'utf8');
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<!doctype html><title>MAOMAO PhoneStorage browser contract</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const device of [
    { label: 'Android-sized Chromium', width: 393, height: 873 },
    { label: 'iPhone-sized Chromium (not Safari)', width: 390, height: 844 }
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block'
    });
    try {
      const page = await context.newPage();
      await page.goto(url);
      const checks = await page.evaluate((code) => {
        const requireCheck = (ok, reason) => { if (!ok) throw Error(reason); };
        const results = [];
        const rawA = '{broken-primary';
        const rawB = JSON.stringify([{ role: 'received', text: 'B primary', mid: 'b-1' }]);
        const legacyRoot = {
          A: { chat: { history: [{ text: 'stale A' }] } },
          B: { chat: { history: [{ text: 'legacy B copy' }] } }
        };
        localStorage.clear();
        localStorage.setItem('chat_history_A', rawA);
        localStorage.setItem('chat_history_B', rawB);
        localStorage.setItem('phone_data_v2', JSON.stringify(legacyRoot));
        new Function('window', 'localStorage', 'console', code)(window, localStorage, console);
        const api = window.PhoneStorage;

        requireCheck(api.getChatHistory('A').length === 0, 'corrupt primary masked by duplicate');
        requireCheck(api.result.getChatHistory('A').error.code === 'CORRUPT_DATA', 'missing corruption error');
        requireCheck(api.saveChatHistory('A', [{ text: 'not persisted' }]) === false, 'corrupt write succeeded');
        requireCheck(api.result.saveChatHistory('A', []).error.code === 'CORRUPT_DATA', 'result write succeeded');
        requireCheck(localStorage.getItem('chat_history_A') === rawA, 'corrupt bytes changed');
        requireCheck(localStorage.getItem('chat_history_B') === rawB, 'role B modified');
        results.push('corrupt primary + explicit errors + A/B isolation');

        localStorage.setItem('chat_history_A', '[]');
        requireCheck(api.getChatHistory('A').length === 0, 'stale duplicate overridden empty primary');
        requireCheck(api.saveChatHistory('A', [{ role: 'user', text: 'A verified', mid: 'a-1' }]) === true,
          'valid A write failed');
        requireCheck(JSON.parse(localStorage.getItem('chat_history_A'))[0].mid === 'a-1',
          'primary did not round-trip');
        requireCheck(JSON.parse(localStorage.getItem('phone_data_v2')).B.chat.history[0].text ===
          'legacy B copy', 'v2 cleanup deleted unrelated role B');
        results.push('valid empty primary + verified persistence + scoped cleanup');

        const before = localStorage.getItem('chat_history_A');
        const savedRawSet = api.rawSet;
        try {
          api.rawSet = () => true; // simulate a storage facade lying about persistence
          requireCheck(api.saveChatHistory('A', [{ text: 'fake success' }]) === false,
            'false-positive save was accepted');
          requireCheck(localStorage.getItem('chat_history_A') === before, 'fake write changed bytes');
        } finally {
          api.rawSet = savedRawSet;
        }
        results.push('fake storage success must fail');
        return results;
      }, productionSource);
      await page.reload();
      const afterReload = await page.evaluate(() => ({
        a: JSON.parse(localStorage.getItem('chat_history_A'))[0].mid,
        b: JSON.parse(localStorage.getItem('chat_history_B'))[0].mid
      }));
      assert.deepEqual(afterReload, { a: 'a-1', b: 'b-1' });
      console.log(device.label + ': ' + checks.length + ' sections passed; native persistence survived reload');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
