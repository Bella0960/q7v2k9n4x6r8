// Run against an installed source/build server: BASE_URL=http://localhost:3000 node tests/chat-light-surfaces-browser.mjs
// Uses synthetic roles only; default + iMessage at real mobile viewports.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch();
try {
  for (const width of [375, 390, 430, 1280]) {
    for (const theme of ['default', 'imessage']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.addInitScript(themePreset => {
        localStorage.setItem('maomao_chat_theme_preset', themePreset);
        localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'light-qa', name: '测试角色' }]));
        localStorage.setItem('chat_history_light-qa', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 ? 'user' : 'assistant',
          text: i === 28 ? '长消息用于检查换行。'.repeat(20) : '测试消息 ' + i,
          time: Date.now() - 60000 + i * 1000
        }))));
      }, theme);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        for (const path of ['chat/chat/chat.html', 'chat/chat/chat-detail.html?id=light-qa']) {
          await page.goto(new URL(path, base).href);
          await page.waitForTimeout(650);
          const shell = page.locator('.phone-mockup');
          assert.equal(await shell.evaluate(e => getComputedStyle(e).borderTopWidth), '0px');
          assert.equal(await shell.evaluate(e => getComputedStyle(e).boxShadow), 'none');
          assert.equal(await page.locator('.phone-mockup > .status-bar').evaluate(e => getComputedStyle(e).display), 'none', 'native system chrome, not a fake status bar');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
        }

        const shellBox = await page.locator('.phone-mockup').boundingBox();
        const header = await page.locator('.chat-header').boundingBox();
        assert.ok(header.y - shellBox.y < 30, 'header must start near top, not under fake status area');
        assert.ok(header.height < 96, 'header must stay slim');

        assert.equal(await page.locator('#myFloatSend').count(), 0, 'no duplicate floating send');
        const send = page.locator('#chat-form .send-icon-btn');
        if (theme === 'imessage') {
          assert.equal(await send.evaluate(e => getComputedStyle(e).display), 'none', 'iMessage shows voice until text is entered');
        }
        await page.locator('#chat-input').fill('检查输入框换行\n第二行\n第三行');
        assert.equal(await send.evaluate(e => getComputedStyle(e).display), 'flex', 'native send must appear on text input');
        const stage = await page.locator('#chat-messages').boundingBox();
        const form = await page.locator('#chat-form').boundingBox();
        const plus = await page.locator('#plus-action-btn').boundingBox();
        assert.ok(stage.y + stage.height <= form.y + 1, 'composer must not cover messages');
        assert.ok(form.y <= plus.y && plus.y + plus.height <= form.y + form.height + 1, 'plus button stays inside the input row');
        await page.locator('#plus-action-btn').click();
        await page.locator('.plus-panel-sheet').waitFor({ state: 'visible' });
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log(width + 'px / ' + theme + ': header, status bar, overflow, input and features passed');
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
