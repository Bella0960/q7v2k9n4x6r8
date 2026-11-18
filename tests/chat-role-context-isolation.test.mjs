import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');
function section(begin,end) {
  const a=detail.indexOf(begin),b=detail.indexOf(end,a);
  assert.ok(a>=0&&b>a, 'source boundary missing '+begin);
  return detail.slice(a,b);
}
const chooseRoleSection=section('            // Group metadata is not a character.',
  '            // 当前主角色专属的人物关系与生活线');
const composeSpeaker=new Function('isGroupChat','groupReplyPick','getRoleById',
  'currentCharacter','aliasRoleId','groupContextPrompt','rolePersona',
  'capText','CTX_CAP', 'var latestDirectRole = getRoleById(currentCharacter.id) || currentCharacter;\n' +
  chooseRoleSection +
  '\nreturn {speakingRole,speakingRoleId,speakingRoleName,speakingRolePersona,rolePersona};');
const rpSection=section("            let rpProtocol = '';",'            // 世界书：');
const buildRPReader=new Function('localStorage','speakingRoleId','capText','CTX_CAP','window',
  rpSection+'\nreturn rpProtocol;');
const readRP=(localStorage, speakingRoleId, capText, ctxCap, window = {}) =>
  buildRPReader(localStorage,speakingRoleId,capText,ctxCap,window);
const worldbookSection=section("            let worldbookText = '';",'            // 协议变量替换：');
const readBooks=new Function('localStorage','aliasRoleId','window','isGroupChat',
  'text','historyList','CTX_CAP','capText',worldbookSection+'\nreturn worldbookText;');
const varSection=section('            function applyProtocolVars(text) {','            let systemPrompt;');
const applyVars=new Function('speakingRoleName','userName','rolePersona','roleMemory',
  'worldbookText',varSection+'\nreturn applyProtocolVars;');
const roles={
  a:{id:'a',name:'林策',persona:'安静、谨慎，钟爱天文',memory:'承诺去观星'},
  b:{id:'b',name:'周遥',persona:'直率、爱开玩笑，喜欢足球',memory:'喜欢踢球'}
};
const group={id:'group-01',name:'班级群',persona:'群里的人都很热情',memory:'群聊专属记忆'};
const capText=(text,max)=>String(text||'').slice(0,max);
function fixture(pick){
  const who=pick==='a'?roles.a:roles.b;
  return composeSpeaker(true,{id:pick,name:who.name},id=>roles[id],
    group,group.id,'','群成员：林策、周遥',capText,{persona:5000});
}
function storage(map){
  return {
    getItem(key){return Object.prototype.hasOwnProperty.call(map,key)?map[key]:null;},
    setItem(key,value){map[key]=String(value);}
  };
}
function policy(){
  const window={};
  runInNewContext(policySource,{window});
  return {ChatContextPolicy:window.ChatContextPolicy};
}

test('group reply persona and identity resolve the selected member, not the group',()=>{
  const a=fixture('a'),b=fixture('b');
  assert.equal(a.speakingRoleName,'林策');
  assert.equal(a.speakingRoleId,'a');
  assert.match(a.rolePersona,/安静、谨慎，钟爱天文/);
  assert.match(a.rolePersona,/本轮发言者（优先遵守）/);
  assert.ok(a.rolePersona.indexOf('安静、谨慎')<a.rolePersona.indexOf('其他群成员'));
  assert.equal(b.speakingRoleName,'周遥');
  assert.equal(b.speakingRoleId,'b');
  assert.match(b.rolePersona,/直率、爱开玩笑/);
  assert.doesNotMatch(b.rolePersona.split('【其他群成员')[0],/安静、谨慎/);
});
test('single role still retains its original persona and character ID',()=>{
  const person=composeSpeaker(false,null,id=>roles[id],roles.a,'a','',
    '安静、谨慎，钟爱天文',capText,{persona:5000});
  assert.equal(person.speakingRoleName,'林策');
  assert.equal(person.speakingRoleId,'a');
  assert.equal(person.rolePersona,'安静、谨慎，钟爱天文');
});
test('global protocol {{char}} is the chosen group speaker, not the group name',()=>{
  const speaker=fixture('b');
  const render=applyVars(speaker.speakingRoleName,'用户',speaker.rolePersona,
    roles.b.memory,'【学校】在南门');
  const rp=render('我是{{char}}。\n{{persona}}\n{{memory}}\n{{worldbook}}');
  assert.match(rp,/我是周遥/);
  assert.match(rp,/喜欢踢球/);
  assert.match(rp,/在南门/);
  assert.doesNotMatch(rp,/我是班级群/);
});
test('a role legacy protocol cannot be silently promoted to all characters',()=>{
  const data={'chat_rp_protocol_a':'A-only instruction'};
  const ls=storage(data);
  assert.equal(readRP(ls,'b',capText,{rpProtocol:6000}),'');
  assert.equal(readRP(ls,'a',capText,{rpProtocol:6000}),'A-only instruction');
  assert.equal(ls.getItem('chat_rp_protocol_'),null);
  data.chat_rp_protocol_='saved GLOBAL protocol';
  assert.equal(readRP(ls,'b',capText,{rpProtocol:6000}),'saved GLOBAL protocol');
});
test('saved RP protocol wins; the shared default is used only when none was saved',()=>{
  const defaults={MAOMAO_RP_DEFAULT_PROTOCOL:'【默认协议】根据角色人设自然回复'};
  const ls=storage({});
  assert.equal(readRP(ls,'a',capText,{rpProtocol:6000},defaults),defaults.MAOMAO_RP_DEFAULT_PROTOCOL);
  ls.setItem('chat_rp_protocol_','【用户自定义协议】照角色档案说话');
  assert.equal(readRP(ls,'a',capText,{rpProtocol:6000},defaults),'【用户自定义协议】照角色档案说话');
  assert.equal(ls.getItem('chat_rp_protocol_'),'【用户自定义协议】照角色档案说话');
});

test('without explicit mounts local worldbooks are excluded from any conversation',()=>{
  const data={phone_worldbooks:JSON.stringify([
    {id:'global',scope:'global',title:'共同世界',content:'一起生活在未来城'},
    {id:'secretA',scope:'local',title:'A-only',content:'只属于A的秘密设定'},
    {id:'secretB',scope:'local',title:'B-only',content:'只属于B的秘密设定'}
  ])};
  for(const id of ['a','b','group-01']){
    const text=readBooks(storage(data),id,policy(),id==='group-01','聊聊学校',
      [{role:'user',text:'今天怎么样'}],{worldbook:8000},capText);
    assert.match(text,/共同世界/);
    assert.doesNotMatch(text,/A-only|B-only/);
  }
});
test('explicit mount is scoped; empty or malformed mount never leaks local books',()=>{
  const data={phone_worldbooks:JSON.stringify([
    {id:'global',scope:'global',title:'共同世界',content:'未来城'},
    {id:'secretA',scope:'local',title:'A-only',content:'图书馆秘密'},
    {id:'secretB',scope:'local',title:'B-only',content:'体育馆秘密'}
  ]),chat_worldbooks_a:JSON.stringify(['secretA'])};
  const context=(id)=>readBooks(storage(data),id,policy(),false,'',
    [],{worldbook:8000},capText);
  assert.match(context('a'),/A-only/);
  assert.doesNotMatch(context('a'),/B-only/);
  assert.doesNotMatch(context('b'),/A-only|B-only/);
  data.chat_worldbooks_b='[]';
  assert.equal(context('b'),'');
  data.chat_worldbooks_b='not-json';
  // Invalid mount data now fails the turn closed rather than silently
  // pretending no lore exists.
  assert.equal(context('b'),undefined);
});
test('main chat identity memory and group name references remain speaker-scoped',()=>{
  assert.match(detail,/const charName = speakingRoleName;/);
  assert.match(detail,/const roleMemory = isGroupChat[\s\S]*?buildWeightedMemoryText\(\s*speakingRoleId,/);
  assert.match(detail,/\.replace\(\/\\\{\\\{char\\\}\\\}\/g, speakingRoleName\)/);
  assert.match(detail,/relationshipRole = speakingRole;/);
  assert.doesNotMatch(rpSection,/localStorage\.setItem\(globalRpKey/);
});


test('missing group speaker stops before constructing a group identity prompt',()=>{
  const block=section('            // Avoid an API request under a group name',
    '            // 当前主角色专属的人物关系与生活线');
  assert.match(block,/if \(isGroupChat && !groupReplyPick\)/);
  assert.match(block,/return;/);
  assert.match(block,/getRoleById\(groupReplyPick\.id\) \|\| groupReplyPick/);
});

test('built-in calling and virtual gifts honor persona rather than mandating actions',()=>{
  const builtins=section('            // Built-in affordances must not replace a role',
    '            // 心声：');
  assert.match(builtins,/\[发起语音通话\]/);
  assert.match(builtins,/\[红包:金额:留言\]/);
  assert.match(builtins,/\[转账:金额:留言\]/);
  assert.match(builtins,/角色可以按人设/);
  assert.doesNotMatch(builtins,/具备真实拨号能力的 AI 助理|你必须答应|禁止推脱/);
  assert.doesNotMatch(builtins,/测试转账.{0,30}必须/);
});

test('family-card built-in prompt is limited to one-to-one conversations',()=>{
  const block=section('            if (!isGroupChat) {\n            // 单聊中的亲属卡',
    '            // 只向一对一角色聊天提供该角色自己的图库目录');
  assert.match(block,/亲属卡 \/ 亲密付规则/);
  assert.match(block,/\n            \}/);
});



test('direct character edits become visible to the very next AI turn',()=>{
  const fragment=section('            // Re-read the direct role on every AI turn.',
    '            // Assemble this turn');
  const readLatest=new Function('isGroupChat','currentCharacter','getRoleById',
    fragment+'\nreturn latestDirectRole;');
  const old={id:'a',name:'林策',persona:'原人设'};
  const updated={id:'a',name:'林策',persona:'更新后不喜欢客套话',memory:'新设定记忆'};
  const resolved=readLatest(false,old,id=>id==='a'?updated:null);
  assert.equal(resolved.persona,updated.persona);
  assert.notEqual(resolved.persona,old.persona);
  assert.match(detail,/rolePersona = \(latestDirectRole\.persona \|\| latestDirectRole\.prompt/);
  assert.match(detail,/var speakingRole = isGroupChat && groupReplyPick[\s\S]*?latestDirectRole;/);
});

test('group prompt exposes member names, never copies other members private personas',()=>{
  const roster=section('                // The group roster is public context',
    '                if (availableMembers.length) {');
  const make=new Function('currentGroup','groupMemberDisplayName','isGroupMemberInActiveHours',
    'const members=currentGroup.members; var rolePersona;\n'+roster+'\nreturn rolePersona;');
  const groupData={name:'班级群',ownerId:'__user',members:[
    {id:'a',name:'林策',persona:'只对自己有用的机密爱好',secret:'A私密日记'},
    {id:'b',name:'周遥',persona:'只属于B的隐藏经历',secret:'B私密日记'}
  ]};
  const rosterText=make(groupData,m=>m.name,()=>true);
  assert.match(rosterText,/林策|周遥/);
  assert.doesNotMatch(rosterText,/机密爱好|隐藏经历|私密日记/);
});


test('group prompts exclude unscoped user memory and personal role memory',()=>{
  const block=section('            let userMemoryText = isGroupChat',
    '            // 实时状态（记忆空间子系统');
  assert.match(block,/const um = isGroupChat \? \[\] : JSON\.parse/);
  assert.match(block,/const roleMemory = isGroupChat/);
  const code=section('            const roleMemory = isGroupChat',
    '            // 实时状态（记忆空间子系统');
  const getMemory=new Function('isGroupChat','speakingRoleId','speakingRole',
    'buildWeightedMemoryText','capText','CTX_CAP',
    code+'\nreturn roleMemory;');
  const get=(_id,stored)=>'私人记忆：'+stored;
  assert.doesNotMatch(
    getMemory(true,'a',roles.a,get,capText,{memory:3000}),
    /承诺去观星/);
  assert.match(
    getMemory(false,'a',roles.a,get,capText,{memory:3000}),
    /承诺去观星/);
});

test('long saved lore or protocol is rejected before API instead of truncating silently',()=>{
  const rpSource=section("            let rpProtocol = '';",'            // 世界书：');
  const ls=storage({chat_rp_protocol_:'X'.repeat(24001)});
  const prompt=readRP(ls,'a',capText,{rpProtocol:6000});
  assert.equal(prompt,undefined);
  const largeLore=storage({phone_worldbooks:JSON.stringify([
    {id:'global',scope:'global',title:'长世界书',content:'Y'.repeat(32001)}
  ])});
  const books=readBooks(largeLore,'a',policy(),false,'',[],
    {worldbook:8000},capText);
  assert.equal(books,undefined);
  assert.match(detail,/systemPrompt = applyProtocolVars\(rpProtocol\);/);
  assert.doesNotMatch(detail,/systemPrompt = capText\(applyProtocolVars\(rpProtocol\)/);
});

