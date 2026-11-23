import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4179';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  const url = origin + '/cafe/cafe.html';
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch(url).then(response => response.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  for (const width of [375, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const option = page.locator('#view-overview [data-event]:enabled').first();
    const choice = Number(await option.getAttribute('data-event'));
    await option.tap();
    const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('maomao_cafe_state_v1')));
    const state = await readState();
    assert.equal(state.eventChoice, choice);
    assert.equal(state.partnerDecision.choice, choice);
    const partner = state.partnerProfiles[state.partnerDecision.roleId];
    assert.equal(partner.decisions, 1);
    assert.equal(partner.history[0].choice, state.partnerDecision.choiceTitle);
    await page.reload();
    assert.deepEqual((await readState()).partnerDecision, state.partnerDecision);
    await page.evaluate(() => {
      const key = 'maomao_cafe_state_v1';
      const state = JSON.parse(localStorage.getItem(key));
      state.lifeStats.days = 3;
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await page.locator('header [data-open-cafe="menu"]').tap();
    await page.locator('#cafe-drawer #view-menu').waitFor();
    await page.locator('#cafe-drawer [data-cafe-panel="records"]').tap();
    const reward = page.locator('#cafe-drawer #view-extra [data-growth-claim="days3"]');
    await reward.tap();
    await reward.waitFor({ state: 'detached' });
    const rewarded = await readState();
    assert.equal(rewarded.growthClaims.days3.day, state.day);
    await page.reload();
    assert.deepEqual((await readState()).growthClaims.days3, rewarded.growthClaims.days3);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
