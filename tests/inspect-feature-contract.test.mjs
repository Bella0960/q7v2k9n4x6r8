import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const shell=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');

function setup() {
  const store=new Map();
  const storage={
    getItem(key){return store.has(key)?store.get(key):null;},
    setItem(key,value){store.set(key,String(value));},
    removeItem(key){store.delete(key);}
  };
  function elem(){
    return {innerHTML:'',textContent:'',scrollTop:0,addEventListener(){},classList:{add(){},remove(){}}};
  }
  const appBody=elem(),appLayer=elem(),appTitle=elem();
  const doc={querySelector(){return elem();},getElementById(){return elem();}};
  const window={PhoneStorage:{getApiConfig(){return {};}}};
  vm.runInNewContext(src,{window,localStorage:storage,document:doc,Date,Math,JSON,Number,String,Array,Object,console,prompt(){return null;}});
  function mount(role){
    window.InspectPhoneFeature.mount({role,requestedId:String(role.id),appBody,appLayer,appTitle});
    return JSON.parse(storage.getItem(window.InspectPhoneFeature.storyKey(String(role.id))));
  }
  return {window,store,mount,appBody,appLayer,appTitle};
}

test('查手机入口依然保留原锁屏交互和角色选择',()=>{
  assert.match(shell,/inspect-feature\.js\?v=/);
  assert.match(shell,/SWIPE_UP_THRESHOLD_PX = 36/);
  assert.match(shell,/touch-action:none/);
  assert.match(shell,/InspectPhoneFeature\.onUnlock/);
  assert.match(shell,/InspectPhoneFeature\.mount/);
});

test('八板块+论坛拥有完整的本地虚构剧情样例与共享时间线',()=>{
  const {window,mount}=setup();
  const s=mount({id:'role-1',name:'小叶',description:'大学生，花钱谨慎'});
  assert.equal(window.InspectPhoneFeature.defaultItems.length,10);
  assert.equal(s.sections.chat.contacts.length>=5,true);
  assert.equal(s.sections.chat.contacts.every(c=>c.name&&c.messages.length>=8),true);
  assert.equal(s.sections.moments.moments.length>=3,true);
  assert.equal(s.sections.browser.searchHistory.length>=5,true);
  assert.equal(s.sections.browser.searchHistory.some(x=>x.deleted),true);
  assert.equal(s.sections.browser.bookmarks.length>=2,true);
  assert.equal(s.sections.notes.notes.length>=3,true);
  assert.equal(s.sections.notes.locked.length>=2,true);
  assert.equal(s.sections.wallet.transactions.filter(t=>t.amount<0).length>=5,true);
  assert.equal(s.sections.wallet.transactions.filter(t=>t.amount>0).length>=1,true);
  assert.equal(s.sections.music.recent.length>=5,true);
  assert.equal(s.sections.music.playlists.length>=2,true);
  assert.equal(s.sections.map.stops.length>=3,true);
  assert.equal(s.sections.album.photos.length>=5,true);
  assert.equal(s.sections.album.hidden.length>=3,true);
  assert.equal(s.sections.device.apps.length>=5,true);
  assert.equal(s.sections.forum.posts.length>=3,true);
  assert.equal(s.facts.length,4);
  assert.ok(s.facts.every((f,i)=>f.time<=Date.now()&&(i===0||f.time>s.facts[i-1].time)));
  assert.equal(s.sections.map.stops[1].place,s.facts[1].place);
  assert.equal(s.sections.wallet.transactions[1].merchant,s.facts[1].place);
  assert.equal(s.sections.album.photos[1].time,s.facts[1].time);
  assert.ok(s.sections.chat.contacts[0].messages.some(m=>m.status==='read_no_reply'));
  assert.ok(s.sections.chat.contacts[0].messages.some(m=>m.status==='recalled'));
});

test('不同角色独立保存，不覆盖同名角色或旧聊天钱包真实数据',()=>{
  const {store,mount,window}=setup();
  const a=mount({id:'a',name:'小叶',description:'学生'});
  const b=mount({id:'b',name:'小叶',description:'公司设计师'});
  assert.notEqual(window.InspectPhoneFeature.storyKey('a'),window.InspectPhoneFeature.storyKey('b'));
  assert.notEqual(a.sections.wallet.transactions[0].amount,b.sections.wallet.transactions[0].amount);
  assert.equal(a.roleId,'a');
  assert.equal(b.roleId,'b');
  assert.equal(store.has('chat_history_a'),false);
  assert.equal(store.has('finance_records'),false);
  assert.equal(store.has('phone_data_v2'),false);
});

test('许可与锁定内容有角色判断，不是真实设备安全机制',()=>{
  const {window}=setup();
  const api=window.InspectPhoneFeature;
  assert.equal(api.access({name:'甲',relationship:'陌生人'},new Date('2026-11-11T12:00:00')).decision,'拒绝');
  assert.equal(api.access({name:'甲',relationship:'朋友'},new Date('2026-11-11T12:00:00')).decision,'同意');
  assert.equal(api.access({name:'甲',relationship:'朋友',personality:'很有戒备心'},new Date('2026-11-11T12:00:00')).decision,'犹豫');
  assert.equal(api.hiddenPin('a'),api.hiddenPin('a'));
  assert.notEqual(api.hiddenPin('a'),api.hiddenPin('b'));
  assert.equal(typeof api.detection(120,true,1,2).caught,'boolean');
});

test('单板块更新的数据需具备足够记录，拒绝未来时间与不完整内容',()=>{
  const {window}=setup();const api=window.InspectPhoneFeature;
  const now=Date.now();
  assert.equal(api.valid('chat',{contacts:[{name:'同学',messages:[]}]},now),false);
  assert.equal(api.valid('album',{photos:[{description:'仅一张'}],hidden:[]},now),false);
  assert.equal(api.valid('forum',{posts:[{title:'甲',time:now+86400000},{title:'乙',time:now},{title:'丙',time:now}]},now),false);
  assert.ok(api.promptFor('notes',{name:'小叶',description:'工程师'},{
    facts:[{id:'e1',time:now,place:'公司',event:'加班'}],
    sections:{notes:{notes:[]}}
  },now).includes('单板块刷新不能修改其他板块'));
});
