/**
 * 聊天数据隔离：真实浏览器读写验证（本机优先 msedge，CI 回退内置 chromium）。
 * 覆盖：角色 A/B/全局聊天背景、聊天名片和转发按会话隔离、两套封面互不覆盖。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.resolve(ROOT, '.' + urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

const image = (label) => 'data:image/png;base64,' + label;

const SEED = {
  ai_custom_characters: JSON.stringify([
    { id: 'iso_A', name: '测试角色 A' },
    { id: 'iso_B', name: '测试角色 B' }
  ]),
  beauty_chat_global_v1: JSON.stringify({
    v: 1,
    updatedAt: 1,
    vars: { chatBg: 'idb-image:beauty_chat_bg_global' }
  }),
  beauty_chat_bg_global: image('GLOBALIMG'),
  beauty_chat_bg_role_iso_A: image('ROLEAIMG'),
  chat_history_iso_A: JSON.stringify([
    {
      role: 'user',
      type: 'card',
      card: { id: 'card-1', name: '卡片甲', avatar: '' },
      text: '',
      time: 1,
      mid: 'mid-card-1'
    },
    { role: 'received', text: 'A 会话的普通消息', time: 2, mid: 'mid-a-2' }
  ]),
  chat_history_iso_B: JSON.stringify([
    { role: 'received', text: 'B 会话的普通消息', time: 3, mid: 'mid-b-3' }
  ]),
  chat_list_cover_v1: image('CHATCOVER'),
  chat_list_cover_migrated_v1: '1',
  my_home_cover_v1: image('HOMECOVER'),
  my_home_cover_migrated_v1: '1',
  myProfile: JSON.stringify({ nickname: '我', cover: image('PROFILECOVER') })
};

async function waitForStyleValue(page, needle) {
  await page.waitForFunction(
    (value) => {
      const el = document.getElementById('chat-messages');
      if (!el) return false;
      return el.style.getPropertyValue('--chat-bg-image').indexOf(value) !== -1;
    },
    needle,
    { timeout: 6000 }
  );
}

async function waitForText(page, text, present) {
  await page.waitForFunction(
    (arg) => document.body.innerText.indexOf(arg.text) !== -1 === arg.present,
    { text, present },
    { timeout: 6000, polling: 100 }
  );
}

async function verifyForwarding(page, origin) {
  const sourceUrl = origin + '/chat/chat/chat-detail.html?id=iso_A';
  const targetUrl = origin + '/chat/chat/chat-detail.html?id=iso_B';
  const sourceText = 'A 会话的普通消息';
  const legacyText = 'B 的旧版聊天记录';
  const sourceKey = 'chat_history_iso_A';
  const targetKey = 'chat_history_iso_B';
  const broken = '{"incomplete":';
  const legacy = JSON.stringify({ iso_B: { chat: { history: [
    { role: 'received', text: legacyText, mid: 'legacy-b', time: 1 }
  ] } } });
  await page.goto(sourceUrl);
  const read = key => page.evaluate(name => localStorage.getItem(name), key);
  const sourceBytes = await read(sourceKey);
  await page.evaluate(({ targetKey, broken, legacy }) => {
    localStorage.setItem(targetKey, broken);
    localStorage.setItem('phone_data_v2', legacy);
  }, { targetKey, broken, legacy });

  const forward = async () => {
    await page.getByText(sourceText, { exact: true }).click({ delay: 650 });
    await page.locator('[data-act="forward"]').click();
    await page.locator('#fwList [data-id="iso_B"]').click();
  };
  await forward();
  await page.getByText('目标会话记录异常，已停止转发以保护原始数据', { exact: true }).waitFor();
  assert.equal(await read(targetKey), broken);
  assert.equal(await read('phone_data_v2'), legacy);
  assert.equal(await read(sourceKey), sourceBytes);

  await page.evaluate(key => localStorage.removeItem(key), targetKey);
  await forward();
  await page.getByText('已转发给 测试角色 B', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await read(targetKey)).map(message => message.text), [legacyText, sourceText]);
  assert.equal(await read(sourceKey), sourceBytes);
  await page.goto(targetUrl);
  await page.reload();
  await page.getByText(sourceText, { exact: true }).waitFor();
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('NOT RUN: Playwright 不可用 ->', err && err.message);
    process.exit(1);
  }

  let browser;
  let browserLabel;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    browserLabel = 'msedge';
  } catch (err) {
    browser = await chromium.launch({ headless: true });
    browserLabel = 'bundled-chromium (msedge 不可用，已回退)';
  }
  console.log('[browser]', browserLabel);

  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  await context.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript((seed) => {
    Object.keys(seed).forEach((key) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, seed[key]);
      }
    });
  }, SEED);

  const page = await context.newPage();

  try {
    // 1. 全局聊天背景：无角色配置时 A/B 都显示全局图
    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_A', { waitUntil: 'domcontentloaded' });
    await waitForStyleValue(page, 'GLOBALIMG');
    results.push('A 会话显示全局聊天背景');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_B', { waitUntil: 'domcontentloaded' });
    await waitForStyleValue(page, 'GLOBALIMG');
    results.push('B 会话显示全局聊天背景');

    // 2. 角色 A 覆盖：A 显示角色图，B 仍显示全局图（不串）
    await page.evaluate(() => {
      localStorage.setItem('beauty_chat_iso_A', JSON.stringify({
        v: 1,
        updatedAt: 2,
        vars: { chatBg: 'idb-image:beauty_chat_bg_role_iso_A' }
      }));
    });
    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_A', { waitUntil: 'domcontentloaded' });
    await waitForStyleValue(page, 'ROLEAIMG');
    results.push('A 会话优先显示角色专属背景');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_B', { waitUntil: 'domcontentloaded' });
    await waitForStyleValue(page, 'GLOBALIMG');
    results.push('B 会话未被 A 的角色背景覆盖');

    // 3. 名片快照只在所属会话渲染
    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_A', { waitUntil: 'domcontentloaded' });
    await waitForText(page, '卡片甲', true);
    results.push('A 会话渲染名片快照');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=iso_B', { waitUntil: 'domcontentloaded' });
    await waitForText(page, 'B 会话的普通消息', true);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('卡片甲')), false);
    results.push('B 会话不出现 A 的名片');

    await verifyForwarding(page, origin);
    results.push('转发保护目标原始数据，旧版历史可追加并在刷新后读回');

    // 4. 聊天列表封面与我的主页封面互不覆盖
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const box = document.getElementById('coverBox');
        return !!box && box.style.backgroundImage.indexOf('CHATCOVER') !== -1;
      },
      { timeout: 6000 }
    );
    assert.equal(await page.evaluate(() => document.getElementById('coverBox').style.backgroundImage.includes('HOMECOVER')), false);
    results.push('聊天列表显示自己的封面');

    await page.goto(origin + '/chat/moments/my-moments.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const img = document.getElementById('coverImg');
        return !!img && img.src.indexOf('HOMECOVER') !== -1;
      },
      { timeout: 6000 }
    );
    assert.equal(await page.evaluate(() => document.getElementById('coverImg').src.includes('CHATCOVER')), false);
    results.push('我的主页显示自己的封面');

    // 5. 编辑共享 myProfile.cover 后，两套独立封面保持不变
    await page.evaluate(() => {
      localStorage.setItem('myProfile', JSON.stringify({ nickname: '我', cover: 'data:image/png;base64,PROFILECOVER2' }));
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const box = document.getElementById('coverBox');
        return !!box && box.style.backgroundImage.indexOf('CHATCOVER') !== -1;
      },
      { timeout: 6000 }
    );
    await page.goto(origin + '/chat/moments/my-moments.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const img = document.getElementById('coverImg');
        return !!img && img.src.indexOf('HOMECOVER') !== -1;
      },
      { timeout: 6000 }
    );
    results.push('编辑 myProfile.cover 不覆盖两套独立封面');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((done) => server.close(done));
  }

  results.forEach((line) => console.log('PASS -', line));
  console.log('ALL PASS:', results.length);
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
