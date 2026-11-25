import {getTurtlePuzzleForRules} from './turtle-puzzles.js';

export const TURTLE_VERDICTS=Object.freeze(['yes','no','irrelevant','unclear']);
const fail=code=>{throw Error(code);};
const clone=v=>JSON.parse(JSON.stringify(v));
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=500;
const norm=v=>v.normalize('NFKC').replace(/[\s，。！？、,.!?；;：:]/g,'').toLowerCase();
function roster(room){
 if(room?.gameId!=='turtle'||!Array.isArray(room.seats)||room.seats.length<2||room.seats.length>8||
   !room.seats.every(s=>s&&['moderator','player'].includes(s.mode))||new Set(room.seats.map(s=>s.seatId)).size!==room.seats.length)fail('TURTLE_INVALID_ROOM');
 const moderators=room.seats.filter(s=>s.mode==='moderator'),players=room.seats.filter(s=>s.mode==='player').map(s=>s.seatId);
 if(moderators.length!==1||!players.length)fail('TURTLE_INVALID_ROOM');
 return {host:moderators[0].seatId,players};
}
export function createTurtleRules({puzzleId,maxQuestions=60}={}){
 const puzzle=getTurtlePuzzleForRules(puzzleId);
 if(!Number.isInteger(maxQuestions)||maxQuestions<1||maxQuestions>120)fail('TURTLE_INVALID_LIMIT');
 const publicPuzzle={id:puzzle.id,title:puzzle.title,difficulty:puzzle.difficulty,prompt:puzzle.prompt};
 const fact=id=>puzzle.facts.find(f=>f[0]===id);
 function active(s){return s.pending?s.host:s.players[s.index];}
 function nextTurn(s){s.index=(s.index+1)%s.players.length;s.pending=null;}
 function finish(s,reason,winner=null){s.ended=reason;s.pending=null;return {state:s,result:winner?{kind:'win',winnerSeatIds:[winner]}:{kind:'draw',winnerSeatIds:[]}};}
 function check(s,room){
   const r=roster(room);
   if(s?.schema!==1||s.puzzleId!==puzzle.id||s.host!==r.host||JSON.stringify(s.players)!==JSON.stringify(r.players)||
     !Number.isInteger(s.index)||s.index<0||s.index>=r.players.length||!Array.isArray(s.history)||s.history.length>maxQuestions*2+maxQuestions+2||
     !Number.isInteger(s.questions)||s.questions<0||s.questions>maxQuestions||!Number.isInteger(s.hints)||s.hints<0||s.hints>puzzle.hints.length||
     ![null,'solved','revealed','limit'].includes(s.ended)||Boolean(s.ended)!==(room.phase==='finished'))fail('TURTLE_INVALID_STATE');
   return r;
 }
 return Object.freeze({gameId:'turtle',
 init(room){const {host,players}=roster(room);return {schema:1,puzzleId:puzzle.id,host,players,index:0,history:[],questions:0,hints:0,pending:null,ended:null};},
 step({state,room,actorSeatId,move}){
   check(state,room);
   if(room.phase!=='playing'||!move||typeof move.kind!=='string')fail('TURTLE_INVALID_MOVE');
   const s=clone(state),kind=move.kind;
   // Reveal is an explicit human owner operation; a generated role cannot
   // decide to disclose the answer unilaterally.
   if(kind==='reveal'){
     if(actorSeatId!=='user'||!exact(move,['kind']))fail('TURTLE_REVEAL_DENIED');
     return finish(s,'revealed');
   }
   if(actorSeatId!==active(s))fail('TURTLE_NOT_YOUR_TURN');
   if(s.pending){
     const p=s.pending;
     if(kind==='answer'&&p.kind==='ask'&&exact(move,['kind','verdict'])&&TURTLE_VERDICTS.includes(move.verdict)){
       const known=p.factId?fact(p.factId):puzzle.facts.find(f=>norm(f[1])===norm(p.text));
       if(known&&known[2]!==move.verdict)fail('TURTLE_INCONSISTENT_ANSWER');
       s.history.push({kind:'answer',seatId:s.host,verdict:move.verdict,questionId:p.id});
     }else if(kind==='judge'&&p.kind==='guess'&&exact(move,['kind','correct'])&&typeof move.correct==='boolean'){
       // Natural-language correctness is a moderator judgement. Structured
       // result only; no model-generated answer or explanation is accepted.
       s.history.push({kind:'judge',seatId:s.host,correct:move.correct,questionId:p.id});
       if(move.correct)return finish(s,'solved',p.seatId);
     }else fail('TURTLE_INVALID_MODERATOR_ACTION');
     nextTurn(s);
     if(s.questions===maxQuestions)return finish(s,'limit');
     return {state:s,nextSeatId:null};
   }
   if(kind==='hint'&&exact(move,['kind'])){
     if(s.hints>=puzzle.hints.length)fail('TURTLE_NO_HINT');
     s.history.push({kind:'hint',seatId:s.host,text:puzzle.hints[s.hints++]});
     nextTurn(s);return {state:s,nextSeatId:null};
   }
   if(kind==='pass'&&exact(move,['kind'])){
     // Pass consumes a turn and the question budget; prevents infinite loops.
     s.questions++;s.history.push({kind:'pass',seatId:actorSeatId});
     nextTurn(s);if(s.questions===maxQuestions)return finish(s,'limit');return {state:s,nextSeatId:null};
   }
   let value,selected=null;
   if(kind==='ask'&&exact(move,['kind','factId'])){selected=fact(move.factId);if(!selected)fail('TURTLE_INVALID_QUESTION');value=selected[1];}
   else if(['ask','guess'].includes(kind)&&exact(move,['kind','text'])&&text(move.text))value=move.text;
   else fail('TURTLE_INVALID_PLAYER_ACTION');
   if(s.history.some(q=>q.kind===kind&&typeof q.text==='string'&&norm(q.text)===norm(value)))fail('TURTLE_DUPLICATE_QUESTION');
   s.questions++;
   const entry={kind,seatId:actorSeatId,id:s.questions,text:value};
   s.history.push(entry);s.pending={...entry,...(selected?{factId:selected[0]}:{})};
   return {state:s,nextSeatId:null};
 },
 project({state:s,room,actorSeatId}){
   check(s,room);
   const seat=room.seats.find(x=>x.seatId===actorSeatId);if(!seat)fail('TURTLE_UNKNOWN_SEAT');
   const finished=room.phase==='finished',moderator=actorSeatId===s.host,isActive=!finished&&active(s)===actorSeatId;
   const known=s.pending?.kind==='ask'?(s.pending.factId?fact(s.pending.factId):puzzle.facts.find(f=>norm(f[1])===norm(s.pending.text))):null;
   const legalKinds=finished?[]:isActive?(s.pending?[s.pending.kind==='ask'?'answer':'judge']:['ask','guess','pass',...(s.hints<puzzle.hints.length?['hint']:[])]):[];
   if(!finished&&actorSeatId==='user')legalKinds.push('reveal');
   return {schema:1,puzzle:clone(publicPuzzle),hostSeatId:s.host,activeSeatId:finished?null:active(s),stage:finished?'finished':s.pending?'judging':'questioning',
     history:clone(s.history),questions:s.questions,maxQuestions,hintsRemaining:puzzle.hints.length-s.hints,legalKinds,
     questionOptions:!finished&&!moderator?puzzle.facts.filter(f=>!s.history.some(q=>q.kind==='ask'&&norm(q.text)===norm(f[1]))).map(([id,label])=>({id,label})):[],
     pending:s.pending?{kind:s.pending.kind,seatId:s.pending.seatId,id:s.pending.id,text:s.pending.text}:null,
     ...(moderator||finished?{solution:puzzle.answer}:{}),
     ...(moderator&&!finished?{moderatorFacts:puzzle.facts.map(([id,label,verdict])=>({id,label,verdict})),pendingVerdict:known?.[2]??null}:{}),
     ...(finished?{endReason:s.ended}:{})};
 }
 });
}
