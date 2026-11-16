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
    getCharacters(){
      const raw=localStorage.getItem('ai_custom_characters');
      return raw===null?{ok:false,error:{code:'NOT_FOUND'}}:{ok:true,value:JSON.parse(raw)};
    },
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



test('角色编辑器的 PhoneStorage 静默丢写必须报错并禁止后续覆盖', () => {
  const start=managerSource.indexOf('let roleStoreReadError = false;');
  const end=managerSource.indexOf('const ROLE_AVATAR_CLEANUP_QUEUE_KEY',start);
  const existing=[{id:'old',name:'保留的角色',persona:'绝不能被空数组覆盖'}];
  const source=managerSource.slice(start,end);
  const fake={
    getCharacters(){return {ok:true,value:existing};},
    saveCharacters(){return {ok:true};} // 浏览器报告写入成功，实际没持久化
  };
  const PhoneStorage={result:fake};
  const localStorage={getItem(){return JSON.stringify(existing);},setItem(){throw Error('should never touch fallback');}};
  const manager=vm.runInNewContext(source+';({loadRoles,saveRoles,isBlocked:()=>roleStoreReadError})',
    {window:{PhoneStorage},PhoneStorage,localStorage,STORAGE_KEY:'ai_custom_characters',DEFAULT_ROLES:[],console});
  assert.equal(manager.loadRoles().length,1);
  assert.equal(manager.saveRoles([{id:'new',name:'本次待保存角色'}]),false,
    '旧数据没变时不得误报保存成功');
  assert.equal(manager.isBlocked(),true,'必须拒绝再次覆盖旧数据');
  assert.equal(existing[0].persona,'绝不能被空数组覆盖');
});

test('没有 PhoneStorage 时本地存储假写成功也必须拒绝并保留旧字节', () => {
  const start=managerSource.indexOf('let roleStoreReadError = false;');
  const end=managerSource.indexOf('const ROLE_AVATAR_CLEANUP_QUEUE_KEY',start);
  const original='[{"id":"preserved","name":"旧角色"}]';
  const localStorage={getItem(){return original;},setItem(){}};
  const manager=vm.runInNewContext(managerSource.slice(start,end)+
    ';({loadRoles,saveRoles,isBlocked:()=>roleStoreReadError})',
    {window:{},localStorage,STORAGE_KEY:'ai_custom_characters',DEFAULT_ROLES:[],console});
  assert.equal(manager.loadRoles().length,1);
  assert.equal(manager.saveRoles([{id:'new',name:'新角色'}]),false);
  assert.equal(manager.isBlocked(),true);
  assert.equal(localStorage.getItem('ai_custom_characters'),original);
});



test('同一张邂逅候选始终映射相同角色 ID，原有 ID 冲突时绝不覆盖', () => {
  const start=managerSource.indexOf('        savedRoleId = activeEncounterDraftId');
  const end=managerSource.indexOf('        // 保留「邂逅」的结构化来源',start);
  assert.ok(start>=0 && end>start, '新建候选必须使用确定性正式角色 ID');
  const snippet=managerSource.slice(start,end);
  const errors=[];
  const chooseId=vm.runInNewContext(
    '(function (candidateId,roles){let savedRoleId="";'+
      'const activeEncounterDraftId=candidateId;'+snippet+
      'return savedRoleId;})',
    {Date,Math,String,setSaveStatus(message){errors.push(message);}}
  );
  const id=chooseId('enc_test001',[]);
  assert.equal(id,'role_enc_test001');
  assert.equal(chooseId('enc_test001',[]),id);
  assert.equal(chooseId('enc_test001',[{id}]),undefined);
  assert.match(errors[0],/角色 ID 已存在/);
  assert.ok(chooseId('',[]).startsWith('role_'),'普通新增角色仍能使用原有 ID 规则');
});

test('候选正式入库必须通过同账号 Web Locks，等待时重复点保存无效', async () => {
  const start=managerSource.indexOf('let encounterRoleSaveBusy = false;');
  const endAnchor="document.getElementById('btnSaveRole').addEventListener('click', saveEncounterRoleWithLock);";
  const end=managerSource.indexOf(endAnchor,start);
  assert.ok(start>=0 && end>start,'必须复用角色编辑器中的入库锁');
  const code=managerSource.slice(start,end+endAnchor.length);
  let onClick,unlock,saveCount=0,lockName='',status='';
  const els={
    btnSaveRole:{disabled:false,addEventListener(type,fn){onClick=fn;}},
    editorView:{classList:{contains(){return false;}}},
    editRoleId:{value:''}
  };
  const document={getElementById(id){return els[id];}};
  const window={
    MAOMAOEncounter:{checkAccountScope(){return {ok:true,value:{id:'MAO-AAAAAAAAAAAA'}};}},
    navigator:{locks:{request(name,options,fn){
      lockName=name;
      assert.equal(options.mode,'exclusive');
      return new Promise(resolve=>{unlock=()=>resolve(fn());});
    }}}
  };
  const globals={window,document,activeEncounterDraftId:'enc_one',handleSaveRole(){saveCount++;},
    setSaveStatus(s){status=s;},console};
  vm.runInNewContext(code,globals);
  const first=onClick(),second=onClick();
  assert.equal(els.btnSaveRole.disabled,true,'保存等待期间必须禁用按钮');
  assert.equal(saveCount,0);
  assert.equal(lockName,'maomao:encounter:role-create:MAO-AAAAAAAAAAAA');
  await second;
  assert.equal(saveCount,0,'不能重复进入创建');
  unlock();
  await first;
  assert.equal(saveCount,1);
  assert.equal(els.btnSaveRole.disabled,false);
  assert.equal(status,'');
});

test('拿到入库锁之前切换账号或人物，绝不能创建候选',async ()=>{
  const start=managerSource.indexOf('let encounterRoleSaveBusy = false;');
  const endAnchor="document.getElementById('btnSaveRole').addEventListener('click', saveEncounterRoleWithLock);";
  const end=managerSource.indexOf(endAnchor,start);
  const code=managerSource.slice(start,end+endAnchor.length);
  let click,unlock,accountId='MAO-AAAAAAAAAAAA',saveCount=0,reason='';
  const els={
    btnSaveRole:{disabled:false,addEventListener(type,fn){click=fn;}},
    editorView:{classList:{contains(){return false;}}},
    editRoleId:{value:''}
  };
  const window={
    MAOMAOEncounter:{checkAccountScope(){return {ok:true,value:{id:accountId}};}},
    navigator:{locks:{request(name,options,fn){
      return new Promise(resolve=>{unlock=()=>resolve(fn());});
    }}}
  };
  vm.runInNewContext(code,{
    window,document:{getElementById(id){return els[id];}},
    activeEncounterDraftId:'enc_one',handleSaveRole(){saveCount++;},
    setSaveStatus(message){reason=message;},console
  });
  const pending=click();
  accountId='MAO-BBBBBBBBBBBB';
  unlock();
  await pending;
  assert.equal(saveCount,0,'账号变化后不能保存旧账号候选');
  assert.match(reason,/账号或当前人物已变化/);
  assert.equal(els.btnSaveRole.disabled,false);
});


test('候选入库后清理已消费 URL，刷新不应再次尝试导入或丢掉返回来源', () => {
  const start=managerSource.indexOf('        // 创建成功后 URL 不可继续指向已消费的候选。');
  const end=managerSource.indexOf("        } catch (error) { console.warn('创建已保存，清理邂逅来源参数失败：', error); }",start);
  assert.ok(start>=0 && end>start,'成功创建后必须清理 encounterDraft 查询参数');
  const source=managerSource.slice(managerSource.indexOf('        try {',start),
    end+"        } catch (error) { console.warn('创建已保存，清理邂逅来源参数失败：', error); }".length);
  const replaced=[];
  const window={
    location:{href:'https://app.mao520.com/worldbook/characters/characters.html?encounterDraft=enc_old&from=contacts#profile'},
    history:{state:{tab:'roles'},replaceState(state,title,url){replaced.push({state,url});}}
  };
  vm.runInNewContext(source,{window,URL,console});
  assert.equal(replaced.length,1);
  assert.equal(replaced[0].url,
    '/worldbook/characters/characters.html?from=contacts#profile');
  assert.equal(replaced[0].state.tab,'roles');
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
  assert.equal(r.belongsTo('characters','maomao_encounter_card_v2:enc_example'),true);
  assert.equal(r.belongsTo('characters','maomao_encounter_removed_v2:enc_example'),true);
  assert.equal(r.belongsTo('characters','maomao_character_draft_v1:new'),true);
  assert.equal(r.belongsTo('characters','maomao_character_draft_v1:encounter:enc_example'),true);
  assert.equal(r.belongsTo('other','maomao_encounter_candidates_v1'),false);
  const saved=r.selectSnapshot('characters',{
    maomao_encounter_candidates_v1:'[{"id":"enc_example"}]',
    maomao_encounter_preferences_v1:'{"gender":"女"}',
    'maomao_encounter_card_v2:enc_example':'{"id":"enc_example","name":"测试角色"}',
    'maomao_encounter_removed_v2:enc_deleted':'1',
    api_settings:'private-api-key',
    another_feature:'should-not-export'
  });
  assert.deepEqual(Object.keys(saved).sort(),[
    'maomao_encounter_candidates_v1','maomao_encounter_preferences_v1',
    'maomao_encounter_card_v2:enc_example','maomao_encounter_removed_v2:enc_deleted'
  ].sort());
  assert.equal(Object.hasOwn(saved,'api_settings'),false,'备份不得夹带 API 密钥');
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


test('支持原生 Web Locks 时收藏和删除必须通过同账号独占锁',async () => {
  const data=new Map(),requestNames=[];
  const localStorage={
    get length(){return data.size;},
    key(i){return [...data.keys()][i]??null;},
    getItem(k){return data.get(k)??null;},
    setItem(k,v){data.set(k,String(v));},
    removeItem(k){data.delete(k);}
  };
  const window={
    localStorage,dispatchEvent(){},
    navigator:{locks:{
      async request(name,options,fn){
        requestNames.push({name,mode:options.mode});
        return fn();
      }
    }}
  };
  vm.runInNewContext(engineSource,{window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
  const api=window.MAOMAOEncounter;
  const card=api.generate().value;
  assert.equal((await api.saveCandidateSafe(card)).ok,true);
  assert.equal((await api.removeCandidateSafe(card.id)).ok,true);
  assert.equal(api.getCandidates().value.length,0);
  assert.equal(requestNames.length,2);
  assert.equal(requestNames[0].name,'maomao:encounter:v2:local-development');
  assert.equal(requestNames[0].mode,'exclusive');
});

test('没有 Web Locks 的旧浏览器仍使用逐角色存储，不回退共用数组',async ()=>{
  const h=harness();
  const card=h.api.generate().value;
  assert.equal((await h.api.saveCandidateSafe(card)).ok,true);
  assert.equal(h.api.getCandidates().value.length,1);
  assert.equal(h.map.has('maomao_encounter_candidates_v1'),false);
  assert.equal((await h.api.removeCandidateSafe(card.id)).ok,true);
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

test('空角色库与 PhoneStorage 返回独立副本：保存失败不能产生幽灵角色', () => {
  const start = managerSource.indexOf('let roleStoreReadError = false;');
  const end = managerSource.indexOf('const ROLE_AVATAR_CLEANUP_QUEUE_KEY', start);
  assert.ok(start >= 0 && end > start);
  const code = managerSource.slice(start, end) + ';({loadRoles,saveRoles})';
  const storage = {getItem(){return null;},setItem(){throw Error('quota');}};
  const emptyPhoneStorage = {
    result: {
      getCharacters(){return {ok:false,error:{code:'NOT_FOUND'}};},
      saveCharacters(){return {ok:false,error:{code:'QUOTA_EXCEEDED'}};}
    }
  };
  const empty = vm.runInNewContext(code, {
    window:{PhoneStorage:emptyPhoneStorage},PhoneStorage:emptyPhoneStorage,
    localStorage:storage,STORAGE_KEY:'ai_custom_characters',DEFAULT_ROLES:[],console
  });
  const pending = empty.loadRoles();
  pending.push({id:'role_unsaved',name:'未成功保存'});
  assert.equal(empty.saveRoles(pending),false);
  assert.deepEqual([...empty.loadRoles()],[],'写入失败后不能把内存中的新角色当成已保存角色');
  assert.notEqual(empty.loadRoles(),empty.loadRoles(),'默认空库不能共享可变数组');

  const cached = [{id:'existing',name:'已有角色'}];
  const phoneStorage = {
    result: {
      getCharacters(){return {ok:true,value:cached};},
      saveCharacters(){return {ok:false,error:{code:'QUOTA_EXCEEDED'}};}
    }
  };
  const existing = vm.runInNewContext(code, {
    window:{PhoneStorage:phoneStorage},PhoneStorage:phoneStorage,
    localStorage:storage,STORAGE_KEY:'ai_custom_characters',DEFAULT_ROLES:[],console
  });
  const draft = existing.loadRoles();
  draft[0].name = '未保存的修改';
  assert.equal(cached[0].name,'已有角色','编辑前不得直接改写底层缓存引用');
  assert.equal(existing.saveRoles(draft),false);
  assert.equal(existing.loadRoles()[0].name,'已有角色','保存失败后应能重新读到原资料');
});


function encounterEditorDraftFixture(seed = {}) {
  const db = new Map(Object.entries(seed));
  const localStorage = {
    get length(){return db.size;},
    key(i){return [...db.keys()][i]??null;},
    getItem(key){return db.has(key)?db.get(key):null;},
    setItem(key,value){db.set(key,String(value));},
    removeItem(key){db.delete(key);}
  };
  const window = {
    localStorage,location:{hostname:'localhost',search:''},
    dispatchEvent(){}
  };
  vm.runInNewContext(engineSource,{window,Math,Set,Uint32Array,Date,JSON,String,Array,Object,Number,CustomEvent:class {}});
  const candidate=window.MAOMAOEncounter.generate().value;
  assert.equal(window.MAOMAOEncounter.saveCandidate(candidate).ok,true);
  window.location.search='?encounterDraft='+encodeURIComponent(candidate.id);
  const elements=new Map();
  const document={getElementById(id){
    if(elements.has(id))return elements.get(id);
    const flags=new Set(['hidden']);
    const item={id,value:'',textContent:'',style:{},dataset:{},
      classList:{add:k=>flags.add(k),remove:k=>flags.delete(k),contains:k=>flags.has(k)},
      focus(){}};
    elements.set(id,item);
    return item;
  }};
  const segment=(start,end)=>{
    const i=managerSource.indexOf(start),j=managerSource.indexOf(end,i+start.length);
    assert.ok(i>=0&&j>i,'missing actual editor function '+start);
    return managerSource.slice(i,j);
  };
  const code=[
    "let activeEncounterDraftId='',pendingDraftRecovery=null,unreadableDraftKey='',currentDraftKey='',editorOriginalState=null,selectedColor='',avatarDataUrl='',selectedWorldBookIds=[],portraitPurpose='',editorReturnView='';",
    "function getRandomColor(){return '#777'} function updateAvatarPreview(){} function renderWorldBookBinder(){} function showView(){} function showAppView(){} function setSaveStatus(message,state){statuses.push({message,state});}",
    segment('function openAddRole(options) {','// 打开编辑旧角色'),
    segment('function getDraftKey(roleId) {','function setSaveStatus(message, state) {'),
    segment('function persistEditorDraft(force) {',"document.getElementById('btnBackProfile')"),
    segment('function openEncounterCandidateFromQuery() {','// 「已相识」返回现有角色档案'),
    ";({importCandidate:openEncounterCandidateFromQuery,openManual:openAddRole,saveDraft:persistEditorDraft,recover:recoverPendingDraft,discard:discardPendingDraft,cancel:handleCancelEdit,peek:()=>({key:currentDraftKey,hasRecovery:!!pendingDraftRecovery,unreadable:unreadableDraftKey===currentDraftKey,origin:activeEncounterDraftId})})"
  ].join('\n');
  const statuses=[];
  const editor=vm.runInNewContext(code,{
    window,document,localStorage,URLSearchParams,JSON,Date,console,
    statuses,confirm:()=>true,alert(message){throw Error('unexpected alert: '+message);}
  });
  return {editor,db,localStorage,elements,candidate,window,statuses,
    el:id=>document.getElementById(id)};
}

test('邂逅导入的草稿按人物隔离，不覆盖普通新角色草稿，回访可恢复未保存修改',()=>{
  const normalDraft={version:1,savedAt:123,
    state:{roleId:'',name:'正在手写的角色',persona:'一份没写完的重要人设',tone:'',avatar:'',worldBookIds:[]}};
  const raw=JSON.stringify(normalDraft);
  const h=encounterEditorDraftFixture({'maomao_character_draft_v1:new':raw});
  h.editor.importCandidate();
  const key='maomao_character_draft_v1:encounter:'+h.candidate.id;
  assert.equal(h.editor.peek().key,key);
  assert.equal(h.el('editRoleName').value,h.candidate.name);
  assert.equal(h.db.get('maomao_character_draft_v1:new'),raw,'不得覆盖用户普通新角色草稿');
  assert.equal(h.db.has(key),false,'首次打开模板不应写入无意义的恢复草稿');
  h.el('editRolePersona').value='修改后仍未保存的邂逅人设';
  assert.equal(h.editor.saveDraft(true),true);
  const saved=h.db.get(key);
  h.editor.importCandidate();
  assert.equal(h.editor.peek().hasRecovery,true,'重开相同人物应询问是否恢复');
  assert.equal(h.db.get(key),saved,'进入编辑器不能先覆盖旧草稿');
  h.editor.recover();
  assert.equal(h.el('editRolePersona').value,'修改后仍未保存的邂逅人设');
  h.editor.openManual();
  assert.equal(h.editor.peek().key,'maomao_character_draft_v1:new');
  assert.equal(h.editor.peek().hasRecovery,true,'普通新角色草稿仍有独立恢复入口');
  assert.equal(h.db.get('maomao_character_draft_v1:new'),raw);
});

test('损坏的邂逅草稿不自动删除或覆盖；恢复失败后只有明确放弃才能清理',()=>{
  const h=encounterEditorDraftFixture();
  const key='maomao_character_draft_v1:encounter:'+h.candidate.id;
  const corrupt='{damaged-but-owned-by-user';
  h.db.set(key,corrupt);
  h.editor.importCandidate();
  assert.equal(h.editor.peek().unreadable,true);
  assert.equal(h.editor.peek().hasRecovery,true);
  assert.equal(h.db.get(key),corrupt,'读取错误不应删除原草稿');
  assert.equal(h.editor.saveDraft(true),false,'自动暂存不允许覆盖损坏原文');
  h.editor.recover();
  assert.equal(h.db.get(key),corrupt,'无法恢复时不能偷偷清理');
  h.editor.cancel();
  assert.equal(h.db.get(key),corrupt,'关闭编辑器也不是授权删除损坏数据');
  h.editor.importCandidate();
  h.editor.discard();
  assert.equal(h.db.has(key),false,'用户明确点击放弃草稿才可删除');
  assert.equal(h.editor.peek().unreadable,false,'放弃后可以开始新的草稿');
});

test('性格盲测固定三种不同选项，真实气质只出现一次且不写角色数据', () => {
  const original = '[{"id":"old","name":"原有角色","persona":"必须原样保留"}]';
  const h = harness({
    ai_custom_characters: original,
    maomao_encounter_preferences_v1: '{"type":"性格盲测"}'
  });
  const card = h.api.generate().value;
  assert.equal(card.type, '性格盲测');
  const before = h.map.size;
  const options = Array.from(h.api.getBlindOptions(card));
  assert.equal(options.length, 3);
  assert.equal(new Set(options).size, 3);
  assert.equal(options.filter(x => x === card.trait).length, 1);
  assert.deepEqual(Array.from(h.api.getBlindOptions({...card})), options);
  assert.equal(h.map.size, before, '猜测选项不可自动写入任何数据');
  assert.equal(h.localStorage.getItem('ai_custom_characters'), original);
  assert.deepEqual(Array.from(h.api.getBlindOptions({...card,trait:'特殊性格'})).filter(x => x === '特殊性格'), ['特殊性格']);
  assert.equal(h.api.getBlindOptions(null).length, 0);
});



test('已相识的人物支持三个免费重逢场景，按正式 ID 检索且绝不写角色、记忆或聊天', () => {
  const original={id:'old',name:'旧角色',persona:'不能改变'};
  const met={id:'role_enc_demo',name:'林见山',persona:'原人设',encounterOrigin:{
    version:1,sourceCandidateId:'enc_demo',era:'现代都市',job:'摄影师',
    object:'一卷褪色的胶片',originalFate:'曾经离开故乡多年'
  }};
  const value=JSON.stringify([original,met]);
  const h=harness({'ai_custom_characters':value});
  const size=h.map.size;
  const result=h.api.getReunionScenes(met.id);
  assert.equal(result.ok,true,result.error);
  assert.equal(result.value.id,met.id);
  assert.equal(result.value.scenes.length,3);
  assert.equal(new Set(Array.from(result.value.scenes,x=>x.id)).size,3);
  assert.match(result.value.scenes[0].text,/摄影师/);
  assert.match(result.value.scenes[1].text,/胶片/);
  assert.match(result.value.scenes[2].text,/离开故乡/);
  assert.deepEqual(Array.from(h.api.getReunionScenes(met.id).value.scenes,x=>x.text),
    Array.from(result.value.scenes,x=>x.text));
  assert.equal(h.api.getReunionScenes(original.id).ok,false,'普通旧角色不能冒充邂逅角色');
  assert.equal(h.api.getReunionScenes('role_missing').ok,false);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),value);
  assert.equal(h.map.size,size);
});
test('已相识角色库损坏时拒绝再遇并保留原始数据',()=>{
  const h=harness({'ai_custom_characters':'{damaged'});
  assert.equal(h.api.getReunionScenes('role_enc_demo').ok,false);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),'{damaged');
});


test('以物识人提供所属世界的三种职业猜测，真实身份恰好一次且零存储写入',()=>{
  const original='[{"id":"older","name":"旧人物","persona":"绝不更改"}]';
  const h=harness({
    ai_custom_characters:original,
    maomao_encounter_preferences_v1:'{"type":"以物识人","world":"现代都市"}'
  });
  const known=['书店店主','建筑设计师','医生','摄影师','花艺师','律师','编辑','音乐制作人','咖啡师','研究员'];
  const card=h.api.generate().value;
  assert.equal(card.type,'以物识人');
  const before=new Map(h.map);
  const options=Array.from(h.api.getObjectOptions(card));
  assert.equal(options.length,3);
  assert.equal(new Set(options).size,3,'猜测职业不得重复');
  assert.equal(options.filter(x=>x===card.job).length,1,'真实职业必须且只出现一次');
  assert.ok(options.every(x=>known.includes(x)),'不应混入其他世界的职业');
  assert.deepEqual(Array.from(h.api.getObjectOptions({...card})),options,'人物同一 ID 选项顺序要稳定');
  assert.equal(h.api.getObjectOptions({...card,type:'普通相遇'}).length,0);
  assert.equal(h.api.getObjectOptions({...card,job:'其他世界不存在的职业'}).length,0);
  assert.deepEqual(Array.from(h.map.entries()),Array.from(before.entries()),'猜测选项不得写存储');
  assert.equal(h.localStorage.getItem('ai_custom_characters'),original);
});
test('以物识人任意原生世界均生成有三个不重复的合理身份选项',()=>{
  const worlds=['现代都市','架空古代','东方幻想','西方奇幻','未来纪元','现代异闻','神话时代'];
  for(const world of worlds){
    const h=harness({'maomao_encounter_preferences_v1':JSON.stringify({type:'以物识人',world})});
    for(let i=0;i<3;i++){
      const r=h.api.generate();
      assert.equal(r.ok,true,r.error);
      assert.equal(r.value.era,world);
      const choices=Array.from(h.api.getObjectOptions(r.value));
      assert.equal(choices.length,3,world);
      assert.equal(new Set(choices).size,3,world);
      assert.equal(choices.filter(x=>x===r.value.job).length,1,world);
    }
  }
});


test('蒙面档案三条线索只读且不会提前揭晓姓名、职业或角色 ID',()=>{
  const original='[{"id":"existing","name":"原来的人","persona":"不能修改"}]';
  const h=harness({'ai_custom_characters':original,
    'maomao_encounter_preferences_v1':'{"type":"蒙面档案"}'});
  const c=h.api.generate().value;
  assert.equal(c.type,'蒙面档案');
  const before=Array.from(h.map.entries());
  const clues=Array.from(h.api.getMaskedClues(c));
  assert.equal(clues.length,3);
  assert.deepEqual(Array.from(clues,x=>x.id),['origin','kind','keepsake']);
  assert.equal(new Set(Array.from(clues,x=>x.id)).size,3);
  assert.match(clues[0].text,new RegExp(c.era));
  assert.match(clues[1].text,new RegExp(c.species));
  assert.ok(clues[2].text.includes(c.object));
  const preview=clues.map(x=>x.text).join(' ');
  assert.equal(preview.includes(c.name),false,'蒙面线索不得写出人物真实姓名');
  assert.equal(preview.includes(c.job),false,'未揭晓前不得包含职业');
  assert.equal(preview.includes(c.id),false,'不能泄露候选 ID');
  assert.deepEqual(Array.from(h.map.entries()),before,'逐条线索不应改写任何存储');
  assert.equal(h.localStorage.getItem('ai_custom_characters'),original);
  assert.equal(h.api.getMaskedClues({...c,type:'普通相遇'}).length,0);
  assert.equal(h.api.getMaskedClues(null).length,0);
});
