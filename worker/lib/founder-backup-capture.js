import { sealFounderBackup } from '../../scripts/release/founder-logical-backup.mjs';
import { ROOT_NAMESPACE_ID, ROOT_OBJECT_ID } from '../../scripts/release/founder-recovery-receipts.mjs';

export const FOUNDER_BACKUP_PATH = '/internal/release/founder-backup';
const headers = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const respond = (body, status) => new Response(JSON.stringify(body), { status, headers });

function matchesSecret(supplied, expected) {
  if (!/^[A-Za-z0-9_-]{48,256}$/.test(expected) || supplied.length > 256) return false;
  let difference = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return difference === 0;
}

export async function captureFounderBackupInternal({ request, env, state, now = Date.now }) {
  const url = new URL(request.url);
  const key = env?.FOUNDER_BACKUP_ENCRYPTION_KEY;
  const vault = env?.FOUNDER_BACKUP_VAULT;
  if (url.protocol !== 'https:' || url.hostname !== 'maomao.internal' ||
      url.pathname !== FOUNDER_BACKUP_PATH || request.method !== 'POST' ||
      env?.FOUNDER_BACKUP_CAPTURE_MODE !== 'read-only-sealed-backup' ||
      typeof key !== 'string' || typeof vault?.put !== 'function' ||
      state?.id?.toString() !== ROOT_OBJECT_ID) {
    return respond({ ok: false, error: 'not_found' }, 404);
  }
  if (!matchesSecret(request.headers.get('x-maomao-release-secret') || '',
    env.FOUNDER_RELEASE_OPERATOR_SECRET || '')) {
    return respond({ ok: false, error: 'forbidden' }, 403);
  }
  const start = Number(request.headers.get('x-maomao-backup-from'));
  const end = Number(request.headers.get('x-maomao-backup-until'));
  const time = now();
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      end <= start || end - start > 120000 || time < start || time >= end) {
    return respond({ ok: false, error: 'backup_window_closed' }, 403);
  }

  try {
    const sealed = await sealFounderBackup({ state, sourceNamespaceId: ROOT_NAMESPACE_ID, key });
    const { artifact, ciphertextSha256, sourceObjectId, sourceNamespaceId, createdAt } = sealed;
    await vault.put('founder-recovery/v1/' + ciphertextSha256 + '.json', artifact);
    // Return only metadata to the authorized private operator. Snapshot bytes
    // and credentials never become an HTTP response, including internal RPC.
    return respond({ ok: true, ciphertextSha256, sourceObjectId, sourceNamespaceId, createdAt }, 200);
  } catch {
    return respond({ ok: false, error: 'backup_capture_unavailable' }, 503);
  }
}
