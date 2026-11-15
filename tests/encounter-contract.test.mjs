import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineSource = fs.readFileSync(new URL('../encounter/encounter-engine.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../encounter/encounter.html', import.meta.url), 'utf8');
const managerSource = fs.readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const charactersPage = fs.readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const desktopSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const chatListSource = fs.readFileSync(new URL('../chat/chat/chat.html', import.meta.url), 'utf8');

function harness(seed = {}) {
  const map = new Map(Object.entries(seed));
  const localStorage = {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
  const window = {localStorage, dispatchEvent() {}};
  vm.runInNewContext(engineSource, {window, Math, Set, Uint32Array, Date, JSON, String, Array, Object, Number, CustomEvent: class {}});
  return {api:window.MAOMAOEncounter,map,localStorage};
}

test('邂逅引擎保持离线，不需要 API，并为新角色生成唯一姓名', () => {
  const h = harness({'ai_custom_characters':JSON.stringify([{id:'original',name:'沈知序'}])});
  const seen = new Set(['沈知序']);
  for (let i = 0; i < 35; i++) {
    const r = h.api.generate();
    assert.equal(r.ok, true, r.error);
    assert.ok(!seen.has(r.value.name), '原角色或同轮抽卡姓名不得碰撞');
    seen.add(r.value.name);
    assert.ok(r.value.age >= 21);
    assert.ok(['男','女'].includes(r.value.gender));
    assert.ok(['年上感','年下感','同龄感','自由发展'].includes(r.value.relationVibe));
    assert.ok(r.value.species !== '哥布林');
    assert.ok(['普通','特别邂逅'].includes(r.value.rarity));
    assert.ok(r.value.id.startsWith('enc_'));
  }
});

test('姓名规整能识别空格、宽字符、标点造成的假不同', () => {
  const h = harness();
  assert.equal(h.api.normalizeName('林　野'),h.api.normalizeName('林野'));
  assert.equal(h.api.normalizeName('Ａster·Vale'), h.api.normalizeName('AsterVale'));
});

test('候选保存与删除是显式成功后更新，不会碰正式角色库', () => {
  const h = harness({'ai_custom_characters':'[{"id":"role_1","name":"既有角色"}]'});
  const person = h.api.generate().value;
  const saved = h.api.saveCandidate(person);
  assert.equal(saved.ok,true);
  assert.equal(h.api.getCandidates().value.length,1);
  assert.equal(h.api.saveCandidate(person).value.length,1);
  assert.equal(JSON.parse(h.localStorage.getItem('ai_custom_characters'))[0].name,'既有角色');
  assert.equal(h.api.removeCandidate(person.id).ok,true);
  assert.equal(h.api.getCandidates().value.length,0);
});

test('收藏时再次与正式角色库查重，绝不覆盖现有姓名', () => {
  const h = harness();
  const person = h.api.generate().value;
  h.localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'role_1',name:person.name}]));
  const saved = h.api.saveCandidate(person);
  assert.equal(saved.ok,false);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),null);
});

test('损坏的候选收藏保持原文，不得静默覆盖', () => {
  const raw = '{broken';
  const h = harness({'maomao_encounter_candidates_v1':raw});
  const generated=h.api.generate();
  assert.equal(generated.ok,false);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),raw);
});

test('存储空间不足时不显示收藏成功', () => {
  const h = harness();
  const card=h.api.generate().value;
  h.localStorage.setItem = function() {throw new Error('quota');};
  assert.equal(h.api.saveCandidate(card).ok,false);
});

test('隐藏偏好允许按人物性别抽取，绝不自动调用生成 API', () => {
  const h = harness();
  assert.equal(h.api.savePreferences({gender:'女'}).ok,true);
  for (let i=0;i<12;i++) assert.equal(h.api.generate().value.gender,'女');
  assert.equal(h.api.savePreferences({gender:'男'}).ok,true);
  for (let i=0;i<12;i++) assert.equal(h.api.generate().value.gender,'男');
});

test('相似度是偏好，不强制排除喜爱的类型', () => {
  const h = harness();
  assert.equal(h.api.savePreferences({similarity:'多来喜欢的类型'}).ok,true);
  assert.equal(h.api.getPreferences().similarity,'多来喜欢的类型');
  const card=h.api.generate();
  assert.equal(card.ok,true);
});

test('扩展点可以注册与撤销，不影响默认抽卡', () => {
  const h=harness();
  const unregister=h.api.registerCardDecorator(function(){return {badge:'custom-event'};});
  assert.equal(h.api.generate().value.badge,'custom-event');
  unregister();
  assert.equal(h.api.generate().value.badge,undefined);
});

test('角色库已有原生编辑器、邂逅候选交接、仅接受 MAOMAO JSON', () => {
  assert.match(charactersPage,/encounter-engine\.js/);
  assert.match(managerSource,/openEncounterCandidateFromQuery/);
  assert.match(managerSource,/MAOMAOEncounter\.formatBrief/);
  assert.match(managerSource,/encounterOrigin/);
  assert.match(managerSource,/sourceCandidateId/);
  assert.match(managerSource,/data\.format !== 'maomao-character'/);
  assert.doesNotMatch(managerSource,/data\.char_name\s*\|\|/);
  assert.match(managerSource,/btnExportRole/);
  assert.match(managerSource,/btnExpandEncounterPersona/);
  assert.match(managerSource,/PhoneAPI\.complete/);
  assert.match(managerSource,/confirm\('完善完整人设将调用一次/);
  assert.match(managerSource,/不支持把其他平台的 JSON 角色卡作为 TXT 导入/);
  assert.match(managerSource,/saveRoles\(roles\)/);
});


test('PhoneStorage 损坏/不可用时抽卡必须停止，不能 fallback 成空角色库', () => {
  for (const errorCode of ['CORRUPT_DATA', 'DB_UNAVAILABLE', 'DB_BLOCKED']) {
    const h = harness();
    const window = {
      localStorage: h.localStorage,
      dispatchEvent() {},
      PhoneStorage: { result: { getCharacters() { return {ok: false, error: {code:errorCode}}; } } }
    };
    vm.runInNewContext(engineSource, {window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
    const result = window.MAOMAOEncounter.generate();
    assert.equal(result.ok,false, '角色读取错误必须阻断生成: '+errorCode);
  }
});

test('原角色库读取损坏时不得用空数组覆盖，且拒绝保存', () => {
  const start = managerSource.indexOf('let roleStoreReadError = false;');
  const end = managerSource.indexOf('const ROLE_AVATAR_CLEANUP_QUEUE_KEY',start);
  assert.ok(start >= 0 && end > start, '应复用当前管理器的真实读取/保存函数');
  const code = managerSource.slice(start,end);
  const key='ai_custom_characters';
  for (const stored of ['{broken','{"roles":[]}','null']) {
    const data = new Map([[key,stored]]);
    const localStorage = {
      getItem(k) { return data.has(k)?data.get(k):null; },
      setItem(k,v) { data.set(k,String(v)); },
      removeItem(k) { data.delete(k); }
    };
    const PhoneStorage = {
      result: {
        getCharacters() {return {ok:false,error:{code:'CORRUPT_DATA'}};},
        saveCharacters() {throw new Error('must not write');}
      }
    };
    const window = {PhoneStorage};
    const manager = vm.runInNewContext(code+';({loadRoles,saveRoles,isBlocked:()=>roleStoreReadError})',
      {window,PhoneStorage,localStorage,STORAGE_KEY:key,DEFAULT_ROLES:[],console});
    assert.equal(manager.loadRoles().length,0);
    assert.equal(manager.isBlocked(),true);
    assert.equal(manager.saveRoles([{id:'new'}]),false);
    assert.equal(data.get(key),stored,'读取错误时保留全部原始字节');
  }
});


test('付费 AI 人设草稿写入失败必须返回失败，不能误报已经保存', () => {
  const start=managerSource.indexOf('function persistEditorDraft(force) {');
  const end=managerSource.indexOf('function applyEditorState(state) {',start);
  assert.ok(start>=0 && end>start);
  const source=managerSource.slice(start,end);
  const status=[];
  const result=vm.runInNewContext(source+';persistEditorDraft(true)',
    {
      currentDraftKey:'maomao_character_draft_v1:new',editorOriginalState:null,
      captureEditorState:()=>({name:'保留生成的角色',persona:'已经支付并得到返回值'}),
      editorStatesEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
      localStorage:{setItem(){throw new Error('QuotaExceededError');}},
      setSaveStatus:(text,state)=>status.push({text,state}),
      Date,JSON,console
    });
  assert.equal(result,false,'空间不足时返回失败');
  assert.equal(status.at(-1).state,'error','必须告知用户需要立即复制原文');
  assert.match(status.at(-1).text,/草稿暂存失败/);
  assert.match(managerSource,/if \(!persistEditorDraft\(true\)\)/,'收费请求前必须先做存储预检');
  assert.match(managerSource,/if \(!draftSaved\)/,'收费结果不能假称已经持久化');
});

test('角色库第一次为空时可安全初始化新角色，不需要写空数组', () => {
  const start=managerSource.indexOf('let roleStoreReadError = false;');
  const end=managerSource.indexOf('const ROLE_AVATAR_CLEANUP_QUEUE_KEY',start);
  const map=new Map();
  const localStorage={getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,String(v));}};
  const PhoneStorage={result:{
    getCharacters(){return {ok:false,error:{code:'NOT_FOUND'}};},
    saveCharacters(value){localStorage.setItem('ai_custom_characters',JSON.stringify(value));return {ok:true};}
  }};
  const window={PhoneStorage};
  const manager=vm.runInNewContext(managerSource.slice(start,end)+';({loadRoles,saveRoles})',
    {window,PhoneStorage,localStorage,STORAGE_KEY:'ai_custom_characters',DEFAULT_ROLES:[],console});
  assert.equal(manager.loadRoles().length,0);
  assert.equal(map.size,0,'只读加载不应偷偷写入存储');
  assert.equal(manager.saveRoles([{id:'one',name:'自建角色'}]),true);
  assert.equal(JSON.parse(map.get('ai_custom_characters'))[0].name,'自建角色');
});


test('邂逅保存为原生角色后，现有聊天首页可直接列出该角色', () => {
  assert.match(chatListSource,/var CHARACTERS_KEY = 'ai_custom_characters'/);
  assert.match(chatListSource,/var roles = loadCharacters\(\)\.filter/);
  assert.match(chatListSource,/var rolesHTML = roles\.map/);
  assert.match(chatListSource,/chat-detail\.html\?v=.*?&id=/);
  assert.match(managerSource,/saveRoles\(roles\)/);
});

test('保存后的邂逅角色仍可以手动选择 AI 完善，不能强迫再次抽卡', () => {
  assert.match(managerSource,/const editingSavedEncounter =/);
  assert.match(managerSource,/target\.encounterOrigin && target\.encounterOrigin\.version === 1/);
  assert.match(managerSource,/if \(!activeEncounterDraftId && !editingSavedEncounter\)/);
  assert.match(managerSource,/const targetRoleId = editorRoleId/);
});

test('桌面有独立应用入口，抽卡页有可访问交互与移动端样式', () => {
  assert.match(desktopSource,/data-href="encounter\/encounter\.html"/);
  assert.match(appSource,/id="frontCard"/);
  assert.match(appSource,/pointerdown/);
  assert.match(appSource,/pointermove/);
  assert.match(appSource,/prefers-reduced-motion/);
  assert.match(appSource,/id="savedButton"/);
  assert.match(appSource,/id="moreButton"/);
  assert.doesNotMatch(appSource,/(<img[^>]+src="https:\/\/)/);
});
