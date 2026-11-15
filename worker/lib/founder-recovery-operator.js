import { recordFounderCheckpoint, rotateStaleFounderCheckpoint } from '../../scripts/release/founder-checkpoint.mjs';

// This path exists only on the private Durable Object stub. The public Worker
// entrypoint forwards /api/* and does NOT forward /internal/*.
// Defense in depth: even an accidental future proxy must also have a separate
// high-entropy operator secret. This helper NEVER performs a restore/cutover.
export const FOUNDER_CHECKPOINT_PATH = '/internal/release/checkpoint';
export const FOUNDER_ROTATE_PATH = '/internal/release/checkpoint-rotate';

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const json = (value, status) => new Response(JSON.stringify(value), { status, headers: HEADERS });

function fixedTimeEqual(received, expected) {
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength > 256 || b.byteLength > 256) return false;
  let different = a.byteLength ^ b.byteLength;
  for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i++) {
    different |= (a[i] || 0) ^ (b[i] || 0);
  }
  return different === 0;
}

export async function handleFounderCheckpointInternal({ request, env, storage, now = Date.now }) {
  const url = new URL(request.url);
  const configured = env?.FOUNDER_RELEASE_OPERATOR_SECRET;
  // Missing secret means the capability cannot even be probed. The operator
  // must use the explicitly configured private Worker-to-DO binding.
  if (typeof configured !== 'string' || configured.length < 48 ||
      configured.length > 256 || !/^[A-Za-z0-9_-]+$/.test(configured)) {
    return json({ ok: false, error: 'not_found' }, 404);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'maomao.internal' ||
      url.pathname !== FOUNDER_CHECKPOINT_PATH || request.method !== 'POST') {
    return json({ ok: false, error: 'not_found' }, 404);
  }
  const token = request.headers.get('x-maomao-release-secret') || '';
  if (!fixedTimeEqual(token, configured)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  try {
    const { recordedAt } = await recordFounderCheckpoint({ storage, now });
    // Never send a raw bookmark, secret, previous credentials or SQL payload.
    return json({ ok: true, recorded: true, recordedAt }, 200);
  } catch {
    return json({ ok: false, error: 'checkpoint_unavailable' }, 503);
  }
}

/** Only a separately reviewed private operator may preserve + rotate an old PITR lease.
 * No public Worker route forwards /internal/*, no data is restored or exported.
 */
export async function handleFounderCheckpointRotationInternal({ request, env, storage, now = Date.now }) {
  const url=new URL(request.url);
  const configured=env?.FOUNDER_RELEASE_OPERATOR_SECRET;
  if(typeof configured!=='string' || configured.length<48 || configured.length>256 ||
     !/^[A-Za-z0-9_-]+$/.test(configured)) return json({ok:false,error:'not_found'},404);
  if(url.protocol!=='https:' || url.hostname!=='maomao.internal' ||
     url.pathname!==FOUNDER_ROTATE_PATH || request.method!=='POST' ||
     request.headers.get('x-maomao-release-operation')!=='preserve-old-checkpoint-and-rotate') {
    return json({ok:false,error:'not_found'},404);
  }
  if(!fixedTimeEqual(request.headers.get('x-maomao-release-secret')||'',configured))
    return json({ok:false,error:'forbidden'},403);
  try{
    const result=await rotateStaleFounderCheckpoint({storage,now});
    return json({ok:true,recorded:true,recordedAt:result.recordedAt,rotated:result.rotated},200);
  }catch{
    return json({ok:false,error:'rotation_unavailable'},409);
  }
}
