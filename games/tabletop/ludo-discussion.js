import {createRoomChatLog} from './room-chat-log.js';
import {buildRoomSpeechContext} from './room-speech-context.js';
import {createRoomSpeechRunner} from './room-speech-runner.js';

// Ludo's discussion is public within a verified room. Private role sources,
// model budget and output policy belong to separately injected trusted adapters.
const fail=code=>{throw Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v;
export function createLudoDiscussion({session,view,generateRole=null,generateBot=null,allowOutput=null,onChange=()=>{},timeoutMs=30000,now=Date.now}={}){
  if(!session||!['viewUser','viewRole','viewBot','discussionSignal','discussionCurrent'].every(k=>typeof session[k]==='function')||
    view?.gameId!=='ludo'||view.phase!=='playing'||view.selfSeatId!=='user'||
    !Array.isArray(view.seats)||view.seats.length<2||view.seats.length>4||
    ![generateRole,generateBot,allowOutput].every(f=>f===null||typeof f==='function')||
    ((generateRole||generateBot)&&!allowOutput)||typeof onChange!=='function'||typeof now!=='function') fail('LUDO_DISCUSSION_INVALID');
  const roomId=view.roomId,seats=view.seats.map(s=>Object.freeze({...s})),audience=seats.map(s=>s.seatId);
  const log=createRoomChatLog({roomId,seats,maxTextLength:2000});
  const eligible=seats.filter(s=>s.kind!=='user');
  const generator=s=>s.kind==='bot'?generateBot:generateRole;
  let closed=false,epoch=0,tail=Promise.resolve(),pending=0,roundSignal=null,sequence=0;
  function check(stamp){if(closed||stamp!==epoch)fail('LUDO_DISCUSSION_STOPPED');}
  function verify(v,allowFinished=false){
    if(v?.roomId!==roomId||v.gameId!=='ludo'||!(v.phase==='playing'||allowFinished&&v.phase==='finished')||
      !Array.isArray(v.seats)||v.seats.length!==seats.length||seats.some((s,i)=>v.seats[i]?.seatId!==s.seatId||v.seats[i].kind!==s.kind||v.seats[i].roleId!==s.roleId))fail('LUDO_DISCUSSION_SCOPE');
    return v;
  }
  async function current(signal,allowFinished=false){
    const v=verify(await session.viewUser(),allowFinished);
    if(closed||await session.discussionSignal()!==signal||!session.discussionCurrent(signal,{allowFinished}))fail('LUDO_DISCUSSION_SCOPE');
    return v;
  }
  function notify(signal,allowFinished=false){
    if(closed||!session.discussionCurrent(signal,{allowFinished}))return;
    try{onChange(log.read('user'));}catch{/* presentation cannot roll back a message */}
  }
  function find(seatId){const s=eligible.find(s=>s.seatId===seatId);if(!s)fail('LUDO_DISCUSSION_SPEAKER');return s;}
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:eligible.map(s=>s.seatId),timeoutMs,maxPerRound:3,maxPerRoom:128,now,
    async prepare(ticket){
      const signal=roundSignal,s=find(ticket.seatId);
      await current(signal);
      const v=verify(await (s.kind==='bot'?session.viewBot(s.seatId):session.viewRole(s.roleId)));
      if(v.selfSeatId!==s.seatId||!session.discussionCurrent(signal)||ticket.signal.aborted)fail('LUDO_DISCUSSION_SCOPE');
      const context=buildRoomSpeechContext({roleSeatId:s.seatId,view:v,chatLog:log});
      return {request:{seat:s,context},audienceSeatIds:[...audience]};
    },
    async generate({seat,context},{signal}){
      // Ordinary AI is never routed through the saved-character adapter.
      const g=generator(seat);if(!g)fail('LUDO_DISCUSSION_MODEL_UNAVAILABLE');
      return g(context,{signal});
    },
    async authorize(ticket,{text}){
      const signal=roundSignal,s=find(ticket.seatId);
      if(text.length>2000||await allowOutput({seatId:s.seatId,kind:s.kind,text},{signal:ticket.signal})!==true)fail('LUDO_DISCUSSION_OUTPUT_DENIED');
      await current(signal);
      if(ticket.signal.aborted||!session.discussionCurrent(signal))fail('LUDO_DISCUSSION_SCOPE');
      return [...audience];
    },
    validateCommit(){return !closed&&roundSignal!==null&&session.discussionCurrent(roundSignal)===true;}
  });
  function send({messageId,text,replyToSeatId=null}={}){
    if(closed||!id(messageId)||typeof text!=='string'||!text.trim()||text.length>1000) return Promise.reject(Error('LUDO_DISCUSSION_INVALID_MESSAGE'));
    let target;
    try{target=replyToSeatId===null?null:find(replyToSeatId);}catch(error){return Promise.reject(error);}
    if(pending>=16)return Promise.reject(Error('LUDO_DISCUSSION_BUSY'));
    const stamp=epoch;pending++;
    const task=tail.then(async()=>{
      check(stamp);
      const signal=await session.discussionSignal();await current(signal);check(stamp);
      const result=log.append({senderSeatId:'user',messageId:'user:'+messageId,audienceSeatIds:audience,time:now()},text.trim());
      if(result.duplicate)return {duplicate:true,committed:0};
      notify(signal);
      const candidates=target?[target]:eligible.filter(s=>generator(s));
      if(!candidates.some(s=>generator(s)))return {duplicate:false,committed:0,reason:'MODEL_UNAVAILABLE'};
      // Default at most two voices, rotate among eligible players; explicit
      // addressed replies always keep their exact immutable seat identity.
      const available=candidates.filter(s=>generator(s)),offset=target?0:sequence%available.length;
      const speakers=target?available:[...available.slice(offset),...available.slice(0,offset)].slice(0,2);
      sequence++;
      const jobs=speakers.map(s=>({jobId:'reply:'+sequence+':'+s.seatId,seatId:s.seatId}));
      check(stamp);roundSignal=signal;
      try{
        const reply=await runner.runRound(jobs,{signal});check(stamp);
        return {duplicate:false,...reply};
      }finally{
        if(roundSignal===signal)roundSignal=null;
        notify(signal,true);
      }
    }).finally(()=>{pending--;});
    tail=task.catch(()=>{});return task;
  }
  async function read(){
    const stamp=epoch,signal=await session.discussionSignal();await current(signal,true);check(stamp);
    return log.read('user');
  }
  function stop(){epoch++;roundSignal=null;runner.stop();}
  function close(){if(closed)return;closed=true;stop();runner.close();}
  return Object.freeze({send,read,stop,close,status:()=>({closed,pending,...runner.status()})});
}
