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
  const session=createRoomSession({verifyContext:createBrowserRoomVerifier(win),createLifetime:args=>createRoomLifetime({...args,createDispatcher:createRoomDispatcher}),spec,rules});
  let disposed=false,started=false,pending=null,epoch=0,eventRevision=0,lastError=null;
  const listeners=[];
  function listen(target,name,handler) {
    target.addEventListener(name,handler);
    listeners.push(()=>target.removeEventListener(name,handler));
  }
  function dispose() {
    if(disposed) return;
    disposed=true;epoch++;
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
        lastError=error;
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
  function inactive() {epoch++;eventRevision++;}
  function storage(event) {
    // The released namespace passes physical own-account keys, while founder
    // storage remains unprefixed. Never examine values for foreign keys.
    const scope=win.__MAO_ACCOUNT_SCOPE__;
    if(scope?.ready!==true||!validId(scope.accountId)) {dispose();return;}
    const key=scope.role==='super_admin'?'ai_custom_characters':'__mao_account_v1__'+encodeURIComponent(scope.accountId)+'__ai_custom_characters';
    if(event.key!==key&&event.key!==null) return;
    if(event.key===null||!sameMembership(event)) epoch++;
    recheck();
  }
  listen(win,'pagehide',dispose);
  listen(win,'focus',recheck);
  listen(win,'online',recheck);
  listen(win,'offline',inactive);
  listen(win,'storage',storage);
  listen(win.document,'visibilitychange',()=>{if(win.document.hidden) inactive();else recheck();});
  async function prepare(getCallback) {
    await refresh();guard();
    const stamp=epoch,callback=getCallback();
    return async payload=>{
      guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      await refresh();guard();if(stamp!==epoch) fail('STALE_BROWSER_CONTEXT');
      const result=callback(payload);
      if(result.phase==='closed') dispose();
      return result;
    };
  }
  return Object.freeze({
    refresh,dispose,status:()=>disposed?'disposed':session.status(),
    lastError:()=>lastError?.message??null,
    async viewUser(){await refresh();guard();return session.viewUser();},
    prepareUserAction:()=>prepare(()=>session.prepareUserAction()),
    prepareRoleMove:roleId=>prepare(()=>session.prepareRoleMove(roleId))
  });
}
