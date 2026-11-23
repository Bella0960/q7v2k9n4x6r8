import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/diary/diary.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
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
      if (!localStorage.getItem('maomao_diary_entries_v1')) {
        localStorage.setItem('maomao_diary_entries_v1', JSON.stringify([
          { id: 'diary-fixture', date: '2026-11-23', title: 'Fixture', content: 'Test diary', tags: [], pinned: false }
        ]));
      }
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'maomao_diary_entries_v1' && window.ignoreDiaryWrites) return;
        return write.call(this, key, value);
      };
    });
    await page.goto(url);
    const entry = page.locator('[data-open-entry="diary-fixture"]');
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('maomao_diary_entries_v1'))[0]);
    await entry.click();
    await page.locator('#readerMoreBtn').click();
    await page.evaluate(() => { window.ignoreDiaryWrites = true; });
    await page.locator('#readerPin').click();
    assert.match(await page.locator('#toast').innerText(), /没能保存/);
    assert.equal((await read()).pinned, false);
    await page.evaluate(() => { window.ignoreDiaryWrites = false; });
    await page.locator('#readerMoreBtn').click();
    await page.locator('#readerPin').click();
    assert.equal((await read()).pinned, true);
    await page.reload();
    await entry.click();
    await page.locator('#readerMoreBtn').click();
    assert.match(await page.locator('#readerPin').innerText(), /取消置顶/);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
