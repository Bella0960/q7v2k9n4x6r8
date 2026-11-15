import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../chat/chat/js/chat-fanwai.js', import.meta.url), 'utf8');
function mount() {
  const window = {};
  vm.runInNewContext(script, { window, document: undefined, console });
  return window;
}

test('versioned plugin API safely adds a template without replacing built-in templates', () => {
  const window = mount();
  const registry = window.MAOMAOFanwai;
  const core = window.MAOMAOFanwaiCore;
  assert.equal(registry.version, '1.1');
  assert.equal(core.templates.length, 6);
  assert.equal(registry.registerTemplate({
    id: 'rainyday', name: '雨天篇', subtitle: '雨后的路口', english: 'Rainy afternoon',
    mood: '天气渐渐放晴', scenario: '雨天聊天', target: 40
  }), true);
  assert.equal(core.templates.length, 7);
  assert.equal(core.templates[6].id, 'rainyday');
  assert.equal(core.templates[6].target, 40);
  assert.equal(registry.registerTemplate({ id: 'rainyday', name: '重名', scenario: '重复' }), false);
  assert.equal(registry.registerTemplate({ id: '../bad', name: '危险', scenario: '无效 ID' }), false);
  assert.equal(registry.registerTemplate({ id: 'bad' }), false);
  assert.equal(registry.listTemplates().length, 7);
  assert.equal(Object.isFrozen(registry.listTemplates()[0]), true);
});

test('plugin events emit metadata only and can unsubscribe', () => {
  const window = mount();
  const received = [];
  const unsubscribe = window.MAOMAOFanwai.on('templates:changed', event => received.push(event.count));
  window.MAOMAOFanwai.registerTemplate({ id: 'rainyday', name: '雨天篇', scenario: '下雨' });
  assert.deepEqual(received, [7]);
  unsubscribe();
  window.MAOMAOFanwai.registerTemplate({ id: 'snowday', name: '雪天篇', scenario: '下雪' });
  assert.deepEqual(received, [7]);
});

test('no mainline memory is read unless a specific story opted in', async () => {
  const window = mount();
  const core = window.MAOMAOFanwaiCore;
  let reads = 0;
  assert.equal(core.registerContextProvider({
    id: 'world-snapshot', label: '世界书摘要',
    read: ({ character }) => {
      reads++;
      assert.equal(Object.isFrozen(character), true);
      assert.equal(character.id, 'role-1');
      return '只读世界书设定';
    }
  }), true);
  assert.equal(core.registerContextProvider({
    id: 'world-snapshot', label: '重复', read: () => 'bad'
  }), false);
  const character = { id: 'role-1', name: '小云', persona: '话少', memory: '主线记忆：曾经一起旅行' };
  const user = { nickname: '玩家' };
  const episode = { scenario: '聊天', target: 80, messages: [], contextIds: [] };
  assert.equal(await core.resolveContexts(episode, character, user), '');
  assert.equal(reads, 0);
  const baselinePrompt = core.episodePrompt(episode, character, user, 12);
  assert.doesNotMatch(baselinePrompt, /一起旅行/);
  assert.match(baselinePrompt, /话少/);
  episode.contextIds = ['character-memory', 'world-snapshot'];
  const extra = await core.resolveContexts(episode, character, user);
  assert.match(extra, /一起旅行/);
  assert.match(extra, /只读世界书设定/);
  assert.equal(reads, 1);
  const augmentedPrompt = core.episodePrompt(episode, character, user, 12, extra);
  assert.match(augmentedPrompt, /背景参考，只读/);
  assert.match(augmentedPrompt, /一起旅行/);
  assert.doesNotMatch(script, /saveMessages\s*\(|sendMsg\s*\(|chat_history_/);
});

test('plugin context failures are contained and never abort the episode', async () => {
  const window = mount();
  const core = window.MAOMAOFanwaiCore;
  core.registerContextProvider({ id: 'broken', label: '测试', read: () => { throw new Error('故障'); } });
  const extra = await core.resolveContexts({ contextIds: ['broken'] }, { id: 'role-1', name: '小云', memory: '原始记忆' }, {});
  assert.equal(extra, '');
});


test('only opted-in, confirmed memories of the selected role can enter side-story prompts', async () => {
  const window = mount();
  const core = window.MAOMAOFanwaiCore;
  let reads = 0;
  window.MemoryRecall = {
    getMemories(id) {
      reads++;
      assert.equal(id, 'role-1');
      return [
        { sourceRoleId: 'role-1', content: '确认记忆：一起逛书店', status: 'confirmed', importance: 5 },
        { sourceRoleId: 'role-1', content: '待确认草稿：不应出现', status: 'pending', importance: 5 },
        { sourceRoleId: 'role-2', content: '别人的记忆：不应出现', status: 'confirmed', importance: 5 },
        { sourceRoleId: 'role-1', text: '固定纪念日：初雪', status: 'fixed', importance: 4 }
      ];
    }
  };
  const character = { id: 'role-1', name: '小云', persona: '温和', memory: '角色备忘：喜欢晴天' };
  const user = { nickname: '小月' };
  assert.equal(await core.resolveContexts({ contextIds: [] }, character, user), '');
  assert.equal(reads, 0);
  const context = await core.resolveContexts({ contextIds: ['character-memory'] }, character, user);
  assert.equal(reads, 1);
  assert.match(context, /一起逛书店/);
  assert.match(context, /喜欢晴天/);
  assert.match(context, /初雪/);
  assert.doesNotMatch(context, /待确认草稿/);
  assert.doesNotMatch(context, /别人的记忆/);
});
