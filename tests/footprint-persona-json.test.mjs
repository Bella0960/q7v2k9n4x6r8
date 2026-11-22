import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../chat/footprint/footprint-ai.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../chat/footprint/footprint.html',import.meta.url),'utf8');
function module(){
  const win={};
  vm.runInNewContext(source,{window:win});
  return win.FootprintAI;
}
const programmer={
  id:'coder-a',name:'阿河',persona:'深夜写代码的程序员，不喜欢早起，下午两点才醒。',
  profession:'夜班软件工程师',personality:'慢热，吐槽时很直接',
  background:'正在赶一款独立游戏上线，住在深圳。',
  lifeLine:'每晚11点开始调试游戏，日出前收工。',
  lifeEvents:[{date:'2026-11-23',title:'新版本上线',detail:'凌晨要修复紧急兼容问题',status:'ongoing'}]
};
const cultivator={
  id:'cult-b',name:'玄青',persona:'云岚峰修仙门派首席弟子，遵循门规修习御剑术。',
  profession:'大师兄',background:'自幼在山门长大，从未到过现代城市。',
  lifeLine:'近来师尊闭关，需要守护山门。',
  lifeEvents:[{date:'2026-11-23',title:'秘境封印',detail:'晨钟之后巡查西崖阵法'}]
};
const night=[
 {time:'13:40',action:'起床，检查凌晨留下的错误日志',status:'睡得不够，脑子还没开机',thought:'昨天那行代码到底怎么过审的'},
 {time:'21:15',action:'修复独立游戏的崩溃问题',status:'极度专注',thought:'改完这一处就能发测试包'},
 {time:'02:25',action:'点外卖继续调试',status:'又饿又兴奋',thought:'今晚非把这个 bug 找出来不可'}
];
const fantasy=[
 {time:'05:20',action:'在祖师殿打坐调息',status:'心境平静',thought:'师尊交付的剑诀还需揣摩'},
 {time:'14:00',action:'巡查西崖护山法阵',status:'有一丝戒备',thought:'这道符纹为何暗了一角'},
 {time:'20:10',action:'在月下练剑',status:'神思清明',thought:'招式再快也不能乱了心'}
];
function store(seed='null'){
  const map=new Map();
  if(seed!=='null')map.set('footprint_coder-a',seed);
  return {
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,v),
    raw:k=>map.get(k), keys:()=>[...map.keys()]
  };
}

test('prompt includes current full persona, occupation, background, and live events without canned daily timetable',()=>{
 const api=module();
 const p=api.prompts(programmer,'2026-11-23');
 assert.match(p.user,/深夜写代码的程序员/);
 assert.match(p.user,/夜班软件工程师/);
 assert.match(p.user,/新版本上线/);
 assert.match(p.user,/凌晨要修复/);
 assert.match(p.user,/每晚11点开始调试/);
 assert.match(p.system,/"time":"HH:mm","action":"具体行动","status":"此刻的心情或状态","thought":"角色第一人称心声"/);
 assert.match(p.system,/不得强加早起/);
 assert.doesNotMatch(p.user,/祖师殿|剑诀/);
});
test('cultivator prompt contains sect lore without leaking programmer day and requires world consistency',()=>{
 const p=module().prompts(cultivator,'2026-11-23');
 assert.match(p.user,/修仙门派/);
 assert.match(p.user,/巡查西崖阵法/);
 assert.doesNotMatch(p.user,/独立游戏|深圳/);
 assert.match(p.system,/所在世界/);
});
test('complete clean JSON maps to all four fields, chronological order and same role/day',()=>{
 const ai=module(),parsed=ai.parse({ok:true,data:{entries:night}});
 assert.equal(parsed.length,3);
 assert.deepEqual(Array.from(parsed.map(x=>x.time)),['02:25','13:40','21:15']);
 const db=store();
 const saved=ai.writeDay(db,'coder-a','2026-11-23',parsed);
 assert.equal(saved.length,3);
 assert.equal(saved[0].action,'点外卖继续调试');
 assert.equal(saved[0].status,'又饿又兴奋');
 assert.equal(saved[0].thought,'今晚非把这个 bug 找出来不可');
 assert.equal(JSON.parse(db.raw('footprint_coder-a'))['2026-11-23'][0].origin,'character_ai_json_v1');
});
test('recover fenced JSON with prose and a trailing comma outside quoted text without inventing fields',()=>{
 const ai=module();
 const raw='返回数据：\n'+String.fromCharCode(96,96,96)+'json\n'+JSON.stringify({entries:fantasy}).replace(/\}\]$/, '},]')+'\n'+String.fromCharCode(96,96,96)+'\n无关文字';
 const parsed=ai.parse({ok:false,raw});
 assert.equal(parsed.length,3);
 assert.match(parsed[0].action,/打坐/);
 assert.match(parsed[1].action,/法阵/);
});
test('reject truncated data, invalid time, missing thought, extra prose, or generated generic list without proper JSON',()=>{
 const ai=module();
 for(const value of [
   {ok:false,raw:'08:00 | 起床 | 吃饭'},
   {ok:false,raw:'{"entries":[{"time":"08:00","action":"起床"'},
   {ok:true,data:{entries:fantasy.map((x,i)=>i===1?{...x,thought:''}:x)}},
   {ok:true,data:{entries:fantasy.map((x,i)=>i===1?{...x,time:'25:33'}:x)}},
   {ok:true,data:{entries:fantasy.slice(0,2)}}
 ]) assert.throws(()=>ai.parse(value));
});
test('saved old days and unrelated role records survive successful generation',()=>{
 const ai=module();
 const old=[{id:'old-foot',time:'16:00',title:'用户手写旧行程',desc:'不可删除'}];
 const db=store(JSON.stringify({'2026-11-22':old,'2026-11-23':[{id:'earlier'}]}));
 ai.writeDay(db,'coder-a','2026-11-23',night);
 assert.deepEqual(JSON.parse(db.raw('footprint_coder-a'))['2026-11-22'],old);
 assert.equal(JSON.parse(db.raw('footprint_coder-a'))['2026-11-23'].length,3);
 assert.equal(db.keys().length,1);
});
test('missing, malformed or permission denied storage fails closed and retains all original bytes',()=>{
 const ai=module();
 const damaged=store('{broken archive');
 assert.throws(()=>ai.writeDay(damaged,'coder-a','2026-11-23',night),/损坏/);
 assert.equal(damaged.raw('footprint_coder-a'),'{broken archive');
 const quota=store(JSON.stringify({'2026-11-22':[{id:'past'}]}));
 const baseline=quota.raw('footprint_coder-a');
 quota.setItem=()=>{throw new Error('QuotaExceededError');};
 assert.throws(()=>ai.writeDay(quota,'coder-a','2026-11-23',night));
 assert.equal(quota.raw('footprint_coder-a'),baseline);
 const races=store('{"2026-11-22":[]}');
 let calls=0;
 const originalRead=races.getItem;
 races.getItem=(key)=>{calls++;return calls===2?'{"new-data":"other tab"}':originalRead(key);};
 assert.throws(()=>ai.writeDay(races,'coder-a','2026-11-23',night),/其他页面/);
});
test('concurrent second-tab edit during paid model request refuses to overwrite anything',()=>{
 const ai=module();
 const db=store(JSON.stringify({'2026-11-22':[{id:'history'}]}));
 const captured=db.getItem('footprint_coder-a');
 const other=JSON.stringify({'2026-11-22':[{id:'history'}],'2026-11-23':[{id:'other-tab'}]});
 db.setItem('footprint_coder-a',other);
 assert.throws(()=>ai.writeDay(db,'coder-a','2026-11-23',night,captured),/其他页面/);
 assert.equal(db.raw('footprint_coder-a'),other);
});
test('active API profile never borrows old mirror credentials from different account',()=>{
 const ai=module();
 const cfg=ai.selectedApi({
  getApiConfig:()=>({apiKey:'OLD',model:'old-model',baseUrl:'https://old.invalid/v1'}),
  getActiveProfileId:()=> 'new',
  getApiProfiles:()=>[{id:'new',apiKey:'NEW',model:'new-model',baseUrl:'https://new.invalid/v1'}]
 });
 assert.equal(cfg.apiKey,'NEW');
 assert.equal(cfg.model,'new-model');
 assert.equal(cfg.baseUrl,'https://new.invalid/v1');
 const incomplete=ai.selectedApi({
  getApiConfig:()=>({apiKey:'OLD',model:'old'}),
  getActiveProfileId:()=> 'new',
  getApiProfiles:()=>[{id:'new'}]
 });
 assert.equal(incomplete.apiKey,'');assert.equal(incomplete.model,'');
 assert.throws(()=>ai.selectedApi({getActiveProfileId:()=> 'gone',getApiProfiles:()=>[],getApiConfig:()=>({apiKey:'OLD'})}));
});
test('shipped footprint page contains no fabricated demo schedule, does not auto-call AI on load, and renders thought and status',()=>{
 assert.doesNotMatch(html,/generateDefaultFootprint|const DATA =/);
 assert.doesNotMatch(html,/07:30', title: '起床洗漱'/);
 assert.doesNotMatch(html,/setTimeout\(function\(\)\s*\{[^}]*refreshToday\(\)/);
 assert.match(html,/footprint-ai\.js\?v=20261123-persona-json-v1/);
 assert.match(html,/心声 · /);
 assert.match(html,/状态 · /);
 assert.match(html,/writeDay\(localStorage,requestRoleId,requestDate,entries\)/);
});
