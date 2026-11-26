import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/memory_recall.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');

const keyword='蓝鲸观测预约编号', old=keyword+'已经确认', filler='普通日常记录内容';
const msg=(text,extra={})=>({role:'sent',text,...extra});
function fixture(){
 const window={setTimeout:fn=>fn()};
 new Function('window',source)(window);
 return {window,api:window.MemoryRecall};
}
const scope={kind:'role',accountId:'fixture',conversationId:'A',revision:'turn'};
const opts={excludeRecent:1,maxItems:2,maxChars:540,maxScan:2500};
const guard={scope,isCurrent:()=>true,allowExtended:true,yieldControl:async()=>{}};
const longHistory=()=>Array.from({length:4000},(_,i)=>msg(i===3?old:filler));
test('old source beyond 2500 found by extended recall',async()=>{
 const f=fixture(),h=longHistory();
 assert.equal(f.api.buildHistoricalRecallText(h,keyword,opts),'');
 const r=await f.api.recallForModelHistory(h,keyword,opts,guard);
 assert.equal(r.ok,true);assert.equal(r.reason,'indexed');assert.ok(r.text.includes(old));assert.ok(r.text.length<=540);
});
test('bounded hit avoids index construction',async()=>{
 const f=fixture(),h=longHistory();h[3997]=msg(keyword+'近期确认');
 let yields=0;
 const r=await f.api.recallForModelHistory(h,keyword,opts,{...guard,yieldControl:async()=>{yields++}});
 assert.equal(r.reason,'bounded');assert.ok(r.text.includes('近期确认'));assert.equal(yields,0);
});
test('stale projection aborts and cannot return previous excerpts',async()=>{
 const f=fixture();let active=true;
 const r=await f.api.recallForModelHistory(longHistory(),keyword,opts,{...guard,isCurrent:()=>active,yieldControl:async()=>{active=false;}});
 assert.equal(r.ok,false);assert.equal(r.reason,'stale-scope');
});
test('explicitly disabled extended recall stays bounded',async()=>{
 const f=fixture(),r=await f.api.recallForModelHistory(longHistory(),keyword,opts,{...guard,allowExtended:false});
 assert.equal(r.reason,'bounded');assert.equal(r.text,'');
});
test('wrong role and group or private records not indexed or bounded',async()=>{
 const f=fixture(),h=longHistory();h[3]=msg(old,{sourceRoleId:'B'});
 h[7]=msg(keyword+'群聊',{memberId:'A'});h[3997]=msg(keyword+'私密',{visibility:'private'});
 h[3998]=msg(keyword+'群欢迎',{type:'group_welcome'});
 const r=await f.api.recallForModelHistory(h,keyword,opts,guard);
 assert.equal(r.ok,true);assert.equal(r.text,'');
});
test('recent exclusion preserves coordinates',async()=>{
 const f=fixture(),h=longHistory();h[3]=msg(filler);h[3999]=msg(old);
 const r=await f.api.recallForModelHistory(h,keyword,opts,guard);
 assert.equal(r.text,'');
});
test('group path remains separate and bounded',async()=>{
 const f=fixture(),h=longHistory();h[3997]=msg(keyword+'群内公开');
 const r=await f.api.recallForModelHistory(h,keyword,{...opts,groupPublicOnly:true},null);
 assert.equal(r.reason,'group-bounded');assert.ok(r.text.includes('群内公开'));assert.ok(!r.text.includes(old));
});
function pageFixture(options={}){
 const f=fixture(),historyList=longHistory(),roleForTurn={id:'A',name:'角色'},baseline=JSON.stringify(historyList);
 const account={ready:true,accountId:'fixture'};let raw=baseline,archive={revision:'',hidden:options.hidden?['hidden']:[]},stop='',called=0,extended=null;
 const window=f.window;
 window.location={href:'https://example.invalid/chat?id=A'};
 window.__MAO_ACCOUNT_SCOPE__=account;
 const original=window.MemoryRecall.recallForModelHistory;
 window.MemoryRecall.recallForModelHistory=async (h,q,o,g)=>{
  called++;extended=g.allowExtended;
  const result=await original(h,q,o,{...g,yieldControl:async()=>{if(options.edit)raw='[]';}});
  return result;
 };
 const storage={getMemoryArchive:()=>archive};
 const start=page.indexOf('            let historicalRecallGuard = null;');
 const end=page.indexOf('            if (!isGroupChat && !isRegen && !contextOnly && (!silent || visionImageMids.length)',start);
 assert.ok(start>=0&&end>start);
 const block=page.slice(start,end),apiMessages=[{role:'system',content:'fixture'}];
 const names=['window','localStorage','_chatHistoryBaselines','historyList','roleForTurn','currentCharacter','storageKey','getRoleById','_storage','roleModelHistory','recentHistory','text','isGroupChat','currentGroup','isRegen','retryTarget','contextOnly','silent','apiMessages','stopForMissingRoleSource'];
 const values=[window,{getItem:()=>raw},new WeakMap([[historyList,baseline]]),historyList,roleForTurn,roleForTurn,'chat_history_A',()=>({...roleForTurn}),storage,historyList,[historyList[3999]],keyword,false,null,!!options.regen,null,false,false,apiMessages,(r)=>{stop=r;}];
 const run=new Function(...names,'return (async function(){'+block+'\nreturn historicalRecallGuard;})();');
 return {run:()=>run(...values),apiMessages,stop:()=>stop,called:()=>called,extended:()=>extended,edit:()=>{raw='[]';}};
}
test('actual chat recall block adds indexed excerpt to system message',async()=>{
 const f=pageFixture(),check=await f.run();
 assert.equal(f.called(),1);assert.equal(f.extended(),true);assert.ok(f.apiMessages[0].content.includes(old));assert.equal(check(),true);
 f.edit();assert.equal(check(),false);
});
test('actual chat recall block aborts changed source before injection',async()=>{
 const f=pageFixture({edit:true});await f.run();
 assert.equal(f.stop(),'recall-source-changed');assert.equal(f.apiMessages[0].content,'fixture');
});
test('actual chat recall block excludes archive-hidden and regen from extended mode',async()=>{
 for(const o of [{hidden:true},{regen:true}]){
  const f=pageFixture(o);await f.run();assert.equal(f.called(),1);assert.equal(f.extended(),false);assert.equal(f.apiMessages[0].content,'fixture');
 }
});
test('final delivery barrier checks recall source before streaming',()=>{
 const guardPos=page.indexOf('if (historicalRecallGuard && !historicalRecallGuard())');
 const finalPos=page.indexOf('// Final delivery barrier: verify what the model will actually receive.');
 assert.ok(guardPos>=0&&finalPos>guardPos);
});
