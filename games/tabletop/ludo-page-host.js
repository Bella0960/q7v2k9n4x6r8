import {createBrowserRoomSession} from './browser-room-session.js';
import {createLudoRules} from './ludo-rules.js';
import {createLudoBoardView} from './ludo-board-view.js';
import {createLudoTurnDriver} from './ludo-turn-driver.js';
import {createLudoDiscussion,ludoEventPriority} from './ludo-discussion.js';

// Opt-in page controller. The host must load the canonical account scope and
// PhoneStorage first. No fixture identities, storage writes or route registration.
export function createLudoPageHost(root,{win=root?.ownerDocument?.defaultView,onStatus=()=>{},pace=()=>{},rollDie,discussion={},decideRole=null,labelForSeat=()=>undefined}={}){
  const fail=code=>{throw Error(code);};
  if(!root?.ownerDocument||!win?.document||typeof onStatus!=='function'||typeof pace!=='function'||typeof labelForSeat!=='function'||!discussion||typeof discussion!=='object'||(decideRole!==null&&typeof decideRole!=='function')||(rollDie!==undefined&&typeof rollDie!=='function'))fail('LUDO_INVALID_PAGE_HOST');
  let entry=null,destroyed=false,busy=false,epoch=0;
  const listeners=[];
  function listen(target,name,fn){target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));}
  function report(state){onStatus(state);}
  function check(e,stamp){if(destroyed||entry!==e||stamp!==epoch)fail('LUDO_PAGE_STALE');}
  function clear(e){e?.board?.destroy();if(e){e.board=null;e.revision=-1;}root.replaceChildren();}
  function pause(reason){
    if(!entry)return;
    epoch++;entry.eventView=null;entry.driver.stop();entry.discussion?.stop();clear(entry);report(reason);
  }
  function end(){
    const old=entry;entry=null;epoch++;
    if(old){old.discussion?.close();old.driver.dispose();old.session.dispose();}
    clear(old);report('idle');
  }
  function destroy(){
    if(destroyed)return;destroyed=true;end();for(const remove of listeners.splice(0))remove();
  }
  listen(win,'pagehide',destroy);
  listen(win,'offline',()=>pause('paused'));
  listen(win.document,'visibilitychange',()=>{if(win.document.hidden)pause('paused');});
  // Do not inspect storage payloads. Any observable storage change is a
  // conservative reason to hide this board until the account is reverified.
  listen(win,'storage',()=>pause('paused'));
  function publish(e,view,stamp){
    check(e,stamp);
    if(view.roomId!==e.roomId||view.gameId!=='ludo'||view.selfSeatId!=='user'||!['playing','finished'].includes(view.phase))fail('LUDO_PAGE_INVALID_VIEW');
    if(e.revision===view.revision&&e.board)return;
    if(!e.board)e.board=createLudoBoardView(root,{onMove:action=>move(e,action),labelForSeat:id=>/^bot:[1-3]$/.test(id)?'普通棋手 '+id.slice(4):labelForSeat(id)});
    const priority=ludoEventPriority(view);
    if(e.revision>=0&&view.revision===e.revision+1&&priority&&priority>=ludoEventPriority(e.eventView))e.eventView=view;
    e.board.render(view);e.revision=view.revision;
    if(view.phase==='finished'){e.eventView=null;e.discussion?.stop();}
  }
  function flushEvent(e,stamp){
    check(e,stamp);const event=e.eventView;e.eventView=null;
    // Do not wait for optional speech or feed raw model decision text into chat.
    if(event&&e.discussion)void e.discussion.react(event).catch(()=>{});
  }
  async function runRoles(e,stamp){
    check(e,stamp);e.runStamp=stamp;
    const result=await e.driver.runUntilUser();check(e,stamp);
    if(result.status==='user')flushEvent(e,stamp);
    report(result.status==='yield'?'yield':result.status==='finished'?'finished':'ready');
    return result;
  }
  async function move(e,action){
    if(busy||!e.board)fail('LUDO_PAGE_BUSY');
    const stamp=epoch;check(e,stamp);busy=true;
    try{
      // Capability and subsequent view are both verified by the existing
      // session. Its token rejects any intervening mutation at commit.
      const commit=await e.session.prepareUserAction();check(e,stamp);
      const current=await e.session.viewUser();check(e,stamp);
      if(action?.roomId!==e.roomId||action?.seatId!=='user'||action?.revision!==current.revision||current.turnSeatId!=='user'||current.phase!=='playing')fail('LUDO_PAGE_STALE_ACTION');
      const next=await commit({type:'move',move:action.move});check(e,stamp);publish(e,next,stamp);
      if(next.phase==='playing'&&next.turnSeatId!=='user')await runRoles(e,stamp);
      else {if(next.phase==='playing')flushEvent(e,stamp);report(next.phase==='finished'?'finished':'ready');}
    }catch(error){if(entry===e&&stamp===epoch){pause('paused');if(e.session.status()==='disposed')end();}throw error;}
    finally{busy=false;}
  }
  async function start({roomId,roleIds=[],playerCount=Math.max(2,roleIds?.length+1),mode='classic',expectedIdentity=null}={}){
    if(destroyed||busy||entry)fail('LUDO_PAGE_BUSY');
    if(typeof roomId!=='string'||!roomId.trim()||!Array.isArray(roleIds)||roleIds.length>3||!Number.isInteger(playerCount)||playerCount<2||playerCount>4||roleIds.length>=playerCount||!['classic','adventure'].includes(mode)||new Set(roleIds).size!==roleIds.length||!Array.from(roleIds).every(id=>typeof id==='string'&&id.trim()===id&&id.length>0&&id.length<=256))fail('LUDO_PAGE_INVALID_PLAYERS');
    const selected=[...roleIds];busy=true;const stamp=++epoch;
    let e;
    try{
      const session=createBrowserRoomSession({win,spec:{roomId,gameId:'ludo'},expectedIdentity,rules:createLudoRules({rollDie,mode})});
      e={roomId,session,board:null,revision:-1,driver:null,discussion:null,eventView:null,runStamp:stamp};
      e.driver=createLudoTurnDriver({session,pace,decide:decideRole,onView:view=>publish(e,view,e.runStamp)});
      entry=e;report('opening');
      await session.refresh();check(e,stamp);
      for(const roleId of selected){const invite=await session.prepareUserAction();check(e,stamp);await invite({type:'invite',roleId});check(e,stamp);}
      if(selected.length+1<playerCount){const fill=await session.prepareUserAction();check(e,stamp);await fill({type:'fillBots',playerCount});check(e,stamp);}
      const begin=await session.prepareUserAction();check(e,stamp);
      const view=await begin({type:'start'});check(e,stamp);
      e.discussion=createLudoDiscussion({...discussion,session,view,onChange:messages=>{
        if(entry===e&&e.board&&!destroyed) discussion.onChange?.(messages);
      }});
      publish(e,view,stamp);report('ready');
      return view;
    }catch(error){if(entry===e)end();throw error;}
    finally{busy=false;}
  }
  // Internal restore hook for the future verified repository, not a file-import
  // or user-editable state entry. Chat persistence remains a separate contract.
  async function restore(checkpoint,{expectedIdentity=null}={}){
    if(destroyed||busy||entry)fail('LUDO_PAGE_BUSY');
    if(!checkpoint||checkpoint.gameId!=='ludo'||typeof checkpoint.roomId!=='string'||!['classic','adventure'].includes(checkpoint.mode))fail('LUDO_PAGE_INVALID_CHECKPOINT');
    const stamp=++epoch;busy=true;let e;
    try{
      const session=createBrowserRoomSession({win,spec:{roomId:checkpoint.roomId,gameId:'ludo'},rules:createLudoRules({rollDie,mode:checkpoint.mode}),expectedIdentity,checkpoint});
      e={roomId:checkpoint.roomId,session,board:null,revision:-1,driver:null,discussion:null,eventView:null,runStamp:stamp};
      e.driver=createLudoTurnDriver({session,pace,decide:decideRole,onView:view=>publish(e,view,e.runStamp)});
      entry=e;report('opening');
      const view=await session.viewUser();check(e,stamp);
      if(view.phase==='playing')e.discussion=createLudoDiscussion({...discussion,session,view,onChange:messages=>{
        if(entry===e&&e.board&&!destroyed)discussion.onChange?.(messages);
      }});
      publish(e,view,stamp);report(view.phase==='finished'?'finished':view.turnSeatId==='user'?'ready':'yield');
      return view;
    }catch(error){if(entry===e)end();throw error;}
    finally{busy=false;}
  }
  async function checkpoint(){
    const e=entry,stamp=epoch;
    if(destroyed||!e?.board)fail('LUDO_PAGE_BUSY');
    const saved=await e.session.checkpoint();check(e,stamp);return saved;
  }
  async function resume(){
    const e=entry;if(destroyed||!e||busy)fail('LUDO_PAGE_BUSY');
    busy=true;const stamp=epoch;
    try{
      const view=await e.session.viewUser();check(e,stamp);publish(e,view,stamp);
      if(view.phase==='playing'&&view.turnSeatId!=='user')return await runRoles(e,stamp);
      const state=view.phase==='finished'?'finished':'ready';report(state);return {status:state,actions:0};
    }catch(error){if(entry===e&&stamp===epoch){pause('paused');if(e.session.status()==='disposed')end();}throw error;}
    finally{busy=false;}
  }
  root.replaceChildren();
  function chat(){if(destroyed||!entry?.board||!entry.discussion)fail('LUDO_DISCUSSION_NOT_ACTIVE');return entry.discussion;}
  return Object.freeze({start,restore,checkpoint,resume,end,destroy,sendChat:message=>chat().send(message),readChat:()=>chat().read(),stopChat:()=>entry?.discussion?.stop(),status:()=>destroyed?'disposed':busy?'busy':entry?entry.board?'open':'paused':'idle'});
}
