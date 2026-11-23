import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4175/library/library.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
let browser;
let phase = "startup";
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch(url).then(response => response.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  for (const width of [375, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(8000);
    phase = "fixture";
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'maomao_reader_settings_v1' && window.ignoreReaderWrites) return;
        return write.call(this, key, value);
      };
    });
    phase = "open";
    await page.goto(url);
    await page.locator('[data-route="settings"]').click();
    const read = () => page.evaluate(() => localStorage.getItem('maomao_reader_settings_v1'));
    const before = await read();
    await page.evaluate(() => { window.ignoreReaderWrites = true; });
    phase = "failure-toast";
    await page.locator('#fsUp').click();
    assert.match(await page.locator('#toast').innerText(), /阅读设置没能存到本机/);
    phase = "failure-storage";
    assert.equal(await read(), before);
    await page.evaluate(() => { window.ignoreReaderWrites = false; });
    phase = "retry";
    await page.locator('#fsUp').click();
    const after = await read();
    assert.ok(after);
    assert.notEqual(after, before);
    const size = JSON.parse(after).fs;
    assert.equal(Number(await page.locator('#fsValue').textContent()), size);
    phase = "restore";
    await page.reload();
    await page.locator('#fsValue:visible').waitFor();
    assert.equal(Number(await page.locator('#fsValue').textContent()), size);
    await page.close();
  }
} catch (error) {
  console.error("QA_STAGE_" + phase);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
