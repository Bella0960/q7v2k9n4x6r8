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
  'capText','CTX_CAP', chooseRoleSection+
  '\nreturn {speakingRole,speakingRoleId,speakingRoleName,speakingRolePersona,rolePersona};');
const rpSection=section("            let rpProtocol = '';",'            // 世界书：');
const readRP=new Function('localStorage','speakingRoleId','capText','CTX_CAP',
  rpSection+'\nreturn rpProtocol;');
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
  assert.equal(context('b'),'');
});
test('main chat identity memory and group name references remain speaker-scoped',()=>{
  assert.match(detail,/const charName = speakingRoleName;/);
  assert.match(detail,/const roleMemory = capText\(buildWeightedMemoryText\(\s*speakingRoleId,/);
  assert.match(detail,/\.replace\(\/\\\{\\\{char\\\}\\\}\/g, speakingRoleName\)/);
  assert.match(detail,/relationshipRole = isGroupChat \? speakingRole : currentCharacter/);
  assert.doesNotMatch(rpSection,/localStorage\.setItem\(globalRpKey/);
});
