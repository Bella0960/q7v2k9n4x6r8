// Actual Chromium checkout acceptance on a disposable local same-origin server.
// Virtual money only, no live accounts, external API, or production data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const filename = path.resolve(root, pathname);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const bytes = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(bytes);
  } catch (error) {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {})
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/wallet/shop.html';
  async function purchase({ paymentMethod, initialData = {}, width }) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1
    });
    try {
      await context.addInitScript(data => {
        for (const [key, value] of Object.entries(data)) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }, initialData);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url, { waitUntil: 'load' });
      // The first listed product costs ¥2099; use the ¥49 pen for the ¥500
      // close-pay allowance, exercising the valid selection rather than quota hiding.
      const itemIndex = paymentMethod === 'close_pay' ? 7 : 0;
      await page.locator('#productGrid .product').nth(itemIndex).click();
      await page.getByRole('button', { name: 'BUY NOW' }).click();
      assert.equal(await page.locator('#payView').isVisible(), true);
      assert.equal(await page.evaluate(() => !!navigator.locks?.request), true,
        'real Chromium on localhost must provide cross-tab Web Locks');
      if (paymentMethod === 'close_pay') {
        await page.locator('#payMethods [data-method="close_pay"]').click();
      } else {
        await page.locator('#payMethods [data-method="normal"]').click();
      }
      await page.locator('#payView .buy-btn').click();
      await page.waitForFunction(() => document.getElementById('receiptBox')?.classList.contains('show'),
        { timeout: 8000 });

      const state = await page.evaluate(() => {
        const parse = key => {
          const value = localStorage.getItem(key);
          return value == null ? null : JSON.parse(value);
        };
        return {
          selectedProduct: document.getElementById('detailName')?.textContent || '',
          orders: parse('shop_orders'), finance: parse('finance_records'),
          wallet: parse('workData'), closePay: parse('close_pay'),
          receipts: parse('maomao_wallet_pending_checkouts_v1'),
          chat: parse('chat_history_qa-role'),
          receiptVisible: document.getElementById('receiptBox')?.classList.contains('show')
        };
      });
      assert.equal(state.receiptVisible, true);
      assert.equal(state.orders?.length, 1, 'one visible purchase must create exactly one order');
      assert.equal(state.finance?.length, 1, 'one-item order must create exactly one finance line');
      assert.equal(state.receipts?.length, 1);
      assert.equal(state.receipts[0].status, 'completed');
      assert.equal(state.orders[0].paymentId, state.receipts[0].id);
      assert.equal(state.finance[0].paymentId, state.receipts[0].id);
      assert.equal(state.orders[0].payMethod, paymentMethod);
      assert.equal(state.orders[0].total, state.finance[0].amount);
      assert.deepEqual(errors, [], 'shop inline and imported scripts must have no uncaught browser errors');

      if (paymentMethod === 'close_pay') {
        const amount = state.orders[0].total;
        assert.equal(state.wallet?.balance, 1000 - amount, 'close-pay wallet charged exactly once');
        assert.equal(state.wallet?.history?.length, 1);
        assert.equal(state.wallet.history[0].paymentId, state.receipts[0].id);
        assert.equal(state.closePay?.used, amount);
        assert.equal(state.closePay?.history?.length, 1);
        assert.equal(state.closePay.history[0].paymentId, state.receipts[0].id);
        assert.equal(state.chat?.length, 1);
        assert.equal(state.chat[0].paymentId, state.receipts[0].id);
      } else {
        assert.equal(state.wallet, null, 'normal simulated payment must not touch close-pay wallet');
        assert.equal(state.chat, null);
      }

      console.log('PASS Chromium ' + width + 'px ' + paymentMethod +
        ' shop checkout: order, finance journal, receipt, wallet and chat persistence');
    } finally {
      await context.close();
    }
  }

  await purchase({ paymentMethod: 'normal', width: 390 });
  await purchase({
    paymentMethod: 'close_pay', width: 430,
    initialData: {
      workData: { balance: 1000, history: [] },
      close_pay: {
        enabled: true,
        roleId: 'qa-role',
        roleName: 'QA Role',
        limit: 500, used: 0, history: []
      }
    }
  });
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
