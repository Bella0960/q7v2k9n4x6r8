import {createBrowserRoomSession} from './browser-room-session.js';
import {createGomokuRules} from './gomoku-rules.js';
import {createGomokuTurnDriver} from './gomoku-turn-driver.js';
import {createGomokuBoardView} from './gomoku-board-view.js';

// Production-mountable controller; no account bypass or new route.
export function createGomokuPageHost(root,{win=root?.ownerDocument?.defaultView,labelForSeat=()=>'',onStatus=()=>{},onView=()=>{},onDecision=()=>{},decideRole=null,pace=()=>{}}={}){
  const fail=code=>{throw Error(code);};
  if(!root?.ownerDocument||!win?.document||![labelForSeat,onStatus,onView,onDecision,pace].every(f=>typeof f==='function')||(decideRole!==null&&typeof decideRole!=='function'))fail('GOMOKU_INVALID_HOST');
  let entry=null,epoch=0,busy=false,destroyed=false;
  const listeners=[];
  function listen(t,n,f){t.addEventListener(n,f);listeners.push(()=>t.removeEventListener(n,f));}
  function report(s){try{onStatus(s);}catch{}}
  function check(e,stamp){if(destroyed||entry!==e||epoch!==stamp)fail('GOMOKU_PAGE_STALE');}
  function clear(e){e?.board?.destroy();if(e){e.board=null;e.revision=-1;}root.replaceChildren();}
  function pause(){if(!entry)return;epoch++;entry.driver.stop();clear(entry);report('paused');}
  function end(){const old=entry;entry=null;epoch++;if(old){old.driver.dispose();old.session.dispose();}clear(old);report('idle');}
  function destroy(){if(destroyed)return;destroyed=true;end();for(const remove of listeners.splice(0))remove();}
  listen(win,'pagehide',destroy);listen(win,'offline',pause);listen(win,'storage',pause);listen(win.document,'visibilitychange',()=>{if(win.document.hidden)pause();});
  function publish(e,v,stamp){
    check(e,stamp);
    if(v.roomId!==e.roomId||v.gameId!=='gomoku'||v.selfSeatId!=='user'||!['playing','finished'].includes(v.phase))fail('GOMOKU_INVALID_VIEW');
    if(e.board&&e.revision===v.revision)return;
    if(!e.board)e.board=createGomokuBoardView(root,{labelForSeat,onMove:a=>move(e,a),onError:()=>{}});
    e.board.render(v);e.revision=v.revision;try{onView(v);}catch{}
  }
  async function run(e,stamp){
    check(e,stamp);e.runStamp=stamp;report('thinking');
    const result=await e.driver.runUntilUser();check(e,stamp);
    report(result.status==='yield'?'yield':result.status==='finished'?'finished':'ready');return result;
  }
  async function move(e,a){
    if(busy||!e.board)fail('GOMOKU_PAGE_BUSY');const stamp=epoch;check(e,stamp);busy=true;
    try{
      const v=await e.session.viewUser();check(e,stamp);
      if(v.phase!=='playing'||v.turnSeatId!=='user'||a?.roomId!==e.roomId||a.revision!==v.revision||a.seatId!=='user')fail('GOMOKU_STALE_ACTION');
      const commit=await e.session.prepareUserAction();check(e,stamp);
      const next=await commit({type:'move',move:a.move});check(e,stamp);publish(e,next,stamp);
      if(next.phase==='playing'&&next.turnSeatId!=='user')await run(e,stamp);else report(next.phase==='finished'?'finished':'ready');
    }catch(error){if(entry===e&&epoch===stamp){pause();if(e.session.status()==='disposed')end();}throw error;}finally{busy=false;}
  }
  async function start({roomId,opponents=[],observers=[],watch=false,blackFirst=true,difficulty='normal',expectedIdentity=null}={}){
    if(destroyed||busy||entry)fail('GOMOKU_PAGE_BUSY');
    const ids=[...opponents,...observers];
    if(typeof roomId!=='string'||!roomId.trim()||!Array.isArray(opponents)||!Array.isArray(observers)||
      typeof watch!=='boolean'||typeof blackFirst!=='boolean'||opponents.length!==(watch?2:1)||observers.length>(watch?5:6)||new Set(ids).size!==ids.length||
      !ids.every(id=>typeof id==='string'&&id.length&&id.length<=256&&id.trim()===id)||!['easy','normal','hard'].includes(difficulty))fail('GOMOKU_INVALID_SETUP');
    busy=true;const stamp=++epoch;let e;
    try{
      const session=createBrowserRoomSession({win,spec:{roomId,gameId:'gomoku'},rules:createGomokuRules(),expectedIdentity});
      e={roomId,session,board:null,revision:-1,driver:null,runStamp:stamp};
      e.driver=createGomokuTurnDriver({session,decide:decideRole,difficulty,maxActions:watch?8:1,pace,onView:v=>publish(e,v,e.runStamp),onDecision:d=>{if(entry===e&&e.board&&!destroyed)onDecision(d);}});
      entry=e;report('opening');await session.refresh();check(e,stamp);
      async function send(action){const commit=await session.prepareUserAction();check(e,stamp);const v=await commit(action);check(e,stamp);return v;}
      await send({type:'invite',roleId:opponents[0]});
      if(watch){await send({type:'invite',roleId:opponents[1],mode:'observer'});await send({type:'swapSeats',playerSeatId:'user',observerSeatId:'role:'+opponents[1]});}
      for(const id of observers)await send({type:'invite',roleId:id,mode:'observer'});
      if(!watch&&!blackFirst)await send({type:'reorder',seatIds:['role:'+opponents[0],'user',...observers.map(id=>'role:'+id)]});
      const v=await send({type:'start'});publish(e,v,stamp);
      report(v.turnSeatId==='user'?'ready':'yield');
      return v;
    }catch(error){if(entry===e)end();throw error;}finally{busy=false;}
  }
  async function resume(){
    const e=entry,stamp=epoch;if(destroyed||busy||!e)fail('GOMOKU_PAGE_BUSY');busy=true;
    try{const v=await e.session.viewUser();check(e,stamp);publish(e,v,stamp);
      if(v.phase==='playing'&&v.turnSeatId!=='user')return await run(e,stamp);
      const status=v.phase==='finished'?'finished':'user';report(status==='user'?'ready':status);return {status,actions:0};
    }catch(error){if(entry===e&&stamp===epoch){pause();if(e.session.status()==='disposed')end();}throw error;}finally{busy=false;}
  }
  root.replaceChildren();
  return Object.freeze({start,resume,end,destroy,pause,status:()=>destroyed?'disposed':busy?'busy':entry?entry.board?'open':'paused':'idle'});
}
