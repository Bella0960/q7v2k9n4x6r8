import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGomokuPageHost} from '../games/tabletop/gomoku-page-host.js';
import {mountGomokuPage} from '../games/tabletop/gomoku-page.js';
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
const wait=async()=>{for(let i=0;i<5000;i++)await Promise.resolve();};
function fixture({ready=true,decideRole=null,discussion={},pace=null}={}){
  let sessionId='s1',reads=0;
  const doc=target({hidden:false,createElement:tag=>new El(doc,tag),querySelector:s=>({content:s.includes('mao-account-role')?'user':accountId})});
  const win=target({document:doc,navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready,accountId,role:'user'},PhoneStorage:{result:{getCharacters(){reads++;return {ok:true,meta:{source:'ai_custom_characters'},value:[{id:'r1',name:'棋友一'},{id:'r2',name:'棋友二'},{id:'r3',name:'棋友三'}]};}}},fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:accountId,role:'user',status:'active'}}:{currentSessionId:sessionId}})});
  const root=new El(doc,'div'),page=mountGomokuPage(root,{win,makeRoomId:()=> 'room',decideRole,discussion,pace});
  const one=c=>all(root,c)[0],choose=(c,value)=>{one(c).value=value;one(c).fire('change');};
  return {win,root,page,one,choose,session:x=>{sessionId=x;},reads:()=>reads};
}
test('verified picker and actual 225-cell board support user black, role reply and occupied rejection',async()=>{
  const f=fixture();await wait();f.choose('mao-gomoku__first','r1');
  f.one('mao-gomoku__start').click();await wait();
  assert.equal(f.one('mao-gomoku__game').hidden,false);assert.equal(all(f.root,'mao-gomoku-board__cell').length,225);
  const cell=all(f.root,'mao-gomoku-board__cell')[112];cell.click();await wait();
  assert.equal(all(f.root,'mao-gomoku-board__cell').filter(c=>c.className.includes('is-black')).length,1);
  assert.equal(all(f.root,'mao-gomoku-board__cell').filter(c=>c.className.includes('is-white')).length,1);
  cell.click();await wait();assert.equal(all(f.root,'mao-gomoku-board__cell').filter(c=>c.className.includes('is-black')).length,1);
  f.page.destroy();
});
test('user white starts with role black then user legal turn',async()=>{
  const f=fixture();await wait();f.choose('mao-gomoku__first','r1');f.choose('mao-gomoku__color','white');f.one('mao-gomoku__start').click();await wait();
  assert.equal(all(f.root,'mao-gomoku-board__cell').filter(c=>c.className.includes('is-black')).length,1);
  assert.equal(all(f.root,'mao-gomoku-board__cell').filter(c=>c.className.includes('is-white')).length,0);
  assert.ok(all(f.root,'mao-gomoku-board__cell').some(c=>c.attrs['aria-disabled']==='false'));f.page.destroy();
});
test('watch two distinct roles and extra observer, board cannot be clicked, bounded batch continues',async()=>{
  const f=fixture();await wait();f.choose('mao-gomoku__mode','watch');f.choose('mao-gomoku__first','r1');f.choose('mao-gomoku__second','r1');
  assert.equal(f.one('mao-gomoku__start').disabled,true);
  f.choose('mao-gomoku__second','r2');const box=all(f.root,'mao-gomoku__observer')[2].children[0];box.checked=true;box.fire('change');
  f.one('mao-gomoku__start').click();await wait();
  const count=()=>all(f.root,'mao-gomoku-board__cell').filter(c=>/is-black|is-white/.test(c.className)).length;
  assert.equal(count(),8);assert.ok(all(f.root,'mao-gomoku-board__cell').every(c=>c.attrs['aria-disabled']==='true'));assert.equal(f.one('mao-gomoku__next').hidden,false);
  f.one('mao-gomoku__next').click();await wait();assert.ok(count()>8);f.page.destroy();
});
test('offline clears board; same login resume retains board; changed session rejects old game',async()=>{
  const f=fixture();await wait();f.choose('mao-gomoku__first','r1');f.one('mao-gomoku__start').click();await wait();
  all(f.root,'mao-gomoku-board__cell')[112].click();await wait();
  f.win.navigator.onLine=false;f.win.fire('offline');assert.equal(all(f.root,'mao-gomoku-board__cell').length,0);
  f.win.navigator.onLine=true;f.one('mao-gomoku__next').click();await wait();assert.equal(all(f.root,'mao-gomoku-board__cell').length,225);
  f.win.fire('storage',{key:null});f.session('s2');f.one('mao-gomoku__next').click();await wait();
  assert.equal(all(f.root,'mao-gomoku-board__cell').length,0);assert.equal(f.one('mao-gomoku__game').hidden,true);f.page.destroy();
});
test('unready identity never reads roster; changed login after picker prevents start',async()=>{
  const f=fixture({ready:false});await wait();assert.equal(f.reads(),0);assert.equal(f.one('mao-gomoku__start').disabled,true);f.page.destroy();
  const g=fixture();await wait();g.choose('mao-gomoku__first','r1');g.session('s2');g.one('mao-gomoku__start').click();await wait();
  assert.equal(all(g.root,'mao-gomoku-board__cell').length,0);g.page.destroy();
});

test('folded public game chat addresses selected role, never invents reply without model',async()=>{
  const f=fixture();await wait();f.choose('mao-gomoku__first','r1');f.one('mao-gomoku__start').click();await wait();
  assert.ok(!f.one('mao-gomoku__chat').open);f.one('mao-gomoku__input').value='开始';f.one('mao-gomoku__send').click();await wait();
  assert.equal(all(f.root,'mao-gomoku__message').length,1);assert.ok(f.one('mao-gomoku__chat-note').textContent.includes('没有可用模型'));f.page.destroy();
  const calls=[],g=fixture({discussion:{generateRole:c=>{calls.push(c);return '可以。';},allowOutput:()=>true}});
  await wait();g.choose('mao-gomoku__first','r1');const box=all(g.root,'mao-gomoku__observer')[1].children[0];box.checked=true;box.fire('change');g.one('mao-gomoku__start').click();await wait();
  g.one('mao-gomoku__target').value='role:r2';g.one('mao-gomoku__input').value='观战感想？';g.one('mao-gomoku__send').click();await wait();
  assert.equal(calls[0].selfSeatId,'role:r2');assert.equal(calls[0].game.legalMoves.length,0);assert.equal(all(g.root,'mao-gomoku__message').length,2);
  g.win.navigator.onLine=false;g.win.fire('offline');assert.equal(all(g.root,'mao-gomoku__message').length,0);
  g.win.navigator.onLine=true;g.one('mao-gomoku__next').click();await wait();assert.equal(all(g.root,'mao-gomoku__message').length,2);g.page.destroy();
});

test('verified combined host checkpoint restores board, difficulty, chat and deduplication on fresh login',async()=>{
  const f=fixture();await wait();f.page.destroy();
  const root=new El(f.win.document,'div'),calls=[];
  const discussion={generateRole:c=>{calls.push(c);return '继续。';},allowOutput:()=>true};
  const host=createGomokuPageHost(root,{win:f.win,discussion});
  await host.start({roomId:'saved',opponents:['r1'],observers:['r2'],blackFirst:false,difficulty:'hard'});
  await host.resume();await host.sendChat({messageId:'first',text:'你好',replyToSeatId:'role:r2'});
  const before=await host.readChat(),saved=await host.saveMatch();host.destroy();f.session('s2');
  const other=createGomokuPageHost(root,{win:f.win,discussion});
  const restored=await other.restoreMatch(saved);
  assert.equal(restored.game.count,1);assert.equal(saved.difficulty,'hard');
  assert.deepEqual(await other.readChat(),before);
  assert.equal((await other.sendChat({messageId:'first',text:'你好',replyToSeatId:'role:r2'})).duplicate,true);
  assert.equal(calls.length,1);await other.sendChat({messageId:'second',text:'继续',replyToSeatId:'role:r1'});assert.equal(calls.length,2);
  assert.equal((await other.readChat()).length,4);
  other.destroy();
  const bad=createGomokuPageHost(root,{win:f.win,discussion});
  await assert.rejects(bad.restoreMatch({...saved,chat:{...saved.chat,revision:99}}),/GOMOKU_INVALID_MATCH/);
  const forged=JSON.parse(JSON.stringify(saved));forged.chat.messages[1].senderSeatId='role:r1';
  await assert.rejects(bad.restoreMatch(forged),/GOMOKU_CHAT_CHECKPOINT/);assert.equal(root.children.length,0);bad.destroy();
});
test('continuous watch is opt-in and stops before another batch after cancellation',async()=>{
  const f=fixture({pace:()=>{}});await wait();f.choose('mao-gomoku__mode','watch');f.choose('mao-gomoku__first','r1');f.choose('mao-gomoku__second','r2');
  f.one('mao-gomoku__start').click();await wait();
  const count=()=>all(f.root,'mao-gomoku-board__cell').filter(c=>/is-black|is-white/.test(c.className)).length;
  assert.equal(count(),8);f.one('mao-gomoku__auto').click();assert.equal(f.one('mao-gomoku__auto').textContent,'停止连播');
  await new Promise(r=>setTimeout(r,400));await wait();assert.ok(count()>8);
  f.one('mao-gomoku__auto').click();const saved=count();
  await new Promise(r=>setTimeout(r,400));await wait();assert.equal(count(),saved);assert.equal(f.one('mao-gomoku__auto').textContent,'连续观战');f.page.destroy();
});

test('full page remount restores board and chat without repeating moves or message IDs',async()=>{
 const f=fixture();await wait();f.choose('mao-gomoku__first','r1');f.one('mao-gomoku__start').click();await wait();
 all(f.root,'mao-gomoku-board__cell')[112].click();await wait();f.one('mao-gomoku__input').value='第一条';f.one('mao-gomoku__send').click();await wait();const saved=await f.page.saveMatch();f.page.destroy();
 const g=fixture();await wait();g.session('s2');await g.page.reload();const v=await g.page.restoreMatch(saved);
 assert.equal(v.game.count,2);assert.equal(all(g.root,'mao-gomoku__message').length,1);
 g.one('mao-gomoku__input').value='第二条';g.one('mao-gomoku__send').click();await wait();assert.equal(all(g.root,'mao-gomoku__message').length,2);g.page.destroy();
});
