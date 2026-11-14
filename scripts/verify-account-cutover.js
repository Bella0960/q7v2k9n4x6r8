/**
 * Pure, read-only MAOMAO account cutover safety gate.
 *
 * Evidence must come from trusted Cloudflare read-only queries, not browser
 * claims or a static GitHub config. No credentials, tokens, SQL rows or
 * password hashes are accepted or written here.
 */
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^MAO-[A-Z0-9]{12,24}$/.test(value);
export function auditAccountCutover(evidence, expectedFounderId) {
  const failures = [];
  const p=evidence?.productionAccountStore;
  const q=evidence?.qaAccountStore;
  const a=evidence?.permanentIdentityStore;
  const route=evidence?.appDomain;
  if (!validId(expectedFounderId)) failures.push('EXPECTED_FOUNDER_ID_UNAVAILABLE');
  if (!p || !isCount(p.count) || !isCount(p.superAdmins)) {
    failures.push('PRODUCTION_COUNTS_NOT_VERIFIED');
  } else {
    if (p.count===0) failures.push('PRODUCTION_HAS_NO_ACCOUNTS');
    if (p.superAdmins!==1) failures.push('PRODUCTION_NOT_EXACTLY_ONE_ADMIN');
    if (p.canonicalFounderId!==expectedFounderId ||
        p.canonicalFounderRole!=='super_admin' ||
        p.canonicalFounderStatus!=='active')
      failures.push('PRODUCTION_FOUNDER_ID_NOT_VERIFIED');
  }
  if (!q || !isCount(q.count) || q.canonicalFounderId!==expectedFounderId ||
      q.canonicalFounderRole!=='super_admin' || q.canonicalFounderStatus!=='active') {
    failures.push('ORIGINAL_QA_FOUNDER_CONTINUITY_UNVERIFIED');
  }
  if (!a || !a.nonPreview || !isCount(a.count) || a.count<1 ||
      a.canonicalFounderId!==expectedFounderId ||
      a.canonicalFounderStatus!=='active') {
    failures.push('PERMANENT_IDENTITY_AUTHORITY_NOT_READY');
  }
  if (!route || route.host!=='app.mao520.com' ||
      route.sameOriginAccountApiVerified!==true ||
      route.privateHtmlGated!==true ||
      route.activeAccountAuthorityMatches!==true) {
    failures.push('APP_DOMAIN_SAME_ORIGIN_AUTH_NOT_VERIFIED');
  }
  if (evidence?.passwordAndOldSessionsContinuityVerified!==true)
    failures.push('ORIGINAL_LOGIN_CONTINUITY_NOT_VERIFIED');
  if (evidence?.twoAccountIsolationVerified!==true)
    failures.push('CROSS_ACCOUNT_ISOLATION_NOT_VERIFIED');
  if (evidence?.rollbackVerified!==true)
    failures.push('PRODUCTION_ROLLBACK_NOT_VERIFIED');
  if (evidence?.recoverableAccountBackupVerified!==true)
    failures.push('ACCOUNT_RECOVERY_BACKUP_NOT_VERIFIED');
  // Chromium / WebKit simulation cannot be marked as actual Android/iPhone hardware.
  if (evidence?.androidDeviceVerified!==true || evidence?.iphoneDeviceVerified!==true)
    failures.push('ANDROID_AND_IPHONE_REAL_DEVICE_NOT_VERIFIED');
  return Object.freeze({ ready: failures.length === 0, blockers: Object.freeze(failures) });
}
