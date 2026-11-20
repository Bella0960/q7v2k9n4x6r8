import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const detail = read('chat/chat/chat-detail.html');
const memories = read('shared/js/phone/chat-context-policy.js');
const roles = read('shared/js/phone/chat-role-context.js');
const bridge = read('shared/js/phone/role-worldbook-bindings.js');

function fixture(init = {}) {
  const data = new Map(Object.entries(init));
  const localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, val) => data.set(key, String(val)),
    removeItem: key => data.delete(key)
  };
  const window = {localStorage};
  const context = vm.createContext({window, localStorage});
  for (const source of [memories,roles,bridge]) vm.runInContext(source, context);
  return {window,data,storage:localStorage,role:window.MAOMAOChatRoleContext,
    context:window.ChatContextPolicy, binding:window.RoleWorldbookBindings};
}

test('legacy user memories without matching sourceRoleId are never sent to any role',()=>{
  const {context}=fixture();
  const raw=[
    {text:'无来源的阿晴旧记忆'},
    {sourceRoleId:'',text:'空来源'},
    {sourceRoleId:'role_a',text:'角色A的过去'},
    {sourceRoleId:'role_b',text:'角色B的私人秘密'},
    {sourceRoleId:123,text:'数字 ID'}
  ];
  const before=JSON.stringify(raw);
  assert.deepEqual(Array.from(context.filterUserMemoriesForRole(raw,'role_a'),x=>x.text),['角色A的过去']);
  assert.deepEqual(Array.from(context.filterUserMemoriesForRole(raw,'role_b'),x=>x.text),['角色B的私人秘密']);
  assert.deepEqual(Array.from(context.filterUserMemoriesForRole(raw,'')),[]);
  assert.equal(JSON.stringify(raw),before,'must not mutate old memories');
  assert.doesNotMatch(detail,/return !m\.sourceRoleId \|\|/);
  assert.match(detail,/String\(m\.sourceRoleId\)\.trim\(\) === activeMemoryRoleId/);
});

test('unmounted global books and private books never enter single or group AI context',()=>{
  const two=[
    {id:'global',scope:'global',content:'阿晴的全局世界'},
    {id:'local_a',scope:'local',content:'只有A知道'},
    {id:'local_b',scope:'local',content:'只有B知道'}
  ];
  const roles=[{id:'role_a',name:'A',worldBookIds:['local_a']},{id:'role_b',name:'B',worldBookIds:[]}];
  const {binding,role,data}=fixture({ai_custom_characters:JSON.stringify(roles),phone_worldbooks:JSON.stringify(two)});
  assert.deepEqual(Array.from(binding.read('role_a').ids),['local_a']);
  assert.deepEqual(Array.from(binding.read('role_b').ids),[]);
  assert.deepEqual(Array.from(binding.filterBooks('role_b',two).books),[]);
  assert.deepEqual(Array.from(role.selectWorldbooksForRole(two,roles[1],[])),[]);
  assert.deepEqual(Array.from(role.selectWorldbooksForGroup(two,[])),[]);
  assert.deepEqual(Array.from(role.selectWorldbooksForGroupSpeaker(two,[],roles[1])),[]);
  assert.equal(binding.save('role_b',['global']).ok,true);
  assert.deepEqual(Array.from(binding.filterBooks('role_b',two).books,x=>x.id),['global']);
  assert.equal(binding.save('group_1',['local_a']).ok,true);
  assert.deepEqual(Array.from(role.selectWorldbooksForGroupSpeaker(
    two,Array.from(binding.read('group_1').ids),roles[1]),x=>x.id),['global','local_a']);
  assert.ok(data.has('phone_worldbooks'),'book data never removed');
});

test('blank, name-only and explicitly labeled name-only dossiers get only minimal prompt',()=>{
  const {role}=fixture();
  const minimal=role.MINIMAL_PERSONA_PROMPT;
  assert.equal(minimal,'注意：当前角色档案缺失，请保持简短回应，绝对不要自行编造姓名或职业。');
  for (const persona of ['', '陆昭辰', '姓名：陆昭辰', '名字: 陆昭辰。']) {
    const source={id:'a',name:'陆昭辰',persona};
    assert.equal(role.isPersonaIncomplete(source),true);
    assert.equal(role.validateFinalApiMessages({
      role:source,speakerId:'a',persona:minimal,protocol:minimal,
      expandedProtocol:minimal,worldbookPolicyReady:true,
      messages:[{role:'system',content:minimal}]
    }).ok,true);
    const wrong=role.validateFinalApiMessages({
      role:source,speakerId:'a',persona:'AI助手默认人设',protocol:minimal,
      expandedProtocol:minimal,worldbookPolicyReady:true,
      messages:[{role:'system',content:'AI助手默认人设 '+minimal}]
    });
    assert.equal(wrong.ok,false);
  }
  assert.equal(role.isPersonaIncomplete({id:'a',name:'陆昭辰',
    persona:'在深圳独立经营一家书店，性格直率。'}),false);
});

test('rich user-authored persona must still pass exact identity & content checks',()=>{
  const {role}=fixture();
  const person={id:'personA',name:'A',persona:'A有完整独立经历'};
  const base={role:person,speakerId:'personA',tone:'',protocol:'自定义协议',
    expandedProtocol:'自定义协议',worldbook:'',worldbookPolicyReady:true,
    messages:[{role:'system',content:'自定义协议\nA有完整独立经历'}]};
  assert.equal(role.validateFinalApiMessages({...base,persona:person.persona}).ok,true);
  assert.equal(role.validateFinalApiMessages({...base,persona:role.MINIMAL_PERSONA_PROMPT}).ok,false);
  assert.equal(role.validateFinalApiMessages({...base,speakerId:'personB',persona:person.persona}).ok,false);
});

test('offline source envelope shares strict mounts and minimal persona without mutating stored data',()=>{
  const roles=[{id:'A',name:'陆昭辰',persona:'姓名：陆昭辰',worldBookIds:[]},
    {id:'B',name:'顾清',persona:'有丰富的旅行经历',worldBookIds:['B-private']}];
  const books=[{id:'global',scope:'global',content:'外部通用故事'},
    {id:'B-private',scope:'local',content:'顾清专属秘密'}];
  const store={ai_custom_characters:JSON.stringify(roles),phone_worldbooks:JSON.stringify(books)};
  const {role,context,binding,storage,data}=fixture(store);
  const before=JSON.stringify(Array.from(data.entries()));
  const a=role.buildSavedSourceEnvelope({role:roles[0],storage,contextPolicy:context,
    bindingBridge:binding,defaultProtocol:'所有人都很温柔',currentText:'阿晴是谁'});
  assert.equal(a.ok,true);
  assert.equal(a.persona,role.MINIMAL_PERSONA_PROMPT);
  assert.equal(a.protocol,role.MINIMAL_PERSONA_PROMPT,'must not inject generic default for name-only dossier');
  assert.equal(a.worldbook,'');
  const b=role.buildSavedSourceEnvelope({role:roles[1],storage,contextPolicy:context,
    bindingBridge:binding,defaultProtocol:'原有默认协议',currentText:'你好'});
  assert.equal(b.ok,true);
  assert.equal(b.protocol,'原有默认协议');
  assert.match(b.worldbook,/顾清专属秘密/);
  assert.doesNotMatch(b.worldbook,/外部通用故事/);
  assert.equal(JSON.stringify(Array.from(data.entries())),before);
});

test('online system uses same minimal fallback and preserves current persona source barriers',()=>{
  assert.match(detail,/const personaIncomplete = !!\(relationshipRole && personaPolicy/);
  assert.match(detail,/personaPolicy\.isPersonaIncomplete\(relationshipRole\)/);
  assert.match(detail,/const turnSpeakerPersona = personaIncomplete/);
  assert.match(detail,/personaIncomplete\s*\?\s*String\(personaPolicy/);
  assert.match(detail,/stopForMissingRoleSource\('persona-sources-incomplete'/);
  assert.match(detail,/stopForMissingRoleSource\('final-source-audit'/);
  const sections=[...detail.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  const main=sections.find(src=>src.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(()=>new vm.Script(main));
});
