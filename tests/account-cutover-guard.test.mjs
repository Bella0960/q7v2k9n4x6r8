import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAccountCutover } from '../scripts/verify-account-cutover.js';

const F='MAO-SYNTHFOUNDER001';
function readyEvidence() {
  return {
    productionAccountStore:{count:2,superAdmins:1,canonicalFounderId:F,canonicalFounderRole:'super_admin',canonicalFounderStatus:'active'},
    qaAccountStore:{count:1,canonicalFounderId:F,canonicalFounderRole:'super_admin',canonicalFounderStatus:'active'},
    permanentIdentityStore:{count:1,nonPreview:true,canonicalFounderId:F,canonicalFounderStatus:'active'},
    appDomain:{host:'app.mao520.com',sameOriginAccountApiVerified:true,privateHtmlGated:true,activeAccountAuthorityMatches:true},
    passwordAndOldSessionsContinuityVerified:true,
    twoAccountIsolationVerified:true,
    rollbackVerified:true,recoverableAccountBackupVerified:true,
    androidDeviceVerified:true,iphoneDeviceVerified:true
  };
}
test('no production founder and empty permanent identity cannot be mistaken for an accepted QA login',()=>{
  const s=readyEvidence();
  s.productionAccountStore={count:0,superAdmins:0,canonicalFounderId:null};
  s.permanentIdentityStore={count:0,nonPreview:true,canonicalFounderId:null};
  s.appDomain={host:'app.mao520.com',sameOriginAccountApiVerified:false,privateHtmlGated:false};
  s.recoverableAccountBackupVerified=false;
  const result=auditAccountCutover(s,F);
  for(const block of ['PRODUCTION_HAS_NO_ACCOUNTS','PRODUCTION_NOT_EXACTLY_ONE_ADMIN',
    'PRODUCTION_FOUNDER_ID_NOT_VERIFIED','PERMANENT_IDENTITY_AUTHORITY_NOT_READY',
    'APP_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED','ACCOUNT_RECOVERY_BACKUP_NOT_VERIFIED'])
    assert.ok(result.blockers.includes(block),block);
  assert.equal(result.ready,false);
});
test('a second administrator or mismatching permanent ID always blocks a production cutover',()=>{
  for(const conflict of [
    s=>{s.productionAccountStore.superAdmins=2},
    s=>{s.productionAccountStore.canonicalFounderId='MAO-OTHERSYNTHETIC01'},
    s=>{s.productionAccountStore.canonicalFounderStatus='disabled'},
    s=>{s.permanentIdentityStore.canonicalFounderId='MAO-OTHERSYNTHETIC01'},
  ]) {
    const evidence=readyEvidence();conflict(evidence);
    assert.equal(auditAccountCutover(evidence,F).ready,false);
  }
});
test('unverified rollback, private-page session, backups or real iPhone each block cutover',()=>{
  for(const key of ['passwordAndOldSessionsContinuityVerified','twoAccountIsolationVerified',
    'rollbackVerified','recoverableAccountBackupVerified','androidDeviceVerified','iphoneDeviceVerified']) {
    const e=readyEvidence();e[key]=false;
    assert.equal(auditAccountCutover(e,F).ready,false,key);
  }
  const e=readyEvidence();e.appDomain.sameOriginAccountApiVerified=false;
  assert.ok(auditAccountCutover(e,F).blockers.includes('APP_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED'));
  // Lack of trusted evidence for the active account authority must fail closed.
  for (const value of [undefined, null, false, 'true']) {
    const unknown = readyEvidence();
    if (value === undefined) delete unknown.appDomain.activeAccountAuthorityMatches;
    else unknown.appDomain.activeAccountAuthorityMatches = value;
    assert.ok(
      auditAccountCutover(unknown,F).blockers.includes('APP_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED'),
      'identity-authority evidence: ' + String(value)
    );
  }
});
test('only complete trusted evidence with one canonical founder passes',()=>{
  assert.deepEqual(auditAccountCutover(readyEvidence(),F),{ready:true,blockers:[]});
});
test('missing or malformed evidence fails closed and never exposes credentials',()=>{
  assert.equal(auditAccountCutover(null,F).ready,false);
  assert.equal(auditAccountCutover(readyEvidence(),'not an ID').ready,false);
  const e=readyEvidence();e.productionAccountStore.count=NaN;
  assert.ok(auditAccountCutover(e,F).blockers.includes('PRODUCTION_COUNTS_NOT_VERIFIED'));
});
