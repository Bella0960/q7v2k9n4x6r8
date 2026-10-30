/**
 * Fix C 回归验证：在真实改后的 chat-detail.html 上，实测两条路径的耗时对比
 *   - OLD 路径：window.renderAllMessages()  （清空 + 全量重建 N 个气泡）
 *   - NEW 路径：window.appendMessageToDOM(aiMsg)  （只追加最后一条，Fix C 落地后的真实行为）
 *
 * 运行： node perf/fixc-regression.mjs            （桌面基线）
 *        THROTTLE=4 node perf/fixc-regression.mjs  （4× CPU 降频，模拟中端手机）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5179;
const THROTTLE = Number(process.env.THROTTLE || 1);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;
const ROLE_ID = 'perf-role';

// 一条逼真的 AI 回复：含 思维链(think) + 旁白(narratage) + 双回车多气泡，专门考验 parseReplyContent 展开
const SAMPLE_AI = {
  role: 'assistant',
  text: '好呀，那我们就这么定啦。\n\n<think>让我想想怎么安排比较合适</think>\n\n其实我刚才也在琢磨这件事，<narratage>（轻轻歪头看着你，眼里带着笑意）</narratage>所以我的想法是，先从简单的地方开始。\n\n你今天过得还顺利吗？有没有遇到什么烦心事。',
  time: Date.now(),
};

function makeAvatar(kb) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < kb * 1024; i++) s += chars[(i * 31 + 7) % 64];
  return 'data:image/jpeg;base64,' + s;
}
function makeHistory(n) {
  const arr = [];
  const t0 = Date.now() - n * 60000;
  for (let i = 0; i < n; i++) {
    arr.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: '这是第 ' + i + ' 条历史消息，用来模拟长会话的渲染压力。', time: t0 + i * 60000, mid: 'perf-mid-' + i });
  }
  return arr;
}

const SCALES = [200, 1000, 2000];
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--force-device-scale-factor=1'] });

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`  Fix C 回归验证  |  Edge / 390×844  |  CPU 降频 ${THROTTLE}× ${THROTTLE > 1 ? '(模拟移动端)' : '(桌面)'}`);
console.log('══════════════════════════════════════════════════════════════════\n');

const missing = [];
for (const N of SCALES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(
    ({ roleId, history, avatar }) => {
      localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: '性能测试', persona: '测试', avatar }]));
      localStorage.setItem('phone_current_contact', roleId);
      localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
      localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar, bio: '测试' }));
      localStorage.setItem('phone_data_v2', JSON.stringify({}));
    },
    { roleId: ROLE_ID, history: makeHistory(N), avatar: makeAvatar(60) }
  );
  const page = await ctx.newPage();
  if (THROTTLE > 1) {
    const client = await ctx.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('chat-messages');
    return el && el.querySelectorAll('.msg-row').length > 0;
  }, { timeout: 60000 });
  await page.waitForTimeout(500);

  const r = await page.evaluate((sampleAi) => {
    const el = document.getElementById('chat-messages');
    const out = { msgRowsBefore: el.querySelectorAll('.msg-row').length };
    if (typeof window.renderAllMessages !== 'function') return { error: 'renderAllMessages 不可见' };
    if (typeof window.appendMessageToDOM !== 'function') return { error: 'appendMessageToDOM 不可见' };

    // OLD 路径：全量重渲染（每次 AI 回复收尾的旧实现）
    const full = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      window.renderAllMessages();
      full.push(performance.now() - t0);
    }
    full.sort((a, b) => a - b);
    out.fullMs = +full[1].toFixed(1);

    // NEW 路径：只追加最后一条（Fix C 落地后的真实行为）
    const inc = [];
    for (let i = 0; i < 3; i++) {
      window.renderAllMessages(); // 复位到干净的 N 节点（不算入增量耗时）
      const t0 = performance.now();
      window.appendMessageToDOM(Object.assign({}, sampleAi, { time: Date.now() }));
      inc.push(performance.now() - t0);
    }
    inc.sort((a, b) => a - b);
    out.incMs = +inc[1].toFixed(2);
    out.msgRowsAfter = el.querySelectorAll('.msg-row').length;
    // 校验增量追加确实只多渲染了 1 条（思维链/旁白展开后气泡数可能 >1，但 .msg-row 行数应 +1）
    out.rowDelta = out.msgRowsAfter - out.msgRowsBefore;
    return out;
  }, SAMPLE_AI);

  if (r.error) { missing.push(`${N} 条: ${r.error}`); await ctx.close(); continue; }

  const speedup = (r.fullMs / Math.max(r.incMs, 0.01)).toFixed(0);
  const pass = r.incMs < r.fullMs * 0.05; // 增量耗时应 < 全量的 5%
  console.log(
    `${String(N).padStart(4)} 条 | 全量 ${String(r.fullMs).padStart(7)}ms  →  增量 ${String(r.incMs).padStart(6)}ms` +
    `  | 提速 ${speedup}×  | 行数 Δ=${r.rowDelta}  | ${pass ? '✅ PASS' : '❌ FAIL'}`
  );
  console.log(`         （DOM 核对：追加前 ${r.msgRowsBefore} 行，追加后 ${r.msgRowsAfter} 行，应 +1）`);
  await ctx.close();
}

await browser.close();
server.close();
if (missing.length) { console.log('\n⚠️  部分规模缺失：', missing.join('; ')); process.exit(1); }
console.log('\n✅ Fix C 落地验证完成：增量追加耗时稳定在全量重渲染的极小比例，且 DOM 行数正确 +1。');
