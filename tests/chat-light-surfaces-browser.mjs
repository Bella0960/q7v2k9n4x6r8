/** Real Chromium smoke against the built Vite app (not a stand-alone fixture).
 * Run after npm run build. The script starts its own local preview; no live API/data.
 * BASE_URL may override only with a pre-existing localhost server.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.CHAT_UI_QA_PORT || 34279);
const base = process.env.BASE_URL || 'http://127.0.0.1:' + PORT + '/';
const parsedBase = new URL(base);
if (parsedBase.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(parsedBase.hostname)) {
  throw new Error('CHAT-UI-001 browser smoke only accepts a local preview origin');
}

let server, browser;
async function startPreview() {
  if (process.env.BASE_URL) return;
  const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  server = spawn(process.execPath,
    [vite.pathname, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = new URL('chat/chat/chat.html', base);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Local Vite preview exited early');
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(600) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Local Vite preview did not become ready');
}

try {
  await startPreview();
  browser = await chromium.launch({ headless: true,
    ...(process.env.MAOMAO_CHROMIUM_PATH
      ? { executablePath: process.env.MAOMAO_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  for (const width of [375, 390, 430, 1280]) {
    for (const theme of ['default', 'imessage']) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: width <= 430, hasTouch: width <= 430,
        serviceWorkers: 'block'
      });
      // Never call any production/QA AI, account, push or wallet endpoint.
      await context.route('**/*', route =>
        route.request().url().startsWith(parsedBase.origin + '/')
          ? route.continue() : route.abort());
      await context.addInitScript(themePreset => {
        localStorage.setItem('maomao_chat_theme_preset', themePreset);
        localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'light-qa', name: '测试角色' }]));
        localStorage.setItem('chat_history_light-qa', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 ? 'user' : 'received',
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

        // A page shell alone is not sufficient: verify the actual character and both directions of history.
        await page.waitForFunction(() => {
          const title = document.getElementById('chat-title');
          return title && title.textContent.trim() === '测试角色' && document.querySelectorAll('#chat-messages .msg-row').length >= 20;
        }, null, { timeout: 5000 });
        assert.ok(await page.locator('#chat-messages .msg-row.sent').count() >= 8, 'seeded sent messages must render');
        assert.ok(await page.locator('#chat-messages .msg-row.received').count() >= 8, 'seeded received messages must render');
        const shellBox = await page.locator('.phone-mockup').boundingBox();
        const header = await page.locator('.chat-header').boundingBox();
        assert.ok(header.y - shellBox.y < 30, 'header must start near top, not under fake status area');
        assert.ok(header.height < 96, 'header must stay slim');
        if (theme === 'imessage') {
          assert.equal(await page.locator('.chat-title-box').evaluate(e => getComputedStyle(e).position), 'static', 'title must participate in the slim header layout');
          assert.equal(await page.locator('#chat-header-avatar').evaluate(e => getComputedStyle(e).display), 'none', 'large header portrait must not increase the top bar');
          assert.notEqual(await page.locator('#chat-status-sub').evaluate(e => getComputedStyle(e).display), 'none', 'online/offline mode entry stays available');
        }
        assert.ok((await page.locator('#btn-more-menu').boundingBox()).width >= 40, 'more menu has a generous touch area');
        const stagePadding = await page.locator('#chat-messages').evaluate(e => parseFloat(getComputedStyle(e).paddingBottom));
        assert.ok(stagePadding < 48, 'stage must not keep the legacy 82px composer overlay gap');

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
        assert.ok(plus.width >= 44, 'plus target must be at least 44px wide');
        assert.ok((await send.boundingBox()).width >= 44, 'send target must be at least 44px wide');
        await page.locator('#plus-action-btn').click();
        await page.locator('.plus-panel-sheet').waitFor({ state: 'visible' });
        if (theme === 'imessage') {
          const panelAppearance = await page.locator('.plus-panel-sheet').evaluate(el => {
            const styles = getComputedStyle(el);
            return { blur: styles.backdropFilter, background: styles.backgroundColor };
          });
          assert.equal(panelAppearance.blur, 'none', 'iMessage more panel must not inherit frosted glass');
          assert.equal(panelAppearance.background, 'rgb(255, 255, 255)', 'iMessage more panel stays paper white');
        }
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log(width + 'px / ' + theme + ': header, status bar, overflow, input and features passed');
      } finally {
        await context.close();
      }
    }
  }
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
}
