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
const REQUIRED_SECRETS = ['DEVICE_SECRET_PEPPER', 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET', 'MAO_CANONICAL_FOUNDER_ID', 'MAO_CANONICAL_FOUNDER_CREATED_AT'];

/** Never accept a founder from the wrong Durable Object just because its display badge is 001. */
export function auditCanonicalFounderEvidence({ expectedId, expectedCreatedAt, rows }) {
  const errors = [];
  if (!/^MAO-[A-Z0-9]{12,24}$/.test(expectedId || '') ||
      !Number.isSafeInteger(Number(expectedCreatedAt)) || Number(expectedCreatedAt) <= 0) {
    errors.push('FOUNDER_ORIGIN_PIN_INVALID');
  }
  if (!Array.isArray(rows) || rows.length !== 1 ||
      rows[0]?.id !== expectedId || rows[0]?.role !== 'super_admin' ||
      rows[0]?.status !== 'active' || Number(rows[0]?.created_at) !== Number(expectedCreatedAt)) {
    errors.push('FOUNDER_ORIGIN_MISMATCH');
  }
  return errors;
}


export function auditProductionAccountReadiness({ production, preview, secrets, online, domains, hostname, namespaces }) {
  const failures = [];
  const customDomains = Array.isArray(domains) ? domains : [];
  const mapping = customDomains.filter(domain => domain?.hostname === hostname);
  if (mapping.length !== 1 || typeof hostname !== 'string' || !hostname) {
    failures.push('PRODUCTION_DOMAIN_MAPPING_NOT_UNIQUE');
  } else if (mapping[0].service !== PRODUCTION_SCRIPT ||
             mapping[0].environment !== 'production' ||
             mapping[0].enabled !== true) {
    failures.push('PRODUCTION_DOMAIN_TARGET_MISMATCH');
  }
  const prodBindings = Array.isArray(production?.bindings) ? production.bindings : [];
  const previewBindings = Array.isArray(preview?.bindings) ? preview.bindings : [];
  const prodDb = prodBindings.find(item => item.name === 'CLOUD_DB');
  const previewDb = previewBindings.find(item => item.name === 'CLOUD_DB');
  // Runtime pinning is optional for synthetic QA, but mandatory in production.
  // Presence of the secrets alone does not activate strict enforcement.
  const strictPins = prodBindings.filter(item => item?.name === 'MAO_CANONICAL_FOUNDER_REQUIRED');
  if (strictPins.length !== 1 || strictPins[0].type !== 'plain_text' ||
      strictPins[0].text !== 'true') {
    failures.push('PROD_FOUNDER_GUARD_NOT_REQUIRED');
  }

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

/**
 * Cloudflare DO SQL Query v2 is a POST transport, but the only SQL we ever
 * send here is this fixed SELECT. No secrets, password hashes or session
 * tokens are retrieved. Query the existing stored object ID; never create one.
 */
async function readFounderSqlEvidence({ accountId, token, namespaceId }) {
  if (!/^[a-f0-9]{32}$/.test(String(namespaceId || ''))) {
    throw new Error('FOUNDER_NAMESPACE_ID_INVALID');
  }
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId
    + '/workers/durable_objects/namespaces/' + namespaceId;
  const objects = await getJson(base + '/objects?limit=100', token);
  if (!Array.isArray(objects) || objects.length !== 1 ||
      objects[0]?.hasStoredData !== true ||
      !/^[a-f0-9]{64}$/.test(String(objects[0].id || ''))) {
    throw new Error('FOUNDER_NAMESPACE_OBJECT_NOT_UNIQUE');
  }
  const response = await fetch(base + '/query/v2', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token, Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      durable_object_id: objects[0].id,
      queries: [{
        sql: "SELECT id, role, status, created_at FROM mao_accounts WHERE role = 'super_admin' LIMIT 2"
      }]
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('FOUNDER_SQL_AUDIT_HTTP_' + response.status);
  const payload = await response.json();
  if (payload?.success !== true || payload.result?.error ||
      !Array.isArray(payload.result?.results) ||
      payload.result.results.length !== 1) {
    throw new Error('FOUNDER_SQL_AUDIT_FAILED');
  }
  const result = payload.result.results[0];
  const columns = result.columns;
  if (!Array.isArray(columns) || !Array.isArray(result.rows) ||
      !['id', 'role', 'status', 'created_at'].every(key => columns.includes(key)) ||
      result.meta?.rows_written !== 0) {
    throw new Error('FOUNDER_SQL_EVIDENCE_INVALID');
  }
  return result.rows.map(row =>
    Object.fromEntries(columns.map((key, index) => [key, row[index]]))
  );
}

/**
 * A schema-only inventory is NOT a backup. Only independently restored and
 * read-back-verified encrypted/controlled snapshots can release production.
 */
function isVerifiedTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function auditBackupEvidence({ backup, expectedId, expectedCreatedAt, sourceNamespace }) {
  const failures = [];
  if (!backup || backup.status !== 'verified' ||
      !Number.isSafeInteger(Number(backup.schema_count)) || Number(backup.schema_count) < 1 ||
      !Number.isSafeInteger(Number(backup.table_count)) || Number(backup.table_count) < 1 ||
      !Number.isSafeInteger(Number(backup.row_count)) || Number(backup.row_count) < 1 ||
      !/^[a-f0-9]{64}$/.test(String(backup.content_digest || '')) ||
      !isVerifiedTimestamp(backup.verified_at)) {
    failures.push('RESTORABLE_BACKUP_NOT_VERIFIED');
  }
  if (!/^[a-f0-9]{32}$/.test(String(sourceNamespace || '')) ||
      backup?.source_namespace !== sourceNamespace ||
      backup?.founder_id !== expectedId ||
      Number(backup?.founder_created_at) !== Number(expectedCreatedAt)) {
    failures.push('BACKUP_ORIGIN_MISMATCH');
  }
  return failures;
}

async function fetchVaultBackupEvidence({ accountId, token, databaseId }) {
  if (!/^[a-f0-9-]{36}$/.test(String(databaseId || ''))) {
    throw new Error('Release blocked: verified backup database reference is required');
  }
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId +
    '/d1/database/' + databaseId + '/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token, Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql: "SELECT source_namespace,founder_id,founder_created_at,status,schema_count,table_count,row_count,content_digest,verified_at FROM vault_snapshots WHERE status='verified' ORDER BY verified_at DESC LIMIT 1"
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Release blocked: private backup verification is unavailable');
  const payload = await response.json();
  if (payload?.success !== true ||
      payload.result?.length !== 1 || payload.result[0]?.success !== true) {
    throw new Error('Release blocked: backup evidence query failed');
  }
  return payload.result[0]?.results?.[0] || null;
}

async function verify() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const origin = String(process.env.MAOMAO_PRODUCTION_ORIGIN || '').trim();
  // Operator-approved snapshot of the ORIGINAL account, not a fresh account.
  // These values are compared to actual SQLite rows; neither is a credential.
  const expectedId = String(process.env.MAO_CANONICAL_FOUNDER_ID || '').trim();
  const expectedCreatedAt = Number(process.env.MAO_CANONICAL_FOUNDER_CREATED_AT || NaN);
  const originalNamespace = String(process.env.MAO_ORIGINAL_FOUNDER_NAMESPACE_ID || '').trim();
  const backupVaultId = String(process.env.MAOMAO_BACKUP_VAULT_D1_ID || '').trim();
  if (!/^MAO-[A-Z0-9]{12,24}$/.test(expectedId) ||
      !Number.isSafeInteger(expectedCreatedAt) || expectedCreatedAt <= 0) {
    throw new Error('Release blocked: exact original founder ID and registration timestamp are required');
  }
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token || !/^https:\/\/[^/?#]+$/.test(origin)) {
    throw new Error('Release blocked: Cloudflare read-only credentials or explicit production origin are missing');
  }
  const endpoint = 'https://api.cloudflare.com/client/v4/accounts/' + accountId
    + '/workers/scripts/';
  const [production, preview, secrets, domains, namespaces] = await Promise.all([
    getJson(endpoint + PRODUCTION_SCRIPT + '/settings', token),
    getJson(endpoint + PREVIEW_SCRIPT + '/settings', token),
    getJson(endpoint + PRODUCTION_SCRIPT + '/secrets', token),
    getJson('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/domains', token),
    listAllDurableObjectNamespaces({ accountId, token, requestJson: getEnvelope })
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
    production, preview, secrets, domains, namespaces, hostname: new URL(origin).hostname,
    online: { httpStatus: response.status, body }
  });
  if (failures.length) {
    for (const failure of failures) console.error('BLOCKED: ' + failure);
    throw new Error('Production account release gate failed: ' + failures.length + ' unmet condition(s)');
  }
  // Infrastructure + public initialized=true alone is not identity proof.
  // Only the original ID AND original registration timestamp may pass.
  const prodDb = (Array.isArray(production?.bindings) ? production.bindings : [])
    .find(binding => binding?.name === 'CLOUD_DB');
  const rows = await readFounderSqlEvidence({
    accountId, token, namespaceId: prodDb?.namespace_id
  });
  const founderErrors = auditCanonicalFounderEvidence({ expectedId, expectedCreatedAt, rows });
  if (founderErrors.length) {
    for (const failure of founderErrors) console.error('BLOCKED: ' + failure);
    throw new Error('Release blocked: production SQLite does not contain the selected original founder');
  }
  // Never allow a point-in-time bookmark or schema-only inventory to masquerade
  // as an independent restorable backup. No verified snapshot => no release.
  const evidence = await fetchVaultBackupEvidence({
    accountId, token, databaseId: backupVaultId
  });
  const backupFailures = auditBackupEvidence({
    backup: evidence, expectedId, expectedCreatedAt, sourceNamespace: originalNamespace
  });
  if (backupFailures.length) {
    for (const issue of backupFailures) console.error('BLOCKED: ' + issue);
    throw new Error('Release blocked: original founder database has no verified restorable backup');
  }
  console.log('PASS: original founder backup provenance and independent readback are verified');
  console.log('PASS: production namespace includes the exact original 001 identity and creation time, without SQL writes');
  console.log('PASS: production domain maps to expected Worker, isolated DB, required secrets, native crypto, initialized founder 001');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify().catch(error => {
    console.error('RELEASE BLOCKED: ' + String(error?.message || error).slice(0, 250));
    process.exitCode = 1;
  });
}

