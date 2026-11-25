import {createRoomDispatcher} from './room-dispatcher.js';
import {createLudoRules} from './ludo-rules.js';
import {validateLudoChatCheckpoint} from './ludo-discussion.js';
import {createGomokuRules} from './gomoku-rules.js';
import {validateGomokuChatCheckpoint} from './gomoku-discussion.js';
import {createTurtleRulesFromMode} from './turtle-rules.js';
import {createWerewolfRulesFromMode} from './werewolf-rules.js';

// Internal, account-scoped in-memory journal. The caller must supply an
// authenticated context and validated repository records, never model output.
// No daily-chat writes, storage keys, network calls or financial settlement.
const fail=code=>{throw Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const clone=v=>JSON.parse(JSON.stringify(v));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
function scope(getContext){
  const c=getContext();
  if(!c||!id(c.accountId)||!id(c.sessionId)||!Array.isArray(c.roleIds)||!Array.from(c.roleIds).every(id))fail('JOURNAL_SCOPE');
  return {accountId:c.accountId,sessionId:c.sessionId,roleIds:[...new Set(c.roleIds)]};
}
const fragmentId=(roomId,roleId,source)=>JSON.stringify([roomId,roleId,source]);
const grantId=(fragmentId,roleId,channel)=>JSON.stringify([fragmentId,roleId,channel]);
export function createLudoJournal(options={}){return createGameJournal({...options,gameIds:['ludo']});}
export function createGameJournal({getContext,maxMatches=512,snapshot=null,gameIds=['ludo','gomoku','turtle','werewolf']}={}){
  if(!Array.isArray(gameIds)||!gameIds.length||!gameIds.every(g=>['ludo','gomoku','turtle','werewolf'].includes(g)))fail('JOURNAL_SPEC');
  const allowedGames=new Set(gameIds);
  if(typeof getContext!=='function'||!Number.isInteger(maxMatches)||maxMatches<1||maxMatches>4096)fail('JOURNAL_SPEC');
  const initial=scope(getContext),records=new Map(),fragments=new Map(),grants=new Set(),muted=new Set(),replays=new Map();
  let closed=false;
  function current(){
    if(closed)fail('JOURNAL_CLOSED');
    const c=scope(getContext);
    if(c.accountId!==initial.accountId||c.sessionId!==initial.sessionId){closed=true;fail('JOURNAL_SCOPE_CHANGED');}
    // An observed role removal revokes every grant involving that role.
    for(const key of grants){const [fid,target]=JSON.parse(key),f=fragments.get(fid);if(!f||!c.roleIds.includes(f.roleId)||!c.roleIds.includes(target))grants.delete(key);}
    return c;
  }
  function same(c){
    const n=current();
    if(n.roleIds.length!==c.roleIds.length||c.roleIds.some(id=>!n.roleIds.includes(id)))fail('JOURNAL_ROSTER_CHANGED');
    return n;
  }
  function getFragment(fid,c){
    const f=fragments.get(fid);
    if(!f||!c.roleIds.includes(f.roleId))fail('JOURNAL_FRAGMENT_UNAVAILABLE');
    return f;
  }
  function recordMatch(board,chat=null){
    const c=current();
    const gomoku=board?.gameId==='gomoku',turtle=board?.gameId==='turtle',wolf=board?.gameId==='werewolf';
    if(!board||board.accountId!==c.accountId||!allowedGames.has(board.gameId)||!id(board.roomId)||!(wolf?typeof board.mode==='string'&&board.mode.startsWith('werewolf-v1:'):turtle?typeof board.mode==='string'&&board.mode.startsWith('puzzle-v1:'):gomoku?board.mode==='freestyle':['classic','adventure'].includes(board.mode)))fail('JOURNAL_INVALID_MATCH');
    // The authoritative engine derives the terminal result and all positions.
    // A caller-provided winner, summary or timestamp cannot settle a match.
    const d=createRoomDispatcher({getContext:()=>c,spec:{gameId:board.gameId,roomId:board.roomId},rules:wolf?createWerewolfRulesFromMode(board.mode):turtle?createTurtleRulesFromMode(board.mode):gomoku?createGomokuRules():createLudoRules({mode:board.mode}),checkpoint:board});
    const v=d.view('user');
    if(v.phase!=='finished'||!(v.result?.kind==='win'&&(wolf?v.result.winnerSeatIds.length>0:v.result.winnerSeatIds.length===1)||(gomoku||turtle||wolf)&&v.result?.kind==='draw'&&v.result.winnerSeatIds.length===0))fail('JOURNAL_MATCH_UNFINISHED');
    const winner=v.result.winnerSeatIds[0]??null;
    const recordKey=JSON.stringify([board.gameId,v.roomId]);
    const memoryId=(roleId,source)=>gomoku||turtle||wolf?JSON.stringify([board.gameId,v.roomId,roleId,source]):fragmentId(v.roomId,roleId,source);
    const entry={schema:1,accountId:c.accountId,roomId:v.roomId,gameId:board.gameId,mode:board.mode,revision:v.revision,
      winnerSeatId:winner,players:v.seats.map(s=>({seatId:s.seatId,kind:s.kind,...(s.kind==='role'?{roleId:s.roleId}:{}),...(wolf?{mode:s.mode,activeAtEnd:v.game.players.find(p=>p.seatId===s.seatId).alive}:turtle?{mode:s.mode}:gomoku?{mode:s.mode,color:v.game.players.find(p=>p.seatId===s.seatId)?.color??null}:{finished:v.game.players.find(p=>p.seatId===s.seatId).planes.filter(p=>p.zone==='finished').length})})),...(wolf?{winningTeam:v.game.winningTeam,winnerSeatIds:[...v.result.winnerSeatIds],rounds:v.game.round}:turtle?{puzzleId:v.game.puzzle.id,title:v.game.puzzle.title,questions:v.game.questions,endReason:v.game.endReason}:gomoku?{moves:v.game.count}:{} )};
    const publicMessages=chat===null?[]:(gomoku?validateGomokuChatCheckpoint(v,chat):validateLudoChatCheckpoint(v,chat)).log.read('user').filter(m=>m.sender.kind==='role');
    const messageFragments=publicMessages.map(m=>({schema:1,id:memoryId(m.sender.roleId,m.id),roomId:v.roomId,roleId:m.sender.roleId,kind:'public-message',gameId:board.gameId,text:m.text,time:m.time,sourceMessageId:m.id}));
    // Only the role's own public question/guess; never copy the moderator
    // solution, hints, private facts or another player's statements.
    if(turtle)for(const item of v.game.history){
      if(!['ask','guess'].includes(item.kind))continue;
      const seat=v.seats.find(s=>s.seatId===item.seatId&&s.kind==='role');
      if(!seat)continue;
      messageFragments.push({schema:1,id:memoryId(seat.roleId,'turn:'+item.id),roomId:v.roomId,roleId:seat.roleId,kind:'public-question',gameId:'turtle',puzzleId:v.game.puzzle.id,action:item.kind,text:item.text});
    }
    // Never archive night actions, deck, inspection results, or identities
    // into model-readable memory. Own public speech only after game ends.
    if(wolf)for(const [i,item] of v.game.publicEvents.entries()){
      if(item.kind!=='speech')continue;
      const seat=v.seats.find(s=>s.seatId===item.seatId&&s.kind==='role');if(!seat)continue;
      messageFragments.push({schema:1,id:memoryId(seat.roleId,'speech:'+i),roomId:v.roomId,roleId:seat.roleId,kind:'public-message',gameId:'werewolf',text:item.text,round:item.round});
    }
    same(c);
    const prior=records.get(recordKey);
    if(prior){
      if(JSON.stringify(prior)!==JSON.stringify(entry))fail('JOURNAL_MATCH_CONFLICT');
      if(messageFragments.some(f=>JSON.stringify(fragments.get(f.id))!==JSON.stringify(f)))fail('JOURNAL_MATCH_CONFLICT');
      return {duplicate:true,record:clone(prior)};
    }
    if(records.size>=maxMatches)fail('JOURNAL_CAPACITY');
    // Facts are not fabricated emotional memories; each saved role receives
    // its own result. Bots have no durable identity and receive no fragments.
    const next=entry.players.filter(p=>p.kind==='role').map(p=>({
      schema:1,id:memoryId(p.roleId,'result'),roomId:v.roomId,roleId:p.roleId,kind:'result',
      gameId:board.gameId,mode:entry.mode,outcome:wolf?v.result.kind==='draw'?'draw':v.result.winnerSeatIds.includes(p.seatId)?'win':'loss':turtle?p.mode==='moderator'?'hosted':winner===p.seatId?'solved':'participated':gomoku&&p.mode==='observer'?'observed':winner===null?'draw':p.seatId===winner?'win':'loss',...(wolf?{rounds:entry.rounds,activeAtEnd:p.activeAtEnd}:turtle?{puzzleId:entry.puzzleId,questions:entry.questions,endReason:entry.endReason}:gomoku?{color:p.color,moves:entry.moves}:{finished:p.finished})
    }));
    records.set(recordKey,entry);replays.set(recordKey,clone({board,chat}));for(const f of [...next,...messageFragments])fragments.set(f.id,f);
    return {duplicate:false,record:clone(entry)};
  }
  function recordSavedMatch(saved){
    const gomoku=saved?.board?.gameId==='gomoku';
    if(['turtle','werewolf'].includes(saved?.board?.gameId)){
      if(!exact(saved,['schema','board'])||saved.schema!==1)fail('JOURNAL_INVALID_MATCH');
      return recordMatch(saved.board);
    }
    if(!exact(saved,gomoku?['schema','board','chat','difficulty']:['schema','board','chat'])||saved.schema!==1||!saved.board||!saved.chat||gomoku&&!['easy','normal','hard'].includes(saved.difficulty))fail('JOURNAL_INVALID_MATCH');
    return recordMatch(saved.board,saved.chat);
  }
  function permit({fragmentId:fid,targetRoleId,channel,allowed}={}){
    const c=current(),f=getFragment(fid,c);
    if(!c.roleIds.includes(targetRoleId)||!['game','daily'].includes(channel)||typeof allowed!=='boolean')fail('JOURNAL_INVALID_GRANT');
    // Same-role game recall is the default. Daily and cross-role are explicit.
    if(channel==='game'&&targetRoleId===f.roleId)fail('JOURNAL_DEFAULT_ACCESS');
    if(allowed&&muted.has(fid))fail('JOURNAL_MEMORY_MUTED');
    const key=grantId(fid,targetRoleId,channel);
    same(c);if(allowed)grants.add(key);else grants.delete(key);
    return {allowed,fragmentId:fid,targetRoleId,channel};
  }
  function read({roleId,channel='game',limit=24,excludePuzzleId=null}={}){
    const c=current();
    if(!c.roleIds.includes(roleId)||!['game','daily'].includes(channel)||!Number.isInteger(limit)||limit<1||limit>128||(excludePuzzleId!==null&&!id(excludePuzzleId)))fail('JOURNAL_READ_DENIED');
    const items=[...fragments.values()].filter(f=>!muted.has(f.id)&&c.roleIds.includes(f.roleId)&&!(excludePuzzleId!==null&&f.gameId==='turtle'&&f.puzzleId===excludePuzzleId)&&
      (channel==='game'&&roleId===f.roleId||grants.has(grantId(f.id,roleId,channel))));
    same(c);return clone(items.slice(-limit));
  }
  // Owner management surface, not a model-readable API. Muting a fragment
  // revokes all grants and disables even the default same-role recall.
  function manage({roleId,gameId=null,limit=128,offset=0}={}){
    const c=current();
    if(!c.roleIds.includes(roleId)||gameId!==null&&!allowedGames.has(gameId)||!Number.isInteger(limit)||limit<1||limit>128||!Number.isInteger(offset)||offset<0)fail('JOURNAL_READ_DENIED');
    const items=[...fragments.values()].filter(f=>f.roleId===roleId&&(gameId===null||f.gameId===gameId)).reverse();
    const out=items.slice(offset,offset+limit).map(f=>({fragment:clone(f),enabled:!muted.has(f.id),grants:[...grants].map(k=>JSON.parse(k)).filter(([fid,target])=>fid===f.id&&c.roleIds.includes(target)).map(([,targetRoleId,channel])=>({targetRoleId,channel}))}));
    same(c);return {items:out,total:items.length};
  }
  function setRecall({fragmentId:fid,enabled}={}){
    const c=current();getFragment(fid,c);if(typeof enabled!=='boolean')fail('JOURNAL_INVALID_RECALL');
    same(c);if(enabled)muted.delete(fid);else{muted.add(fid);for(const key of grants)if(JSON.parse(key)[0]===fid)grants.delete(key);}
    return {fragmentId:fid,enabled};
  }
  function list(){const c=current();const out=[...records.values()].filter(e=>e.players.every(p=>p.kind!=='role'||c.roleIds.includes(p.roleId)));same(c);return clone(out);}
  // Trusted private repository payload only. Replay terminal actions to derive
  // facts instead of trusting imported summaries. Includes hidden action data;
  // never use this as a public export or model input.
  function checkpoint(){
    const c=current();same(c);
    return clone({schema:1,accountId:c.accountId,matches:[...replays.values()],grants:[...grants],muted:[...muted]});
  }
  if(snapshot!==null){
    const c=current();
    if(!exact(snapshot,['schema','accountId','matches','grants','muted'])||snapshot.schema!==1||snapshot.accountId!==c.accountId||!Array.isArray(snapshot.matches)||snapshot.matches.length>maxMatches||!Array.isArray(snapshot.grants)||!Array.isArray(snapshot.muted))fail('JOURNAL_INVALID_CHECKPOINT');
    for(const entry of snapshot.matches){
      if(!exact(entry,['board','chat'])||!entry.board||entry.chat!==null&&!['ludo','gomoku'].includes(entry.board.gameId))fail('JOURNAL_INVALID_CHECKPOINT');
      if(recordMatch(entry.board,entry.chat).duplicate)fail('JOURNAL_INVALID_CHECKPOINT');
    }
    for(const fid of snapshot.muted){
      if(typeof fid!=='string'||muted.has(fid)||!fragments.has(fid))fail('JOURNAL_INVALID_CHECKPOINT');
      muted.add(fid);
    }
    for(const key of snapshot.grants){
      let pair;try{pair=JSON.parse(key);}catch{fail('JOURNAL_INVALID_CHECKPOINT');}
      if(typeof key!=='string'||!Array.isArray(pair)||pair.length!==3||JSON.stringify(pair)!==key||grants.has(key))fail('JOURNAL_INVALID_CHECKPOINT');
      const [fid,targetRoleId,channel]=pair;
      if(!fragments.has(fid)||muted.has(fid)||!['game','daily'].includes(channel))fail('JOURNAL_INVALID_CHECKPOINT');
      if(!c.roleIds.includes(targetRoleId))continue;
      permit({fragmentId:fid,targetRoleId,channel,allowed:true});
    }
    same(c);
  }
  return Object.freeze({recordMatch:board=>recordMatch(board),recordSavedMatch,permit,read,manage,setRecall,list,checkpoint,close(){closed=true;}});
}
