import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewRound,PREVIEW_PLAYERS} from './tabletop-preview/ludo-preview-round.js';
const action=(v,move)=>({roomId:v.roomId,revision:v.revision,seatId:'user',move});
const create=(n=2,opts={})=>createPreviewRound({roomId:'preview-test',selectedIds:PREVIEW_PLAYERS.slice(0,n-1),...opts});
test('actual preview controller completes 2, 3 and 4 seat games',async()=>{
  for(const n of [2,3,4]){
    let seed=n+17,last=-1;const r=create(n,{rollDie:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%6+1;},render:v=>{assert.ok(v.revision>last);last=v.revision;}});
    r.show();let count=0;
    while(r.view().phase==='playing'&&count++<20000){
      const v=r.view();
      if(v.turnSeatId==='user'){const m=v.game.legalMoves.find(m=>m.from===-1)??v.game.legalMoves[0];r.userMove(action(v,m.kind==='roll'?{kind:'roll'}:{kind:'choose',plane:m.plane}));}
      else await r.advanceRoles();
    }
    assert.equal(r.view().phase,'finished');assert.equal(r.view().result.winnerSeatIds.length,1);r.dispose();
  }
});
test('invalid fixture selection and stale board action fail closed',()=>{
  for(const selectedIds of [[],['real-role'],['fixture-1','fixture-1']])assert.throws(()=>create(2,{selectedIds}),/PREVIEW_INVALID_PLAYERS/);
  const r=create(2,{rollDie:()=>6}),v=r.view();r.userMove(action(v,{kind:'roll'}));assert.throws(()=>r.userMove(action(v,{kind:'roll'})),/PREVIEW_STALE_ACTION/);assert.throws(()=>r.userMove({...action(r.view(),{kind:'choose',plane:0}),roomId:'preview-other'}),/PREVIEW_STALE_ACTION/);r.dispose();
});
test('chat is independent during role pacing and restart discards prior state',async()=>{
  let release;const r=create(2,{rollDie:()=>3,pace:()=>new Promise(x=>{release=x;})});
  r.userMove(action(r.view(),{kind:'roll'}));const pending=r.advanceRoles();while(!release)await Promise.resolve();
  r.send('本局测试');assert.equal(r.messages()[0].text,'本局测试');assert.equal(r.view().turnSeatId,'role:fixture-1');
  assert.throws(()=>r.userMove(action(r.view(),{kind:'roll'})),/PREVIEW_BUSY/);
  r.dispose();release();await assert.rejects(pending,/LUDO_DRIVER_STOPPED/);
  assert.throws(()=>r.messages(),/PREVIEW_DISPOSED/);const fresh=create(2,{roomId:'preview-new'});assert.deepEqual(fresh.messages(),[]);assert.equal(fresh.view().turnSeatId,'user');fresh.dispose();
});
