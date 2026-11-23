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
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
