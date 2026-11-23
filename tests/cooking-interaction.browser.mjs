import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4174/games/cooking.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
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
      localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'cook-fixture', name: 'Fixture' }]));
    });
    await page.goto(url);
    await page.locator('.ingredient-item').first().tap();
    await page.locator('#cookButton').tap();
    await page.locator('#serveButton').tap();
    await page.evaluate(() => document.querySelector('#serveButton').click());
    await page.locator('#tastingActions').waitFor();
    const readHistory = () => page.evaluate(() => JSON.parse(localStorage.getItem('maomao_cooking_history_v1')));
    assert.equal((await readHistory()).length, 1);
    await page.evaluate(() => document.querySelector('#serveButton').click());
    assert.equal(await page.locator('#tastingActions').isVisible(), true);
    assert.equal((await readHistory()).length, 1);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
