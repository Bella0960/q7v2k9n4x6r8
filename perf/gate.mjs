/**
 * 性能预算门禁（CI 用）：在真实 chat-detail.html 上跑关键路径，断言性能预算。
 * 目的：锁死 Fix A / Fix B / Fix C 三项优化成果，任何回退（或性能劣化）都让 CI 红。
 *
 * 关键断言（按"失败模式区分度"排序，确保 CI 噪声不会误伤）：
 *   - Fix C 增量追加未被回退：N=2000 增量追加耗时 < 5ms，且 < 全量重渲染的 5%。
 *     （回退到全量重渲染会从 ~0.3ms 暴增到 1000ms+，5ms 阈值有数百倍区分度）
 *   - Fix A content-visibility 生效：关掉它后全量重渲染变慢 ≥25%（withA < noA*0.75）
 *   - Fix A+B 绝对预算：N=1000 < 80ms，N=2000 < 160ms（桌面基线 26/52ms，留 ~3× 余量抗 CI 噪声）
 *   - Fix B 头像缓存生效：强制缓存失效后，3 次重渲染只解析 myProfile 1 次
 *
 * 运行： node perf/gate.mjs          （桌面，默认；CI 用它）
 *        THROTTLE=4 node perf/gate.mjs  （可选：移动端降频对照，不作为 CI 门禁）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5183;
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
const ROLE_ID = 'perf-gate';

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
    arr.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: '第 ' + i + ' 条历史消息，模拟长会话渲染压力。', time: t0 + i * 60000, mid: 'perf-mid-' + i });
  }
  return arr;
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// 预算阈值（桌面基线校准：fixab 实测 200/1000/2000 = 8.9/26.2/52.2ms；fixc 增量 ~0.3ms）
const BUDGET = {
  fixC_incMs_max: 5,          // 增量追加上限（回退即 1000ms+，区分度极大）
  fixC_incRatio_max: 0.05,    // 增量耗时 < 全量的 5%
  fixA_withA_1000_max: 80,    // Fix A+B 全量重渲染 N=1000
  fixA_withA_2000_max: 160,   // Fix A+B 全量重渲染 N=2000
  fixA_speedup_min: 0.75,      // 关掉 content-visibility 后，withA 必须 < noA*0.75（即 A 至少省 25%）
  fixB_parseCount: 1,         // 强制失效后 3 次重渲染只解析 myProfile 1 次
};

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--force-device-scale-factor=1'] });
const checks = [];
function record(name, value, limit, pass, note = '') {
  checks.push({ name, value, limit, pass, note });
  console.log(`  ${pass ? '✅' : '❌'} ${name}: ${value}  (预算 ${limit})  ${note}`);
}

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`  性能预算门禁  |  Chromium / 390×844  |  CPU 降频 ${THROTTLE}× ${THROTTLE > 1 ? '(移动端对照)' : '(桌面 CI)'}`);
console.log('══════════════════════════════════════════════════════════════════\n');

// ---------- Fix C：增量追加不可回退 ----------
{
  const N = 2000;
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
  if (THROTTLE > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const el = document.getElementById('chat-messages'); return el && el.querySelectorAll('.msg-row').length > 0; }, { timeout: 60000 });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const el = document.getElementById('chat-messages');
    const full = [], inc = [];
    const sampleAi = { role: 'assistant', text: '增量追加回归校验消息。\n\n<think>思考</think>\n\n正文。', time: Date.now() };
    for (let i = 0; i < 3; i++) {
      // 计时区 1：全量重渲染（旧实现成本）
      const t0 = performance.now(); window.renderAllMessages(); full.push(performance.now() - t0);
      // 复位到干净 N 节点（不算入增量耗时）
      window.renderAllMessages();
      // 计时区 2：只追加最后一条（Fix C 真实成本）—— 单独计时，不与复位重叠
      const t1 = performance.now(); window.appendMessageToDOM(Object.assign({}, sampleAi, { time: Date.now() })); inc.push(performance.now() - t1);
    }
    return { full, inc, before: el.querySelectorAll('.msg-row').length };
  });
  r.fullMs = median(r.full);
  r.incMs = median(r.inc);
  const ratio = r.incMs / Math.max(r.fullMs, 0.01);
  record('Fix C 增量追加耗时(N=2000)', r.incMs.toFixed(2) + 'ms', `< ${BUDGET.fixC_incMs_max}ms`, r.incMs < BUDGET.fixC_incMs_max, '回退即 1000ms+');
  record('Fix C 增量/全量 占比', (ratio * 100).toFixed(1) + '%', `< ${(BUDGET.fixC_incRatio_max * 100)}%`, ratio < BUDGET.fixC_incRatio_max);
  await ctx.close();
}

// ---------- Fix A + Fix B：全量重渲染预算 + content-visibility 生效 + 头像缓存 ----------
for (const N of [1000, 2000]) {
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
  if (THROTTLE > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => { const el = document.getElementById('chat-messages'); return el && el.querySelectorAll('.msg-row').length > 0; }, { timeout: 60000 });
  await page.waitForTimeout(400);

  const withA = [];
  for (let i = 0; i < 3; i++) withA.push(await page.evaluate(() => { const t0 = performance.now(); window.renderAllMessages(); return performance.now() - t0; }));
  await page.addStyleTag({ content: '* { content-visibility: visible !important; contain-intrinsic-size: auto !important; }' });
  await page.waitForTimeout(150);
  const noA = [];
  for (let i = 0; i < 3; i++) noA.push(await page.evaluate(() => { const t0 = performance.now(); window.renderAllMessages(); return performance.now() - t0; }));

  const withAMs = median(withA), noAMs = median(noA);
  record(`Fix A+B 全量重渲染(N=${N})`, withAMs.toFixed(1) + 'ms', `< ${N === 1000 ? BUDGET.fixA_withA_1000_max : BUDGET.fixA_withA_2000_max}ms`, withAMs < (N === 1000 ? BUDGET.fixA_withA_1000_max : BUDGET.fixA_withA_2000_max));
  record(`Fix A content-visibility 生效(N=${N})`, `withA/noA=${(withAMs / noAMs).toFixed(2)}`, `< ${BUDGET.fixA_speedup_min}`, withAMs < noAMs * BUDGET.fixA_speedup_min, `关A后 ${noAMs.toFixed(0)}ms`);

  const parseCount = await page.evaluate(() => {
    const raw = localStorage.getItem('myProfile');
    const p = JSON.parse(raw);
    p.avatar = p.avatar.slice(0, -4) + 'ZZZZ'; // 强制缓存失效一次（结构仍合法）
    localStorage.setItem('myProfile', JSON.stringify(p));
    const orig = JSON.parse;
    let c = 0;
    JSON.parse = function (s) { if (typeof s === 'string' && s.indexOf('"bio":"__PERF_AVATAR__"') !== -1) c++; return orig.apply(this, arguments); };
    for (let i = 0; i < 3; i++) window.renderAllMessages();
    JSON.parse = orig;
    return c;
  });
  record(`Fix B 头像缓存(N=${N})`, `myProfile解析 ${parseCount} 次/3渲染`, `= ${BUDGET.fixB_parseCount}`, parseCount === BUDGET.fixB_parseCount, '期望 1=缓存命中');
  await ctx.close();
}

await browser.close();
server.close();

const failed = checks.filter(c => !c.pass);
console.log('\n══════════════════════════════════════════════════════════════════');
if (failed.length === 0) {
  console.log(`  ✅ 性能预算门禁通过：${checks.length} 项全部达标。Fix A/B/C 成果已锁定。`);
  process.exit(0);
} else {
  console.log(`  ❌ 性能预算门禁失败：${failed.length}/${checks.length} 项超标：`);
  failed.forEach(c => console.log(`     - ${c.name}: ${c.value} (预算 ${c.limit})`));
  process.exit(1);
}
