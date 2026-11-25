import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../shared/js/phone/memory_recall.js', import.meta.url), 'utf8');

function fixture() {
  const window = { setTimeout };
  new Function('window', source)(window);
  const scope = { kind:'role', accountId:'fixture-a', conversationId:'role-a', revision:'v1' };
  let current = { ...scope }, yields = 0;
  return {
    recall:window.MemoryRecall, scope,
    change:value => { current = value; },
    options: { scope, getCurrentScope:()=>current, yieldControl:async()=>{ yields++; } },
    yields:()=>yields
  };
}
const message = (text,extra={}) => ({role:'sent',text,...extra});
const keyword = '蓝鲸观测预约编号';
const unique = keyword + '已确认';
const filler = '普通日常记录内容';

test('index reaches old source in 100000 synthetic messages, with bounded candidate recall', async () => {
  const f=fixture();
  const history=Array.from({length:100000},(_,i)=>message(i===17?unique:filler));
  const index=await f.recall.createHistoryIndex(history,f.options);
  assert.equal(index.ok,true);
  assert.equal(index.historyLength,100000);
  assert.equal(index.indexedMessages,100000);
  assert.ok(f.yields()>0);
  const result=index.search(keyword,{scope:f.scope});
  assert.equal(result.ok,true);
  assert.equal(result.candidateCount,1);
  assert.equal(result.matches[0].index,17);
  assert.equal(result.matches[0].content,unique);
  assert.equal(f.recall.searchHistoryMessages(history,keyword).length,0);
  assert.equal(index.search('普通日常记录',{scope:f.scope}).reason,'query-too-broad');
  index.dispose();
});
test('revision change invalidates and releases the index', async () => {
  const f=fixture(), index=await f.recall.createHistoryIndex([message(unique)],f.options);
  f.change({...f.scope,revision:'v2'});
  assert.equal(index.search(keyword,{scope:f.scope}).reason,'stale-scope');
  assert.equal(index.search(keyword,{scope:f.scope}).reason,'disposed');
});
test('different account cannot use the same role index', async () => {
  const f=fixture(), index=await f.recall.createHistoryIndex([message(unique)],f.options);
  assert.equal(index.search(keyword,{scope:{...f.scope,accountId:'other'}}).reason,'stale-scope');
});
test('different conversation cannot use the index', async () => {
  const f=fixture(), index=await f.recall.createHistoryIndex([message(unique)],f.options);
  assert.equal(index.search(keyword,{scope:{...f.scope,conversationId:'other'}}).reason,'stale-scope');
});
test('wrong-role, group, private, silent and failed source messages excluded', async () => {
  const f=fixture();
  const history=[message(unique),message(unique,{sourceRoleId:'other'}),message(unique,{roleId:'other'}),message(unique,{groupId:'g'}),message(unique,{memberId:'role-a'}),message(unique,{type:'group_private'}),message(unique,{visibility:'role_only'}),message(unique,{silent:true}),message(unique,{sendFailed:true})];
  const index=await f.recall.createHistoryIndex(history,f.options);
  assert.equal(index.indexedMessages,1);
  assert.equal(index.search(keyword,{scope:f.scope}).matches[0].index,0);
});
test('recent exclusion preserves source coordinates',async()=>{
  const f=fixture(),index=await f.recall.createHistoryIndex([message(unique),message(''),message(keyword+'已取消')],f.options);
  const result=index.search(keyword,{scope:f.scope,excludeRecent:1});
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].index,0);
});
test('account switch during asynchronous build fails closed',async()=>{
  const f=fixture();
  const index=await f.recall.createHistoryIndex(Array.from({length:300},()=>message(filler)),{...f.options,yieldControl:async()=>{f.change({...f.scope,accountId:'other'});}});
  assert.equal(index.reason,'stale-scope');
});
test('cancellation during build fails closed',async()=>{
  const f=fixture(),signal={aborted:false};
  const index=await f.recall.createHistoryIndex(Array.from({length:300},()=>message(filler)),{...f.options,signal,yieldControl:async()=>{signal.aborted=true;}});
  assert.equal(index.reason,'stale-scope');
});
test('group scope and missing authority rejected',async()=>{
  const f=fixture();
  assert.equal((await f.recall.createHistoryIndex([],{...f.options,scope:{...f.scope,kind:'group'}})).reason,'invalid-scope');
  assert.equal((await f.recall.createHistoryIndex([],{scope:f.scope})).reason,'invalid-scope');
});
test('explicit disposal denies subsequent search',async()=>{
  const f=fixture(),index=await f.recall.createHistoryIndex([message(unique)],f.options);
  index.dispose();
  assert.equal(index.search(keyword,{scope:f.scope}).reason,'disposed');
});
test('history resource cap never returns incomplete index as successful',async()=>{
  const f=fixture();
  assert.equal((await f.recall.createHistoryIndex(new Array(100001),f.options)).reason,'history-limit');
});
test('mutable caller scope cannot widen the captured conversation during build',async()=>{
  const f=fixture(),snapshot={...f.scope};
  const history=Array.from({length:300},(_,i)=>message(i===299?unique:filler,i===299?{sourceRoleId:'other'}:{}));
  const index=await f.recall.createHistoryIndex(history,{...f.options,yieldControl:async()=>{f.scope.conversationId='other';}});
  assert.equal(index.ok,true);
  assert.equal(index.indexedMessages,299);
  assert.equal(index.search(keyword,{scope:snapshot}).matches.length,0);
});
test('index is a read-only projection of source history',async()=>{
  const f=fixture(),history=[message(unique)];
  const before=JSON.stringify(history);
  const index=await f.recall.createHistoryIndex(history,f.options);
  index.search(keyword,{scope:f.scope});
  assert.equal(JSON.stringify(history),before);
});
