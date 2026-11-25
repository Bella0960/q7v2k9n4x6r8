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

test('fixture discussion uses ordered real seat identities and visible game context',async()=>{
  const r=create(4,{rollDie:()=>6});
  r.send('开始吧');assert.deepEqual(await r.discuss(),{committed:3});
  const m=r.messages();assert.deepEqual(m.map(x=>x.sender.seatId),['user','role:fixture-1','role:fixture-2','role:fixture-3']);
  assert.ok(m.slice(1).every(x=>x.text.includes('0 架抵达')));
  assert.equal(new Set(m.map(x=>x.id)).size,4);r.dispose();
});
test('discussion does not block board; stop prevents late reply and next round can run',async()=>{
  let release;let delayed=true;
  const r=create(2,{rollDie:()=>6,speechPace:()=>delayed?new Promise(x=>{release=x;}):undefined});
  const p=r.discuss();while(!release)await Promise.resolve();
  r.userMove(action(r.view(),{kind:'roll'}));r.userMove(action(r.view(),{kind:'choose',plane:0}));
  assert.equal(r.view().game.players[0].planes[0].progress,0);
  await assert.rejects(r.discuss(),/PREVIEW_SPEECH_BUSY/);
  r.stopSpeech();await assert.rejects(p,/SPEECH_CANCELLED/);release();
  assert.deepEqual(r.messages(),[]);delayed=false;
  assert.deepEqual(await r.discuss(),{committed:1});assert.equal(r.messages().length,1);r.dispose();
});
test('closing preview cancels discussion, fresh game never receives old reply',async()=>{
  let release;const r=create(2,{speechPace:()=>new Promise(x=>{release=x;})});
  const p=r.discuss();while(!release)await Promise.resolve();r.dispose();
  await assert.rejects(p,/SPEECH_CANCELLED/);release();
  const next=create(2,{roomId:'preview-next'});assert.deepEqual(next.messages(),[]);next.dispose();
});
