/**
 * CHAT-001 真实浏览器验证（Playwright + 本机 Edge channel:'msedge'）。
 * 只验证已实现行为，不修改生产代码：
 *   1) 引用后编辑原消息 → 引用气泡文本同步
 *   2) 删除原消息 → 引用进入失效态且消息从历史消失
 *   3) 重新生成 → 旧引用失效且不指向新内容
 *   4) 失效引用的旧文本不进入 AI 请求体
 * 后端不存在，用 page.route 拦截 /chat/completions 并返回最小 SSE。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_ID = 'chat001-role';
const HISTORY_KEY = 'chat_history_' + ROLE_ID;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const T0 = Date.now() - 120000;
const SEED_HISTORY = [
  { mid: 'target-1', role: 'received', name: '小林', text: '原始消息内容', time: T0 },
  { mid: 'ai-1', role: 'received', name: '小林', text: 'AI 第一条回复', time: T0 + 1000 },
  {
    mid: 'ai-reply-1', role: 'sent', text: '引用这条 AI 回复', time: T0 + 2000,
    quote: { mid: 'ai-1', text: 'AI 第一条回复', fromRole: 'received', authorName: '小林' }
  }
];

const SSE_REPLY = '这是重生成后的回复。';
const results = [];
const consoleErrors = [];

function record(scenario, pass, evidence, note = '') {
  results.push({ scenario, pass, evidence, note });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${scenario} | ${evidence}${note ? ' | ' + note : ''}`);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--force-device-scale-factor=1'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(({ roleId, history, port }) => {
  if (localStorage.getItem('chat_history_' + roleId)) return; // 只首轮预置，避免刷新覆盖真实操作结果
  localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: '小林', persona: '测试角色', avatar: '' }]));
  localStorage.setItem('phone_current_contact', roleId);
  localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
  localStorage.setItem('phone_data_v2', JSON.stringify({}));
  localStorage.setItem('api_settings', JSON.stringify({
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${port}/api`,
    model: 'test-model'
  }));
}, { roleId: ROLE_ID, history: SEED_HISTORY, port: PORT });

const page = await context.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

const requests = [];
await page.route('**/api/chat/completions', async (route) => {
  requests.push(route.request().postData() || '');
  const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: SSE_REPLY } }] }) + '\n\n' +
    'data: [DONE]\n\n';
  await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
});

await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.msg-row[data-mid]').length >= 3, { timeout: 30000 });

const readHistory = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), HISTORY_KEY);
const row = (mid) => page.locator(`.msg-row[data-mid="${mid}"]`);
const quoteText = (mid) => page.locator(`.msg-row[data-mid="${mid}"] .msg-quoted-text`).first().textContent();
const quoteAuthor = (mid) => page.locator(`.msg-row[data-mid="${mid}"] .msg-quoted-author`).first().textContent();

async function longPress(mid) {
  const target = row(mid);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForSelector('#msgSheetOverlay.active', { timeout: 5000 });
}

async function actOnMessage(mid, act) {
  await longPress(mid);
  await page.click(`#msgSheetList [data-act="${act}"]`);
}

async function sendText(text) {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
}

// ---------- 场景 1：引用发送 → 编辑原消息 → 引用气泡同步 ----------
let replyMid = '';
try {
  await actOnMessage('target-1', 'quote');
  await page.waitForFunction(() => {
    const bar = document.getElementById('quoteBar');
    return bar && bar.style.display === 'block';
  });
  const beforeSend = requests.length;
  await sendText('引用回复第二条');
  await page.waitForFunction((n) => {
    const rows = document.querySelectorAll('.msg-row');
    return Array.from(rows).some((r) => r.querySelector('.msg-quoted-text') && !r.dataset.mid.startsWith('ai-reply'));
  }, beforeSend);
  const replyMidFound = await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('chat_history_chat001-role') || '[]');
    const m = arr.find((x) => x.text === '引用回复第二条');
    return m ? m.mid : '';
  });
  replyMid = replyMidFound;
  if (!replyMid) throw new Error('引用消息未落库');
  const firstQuote = await quoteText(replyMid);
  if (firstQuote !== '原始消息内容') throw new Error('初始引用文本不符: ' + firstQuote);

  await actOnMessage('target-1', 'edit');
  await page.fill('#editInput', '编辑后的原文');
  await page.click('#editConfirm');
  await page.waitForTimeout(350);

  const afterEditQuote = await quoteText(replyMid);
  const persisted = await readHistory();
  const quotePersisted = persisted.find((m) => m.mid === replyMid).quote.text;
  const pass = afterEditQuote === '编辑后的原文' && quotePersisted === '编辑后的原文';
  record('场景1 编辑同步引用气泡', pass, `DOM="${afterEditQuote}" storage="${quotePersisted}"`);
} catch (err) {
  record('场景1 编辑同步引用气泡', false, 'exception: ' + err.message);
}

// ---------- 场景 2：删除被引用消息 → 失效态 + 历史保留引用 ----------
try {
  await actOnMessage('target-1', 'delete');
  await page.waitForFunction(() => !document.querySelector('.msg-row[data-mid="target-1"]'), { timeout: 5000 });
  const replyStillThere = await row(replyMid).count();
  const author = await quoteAuthor(replyMid);
  const hasInvalidClass = await row(replyMid).locator('.msg-quoted-preview').evaluate(
    (el) => el.classList.contains('msg-quoted-invalid')
  );
  const persisted = await readHistory();
  const q = persisted.find((m) => m.mid === replyMid).quote;
  const targetGone = !persisted.some((m) => m.mid === 'target-1');
  const pass = replyStillThere === 1 && author.includes('原消息已删除') && hasInvalidClass &&
    q.invalid === true && q.text === '编辑后的原文' && targetGone;
  record('场景2 删除后引用失效', pass, `row="${replyStillThere}" author="${author}" invalidClass=${hasInvalidClass} storageInvalid=${q.invalid} targetGone=${targetGone}`);
} catch (err) {
  record('场景2 删除后引用失效', false, 'exception: ' + err.message);
}

// ---------- 场景 4：失效引用不进入 AI 请求体（跟进一条普通消息） ----------
try {
  const before = requests.length;
  await sendText('后续普通消息');
  await page.waitForFunction(() => true);
  const started = Date.now();
  while (requests.length <= before && Date.now() - started < 8000) await page.waitForTimeout(100);
  const body = requests[requests.length - 1] || '';
  const bodyHasDeletedQuotedText = body.includes('编辑后的原文');
  const bodyHasReplyContent = body.includes('引用回复第二条');
  const pass = !!body && !bodyHasDeletedQuotedText && bodyHasReplyContent;
  record('场景4 失效引用不进入 prompt', pass, `requestCaptured=${!!body} deletedQuoteInBody=${bodyHasDeletedQuotedText} replyInBody=${bodyHasReplyContent}`);
} catch (err) {
  record('场景4 失效引用不进入 prompt', false, 'exception: ' + err.message);
}

// 等待上一轮流式收尾，避免 aiSending 锁影响重生成
await page.waitForTimeout(800);

// ---------- 场景 3：重新生成 → 旧引用失效且不指向新内容 ----------
try {
  await actOnMessage('ai-1', 'rewrite');
  await page.waitForSelector('#regenOverlay', { state: 'visible', timeout: 5000 });
  const before = requests.length;
  await page.click('#regenConfirm');
  await page.waitForFunction(() => !document.querySelector('.msg-row[data-mid="ai-1"]'), { timeout: 5000 });
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.msg-row'));
    return rows.some((r) => r.dataset.mid && r.dataset.mid !== 'ai-1' && /这是重生成后的回复/.test(r.innerText || ''));
  }, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.waitForFunction((key) => {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return arr.some((m) => /这是重生成后的回复/.test((m.text || '') + (m.content || '')));
  }, HISTORY_KEY, { timeout: 10000 });

  const author = await quoteAuthor('ai-reply-1');
  const persisted = await readHistory();
  const q = persisted.find((m) => m.mid === 'ai-reply-1').quote;
  const newReply = persisted.find((m) => {
    const text = (m.text || '') + (m.content || '');
    return m.mid !== 'ai-1' && /这是重生成后的回复/.test(text);
  });
  const quoteBoundToNew = persisted.some((m) => {
    const qq = m && m.quote;
    return qq && newReply && String(qq.mid) === String(newReply.mid) && qq.text === SSE_REPLY;
  });
  const regenRequested = requests.length > before;
  const pass = author.includes('原消息已删除') && q.invalid === true && q.mid === 'ai-1' &&
    q.text === 'AI 第一条回复' && !!newReply && newReply.mid !== q.mid && !quoteBoundToNew && regenRequested;
  record('场景3 重生成后旧引用失效', pass,
    `author="${author}" quoteMid="${q.mid}" newMid="${newReply ? newReply.mid : '无'}" quoteTextUnchanged=${q.text === 'AI 第一条回复'} quoteBoundToNew=${quoteBoundToNew} regenRequested=${regenRequested}`);
} catch (err) {
  record('场景3 重生成后旧引用失效', false, 'exception: ' + err.message);
}

if (consoleErrors.length) {
  console.log('CONSOLE_ERRORS: ' + consoleErrors.slice(0, 5).join(' | '));
}

await browser.close();
server.close();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`SUMMARY ${passed}/${total} passed`);
process.exitCode = passed === total ? 0 : 1;
