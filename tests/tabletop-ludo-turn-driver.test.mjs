import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLudoTurnDriver} from '../games/tabletop/ludo-turn-driver.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
function setup({dice=[3,6,2],n=2,bots=false,...options}={}){
  let ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','r3']},i=0;
  const room=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'drive',gameId:'ludo'},rules:createLudoRules({rollDie:()=>dice[i++%dice.length]})});
  if(bots)room.prepareUserAction()({type:'fillBots',playerCount:n});else for(let j=1;j<n;j++)room.prepareUserAction()({type:'invite',roleId:'r'+j});
  room.prepareUserAction()({type:'start'});
  const views=[];
  const driver=createLudoTurnDriver({session:room,onView:v=>views.push(v),...options});
  return {room,driver,views,change:next=>{ctx=next;},rolls:()=>i};
}
test('automatic role rolls, selects and returns control to user',async()=>{
  const f=setup();f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  const r=await f.driver.runUntilUser();assert.deepEqual(r,{actions:4,status:'user'});
  assert.equal(f.rolls(),3);assert.equal(f.room.viewUser().turnSeatId,'user');
  assert.equal(f.views.length,5);assert.equal(f.views.at(-1).game.players[1].planes[0].progress,2);
});
test('driver never rolls on user turn',async()=>{
  const f=setup();assert.deepEqual(await f.driver.runUntilUser(),{actions:0,status:'user'});assert.equal(f.rolls(),0);
});
test('bounded automatic run yields and resumes without skipping turns',async()=>{
  const f=setup({maxActions:1});f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  assert.deepEqual(await f.driver.runUntilUser(),{actions:1,status:'yield'});
  assert.deepEqual(await f.driver.runUntilUser(),{actions:1,status:'yield'});
  assert.equal(f.room.viewUser().game.players[1].planes[0].progress,0);
});
test('concurrent runs reject; stop during pacing prevents commit',async()=>{
  let release;const f=setup({pace:()=>new Promise(r=>{release=r;})});f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  const p=f.driver.runUntilUser();while(!release)await Promise.resolve();
  await assert.rejects(f.driver.runUntilUser(),/LUDO_DRIVER_BUSY/);f.driver.stop();release();
  await assert.rejects(p,/LUDO_DRIVER_STOPPED/);assert.equal(f.rolls(),1);
  assert.equal(f.driver.status(),'idle');
});
test('roster removal and scope replacement cannot act using the old turn',async()=>{
  for(const ctx of [{accountId:'a',sessionId:'s',roleIds:['r2']},{accountId:'b',sessionId:'s',roleIds:['r1','r2']}]){
    let f;f=setup({pace:()=>f.change(ctx)});f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
    await assert.rejects(f.driver.runUntilUser(),/ROLE_UNAVAILABLE|SCOPE_CHANGED|ROSTER_CHANGED/);assert.equal(f.rolls(),1);
  }
});
test('three and four player games can progress from user to each role in order',async()=>{
  for(const n of [3,4]){const f=setup({n,dice:[3]});f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
    assert.deepEqual(await f.driver.runUntilUser(),{actions:n-1,status:'user'});assert.equal(f.rolls(),n);
    assert.deepEqual(f.views.map(v=>v.turnSeatId),[...Array.from({length:n-1},(_,i)=>'role:r'+(i+1)),'user']);
  }
});
test('dispose is terminal and rejects pending work before any move',async()=>{
  let f;f=setup({pace:()=>f.driver.dispose()});f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  await assert.rejects(f.driver.runUntilUser(),/LUDO_DRIVER_STOPPED/);await assert.rejects(f.driver.runUntilUser(),/LUDO_DRIVER_DISPOSED/);assert.equal(f.rolls(),1);
});
test('stop releases a stalled animation pace without waiting for its completion',async()=>{
  let release;const f=setup({pace:()=>new Promise(r=>{release=r;})});
  f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  const p=f.driver.runUntilUser();while(!release)await Promise.resolve();
  const rejected=assert.rejects(p,/LUDO_DRIVER_STOPPED/);f.driver.stop();
  let timer;try{await Promise.race([rejected,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('STOP_DID_NOT_RELEASE')),100);})]);
    assert.equal(f.driver.status(),'idle');assert.equal(f.rolls(),1);
  }finally{clearTimeout(timer);release();await rejected;}
});
test('a cancelled pace can settle late without interfering with a fresh role run',async()=>{
  let rejectOld,first=true;
  const f=setup({dice:[3],pace:()=>{if(first){first=false;return new Promise((_,reject)=>{rejectOld=reject;});}}});
  f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
  const p=f.driver.runUntilUser();while(!rejectOld)await Promise.resolve();
  f.driver.stop();await assert.rejects(p,/LUDO_DRIVER_STOPPED/);
  assert.deepEqual(await f.driver.runUntilUser(),{actions:1,status:'user'});
  rejectOld(Error('late pace rejection'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.rolls(),2);assert.equal(f.driver.status(),'idle');
});

test('ordinary Ludo seat uses its own optional model, never the saved-role provider',async()=>{
 const calls=[],strategies=[],f=setup({bots:true,decide:()=>{throw Error('wrong provider');},decideBot:(v,signal)=>{calls.push(v);assert.equal(signal.aborted,false);return {move:{kind:'choose',plane:2}};},onStrategy:s=>strategies.push(s)});
 f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
 assert.equal((await f.driver.runUntilUser()).status,'user');assert.equal(calls.length,1);assert.equal(calls[0].selfSeatId,'bot:1');assert.ok(calls[0].seats.every(s=>!Object.hasOwn(s,'roleId')));
 assert.equal(f.room.viewUser().game.players[1].planes[2].progress,2);assert.equal(strategies[0].source,'model');
});
test('stalled model is aborted; local choice continues and late response cannot change board',async()=>{
 let release,signal;const strategies=[],f=setup({bots:true,timeoutMs:1,decideBot:(v,s)=>{signal=s;return new Promise(r=>{release=r;});},onStrategy:s=>strategies.push(s)});
 f.room.prepareUserAction()({type:'move',move:{kind:'roll'}});
 assert.equal((await f.driver.runUntilUser()).status,'user');assert.equal(signal.aborted,true);assert.equal(strategies[0].source,'local');
 const before=f.room.viewUser();release({move:{kind:'choose',plane:3}});await Promise.resolve();assert.deepEqual(f.room.viewUser(),before);
});
