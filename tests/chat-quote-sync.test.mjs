import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const detail = readFileSync(resolve(root, 'chat/chat/chat-detail.html'), 'utf8');

// 从真实源码中按名称提取函数体（大括号配平），避免复制一份实现自证。
function sliceFrom(source, startIndex) {
  const open = source.indexOf('{', startIndex);
  assert.ok(open !== -1, 'expected function body opening brace');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  throw new Error('unbalanced braces while extracting source');
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start !== -1, 'missing helper: ' + name);
  return sliceFrom(source, start);
}

function extractAssignmentFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, 'missing assignment: ' + signature);
  return sliceFrom(source, start);
}

const helperNames = [
  '_forEachQuoteOfMid',
  '_syncQuotedTextsAfterEdit',
  '_invalidateQuotesForDeletedMids',
  '_persistWithQuoteSync',
  '_sanitizeQuotesForPrompt'
];
const helperSource = helperNames.map((name) => extractFunction(detail, name)).join('\n');

function makeSandbox(overrides = {}) {
  const sandbox = {
    console: { warn() {} },
    showToast() {},
    _shouldWarnAgain() { return true; },
    _storage: null,
    currentCharacter: { id: 'c1' },
    storageKey: 'chat_history_c1',
    localStorage: null,
    saveMessages() {},
    ...overrides
  };
  runInNewContext(helperSource, sandbox);
  return sandbox;
}

// ---------- 1. 三个入口确实调用同步逻辑 ----------

test('编辑路径在落盘前同步被引用消息的最新文本', () => {
  const body = extractFunction(detail, 'saveEditedMessage');
  assert.match(body, /var quoteExpected = _syncQuotedTextsAfterEdit\(list, mid, newText\);/);
  assert.match(body, /var quoteSaved = _persistWithQuoteSync\(list, quoteExpected\);/);
  // 原来的裸 saveMessages(list) 已被带复核的持久化函数取代
  assert.ok(!/^\s*saveMessages\(list\);\s*$/m.test(body), 'edit path must persist via _persistWithQuoteSync');
  assert.match(body, /if \(quoteSaved && typeof showToast === 'function'\) showToast\('已保存'\);/);
  // 引用快照变化时必须整表重绘，否则其他消息里的引用预览仍显示旧文本
  assert.match(body, /if \(Object\.keys\(quoteExpected\)\.length\) \{[\s\S]*?renderAllMessages\(\);[\s\S]*?return;/);
});

test('单条删除路径在保留历史的同时把引用标记为失效', () => {
  const body = extractFunction(detail, 'deleteOneMessage');
  assert.match(body, /var quoteExpected = _invalidateQuotesForDeletedMids\(keep, \[mid\]\);/);
  assert.match(body, /var quoteSaved = _persistWithQuoteSync\(keep, quoteExpected\);/);
  assert.match(body, /if \(quoteSaved && typeof showToast === 'function'\) showToast\('已删除 1 条消息'\);/);
});

test('批量删除路径同样让引用失效，且不会谎报成功', () => {
  const start = detail.indexOf("document.getElementById('selectDeleteBtn').addEventListener('click', function () {");
  assert.ok(start !== -1);
  const body = sliceFrom(detail, start);
  assert.match(body, /var deletedMids = list\.filter/);
  assert.match(body, /var quoteExpected = _invalidateQuotesForDeletedMids\(keep, deletedMids\);/);
  assert.match(body, /var quoteSaved = _persistWithQuoteSync\(keep, quoteExpected\);/);
  assert.match(body, /if \(quoteSaved && typeof showToast === 'function'\) showToast\('已删除 '/);
});

test('重新生成路径先记录被移除消息的 mid，再让旧引用失效', () => {
  const body = extractAssignmentFunction(detail, 'window.regenerateReply = function(direction, mid)');
  const removedIndex = body.indexOf('var removedMid = ensureMid(list[targetIdx]);');
  const spliceIndex = body.indexOf('list.splice(targetIdx, 1);');
  const invalidateIndex = body.indexOf('var quoteExpected = _invalidateQuotesForDeletedMids(list, [removedMid]);');
  assert.ok(removedIndex !== -1, 'removedMid must be captured before splice');
  assert.ok(spliceIndex !== -1, 'target message must still be removed');
  assert.ok(invalidateIndex !== -1, 'quotes referring to the regenerated reply must be invalidated');
  assert.ok(removedIndex < spliceIndex, 'mid must be read before the message disappears from the list');
  assert.ok(spliceIndex < invalidateIndex, 'invalidation must run on the remaining history');
  assert.match(body, /_persistWithQuoteSync\(list, quoteExpected\);/);
});

// ---------- 2. 失效引用不再进入 prompt ----------

test('prompt 拼装对 ChatContextPolicy 的输入先剔除失效引用文本', () => {
  assert.match(
    detail,
    /recentHistory = _sanitizeQuotesForPrompt\(recentHistory\);/,
    'history must be sanitized before prompt assembly'
  );
  assert.match(
    detail,
    /window\.ChatContextPolicy\.mapHistoryToApiMessages\(recentHistory, stripInternalReasoning,/,
    'sanitized history must feed the shared context policy'
  );
});

test('兼容降级 prompt 拼装显式跳过失效引用', () => {
  const start = detail.indexOf('// Compatibility fallback: keep the legacy context mapping intact');
  assert.ok(start !== -1);
  const body = detail.slice(start, start + 3000);
  assert.match(body, /if \(m\.quote && typeof m\.quote === 'object' && !m\.quote\.invalid && m\.quote\.text\) \{/);
});

// ---------- 3. UI 明确展示失效状态，旧数据继续可渲染 ----------

test('引用气泡渲染保留旧数据并显示明确的失效状态', () => {
  assert.match(detail, /if \(msg\.quote && \(msg\.quote\.text \|\| msg\.quote\.invalid\)\) \{/);
  assert.match(detail, /' · 原消息已删除'/);
  assert.match(detail, /quoteBox\.classList\.add\('msg-quoted-invalid'\)/);
  assert.match(detail, /\.msg-quoted-invalid \.msg-quoted-text \{ color:#8E8E93; \}/);
  // 旧 quote 结构（只有 text/authorName/mid）仍走原渲染分支
  assert.match(detail, /quoteText\.textContent = String\(msg\.quote\.text \|\| ''\);/);
});

// ---------- 4. 真实源码函数行为 ----------

test('编辑同步只更新真正引用了该 mid 的、仍有效的快照', () => {
  const box = makeSandbox();
  const list = [
    { mid: 'reply-1', role: 'user', quote: { mid: 'target', text: '旧文本', authorName: 'TA', fromRole: 'received' } },
    { mid: 'reply-2', role: 'user', quote: { mid: 'target', text: '旧文本', invalid: true } },
    { mid: 'reply-3', role: 'user', quote: { mid: 'other', text: '无关引用' } },
    { mid: 'target', role: 'received', text: '旧文本' }
  ];
  const expected = box._syncQuotedTextsAfterEdit(list, 'target', '新文本');
  assert.equal(Object.keys(expected).length, 1);
  assert.equal(expected.target.text, '新文本');
  assert.equal(list[0].quote.text, '新文本');
  assert.equal(list[1].quote.text, '旧文本', '已失效的引用不能复活');
  assert.equal(list[1].quote.invalid, true);
  assert.equal(list[2].quote.text, '无关引用', '其他引用不受影响');
  assert.equal(list[3].text, '旧文本', '消息本体不在这里被修改');
});

test('删除/重生成把引用标记为失效，但保留引用历史文本', () => {
  const box = makeSandbox();
  const list = [
    { mid: 'reply-1', quote: { mid: 'target', text: '旧文本', authorName: 'TA' } },
    { mid: 'reply-2', quote: { mid: 'target', text: '旧文本', invalid: true } },
    { mid: 'reply-3', quote: { mid: 'other', text: '无关引用' } }
  ];
  const expected = box._invalidateQuotesForDeletedMids(list, ['target']);
  assert.deepEqual(Object.keys(expected), ['target']);
  assert.equal(expected.target.invalid, true);
  assert.equal(list[0].quote.invalid, true);
  assert.equal(list[0].quote.text, '旧文本', '引用历史文本必须保留');
  assert.equal(list[1].quote.invalid, true, '重复失效保持幂等');
  assert.equal(list[2].quote.invalid, undefined, '其他引用不受影响');
});

test('旧数据结构（无 invalid 字段）按有效引用处理，不做迁移', () => {
  const box = makeSandbox();
  const legacy = [
    { mid: 'reply-1', quote: { mid: 'target', text: '旧文本', authorName: 'TA' } },
    { mid: 'legacy-without-mid', quote: { text: '没有 mid 的旧快照' } }
  ];
  const sanitized = box._sanitizeQuotesForPrompt(legacy);
  assert.equal(sanitized, legacy, '没有任何失效引用时应原样返回，不重建数组');
  assert.equal(legacy[0].quote.text, '旧文本');
  assert.equal(legacy[0].quote.invalid, undefined);
  assert.equal(legacy[1].quote.text, '没有 mid 的旧快照');
});

test('失效引用在给 AI 的上下文里被剥掉旧文本，且不改动原记录', () => {
  const box = makeSandbox();
  const history = [
    { role: 'user', text: '回答我', quote: { mid: 'target', text: '旧文本', authorName: 'TA', invalid: true } },
    { role: 'user', text: '正常引用', quote: { mid: 'target', text: '保留', authorName: 'TA' } }
  ];
  const sanitized = box._sanitizeQuotesForPrompt(history);
  assert.equal(sanitized[0].quote.text, undefined, '失效引用的旧内容不得再进入 prompt');
  assert.equal(sanitized[0].quote.invalid, true);
  assert.equal(sanitized[0].quote.authorName, 'TA');
  assert.equal(history[0].quote.text, '旧文本', '内存中的历史记录不能被就地改写');
  assert.equal(sanitized[1].quote.text, '保留');
  assert.equal(sanitized[1], history[1], '有效引用直接复用原对象');
});

test('同步落盘失败时返回 false 并沿用现有 toast 冷却', () => {
  const toasts = [];
  const stale = [{ mid: 'reply-1', quote: { mid: 'target', text: '旧文本' } }];
  const box = makeSandbox({
    _storage: { getChatHistory() { return stale; } },
    saveMessages() {},
    showToast(message) { toasts.push(message); },
    _shouldWarnAgain() { return true; }
  });
  const current = [{ mid: 'reply-1', quote: { mid: 'target', text: '旧文本', invalid: true } }];
  assert.equal(box._persistWithQuoteSync(current, { target: { invalid: true } }), false);
  assert.deepEqual(toasts, ['引用同步未能保存，请检查本地存储空间']);
});

test('同步落盘成功时返回 true 且不弹失败提示', () => {
  const toasts = [];
  const persisted = [{ mid: 'reply-1', quote: { mid: 'target', text: '新文本' } }];
  const box = makeSandbox({
    _storage: { getChatHistory() { return persisted; } },
    saveMessages() {},
    showToast(message) { toasts.push(message); },
    _shouldWarnAgain() { return true; }
  });
  assert.equal(box._persistWithQuoteSync(persisted, { target: { text: '新文本' } }), true);
  assert.deepEqual(toasts, []);
  // 没有引用需要同步时不应额外读取或弹提示
  assert.equal(box._persistWithQuoteSync([], {}), true);
  assert.deepEqual(toasts, []);
});
