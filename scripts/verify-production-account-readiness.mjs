/**
 * Production account cutover hard gate: read-only, fail closed.
 *
 * Checks Cloudflare Worker configuration and the PUBLIC founder-ready status.
 * It never reads secret values, writes to a database or issues a registration.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_SCRIPT = 'mao';
export const PREVIEW_SCRIPT = 'mao-auth-preview';
const REQUIRED_SECRETS = ['DEVICE_SECRET_PEPPER', 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'];

export function auditProductionAccountReadiness({ production, preview, secrets, online, domains, hostname }) {
  const failures = [];
  const customDomains = Array.isArray(domains) ? domains : [];
  const mapping = customDomains.filter(domain => domain?.hostname === hostname);
  if (mapping.length !== 1 || typeof hostname !== 'string' || !hostname) {
    failures.push('PRODUCTION_DOMAIN_MAPPING_NOT_UNIQUE');
  } else if (mapping[0].service !== PRODUCTION_SCRIPT ||
             mapping[0].environment !== 'production') {
    failures.push('PRODUCTION_DOMAIN_TARGET_MISMATCH');
  }
  const prodBindings = Array.isArray(production?.bindings) ? production.bindings : [];
  const previewBindings = Array.isArray(preview?.bindings) ? preview.bindings : [];
  const prodDb = prodBindings.find(item => item.name === 'CLOUD_DB');
  const previewDb = previewBindings.find(item => item.name === 'CLOUD_DB');

  if (!prodBindings.some(item => item.name === 'ASSETS' && item.type === 'assets')) {
    failures.push('PROD_ASSETS_MISSING');
  }
  if (prodDb?.type !== 'durable_object_namespace' ||
      prodDb?.class_name !== 'CloudDatabase' ||
      !prodDb?.namespace_id) {
    failures.push('PROD_CLOUD_DB_NOT_READY');
  }
  if (!previewDb?.namespace_id) {
    failures.push('PREVIEW_DB_ID_UNAVAILABLE');
  } else if (prodDb?.namespace_id && prodDb.namespace_id === previewDb.namespace_id) {
    failures.push('PRODUCTION_REUSES_PREVIEW_DATABASE');
  }
  if (!production?.compatibility_flags?.includes('nodejs_compat')) {
    failures.push('NODE_CRYPTO_COMPAT_MISSING');
  }
  if (String(production?.compatibility_date || '') < '2024-09-23') {
    failures.push('NODE_CRYPTO_COMPAT_DATE_TOO_OLD');
  }

  const names = new Set((Array.isArray(secrets) ? secrets : []).map(item => item?.name));
  for (const name of REQUIRED_SECRETS) {
    if (!names.has(name)) failures.push('PROD_SECRET_MISSING_' + name);
  }

  if (online?.httpStatus !== 200) {
    failures.push('LIVE_ACCOUNT_STATUS_NOT_200');
  } else {
    if (online.body?.configured !== true) failures.push('LIVE_ACCOUNT_NOT_CONFIGURED');
    if (online.body?.initialized !== true) failures.push('FOUNDER_001_NOT_INITIALIZED');
  }
  return failures;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Cloudflare read-only resource returned HTTP ' + response.status);
  const result = await response.json();
  if (result?.success !== true) throw new Error('Cloudflare resource did not report success');
  return result.result;
}

async function verify() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const origin = String(process.env.MAOMAO_PRODUCTION_ORIGIN || '').trim();
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token || !/^https:\/\/[^/?#]+$/.test(origin)) {
    throw new Error('Release blocked: Cloudflare read-only credentials or explicit production origin are missing');
  }
  const endpoint = 'https://api.cloudflare.com/client/v4/accounts/' + accountId
    + '/workers/scripts/';
  const [production, preview, secrets, domains] = await Promise.all([
    getJson(endpoint + PRODUCTION_SCRIPT + '/settings', token),
    getJson(endpoint + PREVIEW_SCRIPT + '/settings', token),
    getJson(endpoint + PRODUCTION_SCRIPT + '/secrets', token),
    getJson('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/domains', token)
  ]);
  // No registration POST, login credentials, secret values or admin privileges.
  // The active existing production origin must ALREADY have server-authorized 001.
  const response = await fetch(origin + '/api/admin/bootstrap/status', {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000)
  });
  let body = {};
  if (response.status === 200) {
    try { body = await response.json(); } catch {}
  }
  const failures = auditProductionAccountReadiness({
    production, preview, secrets, domains, hostname: new URL(origin).hostname,
    online: { httpStatus: response.status, body }
  });
  if (failures.length) {
    for (const failure of failures) console.error('BLOCKED: ' + failure);
    throw new Error('Production account release gate failed: ' + failures.length + ' unmet condition(s)');
  }
  console.log('PASS: production domain maps to expected Worker, isolated DB, required secrets, native crypto, initialized founder 001');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify().catch(error => {
    console.error('RELEASE BLOCKED: ' + String(error?.message || error).slice(0, 250));
    process.exitCode = 1;
  });
}
