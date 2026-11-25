import {chooseGomokuMove} from './gomoku-strategy.js';

// Existing scoped session controls seat capabilities. A model only proposes
// coordinates; local fallback is explicit and cannot modify the rules.
export function createGomokuTurnDriver({session,onView=()=>{},onDecision=()=>{},pace=()=>{},decide=null,decideBot=null,difficulty='normal',timeoutMs=8000,maxActions=16}={}){
  const fail=code=>{throw Error(code);};
  if(!session||typeof session.viewUser!=='function'||typeof session.prepareRoleTurn!=='function'||
    ![onView,onDecision,pace].every(f=>typeof f==='function')||(![decide,decideBot].every(f=>f===null||typeof f==='function'))||
    !['easy','normal','hard'].includes(difficulty)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
    !Number.isInteger(maxActions)||maxActions<1||maxActions>225)fail('GOMOKU_INVALID_DRIVER');
  let epoch=0,running=false,disposed=false,cancel=null;
  function check(stamp){if(disposed||stamp!==epoch)fail('GOMOKU_DRIVER_STOPPED');}
  function stop(){epoch++;cancel?.();}
  async function bounded(stamp,work){
    check(stamp);const ac=new AbortController();let timer,rejectStop;
    const stopped=new Promise((_,reject)=>{rejectStop=reject;});
    const interrupt=()=>{rejectStop(Error('GOMOKU_DRIVER_STOPPED'));ac.abort();};
    cancel=interrupt;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('GOMOKU_DRIVER_TIMEOUT'));ac.abort();},timeoutMs);});
    try{
      const result=await Promise.race([stopped,deadline,Promise.resolve().then(()=>{check(stamp);return work(ac.signal);})]);
      check(stamp);return result;
    }finally{clearTimeout(timer);if(cancel===interrupt)cancel=null;}
  }
  async function runUntilUser(){
    if(disposed)fail('GOMOKU_DRIVER_DISPOSED');if(running)fail('GOMOKU_DRIVER_BUSY');
    running=true;const stamp=epoch;let actions=0;
    try{
      let view=await session.viewUser();check(stamp);const roomId=view.roomId;
      function valid(v){if(v?.gameId!=='gomoku'||v.roomId!==roomId||v.selfSeatId!=='user'||!['playing','finished'].includes(v.phase)||!Number.isSafeInteger(v.revision))fail('GOMOKU_STALE_VIEW');}
      valid(view);await onView(view);check(stamp);
      while(view.phase==='playing'&&view.turnSeatId!=='user'&&actions<maxActions){
        const role=view.seats.find(s=>s.seatId===view.turnSeatId&&s.mode==='player');
        const bot=role?.kind==='bot'&&role.seatId==='bot:1'&&role.roleId===undefined;
        if(!bot&&(!role||role.kind!=='role'||role.seatId!=='role:'+role.roleId))fail('GOMOKU_INVALID_ROLE_TURN');
        await bounded(stamp,signal=>pace(view,signal));check(stamp);
        const turn=await (bot?session.prepareBotTurn(role.seatId):session.prepareRoleTurn(role.roleId));check(stamp);
        const own=turn?.view;
        if(own?.gameId!=='gomoku'||own.roomId!==roomId||own.revision!==view.revision||own.selfSeatId!==role.seatId||own.turnSeatId!==role.seatId||own.phase!=='playing'||typeof turn.commit!=='function')fail('GOMOKU_STALE_VIEW');
        let proposal=null,source='local';
        const provider=bot?decideBot:decide;
        if(provider){
          try{
            const candidate=await bounded(stamp,signal=>provider(own,signal));
            const m=candidate?.move;
            if(m&&Object.keys(m).length===3&&own.game.legalMoves.some(x=>x.kind===m.kind&&x.x===m.x&&x.y===m.y)&&['kind','x','y'].every(k=>Object.hasOwn(m,k))){
              proposal={kind:m.kind,x:m.x,y:m.y};source='model';
            }
          }catch{check(stamp);}
        }
        check(stamp);const move=chooseGomokuMove(own,{difficulty,proposal});
        if(!move)fail('GOMOKU_NO_MOVE');
        // Commit re-verifies role, room, session and revision in existing bridge.
        await turn.commit(move);actions++;check(stamp);
        const next=await session.viewUser();check(stamp);valid(next);
        if(next.revision!==view.revision+1)fail('GOMOKU_STALE_VIEW');
        view=next;await onView(view);check(stamp);
        try{Promise.resolve(onDecision({seatId:role.seatId,source,move:{...move},revision:view.revision})).catch(()=>{});}catch{}
      }
      return {actions,status:view.phase==='finished'?'finished':view.turnSeatId==='user'?'user':'yield'};
    }finally{running=false;}
  }
  return Object.freeze({runUntilUser,stop,dispose(){disposed=true;stop();},status:()=>disposed?'disposed':running?'running':'idle'});
}
