import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../worldbook/characters/js/character-ai-drafts.js',import.meta.url),'utf8');
const parserSource=readFileSync(new URL('../worldbook/characters/js/character-ai-json.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
test('life AI click makes one model request and visibly fills every event field',async()=>{
  const ids=['btnAiLife','btnAiNpc','btnAiRelationships','lifeAiStatus','lifeEventTitle','lifeEventDate','lifeEventPeople','lifeEventStatus','lifeEventDetail'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,addEventListener(_,cb){this.click=cb;},scrollIntoView(){this.scrolled=true;}}]));
  nodes.lifeEventTitle.value='旧草稿';
  const local=new Map();let requests=0,confirmations=0,writes=0;
  const win={PhoneStorage:{getApiConfig:()=>({apiKey:'test-key',model:'test-model'})},
    PhoneAPI:{completeJSON:async()=>{requests++;return {ok:true,data:{title:'新活动',date:'2026-11-23',people:['小林','小王'],status:'ongoing',detail:'展览准备'}};}},
    localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)},
    confirm:()=>{confirmations++;return true;}};
  const ctx=vm.createContext({window:win,document:{getElementById:id=>nodes[id]||null},
    getActiveProfileRole:()=>({id:'role-A',name:'测试角色',npcCharacters:[],lifeEvents:[]}),
    saveActiveRoleMutation:()=>{writes++;return true;},loadWorldBooks:()=>[]});
  vm.runInContext(parserSource,ctx);
  vm.runInContext(source,ctx);
  assert.equal(typeof nodes.btnAiLife.click,'function');
  nodes.btnAiLife.click();for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(requests,1);assert.equal(confirmations,1);assert.equal(writes,0);
  assert.equal(nodes.lifeEventTitle.value,'新活动');
  assert.equal(nodes.lifeEventDate.value,'2026-11-23');
  assert.equal(nodes.lifeEventPeople.value,'小林、 小王'.replace('、 ','、'));
  assert.equal(nodes.lifeEventStatus.value,'ongoing');
  assert.equal(nodes.lifeEventDetail.value,'展览准备');
  assert.equal(nodes.lifeEventTitle.scrolled,true);
  assert.match(nodes.lifeAiStatus.textContent,/已生成生活事件草稿/);
  nodes.btnAiLife.click();for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(requests,1,'cooldown blocks accidental paid repeat');
});
test('life result indicator is near page introduction, not below the editing form',()=>{
  const life=page.slice(page.indexOf('id="lifeView"'),page.indexOf('<!-- 角色卡编辑/新增界面 -->'));
  assert.ok(life.indexOf('id="lifeAiStatus"')<life.indexOf('id="lifeEventTitle"'));
  assert.match(life,/id="btnAiLife"/);
});
