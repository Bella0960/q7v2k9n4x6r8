import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const guardSource=readFileSync(new URL('../shared/js/phone/inspect_account_guard.js',import.meta.url),'utf8');
const bridgeSource=readFileSync(new URL('../shared/js/phone/inspect_interaction_bridge.js',import.meta.url),'utf8');
const featureSource=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const phone=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');
const chat=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');

function make(accountId=null,ready=true,store=null){
  const disk=store||new Map();
  const storage={
    getItem(k){return disk.get(String(k))||null;},
    setItem(k,v){disk.set(String(k),String(v));}
  };
  const document={querySelector(q){return q==='meta[name="mao-account-id"]'&&accountId?
    {content:accountId}:null;}};
  const window={document,localStorage:storage,
    __MAO_ACCOUNT_SCOPE__:accountId&&ready?{ready:true,accountId}:undefined};
  const ctx={window,document,localStorage:storage,Date,Math,Number,String,Array,Object,JSON};
  vm.runInNewContext(guardSource,ctx);
  vm.runInNewContext(bridgeSource,ctx);
  return {disk,storage,window,guard:window.InspectPhoneAccountGuard,
    bridge:window.InspectInteractionBridge,ctx};
}

test('有账号页面元信息但没有 Worker 注入的认证作用域时必须拒绝读取',()=>{
  const x=make('MAO-ABCDEFGHIJKL',false);
  assert.equal(x.guard.state().mode,'blocked');
  assert.equal(x.guard.stamp({roleId:'r'}),false);
  assert.equal(x.guard.canRead({roleId:'r'}),false);
  assert.equal(x.bridge.requestFocus({roleId:'r'},'note',{title:'秘密',sourceId:'a',text:'不能读取'}),null);
});
test('正式账号作用域为数据打上 ownerAccountId，另一账号不可读写',()=>{
  const a=make('MAO-ABCDEFGHIJKL');
  const story={schema:1,roleId:'same-role',interactions:[]};
  assert.equal(a.guard.stamp(story),true);
  assert.equal(story.ownerAccountId,'MAO-ABCDEFGHIJKL');
  assert.equal(a.guard.canRead(story),true);
  a.storage.setItem(a.bridge.key('same-role'),JSON.stringify(story));
  assert.equal(a.bridge.buildPrompt('same-role',a.storage),'');
  const b=make('MAO-MNOPQRSTUVWX',true,a.disk);
  assert.equal(b.guard.canRead(story),false);
  assert.equal(b.guard.stamp(story),false);
  assert.equal(b.bridge.buildPrompt('same-role',b.storage),'');
  assert.equal(b.bridge.markOffered('same-role',['any'],b.storage),false);
});
test('未登录的本地演示不能打开带 ownerAccountId 的私有账号手机',()=>{
  const demo=make(),privateRecord={roleId:'r',ownerAccountId:'MAO-ABCDEFGHIJKL'};
  assert.equal(demo.guard.state().mode,'local-demo');
  assert.equal(demo.guard.canRead(privateRecord),false);
  assert.equal(demo.guard.stamp(privateRecord),false);
  assert.equal(demo.guard.stamp({roleId:'demo'}),true);
});
test('账号之间物理 key 隔离仍必须由已认证的 scope 层提供，不能伪造前端ID当认证',()=>{
  const disk=new Map();
  function scoped(accountId){
    const a=make(accountId,true,new Map());
    const storage={
      getItem(k){return disk.get(accountId+':'+k)||null;},
      setItem(k,v){disk.set(accountId+':'+k,String(v));}
    };
    a.storage=storage;
    const story={roleId:'r1',ownerAccountId:accountId,interactions:[]};
    storage.setItem(a.bridge.key('r1'),JSON.stringify(story));
    return a;
  }
  const alice=scoped('MAO-ABCDEFGHIJKL'),bob=scoped('MAO-MNOPQRSTUVWX');
  const note=alice.bridge.record(JSON.parse(alice.storage.getItem(alice.bridge.key('r1'))),
    'note_created','只有账号A可以读取的日记','note-A');
  assert.ok(note);
  const data=JSON.parse(alice.storage.getItem(alice.bridge.key('r1')));
  data.interactions.push(note);
  alice.storage.setItem(alice.bridge.key('r1'),JSON.stringify(data));
  assert.match(alice.bridge.buildPrompt('r1',alice.storage),/只有账号A/);
  assert.equal(bob.bridge.buildPrompt('r1',bob.storage),'');
});
test('手机及聊天页都在互动桥接前加载作用域守卫，Worker注入缺失时不降级为跨账号读取',()=>{
  assert.match(phone,/inspect_account_guard\.js\?v=20261112v1/);
  assert.match(chat,/inspect_account_guard\.js\?v=20261112v1/);
  assert.ok(phone.indexOf('inspect_account_guard.js')<phone.indexOf('inspect_interaction_bridge.js'));
  assert.ok(chat.indexOf('inspect_account_guard.js')<chat.indexOf('inspect_interaction_bridge.js'));
  assert.match(featureSource,/accountGuard\.state\(\)\.mode==='blocked'/);
  assert.match(featureSource,/guard&&!guard\.canRead\(persisted\)/);
  assert.match(bridgeSource,/guard&&!\s*guard\.stamp/);
});
test('无有效 Worker 身份的页面调用角色手机不会回退读取不受保护的旧数据',()=>{
  const x=make('MAO-ABCDEFGHIJKL',false),ui={innerHTML:'',textContent:'',
    classList:{add(){}},addEventListener(){}};
  const env={...x.ctx,window:x.window};
  vm.runInNewContext(featureSource,env);
  x.window.InspectPhoneFeature.mount({role:{id:'r1',name:'林禾'},requestedId:'r1',
    appTitle:ui,appBody:ui,appLayer:ui});
  assert.match(ui.innerHTML,/账号作用域尚未通过服务端页面校验/);
  assert.equal(x.disk.size,0);
});
