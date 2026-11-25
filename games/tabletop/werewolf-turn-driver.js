// Trusted scheduling adapter. Scan private seat views internally; only the
// acting seat's own projection may enter its isolated model request.
export function createWerewolfTurnDriver({session,decideRole=null,allowSpeech=null,onView=()=>{},pace=()=>{},timeoutMs=12000,maxActions=16}={}){
 const fail=code=>{throw Error(code);};
 if(!session||!['viewUser','viewRole','prepareRoleTurn'].every(k=>typeof session[k]==='function')||
   (decideRole!==null&&(typeof decideRole!=='function'||typeof allowSpeech!=='function'))||
   ![onView,pace].every(f=>typeof f==='function')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
   !Number.isInteger(maxActions)||maxActions<1||maxActions>60)fail('WOLF_DRIVER_INVALID');
 const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
 let epoch=0,running=false,disposed=false,cancel=null;
 function check(stamp){if(disposed||epoch!==stamp)fail('WOLF_DRIVER_STOPPED');}
 function stop(){epoch++;cancel?.();}
 async function bounded(stamp,work){
   check(stamp);const ac=new AbortController();let timer,interrupt;
   const cancelled=new Promise((_,reject)=>{interrupt=()=>{reject(Error('WOLF_DRIVER_STOPPED'));ac.abort();};});cancel=interrupt;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('WOLF_DRIVER_TIMEOUT'));ac.abort();},timeoutMs);});
   try{const v=await Promise.race([cancelled,deadline,Promise.resolve().then(()=>{check(stamp);return work(ac.signal);})]);check(stamp);return v;}
   finally{clearTimeout(timer);if(cancel===interrupt)cancel=null;}
 }
 function validate(v,roomId,seatId){
   if(v?.gameId!=='werewolf'||v.roomId!==roomId||v.selfSeatId!==seatId||!['playing','finished'].includes(v.phase)||!Number.isSafeInteger(v.revision)||
     !Array.isArray(v.game?.legalKinds)||!Array.isArray(v.game?.legalTargets)||!Array.isArray(v.game?.players))fail('WOLF_DRIVER_VIEW');
   if(v.phase==='playing'&&(v.game.players.some(p=>Object.hasOwn(p,'role'))||Object.hasOwn(v.game,'queue')||Object.hasOwn(v.game,'night')||Object.hasOwn(v.game,'votes')))fail('WOLF_DRIVER_PRIVATE_VIEW');
 }
 async function runUntilUser(){
   if(disposed||running)fail('WOLF_DRIVER_BUSY');running=true;const stamp=epoch;let actions=0;
   try{
     let v=await session.viewUser();check(stamp);const roomId=v.roomId;validate(v,roomId,'user');await onView(v);check(stamp);
     while(v.phase==='playing'&&!v.game.legalKinds.length&&actions<maxActions){
       if(!decideRole)return {status:'model-unavailable',actions};
       let actor=null;
       const candidates=v.seats.filter(s=>s.kind==='role'&&s.mode==='player'&&v.game.players.some(p=>p.seatId===s.seatId&&p.alive));
       for(const seat of candidates){
         if(v.game.stage!=='night'&&v.game.activeSeatId!==seat.seatId)continue;
         const probe=await session.viewRole(seat.roleId);check(stamp);validate(probe,roomId,seat.seatId);
         if(probe.revision!==v.revision)fail('WOLF_DRIVER_STALE');
         if(probe.game.legalKinds.length){actor=seat;break;}
       }
       if(!actor)fail('WOLF_DRIVER_NO_ACTOR');
       await bounded(stamp,signal=>pace({round:v.game.round,stage:v.game.stage},signal));check(stamp);
       const turn=await session.prepareRoleTurn(actor.roleId);check(stamp);const own=turn.view;validate(own,roomId,actor.seatId);
       if(own.revision!==v.revision||!own.game.legalKinds.length||typeof turn.commit!=='function')fail('WOLF_DRIVER_STALE');
       const g=own.game,proposed=await bounded(stamp,signal=>decideRole(own,{signal}));let move=null;
       if(proposed&&g.legalKinds.includes(proposed.kind)){
         if(proposed.kind==='pass'&&exact(proposed,['kind']))move={kind:'pass'};
         else if(proposed.kind==='speak'&&exact(proposed,['kind','text'])&&typeof proposed.text==='string'&&proposed.text.trim()===proposed.text&&proposed.text.length>0&&proposed.text.length<=500){
           if(await bounded(stamp,signal=>allowSpeech({seatId:actor.seatId,text:proposed.text},{signal}))===true)move={kind:'speak',text:proposed.text};
         }else if(['choose','protect','inspect','vote'].includes(proposed.kind)&&exact(proposed,['kind','targetSeatId'])&&g.legalTargets.includes(proposed.targetSeatId))move={kind:proposed.kind,targetSeatId:proposed.targetSeatId};
       }
       if(!move)fail('WOLF_DRIVER_BAD_MOVE');
       check(stamp);await turn.commit(move);check(stamp);actions++;
       const next=await session.viewUser();check(stamp);validate(next,roomId,'user');if(next.revision!==v.revision+1)fail('WOLF_DRIVER_STALE');
       v=next;await onView(v);check(stamp);
     }
     return {status:v.phase==='finished'?'finished':v.game.legalKinds.length?'user':'yield',actions};
   }finally{running=false;}
 }
 return Object.freeze({runUntilUser,stop,dispose(){disposed=true;stop();},status:()=>disposed?'disposed':running?'running':'idle'});
}
