import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGomokuRules} from '../games/tabletop/gomoku-rules.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createGomokuTurnDriver} from '../games/tabletop/gomoku-turn-driver.js';
function fixture({watch=false,...options}={}){
  let ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2']};
  const life=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'room',gameId:'gomoku'},rules:createGomokuRules()});
  const send=action=>life.prepareUserAction()(action);
  send({type:'invite',roleId:'r1'});send({type:'invite',roleId:'r2',mode:'observer'});
  if(watch)send({type:'swapSeats',playerSeatId:'user',observerSeatId:'role:r2'});
  send({type:'start'});
  if(!watch)send({type:'move',move:{kind:'place',x:7,y:7}});
  const decisions=[],session={viewUser:async()=>life.viewUser(),prepareRoleTurn:async id=>life.prepareRoleTurn(id)};
  const driver=createGomokuTurnDriver({session,onDecision:x=>decisions.push(x),...options});
  return {life,driver,decisions,change:()=>{ctx={...ctx,roleIds:['r2']};}};
}
test('role makes one legal move and returns user turn, model source distinguished',async()=>{
  const f=fixture({decide:()=>({move:{kind:'place',x:6,y:7}})});
  assert.deepEqual(await f.driver.runUntilUser(),{actions:1,status:'user'});
  assert.equal(f.life.viewUser().game.board[7*15+6],2);assert.equal(f.decisions[0].source,'model');
});
test('watch mode alternates roles and yields bounded batch, then continues',async()=>{
  const f=fixture({watch:true,maxActions:3});
  assert.deepEqual(await f.driver.runUntilUser(),{actions:3,status:'yield'});
  assert.deepEqual(f.decisions.map(d=>d.seatId),['role:r1','role:r2','role:r1']);
  assert.deepEqual(await f.driver.runUntilUser(),{actions:3,status:'yield'});
  assert.equal(f.life.viewUser().game.count,6);
});
test('invalid model suggestion is replaced by legal local choice',async()=>{
  const f=fixture({decide:()=>({move:{kind:'place',x:7,y:7}})});
  await f.driver.runUntilUser();assert.equal(f.decisions[0].source,'local');assert.equal(f.life.viewUser().game.count,2);
});
test('timeout aborts model and local strategy continues, late result cannot play',async()=>{
  let release,signal;const f=fixture({timeoutMs:5,decide:(_,s)=>{signal=s;return new Promise(r=>{release=r;});}});
  await f.driver.runUntilUser();assert.equal(signal.aborted,true);assert.equal(f.decisions[0].source,'local');
  release({move:{kind:'place',x:0,y:0}});await Promise.resolve();assert.equal(f.life.viewUser().game.count,2);
});
test('stop during generation and role removal prevent stale placement',async()=>{
  let start,release;const started=new Promise(r=>{start=r;});
  const f=fixture({decide:()=>{start();return new Promise(r=>{release=r;});}});
  const p=f.driver.runUntilUser(),rejected=assert.rejects(p,/GOMOKU_DRIVER_STOPPED/);await started;f.driver.stop();release({move:{kind:'place',x:0,y:0}});await rejected;
  assert.equal(f.life.viewUser().game.count,1);
  let g;g=fixture({decide:()=>{g.change();return {move:{kind:'place',x:0,y:0}};}});
  await assert.rejects(g.driver.runUntilUser(),/ROLE_UNAVAILABLE/);assert.equal(g.decisions.length,0);
});
