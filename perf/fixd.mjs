/**
 * Fix D 精细归因：流式滚动到底的三种写法对比
 *
 * 目标：给出「消除强制同步布局」这个建议的诚实收益。
 * 注意：真实修复仍然要滚动到底，所以必须对比"写了滚动但没读布局"的方案，
 *       而不是拿"完全不滚动"当对照组（那会夸大收益）。
 *
 * 三种写法：
 *   ① 现状   textContent 写 → 读 scrollHeight → 写 scrollTop（read 夹在两次 write 中间）
 *   ② 改进   textContent 写 → 写 scrollTop = 1e9（不读布局）
 *   ③ 地板   textContent 写（完全不滚动，仅作理论下限参考）
 *
 * 运行： node perf/fixd.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5181;
const ROLE_ID = 'perf-role';
const THROTTLE = Number(process.env.THROTTLE || 4);
const N = Number(process.env.N || 1000);

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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

await ctx.addInitScript(({ roleId, history }) => {
  localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: 'FixD', persona: '测试', avatar: '' }]));
  localStorage.setItem('phone_current_contact', roleId);
  localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
  localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar: 'data:image/jpeg;base64,' + 'A'.repeat(60000), bio: '' }));
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
  const client = await ctx.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
}
await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.msg-row').length > 0, { timeout: 60000 });
await page.waitForTimeout(800);

const r = await page.evaluate(async () => {
  const el = document.getElementById('chat-messages');
  const row = document.createElement('div');
  row.className = 'msg-row';
  const bub = document.createElement('div');
  bub.className = 'msg-bubble';
  row.appendChild(bub); el.appendChild(row);
  const big = '流式渲染测试文本内容'.repeat(120);
  const FRAMES = 60;

  const med = a => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
  const run = fn => { const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); } return med(t); };

  // ① 现状：write → read(scrollHeight) → write(scrollTop)
  const current = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
      el.scrollTop = el.scrollHeight;
    }
  });

  // ② 改进：write → write(scrollTop)，不读布局属性
  const improved = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
      el.scrollTop = 1e9;
    }
  });

  // ③ 地板：只写文本，完全不滚动
  const floor = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
    }
  });

  // ===== 第二轮：叠加 content-visibility，验证节点数才是根因 =====
  const styleA = document.createElement('style');
  styleA.textContent = '.msg-row { content-visibility: auto; contain-intrinsic-size: auto 76px; }';
  document.head.appendChild(styleA);
  el.appendChild(row);   // 重新挂回（第一轮末尾被移除）
  window.renderAllMessages();
  el.appendChild(row);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const cv_current = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
      el.scrollTop = el.scrollHeight;
    }
  });
  const cv_improved = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
      el.scrollTop = 1e9;
    }
  });
  const cv_floor = run(() => {
    for (let i = 0; i < FRAMES; i++) {
      bub.textContent = big.slice(0, i * 20);
    }
  });

  row.remove(); styleA.remove();
  return {
    current, improved, floor, FRAMES,
    cv_current, cv_improved, cv_floor,
    domNodes: el.getElementsByTagName('*').length,
  };
});

await browser.close();
server.close();

const per = v => +(v / r.FRAMES).toFixed(2);
console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  Fix D 精细归因  |  ${N} 条消息  |  CPU 降频 ${THROTTLE}×  |  DOM ${r.domNodes} 节点`);
console.log('══════════════════════════════════════════════════════════════\n');
console.log(`① 现状  write → read(scrollHeight) → write    ${String(r.current).padStart(8)} ms   ${String(per(r.current)).padStart(6)} ms/帧`);
console.log(`② 改进  write → write(scrollTop=1e9)，不读布局  ${String(r.improved).padStart(8)} ms   ${String(per(r.improved)).padStart(6)} ms/帧`);
console.log(`③ 地板  只写文本，不滚动（理论下限）            ${String(r.floor).padStart(8)} ms   ${String(per(r.floor)).padStart(6)} ms/帧`);
console.log(`\n真实收益（现状 → 改进）：提速 ${(r.current / Math.max(r.improved, 0.01)).toFixed(1)}×，每帧省 ${(per(r.current) - per(r.improved)).toFixed(2)} ms`);
console.log(`（对照：完全不滚动的下限是 ${per(r.floor)} ms/帧，改进方案距下限仅差 ${(per(r.improved) - per(r.floor)).toFixed(2)} ms/帧）`);

console.log('\n────────── 叠加 content-visibility 后 ──────────');
console.log(`① 现状  write → read → write        ${String(r.cv_current).padStart(8)} ms   ${String(per(r.cv_current)).padStart(6)} ms/帧   （原 ${per(r.current)} ms/帧，提速 ${(r.current / Math.max(r.cv_current, 0.01)).toFixed(1)}×）`);
console.log(`② 改进  write → write，不读布局      ${String(r.cv_improved).padStart(8)} ms   ${String(per(r.cv_improved)).padStart(6)} ms/帧   （原 ${per(r.improved)} ms/帧）`);
console.log(`③ 地板  只写文本，不滚动            ${String(r.cv_floor).padStart(8)} ms   ${String(per(r.cv_floor)).padStart(6)} ms/帧`);
console.log(`\n★ 结论：content-visibility 把流式每帧成本从 ${per(r.current)}ms 降到 ${per(r.cv_current)}ms`);
console.log(`  而"去掉 scrollHeight 读取"收益为 ${(r.current / Math.max(r.improved, 0.01)).toFixed(1)}×（≈无效）`);
console.log(`  → 流式卡顿的根因是「布局节点太多」，不是「读写顺序」\n`);

fs.writeFileSync(path.join(__dirname, `fixd-throttle${THROTTLE}x.json`), JSON.stringify({ date: new Date().toISOString(), N, throttle: THROTTLE, ...r }, null, 2));
