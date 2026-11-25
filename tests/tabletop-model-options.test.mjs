import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTabletopModelOptions} from '../games/tabletop/tabletop-model-options.js';
const identity={accountId:'MAO-AAAAAAAAAAAA',sessionId:'s1'};
function fixture({allowed=true,output=true,abortReady=true,answer={move:{kind:'place',x:7,y:7}}}={}){
 let sessionId='s1',calls=[],charges=[],outputs=[],sources=[],dailyReads=0;
 const roles=[{id:'r1',name:'同名',persona:'谨慎棋手',memory:'日常私人记忆A'},{id:'r2',name:'同名',persona:'另一个角色私有资料B'}];
 const win={document:{hidden:false,querySelector:s=>({content:s.includes('mao-account-role')?'user':identity.accountId})},navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready:true,accountId:identity.accountId,role:'user'},
 fetch:async path=>({ok:true,json:async()=>path.endsWith('/me')?{account:{id:identity.accountId,role:'user',status:'active'}}:{currentSessionId:sessionId}}),
 PhoneStorage:{result:{getCharacters:()=>({ok:true,meta:{source:'ai_custom_characters'},value:roles}),getApiConfig:()=>({ok:true,value:{apiKey:'synthetic-key',model:'test'}})},getChatHistory(){dailyReads++;throw Error('daily')},getMemories(){dailyReads++;throw Error('daily')}},
 MAOMAOChatRoleContext:{buildSavedSourceEnvelope(o){sources.push(o);return {ok:true,persona:o.role.persona,tone:'',worldbook:'绑定世界书',protocol:'协议',expandedProtocol:'协议',worldbookPolicyReady:true};},validateFinalApiMessages(o){return {ok:o.messages[0].content.includes(o.role.persona)&&o.messages[0].content.includes('绑定世界书')};}},
 PhoneAPI:{supportsAbortSignal:abortReady,complete:async opts=>{calls.push(opts);return JSON.stringify(answer);}}};
 const services={win,identity,charge:async x=>{charges.push(x);return allowed;},authorizePublicText:async x=>{outputs.push(x);return output;}};
 const make=gameId=>createTabletopModelOptions({...services,gameId});
 const view=(gameId='gomoku',seat='role:r1')=>({roomId:'room',revision:5,phase:'playing',gameId,selfSeatId:seat,turnSeatId:seat,seats:[{seatId:'user',kind:'user',mode:'player'},{seatId:'role:r1',roleId:'r1',kind:'role',mode:'player'},{seatId:'role:r2',roleId:'r2',kind:'role',mode:'player'},{seatId:'bot:1',kind:'bot',mode:'player'}],game:{legalMoves:[{kind:'place',x:7,y:7}],legalKinds:['ask','speak','pass']}});
 return {make,services,win,view,calls,charges,outputs,sources,dailyReads:()=>dailyReads,session:x=>{sessionId=x;}};
}
test('uses existing saved role source and PhoneAPI, exact legal move, no daily/private peer memory',async()=>{
 const f=fixture(),ac=new AbortController();const move=await f.make('gomoku').decideRole(f.view(),ac.signal);
 assert.deepEqual(move,{move:{kind:'place',x:7,y:7}});assert.equal(f.calls.length,1);assert.equal(f.charges.length,1);assert.equal(f.calls[0].signal,ac.signal);
 const prompt=JSON.stringify(f.calls[0].messages);assert.ok(prompt.includes('谨慎棋手'));assert.ok(!prompt.includes('另一个角色私有资料B'));assert.ok(!prompt.includes('日常私人记忆A'));assert.equal(f.sources[0].memory,'暂无已授权游戏记忆');assert.equal(f.dailyReads(),0);
});
test('missing debit service, denied debit, non-abortable API, and changed login produce zero model calls',async()=>{
 const f=fixture({allowed:false}),signal=new AbortController().signal;
 assert.throws(()=>createTabletopModelOptions({...f.services,gameId:'gomoku',charge:null}),/SERVICES_UNREADY/);
 await assert.rejects(f.make('gomoku').decideRole(f.view(),signal),/BUDGET_DENIED/);assert.equal(f.calls.length,0);
 const g=fixture({abortReady:false});await assert.rejects(g.make('gomoku').decideRole(g.view(),signal),/ABORT_UNREADY/);assert.equal(g.charges.length,0);assert.equal(g.calls.length,0);
 const j=fixture();j.services.charge=async()=>{j.session('s2');return true;};await assert.rejects(j.make('gomoku').decideRole(j.view(),signal),/STALE/);assert.equal(j.calls.length,0);
});
test('ordinary bot never builds character envelope and private Turtle view is rejected for player',async()=>{
 const f=fixture({answer:{text:'轮到我了'}}),signal=new AbortController().signal;
 assert.equal(await f.make('ludo').discussion.generateBot(f.view('ludo','bot:1'),{signal}),'轮到我了');assert.equal(f.sources.length,0);assert.equal(f.outputs[0].roleId,null);
 const g=fixture({answer:{kind:'ask',text:'问题'}}),v=g.view('turtle');v.game.solution='私密谜底';
 await assert.rejects(g.make('turtle').askRole(v,{signal}),/PRIVATE_VIEW/);assert.equal(g.calls.length,0);
});
test('public output denial, illegal move, and cancelled response cannot be accepted',async()=>{
 const f=fixture({answer:{text:'私人资料'},output:false}),signal=new AbortController().signal;
 await assert.rejects(f.make('gomoku').discussion.generateRole(f.view(),{signal}),/OUTPUT_DENIED/);assert.equal(f.outputs.length,1);
 const g=fixture({answer:{move:{kind:'place',x:99,y:99}}});await assert.rejects(g.make('gomoku').decideRole(g.view(),signal),/ILLEGAL_MOVE/);
 const j=fixture(),ac=new AbortController();j.win.PhoneAPI.complete=async()=>{ac.abort();return '{"move":{"kind":"place","x":7,"y":7}}';};await assert.rejects(j.make('gomoku').decideRole(j.view(),ac.signal),/STALE/);
});
test('authorized memory request excludes current mystery and never reads daily chat',async()=>{
 const f=fixture({answer:{kind:'ask',text:'是否有关？'}}),seen=[];f.services.readGameMemory=async o=>{seen.push(o);return '授权游戏记忆';};
 const v=f.view('turtle');v.game.puzzle={id:'rain-window'};
 const result=await f.make('turtle').askRole(v,{signal:new AbortController().signal});assert.equal(result.kind,'ask');assert.equal(seen[0].excludePuzzleId,'rain-window');assert.equal(f.sources[0].memory,'授权游戏记忆');assert.equal(f.dailyReads(),0);
});

test('game recall is explicit even without protocol memory placeholder and revocation blocks request',async()=>{
 const f=fixture();f.services.readGameMemory=async()=> '已授权的棋局历史';await f.make('gomoku').decideRole(f.view(),new AbortController().signal);
 assert.ok(f.calls[0].messages[0].content.includes('已授权的棋局历史'));
 const g=fixture();let memory='授权事实';g.services.readGameMemory=async()=>memory;g.services.charge=async()=>{memory='';return true;};
 await assert.rejects(g.make('gomoku').decideRole(g.view(),new AbortController().signal),/MEMORY_CHANGED/);assert.equal(g.calls.length,0);
});

test('Ludo canonical choice accepts preview metadata without trusting it and rejects forged fields',async()=>{
 const signal=new AbortController().signal;
 const f=fixture({answer:{move:{kind:'choose',plane:1,card:'boost'}}}),v=f.view('ludo');
 v.game.legalMoves=[{kind:'choose',plane:1,from:4,to:10,effects:['boost'],card:'boost'},{kind:'choose',plane:0,from:1,to:5,effects:[]}];
 assert.deepEqual(await f.make('ludo').decideRole(v,signal),{move:{kind:'choose',plane:1,card:'boost'}});
 const bad=fixture({answer:{move:{kind:'choose',plane:1,card:'boost',to:999}}});
 await assert.rejects(bad.make('ludo').decideRole(v,signal),/ILLEGAL_MOVE/);
 const unavailable=fixture({answer:{move:{kind:'choose',plane:0,card:'shield'}}});
 await assert.rejects(unavailable.make('ludo').decideRole(v,signal),/ILLEGAL_MOVE/);
});
test('changed worldbook or protocol after debit blocks network; changed sources during request block response',async()=>{
 const f=fixture(),signal=new AbortController().signal;let book='初始世界书';
 f.win.MAOMAOChatRoleContext.buildSavedSourceEnvelope=o=>({ok:true,persona:o.role.persona,tone:'',worldbook:book,protocol:'协议',expandedProtocol:'协议',worldbookPolicyReady:true});
 f.win.MAOMAOChatRoleContext.validateFinalApiMessages=()=>({ok:true});
 f.services.charge=async()=>{book='更改后的世界书';return true;};
 await assert.rejects(f.make('gomoku').decideRole(f.view(),signal),/SOURCE_CHANGED/);assert.equal(f.calls.length,0);
 const g=fixture();let agreement='协议一';
 g.win.MAOMAOChatRoleContext.buildSavedSourceEnvelope=o=>({ok:true,persona:o.role.persona,tone:'',worldbook:'绑定世界书',protocol:agreement,expandedProtocol:agreement,worldbookPolicyReady:true});
 g.win.PhoneAPI.complete=async()=>{agreement='协议二';return '{"move":{"kind":"place","x":7,"y":7}}';};
 await assert.rejects(g.make('gomoku').decideRole(g.view(),signal),/SOURCE_CHANGED/);
});
