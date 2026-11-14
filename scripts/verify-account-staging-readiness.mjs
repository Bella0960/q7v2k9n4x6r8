/**
 * Read-only preparation gate for the `mao` account Worker BEFORE routing
 * app.mao520.com away from its currently running static Worker.
 *
 * This is NOT production approval: it cannot prove founder initialization,
 * a successful login or any phone/browser acceptance result.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SCRIPT, PREVIEW_SCRIPT } from './verify-production-account-readiness.mjs';
import { listAllDurableObjectNamespaces, isCanonicalWorkerNamespace } from './lib/cloudflare-namespace-inventory.mjs';

export const CURRENT_LIVE_SCRIPT = 'curly-dream-324c';
export const LIVE_HOSTNAME = 'app.mao520.com';
export const STAGING_REQUIRED_SECRETS = [
  'DEVICE_SECRET_PEPPER',
  'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'
];

export function auditAccountStagingInfrastructure({ staging, preview, secrets, subdomain, domains, namespaces }) {
  const issues = [];
  const bindings = Array.isArray(staging?.bindings) ? staging.bindings : [];
  const previewBindings = Array.isArray(preview?.bindings) ? preview.bindings : [];
  const stageDb = bindings.find(binding => binding?.name === 'CLOUD_DB');
  const previewDb = previewBindings.find(binding => binding?.name === 'CLOUD_DB');

  if (!bindings.some(binding => binding?.name === 'ASSETS' && binding.type === 'assets')) {
    issues.push('STAGING_ASSETS_MISSING');
  }
  if (stageDb?.type !== 'durable_object_namespace' ||
      stageDb?.class_name !== 'CloudDatabase' ||
      !stageDb?.namespace_id ||
      stageDb?.script_name) {
    issues.push('STAGING_SQLITE_BINDING_NOT_READY');
  }
  if (previewDb?.type !== 'durable_object_namespace' || !previewDb?.namespace_id) {
    issues.push('PREVIEW_NAMESPACE_UNAVAILABLE');
  } else if (stageDb?.namespace_id && previewDb.namespace_id === stageDb.namespace_id) {
    issues.push('STAGING_REUSES_PREVIEW_NAMESPACE');
  }
  // Cloudflare retains many branch-specific preview namespaces. A different
  // namespace ID alone does not prove this is the canonical production database.
  const inventory = Array.isArray(namespaces) ? namespaces : [];
  if (!Array.isArray(namespaces)) issues.push('STAGING_NAMESPACE_INVENTORY_UNAVAILABLE');
  if (stageDb?.namespace_id) {
    if (!isCanonicalWorkerNamespace(inventory, stageDb.namespace_id, PRODUCTION_SCRIPT)) {
      issues.push('STAGING_NAMESPACE_NOT_CANONICAL');
    }
  }
  if (previewDb?.namespace_id) {
    if (!isCanonicalWorkerNamespace(inventory, previewDb.namespace_id, PREVIEW_SCRIPT)) {
      issues.push('PREVIEW_NAMESPACE_INVENTORY_MISMATCH');
    }
  }
  if (!staging?.compatibility_flags?.includes('nodejs_compat') ||
      String(staging?.compatibility_date || '') < '2024-09-23') {
    issues.push('STAGING_NODE_CRYPTO_NOT_READY');
  }
  if (subdomain?.enabled !== true) issues.push('STAGING_WORKERS_DEV_DISABLED');
  const names = new Set((Array.isArray(secrets) ? secrets : []).map(binding => binding?.name));
  for (const name of STAGING_REQUIRED_SECRETS) {
    if (!names.has(name)) issues.push('STAGING_SECRET_MISSING_' + name);
  }

  const mappings = (Array.isArray(domains) ? domains : [])
    .filter(domain => domain?.hostname === LIVE_HOSTNAME);
  if (mappings.length !== 1) {
    issues.push('LIVE_DOMAIN_MAPPING_AMBIGUOUS');
  } else if (mappings[0].service !== CURRENT_LIVE_SCRIPT ||
             mappings[0].environment !== 'production' ||
             mappings[0].enabled !== true) {
    issues.push('LIVE_DOMAIN_ALREADY_CHANGED_OR_DISABLED');
  }

  return issues;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Cloudflare infrastructure request returned HTTP ' + response.status);
  const body = await response.json();
  if (body?.success !== true) throw new Error('Cloudflare infrastructure request did not report success');
  return body.result;
}

async function getEnvelope(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Cloudflare namespace request returned HTTP ' + response.status);
  const body = await response.json();
  if (body?.success !== true) throw new Error('Cloudflare namespace listing did not report success');
  return body;
}

async function main() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token) {
    throw new Error('Read-only staging audit requires Cloudflare account ID and API token');
  }
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/scripts/';
  const [staging, preview, secrets, subdomain, domains, namespaces] = await Promise.all([
    getJson(base + PRODUCTION_SCRIPT + '/settings', token),
    getJson(base + PREVIEW_SCRIPT + '/settings', token),
    getJson(base + PRODUCTION_SCRIPT + '/secrets', token),
    getJson(base + PRODUCTION_SCRIPT + '/subdomain', token),
    getJson('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/domains', token),
    listAllDurableObjectNamespaces({ accountId, token, requestJson: getEnvelope })
  ]);
  const issues = auditAccountStagingInfrastructure({ staging, preview, secrets, subdomain, domains, namespaces });
  if (issues.length) {
    for (const issue of issues) console.error('STAGING BLOCKED: ' + issue);
    throw new Error('Staging infrastructure has ' + issues.length + ' unmet prerequisite(s)');
  }
  console.log('PASS: isolated staging Worker infrastructure ready; production domain still unchanged.');
  console.log('NOT VERIFIED: founder 001, login, registration, Android/iOS and production cutover.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('STAGING BLOCKED: ' + String(error?.message || error).slice(0, 220));
    process.exitCode = 1;
  });
}
