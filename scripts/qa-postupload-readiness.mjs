/**
 * Strictly bounded readiness retries for the POST-deployment HTTP checks.
 * Cloudflare edge propagation can briefly serve an earlier static asset.
 * Retrying never marks a failed check as success, never skips the SHA check,
 * and never modifies or deploys anything.
 */
const BACKOFF_MS = Object.freeze([0, 750, 1500, 2500, 4000]);
const TEMPORARY_READINESS = /(?:fetch failed|\bETIMEDOUT\b|\bECONNRESET\b|\bENOTFOUND\b|\bEAI_AGAIN\b|AbortError|The owner QA domain did not serve the build receipt|serving a different QA build than the tested git SHA|QA status endpoint did not return HTTP 200|QA login document did not return HTTP 200|QA linked stylesheet did not return HTTP 200|QA login HTML is still referencing cached older JavaScript|QA login source stylesheet is stale or missing|QA login HTML does not actually load the password warning style|QA login JavaScript did not return HTTP 200|QA login stylesheet did not return HTTP 200|QA founder setup HTML did not return HTTP 200|QA founder setup JavaScript did not return HTTP 200)/i;

export async function assertPostUploadQaHttpReady(check, {
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (typeof check !== 'function' || typeof sleep !== 'function') {
    throw new TypeError('QA readiness requires read-only check and sleep callbacks');
  }
  for (let index = 0; index < BACKOFF_MS.length; index++) {
    if (index > 0) await sleep(BACKOFF_MS[index]);
    try {
      // The caller MUST perform all of its checks on every attempt.
      // Partial success from one attempt never carries into the next one.
      await check();
      return Object.freeze({ attempts: index + 1 });
    } catch (error) {
      // Unknown errors or broken security/account invariants fail at once.
      // Even retryable errors fail closed if the final check stays unhealthy.
      if (index === BACKOFF_MS.length - 1 ||
          !TEMPORARY_READINESS.test(String(error?.message || ''))) {
        throw error;
      }
    }
  }
  throw new Error('QA readiness exhausted unexpectedly');
}
