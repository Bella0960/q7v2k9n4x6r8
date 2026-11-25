// Independent scoped requests: moderator and player providers must not share
// conversational state. The moderator can only return a verdict or boolean.
export function createTurtleTurnDriver({session,askRole=null,judgeRole=null,askBot=null,judgeBot=null,allowPlayerText=null,onView=()=>{},onStatus=()=>{},pace=()=>{},timeoutMs=12000,maxActions=12}={}){
 const fail=code=>{throw Error(code);};
 if(!session||typeof session.viewUser!=='function'||typeof session.prepareRoleTurn!=='function'||
   ![askRole,judgeRole,askBot,judgeBot,allowPlayerText].every(f=>f===null||typeof f==='function')||
   (askRole||askBot)&&!allowPlayerText||![onView,onStatus,pace].every(f=>typeof f==='function')||
   !Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxActions)||maxActions<1||maxActions>60)fail('TURTLE_DRIVER_INVALID');
 let epoch=0,running=false,disposed=false,cancel=null;
 const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
 function check(stamp){if(disposed||stamp!==epoch)fail('TURTLE_DRIVER_STOPPED');}
 function stop(){epoch++;cancel?.();}
 async function bounded(stamp,fn){
   check(stamp);const ac=new AbortController();let timer,interrupt;
   const stopped=new Promise((_,reject)=>{interrupt=()=>{reject(Error('TURTLE_DRIVER_STOPPED'));ac.abort();};});
   cancel=interrupt;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('TURTLE_DRIVER_TIMEOUT'));ac.abort();},timeoutMs);});
   try{const value=await Promise.race([stopped,deadline,Promise.resolve().then(()=>{check(stamp);return fn(ac.signal);})]);check(stamp);return value;}
   finally{clearTimeout(timer);if(cancel===interrupt)cancel=null;}
 }
 function valid(v,roomId,seatId){
   if(v?.gameId!=='turtle'||v.roomId!==roomId||v.selfSeatId!==seatId||!['playing','finished'].includes(v.phase)||!Number.isSafeInteger(v.revision)||!v.game||!Array.isArray(v.game.legalKinds))fail('TURTLE_DRIVER_VIEW');
 }
 async function runUntilUser(){
   if(disposed||running)fail('TURTLE_DRIVER_BUSY');running=true;const stamp=epoch;let actions=0;
   try{
     let v=await session.viewUser();check(stamp);const roomId=v.roomId;valid(v,roomId,'user');
     await onView(v);check(stamp);
     while(v.phase==='playing'&&v.game.activeSeatId!=='user'&&actions<maxActions){
       const seat=v.seats.find(s=>s.seatId===v.game.activeSeatId&&['role','bot'].includes(s.kind));
       const bot=seat?.kind==='bot'&&/^bot:[1-7]$/.test(seat.seatId)&&seat.roleId===undefined;
       if(!bot&&(!seat||seat.seatId!=='role:'+seat.roleId))fail('TURTLE_DRIVER_SEAT');
       await bounded(stamp,signal=>pace(v,signal));check(stamp);
       const turn=await (bot?session.prepareBotTurn(seat.seatId):session.prepareRoleTurn(seat.roleId));check(stamp);const own=turn.view;
       valid(own,roomId,seat.seatId);
       if(own.revision!==v.revision||own.game.activeSeatId!==seat.seatId||own.phase!=='playing'||typeof turn.commit!=='function')fail('TURTLE_DRIVER_STALE');
       let move=null,source='local';const ask=bot?askBot:askRole,judge=bot?judgeBot:judgeRole;
       if(seat.mode==='moderator'){
         if(!Object.hasOwn(own.game,'solution')||!own.game.pending)fail('TURTLE_DRIVER_MODERATOR');
         if(own.game.pending.kind==='ask'&&own.game.pendingVerdict!==null){
           move={kind:'answer',verdict:own.game.pendingVerdict};
         }else if(judge){
           const candidate=await bounded(stamp,signal=>judge(own,{signal}));
           if(own.game.pending.kind==='ask'&&exact(candidate,['kind','verdict'])&&candidate.kind==='answer'&&['yes','no','irrelevant','unclear'].includes(candidate.verdict))move={kind:'answer',verdict:candidate.verdict};
           if(own.game.pending.kind==='guess'&&exact(candidate,['kind','correct'])&&candidate.kind==='judge'&&typeof candidate.correct==='boolean')move={kind:'judge',correct:candidate.correct};
           if(!move)fail('TURTLE_DRIVER_BAD_JUDGEMENT');source='model';
         }else return {status:'model-unavailable',actions};
       }else{
         // Defence in depth: never call a player provider with a moderator view.
         if(Object.hasOwn(own.game,'solution')||Object.hasOwn(own.game,'moderatorFacts')||Object.hasOwn(own.game,'pendingVerdict'))fail('TURTLE_DRIVER_PRIVATE_VIEW');
         if(ask){
           const candidate=await bounded(stamp,signal=>ask(own,{signal}));
           if(candidate&&own.game.legalKinds.includes(candidate.kind)){
             if(['ask','guess'].includes(candidate.kind)&&exact(candidate,['kind','text'])&&typeof candidate.text==='string'&&candidate.text.trim()===candidate.text&&candidate.text.length>0&&candidate.text.length<=500){
               if(await bounded(stamp,signal=>allowPlayerText({seatId:seat.seatId,text:candidate.text},{signal}))===true)move={kind:candidate.kind,text:candidate.text};
             }else if(candidate.kind==='ask'&&exact(candidate,['kind','factId'])&&own.game.questionOptions.some(q=>q.id===candidate.factId))move={kind:'ask',factId:candidate.factId};
             else if(candidate.kind==='pass'&&exact(candidate,['kind']))move={kind:'pass'};
           }
           if(move)source='model';
         }
         if(!move&&own.game.questionOptions.length)move={kind:'ask',factId:own.game.questionOptions[0].id};
         if(!move)return {status:'model-unavailable',actions};
       }
       check(stamp);await turn.commit(move);check(stamp);actions++;
       const next=await session.viewUser();check(stamp);valid(next,roomId,'user');if(next.revision!==v.revision+1)fail('TURTLE_DRIVER_STALE');
       v=next;await onView(v);check(stamp);try{onStatus({seatId:seat.seatId,source,revision:v.revision});}catch{}
     }
     return {status:v.phase==='finished'?'finished':v.game.activeSeatId==='user'?'user':'yield',actions};
   }finally{running=false;}
 }
 return Object.freeze({runUntilUser,stop,dispose(){disposed=true;stop();},status:()=>disposed?'disposed':running?'running':'idle'});
}
