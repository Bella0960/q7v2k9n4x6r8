/**
 * APP-MUSIC-001: browser proof of toast and legacy-key rollback at 375/390/430.
 * Isolated local Vite preview, synthetic localStorage; no real provider API.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = Number(process.env.MUSIC_STORAGE_QA_PORT || 4178);
const origin = 'http://127.0.0.1:' + port;
const url = origin + '/music/music.html';
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const shots = await mkdtemp(join(tmpdir(), 'maomao-music-storage-'));
const server = spawn(process.execPath,
  [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite preview exited');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, 'Vite preview must serve music page');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      serviceWorkers: 'block'
    });
    try {
      await context.route('**/*', route => route.request().url().startsWith(origin + '/')
        ? route.continue() : route.abort());
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.locator('body').waitFor({ state: 'visible' });
      await page.evaluate(() => window.toast('浏览器测试提示'));
      const el = page.locator('#musicToast.show');
      await el.waitFor({ state: 'visible' });
      assert.equal(await el.textContent(), '浏览器测试提示');
      const state = await page.evaluate(() => {
        const keys = ['music_profile_name', 'music_profile_handle', 'music_profile_bg'];
        const old = ['旧昵称', '@old', '#222'];
        keys.forEach((key, i) => localStorage.setItem(key, old[i]));
        const setItem = Storage.prototype.setItem;
        let triggered = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'music_profile_bg' && !triggered) {
            triggered = true;
            throw new Error('SyntheticQuotaExceeded');
          }
          return setItem.call(this, key, value);
        };
        let result;
        try {
          result = window.persistProfileFields([
            ['music_profile_name', '新昵称'],
            ['music_profile_handle', '@new'],
            ['music_profile_bg', '#eeeeee']
          ]);
        } finally {
          Storage.prototype.setItem = setItem;
        }
        return { result, triggered, after: keys.map(key => localStorage.getItem(key)) };
      });
      assert.equal(state.triggered, true, 'injected third-key failure must occur');
      assert.equal(state.result, false, 'partial write must not report success');
      assert.deepEqual(state.after, ['旧昵称', '@old', '#222'], 'legacy keys must roll back');
      assert.equal(pageErrors.some(message =>
        /(?:toast|persistProfileFields|saveLocal) is not defined/.test(message)), false,
        'music must not call missing runtime helpers');
      await page.screenshot({ path: join(shots, 'music-' + width + '.png') });
      console.log('MUSIC_STORAGE_BROWSER_PASS ' + width);
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await rm(shots, { recursive: true, force: true });
}
