import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../inspect-phone/inspect-life-clock.js',import.meta.url),'utf8');
const feature=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const run=()=>{
  const window={};vm.runInNewContext(source,{window,Date,Math,Number,String,Array,Object});
  return window.InspectPhoneLifeClock;
};
const at=(d,time='09:00')=>new Date(d+'T'+time+':00').getTime();
function story(roleId){
 const contacts=[{id:'user',name:'你',messages:[{side:'me',text:'人工写的记录不能消失',time:at('2026-11-01')-30000,origin:'player_as_role'}]},
   {id:'c2',name:'同事小林',messages:[{side:'ai',text:'我们上次的聊天还在',time:at('2026-11-01')-10000}],lastTime:at('2026-11-01'),unread:0}];
 return {schema:1,roleId,facts:[],source:{},sections:{
   chat:{contacts},notes:{notes:[],locked:[]},
   wallet:{transactions:[],balance:2000},map:{stops:[]},
   album:{photos:[],hidden:[]},moments:{moments:[]},forum:{posts:[]}
 }};
}

test('首次打开只记录时间锚点，不伪造过去几天已在云端运行',()=>{
 const clock=run(),s=story('roleA');
 const r=clock.advance(s,{name:'林禾',occupation:'图书编辑'},new Date(at('2026-11-01')));
 assert.equal(r.initialized,true);
 assert.equal(r.added,0);
 assert.equal(s.facts.length,0);
 assert.equal(s.lifeClock.mode,'catch-up-on-open');
});

test('三天没打开后补齐离线剧情，每一个事件跨七个板块引用同一事实ID',()=>{
 const clock=run(),s=story('roleA'),role={name:'林禾',occupation:'图书编辑'};
 clock.advance(s,role,new Date(at('2026-11-01')));
 const r=clock.advance(s,role,new Date(at('2026-11-04')));
 assert.equal(r.added,3);
 assert.equal(s.facts.length,3);
 assert.equal(s.lifeClock.episodes,3);
 const ids=s.facts.map(x=>x.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(s.facts.every(x=>x.time<=at('2026-11-04')&&x.amount<0));
 for(const id of ids){
   const fact=s.facts.find(x=>x.id===id);
   const tx=s.sections.wallet.transactions.find(x=>x.storyEventId===id);
   const map=s.sections.map.stops.find(x=>x.storyEventId===id);
   const image=s.sections.album.photos.find(x=>x.storyEventId===id);
   assert.ok(tx&&map&&image,'缺失共享事件链 '+id);
   assert.equal(tx.merchant,fact.place);
   assert.equal(map.place,fact.place);
   assert.equal(tx.amount,fact.amount);
   assert.equal(tx.time,fact.time);
   assert.equal(map.arrival,fact.time);
   assert.equal(image.time,fact.time+8*60000);
   assert.equal(s.sections.notes.notes.filter(x=>x.storyEventId===id).length,1);
   assert.equal(s.sections.moments.moments.filter(x=>x.storyEventId===id).length,1);
   assert.equal(s.sections.forum.posts.filter(x=>x.storyEventId===id).length,1);
   assert.equal(s.sections.chat.contacts[1].messages.filter(x=>x.storyEventId===id).length,2);
 }
});

test('重复查看与刷新不产生相同情节，旧消息和锁定日记保持原样',()=>{
 const clock=run(),s=story('r'),role={name:'小叶'};
 s.sections.notes.locked.push({title:'私人日记',text:'原来的秘密不能丢'});
 clock.advance(s,role,new Date(at('2026-11-01')));
 clock.advance(s,role,new Date(at('2026-11-05')));
 const old=JSON.stringify(s);
 const r=clock.advance(s,role,new Date(at('2026-11-05')));
 assert.equal(r.added,0);
 assert.ok(s.sections.chat.contacts[0].messages.some(x=>x.origin==='player_as_role'));
 assert.equal(s.sections.notes.locked[0].text,'原来的秘密不能丢');
 assert.equal(s.facts.length,4);
 assert.deepEqual(s.facts.map(x=>x.id),JSON.parse(old).facts.map(x=>x.id));
});

test('事件必须等当天内容发生完毕后才补录，不编造未来照片和帖子',()=>{
 const clock=run(),role={name:'林禾'},s=story('r');
 clock.advance(s,role,new Date(at('2026-11-01')));
 assert.equal(clock.advance(s,role,new Date(at('2026-11-01','21:30'))).added,0);
 assert.equal(clock.advance(s,role,new Date(at('2026-11-01','21:42'))).added,1);
 assert.ok(s.sections.forum.posts.every(x=>x.time<=at('2026-11-01','21:42')));
 assert.equal(clock.advance(s,role,new Date(at('2026-11-01','23:59'))).added,0);
});

test('跨角色不混内容，回拨时钟不会改写既有资料，长时间离线最多追赶7天',()=>{
 const clock=run(),a=story('roleA'),b=story('roleB'),role={name:'林禾'};
 clock.advance(a,role,new Date(at('2026-11-01')));
 clock.advance(b,role,new Date(at('2026-11-01')));
 clock.advance(a,role,new Date(at('2026-11-03')));
 assert.equal(b.facts.length,0);
 assert.notEqual(a.facts[0].id,b.roleId);
 assert.equal(clock.advance(a,role,new Date(at('2026-11-02'))).clockBackwards,true);
 assert.equal(a.facts.length,2);
 clock.advance(b,role,new Date(at('2026-12-01')));
 assert.ok(b.facts.length<=8);
 assert.ok(b.facts.length>=6);
});

test('真实手机加载了时间线模块，且主引擎在阅读角色数据后调用',()=>{
 assert.match(html,/inspect-life-clock\.js\?v=20261112v1/);
 assert.ok(html.indexOf('inspect-life-clock.js')<html.indexOf('inspect-feature.js'));
 assert.match(feature,/global\.InspectPhoneLifeClock\.advance\(data,role,now\)/);
 assert.match(sw,/inspect-life-clock\.js\?v=20261112v1/);
});


test('连续七天的虚构场景不重复，不因为刷新换一个故事',()=>{
 const clock=run(),s=story('sevenDayPersona'),role={name:'林禾',occupation:'图书编辑'};
 clock.advance(s,role,new Date(at('2026-11-01')));
 const r=clock.advance(s,role,new Date(at('2026-11-08')));
 assert.equal(r.added,7);
 assert.equal(s.facts.length,7);
 assert.equal(new Set(s.facts.map(x=>x.place)).size,7);
 const before=s.facts.map(x=>x.id+'|'+x.place);
 clock.advance(s,role,new Date(at('2026-11-08','09:05')));
 assert.deepEqual(s.facts.map(x=>x.id+'|'+x.place),before);
});

test('日记完整正文按角色身份处理，学生不会突然写下班经历',()=>{
 const clock=run(),s=story('studentRole');
 const role={name:'小叶',occupation:'在校大学生'};
 clock.advance(s,role,new Date(at('2026-11-01')));
 clock.advance(s,role,new Date(at('2026-11-08')));
 assert.equal(s.sections.notes.notes.length,7);
 assert.ok(s.sections.notes.notes.every(x=>x.text.length>40));
 assert.ok(s.sections.notes.notes.every(x=>!x.text.includes('下班后')));
});


test('真实页面挂载跨天以后会把累积的记录写入同一角色缓存',()=>{
 let fakeNow=at('2026-11-01');
 class ClockDate extends Date{
   constructor(...args){super(...(args.length?args:[fakeNow]));}
   static now(){return fakeNow;}
 }
 const storageData=new Map(),window={PhoneStorage:{getApiConfig(){return {};}}};
 const storage={getItem:k=>storageData.get(k)||null,setItem(k,v){storageData.set(k,String(v));}};
 function node(){return {innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(){}};}
 const document={querySelector(){return node();},getElementById(){return node();}};
 const runtime={window,document,localStorage:storage,Date:ClockDate,Math,JSON,Number,String,Array,Object,console};
 vm.runInNewContext(source,runtime);
 vm.runInNewContext(feature,runtime);
 const role={id:'integration',name:'小林',occupation:'大学生',description:'在校大学生'};
 function mount(){window.InspectPhoneFeature.mount({role,requestedId:role.id,appBody:node(),appTitle:node(),appLayer:node()});}
 mount();
 const key=window.InspectPhoneFeature.storyKey('integration');
 assert.equal(JSON.parse(storage.getItem(key)).lifeClock.episodes,0);
 fakeNow=at('2026-11-04');mount();
 const d=JSON.parse(storage.getItem(key));
 assert.equal(d.lifeClock.episodes,3);
 assert.equal(d.sections.notes.notes.filter(x=>x.origin==='autonomous_story').length,3);
 assert.equal(d.sections.forum.posts.filter(x=>x.origin==='autonomous_story').length,3);
 assert.equal(d.sections.chat.contacts[1].messages.filter(x=>x.origin==='autonomous_story').length,6);
 const original=JSON.stringify(d.sections.notes.notes);
 mount();
 assert.equal(JSON.stringify(JSON.parse(storage.getItem(key)).sections.notes.notes),original);
});
