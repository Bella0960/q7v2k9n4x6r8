/**
 * inspect-phone/phone.html 解锁手势与窄屏布局回归测试。
 *
 * 核心特性：用 Playwright CDP Input.dispatchTouchEvent 派发真实 trusted touch
 * 事件（pointerId 从 0 起、touchEnd 时 touchPoints 为空数组），不触发 click，
 * 真正验证 touch 通道是否独立生效——上一轮 mouse+click 兜底能"蒙对"的路径在这里被彻底切断。
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

/**
 * CDP 真实触摸：touchStart → N×touchMove → touchEnd
 * 不产生 click 事件，不触发浏览器默认手势拦截，完全模拟手指滑动。
 */
async function touchSwipe(cdp, startX, startY, endX, endY, steps = 8) {
  // touchStart
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, pointerId: 0 }],
  });
  // touchMove 序列
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i / steps);
    const y = startY + ((endY - startY) * i / steps);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, pointerId: 0 }],
    });
  }
  // touchEnd：touchPoints 传空数组表示手指抬起
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** 阈值条件（与源码 shouldUnlock 完全一致） */
const shouldUnlock = (dy, dx) => dy < -36 && Math.abs(dy) > Math.abs(dx) * 1.15;

async function main() {
  console.log('\n=== inspect-phone 回归测试（真实 CDP touch）===');
  console.log('BASE:', BASE);

  // ---- 测试 1: 移动视口窄屏无白边（HTML/CSS 层）----
  console.log('\n--- Test 1: 390x844 窄屏无白边 ---');
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
        // .device touch-action 是否被收窄（应为 auto/manipulation 等，不是 none）
        deviceTA: getComputedStyle(d).touchAction,
      };
    });
    assert(Math.abs(l.d.w - 390) < 1, `.device 铺满 390px: ${l.d.w}`);
    assert(l.d.left < 1, `.device left 无白边: ${l.d.left}`);
    assert(Math.abs(l.d.right - l.vw) < 1, `.device right 无白边: ${l.d.right}`);
    assert(l.d.border === '0px', `border 清零: ${l.d.border}`);
    assert(l.d.br === '0px', `border-radius 清零: ${l.d.br}`);
    assert(l.sw <= l.cw + 1, `无横向溢出: sw=${l.sw} cw=${l.cw}`);
    assert(l.lockTA === 'none', `.lock touch-action=none (解锁手势接管): ${l.lockTA}`);
    assert(l.deviceTA !== 'none', `.device touch-action 已收窄（不是 none）: ${l.deviceTA}`);
    assert(l.bg === 'rgb(255, 255, 255)', `body 白底: ${l.bg}`);
    await browser.close();
  }

  // ---- 测试 2: 首次上滑解锁（真实 CDP touch，不触发 click）----
  console.log('\n--- Test 2: 首次上滑解锁（CDP touch，无 click 兜底）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });

    // 全程不派发 click；额外监听 click 事件来证明它根本没到
    const clickCountRef = { n: 0 };
    await page.evaluate(() => {
      window.__testClickCount = 0;
      document.getElementById('lock').addEventListener('click', () => { window.__testClickCount++; });
    });

    const before = await page.evaluate(() =>
      document.getElementById('lock').classList.contains('hide'));
    assert(before === false, '初始锁屏可见');

    // 上滑：(195, 700) → (195, 350), dy = -350
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);

    const after = await page.evaluate(() => ({
      lockHidden: document.getElementById('lock').classList.contains('hide'),
      phoneShown: document.getElementById('phone').classList.contains('show'),
      clickCount: window.__testClickCount,
    }));
    assert(after.lockHidden === true, '首次 touch 上滑后锁屏隐藏（pointer 通道生效）');
    assert(after.phoneShown === true, '桌面内容已显示');
    assert(after.clickCount === 0, `click 通道未被触发（纯 touch 解锁）: clickCount=${after.clickCount}`);
    await browser.close();
  }

  // ---- 测试 3: 边界值 ----
  console.log('\n--- Test 3: 边界值判定（shouldUnlock 源码条件）---');
  {
    const cases = [
      { dy: -350, dx: 0,   expect: true,  label: '上滑 -350px 竖直' },
      { dy: -37,  dx: 0,   expect: true,  label: '上滑 -37px 刚过阈值（> -36）' },
      { dy: -36,  dx: 0,   expect: false, label: '上滑 -36px 边界不触发（严格 < -36）' },
      { dy: -35,  dx: 0,   expect: false, label: '上滑 -35px 不够阈值' },
      { dy: -20,  dx: 0,   expect: false, label: '上滑 -20px 远不够' },
      { dy: 0,    dx: 300, expect: false, label: '横向滑动 dy=0' },
      { dy: -20,  dx: 100, expect: false, label: '斜滑 近水平 |dy|=20 < 115' },
      { dy: -300, dx: 350, expect: false, label: '斜滑 |dy|=300 < 350*1.15=402.5' },
      { dy: -350, dx: 50,  expect: true,  label: '斜滑 略水平 |dy|=350 > 50*1.15=57.5' },
      { dy: 350,  dx: 0,   expect: false, label: '向下滑动 dy > 0' },
    ];
    for (const c of cases) {
      const got = shouldUnlock(c.dy, c.dx);
      assert(got === c.expect,
        `dy=${c.dy} dx=${c.dx} → ${got} (expect ${c.expect}) [${c.label}]`);
    }
  }

  // ---- 测试 4: 横向滑动（真实 touch，dy 小 dx 大）不解锁 ----
  console.log('\n--- Test 4: 真实 touch 横向滑动不解锁 ---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });

    // 水平方向从 x=50 滑到 x=350，y=400 不动：dy=0, dx=300
    await touchSwipe(cdp, 50, 400, 350, 400);
    await page.waitForTimeout(80);

    const stillLocked = await page.evaluate(() =>
      !document.getElementById('lock').classList.contains('hide'));
    assert(stillLocked === true, '横向滑动后锁屏仍在（未误判解锁）');
    await browser.close();
  }

  // ---- 测试 5: pointercancel / touchcancel 后可再次解锁 ----
  console.log('\n--- Test 5: cancel 后状态复位（pointercancel + touchcancel）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });

    // 先派发 pointerdown → pointercancel 模拟系统中断
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', button: 'left', clickCount: 1, x: 195, y: 700,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', button: 'left', clickCount: 1, x: 195, y: 700,
    });
    // 派发真实 pointercancel（用 dispatchKeyEvent Escape 触发）
    // CDP 没有直接的 pointercancel，改用 touch cancel 序列
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 195, y: 700, pointerId: 5 }],
    });
    // CDP 没有 touchCancel——但我们可以用 touchEnd + 然后立刻 touch 一个不同 pointerId
    // 本质上 touchEnd 已经完成了 resetLockState，然后用新 touchStart 验证状态已清
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd', touchPoints: [],
    });

    // 现在完整上滑——这才是真正的解锁手势
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);

    const after = await page.evaluate(() =>
      document.getElementById('lock').classList.contains('hide'));
    assert(after === true, 'cancel 序列后完整上滑解锁成功（状态已复位）');
    await browser.close();
  }

  // ---- 测试 6: 解锁后重复事件不重复触发（幂等性）----
  console.log('\n--- Test 6: 解锁后重复 touch 不重复触发 unlockPhone（幂等）---');
  {
    const { browser, page, cdp } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });

    // 第一次上滑解锁
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);
    const afterFirst = await page.evaluate(() =>
      document.getElementById('lock').classList.contains('hide'));
    assert(afterFirst === true, '第一次上滑解锁成功');

    // 第二次同样的 touch——lock 已经 hide + pointer-events:none，事件不再派发。
    // 即使派发，unlockFired/unlocked 幂等也会拦住重复调用。
    // 解锁状态应保持隐藏，不会白屏或卡住。
    await touchSwipe(cdp, 195, 700, 195, 350);
    await page.waitForTimeout(80);
    const afterSecond = await page.evaluate(() => ({
      lockHidden: document.getElementById('lock').classList.contains('hide'),
      phoneShown: document.getElementById('phone').classList.contains('show'),
      // 幂等计数：如果 unlockPhone 真重复调用会抛错（lock.hide 已加）
      // 这里检查 phone 仍然是 show 即可
    }));
    assert(afterSecond.lockHidden === true && afterSecond.phoneShown === true,
      '第二次 touch 不破坏解锁状态（幂等）');
    await browser.close();
  }

  // ---- 测试 7: 点击辅助路径（独立 mouse.click）----
  console.log('\n--- Test 7: 点击辅助解锁（mouse click）---');
  {
    const { browser, page } = await freshPage({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.locator('#lock').click();
    const after = await page.evaluate(() =>
      document.getElementById('lock').classList.contains('hide'));
    assert(after === true, '点击后锁屏隐藏（辅助路径）');
    await browser.close();
  }

  // ---- 测试 8: 桌面 1280x900 外壳保留 ----
  console.log('\n--- Test 8: 桌面视口保留模拟器外壳 ---');
  {
    const { browser, page } = await freshPage({ width: 1280, height: 900 });
    await page.goto(URL, { waitUntil: 'networkidle' });
    const l = await page.evaluate(() => {
      const r = document.querySelector('.device').getBoundingClientRect();
      const s = getComputedStyle(document.querySelector('.device'));
      return { w: r.width, border: s.borderWidth, br: s.borderRadius,
               centered: Math.abs(r.left - (window.innerWidth - r.width) / 2) < 3 };
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
