import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const bridgeCode=readFileSync(new URL('../shared/js/phone/inspect_interaction_bridge.js',import.meta.url),'utf8');
const chatHtml=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const phoneFeature=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');

function fixture(role='rA'){
  const cache=new Map(),storage={
    getItem(k){return cache.get(k)||null;},
    setItem(k,v){cache.set(k,String(v));}
  };
  const window={localStorage:storage};
  vm.runInNewContext(bridgeCode,{window,Date,Math,Number,String,JSON,Array,Object});
  const bridge=window.InspectInteractionBridge;
  const data={schema:1,roleId:role,day:'2026-11-12',facts:[{id:'x'}],sections:{},interactions:[]};
  function sync(){storage.setItem(bridge.key(role),JSON.stringify(data));}
  function persisted(){return JSON.parse(storage.getItem(bridge.key(role)));}
  return {cache,storage,bridge,data,sync,persisted};
}
test('首次只为新互动提供一次 AI 参考，不直接生成角色聊天记录',()=>{
  const f=fixture();
  f.bridge.record(f.data,'note_created','《周五提醒》：记得买水果','note-100');
  f.sync();
  const packet=f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'下午做什么'});
  assert.equal(packet.mode,'fresh');
  assert.equal(packet.eventIds.length,1);
  assert.match(packet.text,/记得买水果/);
  assert.ok(!('chatMessages' in f.data));
  assert.equal(f.persisted().interactions[0].offeredToAIAt,undefined);
});

test('真实 AI 回复保存后才标记提供过的线索，普通聊天不重复主动提醒',()=>{
  const f=fixture();
  f.bridge.record(f.data,'note_edited','我写的日记', 'note-101');
  f.sync();
  const one=f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'你好'});
  assert.equal(one.eventIds.length,1);
  assert.equal(f.bridge.markOffered('rA',one.eventIds,f.storage,Date.now()),true);
  assert.ok(f.persisted().interactions[0].offeredToAIAt>0);
  const next=f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'今天吃什么'});
  assert.equal(next.text,'');
  assert.deepEqual(next.eventIds,[]);
  assert.equal(next.mode,'none');
});

test('用户主动问起备忘录时，之前已提供的线索仍可被回忆，但不会再次标记新提醒',()=>{
  const f=fixture();
  f.bridge.record(f.data,'note_created','《重要提醒》：别忘了明天的约定','note-102');
  f.sync();
  const first=f.bridge.buildPromptPacket('rA',f.storage);
  f.bridge.markOffered('rA',first.eventIds,f.storage);
  const followup=f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'你有没有看到我写的备忘录？'});
  assert.equal(followup.mode,'reference');
  assert.match(followup.text,/明天的约定/);
  assert.match(followup.text,/只在用户本轮主动提及/);
  assert.equal(followup.eventIds.length,0);
  assert.equal(f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'我看到一只猫'}).text,'');
});

test('反复编辑同一篇日记只展示最新版本，独立朋友圈评论都保留',()=>{
  const f=fixture();
  f.bridge.record(f.data,'note_created','日记旧版本','note-103');
  f.bridge.record(f.data,'note_edited','日记新的版本','note-103');
  f.bridge.record(f.data,'moment_comment','第一条评论','post-1');
  f.bridge.record(f.data,'moment_comment','第二条评论','post-1');
  f.sync();
  const first=f.bridge.buildPromptPacket('rA',f.storage);
  assert.match(first.text,/第二条评论/);
  assert.match(first.text,/第一条评论/);
  assert.equal(first.eventIds.length,2);
  f.bridge.markOffered('rA',first.eventIds,f.storage);
  const question=f.bridge.buildPromptPacket('rA',f.storage,Date.now(),{userText:'我写的日记还有吗？'});
  assert.match(question.text,/日记新的版本/);
  assert.doesNotMatch(question.text,/日记旧版本/);
});

test('角色隔离：另一角色不能读取或标记本角色互动',()=>{
  const f=fixture('rA');
  f.bridge.record(f.data,'note_created','属于A的秘密','note-abc');f.sync();
  assert.equal(f.bridge.buildPrompt('rB',f.storage),'');
  assert.equal(f.bridge.markOffered('rB',[f.data.interactions[0].id],f.storage),false);
  assert.equal(f.persisted().interactions[0].offeredToAIAt,undefined);
});

test('存储额度不足不假装已提供给 AI，旧线索仍可重新提供',()=>{
  const f=fixture();
  f.bridge.record(f.data,'moment_comment','请记住这一条','moment-5');f.sync();
  const offer=f.bridge.buildPromptPacket('rA',f.storage);
  const quota={getItem(k){return f.storage.getItem(k)},setItem(){throw new Error('full')}};
  assert.equal(f.bridge.markOffered('rA',offer.eventIds,quota),false);
  assert.equal(f.persisted().interactions[0].offeredToAIAt,undefined);
  assert.equal(f.bridge.buildPromptPacket('rA',f.storage).eventIds.length,1);
});

test('已过期互动和伪造来源不进入模型的提示词',()=>{
  const f=fixture();
  f.bridge.record(f.data,'note_created','本周才写的','a');
  f.data.interactions.push({id:'fake-1',type:'note_edited',at:Date.now(),text:'不可信的伪造来源',origin:'unknown'});
  f.data.interactions.push({id:'old-1',type:'note_created',at:Date.now()-40*86400000,text:'四十天前',origin:'user_on_fictional_phone'});
  f.sync();
  const packet=f.bridge.buildPromptPacket('rA',f.storage);
  assert.match(packet.text,/本周才写的/);
  assert.doesNotMatch(packet.text,/不可信的伪造来源|四十天前/);
});

test('聊天提示词生命周期仅在正常单聊且保存AI回复后确认，不误判成已读',()=>{
  assert.match(chatHtml,/var inspectPhoneEventIds=\[\]/);
  assert.match(chatHtml,/!isGroupChat && !silent && !contextOnly && !isRegen/);
  assert.match(chatHtml,/InspectInteractionBridge\.buildPromptPacket/);
  const saveIndex=chatHtml.indexOf('if (!replySaved) {'),offeredIndex=chatHtml.indexOf('InspectInteractionBridge.markOffered');
  assert.ok(saveIndex>0&&offeredIndex>saveIndex);
  assert.match(chatHtml,/This is NOT[\s\S]*?a fictional "read receipt"/);
  assert.match(phoneFeature,/num\(record\.offeredToAIAt,0\)>num\(entry\.offeredToAIAt,0\)/);
});
