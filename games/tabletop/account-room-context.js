// Read-only preflight for the future authenticated tabletop page. No storage or
// authentication implementation here. The caller must supply a verified scoped
// roster reader; never substitute the legacy unscoped character list.
const fail = code => { throw new Error(code); };
export class RoomVerificationUnavailable extends Error {
  constructor() { super('ACCOUNT_TEMPORARILY_UNAVAILABLE'); }
}
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
function scopeSnapshot(readScope) {
  const s = readScope();
  if (!s || s.ready !== true || typeof s.accountId !== 'string' || !/^MAO-[A-Z0-9]{12,24}$/.test(s.accountId) ||
      s.pageAccountId !== s.accountId || !['user','super_admin'].includes(s.role)) fail('ACCOUNT_SCOPE_UNREADY');
  return {accountId:s.accountId,role:s.role};
}
export async function verifyRoomContext({request,readScope,readScopedRoster,signal}={}) {
  if (![request,readScope,readScopedRoster].every(f=>typeof f==='function')) fail('INVALID_CONTEXT_ADAPTER');
  const initial = scopeSnapshot(readScope);
  function check() {
    if (signal?.aborted) fail('CONTEXT_CANCELLED');
    const s=scopeSnapshot(readScope);
    if (s.accountId!==initial.accountId || s.role!==initial.role) fail('ACCOUNT_SCOPE_CHANGED');
  }
  async function get(path) {
    check();
    let response;
    try {
      response=await request(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{accept:'application/json','x-mao-account-context':initial.accountId}});
    } catch (error) {
      check();
      if(error instanceof TypeError) throw new RoomVerificationUnavailable();
      throw error;
    }
    check();
    if(response?.ok===false && (response.status===429 || (Number.isInteger(response.status)&&response.status>=500&&response.status<=599))) throw new RoomVerificationUnavailable();
    if (!response || response.ok!==true) fail('ACCOUNT_VERIFICATION_FAILED');
    const data=await response.json();check();return data;
  }
  async function account() {
    const a=(await get('/api/accounts/me'))?.account;
    if (!a || a.id!==initial.accountId || a.role!==initial.role || a.status!=='active') fail('ACCOUNT_VERIFICATION_FAILED');
  }
  async function session() {
    const id=(await get('/api/accounts/security'))?.currentSessionId;
    if (!validId(id)) fail('SESSION_UNVERIFIED');
    return id;
  }
  await account();
  const sessionId=await session();
  check();
  const roster=await readScopedRoster({accountId:initial.accountId,sessionId});
  check();
  if (!roster || roster.accountId!==initial.accountId || roster.sessionId!==sessionId ||
      !Array.isArray(roster.roleIds) || !Array.from(roster.roleIds).every(validId)) fail('ROSTER_UNVERIFIED');
  const roleIds=Object.freeze([...new Set(roster.roleIds)]);
  // Detect observable login changes across the asynchronous roster read.
  await account();
  if (await session()!==sessionId) fail('SESSION_CHANGED');
  check();
  return Object.freeze({accountId:initial.accountId,sessionId,roleIds});
}

// Browser contract from the released QA scope. Not auto-installed or enabled:
// the page must load the authenticated Worker-injected scope before PhoneStorage.
export function createBrowserRoomVerifier(win=globalThis.window,{includeRoleLabels=false}={}) {
  function readScope() {
    const s=win?.__MAO_ACCOUNT_SCOPE__;
    const pageAccountId=win?.document?.querySelector('meta[name="mao-account-id"]')?.content;
    const pageRole=win?.document?.querySelector('meta[name="mao-account-role"]')?.content;
    if (!s || s.role!==pageRole) return null;
    return {ready:s.ready,accountId:s.accountId,pageAccountId,role:s.role};
  }
  function readScopedRoster({accountId,sessionId}) {
    const before=scopeSnapshot(readScope);
    if(before.accountId!==accountId) fail('ACCOUNT_SCOPE_CHANGED');
    const storage=win?.PhoneStorage?.result;
    if(typeof storage?.getCharacters!=='function') fail('ROSTER_UNVERIFIED');
    const result=storage.getCharacters();
    const after=scopeSnapshot(readScope);
    if(after.accountId!==before.accountId || after.role!==before.role) fail('ACCOUNT_SCOPE_CHANGED');
    if(result?.ok===false && result.error?.code==='NOT_FOUND') return {accountId,sessionId,roleIds:[],roleLabels:[]};
    if(result?.ok!==true || result.meta?.source!=='ai_custom_characters' || !Array.isArray(result.value)) fail('ROSTER_UNVERIFIED');
    const roleIds=Array.from(result.value,role=>role?.id);
    if(!roleIds.every(validId)) fail('ROSTER_UNVERIFIED');
    const roleLabels=includeRoleLabels?Array.from(result.value,role=>Object.freeze({id:role.id,name:typeof role.name==='string'&&role.name.trim()?role.name.trim().slice(0,80):'未命名角色'})):[];
    if(includeRoleLabels&&new Set(roleIds).size!==roleIds.length) fail('ROSTER_UNVERIFIED');
    return {accountId,sessionId,roleIds,roleLabels};
  }
  return async ({signal}={})=>{
    const initial=scopeSnapshot(readScope);
    if(signal?.aborted) fail('CONTEXT_CANCELLED');
    // Bound the entire browser preflight (including response-body reads).
    // Race cancellation as well as aborting fetch, so an adapter ignoring
    // AbortSignal cannot keep the room locked or publish a late context.
    const controller=new AbortController();
    let timer,cancel;
    const deadline=new Promise((_,reject)=>{
      const stop=error=>{reject(error);controller.abort();};
      cancel=()=>stop(new Error('CONTEXT_CANCELLED'));
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{
        try {
          const current=scopeSnapshot(readScope);
          if(current.accountId!==initial.accountId || current.role!==initial.role) fail('ACCOUNT_SCOPE_CHANGED');
          stop(new RoomVerificationUnavailable());
        } catch(error) {stop(error);}
      },15000);
    });
    async function verify() {
      const context=await verifyRoomContext({request:(path,options)=>win.fetch(path,options),readScope,readScopedRoster,signal:controller.signal});
      // Same-document storage changes do not emit storage events. Re-read the
      // synchronous scoped roster after the final network response, not before it.
      if(controller.signal.aborted) fail('CONTEXT_CANCELLED');
      const current=scopeSnapshot(readScope);
      if(current.accountId!==initial.accountId || current.role!==initial.role) fail('ACCOUNT_SCOPE_CHANGED');
      const latestRoster=readScopedRoster(context),latest=new Set(latestRoster.roleIds);
      if(latest.size!==context.roleIds.length || context.roleIds.some(id=>!latest.has(id))) fail('ROSTER_CHANGED');
      if(controller.signal.aborted) fail('CONTEXT_CANCELLED');
      return includeRoleLabels?Object.freeze({...context,roleLabels:Object.freeze(latestRoster.roleLabels)}):context;
    }
    try {return await Promise.race([verify(),deadline]);}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  };
}
