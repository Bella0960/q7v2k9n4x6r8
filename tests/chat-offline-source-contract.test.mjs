import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const policyWindow = {};
const contextWindow = {};
runInNewContext(src('shared/js/phone/chat-role-context.js'), {window:policyWindow});
runInNewContext(src('shared/js/phone/chat-context-policy.js'), {window:contextWindow});
const policy=policyWindow.MAOMAOChatRoleContext;
const context=contextWindow.ChatContextPolicy;
const long=src('chat/date/date.html');
const short=src('chat/date/journey.html');

function envelope(currentText, overrides={}) {
  const role={id:'r1',name:'人物一',persona:'住在深圳，职业是摄影师。',
    tone:'短句，少用感叹号。',worldBookIds:['r1-local'],memory:'记得上次去的巷子。'};
  const records={
    chat_rp_protocol_:'用户保存的协议：{{char}}，{{persona}}，{{memory}}，{{worldbook}}',
    phone_worldbooks:JSON.stringify([
      {id:'global',scope:'global',title:'城市',entries:[{name:'背景',injectMode:'always',content:'住在南方'}]},
      {id:'r1-local',scope:'local',title:'个人',entries:[{name:'巷子',injectMode:'keyword',keywords:['巷子'],content:'转角是书店'}]},
      {id:'r2-private',scope:'local',title:'其他人',content:'不能泄露'}
    ]),
    chat_worldbooks_r1:'[]'
  };
  Object.assign(records, overrides);
  return policy.buildSavedSourceEnvelope({
    role,storage:{getItem:key=>records[key]??null},contextPolicy:context,
    conversationId:'r1',currentText,recentMessages:[],userName:'玩家',
    defaultProtocol:'默认协议备用'
  });
}

test('offline/short routes load the same fresh source scripts, without fallback generic character persona', () => {
  for(const page of [long,short]){
    assert.match(page,/rp-default-protocol\.js/);
    assert.match(page,/chat-context-policy\.js/);
    assert.match(page,/chat-role-context\.js/);
    assert.match(page,/buildSavedSourceEnvelope\(/);
    assert.match(page,/validateFinalApiMessages\(/);
  }
  assert.doesNotMatch(long, /persona = capText\(\(character\.persona/);
  assert.doesNotMatch(short, /String\(character\.persona\|\|character\.prompt\|\|character\.description/);
  assert.doesNotMatch(short,/messages:fallbackMessages\.slice\(\)/);
});

test('role's saved protocol, persona, tone and trigger-specific worldbooks pass outbound audit together', () => {
  const a=envelope('巷子怎么走');
  assert.equal(a.ok,true);
  assert.match(a.expandedProtocol,/住在深圳，职业是摄影师/);
  assert.match(a.expandedProtocol,/记得上次去的巷子/);
  assert.match(a.worldbook,/住在南方/);
  assert.match(a.worldbook,/转角是书店/);
  assert.doesNotMatch(a.worldbook,/不能泄露/);
  const request={...a,speakerId:a.role.id,
    messages:[{role:'system',content:a.expandedProtocol+'\n'+a.persona+'\n'+a.tone+'\n'+a.worldbook}]};
  assert.equal(policy.validateFinalApiMessages(request).ok,true);
  assert.equal(policy.validateFinalApiMessages({...request,messages:[{role:'system',content:a.persona}]}).ok,false);
});

test('keyword worldbooks obey activation rules while global always-on entries still load', () => {
  const a=envelope('其他话题');
  assert.equal(a.ok,true);
  assert.match(a.worldbook,/住在南方/);
  assert.doesNotMatch(a.worldbook,/转角是书店/);
});

test('corrupt saved worldbook or missing persona fails closed rather than generating generic messages', () => {
  assert.deepEqual(envelope('巷子', {phone_worldbooks:'not JSON'}).ok,false);
  assert.equal(policy.buildSavedSourceEnvelope({
    role:{id:'r1',persona:''},storage:{getItem:()=>null},
    contextPolicy:context,defaultProtocol:'默认协议'
  }).ok,false);
  assert.match(long,/角色档案、伴侣协议或世界书未完整加载/);
  assert.match(short,/角色资料未加载/);
  assert.match(short,/Only publish a role-verified, actually generated message/);
  assert.match(long,/source\.expandedProtocol \+ '\\n\\n' \+ parts\.join/);
});
