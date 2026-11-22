/**
 * Decide whether a tested QA-only release candidate is safe to publish.
 * This function does not grant permission to deploy: checkout, build, tests,
 * account isolation and Cloudflare gates remain mandatory elsewhere.
 */
export function evaluateQaSnapshot({ candidateSha, remoteSha, allowPinned = false, remoteDescendsFromCandidate = false }) {
  const gitSha = /^[0-9a-f]{40}$/;
  if (!gitSha.test(candidateSha || '') || !gitSha.test(remoteSha || '')) {
    throw new Error('QA candidate and remote HEAD must both be verified commit SHAs');
  }
  if (candidateSha === remoteSha) {
    return { mode: 'current', candidateSha, remoteSha };
  }
  if (!allowPinned) {
    throw new Error('QA integration branch advanced; strict release requires the latest HEAD');
  }
  if (remoteDescendsFromCandidate !== true) {
    throw new Error('QA integration history changed or diverged; cannot publish this candidate');
  }
  return { mode: 'tested-snapshot', candidateSha, remoteSha };
}
