/**
 * 侦探案件解锁链路 · 真实 Chromium 回归（GAME-UNLOCK-001）。
 *
 * 运行方式：npm run test:detective:unlock:browser（会先 vite build，再用 vite preview 提供产物）。
 * 依赖：playwright 的本地 Chromium（如缺失先执行 npx playwright install chromium）。
 *
 * 场景：
 *   A. 用户历史存档快照（BUG-REPORT-案件解锁.md 的真实数据）：
 *      案件01 显示已结案、案件02 可进入沉浸式，刷新后仍保持；
 *   B. 全新存档完整结案链路：沉浸式通关案件01 → 案件02 解锁 → 刷新保持，
 *      且不再写全局 immCasesDone 镜像；
 *   C. 角色隔离：另一角色看不到别人的解锁进度；
 *   D. 存储写入失败：不显示「已结案」、如实提示保存失败、案件02 不解锁；
 *   E. 375 / 390 / 430 视口：档案室与沉浸式页面可交互、无横向溢出。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distGames = resolve(root, 'dist/games/games.html');
const PORT = 3477;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(distGames)) {
  console.error('缺少 dist/games/games.html，请先执行 npm run build（本脚本应由 npm run test:detective:unlock:browser 调用）。');
  process.exit(1);
}

/* ---------- 用户浏览器实际 localStorage 快照（来自 BUG-REPORT-案件解锁.md） ---------- */
const USER_SNAPSHOT = {
  maomao_game_role: 'role_3',
  maomao_detective_progress_v1: JSON.stringify({
    role_3: {
      completed: [0],
      attempts: {},
      notes: { '潮汐档案室的最后一夜': { result: 'solved', day: '2026-10-29', legacy: true } },
      campaign: { trust: {}, flags: [], threads: [], choices: [] }
    },
    'default-partner': {
      completed: [0],
      notes: {
        '潮汐档案室的最后一夜': {
          result: 'solved', day: '2026-10-29', suspect: '贺知远', evidence: 7, source: 'immersive'
        }
      },
      attempts: {},
      campaign: { trust: {}, flags: [], threads: [], choices: [] }
    }
  }),
  immCasesDone: JSON.stringify([0]),
  maomao_detective_team_v1: JSON.stringify(['role_3', 'role_1', 'role_2']),
  maomao_detective_immersive_progress_migrated_v1: '1'
};

const ROLES_SEED = {
  ai_custom_characters: JSON.stringify([
    { id: 'role_3', name: '侦探甲', description: '冷静细致' },
    { id: 'role_1', name: '侦探乙', description: '行动派' }
  ]),
  immCasesDone: JSON.stringify([]),
  maomao_detective_team_v1: JSON.stringify(['role_3'])
};

function startPreviewServer() {
  const child = spawn(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) { /* 服务器未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview 服务器未在 ${timeoutMs}ms 内就绪：${url}`);
}

async function seed(page, data) {
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      try { localStorage.setItem(k, v); } catch (e) { /* 忽略单个键的失败 */ }
    }
  }, data);
}

async function openArchive(page) {
  await page.goto(`${BASE}/games/games.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('.game-row[data-game="detective"]').click();
  await page.locator('#caseArchiveList .case-archive-item').first().waitFor({ timeout: 15000 });
  return page.locator('#caseArchiveList .case-archive-item');
}

async function clickAct(page, act) {
  const loc = page.locator(`#immRoot [data-act="${act}"]`).locator('visible=true').first();
  await loc.click({ timeout: 15000 });
}

/** 完整走通沉浸式案件01：开场 → 现场找齐线索(自动推进) → 推理板 → 指认真凶(下标1) → 提交 */
async function playImmersiveCase0(page) {
  await page.locator('#caseArchiveList .case-archive-item').first().click();
  await page.locator('#immRoot').waitFor({ timeout: 15000 });
  await clickAct(page, 'enter');
  // 现场勘查：逐个点开热点（data-hot），关掉线索详情单；全部找齐后 2.6s 自动推进到「见相关人员」
  const hotCount = await page.locator('#immRoot [data-hot]').count();
  assert.ok(hotCount > 0, '现场页没有可勘查的热点');
  for (let i = 0; i < hotCount; i += 1) {
    await page.locator('#immRoot [data-act="close-sheet"]').locator('visible=true').first()
      .click({ timeout: 3000 }).catch(() => {});
    await page.locator(`#immRoot [data-hot="${i}"]`).locator('visible=true').first()
      .click({ timeout: 10000 });
  }
  await page.locator('#immRoot [data-act="close-sheet"]').locator('visible=true').first()
    .click({ timeout: 3000 }).catch(() => {});
  await page.locator('#immRoot [data-act="goto-deduction"]').locator('visible=true').first()
    .waitFor({ timeout: 20000 });
  await clickAct(page, 'goto-deduction');
  await clickAct(page, 'goto-accuse');
  await page.locator('#immRoot [data-acc="1"]').first().click();
  await clickAct(page, 'submit-accusation');
}

let passed = 0;
async function scenario(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n    ') : err}`);
    throw err;
  }
}

/* __SCENARIOS__ */
async function main() {
  const server = startPreviewServer();
  let browser;
  try {
    await waitForServer(`${BASE}/games/games.html`);
    browser = await chromium.launch();

    /* ---------- A. 用户历史存档快照（390px） ---------- */
    await scenario('A 用户快照：案件01已结案、案件02解锁，刷新后保持（390px）', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await seed(page, USER_SNAPSHOT);
      let cards = await openArchive(page);
      assert.ok(!(await cards.nth(0).isDisabled()), '案件01 应可点击');
      assert.match(await cards.nth(0).locator('.case-archive-status').textContent(), /已结案/, '案件01 应显示已结案');
      assert.ok(!(await cards.nth(1).isDisabled()), '案件02 不应被锁定');
      await cards.nth(1).click();
      await page.locator('#immRoot').waitFor({ timeout: 15000 });
      // 刷新后状态保持
      cards = await openArchive(page);
      assert.ok(!(await cards.nth(1).isDisabled()), '刷新后案件02 仍应解锁');
      assert.match(await cards.nth(0).locator('.case-archive-status').textContent(), /已结案/);
      await ctx.close();
    });

    /* ---------- B. 全新存档完整结案链路（375px） ---------- */
    await scenario('B 全新存档：沉浸式通关案件01 → 案件02解锁 → 刷新保持，不写全局镜像（375px）', async () => {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
      const page = await ctx.newPage();
      await seed(page, ROLES_SEED); // 不 seed 进度键，解锁必须来自本次结案写入
      let cards = await openArchive(page);
      assert.ok(await cards.nth(1).isDisabled(), '初始案件02 应被锁定');
      assert.match(await cards.nth(0).locator('.case-archive-status').textContent(), /可调查/);

      await playImmersiveCase0(page);
      await page.locator('#immRoot').getByText('已结案', { exact: true }).waitFor({ timeout: 10000 });
      const progress = JSON.parse(await page.evaluate(() => localStorage.getItem('maomao_detective_progress_v1') || '{}'));
      assert.ok(progress.role_3 && progress.role_3.completed.includes(0), '结案应写入 role_3 的按角色存档');
      assert.equal(await page.evaluate(() => localStorage.getItem('immCasesDone')), '[]', '不得再写全局 immCasesDone 镜像');

      await clickAct(page, 'back-archive');
      await page.locator('#caseArchiveList .case-archive-item').first().waitFor({ timeout: 15000 });
      cards = page.locator('#caseArchiveList .case-archive-item');
      assert.ok(!(await cards.nth(1).isDisabled()), '结案后案件02 应解锁');

      // 刷新（模拟退出重进）：进度来自已持久化的按角色存档
      cards = await openArchive(page);
      assert.ok(!(await cards.nth(1).isDisabled()), '刷新后案件02 仍应解锁');
      assert.match(await cards.nth(0).locator('.case-archive-status').textContent(), /已结案/);
      await ctx.close();
    });

    /* ---------- C. 角色隔离（390px） ---------- */
    await scenario('C 角色隔离：侦探乙（无进度）看不到侦探甲的解锁（390px）', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await seed(page, ROLES_SEED);
      let cards = await openArchive(page);
      assert.ok(await cards.nth(1).isDisabled(), 'role_3 结案前案件02 应锁定');
      await playImmersiveCase0(page);
      await page.locator('#immRoot').getByText('已结案', { exact: true }).waitFor({ timeout: 10000 });
      await clickAct(page, 'back-archive');

      // 切到 role_1（从未结案）
      await page.evaluate(() => localStorage.setItem('maomao_game_role', 'role_1'));
      cards = await openArchive(page);
      assert.match(await cards.nth(0).locator('.case-archive-status').textContent(), /可调查/, 'role_1 的案件01 不应显示已结案');
      assert.ok(await cards.nth(1).isDisabled(), 'role_1 的案件02 应保持锁定');

      // 切回 role_3
      await page.evaluate(() => localStorage.setItem('maomao_game_role', 'role_3'));
      cards = await openArchive(page);
      assert.ok(!(await cards.nth(1).isDisabled()), 'role_3 的案件02 应解锁');
      await ctx.close();
    });

/* __SCENARIOS2__ */
    /* ---------- D. 存储写入失败不假成功（430px） ---------- */
    await scenario('D 写入失败：不盖「已结案」章、如实提示保存失败、案件02 不解锁（430px）', async () => {
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
      const page = await ctx.newPage();
      await seed(page, ROLES_SEED);
      await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'maomao_detective_progress_v1') throw new Error('QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      let cards = await openArchive(page);
      // startCase 的 heal+save 失败必须可见（toast）
      await page.locator('#toast.show').getByText('案件进度保存失败', { exact: false }).waitFor({ timeout: 5000 });

      await playImmersiveCase0(page);
      await page.locator('#immRoot').getByText('未归档', { exact: true }).waitFor({ timeout: 10000 });
      await page.locator('#immRoot').getByText('结案进度保存失败', { exact: false }).first().waitFor({ timeout: 5000 });
      const stampTexts = await page.locator('#immRoot').getByText('已结案', { exact: true }).count();
      assert.equal(stampTexts, 0, '保存失败时不得展示「已结案」章');

      await clickAct(page, 'back-archive');
      await page.locator('#caseArchiveList .case-archive-item').first().waitFor({ timeout: 15000 });
      cards = page.locator('#caseArchiveList .case-archive-item');
      assert.ok(await cards.nth(1).isDisabled(), '进度未持久化时案件02 必须保持锁定');
      await ctx.close();
    });

    /* ---------- E. 375 / 390 / 430 视口交互 ---------- */
    await scenario('E 视口回归：375/390/430 档案室可交互、无横向溢出、可进入沉浸式', async () => {
      for (const width of [375, 390, 430]) {
        const ctx = await browser.newContext({ viewport: { width, height: 812 } });
        const page = await ctx.newPage();
        await seed(page, USER_SNAPSHOT);
        const cards = await openArchive(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${width}px 档案室出现横向溢出（${overflow}px）`);
        assert.ok(!(await cards.nth(1).isDisabled()), `${width}px 案件02 应可点击`);
        await cards.nth(1).click();
        await page.locator('#immRoot').waitFor({ timeout: 15000 });
        await clickAct(page, 'enter');
        const enterOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(enterOverflow <= 1, `${width}px 沉浸式现场出现横向溢出（${enterOverflow}px）`);
        await ctx.close();
      }
    });

    console.log(`\n浏览器回归全部通过：${passed}/5 个场景（Chromium + vite preview, dist 产物）`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
  }
}

main().catch(() => {
  console.error('\n浏览器回归失败。');
  process.exit(1);
});

