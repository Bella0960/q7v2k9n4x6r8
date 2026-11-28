import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
const context=()=>({accountId:'a',sessionId:'s',roleIds:['r1','r2','r3']});
function fixture({gameId='gomoku',init,step,getContext,project}={}) {
  let calls=0,ctx=context();
  const d=createRoomDispatcher({getContext:getContext||(()=>ctx),spec:{roomId:'room',gameId},rules:{gameId,project,init:init||(()=>({count:0,private:'secret'})),step:step||(({state,actorSeatId,move})=>{calls++;if(move==='bad')throw Error('ILLEGAL_MOVE');return {state:{...state,count:state.count+1},nextSeatId:move==='win'?null:actorSeatId==='user'?'role:r1':'user',result:move==='win'?{kind:'win',winnerSeatIds:[actorSeatId]}:null};})}});
  const send=(type,data={},actor='user',token=d.token(actor))=>d.dispatch(actor,token,{type,...data});
  const start=()=>{send('invite',{roleId:'r1'});send('start');};
  return {d,send,start,calls:()=>calls,setCtx:c=>{ctx=c;}};
}
test('double clicks cannot commit two moves; next actor uses new revision',()=>{const f=fixture();f.start();const t=f.d.token('user');f.send('move',{move:'ok'},'user',t);assert.throws(()=>f.send('move',{move:'ok'},'user',t),/STALE_ACTION/);assert.equal(f.calls(),1);assert.equal(f.send('move',{move:'ok'},'role:r1').turnSeatId,'user');});
test('late reply after room closes is rejected',()=>{const f=fixture();f.start();f.send('move',{move:'ok'});const t=f.d.token('role:r1');f.send('close');assert.throws(()=>f.send('move',{move:'ok'},'role:r1',t),/STALE_ACTION|ROOM_TERMINAL/);assert.equal(f.d.view('user').phase,'closed');});
test('no raw advance, forged result or out-of-turn move',()=>{const f=fixture();f.start();assert.throws(()=>f.send('advance'),/UNKNOWN_ACTION/);assert.throws(()=>f.send('finish',{result:{kind:'win'}}),/UNKNOWN_ACTION/);assert.throws(()=>f.send('move',{move:'ok'},'role:r1'),/NOT_YOUR_TURN/);assert.equal(f.calls(),0);});
test('observer may view but cannot move or become next player',()=>{const f=fixture({step:()=>({state:{},nextSeatId:'role:r2'})});f.send('invite',{roleId:'r2',mode:'observer'});f.start();assert.throws(()=>f.send('move',{move:'ok'},'role:r2'),/OBSERVER_CANNOT_MOVE/);assert.throws(()=>f.send('move',{move:'ok'}),/INVALID_NEXT_SEAT/);assert.equal(f.d.view('user').turnSeatId,'user');});
test('invalid move and mutations to cloned state do not commit',()=>{let attempt=0;const f=fixture({step:({state})=>{assert.equal(state.count,0);state.count++;if(!attempt++)throw Error('ILLEGAL_MOVE');return {state,nextSeatId:'role:r1'};}});f.start();const t=f.d.token('user');assert.throws(()=>f.send('move',{move:1},'user',t),/ILLEGAL_MOVE/);assert.equal(f.send('move',{move:2},'user',t).turnSeatId,'role:r1');});
test('terminal result immutable, projected only at finish, all later actions rejected',()=>{const f=fixture();f.start();const t=f.d.token('user');assert.equal(f.d.view('user').result,null);const v=f.send('move',{move:'win'},'user',t);assert.equal(v.phase,'finished');assert.equal(v.turnSeatId,null);v.result.winnerSeatIds.push('fake');assert.deepEqual(f.d.view('role:r1').result,{kind:'win',winnerSeatIds:['user']});assert.throws(()=>f.d.token('user'),/ROOM_TERMINAL/);assert.throws(()=>f.send('close',{},'user',t),/STALE_ACTION|ROOM_TERMINAL/);});
test('invalid terminal result and async rules fail without revision change',()=>{for(const step of [()=>({state:{},result:{kind:'win',winnerSeatIds:['fake']}}),async()=>({state:{},nextSeatId:'user'}),()=>({state:{},result:{kind:'draw',winnerSeatIds:['user']}})]){const f=fixture({step});f.start();const before=f.d.view('user');assert.throws(()=>f.send('move',{move:'ok'}),/INVALID_RESULT|INVALID_RULE_TRANSITION/);assert.deepEqual(f.d.view('user'),before);}});
test('failed initialization does not start a room',()=>{const f=fixture({init:()=>{throw Error('INIT_FAILED');}});f.send('invite',{roleId:'r1'});const before=f.d.view('user');assert.throws(()=>f.send('start'),/INIT_FAILED/);assert.deepEqual(f.d.view('user'),before);});
test('account or session change rejects pending response',()=>{const f=fixture();f.start();const t=f.d.token('user');for(const c of [{...context(),accountId:'b'},{...context(),sessionId:'new'}]){f.setCtx(c);assert.throws(()=>f.send('move',{move:'ok'},'user',t),/SCOPE_MISMATCH/);}f.setCtx(context());assert.equal(f.calls(),0);});
test('context change inside rule computation prevents commit',()=>{let f;f=fixture({step:()=>{f.setCtx({...context(),roleIds:[]});return {state:{},nextSeatId:'role:r1'};}});f.start();const before=f.d.view('user');assert.throws(()=>f.send('move',{move:'ok'}),/ROLE_UNAVAILABLE/);f.setCtx(context());assert.deepEqual(f.d.view('user'),before);});
test('reentrant dispatch rejected, outer legal move can finish',()=>{let f;f=fixture({step:()=>{assert.throws(()=>f.d.view('user'),/DISPATCH_BUSY/);return {state:{},nextSeatId:'role:r1'};}});f.start();assert.equal(f.send('move',{move:'ok'}).turnSeatId,'role:r1');});
test('public view never includes rule state, session or private result fields',()=>{const f=fixture({step:()=>({state:{private:'secret'},result:{kind:'draw',winnerSeatIds:[],secret:'secret'}})});f.start();assert.ok(!JSON.stringify(f.d.view('user')).includes('secret'));const v=f.send('move',{move:'ok'});assert.ok(!JSON.stringify(v).includes('secret'));assert.ok(!('sessionId' in v));});
test('extra turn supported by rule, without forcing round-robin',()=>{const f=fixture({gameId:'ludo',step:()=>({state:{},nextSeatId:'user'})});f.start();assert.equal(f.send('move',{move:'ok'}).turnSeatId,'user');});
test('host can remove multiple unavailable roles one by one without leaking stale roster',()=>{const f=fixture({gameId:'ludo'});f.send('invite',{roleId:'r1'});f.send('invite',{roleId:'r2'});f.setCtx({...context(),roleIds:[]});const v=f.send('remove',{seatId:'role:r1'});assert.equal(v.recoveryRequired,true);assert.ok(!('seats' in v));assert.equal(f.send('remove',{seatId:'role:r2'}).seats.length,1);});
test('host can close after a role disappears; stale private roster is not returned',()=>{const f=fixture();f.start();f.setCtx({...context(),roleIds:[]});const v=f.send('close');assert.equal(v.phase,'closed');assert.ok(!('seats' in v));assert.throws(()=>f.d.token('user'),/ROOM_TERMINAL/);});

test('sparse winner list rejected and original room preserved',()=>{const f=fixture({step:()=>({state:{},result:{kind:'win',winnerSeatIds:Array(1)}})});f.start();const before=f.d.view('user');assert.throws(()=>f.send('move',{move:'ok'}),/INVALID_RESULT/);assert.deepEqual(f.d.view('user'),before);});

// Trusted adapters opt in to a per-seat, detached board/discussion view.
test('rule projection supplies only the current seat\'s allowed board and private fields',()=>{
  const f=fixture({init:()=>({board:[0],hidden:'raw-secret',hands:{user:'my-card','role:r1':'r1-card','role:r2':'r2-card'}}),project:({state,actorSeatId})=>({board:state.board,hand:state.hands[actorSeatId]??null}),step:({state})=>({state:{...state,board:[1]},nextSeatId:'role:r1'})});
  f.send('invite',{roleId:'r2',mode:'observer'});f.start();
  assert.deepEqual(f.d.view('user').game,{board:[0],hand:'my-card'});
  assert.deepEqual(f.d.view('role:r1').game,{board:[0],hand:'r1-card'});
  assert.deepEqual(f.d.view('role:r2').game,{board:[0],hand:'r2-card'});
  const updated=f.send('move',{move:1});assert.deepEqual(updated.game,{board:[1],hand:'my-card'});
  assert.ok(!JSON.stringify(updated).includes('raw-secret'));assert.ok(!JSON.stringify(updated).includes('r1-card'));
  assert.throws(()=>f.d.view('role:r3'),/UNKNOWN_SEAT/);
});
test('projection mutations and returned view mutations cannot alter rule state or room metadata',()=>{
  const f=fixture({init:()=>({board:[0]}),project:({state,room})=>{state.board.push(99);room.seats.length=0;return {board:state.board};},step:({state})=>{assert.deepEqual(state.board,[0]);return {state:{board:[1]},nextSeatId:'role:r1'};}});
  f.start();const v=f.d.view('user');assert.equal(v.seats.length,2);v.game.board.push(100);
  assert.deepEqual(f.d.view('user').game.board,[0,99]);assert.deepEqual(f.send('move',{move:1}).game.board,[1,99]);
});
test('projection error prevents start and move commit atomically',()=>{
  let broken=true;const f=fixture({project:()=>{if(broken)throw Error('PROJECTION_FAILED');return {ok:true};}});
  f.send('invite',{roleId:'r1'});const before=f.d.view('user');assert.throws(()=>f.send('start'),/PROJECTION_FAILED/);assert.deepEqual(f.d.view('user'),before);
  broken=false;f.send('start');const playing=f.d.view('user');broken=true;assert.throws(()=>f.send('move',{move:'ok'}),/PROJECTION_FAILED/);broken=false;assert.deepEqual(f.d.view('user'),playing);
});
test('invalid asynchronous or non-object projection fails before room transition',()=>{
  for(const project of [async()=>({}),()=>undefined,()=>null,()=>[],()=>1]){const f=fixture({project});f.send('invite',{roleId:'r1'});const before=f.d.view('user');assert.throws(()=>f.send('start'),/INVALID_RULE_PROJECTION/);assert.deepEqual(f.d.view('user'),before);}
});
test('no game projection in lobby or closed room, finished view is rule-controlled',()=>{
  let calls=0;const f=fixture({project:({room})=>{calls++;return {finished:room.phase==='finished'};}});
  assert.ok(!('game' in f.d.view('user')));assert.equal(calls,0);f.start();assert.deepEqual(f.d.view('user').game,{finished:false});
  const end=f.send('move',{move:'win'});assert.deepEqual(end.game,{finished:true});assert.deepEqual(f.d.view('role:r1').game,{finished:true});
  const g=fixture({project:()=>{throw Error('unexpected projection');}});assert.ok(!('game' in g.send('close')));
});
test('scope change during projection prevents commit and a projected read',()=>{
  let changed=false,f;f=fixture({project:()=>{if(changed)f.setCtx({...context(),roleIds:[]});return {board:[0]};}});f.start();const before=f.d.view('user');changed=true;
  assert.throws(()=>f.send('move',{move:'ok'}),/ROLE_UNAVAILABLE/);f.setCtx(context());assert.throws(()=>f.d.view('user'),/ROLE_UNAVAILABLE/);
  f.setCtx(context());changed=false;assert.deepEqual(f.d.view('user'),before);
});
