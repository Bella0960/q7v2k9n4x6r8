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
  const normalizeFn = extractFunction(settingsSource, 'function normalizeReplyBubbleMode(value)', '\n  }');
  const getRoleFn = 'function getRoleById(id) {'
    + ' var raw = localStorage.getItem(ROLE_STORAGE_KEY);'
    + ' var roles = raw ? JSON.parse(raw) : [];'
    + ' var found = roles.filter(function (r) { return r && String(r.id) === String(id); })[0];'
    + ' return found || null; }';
  runInNewContext(
    `${normalizeFn}\n${getRoleFn}\n${saveFn}\n${readFn}\nglobalThis.__save = saveReplyBubbleMode; globalThis.__read = readReplyBubbleMode;`,
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

test('字段核查：缺失、空值与未知值都归一到 auto；single/multi 各自生效', () => {
  assert.equal(policy.REPLY_BUBBLE_MAX, 5);
  assert.equal(policy.normalizeReplyBubbleMode(undefined), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode(null), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode(''), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode('auto'), 'auto');
  assert.equal(policy.normalizeReplyBubbleMode('SINGLE'), 'single');
  assert.equal(policy.normalizeReplyBubbleMode('multi'), 'multi');
  assert.equal(policy.normalizeReplyBubbleMode(' MULTI '), 'multi');
  assert.equal(policy.normalizeReplyBubbleMode('weird'), 'auto');
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

test('缺少 replyBubbleMode 的老角色：6 段以上不设上限；显式 auto 仍最多 5 条', () => {
  const segments = ['一', '二', '三', '四', '五', '六', '七'];
  const raw = segments.join('\n\n');

  const legacy = policy.parseReplyContent(raw, 'legacy');
  assert.deepEqual(Array.from(legacy.bubbles), segments);

  const explicitAuto = policy.parseReplyContent(raw, 'auto');
  assert.equal(explicitAuto.bubbles.length, 5);
  assert.deepEqual(Array.from(explicitAuto.bubbles.slice(0, 4)), segments.slice(0, 4));
  assert.equal(explicitAuto.bubbles[4], '五\n六\n七');

  const legacyMessages = policy.buildReplyMessages(raw, 'legacy', { time: 1000, turnId: 'legacy-turn' });
  assert.equal(legacyMessages.length, 7);
  assert.deepEqual(Array.from(legacyMessages, (message) => message.text), segments);
  assert.ok(legacyMessages.every((message) => message.turnId === 'legacy-turn'));

  const autoMessages = policy.buildReplyMessages(raw, 'auto', { time: 2000, turnId: 'auto-turn' });
  assert.equal(autoMessages.length, 5);
  assert.equal(autoMessages[4].text, '五\n六\n七');

  const storedLegacy = policy.getMessageBubbles({ mid: 'm-legacy', text: raw });
  assert.equal(storedLegacy.bubbles.length, 7);
  assert.deepEqual(Array.from(storedLegacy.bubbles, (bubble) => bubble.text), segments);

  const editedLegacyText = policy.replaceBubbleInText(raw, 6, '七·已编辑');
  const editedLegacy = policy.parseReplyContent(editedLegacyText, 'legacy');
  assert.equal(editedLegacy.bubbles.length, 7);
  assert.equal(editedLegacy.bubbles[6], '七·已编辑');

  const removedLegacyText = policy.removeBubbleFromText(raw, 6);
  const removedLegacy = policy.parseReplyContent(removedLegacyText, 'legacy');
  assert.deepEqual(Array.from(removedLegacy.bubbles), segments.slice(0, 6));

  const translatedLegacyText = policy.applyBubbleTranslation(raw, 6, 'seventh translation');
  const translatedLegacy = policy.parseReplyContent(translatedLegacyText, 'legacy');
  assert.equal(translatedLegacy.bubbles.length, 7);
  assert.equal(translatedLegacy.translations[6], 'seventh translation');

  // 8 段：老角色同样不封顶；显式 auto 仍把第 5 段之后的正文并入第 5 条。
  const eightSegments = ['一', '二', '三', '四', '五', '六', '七', '八'];
  const eightRaw = eightSegments.join('\n\n');
  const legacyEight = policy.parseReplyContent(eightRaw, 'legacy');
  assert.equal(legacyEight.bubbles.length, 8);
  assert.deepEqual(Array.from(legacyEight.bubbles), eightSegments);
  const autoEight = policy.parseReplyContent(eightRaw, 'auto');
  assert.equal(autoEight.bubbles.length, 5);
  assert.equal(autoEight.bubbles[4], '五\n六\n七\n八');
  assert.equal(Number(Array.from(autoEight.bubbles).join('\n').split('八').length - 1), 1);
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

// 本轮续修：三模式、气泡级身份、逐条持久化、老记录兼容、未读与上下文。
const contextWindow = {};
runInNewContext(read('shared/js/phone/chat-context-policy.js'), { window: contextWindow, globalThis: {} });
const contextPolicy = contextWindow.ChatContextPolicy;

test('三种模式的实际输出差异：single=1 条，auto 保留单换行，multi 按单换行拆', () => {
  const raw = '第一句\n第二句\n\n第三句';
  const single = policy.buildReplyMessages(raw, 'single', { time: 1000, turnId: 't1' });
  assert.equal(single.length, 1);
  assert.equal(single[0].text, '第一句\n第二句\n第三句');

  const auto = policy.buildReplyMessages(raw, 'auto', { time: 1000, turnId: 't1' });
  assert.equal(auto.length, 2);
  assert.deepEqual(Array.from(auto, (m) => m.text), ['第一句\n第二句', '第三句']);

  const multi = policy.buildReplyMessages(raw, 'multi', { time: 1000, turnId: 't1' });
  assert.equal(multi.length, 3);
  assert.deepEqual(Array.from(multi, (m) => m.text), ['第一句', '第二句', '第三句']);
});

test('同一毫秒内不同回复轮次的气泡 ID 不冲突，且可安全解析', () => {
  const first = policy.buildReplyMessages('第一句\n第二句', 'multi', {
    time: 3000,
    turnId: 'turn/a#one'
  });
  const second = policy.buildReplyMessages('另一轮第一句\n另一轮第二句', 'multi', {
    time: 3000,
    turnId: 'turn/b#two'
  });

  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  const allIds = [...first, ...second].map((message) => message.mid);
  assert.equal(new Set(allIds).size, 4, '不同回复轮次即使同毫秒完成，也必须有不同 mid');
  assert.ok(allIds.every((id) => !id.includes('#')), '轮次 ID 中的 # 必须编码，不能混入旧版气泡分隔符');

  first.forEach((message) => {
    // Policy helpers execute in a VM realm; normalize the result into this
    // test realm before strict comparison (Node 24 checks prototypes).
    const parsed = policy.parseBubbleId(message.mid);
    assert.deepEqual({ mid: parsed.mid, index: parsed.index }, { mid: message.mid, index: 0 });
  });

  const repeated = policy.buildReplyMessages('第一句\n第二句', 'multi', {
    time: 3000,
    turnId: 'turn/a#one'
  });
  assert.deepEqual(
    Array.from(repeated, (message) => message.mid),
    Array.from(first, (message) => message.mid),
    '同一轮次的相同输入应生成可复现的消息身份'
  );
});

test('逐气泡落库：身份唯一，写入 chat_history_* 后重读（模拟刷新）身份与文本不变', () => {
  const messages = policy.buildReplyMessages(
    '<narratage>夜色沉了下来</narratage>\n\n第一句\n\n第二句',
    'auto',
    { time: 2000, turnId: 'turn-1', voiceMode: 'online' }
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0].turnId, 'turn-1');
  assert.equal(messages[0].bubbleIndex, 0);
  assert.equal(messages[1].bubbleIndex, 1);
  assert.equal(messages[0].bubbleCount, 2);
  assert.ok(messages[0].text.startsWith('<narratage>夜色沉了下来</narratage>'));
  assert.equal(messages[1].text, '第二句');

  const storage = makeLocalStorage();
  storage.setItem('chat_history_role_1', JSON.stringify(messages));
  const loaded = JSON.parse(storage.getItem('chat_history_role_1'));
  const ids = loaded.map((m) => policy.bubbleIdFor(m.mid, 0, 1));
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, '每个气泡身份必须唯一');
  assert.deepEqual(ids, [loaded[0].mid, loaded[1].mid], '单气泡消息身份等于自身 mid');

  const reloaded = loadSettingsHelpers(storage); // 触发一次独立的重新读取环境
  const again = JSON.parse(storage.getItem('chat_history_role_1')).map((m) => policy.bubbleIdFor(m.mid, 0, 1));
  assert.deepEqual(again, ids, '刷新后同一气泡身份不变');
  assert.ok(reloaded.read() === 'auto');
});

test('老记录兼容：一条消息多气泡仍解析为多气泡，身份 mid#index 且刷新稳定', () => {
  const legacy = { mid: 'm1700000000000', role: 'assistant', text: '甲\n\n乙\n\n丙', time: 1700000000000 };
  const group = policy.getMessageBubbles(legacy);
  assert.equal(group.bubbles.length, 3);
  assert.deepEqual(Array.from(group.bubbles, (b) => b.id), ['m1700000000000#0', 'm1700000000000#1', 'm1700000000000#2']);
  assert.deepEqual(Array.from(group.bubbles, (b) => b.text), ['甲', '乙', '丙']);
  // 重新解析（模拟刷新）身份与文本完全一致
  const again = policy.getMessageBubbles(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(Array.from(again.bubbles, (b) => b.id), Array.from(group.bubbles, (b) => b.id));
});

test('引用/编辑/删除/翻译只作用于目标气泡，不误伤兄弟气泡', () => {
  const legacy = [{ mid: 'm1', role: 'assistant', text: '甲\n\n乙\n\n丙', time: 1 }];
  assert.equal(policy.resolveBubble(legacy, 'm1#1').text, '乙');
  assert.equal(policy.resolveBubble(legacy, 'm1#1').count, 3);

  const editedText = policy.replaceBubbleInText(legacy[0].text, 1, '乙已改');
  const edited = policy.getMessageBubbles({ mid: 'm1', text: editedText });
  assert.deepEqual(Array.from(edited.bubbles, (b) => b.text), ['甲', '乙已改', '丙']);

  const removed = policy.removeBubblesFromHistory(legacy, ['m1#1']);
  assert.equal(removed.length, 1);
  assert.deepEqual(Array.from(policy.getMessageBubbles(removed[0]).bubbles, (b) => b.text), ['甲', '丙']);

  const translatedText = policy.applyBubbleTranslation(legacy[0].text, 1, '第二句译文');
  const translated = policy.getMessageBubbles({ mid: 'm1', text: translatedText });
  assert.deepEqual(Array.from(translated.bubbles, (b) => b.text), ['甲', '乙', '丙']);
  assert.equal(translated.bubbles[1].translation, '第二句译文');
  assert.equal(translated.bubbles[0].translation, '');

  // 新存储：每个气泡一条消息，删一条只删该消息
  const fresh = [
    { mid: 'a', text: '甲', turnId: 't', bubbleCount: 1 },
    { mid: 'b', text: '乙', turnId: 't', bubbleCount: 1 }
  ];
  assert.deepEqual(Array.from(policy.removeBubblesFromHistory(fresh, ['b']), (m) => m.mid), ['a']);
});

test('重生成按整轮删除：新记录同 turnId 全部移除；老记录只删目标消息', () => {
  const fresh = [
    { mid: 'a', turnId: 't1', bubbleCount: 1 },
    { mid: 'b', turnId: 't1', bubbleCount: 1 },
    { mid: 'c', turnId: 't2', bubbleCount: 1 }
  ];
  assert.deepEqual(policy.removeTurnFromHistory(fresh, 'b').map((m) => m.mid), ['c']);
  const legacy = [{ mid: 'l1', text: '一\n\n二' }, { mid: 'l2', text: '三' }];
  assert.deepEqual(policy.removeTurnFromHistory(legacy, 'l1#1').map((m) => m.mid), ['l2']);
});

test('未读按 turn 去重：一轮 3 气泡算 1 条未读；老记录仍逐条计数', () => {
  const notifierSource = read('shared/js/chat-notifier.js');
  const safeGet = extractFunction(notifierSource, 'function safeGet(key)', '\n    }');
  const safeJsonParse = extractFunction(notifierSource, 'function safeJsonParse(s)', '\n    }');
  const readHistory = extractFunction(notifierSource, 'function readHistory(roleId)', '\n    }');
  const unreadOf = extractFunction(notifierSource, 'function unreadOf(contact)', '\n    }');
  const storage = makeLocalStorage({
    'chat_lastread_role_1': '100',
    'chat_history_role_1': JSON.stringify([
      { role: 'assistant', text: '一', time: 101, turnId: 't1' },
      { role: 'assistant', text: '二', time: 102, turnId: 't1' },
      { role: 'assistant', text: '三', time: 103, turnId: 't1' },
      { role: 'assistant', text: '老记录一', time: 104 },
      { role: 'assistant', text: '老记录二', time: 105 }
    ])
  });
  const context = { localStorage: storage, JSON, Object, Array, Number };
  runInNewContext(
    `${safeGet}\n${safeJsonParse}\n${readHistory}\n${unreadOf}\nglobalThis.__unread = unreadOf;`,
    context
  );
  const result = context.__unread({ id: 'role_1' });
  assert.equal(result.count, 3, '一轮 3 气泡算 1 条 + 2 条老记录');
  assert.equal(result.newest.text, '老记录二');
});

test('上下文拼接：同 turnId 合并回一条 assistant；老记录不受影响', () => {
  const history = [
    { role: 'user', text: '在吗', time: 1 },
    { role: 'assistant', text: '在', time: 2, turnId: 't1' },
    { role: 'assistant', text: '怎么了', time: 3, turnId: 't1' },
    { role: 'assistant', text: '老记录回复', time: 4 }
  ];
  const api = contextPolicy.mapHistoryToApiMessages(history, null, {});
  const mapped = Array.from(api, (m) => ({ role: m.role, content: m.content }));
  // 末尾 "(继续)" 是既有的历史收尾保护，不属于本轮回复内容。
  assert.equal(mapped[0].content, '在吗');
  assert.equal(mapped[1].role, 'assistant');
  assert.equal(mapped[1].content, '在\n\n怎么了');
  assert.equal(mapped[2].content, '老记录回复');
  assert.equal(mapped.length, 4);

  const recent = contextPolicy.selectRecentHistory([
    { role: 'user', text: '问', time: 1 },
    { role: 'assistant', text: '一', time: 2, turnId: 't2' },
    { role: 'assistant', text: '二', time: 3, turnId: 't2' },
    { role: 'user', text: '再问', time: 4 }
  ], 2);
  assert.equal(recent.length, 3, '窗口落在一轮回复中间时向前补齐整轮');
});

test('设置页三模式：multi 可保存并刷新读取；非法值回落 auto；其他字段不变', () => {
  const storage = makeLocalStorage({ ai_custom_characters: JSON.stringify([fullRole]) });
  const helpers = loadSettingsHelpers(storage);
  assert.equal(helpers.read(), 'auto');
  assert.ok(helpers.save('multi'));
  const after = JSON.parse(storage.getItem('ai_custom_characters'))[0];
  assert.equal(after.replyBubbleMode, 'multi');
  const expected = Object.assign({}, fullRole, { replyBubbleMode: 'multi' });
  assert.deepEqual(after, expected);
  const reloaded = loadSettingsHelpers(storage);
  assert.equal(reloaded.read(), 'multi');
  assert.ok(reloaded.save('garbage'));
  assert.equal(JSON.parse(storage.getItem('ai_custom_characters'))[0].replyBubbleMode, 'auto');
});

test('聊天页接线：缺字段走 legacy、按模式生成、已存内容不套生成上限', () => {
  assert.match(detailSource, /function getActiveReplyBubbleMode\(\)/);
  assert.match(detailSource, /hasOwnProperty\.call\(currentCharacter, 'replyBubbleMode'\)/);
  assert.match(detailSource, /currentCharacter\.replyBubbleMode/);
  assert.match(detailSource, /buildReplyMessages\(fullText, getActiveReplyBubbleMode\(\)/);
  assert.match(detailSource, /parseReplyContent\(raw, 'legacy'\)/);
  // 历史展示不得套用 5 条上限：上限只在生成侧（policy 的 legacyUncapped 守卫）生效。
  assert.ok(!/bubbles\.length > 5/.test(detailSource), '已存内容渲染不得截断到 5 条');
  assert.match(policySource, /!legacyUncapped && bubbles\.length > REPLY_BUBBLE_MAX/);
  assert.match(detailSource, /本轮只输出一条完整消息，不要用空行分隔多个气泡/);
  assert.match(detailSource, /本轮必须拆成 2–5 条连续消息/);
  assert.match(detailSource, /单次回复最多 5 条/);
  assert.match(detailSource, /不设置固定条数上限/);
});

test('设置页接线：复用 ai_custom_characters，三选一模式，不新增独立存储键', () => {
  assert.match(settingsSource, /function saveReplyBubbleMode\(mode\)/);
  assert.match(settingsSource, /target\.replyBubbleMode = normalized/);
  assert.match(settingsSource, /var ROLE_STORAGE_KEY = 'ai_custom_characters'/);
  assert.match(settingsSource, /data-mode="single"/);
  assert.match(settingsSource, /data-mode="auto"/);
  assert.match(settingsSource, /data-mode="multi"/);
  assert.ok(!/localStorage\.setItem\('chat_reply_bubble/.test(settingsSource));
});
