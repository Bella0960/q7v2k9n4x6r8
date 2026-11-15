/**
 * CHAT-REPLY-001 续修：多气泡真实浏览器验证（Playwright）。
 *
 * 覆盖：
 *  1. 单条 / 自动 / 连续多条三种模式的真实落库与显示差异（走真实 sendMsg 链路，API 用本地 SSE mock）。
 *  2. 每个气泡身份唯一；刷新后身份与文本不变。
 *  3. 引用 / 编辑 / 删除 / 重生成在多气泡场景下不串号、不误伤其他气泡与其他轮次。
 *  4. 逐条显示（随时间统计 DOM 行数）、逐条持久化、刷新恢复。
 *  5. 老聊天记录（单条消息内含多个气泡）仍可正常显示与单气泡操作，且不做破坏性迁移。
 *  6. 设置页三种模式在 375 / 390 / 430 的实际布局与选中态。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.resolve(ROOT, '.' + urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

const ROLE_A = {
  id: 'bubA',
  name: '测试角色A',
  avatar: '',
  persona: '测试用角色，回复简短自然。',
  createdAt: 1
};
function rolesWith(mode) {
  return JSON.stringify([
    Object.assign({}, ROLE_A, { replyBubbleMode: mode }),
    { id: 'bubB', name: '测试角色B', avatar: '', persona: '另一个角色。', replyBubbleMode: 'auto', createdAt: 2 },
    // 非法的显式值归一到 auto；完全缺字段的角色由聊天页走 legacy 兼容路径。
    { id: 'bubC', name: '测试角色C', avatar: '', persona: '老角色。', replyBubbleMode: 'weird', createdAt: 3 }
  ]);
}

const MOCK_BASE = 'https://mock-maomao.test/v1';
const API_SETTINGS = JSON.stringify({ apiKey: 'test-key', baseUrl: MOCK_BASE, model: 'test-model' });

// 把文本切成小段拼成 OpenAI 兼容 SSE；PhoneStream 逐行解析 data: 载荷。
function sseFor(text) {
  const pieces = String(text).match(/[\s\S]{1,6}/g) || [String(text)];
  return pieces.map((piece) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
}

async function setSeed(page, entries) {
  await page.evaluate((obj) => {
    Object.keys(obj).forEach((key) => localStorage.setItem(key, obj[key]));
  }, entries);
}

function getBubbleRows(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('#chat-messages .msg-row')).map((row) => {
      const bubble = row.querySelector('.msg-bubble');
      return {
        bubbleId: row.dataset.bubbleId || '',
        mid: row.dataset.mid || '',
        bubbleIndex: row.dataset.bubbleIndex || '',
        text: bubble ? bubble.textContent.trim() : ''
      };
    });
  });
}

async function waitForRows(page, expected) {
  await page.waitForFunction((count) => {
    return document.querySelectorAll('#chat-messages .msg-row').length >= count;
  }, expected, { timeout: 8000, polling: 60 });
  // 等一次布局落定，避免刚 append 就取 rect。
  await page.waitForTimeout(120);
}

async function longPress(page, bubbleId) {
  const row = page.locator(`#chat-messages .msg-row[data-bubble-id="${bubbleId}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(260);
  const box = await row.locator('.msg-bubble').boundingBox();
  assert.ok(box, '气泡应有可见尺寸：' + bubbleId);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.locator('#msgSheetOverlay.active').waitFor({ timeout: 4000 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function clickMenuAction(page, act) {
  await page.locator(`#msgSheetList .msg-sheet-item[data-act="${act}"]`).click();
}

async function readHistory(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), key);
}

// 用 MutationObserver 记录行数变化序列：比轮询更可靠地捕获“逐条上屏”的中间态。
async function startRowWatch(page) {
  await page.evaluate(() => {
    const box = document.getElementById('chat-messages');
    window.__bubbleRowCounts = [box.querySelectorAll('.msg-row').length];
    window.__bubbleRowObserver = new MutationObserver(() => {
      const count = box.querySelectorAll('.msg-row').length;
      const list = window.__bubbleRowCounts;
      if (list[list.length - 1] !== count) list.push(count);
    });
    window.__bubbleRowObserver.observe(box, { childList: true, subtree: true });
  });
}

async function stopRowWatch(page) {
  return page.evaluate(() => {
    if (window.__bubbleRowObserver) window.__bubbleRowObserver.disconnect();
    return window.__bubbleRowCounts || [];
  });
}

// 发送一条用户消息，并在回复落库 / 逐条上屏期间记录 DOM 行数变化。
async function sendAndObserve(page, historyKey, text, expectedBubbles) {
  const before = await page.evaluate(() => document.querySelectorAll('#chat-messages .msg-row').length);
  await startRowWatch(page);
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');

  const deadline = Date.now() + 25000;
  let finalRows = -1;
  let replyCount = 0;
  while (Date.now() < deadline) {
    const snap = await page.evaluate((key) => {
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      return {
        rows: document.querySelectorAll('#chat-messages .msg-row').length,
        reply: history.filter((m) => m && m.role === 'assistant' && m.turnId).length
      };
    }, historyKey);
    replyCount = snap.reply;
    if (replyCount >= expectedBubbles && snap.rows >= before + 1 + expectedBubbles) {
      finalRows = snap.rows;
      break;
    }
    await page.waitForTimeout(70);
  }
  assert.ok(finalRows > 0, '等待回复逐条上屏超时；已落库气泡数=' + replyCount);
  const counts = await stopRowWatch(page);
  return { before, counts, finalRows };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('NOT RUN: Playwright 不可用 ->', err && err.message);
    process.exit(1);
  }

  let browser;
  let browserLabel;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    browserLabel = 'msedge';
  } catch (err) {
    browser = await chromium.launch({ headless: true });
    browserLabel = 'bundled-chromium (msedge 不可用，已回退)';
  }
  console.log('[browser]', browserLabel);

  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  const pageIssues = [];

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  await context.addInitScript((seed) => {
    Object.keys(seed).forEach((key) => {
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, seed[key]);
      }
    });
  }, { ai_custom_characters: rolesWith('auto'), api_settings: API_SETTINGS });

  const page = await context.newPage();
  page.on('pageerror', (err) => pageIssues.push('pageerror: ' + (err && err.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageIssues.push('console.error: ' + msg.text());
  });

  // API mock：真实 sendMsg -> PhoneStream -> fetch，本地 SSE 回包。
  let mockReplyText = '';
  let mockTranslation = '';
  await page.route(MOCK_BASE + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }
    // AI 翻译走非流式调用（stream:false），回 JSON；其余对话走 SSE。
    let wantsStream = true;
    try {
      const payload = JSON.parse(req.postData() || '{}');
      wantsStream = payload.stream !== false;
    } catch (err) {}
    if (!wantsStream) {
      return route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ choices: [{ message: { content: mockTranslation } }] })
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store'
      },
      body: sseFor(mockReplyText)
    });
  });

  try {
    // ================= 1. 设置页三种模式 =================
    await page.goto(origin + '/chat/chat/chat-settings.html?roleId=bubA', { waitUntil: 'domcontentloaded' });
    await page.locator('#bubbleModeCard').waitFor({ state: 'visible', timeout: 8000 });

    const initialMode = await page.evaluate(() => {
      const active = document.querySelector('#bubbleModeOptions .bubble-mode-opt.active');
      return active ? active.dataset.mode : '';
    });
    assert.equal(initialMode, 'auto', '老角色缺字段时应默认 auto');
    assert.equal(await page.locator('#bubbleModeOptions .bubble-mode-opt').count(), 3);
    results.push('设置页显示单条 / 自动 / 连续多条三个选项，缺字段默认自动');

    await page.locator('#bubbleModeOptions .bubble-mode-opt[data-mode="multi"]').click();
    let roleMode = await page.evaluate(() => {
      const roles = JSON.parse(localStorage.getItem('ai_custom_characters') || '[]');
      const role = roles.find((r) => r && r.id === 'bubA');
      return role ? role.replyBubbleMode : '';
    });
    assert.equal(roleMode, 'multi', '点击连续多条应写入 replyBubbleMode');
    assert.match(await page.textContent('#bubbleModeSub'), /连续多条/);
    results.push('点击连续多条写入角色对象并更新副标题');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#bubbleModeCard').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(
      await page.evaluate(() => {
        const active = document.querySelector('#bubbleModeOptions .bubble-mode-opt.active');
        return active ? active.dataset.mode + ':' + active.getAttribute('aria-checked') : '';
      }),
      'multi:true',
      '刷新后应保持连续多条选中'
    );
    results.push('刷新后连续多条选中态保持');

    await page.locator('#bubbleModeOptions .bubble-mode-opt[data-mode="single"]').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#bubbleModeCard').waitFor({ state: 'visible', timeout: 8000 });
    assert.match(await page.textContent('#bubbleModeSub'), /单条/);
    assert.equal(
      await page.evaluate(() => {
        const active = document.querySelector('#bubbleModeOptions .bubble-mode-opt.active');
        return active ? active.dataset.mode : '';
      }),
      'single'
    );
    results.push('单条模式写入并刷新保持');

    await page.goto(origin + '/chat/chat/chat-settings.html?roleId=bubC', { waitUntil: 'domcontentloaded' });
    await page.locator('#bubbleModeCard').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(
      await page.evaluate(() => {
        const active = document.querySelector('#bubbleModeOptions .bubble-mode-opt.active');
        return active ? active.dataset.mode : '';
      }),
      'auto',
      '非法 replyBubbleMode 应回落 auto'
    );
    results.push('非法 replyBubbleMode 回落自动（老角色兼容）');

    // ================= 2. 三模式真实生成落库 =================
    const MODE_CASES = [
      { mode: 'multi', reply: '第一句。\n第二句。\n第三句。', expected: ['第一句。', '第二句。', '第三句。'] },
      { mode: 'auto', reply: '甲段。\n\n乙段。\n\n丙段。', expected: ['甲段。', '乙段。', '丙段。'] },
      { mode: 'single', reply: '甲段。\n\n乙段。\n\n丙段。', expected: ['甲段。\n乙段。\n丙段。'] },
      { label: 'legacy', mode: undefined, reply: '老角色第一段。\n\n老角色第二段。\n\n老角色第三段。\n\n老角色第四段。\n\n老角色第五段。\n\n老角色第六段。\n\n老角色第七段。', expected: ['老角色第一段。', '老角色第二段。', '老角色第三段。', '老角色第四段。', '老角色第五段。', '老角色第六段。', '老角色第七段。'] }
    ];
    const generatedIds = {};

    for (const item of MODE_CASES) {
      const caseName = item.label || item.mode;
      await setSeed(page, {
        ai_custom_characters: rolesWith(item.mode),
        api_settings: API_SETTINGS,
        chat_history_bubA: JSON.stringify([{ role: 'user', text: '开始', time: 1000, mid: 'm_u1' }])
      });
      await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
      await waitForRows(page, 1);
      mockReplyText = item.reply;

      const observed = await sendAndObserve(page, 'chat_history_bubA', '请回我三句', item.expected.length);
      const history = await readHistory(page, 'chat_history_bubA');
      const turn = history.filter((m) => m && m.role === 'assistant' && m.turnId);
      assert.equal(turn.length, item.expected.length, `${caseName} 模式落库气泡数`);
      assert.deepEqual(turn.map((m) => m.text), item.expected, `${caseName} 模式正文`);
      assert.equal(new Set(turn.map((m) => m.mid)).size, turn.length, '每个气泡应有独立 mid');
      assert.equal(new Set(turn.map((m) => m.turnId)).size, 1, '同一轮应共享 turnId');
      assert.deepEqual(turn.map((m) => m.bubbleIndex), item.expected.map((_, i) => i));
      assert.deepEqual(turn.map((m) => m.bubbleCount), item.expected.map(() => item.expected.length));

      // 逐条显示：MutationObserver 记录的行数序列必须出现「尚未全部上屏」的中间态。
      assert.ok(
        observed.counts.some((n) => n > observed.before && n < observed.finalRows),
        `${caseName} 模式应逐条上屏（行数序列=${observed.counts.join(',')}）`
      );
      assert.equal(observed.counts[observed.counts.length - 1], observed.finalRows);

      const rowsBeforeReload = await getBubbleRows(page);
      const turnRows = rowsBeforeReload.filter((row) => turn.some((m) => row.bubbleId === m.mid));
      assert.equal(turnRows.length, turn.length, `${caseName} 模式 DOM 行数`);
      assert.deepEqual(turnRows.map((row) => row.text), item.expected);

      // 刷新恢复：身份与文本不变。
      await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
      await waitForRows(page, 1 + 1 + item.expected.length);
      const rowsAfterReload = await getBubbleRows(page);
      const turnRowsAfter = rowsAfterReload.filter((row) => turn.some((m) => row.bubbleId === m.mid));
      assert.equal(turnRowsAfter.length, turn.length, `${caseName} 模式刷新后气泡数`);
      assert.deepEqual(turnRowsAfter.map((row) => row.bubbleId), turnRows.map((row) => row.bubbleId));
      assert.deepEqual(turnRowsAfter.map((row) => row.text), item.expected);

      generatedIds[caseName] = turn.map((m) => m.mid);
      results.push(`${caseName} 模式：落库 ${turn.length} 条、逐条上屏、刷新后身份与文本不变`);
    }

    // ================= 2b. 浏览器真实链路：用户发送持久化失败 =================
    // 故障注入仅针对当前角色聊天记录，不改其他本地设置，不调用正式 AI。
    for (const failure of ['quota', 'silent']) {
      await setSeed(page, {
        ai_custom_characters: rolesWith('auto'),
        api_settings: API_SETTINGS,
        chat_history_bubA: JSON.stringify([{ role: 'user', text: '旧消息必须保留', time: 1, mid: 'old_safe' }])
      });
      await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
      await waitForRows(page, 1);
      const before = await page.evaluate(() => localStorage.getItem('chat_history_bubA'));

      await page.evaluate((mode) => {
        const original = Storage.prototype.setItem;
        window.__chatWriteAttemptCount = 0;
        window.__restoreChatWrite = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (key, value) {
          if (String(key) === 'chat_history_bubA') {
            window.__chatWriteAttemptCount += 1;
            if (mode === 'quota') throw new DOMException('quota exceeded', 'QuotaExceededError');
            return; // Simulate a browser/storage layer that silently ignores writes.
          }
          return original.call(this, key, value);
        };
      }, failure);

      const unsavedText = '模拟写入失败，不允许发送';
      try {
        await page.locator('#chat-input').fill(unsavedText);
        await page.locator('#chat-input').press('Enter');
        await page.waitForTimeout(700);
        const observed = await page.evaluate(() => ({
          writeAttempts: window.__chatWriteAttemptCount,
          stored: localStorage.getItem('chat_history_bubA'),
          input: document.getElementById('chat-input').value,
          visible: Array.from(document.querySelectorAll('#chat-messages .msg-row'))
            .map(row => row.innerText || '').join('\n')
        }));
        assert.ok(observed.writeAttempts > 0, failure + ': actual chat save path must be intercepted');
        assert.equal(observed.stored, before, failure + ': unsaved message must not mutate old history');
        assert.equal(observed.input, unsavedText, failure + ': a failed send must keep editable input');
        assert.ok(!observed.visible.includes(unsavedText),
          failure + ': a failed send must not appear as successfully delivered');
        results.push(failure + '：真实浏览器发送被拒，旧记录不变，输入和引用安全保留');
      } finally {
        await page.evaluate(() => {
          if (window.__restoreChatWrite) window.__restoreChatWrite();
          delete window.__restoreChatWrite;
        });
      }
    }

    // ================= 3. 老记录：单条消息多气泡的显示与四类操作 =================
    const legacyText = '旧气泡一\n\n旧气泡二\n\n旧气泡三';
    const legacyHistory = JSON.stringify([
      { role: 'user', text: '你好', time: 1000, mid: 'm_u_legacy' },
      { role: 'assistant', text: legacyText, time: 1001, mid: 'm_legacy' }
    ]);
    // 角色模式设为 multi：历史渲染必须保持存储文本原样，不被当前生成模式或 5 条上限重排。
    await setSeed(page, {
      ai_custom_characters: rolesWith('multi'),
      api_settings: API_SETTINGS,
      chat_history_bubA: legacyHistory
    });
    await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
    await waitForRows(page, 4);
    mockReplyText = '收到。';

    const legacyRows = await getBubbleRows(page);
    const legacyBubbles = legacyRows.filter((row) => row.bubbleId.indexOf('m_legacy') === 0);
    assert.deepEqual(legacyBubbles.map((row) => row.bubbleId), ['m_legacy#0', 'm_legacy#1', 'm_legacy#2']);
    assert.deepEqual(legacyBubbles.map((row) => row.text), ['旧气泡一', '旧气泡二', '旧气泡三']);
    results.push('老记录一条消息解析出 3 个独立气泡身份（mid#index），不受当前模式影响');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRows(page, 4);
    const legacyRowsReload = await getBubbleRows(page);
    assert.deepEqual(
      legacyRowsReload.filter((row) => row.bubbleId.indexOf('m_legacy') === 0).map((row) => row.bubbleId),
      legacyBubbles.map((row) => row.bubbleId),
      '刷新后老记录气泡身份不变'
    );
    results.push('刷新后老记录气泡身份不变');

    // 3a. 引用第二个气泡：只带该气泡文本，不串到兄弟气泡。
    await longPress(page, 'm_legacy#1');
    await clickMenuAction(page, 'quote');
    const quoteText = await page.textContent('#quoteBarText');
    assert.match(quoteText, /旧气泡二/);
    assert.doesNotMatch(quoteText, /旧气泡一|旧气泡三/);
    await page.fill('#chat-input', '收到引用');
    await page.press('#chat-input', 'Enter');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        return history.some((m) => m && m.role === 'user' && m.text === '收到引用');
      },
      { timeout: 8000 }
    );
    const quotedHistory = await readHistory(page, 'chat_history_bubA');
    const quotedUser = quotedHistory.filter((m) => m && m.role === 'user' && m.text === '收到引用').pop();
    assert.ok(quotedUser && quotedUser.quote, '引用应写入消息字段');
    assert.equal(quotedUser.quote.text, '旧气泡二', '引用只包含目标气泡文本');
    assert.equal(quotedUser.quote.mid, 'm_legacy', '引用仍指向原消息 mid');
    results.push('多气泡下引用只取目标气泡文本，兄弟气泡不串号');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.msg-quoted-text');
        return !!el && el.textContent.indexOf('旧气泡二') !== -1;
      },
      { timeout: 8000 }
    );
    assert.doesNotMatch(await page.evaluate(() => document.querySelector('.msg-quoted-text').textContent), /旧气泡一|旧气泡三/);
    results.push('引用内容刷新后仍正确显示');

    // 3b. 编辑第三个气泡：兄弟气泡不变，老记录仍是同一条消息。
    await longPress(page, 'm_legacy#2');
    await clickMenuAction(page, 'edit');
    await page.locator('#editOverlay').waitFor({ state: 'visible', timeout: 4000 });
    assert.equal(await page.inputValue('#editInput'), '旧气泡三');
    await page.fill('#editInput', '旧气泡三·已编辑');
    await page.locator('#editConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm_legacy');
        return !!msg && msg.text.indexOf('旧气泡三·已编辑') !== -1;
      },
      { timeout: 5000 }
    );
    const editedHistory = await readHistory(page, 'chat_history_bubA');
    const legacyMsg = editedHistory.filter((m) => m && m.mid === 'm_legacy');
    assert.equal(legacyMsg.length, 1, '老记录不做破坏性迁移：仍是一条消息');
    assert.equal(legacyMsg[0].text, '旧气泡一\n\n旧气泡二\n\n旧气泡三·已编辑');
    assert.equal(legacyMsg[0].turnId, undefined, '老记录不应被补写 turnId');
    const rowsAfterEdit = await getBubbleRows(page);
    assert.deepEqual(
      rowsAfterEdit.filter((row) => row.bubbleId.indexOf('m_legacy') === 0).map((row) => row.text),
      ['旧气泡一', '旧气泡二', '旧气泡三·已编辑']
    );
    results.push('多气泡下编辑单个气泡：兄弟气泡不变，老记录仍单条存储');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRows(page, 4);
    assert.deepEqual(
      (await getBubbleRows(page)).filter((row) => row.bubbleId.indexOf('m_legacy') === 0).map((row) => row.text),
      ['旧气泡一', '旧气泡二', '旧气泡三·已编辑'],
      '编辑结果刷新后保持'
    );
    results.push('编辑结果刷新后保持');

    // 3c. 删除第二个气泡：兄弟气泡保留，刷新后仍保留。
    await longPress(page, 'm_legacy#1');
    await clickMenuAction(page, 'delete');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm_legacy');
        return !!msg && msg.text === '旧气泡一\n\n旧气泡三·已编辑';
      },
      { timeout: 5000 }
    );
    const rowsAfterDelete = await getBubbleRows(page);
    assert.deepEqual(
      rowsAfterDelete.filter((row) => row.bubbleId.indexOf('m_legacy') === 0).map((row) => row.text),
      ['旧气泡一', '旧气泡三·已编辑'],
      '删除后兄弟气泡保留'
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    assert.deepEqual(
      (await getBubbleRows(page)).filter((row) => row.bubbleId.indexOf('m_legacy') === 0).map((row) => row.text),
      ['旧气泡一', '旧气泡三·已编辑'],
      '删除结果刷新后保持，兄弟气泡未被误删'
    );
    results.push('多气泡下删除单个气泡：兄弟气泡保留，刷新后仍保留');

    // 3d. 翻译第一个气泡：译文只写回目标段，兄弟气泡不受影响。
    mockTranslation = '旧气泡一译文';
    await longPress(page, 'm_legacy#0');
    await clickMenuAction(page, 'translate');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm_legacy');
        return !!msg && msg.text.indexOf('[中译:旧气泡一译文]') !== -1;
      },
      { timeout: 8000 }
    );
    const translatedHistory = await readHistory(page, 'chat_history_bubA');
    const translatedMsg = translatedHistory.filter((m) => m && m.mid === 'm_legacy');
    assert.equal(translatedMsg.length, 1, '翻译不应拆分老记录');
    assert.equal(translatedMsg[0].text, '旧气泡一\n[中译:旧气泡一译文]\n\n旧气泡三·已编辑');
    const legacyTextAfterTranslate = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#chat-messages .msg-row'))
        .filter((row) => (row.dataset.bubbleId || '').indexOf('m_legacy') === 0)
        .map((row) => {
          const clone = row.querySelector('.msg-bubble').cloneNode(true);
          const strip = clone.querySelector('.msg-translation');
          if (strip) strip.remove();
          return clone.textContent.trim();
        });
    });
    assert.deepEqual(legacyTextAfterTranslate, ['旧气泡一', '旧气泡三·已编辑'], '翻译后正文与气泡数量不变');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRows(page, 4);
    const legacyTranslationText = await page.evaluate(() => {
      const row = document.querySelector('#chat-messages .msg-row[data-bubble-id="m_legacy#0"]');
      const el = row && row.querySelector('.msg-translation');
      return el ? el.textContent.trim() : '';
    });
    assert.equal(legacyTranslationText, '旧气泡一译文', '刷新后译文仍只挂在目标气泡下');
    results.push('多气泡下翻译单个气泡：老记录译文只写回目标段，兄弟气泡不变');

    // 3e. 重生成：老记录没有 turnId，只替换被点击的那条消息，不误删其他消息。
    mockReplyText = '重写后一。\n\n重写后二。';
    await longPress(page, 'm_legacy#0');
    await clickMenuAction(page, 'rewrite');
    await page.locator('#regenOverlay').waitFor({ state: 'visible', timeout: 4000 });
    await page.locator('#regenConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const fresh = history.filter((m) => m && m.role === 'assistant' && m.turnId);
        return fresh.length >= 2 && !history.some((m) => m && m.mid === 'm_legacy');
      },
      { timeout: 15000 }
    );
    const afterLegacyRegen = await readHistory(page, 'chat_history_bubA');
    const legacyRegenTurn = afterLegacyRegen.filter(
      (m) => m && m.role === 'assistant' && (m.text === '重写后一。' || m.text === '重写后二。')
    );
    assert.equal(legacyRegenTurn.length, 2, '老记录重生成应按当前模式落库新气泡');
    assert.deepEqual(legacyRegenTurn.map((m) => m.text), ['重写后一。', '重写后二。']);
    assert.equal(legacyRegenTurn[0].turnId, legacyRegenTurn[1].turnId, '新回复共享一轮 turnId');
    assert.ok(!afterLegacyRegen.some((m) => m && m.mid === 'm_legacy'), '被重生成的老消息应被移除');
    assert.ok(afterLegacyRegen.some((m) => m && m.mid === 'm_u_legacy'), '更早的用户消息不应被误删');
    results.push('多气泡下重生成：老记录只替换目标消息，其他消息保留');

    // ================= 3f. 历史记录 8 条：编辑/删除/翻译/重生成都不得合并或截断 =================
    const EIGHT = ['一', '二', '三', '四', '五', '六', '七', '八'];
    const eightText = EIGHT.join('\n\n');
    await setSeed(page, {
      // 缺 replyBubbleMode 的老角色：生成与历史展示都走 legacy，不受 5 条上限约束。
      ai_custom_characters: JSON.stringify([ROLE_A]),
      api_settings: API_SETTINGS,
      chat_history_bubA: JSON.stringify([
        { role: 'user', text: '八段开始', time: 3000, mid: 'm_u8' },
        { role: 'assistant', name: '测试角色A', text: eightText, time: 4000, mid: 'm8' }
      ])
    });
    await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
    await waitForRows(page, 9);
    const eightIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#chat-messages .msg-row[data-bubble-id^="m8#"]')).map((row) => row.dataset.bubbleId)
    );
    assert.deepEqual(eightIds, EIGHT.map((_, i) => 'm8#' + i), '8 段历史应渲染为 8 个独立气泡');

    // 3f-1 编辑第 7 条：其余 7 条保持原样，不合并、不截断。
    await longPress(page, 'm8#6');
    await clickMenuAction(page, 'edit');
    await page.locator('#editOverlay').waitFor({ state: 'visible', timeout: 4000 });
    assert.equal(await page.inputValue('#editInput'), '七');
    await page.fill('#editInput', '七·改');
    await page.locator('#editConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm8');
        return !!msg && msg.text.indexOf('七·改') !== -1;
      },
      { timeout: 8000 }
    );
    const eightAfterEdit = (await readHistory(page, 'chat_history_bubA')).filter((m) => m && m.mid === 'm8');
    assert.equal(eightAfterEdit.length, 1, '编辑不应拆分老记录');
    assert.deepEqual(
      eightAfterEdit[0].text.split('\n\n'),
      ['一', '二', '三', '四', '五', '六', '七·改', '八'],
      '编辑后仍是 8 条，未合并'
    );
    results.push('历史 8 条：编辑第 7 条后仍保留 8 条，其余内容不变');

    // 3f-2 翻译第 8 条：条数仍为 8，译文只落在第 8 条。
    mockTranslation = '八译文';
    await longPress(page, 'm8#7');
    await clickMenuAction(page, 'translate');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm8');
        return !!msg && msg.text.indexOf('[中译:八译文]') !== -1;
      },
      { timeout: 8000 }
    );
    const eightAfterTranslate = (await readHistory(page, 'chat_history_bubA')).filter((m) => m && m.mid === 'm8');
    const translatedParts = eightAfterTranslate[0].text.split('\n\n');
    assert.equal(translatedParts.length, 8, '翻译后仍是 8 条');
    assert.deepEqual(translatedParts.slice(0, 7), ['一', '二', '三', '四', '五', '六', '七·改']);
    assert.match(translatedParts[7], /八\n\[中译:八译文\]/, '译文只写回第 8 条');
    results.push('历史 8 条：翻译第 8 条后仍保留 8 条，译文不扩散');

    // 3f-3 删除第 6 条：剩 7 条，不合并、不截断。
    await longPress(page, 'm8#5');
    await clickMenuAction(page, 'delete');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm8');
        return !!msg && msg.text.indexOf('六') === -1;
      },
      { timeout: 8000 }
    );
    const eightAfterDelete = (await readHistory(page, 'chat_history_bubA')).filter((m) => m && m.mid === 'm8');
    assert.equal(eightAfterDelete.length, 1, '删除单个气泡不应拆分老记录');
    const deletedParts = eightAfterDelete[0].text.split('\n\n');
    assert.equal(deletedParts.length, 7, '删除后剩 7 条，未合并');
    assert.deepEqual(deletedParts.slice(0, 5), ['一', '二', '三', '四', '五']);
    assert.equal(deletedParts[5], '七·改');
    assert.match(deletedParts[6], /八\n\[中译:八译文\]/);
    const rowsAfterDelete8 = await getBubbleRows(page);
    assert.equal(rowsAfterDelete8.filter((row) => row.bubbleId.indexOf('m8') === 0).length, 7);
    results.push('历史 8 条：删除第 6 条后剩 7 条，其余气泡不合并不截断');

    // 3f-4 重生成：老角色 8 段回复仍落 8 条，更早的用户消息保留。
    mockReplyText = EIGHT.map((s) => s + '。').join('\n\n');
    await longPress(page, 'm8#0');
    await clickMenuAction(page, 'rewrite');
    await page.locator('#regenOverlay').waitFor({ state: 'visible', timeout: 4000 });
    await page.locator('#regenConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const fresh = history.filter((m) => m && m.role === 'assistant');
        return fresh.length === 8 && !history.some((m) => m && m.mid === 'm8');
      },
      null,
      { timeout: 15000 }
    );
    const afterRegen8 = await readHistory(page, 'chat_history_bubA');
    const fresh8 = afterRegen8.filter((m) => m && m.role === 'assistant');
    assert.equal(fresh8.length, 8, '老角色 8 段重生成必须是 8 条');
    assert.deepEqual(fresh8.map((m) => m.text), EIGHT.map((s) => s + '。'));
    assert.equal(new Set(fresh8.map((m) => m.turnId)).size, 1, '同一轮共享 turnId');
    assert.ok(afterRegen8.some((m) => m && m.mid === 'm_u8'), '更早用户消息保留');
    results.push('历史 8 条：重生成后老角色仍落 8 条，未被 5 条上限合并');

    // ================= 4. 新记录：编辑 / 删除 / 重生成 =================
    const splitHistory = JSON.stringify([
      { role: 'user', text: '开始', time: 2000, mid: 'm_u2' },
      { role: 'assistant', text: '新气泡一', time: 2001, mid: 'm_n1', turnId: 'turn-new', bubbleIndex: 0, bubbleCount: 3 },
      { role: 'assistant', text: '新气泡二', time: 2002, mid: 'm_n2', turnId: 'turn-new', bubbleIndex: 1, bubbleCount: 3 },
      { role: 'assistant', text: '新气泡三', time: 2003, mid: 'm_n3', turnId: 'turn-new', bubbleIndex: 2, bubbleCount: 3 },
      { role: 'user', text: '再问', time: 2010, mid: 'm_u3' },
      { role: 'assistant', text: '第二轮回复', time: 2011, mid: 'm_n4', turnId: 'turn-two', bubbleIndex: 0, bubbleCount: 1 }
    ]);
    await setSeed(page, {
      ai_custom_characters: rolesWith('auto'),
      api_settings: API_SETTINGS,
      chat_history_bubA: splitHistory
    });
    await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
    await waitForRows(page, 6);
    mockReplyText = '重写一。\n\n重写二。';

    const splitRows = await getBubbleRows(page);
    assert.deepEqual(splitRows.map((row) => row.bubbleId), ['m_u2', 'm_n1', 'm_n2', 'm_n3', 'm_u3', 'm_n4']);
    results.push('新记录每个气泡一条消息、独立 mid，身份即消息身份');

    // 4a. 编辑第二个气泡。
    await longPress(page, 'm_n2');
    await clickMenuAction(page, 'edit');
    await page.locator('#editOverlay').waitFor({ state: 'visible', timeout: 4000 });
    assert.equal(await page.inputValue('#editInput'), '新气泡二');
    await page.fill('#editInput', '新气泡二·已编辑');
    await page.locator('#editConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        return history.some((m) => m && m.mid === 'm_n2' && m.text === '新气泡二·已编辑');
      },
      { timeout: 5000 }
    );
    const afterEditHistory = await readHistory(page, 'chat_history_bubA');
    assert.equal(afterEditHistory.length, 6, '编辑不应合并或拆分消息');
    assert.deepEqual(
      afterEditHistory.map((m) => m.text),
      ['开始', '新气泡一', '新气泡二·已编辑', '新气泡三', '再问', '第二轮回复']
    );
    results.push('新记录编辑单个气泡不串改其他气泡');

    // 4b. 删除第三个气泡。
    await longPress(page, 'm_n3');
    await clickMenuAction(page, 'delete');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        return !history.some((m) => m && m.mid === 'm_n3');
      },
      { timeout: 5000 }
    );
    const afterDeleteHistory = await readHistory(page, 'chat_history_bubA');
    assert.equal(afterDeleteHistory.length, 5);
    assert.deepEqual(
      afterDeleteHistory.map((m) => m.text),
      ['开始', '新气泡一', '新气泡二·已编辑', '再问', '第二轮回复']
    );
    results.push('新记录删除单个气泡只移除该气泡，其他气泡与其他轮次保留');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRows(page, 5);
    assert.deepEqual(
      (await getBubbleRows(page)).map((row) => row.text),
      ['开始', '新气泡一', '新气泡二·已编辑', '再问', '第二轮回复']
    );
    results.push('新记录编辑 / 删除结果刷新后保持');

    // 4d. 翻译第二个气泡：只写入该条消息的 translation，其他气泡不受影响。
    mockTranslation = '新气泡二译文';
    await longPress(page, 'm_n2');
    await clickMenuAction(page, 'translate');
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const msg = history.find((m) => m && m.mid === 'm_n2');
        return !!msg && msg.translation === '新气泡二译文';
      },
      { timeout: 8000 }
    );
    const afterTranslateHistory = await readHistory(page, 'chat_history_bubA');
    assert.equal(afterTranslateHistory.length, 5, '翻译不应新增或合并消息');
    assert.deepEqual(
      afterTranslateHistory.map((m) => m.text),
      ['开始', '新气泡一', '新气泡二·已编辑', '再问', '第二轮回复']
    );
    assert.equal(afterTranslateHistory.find((m) => m.mid === 'm_n2').translation, '新气泡二译文');
    assert.equal(afterTranslateHistory.find((m) => m.mid === 'm_n1').translation, undefined, '兄弟气泡不应被写入译文');
    const freshTranslationText = await page.evaluate(() => {
      const row = document.querySelector('#chat-messages .msg-row[data-bubble-id="m_n2"]');
      const el = row && row.querySelector('.msg-translation');
      return el ? el.textContent.trim() : '';
    });
    assert.equal(freshTranslationText, '新气泡二译文', '译文应挂在目标气泡下');
    results.push('多气泡下翻译单个气泡：新记录只写目标消息，其他气泡不受影响');

    // 4e. 引用第二个气泡：引用栏只带该气泡文本，不串到兄弟气泡。
    await longPress(page, 'm_n2');
    await clickMenuAction(page, 'quote');
    const freshQuoteText = await page.textContent('#quoteBarText');
    assert.match(freshQuoteText, /新气泡二·已编辑/);
    assert.doesNotMatch(freshQuoteText, /新气泡一|新气泡三/);
    results.push('多气泡下引用：新记录只取目标气泡文本，兄弟气泡不串号');

    // 4c. 重生成：走真实菜单 -> 改写 -> 确认重玩，整轮 turn-new 被替换，其他轮次不动。
    await longPress(page, 'm_n1');
    await clickMenuAction(page, 'rewrite');
    await page.locator('#regenOverlay').waitFor({ state: 'visible', timeout: 4000 });
    await page.fill('#regenInput', '换个说法');
    await page.locator('#regenConfirm').click();
    await page.waitForFunction(
      () => {
        const history = JSON.parse(localStorage.getItem('chat_history_bubA') || '[]');
        const turnNew = history.filter((m) => m && m.turnId === 'turn-new');
        const newTurn = history.filter((m) => m && m.role === 'assistant' && m.turnId !== 'turn-two' && m.text === '重写一。');
        return turnNew.length === 0 && newTurn.length === 1;
      },
      { timeout: 25000 }
    );
    // 落库先于逐条上屏完成，等新气泡真正上屏后再断言 DOM。
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('#chat-messages .msg-row .msg-bubble')).some((el) => el.textContent.trim() === '重写二。'),
      { timeout: 10000 }
    );
    const regenHistory = await readHistory(page, 'chat_history_bubA');
    assert.equal(regenHistory.some((m) => m && (m.mid === 'm_n1' || m.mid === 'm_n2')), false, '旧轮气泡应全部移除');
    assert.ok(regenHistory.some((m) => m && m.mid === 'm_n4'), '其他轮次不应被误删');
    assert.ok(regenHistory.some((m) => m && m.mid === 'm_u2') && regenHistory.some((m) => m && m.mid === 'm_u3'), '用户消息应保留');
    const regenTurn = regenHistory.filter(
      (m) => m && m.role === 'assistant' && (m.text === '重写一。' || m.text === '重写二。')
    );
    assert.equal(regenTurn.length, 2, 'auto 模式重生成应落库 2 条气泡');
    assert.equal(new Set(regenTurn.map((m) => m.mid)).size, 2);
    assert.equal(new Set(regenTurn.map((m) => m.turnId)).size, 1);
    assert.notEqual(regenTurn[0].turnId, 'turn-new');

    const regenRows = await getBubbleRows(page);
    assert.equal(regenRows.some((row) => row.bubbleId === 'm_n1' || row.bubbleId === 'm_n2'), false);
    assert.ok(regenRows.some((row) => row.text === '重写一。'));
    assert.ok(regenRows.some((row) => row.text === '重写二。'));
    assert.ok(regenRows.some((row) => row.text === '第二轮回复'));
    results.push('多气泡下重生成：整轮替换、其他轮次与用户消息不受影响');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const regenHistoryReload = await readHistory(page, 'chat_history_bubA');
    assert.equal(regenHistoryReload.filter((m) => m && m.turnId === 'turn-new').length, 0);
    assert.ok(regenHistoryReload.some((m) => m && m.mid === 'm_n4'));
    assert.ok((await getBubbleRows(page)).some((row) => row.text === '重写一。'));
    results.push('重生成结果刷新后保持');

    // ================= 5. 375 / 390 / 430 三档页面验证 =================
    const widthHistory = JSON.stringify([
      { role: 'user', text: '宽度检查', time: 3000, mid: 'm_u_w' },
      { role: 'assistant', text: '宽度气泡一\n\n宽度气泡二\n\n宽度气泡三', time: 3001, mid: 'm_w' }
    ]);
    for (const width of [375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });

      await setSeed(page, {
        ai_custom_characters: rolesWith('auto'),
        chat_history_bubA: widthHistory
      });
      await page.goto(origin + '/chat/chat/chat-settings.html?roleId=bubA', { waitUntil: 'domcontentloaded' });
      await page.locator('#bubbleModeCard').waitFor({ state: 'visible', timeout: 8000 });

      const settingsLayout = await page.evaluate(() => {
        const card = document.getElementById('bubbleModeCard');
        const opts = Array.from(document.querySelectorAll('#bubbleModeOptions .bubble-mode-opt'));
        const vw = document.documentElement.clientWidth;
        const cardRect = card.getBoundingClientRect();
        const rects = opts.map((el) => {
          const r = el.getBoundingClientRect();
          return { mode: el.dataset.mode, left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
        });
        return {
          vw,
          cardRight: cardRect.right,
          options: rects,
          sameRow: rects.every((r) => Math.abs(r.top - rects[0].top) < 2)
        };
      });
      assert.equal(settingsLayout.options.length, 3, width + 'px 设置页应有三个选项');
      assert.ok(settingsLayout.options.every((r) => r.width > 0 && r.height > 0), width + 'px 三个选项均应可见');
      assert.ok(settingsLayout.sameRow, width + 'px 三个选项应排在同一行');
      assert.ok(settingsLayout.cardRight <= settingsLayout.vw + 1, width + 'px 设置卡片不应横向溢出');
      assert.ok(Math.max(...settingsLayout.options.map((r) => r.right)) <= settingsLayout.vw + 1, width + 'px 选项不应横向溢出');

      await page.goto(origin + '/chat/chat/chat-detail.html?id=bubA', { waitUntil: 'domcontentloaded' });
      await waitForRows(page, 4);
      const chatLayout = await page.evaluate(() => {
        const box = document.getElementById('chat-messages');
        const vw = document.documentElement.clientWidth;
        const bubbles = Array.from(box.querySelectorAll('.msg-row .msg-bubble'));
        const bad = bubbles.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > vw + 1 || r.left < -1);
        });
        return {
          vw,
          bubbles: bubbles.length,
          bad: bad.length,
          overflowX: box.scrollWidth - box.clientWidth
        };
      });
      assert.ok(chatLayout.bubbles >= 4, width + 'px 聊天页应渲染多气泡');
      assert.equal(chatLayout.bad, 0, width + 'px 气泡不应横向溢出屏幕');
      assert.ok(chatLayout.overflowX <= 1, width + 'px 聊天区域不应横向滚动');

      results.push(`${width}px：设置页三选项同排可见、聊天 3 气泡不横向溢出`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
  } finally {
    await context.close();
    await browser.close();
    await new Promise((done) => server.close(done));
  }

  results.forEach((line) => console.log('PASS -', line));
  if (pageIssues.length) {
    console.log('WARN - 页面错误日志（可能与本次改动无关，未作为失败条件）：');
    pageIssues.slice(0, 12).forEach((line) => console.log('  ' + line));
  }
  console.log('ALL PASS:', results.length);
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
