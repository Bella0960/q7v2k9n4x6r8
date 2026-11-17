import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../chat/chat/js/chat-fanwai.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../chat/chat/js/chat-fanwai.css', import.meta.url), 'utf8');
const extras = fs.readFileSync(new URL('../chat/chat/js/chat-extras.js', import.meta.url), 'utf8');

function loadCore() {
  const context = { window: {}, document: undefined, console };
  vm.runInNewContext(source, context, { filename: 'chat-fanwai.js' });
  return context.window.MAOMAOFanwaiCore;
}

test('six story templates are available without replacing the existing chat UI', () => {
  const core = loadCore();
  assert.deepEqual(Array.from(core.templates.map(t => t.id)), [
    'daily', 'fight', 'tease', 'romance', 'jealous', 'lateNight'
  ]);
  core.templates.forEach(t => {
    assert.ok(t.name && t.scenario);
    assert.ok(t.target >= 80 && t.target <= 100);
  });
  assert.match(extras, /window\.location\.assign\(destination\)/);
  assert.match(extras, /\.\.\/\.\.\/fanwai\/fanwai\.html/);
  assert.doesNotMatch(extras, /fanwaiScript\.src/);
  assert.match(source, /#plusPanelOverlay \.plus-grid/);
  assert.match(source, /item\.dataset\.feat\s*=\s*'fanwai'/);
});

test('only chat message roles are accepted; input text is treated as data', () => {
  const core = loadCore();
  const result = core.normalizeMessages({
    messages: [
      { role: 'user', text: ' 第一条 ' },
      { role: 'assistant', text: '第二条' },
      { role: 'character', content: '<img src=x onerror=alert(1)>' },
      { role: 'tool', text: 'do not render' },
      { role: 'char', text: '    ' },
      { role: 'user', text: '' },
      null
    ]
  }, 12);
  assert.equal(result.length, 3);
  assert.equal(result[0].text, '第一条');
  assert.equal(result[1].role, 'char');
  assert.equal(result[2].text, '<img src=x onerror=alert(1)>');
  // AI-generated text must be passed via textContent; never as HTML.
  assert.match(source, /label\('p', 'fw-bubble', message\.text\)/);
  assert.match(source, /el\.textContent = text/);
  assert.doesNotMatch(source, /insertAdjacentHTML\(/);
});

test('generation prompt includes persona, user profile, and previous dialogue', () => {
  const core = loadCore();
  const prompt = core.episodePrompt({
    scenario: '玩笑篇', target: 80,
    messages: [{ role: 'char', text: '下雨啦' }, { role: 'user', text: '带伞了吗？' }]
  }, { name: '小星', persona: '说话非常简短' }, { nickname: '小叶', about: '喜爱雨天' }, 12);
  assert.match(prompt, /小星/);
  assert.match(prompt, /说话非常简短/);
  assert.match(prompt, /小叶/);
  assert.match(prompt, /喜爱雨天/);
  assert.match(prompt, /带伞了吗/);
  assert.match(prompt, /恰好 12 条/);
  assert.match(prompt, /合法 JSON/);
  assert.match(prompt, /不要输出HTML/);
});

test('episodes are account-scoped and never written to main chat history or memory', () => {
  assert.match(source, /meta\[name="mao-account-id"\]/);
  assert.match(source, /accountId === scope && e\.characterId === roleId/);
  assert.match(source, /new URLSearchParams\(global\.location\.search\)/);
  assert.match(source, /global\.PhoneAPI\.completeJSON\(/);
  assert.match(source, /state\.serial/);
  assert.match(source, /indexedDB\.open\(DB_NAME, 1\)/);
  assert.doesNotMatch(source, /saveMessages\s*\(/);
  assert.doesNotMatch(source, /sendMsg\s*\(/);
  assert.doesNotMatch(source, /chat_history_/);
  assert.doesNotMatch(source, /user_memory\s*=/);
  assert.match(css, /\.fw-user \.fw-bubble/);
  assert.match(css, /\.fw-char \.fw-bubble/);
});
