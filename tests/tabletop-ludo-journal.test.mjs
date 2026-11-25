import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {createLudoJournal} from '../games/tabletop/ludo-journal.js';
const ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','outside']};
function board(roomId='room',done=true){
  let seed=15;
  const d=createRoomDispatcher({getContext:()=>ctx,spec:{roomId,gameId:'ludo'},rules:createLudoRules({mode:'adventure',rollDie:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%6+1;}})});
  const send=(actor,action)=>d.dispatch(actor,d.token(actor),action);
  send('user',{type:'invite',roleId:'r1'});send('user',{type:'invite',roleId:'r2'});send('user',{type:'fillBots',playerCount:4});send('user',{type:'start'});
  if(done)for(let i=0;i<3000&&d.view('user').phase==='playing';i++){
    const actor=d.view('user').turnSeatId,moves=d.view(actor).game.legalMoves,m=moves.find(m=>m.effects?.includes('finish'))??moves.find(m=>m.kind==='choose'&&m.from>=0)??moves[0];
    send(actor,{type:'move',move:m.kind==='choose'?{kind:'choose',plane:m.plane,...(m.card?{card:m.card}:{})}:{kind:m.kind}});
  }
  return d.checkpoint();
}
const msg={schema:1,roomId:'room',id:'reply:1:role:r1',sender:{seatId:'role:r1',kind:'role',roleId:'r1'},text:'下一局再试试。',time:1};
test('terminal journal derives result once and creates saved-role facts only',()=>{
  const j=createLudoJournal({getContext:()=>ctx}),b=board();
  const first=j.recordMatch(b);assert.equal(first.duplicate,false);assert.equal(j.recordMatch(b).duplicate,true);assert.equal(j.list().length,1);
  assert.equal(j.read({roleId:'r1'}).length,1);assert.equal(j.read({roleId:'r2'}).length,1);assert.deepEqual(j.read({roleId:'outside'}),[]);
  first.record.winnerSeatId='forged';assert.ok(j.list()[0].winnerSeatId!=='forged');
  assert.throws(()=>j.recordMatch(board('unfinished',false)),/JOURNAL_MATCH_UNFINISHED/);
});
test('own public game memory only; daily and cross-role permissions are per fragment and revocable',()=>{
  const j=createLudoJournal({getContext:()=>ctx});j.recordMatch(board());const f=j.rememberPublicMessage({roomId:'room',message:msg}).fragment;
  assert.equal(j.rememberPublicMessage({roomId:'room',message:msg}).duplicate,true);
  assert.equal(j.read({roleId:'r1'}).length,2);assert.equal(j.read({roleId:'r2'}).length,1);assert.deepEqual(j.read({roleId:'r1',channel:'daily'}),[]);
  j.permit({fragmentId:f.id,targetRoleId:'r2',channel:'daily',allowed:true});
  assert.deepEqual(j.read({roleId:'r2',channel:'daily'}),[f]);assert.equal(j.read({roleId:'r2'}).length,1);
  j.permit({fragmentId:f.id,targetRoleId:'r2',channel:'daily',allowed:false});assert.deepEqual(j.read({roleId:'r2',channel:'daily'}),[]);
  j.permit({fragmentId:f.id,targetRoleId:'r2',channel:'game',allowed:true});assert.equal(j.read({roleId:'r2'}).length,2);
});
test('forged bot/other-role message and cross-account match refused',()=>{
  const j=createLudoJournal({getContext:()=>ctx});j.recordMatch(board());
  for(const m of [{...msg,sender:{seatId:'bot:1',kind:'bot'}},{...msg,sender:{seatId:'role:r2',kind:'role',roleId:'r2'}},{...msg,roomId:'other'}])assert.throws(()=>j.rememberPublicMessage({roomId:'room',message:m}),/JOURNAL_INVALID_MESSAGE/);
  assert.throws(()=>j.recordMatch({...board(),accountId:'foreign'}),/JOURNAL_INVALID_MATCH/);
});
test('scope change and removed role deny reads and grants, no silent eviction',()=>{
  let c=ctx;const j=createLudoJournal({getContext:()=>c,maxMatches:1});j.recordMatch(board());
  const f=j.rememberPublicMessage({roomId:'room',message:msg}).fragment;
  j.permit({fragmentId:f.id,targetRoleId:'r2',channel:'daily',allowed:true});
  assert.throws(()=>j.recordMatch(board('another')),/JOURNAL_CAPACITY/);assert.equal(j.list().length,1);
  c={...ctx,roleIds:['r2','outside']};assert.deepEqual(j.read({roleId:'r2',channel:'daily'}),[]);assert.throws(()=>j.permit({fragmentId:f.id,targetRoleId:'r2',channel:'daily',allowed:true}),/JOURNAL_FRAGMENT_UNAVAILABLE/);
  c={...ctx,sessionId:'new'};assert.throws(()=>j.list(),/JOURNAL_SCOPE_CHANGED/);c=ctx;assert.throws(()=>j.list(),/JOURNAL_CLOSED/);
});
