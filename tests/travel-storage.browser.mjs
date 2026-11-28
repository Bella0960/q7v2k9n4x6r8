import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 4176;
const url = `http://${host}:${port}/travel/dream-travel.html`;
const storeKey = 'maomao_dream_travel_v1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const outputLimit = 8000;
let serverOutput = '';
let serverError = '';
let stage = 'starting preview server';
let browser;

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port), '--strictPort'
], { stdio: ['ignore', 'pipe', 'pipe'] });

function rememberServerOutput(chunk) {
  serverOutput = (serverOutput + chunk.toString()).slice(-outputLimit);
}

server.stdout.on('data', rememberServerOutput);
server.stderr.on('data', rememberServerOutput);
server.on('error', error => { serverError = error.message; });

async function waitForPreview() {
  let lastError = 'no response';
  for (let attempt = 1; attempt <= 80; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(`preview exited before readiness (code ${server.exitCode})`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.text();
      if (response.ok && body.includes('id="detailFavorite"')) return;
      lastError = `HTTP ${response.status}; expected travel marker=${body.includes('id="detailFavorite"')}`;
    } catch (error) {
      lastError = error.message;
    }
    await delay(250);
  }
  throw new Error(`preview did not become ready within 20s (${lastError})`);
}

async function stopPreview() {
  if (server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(3000).then(() => false)])) return;
  server.kill('SIGKILL');
  await exited.catch(() => {});
}

try {
  await waitForPreview();
  stage = 'launching browser';
  browser = await chromium.launch();

  for (const width of [375, 390, 430]) {
    stage = `width=${width}: creating isolated context`;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const pageErrors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 500)));
      await page.addInitScript(key => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key && window.ignoreTravelWrites) return;
          return write.call(this, name, value);
        };
      }, storeKey);

      stage = `width=${width}: loading travel page`;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      assert(response?.ok(), `travel page returned HTTP ${response?.status() ?? 'no response'}`);
      const detailButton = page.locator('button[data-detail]:visible').first();
      await detailButton.waitFor({ state: 'visible', timeout: 10000 });
      const placeId = await detailButton.getAttribute('data-detail');
      assert(placeId, 'first visible destination has no data-detail id');

      stage = `width=${width}: opening destination ${placeId}`;
      await detailButton.tap();
      const favorite = page.locator('#detailFavorite');
      await favorite.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await favorite.innerText(), '☆');

      stage = `width=${width}: verifying failed write rollback`;
      await page.evaluate(() => { window.ignoreTravelWrites = true; });
      await favorite.tap();
      assert.equal(await favorite.innerText(), '☆');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storeKey), null);

      stage = `width=${width}: persisting favorite`;
      await page.evaluate(() => { window.ignoreTravelWrites = false; });
      await favorite.tap();
      assert.equal(await favorite.innerText(), '★');
      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storeKey);
      assert(stored?.favorites?.includes(placeId), `stored favorites do not contain ${placeId}`);

      stage = `width=${width}: reloading persisted favorite`;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      const reloadedButton = page.locator('button[data-detail]:visible').first();
      await reloadedButton.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await reloadedButton.getAttribute('data-detail'), placeId);
      await reloadedButton.tap();
      const reloadedFavorite = page.locator('#detailFavorite');
      await reloadedFavorite.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await reloadedFavorite.innerText(), '★');

      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    } catch (error) {
      error.message += `; pageErrors=${pageErrors.join(' | ') || 'none'}`;
      throw error;
    } finally {
      await context.close();
    }
  }
} catch (error) {
  const diagnostics = [
    `travel browser failure at stage: ${stage}`,
    `cause: ${error.message}`,
    `preview error: ${serverError || 'none'}`,
    `preview output: ${serverOutput.trim() || 'none'}`
  ].join('\n');
  throw new Error(diagnostics, { cause: error });
} finally {
  await browser?.close();
  await stopPreview();
}
