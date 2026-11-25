import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createTurtleRules} from '../games/tabletop/turtle-rules.js';
import {listTurtlePuzzles} from '../games/tabletop/turtle-puzzles.js';
import {createTurtleTurnDriver} from '../games/tabletop/turtle-turn-driver.js';
function fixture({humanHost=false,maxQuestions=60,count=2,...options}={}){
 let ctx={accountId:'a',sessionId:'s',roleIds:Array.from({length:7},(_,i)=>'r'+(i+1))};
 const lifetime=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{gameId:'turtle',roomId:'t'},rules:createTurtleRules({puzzleId:'rain-window',maxQuestions})});
 const send=action=>lifetime.prepareUserAction()(action),move=m=>send({type:'move',move:m});
 for(let i=1;i<count;i++)send({type:'invite',roleId:'r'+i});
 send({type:'setModerator',seatId:humanHost?'user':'role:r1'});send({type:'start'});
 const session={viewUser:async()=>lifetime.viewUser(),prepareRoleTurn:async id=>lifetime.prepareRoleTurn(id)},driver=createTurtleTurnDriver({session,...options});
 return {lifetime,driver,move,role:(id,m)=>lifetime.prepareRoleTurn(id).commit(m),remove:id=>{ctx={...ctx,roleIds:ctx.roleIds.filter(r=>r!==id)};}};
}
test('catalog contains six original public puzzles without solutions or private verdicts',()=>{
 const puzzles=listTurtlePuzzles();assert.equal(puzzles.length,6);for(const p of puzzles){assert.deepEqual(Object.keys(p),['id','title','difficulty','prompt']);}
});
test('only moderator sees solution before reveal; role judge may not reveal or add text',()=>{
 const f=fixture({count:3}),u=f.lifetime.viewUser(),h=f.lifetime.viewRole('r1'),other=f.lifetime.viewRole('r2');
 assert.equal(Object.hasOwn(u.game,'solution'),false);assert.equal(Object.hasOwn(other.game,'moderatorFacts'),false);assert.ok(h.game.solution);
 assert.throws(()=>f.role('r1',{kind:'reveal'}),/TURTLE_REVEAL_DENIED/);
 f.move({kind:'ask',factId:'weather'});
 assert.throws(()=>f.role('r2',{kind:'answer',verdict:'no'}),/TURTLE_NOT_YOUR_TURN/);
 assert.throws(()=>f.role('r1',{kind:'answer',verdict:'yes'}),/TURTLE_INCONSISTENT_ANSWER/);
 assert.throws(()=>f.role('r1',{kind:'answer',verdict:'no',text:h.game.solution}),/TURTLE_INVALID_MODERATOR_ACTION/);
 f.role('r1',{kind:'answer',verdict:'no'});assert.equal(f.lifetime.viewUser().game.activeSeatId,'role:r2');
 f.move({kind:'reveal'});assert.equal(f.lifetime.viewRole('r2').game.solution,h.game.solution);
});
test('known question auto judgement, free question needs actual judge, no fabricated reply',async()=>{
 const f=fixture();f.move({kind:'ask',factId:'weather'});assert.deepEqual(await f.driver.runUntilUser(),{status:'user',actions:1});
 assert.equal(f.lifetime.viewUser().game.history.at(-1).verdict,'no');
 assert.throws(()=>f.move({kind:'ask',factId:'weather'}),/TURTLE_DUPLICATE_QUESTION/);
 f.move({kind:'ask',text:'水来自哪里？'});assert.deepEqual(await f.driver.runUntilUser(),{status:'model-unavailable',actions:0});
 assert.equal(f.lifetime.viewUser().game.stage,'judging');f.driver.dispose();
});
test('human moderator and eight seats; player model receives only public view, valid guess can solve',async()=>{
 const calls=[],f=fixture({humanHost:true,count:8,askRole:v=>{calls.push(v);return {kind:'guess',text:'清洁工正在洗窗户。'};},allowPlayerText:()=>true});
 assert.deepEqual(await f.driver.runUntilUser(),{status:'user',actions:1});
 assert.equal(calls[0].selfSeatId,'role:r1');assert.equal(Object.hasOwn(calls[0].game,'solution'),false);assert.equal(Object.hasOwn(calls[0].game,'moderatorFacts'),false);
 f.move({kind:'judge',correct:true});const v=f.lifetime.viewUser();assert.equal(v.phase,'finished');assert.deepEqual(v.result,{kind:'win',winnerSeatIds:['role:r1']});assert.equal(v.game.endReason,'solved');
});
test('free question adjudicated only by scoped moderator provider; reject explanation-bearing output',async()=>{
 let seen;const f=fixture({judgeRole:v=>{seen=v;return {kind:'answer',verdict:'yes'};}});
 f.move({kind:'ask',text:'是清洁工作造成的吗？'});await f.driver.runUntilUser();assert.ok(seen.game.solution);assert.equal(Object.hasOwn(f.lifetime.viewUser().game,'solution'),false);
 const g=fixture({judgeRole:()=>({kind:'answer',verdict:'yes',text:'额外解释'})});g.move({kind:'ask',text:'是清洁工作造成的吗？'});
 await assert.rejects(g.driver.runUntilUser(),/TURTLE_DRIVER_BAD_JUDGEMENT/);assert.equal(g.lifetime.viewUser().game.stage,'judging');
});
test('question limit ends after answer and prevents extra turns; hints controlled by catalog',async()=>{
 const f=fixture({maxQuestions:1});f.move({kind:'hint'});assert.equal(f.lifetime.viewUser().game.hintsRemaining,1);f.move({kind:'ask',factId:'weather'});await f.driver.runUntilUser();
 const v=f.lifetime.viewUser();assert.equal(v.game.endReason,'limit');assert.equal(v.phase,'finished');assert.ok(v.game.solution);
 assert.throws(()=>f.move({kind:'ask',factId:'clean'}),/ROOM_TERMINAL/);
});
test('stop and role removal invalidate late moderator judgement',async()=>{
 let start,release;const waiting=new Promise(r=>{start=r;});
 const f=fixture({judgeRole:()=>{start();return new Promise(r=>{release=r;});}});
 f.move({kind:'ask',text:'是清洁工作造成的吗？'});const job=f.driver.runUntilUser(),rejected=assert.rejects(job,/TURTLE_DRIVER_STOPPED/);await waiting;f.driver.stop();release({kind:'answer',verdict:'yes'});await rejected;assert.equal(f.lifetime.viewUser().game.stage,'judging');
 let g;g=fixture({judgeRole:()=>{g.remove('r1');return {kind:'answer',verdict:'yes'};}});g.move({kind:'ask',text:'是清洁工作造成的吗？'});await assert.rejects(g.driver.runUntilUser(),/ROLE_UNAVAILABLE/);
});
