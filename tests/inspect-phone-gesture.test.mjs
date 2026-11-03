/**
 * inspect-phone/phone.html 解锁手势与窄屏布局回归测试（v2 重写）。
 *
 * 核心：用 Playwright CDP Input.dispatchTouchEvent 派发真实 trusted touch
 * 事件（pointerId 从 0 起、touchEnd/touchCancel 时 touchPoints 为空数组），
 * 不产生 click 事件，不触发浏览器默认手势拦截。
 *
 * v2 变更（针对审查 #2 / #3 / #4）：
 *   - Test 3: 从纯数学 shouldUnlock 断言 → 独立页面 + 真实 CDP touch 边界用例
 *             （每个阈值 case 起独立页面，不跨 case 复用状态）
 *   - Test 5: 用 CDP touchCancel 代替 mousePressed/mouseReleased
 *             （后者会触发 click 兜底解锁，使 cancel 测试无效）
 *   - 所有 touch 用例额外断言 clickCount === 0，证明不是 click 兜底蒙对
 *   - 保留 Test 4/6/7/8/1 不变
 *
 * 运行：
 *   BASE_URL=http://localhost:3000 node tests/inspect-phone-gesture.test.mjs
 *
 * 依赖：playwright 主包（package.json devDependencies ^1.64.1）
 */
import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const URL = `${BASE}/inspect-phone/phone.html?id=pw-test`;
const ROLE_SEED = JSON.stringify([{ id: 'pw-test', name: 'PW测试', description: 'test role' }]);

function assert(cond, msg) {
  if (!cond) { console.error('\u274c ' + msg); process.exitCode = 1; }
  else       { console.log('\u2705 ' + msg); }
}

async function freshPage(viewport = { width: 390, height: 844 }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport,
    isMobile: viewport.width <= 480,
    hasTouch: viewport.width <= 480,
  });
  await ctx.addInitScript((seed) => {
    localStorage.setItem('ai_custom_characters', seed);
    localStorage.setItem('phone_current_contact', 'pw-test');
  }, ROLE_SEED);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { browser, page, cdp };
}

/** 开启 click 计数：给 .lock 的 click 加一条 window.__clickCount++ 监听 */
async function installClickCounter(page) {
  await page.evaluate(() => {
    window.__clickCount = 0;
    const lock = document.getElementById('lock');
    if (lock) {
      // passive: true 让 click 能继续触发 unlockPhone
      lock.addEventListener('click', () => { window.__clickCount++; });
    }
  });
}

/**
 * CDP 真实触摸：touchStart → N×touchMove → touchEnd
 * 不产生 click 事件，不触发浏览器默认手势拦截。
 */
async function touchSwipe(cdp, startX, startY, endX, endY, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, pointerId: 0 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i / steps);
    const y = startY + ((endY - startY) * i / steps);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, pointerId: 0 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/**
 * CDP 纯 touchCancel：touchStart → touchCancel，**不发 touchEnd**。
 * 空 touchPoints 让浏览器派发真实 touchcancel 事件，对应页面 JS 中
 * lock.addEventListener('touchcancel', resetLockState) 的分支。
 */
async function touchCancel(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, pointerId: 0 }],
  });
  // Playwright CDP 1.43+ 支持 touchCancel
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
}

async function main() {
  console.log('\n=== inspect-phone 回归测试 v2（纯 CDP touch，无 click 兜底）===');
  console.log('BASE:', BASE);

  // ---- Test 1: 窄屏无白边（HTML/CSS 层）----
  console.log('\n--- Test 1: 390x844 窄屏无白边 / 无溢出 / touch-action 收窄 ---');
  {
    const { browser, page } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    const l = await page.evaluate(() => {
      const d = document.querySelector('.device');
      const r = d.getBoundingClientRect();
      const s = getComputedStyle(d);
      const lStyle = getComputedStyle(document.querySelector('.lock'));
      return {
        vw: window.innerWidth,
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        d: { left: r.left, right: r.right, w: r.width, border: s.borderWidth, br: s.borderRadius },
        bg: getComputedStyle(document.body).backgroundColor,
        lockTA: lStyle.touchAction,
        deviceTA: getComputedStyle(d).touchAction,
      };
    });
    assert(Math.abs(l.d.w - 390) < 1, `.device 铺满 390px: ${l.d.w}`);
    assert(l.d.left < 1, `.device left 无白边: ${l.d.left}`);
    assert(Math.abs(l.d.right - l.vw) < 1, `.device right 无白边: ${l.d.right}`);
    assert(l.d.border === '0px', `border 清零: ${l.d.border}`);
    assert(l.d.br === '0px', `border-radius 清零: ${l.d.br}`);
    assert(l.sw <= l.cw + 1, `无横向溢出: sw=${l.sw} cw=${l.cw}`);
    assert(l.lockTA === 'none', `.lock touch-action=none: ${l.lockTA}`);
    assert(l.deviceTA !== 'none', `.device touch-action 已收窄（不是 none）: ${l.deviceTA}`);
    assert(l.bg === 'rgb(255, 255, 255)', `body 白底: ${l.bg}`);
    await browser.close();
  }

  // ---- Test 2: 首次上滑解锁（真实 CDP touch，不触发 click）----
  console.log('\n--- Test 2: 首次 touch 上滑解锁（全程无 click）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    const before = await page.evaluate(() =>
      document.getElementById('lock').classList.contains('hide'));
    assert(before === false, '初始锁屏可见');

    // 上滑 dy=-350: (195, 700) → (195, 350)
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);

    const after = await page.evaluate(() => ({
      lockHidden: document.getElementById('lock').classList.contains('hide'),
      phoneShown: document.getElementById('phone').classList.contains('show'),
      clickCount: window.__clickCount,
    }));
    assert(after.lockHidden === true, '首次 touch 上滑后锁屏隐藏');
    assert(after.phoneShown === true, '桌面内容已显示');
    assert(after.clickCount === 0, `clickCount=0（纯 touch 解锁，不是 click 兜底）: ${after.clickCount}`);
    await browser.close();
  }

  // ---- Test 3: 阈值边界真实触摸用例（每个 case 独立页面 + clickCount=0 断言）----
  console.log('\n--- Test 3: 阈值边界（每个 case 独立页面，真实 CDP touch）---');

  // case: dy=-37 → 刚过阈值，应解锁
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    // (195, 700) → (195, 663): dy = -37
    await touchSwipe(cdp, 195, 700, 195, 663);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lock').classList.contains('hide'), cc: window.__clickCount }));
    assert(r.hidden === true && r.cc === 0, `dy=-37 → 解锁且 clickCount=0`);
    await browser.close();
  }

  // case: dy=-36 → 严格 < -36 才触发，边界不触发
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    // (195, 700) → (195, 664): dy = -36
    await touchSwipe(cdp, 195, 700, 195, 664);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lock').classList.contains('hide'), cc: window.__clickCount }));
    assert(r.hidden === false && r.cc === 0, `dy=-36 → 不解锁且 clickCount=0（边界不触发）`);
    await browser.close();
  }

  // case: dy=-25 → 明显不够阈值（> Chrome ~10px tap 阈值，不会被当成 tap 生成 click）
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    // (195, 700) → (195, 675): dy = -25，远低于 -36 阈值，但高于 Chrome ~10px tap 阈值
    await touchSwipe(cdp, 195, 700, 195, 675);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lock').classList.contains('hide'), cc: window.__clickCount }));
    assert(r.hidden === false && r.cc === 0, `dy=-25 → 不解锁且 clickCount=0（没通过 click 兜底，也没达到 -36 阈值）`);
    await browser.close();
  }

  // case: 横向滑动 dx=300 dy=0 → 不解锁
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    await touchSwipe(cdp, 50, 400, 350, 400);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lock').classList.contains('hide'), cc: window.__clickCount }));
    assert(r.hidden === false && r.cc === 0, `横向 dx=300 → 不解锁且 clickCount=0`);
    await browser.close();
  }

  // ---- Test 4: 斜滑边界 |dy| ≈ |dx|*1.15 ----
  console.log('\n--- Test 4: 斜滑边界（独立页面）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    // dx=300, dy=-300: |dy|=300 < 300*1.15=345 → 不解锁
    await touchSwipe(cdp, 100, 500, 400, 200);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lock').classList.contains('hide'), cc: window.__clickCount }));
    assert(r.hidden === false && r.cc === 0, `斜滑 dy=-300 dx=300 → 不解锁`);
    await browser.close();
  }

  // ---- Test 5: touchCancel 后状态复位（独立页面，全程无 click）----
  console.log('\n--- Test 5: CDP touchCancel 后状态复位 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // 取消阶段：touchStart → **touchCancel**（空 touchPoints），**不发 touchEnd**
    // 这会触发 JS 里的 lock.addEventListener('touchcancel', resetLockState)
    await touchCancel(cdp, 195, 700);
    await page.waitForTimeout(80);

    const afterCancel = await page.evaluate(() => ({
      lockHidden: document.getElementById('lock').classList.contains('hide'),
      clickCount: window.__clickCount,
    }));
    assert(afterCancel.lockHidden === false, 'touchCancel 后锁屏仍可见（未误解锁）');
    assert(afterCancel.clickCount === 0, `touchCancel 后 clickCount=0（不是 click 打开）: ${afterCancel.clickCount}`);

    // 紧接着做一次完整上滑（touchStart → N×touchMove → touchEnd）
    // 断言解锁成功 → 状态没被 cancel 卡死
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);

    const afterSwipe = await page.evaluate(() => ({
      lockHidden: document.getElementById('lock').classList.contains('hide'),
      phoneShown: document.getElementById('phone').classList.contains('show'),
    }));
    assert(afterSwipe.lockHidden === true, 'touchCancel 后完整上滑解锁成功（状态已复位，未卡死）');
    assert(afterSwipe.phoneShown === true, '桌面内容已显示');
    await browser.close();
  }

  // ---- Test 6: 解锁后重复 touch 幂等 ----
  console.log('\n--- Test 6: 解锁后重复 touch 幂等 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // 第一次上滑解锁
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);
    const ok1 = await page.evaluate(() => ({
      hidden: document.getElementById('lock').classList.contains('hide'),
      cc: window.__clickCount,
    }));
    assert(ok1.hidden === true && ok1.cc === 0, '第一次 touch 解锁成功，clickCount=0');

    // 第二次同样的 touch——幂等：unlockFired 已 true，重复 touch 不破坏解锁状态
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);
    const ok2 = await page.evaluate(() => ({
      hidden: document.getElementById('lock').classList.contains('hide'),
      phoneShown: document.getElementById('phone').classList.contains('show'),
      cc: window.__clickCount,
    }));
    assert(ok2.hidden === true && ok2.phoneShown === true, '第二次 touch 不破坏解锁状态（幂等）');
    await browser.close();
  }

  // ---- Test 7: click 辅助路径（独立 mouse.click）----
  console.log('\n--- Test 7: 点击辅助解锁 ---');
  {
    const { browser, page } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);
    await page.locator('#lock').click();
    const after = await page.evaluate(() => ({
      hidden: document.getElementById('lock').classList.contains('hide'),
      cc: window.__clickCount,
    }));
    assert(after.hidden === true && after.cc === 1, `点击后锁屏隐藏，clickCount=1`);
    await browser.close();
  }

  // ---- Test 8: 桌面 1280x900 外壳保留 ----
  console.log('\n--- Test 8: 桌面 1280x900 外壳保留 ---');
  {
    const { browser, page } = await freshPage({ width: 1280, height: 900 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    const l = await page.evaluate(() => {
      const r = document.querySelector('.device').getBoundingClientRect();
      const s = getComputedStyle(document.querySelector('.device'));
      return {
        w: r.width, border: s.borderWidth, br: s.borderRadius,
        centered: Math.abs(r.left - (window.innerWidth - r.width) / 2) < 3,
      };
    });
    assert(Math.abs(l.w - 390) < 3, `桌面外壳宽≈390: ${l.w}`);
    assert(l.border && l.border !== '0px', `桌面有 border: ${l.border}`);
    assert(l.br && l.br !== '0px', `桌面有 border-radius: ${l.br}`);
    assert(l.centered, '桌面外壳居中');
    await browser.close();
  }

  console.log('\n=== 全部完成 ===');
}

main().catch(err => { console.error('FATAL:', err?.message || err); process.exit(1); });
