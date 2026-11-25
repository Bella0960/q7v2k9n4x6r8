import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountTabletopHall} from '../games/tabletop/tabletop-hall.js';
const accountId='MAO-AAAAAAAAAAAA';
function target(o={}){const events=new Map();return Object.assign(o,{addEventListener(k,f){if(!events.has(k))events.set(k,new Set());events.get(k).add(f);},removeEventListener(k,f){events.get(k)?.delete(f);},fire(k,e={}){for(const f of [...(events.get(k)||[])])f(e);}});}
class El{
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.value='';this.attrs={};target(this);}
 setAttribute(k,v){this.attrs[k]=v;}append(...a){this.children.push(...a);a.forEach(x=>x.parent=this);}
 replaceChildren(...a){this.children=[];this.append(...a);}
 get firstElementChild(){return this.children[0]??null;}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
 click(){if(!this.disabled)this.fire('click');}
}
const all=(e,fn)=>[...(fn(e)?[e]:[]),...e.children.flatMap(c=>all(c,fn))];
const wait=async()=>{for(let i=0;i<15000;i++)await Promise.resolve();};
function fixture(){
 let sessionId='s1';
 const doc=target({hidden:false,createElement:tag=>new El(doc,tag),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
 const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready:true,accountId,role:'user'},PhoneStorage:{result:{getCharacters(){return {ok:true,meta:{source:'ai_custom_characters'},value:[{id:'r1',name:'角色一'},{id:'r2',name:'角色二'}]};}}},fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:'active'}}:{currentSessionId:sessionId}})});
 const root=new El(doc,'div'),page=mountTabletopHall(root,{win,gameOptions:{turtle:{makeRoomId:()=> 'turtle-room'}}});
 const cls=c=>all(root,e=>e.className?.split(' ').includes(c)),one=c=>cls(c)[0],button=text=>all(root,e=>e.tagName==='button'&&e.textContent===text)[0],click=async text=>{const b=button(text);assert.ok(b);b.click();await wait();};
 return {root,win,page,cls,one,button,click,session:x=>{sessionId=x;},pick:()=>{const box=one('mao-turtle__role').children[0];box.checked=true;box.fire('change');}};
}
test('hall launches actual Turtle Soup; temporary progress survives offline and same-login restore, not changed login',async()=>{
 const f=fixture();assert.equal(f.cls('mao-table-hall__open').length,4);await f.click('海龟汤');f.pick();f.one('mao-turtle__host').value='role:r1';f.one('mao-turtle__start').click();await wait();
 f.one('mao-turtle__question').click();await wait();assert.equal(f.cls('mao-turtle__entry').length,2);await f.click('暂存本局');
 await f.click('返回多人游戏');await f.click('返回多人游戏');assert.ok(f.button('继续暂存'));
 f.win.navigator.onLine=false;f.win.fire('offline');assert.equal(f.one('mao-table-hall__main').hidden,true);f.win.navigator.onLine=true;await f.click('重新验证');assert.ok(f.button('继续暂存'));
 await f.click('继续暂存');assert.equal(f.cls('mao-turtle__entry').length,2);assert.equal(f.one('mao-turtle__solution').textContent,'');
 f.win.fire('storage',{key:null});f.session('s2');await f.click('重新验证');assert.equal(f.cls('mao-turtle__entry').length,0);assert.equal(f.button('继续暂存'),undefined);f.page.destroy();
});
test('terminal game archive deduplicates, journal exposes role recall controls and grant revoke',async()=>{
 const f=fixture();await f.click('海龟汤');f.pick();f.one('mao-turtle__start').click();await wait();
 assert.ok(f.one('mao-turtle__solution').textContent);f.one('mao-turtle__reveal').click();f.one('mao-turtle__reveal').click();await wait();
 assert.ok(f.one('mao-table-note').textContent.includes('记入本次会话'));await f.click('归档已结束对局');assert.ok(f.one('mao-table-note').textContent.includes('已归档'));await f.click('返回多人游戏');await f.click('返回多人游戏');await f.click('游戏手账');
 assert.equal(f.cls('mao-table-journal__row').length,1);await f.click('角色记忆');assert.ok(f.cls('mao-table-journal__fragment').length>=1);
 await f.click('授权读取');assert.ok(f.cls('mao-table-journal__grant').length>=1);await f.click('撤回');assert.equal(f.cls('mao-table-journal__grant').length,0);
 await f.click('停用记忆');assert.ok(f.button('恢复记忆'));await f.click('恢复记忆');assert.ok(f.button('停用记忆'));f.page.destroy();
});

test('automatic settlement advances only matching temporary checkpoint and restores it as finished',async()=>{
 const f=fixture();await f.click('海龟汤');f.pick();f.one('mao-turtle__host').value='role:r1';f.one('mao-turtle__start').click();await wait();
 f.one('mao-turtle__question').click();await wait();await f.click('暂存本局');
 f.one('mao-turtle__reveal').click();f.one('mao-turtle__reveal').click();await wait();
 assert.ok(f.one('mao-table-note').textContent.includes('记入本次会话'));
 await f.click('返回多人游戏');await f.click('返回多人游戏');assert.equal(f.button('继续暂存'),undefined);assert.ok(f.button('查看已结束对局'));
 await f.click('查看已结束对局');assert.ok(f.one('mao-turtle__turn').textContent.includes('本局结束'));assert.ok(f.one('mao-turtle__solution').textContent);assert.equal(f.one('mao-turtle__controls').hidden,true);
 await f.click('返回多人游戏');await f.click('返回多人游戏');await f.click('游戏手账');assert.equal(f.cls('mao-table-journal__row').length,1);f.page.destroy();
});
