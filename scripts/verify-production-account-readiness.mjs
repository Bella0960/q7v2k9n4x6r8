/**
 * Production account cutover hard gate: read-only, fail closed.
 *
 * Checks Cloudflare Worker configuration and the PUBLIC founder-ready status.
 * It never reads secret values, writes to a database or issues a registration.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAllDurableObjectNamespaces, isCanonicalWorkerNamespace } from './lib/cloudflare-namespace-inventory.mjs';

export const PRODUCTION_SCRIPT = 'mao';
export const PREVIEW_SCRIPT = 'mao-auth-preview';
export const OFFICIAL_EDGE_SCRIPT = 'curly-dream-324c';
const REQUIRED_SECRETS = ['DEVICE_SECRET_PEPPER', 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'];

/**
 * A verified gateway is not a durable release if the next automatic push
 * silently overwrites it with the old static Worker. Check actual remote
 * Cloudflare Build triggers, not a repository comment or plan.
 */
export function auditOfficialAutoDeployTrigger(triggers) {
  if (!Array.isArray(triggers)) return ['OFFICIAL_AUTO_DEPLOY_UNVERIFIED'];
  const activeMain = triggers.filter(t => Array.isArray(t?.branch_includes) &&
    t.branch_includes.includes('main'));
  if (activeMain.length !== 1) return ['OFFICIAL_AUTO_DEPLOY_UNVERIFIED'];
  const cmd = String(activeMain[0].deploy_command || '').trim();
  if (!/(?:^|\\s)wrangler deploy --config wrangler\\.app\\.cutover\\.jsonc --keep-vars(?:\\s|$)/.test(cmd))
    return ['OFFICIAL_AUTO_DEPLOY_REVERTS_STATIC'];
  return [];
}

export function auditProductionAccountReadiness({ production, preview, appGateway = null, autoDeployTriggers = null, secrets, online, domains, hostname, namespaces }) {
  const failures = [];
  const customDomains = Array.isArray(domains) ? domains : [];
  const mapping = customDomains.filter(domain => domain?.hostname === hostname);
  if (mapping.length !== 1 || typeof hostname !== 'string' || !hostname) {
    failures.push('PRODUCTION_DOMAIN_MAPPING_NOT_UNIQUE');
  } else if (mapping[0].environment !== 'production' || mapping[0].enabled !== true) {
    failures.push('PRODUCTION_DOMAIN_TARGET_MISMATCH');
  } else if (mapping[0].service === OFFICIAL_EDGE_SCRIPT) {
    // The paid app hostname can retain its original Worker name when it
    // delegates the WHOLE authenticated origin to the verified full backend.
    // Inspect the 100%-deployed *version*, never a staged settings upload.
    const bindings = Array.isArray(appGateway?.bindings) ? appGateway.bindings : [];
    const service = bindings.filter(item => item?.type === 'service');
    const switchBinding = bindings.find(item => item?.name === 'MAO_APP_CUTOVER_ENABLED');
    if (appGateway?.main_module !== 'worker-app-cutover.js' ||
        switchBinding?.type !== 'plain_text' || switchBinding?.text !== 'true' ||
        service.length !== 1 ||
        service[0]?.name !== 'MAO_APP_BACKEND' ||
        service[0]?.service !== PRODUCTION_SCRIPT ||
        (service[0]?.environment && service[0].environment !== 'production') ||
        !bindings.some(item => item.name === 'ASSETS' && item.type === 'assets') ||
        bindings.some(item => item.type === 'durable_object_namespace')) {
      failures.push('PRODUCTION_GATEWAY_NOT_VERIFIED');
      failures.push('PRODUCTION_DOMAIN_TARGET_MISMATCH');
    }
    failures.push(...auditOfficialAutoDeployTrigger(autoDeployTriggers));
  } else if (mapping[0].service !== PRODUCTION_SCRIPT) {
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
      !prodDb?.namespace_id || prodDb?.script_name) {
    failures.push('PROD_CLOUD_DB_NOT_READY');
  }
  if (!previewDb?.namespace_id) {
    failures.push('PREVIEW_DB_ID_UNAVAILABLE');
  } else if (prodDb?.namespace_id && prodDb.namespace_id === previewDb.namespace_id) {
    failures.push('PRODUCTION_REUSES_PREVIEW_DATABASE');
  }
  // Merely differing from the preview DB ID is insufficient: an old QA
  // namespace from another branch would otherwise pass the production gate.
  if (!Array.isArray(namespaces)) failures.push('PROD_NAMESPACE_INVENTORY_UNAVAILABLE');
  if (prodDb?.namespace_id &&
      !isCanonicalWorkerNamespace(namespaces, prodDb.namespace_id, PRODUCTION_SCRIPT)) {
    failures.push('PROD_NAMESPACE_NOT_CANONICAL');
  }
  if (previewDb?.namespace_id &&
      !isCanonicalWorkerNamespace(namespaces, previewDb.namespace_id, PREVIEW_SCRIPT)) {
    failures.push('PREVIEW_NAMESPACE_INVENTORY_MISMATCH');
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

// Cloudflare /scripts/:name/settings and /secrets represent the MOST RECENTLY
// UPLOADED version, not necessarily the one receiving real traffic. A staged
// checkpoint probe or incomplete candidate must never be treated as live.
export function selectActiveDeploymentVersionId(data) {
  const deployment = Array.isArray(data?.deployments) ? data.deployments[0] : null;
  const versions = deployment?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 ||
      versions[0]?.percentage !== 100 ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(versions[0]?.version_id || '')) {
    throw new Error('Release blocked: no single fully deployed Worker version');
  }
  return versions[0].version_id;
}

async function getOfficialBuildTriggers({ accountId, token }) {
  const workers = await getJson(
    'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/scripts',
    token
  );
  const edge = Array.isArray(workers) ? workers.find(w => w?.id === OFFICIAL_EDGE_SCRIPT) : null;
  if (!/^[a-f0-9]{32}$/i.test(edge?.tag || ''))
    throw new Error('Release blocked: official Worker build target unavailable');
  return getJson('https://api.cloudflare.com/client/v4/accounts/' + accountId +
    '/builds/workers/' + edge.tag + '/triggers', token);
}

async function getActiveWorkerVersion({ accountId, scriptName, token }) {
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
  const deployments = await getJson(base + '/workers/scripts/' + scriptName +
    '/deployments?page=1&per_page=1', token);
  const id = selectActiveDeploymentVersionId(deployments);
  // The v2 version endpoint includes *version-specific* bindings and runtime
  // compatibility flags. It does not reveal encrypted secret values.
  const version = await getJson(base + '/workers/workers/' + scriptName +
    '/versions/' + id, token);
  if (version?.id !== id || !Array.isArray(version.bindings) || !version.main_module) {
    throw new Error('Release blocked: active Worker version metadata unavailable');
  }
  return version;
}

async function verify() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const origin = String(process.env.MAOMAO_PRODUCTION_ORIGIN || '').trim();
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token || !/^https:\/\/[^/?#]+$/.test(origin)) {
    throw new Error('Release blocked: Cloudflare read-only credentials or explicit production origin are missing');
  }
  const [production, preview, domains, namespaces] = await Promise.all([
    getActiveWorkerVersion({ accountId, scriptName: PRODUCTION_SCRIPT, token }),
    getActiveWorkerVersion({ accountId, scriptName: PREVIEW_SCRIPT, token }),
    getJson('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/domains', token),
    listAllDurableObjectNamespaces({ accountId, token, requestJson: getEnvelope })
  ]);
  const liveHost = new URL(origin).hostname;
  const usesOfficialGateway = domains.some(d => d?.hostname === liveHost &&
    d?.service === OFFICIAL_EDGE_SCRIPT);
  const [appGateway, autoDeployTriggers] = await Promise.all([
    usesOfficialGateway
      ? getActiveWorkerVersion({ accountId, scriptName: OFFICIAL_EDGE_SCRIPT, token })
      : Promise.resolve(null),
    usesOfficialGateway
      ? getOfficialBuildTriggers({ accountId, token })
      : Promise.resolve(null)
  ]);
  // Production cannot pass merely because some *other* administrator has
  // initialized the backend. The four live stores must retain the selected
  // 001 and every existing member; query only aggregate counts on the actual
  // deployed Durable Object namespaces (never a staged/Preview upload).
  const { auditCloudflareAccounts } = await import('./release/audit-live-account-inventory.mjs');
  const inventory = await auditCloudflareAccounts({
    accountId, token, founderId: String(process.env.MAO_EXPECTED_FOUNDER_ID || '')
  });
  if (inventory.inventoryIssues.length) {
    for (const issue of inventory.inventoryIssues)
      console.error('BLOCKED: ' + issue);
    throw new Error('Live account continuity not ready: ' +
      inventory.inventoryIssues.length + ' unmet condition(s)');
  }
  const secrets = production.bindings.filter(item => item.type === 'secret_text');
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
    production, preview, appGateway, autoDeployTriggers, secrets, domains, namespaces, hostname: liveHost,
    online: { httpStatus: response.status, body }
  });
  if (failures.length) {
    for (const failure of failures) console.error('BLOCKED: ' + failure);
    throw new Error('Production account release gate failed: ' + failures.length + ' unmet condition(s)');
  }
  console.log('PASS: deployed official domain uses a verified full backend (direct or guarded gateway); isolated DB, required secrets, native crypto, initialized founder 001');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify().catch(error => {
    console.error('RELEASE BLOCKED: ' + String(error?.message || error).slice(0, 250));
    process.exitCode = 1;
  });
}
