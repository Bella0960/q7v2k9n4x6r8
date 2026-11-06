import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4173';
const artifactDir = path.join(root, 'artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, NODE_ENV: 'test' }
});

let browser;
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(baseUrl + '/luck-room/luck-room.html');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Vite preview server did not become ready');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl + '/luck-room/luck-room.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-home.png'), fullPage: true });
  assert(await page.locator('.play-tab').count() === 4, 'Expected four play tabs');
  assert(await page.locator('#roleSelect option').count() >= 1, 'Solo option should always exist');

  await page.locator('#drawLotBtn').click();
  await page.locator('#lotResult').waitFor({ state: 'visible', timeout: 4000 });
  assert((await page.locator('#lotResultText').textContent()).trim().length > 0, 'Lot result should be populated');
  assert((await page.locator('#lotResult .disclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Lot disclaimer mismatch');

  await page.locator('[data-tab="wheel"]').click();
  await page.locator('#spinWheelBtn').click();
  await page.locator('#wheelResult').waitFor({ state: 'visible', timeout: 8500 });
  assert((await page.locator('#wheelResultText').textContent()).trim().length > 0, 'Wheel result should be populated');
  assert((await page.locator('#wheelResult .disclaimer').textContent()).trim().length > 0, 'Wheel disclaimer should be visible');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-wheel.png'), fullPage: true });

  await page.locator('[data-tab="tarot"]').click();
  await page.locator('#drawTarotBtn').click();
  await page.locator('#tarotSpread').waitFor({ state: 'visible', timeout: 4000 });
  const card = page.locator('.tarot-crystal-card').first();
  const clipPath = await card.evaluate((node) => getComputedStyle(node).clipPath);
  assert(clipPath.includes('polygon'), 'Tarot card must use a polygon crystal silhouette');
  await card.click();
  await page.locator('#tarotDisclaimer').waitFor({ state: 'visible', timeout: 2000 });
  assert((await page.locator('#tarotDisclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Tarot disclaimer mismatch');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-crystal-tarot.png'), fullPage: true });

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDrawBtn').click();
  await page.locator('#dailyResult').waitFor({ state: 'visible', timeout: 2000 });
  const score = Number((await page.locator('#dailyScore').textContent()).trim());
  assert(score >= 60 && score <= 100, 'Daily fun score should be within its declared range');
  assert((await page.locator('#dailyResult .disclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Daily luck disclaimer mismatch');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-daily.png'), fullPage: true });

  assert(pageErrors.length === 0, 'Browser console errors: ' + pageErrors.join(' | '));
  console.log('Luck room mobile browser smoke test passed: lots, wheel, crystal tarot, daily luck.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  });
