/**
 * CHAT-AVATAR-003 — real Chromium acceptance, 375 / 390 / 430 px.
 *
 * Prerequisite: npm run build
 * Then: npm run test:role:avatars:browser
 * Optional: CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
 *
 * Everything is synthetic, locally served and isolated by browser context.
 * No MAOMAO account, API token, server data, screenshots or remote requests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const widths = [375, 390, 430];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

async function serve(req, res) {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const resolved = path.resolve(root, '.' + pathname);
    if (!resolved.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await fs.readFile(resolved);
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(resolved)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }).end(body);
  } catch (_) {
    res.writeHead(404).end('Not Found');
  }
}

const examplePhotos = [
  { name: 'alpha.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#dddddd"/></svg>') },
  { name: 'beta.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777777"/></svg>') }
];

async function verifyPage(browser, base, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true
  });
  const page = await context.newPage();
  const errors = [];
  const missing = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() >= 400) {
      missing.push(response.status() + ' ' + new URL(response.url()).pathname);
    }
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')
      ? route.continue() : route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    const roles = [
      { id: 'role-A', name: '测试角色甲', avatar: '', avatarAutonomyEnabled: true },
      { id: 'role-B', name: '测试角色乙', avatar: '', avatarAutonomyEnabled: true }
    ];
    // Preserve edits across reload; only a fresh test context is seeded.
    if (!localStorage.getItem('ai_custom_characters')) {
      localStorage.setItem('ai_custom_characters', JSON.stringify(roles));
    }
    if (!localStorage.getItem('myProfile')) {
      localStorage.setItem('myProfile', JSON.stringify({ avatar: 'sentinel-only' }));
    }
  });

  try {
    const address = base + '/chat/chat/avatar-manager.html?roleId=role-A';
    const navigation = await page.goto(address, { waitUntil: 'domcontentloaded' });
    assert.equal(navigation?.status(), 200, 'portrait route must be served');
    await page.waitForFunction(() => Boolean(window.RoleAvatarLibrary), null, { timeout: 15000 });
    assert.equal(await page.locator('#roleName').textContent(), '测试角色甲');
    assert.equal(await page.locator('#album .portrait').count(), 0);
    assert.equal(await page.locator('#advancedMenu').count(), 1);

    // Use the real MediaRepository/IndexedDB, never stub the storage layer.
    await page.locator('#avatarFiles').setInputFiles(examplePhotos);
    await page.waitForFunction(() => document.querySelectorAll('#album .portrait').length === 2, null, { timeout: 15000 });
    assert.equal(await page.locator('#libraryCount').textContent(), '02');
    const first = page.locator('#album .portrait').nth(0);
    await first.click();
    await page.getByRole('button', { name: '设为 TA 的当前头像' }).click();
    await page.waitForFunction(() => !!JSON.parse(
      localStorage.getItem('ai_custom_characters') || '[]'
    ).find(role => role.id === 'role-A')?.avatarAssetId, null, { timeout: 12000 });
    assert.equal(await page.locator('#currentState').textContent(), '已应用');
    await page.locator('#startPair').click();
    await first.click();
    await page.locator('#album .portrait').nth(1).click();
    assert.equal(await page.locator('#createPair').isEnabled(), true);
    assert.equal(await page.locator('#album .portrait').nth(0).getAttribute('aria-pressed'), 'true');
    await page.locator('#createPair').click();
    await page.waitForFunction(() => document.querySelectorAll('#pairList .pair').length === 1, null, { timeout: 12000 });
    assert.equal(await page.locator('#pairCount').textContent(), '01');

    await page.locator('#pairList .pair').click();
    await page.getByRole('button', { name: '双方使用这组情头' }).click();
    await page.waitForFunction(() => {
      const roles = JSON.parse(localStorage.getItem('ai_custom_characters') || '[]');
      return !!roles.find(role => role.id === 'role-A')?.avatarAssetId &&
        !!localStorage.getItem('maomao_chat_pair_user_avatar_v1_role-A');
    }, null, { timeout: 12000 });
    const afterPair = await page.evaluate(() => ({
      selected: JSON.parse(localStorage.getItem('maomao_chat_pair_user_avatar_v1_role-A') || '{}'),
      other: JSON.parse(localStorage.getItem('ai_custom_characters') || '[]').find(role => role.id === 'role-B'),
      profile: localStorage.getItem('myProfile')
    }));
    assert.ok(afterPair.selected.assetId, 'only this chat should receive the user portrait');
    assert.equal(afterPair.other.avatar, '', 'other character cannot change');
    assert.equal(afterPair.profile, '{"avatar":"sentinel-only"}', 'global avatar cannot change');

    await page.locator('#pairList .pair').click();
    await page.getByRole('button', { name: '重命名这组情头' }).click();
    await page.locator('#renameInput').fill('晨雨');
    await page.getByRole('button', { name: '保存' }).click();
    await page.waitForFunction(() =>
      document.querySelector('#pairList .pair strong')?.textContent === '晨雨',
      null, { timeout: 12000 });

    await page.locator('#pairList .pair').click();
    await page.getByRole('button', { name: '交换 A / B 顺序' }).click();
    await page.waitForFunction(() => document.querySelector('#pairList .pair') !== null);
    assert.equal(await page.locator('#pairList .pair').count(), 1);

    await page.locator('#advancedMenu summary').click();
    await page.locator('#autonomyToggle').uncheck({ force: true });
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ai_custom_characters') || '[]')
        .find(role => role.id === 'role-A').avatarAutonomyEnabled), false);
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ai_custom_characters') || '[]')
        .find(role => role.id === 'role-B').avatarAutonomyEnabled), true);
    await page.locator('#advancedMenu summary').click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#album .portrait').length === 2, null, { timeout: 15000 });
    assert.equal(await page.locator('#pairList .pair').count(), 1);
    assert.equal(await page.locator('#pairList .pair strong').textContent(), '晨雨');
    assert.equal(await page.locator('#autonomyToggle').isChecked(), false);

    // Removal must be a two-stage in-page confirmation; cancel is harmless.
    await page.locator('#pairList .pair').click();
    await page.getByRole('button', { name: /解除配对/ }).click();
    assert.equal(await page.locator('#pairList .pair').count(), 1);
    await page.getByRole('button', { name: '取消' }).click();
    assert.equal(await page.locator('#pairList .pair').count(), 1);
    await page.locator('#pairList .pair').click();
    await page.getByRole('button', { name: /解除配对/ }).click();
    await page.getByRole('button', { name: '确认解除' }).click();
    await page.waitForFunction(() => document.querySelectorAll('#pairList .pair').length === 0, null, { timeout: 12000 });
    assert.equal(await page.locator('#album .portrait').count(), 2, 'unlink never removes original photos');

    // Removing an unpaired, inactive photo must not delete the current one.
    const inactive = page.locator('#album .portrait').filter({
      hasNot: page.locator('.chip')
    }).first();
    await inactive.click();
    await page.getByRole('button', { name: '从收藏移除' }).click();
    assert.equal(await page.locator('#album .portrait').count(), 2);
    await page.getByRole('button', { name: '确认移除' }).click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#album .portrait').length === 1,
      null, { timeout: 12000 });
    assert.equal(await page.locator('#currentState').textContent(), '已应用');
    assert.equal(await page.evaluate(() => localStorage.getItem('myProfile')),
      '{"avatar":"sentinel-only"}');

    const geometry = await page.evaluate(() => {
      const frame = document.querySelector('.phone').getBoundingClientRect();
      const scroll = document.querySelector('.scroll').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        frameX: frame.x,
        frameRight: frame.right,
        scrollBottom: scroll.bottom,
        viewportHeight: window.innerHeight
      };
    });
    assert.ok(geometry.scrollWidth <= geometry.viewportWidth + 1, 'page must not overflow horizontally');
    assert.ok(geometry.frameX >= -1 && geometry.frameRight <= width + 1, 'frame must fit viewport');
    assert.ok(geometry.scrollBottom <= geometry.viewportHeight + 1, 'scroll area must fit visible phone');
    assert.deepEqual(errors, [], 'the page must not raise uncaught JavaScript errors');
    assert.deepEqual(missing, [], 'no local page asset may return 4xx');
    return { width, result: 'PASS', uploaded: 2, manualApply: true, pairsCreated: 1,
      pairRenamed: true, pairSwapped: true, pairUnlinked: 1, inactivePhotoRemoved: true,
      roleIsolation: true };
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.access(path.join(root, 'chat/chat/avatar-manager.html'));
  const server = http.createServer((req, res) => { void serve(req, res); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox']
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const width of widths) {
      const result = await verifyPage(browser, base, width);
      console.log(JSON.stringify(result));
    }
    console.log('CHAT-AVATAR-003 browser acceptance: 3/3 viewport flows passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error('CHAT-AVATAR-003 browser acceptance FAILED:', error.stack || error);
  process.exitCode = 1;
});
