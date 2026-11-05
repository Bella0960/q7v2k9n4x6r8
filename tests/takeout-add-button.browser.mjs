import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * BUG-P1-02：外卖加购按钮被移动端全宽底栏选择器拉长。
 * 真实浏览器验证（本机 Edge，390×844）：
 *   1) .add-btn 必须是 26px 圆形，数量 +/− 可点，角标/件数/合计同步；
 *   2) 刷新、加购、减购、清空、跨店替换、重新进入后状态正确；
 *   3) 其他使用底部固定栏的页面没有位移、压扁或撑高。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const round = (value) => Math.round(value * 100) / 100;

async function readAddButtons(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('#dishList .add-btn')].map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius: style.borderRadius,
        transform: style.transform
      };
    });
  });
}

async function readQty(page) {
  return page.evaluate(() => {
    const ctrl = document.querySelector('#dishList .qty-ctrl');
    if (!ctrl) return null;
    const btns = [...ctrl.querySelectorAll('.qty-btn')].map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return {
      buttons: btns,
      number: ctrl.querySelector('.qty-num') ? ctrl.querySelector('.qty-num').textContent.trim() : ''
    };
  });
}

async function readCart(page) {
  return page.evaluate(() => {
    const badge = document.getElementById('cartBadge');
    const badgeRect = badge.getBoundingClientRect();
    const badgeStyle = getComputedStyle(badge);
    const bar = document.getElementById('cartBar');
    return {
      badgeText: badge.textContent.trim(),
      badgeDisplay: badgeStyle.display,
      badgeVisible: badgeStyle.display !== 'none',
      badgeWidth: badgeRect.width,
      barVisible: bar.style.display !== 'none' && getComputedStyle(bar).display !== 'none',
      barCount: document.getElementById('cartBarCount').textContent.trim(),
      barTotal: document.getElementById('cartBarTotal').textContent.trim()
    };
  });
}

async function openFirstShop(page) {
  await page.locator('.shop-card').first().click();
  await page.waitForSelector('#viewDishes.active .dish-card');
}

async function resetStorage(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'load' });
  await settle(page);
}

async function runTakeoutChecks(page, baseUrl, check) {
  const takeoutUrl = `${baseUrl}/wallet/takeout.html`;
  await resetStorage(page, takeoutUrl);
  await page.waitForSelector('.shop-card');

  // 1) 初始状态：无角标、无底栏、菜品按钮为 26px 圆形
  await openFirstShop(page);
  const initialButtons = await readAddButtons(page);
  check('初始每家菜品都有加购按钮', initialButtons.length > 0, { count: initialButtons.length });
  initialButtons.forEach((item, index) => {
    check(
      `加购按钮 #${index + 1} 为 26px 圆形`,
      Math.abs(item.width - item.height) <= 0.5 && Math.abs(item.width - 26) <= 1 && item.borderRadius === '50%',
      {
        width: round(item.width),
        height: round(item.height),
        borderRadius: item.borderRadius,
        transform: item.transform
      }
    );
  });
  const initialCart = await readCart(page);
  check('初始角标隐藏', initialCart.badgeText === '' && initialCart.badgeVisible === false, initialCart);
  check('初始购物车底栏隐藏', initialCart.barVisible === false, initialCart);

  // 2) 加购：角标、件数、合计同步
  await page.locator('#dishList .add-btn').first().click();
  await page.waitForSelector('#dishList .qty-ctrl');
  const qtyOne = await readQty(page);
  const cartOne = await readCart(page);
  check('加购后数量为 1', qtyOne && qtyOne.number === '1', qtyOne);
  check('加购后数量按钮可点且尺寸正常', qtyOne && qtyOne.buttons.length === 2 &&
    qtyOne.buttons.every((b) => Math.abs(b.width - b.height) <= 0.5 && b.width >= 20 && b.width <= 28), qtyOne);
  check('加购后角标为 1', cartOne.badgeText === '1' && cartOne.badgeVisible === true, cartOne);
  check('加购后底栏件数与合计正确', cartOne.barVisible === true && cartOne.barCount === '1 件' && cartOne.barTotal === '¥16', cartOne);

  // 3) 减购：回到加购按钮，角标与底栏归零
  await page.locator('#dishList .qty-btn').first().click();
  await page.waitForSelector('#dishList .add-btn');
  const cartZero = await readCart(page);
  const afterDecButtons = await readAddButtons(page);
  check('减购后恢复圆形加购按钮', afterDecButtons.length > 0 &&
    Math.abs(afterDecButtons[0].width - 26) <= 1 && Math.abs(afterDecButtons[0].width - afterDecButtons[0].height) <= 0.5,
    { width: round(afterDecButtons[0].width), height: round(afterDecButtons[0].height) });
  check('减购后角标隐藏', cartZero.badgeText === '' && cartZero.badgeVisible === false, cartZero);
  check('减购后底栏隐藏', cartZero.barVisible === false, cartZero);

  // 4) 加两份后刷新：状态从 localStorage 恢复
  await page.locator('#dishList .add-btn').first().click();
  await page.locator('#dishList .qty-btn').nth(1).click();
  const cartTwo = await readCart(page);
  check('加两份后角标为 2', cartTwo.badgeText === '2' && cartTwo.badgeVisible === true, cartTwo);
  check('加两份后合计为 ¥32', cartTwo.barCount === '2 件' && cartTwo.barTotal === '¥32', cartTwo);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.shop-card');
  const cartAfterReload = await readCart(page);
  check('刷新后角标仍为 2', cartAfterReload.badgeText === '2' && cartAfterReload.badgeVisible === true, cartAfterReload);
  check('刷新后底栏件数与合计仍正确', cartAfterReload.barVisible === true &&
    cartAfterReload.barCount === '2 件' && cartAfterReload.barTotal === '¥32', cartAfterReload);
  await openFirstShop(page);
  const qtyAfterReload = await readQty(page);
  check('刷新后重新进店数量仍为 2', qtyAfterReload && qtyAfterReload.number === '2', qtyAfterReload);

  // 5) 从商家详情返回外卖首页，再进入同一家店：状态不丢、不重复加
  await page.locator('#viewDishes .back-btn').click();
  await page.waitForSelector('#viewShops.active');
  const cartBackHome = await readCart(page);
  check('返回首页角标仍为 2', cartBackHome.badgeText === '2' && cartBackHome.badgeVisible === true, cartBackHome);
  await openFirstShop(page);
  const qtyReenter = await readQty(page);
  const cartReenter = await readCart(page);
  check('重新进入同店数量不重复累加', qtyReenter && qtyReenter.number === '2' && cartReenter.badgeText === '2',
    { qty: qtyReenter, cart: cartReenter });

  // 6) 清空购物车
  await page.locator('#viewDishes .cart-icon').click();
  await page.waitForSelector('#cartOverlay.open');
  await page.locator('.cart-clear-btn').click();
  const cleared = await page.evaluate(() => ({
    overlayText: document.getElementById('cartItems').textContent.trim(),
    stored: localStorage.getItem('takeout_cart'),
    shopId: localStorage.getItem('takeout_cart_shop_id')
  }));
  const cartCleared = await readCart(page);
  check('清空后弹层显示空购物车', cleared.overlayText.includes('购物车是空的'), cleared);
  check('清空后存储被移除', (cleared.stored === '{}' || cleared.stored === null) && cleared.shopId === null, cleared);
  check('清空后角标隐藏', cartCleared.badgeText === '' && cartCleared.badgeVisible === false, cartCleared);
  check('清空后底栏隐藏', cartCleared.barVisible === false, cartCleared);

  await page.locator('#cartOverlay .sheet-close').click();
  await page.locator('#viewDishes .back-btn').click();
  await page.waitForSelector('#viewShops.active');

  // 7) 跨店替换：确认后旧购物车清空，只保留新店商品
  await page.locator('.shop-card').first().click();
  await page.waitForSelector('#viewDishes.active .dish-card');
  await page.locator('#dishList .add-btn').first().click();
  await page.locator('#viewDishes .back-btn').click();
  await page.waitForSelector('#viewShops.active');
  await page.locator('.shop-card').nth(1).click();
  await page.waitForSelector('#viewDishes.active .dish-card');
  let dialogMessage = '';
  page.once('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator('#dishList .add-btn').first().click();
  await page.waitForSelector('#dishList .qty-ctrl');
  const crossCart = await readCart(page);
  const crossStore = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('takeout_cart') || '{}');
    return {
      keys: Object.keys(raw),
      shopId: localStorage.getItem('takeout_cart_shop_id'),
      quantities: Object.values(raw).map((item) => item.qty)
    };
  });
  check('跨店加购触发替换确认', dialogMessage.includes('是否清空旧购物车'), { message: dialogMessage });
  check('跨店替换后只剩新店 1 件', crossCart.badgeText === '1' && crossStore.keys.length === 1 &&
    crossStore.quantities[0] === 1 && crossStore.shopId === 's2', { cart: crossCart, store: crossStore });
  check('跨店替换后合计为新店价格 ¥14', crossCart.barCount === '1 件' && crossCart.barTotal === '¥14', crossCart);
}

// native-feel.js 的入场动画会给 html 加 transform，等待动画摘除后再测量。
async function settle(page) {
  await page.waitForTimeout(700);
  await page.waitForFunction(() => {
    const root = document.documentElement;
    return !root.classList.contains('nf-enter') && !root.classList.contains('nf-hide');
  });
}

async function measureElement(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
      position: style.position,
      display: style.display
    };
  }, selector);
}

async function runBottomBarChecks(page, baseUrl, check) {
  const viewport = page.viewportSize();

  // 店铺管理：.add-btn 仍是贴底全宽栏（固定在 body 直属子元素上）
  await page.goto(`${baseUrl}/wallet/shop-admin.html`, { waitUntil: 'load' });
  await page.waitForSelector('body > .add-btn');
  await settle(page);
  const shopAdminBtn = await measureElement(page, 'body > .add-btn');
  check('店铺管理底栏宽度贴合 390 视口', shopAdminBtn && Math.abs(shopAdminBtn.width - viewport.width) <= 0.5,
    { width: shopAdminBtn ? round(shopAdminBtn.width) : null, viewport: viewport.width });
  check('店铺管理底栏仍贴底', shopAdminBtn && Math.abs(shopAdminBtn.bottom - viewport.height) <= 0.5,
    { bottom: shopAdminBtn ? round(shopAdminBtn.bottom) : null, viewport: viewport.height });

  // 自制剧本：.add-btn 是表单内全宽按钮，不应被固定成全屏底栏
  await page.goto(`${baseUrl}/games/story-create.html`, { waitUntil: 'load' });
  await page.waitForSelector('.add-btn');
  await settle(page);
  const storyBtn = await measureElement(page, '.add-btn');
  const storyParent = await page.evaluate(() => {
    const btn = document.querySelector('.add-btn');
    const parent = btn ? btn.parentElement : null;
    return parent ? parent.getBoundingClientRect().width : 0;
  });
  check('自制剧本添加按钮仍是容器内全宽', storyBtn && storyBtn.width < viewport.width - 20 &&
    Math.abs(storyBtn.width - storyParent) <= 1 && storyBtn.position !== 'fixed',
    { width: storyBtn ? round(storyBtn.width) : null, parentWidth: round(storyParent), position: storyBtn ? storyBtn.position : null });

  // 图书馆底栏
  await page.goto(`${baseUrl}/library/library.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tabbar');
  await settle(page);
  const libraryTabbar = await measureElement(page, '.tabbar');
  check('图书馆底栏全宽贴底且未被压扁', libraryTabbar && Math.abs(libraryTabbar.width - viewport.width) <= 0.5 &&
    Math.abs(libraryTabbar.bottom - viewport.height) <= 1 && libraryTabbar.height > 30,
    { width: libraryTabbar ? round(libraryTabbar.width) : null, bottom: libraryTabbar ? round(libraryTabbar.bottom) : null, height: libraryTabbar ? round(libraryTabbar.height) : null });

  // 记账页弹层（.modal-backdrop 与底栏共用同一组全宽规则）
  await page.goto(`${baseUrl}/wallet/finance.html`, { waitUntil: 'load' });
  await page.waitForSelector('.side-btn');
  await settle(page);
  await page.locator('.side-btn').first().click();
  await page.waitForSelector('.modal-backdrop.show');
  const financeModal = await measureElement(page, '.modal-backdrop.show');
  check('记账页弹层全宽贴合视口且未被位移', financeModal && Math.abs(financeModal.width - viewport.width) <= 0.5 &&
    Math.abs(financeModal.x) <= 0.5 && Math.abs(financeModal.bottom - viewport.height) <= 0.5,
    { width: financeModal ? round(financeModal.width) : null, x: financeModal ? round(financeModal.x) : null, bottom: financeModal ? round(financeModal.bottom) : null });

  // 聊天列表底栏（nav.js 注入的悬浮导航）
  await page.goto(`${baseUrl}/chat/chat/chat.html`, { waitUntil: 'load' });
  await page.waitForSelector('.floating-nav', { timeout: 5000 });
  await settle(page);
  const floatingNav = await measureElement(page, '.floating-nav');
  check('聊天列表悬浮底栏未位移且保持居中胶囊', floatingNav && floatingNav.width < viewport.width - 20 &&
    Math.abs(floatingNav.bottom - (viewport.height - 20)) <= 1 && floatingNav.x > 0,
    { width: floatingNav ? round(floatingNav.width) : null, bottom: floatingNav ? round(floatingNav.bottom) : null, x: floatingNav ? round(floatingNav.x) : null });

  // 聊天详情输入区
  await page.goto(`${baseUrl}/chat/chat/chat-detail.html`, { waitUntil: 'load' });
  await page.waitForSelector('.input-dock');
  await settle(page);
  const inputDock = await measureElement(page, '.input-dock');
  check('聊天详情输入区贴底且未被撑高', inputDock && Math.abs(inputDock.width - viewport.width) <= 0.5 &&
    Math.abs(inputDock.bottom - viewport.height) <= 1 && inputDock.height > 30 && inputDock.height < 90,
    { width: inputDock ? round(inputDock.width) : null, bottom: inputDock ? round(inputDock.bottom) : null, height: inputDock ? round(inputDock.height) : null });

  // 设置页返回栏（顶部 header 内的返回按钮）
  await page.goto(`${baseUrl}/settings/settings.html`, { waitUntil: 'load' });
  await page.waitForSelector('.header .back-btn');
  await settle(page);
  const settingsBack = await measureElement(page, '.header .back-btn');
  check('设置页返回按钮未位移且尺寸正常', settingsBack && settingsBack.y > 0 && settingsBack.y < 100 &&
    settingsBack.width >= 28 && settingsBack.width <= 40 && Math.abs(settingsBack.width - settingsBack.height) <= 1,
    { y: settingsBack ? round(settingsBack.y) : null, width: settingsBack ? round(settingsBack.width) : null, height: settingsBack ? round(settingsBack.height) : null });
}

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
let failed = false;
const report = { viewport: '390x844', takeout: {}, bottomBars: {} };

try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();

  const collect = (bucket) => (name, ok, detail) => {
    bucket[name] = { ok, detail };
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  };

  await runTakeoutChecks(page, baseUrl, collect(report.takeout));
  await runBottomBarChecks(page, baseUrl, collect(report.bottomBars));

  await context.close();
  console.log('\nRESULT ' + JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

if (failed) {
  console.error('\n存在失败断言');
  process.exitCode = 1;
} else {
  console.log('\n全部断言通过');
}
