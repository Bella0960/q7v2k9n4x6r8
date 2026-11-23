/** APP-COMPANION-001, isolated real-page browser regression (no network/paid API) */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.COMPANION_QA_PORT || 4180);
const origin = 'http://127.0.0.1:' + port;
const pageUrl = origin + '/companion/companion.html';
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite preview stopped');
    try { const res = await fetch(pageUrl, { signal: AbortSignal.timeout(500) }); if (res.status === 200) { ready = true; break; } }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  assert.ok(ready, 'local Vite preview must serve companion');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await context.addInitScript(() => {
        // Synthetic roles only. The real PhoneStorage file loads after this seeding.
        localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'qa-A', name: '角色甲' }, { id: 'qa-B', name: '角色乙' }]));
        localStorage.setItem('phone_current_contact', 'qa-A');
        localStorage.setItem('maoer_daily_questions_default', JSON.stringify({ legacy: ['旧共享回答'] }));
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pageUrl + '?id=qa-A', { waitUntil: 'domcontentloaded' });
      assert.match(await page.locator('#roleLabel').textContent(), /角色甲/);
      await page.locator('[data-answer="0"]').fill('A角色专属记录');
      await page.locator('#saveAnswers').click();
      assert.match(await page.locator('#saveStatus').textContent(), /已保存/);
      const a = await page.evaluate(() => localStorage.getItem('maoer_daily_questions_qa-A'));
      assert.ok(a?.includes('A角色专属记录'));

      await page.goto(pageUrl + '?id=qa-B', { waitUntil: 'domcontentloaded' });
      assert.match(await page.locator('#roleLabel').textContent(), /角色乙/);
      assert.equal(await page.locator('[data-answer="0"]').inputValue(), '', 'B must not see A answer or global legacy');
      await page.locator('[data-answer="0"]').fill('B角色专属记录');
      await page.locator('#saveAnswers').click();
      const b = await page.evaluate(() => localStorage.getItem('maoer_daily_questions_qa-B'));
      assert.ok(b?.includes('B角色专属记录'));
      assert.ok(!b?.includes('A角色专属记录'));

      await page.goto(pageUrl + '?id=qa-A', { waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('[data-answer="0"]').inputValue(), 'A角色专属记录');

      // A silently failed write must not create a false "saved" status.
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        window.__qaRestoreWrite = () => { Storage.prototype.setItem = set; };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'maoer_daily_questions_qa-A') return;
          return set.call(this, key, value);
        };
      });
      await page.locator('[data-answer="0"]').fill('失败的覆盖记录');
      await page.locator('#saveAnswers').click();
      assert.match(await page.locator('#saveStatus').textContent(), /没能保存/);
      await page.evaluate(() => window.__qaRestoreWrite());
      assert.equal(await page.evaluate(() => localStorage.getItem('maoer_daily_questions_qa-A')), a,
        'silent failure must not overwrite persisted A record');

      await page.goto(pageUrl + '?id=ghost', { waitUntil: 'domcontentloaded' });
      assert.match(await page.locator('#roleLabel').textContent(), /只读/);
      await page.locator('[data-answer="0"]').fill('不应被保存');
      await page.locator('#saveAnswers').click();
      assert.equal(await page.evaluate(() => localStorage.getItem('maoer_daily_questions_ghost')), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('maoer_daily_questions_default')), JSON.stringify({ legacy: ['旧共享回答'] }));
      assert.ok(!errors.some(x => /PhoneStorage|storeSet|canStore.*not defined/.test(x)), 'no broken dependency');
      console.log('COMPANION_BROWSER_PASS ' + width);
    } finally { await context.close(); }
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
