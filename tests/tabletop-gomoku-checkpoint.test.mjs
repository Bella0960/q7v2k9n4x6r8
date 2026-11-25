import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createGomokuRules} from '../games/tabletop/gomoku-rules.js';
const ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','r3']},spec={gameId:'gomoku',roomId:'g'};
const create=(checkpoint=null,c=ctx)=>createRoomDispatcher({getContext:()=>c,spec,rules:createGomokuRules(),checkpoint});
function start(watch=false){
  const d=create(),send=(a)=>d.dispatch('user',d.token('user'),a);
  send({type:'invite',roleId:'r1'});send({type:'invite',roleId:'r2',mode:'observer'});
  if(watch)send({type:'swapSeats',playerSeatId:'user',observerSeatId:'role:r2'});
  else send({type:'reorder',seatIds:['role:r1','user','role:r2']});
  send({type:'start'});return d;
}
function move(d,x,y){const actor=d.view('user').turnSeatId;return d.dispatch(actor,d.token(actor),{type:'move',move:{kind:'place',x,y}});}
test('Gomoku checkpoint preserves black/white and observer seat order and rejects prior tokens',()=>{
  for(const watch of [false,true]){
    const d=start(watch);move(d,7,7);move(d,8,8);const saved=d.checkpoint(),old=d.token(d.view('user').turnSeatId);
    const fresh=create(saved,{...ctx,sessionId:'new'});assert.deepEqual(fresh.view('user'),d.view('user'));
    assert.deepEqual(create(saved).view('user'),d.view('user'));const same=create(saved);
    assert.throws(()=>same.dispatch(old.seatId,old,{type:'move',move:{kind:'place',x:9,y:9}}),/STALE_ACTION/);
    move(fresh,9,9);move(d,9,9);assert.deepEqual(fresh.checkpoint(),d.checkpoint());
    assert.ok(!JSON.stringify(saved).includes('sessionId'));
  }
});
test('Gomoku checkpoint rejects foreign account, removed observer and forged actions',()=>{
  const d=start();move(d,7,7);const saved=d.checkpoint();
  assert.throws(()=>create(saved,{...ctx,accountId:'other'}),/INVALID_CHECKPOINT/);
  assert.throws(()=>create(saved,{...ctx,roleIds:['r1']}),/INVALID_CHECKPOINT_SEAT/);
  for(const alter of [s=>s.moves[0].actorSeatId='role:r2',s=>s.moves[0].move.x=15,s=>s.moves[0].die=6,s=>s.seats[2].mode='player',s=>s.gameId='ludo']){
    const bad=JSON.parse(JSON.stringify(saved));alter(bad);assert.throws(()=>create(bad),/INVALID_CHECKPOINT/);
  }
});
test('Gomoku terminal history restores exactly and cannot play extra moves',()=>{
  const d=start();for(let i=0;i<5;i++){move(d,i,0);if(i<4)move(d,i*2,10);}
  const saved=d.checkpoint(),restored=create(saved);assert.deepEqual(restored.view('user'),d.view('user'));
  assert.equal(restored.view('user').phase,'finished');assert.throws(()=>restored.token('user'),/ROOM_TERMINAL/);
  saved.moves.push({actorSeatId:'user',move:{kind:'place',x:9,y:9}});assert.throws(()=>create(saved),/INVALID_CHECKPOINT_MOVE/);
});
