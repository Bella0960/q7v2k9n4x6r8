/**
 * Read ONLY the actual deployed Durable Object SQLite namespace for each
 * existing MAOMAO account service. Aggregates only: no rows, password hashes,
 * sessions, secrets, or PITR bookmarks are exported. NOT a backup or release.
 */
import { selectActiveDeploymentVersionId } from '../verify-production-account-readiness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACCOUNT_STORES = Object.freeze({
  existingMembers: 'mao-auth-preview',
  integratedBackend: 'mao',
  isolatedQA: 'maomao-aw-qa-20261114',
  permanentIdentity: 'maomao-identity-core'
});
const FOUNDER_ID = /^MAO-[A-Z0-9]{12,24}$/;
const BASE = 'https://api.cloudflare.com/client/v4/accounts/';

export function makeAggregateQueries(id) {
  if (!FOUNDER_ID.test(id || '')) throw Error('EXPECTED_FOUNDER_ID_INVALID');
  return [
    { sql: "SELECT COUNT(*) AS accounts, " +
      "COALESCE(SUM(CASE WHEN role = 'super_admin' THEN 1 ELSE 0 END),0) AS admins, " +
      "COALESCE(SUM(CASE WHEN role != 'super_admin' THEN 1 ELSE 0 END),0) AS members, " +
      "COALESCE(SUM(CASE WHEN id = ? AND role = 'super_admin' AND status = 'active' THEN 1 ELSE 0 END),0) AS selected_admin, " +
      "COALESCE(SUM(CASE WHEN id = ? THEN 1 ELSE 0 END),0) AS selected_exists FROM mao_accounts",
      params: [id, id] },
    { sql: 'SELECT COUNT(*) AS audit_events FROM mao_account_audit' },
    { sql: 'SELECT COUNT(*) AS sessions FROM mao_account_sessions' },
    { sql: 'SELECT COUNT(*) AS invitations FROM mao_invite_codes' },
    { sql: 'SELECT COUNT(*) AS migrations FROM schema_migrations' }
  ];
}

function count(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw Error('ACCOUNT_INVENTORY_INVALID_COUNT');
  return v;
}
export function parseAggregateResults(payload) {
  const items = payload?.result?.results;
  const names = [
    ['accounts','admins','members','selected_admin','selected_exists'],
    ['audit_events'],['sessions'],['invitations'],['migrations']
  ];
  if (payload?.success !== true || !Array.isArray(items) || items.length !== names.length)
    throw Error('ACCOUNT_INVENTORY_RESPONSE_INVALID');
  const output = {};
  for (let i=0;i<names.length;i++) {
    const item = items[i];
    if (!Array.isArray(item?.rows) || item.rows.length !== 1 ||
        !Array.isArray(item.rows[0]) || !Array.isArray(item.columns) ||
        item.columns.join('|') !== names[i].join('|') || item.meta?.rows_written !== 0)
      throw Error('ACCOUNT_INVENTORY_NOT_PROVABLY_READ_ONLY');
    names[i].forEach((key,j) => { output[key] = count(item.rows[0][j]); });
  }
  if (output.admins + output.members !== output.accounts ||
      output.selected_admin > 1 || output.selected_exists > 1 ||
      output.selected_admin > output.selected_exists)
    throw Error('ACCOUNT_INVENTORY_CONTRADICTORY');
  return Object.freeze(output);
}
export function auditLiveContinuity(stores) {
  const issues = [];
  const old = stores?.existingMembers;
  const qa = stores?.isolatedQA;
  const prod = stores?.integratedBackend;
  const identity = stores?.permanentIdentity;
  if (!old || !qa || !prod || !identity) return ['ACCOUNT_STORES_INCOMPLETE'];
  if (old.accounts < 1 || old.members < 1) issues.push('EXISTING_LIVE_MEMBER_NOT_VERIFIED');
  if (old.admins !== 1) issues.push('OLD_AUTHORITY_ADMIN_STATE_UNEXPECTED');
  if (old.admins === 1 && old.selected_admin !== 1)
    issues.push('OLD_AUTHORITY_HAS_DIFFERENT_FOUNDER');
  if (qa.admins !== 1 || qa.selected_admin !== 1)
    issues.push('SELECTED_FOUNDER_QA_NOT_CONFIRMED');
  if (prod.admins !== 1 || prod.selected_admin !== 1)
    issues.push('INTEGRATED_BACKEND_FOUNDER_NOT_READY');
  if (identity.admins !== 1 || identity.selected_admin !== 1)
    issues.push('PERMANENT_IDENTITY_NOT_READY');
  if (prod.members < old.members)
    issues.push('EXISTING_MEMBERS_NOT_CONTINUOUS_IN_BACKEND');
  // Aggregate continuity is a necessary, never sufficient, release condition.
  return Object.freeze(issues);
}

async function requestJson(url, token, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw Error('ACCOUNT_INVENTORY_API_HTTP_' + res.status);
  const payload = await res.json();
  if (payload?.success !== true) throw Error('ACCOUNT_INVENTORY_API_REJECTED');
  return payload;
}
async function activeNamespace(accountId, script, token) {
  const root = BASE + accountId;
  const dep = await requestJson(root + '/workers/scripts/' + script +
    '/deployments?page=1&per_page=1', token);
  const activeId = selectActiveDeploymentVersionId(dep.result);
  const version = await requestJson(root + '/workers/workers/' + script +
    '/versions/' + activeId, token);
  if (version.result?.id !== activeId || !Array.isArray(version.result?.bindings))
    throw Error('ACCOUNT_ACTIVE_VERSION_UNAVAILABLE');
  const bindings = version.result.bindings.filter(x => x.name === 'CLOUD_DB');
  if (bindings.length !== 1 ||
      bindings[0]?.type !== 'durable_object_namespace' ||
      bindings[0]?.class_name !== 'CloudDatabase' ||
      !bindings[0]?.namespace_id || bindings[0]?.script_name)
    throw Error('ACCOUNT_ACTIVE_NAMESPACE_UNTRUSTED');
  return bindings[0].namespace_id;
}
export async function auditCloudflareAccounts({ accountId, token, founderId }) {
  if (!/^[a-f0-9]{32}$/.test(accountId || '') || !token ||
      !FOUNDER_ID.test(founderId || ''))
    throw Error('ACCOUNT_INVENTORY_INPUTS_REQUIRED');
  const stores = {};
  const seen = new Set();
  for (const [key, script] of Object.entries(ACCOUNT_STORES)) {
    const ns = await activeNamespace(accountId, script, token);
    if (seen.has(ns)) throw Error('ACCOUNT_STORES_SHARE_NAMESPACE');
    seen.add(ns);
    const payload = await requestJson(BASE + accountId +
      '/workers/durable_objects/namespaces/' + ns + '/query/v2',
      token, { durable_object_name: 'maomao-global', jurisdiction: 'none',
        queries: makeAggregateQueries(founderId) });
    stores[key] = parseAggregateResults(payload);
  }
  return Object.freeze({
    stores: Object.freeze(stores),
    inventoryIssues: auditLiveContinuity(stores),
    releaseApproved: false
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditCloudflareAccounts({
    accountId: String(process.env.CLOUDFLARE_ACCOUNT_ID || ''),
    token: String(process.env.CLOUDFLARE_API_TOKEN || ''),
    founderId: String(process.env.MAO_EXPECTED_FOUNDER_ID || '')
  }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.inventoryIssues.length) process.exitCode = 2;
  }).catch(error => {
    console.error('ACCOUNT INVENTORY BLOCKED:',
      /^[A-Z0-9_]+$/.test(error?.message || '')
        ? error.message : 'ACCOUNT_INVENTORY_UNAVAILABLE');
    process.exitCode = 1;
  });
}
