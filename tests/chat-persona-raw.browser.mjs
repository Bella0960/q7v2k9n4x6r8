import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * 聊天上下文隔离：personaRaw 原文绝不进入聊天请求体。
 * 真实浏览器（本机 Edge）+ 本地 mock，不请求任何付费 API。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const RAW_MARKER = 'RAW-ONLY-MARKER-7f3a';
const PERSONA = '整理后人设：她在城南经营旧书店，性格安静。';
const ROLE = {
  id: 'role_raw',
  name: '林晚',
  persona: PERSONA,
  tone: '语速慢，喜欢停顿。',
  personaRaw: RAW_MARKER + '\n【人物关系】与常客老陈相熟。\n【个人线】准备重修二楼阅览室。',
  avatar: '',
  worldBookIds: []
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
      if (!filePath.startsWith(root)) return res.writeHead(403).end('Forbidden');
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise(server)));
}

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
const failures = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ role, base }) => {
    if (sessionStorage.getItem('__maomao_chat_seeded')) return;
    sessionStorage.setItem('__maomao_chat_seeded', '1');
    localStorage.clear();
    localStorage.setItem('ai_custom_characters', JSON.stringify([role]));
    localStorage.setItem('phone_worldbooks', JSON.stringify([]));
    localStorage.setItem('api_settings', JSON.stringify({
      apiKey: 'test-key',
      baseUrl: base + '/v1',
      model: 'test-model',
      temperature: 0.8
    }));
  }, { role: ROLE, base: baseUrl });

  const page = await context.newPage();
  const bodies = [];
  await page.route('**/chat/completions', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '嗯，我在。' } }] })
    });
  });

  await page.goto(baseUrl + '/chat/chat/chat-detail.html?id=' + ROLE.id, { waitUntil: 'load' });
  await sleep(200);

  await page.fill('#chat-input', '在吗？');
  await page.press('#chat-input', 'Enter');
  // 等请求真正到达（最多 8 秒）。
  const deadline = Date.now() + 8000;
  while (bodies.length === 0 && Date.now() < deadline) await sleep(100);

  const payload = bodies[0] ? JSON.stringify(bodies[0]) : '';
  check('聊天确有一次真实请求', bodies.length >= 1, { calls: bodies.length });
  check('请求体包含整理后的 persona', payload.includes(PERSONA), { length: payload.length });
  check('请求体不包含 personaRaw 原文', !payload.includes(RAW_MARKER), {
    leaked: payload.includes(RAW_MARKER)
  });
  check('请求体不包含原文分节内容', !payload.includes('【个人线】'), {});

  await context.close();
} catch (error) {
  failures.push('exception: ' + error.message);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}

for (const item of checks) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}`);
if (failures.length) {
  console.error('[chat-persona-raw] FAIL');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('[chat-persona-raw] PASS');
