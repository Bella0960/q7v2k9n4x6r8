import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4176/travel/dream-travel.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { stdio: 'ignore' });
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
        if (key === 'maomao_dream_travel_v1' && window.ignoreTravelWrites) return;
        return write.call(this, key, value);
      };
    });
    await page.goto(url);
    await page.locator('button[data-detail]:visible').first().tap();
    const favorite = page.locator('#detailFavorite');
    assert.equal(await favorite.innerText(), '☆');
    await page.evaluate(() => { window.ignoreTravelWrites = true; });
    await favorite.tap();
    assert.equal(await favorite.innerText(), '☆');
    await page.evaluate(() => { window.ignoreTravelWrites = false; });
    await favorite.tap();
    assert.equal(await favorite.innerText(), '★');
    await page.reload();
    await page.locator('button[data-detail]:visible').first().tap();
    assert.equal(await favorite.innerText(), '★');
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
