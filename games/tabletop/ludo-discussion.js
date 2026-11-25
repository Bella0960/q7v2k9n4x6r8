import {createRoomChatLog} from './room-chat-log.js';
import {buildRoomSpeechContext} from './room-speech-context.js';
import {createRoomSpeechRunner} from './room-speech-runner.js';

// Ludo's discussion is public within a verified room. Private role sources,
// model budget and output policy belong to separately injected trusted adapters.
const fail=code=>{throw Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v;
// Only committed public game events merit an unsolicited reaction.
export function ludoEventPriority(view){
  const last=view?.game?.last;
  if(view?.gameId!=='ludo'||view.phase!=='playing'||!last)return 0;
  if(last.kind==='move'){
    if(last.captures?.length||last.effects?.includes('blocked'))return 3;
    if(last.effects?.some(e=>['finish','flight'].includes(e)))return 2;
    if(last.card||last.gained||last.effects?.some(e=>['supply','wind'].includes(e)))return 1;
  }
  return last.kind==='roll'&&last.cruise===true?1:0;
}
export function createLudoDiscussion({session,view,generateRole=null,generateBot=null,allowOutput=null,onChange=()=>{},timeoutMs=30000,now=Date.now,checkpoint=null}={}){
  if(!session||!['viewUser','viewRole','viewBot','discussionSignal','discussionCurrent'].every(k=>typeof session[k]==='function')||
    view?.gameId!=='ludo'||!['playing','finished'].includes(view.phase)||view.selfSeatId!=='user'||
    !Array.isArray(view.seats)||view.seats.length<2||view.seats.length>4||
    ![generateRole,generateBot,allowOutput].every(f=>f===null||typeof f==='function')||
    ((generateRole||generateBot)&&!allowOutput)||typeof onChange!=='function'||typeof now!=='function') fail('LUDO_DISCUSSION_INVALID');
  const roomId=view.roomId,seats=view.seats.map(s=>Object.freeze({...s})),audience=seats.map(s=>s.seatId);
  const log=createRoomChatLog({roomId,seats,maxTextLength:2000});
  const eligible=seats.filter(s=>s.kind!=='user');
  const generator=s=>s.kind==='bot'?generateBot:generateRole;
  let closed=false,epoch=0,tail=Promise.resolve(),pending=0,roundSignal=null,sequence=0;
  let roundEvent=null,automatic=null,lastObserved=view.revision,lastAutomatic=-Infinity,automaticCount=0;
  let restoredJobIds=[];
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  if(checkpoint!==null){
    if(!exact(checkpoint,['schema','roomId','revision','sequence','automaticCount','lastAutomatic','jobIds','messages'])||
      checkpoint.schema!==1||checkpoint.roomId!==roomId||checkpoint.revision!==view.revision||
      !Number.isSafeInteger(checkpoint.sequence)||checkpoint.sequence<0||checkpoint.sequence>4096||
      !Number.isInteger(checkpoint.automaticCount)||checkpoint.automaticCount<0||checkpoint.automaticCount>12||
      (checkpoint.lastAutomatic===null?checkpoint.automaticCount!==0:(!Number.isSafeInteger(checkpoint.lastAutomatic)||checkpoint.lastAutomatic<0||checkpoint.lastAutomatic>view.revision||checkpoint.automaticCount===0))||
      !Array.isArray(checkpoint.jobIds)||checkpoint.jobIds.length>128||new Set(checkpoint.jobIds).size!==checkpoint.jobIds.length||
      !Array.isArray(checkpoint.messages)||checkpoint.messages.length>log.maxMessages)fail('LUDO_INVALID_CHAT_CHECKPOINT');
    sequence=checkpoint.sequence;automaticCount=checkpoint.automaticCount;lastAutomatic=checkpoint.lastAutomatic??-Infinity;
    let events=0;
    const jobs=new Map();
    for(const job of checkpoint.jobIds){
      if(typeof job!=='string'||job.length>256)fail('LUDO_INVALID_CHAT_CHECKPOINT');
      const m=/^(reply|event):([1-9][0-9]*):(.+)$/.exec(job),n=m?Number(m[2]):NaN;
      if(!m||!Number.isSafeInteger(n)||!eligible.some(s=>s.seatId===m[3])||
        (m[1]==='reply'?n>sequence:n>lastAutomatic))fail('LUDO_INVALID_CHAT_CHECKPOINT');
      if(m[1]==='event')events++;
      jobs.set(job,m[3]);
    }
    if(events>automaticCount)fail('LUDO_INVALID_CHAT_CHECKPOINT');
    restoredJobIds=[...checkpoint.jobIds];
    const seen=new Set();
    for(const m of checkpoint.messages){
      if(!exact(m,['id','senderSeatId','text','time'])||seen.has(m.id)||!audience.includes(m.senderSeatId)||
        (m.senderSeatId==='user'?(typeof m.id!=='string'||!m.id.startsWith('user:')||!id(m.id.slice(5))||typeof m.text!=='string'||m.text.length>1000):jobs.get(m.id)!==m.senderSeatId))fail('LUDO_INVALID_CHAT_CHECKPOINT');
      log.append({senderSeatId:m.senderSeatId,messageId:m.id,audienceSeatIds:audience,time:m.time},m.text);
      seen.add(m.id);
    }
  }
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
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:eligible.map(s=>s.seatId),timeoutMs,maxPerRound:3,maxPerRoom:128,now,restoredJobIds,
    async prepare(ticket){
      const signal=roundSignal,s=find(ticket.seatId);
      await current(signal);
      const v=verify(await (s.kind==='bot'?session.viewBot(s.seatId):session.viewRole(s.roleId)));
      if(v.selfSeatId!==s.seatId||!session.discussionCurrent(signal)||ticket.signal.aborted)fail('LUDO_DISCUSSION_SCOPE');
      const context=buildRoomSpeechContext({roleSeatId:s.seatId,view:v,chatLog:log});
      if(roundEvent)context.trigger=JSON.parse(JSON.stringify(roundEvent));
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
    // Explicit messages take precedence over optional commentary.
    if(automatic){automatic.cancelled=true;if(automatic.running)runner.stop();}
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
      if(runner.status().remaining<speakers.length)return {duplicate:false,committed:0,reason:'SPEECH_LIMIT'};
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
  // Trusted page host only: pass a detached snapshot of a committed move,
  // never a user/model supplied event. The latest live view is reverified.
  function react(eventView){
    if(closed)return Promise.resolve({committed:0,reason:'CLOSED'});
    try{verify(eventView);}catch{return Promise.resolve({committed:0,reason:'STALE_EVENT'});}
    const revision=eventView.revision,priority=ludoEventPriority(eventView);
    if(eventView.selfSeatId!=='user'||!Number.isSafeInteger(revision)||revision<=lastObserved)return Promise.resolve({committed:0,reason:'STALE_EVENT'});
    lastObserved=revision;
    if(!priority||pending||automaticCount>=12||runner.status().remaining<1||revision-lastAutomatic<4)return Promise.resolve({committed:0,reason:'QUIET'});
    const last=eventView.game.last;
    if(!audience.includes(last.seatId))return Promise.resolve({committed:0,reason:'STALE_EVENT'});
    const victims=last.kind==='move'&&Array.isArray(last.captures)?last.captures.filter(c=>audience.includes(c?.seatId)&&Number.isInteger(c.plane)&&c.plane>=0&&c.plane<4).map(c=>({seatId:c.seatId,plane:c.plane})):[];
    const preferred=[...new Set([...victims.map(v=>v.seatId),last.seatId,...eligible.map(s=>s.seatId)])];
    const speaker=preferred.map(id=>eligible.find(s=>s.seatId===id)).find(s=>s&&generator(s));
    if(!speaker)return Promise.resolve({committed:0,reason:'MODEL_UNAVAILABLE'});
    const event={kind:'game-event',revision,actorSeatId:last.seatId,action:last.kind,
      effects:Array.isArray(last.effects)?last.effects.filter(e=>['launch','jump','flight','bounce','finish','blocked','supply','wind'].includes(e)):[],
      captures:victims,
      ...(Number.isInteger(last.plane)&&last.plane>=0&&last.plane<4?{plane:last.plane}:{}),
      ...(['boost','shield'].includes(last.card)?{card:last.card}:{}),
      ...(last.cruise===true?{cruise:true}:{})};
    const stamp=epoch,job={cancelled:false,running:false};automatic=job;pending++;automaticCount++;lastAutomatic=revision;
    const task=tail.then(async()=>{
      check(stamp);if(job.cancelled)return {committed:0,reason:'QUIET'};
      const signal=await session.discussionSignal(),latest=await current(signal);check(stamp);
      if(job.cancelled||latest.revision<revision||latest.revision-revision>8)return {committed:0,reason:'STALE_EVENT'};
      roundSignal=signal;roundEvent=event;job.running=true;
      try{
        return await runner.runRound([{jobId:'event:'+revision+':'+speaker.seatId,seatId:speaker.seatId}],{signal,allowSilence:true});
      }finally{
        job.running=false;roundEvent=null;
        if(roundSignal===signal)roundSignal=null;
        notify(signal,true);
      }
    }).finally(()=>{pending--;if(automatic===job)automatic=null;});
    tail=task.catch(()=>{});return task;
  }
  async function read(){
    const stamp=epoch,signal=await session.discussionSignal();await current(signal,true);check(stamp);
    return log.read('user');
  }
  async function save(expectedRevision){
    const stamp=epoch,signal=await session.discussionSignal(),v=await current(signal,true);check(stamp);
    if(pending||runner.status().running||!Number.isSafeInteger(expectedRevision)||v.revision!==expectedRevision)fail('LUDO_CHAT_CHECKPOINT_BUSY');
    return {schema:1,roomId,revision:v.revision,sequence,automaticCount,lastAutomatic:Number.isFinite(lastAutomatic)?lastAutomatic:null,
      jobIds:runner.checkpoint(),messages:log.read('user').map(m=>({id:m.id,senderSeatId:m.sender.seatId,text:m.text,time:m.time}))};
  }
  function stop(){epoch++;if(automatic)automatic.cancelled=true;roundSignal=null;roundEvent=null;runner.stop();}
  function close(){if(closed)return;closed=true;stop();runner.close();}
  return Object.freeze({send,react,read,save,stop,close,status:()=>({closed,pending,...runner.status()})});
}
