/**
 * 「小手机」AI 请求载荷测量
 *
 * 目标：量化每次对话实际发给模型的体积，评估其对首字延迟（TTFT）与成本的影响，
 *       并区分「稳定前缀」（每轮重发的 system prompt）与「变化部分」（新消息）。
 *
 * 方法：拦截 window.fetch，捕获真实请求体后返回伪造的 SSE 流（不发真实网络请求）。
 *
 * 运行： node perf/payload.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5180;
const ROLE_ID = 'perf-role';

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

/** 构造三种数据规模，观察载荷随"记忆/世界书"膨胀的曲线 */
function seed(scale) {
  const persona = '你是一个温柔细腻的女孩，说话时会带一点犹豫，习惯用短句。你喜欢在对话里提到天气和食物。'.repeat(scale === 'heavy' ? 25 : (scale === 'mid' ? 8 : 1));

  const memories = [];
  const memCount = scale === 'heavy' ? 300 : (scale === 'mid' ? 80 : 0);
  for (let i = 0; i < memCount; i++) {
    memories.push({
      content: `第${i}条记忆：我们一起去了城东的那家面馆，你说汤头有点咸但很喜欢那个氛围，后来每次路过都会想起。`,
      category: ['key', 'plot', 'detail', 'preference'][i % 4],
      importance: 0.5 + (i % 5) * 0.1,
      status: 'confirmed',
      createdAt: Date.now() - i * 86400000,
    });
  }

  const worldbook = [];
  const wbCount = scale === 'heavy' ? 40 : (scale === 'mid' ? 12 : 0);
  for (let i = 0; i < wbCount; i++) {
    worldbook.push({
      keys: ['关键词' + i, '别名' + i],
      content: `世界书条目 ${i}：这个设定描述了故事发生的背景环境，包括地理位置、气候特征以及主要人物之间的关系网络。`.repeat(2),
      enabled: true,
    });
  }

  return { persona, memories, worldbook };
}

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const scenarios = ['light', 'mid', 'heavy'];
const out = {};

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  AI 请求载荷测量  |  拦截 fetch，不发真实请求');
console.log('══════════════════════════════════════════════════════════════\n');

for (const scale of scenarios) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const s = seed(scale);

  await ctx.addInitScript(({ roleId, persona, memories, worldbook, history }) => {
    localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: roleId, name: '载荷测试', persona: persona, avatar: '' },
    ]));
    localStorage.setItem('phone_current_contact', roleId);
    localStorage.setItem('chat_history_' + roleId, JSON.stringify(history));
    localStorage.setItem('myProfile', JSON.stringify({ name: '我', avatar: '', bio: '' }));
    localStorage.setItem('phone_data_v2', JSON.stringify({}));
    localStorage.setItem('chat_memories_' + roleId, JSON.stringify(memories));
    localStorage.setItem('phone_worldbooks', JSON.stringify([{ id: 'wb1', name: '主设定', entries: worldbook }]));
    localStorage.setItem('chat_worldbooks_' + roleId, JSON.stringify(['wb1']));
    localStorage.setItem('api_settings', JSON.stringify({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-benchmark-dummy-key',
      model: 'deepseek-chat',
      temperature: 0.85,
      maxTokens: 0,
      memoryCount: 20,
    }));
  }, {
    roleId: ROLE_ID,
    persona: s.persona,
    memories: s.memories,
    worldbook: s.worldbook,
    history: Array.from({ length: 400 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: '这是一条用于构造载荷的历史消息内容，长度大约三十到五十字左右，用于模拟真实对话的体量。'.slice(0, 30 + (i % 25)),
      time: Date.now() - (400 - i) * 60000,
      mid: 'h-' + i,
    })),
  });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/chat/chat/chat-detail.html?id=${ROLE_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.msg-row').length > 0, { timeout: 60000 });
  await page.waitForTimeout(600);

  const r = await page.evaluate(async () => {
    // 拦截 fetch：捕获请求体后立即返回伪造的 SSE 流
    let captured = null;
    const origFetch = window.fetch;
    window.fetch = async function (url, options) {
      captured = { url: String(url), body: options && options.body };
      const enc = new TextEncoder();
      const frame = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '嗯，我明白了。' } }] }) + '\n\ndata: [DONE]\n\n';
      const stream = new ReadableStream({
        start(c) { c.enqueue(enc.encode(frame)); c.close(); }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    await window.sendMsg({ text: '今天过得怎么样？' });
    window.fetch = origFetch;

    if (!captured) return { error: '未捕获到请求' };
    const parsed = JSON.parse(captured.body);
    const sys = (parsed.messages.find(m => m.role === 'system') || {}).content || '';
    const rest = parsed.messages.filter(m => m.role !== 'system');
    const bytes = new Blob([captured.body]).size;

    return {
      url: captured.url,
      totalBytes: bytes,
      totalKB: +(bytes / 1024).toFixed(1),
      systemChars: sys.length,
      historyMsgs: rest.length,
      historyChars: rest.reduce((a, m) => a + String(m.content || '').length, 0),
      model: parsed.model,
      stream: parsed.stream,
      max_tokens: parsed.max_tokens || null,
      temperature: parsed.temperature,
    };
  });

  out[scale] = r;
  await ctx.close();

  if (r.error) { console.log(`【${scale}】${r.error}`); continue; }
  // 中文粗估：约 1.5 字符 ≈ 1 token；此处仅作量级参考
  const estTokens = Math.round((r.systemChars + r.historyChars) / 1.5);
  console.log(
    `【${scale.padEnd(5)}】载荷 ${String(r.totalKB).padStart(6)} KB  |  ` +
    `system ${String(r.systemChars).padStart(6)} 字  |  历史 ${String(r.historyMsgs).padStart(3)} 条 / ${String(r.historyChars).padStart(5)} 字  |  ` +
    `≈ ${String(estTokens).padStart(5)} tokens`
  );
}

await browser.close();
server.close();

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  分析');
console.log('──────────────────────────────────────────────────────────────');
const light = out.light, heavy = out.heavy;
if (light && heavy && !light.error && !heavy.error) {
  const stable = heavy.systemChars, varying = heavy.historyChars;
  console.log(`1. 每轮请求中「稳定前缀」（system prompt，可缓存）占 ${((stable / (stable + varying)) * 100).toFixed(0)}%，每轮原样重发`);
  console.log(`2. 载荷随数据量膨胀：${light.totalKB} KB（轻量）→ ${heavy.totalKB} KB（重度），${(heavy.totalKB / light.totalKB).toFixed(1)}×`);
  console.log(`3. 重度场景单次请求 ${heavy.totalKB} KB ≈ ${Math.round((heavy.systemChars + heavy.historyChars) / 1.5)} tokens，全部计入 prefill`);
  console.log(`4. 历史窗口已限制在 ${heavy.historyMsgs} 条 —— 设计正确，不是膨胀源`);
  console.log(`5. 膨胀主要来自 system prompt：人设 + 记忆 + 世界书 = ${heavy.systemChars} 字`);
}

fs.writeFileSync(path.join(__dirname, 'payload.json'), JSON.stringify({ date: new Date().toISOString(), ...out }, null, 2));
console.log(`\n数据已写入 perf/payload.json\n`);
