import {createRoomDispatcher} from './room-dispatcher.js';
import {createLudoRules} from './ludo-rules.js';

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
export function createLudoJournal({getContext,maxMatches=512}={}){
  if(typeof getContext!=='function'||!Number.isInteger(maxMatches)||maxMatches<1||maxMatches>4096)fail('JOURNAL_SPEC');
  const initial=scope(getContext),records=new Map(),fragments=new Map(),grants=new Set();
  let closed=false;
  function current(){
    if(closed)fail('JOURNAL_CLOSED');
    const c=scope(getContext);
    if(c.accountId!==initial.accountId||c.sessionId!==initial.sessionId){closed=true;fail('JOURNAL_SCOPE_CHANGED');}
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
  function recordMatch(board){
    const c=current();
    if(!board||board.accountId!==c.accountId||board.gameId!=='ludo'||!id(board.roomId)||!['classic','adventure'].includes(board.mode))fail('JOURNAL_INVALID_MATCH');
    // The authoritative engine derives the terminal result and all positions.
    // A caller-provided winner, summary or timestamp cannot settle a match.
    const d=createRoomDispatcher({getContext:()=>c,spec:{gameId:'ludo',roomId:board.roomId},rules:createLudoRules({mode:board.mode}),checkpoint:board});
    const v=d.view('user');
    if(v.phase!=='finished'||v.result?.kind!=='win'||v.result.winnerSeatIds.length!==1)fail('JOURNAL_MATCH_UNFINISHED');
    const winner=v.result.winnerSeatIds[0];
    const entry={schema:1,accountId:c.accountId,roomId:v.roomId,gameId:'ludo',mode:board.mode,revision:v.revision,
      winnerSeatId:winner,players:v.seats.map(s=>({seatId:s.seatId,kind:s.kind,...(s.kind==='role'?{roleId:s.roleId}:{}),finished:v.game.players.find(p=>p.seatId===s.seatId).planes.filter(p=>p.zone==='finished').length}))};
    same(c);
    const prior=records.get(v.roomId);
    if(prior){
      if(JSON.stringify(prior)!==JSON.stringify(entry))fail('JOURNAL_MATCH_CONFLICT');
      return {duplicate:true,record:clone(prior)};
    }
    if(records.size>=maxMatches)fail('JOURNAL_CAPACITY');
    // Facts are not fabricated emotional memories; each saved role receives
    // its own result. Bots have no durable identity and receive no fragments.
    const next=entry.players.filter(p=>p.kind==='role').map(p=>({
      schema:1,id:fragmentId(v.roomId,p.roleId,'result'),roomId:v.roomId,roleId:p.roleId,kind:'result',
      gameId:'ludo',mode:entry.mode,outcome:p.seatId===winner?'win':'loss',finished:p.finished
    }));
    records.set(v.roomId,entry);for(const f of next)fragments.set(f.id,f);
    return {duplicate:false,record:clone(entry)};
  }
  // The actual chat log is the authority for text and sender. This API accepts
  // only an already verified room's user-visible messages from the host.
  // Do not pass model-proposed text, arbitrary import data or private logs.
  function rememberPublicMessage({roomId,message}={}){
    const c=current(),entry=records.get(roomId);
    if(!entry||message?.schema!==1||message.roomId!==roomId||!id(message.id)||typeof message.text!=='string'||!message.text.trim()||message.text.length>2000||
      !Number.isSafeInteger(message.time)||message.time<0||message.sender?.kind!=='role')fail('JOURNAL_INVALID_MESSAGE');
    const roleId=message.sender.roleId;
    if(!c.roleIds.includes(roleId)||message.sender.seatId!=='role:'+roleId||!entry.players.some(p=>p.kind==='role'&&p.roleId===roleId)||
      !/^(reply|event):[1-9][0-9]*:/.test(message.id)||!message.id.endsWith(':'+message.sender.seatId))fail('JOURNAL_INVALID_MESSAGE');
    const f={schema:1,id:fragmentId(roomId,roleId,message.id),roomId,roleId,kind:'public-message',gameId:'ludo',text:message.text,time:message.time,sourceMessageId:message.id};
    const prior=fragments.get(f.id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(f))fail('JOURNAL_FRAGMENT_CONFLICT');return {duplicate:true,fragment:clone(prior)};}
    if([...fragments.values()].filter(x=>x.roomId===roomId&&x.kind==='public-message').length>=128)fail('JOURNAL_FRAGMENT_CAPACITY');
    same(c);fragments.set(f.id,f);return {duplicate:false,fragment:clone(f)};
  }
  function permit({fragmentId:fid,targetRoleId,channel,allowed}={}){
    const c=current(),f=getFragment(fid,c);
    if(!c.roleIds.includes(targetRoleId)||!['game','daily'].includes(channel)||typeof allowed!=='boolean')fail('JOURNAL_INVALID_GRANT');
    // Same-role game recall is the default. Daily and cross-role are explicit.
    if(channel==='game'&&targetRoleId===f.roleId)fail('JOURNAL_DEFAULT_ACCESS');
    const key=grantId(fid,targetRoleId,channel);
    same(c);if(allowed)grants.add(key);else grants.delete(key);
    return {allowed,fragmentId:fid,targetRoleId,channel};
  }
  function read({roleId,channel='game',limit=24}={}){
    const c=current();
    if(!c.roleIds.includes(roleId)||!['game','daily'].includes(channel)||!Number.isInteger(limit)||limit<1||limit>128)fail('JOURNAL_READ_DENIED');
    const items=[...fragments.values()].filter(f=>c.roleIds.includes(f.roleId)&&
      (channel==='game'&&roleId===f.roleId||grants.has(grantId(f.id,roleId,channel))));
    same(c);return clone(items.slice(-limit));
  }
  function list(){const c=current();const out=[...records.values()].filter(e=>e.players.every(p=>p.kind!=='role'||c.roleIds.includes(p.roleId)));same(c);return clone(out);}
  return Object.freeze({recordMatch,rememberPublicMessage,permit,read,list,close(){closed=true;}});
}
