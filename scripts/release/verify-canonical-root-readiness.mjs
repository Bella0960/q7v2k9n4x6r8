/**
 * Read-only canonical MAOMAO release gate.
 *
 * The paid mao520.com root IS the official app and already owns live accounts.
 * The historical Worker name "mao-auth-preview" is NOT authorization to
 * replace its existing CloudDatabase or force users into a new account store.
 * app.mao520.com is the sole isolated trial, never the public production
 * authority. No account rows, session tokens, salts or password hashes leave
 * Cloudflare: the DO queries below return only aggregate counts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_HOST = 'mao520.com';
export const ROOT_WORKER = 'mao-auth-preview';
export const TRIAL_HOST = 'app.mao520.com';
export const TRIAL_EDGE_WORKER = 'curly-dream-324c';
export const QA_WORKER = 'maomao-aw-qa-20261114';
// Pin actual, inspected production and trial namespaces; no implicit migration.
export const ROOT_NAMESPACE_ID = 'de73581323904befa8640be3f63db9b0';
export const QA_NAMESPACE_ID = '4a24ce58079f468c87c2f75e107c4d1c';
export const FOUNDER_ID = /^MAO-[A-Z0-9]{12,24}$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const BACKUP_AUDIT_NAMESPACE = '54544f9f1ce54220957d8fc9c49ccc7c';

function binding(version, name) {
  return (Array.isArray(version?.bindings) ? version.bindings : []).find(b => b?.name === name);
}
function oneDomain(domains, hostname, service) {
  const records=(Array.isArray(domains)?domains:[]).filter(d=>d?.hostname===hostname);
  return records.length===1 && records[0]?.enabled===true &&
    records[0]?.environment==='production' && records[0]?.service===service;
}
const validCount=n=>Number.isSafeInteger(n)&&n>=0;

export function auditCanonicalRootReadiness(input) {
  const blocked=[];
  const { domains, rootVersion, trialVersion, qaVersion, rootCounts, qaCounts,
    expectedFounderId, backupReceipt, restoreReceipt, status }=input||{};
  if(!FOUNDER_ID.test(expectedFounderId||''))blocked.push('EXPECTED_FOUNDER_UNAVAILABLE');
  if(!oneDomain(domains,ROOT_HOST,ROOT_WORKER))blocked.push('ROOT_DOMAIN_NOT_CANONICAL');
  if(!oneDomain(domains,TRIAL_HOST,TRIAL_EDGE_WORKER))blocked.push('TRIAL_DOMAIN_NOT_ISOLATED');

  const rootDb=binding(rootVersion,'CLOUD_DB');
  const qaDb=binding(qaVersion,'CLOUD_DB');
  if(rootVersion?.main_module!=='worker.js' ||
      binding(rootVersion,'ASSETS')?.type!=='assets' ||
      rootDb?.type!=='durable_object_namespace' ||
      rootDb?.class_name!=='CloudDatabase' || rootDb?.namespace_id!==ROOT_NAMESPACE_ID ||
      rootDb?.script_name ||
      !rootVersion?.compatibility_flags?.includes('nodejs_compat') ||
      !['DEVICE_SECRET_PEPPER','MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'].every(n=>binding(rootVersion,n)?.type==='secret_text')) {
    blocked.push('ROOT_WORKER_OR_ACCOUNT_STORAGE_UNVERIFIED');
  }
  if(qaVersion?.main_module!=='worker.js' ||
      qaDb?.type!=='durable_object_namespace' || qaDb?.namespace_id!==QA_NAMESPACE_ID ||
      qaDb?.class_name!=='CloudDatabase' || qaDb?.script_name ||
      qaDb.namespace_id===rootDb?.namespace_id) {
    blocked.push('QA_ACCOUNT_DATABASE_NOT_ISOLATED');
  }
  if(trialVersion?.main_module!=='worker-app-cutover.js' ||
      binding(trialVersion,'MAO_APP_BACKEND')?.type!=='service' ||
      binding(trialVersion,'MAO_APP_BACKEND')?.service!==QA_WORKER ||
      binding(trialVersion,'MAO_APP_CUTOVER_ENABLED')?.type!=='plain_text' ||
      !['false','true'].includes(binding(trialVersion,'MAO_APP_CUTOVER_ENABLED')?.text) ||
      (trialVersion?.bindings||[]).some(b=>b.type==='durable_object_namespace')) {
    blocked.push('TRIAL_WORKER_BINDING_UNVERIFIED');
  }

  if(!rootCounts || ![rootCounts.accounts,rootCounts.admins,rootCounts.members,
      rootCounts.chosenFounder,rootCounts.sessions,rootCounts.orphanSessions,
      rootCounts.verifiers].every(validCount) ||
      rootCounts.accounts!==rootCounts.admins+rootCounts.members ||
      rootCounts.verifiers!==rootCounts.accounts) {
    blocked.push('ROOT_ACCOUNT_INVENTORY_UNVERIFIED');
  } else {
    if(rootCounts.admins!==1 || rootCounts.chosenFounder!==1)
      blocked.push('FOUNDER_001_NOT_YET_AUTHORITATIVE');
    if(rootCounts.members<1) blocked.push('EXISTING_LIVE_MEMBER_MISSING');
    if(rootCounts.orphanSessions!==0) blocked.push('LIVE_SESSION_INTEGRITY_FAILED');
  }
  if(!qaCounts || !validCount(qaCounts.chosenFounder) || qaCounts.chosenFounder!==1)
    blocked.push('SELECTED_FOUNDER_QA_NOT_VERIFIED');
  if(status?.httpStatus!==200 || status?.body?.ok!==true ||
      status.body.initialized!==true || status.body.configured!==true)
    blocked.push('ROOT_SAME_ORIGIN_ACCOUNT_API_NOT_READY');

  // A failed or absent private checkpoint is never a backup. The rehearsal
  // receipt must come from an authorized, separately audited operator, not
  // from a browser, repo file, workflow variable or developer assertion.
  if(backupReceipt?.ok!==true || backupReceipt?.code!=='checkpoint_recorded' ||
      !Number.isSafeInteger(backupReceipt?.recordedAt))
    blocked.push('LIVE_PITR_CHECKPOINT_NOT_VERIFIED');
  if(restoreReceipt?.ok!==true || restoreReceipt?.code!=='isolated_restore_verified' ||
      !Number.isSafeInteger(restoreReceipt?.verifiedAt))
    blocked.push('INDEPENDENT_RECOVERY_REHEARSAL_NOT_VERIFIED');
  return Object.freeze({ready:blocked.length===0,blockers:Object.freeze(blocked)});
}

async function getJSON(url,token,{body}={}) {
  const resp=await fetch(url,{
    method:body?'POST':'GET',
    headers:{authorization:'Bearer '+token,accept:'application/json',
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)
  });
  if(!resp.ok)throw Error('CLOUDFLARE_READ_FAILED_'+resp.status);
  const payload=await resp.json();
  if(payload?.success!==true)throw Error('CLOUDFLARE_RESPONSE_REJECTED');
  return payload;
}
function activeVersionId(data) {
  const versions=data?.result?.deployments?.[0]?.versions;
  if(!Array.isArray(versions)||versions.length!==1||versions[0]?.percentage!==100||
    !/^[0-9a-f-]{36}$/i.test(versions[0]?.version_id||''))
    throw Error('DEPLOYED_VERSION_NOT_PINNED');
  return versions[0].version_id;
}
async function deployedVersion(base,worker,token) {
  const deployments=await getJSON(base+'/workers/scripts/'+worker+'/deployments?page=1&per_page=1',token);
  const id=activeVersionId(deployments);
  const v=await getJSON(base+'/workers/workers/'+worker+'/versions/'+id,token);
  if(v.result?.id!==id)throw Error('ACTIVE_VERSION_MISMATCH');
  return v.result;
}
async function safeAggregate(base,token,ns,founderId,isRoot) {
  if(!ns||!/^[0-9a-f]{32}$/.test(ns))throw Error('NAMESPACE_INVALID');
  const queries=isRoot?[
    {sql:"SELECT COUNT(*) AS accounts, COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END),0) AS admins, COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END),0) AS members, COALESCE(SUM(CASE WHEN id = ? AND role = 'super_admin' AND status = 'active' THEN 1 ELSE 0 END),0) AS founder, COALESCE(SUM(CASE WHEN length(password_salt)>0 AND length(password_hash)>0 THEN 1 ELSE 0 END),0) AS verifiers FROM mao_accounts",params:[founderId]},
    {sql:'SELECT COUNT(*) AS sessions FROM mao_account_sessions'},
    {sql:'SELECT COUNT(*) AS orphans FROM mao_account_sessions s WHERE NOT EXISTS (SELECT 1 FROM mao_accounts a WHERE a.id = s.account_id)'}
  ]:[
    {sql:"SELECT COUNT(*) AS chosen_founder FROM mao_accounts WHERE id=? AND role='super_admin' AND status='active'",params:[founderId]}
  ];
  const resp=await getJSON(base+'/workers/durable_objects/namespaces/'+ns+'/query/v2',token,{
    body:{durable_object_name:'maomao-global',jurisdiction:'none',queries}
  });
  const entries=resp.result?.results;
  if(!Array.isArray(entries)||entries.length!==queries.length ||
      entries.some(e=>e?.meta?.rows_written!==0 || !Array.isArray(e.rows)||e.rows.length!==1))
    throw Error('ACCOUNT_AGGREGATE_NOT_READ_ONLY');
  if(!isRoot)return {chosenFounder:entries[0].rows[0][0]};
  const [accounts,admins,members,chosenFounder,verifiers]=entries[0].rows[0];
  return {accounts,admins,members,chosenFounder,verifiers,
    sessions:entries[1].rows[0][0],orphanSessions:entries[2].rows[0][0]};
}
async function privateAudit(base,token,key) {
  const resp=await fetch(base+'/storage/kv/namespaces/'+BACKUP_AUDIT_NAMESPACE+
      '/values/'+encodeURIComponent(key),{
    headers:{authorization:'Bearer '+token},redirect:'error',
    cache:'no-store',signal:AbortSignal.timeout(10000)
  });
  if(resp.status===404)return null;
  if(!resp.ok)throw Error('RECOVERY_AUDIT_UNAVAILABLE');
  const data=await resp.json().catch(()=>null);
  return data&&typeof data==='object'?data:null;
}
export async function verifyOfficialRootReadiness(env=process.env) {
  const token=String(env.CLOUDFLARE_API_TOKEN||'');
  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'');
  const expectedFounderId=String(env.MAO_EXPECTED_FOUNDER_ID||'');
  const origin=String(env.MAOMAO_PRODUCTION_ORIGIN||'');
  if(!ACCOUNT_ID.test(accountId)||!token||!FOUNDER_ID.test(expectedFounderId)||
      origin!=='https://mao520.com')throw Error('OFFICIAL_RELEASE_INPUTS_INVALID');
  const base='https://api.cloudflare.com/client/v4/accounts/'+accountId;
  const [domainsResponse,rootVersion,trialVersion,qaVersion,backupReceipt,restoreReceipt]=await Promise.all([
    getJSON(base+'/workers/domains',token),
    deployedVersion(base,ROOT_WORKER,token),
    deployedVersion(base,TRIAL_EDGE_WORKER,token),
    deployedVersion(base,QA_WORKER,token),
    privateAudit(base,token,'founder-checkpoint:success'),
    privateAudit(base,token,'founder-recovery:isolated-restore-success')
  ]);
  const rootNs=binding(rootVersion,'CLOUD_DB')?.namespace_id;
  const qaNs=binding(qaVersion,'CLOUD_DB')?.namespace_id;
  const [rootCounts,qaCounts,statusResp]=await Promise.all([
    safeAggregate(base,token,rootNs,expectedFounderId,true),
    safeAggregate(base,token,qaNs,expectedFounderId,false),
    fetch(origin+'/api/admin/bootstrap/status',{
      headers:{accept:'application/json','cache-control':'no-store'},
      cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)
    })
  ]);
  const status={httpStatus:statusResp.status,body:statusResp.status===200?
    await statusResp.json().catch(()=>null):null};
  const result=auditCanonicalRootReadiness({
    domains:domainsResponse.result,rootVersion,trialVersion,qaVersion,
    rootCounts,qaCounts,expectedFounderId,backupReceipt,restoreReceipt,status
  });
  if(!result.ready)throw Error('OFFICIAL_ROOT_RELEASE_BLOCKED:'+result.blockers.join(','));
  console.log('PASS: original paid root account authority; isolated QA and independently recoverable 001');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verifyOfficialRootReadiness().catch(e=>{
    console.error(String(e?.message||'OFFICIAL_ROOT_RELEASE_UNAVAILABLE'));
    process.exitCode=1;
  });
}
