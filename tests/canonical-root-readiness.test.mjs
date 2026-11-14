import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCanonicalRootReadiness, ROOT_HOST, ROOT_WORKER,
  TRIAL_HOST, TRIAL_EDGE_WORKER, QA_WORKER
} from '../scripts/release/verify-canonical-root-readiness.mjs';

const chosen='MAO-SYNTHFOUNDER001';
const liveNs='a'.repeat(32), qaNs='b'.repeat(32);
const rootBindings=[
  {name:'ASSETS',type:'assets'},
  {name:'CLOUD_DB',type:'durable_object_namespace',
    class_name:'CloudDatabase',namespace_id:liveNs},
  {name:'DEVICE_SECRET_PEPPER',type:'secret_text'},
  {name:'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET',type:'secret_text'}
];
function fixtures() {
 return {
  expectedFounderId:chosen,
  domains:[
    {hostname:ROOT_HOST,service:ROOT_WORKER,environment:'production',enabled:true},
    {hostname:TRIAL_HOST,service:TRIAL_EDGE_WORKER,environment:'production',enabled:true}
  ],
  rootVersion:{main_module:'worker.js',compatibility_flags:['nodejs_compat'],bindings:rootBindings.map(x=>({...x}))},
  qaVersion:{main_module:'worker.js',bindings:[
    {name:'CLOUD_DB',type:'durable_object_namespace',class_name:'CloudDatabase',namespace_id:qaNs}
  ]},
  trialVersion:{main_module:'worker-app-cutover.js',bindings:[
    {name:'ASSETS',type:'assets'},
    {name:'MAO_APP_BACKEND',type:'service',service:QA_WORKER},
    {name:'MAO_APP_CUTOVER_ENABLED',type:'plain_text',text:'false'}
  ]},
  rootCounts:{accounts:2,admins:1,members:1,chosenFounder:1,verifiers:2,sessions:3,orphanSessions:0},
  qaCounts:{chosenFounder:1},
  status:{httpStatus:200,body:{ok:true,initialized:true,configured:true}},
  backupReceipt:{ok:true,code:'checkpoint_recorded',recordedAt:1794651180341},
  restoreReceipt:{ok:true,code:'isolated_restore_verified',verifiedAt:1794651180341}
 };
}
test('canonical root readiness is a strict all-evidence predicate, not a deploy command',()=>{
 assert.deepEqual(auditCanonicalRootReadiness(fixtures()),{ready:true,blockers:[]});
});
test('app.mao520.com or another Worker can never masquerade as official root',()=>{
 for(const [host,worker] of [
  ['app.mao520.com','mao-auth-preview'],
  ['mao520.com','mao'],
  ['mao520.com','maomao-aw-qa-20261114'],
  ['example.com','mao-auth-preview']
 ]) {
  const x=fixtures();x.domains[0].hostname=host;x.domains[0].service=worker;
  assert.ok(auditCanonicalRootReadiness(x).blockers.includes('ROOT_DOMAIN_NOT_CANONICAL'));
 }
});
test('QA never shares the live database or obtains a direct root DB binding',()=>{
 const x=fixtures();x.qaVersion.bindings[0].namespace_id=liveNs;
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('QA_ACCOUNT_DATABASE_NOT_ISOLATED'));
 const y=fixtures();y.trialVersion.bindings.push({name:'CLOUD_DB',type:'durable_object_namespace',namespace_id:liveNs});
 assert.ok(auditCanonicalRootReadiness(y).blockers.includes('TRIAL_WORKER_BINDING_UNVERIFIED'));
});
test('trial switch OFF is acceptable, but any different backend is not',()=>{
 const x=fixtures();x.trialVersion.bindings[1].service='mao';
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('TRIAL_WORKER_BINDING_UNVERIFIED'));
 const y=fixtures();y.trialVersion.bindings[2].text='true';
 assert.equal(auditCanonicalRootReadiness(y).ready,true);
});
test('QA founder alone must not authorize production before root 001 exists',()=>{
 const x=fixtures();x.rootCounts.chosenFounder=0;
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('FOUNDER_001_NOT_YET_AUTHORITATIVE'));
});
test('existing users, verifiers and session integrity must all survive',()=>{
 const x=fixtures();x.rootCounts.members=0;x.rootCounts.accounts=1;x.rootCounts.verifiers=0;x.rootCounts.orphanSessions=1;
 const a=auditCanonicalRootReadiness(x);
 for(const code of ['ROOT_ACCOUNT_INVENTORY_UNVERIFIED','EXISTING_LIVE_MEMBER_MISSING','LIVE_SESSION_INTEGRITY_FAILED'])
  assert.ok(a.blockers.includes(code),code);
});
test('missing PITR success and independent restore must always block release',()=>{
 const x=fixtures();x.backupReceipt={ok:false,code:'invalid_acknowledgement'};
 x.restoreReceipt=null;
 const a=auditCanonicalRootReadiness(x);
 assert.ok(a.blockers.includes('LIVE_PITR_CHECKPOINT_NOT_VERIFIED'));
 assert.ok(a.blockers.includes('INDEPENDENT_RECOVERY_REHEARSAL_NOT_VERIFIED'));
});
test('wrong hostname, missing private HTML protections or public login 404 fail closed',()=>{
 const x=fixtures();x.status.httpStatus=404;
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('ROOT_SAME_ORIGIN_ACCOUNT_API_NOT_READY'));
 x.status.httpStatus=200;x.status.body.ok=false;
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('ROOT_SAME_ORIGIN_ACCOUNT_API_NOT_READY'));
});
test('secret names and original account namespaces are required; secret values are never inputs',()=>{
 const x=fixtures();x.rootVersion.bindings=x.rootVersion.bindings.filter(b=>b.name!=='DEVICE_SECRET_PEPPER');
 assert.ok(auditCanonicalRootReadiness(x).blockers.includes('ROOT_WORKER_OR_ACCOUNT_STORAGE_UNVERIFIED'));
});
