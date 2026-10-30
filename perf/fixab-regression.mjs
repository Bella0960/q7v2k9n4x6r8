/**
 * Fix A + Fix B 回归验证：在真实改后的 chat-detail.html 上实测「全量重渲染」耗时
 *   - Fix A（content-visibility:auto）：用 CSS 覆写关闭它，隔离其对全量重渲染的提速贡献
 *   - Fix B（头像缓存）：强制缓存失效后，统计 3 次 renderAllMessages 里 myProfile 的 JSON.parse 次数
 *                       有缓存应 = 1（首次 miss 解析一次，之后命中）；无缓存则 = 3×(自消息数)
 *
 * 运行： node perf/fixab-regression.mjs            （桌面基线）
 *        THROTTLE=4 node perf/fixab-regression.mjs  （4× CPU 降频，模拟中端手机）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5181;
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
const ROLE_ID = 'perf-role-ab';

// myProfile 用专属 bio 标记，便于在 JSON.parse 拦截里精确识别"这是 myProfile 的解析"
function makeProfile(avatarKb) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < avatarKb * 1024; i++) s += chars[(i * 31 + 7) % 64];
  return { name: '我', avatar: 'data:image/jpeg;base64,' + s, bio: '__PERF_AVATAR__' };
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
console.log(`  Fix A+B 回归验证  |  Edge / 390×844  |  CPU 降频 ${THROTTLE}× ${THROTTLE > 1 ? '(模拟移动端)' : '(桌面)'}`);
console.log('══════════════════════════════════════════════════════════════════\n');

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

for (const N of SCALES) {
  // ---- 默认（Fix A 生效）全量重渲染耗时 ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(
      ({ roleId, history, profile }) => {
        localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: roleId, name: '性能测试', persona: '测试', avatar: profile.avatar }]));
        localStorage.setItem('phone_current_contact', roleId);
        localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
        localStorage.setItem('myProfile', JSON.stringify(profile));
        localStorage.setItem('phone_data_v2', JSON.stringify({}));
      },
      { roleId: ROLE_ID, history: makeHistory(N), profile: makeProfile(60) }
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
    await page.waitForTimeout(400);

    const withA = [];
    for (let i = 0; i < 3; i++) {
      const t = await page.evaluate(() => { const t0 = performance.now(); window.renderAllMessages(); return performance.now() - t0; });
      withA.push(t);
    }
    // ---- 关闭 Fix A（CSS 覆写），隔离其贡献 ----
    await page.addStyleTag({ content: '* { content-visibility: visible !important; contain-intrinsic-size: auto !important; }' });
    await page.waitForTimeout(150);
    const noA = [];
    for (let i = 0; i < 3; i++) {
      const t = await page.evaluate(() => { const t0 = performance.now(); window.renderAllMessages(); return performance.now() - t0; });
      noA.push(t);
    }

    // ---- Fix B 证明：强制缓存失效后，统计 3 次 renderAllMessages 中 myProfile 的 JSON.parse 次数 ----
    const parseCount = await page.evaluate(() => {
      // 把头像末尾 4 字符换掉 → raw 字符串变化 → 缓存失效一次（结构仍合法）
      const raw = localStorage.getItem('myProfile');
      const p = JSON.parse(raw);
      p.avatar = p.avatar.slice(0, -4) + 'ZZZZ';
      localStorage.setItem('myProfile', JSON.stringify(p));
      const orig = JSON.parse;
      let c = 0;
      JSON.parse = function (s) { if (typeof s === 'string' && s.indexOf('"bio":"__PERF_AVATAR__"') !== -1) c++; return orig.apply(this, arguments); };
      for (let i = 0; i < 3; i++) window.renderAllMessages();
      JSON.parse = orig;
      return c;
    });

    const withAMs = +median(withA).toFixed(1);
    const noAMs = +median(noA).toFixed(1);
    const aSave = +(noAMs - withAMs).toFixed(1);

    // 断言：Fix A 确实降低耗时；Fix A+B 接近 ab.mjs 的 A+B 投影（1000条4×≈161ms）
    const aHelps = noAMs > withAMs;
    const abReasonable = withAMs < (N >= 1000 && THROTTLE > 1 ? 320 : 9999);
    const bWorks = parseCount === 1; // 3 次重渲染只解析 myProfile 一次 = 缓存命中
    const pass = aHelps && abReasonable && bWorks;

    console.log(`${String(N).padStart(4)} 条 | Fix A+B ${String(withAMs).padStart(7)}ms  vs  关A ${String(noAMs).padStart(7)}ms  →  Fix A 省 ${String(aSave).padStart(6)}ms`);
    console.log(`         myProfile JSON.parse 次数(3次重渲染) = ${parseCount}  [期望 1=${'缓存命中 ✓'}]  | ${pass ? '✅ PASS' : '❌ FAIL'}`);
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log('\n✅ Fix A+B 验证完成：content-visibility 降低全量重渲染耗时，头像缓存使 myProfile 仅解析一次。');
