import {createRoomChatLog} from './room-chat-log.js';
import {buildRoomSpeechContext} from './room-speech-context.js';
import {createRoomSpeechRunner} from './room-speech-runner.js';

// Public game discussion, independent of daily chat. All model calls remain
// behind trusted provider and output-policy adapters.
export function createGomokuDiscussion({session,view,generateRole=null,allowOutput=null,onChange=()=>{},timeoutMs=30000,now=Date.now,checkpoint=null}={}){
  const fail=code=>{throw Error(code);};
  if(!session||!['viewUser','viewRole','discussionSignal','discussionCurrent'].every(k=>typeof session[k]==='function')||
    view?.gameId!=='gomoku'||!['playing','finished'].includes(view.phase)||view.selfSeatId!=='user'||!Array.isArray(view.seats)||
    (generateRole!==null&&(typeof generateRole!=='function'||typeof allowOutput!=='function'))||typeof onChange!=='function')fail('GOMOKU_CHAT_INVALID');
  const roomId=view.roomId,seats=view.seats.map(s=>({...s})),audience=seats.map(s=>s.seatId),roles=seats.filter(s=>s.kind==='role');
  const log=createRoomChatLog({roomId,seats,maxTextLength:2000});
  let epoch=0,closed=false,pending=0,sequence=0,tail=Promise.resolve(),roundSignal=null;
  let restoredJobIds=[];
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  if(checkpoint!==null){
    if(!exact(checkpoint,['schema','roomId','revision','sequence','jobIds','messages'])||checkpoint.schema!==1||
      checkpoint.roomId!==roomId||checkpoint.revision!==view.revision||!Number.isInteger(checkpoint.sequence)||checkpoint.sequence<0||checkpoint.sequence>4096||
      !Array.isArray(checkpoint.jobIds)||checkpoint.jobIds.length>128||new Set(checkpoint.jobIds).size!==checkpoint.jobIds.length||
      !Array.isArray(checkpoint.messages)||checkpoint.messages.length>log.maxMessages)fail('GOMOKU_CHAT_CHECKPOINT');
    sequence=checkpoint.sequence;const jobs=new Map(),seen=new Set();
    for(const j of checkpoint.jobIds){
      const m=typeof j==='string'&&j.length<=256?/^reply:([1-9][0-9]*):(.+)$/.exec(j):null;
      if(!m||Number(m[1])>sequence||!roles.some(s=>s.seatId===m[2]))fail('GOMOKU_CHAT_CHECKPOINT');jobs.set(j,m[2]);
    }
    restoredJobIds=[...checkpoint.jobIds];
    for(const m of checkpoint.messages){
      if(!exact(m,['id','senderSeatId','text','time'])||seen.has(m.id)||!audience.includes(m.senderSeatId)||
        (m.senderSeatId==='user'?(typeof m.id!=='string'||!m.id.startsWith('user:')||!m.id.slice(5).trim()||m.id.slice(5).trim()!==m.id.slice(5)||m.id.length>133||typeof m.text!=='string'||m.text.length>1000):jobs.get(m.id)!==m.senderSeatId))fail('GOMOKU_CHAT_CHECKPOINT');
      log.append({senderSeatId:m.senderSeatId,messageId:m.id,audienceSeatIds:audience,time:m.time},m.text);seen.add(m.id);
    }
  }
  function check(stamp){if(closed||stamp!==epoch)fail('GOMOKU_CHAT_STOPPED');}
  function verified(v,finished=false){
    if(v?.roomId!==roomId||v.gameId!=='gomoku'||!(v.phase==='playing'||finished&&v.phase==='finished')||!Array.isArray(v.seats)||v.seats.length!==seats.length||
      seats.some((s,i)=>s.seatId!==v.seats[i]?.seatId||s.kind!==v.seats[i]?.kind||s.roleId!==v.seats[i]?.roleId||s.mode!==v.seats[i]?.mode))fail('GOMOKU_CHAT_SCOPE');
    return v;
  }
  async function current(signal,finished=false){const v=verified(await session.viewUser(),finished);if(closed||await session.discussionSignal()!==signal||!session.discussionCurrent(signal,{allowFinished:finished}))fail('GOMOKU_CHAT_SCOPE');return v;}
  function notify(signal){if(!closed&&session.discussionCurrent(signal,{allowFinished:true})){try{onChange(log.read('user'));}catch{}}}
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:roles.map(s=>s.seatId),maxPerRound:2,maxPerRoom:128,timeoutMs,now,restoredJobIds,
    async prepare(ticket){
      const signal=roundSignal,role=roles.find(s=>s.seatId===ticket.seatId);await current(signal);
      const v=verified(await session.viewRole(role.roleId));
      if(v.selfSeatId!==role.seatId||ticket.signal.aborted||!session.discussionCurrent(signal))fail('GOMOKU_CHAT_SCOPE');
      return {request:buildRoomSpeechContext({roleSeatId:role.seatId,view:v,chatLog:log}),audienceSeatIds:audience};
    },
    generate(context,{signal}){return generateRole(context,{signal});},
    async authorize(ticket,{text}){
      const signal=roundSignal;
      if(text.length>2000||await allowOutput({seatId:ticket.seatId,kind:'role',text},{signal:ticket.signal})!==true)fail('GOMOKU_CHAT_OUTPUT_DENIED');
      await current(signal);if(ticket.signal.aborted||!session.discussionCurrent(signal))fail('GOMOKU_CHAT_SCOPE');return audience;
    },
    validateCommit(){return !closed&&roundSignal!==null&&session.discussionCurrent(roundSignal);}
  });
  function send({messageId,text,replyToSeatId=null}={}){
    if(closed||typeof messageId!=='string'||!messageId.length||messageId.length>128||messageId.trim()!==messageId||typeof text!=='string'||!text.trim()||text.length>1000)return Promise.reject(Error('GOMOKU_CHAT_MESSAGE'));
    const target=replyToSeatId===null?null:roles.find(s=>s.seatId===replyToSeatId);
    if(replyToSeatId!==null&&!target)return Promise.reject(Error('GOMOKU_CHAT_TARGET'));
    if(pending>=16)return Promise.reject(Error('GOMOKU_CHAT_BUSY'));
    const stamp=epoch;pending++;
    const task=tail.then(async()=>{
      check(stamp);const signal=await session.discussionSignal();await current(signal);check(stamp);
      const appended=log.append({senderSeatId:'user',messageId:'user:'+messageId,audienceSeatIds:audience,time:now()},text.trim());
      if(appended.duplicate)return {duplicate:true,committed:0};
      notify(signal);
      if(!generateRole)return {duplicate:false,committed:0,reason:'MODEL_UNAVAILABLE'};
      const pool=target?[target]:[...roles.slice(sequence%roles.length),...roles.slice(0,sequence%roles.length)].slice(0,2);
      if(runner.status().remaining<pool.length)return {duplicate:false,committed:0,reason:'SPEECH_LIMIT'};
      sequence++;roundSignal=signal;
      try{return {duplicate:false,...await runner.runRound(pool.map(s=>({seatId:s.seatId,jobId:'reply:'+sequence+':'+s.seatId})),{signal})};}
      finally{if(roundSignal===signal)roundSignal=null;notify(signal);}
    }).finally(()=>{pending--;});
    tail=task.catch(()=>{});return task;
  }
  async function read(){const stamp=epoch,signal=await session.discussionSignal();await current(signal,true);check(stamp);return log.read('user');}
  async function save(revision){
    const stamp=epoch,signal=await session.discussionSignal(),v=await current(signal,true);check(stamp);
    if(pending||runner.status().running||v.revision!==revision)fail('GOMOKU_CHAT_CHECKPOINT_BUSY');
    return {schema:1,roomId,revision,sequence,jobIds:runner.checkpoint(),messages:log.read('user').map(m=>({id:m.id,senderSeatId:m.sender.seatId,text:m.text,time:m.time}))};
  }
  function stop(){epoch++;roundSignal=null;runner.stop();}
  return Object.freeze({send,read,save,stop,close(){if(!closed){closed=true;stop();runner.close();}}});
}
