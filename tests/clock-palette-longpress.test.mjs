import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

/**
 * CLOCK-PALETTE-001 回归测试：桌面时钟调色盘与通用长按拖拽的冲突。
 *
 * 授权背景（PR #148 评论 6688985166 / 6689516660）：
 *   1) 常态下按/按住时钟，不应挂上通用 [data-drag] 长按计时器，
 *      超过 280ms（触摸）/ 260ms（鼠标）也不能进入 home-editing；
 *   2) 快点击与慢点击都必须打开已有的时钟颜色面板；
 *   3) 进入 home-editing 后，时钟仍可拖动；
 *   4) 其他 [data-drag] 元素的长按拖动行为保持不变。
 *
 * 运行前提（本地测试，非 CI 覆盖）：
 *   - 需要 Playwright 与 Microsoft Edge；仓库既有浏览器测试同样使用
 *     channel: 'msedge'（见 tests/takeout-add-button.browser.mjs）。
 *   - 若环境没有 Edge，可用 CLOCK_TEST_CHANNEL=chromium 指定其他 Chromium 渠道。
 *   - 依赖本地静态服务器（serviceWorkers: 'block'），不启动 Vite，也不依赖
 *     %TEMP% 下的任何临时脚本或配置。
 *   - 触摸用例使用 CDP Input.dispatchTouchEvent 真实触摸事件，不是普通 click()。
 *     自动化触摸结果与真机结果分开：真机仍未验证（NOT VERIFIED）。
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
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

// 只保留 origin/main 已确认的内联 SVG path 解析噪声。
// favicon.ico 由下面的测试服务器明确返回 204；其他资源出现 404 必须让测试失败。
const BASELINE_ERRORS = [
  /<path> attribute d: Expected number/i
];

const LAYOUT_KEY = 'ds_layout_v14';

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let urlPath;
      try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      } catch {
        urlPath = (req.url || '/').split('?')[0];
      }
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      // 源文件里的 %BASE_URL% 由 Vite 在构建时替换；静态直出时按 "/" 解析，
      // 避免把构建期占位符误报成 404。
      const normalized = rel.replaceAll('%BASE_URL%', '');
      // 避免浏览器自动请求 favicon 时产生基线 404；其他缺失资源仍应暴露。
      if (normalized === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const filePath = path.join(root, normalized);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const results = [];
let failed = false;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
}

async function openPage(browser, origin, viewport, touch) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: touch,
    hasTouch: touch,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push('console: ' + message.text());
  });
  await page.goto(origin + '/index.html', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('clgTime');
    return !!el && /^\d{2}:\d{2}$/.test(el.textContent || '');
  }, null, { timeout: 15000 });
  await delay(800);
  return { context, page, consoleErrors };
}

function unexpectedErrors(errors) {
  return errors.filter((message) => !BASELINE_ERRORS.some((pattern) => pattern.test(message)));
}

async function paletteState(page) {
  return page.evaluate(() => ({
    palette: !!document.querySelector('.clock-palette'),
    editing: document.body.classList.contains('home-editing'),
    dots: document.querySelectorAll('.clock-palette .palette-dot').length,
    custom: !!document.querySelector('.clock-palette .palette-custom input')
  }));
}

async function closePalette(page) {
  await page.keyboard.press('Escape');
  await delay(80);
}

async function targetCenter(page, id) {
  return page.evaluate((targetId) => {
    const el = document.getElementById(targetId);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, id);
}

async function touchPress(cdp, x, y, holdMs) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
  });
  await delay(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(500);
}

async function mousePress(page, x, y, holdMs) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await delay(holdMs);
  await page.mouse.up();
  await delay(500);
}

async function findBlankPoint(page, startY = 60) {
  return page.evaluate((fromY) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isBlank = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return true;
      return !el.closest('[data-drag]') && !el.closest('.dot') &&
        !el.closest('#dockBar') && !el.closest('.edit-mode-indicator') &&
        !el.closest('.clock-palette') && !el.closest('#homeActionMenu');
    };
    // 先扫左右边距，通常一定存在空白；再从 fromY 起做细步进扫描。
    for (let y = fromY; y < height - 60; y += 8) {
      for (const x of [4, width - 5]) {
        if (isBlank(x, y)) return { x, y };
      }
    }
    for (let y = fromY; y < height - 60; y += 6) {
      for (let x = 20; x < width - 20; x += 6) {
        if (isBlank(x, y)) return { x, y };
      }
    }
    return null;
  }, startY);
}

async function isEditing(page) {
  return page.evaluate(() => document.body.classList.contains('home-editing'));
}

async function enterEdit(page) {
  if (await isEditing(page)) return true;
  const blank = await findBlankPoint(page);
  if (blank) {
    await mousePress(page, blank.x, blank.y, 520);
    if (await isEditing(page)) return true;
  }
  // 兜底：长按一个可见图标同样会进入编辑模式（不移动鼠标，松手后回到原槽位）
  const tile = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-drag^="app_"]')).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  if (tile) await mousePress(page, tile.x, tile.y, 330);
  return isEditing(page);
}

async function exitEdit(page) {
  const editing = await page.evaluate(() => document.body.classList.contains('home-editing'));
  if (!editing) return true;
  const blank = await findBlankPoint(page);
  if (!blank) {
    // 兜底：页面被图标占满时，用合成 click 命中非 [data-drag] 的桌面容器退出编辑。
    // 仅用于测试收尾，不参与任何功能断言。
    await page.evaluate(() => {
      const target = document.querySelector('.desktop-pages') ||
        document.getElementById('homeScreen') || document.body;
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 2,
        clientY: 300
      }));
    });
    await delay(350);
    return !(await isEditing(page));
  }
  await page.mouse.click(blank.x, blank.y);
  await delay(350);
  const stillEditing = await page.evaluate(() => document.body.classList.contains('home-editing'));
  return !stillEditing;
}

async function readRect(page, dragId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-drag="${id}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      index: Array.prototype.indexOf.call(el.parentNode.children, el)
    };
  }, dragId);
}

function moved(before, after) {
  if (!before || !after) return false;
  return Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5 || after.index !== before.index;
}

async function runLargeClock(browser, origin, viewport) {
  const label = `${viewport.width}x${viewport.height}`;

  // 触摸：100ms 快点击与 360ms 慢点击
  {
    const { context, page, consoleErrors } = await openPage(browser, origin, viewport, true);
    const cdp = await context.newCDPSession(page);
    const center = await targetCenter(page, 'clgTime');
    if (!center) {
      check(`large clock ${label} touch target`, false, 'large clock is not visible');
    } else {
      await touchPress(cdp, center.x, center.y, 100);
      let state = await paletteState(page);
      check(`large clock ${label} touch 100ms`, state.palette && !state.editing, state);
      check(`large clock ${label} touch 100ms swatches`, state.dots === 16, { dots: state.dots });
      await closePalette(page);

      await touchPress(cdp, center.x, center.y, 360);
      state = await paletteState(page);
      check(`large clock ${label} touch 360ms`, state.palette && !state.editing, state);
      await closePalette(page);
    }
    check(`large clock ${label} touch console`, unexpectedErrors(consoleErrors).length === 0, {
      unexpected: unexpectedErrors(consoleErrors)
    });
    await context.close();
  }

  // 鼠标：100ms 快点击与 360ms 长按
  {
    const { context, page, consoleErrors } = await openPage(browser, origin, viewport, false);
    const center = await targetCenter(page, 'clgTime');
    if (!center) {
      check(`large clock ${label} mouse target`, false, 'large clock is not visible');
    } else {
      await mousePress(page, center.x, center.y, 100);
      let state = await paletteState(page);
      check(`large clock ${label} mouse 100ms`, state.palette && !state.editing, state);
      await closePalette(page);

      await mousePress(page, center.x, center.y, 360);
      state = await paletteState(page);
      check(`large clock ${label} mouse 360ms`, state.palette && !state.editing, state);
      await closePalette(page);
    }
    check(`large clock ${label} mouse console`, unexpectedErrors(consoleErrors).length === 0, {
      unexpected: unexpectedErrors(consoleErrors)
    });
    await context.close();
  }
}

async function runGestureEdges(browser, origin, viewport) {
  const label = `${viewport.width}x${viewport.height}`;
  const { context, page, consoleErrors } = await openPage(browser, origin, viewport, true);
  const cdp = await context.newCDPSession(page);
  const center = await targetCenter(page, 'clgTime');

  if (!center) {
    check(`gesture edges ${label} target`, false, 'large clock is not visible');
    await context.close();
    return;
  }

  const snapshot = () => page.evaluate(() => ({
    palette: document.querySelectorAll('.clock-palette').length,
    editing: document.body.classList.contains('home-editing'),
    ghost: !!document.querySelector('.ds-drag-ghost, .drag-ghost')
  }));

  // 1) 长按 360ms 后取消触摸：不得残留编辑模式或拖拽幽灵
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: center.x, y: center.y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
  });
  await delay(360);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await delay(600);
  let state = await snapshot();
  check(`gesture edges ${label} touch cancel 360ms`, !state.palette && !state.editing && !state.ghost, state);

  // 2) 取消后仍可正常短按打开面板（无卡死的手势状态）
  await touchPress(cdp, center.x, center.y, 100);
  state = await snapshot();
  check(`gesture edges ${label} tap after cancel`, state.palette === 1 && !state.editing && !state.ghost, state);
  await closePalette(page);

  // 3) 快速连击三次（真实连续触摸：按住 40ms、间隔 60ms）：只出现一个面板，不进入编辑模式
  for (let i = 0; i < 3; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: center.x, y: center.y, radiusX: 1, radiusY: 1, force: 1, id: 1 }]
    });
    await delay(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(60);
  }
  await delay(700);
  state = await snapshot();
  check(`gesture edges ${label} rapid triple tap`, state.palette <= 1 && !state.editing && !state.ghost, state);
  if (state.palette) await closePalette(page);

  // 4) 面板与编辑模式互斥（任何时刻都不同时出现）
  const exclusive = await page.evaluate(() => {
    const palette = !!document.querySelector('.clock-palette');
    const editing = document.body.classList.contains('home-editing');
    return { palette, editing, exclusive: !(palette && editing) };
  });
  check(`gesture edges ${label} palette-editing exclusive`, exclusive.exclusive, exclusive);

  check(`gesture edges ${label} console`, unexpectedErrors(consoleErrors).length === 0, {
    unexpected: unexpectedErrors(consoleErrors)
  });
  await context.close();
}

async function runSmallClock(browser, origin, viewport) {
  const label = `${viewport.width}x${viewport.height}`;

  // 布局前提：默认生产布局中，小时钟挂件位于隐藏的 itemShelf（被移除列表），
  // 不在任何可见桌面页。因此默认布局下无法真实点击到 #clTime。
  // 本用例通过把 [data-drag="clock"] 放入可见 .desktop-grid 来覆盖其真实事件链，
  // 属构造布局；默认布局下的实际入口不可达，报告需标注该用例适用范围。
  const prepare = async (page) => {
    const info = await page.evaluate(() => {
      const small = document.querySelector('[data-drag="clock"]');
      const grid = document.querySelector('.desktop-grid');
      if (!small || !grid) return { relocated: false, defaultVisible: false };
      const before = small.getBoundingClientRect();
      const defaultVisible = before.width > 0 && before.height > 0;
      grid.insertBefore(small, grid.firstChild);
      return { relocated: true, defaultVisible };
    });
    await delay(200);
    const center = await targetCenter(page, 'clTime');
    return { info, center };
  };

  for (const touch of [true, false]) {
    const { context, page, consoleErrors } = await openPage(browser, origin, viewport, touch);
    const { info, center } = await prepare(page);
    const mode = touch ? 'touch' : 'mouse';
    if (!center) {
      check(`small clock ${label} ${mode} target`, false, { ...info, center });
    } else {
      if (touch) {
        const cdp = await context.newCDPSession(page);
        await touchPress(cdp, center.x, center.y, 100);
        let state = await paletteState(page);
        check(`small clock ${label} touch 100ms`, state.palette && !state.editing,
          { ...state, defaultVisible: info.defaultVisible });
        await closePalette(page);

        await touchPress(cdp, center.x, center.y, 360);
        state = await paletteState(page);
        check(`small clock ${label} touch 360ms`, state.palette && !state.editing,
          { ...state, defaultVisible: info.defaultVisible });
        await closePalette(page);
      } else {
        await mousePress(page, center.x, center.y, 100);
        let state = await paletteState(page);
        check(`small clock ${label} mouse 100ms`, state.palette && !state.editing,
          { ...state, defaultVisible: info.defaultVisible });
        await closePalette(page);

        await mousePress(page, center.x, center.y, 360);
        state = await paletteState(page);
        check(`small clock ${label} mouse 360ms`, state.palette && !state.editing,
          { ...state, defaultVisible: info.defaultVisible });
        await closePalette(page);
      }
    }
    check(`small clock ${label} ${mode} console`, unexpectedErrors(consoleErrors).length === 0, {
      unexpected: unexpectedErrors(consoleErrors),
      layoutPremise: 'clock relocated from itemShelf to visible grid'
    });
    await context.close();
  }
}

async function runEditModeDrag(browser, origin) {
  const viewport = { width: 390, height: 844 };
  const { context, page, consoleErrors } = await openPage(browser, origin, viewport, false);

  const entered = await enterEdit(page);
  const editingNow = await isEditing(page);
  check('edit mode entry', entered && editingNow, { editing: editingNow });

  // 编辑模式内拖动大时钟
  const layoutBefore = await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY);
  const before = await readRect(page, 'clock-lg');
  if (before) {
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await page.mouse.down();
    await delay(60);
    await page.mouse.move(before.x + before.w / 2 + 40, before.y + before.h / 2 + 50, { steps: 6 });
    await delay(60);
    await page.mouse.up();
    await delay(500);
  }
  const after = await readRect(page, 'clock-lg');
  const layoutAfter = await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY);
  const savedLayout = layoutAfter ? JSON.parse(layoutAfter) : null;
  const layoutHasClock = !!savedLayout && reasoningLayout(savedLayout);
  const stillEditing = await page.evaluate(() => document.body.classList.contains('home-editing'));
  const paletteOpen = await page.evaluate(() => !!document.querySelector('.clock-palette'));
  check('edit mode drag large clock',
    moved(before, after) && stillEditing && !paletteOpen,
    { before, after, editing: stillEditing, palette: paletteOpen });
  check('edit mode large clock layout saved', layoutBefore !== layoutAfter && layoutHasClock, {
    layoutChanged: layoutBefore !== layoutAfter,
    layoutHasClock
  });

  await exitEdit(page);

  // 另选两个可见的非时钟 [data-drag] 元素：长按 > 260ms 后仍进入编辑并可拖动
  const candidates = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('[data-drag]').forEach((el) => {
      const dragId = el.getAttribute('data-drag');
      if (!dragId || dragId === 'clock' || dragId === 'clock-lg') return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight) {
        list.push({ dragId, widget: el.classList.contains('ds-widget') });
      }
    });
    const widgets = list.filter((item) => item.widget);
    const others = list.filter((item) => !item.widget);
    return widgets.concat(others).slice(0, 2);
  });

  if (candidates.length < 2) {
    check('non-clock drag targets available', false, { candidates });
  }
  for (const candidate of candidates) {
    const itemBefore = await readRect(page, candidate.dragId);
    if (!itemBefore) {
      check(`non-clock drag ${candidate.dragId}`, false, 'target disappeared');
      continue;
    }
    const cx = itemBefore.x + itemBefore.w / 2;
    const cy = itemBefore.y + itemBefore.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await delay(330);
    await page.mouse.move(cx + 100, cy + 120, { steps: 8 });
    await delay(60);
    await page.mouse.up();
    await delay(500);
    const itemAfter = await readRect(page, candidate.dragId);
    const editing = await page.evaluate(() => document.body.classList.contains('home-editing'));
    check(`non-clock long-press drag ${candidate.dragId}`,
      editing && moved(itemBefore, itemAfter),
      { before: itemBefore, after: itemAfter, editing });
    if (editing) await exitEdit(page);
  }

  // 编辑模式内拖动小时钟（构造布局，前提同上）
  {
    await page.evaluate(() => {
      const small = document.querySelector('[data-drag="clock"]');
      const grid = document.querySelector('.desktop-grid');
      if (small && grid) grid.insertBefore(small, grid.firstChild);
    });
    await delay(200);
    const enteredSmallEdit = await enterEdit(page);
    check('edit mode entry for small clock', enteredSmallEdit && (await isEditing(page)), {
      editing: await isEditing(page)
    });
    const smallBefore = await readRect(page, 'clock');
    const dropTarget = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('[data-drag]')).find((item) => {
        const id = item.getAttribute('data-drag');
        if (!id || id === 'clock' || id === 'clock-lg') return false;
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { id: el.getAttribute('data-drag'), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    if (smallBefore && dropTarget) {
      await page.mouse.move(smallBefore.x + smallBefore.w / 2, smallBefore.y + smallBefore.h / 2);
      await page.mouse.down();
      await delay(60);
      await page.mouse.move(dropTarget.x, dropTarget.y, { steps: 8 });
      await delay(60);
      await page.mouse.up();
      await delay(500);
    }
    const smallAfter = await readRect(page, 'clock');
    const layoutSmall = await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY);
    const smallSaved = layoutSmall ? JSON.parse(layoutSmall) : null;
    check('edit mode drag small clock (relocated layout)', moved(smallBefore, smallAfter) &&
      !!smallSaved && reasoningLayout(smallSaved),
      {
        before: smallBefore,
        after: smallAfter,
        dropTarget,
        layoutHasClock: !!smallSaved && reasoningLayout(smallSaved),
        layoutPremise: 'clock relocated from itemShelf to visible grid'
      });
    if (await page.evaluate(() => document.body.classList.contains('home-editing'))) {
      await exitEdit(page);
    }
  }

  check('edit mode console', unexpectedErrors(consoleErrors).length === 0, {
    unexpected: unexpectedErrors(consoleErrors)
  });
  await context.close();
}

function reasoningLayout(layout) {
  const pages = Array.isArray(layout.pages) ? layout.pages : [];
  const ids = pages.flat();
  return ids.includes('clock') || ids.includes('clock-lg');
}

async function runPaletteRegression(browser, origin) {
  const viewport = { width: 390, height: 844 };
  const { context, page, consoleErrors } = await openPage(browser, origin, viewport, false);
  const center = await targetCenter(page, 'clgTime');
  await page.mouse.click(center.x, center.y);
  await delay(400);

  const state = await paletteState(page);
  const layout = await page.evaluate(() => {
    const palette = document.querySelector('.clock-palette');
    if (!palette) return null;
    const rect = palette.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  check('palette open', state.palette && !state.editing, state);
  check('palette 16 presets and custom input', state.dots === 16 && state.custom, {
    dots: state.dots,
    custom: state.custom
  });
  check('palette no overflow', !!layout && layout.left >= 0 && layout.right <= layout.viewportWidth &&
    layout.top >= 0 && layout.bottom <= layout.viewportHeight, layout);

  const applied = await page.evaluate(() => {
    const first = document.querySelector('.clock-palette .palette-dot');
    if (first) first.click();
    return {
      saved: localStorage.getItem('ds_clock_color'),
      color: getComputedStyle(document.getElementById('clgTime')).color
    };
  });
  check('palette preset applies', applied.saved === '#1a1a1a', applied);

  await page.mouse.click(center.x, center.y);
  await delay(300);
  await page.evaluate(() => {
    const reset = document.querySelector('.clock-palette .palette-reset');
    if (reset) reset.click();
  });
  await delay(200);
  const resetState = await page.evaluate(() => ({
    saved: localStorage.getItem('ds_clock_color'),
    color: getComputedStyle(document.getElementById('clgTime')).color,
    palette: !!document.querySelector('.clock-palette')
  }));
  check('palette reset restores default', resetState.saved === null && !resetState.palette, resetState);

  check('palette console', unexpectedErrors(consoleErrors).length === 0, {
    unexpected: unexpectedErrors(consoleErrors)
  });
  await context.close();
}

const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({
    channel: process.env.CLOCK_TEST_CHANNEL || 'msedge',
    headless: true
  });

  for (const viewport of VIEWPORTS) {
    await runLargeClock(browser, origin, viewport);
    await runGestureEdges(browser, origin, viewport);
    await runSmallClock(browser, origin, viewport);
  }
  await runEditModeDrag(browser, origin);
  await runPaletteRegression(browser, origin);
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const passed = results.filter((item) => item.ok).length;
console.log(`\nRESULT pass=${passed} fail=${results.length - passed} total=${results.length}`);
if (failed) {
  console.error('存在失败断言');
  process.exitCode = 1;
}
