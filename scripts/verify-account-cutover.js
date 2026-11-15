/**
 * MAOMAO single-authority production cutover evidence gate.
 *
 * mao520.com is the only official product and its original account database
 * must remain authoritative. app.mao520.com is the ONE separate trial site.
 * No duplicate "permanent" identity database, user import or QA promotion is
 * acceptable as a substitute for the original live account continuity.
 *
 * This pure validator is necessary, NOT sufficient to authorize a deployment.
 * Trusted release operators must provide evidence from real read-only
 * inventory, a separately recoverable live checkpoint and real-device tests.
 * Browser-provided booleans, client localStorage and GitHub text are NOT proof.
 */
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^MAO-[A-Z0-9]{12,24}$/.test(value);

export function auditAccountCutover(evidence, expectedFounderId) {
  const failures = [];
  const official = evidence?.productionAccountStore;
  const qa = evidence?.qaAccountStore;
  const prodDomain = evidence?.productionDomain;
  const trialDomain = evidence?.trialDomain;

  if (!validId(expectedFounderId)) failures.push('EXPECTED_FOUNDER_ID_UNAVAILABLE');
  if (!official || !isCount(official.count) || !isCount(official.superAdmins)) {
    failures.push('PRODUCTION_COUNTS_NOT_VERIFIED');
  } else {
    if (official.count === 0) failures.push('PRODUCTION_HAS_NO_ACCOUNTS');
    if (official.superAdmins !== 1) failures.push('PRODUCTION_NOT_EXACTLY_ONE_ADMIN');
    if (official.canonicalFounderId !== expectedFounderId ||
        official.canonicalFounderRole !== 'super_admin' ||
        official.canonicalFounderStatus !== 'active') {
      failures.push('PRODUCTION_FOUNDER_ID_NOT_VERIFIED');
    }
  }
  if (!qa || !isCount(qa.count) ||
      qa.canonicalFounderId !== expectedFounderId ||
      qa.canonicalFounderRole !== 'super_admin' ||
      qa.canonicalFounderStatus !== 'active') {
    failures.push('ORIGINAL_QA_FOUNDER_CONTINUITY_UNVERIFIED');
  }

  if (!prodDomain || prodDomain.host !== 'mao520.com' ||
      prodDomain.authorityWorker !== 'mao-auth-preview' ||
      prodDomain.sameOriginAccountApiVerified !== true ||
      prodDomain.privateHtmlGated !== true ||
      prodDomain.activeAccountAuthorityMatches !== true) {
    failures.push('PRODUCTION_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED');
  }
  if (!trialDomain || trialDomain.host !== 'app.mao520.com' ||
      trialDomain.isolatedQaWorker !== 'maomao-aw-qa-20261114' ||
      trialDomain.databaseIsolated !== true ||
      trialDomain.productionDataAccess === true) {
    failures.push('TRIAL_DOMAIN_ISOLATION_NOT_VERIFIED');
  }

  if (evidence?.existingMembersPreserved !== true)
    failures.push('ORIGINAL_MEMBER_CONTINUITY_NOT_VERIFIED');
  if (evidence?.passwordAndOldSessionsContinuityVerified !== true)
    failures.push('ORIGINAL_LOGIN_CONTINUITY_NOT_VERIFIED');
  if (evidence?.twoAccountIsolationVerified !== true)
    failures.push('CROSS_ACCOUNT_ISOLATION_NOT_VERIFIED');
  if (evidence?.rollbackVerified !== true)
    failures.push('PRODUCTION_ROLLBACK_NOT_VERIFIED');
  if (evidence?.recoverableAccountBackupVerified !== true)
    failures.push('ACCOUNT_RECOVERY_BACKUP_NOT_VERIFIED');
  if (evidence?.androidDeviceVerified !== true || evidence?.iphoneDeviceVerified !== true)
    failures.push('ANDROID_AND_IPHONE_REAL_DEVICE_NOT_VERIFIED');

  return Object.freeze({ ready: failures.length === 0, blockers: Object.freeze(failures) });
}
