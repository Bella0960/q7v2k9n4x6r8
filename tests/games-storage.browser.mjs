/* APP-GAMES-001 / isolated browser regression, no paid AI requests */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.GAMES_STORAGE_QA_PORT || 4179);
const origin = 'http://127.0.0.1:' + port;
const pageUrl = origin + '/games/games.html';
const cli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const proc = spawn(process.execPath,
  [cli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'ignore' });
let browser;
try {
  let live = false;
  for (let retry = 0; retry < 60; retry++) {
    if (proc.exitCode !== null) throw new Error('Vite preview terminated');
    try {
      const res = await fetch(pageUrl, { signal: AbortSignal.timeout(600) });
      if (res.status === 200) { live = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(live, 'game page available from local build');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [375, 390, 430]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    try {
      await ctx.route('**/*', route => route.request().url().startsWith(origin + '/')
        ? route.continue() : route.abort());
      await ctx.addInitScript(() => {
        localStorage.setItem('ai_custom_characters', JSON.stringify([
          { id: 'qa-A', name: '角色甲' }, { id: 'qa-B', name: '角色乙' }
        ]));
        localStorage.setItem('maomao_game_role', 'qa-A');
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const res = await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      assert.equal(res.status(), 200, 'game page must load');
      await page.locator('body').waitFor({ state: 'visible' });
      // The real game helpers live in an IIFE; verify through the rendered
      // role picker rather than calling unexported implementation functions.
      await page.locator('#togglePartnerPicker').click();
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.__restoreGameWrites = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'maomao_game_role') return; // silent write loss
          return original.call(this, key, value);
        };
      });
      await page.locator('[data-role="qa-B"]').click();
      const tested = await page.evaluate(() => ({
        persisted: localStorage.getItem('maomao_game_role'),
        toast: document.getElementById('toast')?.textContent || '',
        roleMarkup: document.getElementById('roleRail')?.textContent || ''
      }));
      await page.evaluate(() => window.__restoreGameWrites());
      assert.equal(tested.persisted, 'qa-A', 'role change must not claim persistence');
      assert.match(tested.toast, /没能存到本机/);
      assert.match(tested.roleMarkup, /角色乙/);
      assert.ok(!errors.some(e => /saveRaw|showToast|saveJSON.*not defined/.test(e)),
        'no missing storage helper on real page');
      console.log('GAMES_STORAGE_BROWSER_PASS ' + width);
    } finally { await ctx.close(); }
  }
} finally {
  if (browser) await browser.close();
  proc.kill('SIGTERM');
}
