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
  await page.addInitScript(() => {
    const avatar = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%2210%22 fill=%22%23111%22/%3E%3C/svg%3E';
    localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'luck-room-smoke-role', name: '测试角色', avatar: avatar }
    ]));
  });

  await page.goto(baseUrl + '/luck-room/luck-room.html', { waitUntil: 'networkidle' });
  await page.locator('#roleSelect').selectOption('luck-room-smoke-role');
  assert(await page.locator('#companionAvatar').isVisible(), 'Selected character avatar should be shown');
  assert((await page.locator('#roleStatus').textContent()).includes('测试角色'), 'Selected character name should be shown');
  await page.locator('#roleSelect').selectOption('');
  assert(await page.locator('#companionFallback').isVisible(), 'Solo mode should restore the neutral companion mark');
  await page.locator('#roleSelect').selectOption('luck-room-smoke-role');
  await page.locator('#lotDrawMode').selectOption('alternate');
  assert((await page.locator('#lotDrawHint').textContent()).includes('下一次由你抽取'), 'Alternating lot mode should start with the user');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-home.png'), fullPage: true });
  assert(await page.locator('.play-tab').count() === 4, 'Expected four play tabs');
  assert(await page.locator('#roleSelect option').count() >= 1, 'Solo option should always exist');

  await page.locator('#drawLotBtn').click();
  assert(await page.locator('#rolePrompt').isVisible(), 'Selected role should participate before the lot result');
  assert(await page.locator('#lotResult').isHidden(), 'Lot result must stay concealed while the character participates and the vessel shakes');
  assert((await page.locator('#rolePrompt').textContent()).includes('测试角色'), 'Pre-draw response should belong to the selected role');
  await page.locator('#lotResult').waitFor({ state: 'visible', timeout: 4000 });
  assert((await page.locator('#lotResultText').textContent()).trim().length > 0, 'Lot result should be populated');
  assert((await page.locator('#lotResult .disclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Lot disclaimer mismatch');
  assert((await page.locator('#lotRoleReaction').textContent()).includes('测试角色'), 'Character should respond after the lot result');
  assert((await page.locator('#lotDrawHint').textContent()).includes('下一次由测试角色抽取'), 'Alternating mode should hand the next draw to the selected character');
  await page.locator('#drawLotBtn').click();
  assert(await page.locator('#lotResult').isHidden(), 'Second alternating lot result must remain hidden during the draw animation');
  await page.locator('#lotResult').waitFor({ state: 'visible', timeout: 4000 });
  assert((await page.locator('#lotDrawHint').textContent()).includes('下一次由你抽取'), 'Alternating mode should return the next draw to the user');
  await page.locator('#historyToggle').click();
  const lotHistory = await page.locator('#historyList .history-entry').allTextContents();
  assert(lotHistory.some((entry) => entry.includes('由你抽取')), 'History should record user draws');
  assert(lotHistory.some((entry) => entry.includes('由测试角色抽取')), 'History should record character draws');
  await page.locator('#closeHistory').click();

  await page.locator('[data-tab="wheel"]').click();
  await page.locator('#spinWheelBtn').click();
  assert(await page.locator('#rolePrompt').isVisible(), 'Selected role should participate before the wheel result');
  assert((await page.locator('#rolePrompt').textContent()).includes('测试角色'), 'Wheel warm-up should use the selected character');
  await page.locator('#wheelResult').waitFor({ state: 'visible', timeout: 8500 });
  assert((await page.locator('#wheelRoleReaction').textContent()).includes('测试角色'), 'Character should respond after the wheel result');
  assert((await page.locator('#wheelResultText').textContent()).trim().length > 0, 'Wheel result should be populated');
  assert((await page.locator('#wheelResult .disclaimer').textContent()).trim().length > 0, 'Wheel disclaimer should be visible');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-wheel.png'), fullPage: true });

  await page.locator('[data-tab="tarot"]').click();
  assert((await page.locator('#tarotDeckCount').textContent()).includes('78'), 'Tarot should advertise the full 78-card deck');
  await page.locator('#drawTarotBtn').click();
  assert(await page.locator('#rolePrompt').isVisible(), 'Selected role should participate before tarot reveal');
  await page.locator('#tarotSpread').waitFor({ state: 'visible', timeout: 4000 });
  assert(await page.locator('.tarot-crystal-card').count() === 1, 'Single-card spread should draw one card');
  const card = page.locator('.tarot-crystal-card').first();
  const clipPath = await card.evaluate((node) => getComputedStyle(node).clipPath);
  assert(clipPath.includes('polygon'), 'Tarot card must use a polygon crystal silhouette');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-tarot-card-back.png'), fullPage: true });
  await card.click();
  await page.locator('#tarotDisclaimer').waitFor({ state: 'visible', timeout: 2000 });
  assert((await page.locator('#tarotDisclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Tarot disclaimer mismatch');
  assert(await page.locator('.tarot-reading').count() === 1, 'Single-card reading should render one structured interpretation');
  assert((await page.locator('#tarotDeckCount').textContent()).includes('78'), 'Deck counter should retain the full pool size');
  assert(await page.locator('#tarotRoleReaction').isVisible(), 'Character should respond after the single-card reveal');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-tarot-single-face.png'), fullPage: true });

  await page.locator('#tarotSpreadSelect').selectOption('3');
  await page.locator('#drawTarotBtn').click();
  await page.locator('#tarotSpread').waitFor({ state: 'visible', timeout: 4000 });
  assert(await page.locator('.tarot-crystal-card').count() === 3, 'Three-card spread should draw three different cards');
  const names = await page.locator('.tarot-card-name').allTextContents();
  assert(new Set(names).size === 3, 'Three-card spread must not contain duplicate cards');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-tarot-three-card-back.png'), fullPage: true });
  for (let i = 0; i < 3; i++) await page.locator('.tarot-crystal-card').nth(i).click();
  assert(await page.locator('.tarot-reading').count() === 3, 'Three-card spread should render three structured interpretations');
  assert(await page.locator('#tarotRoleReaction').isVisible(), 'Character should respond after the three-card reading');
  assert((await page.locator('#tarotDisclaimer').textContent()).trim() === '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。', 'Tarot spread disclaimer mismatch');
  await page.screenshot({ path: path.join(artifactDir, 'luck-room-tarot-three-card-face.png'), fullPage: true });

  await page.locator('[data-tab="daily"]').click();
  await page.locator('#dailyDrawBtn').click();
  assert(await page.locator('#rolePrompt').isVisible(), 'Selected role should participate before daily luck is revealed');
  assert(await page.locator('#dailyResult').isHidden(), 'Daily result should remain concealed during the short preparation phase');
  await page.locator('#dailyResult').waitFor({ state: 'visible', timeout: 2000 });
  const score = Number((await page.locator('#dailyScore').textContent()).trim());
  assert(score >= 60 && score <= 100, 'Daily fun score should be within its declared range');
  assert((await page.locator('#dailyRoleReaction').textContent()).includes('测试角色'), 'Character should respond after daily luck is revealed');
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
