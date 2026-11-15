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
const backupRegistrySource = fs.readFileSync(new URL('../settings/js/backup-modules.js', import.meta.url), 'utf8');

function harness(seed = {}) {
  const map = new Map(Object.entries(seed));
  const localStorage = {
    get length(){return map.size;},
    key(index){return [...map.keys()][index]??null;},
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
  assert.equal([...h.map.keys()].some(k=>k.startsWith('maomao_encounter_card_v2:')),false);
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


test('正式域名未注入已生效的 MAO 账号作用域时全部候选操作必须停止', () => {
  const local = new Map();
  const localStorage={
    getItem(key){return local.get(key)??null;},
    setItem(key,value){local.set(key,String(value));}
  };
  const metas={
    'meta[name="mao-account-id"]':{content:'MAO-AAAAAAAAAAAA'},
    'meta[name="mao-account-role"]':{content:'user'}
  };
  function verify(meta, scope, hostname='app.mao520.com') {
    const window={
      localStorage,location:{hostname},
      document:{querySelector(s){return meta[s]||null;}},
      __MAO_ACCOUNT_SCOPE__:scope
    };
    vm.runInNewContext(engineSource,{window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
    return window.MAOMAOEncounter;
  }
  const noIdentity=verify({},null);
  assert.equal(noIdentity.generate().ok,false);
  assert.equal(noIdentity.saveCandidate({id:'enc_x',name:'访客'}).ok,false);
  assert.equal(noIdentity.savePreferences({gender:'女'}).ok,false);
  const missingScope=verify(metas,null);
  assert.equal(missingScope.getCandidates().ok,false);
  const wrongScope=verify(metas,{accountId:'MAO-BBBBBBBBBBBB',role:'user',ready:true});
  assert.equal(wrongScope.generate().ok,false);
  assert.equal(local.size,0,'拒绝账号作用域时不得读写存储');
});

test('正式账号作用域就绪时复用原本隔离的 storage，多个账号候选互不可见', () => {
  // 模拟 PR #290 提供的账号代理，邂逅只调用作用域代理，不另造身份系统。
  const backing=new Map();
  function makeAccount(accountId) {
    const prefix='__mao_account_v1__'+encodeURIComponent(accountId)+'__';
    const localStorage={
      get length(){return [...backing.keys()].filter(k=>k.startsWith(prefix)).length;},
      key(index){return [...backing.keys()].filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length))[index]??null;},
      getItem(key){return backing.get(prefix+key)??null;},
      setItem(key,value){backing.set(prefix+key,String(value));},
      removeItem(key){backing.delete(prefix+key);}
    };
    const metas={
      'meta[name="mao-account-id"]':{content:accountId},
      'meta[name="mao-account-role"]':{content:'user'}
    };
    const window={
      localStorage,
      location:{hostname:'app.mao520.com'},
      document:{querySelector(s){return metas[s]||null;}},
      __MAO_ACCOUNT_SCOPE__:{accountId,role:'user',ready:true}
    };
    vm.runInNewContext(engineSource,{window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
    return window.MAOMAOEncounter;
  }
  const a=makeAccount('MAO-AAAAAAAAAAAA'),b=makeAccount('MAO-BBBBBBBBBBBB');
  assert.equal(a.checkAccountScope().ok,true);
  const card=a.generate().value;
  assert.equal(a.saveCandidate(card).ok,true);
  assert.equal(a.getCandidates().value.length,1);
  assert.equal(b.getCandidates().value.length,0,'其他账号不得读取 A 的候选');
  assert.equal(b.generate().ok,true,'其他账号仍应能使用其独立角色库');
  assert.ok(Array.from(backing.keys()).every(k=>k.startsWith('__mao_account_v1__MAO-AAAAAAAAAAAA__')));
});

test('损坏的抽卡偏好不得在下一次设置时被静默覆盖', () => {
  const source='{corrupt-preferences';
  const h=harness({'maomao_encounter_preferences_v1':source});
  const result=h.api.savePreferences({type:'普通相遇'});
  assert.equal(result.ok,false);
  assert.equal(h.localStorage.getItem('maomao_encounter_preferences_v1'),source);
  // 默认抽卡仍可进行，但用户必须主动修复偏好文件才能更新设置。
  assert.equal(h.api.generate().ok,true);
});

test('浏览器静默丢写时不能误报收藏/删除/偏好保存成功', () => {
  const h=harness();
  const candidate=h.api.generate().value;
  h.localStorage.setItem=()=>{}; // 浏览器或扩展悄悄忽略 setItem
  assert.equal(h.api.saveCandidate(candidate).ok,false);
  assert.equal(h.api.savePreferences({gender:'女'}).ok,false);
  assert.equal(h.api.getCandidates().value.length,0);
  // 移除被浏览器静默忽略也应被校验发现
  const normal=harness();
  const card=normal.api.generate().value;
  assert.equal(normal.api.saveCandidate(card).ok,true);
  normal.localStorage.setItem=()=>{};
  assert.equal(normal.api.removeCandidate(card.id).ok,false);
  assert.equal(normal.api.getCandidates().value.length,1);
});

test('可扩展卡片不能覆盖稳定人物 ID、版本和创建时间', () => {
  const h=harness();
  h.api.registerCardDecorator(() => ({
    id:'role_conflict',createdAt:0,schemaVersion:99,badge:'custom-arc'
  }));
  const card=h.api.generate().value;
  assert.ok(card.id.startsWith('enc_'));
  assert.equal(card.schemaVersion,1);
  assert.ok(card.createdAt>0);
  assert.equal(card.badge,'custom-arc');
});


test('人物候选与偏好包含在现有「角色」分类备份中', () => {
  const window = {};
  vm.runInNewContext(backupRegistrySource, {window,console,Array,Object,Set,String,Number,TypeError});
  const r=window.MAOMAOBackupRegistry;
  assert.equal(r.belongsTo('characters','maomao_encounter_candidates_v1'),true);
  assert.equal(r.belongsTo('characters','maomao_encounter_preferences_v1'),true);
  assert.equal(r.belongsTo('other','maomao_encounter_candidates_v1'),false);
  const saved=r.selectSnapshot('characters',{
    maomao_encounter_candidates_v1:'[{"id":"enc_example"}]',
    maomao_encounter_preferences_v1:'{"gender":"女"}',
    api_settings:'private-api-key',
    another_feature:'should-not-export'
  });
  assert.deepEqual(Object.keys(saved).sort(),['maomao_encounter_candidates_v1','maomao_encounter_preferences_v1']);
});


test('两个标签页保存不同候选不会覆盖彼此，删除其一不会删除另一位', () => {
  const map=new Map();
  function tab() {
    const localStorage={
      get length(){return map.size;},
      key(index){return [...map.keys()][index]??null;},
      getItem(key){return map.get(key)??null;},
      setItem(key,value){map.set(key,String(value));},
      removeItem(key){map.delete(key);}
    };
    const window={localStorage,dispatchEvent(){}};
    vm.runInNewContext(engineSource,{window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
    return window.MAOMAOEncounter;
  }
  const a=tab(),b=tab();
  const cardA=a.generate().value;
  let cardB=b.generate().value;
  for(let attempt=0;cardA.name===cardB.name && attempt<10;attempt++)cardB=b.generate().value;
  assert.ok(cardA.id!==cardB.id && cardA.name!==cardB.name);
  assert.equal(a.saveCandidate(cardA).ok,true);
  assert.equal(b.saveCandidate(cardB).ok,true);
  assert.equal(a.getCandidates().value.length,2);
  assert.equal(b.getCandidates().value.length,2);
  assert.equal(a.removeCandidate(cardA.id).ok,true);
  const left=b.getCandidates().value;
  assert.equal(left.length,1);
  assert.equal(left[0].id,cardB.id);
  assert.equal(b.saveCandidate(cardA).ok,false,'另一标签页不能复活已经删除的人物');
  assert.equal(a.getCandidates().value.length,1);
});

test('旧版候选数组只读兼容：新增不改旧数组，删除使用单独墓碑', () => {
  const legacyCard={id:'enc_legacy01',name:'旧候选人物',createdAt:12345,gender:'女'};
  const original=JSON.stringify([legacyCard]);
  const h=harness({'maomao_encounter_candidates_v1':original});
  assert.equal(h.api.getCandidates().value.length,1);
  const fresh=h.api.generate().value;
  assert.equal(h.api.saveCandidate(fresh).ok,true);
  assert.equal(h.api.getCandidates().value.length,2);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),original);
  assert.equal(h.api.removeCandidate(legacyCard.id).ok,true);
  assert.equal(h.api.getCandidates().value.length,1);
  assert.equal(h.api.getCandidates().value[0].id,fresh.id);
  assert.equal(h.localStorage.getItem('maomao_encounter_candidates_v1'),original,'旧数组原样保留可恢复');
  assert.equal(h.localStorage.getItem('maomao_encounter_removed_v2:'+legacyCard.id),'1');
});

test('不同候选是独立物理存储键，浏览器备份能完整枚举', () => {
  const h=harness();
  const a=h.api.generate().value;
  const b=h.api.generate().value;
  assert.ok(a.id!==b.id && a.name!==b.name);
  assert.equal(h.api.saveCandidate(a).ok,true);
  assert.equal(h.api.saveCandidate(b).ok,true);
  assert.ok(h.map.has('maomao_encounter_card_v2:'+a.id));
  assert.ok(h.map.has('maomao_encounter_card_v2:'+b.id));
  assert.equal(h.map.has('maomao_encounter_candidates_v1'),false,
    'V2 不再向全局共享的 V1 数组写入新候选');
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
