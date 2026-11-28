// Pure scheduling state for one room's discussion. The trusted future adapter
// supplies eligible role seats and job IDs; no model, storage or board calls.
const fail=code=>{throw new Error(code);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const roleSeat=v=>id(v)&&((v.startsWith('role:')&&id(v.slice(5)))||/^bot:[1-3]$/.test(v));
const limit=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;

export function createRoomSpeechQueue({roleSeatIds,maxPerRound=6,maxPerRoom=128,restoredJobIds=[]}={}) {
  if(!Array.isArray(roleSeatIds)||roleSeatIds.length>12||!Array.from(roleSeatIds).every(roleSeat)||
     new Set(roleSeatIds).size!==roleSeatIds.length||!limit(maxPerRound,32)||
     !limit(maxPerRoom,4096)||maxPerRoom<maxPerRound) fail('INVALID_SPEECH_SPEC');
  if(!Array.isArray(restoredJobIds)||restoredJobIds.length>maxPerRoom||!Array.from(restoredJobIds).every(id)||new Set(restoredJobIds).size!==restoredJobIds.length)fail('INVALID_SPEECH_CHECKPOINT');
  const roles=new Set(roleSeatIds),seen=new Set(restoredJobIds);
  let pending=[],active=null,closed=false,stopping=false;
  function open(){if(closed) fail('SPEECH_CLOSED');if(stopping) fail('SPEECH_STOPPING');}
  function beginRound(jobs) {
    open();
    if(active||pending.length) fail('SPEECH_ROUND_BUSY');
    if(!Array.isArray(jobs)||!jobs.length||jobs.length>maxPerRound) fail('INVALID_SPEECH_ROUND');
    const next=[],ids=new Set();
    for(const job of jobs) {
      const jobId=job?.jobId,seatId=job?.seatId;
      if(!id(jobId)||!roles.has(seatId)) fail('INVALID_SPEECH_JOB');
      if(seen.has(jobId)||ids.has(jobId)) fail('DUPLICATE_SPEECH_JOB');
      ids.add(jobId);next.push({jobId,seatId});
    }
    // Reserve a bounded number of distinct jobs, including cancelled jobs.
    // This is a local scheduling limit, not a provider or monetary charge.
    if(seen.size+next.length>maxPerRoom) fail('SPEECH_BUDGET_EXHAUSTED');
    for(const jobId of ids) seen.add(jobId);
    pending=next;
  }
  function take() {
    open();
    if(active||!pending.length) return null;
    const controller=new AbortController(),job=pending.shift();
    const ticket=Object.freeze({...job,signal:controller.signal});
    active={ticket,controller};return ticket;
  }
  // Only the original in-flight ticket may settle. The caller must verify
  // current account, room and audience before synchronously publishing output.
  function settle(ticket) {
    if(closed||stopping||!active||active.ticket!==ticket) return false;
    active=null;return true;
  }
  function stop() {
    if(stopping) return;
    stopping=true;
    const old=active;active=null;pending=[];
    try {old?.controller.abort();} finally {stopping=false;}
  }
  return Object.freeze({beginRound,take,settle,stop,checkpoint(){open();if(active||pending.length)fail('SPEECH_ROUND_BUSY');return [...seen];},
    close(){closed=true;stop();},
    status:()=>Object.freeze({closed,active:active!==null,queued:pending.length,remaining:maxPerRoom-seen.size})
  });
}
