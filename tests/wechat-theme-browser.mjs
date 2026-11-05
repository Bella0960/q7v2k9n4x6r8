import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4187;
const origin = 'http://127.0.0.1:' + port;
const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error('Vite exited before ready');
    try {
      const response = await fetch(origin + '/index.html');
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error('Vite server did not become ready');
}

const pages = [
  ['chat home', '/chat/chat/chat.html'],
  ['chat detail', '/chat/chat/chat-detail.html?id=wechat-theme-smoke'],
  ['contacts', '/chat/contacts/contacts.html'],
  ['Moments', '/chat/moments/moments.html'],
  ['Me profile', '/profile/profile.html']
];

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [375, 390, 430]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      });
      await context.addInitScript(() => {
        localStorage.setItem('maomao_chat_theme_preset', 'wechat');
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));

      for (const [label, path] of pages) {
        await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.phone-mockup[data-chat-theme-preset="wechat"]', { timeout: 15000 });
        // native-feel animates the document root for 120ms on page entry.
        // Measure the stable phone layout, not the temporary translated frame.
        await page.waitForFunction(() => {
          const root = document.documentElement;
          return !root.classList.contains('nf-enter')
            && !root.classList.contains('nf-hide');
        }, null, { timeout: 2000 });
        const metrics = await page.evaluate(() => {
          const shell = document.querySelector('.phone-mockup');
          const viewportWidth = document.documentElement.clientWidth;
          const overflowElements = Array.from(document.querySelectorAll('body *'))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                cssWidth: style.width,
                minWidth: style.minWidth,
                padding: style.padding,
                margin: style.margin,
                position: style.position,
                transform: style.transform,
                display: style.display,
                visibility: style.visibility
              };
            })
            .filter((item) => item.display !== 'none' && item.visibility !== 'hidden'
              && (item.right > viewportWidth + 1 || item.left < -1))
            .sort((a, b) => b.right - a.right)
            .slice(0, 25);
          const overflowContainers = Array.from(document.querySelectorAll('*'))
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                overflowX: getComputedStyle(element).overflowX
              };
            })
            .slice(0, 30);
          const pseudoElements = ['html::before', 'html::after', 'body::before', 'body::after']
            .map((selector) => {
              const element = selector.startsWith('html') ? document.documentElement : document.body;
              const pseudo = getComputedStyle(element, selector.endsWith('before') ? '::before' : '::after');
              return {
                selector,
                content: pseudo.content,
                display: pseudo.display,
                position: pseudo.position,
                left: pseudo.left,
                right: pseudo.right,
                width: pseudo.width,
                transform: pseudo.transform
              };
            });
          const rootChildren = Array.from(document.documentElement.children).map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              id: element.id || '',
              className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth
            };
          });
          return {
            stylesheetCount: document.querySelectorAll('link[href*="wechat-theme-refinements.css"]').length,
            green: getComputedStyle(shell).getPropertyValue('--wechat-green').trim(),
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            viewportWidth,
            rootLeft: document.documentElement.getBoundingClientRect().left,
            rootRight: document.documentElement.getBoundingClientRect().right,
            overflowElements,
            overflowContainers,
            pseudoElements,
            rootChildren
          };
        });
        assert.equal(metrics.stylesheetCount, 1, label + ' loads the WeChat layer exactly once');
        assert.equal(metrics.green, '#07C160', label + ' receives WeChat theme variables');
        assert.ok(metrics.documentWidth <= width + 1, label + ' document overflow: ' + JSON.stringify(metrics));
        assert.ok(metrics.bodyWidth <= width + 1, label + ' body overflow: ' + JSON.stringify(metrics));

        if (label === 'chat detail') {
          const send = page.locator('#myFloatSend');
          await send.waitFor({ state: 'visible', timeout: 10000 });
          const wechatSend = await send.evaluate(el => ({
            background: getComputedStyle(el).backgroundColor,
            radius: getComputedStyle(el).borderRadius,
            icon: !!el.querySelector('svg')
          }));
          assert.equal(wechatSend.background, 'rgb(7, 193, 96)', 'WeChat send button is green');
          assert.equal(wechatSend.radius, '6px', 'WeChat send button uses the square-corner treatment');
          assert.equal(wechatSend.icon, true, 'WeChat send button renders its send icon');

          await page.evaluate(() => {
            localStorage.setItem('maomao_chat_theme_preset', 'default');
            window.dispatchEvent(new Event('maomao:chat-theme-change'));
          });
          await page.waitForFunction(() => {
            const shell = document.querySelector('.phone-mockup');
            const sendButton = document.getElementById('myFloatSend');
            return shell?.getAttribute('data-chat-theme-preset') === 'default'
              && sendButton && getComputedStyle(sendButton).borderRadius === '50%';
          });
          const defaultSend = await send.evaluate(el => ({
            background: getComputedStyle(el).backgroundColor,
            radius: getComputedStyle(el).borderRadius
          }));
          assert.equal(defaultSend.background, 'rgb(255, 255, 255)', 'default theme keeps the original white floating control');
          assert.equal(defaultSend.radius, '50%', 'default theme keeps its original round send control');
        }
        process.stdout.write('PASS WeChat ' + label + ' @ ' + width + 'px\n');
      }

      assert.deepEqual(pageErrors, [], width + 'px theme pages should not throw runtime errors');
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  vite.kill('SIGTERM');
}
