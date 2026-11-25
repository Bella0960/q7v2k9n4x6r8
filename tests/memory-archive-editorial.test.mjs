import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../worldbook/memory/memory.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../shared/js/phone/memory_space_v2.js',import.meta.url),'utf8');
function excerpt(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+1);assert.ok(a>=0&&b>a);return s.slice(a,b);}
const lib=excerpt(page,'    let renderedLibraryRole','    // ---- 手动总结 ----');
const handler=excerpt(page,'    // 记忆库操作（事件委托）','    // 记忆工具\n');
function libraryFixture(){
  let records=[{id:'a',content:'one',status:'confirmed'},{id:'b',content:'two',status:'fixed'}], click, writes=0;
  const list={innerHTML:'',addEventListener:(type,fn)=>{click=fn}};
  const make=new Function('document','loadMemories','saveMemories','refreshLibSub','escapeHtml','STATUS_LABEL','CAT_LABEL','alert','confirm','currentMemId',lib+'\n'+handler+'\nreturn {renderLib};');
  const api=make({getElementById:()=>list},()=>JSON.parse(JSON.stringify(records)),(id,x)=>{assert.equal(id,'role-a');writes++;records=x;return true},()=>{},s=>s,{}, {},()=>{},()=>true,'role-a');
  api.renderLib();
  return {list,records:()=>records,writes:()=>writes,change:()=>{records[1].content='changed'},click:(act,i)=>click({target:{closest:()=>({getAttribute:k=>k==='data-act'?act:String(i)})}})};
}
test('fixed memory is displayed first and uses original storage index',()=>{const f=libraryFixture();assert.ok(f.list.innerHTML.indexOf('two')<f.list.innerHTML.indexOf('one'));f.click('unfix',1);assert.equal(f.writes(),1);assert.equal(f.records()[0].status,'confirmed');assert.equal(f.records()[1].status,'confirmed');});
test('a stale memory row cannot delete a changed record',()=>{const f=libraryFixture();f.change();f.click('del',1);assert.equal(f.writes(),0);assert.equal(f.records().length,2);});
const archive=excerpt(js,'  function onRememberClick(','  function init()');
const identity=excerpt(js,'  function msgRole(','  function addStyles(');
const make=new Function('roleId','fullHistory','getActive','readHistory','readMemories','window','renderTimeline','updateDashboard','msgText',identity+'\n'+archive+'\nreturn onRememberClick');
const cases=[
 ['user candidate confirmed','rA','rA','sent',false,0,false,'confirmed'],
 ['AI candidate requires review','rA','rA','assistant',false,0,false,'pending'],
 ['changed role blocks promotion','rA','rB','sent',false,0,false,null],
 ['changed source blocks promotion','rA','rA','sent',true,0,false,null],
 ['group direct promotion blocked','g1','g1','sent',false,0,false,null],
 ['unknown sender blocked','rA','rA','npc',false,0,false,null],
 ['capacity cannot evict old memory','rA','rA','sent',false,300,false,null],
 ['duplicate cannot overwrite source','rA','rA','sent',false,1,true,null]
];
for(const [name,id,active,role,changed,n,dup,expected] of cases){
 test(name,()=>{
  const writes=[];let redraw=0;const m={role,text:'source text',time:1};
  const list=Array.from({length:n},(_,i)=>({content:dup?'source text':'other '+i}));
  const button={disabled:false,textContent:'',getAttribute:()=> '0'};
  const run=make(id,[m],()=>({id:active}),()=>[{...m,text:changed?'changed':'source text'}],()=>list,{MemoryRecall:{normalize:s=>s.trim().toLowerCase(),upsertMemory:(roleId,input)=>{writes.push({roleId,input});return{ok:true}}}},()=>redraw++,()=>{},m=>m?.text||'');
  run({target:{closest:()=>button}});
  if(expected===null){assert.equal(writes.length,0);if(changed)assert.equal(redraw,1);}
  else{assert.equal(writes.length,1);assert.equal(writes[0].roleId,id);assert.equal(writes[0].input.status,expected);}
 });
}

test('desktop back uses native navigation and legacy global renderer is detached',()=>{
 assert.match(page, /<a class="mem-back back-btn" href="\.\.\/\.\.\/index\.html" aria-label="返回"/);
 assert.doesNotMatch(page,/src="\.\.\/\.\.\/shared\/js\/memory\.js/);
});
const summary=excerpt(page,'    async function runSummary(','    // ---- 记忆工具 ----');
const buildSummary=new Function('currentMemId','readHistory','getAiConfig','getSelectedCats','CAT_LABEL','sumConfig','document','alert','fetch','AbortController','setTimeout','clearTimeout','loadMemories','saveMemories','localStorage','refreshManual','renderLib',summary+'\nreturn runSummary');
for(const [name,role,sender,changed,oversized,expected] of [
 ['valid summary remains pending','r1','sent',false,false,true],
 ['changed source stops commit','r1','sent',true,false,false],
 ['unknown sender stops request','r1','npc',false,false,false],
 ['group stops request','g1','sent',false,false,false],
 ['oversized batch stops cursor','r1','sent',false,true,false]
]){
 test(name,async()=>{
  let source=[{role:sender,text:oversized?'a'.repeat(4100):'test source'}],calls=0,writes=0,cursor=0,mems=[];
  const orig=JSON.parse(JSON.stringify(source)),btn={textContent:'总结',disabled:false};
  const run=buildSummary(role,()=>source,()=>({apiKey:'synthetic'}),()=>['detail'],{detail:'细节'},{maxOutput:100},{getElementById:()=>btn},()=>{},async()=>{calls++;if(changed)source=[{role:sender,text:'changed'}];return {ok:true,json:async()=>({choices:[{message:{content:'[{"content":"synthetic candidate","category":"detail","importance":5}]'}}]})}},class{abort(){}},()=>1,()=>{},()=>[],(id,v)=>{writes++;mems=v;return true},{setItem:k=>{if(k.includes('processed'))cursor++}},()=>{},()=>{});
  await run(orig,true,1);
  if(expected){assert.equal(writes,1);assert.equal(mems[0].status,'pending');assert.equal(cursor,1);}
  else{assert.equal(writes,0);assert.equal(cursor,0);assert.equal(calls,changed?1:0);}
 });
}
test('AI merge preserves originals and marks derived records pending',()=>{
 const merge=excerpt(page,'    async function doMerge()','    // ---- 折叠卡片 ----');
 assert.match(merge,/sourceMemoryIds: pool\.map/);
 assert.match(merge,/JSON\.stringify\(latestPool\) !== poolSnapshot/);
 assert.match(merge,/status: 'pending'/);
 assert.doesNotMatch(merge,/arr = arr\.filter/);
});
