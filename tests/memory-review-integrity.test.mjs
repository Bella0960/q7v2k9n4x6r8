import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/memory_recall.js',import.meta.url),'utf8');

const original={id:'m1',content:'咖啡不加糖',category:'preference',status:'fixed',sourceRoleId:'A',source:'manual',extra:'preserve'};
function fixture(initial=[],options={}){
 let raw=JSON.stringify(initial),writes=0,reads=0;
 const window={PhoneStorage:{getMemories:()=>JSON.parse(raw),saveMemories:(id,arr)=>{writes++;raw=JSON.stringify(arr);return true}}};
 if(options.rawStorage)window.localStorage={getItem:k=>{reads++;return options.onRead?options.onRead(k,reads,raw):k==='chat_memories_A'?raw:null},setItem:(k,v)=>{writes++;raw=v}};
 new Function('window',source)(window);
 return {api:window.MemoryRecall,records:()=>JSON.parse(raw),writes:()=>writes};
}
test('automatic memory marker cannot establish or pin a fact',()=>{
 const h=fixture([original]),r=h.api.upsertMemory('A',{content:'咖啡加糖',source:'ai-marker',status:'fixed'});
 assert.equal(r.ok,true);assert.equal(r.memory.status,'pending');assert.deepEqual(h.records()[0],original);
});
test('punctuation differences do not collapse distinct facts',()=>{
 const h=fixture([{...original,content:'编号 A-B',status:'confirmed',category:'detail'}]);
 assert.equal(h.api.upsertMemory('A',{content:'编号 AB'}).duplicate,false);assert.equal(h.records().length,2);
});
test('inferred pending record cannot reinforce a confirmed original',()=>{
 const h=fixture([{...original,content:'原始资料',source:'ai-marker',category:'detail',status:'confirmed'}]);
 const r=h.api.upsertMemory('A',{content:'原始资料',source:'ai-marker',status:'confirmed'});
 assert.equal(r.duplicate,false);assert.equal(r.memory.status,'pending');assert.equal(h.records()[0].reinforcementCount,undefined);
});
test('exact same source and review status reinforces existing candidate',()=>{
 const h=fixture(),p={content:'原始资料',source:'ai-marker'};
 assert.equal(h.api.upsertMemory('A',p).ok,true);
 const r=h.api.upsertMemory('A',p);assert.equal(r.duplicate,true);assert.equal(r.memory.reinforcementCount,2);assert.equal(h.records().length,1);
});
test('conflicting source anchor preserves original and stages pending',()=>{
 const a={...original,source:'chat-archive',sourceMessageTime:10,sourceMessageIndex:2,status:'confirmed',category:'detail'},h=fixture([a]);
 const r=h.api.upsertMemory('A',{content:'不同记录',source:'chat-archive',sourceMessageTime:10,sourceMessageIndex:2,status:'confirmed'});
 assert.equal(r.conflict,true);assert.equal(r.memory.status,'pending');assert.deepEqual(h.records()[0],a);
});
test('different source coordinates preserve independent records',()=>{
 const a={...original,source:'chat-archive',sourceMessageTime:10,sourceMessageIndex:2,status:'confirmed',category:'detail'},h=fixture([a]);
 const r=h.api.upsertMemory('A',{content:a.content,source:'chat-archive',sourceMessageTime:20,sourceMessageIndex:3});
 assert.equal(r.duplicate,false);assert.equal(r.conflict,false);assert.equal(h.records().length,2);
});
test('corrupt authoritative primary never becomes empty write',()=>{
 const h=fixture([],{rawStorage:true,onRead:()=>'{broken'});
 assert.equal(h.api.upsertMemory('A',{content:'new memory'}).reason,'read-failed');assert.equal(h.writes(),0);
});
test('changed snapshot rejects mutation before save',()=>{
 const h=fixture([original],{rawStorage:true,onRead:(k,n,raw)=>n===1?raw:'[]'});
 assert.equal(h.api.upsertMemory('A',{content:'new memory'}).reason,'stale-memory');assert.equal(h.writes(),0);
});
test('overlong input rejected rather than silently truncated',()=>{
 const h=fixture([original]);assert.equal(h.api.upsertMemory('A',{content:'甲'.repeat(601)}).reason,'content-too-long');assert.equal(h.writes(),0);
});
test('capacity never evicts original records',()=>{
 const h=fixture(Array.from({length:300},(_,i)=>({...original,id:'m'+i,content:'old'+i})));
 assert.equal(h.api.upsertMemory('A',{content:'new'}).reason,'capacity');assert.equal(h.writes(),0);
});
test('correction preview links original without writing',()=>{
 const h=fixture([original]),r=h.api.planMemoryCorrection('A',h.records(),original,'咖啡改成不加奶');
 assert.equal(r.ok,true);assert.equal(r.requiresReview,true);assert.equal(r.candidate.status,'pending');assert.deepEqual(r.candidate.sourceMemoryIds,['m1']);assert.deepEqual(h.records()[0],original);assert.equal(h.writes(),0);
});
test('stale or foreign correction rejected',()=>{
 const h=fixture([original]);assert.equal(h.api.planMemoryCorrection('A',h.records(),{...original,content:'stale'},'new').reason,'stale-memory');assert.equal(h.api.planMemoryCorrection('B',h.records(),original,'new').reason,'invalid-scope');
});
test('invalid stored entry cannot be silently discarded',()=>{
 const h=fixture([null]);assert.equal(h.api.upsertMemory('A',{content:'new'}).reason,'invalid-existing-data');assert.equal(h.writes(),0);
});
