import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const parserSource = readFileSync(new URL('../worldbook/characters/js/character-ai-json.js', import.meta.url), 'utf8');
const generatorSource = readFileSync(new URL('../worldbook/characters/js/character-ai-drafts.js', import.meta.url), 'utf8');

function parser() {
  const window = {};
  vm.runInNewContext(parserSource, {window});
  return window.CharacterAiJSON;
}
function setup(config, reply) {
  const ids = ['btnAiNpc','btnAiRelationships','btnAiLife','npcAiStatus','relationshipsAiStatus','lifeAiStatus',
    'npcId','npcName','lifeEventTitle','lifeEventPeople','lifeEventDetail','lifeEventStatus','lifeEventDate'];
  const nodes = Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,
    addEventListener(_type,fn){ this.click=fn; },scrollIntoView(){}}]));
  const storage = new Map();
  const calls = [], prompt = [], role = {
    id:'primary-A',name:'测试主角色',persona:'常和同事林青一起准备摄影展。',
    worldBookIds:[], npcCharacters:[],lifeEvents:[]};
  let saves = 0;
  const window = {
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    confirm:()=>true,
    PhoneStorage:{getApiConfig:()=>config},
    PhoneAPI:{completeJSON:async opts=>{calls.push(opts);prompt.push(opts.system);if(reply) return reply(opts);return {ok:true,data:{people:[{name:'林青',relation:'同事',background:'摄影展合作'}]}};}}
  };
  const context = vm.createContext({window,document:{getElementById:id=>nodes[id]||null},
    getActiveProfileRole:()=>role,loadWorldBooks:()=>[],
    saveActiveRoleMutation:fn=>{saves++;fn(role);return true;},renderRelationshipView:()=>{}});
  vm.runInContext(parserSource,context);
  vm.runInContext(generatorSource,context);
  return {nodes,calls,prompt,role,storage,window,get saves(){return saves;}};
}
async function settle() { for(let i=0;i<25;i++)await Promise.resolve(); }

test('recover one complete NPC from a truncated JSON wrapper without requesting again',()=>{
  const out=parser().fromCompletion({ok:false,
    raw:'{"people":[{"name":"林青","relation":"同事","background":"摄影展合作"}],"summary":"未写完'},'relationships');
  assert.equal(out.ok,true);
  assert.equal(out.data.people.length,1);
  assert.equal(out.data.people[0].name,'林青');
});
test('recover complete life event from incomplete outer JSON object',()=>{
  const out=parser().fromCompletion({ok:false,
    raw:'{"event":{"title":"筹备摄影展","people":"林青","detail":"挑选照片"},"note":"未结束'},'life');
  assert.equal(out.ok,true);assert.equal(out.data.title,'筹备摄影展');
});
test('do not salvage a name alone or create a fake person from incomplete data',()=>{
  assert.equal(parser().fromCompletion({ok:false,raw:'{"people":[{"name":"林青"}],"note":"未结束'},'relationships').ok,false);
});
test('block too-low explicit output budget BEFORE making any billable API request',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:128});
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,0);
  assert.match(x.nodes.relationshipsAiStatus.textContent,/还没有调用 API/);
  assert.equal(x.saves,0);
});
test('one compact relationship response preserves an existing persona name and saves once',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:1024});
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1);
  assert.equal(x.saves,1);
  assert.equal(x.role.npcCharacters[0].name,'林青');
  assert.match(x.prompt[0],/拟出 1 到 2 位/);
  assert.match(x.calls[0].user,/林青/);
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1,'cooldown never silently repeats a paid request');
});
test('long persona includes a named relationship from its middle without a second paid call',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:1024});
  x.role.persona = '普通成长经历。'.repeat(1000) + '\\n旧友苏禾是主角多年的朋友，经常一起旅行。\\n' + '其他日常设定。'.repeat(200);
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1);
  assert.match(x.calls[0].user,/苏禾/);
});
test('distinguish output truncation; do not write partial data or retry',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:1024},async opts=>{
    opts.onDiagnostic?.({stage:'response',finish:'length',characters:48,reasoningOnly:false});
    return {ok:false,raw:'{"people":[{"name":"林青","background":"文字未结束'};
  });
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1);
  assert.equal(x.saves,0);
  assert.match(x.nodes.relationshipsAiStatus.textContent,/输出长度限制截断/);
  assert.match(x.nodes.relationshipsAiStatus.textContent,/不会自动再次调用/);
});
test('life output with valid fields populates form once without automatic persistence',async()=>{
  const x=setup({apiKey:'mock',model:'mock'},async()=>({ok:true,data:{title:'准备摄影展',people:'林青',status:'planned',detail:'挑选作品'}}));
  x.nodes.btnAiLife.click();await settle();
  assert.equal(x.calls.length,1);assert.equal(x.saves,0);
  assert.equal(x.nodes.lifeEventTitle.value,'准备摄影展');
  assert.equal(x.nodes.lifeEventPeople.value,'林青');
  assert.match(x.nodes.lifeAiStatus.textContent,/已生成生活事件草稿/);
});

test('one brief AI response with only name and relationship saves useful NPC data',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:256},async()=>({
    ok:true,data:{people:[{name:'小安',relation:'高中同学'}]}
  }));
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1);
  assert.equal(x.saves,1);
  assert.equal(x.role.npcCharacters[0].name,'小安');
  assert.equal(x.role.npcCharacters[0].relation,'高中同学');
});
test('two short relationship candidates can save together without requiring 11 fields each',async()=>{
  const x=setup({apiKey:'mock',model:'mock',maxTokens:512},async()=>({
    ok:true,data:{people:[{name:'小安',relation:'同学'},{name:'阿青',relation:'同事'}]}
  }));
  x.nodes.btnAiRelationships.click();await settle();
  assert.equal(x.calls.length,1);
  assert.equal(x.role.npcCharacters.length,2);
});
test('extensible generator hook reuses one-call billing guard and role isolation',async()=>{
  const x=setup({apiKey:'mock',model:'mock'},async()=>({ok:true,data:{caption:'今天的故事'}}));
  const handled=[];
  assert.equal(x.window.CharacterWorldAI.registerKind('caption',{
    prompt:'给角色拟一句日常记录',
    statusId:'npcAiStatus',
    apply:(data,helpers)=>{ handled.push(data.caption);helpers.status('已生成扩展草稿'); }
  }),true);
  assert.equal(x.window.CharacterWorldAI.registerKind('relationships',{prompt:'绕过规则',apply:()=>{}}),false);
  const extra={disabled:false,textContent:'扩展生成'};
  await x.window.CharacterWorldAI.generate('caption',extra);
  assert.equal(x.calls.length,1);
  assert.deepEqual(handled,['今天的故事']);
  assert.equal(x.nodes.npcAiStatus.textContent,'已生成扩展草稿');
  await x.window.CharacterWorldAI.generate('caption',extra);
  assert.equal(x.calls.length,1,'extension cannot bypass shared rate limiter');
});
