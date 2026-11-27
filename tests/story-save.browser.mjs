import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4177/games/story.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4177', '--strictPort'], { stdio: 'ignore' });
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
      localStorage.setItem('maomao_story_player_name', 'Fixture');
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('maomao_story_save_') && window.rejectStorySave) return;
        return originalSet.call(this, key, value);
      };
    });
    await page.goto(url);
    await page.locator('.book-card').first().tap();
    await page.locator('#btnMenu').tap();
    await page.evaluate(() => { window.rejectStorySave = true; });
    await page.locator('#btnSave').tap();
    assert.match(await page.locator('#toast').innerText(), /没能保存/);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('maomao_story_save_'))), false);
    await page.evaluate(() => { window.rejectStorySave = false; });
    await page.locator('#btnMenu').tap();
    await page.locator('#btnSave').tap();
    assert.equal(await page.locator('#toast').innerText(), '已保存');
    await page.reload();
    assert.match(await page.locator('.book-progress').first().innerText(), /继续/);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
