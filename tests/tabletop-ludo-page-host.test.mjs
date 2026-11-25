import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLudoPageHost} from '../games/tabletop/ludo-page-host.js';
const accountId='MAO-AAAAAAAAAAAA';
function target(o={}){const events=new Map();return Object.assign(o,{addEventListener(k,f){if(!events.has(k))events.set(k,new Set());events.get(k).add(f);},removeEventListener(k,f){events.get(k)?.delete(f);},fire(k,e={}){for(const f of [...(events.get(k)||[])])f(e);}});}
class El{
  constructor(doc){this.ownerDocument=doc;this.children=[];this.style={};this.events={};this.classList={add:c=>{this.className+=' '+c;}};}
  setAttribute(){}append(...a){this.children.push(...a);a.forEach(x=>x.parent=this);}replaceChildren(...a){this.children=[];this.append(...a);}
  addEventListener(k,f){this.events[k]=f;}remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  click(){if(!this.disabled)this.events.click?.();}
}
function fixture({rollDie=()=>6,pace}={}){
  let sessionId='s1',roles=['r1','r2','r3'],active=true,fetches=0,rolls=0;
  const doc=target({hidden:false,createElement:()=>new El(doc),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
  const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready:true,accountId,role:'user'},PhoneStorage:{result:{getCharacters:()=>({ok:true,meta:{source:'ai_custom_characters'},value:roles.map(id=>({id}))})}},async fetch(path){fetches++;return {ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:active?'active':'disabled'}}:{currentSessionId:sessionId}};}});
  const root=new El(doc),states=[],host=createLudoPageHost(root,{win,rollDie:()=>{rolls++;return rollDie();},pace,onStatus:s=>states.push(s)});
  return {root,host,win,states,fetches:()=>fetches,rolls:()=>rolls,session:x=>{sessionId=x;},roles:x=>{roles=x;},active:x=>{active=x;}};
}
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
async function settle(host){for(let i=0;i<1000&&host.status()==='busy';i++)await Promise.resolve();assert.notEqual(host.status(),'busy');}
test('real browser session adapter starts selected roles and handles board action',async()=>{
  const f=fixture();await f.host.start({roomId:'room',roleIds:['r1','r2']});
  assert.equal(all(f.root,'mao-ludo__player').length,3);
  all(f.root,'mao-ludo__action')[0].click();await settle(f.host);
  assert.equal(f.rolls(),1);assert.equal(all(f.root,'mao-ludo__action').length,4);
  assert.ok(f.fetches()>4);f.host.destroy();
});
test('missing role and disabled account never display a playable board',async()=>{
  for(const change of [f=>f.roles(['r2']),f=>f.active(false)]){
    const f=fixture();change(f);await assert.rejects(f.host.start({roomId:'room',roleIds:['r1']}));assert.equal(f.root.children.length,0);f.host.destroy();
  }
});
test('offline clears display, verified resume preserves game and new session rejects old board',async()=>{
  const f=fixture();await f.host.start({roomId:'room',roleIds:['r1']});
  all(f.root,'mao-ludo__action')[0].click();await settle(f.host);
  f.win.navigator.onLine=false;f.win.fire('offline');assert.equal(f.root.children.length,0);
  f.win.navigator.onLine=true;await f.host.resume();assert.equal(all(f.root,'mao-ludo__action').length,4);
  f.win.fire('storage');assert.equal(f.root.children.length,0);f.session('new');
  await assert.rejects(f.host.resume(),/SCOPE_CHANGED/);assert.equal(f.root.children.length,0);f.host.destroy();
});
test('end during automatic role pacing does not publish a later board',async()=>{
  let release;const f=fixture({rollDie:()=>3,pace:()=>new Promise(r=>{release=r;})});
  await f.host.start({roomId:'room',roleIds:['r1']});all(f.root,'mao-ludo__action')[0].click();
  for(let i=0;i<1000&&!release;i++)await Promise.resolve();assert.equal(typeof release,'function');
  f.host.end();release();await settle(f.host);assert.equal(f.root.children.length,0);assert.equal(f.rolls(),1);f.host.destroy();
});
test('pagehide destroys host and rejects another start',async()=>{
  const f=fixture();await f.host.start({roomId:'room',roleIds:['r1']});f.win.fire('pagehide');
  assert.equal(f.root.children.length,0);assert.equal(f.host.status(),'disposed');await assert.rejects(f.host.start({roomId:'new',roleIds:['r1']}),/LUDO_PAGE_BUSY/);
});

test('automatic real session role turn returns control to the user',async()=>{
  const dice=[3,6,2];let n=0;const f=fixture({rollDie:()=>dice[n++%3]});
  await f.host.start({roomId:'room',roleIds:['r1']});
  all(f.root,'mao-ludo__action')[0].click();await settle(f.host);
  assert.equal(f.rolls(),3);assert.equal(all(f.root,'mao-ludo__action').length,1);
  assert.equal(f.states.at(-1),'ready');f.host.destroy();
});
test('start snapshots the selected role IDs before asynchronous verification',async()=>{
  const f=fixture();const roles=['r1'];const start=f.host.start({roomId:'room',roleIds:roles});roles[0]='r2';
  const v=await start;assert.equal(v.seats[1].roleId,'r1');f.host.destroy();
});

test('picker identity pins session before first invitation, even with identical role IDs',async()=>{
  const f=fixture();f.session('s2');
  await assert.rejects(f.host.start({roomId:'room',roleIds:['r1'],expectedIdentity:{accountId,sessionId:'s1'}}),/SCOPE_CHANGED/);
  assert.equal(f.root.children.length,0);f.host.destroy();
});
