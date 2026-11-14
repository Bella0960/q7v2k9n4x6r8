/**
 * Read-only release gate for the ACTUAL deployed version and an EXPLICIT
 * candidate version. Never use "latest": a newly uploaded probe may have
 * no app assets or the wrong secret bindings.
 *
 * Does not access user records, secret values, SQL, or alter Cloudflare.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectActiveDeploymentVersionId } from '../verify-production-account-readiness.mjs';

const REQUIRED_SECRETS = [
  'DEVICE_SECRET_PEPPER',
  'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT'
];

const BINDING_TYPE = 'durable_object_namespace';
const SECRET_TYPE = 'secret_text';

function bindingMap(version) {
  return new Map((Array.isArray(version?.bindings) ? version.bindings : [])
    .filter(b => typeof b?.name === 'string' && b.name)
    .map(b => [b.name, b]));
}

export function auditStagedAccountVersion({ deployments, active, candidate, candidateVersionId, expectedActiveVersionId }) {
  const failures = [];
  let activeId;
  try {
    activeId = selectActiveDeploymentVersionId(deployments);
  } catch {
    return ['ACTIVE_DEPLOYMENT_UNAVAILABLE_OR_SPLIT'];
  }
  if (typeof expectedActiveVersionId !== 'string' || activeId !== expectedActiveVersionId) {
    failures.push('ACTIVE_DEPLOYMENT_CHANGED');
  }
  if (!candidateVersionId || candidate?.id !== candidateVersionId ||
      !/^[0-9a-f-]{36}$/i.test(candidateVersionId)) failures.push('EXPLICIT_CANDIDATE_VERSION_REQUIRED');
  if (candidateVersionId === activeId) failures.push('CANDIDATE_IS_ALREADY_LIVE');
  if (active?.id !== activeId) failures.push('ACTIVE_VERSION_METADATA_MISMATCH');
  if (!candidate?.id) failures.push('CANDIDATE_VERSION_METADATA_UNAVAILABLE');

  if (candidate?.main_module !== 'worker.js' ||
      active?.main_module !== 'worker.js') failures.push('WORKER_ENTRYPOINT_MISMATCH');
  if (!candidate?.compatibility_flags?.includes('nodejs_compat')) failures.push('NODE_CRYPTO_COMPAT_MISSING');

  const old = bindingMap(active);
  const staged = bindingMap(candidate);
  const oldDb = old.get('CLOUD_DB');
  const stagedDb = staged.get('CLOUD_DB');
  if (oldDb?.type !== BINDING_TYPE || !oldDb?.namespace_id ||
      stagedDb?.type !== BINDING_TYPE ||
      !stagedDb?.namespace_id || stagedDb.namespace_id !== oldDb.namespace_id) {
    failures.push('STAGED_DATABASE_NAMESPACE_CHANGED');
  }
  // An auth-only worker must never replace the app's existing static assets.
  if (old.get('ASSETS')?.type !== 'assets' || staged.get('ASSETS')?.type !== 'assets' ||
      candidate?.assets?.config?.run_worker_first !== true) {
    failures.push('STAGED_APP_ASSETS_MISSING');
  }
  const oldSecretNames = [...old].filter(([, b]) => b.type === SECRET_TYPE).map(([name]) => name);
  for (const name of new Set([...REQUIRED_SECRETS, ...oldSecretNames])) {
    if (staged.get(name)?.type !== SECRET_TYPE) {
      failures.push('STAGED_SECRET_MISSING_' + name);
    }
  }
  return failures;
}

async function readJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Cloudflare metadata read failed: HTTP ' + response.status);
  const body = await response.json();
  if (body?.success !== true) throw new Error('Cloudflare metadata read failed');
  return body.result;
}

export async function verifyStagedAccountVersion(env = process.env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const candidateVersionId = String(env.MAOMAO_CANDIDATE_VERSION_ID || '').trim();
  const expectedActiveVersionId = String(env.MAOMAO_EXPECTED_ACTIVE_VERSION_ID || '').trim();
  const worker = 'mao-auth-preview';
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token ||
      !/^[a-f0-9-]{36}$/i.test(candidateVersionId) ||
      !/^[a-f0-9-]{36}$/i.test(expectedActiveVersionId)) {
    throw new Error('Explicit read-only credentials and both pinned version IDs required');
  }
  const root = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
  const deployments = await readJson(root + '/workers/scripts/' + worker +
    '/deployments?page=1&per_page=1', token);
  const activeId = selectActiveDeploymentVersionId(deployments);
  // Avoid a stale candidate or a race with a new deployment.
  if (activeId !== expectedActiveVersionId) {
    throw new Error('Release blocked: active Worker changed during verification');
  }
  const getVersion = id => readJson(root + '/workers/workers/' + worker +
    '/versions/' + id, token);
  const [active, candidate] = await Promise.all([
    getVersion(activeId), getVersion(candidateVersionId)
  ]);
  const errors = auditStagedAccountVersion({
    deployments, active, candidate, candidateVersionId, expectedActiveVersionId
  });
  if (errors.length) throw new Error('Release blocked: ' + errors.join(','));
  return {
    ok: true,
    activeVersionId: activeId,
    candidateVersionId,
    databaseNamespaceUnchanged: true,
    requiredBindingsPresent: true
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyStagedAccountVersion().then(result => {
    console.log('PASS: explicit staged account version preserves active database, assets and secret bindings');
    console.log('Validated candidate version: ' + result.candidateVersionId);
  }).catch(error => {
    console.error('RELEASE BLOCKED: ' + String(error?.message || error).slice(0,480));
    process.exitCode = 1;
  });
}
