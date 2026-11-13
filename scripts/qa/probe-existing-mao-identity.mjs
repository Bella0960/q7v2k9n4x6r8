// Safe Cloudflare Builds diagnostic of the user's OWN deployed preview.
// GET only: never sends a password, registration, invitation, or admin claim.
// Does not run as part of the normal site and must never cause a deployment.
const endpoint = 'https://feat-mao-social-admin-approval-20261112-mao.miamor520000.workers.dev/api/admin/bootstrap/status';
const response = await fetch(endpoint, {
  method: 'GET',
  redirect: 'manual',
  cache: 'no-store',
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(15000)
});
if (response.status !== 200) {
  console.log('IDENTITY_PROBE_HTTP_STATUS', response.status);
  process.exitCode = 2;
} else {
  const data = await response.json();
  if (data?.ok !== true || data?.identityMode !== 'delegated' ||
      typeof data?.identityAuthorityConnected !== 'boolean' ||
      typeof data?.identityAuthorityInitialized !== 'boolean' ||
      typeof data?.signInReady !== 'boolean') {
    console.log('IDENTITY_PROBE_INVALID_RESPONSE');
    process.exitCode = 2;
  } else {
    console.log('IDENTITY_PROBE_RESULT', JSON.stringify({
      authorityConnected: data.identityAuthorityConnected,
      authorityInitialized: data.identityAuthorityInitialized,
      signInReady: data.signInReady,
      noPreviewBootstrap: data.bootstrapAllowed === false
    }));
  }
}
