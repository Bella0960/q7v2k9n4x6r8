/**
 * 「小手机」聊天页性能基准测试 v2
 *
 * 测量维度：
 *   A. renderAllMessages() 全量重渲染耗时（每条 AI 回复结束后的真实开销）
 *   B. getMyAvatar() 的 localStorage + JSON.parse 放大效应
 *   C. 长列表滚动帧率（含移动端 CPU 降频）
 *   D. 流式渲染：每帧全量正则的 O(n²) 累积开销
 *   E. 流式渲染：写入后读 scrollHeight 的强制同步布局
 *
 * 运行： node perf/bench.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5178;

const SCALES = [50, 200, 500, 1000, 2000];
const AVATAR_KB = 60;
/** 移动端 CPU 降频倍率：4× ≈ 中端安卓，6× ≈ 低端机 */
const THROTTLE = Number(process.env.THROTTLE || 1);

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
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;

const ROLE_ID = 'perf-role';

function makeAvatarDataUrl(kb) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < kb * 1024; i++) s += chars[(i * 31 + 7) % 64];
  return 'data:image/jpeg;base64,' + s;
}

function makeText(seed) {
  const seeds = [
    '今天过得怎么样呀，我这边刚下课，风特别大，走在路上头发都被吹乱了。你那边天气还好吗？',
    '嗯，我知道你说的那个地方，上次路过的时候还在装修呢，没想到这么快就开了。下次我们一起去看看吧。',
    '其实我刚才想了很久，觉得有些事情还是说清楚比较好，虽然可能有点尴尬，但一直憋着反而更难受。',
    '哈哈哈哈你也太逗了吧，我刚才差点把水喷出来。不过说真的，你每次都能把我逗笑，这点我很服气。',
    '好呀，那就这么定了。我把时间记下来，到时候提前提醒你，免得你又忘记了上次就是这样的。',
  ];
  return (seeds[seed % seeds.length] + ' ').repeat(1 + (seed % 3)).trim();
}

function makeHistory(n) {
  const arr = [];
  const t0 = Date.now() - n * 60000;
  for (let i = 0; i < n; i++) {
    arr.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: makeText(i),
      time: t0 + i * 60000,
      mid: 'perf-mid-' + i,
    });
  }
  return arr;
}

const results = [];
const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: ['--force-device-scale-factor=1'],
});

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  小手机 · 聊天页性能基准 v2  |  Edge / 390×844`);
console.log(`  头像 ${AVATAR_KB}KB  |  CPU 降频 ${THROTTLE}× ${THROTTLE > 1 ? '(模拟移动端)' : '(桌面基线)'}`);
console.log('══════════════════════════════════════════════════════════════\n');

for (const N of SCALES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });

  await ctx.addInitScript(
    ({ roleId, history, avatar }) => {
      localStorage.setItem('ai_custom_characters', JSON.stringify([
        { id: roleId, name: '性能测试', persona: '一个用于性能测量的测试角色。', avatar },
      ]));
      localStorage.setItem('phone_current_contact', roleId);
      localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
      localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar, bio: '测试资料' }));
      localStorage.setItem('phone_data_v2', JSON.stringify({}));
    },
    { roleId: ROLE_ID, history: makeHistory(N), avatar: makeAvatarDataUrl(AVATAR_KB) }
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
  await page.waitForTimeout(800);

  const measure = await page.evaluate(() => {
    const el = document.getElementById('chat-messages');
    const out = {};
    out.msgRows = el.querySelectorAll('.msg-row').length;
    out.domNodes = el.getElementsByTagName('*').length;
    out.scrollHeight = Math.round(el.scrollHeight);

    // ---- A. 全量重渲染（每次 AI 回复结束后执行）----
    const rt = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      window.renderAllMessages();
      rt.push(performance.now() - t0);
    }
    rt.sort((a, b) => a - b);
    out.renderMs = +rt[1].toFixed(1);

    // ---- B. getMyAvatar 放大效应 ----
    const half = Math.max(1, Math.floor(out.msgRows / 2));
    const t1 = performance.now();
    for (let i = 0; i < half; i++) { JSON.parse(localStorage.getItem('myProfile')); }
    out.avatarCurrentMs = +(performance.now() - t1).toFixed(1);

    const cachedRaw = localStorage.getItem('myProfile');
    const cached = JSON.parse(cachedRaw);
    const t2 = performance.now();
    for (let i = 0; i < half; i++) { void cached.avatar; }
    out.avatarCachedMs = +(performance.now() - t2).toFixed(3);
    out.avatarCalls = half;
    out.profileBytes = cachedRaw.length;

    // ---- D. 流式每帧正则：对「累积全文」跑清洗链（现状）vs 只处理「新增增量」----
    // 现状（paintStreamLive 的做法）：每个 rAF 帧都对 fullText 跑完整正则链
    const FRAMES = 120;          // 一次 2 秒左右的流式回复
    const CHUNK = 18;            // 每帧新增字符数
    const cleanChain = function (t) {
      return t
        .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, '')
        .replace(/<\/?narratage\b[^>]*>/gi, '')
        .replace(/\[中译[:：][^\]]{0,800}\]/g, '')
        .replace(/\[中译[:：][^\]]{0,}$/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };
    const t3 = performance.now();
    let acc = '';
    for (let f = 0; f < FRAMES; f++) {
      acc += '这是一段模拟的流式回复文本内容，'.repeat(1).slice(0, CHUNK);
      cleanChain(acc);          // ← 现状：处理的是「累积全文」
    }
    out.streamRegexFullMs = +(performance.now() - t3).toFixed(1);

    // 改进：只对新到达的尾部片段做清洗，累积结果直接拼接
    const t4 = performance.now();
    let acc2 = '';
    for (let f = 0; f < FRAMES; f++) {
      const delta = '这是一段模拟的流式回复文本内容，'.repeat(1).slice(0, CHUNK);
      acc2 += cleanChain(acc2.slice(-16) + delta).slice(acc2.slice(-16).length ? Math.min(16, acc2.length) : 0);
    }
    out.streamRegexDeltaMs = +(performance.now() - t4).toFixed(1);
    out.streamFinalChars = acc.length;

    // ---- E. 强制同步布局：真实气泡写入 + 读 scrollHeight ----
    // 关键：探测节点必须在 #chat-messages 内部，才会弄脏容器布局
    const row = document.createElement('div');
    row.className = 'msg-row';
    const bub = document.createElement('div');
    bub.className = 'msg-bubble';
    row.appendChild(bub);
    el.appendChild(row);
    const big = '流式渲染测试文本'.repeat(120);

    const t5 = performance.now();
    for (let i = 0; i < 60; i++) {
      bub.textContent = big.slice(0, i * 20);
      void el.scrollHeight;      // ← 现状：write 后立刻 read，强制同步重排
    }
    out.streamThrashMs = +(performance.now() - t5).toFixed(1);

    const t6 = performance.now();
    for (let i = 0; i < 60; i++) {
      bub.textContent = big.slice(0, i * 20);
    }
    out.streamNoReadMs = +(performance.now() - t6).toFixed(1);
    row.remove();

    return out;
  });

  // ---- C. 滚动帧率 ----
  const scroll = await page.evaluate(async () => {
    const el = document.getElementById('chat-messages');
    el.scrollTop = el.scrollHeight;
    await new Promise(r => setTimeout(r, 300));

    const frames = [];
    const start = performance.now();
    return await new Promise(resolve => {
      function tick(now) {
        frames.push(now);
        el.scrollTop -= 14;
        if (now - start < 2500 && el.scrollTop > 0) requestAnimationFrame(tick);
        else {
          const d = [];
          for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
          const sorted = [...d].sort((a, b) => a - b);
          const q = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
          let maxIdx = 0;
          d.forEach((v, i) => { if (v > d[maxIdx]) maxIdx = i; });
          resolve({
            fps: +(d.length / ((frames[frames.length - 1] - frames[0]) / 1000)).toFixed(1),
            p50Ms: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2),
            maxMs: +Math.max(...d, 0).toFixed(2),
            maxAtFrame: maxIdx, totalFrames: d.length,
            janky: d.filter(x => x > 50).length,      // 可感知卡顿
            severe: d.filter(x => x > 100).length,     // 严重卡顿
          });
        }
      }
      requestAnimationFrame(tick);
    });
  });

  results.push({ N, ...measure, scroll });
  await ctx.close();

  const flag = measure.renderMs > 100 ? '❌' : measure.renderMs > 50 ? '⚠️ ' : '✅';
  console.log(
    `【${String(N).padStart(4)} 条】重渲染 ${flag} ${String(measure.renderMs).padStart(7)}ms` +
    `  |  头像 ${String(measure.avatarCurrentMs).padStart(6)}ms` +
    `  |  流式正则 ${String(measure.streamRegexFullMs).padStart(5)}ms` +
    `  |  滚动 ${String(scroll.fps).padStart(5)}fps  卡顿 ${scroll.janky}  严重 ${scroll.severe}`
  );
}

await browser.close();
server.close();

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  明细');
console.log('──────────────────────────────────────────────────────────────');
console.log('消息数 | 重渲染ms | 头像 现状→缓存 | 每帧正则 全文→增量 | 强制布局 读→不读 | fps | p95 | max | 卡顿/严重');
for (const r of results) {
  console.log(
    String(r.N).padStart(6) + ' | ' +
    String(r.renderMs).padStart(8) + ' | ' +
    `${r.avatarCurrentMs}→${r.avatarCachedMs}ms`.padStart(15) + ' | ' +
    `${r.streamRegexFullMs}→${r.streamRegexDeltaMs}ms`.padStart(18) + ' | ' +
    `${r.streamThrashMs}→${r.streamNoReadMs}ms`.padStart(18) + ' | ' +
    String(r.scroll.fps).padStart(5) + ' | ' +
    String(r.scroll.p95Ms).padStart(5) + ' | ' +
    String(r.scroll.maxMs).padStart(6) + ' | ' +
    `${r.scroll.janky}/${r.scroll.severe}`
  );
}

const last = results[results.length - 1], first = results[0];
console.log('\n──────────────────────────────────────────────────────────────');
console.log('  关键结论');
console.log('──────────────────────────────────────────────────────────────');
console.log(`1. 重渲染: ${first.N} 条 ${first.renderMs}ms → ${last.N} 条 ${last.renderMs}ms（${(last.renderMs / first.renderMs).toFixed(1)}×，消息量 ${last.N / first.N}×）→ 近似线性 O(N)`);
console.log(`2. 头像重复解析: ${last.N} 条时 ${last.avatarCalls} 次，${last.avatarCurrentMs}ms → 缓存 ${last.avatarCachedMs}ms（省 ${(last.avatarCurrentMs - last.avatarCachedMs).toFixed(1)}ms，占重渲染 ${((last.avatarCurrentMs / last.renderMs) * 100).toFixed(0)}%）`);
console.log(`3. 流式每帧正则: 全文重洗 ${last.streamRegexFullMs}ms → 增量 ${last.streamRegexDeltaMs}ms（${(last.streamRegexFullMs / Math.max(last.streamRegexDeltaMs, 0.01)).toFixed(1)}×）`);
console.log(`4. 强制同步布局: 60 帧写+读 ${last.streamThrashMs}ms → 只写 ${last.streamNoReadMs}ms（${(last.streamThrashMs / Math.max(last.streamNoReadMs, 0.01)).toFixed(0)}×）`);
console.log(`5. 滚动: ${last.N} 条 p95 ${last.scroll.p95Ms}ms，峰值 ${last.scroll.maxMs}ms（第 ${last.scroll.maxAtFrame} 帧），卡顿 ${last.scroll.janky} 次`);
console.log(`6. DOM: ${last.N} 条 = ${last.domNodes} 节点 / ${last.scrollHeight}px 滚动高度`);

const suffix = THROTTLE > 1 ? `-throttle${THROTTLE}x` : '';
fs.writeFileSync(
  path.join(__dirname, `baseline${suffix}.json`),
  JSON.stringify({ date: new Date().toISOString(), avatarKB: AVATAR_KB, throttle: THROTTLE, results }, null, 2)
);
console.log(`\n数据已写入 perf/baseline${suffix}.json\n`);
