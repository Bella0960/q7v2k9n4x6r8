import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const native=readFileSync(new URL('../inspect-phone/inspect-native-view.js',import.meta.url),'utf8');
const feature=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const phone=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');
const skin=readFileSync(new URL('../inspect-phone/inspect-native.css',import.meta.url),'utf8');

function boot(role={id:'native-1',name:'小叶',description:'在校大学生',relationship:'朋友'}) {
  const handlers={},saved=new Map();
  function elem(id) {
    return {innerHTML:'',textContent:'',scrollTop:0,scrollHeight:660,
      classList:{add(){},remove(){}},
      addEventListener(evt,fn){handlers[id+':'+evt]=fn;}};
  }
  const grid=elem('grid'),dock=elem('dock'),body=elem('body'),layer=elem('layer'),title=elem('title'),
    back=elem('back'),reload=elem('reload');
  const document={
    querySelector:q=>q==='.grid'?grid:dock,
    getElementById:q=>q==='appBack'?back:reload
  };
  const storage={
    getItem:k=>saved.has(k)?saved.get(k):null,
    setItem(k,v){saved.set(k,String(v));}
  };
  const window={PhoneStorage:{getApiConfig(){return {};}}};
  const ctx={window,document,localStorage:storage,Date,Math,JSON,Number,String,Array,Object,console};
  vm.runInNewContext(native,ctx);vm.runInNewContext(feature,ctx);
  window.InspectPhoneFeature.mount({role,requestedId:role.id,appLayer:layer,appBody:body,appTitle:title});
  const event=(scope,sel,kind,val)=>{
    const cb=handlers[scope+':click'];
    assert.equal(typeof cb,'function');
    cb({target:{closest(q){
      if(q!==sel)return null;
      return {dataset:kind==='detail'?{detail:val.kind,index:String(val.index)}:{[kind]:val}};
    }}});
  };
  function action(x){event('body','[data-action]','action',x);}
  function app(x){event(x==='chat'||x==='browser'?'dock':'grid','[data-app]','app',x);}
  function detail(kind,index=0){event('body','[data-detail]','detail',{kind,index});}
  function tab(x){event('body','[data-native-tab]','nativeTab',x);}
  function unlockAll(){
    window.InspectPhoneFeature.onUnlock();action('grant');action('all');action('start');
  }
  const read=()=>JSON.parse(saved.get(window.InspectPhoneFeature.storyKey(role.id)));
  return {body,title,saved,window,unlockAll,action,app,detail,tab,read,
    back(){handlers['back:click']({});},
    reload(){handlers['reload:click']({});}};
}

test('真手机壳内载入新的应用模块与样式，保持上滑解锁',()=>{
  assert.match(phone,/inspect-native-view\.js\?v=20261112v3/);
  assert.match(phone,/inspect-native\.css\?v=20261112v3/);
  assert.match(phone,/id="appReload"/);
  assert.match(phone,/SWIPE_UP_THRESHOLD_PX = 36/);
  assert.match(skin,/\.nv-chat-detail/);
  assert.match(skin,/\.nv-note-editor/);
  assert.match(skin,/\.nv-forum-article/);
});

test('微信有会话列表、可返回的聊天详情、通讯录、发现和底部导航',()=>{
  const u=boot();u.unlockAll();u.app('chat');
  assert.match(u.body.innerHTML,/nv-chat-list/);
  assert.match(u.body.innerHTML,/nv-tabbar/);
  u.detail('chat',0);
  assert.match(u.body.innerHTML,/nv-bubbles/);
  assert.match(u.body.innerHTML,/inspectCompose/);
  u.back();assert.match(u.body.innerHTML,/nv-chat-list/);
  u.tab('contacts');assert.equal(u.title.textContent,'通讯录');
  u.tab('discover');assert.equal(u.title.textContent,'发现');
  u.detail('switch-moments');assert.equal(u.title.textContent,'朋友圈');
});

test('备忘录点进完整原文，离线刷新后新日记保留并能点开',()=>{
  const u=boot();u.unlockAll();u.app('notes');
  assert.match(u.body.innerHTML,/nv-notes-index/);
  u.detail('note',0);
  assert.match(u.body.innerHTML,/nv-note-editor/);
  assert.match(u.body.innerHTML,/nv-paper-body/);
  assert.match(u.body.innerHTML,/午饭|出门/);
  assert.ok(u.body.innerHTML.length>450);
  u.reload();
  assert.equal(u.read().sections.notes.notes[0].title,'今天记录的几件小事');
  assert.match(u.body.innerHTML,/已切换到下一段预置的虚构剧情/);
  assert.match(u.body.innerHTML,/nv-note-editor/);
  u.back();
  assert.match(u.body.innerHTML,/今天记录的几件小事/);
  for(let i=0;i<5;i++)u.reload();
  assert.ok(u.read().sections.notes.archive.length>0);
  u.detail('archived-note',0);
  assert.match(u.body.innerHTML,/nv-note-editor/);
});

test('论坛必须进入完整帖子正文与评论，刷新旧帖子不会消失',()=>{
  const u=boot();u.unlockAll();u.app('forum');
  assert.match(u.body.innerHTML,/nv-forum-card/);
  u.detail('post',0);
  assert.match(u.body.innerHTML,/nv-forum-article/);
  assert.match(u.body.innerHTML,/nv-comment/);
  u.back();
  for(let i=0;i<3;i++)u.reload();
  assert.ok(u.read().sections.forum.archive.length>0);
  u.detail('archived-post',0);
  assert.match(u.body.innerHTML,/nv-forum-article/);
});

test('钱包、相册、音乐、地图、浏览器各自具备可进入的详情页',()=>{
  const u=boot();u.unlockAll();
  for(const [app,kind,selector] of [
    ['wallet','transaction','nv-receipt'],
    ['album','photo','nv-photo-full'],
    ['music','track','nv-player'],
    ['map','stop','nv-sheet'],
    ['browser','search','nv-browser-page'],
    ['moments','moment','nv-sheet']
  ]) {
    u.app(app);u.detail(kind,0);
    assert.match(u.body.innerHTML,new RegExp(selector),app+' 应具有详情页');
    u.back();
  }
  u.app('device');assert.match(u.body.innerHTML,/nv-settings-owner/);
});

test('虚构角色内容始终经过 HTML 转义，不能变成脚本',()=>{
  const u=boot();u.unlockAll();
  const state=u.read(),key=u.window.InspectPhoneFeature.storyKey(state.roleId);
  state.sections.notes.notes[0].text='<img src=x onerror=alert(1)>';
  // Remount creates a fresh view state and reads the edited safe display fixture.
  u.saved.set(key,JSON.stringify(state));
  const escaped=u.window.InspectPhoneNative.render({
    app:'notes',view:{kind:'note',index:0},section:state.sections.notes,roleName:'小叶'
  });
  assert.ok(escaped.body.includes('&lt;img'));
  assert.ok(!escaped.body.includes('<img'));
});
