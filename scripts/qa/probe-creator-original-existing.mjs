/**
 * Read-only HTTP acceptance of the *actual* creator's existing Nov-11 QA URL.
 * No credentials, account IDs, database secrets, state changes or writes.
 */
const base = 'https://qa-phone-founder-001-keyreset-20261111.preview.mao520.com';
const options = { method: 'GET', cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000) };
const [statusResponse, homeResponse] = await Promise.all([
  fetch(base + '/api/admin/bootstrap/status', options),
  fetch(base + '/index.html', options)
]);
const body = await statusResponse.json().catch(() => null);
const visible = {
  http: statusResponse.status,
  mode: body?.identityMode,
  initialized: body?.initialized,
  configured: body?.configured,
  signInReady: body?.signInReady,
  anonymousHomeHttp: homeResponse.status,
  homeRedirectsToLogin: new URL(homeResponse.headers.get('location') || '/', base).pathname === '/account/index.html'
};
console.log('CREATOR_001_LIVE_READ_ONLY_PROBE', JSON.stringify(visible));
if (statusResponse.status !== 200 || body?.ok !== true ||
    body.identityMode !== 'local' || body.initialized !== true ||
    body.configured !== true || body.signInReady !== true ||
    homeResponse.status !== 302 || !visible.homeRedirectsToLogin) {
  throw new Error('Existing founder preview is not fully ready: no password request was sent');
}
