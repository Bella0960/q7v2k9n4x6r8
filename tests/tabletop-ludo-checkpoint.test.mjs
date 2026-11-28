import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
const ctx={accountId:'a',sessionId:'s',roleIds:['r1']},spec={roomId:'room',gameId:'ludo'};
const create=(mode='classic',checkpoint=null,context=ctx,rollDie=()=>6)=>createRoomDispatcher({getContext:()=>context,spec,rules:createLudoRules({mode,rollDie}),checkpoint});
const send=(d,actor,action)=>d.dispatch(actor,d.token(actor),action);
function start(mode='classic',rollDie=()=>6){const d=create(mode,null,ctx,rollDie);send(d,'user',{type:'invite',roleId:'r1'});send(d,'user',{type:'fillBots',playerCount:3});send(d,'user',{type:'start'});return d;}
const move=(d,actor,move)=>send(d,actor,{type:'move',move});
test('classic checkpoint restores exact pending die and legal moves without rerolling',()=>{
  const d=start();move(d,'user',{kind:'roll'});const old=d.token('user'),save=d.checkpoint();
  assert.ok(!JSON.stringify(save).includes('sessionId'));assert.equal(save.moves[0].die,6);
  const restored=create('classic',save,{...ctx,sessionId:'new'},()=>{throw Error('rerolled');});
  assert.deepEqual(restored.view('user'),d.view('user'));
  move(restored,'user',{kind:'choose',plane:0});move(d,'user',{kind:'choose',plane:0});
  assert.deepEqual(restored.view('user'),d.view('user'));assert.deepEqual(restored.checkpoint(),d.checkpoint());
  const same=create('classic',save);assert.throws(()=>same.dispatch('user',old,{type:'move',move:{kind:'choose',plane:0}}),/STALE_ACTION/);
});
test('quick checkpoint preserves cruise, cards, shields, mixed seat order',()=>{
  const d=start('adventure');move(d,'user',{kind:'cruise'});move(d,'user',{kind:'choose',plane:0,card:'shield'});
  const save=d.checkpoint(),restored=create('adventure',save,ctx,()=>{throw Error('rerolled');});
  assert.deepEqual(restored.view('user'),d.view('user'));assert.deepEqual(restored.view('role:r1'),d.view('role:r1'));
  assert.equal(restored.view('user').game.players[0].cruise,0);assert.equal(restored.view('user').game.players[0].planes[0].shield,true);
  save.seats[0].seatId='bad';assert.equal(restored.checkpoint().seats[0].seatId,'user');
});
test('wrong account, room variant, removed role, bogus seat and replay actions refused',()=>{
  const d=start();move(d,'user',{kind:'roll'});const save=d.checkpoint();
  assert.throws(()=>create('classic',save,{...ctx,accountId:'other'}),/INVALID_CHECKPOINT/);
  assert.throws(()=>create('adventure',save),/INVALID_CHECKPOINT/);
  assert.throws(()=>create('classic',save,{...ctx,roleIds:[]}),/INVALID_CHECKPOINT_SEAT/);
  for(const mutate of [s=>s.roomId='other',s=>s.schema=2,s=>s.moves[0].die=7,s=>s.moves[0].actorSeatId='bot:1',s=>s.moves[0].move.die=6,s=>s.seats[2].roleId='r1',s=>s.moves.push({actorSeatId:'user',move:{kind:'choose',plane:9},die:null}),s=>s.result={kind:'win'}]){
    const copy=JSON.parse(JSON.stringify(save));mutate(copy);assert.throws(()=>create('classic',copy),/INVALID_CHECKPOINT|LUDO_INVALID_REPLAY_DIE/);
  }
});
test('failed moves do not enter the checkpoint; lobby and closed room cannot export',()=>{
  const d=create();assert.throws(()=>d.checkpoint(),/CHECKPOINT_UNAVAILABLE/);
  send(d,'user',{type:'fillBots',playerCount:2});send(d,'user',{type:'start'});
  assert.throws(()=>move(d,'user',{kind:'roll',die:6}),/LUDO_EXPECT_ROLL/);assert.equal(d.checkpoint().moves.length,0);
  send(d,'user',{type:'close'});assert.throws(()=>d.checkpoint(),/CHECKPOINT_UNAVAILABLE/);
});
test('finished match restores exact terminal result, cannot replay or settle again',()=>{
  let seed=15;const d=start('adventure',()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%6+1;});
  for(let i=0;i<3000&&d.view('user').phase==='playing';i++){const actor=d.view('user').turnSeatId,moves=d.view(actor).game.legalMoves,m=moves.find(m=>m.effects?.includes('finish'))??moves.find(m=>m.kind==='choose'&&m.from>=0)??moves[0];move(d,actor,m.kind==='choose'?{kind:'choose',plane:m.plane,...(m.card?{card:m.card}:{})}:{kind:m.kind});}
  assert.equal(d.view('user').phase,'finished');
  const save=d.checkpoint(),restored=create('adventure',save);assert.deepEqual(restored.view('user'),d.view('user'));
  assert.throws(()=>restored.token('user'),/ROOM_TERMINAL/);
  save.moves.push({actorSeatId:'user',move:{kind:'roll'},die:6});assert.throws(()=>create('adventure',save),/INVALID_CHECKPOINT_MOVE/);
});
