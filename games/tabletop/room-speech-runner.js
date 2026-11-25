import {createRoomSpeechQueue} from './room-speech-queue.js';

// Unwired orchestration for one live room. All callbacks are trusted adapters.
// prepare and authorize must check current scope, seat, phase and disclosure.
// validateCommit must synchronously re-check the live permission after all awaits.
// generate receives only the prepared request and cancellation signal.
const fail=code=>{throw new Error(code);};
function audience(value,seatId) {
  if(!Array.isArray(value)||!value.length||value.length>12||
     !Array.from(value).every(v=>typeof v==='string'&&v.length>0)||
     new Set(value).size!==value.length||!value.includes(seatId)) fail('INVALID_SPEECH_AUDIENCE');
  return [...value];
}
export function createRoomSpeechRunner({chatLog,roleSeatIds,prepare,generate,authorize,validateCommit,timeoutMs=30000,maxPerRound=6,maxPerRoom=128,now=Date.now,restoredJobIds=[]}={}) {
  if(!chatLog||typeof chatLog.append!=='function'||typeof chatLog.assertAppendable!=='function'||typeof prepare!=='function'||typeof generate!=='function'||typeof authorize!=='function'||typeof validateCommit!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000) fail('INVALID_SPEECH_RUNNER');
  const queue=createRoomSpeechQueue({roleSeatIds,maxPerRound,maxPerRoom,restoredJobIds});
  let running=false;
  function check(ticket){if(ticket.signal.aborted) fail('SPEECH_CANCELLED');}
  async function execute(ticket,allowSilence) {
    const {signal}=ticket;
    let timer,abort;
    const deadline=new Promise((_,reject)=>{
      abort=()=>reject(new Error('SPEECH_CANCELLED'));
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{reject(new Error('SPEECH_TIMEOUT'));queue.stop();},timeoutMs);
    });
    async function work() {
      check(ticket);
      let prepared;
      try {prepared=await prepare(ticket);} catch {fail('SPEECH_PREPARE_FAILED');}
      check(ticket);
      if(!prepared||!Object.hasOwn(prepared,'request')) fail('INVALID_SPEECH_REQUEST');
      const initial=audience(prepared.audienceSeatIds,ticket.seatId);
      // Avoid a provider call when the trusted log already knows this message
      // cannot be accepted. This is not a reservation or a monetary budget.
      chatLog.assertAppendable({senderSeatId:ticket.seatId,messageId:ticket.jobId,audienceSeatIds:initial});
      check(ticket);
      let text;
      try {text=await generate(prepared.request,{signal});} catch {fail('SPEECH_GENERATION_FAILED');}
      check(ticket);
      if(allowSilence&&text===null)return {silent:true};
      if(typeof text!=='string'||!text.trim()||text.length>16000) fail('INVALID_SPEECH_REPLY');
      let allowed;
      try {allowed=await authorize(ticket,{text,audienceSeatIds:[...initial]});} catch {fail('SPEECH_AUTHORIZATION_FAILED');}
      check(ticket);
      const final=audience(allowed,ticket.seatId);
      if(final.length!==initial.length||final.some(id=>!initial.includes(id))) fail('SPEECH_AUDIENCE_CHANGED');
      return {text,final};
    }
    try {return await Promise.race([work(),deadline]);}
    finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  async function runRound(jobs,{signal,allowSilence=false}={}) {
    if(typeof allowSilence!=='boolean')fail('INVALID_SPEECH_ROUND');
    if(running) fail('SPEECH_ROUND_BUSY');
    if(signal!==undefined&&(!(signal instanceof AbortSignal))) fail('INVALID_SPEECH_SIGNAL');
    if(signal?.aborted) fail('SPEECH_CANCELLED');
    queue.beginRound(jobs);running=true;
    const onAbort=()=>queue.stop();
    signal?.addEventListener('abort',onAbort,{once:true});
    let committed=0;
    try {
      if(signal?.aborted) fail('SPEECH_CANCELLED');
      for(let ticket;(ticket=queue.take());) {
        const {text,final,silent}=await execute(ticket,allowSilence);
        if(silent){check(ticket);if(!queue.settle(ticket))fail('SPEECH_CANCELLED');continue;}
        const time=now();
        // No await between final permission check, settlement and append. The
        // caller's synchronous guard must not return an async approval or
        // mutate the authorized audience. Abort still wins during the guard.
        check(ticket);
        let valid;
        try {
          valid=validateCommit(ticket,Object.freeze({text,audienceSeatIds:Object.freeze([...final])}));
          if(valid&&typeof valid.then==='function') Promise.resolve(valid).catch(()=>{});
        } catch {fail('SPEECH_COMMIT_DENIED');}
        if(valid!==true) fail('SPEECH_COMMIT_DENIED');
        if(!queue.settle(ticket)) fail('SPEECH_CANCELLED');
        const result=chatLog.append({senderSeatId:ticket.seatId,messageId:ticket.jobId,audienceSeatIds:final,time},text);
        if(!result.duplicate) committed++;
      }
      return {committed};
    } catch(error) {queue.stop();throw error;}
    finally {signal?.removeEventListener('abort',onAbort);running=false;}
  }
  return Object.freeze({runRound,checkpoint(){if(running)fail('SPEECH_ROUND_BUSY');return queue.checkpoint();},stop:()=>queue.stop(),close:()=>{queue.close();chatLog.close();},status:()=>({...queue.status(),running})});
}
