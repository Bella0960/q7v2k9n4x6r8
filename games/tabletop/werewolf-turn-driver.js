// Trusted scheduling adapter. Scan private seat views internally; only the
// acting seat's own projection may enter its isolated model request.
export function createWerewolfTurnDriver({session,decideRole=null,decideBot=null,allowSpeech=null,onView=()=>{},pace=()=>{},timeoutMs=12000,maxActions=16}={}){
 const fail=code=>{throw Error(code);};
 if(!session||!['viewUser','viewRole','prepareRoleTurn'].every(k=>typeof session[k]==='function')||
   ([decideRole,decideBot].some(f=>f!==null)&&(typeof allowSpeech!=='function'||![decideRole,decideBot].every(f=>f===null||typeof f==='function')))||
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
       let actor=null;
       const candidates=v.seats.filter(s=>['role','bot'].includes(s.kind)&&s.mode==='player'&&v.game.players.some(p=>p.seatId===s.seatId&&p.alive));
       for(const seat of candidates){
         if(v.game.stage!=='night'&&v.game.activeSeatId!==seat.seatId)continue;
         const probe=await (seat.kind==='bot'?session.viewBot(seat.seatId):session.viewRole(seat.roleId));check(stamp);validate(probe,roomId,seat.seatId);
         if(probe.revision!==v.revision)fail('WOLF_DRIVER_STALE');
         if(probe.game.legalKinds.length){actor=seat;break;}
       }
       if(!actor)fail('WOLF_DRIVER_NO_ACTOR');
       const provider=actor.kind==='bot'?decideBot:decideRole;
       if(actor.kind==='role'&&!provider)return {status:'model-unavailable',actions};
       await bounded(stamp,signal=>pace({round:v.game.round,stage:v.game.stage},signal));check(stamp);
       const turn=await (actor.kind==='bot'?session.prepareBotTurn(actor.seatId):session.prepareRoleTurn(actor.roleId));check(stamp);const own=turn.view;validate(own,roomId,actor.seatId);
       if(own.revision!==v.revision||!own.game.legalKinds.length||typeof turn.commit!=='function')fail('WOLF_DRIVER_STALE');
       const g=own.game,proposed=provider?await bounded(stamp,signal=>provider(own,{signal})):chooseWerewolfBotMove(own);let move=null;
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

// Explicit local fallback for anonymous seats only. No persona, memory,
// fabricated speech, hidden-state access or model call. Public votes and
// own legal targets/inspection results are the only inputs.
export function chooseWerewolfBotMove(view){
 if(view?.gameId!=='werewolf'||view.phase!=='playing'||!/^bot:(?:[1-9]|1[01])$/.test(view.selfSeatId)||!view.seats?.some(s=>s.seatId===view.selfSeatId&&s.kind==='bot'))throw Error('WOLF_BOT_VIEW');
 const g=view.game,k=g.legalKinds.find(k=>['choose','protect','inspect','vote'].includes(k));
 if(!k||!g.legalTargets.length)return {kind:'pass'};
 const targets=g.legalTargets,known=new Set((g.inspections??[]).filter(x=>x.team==='wolf').map(x=>x.targetSeatId));
 const teammates=new Set(g.teammates??[]);
 let pool=targets;
 if(k==='vote'){const suspects=targets.filter(id=>known.has(id));const others=targets.filter(id=>!teammates.has(id));if(suspects.length)pool=suspects;else if(others.length)pool=others;}
 if(k==='inspect'){const checked=new Set((g.inspections??[]).map(x=>x.targetSeatId));const fresh=targets.filter(id=>!checked.has(id));if(fresh.length)pool=fresh;}
 const index=(Number(view.selfSeatId.slice(4))+g.round-1)%pool.length;return {kind:k,targetSeatId:pool[index]};
}
