import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAccountCutover } from '../scripts/verify-account-cutover.js';

const F = 'MAO-SYNTHFOUNDER001';

function readyEvidence() {
  return {
    productionAccountStore: {
      count: 2, superAdmins: 1, canonicalFounderId: F,
      canonicalFounderRole: 'super_admin', canonicalFounderStatus: 'active'
    },
    qaAccountStore: {
      count: 1, canonicalFounderId: F,
      canonicalFounderRole: 'super_admin', canonicalFounderStatus: 'active'
    },
    productionDomain: {
      host: 'mao520.com', authorityWorker: 'mao-auth-preview',
      sameOriginAccountApiVerified: true, privateHtmlGated: true,
      activeAccountAuthorityMatches: true
    },
    trialDomain: {
      host: 'app.mao520.com', isolatedQaWorker: 'maomao-aw-qa-20261114',
      databaseIsolated: true, productionDataAccess: false
    },
    existingMembersPreserved: true,
    passwordAndOldSessionsContinuityVerified: true,
    twoAccountIsolationVerified: true,
    rollbackVerified: true,
    recoverableAccountBackupVerified: true,
    androidDeviceVerified: true,
    iphoneDeviceVerified: true
  };
}

test('empty production or QA-only founder cannot qualify as official release', () => {
  const e = readyEvidence();
  e.productionAccountStore = { count: 0, superAdmins: 0, canonicalFounderId: null };
  e.recoverableAccountBackupVerified = false;
  const result = auditAccountCutover(e, F);
  assert.equal(result.ready, false);
  for (const code of [
    'PRODUCTION_HAS_NO_ACCOUNTS',
    'PRODUCTION_NOT_EXACTLY_ONE_ADMIN',
    'PRODUCTION_FOUNDER_ID_NOT_VERIFIED',
    'ACCOUNT_RECOVERY_BACKUP_NOT_VERIFIED'
  ]) assert.ok(result.blockers.includes(code), code);
});

test('only mao520.com on ORIGINAL live account Worker can qualify as production', () => {
  for (const [host, worker] of [
    ['app.mao520.com', 'mao-auth-preview'],
    ['mao520.com', 'mao'],
    ['mao520.com', 'maomao-aw-qa-20261114'],
    ['mao520.com', 'maomao-identity-core']
  ]) {
    const e = readyEvidence();
    e.productionDomain.host = host;
    e.productionDomain.authorityWorker = worker;
    assert.ok(auditAccountCutover(e, F).blockers.includes(
      'PRODUCTION_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED'
    ), host + ' -> ' + worker);
  }
});

test('app.mao520.com must remain the ONE isolated QA, never the original live store', () => {
  const changes = [
    e => { e.trialDomain.host = 'preview.mao520.com'; },
    e => { e.trialDomain.isolatedQaWorker = 'mao-auth-preview'; },
    e => { e.trialDomain.isolatedQaWorker = 'mao'; },
    e => { e.trialDomain.databaseIsolated = false; },
    e => { e.trialDomain.productionDataAccess = true; }
  ];
  for (const change of changes) {
    const e = readyEvidence();
    change(e);
    assert.ok(auditAccountCutover(e, F).blockers.includes(
      'TRIAL_DOMAIN_ISOLATION_NOT_VERIFIED'
    ));
  }
});

test('two founders, wrong permanent ID or disabled founder block official release', () => {
  const changes = [
    e => { e.productionAccountStore.superAdmins = 2; },
    e => { e.productionAccountStore.canonicalFounderId = 'MAO-OTHERTEST00001'; },
    e => { e.productionAccountStore.canonicalFounderStatus = 'disabled'; },
    e => { e.qaAccountStore.canonicalFounderId = 'MAO-OTHERTEST00001'; },
    e => { e.productionDomain.activeAccountAuthorityMatches = false; }
  ];
  for (const change of changes) {
    const e = readyEvidence();
    change(e);
    assert.equal(auditAccountCutover(e, F).ready, false);
  }
});

test('real recoverable checkpoint, member/session continuity and phones are mandatory', () => {
  for (const field of [
    'existingMembersPreserved',
    'passwordAndOldSessionsContinuityVerified',
    'twoAccountIsolationVerified',
    'rollbackVerified',
    'recoverableAccountBackupVerified',
    'androidDeviceVerified',
    'iphoneDeviceVerified'
  ]) {
    const e = readyEvidence();
    e[field] = false;
    assert.equal(auditAccountCutover(e, F).ready, false, field);
  }
});

test('only complete trusted evidence passes pure validator (not a deployment approval)', () => {
  assert.deepEqual(auditAccountCutover(readyEvidence(), F), { ready: true, blockers: [] });
  assert.equal(auditAccountCutover(null, F).ready, false);
  assert.equal(auditAccountCutover(readyEvidence(), 'invalid').ready, false);
  const e = readyEvidence();
  e.productionAccountStore.count = Number.NaN;
  assert.ok(auditAccountCutover(e, F).blockers.includes('PRODUCTION_COUNTS_NOT_VERIFIED'));
});
