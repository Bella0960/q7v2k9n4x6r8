// Read-only preflight for the future authenticated tabletop page. No storage or
// authentication implementation here. The caller must supply a verified scoped
// roster reader; never substitute the legacy unscoped character list.
const fail = code => { throw new Error(code); };
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
function scopeSnapshot(readScope) {
  const s = readScope();
  if (!s || s.ready !== true || !/^MAO-[A-Z0-9]{12,24}$/.test(s.accountId) ||
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
    const response=await request(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{accept:'application/json','x-mao-account-context':initial.accountId}});
    check();
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
      !Array.isArray(roster.roleIds) || !roster.roleIds.every(validId)) fail('ROSTER_UNVERIFIED');
  const roleIds=Object.freeze([...new Set(roster.roleIds)]);
  // Detect observable login changes across the asynchronous roster read.
  await account();
  if (await session()!==sessionId) fail('SESSION_CHANGED');
  check();
  return Object.freeze({accountId:initial.accountId,sessionId,roleIds});
}
