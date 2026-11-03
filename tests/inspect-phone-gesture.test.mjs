/**
 * inspect-phone/phone.html 解锁手势与窄屏布局回归测试（v3 重写）。
 *
 * v3 核心变化（对应审查 #2 追加意见）：
 *   1. 恢复小位移真实触摸用例——删除"用 dy=-25 代替 dy=-10"的做法。
 *      共 8 条位移守卫边界 case：dy=0 / dy=-10 / dy=-15 / dy=-25 / dy=-36 / dy=-37 / 横向 / touchCancel
 *      每条独立页面，以最终锁屏可见性为唯一断言依据。
 *   2. clickCount 降级为诊断打印，不再作为断言条件——因为位移守卫生效后，
 *      Chrome 对 <15px touch 自动生成的 synthetic click 会被守卫拦截，
 *      clickCount 本身不是"守卫是否生效"的可靠信号。
 *   3. 测试 phone.html 新增的 TAP_MOVE_TOLERANCE_PX=8 位移守卫：
 *      任何位移 > 8px 的手势（包括 Chrome 对 dy=-10 生成的 synthetic click）
 *      都不能走 click 兜底解锁，必须走 pointer/touch 的 shouldUnlock 通道。
 *
 * 技术手段：
 *   - dy=0 原地轻点用 Playwright page.locator('#lock').click()（100% 生成 click 事件，
 *     位移 0，守卫允许通过）
 *   - 其余位移 case 用 Playwright CDP Input.dispatchTouchEvent 派发真实 trusted touch，
 *     不经过 Playwright 的高层 click API，精确控制位移。
 *
 * 运行：
 *   BASE_URL=http://127.0.0.1:3000 node tests/inspect-phone-gesture.test.mjs
 * 依赖：playwright 主包（package.json devDependencies ^1.64.1）
 */
import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const URL = `${BASE}/inspect-phone/phone.html?id=pw-test`;
const ROLE_SEED = JSON.stringify([{ id: 'pw-test', name: 'PW测试', description: 'test role' }]);

let totalAssertions = 0;
let passedAssertions = 0;

function assert(cond, msg) {
  totalAssertions++;
  if (cond) {
    passedAssertions++;
    console.log('\u2705 ' + msg);
  } else {
    console.error('\u274c ' + msg);
    process.exitCode = 1;
  }
}

/** 给页面装 click 计数，纯诊断用（打印时带上），不作为断言依据 */
async function installClickCounter(page) {
  await page.evaluate(() => {
    window.__clickCount = 0;
    const lock = document.getElementById('lock');
    if (lock) {
      lock.addEventListener('click', () => { window.__clickCount++; });
    }
  });
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

/**
 * CDP 真实触摸：touchStart → N×touchMove → touchEnd
 * 不产生 click 事件（绕过 Playwright 高层 click 逻辑）。
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
 * CDP 纯 touchCancel：touchStart → touchCancel，不发 touchEnd。
 * 空 touchPoints 让 Chromium 派发真实 touchcancel 事件，对应
 * lock.addEventListener('touchcancel', resetLockState) 分支。
 */
async function touchCancel(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, pointerId: 0 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
}

/** 取当前锁屏状态和 clickCount（诊断），打印到日志 */
async function snapshot(page, label) {
  const r = await page.evaluate(() => ({
    lockHidden: document.getElementById('lock').classList.contains('hide'),
    phoneShown: document.getElementById('phone').classList.contains('show'),
    clickCount: window.__clickCount,
  }));
  console.log(`  [diag ${label}] lockHidden=${r.lockHidden} phoneShown=${r.phoneShown} clickCount=${r.clickCount}`);
  return r;
}

async function main() {
  console.log('\n=== inspect-phone 回归测试 v3（位移守卫边界 + 纯 CDP touch）===');
  console.log('BASE:', BASE);

  // ---- Test 1: 窄屏无白边（HTML/CSS 层，9 条断言）----
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

  // ---- Test 2: 首次上滑解锁（大位移 dy=-350，纯 CDP touch）----
  console.log('\n--- Test 2: 首次 touch 上滑解锁（dy=-350）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-350');
    assert(r.lockHidden === true, '首次 touch 上滑后锁屏隐藏');
    assert(r.phoneShown === true, '桌面内容已显示');
    await browser.close();
  }

  // ---- Test 3: 原地轻点 dy=0 → 允许解锁 ----
  // 位移守卫容差 ≤8px 应放行 tap click。用 Playwright mouse.click() 保证 click 事件真的生成。
  console.log('\n--- Test 3: dy=0 原地轻点 → 允许解锁（守卫 ≤8px 放行）---');
  {
    const { browser, page } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    await page.locator('#lock').click();
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=0 tap');
    assert(r.lockHidden === true, '原地轻点后锁屏隐藏（tap 通过守卫）');
    await browser.close();
  }

  // ---- Test 4: dy=-10 CDP touch → 锁屏保持可见 ----
  // 位移 10 > TAP_MOVE_TOLERANCE_PX=8，守卫拦截 click 兜底；
  // 同时 |dy|=10 < SWIPE_UP_THRESHOLD_PX=36，滑动通道也不触发。
  console.log('\n--- Test 4: dy=-10 → 锁屏保持可见（守卫 8px 拦截）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // (195, 700) → (195, 690): dy = -10
    await touchSwipe(cdp, 195, 700, 195, 690);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-10');
    assert(r.lockHidden === false, 'dy=-10 锁屏保持可见（守卫 8px 拦截 click，滑动通道也未达 -36）');
    await browser.close();
  }

  // ---- Test 5: dy=-15 CDP touch → 锁屏保持可见 ----
  console.log('\n--- Test 5: dy=-15 → 锁屏保持可见 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // (195, 700) → (195, 685): dy = -15
    await touchSwipe(cdp, 195, 700, 195, 685);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-15');
    assert(r.lockHidden === false, 'dy=-15 锁屏保持可见');
    await browser.close();
  }

  // ---- Test 6: dy=-25 CDP touch → 锁屏保持可见 ----
  console.log('\n--- Test 6: dy=-25 → 锁屏保持可见 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // (195, 700) → (195, 675): dy = -25
    await touchSwipe(cdp, 195, 700, 195, 675);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-25');
    assert(r.lockHidden === false, 'dy=-25 锁屏保持可见');
    await browser.close();
  }

  // ---- Test 7: dy=-36 CDP touch → 锁屏保持可见（严格 < -36 才触发，边界不触发）----
  console.log('\n--- Test 7: dy=-36 → 锁屏保持可见（边界 -36 不触发 shouldUnlock）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // (195, 700) → (195, 664): dy = -36
    await touchSwipe(cdp, 195, 700, 195, 664);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-36');
    assert(r.lockHidden === false, 'dy=-36 锁屏保持可见（边界不触发）');
    await browser.close();
  }

  // ---- Test 8: dy=-37 CDP touch → 解锁成功 ----
  console.log('\n--- Test 8: dy=-37 → 解锁，锁屏隐藏 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // (195, 700) → (195, 663): dy = -37
    await touchSwipe(cdp, 195, 700, 195, 663);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dy=-37');
    assert(r.lockHidden === true, 'dy=-37 解锁，锁屏隐藏（刚过阈值）');
    assert(r.phoneShown === true, '桌面内容已显示');
    await browser.close();
  }

  // ---- Test 9: 横向滑动 dx=300 dy=0 → 锁屏保持可见 ----
  console.log('\n--- Test 9: 横向滑动 dx=300 dy=0 → 锁屏保持可见 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    await touchSwipe(cdp, 50, 400, 350, 400);
    await page.waitForTimeout(120);

    const r = await snapshot(page, 'dx=300 横向');
    assert(r.lockHidden === false, '横向 dx=300 dy=0 锁屏保持可见');
    await browser.close();
  }

  // ---- Test 10: touchCancel 后锁屏可见 + 后续完整上滑解锁 ----
  console.log('\n--- Test 10: CDP touchCancel 后锁屏可见，后续上滑解锁 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await installClickCounter(page);

    // 取消阶段：touchStart → touchCancel（空 touchPoints），不发 touchEnd
    await touchCancel(cdp, 195, 700);
    await page.waitForTimeout(120);

    const afterCancel = await snapshot(page, 'touchCancel 后');
    assert(afterCancel.lockHidden === false, 'touchCancel 后锁屏仍可见（未误解锁）');

    // 紧接着完整上滑——验证 cancel 状态没卡死
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(120);

    const afterSwipe = await snapshot(page, 'cancel 后上滑');
    assert(afterSwipe.lockHidden === true, 'touchCancel 后完整上滑解锁成功（状态已复位）');
    assert(afterSwipe.phoneShown === true, '桌面内容已显示');
    await browser.close();
  }

  // ---- Test 11: 桌面 1280x900 外壳保留 ----
  console.log('\n--- Test 11: 桌面 1280x900 外壳保留 ---');
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

  // ---- 总结 ----
  const skipped = 0;  // 本脚本无 skip
  console.log(`\n=== 总计 ${passedAssertions}/${totalAssertions} 通过, ${skipped} skip ===`);
  if (passedAssertions !== totalAssertions) {
    process.exitCode = 1;
  }
}

main().catch(err => { console.error('FATAL:', err?.message || err); process.exit(1); });
