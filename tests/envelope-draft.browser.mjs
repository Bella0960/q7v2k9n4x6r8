import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4178/envelope/envelope.html?id=envelope-fixture';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], { stdio: 'ignore' });
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
      localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'envelope-fixture', name: 'Fixture' }]));
    });
    await page.goto(url);
    await page.locator('#writeButton').tap();
    await page.locator('#letterTitle').fill('Draft title');
    await page.locator('#letterContent').fill('Draft body');
    await page.locator('#composeBack').tap();
    await page.locator('#homeView.active').waitFor();
    await page.reload();
    await page.locator('[data-is-draft="1"]').tap();
    assert.equal(await page.locator('#letterContent').inputValue(), 'Draft body');
    const color = page.locator('#colorPalette [data-color]:not(.active)').last();
    const expectedColor = await color.getAttribute('data-color');
    await color.tap();
    await page.locator('#composeBack').tap();
    const drafts = await page.evaluate(() => window.PhoneStorage.getData('envelope-fixture', 'letters').drafts);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].envelopeColor, expectedColor);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
