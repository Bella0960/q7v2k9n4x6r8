import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const regexSrc = source('shared/js/phone/chat-regex-policy.js');
const diagSrc = source('shared/js/phone/prompt-diagnostic.js');
const detail = source('chat/chat/chat-detail.html');

function storage(raw) {
  const entries = new Map(raw ? [['regex_rules', JSON.stringify(raw)]] : []);
  return {getItem:k=>entries.has(k)?entries.get(k):null,
    setItem:k=>{throw Error('read-only regex policy must not write '+k);}};
}
function regexModule() {
  const win={};
  vm.runInNewContext(regexSrc,{window:win});
  return win.ChatRegexPolicy;
}
test('enabled regex output rules are represented in System without modifying the deterministic cleaner',()=>{
  const policy=regexModule();
  const rules=[
    {id:'text',name:'纠正称呼',pattern:'机器人',replacement:'角色本人',enabled:true},
    {id:'disabled',name:'禁用项',pattern:'不要出现',replacement:'x',enabled:false},
    {id:'bad',name:'无效语法',pattern:'[broken',replacement:'x',enabled:true},
    {id:'r_builtin_missingcomma',builtin:true,pattern:'}',replacement:',}',enabled:true}
  ];
  const local=storage(rules);
  const header=policy.buildSystemRules(local);
  assert.match(header,/【启用的全局正则/);
  assert.match(header,/纠正称呼/);
  assert.match(header,/机器人/);
  assert.match(header,/角色本人/);
  assert.doesNotMatch(header,/禁用项|无效语法|r_builtin_missingcomma/);
  assert.equal(policy.applySaved('我是机器人',local),'我是角色本人');
  assert.equal(policy.buildSystemRules(storage([])),'');
});
test('prompt keeps the saved protocol before output-format rules and preserves regex rules',()=>{
  assert.match(detail,/systemPrompt = applyProtocolVars\(rpProtocol\);/);
  assert.match(detail,/systemPrompt \+= '\\n\\n' \+ IDENTITY_LOCK/);
  assert.doesNotMatch(detail,/systemPrompt = IDENTITY_LOCK\s*\+/);
  assert.match(detail,/if \(regexSystemHead\) systemPrompt = regexSystemHead \+ '\\n\\n' \+ systemPrompt;/);
  assert.match(detail,/const apiMessages = \[[\s\S]*?role: 'system', content: systemPrompt/);
  assert.match(detail,/validateFinalApiMessages\(\{[\s\S]*?messages: apiMessages/);
  assert.match(detail,/messages: apiMessages,/);
  assert.match(detail,/await window\.MAOMAOPromptDiagnostic\.beforeSend\(apiMessages\)/);
  assert.doesNotMatch(detail,/【发送前的角色一致性核对】|【群聊口吻纠偏】|【本轮普通群聊的说话方式】/);
  for(const marker of ['【最终设定优先级】','【世界书 / 角色生活背景】',
    '【群聊模式：线下共同场景】','[发起语音通话]','[群私聊:'])
    assert.ok(detail.includes(marker),'must preserve app features: '+marker);
});

test('chat binds the saved role name literally and puts the identity rules before all other sources', () => {
  const expand = detail.match(/function applyProtocolVars\(text\) \{[\s\S]*?\n {12}\}/)[0];
  const identity = detail.match(/const roleIdentityHead = \[[\s\S]*?systemPrompt = roleIdentityHead \+ '\\n\\n' \+ systemPrompt;/)[0];
  const scope = {
    turnSpeakerName: '测试一号 $& {{user}}', userName: '用户',
    turnSpeakerPersona: '{{memory}}', roleMemory: '旧回复自称阿晴',
    worldbookText: '', nameSeal: '空白档案姓名约束', globalIdentitySeal: '全局身份约束'
  };
  const prompt = vm.runInNewContext(
    expand + '\nlet systemPrompt = "正则\\n" + applyProtocolVars("{{char}} / {{user}} / {{persona}} / {{memory}}");\n' +
    identity + '\nsystemPrompt;', scope);
  assert.ok(prompt.startsWith('【角色扮演最高优先级】'));
  assert.match(prompt, /不要自称 AI/);
  assert.match(prompt, /没有对应设定就自然略过/);
  assert.ok(prompt.includes('正则\n测试一号 $& {{user}} / 用户 / {{memory}} / 旧回复自称阿晴'));
  assert.ok(detail.indexOf(identity) < detail.indexOf('const apiMessages = ['));
});
test('chat gives both response headers and stream inactivity a 60 second budget', () => {
  assert.match(detail, /const chatResponseTimeoutMs = 60000;/);
  assert.match(detail, /PhoneStream\.chat\(\{[^}]*connectMs: chatResponseTimeoutMs,[^}]*watchdogMs: chatResponseTimeoutMs,/);
  assert.doesNotMatch(detail, /15秒未响应/);
});

test('all actual inline chat scripts still compile with streamlined prompt',()=>{
  const main=[...detail.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(x=>x[1]).find(x=>x.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(()=>new vm.Script(main));
  assert.doesNotThrow(()=>new vm.Script(diagSrc));
  assert.doesNotThrow(()=>new vm.Script(regexSrc));
});
function diagnostic(hostname='preview.mao520.com') {
  const stored=new Map(), logs=[], nodes=[];
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.events={};this.attributes={};this.parentNode=null;this.value='';this.textContent='';}
    appendChild(c){c.parentNode=this;this.children.push(c);return c;}
    removeChild(c){this.children.splice(this.children.indexOf(c),1);c.parentNode=null;return c;}
    setAttribute(k,v){this.attributes[k]=String(v);}
    addEventListener(k,fn){this.events[k]=fn;}
    click(){this.events.click?.();}
    focus(){}
    select(){}
    find(tag){return this.children.flatMap(c=>[c,...c.find(tag)]).filter(c=>c.tagName===tag);}
  }
  const body=new Element('body'), title=new Element('span');
  const win={
    location:{hostname},
    sessionStorage:{getItem:k=>stored.has(k)?stored.get(k):null,setItem:(k,v)=>stored.set(k,v)},
    console:{log:(...args)=>logs.push(args)},
    document:{body,createElement:tag=>new Element(tag)},
    navigator:{clipboard:{writeText:async text=>{nodes.push(text);}}}
  };
  vm.runInNewContext(diagSrc,{window:win,Promise,Date});
  return {win,body,title,logs,nodes,api:win.MAOMAOPromptDiagnostic};
}
test('QA five-tap opt-in displays exact full payload on device before fetch, copy works',async()=>{
  const f=diagnostic(),notice=[];
  f.api.bindTitle(f.title,text=>notice.push(text));
  assert.equal(f.api.isEnabled(),false);
  for(let i=0;i<5;i++)f.title.click();
  assert.equal(f.api.isEnabled(),true);
  const persona='角色完整人设 '.repeat(250);
  const msgs=[{role:'system',content:'【协议】\n'+persona+'\n【世界书】地铁终点站'},
    {role:'user',content:'用户私人聊天文字'}];
  let finished=false;
  const result=f.api.beforeSend(msgs).then(()=>{finished=true});
  await Promise.resolve();
  assert.equal(finished,false,'network must wait for user to close preview');
  assert.equal(f.logs.length,2);
  assert.equal(f.logs[0][1],msgs[0].content);
  assert.ok(f.logs[1][1].includes('用户私人聊天文字'));
  const areas=f.body.find('TEXTAREA');
  assert.equal(areas.length,2);
  assert.equal(areas[0].value,msgs[0].content);
  assert.deepEqual(JSON.parse(areas[1].value),msgs);
  const buttons=f.body.find('BUTTON');
  assert.deepEqual(buttons.map(b=>b.textContent),['复制完整诊断','关闭并继续发送']);
  buttons[0].click(); await Promise.resolve();
  assert.ok(f.nodes[0].includes(msgs[0].content));
  assert.ok(f.nodes[0].includes('用户私人聊天文字'));
  buttons[1].click(); await result;
  assert.equal(finished,true);assert.equal(f.body.children.length,0);
  for(let i=0;i<5;i++)f.title.click();
  assert.equal(f.api.isEnabled(),false);
});
test('private prompt diagnostic remains disabled on production origin',async()=>{
  const f=diagnostic('app.mao520.com');
  f.api.bindTitle(f.title,()=>{});
  for(let i=0;i<7;i++)f.title.click();
  const msgs=[{role:'system',content:'PRIVATE DATA'}];
  await f.api.beforeSend(msgs);
  assert.equal(f.api.isEnabled(),false);
  assert.equal(f.logs.length,0);
  assert.equal(f.body.children.length,0);
});
