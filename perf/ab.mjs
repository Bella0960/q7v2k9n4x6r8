/**
 * 「小手机」性能优化 A/B 归因测试
 *
 * 对每个修复手段单独测量收益，用数据决定优先级（而不是凭感觉排期）。
 *
 * 待测修复：
 *   Fix A  content-visibility: auto  —— 让屏幕外气泡跳过渲染
 *   Fix B  getMyAvatar() 结果缓存    —— 消除 N 次 localStorage 读 + JSON.parse
 *   Fix C  增量追加替代全量重渲染    —— AI 回复后只渲染新气泡
 *   Fix D  流式期间避免读 scrollHeight —— 消除强制同步布局
 *
 * 运行： node perf/ab.mjs          （默认 4× 降频，模拟中端手机）
 *       THROTTLE=1 node perf/ab.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5179;
const N = Number(process.env.N || 1000);
const THROTTLE = Number(process.env.THROTTLE || 4);
const AVATAR_KB = 60;
const REPEAT = 5;   // 每项测 5 次取中位数，降低噪声

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
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
const ROLE_ID = 'perf-role';

function makeAvatarDataUrl(kb) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = ''; for (let i = 0; i < kb * 1024; i++) s += c[(i * 31 + 7) % 64];
  return 'data:image/jpeg;base64,' + s;
}
function makeHistory(n) {
  const seeds = [
    '今天过得怎么样呀，我这边刚下课，风特别大，走在路上头发都被吹乱了。你那边天气还好吗？',
    '嗯，我知道你说的那个地方，上次路过的时候还在装修呢，没想到这么快就开了。下次一起去看吧。',
    '其实我刚才想了很久，觉得有些事情还是说清楚比较好，虽然有点尴尬，但一直憋着反而更难受。',
    '哈哈哈哈你也太逗了吧，我刚才差点把水喷出来。不过说真的，你每次都能把我逗笑，这点很服气。',
  ];
  const arr = []; const t0 = Date.now() - n * 60000;
  for (let i = 0; i < n; i++) arr.push({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: (seeds[i % seeds.length] + ' ').repeat(1 + (i % 3)).trim(),
    time: t0 + i * 60000, mid: 'perf-' + i,
  });
  return arr;
}

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--force-device-scale-factor=1'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(({ roleId, history, avatar }) => {
  localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: 'A/B测试', persona: '测试角色', avatar }]));
  localStorage.setItem('phone_current_contact', roleId);
  localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
  localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar, bio: '测试' }));
  localStorage.setItem('phone_data_v2', JSON.stringify({}));
}, { roleId: ROLE_ID, history: makeHistory(N), avatar: makeAvatarDataUrl(AVATAR_KB) });

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
await page.waitForTimeout(800);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  性能优化 A/B 归因  |  ${N} 条消息  |  CPU 降频 ${THROTTLE}×`);
console.log('══════════════════════════════════════════════════════════════\n');

const ab = await page.evaluate(async ({ repeat }) => {
  const el = document.getElementById('chat-messages');
  const med = a => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
  const timeIt = (fn, n) => { const t = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); } return med(t); };
  const out = {};

  out.msgRows = el.querySelectorAll('.msg-row').length;
  out.domNodes = el.getElementsByTagName('*').length;

  // ============ 基线：现状全量重渲染 ============
  out.baseline = timeIt(() => window.renderAllMessages(), repeat);

  // ============ Fix A: content-visibility ============
  const styleA = document.createElement('style');
  styleA.id = 'perf-fix-a';
  styleA.textContent = `.msg-row { content-visibility: auto; contain-intrinsic-size: auto 76px; }`;
  document.head.appendChild(styleA);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  out.fixA = timeIt(() => window.renderAllMessages(), repeat);
  out.fixA_scrollHeight = Math.round(el.scrollHeight);

  // ============ Fix A+B: 叠加头像缓存 ============
  const origGetMyAvatar = window.getMyAvatar;
  let cachedAvatar = '';
  try { cachedAvatar = JSON.parse(localStorage.getItem('myProfile') || '{}').avatar || ''; } catch (e) { }
  window.getMyAvatar = function () { return cachedAvatar; };
  out.fixAB = timeIt(() => window.renderAllMessages(), repeat);

  // ============ 仅 Fix B: 撤掉 A，保留 B ============
  styleA.remove();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  out.fixB = timeIt(() => window.renderAllMessages(), repeat);

  // 还原
  window.getMyAvatar = origGetMyAvatar;

  // ============ Fix C: 增量追加（只渲染新增的一条）============
  // 模拟"AI 回复结束后只 append 新气泡"，而不是重建整个列表
  out.fixC = timeIt(() => {
    window.appendMessageToDOM(
      { role: 'assistant', text: '这是一条用于测量增量追加开销的测试消息。', time: Date.now() },
      out.msgRows, el
    );
    el.lastElementChild.remove();   // 复原，避免污染后续测量
  }, repeat);

  // ============ Fix D: 流式强制同步布局 ============
  const row = document.createElement('div');
  row.className = 'msg-row';
  const bub = document.createElement('div');
  bub.className = 'msg-bubble';
  row.appendChild(bub); el.appendChild(row);
  const big = '流式渲染测试文本内容'.repeat(120);

  out.fixD_before = timeIt(() => {
    for (let i = 0; i < 60; i++) { bub.textContent = big.slice(0, i * 20); void el.scrollHeight; }
  }, 3);
  out.fixD_after = timeIt(() => {
    for (let i = 0; i < 60; i++) { bub.textContent = big.slice(0, i * 20); }   // 不读布局
  }, 3);
  out.fixD_perFrameBefore = +(out.fixD_before / 60).toFixed(2);
  out.fixD_perFrameAfter = +(out.fixD_after / 60).toFixed(2);
  row.remove();

  return out;
}, { repeat: REPEAT });

await browser.close();
server.close();

const pct = (v, base) => `${(((base - v) / base) * 100).toFixed(0)}%`;
console.log(`消息数 ${ab.msgRows}  |  DOM 节点 ${ab.domNodes}\n`);
console.log('── 全量重渲染耗时（每次 AI 回复结束后发生）──');
console.log(`  现状（基线）              ${String(ab.baseline).padStart(8)} ms`);
console.log(`  Fix A  content-visibility ${String(ab.fixA).padStart(8)} ms   提升 ${pct(ab.fixA, ab.baseline)}`);
console.log(`  Fix B  头像缓存           ${String(ab.fixB).padStart(8)} ms   提升 ${pct(ab.fixB, ab.baseline)}`);
console.log(`  Fix A+B 叠加             ${String(ab.fixAB).padStart(8)} ms   提升 ${pct(ab.fixAB, ab.baseline)}`);
console.log(`  Fix C  增量追加           ${String(ab.fixC).padStart(8)} ms   提升 ${pct(ab.fixC, ab.baseline)}  ← 架构级修复`);

console.log('\n── 流式渲染：60 帧内的强制同步布局 ──');
console.log(`  现状（写入后读 scrollHeight）  ${String(ab.fixD_before).padStart(8)} ms   （${ab.fixD_perFrameBefore} ms/帧）`);
console.log(`  Fix D（只写不读）              ${String(ab.fixD_after).padStart(8)} ms   （${ab.fixD_perFrameAfter} ms/帧）`);
console.log(`  提速 ${(ab.fixD_before / Math.max(ab.fixD_after, 0.01)).toFixed(0)}×`);

console.log('\n── 结论 ──');
const budget = 16.7;
console.log(`· 基线 ${ab.baseline}ms 远超 ${budget}ms 单帧预算 → 用户感知为"回复落地时明显卡一下"`);
console.log(`· Fix C 增量追加把 ${ab.baseline}ms 降到 ${ab.fixC}ms（${(ab.baseline / Math.max(ab.fixC, 0.01)).toFixed(0)}×）—— 收益最大，但需改造渲染结构`);
console.log(`· Fix A content-visibility 一行 CSS 拿到 ${pct(ab.fixA, ab.baseline)} 提升 —— 性价比最高`);
console.log(`· Fix D 消除流式期 ${ab.fixD_perFrameBefore}ms/帧 的强制布局 —— 直接决定流式是否掉帧`);
console.log('');

fs.writeFileSync(path.join(__dirname, `ab-throttle${THROTTLE}x-n${N}.json`), JSON.stringify({ date: new Date().toISOString(), N, throttle: THROTTLE, ...ab }, null, 2));
console.log(`数据已写入 perf/ab-throttle${THROTTLE}x-n${N}.json\n`);
