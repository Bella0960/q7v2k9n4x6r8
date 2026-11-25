import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const storage=read("shared/js/phone/phone_storage.js");
const recall=read("shared/js/phone/memory_recall.js");
const chat=read("chat/chat/chat-detail.html");
const library=read("library/library.html");
const date=read("chat/date/date.html");
const context=read("shared/js/phone/phone_context.js");
const original={id:'m1',content:'原记录',status:'fixed',source:'manual',sourceRoleId:'A'};
class FixtureParams { constructor(value){this.value=value;} get(key){return key==='id'?this.value.replace('?id=',''):null;} }
class FixtureAbort { constructor(){this.signal={aborted:false};} abort(){this.signal.aborted=true;} }
function fixture(records=[original],opts={}){
 const map=new Map([['chat_memories_A',JSON.stringify(records)],['chat_history_A',JSON.stringify([{role:'sent',text:'周六去看展览'}])],['api_settings',JSON.stringify({apiKey:'fixture',baseUrl:'https://example.invalid/v1'})]]);
 let writes=0,requests=0;const messages=[];
 const localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(k==='chat_memories_A'){writes++;if(opts.drop)return;}map.set(k,String(v));},removeItem:k=>map.delete(k)};
 const window={localStorage,__MAO_ACCOUNT_SCOPE__:{accountId:'fixture',ready:true}};
 new Function('window','localStorage',storage)(window,localStorage);
 new Function('window',recall)(window);
 const start=chat.indexOf('  async function doSummarize()'),end=chat.indexOf("  btnDismiss.addEventListener('click', snooze);",start);
 const location={search:'?id=A'},btnConfirm={},overlay={style:{}};
 const run=new Function('window','localStorage','location','URLSearchParams','rid','btnConfirm','overlay','sumToast','getProcessedCount','getInterval','AbortController','setTimeout','clearTimeout','fetch','friendlyHttpError',chat.slice(start,end)+'\nreturn doSummarize;');
 const summarize=run(window,localStorage,location,FixtureParams,'A',btnConfirm,overlay,x=>messages.push(x),()=>Number(map.get('chat_summary_processed_A')||0),()=>20,FixtureAbort,()=>1,()=>{},async(url,init)=>{
 requests++;if(opts.edit)map.set('chat_history_A',JSON.stringify([{role:'sent',text:'周日去看展览'}]));
 return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(opts.items??[{content:'计划去看展览',importance:5}])}}]})};
 },()=> '失败');
 return {window,map,summarize,messages,writes:()=>writes,requests:()=>requests,records:()=>JSON.parse(map.get('chat_memories_A'))};
}
const item={content:'新增资料',importance:5},range={start:0,end:19};
test('batch retains originals and inserts only pending records',()=>{const f=fixture();const r=f.window.MemoryRecall.appendPendingSummary('A',[item,{content:'另一条资料'}],range);assert.equal(r.ok,true);assert.equal(r.added,2);assert.equal(f.writes(),1);assert.deepEqual(f.records()[0],original);assert.ok(f.records().slice(1).every(m=>m.status==='pending'));});
test('retry of same source batch is idempotent',()=>{const f=fixture();f.window.MemoryRecall.appendPendingSummary('A',[item],range);const r=f.window.MemoryRecall.appendPendingSummary('A',[item],range);assert.equal(r.duplicates,1);assert.equal(f.writes(),1);});
test('capacity rejects entire batch without eviction',()=>{const f=fixture(Array.from({length:299},(_,i)=>({...original,id:'m'+i})));const r=f.window.MemoryRecall.appendPendingSummary('A',[item,{content:'另一条'}],range);assert.equal(r.reason,'capacity');assert.equal(f.writes(),0);assert.equal(f.records().length,299);});
test('malformed item cannot partially write',()=>{const f=fixture();assert.equal(f.window.MemoryRecall.appendPendingSummary('A',[item,{content:''}],range).reason,'invalid-item');assert.equal(f.writes(),0);});
test('AI marker cannot auto confirm',()=>{const f=fixture();assert.equal(f.window.MemoryRecall.upsertMemory('A',{content:'新增',source:'ai-marker',status:'confirmed'}).memory.status,'pending');});
test('corrupt primary blocks fallback and write',()=>{const f=fixture();f.map.set('chat_memories_A','{bad');f.map.set('phone_data_v2',JSON.stringify({A:{memories:{items:[original]}}}));assert.deepEqual(f.window.PhoneStorage.getMemories('A'),[]);assert.equal(f.window.PhoneStorage.saveMemories('A',[]),false);assert.equal(f.map.get('chat_memories_A'),'{bad');});
test('active projection excludes pending, revisions, foreign data',()=>{const f=fixture([original,{...original,id:'m2',status:'pending'},{...original,id:'m3',status:'superseded-fixed'},{...original,id:'m4',status:'withdrawn'},{...original,id:'m5',sourceRoleId:'B'},{...original,id:'m6',roleId:'B'}]);assert.deepEqual(f.window.PhoneStorage.getActiveMemories('A'),[original]);assert.equal(f.records().length,6);});
test('actual summary handler advances only after confirmed full write',async()=>{const f=fixture();await f.summarize();assert.equal(f.map.get('chat_summary_processed_A'),'1');assert.equal(f.records()[1].status,'pending');assert.equal(f.requests(),1);});
test('actual summary handler keeps cursor and original on dropped write',async()=>{const f=fixture([original],{drop:true});await f.summarize();assert.equal(f.map.has('chat_summary_processed_A'),false);assert.deepEqual(f.records(),[original]);});
test('actual summary handler rejects edited source during API request',async()=>{const f=fixture([original],{edit:true});await f.summarize();assert.equal(f.map.has('chat_summary_processed_A'),false);assert.equal(f.writes(),0);});
test('actual summary handler rejects invalid batch with no cursor advance',async()=>{const f=fixture([original],{items:[item,{content:''}]});await f.summarize();assert.equal(f.map.has('chat_summary_processed_A'),false);assert.equal(f.writes(),0);});
test('actual summary handler does not evict full memory store',async()=>{const f=fixture(Array.from({length:300},(_,i)=>({...original,id:'m'+i})));await f.summarize();assert.equal(f.map.has('chat_summary_processed_A'),false);assert.equal(f.writes(),0);});
test('consumer contracts use active projection rather than raw memory list',()=>{assert.ok(library.includes('PhoneStorage.getActiveMemories(String(roleId))'));assert.ok(context.includes('Storage.getActiveMemories(String(contactId))'));assert.ok(date.includes('_storage.selectActiveMemories(allMemories, String(roleId))'));assert.ok(chat.includes('_storage.selectActiveMemories(allMemories, String(roleId))'));});
