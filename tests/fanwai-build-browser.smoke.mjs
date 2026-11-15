/**
 * MAOMAO 番外真实浏览器烟测：在 npm run build 的 dist 上验证经典脚本加载、
 * 手机触控、模板/折叠设置与不联网的 40 条模拟生成。
 *
 * 不触碰线上域名、账号和真实模型；使用本地 HTTP + Playwright Chromium。
 * Android/iPhone 是视口模拟，不冒充 Safari 或 Android 真机。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};
const REQUIRED = [
  'chat/chat/chat-detail.html',
  'chat/chat/js/chat-extras.js',
  'chat/chat/js/chat-fanwai.js',
  'chat/chat/js/chat-fanwai.css',
  'shared/js/phone/phone_api.js'
];

for (const asset of REQUIRED) {
  assert.ok(existsSync(resolve(ROOT, asset)),
    'Build output is missing ' + asset + '; run npm run build (including postbuild) first');
}

function serveDist() {
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('bad path'); return; }
    const file = resolve(ROOT, '.' + pathname);
    const rel = relative(ROOT, file);
    if (rel.startsWith('..') || rel === '' || rel.startsWith('/')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  return new Promise(resolveServer => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

const widths = [
  { label: 'Android-size Chromium', width: 390, height: 844 },
  { label: 'iPhone-size Chromium (NOT Safari)', width: 375, height: 812 }
];
const seedRole = {
  id: 'fanwai_smoke_role', name: '番外验收角色',
  persona: '朋友关系，简短自然地聊天，认真回应日常生活细节。',
  createdAt: 1
};
let browser, server;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MAOMAO_CHROMIUM_PATH
      ? { executablePath: process.env.MAOMAO_CHROMIUM_PATH } : {})
  });
  server = await serveDist();
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const viewport of widths) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const missingCritical = [];
    page.on('response', response => {
      if (REQUIRED.some(asset => response.url().includes('/' + asset)) && response.status() >= 400)
        missingCritical.push(response.url() + ' HTTP ' + response.status());
    });
    await context.addInitScript(role => {
      if (localStorage.getItem('ai_custom_characters') === null)
        localStorage.setItem('ai_custom_characters', JSON.stringify([role]));
      if (localStorage.getItem('myProfile') === null)
        localStorage.setItem('myProfile', JSON.stringify({ nickname: '测试用户' }));
    }, seedRole);
    try {
      const response = await page.goto(
        origin + '/chat/chat/chat-detail.html?id=' + encodeURIComponent(seedRole.id),
        { waitUntil: 'domcontentloaded', timeout: 25000 }
      );
      assert.equal(response?.status(), 200, viewport.label + ': chat HTML must load');
      const entry = page.locator('#plusPanelOverlay .plus-grid [data-feat="fanwai"]');
      await entry.waitFor({ state: 'attached', timeout: 20000 });
      assert.equal(await entry.count(), 1, 'exactly one entry in existing plus menu');
      await page.locator('#plus-action-btn').click();
      await entry.click();
      const sheet = page.locator('#fanwaiLayer .fw-sheet');
      await sheet.waitFor({ state: 'visible' });
      await page.locator('#fanwaiLayer .fw-card').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('#fanwaiLayer .fw-card').count(), 6);
      const geometry = await sheet.evaluate(el => {
        const box = el.getBoundingClientRect();
        return {
          left: box.left, right: box.right, viewport: innerWidth,
          overflowX: el.scrollWidth > el.clientWidth + 1
        };
      });
      assert.ok(geometry.left >= -1 && geometry.right <= viewport.width + 1,
        viewport.label + ': sheet must stay within mobile viewport ' + JSON.stringify(geometry));
      assert.equal(geometry.overflowX, false, viewport.label + ': sheet must not overflow horizontally');

      await page.evaluate(() => {
        window.__fanwaiMockCalls = 0;
        assertPhoneAPI();
        function assertPhoneAPI() {
          if (!window.PhoneAPI || !window.PhoneStorage) throw Error('Real PhoneAPI did not load');
        }
        window.PhoneStorage.getApiConfig = () => ({
          apiKey: 'SMOKE-ONLY-NO-NETWORK', model: 'mock', maxTokens: 1600
        });
        window.PhoneAPI.completeJSON = async options => {
          window.__fanwaiMockCalls++;
          const requested = Number(options.system.match(/本轮只创作恰好 (\d+) 条/)?.[1] || 0);
          if (!requested || requested > 25) throw Error('Bad model batch: ' + requested);
          return {
            ok: true, data: {
              messages: Array.from({ length: requested }, (_, i) => ({
                role: i % 2 ? 'char' : 'user',
                text: '本地番外验收 ' + window.__fanwaiMockCalls + '/' + i
              }))
            }
          };
        };
      });
      const previousChat = await page.evaluate(id =>
        localStorage.getItem('chat_history_' + id), seedRole.id);

      await page.locator('#fanwaiLayer .fw-card').first().click();
      await page.locator('#fanwaiLayer .fw-preview-cover').waitFor({ state: 'visible' });
      const settingsToggle = page.locator('#fanwaiLayer [data-action="toggle-settings"]');
      await settingsToggle.click();
      assert.equal(await page.locator('#fanwaiLayer .fw-settings-drawer').isVisible(), true);
      await page.locator('#fw-preview-count').selectOption('40');
      await page.locator('#fanwaiLayer [data-action="start-template"]').click();
      await page.waitForFunction(() =>
        document.querySelectorAll('#fanwaiLayer .fw-bubble').length === 40,
        null, { timeout: 25000 }
      );
      const result = await page.evaluate(id => ({
        messages: document.querySelectorAll('#fanwaiLayer .fw-bubble').length,
        calls: window.__fanwaiMockCalls,
        chatHistory: localStorage.getItem('chat_history_' + id)
      }), seedRole.id);
      assert.equal(result.messages, 40);
      assert.ok(result.calls >= 4 && result.calls <= 18, 'generation must be batched');
      assert.equal(result.chatHistory, previousChat,
        'fanwai must not silently alter the real chat message history');
      assert.deepEqual(missingCritical, [], 'required built resources cannot return HTTP errors');
      console.log('PASS ' + viewport.label + ' ' + JSON.stringify({
        viewport: viewport.width + 'x' + viewport.height,
        templateCards: 6, messages: result.messages, modelMockCalls: result.calls,
        noRealApi: true, noMainChatMutation: true
      }));
    } finally {
      await context.close();
    }
  }
  console.log('PASS: built fanwai browser smoke completed (Chromium mobile emulation only).');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
}
