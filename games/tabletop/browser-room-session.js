import {createBrowserRoomVerifier} from './account-room-context.js';
import {createRoomSession} from './room-session.js';
import {createRoomLifetime} from './room-lifetime.js';
import {createRoomDispatcher} from './room-dispatcher.js';

// Opt-in browser runtime. No UI, persistence, network game or AI calls.
// Each operation (including a delayed AI result) re-verifies the account,
// session and roster before touching the authoritative room.
const fail=code=>{throw new Error(code);};
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
function rosterSet(raw) {
  if(raw===null) return new Set();
  try {
    const list=JSON.parse(raw);
    if(!Array.isArray(list)) return null;
    const ids=Array.from(list,r=>r?.id);
    return ids.every(validId)?new Set(ids):null;
  } catch {return null;}
}
function sameMembership(event) {
  const a=rosterSet(event.oldValue),b=rosterSet(event.newValue);
  return a&&b&&a.size===b.size&&[...a].every(id=>b.has(id));
}
export function createBrowserRoomSession({win=globalThis.window,spec,rules}={}) {
  if(!win?.document||typeof win.addEventListener!=='function'||typeof win.removeEventListener!=='function'||
     typeof win.document.addEventListener!=='function'||typeof win.document.removeEventListener!=='function') fail('INVALID_BROWSER_RUNTIME');
  let discussionController=new AbortController(),lastVerified=null;
  function cancelDiscussion() {
    const old=discussionController;discussionController=new AbortController();old.abort();
  }
  const verify=createBrowserRoomVerifier(win);
  const session=createRoomSession({verifyContext:async options=>{
    const next=await verify(options);
    // Same-document roster changes are observable on successful verification
    // even without a storage event. Cancel only the current discussion signal.
    if(lastVerified&&(lastVerified.accountId!==next.accountId||lastVerified.sessionId!==next.sessionId||
       lastVerified.roleIds.length!==next.roleIds.length||lastVerified.roleIds.some(id=>!next.roleIds.includes(id)))) cancelDiscussion();
    lastVerified=next;return next;
  },createLifetime:args=>createRoomLifetime({...args,createDispatcher:createRoomDispatcher}),spec,rules});
  let disposed=false,started=false,pending=null,epoch=0,eventRevision=0,lastError=null;
  const listeners=[];
  function listen(target,name,handler) {
    target.addEventListener(name,handler);
    listeners.push(()=>target.removeEventListener(name,handler));
  }
  function dispose() {
    if(disposed) return;
    disposed=true;epoch++;cancelDiscussion();lastVerified=null;
    for(const remove of listeners.splice(0)) remove();
    session.dispose();
  }
  function guard() {
    if(disposed) fail('ROOM_DISPOSED');
    if(win.document.hidden||win.navigator?.onLine===false) fail('PAGE_INACTIVE');
  }
  async function refresh() {
    guard();started=true;
    if(!pending) {
      const job=(async()=>{
        do {
          guard();
          const before=eventRevision;
          await session.refresh();
          guard();
          if(before===eventRevision) return true;
        } while(true);
      })();
      pending=job;
      const clear=()=>{if(pending===job) pending=null;};
      job.then(()=>{lastError=null;clear();},error=>{
        lastError=error;cancelDiscussion();
        if(session.status()==='disposed') dispose();
        clear();
      });
    }
    return pending;
  }
  function recheck() {
    eventRevision++;
    if(started&&!disposed&&!win.document.hidden&&win.navigator?.onLine!==false) refresh().catch(error=>{lastError=error;});
  }
  function inactive() {epoch++;eventRevision++;cancelDiscussion();}
  function storage(event) {
    // The released namespace passes physical own-account keys, while founder
    // storage remains unprefixed. Never examine values for foreign keys.
    const scope=win.__MAO_ACCOUNT_SCOPE__;
    if(scope?.ready!==true||!validId(scope.accountId)) {dispose();return;}
    const key=scope.role==='super_admin'?'ai_custom_characters':'__mao_account_v1__'+encodeURIComponent(scope.accountId)+'__ai_custom_characters';
    if(event.key!==key&&event.key!==null) return;
    if(event.key===null||!sameMembership(event)) {epoch++;cancelDiscussion();}
    recheck();
  }
  listen(win,'pagehide',dispose);
  listen(win,'focus',recheck);
  listen(win,'online',recheck);
  listen(win,'offline',inactive);
  listen(win,'storage',storage);
  listen(win.document,'visibilitychange',()=>{if(win.document.hidden) inactive();else recheck();});
  function bindBrowser(callback,stamp) {
    return async payload=>{
      guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      await refresh();guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      const result=callback(payload);
      if(result.phase==='closed') dispose();
      return result;
    };
  }
  async function prepare(getCallback) {
    await refresh();guard();
    const stamp=epoch;
    return bindBrowser(getCallback(),stamp);
  }
  async function prepareRoleTurn(roleId) {
    await refresh();guard();
    const stamp=epoch,turn=session.prepareRoleTurn(roleId);
    guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
    return Object.freeze({view:turn.view,commit:bindBrowser(turn.commit,stamp)});
  }
  async function prepareBotTurn(seatId) {
    await refresh();guard();
    const stamp=epoch,turn=session.prepareBotTurn(seatId);
    guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
    return Object.freeze({view:turn.view,commit:bindBrowser(turn.commit,stamp)});
  }
  return Object.freeze({
    prepareBotTurn,
    refresh,dispose,status:()=>disposed?'disposed':session.status(),
    lastError:()=>lastError?.message??null,
    async viewUser(){await refresh();guard();return session.viewUser();},
    async viewRole(roleId){
      await refresh();guard();
      const stamp=epoch,view=session.viewRole(roleId);
      guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      return view;
    },
    async viewBot(seatId){
      await refresh();guard();
      const stamp=epoch,view=session.viewBot(seatId);
      guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      return view;
    },
    // Synchronous publication guard after the asynchronous account check.
    // The current local scope/roster must still match that check.
    discussionCurrent(signal,{allowFinished=false}={}){
      try {
        guard();
        if(!lastVerified||signal!==discussionController.signal||signal.aborted||session.status()!=='ready') return false;
        const scope=win.__MAO_ACCOUNT_SCOPE__;
        if(scope?.ready!==true||scope.accountId!==lastVerified.accountId||
          win.document.querySelector('meta[name="mao-account-id"]')?.content!==scope.accountId||
          win.document.querySelector('meta[name="mao-account-role"]')?.content!==scope.role) return false;
        const roster=win.PhoneStorage?.result?.getCharacters?.();
        const ids=roster?.ok===false&&roster.error?.code==='NOT_FOUND'?[]:
          roster?.ok===true&&roster.meta?.source==='ai_custom_characters'&&Array.isArray(roster.value)?Array.from(roster.value,r=>r?.id):null;
        if(!ids||!ids.every(validId)||new Set(ids).size!==lastVerified.roleIds.length||!lastVerified.roleIds.every(id=>ids.includes(id))) return false;
        if(signal!==discussionController.signal||signal.aborted||win.__MAO_ACCOUNT_SCOPE__?.accountId!==scope.accountId) return false;
        const phase=session.viewUser().phase;
        return phase==='playing'||(allowFinished&&phase==='finished');
      } catch {return false;}
    },
    // Trusted caller passes this signal to the existing speech runner.
    // This detects observed invalidation, not unobserved server-side changes.
    async discussionSignal(){
      await refresh();guard();
      const controller=discussionController;
      if(!['playing','finished'].includes(session.viewUser().phase)) fail('DISCUSSION_NOT_ACTIVE');
      guard();if(controller!==discussionController||controller.signal.aborted) fail('STALE_BROWSER_CONTEXT');
      return controller.signal;
    },
    prepareUserAction:()=>prepare(()=>session.prepareUserAction()),
    prepareRoleMove:roleId=>prepare(()=>session.prepareRoleMove(roleId)),
    prepareRoleTurn
  });
}
