import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountWerewolfPage} from '../games/tabletop/werewolf-page.js';
const accountId='MAO-AAAAAAAAAAAA';
function target(o={}){const events=new Map();return Object.assign(o,{addEventListener(k,f){if(!events.has(k))events.set(k,new Set());events.get(k).add(f);},removeEventListener(k,f){events.get(k)?.delete(f);},fire(k,e={}){for(const f of [...(events.get(k)||[])])f(e);}});}
class El{
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.value='';this.attrs={};target(this);}
 setAttribute(k,v){this.attrs[k]=v;}append(...a){this.children.push(...a);a.forEach(x=>x.parent=this);}
 replaceChildren(...a){this.children=[];this.append(...a);}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
 click(){if(!this.disabled)this.fire('click');}
}
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
const wait=async()=>{for(let i=0;i<15000;i++)await Promise.resolve();};
function fixture({ready=true,...options}={}){
 let sessionId='s1',reads=0;
 const doc=target({hidden:false,createElement:tag=>new El(doc,tag),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
 const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready,accountId,role:'user'},PhoneStorage:{result:{getCharacters(){reads++;return {ok:true,meta:{source:'ai_custom_characters'},value:Array.from({length:11},(_,i)=>({id:'r'+(i+1),name:'角色'+(i+1)}))};}}},fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:'active'}}:{currentSessionId:sessionId}})});
 const root=new El(doc,'div'),page=mountWerewolfPage(root,{win,makeRoomId:()=> 'room',randomIndex:n=>n-1,...options});
 const one=c=>all(root,c)[0],select=i=>{const b=all(root,'mao-wolf__pick')[i].children[0];b.checked=true;b.fire('change');};
 return {root,win,page,one,select,session:x=>{sessionId=x;},reads:()=>reads};
}
test('six player private identity, scoped night actions, public talk and ballot',async()=>{
 const calls=[],f=fixture({decideRole:v=>{calls.push(v);return {kind:'pass'};},allowSpeech:()=>true});
 await wait();for(let i=0;i<5;i++)f.select(i);f.one('mao-wolf__start').click();await wait();
 assert.equal(f.one('mao-wolf__game').hidden,false);assert.equal(f.one('mao-wolf__role').textContent,'狼人');assert.ok(f.one('mao-wolf__private').textContent.includes('角色1'));
 assert.equal(all(f.root,'mao-wolf__seat').length,6);assert.ok(all(f.root,'mao-wolf__seat').every(x=>x.children[2].textContent==='在场'));
 f.one('mao-wolf__pass').click();await wait();assert.equal(calls.length,3);assert.ok(f.one('mao-wolf__turn').textContent.includes('白天发言'));assert.ok(calls.every(v=>v.game.players.every(p=>!Object.hasOwn(p,'role'))));
 f.one('mao-wolf__input').value='先听意见。';f.one('mao-wolf__speak').click();await wait();assert.ok(f.one('mao-wolf__turn').textContent.includes('公开投票'));assert.equal(f.one('mao-wolf__input').value,'');
 f.one('mao-wolf__target').value='role:r1';f.one('mao-wolf__confirm').click();await wait();assert.ok(all(f.root,'mao-wolf__seat')[1].className.includes('is-out'));
 f.page.destroy();
});
test('nine and twelve seat selection requires exact count; unavailable model explicit',async()=>{
 for(const n of [9,12]){const f=fixture();await wait();const s=f.one('mao-wolf__size');s.value=String(n);s.fire('change');
 for(let i=0;i<n-2;i++)f.select(i);assert.equal(f.one('mao-wolf__start').disabled,true);f.select(n-2);f.one('mao-wolf__start').click();await wait();
 assert.equal(all(f.root,'mao-wolf__seat').length,n);f.one('mao-wolf__pass').click();await wait();assert.ok(f.one('mao-wolf__note').textContent.includes('尚未接入'));f.page.destroy();}
});
test('pause wipes identity, same login restores, changed login closes private view',async()=>{
 const f=fixture();await wait();for(let i=0;i<5;i++)f.select(i);f.one('mao-wolf__start').click();await wait();assert.ok(f.one('mao-wolf__role').textContent);
 f.win.navigator.onLine=false;f.win.fire('offline');assert.equal(f.one('mao-wolf__role').textContent,'');assert.equal(all(f.root,'mao-wolf__seat').length,0);
 f.win.navigator.onLine=true;f.one('mao-wolf__resume').click();await wait();assert.equal(f.one('mao-wolf__role').textContent,'狼人');
 f.win.fire('storage',{key:null});f.session('s2');f.one('mao-wolf__resume').click();await wait();assert.equal(f.one('mao-wolf__role').textContent,'');assert.equal(f.one('mao-wolf__game').hidden,true);f.page.destroy();
});
test('unready identity never reads characters',async()=>{const f=fixture({ready:false});await wait();assert.equal(f.reads(),0);assert.equal(f.one('mao-wolf__start').disabled,true);f.page.destroy();});
