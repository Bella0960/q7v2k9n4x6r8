/**
 * 流式每帧成本 vs DOM 节点数 的曲线
 *
 * 目的：验证"每帧强制布局成本 ∝ 布局节点数"，从而推算虚拟列表（窗口 ~60 行）的收益。
 *
 * 运行： THROTTLE=4 node perf/curve.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5182;
const ROLE_ID = 'perf-role';
const THROTTLE = Number(process.env.THROTTLE || 4);
const SCALES = [30, 60, 120, 250, 500, 1000, 2000];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--force-device-scale-factor=1'] });
const rows = [];

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  流式每帧成本 vs 消息数  |  CPU 降频 ${THROTTLE}×`);
console.log('══════════════════════════════════════════════════════════════\n');
console.log('消息数 | DOM节点 |  每帧布局  | 相对60条 | 是否超预算(16.7ms)');
console.log('───────┼─────────┼────────────┼──────────┼──────────────────');

for (const N of SCALES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(({ roleId, history }) => {
    localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: 'Curve', persona: '测试', avatar: '' }]));
    localStorage.setItem('phone_current_contact', roleId);
    localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
    localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar: 'data:image/jpeg;base64,' + 'A'.repeat(60000) }));
    localStorage.setItem('phone_data_v2', JSON.stringify({}));
  }, {
    roleId: ROLE_ID,
    history: Array.from({ length: N }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: '这是一条用于构造长列表的历史消息内容，长度大约三四十个字左右，用于模拟真实对话的体量。'.slice(0, 28 + (i % 25)),
      time: Date.now() - (N - i) * 60000, mid: 'h-' + i,
    })),
  });

  const page = await ctx.newPage();
  if (THROTTLE > 1) {
    const c = await ctx.newCDPSession(page);
    await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.msg-row').length > 0, { timeout: 60000 });
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const el = document.getElementById('chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row';
    const bub = document.createElement('div');
    bub.className = 'msg-bubble';
    row.appendChild(bub); el.appendChild(row);
    const big = '流式渲染测试文本内容'.repeat(120);
    const F = 60;
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const run = fn => { const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); } return med(t); };
    const total = run(() => { for (let i = 0; i < F; i++) { bub.textContent = big.slice(0, i * 20); el.scrollTop = el.scrollHeight; } });
    row.remove();
    return { perFrame: total / F, domNodes: el.getElementsByTagName('*').length };
  });

  rows.push({ N, ...r });
  await ctx.close();
  const over = r.perFrame > 16.7 ? '  ❌ 超预算' : (r.perFrame > 8 ? '  ⚠️ 吃紧' : '  ✅');
  console.log(
    String(N).padStart(6) + ' | ' +
    String(r.domNodes).padStart(7) + ' | ' +
    (r.perFrame.toFixed(2) + ' ms').padStart(10) + ' | ' +
    (rows[1] ? (r.perFrame / rows[1].perFrame).toFixed(1) + '×' : '—').padStart(8) + ' |' + over
  );
}

await browser.close();
server.close();

const at60 = rows.find(x => x.N === 60).perFrame;
const at1000 = rows.find(x => x.N === 1000).perFrame;
const at2000 = rows.find(x => x.N === 2000).perFrame;

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  推算：虚拟列表（窗口 ≈ 60 行）的收益');
console.log('──────────────────────────────────────────────────────────────');
console.log(`  当前 1000 条：${at1000.toFixed(2)} ms/帧  →  虚拟列表后 ≈ ${at60.toFixed(2)} ms/帧（提速 ${(at1000 / at60).toFixed(1)}×）`);
console.log(`  当前 2000 条：${at2000.toFixed(2)} ms/帧  →  虚拟列表后 ≈ ${at60.toFixed(2)} ms/帧（提速 ${(at2000 / at60).toFixed(1)}×）`);
console.log(`  且与消息总量无关：1 万条消息也保持 ≈ ${at60.toFixed(2)} ms/帧\n`);
console.log(`  注：60 条时每帧 ${at60.toFixed(2)}ms，占 16.7ms 预算的 ${((at60 / 16.7) * 100).toFixed(0)}%\n`);

fs.writeFileSync(path.join(__dirname, `curve-throttle${THROTTLE}x.json`), JSON.stringify({ date: new Date().toISOString(), throttle: THROTTLE, rows }, null, 2));
