import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'wallet', 'takeout.html');
const source = await readFile(PAGE, 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `未找到起始标记：${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end >= 0, `未找到结束标记：${endMarker}`);
  return source.slice(start, end);
}

const doPaySource = sliceBetween('function doPay()', '// ===== 转发给TA =====');
const forwardSource = sliceBetween("document.getElementById('forwardList').addEventListener", '// ===== 初始化 =====');
const saveCartSource = sliceBetween('function saveCart()', 'function getCharacters()');
const clearCartSource = sliceBetween('function clearCart()', 'function openCart()');

test('订单保存失败：带上下文报错、提示失败并阻断成功流程', () => {
  const orderCatch = doPaySource.indexOf("console.error('[takeout] 订单保存失败'");
  assert.ok(orderCatch >= 0, '订单写入失败必须有带上下文的 console.error');
  const failBlock = doPaySource.slice(orderCatch, orderCatch + 260);
  assert.match(failBlock, /failPay\('订单保存失败，请重试；购物车已保留'\)/);
  assert.match(failBlock, /return;/, '订单保存失败必须 return，不能继续清购物车/提示成功');

  const block = doPaySource.slice(orderCatch, doPaySource.indexOf('// 5.', orderCatch));
  assert.doesNotMatch(block, /cart\s*=\s*\{\}/, '订单失败分支不得清空购物车');
  assert.doesNotMatch(block, /closeCheckout\(\)/, '订单失败分支不得关闭确认弹窗');
  assert.doesNotMatch(block, /下单成功/, '订单失败分支不得提示下单成功');
});

test('成功提示位于订单落库与购物车清空成功之后', () => {
  const orderWrite = doPaySource.indexOf("localStorage.setItem('takeout_orders'");
  const successToast = doPaySource.indexOf("toast('下单成功");
  assert.ok(orderWrite >= 0, '必须写入 takeout_orders');
  assert.ok(successToast > orderWrite, '下单成功提示必须晚于订单写入');

  const successPath = doPaySource.slice(orderWrite, successToast);
  assert.match(successPath, /attempt\.orderSaved = true/);
  assert.match(successPath, /var cartCleared = saveCart\(\)/);
  assert.match(successPath, /if \(!cartCleared\)[\s\S]*?return;/, '购物车清空失败时不得继续提示下单成功');
});

test('同一次提交重试复用 ts，不会生成两条订单', () => {
  assert.match(
    doPaySource,
    /orders\.some\(function \(o\) \{ return o && o\.ts === attempt\.ts; \}\)/,
    '写订单前必须按同一次提交的 ts 去重'
  );
  assert.match(doPaySource, /payAttempt = \{ signature: signature, ts: Date\.now\(\)/);
  assert.match(doPaySource, /payAttempt = null;/);
});

test('转发失败不关闭弹窗、不提示已转发', () => {
  const forwardCatch = forwardSource.indexOf("console.error('[takeout] 转发消息保存失败");
  assert.ok(forwardCatch >= 0, '转发写入失败必须有带上下文的 console.error');
  const guard = forwardSource.slice(forwardSource.indexOf('if (!forwarded)'), forwardSource.indexOf('if (!forwarded)') + 160);
  assert.match(guard, /toast\('转发失败，消息未保存/);
  assert.match(guard, /return;/);
  assert.ok(forwardSource.indexOf("toast('已转发给") > forwardSource.indexOf('if (!forwarded)'));
});

test('购物车保存失败时如实提示并保留内存态，不谎报已清空', () => {
  assert.match(saveCartSource, /return ok;/);
  assert.match(clearCartSource, /if \(!saveCart\(\)\)/);
  const failBranch = clearCartSource.slice(clearCartSource.indexOf('if (!saveCart())'), clearCartSource.indexOf("toast('购物车已清空')"));
  assert.match(failBranch, /cart = prevCart/);
  assert.match(failBranch, /return;/, '清空失败必须中止，不得继续提示“购物车已清空”');
});

test('失败路径不再使用空 catch 吞异常', () => {
  const catches = [...source.matchAll(/catch\s*\(\s*\w*\s*\)\s*\{([\s\S]*?)\}/g)];
  assert.ok(catches.length > 0);
  for (const match of catches) {
    assert.match(match[1], /console\.(error|warn)/, `catch 块缺少日志：${match[0].slice(0, 80)}`);
  }
});

test('真实页面：订单写入失败时不下单成功、不清空购物车、不关闭弹窗', async (t) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    t.skip(`未安装 playwright：${e.message}`);
    return;
  }

  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.join(ROOT, pathname.replace(/^\/+/, '') || 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/wallet/takeout.html`;

  let browser = null;
  try {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch (e) {
      t.skip(`本机无可用 Edge/Chromium：${e.message.split('\n')[0]}`);
      return;
    }

    const page = await browser.newPage();
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'takeout_orders') throw new DOMException('模拟存储失败', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.shop-card').first().click();
    await page.locator('.add-btn').first().click();
    await page.locator('#checkoutBtn').click();
    await page.locator('#checkoutOverlay.open').waitFor();
    await page.locator('#checkoutOverlay .primary-btn').first().click();
    await page.locator('#toast.show').waitFor();

    const toast = await page.locator('#toast').textContent();
    assert.match(toast, /订单保存失败/, '应出现订单保存失败提示');
    assert.doesNotMatch(toast, /下单成功/, '订单未落库不得提示下单成功');
    assert.ok(await page.locator('#checkoutOverlay.open').count(), '确认订单弹窗应保持打开');
    assert.ok((await page.locator('#cartBadge2').textContent()).trim(), '购物车徽标应保留商品');
    assert.equal(await page.evaluate(() => localStorage.getItem('takeout_orders')), null, '订单不得落库');
    assert.equal(await page.evaluate(() => localStorage.getItem('finance_records')), null, '记账应回滚');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
