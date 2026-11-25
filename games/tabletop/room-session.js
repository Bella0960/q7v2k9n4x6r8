// Internal bridge: only a trusted verifier may supply account/session/roster IDs.
// No browser event wiring, storage, authentication or AI requests in this module.
const fail = code => { throw new Error(code); };
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
function checked(value) {
  if (!value || !validId(value.accountId) || !validId(value.sessionId) || !Array.isArray(value.roleIds) || !Array.from(value.roleIds).every(validId)) fail('UNVERIFIED_CONTEXT');
  return Object.freeze({accountId:value.accountId,sessionId:value.sessionId,roleIds:Object.freeze([...new Set(value.roleIds)])});
}
export function createRoomSession({verifyContext,createLifetime,spec,rules}={}) {
  if (typeof verifyContext!=='function' || typeof createLifetime!=='function') fail('INVALID_SESSION_ADAPTER');
  let status='idle', context=null, lifetime=null, pending=null;
  function dispose() {
    if(status==='disposed') return;
    status='disposed';context=null;
    pending?.controller.abort();
    const old=lifetime;lifetime=null;old?.dispose();
  }
  function getContext() {
    if(status!=='ready' || !context) fail(status==='disposed'?'ROOM_DISPOSED':'SESSION_NOT_READY');
    return context;
  }
  function refresh() {
    if(status==='disposed') return Promise.reject(new Error('ROOM_DISPOSED'));
    if(pending) return pending.promise;
    const previous=context;
    status='verifying';
    const controller=new AbortController(), job={controller,promise:null};
    pending=job;
    job.promise=Promise.resolve().then(async()=>{
      try {
        if(status==='disposed') fail('ROOM_DISPOSED');
        const next=checked(await verifyContext({signal:controller.signal}));
        if(status==='disposed'||controller.signal.aborted) fail('ROOM_DISPOSED');
        if(previous&&(previous.accountId!==next.accountId||previous.sessionId!==next.sessionId)) fail('SCOPE_CHANGED');
        context=next;status='ready';
        if(!lifetime) lifetime=createLifetime({getContext,spec,rules});
        if(status==='disposed') {const old=lifetime;lifetime=null;old?.dispose();fail('ROOM_DISPOSED');}
        return true;
      } catch(error) {dispose();throw error;}
      finally {if(pending===job) pending=null;}
    });
    return job.promise;
  }
  function active() {getContext();if(!lifetime) fail('SESSION_NOT_READY');return lifetime;}
  function bind(callback) {return payload=>{active();return callback(payload);};}
  return Object.freeze({
    refresh,dispose,status:()=>status,
    viewUser:()=>active().viewUser(),
    prepareUserAction:()=>bind(active().prepareUserAction()),
    prepareRoleMove:roleId=>bind(active().prepareRoleMove(roleId))
  });
}
