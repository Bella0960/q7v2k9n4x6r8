import {chooseLudoRoleMove} from './ludo-board.js';

// A local, bounded role-turn driver over the existing verified room adapter.
// No network model, new account, storage, dice source or authority of its own.
export function createLudoTurnDriver({session,onView=()=>{},pace=()=>{},maxActions=32}={}){
  const fail=code=>{throw Error(code);};
  if(!session||typeof session.viewUser!=='function'||typeof session.prepareRoleTurn!=='function'||typeof onView!=='function'||typeof pace!=='function'||!Number.isInteger(maxActions)||maxActions<1||maxActions>128)fail('LUDO_INVALID_DRIVER');
  let running=false,disposed=false,epoch=0;
  const check=stamp=>{if(disposed||stamp!==epoch)fail('LUDO_DRIVER_STOPPED');};
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
        const role=view.seats.find(s=>s.seatId===view.turnSeatId&&s.kind==='role'&&s.mode==='player');
        if(!role||role.seatId!=='role:'+role.roleId)fail('LUDO_INVALID_ROLE_TURN');
        await pace();check(stamp);
        const turn=await session.prepareRoleTurn(role.roleId);check(stamp);
        const own=turn?.view;
        if(own?.roomId!==roomId||own.gameId!=='ludo'||own.revision!==view.revision||own.selfSeatId!==role.seatId||own.turnSeatId!==role.seatId||typeof turn.commit!=='function')fail('LUDO_STALE_VIEW');
        const move=chooseLudoRoleMove(own);
        if(!move)fail('LUDO_NO_ROLE_MOVE');
        check(stamp);
        // The session rechecks scope/roster and the turn token at commit.
        // A commit already in progress is not rolled back by stop().
        await turn.commit(move);actions++;check(stamp);
        const next=await session.viewUser();check(stamp);validate(next);
        if(next.revision!==view.revision+1)fail('LUDO_STALE_VIEW');
        view=next;await onView(view);check(stamp);
      }
      return {actions,status:view.phase!=='playing'?view.phase:view.turnSeatId==='user'?'user':'yield'};
    }finally{running=false;}
  }
  return Object.freeze({runUntilUser,stop(){epoch++;},dispose(){disposed=true;epoch++;},status:()=>disposed?'disposed':running?'running':'idle'});
}
