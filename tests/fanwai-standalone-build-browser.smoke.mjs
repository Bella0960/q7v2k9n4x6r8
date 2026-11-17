/**
 * 番外独立桌面应用的构建产物手机视口烟测。
 * 仅使用本地 dist、合成角色、模型 mock；不访问任何真实模型、管理员或生产账号。
 * 三种尺寸都是 Chromium 触摸模拟，不能替代 Android/iPhone 真机验收。
 *
 * 运行：npm run build && node tests/fanwai-standalone-build-browser.smoke.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(new URL('../dist/', import.meta.url).pathname);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const required = [
  'fanwai/fanwai.html', 'fanwai/fanwai-app.js', 'fanwai/fanwai.css',
  'chat/chat/js/chat-fanwai.js', 'chat/chat/js/chat-fanwai.css',
  'shared/js/phone/phone_storage.js', 'shared/js/phone/phone_api.js'
];
for (const file of required) {
  assert.ok(existsSync(resolve(ROOT, file)), 'Vite/postbuild 未包含: ' + file);
}

function startLocalServer() {
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    const file = resolve(ROOT, '.' + pathname);
    const rel = relative(ROOT, file);
    if (rel.startsWith('..') || rel === '' || rel.startsWith('/')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}
const role = {
  id: 'genuine_character_123', name: '番外合成角色',
  persona: '普通朋友，工作是图书管理员，说话简短而自然。'
};
let server, browser;
try {
  server = await startLocalServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MAOMAO_CHROMIUM_PATH ? { executablePath: process.env.MAOMAO_CHROMIUM_PATH } : {})
  });
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 812 }, isMobile: true, hasTouch: true,
      serviceWorkers: 'block'
    });
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      return route.abort('blockedbyclient'); // 必须离线隔离外部 API
    });
    await context.addInitScript(testRole => {
      // 合成帐号只作为本地 IDB 持久化测试标记，不连接真实 Worker。
      window.__MAO_ACCOUNT_SCOPE__ = { ready: true, accountId: 'MAO-AAAAAAAAAAAA' };
      localStorage.setItem('ai_custom_characters', JSON.stringify([testRole]));
      localStorage.setItem('myProfile', JSON.stringify({ nickname: '测试用户' }));
    }, role);
    await context.route('**/fanwai/fanwai.html*', async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        /<head>/i,
        '<head><meta name="mao-account-id" content="MAO-AAAAAAAAAAAA">'
      );
      await route.fulfill({ response, body: html });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    try {
      await page.goto(origin + '/fanwai/fanwai.html', { waitUntil: 'load' });
      assert.equal(await page.locator('#fanwaiRolePicker .fw-role-row').count(), 1);
      assert.equal(await page.locator('.status-bar').count(), 0, '绝不能叠加假的手机状态栏');
      assert.equal(await page.locator('.fw-app-header').evaluate(e => Math.round(e.getBoundingClientRect().height)), 44);
      await page.locator('.fw-role-row').click();
      await page.locator('#fanwaiLayer .fw-card').first().waitFor({ state: 'visible' });
      // Independent app must surface errors to the user rather than console-only logs.
      await page.evaluate(() => window.showToast('番外测试提示'));
      await page.locator('#fanwaiNotice').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#fanwaiNotice').textContent(), '番外测试提示');
      assert.equal(await page.locator('#fanwaiLayer .fw-card').count(), 6);
      const sheet = page.locator('#fanwaiLayer .fw-sheet');
      const fit = await sheet.evaluate(el => {
        const r = el.getBoundingClientRect();
        // 新版原生引擎用内部薄头；QA 老引擎兼容适配用外层 44px 导航。
        const legacyQa = el.closest('#fanwaiLayer')?.classList.contains('fw-legacy-engine');
        const head = legacyQa
          ? document.querySelector('.fw-bridge-nav') : el.querySelector('.fw-head');
        return {
          top: r.top, bottom: r.bottom, width: r.width,
          viewW: innerWidth, viewH: innerHeight, overflow: el.scrollWidth > el.clientWidth + 1,
          headerHeight: head ? Math.round(head.getBoundingClientRect().height) : -1,
          legacyQa: !!legacyQa
        };
      });
      assert.equal(fit.overflow, false, width + ': 不可横向溢出');
      assert.ok(fit.width <= width + 1, width + ': 整页宽度异常');
      assert.ok(fit.bottom <= fit.viewH + 1, width + ': 整页高度异常');
      assert.equal(fit.headerHeight, 44, width + ': 顶栏必须轻薄（原生/兼容模式）' + JSON.stringify(fit));
      // 阻止真实请求：模型只执行此页注入的本地测试实现。
      await page.evaluate(() => {
        window.__fanwaiMockCalls = 0;
        if (!window.PhoneAPI || !window.PhoneStorage) throw Error('基础 Phone 模块未加载');
        window.PhoneStorage.getApiConfig = () => ({
          apiKey: 'LOCAL-NO-BILLING', model: 'fake', maxTokens: 1600
        });
        window.PhoneAPI.completeJSON = async options => {
          window.__fanwaiMockCalls++;
          const requested = Number(options.system.match(/本轮只创作恰好 (\d+) 条/)?.[1] || 0);
          if (!requested || requested > 25) throw Error('invalid generated batch');
          return { ok: true, data: { messages: Array.from({ length: requested }, (_, i) => ({
            role: i % 2 ? 'char' : 'user',
            text: '番外手机测试 ' + window.__fanwaiMockCalls + '-' + i
          })) } };
        };
      });
      const before = await page.evaluate(id => localStorage.getItem('chat_history_' + id), role.id);
      await page.locator('.fw-card').first().click();
      await page.locator('[data-action="toggle-settings"]').click();
      await page.locator('#fw-preview-count').selectOption('40');
      assert.equal(await page.evaluate(() => window.__fanwaiMockCalls), 0, '预览不能消耗 API');
      await page.locator('[data-action="start-template"]').click();
      await page.waitForFunction(() =>
        document.querySelectorAll('#fanwaiLayer .fw-bubble').length === 40, null, { timeout: 30000 });
      assert.equal(await page.locator('#fanwaiLayer .fw-bubble').count(), 40);
      assert.ok((await page.evaluate(() => window.__fanwaiMockCalls)) >= 4);
      assert.equal(await page.evaluate(id => localStorage.getItem('chat_history_' + id), role.id),
        before, '番外不能改动原聊天记录');
      const reading = await page.locator('.fw-sheet.fw-reading').evaluate(el => ({
        widthOverflow: el.scrollWidth > el.clientWidth + 1,
        visibleChat: el.querySelector('.fw-messages').clientHeight,
        footerBottom: el.querySelector('.fw-actions').getBoundingClientRect().bottom,
        sheetBottom: el.getBoundingClientRect().bottom
      }));
      assert.equal(reading.widthOverflow, false);
      assert.ok(reading.visibleChat >= 120, '阅读区不能被上下栏挤压');
      assert.ok(reading.footerBottom <= reading.sheetBottom + 1, '底栏不得遮挡阅读区');
      // 在相同合成账号的同一浏览器上下文里重新载入，旧番外仍必须能找到。
      await page.reload({ waitUntil: 'load' });
      await page.locator('.fw-card').first().waitFor({ state: 'visible' });
      await page.locator('.fw-saved-row').first().waitFor({ state: 'visible' });
      await page.locator('.fw-saved-row').first().click();
      assert.equal(await page.locator('.fw-bubble').count(), 40);
      // 返回键真的回到目录，不能把读者直接踢回角色选择。
      const legacyQa = await page.locator('#fanwaiLayer.fw-legacy-engine').count() > 0;
      const back = legacyQa
        ? page.locator('.fw-bridge-nav .fw-app-back')
        : page.locator('.fw-reading .fw-head [data-action="back"]');
      assert.equal(await back.count(), 1, '阅读页左上角必须是返回目录');
      await back.click();
      await page.locator('#fanwaiLayer .fw-card').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('#fanwaiLayer .fw-card').count(), 6);
      await page.locator('#fanwaiLayer .fw-card').first().click();
      const roleSwitch = legacyQa
        ? page.locator('.fw-bridge-nav .fw-app-switch')
        : page.locator('.fw-preview .fw-head [data-action="switch-role"]');
      assert.equal(await roleSwitch.count(), 1);
      // QA 兼容层只在目录显示切换角色，先使用 QA 自己的安全 back。
      if (legacyQa) {
        await page.locator('.fw-bridge-nav .fw-app-back').click();
        await page.locator('#fanwaiLayer .fw-card').first().waitFor({ state: 'visible' });
      }
      await roleSwitch.click();
      await page.locator('#fanwaiRolePicker .fw-role-row').first().waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).searchParams.has('id'), false, '切换角色后不应保留旧 id');
      assert.deepEqual(errors, [], width + ': 浏览器发生脚本异常');
      // 错账号 HTML 不得看到角色，亦不得装载故事引擎。
      const guarded = await context.newPage();
      try {
        await guarded.route('**/fanwai/fanwai.html*', async route => {
          const response = await route.fetch();
          const original = await response.text();
          const blocked = original.replace(/<head>/i,
            '<head><meta name="mao-account-id" content="MAO-BBBBBBBBBBBB">');
          await route.fulfill({ response, body: blocked });
        });
        await guarded.goto(origin + '/fanwai/fanwai.html', { waitUntil: 'load' });
        assert.match(await guarded.locator('.fw-role-title').textContent(),
          /暂时无法打开番外/, '错账号必须给出可见的安全错误');
        assert.equal(await guarded.locator('.fw-role-row').count(), 0,
          '错账号禁止显示任何角色入口');
        assert.equal(await guarded.locator('#fanwaiLayer').count(), 0,
          '错账号禁止初始化故事引擎');
      } finally {
        await guarded.close();
      }
      console.log('PASS standalone Chromium touch ' + width + 'x812: ' +
        JSON.stringify({ thinHeader: 44, templates: 6, messages: 40, persistedAfterReload: true, offlineMock: true }));
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
}
