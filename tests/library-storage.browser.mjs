import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4175/library/library.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch(url).then(response => response.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  for (const width of [375, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'maomao_reader_settings_v1' && window.ignoreReaderWrites) return;
        return write.call(this, key, value);
      };
    });
    await page.goto(url);
    await page.locator('.book-card:visible').first().tap();
    await page.locator('#ctrlSet').tap();
    const readSettings = () => page.evaluate(() => localStorage.getItem('maomao_reader_settings_v1'));
    const before = await readSettings();
    const size = Number(await page.locator('#rsFsValue').innerText());
    await page.evaluate(() => { window.ignoreReaderWrites = true; });
    await page.locator('#rsFsUp').tap();
    assert.match(await page.locator('#toast').innerText(), /阅读设置没能存到本机/);
    assert.equal(await readSettings(), before);
    await page.evaluate(() => { window.ignoreReaderWrites = false; });
    await page.locator('#rsFsUp').tap();
    assert.equal(JSON.parse(await readSettings()).fs, size + 2);
    await page.reload();
    await page.locator('.book-card:visible').first().tap();
    await page.locator('#ctrlSet').tap();
    assert.equal(Number(await page.locator('#rsFsValue').innerText()), size + 2);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
