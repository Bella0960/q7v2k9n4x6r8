import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountTurtlePage} from '../games/tabletop/turtle-page.js';
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
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
const wait=async()=>{for(let i=0;i<6000;i++)await Promise.resolve();};
function fixture({ready=true,...options}={}){
 let sessionId='s1',reads=0;
 const doc=target({hidden:false,createElement:tag=>new El(doc,tag),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
 const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready,accountId,role:'user'},PhoneStorage:{result:{getCharacters(){reads++;return {ok:true,meta:{source:'ai_custom_characters'},value:[{id:'r1',name:'角色一'},{id:'r2',name:'角色二'}]};}}},fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:'active'}}:{currentSessionId:sessionId}})});
 const root=new El(doc,'div'),page=mountTurtlePage(root,{win,makeRoomId:()=> 'room',...options});
 const one=c=>all(root,c)[0],select=i=>{const b=all(root,'mao-turtle__role')[i].children[0];b.checked=true;b.fire('change');};
 return {root,win,page,one,select,session:x=>{sessionId=x;},reads:()=>reads};
}
test('role moderator: public puzzle, reference question, free question with judge, confirmed reveal',async()=>{
 const seen=[],f=fixture({judgeRole:v=>{seen.push(v);return {kind:'answer',verdict:'yes'};}});
 await wait();f.select(0);f.one('mao-turtle__host').value='role:r1';f.one('mao-turtle__start').click();await wait();
 assert.equal(f.one('mao-turtle__game').hidden,false);assert.equal(f.one('mao-turtle__solution').textContent,'');assert.equal(f.one('mao-turtle__secret').hidden,true);
 all(f.root,'mao-turtle__question')[0].click();await wait();assert.equal(all(f.root,'mao-turtle__entry').length,2);
 assert.equal(all(f.root,'mao-turtle__entry')[1].children[1].textContent,'否');
 f.one('mao-turtle__input').value='是清洁工作造成的吗？';f.one('mao-turtle__ask').click();await wait();
 assert.equal(seen.length,1);assert.ok(seen[0].game.solution);assert.equal(f.one('mao-turtle__solution').textContent,'');
 f.one('mao-turtle__reveal').click();assert.equal(f.one('mao-turtle__solution').textContent,'');f.one('mao-turtle__reveal').click();await wait();
 assert.ok(f.one('mao-turtle__solution').textContent);assert.equal(f.one('mao-turtle__secret').open,true);f.page.destroy();
});
test('human moderator: role model receives public view, human judges guess, answer cleared on pause',async()=>{
 const seen=[],f=fixture({askRole:v=>{seen.push(v);return {kind:'guess',text:'清洁工在洗窗户。'};},allowPlayerText:()=>true});
 await wait();f.select(0);f.one('mao-turtle__start').click();await wait();
 assert.equal(seen.length,1);assert.equal(Object.hasOwn(seen[0].game,'solution'),false);assert.ok(f.one('mao-turtle__solution').textContent);
 f.win.navigator.onLine=false;f.win.fire('offline');assert.equal(f.one('mao-turtle__solution').textContent,'');assert.equal(all(f.root,'mao-turtle__entry').length,0);
 f.win.navigator.onLine=true;f.one('mao-turtle__resume').click();await wait();assert.ok(f.one('mao-turtle__solution').textContent);
 all(f.root,'mao-turtle__verdict')[0].click();await wait();assert.ok(f.one('mao-turtle__turn').textContent.includes('猜中谜底'));f.page.destroy();
});
test('unready scope and changed login cannot open or restore a private moderator view',async()=>{
 const f=fixture({ready:false});await wait();assert.equal(f.reads(),0);assert.equal(f.one('mao-turtle__start').disabled,true);f.page.destroy();
 const g=fixture();await wait();g.select(0);g.one('mao-turtle__start').click();await wait();assert.ok(g.one('mao-turtle__solution').textContent);
 g.win.fire('storage',{key:null});g.session('s2');g.one('mao-turtle__resume').click();await wait();
 assert.equal(g.one('mao-turtle__solution').textContent,'');assert.equal(g.one('mao-turtle__game').hidden,true);g.page.destroy();
});
