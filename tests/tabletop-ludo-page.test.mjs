import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountLudoPage} from '../games/tabletop/ludo-page.js';
import {createBrowserRoomVerifier} from '../games/tabletop/account-room-context.js';
const accountId='MAO-AAAAAAAAAAAA';
function target(o={}){const events=new Map();return Object.assign(o,{addEventListener(k,f){if(!events.has(k))events.set(k,new Set());events.get(k).add(f);},removeEventListener(k,f){events.get(k)?.delete(f);},fire(k,e={}){for(const f of [...(events.get(k)||[])])f(e);}});}
class El{
  constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.style={};this.value='';this.attrs={};this.classList={add:c=>{this.className+=' '+c;}};target(this);}
  setAttribute(k,v){this.attrs[k]=v;}append(...a){this.children.push(...a);a.forEach(x=>x.parent=this);if(this.tagName==='select'&&a.length&&!this.value)this.value=a[0].value;}
  replaceChildren(...a){this.children=[];if(this.tagName==='select')this.value='';this.append(...a);}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  click(){if(!this.disabled)this.fire('click');}
}
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
const text=e=>[e.textContent??'',...e.children.map(text)].join(' ');
const wait=async()=>{for(let i=0;i<1200;i++)await Promise.resolve();};
function fixture({ready=true,roles=[{id:'r1',name:'同名角色',persona:'private-1'},{id:'r2',name:'同名角色',memory:'private-2'}]}={}){
  let sessionId='s1',reads=0,active=true;
  const doc=target({hidden:false,createElement:tag=>new El(doc,tag),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
  const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready,accountId,role:'user'},PhoneStorage:{result:{getCharacters(){reads++;return {ok:true,meta:{source:'ai_custom_characters'},value:roles};}}},fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:active?'active':'disabled'}}:{currentSessionId:sessionId}})});
  const root=new El(doc,'div'),page=mountLudoPage(root,{win,makeRoomId:()=> 'room'});
  return {win,root,page,one:c=>all(root,c)[0],session:x=>{sessionId=x;},reads:()=>reads};
}
test('verified picker only exposes IDs and names and preserves same-name roles',async()=>{
  const f=fixture();await wait();const v=await createBrowserRoomVerifier(f.win,{includeRoleLabels:true})();
  assert.deepEqual(v.roleLabels,[{id:'r1',name:'同名角色'},{id:'r2',name:'同名角色'}]);
  assert.equal(all(f.root,'mao-flight__role').length,2);assert.ok(!text(f.root).includes('private-'));f.page.destroy();
});
test('unready account does not read private roster or start a game',async()=>{
  const f=fixture({ready:false});await wait();assert.equal(f.reads(),0);
  assert.equal(f.one('mao-flight__start').disabled,true);assert.equal(all(f.root,'mao-flight__role').length,0);f.page.destroy();
});
test('select one role, fill three-player quick game, send and stop chat, end game',async()=>{
  const f=fixture();await wait();const count=f.one('mao-flight__count');count.value='3';count.fire('change');
  f.one('mao-flight__mode').value='adventure';
  const checkbox=all(f.root,'mao-flight__role')[1].children[0];checkbox.checked=true;checkbox.fire('change');
  f.one('mao-flight__start').click();await wait();
  assert.equal(f.one('mao-flight__game').hidden,false);assert.equal(all(f.root,'mao-ludo__player').length,3);
  assert.ok(text(f.root).includes('普通棋手 1'));assert.equal(f.one('mao-flight__reply').children[1].value,'role:r2');
  assert.ok(!f.one('mao-flight__chat').open);
  f.one('mao-flight__input').value='你好';f.one('mao-flight__send').click();await wait();
  assert.equal(all(f.root,'mao-flight__message').length,1);assert.ok(text(f.root).includes('没有可用模型'));
  f.one('mao-flight__stop').click();f.one('mao-flight__end').click();await wait();
  assert.equal(f.one('mao-flight__game').hidden,true);assert.equal(all(f.root,'mao-flight__message').length,0);f.page.destroy();
});
test('login changed after picker load rejects start despite identical role IDs',async()=>{
  const f=fixture();await wait();f.session('s2');f.one('mao-flight__start').click();await wait();
  assert.equal(f.one('mao-flight__game').hidden,true);assert.equal(all(f.root,'mao-ludo__player').length,0);assert.equal(all(f.root,'mao-flight__role').length,0);f.page.destroy();
});
test('offline hides board and chat, same-login resume restores verified messages',async()=>{
  const f=fixture();await wait();f.one('mao-flight__start').click();await wait();
  f.one('mao-flight__input').value='公开游戏消息';f.one('mao-flight__send').click();await wait();
  f.win.navigator.onLine=false;f.win.fire('offline');
  assert.equal(f.one('mao-flight__chat').hidden,true);assert.equal(all(f.root,'mao-flight__message').length,0);assert.equal(all(f.root,'mao-ludo__player').length,0);
  f.win.navigator.onLine=true;f.one('mao-flight__resume').click();await wait();
  assert.equal(all(f.root,'mao-ludo__player').length,4);assert.equal(all(f.root,'mao-flight__message').length,1);f.page.destroy();
});
test('picker invalidation clears names and rejects duplicate role ID projection',async()=>{
  const f=fixture();await wait();f.win.fire('storage');assert.equal(all(f.root,'mao-flight__role').length,0);assert.equal(f.one('mao-flight__start').disabled,true);f.page.destroy();
  const g=fixture({roles:[{id:'r1',name:'A'},{id:'r1',name:'B'}]});await wait();assert.equal(g.one('mao-flight__start').disabled,true);assert.equal(all(g.root,'mao-flight__role').length,0);g.page.destroy();
});
