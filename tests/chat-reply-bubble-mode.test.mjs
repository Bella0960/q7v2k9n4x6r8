import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const policySource = read('shared/js/phone/chat-message-policy.js');
const detailSource = read('chat/chat/chat-detail.html');
const settingsSource = read('chat/chat/chat-settings.html');
const charactersSource = read('worldbook/characters/js/characters-manager.js');
const backupSource = read('settings/js/backup.js');

const policyWindow = {};
runInNewContext(policySource, { window: policyWindow, globalThis: {} });
const policy = policyWindow.ChatMessagePolicy;

// 只读的 localStorage 替身：自有键只暴露真实存储的 key，避免把方法名算进快照。
function makeLocalStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return new Proxy({}, {
    ownKeys: () => Object.keys(data),
    getOwnPropertyDescriptor: (target, prop) => ({ enumerable: true, configurable: true, value: data[prop] }),
    has: (target, prop) => prop in data || ['getItem', 'setItem', 'removeItem', 'clear', 'key', 'length'].includes(prop),
    get: (target, prop) => {
      if (prop === 'getItem') return (key) => (key in data ? data[key] : null);
      if (prop === 'setItem') return (key, value) => { data[key] = String(value); };
      if (prop === 'removeItem') return (key) => { delete data[key]; };
      if (prop === 'clear') return () => { Object.keys(data).forEach((key) => delete data[key]); };
      if (prop === 'key') return (index) => Object.keys(data)[index] ?? null;
      if (prop === 'length') return Object.keys(data).length;
      return data[prop];
    },
    set: (target, prop, value) => { data[prop] = String(value); return true; },
    deleteProperty: (target, prop) => { delete data[prop]; return true; }
  });
}

function extractFunction(source, signature, closing) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`missing function: ${signature}`);
  const end = source.indexOf(closing, start);
  if (end < 0) throw new Error(`missing closing brace for: ${signature}`);
  return source.slice(start, end + closing.length);
}

function loadSettingsHelpers(storage) {
  const phoneStorage = {
    result: {
      saveCharacters(roles) {
        storage.setItem('ai_custom_characters', JSON.stringify(roles));
        return { ok: true };
      }
    }
  };
  const context = {
    localStorage: storage,
    window: { PhoneStorage: phoneStorage },
    PhoneStorage: phoneStorage,
    ROLE_STORAGE_KEY: 'ai_custom_characters',
    roleId: 'role_1',
    JSON
  };
  const saveFn = extractFunction(settingsSource, 'function saveReplyBubbleMode(mode)', '\n  }');
  const readFn = extractFunction(settingsSource, 'function readReplyBubbleMode()', '\n  }');
  const getRoleFn = 'function getRoleById(id) {'
    + ' var raw = localStorage.getItem(ROLE_STORAGE_KEY);'
    + ' var roles = raw ? JSON.parse(raw) : [];'
    + ' var found = roles.filter(function (r) { return r && String(r.id) === String(id); })[0];'
    + ' return found || null; }';
  runInNewContext(
    `${getRoleFn}\n${saveFn}\n${readFn}\nglobalThis.__save = saveReplyBubbleMode; globalThis.__read = readReplyBubbleMode;`,
    context
  );
  return { save: context.__save, read: context.__read };
}

const fullRole = {
  id: 'role_1',
  name: '林深',
  avatar: 'data:image/png;base64,AAAA',
  avatarBg: '#EFEFEF',
  persona: '安静、克制，习惯先观察再开口。',
  tone: '语速偏慢，句子短。',
  appearanceDescription: '黑色短发，灰色针织衫。',
  styleKeywords: ['film grain', 'neutral tone'],
  worldBookIds: ['wb_city', 'wb_past'],
  memory: '用户喜欢深夜聊天。',
  npcCharacters: [{ id: 'npc_1', name: '旧友', speechStyle: '直白' }],
  lifeEvents: [{ id: 'evt_1', title: '搬家', time: '2025-03' }],
  lifeLine: { currentCity: '杭州', status: 'working' },
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  revision: 7,
  schemaVersion: 1
};

test('字段核查：缺失、空值与未知值都归一到 auto，只有显式 single 关闭多气泡', () => {
  assert.equal(policy.REPLY_BUBBLE_MAX, 5);
  assert.equal(policy.normalizeReplyBubbleMode(undefined), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode(null), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode(''), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode('auto'), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode('SINGLE'), 'single');
  assert.equal(policy.normalizeReplyBubbleMode('multi'), 'auto');
});

test('老角色基线：不传模式时与显式 auto 的拆分结果逐字一致（1/2/3/5 段）', () => {
  const cases = [
    '嗯。',
    '晚上好\n\n今天有点累',
    '先别急\n\n我在看\n\n等我一下',
    '一\n\n二\n\n三\n\n四\n\n五'
  ];
  cases.forEach((input) => {
    const legacy = policy.parseReplyContent(input);
    const auto = policy.parseReplyContent(input, 'auto');
    assert.deepEqual(auto.bubbles, legacy.bubbles);
    assert.deepEqual(auto.translations, legacy.translations);
    assert.deepEqual(auto.narrations, legacy.narrations);
  });
});

test('短文本不会被机械切分：标点、空格、单句都保持 1 条', () => {
  ['你好。', '好。', '嗯……好。', '在吗，今天过得怎么样？', '  OK  '].forEach((input) => {
    const result = policy.parseReplyContent(input, 'auto');
    assert.equal(result.bubbles.length, 1);
    assert.equal(result.bubbles[0], input.trim());
  });
});

test('自然多气泡：2–3 段保持原顺序，不重复、不合并', () => {
  const result = policy.parseReplyContent('第一句\n\n第二句\n\n第三句', 'auto');
  assert.deepEqual(Array.from(result.bubbles), ['第一句', '第二句', '第三句']);
  assert.equal(new Set(Array.from(result.bubbles)).size, 3);
});

test('5 条上限：6 段时第 5 条合并溢出内容，正文不丢失', () => {
  const segments = ['一', '二', '三', '四', '五', '六'];
  const result = policy.parseReplyContent(segments.join('\n\n'), 'auto');
  const bubbles = Array.from(result.bubbles);
  assert.equal(bubbles.length, 5);
  assert.deepEqual(bubbles.slice(0, 4), segments.slice(0, 4));
  assert.equal(bubbles[4], '五\n六');
  assert.equal(bubbles.join('\n'), segments.join('\n'));
  assert.equal(bubbles.join('\n').split('六').length - 1, 1);
});

test('恰好 5 段时不被合并', () => {
  const result = policy.parseReplyContent('一\n\n二\n\n三\n\n四\n\n五', 'auto');
  const bubbles = Array.from(result.bubbles);
  assert.equal(bubbles.length, 5);
  assert.deepEqual(bubbles, ['一', '二', '三', '四', '五']);
});

test('single 模式：多段合并为 1 条，正文与译文都不丢', () => {
  const result = policy.parseReplyContent('第一段[中译:first]\n\n第二段[中译:second]', 'single');
  assert.equal(result.bubbles.length, 1);
  assert.equal(result.bubbles[0], '第一段\n第二段');
  assert.deepEqual(Array.from(result.translations), ['first\nsecond']);
});

test('译文与气泡在合并后仍一一对齐', () => {
  const result = policy.parseReplyContent('一[中译:a]\n\n二[中译:b]\n\n三[中译:c]', 'auto');
  assert.equal(result.bubbles.length, 3);
  assert.deepEqual(Array.from(result.translations), ['a', 'b', 'c']);
});

test('设置保存 → 重新读取：replyBubbleMode=single 持久化，其余字段一个不丢', () => {
  const legacyRole = Object.assign({}, fullRole);
  const storage = makeLocalStorage({ ai_custom_characters: JSON.stringify([legacyRole]) });
  const helpers = loadSettingsHelpers(storage);

  assert.equal(helpers.read(), 'auto');
  assert.ok(helpers.save('single'), '保存应成功');

  const after = JSON.parse(storage.getItem('ai_custom_characters'))[0];
  assert.equal(after.replyBubbleMode, 'single');
  const expected = Object.assign({}, legacyRole, { replyBubbleMode: 'single' });
  assert.deepEqual(after, expected);

  // 模拟刷新后重新读取
  const reloaded = loadSettingsHelpers(storage);
  assert.equal(reloaded.read(), 'single');
});

test('切回 auto 也持久化；非目标角色完全不受影响', () => {
  const otherRole = Object.assign({}, fullRole, { id: 'role_2', name: '另一个角色' });
  const storage = makeLocalStorage({
    ai_custom_characters: JSON.stringify([Object.assign({}, fullRole, { replyBubbleMode: 'single' }), otherRole])
  });
  const helpers = loadSettingsHelpers(storage);

  assert.ok(helpers.save('auto'));
  const roles = JSON.parse(storage.getItem('ai_custom_characters'));
  assert.equal(roles[0].replyBubbleMode, 'auto');
  assert.deepEqual(roles[1], otherRole);
});

test('新建角色写入 auto；编辑老角色不覆盖已存模式', () => {
  assert.match(charactersSource, /replyBubbleMode: 'auto'/);
  const loadAnchor = charactersSource.indexOf('const roles = loadRoles();');
  const editStart = charactersSource.indexOf('if (roleId) {', loadAnchor);
  const editEnd = charactersSource.indexOf('} else {', editStart);
  assert.ok(loadAnchor >= 0 && editStart > loadAnchor && editEnd > editStart, '应能定位编辑分支');
  const editBlock = charactersSource.slice(editStart, editEnd);
  assert.ok(!editBlock.includes('replyBubbleMode'), '编辑老角色不得重置 replyBubbleMode');
});

test('备份兼容：快照包含字段，恢复后字段与其它属性全部原样', () => {
  const role = Object.assign({}, fullRole, { replyBubbleMode: 'single' });
  const chatHistory = JSON.stringify([{ role: 'assistant', text: '第一句\n\n第二句', time: 1700000002000 }]);
  const storage = makeLocalStorage({
    ai_custom_characters: JSON.stringify([role]),
    'chat_history_role_1': chatHistory,
    api_settings: JSON.stringify({ key: 'secret' }),
    api_call_logs: JSON.stringify([{ id: 1 }])
  });

  const snapshotSource = extractFunction(backupSource, 'function snapshot(dropCaches, dropSecrets)', '\n    }');
  const excludeDecl = backupSource.match(/var EXCLUDE_KEYS = [^\n]+;/)[0];
  const secretDecl = backupSource.match(/var SECRET_KEYS = [^\n]+;/)[0];
  const context = { localStorage: storage, JSON, Object, Array };
  runInNewContext(`${excludeDecl}\n${secretDecl}\n${snapshotSource}\nglobalThis.__snapshot = snapshot;`, context);
  const snapshot = context.__snapshot;

  const exported = snapshot(true, true);
  assert.ok(exported.ai_custom_characters.includes('replyBubbleMode'));
  assert.deepEqual(JSON.parse(exported.ai_custom_characters), [role]);
  assert.equal(exported['chat_history_role_1'], chatHistory);
  assert.equal(exported.api_settings, undefined, '敏感凭据默认不导出');
  assert.equal(exported.api_call_logs, undefined, '临时日志不导出');

  // 模拟导出文件落盘 → 清空 → 导入写回
  const serialized = JSON.stringify({ data: exported });
  storage.clear();
  const parsed = JSON.parse(serialized).data;
  Object.keys(parsed).forEach((key) => storage.setItem(key, parsed[key]));

  const restoredRoles = JSON.parse(storage.getItem('ai_custom_characters'));
  assert.deepEqual(restoredRoles, [role]);
  assert.equal(restoredRoles[0].replyBubbleMode, 'single');
  assert.deepEqual(restoredRoles[0].npcCharacters, fullRole.npcCharacters);
  assert.deepEqual(restoredRoles[0].styleKeywords, fullRole.styleKeywords);
});

test('聊天记录整条往返：气泡顺序正确、每条恰好出现一次', () => {
  const replyText = '第一句\n\n第二句\n\n第三句';
  const storage = makeLocalStorage({
    'chat_history_role_1': JSON.stringify([{ role: 'assistant', text: replyText, time: 1700000002000 }])
  });

  // 模拟刷新后从聊天记录读取并重新解析
  const history = JSON.parse(storage.getItem('chat_history_role_1'));
  assert.equal(history.length, 1);
  const parsed = policy.parseReplyContent(history[0].text, 'auto');
  const bubbles = Array.from(parsed.bubbles);
  assert.deepEqual(bubbles, ['第一句', '第二句', '第三句']);
  bubbles.forEach((bubble) => {
    assert.equal(bubbles.filter((item) => item === bubble).length, 1);
    assert.ok(replyText.includes(bubble));
  });
});

test('聊天页接线：读角色字段、按模式解析、提示词与 fallback 同步', () => {
  assert.match(detailSource, /function getActiveReplyBubbleMode\(\)/);
  assert.match(detailSource, /currentCharacter\.replyBubbleMode/);
  assert.match(detailSource, /parseReplyContent\(raw, getActiveReplyBubbleMode\(\)\)/);
  assert.match(detailSource, /本轮只输出一条完整消息，不要用空行分隔多个气泡/);
  assert.match(detailSource, /单次回复最多 5 条/);
  assert.match(detailSource, /bubbles\.length > 5/);
});

test('设置页接线：复用 ai_custom_characters，不新增独立存储键', () => {
  assert.match(settingsSource, /function saveReplyBubbleMode\(mode\)/);
  assert.match(settingsSource, /target\.replyBubbleMode = mode === 'single' \? 'single' : 'auto'/);
  assert.match(settingsSource, /var ROLE_STORAGE_KEY = 'ai_custom_characters'/);
  assert.ok(!/localStorage\.setItem\('chat_reply_bubble/.test(settingsSource));
});
