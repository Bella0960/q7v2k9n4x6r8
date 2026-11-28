import {chooseLudoRoleMove} from './ludo-board.js';

// A local, bounded role-turn driver over the existing verified room adapter.
// No network model, new account, storage, dice source or authority of its own.
export function createLudoTurnDriver({session,onView=()=>{},pace=()=>{},maxActions=32,decide=null,decideBot=null,timeoutMs=15000,onStrategy=()=>{},onDecision=()=>{}}={}){
  const fail=code=>{throw Error(code);};
  if(!session||typeof session.viewUser!=='function'||typeof session.prepareRoleTurn!=='function'||typeof onView!=='function'||typeof pace!=='function'||![decide,decideBot].every(f=>f===null||typeof f==='function')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||typeof onStrategy!=='function'||typeof onDecision!=='function'||!Number.isInteger(maxActions)||maxActions<1||maxActions>128)fail('LUDO_INVALID_DRIVER');
  let running=false,disposed=false,epoch=0,cancelPace=null;
  const check=stamp=>{if(disposed||stamp!==epoch)fail('LUDO_DRIVER_STOPPED');};
  function stop(){epoch++;cancelPace?.();}
  async function waitForWork(stamp,work,limit=null){
    check(stamp);
    let cancel,timer;const ac=new AbortController();
    const stopped=new Promise((_,reject)=>{cancel=()=>{reject(Error('LUDO_DRIVER_STOPPED'));ac.abort();};});
    cancelPace=cancel;
    try{
      const jobs=[stopped,Promise.resolve().then(()=>{check(stamp);return work(ac.signal);})];
      if(limit!==null)jobs.push(new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('LUDO_DRIVER_TIMEOUT'));ac.abort();},limit);}));
      const result=await Promise.race(jobs);
      check(stamp);return result;
    }finally{clearTimeout(timer);if(cancelPace===cancel)cancelPace=null;}
  }
  async function runUntilUser(){
    if(disposed)fail('LUDO_DRIVER_DISPOSED');
    if(running)fail('LUDO_DRIVER_BUSY');
    running=true;const stamp=epoch;let actions=0;
    try{
      let view=await session.viewUser();check(stamp);
      const roomId=view.roomId;
      function validate(v){
        if(v?.gameId!=='ludo'||v.roomId!==roomId||v.selfSeatId!=='user'||!Number.isSafeInteger(v.revision))fail('LUDO_STALE_VIEW');
      }
      validate(view);await onView(view);check(stamp);
      while(view.phase==='playing'&&view.turnSeatId!=='user'&&actions<maxActions){
        const role=view.seats.find(s=>s.seatId===view.turnSeatId&&s.mode==='player');
        const bot=role?.kind==='bot'&&/^bot:[1-3]$/.test(role.seatId)&&role.roleId===undefined;
        if(!bot&&(!role||role.kind!=='role'||role.seatId!=='role:'+role.roleId))fail('LUDO_INVALID_ROLE_TURN');
        if(bot&&typeof session.prepareBotTurn!=='function')fail('LUDO_BOT_UNAVAILABLE');
        await waitForWork(stamp,()=>pace(view));check(stamp);
        const turn=await (bot?session.prepareBotTurn(role.seatId):session.prepareRoleTurn(role.roleId));check(stamp);
        const own=turn?.view;
        if(own?.roomId!==roomId||own.gameId!=='ludo'||own.revision!==view.revision||own.selfSeatId!==role.seatId||own.turnSeatId!==role.seatId||typeof turn.commit!=='function')fail('LUDO_STALE_VIEW');
        let choice=null;const provider=bot?decideBot:decide;
        const optional=own.game.legalMoves.length>1;
        if(provider&&optional){try{choice=await waitForWork(stamp,signal=>provider(own,signal),timeoutMs);}catch{check(stamp);}}
        check(stamp);
        // Match the model proposal against this exact seat/revision's projected legal actions.
        const proposed=choice?.move,allowed=proposed&&own.game.legalMoves.find(m=>m.kind===proposed.kind&&m.plane===proposed.plane&&m.card===proposed.card&&Object.keys(proposed).every(k=>['kind','plane','card'].includes(k)));
        const move=allowed?(allowed.kind==='choose'?{kind:'choose',plane:allowed.plane,...(allowed.card?{card:allowed.card}:{})}:{kind:allowed.kind}):chooseLudoRoleMove(own);
        if(!move)fail('LUDO_NO_ROLE_MOVE');
        check(stamp);
        // The session rechecks scope/roster and the turn token at commit.
        // A commit already in progress is not rolled back by stop().
        await turn.commit(move);actions++;check(stamp);
        const next=await session.viewUser();check(stamp);validate(next);
        if(next.revision!==view.revision+1)fail('LUDO_STALE_VIEW');
        view=next;await onView(view);check(stamp);
        if(optional){try{onStrategy({seatId:role.seatId,source:allowed?'model':'local',revision:view.revision});}catch{}}
        if(allowed&&typeof choice.say==='string'&&choice.say.trim()){try{Promise.resolve(onDecision(own.selfSeatId,choice.say.slice(0,150),view)).catch(()=>{});}catch{/* chat must not invalidate a committed move */}}
      }
      return {actions,status:view.phase!=='playing'?view.phase:view.turnSeatId==='user'?'user':'yield'};
    }finally{running=false;}
  }
  return Object.freeze({runUntilUser,stop,dispose(){disposed=true;stop();},status:()=>disposed?'disposed':running?'running':'idle'});
}
