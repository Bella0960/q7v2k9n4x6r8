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


function setupInteractive(role={id:'interactive-role',name:'测试',relationship:'朋友'},apiKey=false) {
  const store=new Map(),handlers={};
  let failWrites=false;
  const storage={
    getItem(key){return store.has(key)?store.get(key):null;},
    setItem(key,value){if(failWrites)throw new Error('quota exceeded');store.set(key,String(value));},
    removeItem(key){store.delete(key);}
  };
  const node=name=>({
    name,innerHTML:'',textContent:'',scrollHeight:550,scrollTop:0,
    classList:{add(){},remove(){}},
    addEventListener(event,handler){handlers[name+':'+event]=handler;}
  });
  const grid=node('grid'),dock=node('dock'),back=node('back'),
    appBody=node('appBody'),appLayer=node('appLayer'),appTitle=node('appTitle');
  const document={
    querySelector(selector){return selector==='.grid'?grid:dock;},
    getElementById(){return back;}
  };
  const window={
    PhoneStorage:{getApiConfig(){return apiKey?{apiKey:'test-only'}:{};}},
    PhoneAPI:{completeJSON:async()=>({ok:false}),complete:async()=>''}
  };
  vm.runInNewContext(src,{window,localStorage:storage,document,Date,Math,JSON,Number,String,Array,Object,console});
  const mount=()=>window.InspectPhoneFeature.mount({
    role,requestedId:String(role.id),appBody,appLayer,appTitle
  });
  const key=window.InspectPhoneFeature.storyKey(role.id);
  const read=()=>JSON.parse(storage.getItem(key));
  const action=id=>handlers['appBody:click']({
    target:{closest(sel){return sel==='[data-action]'?{dataset:{action:id}}:null;}}
  });
  const openApp=id=>handlers[(id==='chat'||id==='browser'?'dock':'grid')+':click']({
    target:{closest(sel){return sel==='[data-app]'?{dataset:{app:id}}:null;}}
  });
  const openContact=index=>handlers['appBody:click']({
    target:{closest(sel){return sel==='[data-detail]'?{dataset:{detail:'chat',index:String(index)}}:null;}}
  });
  const submitMessage=message=>handlers['appBody:submit']({
    target:{id:'inspectCompose',querySelector(){return {value:message};}},
    preventDefault(){}
  });
  const start=()=>{
    mount();window.InspectPhoneFeature.onUnlock();
    action('grant');action('all');action('start');
  };
  return {
    store,window,storage,appBody,appTitle,key,read,mount,start,
    action,openApp,openContact,submitMessage,
    setFailWrites(value){failWrites=value;}
  };
}

test('全部十个虚构板块的本地数据通过严格校验',()=>{
  const ui=setupInteractive();ui.start();
  const snapshot=ui.read(),now=Date.now();
  for(const [id,section] of Object.entries(snapshot.sections)){
    assert.equal(ui.window.InspectPhoneFeature.valid(id,section,now,snapshot.facts),true,
      id+' 样例不满足结构/时间/跨板块事实校验');
  }
});

test('跨天后聊天与用户选择不丢失，旧许可不自动延续',()=>{
  const ui=setupInteractive();ui.start();
  const snapshot=ui.read();
  snapshot.day='2026-11-10';
  snapshot.selected=['chat','notes'];
  snapshot.permission={decision:'同意',at:Date.now()-86400000};
  snapshot.sections.chat.contacts[0].messages.push({
    side:'me',text:'跨天保留的唯一消息',time:Date.now()-60000
  });
  ui.storage.setItem(ui.key,JSON.stringify(snapshot));
  ui.mount();
  const next=ui.read();
  assert.notEqual(next.day,'2026-11-10');
  assert.equal(next.permission,null);
  assert.deepEqual(Array.from(next.selected),['chat','notes']);
  assert.ok(next.sections.chat.contacts[0].messages.some(m=>m.text==='跨天保留的唯一消息'));
});

test('保存失败时不虚假发送聊天；未配置API仍会保存明确的剧情消息',()=>{
  const ui=setupInteractive();ui.start();ui.openApp('chat');ui.openContact(0);
  ui.submitMessage('记录1，没有API也应保留');
  assert.ok(ui.read().sections.chat.contacts[0].messages.some(m=>m.text.includes('记录1')));
  const count=ui.read().sections.chat.contacts[0].messages.length;
  ui.setFailWrites(true);
  ui.submitMessage('记录2，保存失败不应留在界面');
  ui.setFailWrites(false);
  assert.equal(ui.read().sections.chat.contacts[0].messages.length,count);
  assert.doesNotMatch(ui.appBody.innerHTML,/记录2/);
});

test('AI 数据不足或跨板块消费冲突时，原记录不被覆盖',async()=>{
  const ui=setupInteractive(undefined,true);ui.start();ui.openApp('wallet');
  const previous=ui.storage.getItem(ui.key);
  ui.window.PhoneAPI.completeJSON=async()=>({
    ok:true,data:{transactions:[{merchant:'只有一笔',amount:-1}]}
  });
  ui.action('refresh');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.storage.getItem(ui.key),previous);

  const original=ui.read().sections.wallet;
  const conflicting=JSON.parse(JSON.stringify(original));
  conflicting.transactions[1].amount=-999;
  ui.window.PhoneAPI.completeJSON=async()=>({ok:true,data:conflicting});
  ui.action('refresh');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.storage.getItem(ui.key),previous);
});

test('AI 合法刷新只修改目标板块，其他板块保持逐字一致',async()=>{
  const ui=setupInteractive(undefined,true);ui.start();ui.openApp('music');
  const before=ui.read(),music=JSON.parse(JSON.stringify(before.sections.music));
  music.recent[0].title='刷新后独有的歌曲名称';
  ui.window.PhoneAPI.completeJSON=async()=>({ok:true,data:music});
  ui.action('refresh');
  await new Promise(resolve=>setImmediate(resolve));
  const after=ui.read();
  assert.equal(after.sections.music.recent[0].title,'刷新后独有的歌曲名称');
  assert.equal(after.source.music,'ai');
  for(const key of Object.keys(before.sections)){
    if(key!=='music')assert.deepEqual(after.sections[key],before.sections[key]);
  }
});


test('冻结时钟下凌晨/白天/傍晚与深夜的全部板块均符合时间契约',()=>{
  const minutes=[[0,3],[7,3],[12,30],[17,35],[17,42],[19,40],[23,55]];
  for(const [hour,minute] of minutes){
    const timestamp=new Date(2026,10,11,hour,minute).getTime();
    class FrozenDate extends Date {
      constructor(...args){super(...(args.length?args:[timestamp]));}
      static now(){return timestamp;}
    }
    const records=new Map(),storage={
      getItem(key){return records.get(key)||null;},
      setItem(key,value){records.set(key,String(value));}
    };
    const node=()=>({innerHTML:'',textContent:'',scrollHeight:500,scrollTop:0,
      classList:{add(){},remove(){}},addEventListener(){}});
    const document={querySelector(){return node();},getElementById(){return node();}};
    const window={PhoneStorage:{getApiConfig(){return {};}}};
    vm.runInNewContext(src,{window,localStorage:storage,document,Date:FrozenDate,Math,JSON,Number,String,Array,Object,console});
    window.InspectPhoneFeature.mount({
      role:{id:'clock',name:'测试',description:'大学生'},requestedId:'clock',
      appBody:node(),appLayer:node(),appTitle:node()
    });
    const snapshot=JSON.parse(records.get('inspect_story_v1_clock'));
    const label=hour+':'+minute;
    assert.ok(snapshot.facts.every(f=>f.time<=timestamp),label+' 出现未来事件');
    for(const [id,section] of Object.entries(snapshot.sections)){
      assert.equal(window.InspectPhoneFeature.valid(id,section,timestamp,snapshot.facts),true,
        label+' '+id+' 内容不符合验收契约');
    }
    assert.ok(snapshot.sections.device.screenMinutes<=hour*60+minute,
      label+' 今日屏幕使用时间超过已过时间');
    assert.equal(snapshot.sections.device.apps.reduce((sum,x)=>sum+x.minutes,0),
      snapshot.sections.device.screenMinutes,label+' App使用时间与总量不一致');
    assert.ok(snapshot.sections.browser.searchHistory.every((h,i,arr)=>!i||arr[i-1].time>=h.time),
      label+' 搜索记录不是时间倒序');
  }
});

test('毕业后工作的角色不能被大学经历误判为学生消费层',()=>{
  const adult=setupInteractive({id:'editor',name:'编辑',age:26,
    description:'大学毕业，已经工作五年，现在是图书编辑，消费正常'});
  adult.start();
  assert.equal(adult.read().sections.wallet.transactions[0].amount,6800);
  const student=setupInteractive({id:'student',name:'学生',age:20,description:'在校大学生，课余打工'});
  student.start();
  assert.equal(student.read().sections.wallet.transactions[0].amount,1200);
});
