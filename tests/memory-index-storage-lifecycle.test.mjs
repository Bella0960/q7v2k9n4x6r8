import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/memory_recall.js',import.meta.url),'utf8');

const query='蓝鲸观测预约编号', old=query+'已确认', edited=query+'已取消';
const msg=text=>({role:'sent',text});
function fixture(history){
 let raw=JSON.stringify(history),role='r1',page=true,reads=0,writes=0,blocked=false,yields=0;
 const events=new Map();
 const window={__MAO_ACCOUNT_SCOPE__:{ready:true,accountId:'fixture-a',role:'user'},
  localStorage:{getItem:key=>{reads++;if(blocked)throw Error('unavailable');assert.equal(key,'chat_history_r1');return raw},setItem:()=>{writes++}},
  setTimeout,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name)}};
 new Function('window',source)(window);
 const options={conversationId:'r1',getCurrentConversationId:()=>role,isCurrentPage:()=>page,yieldControl:async()=>{yields++}};
 return {window,events,api:window.MemoryRecall,options,setRaw:v=>{raw=v},setRole:v=>{role=v},setPage:v=>{page=v},block:()=>{blocked=true},reads:()=>reads,writes:()=>writes,yields:()=>yields};
}
test('same-length edit invalidates and rebuilds exact primary snapshot',async()=>{
 const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);
 assert.equal((await s.search(query)).matches[0].content,old);
 f.setRaw(JSON.stringify([msg(edited)]));
 assert.equal((await s.search(query)).matches[0].content,edited);
 assert.equal(f.writes(),0);s.dispose();
});
test('deletion and restore reflected on next query',async()=>{
 const f=fixture([msg(old),msg(edited)]),s=f.api.createStoredHistorySession(f.options);
 await s.search(query);f.setRaw('[]');
 const deleted=await s.search(query);assert.equal(deleted.ok,true);assert.equal(deleted.matches.length,0);
 f.setRaw(JSON.stringify([msg(edited)]));assert.equal((await s.search(query)).matches[0].content,edited);
});
for(const [label,value,reason] of [['corrupt','{bad','corrupt-history'],['missing',null,'primary-unavailable'],['invalid shape','{}','corrupt-history']]){
 test(label+' primary refuses stale index',async()=>{
  const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);
  await s.search(query);f.setRaw(value);assert.equal((await s.search(query)).reason,reason);
 });
}
test('storage read failure cannot return cached source',async()=>{
 const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);
 await s.search(query);f.block();assert.equal((await s.search(query)).reason,'storage-unavailable');
});
test('role/account scope mismatch refuses search',async()=>{
 const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);
 await s.search(query);f.setRole('r2');assert.equal((await s.search(query)).reason,'stale-scope');
 f.setRole('r1');f.window.__MAO_ACCOUNT_SCOPE__={ready:true,accountId:'fixture-b',role:'user'};
 assert.equal((await s.search(query)).reason,'stale-scope');
});
test('pagehide disposes and removes listeners',async()=>{
 const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);await s.search(query);
 f.events.get('pagehide')();assert.equal(f.events.size,0);assert.equal((await s.search(query)).reason,'stale-scope');
});
test('account-scoped storage event cancels pending build',async()=>{
 const f=fixture(Array.from({length:300},()=>msg(old)));
 const s=f.api.createStoredHistorySession({...f.options,yieldControl:async()=>f.events.get('storage')({key:'__mao_account_v1__fixture-a__chat_history_r1'})});
 assert.equal((await s.search(query)).reason,'stale-scope');
});
test('same-tab edit during construction detected without storage event',async()=>{
 const f=fixture(Array.from({length:300},()=>msg(old)));
 const s=f.api.createStoredHistorySession({...f.options,yieldControl:async()=>f.setRaw(JSON.stringify(Array.from({length:300},()=>msg(edited))))});
 assert.equal((await s.search(query)).reason,'stale-scope');
});
test('missing account ready flag never reads source',()=>{
 const f=fixture([msg(old)]);delete f.window.__MAO_ACCOUNT_SCOPE__;
 assert.equal(f.api.createStoredHistorySession(f.options).reason,'invalid-scope');assert.equal(f.reads(),0);
});
test('inactive page never reads source',()=>{
 const f=fixture([msg(old)]);f.setPage(false);
 assert.equal(f.api.createStoredHistorySession(f.options).reason,'invalid-scope');assert.equal(f.reads(),0);
});
test('concurrent queries share the same pending index build',async()=>{
 const f=fixture(Array.from({length:300},(_,i)=>msg(i===0?old:'普通日常记录内容')));
 const s=f.api.createStoredHistorySession(f.options);
 const [a,b]=await Promise.all([s.search(query),s.search(query)]);
 assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(f.yields(),1);
});
test('invalidated generation cannot return another generation result',async()=>{
 const f=fixture([msg(old)]),s=f.api.createStoredHistorySession(f.options);
 await s.search(query);
 const pending=s.search(query);s.invalidate();f.setRaw(JSON.stringify([msg(edited)]));
 const newer=s.search(query);
 assert.equal((await pending).reason,'stale-scope');
 assert.equal((await newer).matches[0].content,edited);
});
