import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createWerewolfRules,WEREWOLF_LINEUPS} from '../games/tabletop/werewolf-rules.js';
import {createWerewolfTurnDriver} from '../games/tabletop/werewolf-turn-driver.js';
function fixture({count=6,maxRounds=12,...opts}={}){
 let ctx={accountId:'a',sessionId:'s',roleIds:Array.from({length:11},(_,i)=>'r'+(i+1))};
 const life=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'w',gameId:'werewolf'},rules:createWerewolfRules({randomIndex:n=>n-1,maxRounds})});
 const send=a=>life.prepareUserAction()(a);
 for(let i=1;i<count;i++)send({type:'invite',roleId:'r'+i});send({type:'start'});
 const view=id=>id==='user'?life.viewUser():life.viewRole(id.slice(5));
 const move=(id,m)=>id==='user'?send({type:'move',move:m}):life.prepareRoleTurn(id.slice(5)).commit(m);
 const session={viewUser:async()=>life.viewUser(),viewRole:async id=>life.viewRole(id),prepareRoleTurn:async id=>life.prepareRoleTurn(id)};
 return {view,move,life,driver:createWerewolfTurnDriver({session,...opts}),remove:id=>{ctx={...ctx,roleIds:ctx.roleIds.filter(x=>x!==id)};}};
}
test('6/9/12 exact lineup and only own role; invalid room count rejected',()=>{
 for(const count of [6,9,12]){
  const f=fixture({count}),v=f.view('user');assert.equal(v.game.players.length,count);assert.equal(v.game.selfRole,'wolf');assert.equal(v.game.teammates.length,WEREWOLF_LINEUPS[count].filter(r=>r==='wolf').length-1);
  assert.ok(v.game.players.every(p=>!Object.hasOwn(p,'role')));assert.equal(f.view('role:r2').game.activeSeatId,null);
 }
 assert.throws(()=>fixture({count:7}),/INVALID_PLAYER_COUNT/);
});
test('private night, protection, seer result and public day speech/vote',()=>{
 const f=fixture();assert.throws(()=>f.move('role:r2',{kind:'inspect',targetSeatId:'user'}),/WOLF_NOT_YOUR_TURN/);
 f.move('user',{kind:'choose',targetSeatId:'role:r4'});f.move('role:r1',{kind:'choose',targetSeatId:'role:r4'});
 f.move('role:r3',{kind:'protect',targetSeatId:'role:r4'});f.move('role:r2',{kind:'inspect',targetSeatId:'user'});
 const day=f.view('role:r4');assert.equal(day.game.stage,'day-talk');assert.equal(day.game.publicEvents[0].outSeatId,null);
 assert.equal(Object.hasOwn(day.game,'inspections'),false);assert.equal(f.view('role:r2').game.inspections[0].team,'wolf');assert.equal(Object.hasOwn(day.game,'teamChoices'),false);
 f.move('user',{kind:'speak',text:'先听大家的意见。'});for(let i=1;i<=5;i++)f.move('role:r'+i,{kind:'pass'});
 assert.equal(f.view('user').game.stage,'day-vote');f.move('user',{kind:'vote',targetSeatId:'role:r1'});
 assert.equal(f.view('role:r2').game.publicEvents.some(e=>e.kind==='vote-result'),false);
 for(let i=1;i<=5;i++)f.move('role:r'+i,{kind:'vote',targetSeatId:i===1?'user':'role:r1'});
 const night=f.view('user');assert.equal(night.game.stage,'night');assert.equal(night.game.players[1].alive,false);assert.equal(night.game.publicEvents.at(-1).votes.length,6);
 assert.throws(()=>f.move('role:r1',{kind:'choose',targetSeatId:'role:r4'}),/WOLF_NOT_YOUR_TURN/);
});
test('night and day ties no elimination; finite round cap reveals all',()=>{
 const f=fixture({maxRounds:1});f.move('user',{kind:'choose',targetSeatId:'role:r4'});f.move('role:r1',{kind:'choose',targetSeatId:'role:r5'});f.move('role:r3',{kind:'pass'});f.move('role:r2',{kind:'pass'});
 assert.equal(f.view('user').game.publicEvents[0].outSeatId,null);
 for(const kind of ['talk','vote'])for(const id of ['user',...Array.from({length:5},(_,i)=>'role:r'+(i+1))])f.move(id,{kind:'pass'});
 const v=f.view('user');assert.equal(v.phase,'finished');assert.equal(v.result.kind,'draw');assert.ok(v.game.players.every(p=>p.role));assert.throws(()=>f.move('user',{kind:'pass'}),/ROOM_TERMINAL/);
});
test('wolf parity ends game, terminal role reveal only after rule outcome',()=>{
 const f=fixture();f.move('user',{kind:'choose',targetSeatId:'role:r4'});f.move('role:r1',{kind:'choose',targetSeatId:'role:r4'});f.move('role:r3',{kind:'pass'});f.move('role:r2',{kind:'pass'});
 for(const id of ['user','role:r1','role:r2','role:r3','role:r5'])f.move(id,{kind:'pass'});
 for(const id of ['user','role:r1','role:r2','role:r3','role:r5'])f.move(id,{kind:'vote',targetSeatId:id==='role:r5'?'role:r3':'role:r5'});
 const v=f.view('user');assert.equal(v.phase,'finished');assert.equal(v.game.winningTeam,'wolf');assert.deepEqual(v.result.winnerSeatIds,['user','role:r1']);
});
test('role scheduler receives only seat-specific projections, stops when model missing',async()=>{
 const calls=[],f=fixture({decideRole:v=>{calls.push(v);return {kind:'pass'};},allowSpeech:()=>true});
 f.move('user',{kind:'pass'});const result=await f.driver.runUntilUser();assert.equal(result.status,'user');assert.equal(result.actions,3);
 assert.deepEqual(calls.map(v=>v.selfSeatId),['role:r1','role:r3','role:r2']);assert.equal(Object.hasOwn(calls[1].game,'teammates'),false);assert.equal(Object.hasOwn(calls[0].game,'inspections'),false);
 const g=fixture();g.move('user',{kind:'pass'});assert.deepEqual(await g.driver.runUntilUser(),{status:'model-unavailable',actions:0});
});
test('invalid model action or removed seat cannot commit',async()=>{
 const f=fixture({decideRole:()=>({kind:'choose',targetSeatId:'user'}),allowSpeech:()=>true});f.move('user',{kind:'pass'});await assert.rejects(f.driver.runUntilUser(),/WOLF_DRIVER_BAD_MOVE/);
 let g;g=fixture({decideRole:()=>{g.remove('r1');return {kind:'pass'};},allowSpeech:()=>true});g.move('user',{kind:'pass'});await assert.rejects(g.driver.runUntilUser(),/ROLE_UNAVAILABLE/);
});
test('stop invalidates late role output',async()=>{
 let start,release;const started=new Promise(r=>{start=r;});
 const f=fixture({decideRole:()=>{start();return new Promise(r=>{release=r;});},allowSpeech:()=>true});f.move('user',{kind:'pass'});const rev=f.view('user').revision;
 const p=f.driver.runUntilUser(),rejected=assert.rejects(p,/WOLF_DRIVER_STOPPED/);await started;f.driver.stop();release({kind:'pass'});await rejected;assert.equal(f.view('user').revision,rev);
});
